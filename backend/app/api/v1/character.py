import logging
import os
import io
import uuid
import random
import string
import json
import subprocess
import asyncio
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from pydantic import BaseModel
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import Optional, List
from PIL import Image

from app.db.session import get_db
from app.api.v1.auth import get_current_user_dep
from app.schemas.user import TokenData
from app.schemas.character import CharacterCreate, CharacterUpdate, CharacterResponse, CharacterListResponse, BorrowByUidRequest, UpdateSpeakerIdRequest
from app.models.character import GameCharacter, CharacterBorrow
from app.services.expression_service import expression_service
from app.services.remove_bg_client import remove_bg_async
from app.services.tts_request_manager import tts_request_manager, TTSAPIError
from app.core.websocket import game_ws_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Character"])

UPLOAD_DIR = os.getenv("CHARACTER_UPLOAD_DIR", "/uploads/characters")
os.makedirs(UPLOAD_DIR, exist_ok=True)

VOICE_SAMPLE_DIR = os.getenv("VOICE_SAMPLE_DIR", "/uploads/tts/voice_samples")
os.makedirs(VOICE_SAMPLE_DIR, exist_ok=True)


async def _convert_to_wav(input_path: str, output_path: str) -> bool:
    """用 ffmpeg 将音频转为 WAV（24k 单声道 16bit PCM）"""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y",
            "-i", input_path,
            "-ar", "24000",
            "-ac", "1",
            "-sample_fmt", "s16",
            output_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            logger.warning(f"ffmpeg 转 WAV 失败 (returncode={proc.returncode}): {stderr.decode(errors='replace')[:200]}")
            return False
        return True
    except FileNotFoundError:
        logger.warning("系统未安装 ffmpeg，跳过音频格式转换")
        return False
    except Exception as e:
        logger.warning(f"音频转 WAV 异常: {e}")
        return False


def _save_voice_sample(audio_bytes: bytes, filename: Optional[str], owner_id: int) -> tuple[str, str, str]:
    """保存音频样本到磁盘，返回 (raw_path, original_ext, suffix)"""
    original_ext = filename.split(".")[-1].lower() if filename else "wav"
    supported_formats = {"wav", "mp3", "ogg", "m4a", "aac", "pcm"}
    if original_ext not in supported_formats:
        original_ext = "wav"

    suffix = uuid.uuid4().hex[:10]
    raw_filename = f"clone_raw_u{owner_id}_{suffix}.{original_ext}"
    raw_path = os.path.join(VOICE_SAMPLE_DIR, raw_filename)
    with open(raw_path, "wb") as f:
        f.write(audio_bytes)
    logger.info(f"声音复刻音频已保存: {raw_path}")
    return raw_path, original_ext, suffix


async def _run_voice_clone_task(
    raw_path: str,
    original_ext: str,
    voice_text: Optional[str],
    owner_id: int,
    character_id: int,
    suffix: str,
    speaker_id_override: Optional[str] = None,
) -> None:
    """后台声音复刻任务：转换格式 → 调用 API → 更新角色 speaker_id"""
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        character = db.query(GameCharacter).filter(GameCharacter.id == character_id).first()
        if not character:
            logger.warning(f"[异步复刻] 角色 {character_id} 不存在，跳过")
            return

        from app.models.user import User
        owner = db.query(User).filter(User.id == owner_id).first()
        api_key = owner.api_key if owner else ""
        if not api_key:
            logger.warning(f"[异步复刻] 用户 {owner_id} 未设置 API Key，跳过")
            return

        wav_path = os.path.join(VOICE_SAMPLE_DIR, f"clone_wav_u{owner_id}_{suffix}.wav")
        converted = await _convert_to_wav(raw_path, wav_path)

        if converted:
            with open(wav_path, "rb") as f:
                audio_bytes = f.read()
            audio_format = "wav"
            logger.info(f"[异步复刻] 音频已转 WAV: {raw_path} -> {wav_path}")
        else:
            with open(raw_path, "rb") as f:
                audio_bytes = f.read()
            audio_format = original_ext
            logger.info(f"[异步复刻] 使用原始格式: {audio_format}")

        speaker_id = speaker_id_override or f"S_u{owner_id}_{suffix}"

        result = await tts_request_manager.voice_clone(
            speaker_id=speaker_id,
            audio_data=audio_bytes,
            api_key=api_key,
            audio_format=audio_format,
            language=0,
            text=voice_text,
            enable_audio_denoise=True,
        )
        returned_id = result.get("speaker_id", result.get("voice_type", speaker_id))

        character.speaker_id = returned_id
        character.voice_status = None
        db.commit()
        logger.info(f"[异步复刻] 成功: character_id={character_id}, speaker_id={returned_id}")

    except TTSAPIError as e:
        character.voice_status = "failed"
        db.commit()
        logger.error(f"[异步复刻] API 失败 character_id={character_id}: {e}")
    except Exception as e:
        try:
            character.voice_status = "failed"
            db.commit()
        except Exception:
            db.rollback()
        logger.error(f"[异步复刻] 异常 character_id={character_id}: {e}", exc_info=True)
    finally:
        db.close()


def _generate_uid(db: Session) -> str:
    """生成8位唯一UID"""
    while True:
        uid = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
        exists = db.query(GameCharacter).filter(GameCharacter.uid == uid).first()
        if not exists:
            return uid



async def _save_upload(file: UploadFile, prefix: str = "", remove_bg: bool = True) -> tuple[str, str]:
    raw = await file.read()
    if remove_bg:
        try:
            raw = await remove_bg_async(raw)
        except Exception as e:
            logger.warning(f"背景移除服务不可用({prefix})，使用原图: {e}", exc_info=True)
    img = Image.open(io.BytesIO(raw))
    output_image = img.convert("RGBA")

    output_image = output_image.convert("RGBA")
    filename = f"{prefix}{uuid.uuid4().hex[:12]}.png"
    filepath = os.path.join(UPLOAD_DIR, filename)
    output_image.save(filepath, format="PNG", optimize=True)
    logger.info(f"[_save_upload] 完成 {prefix} -> {filepath}")
    return f"/uploads/characters/{filename}", os.path.abspath(filepath)


def _parse_remove_bg_list(raw: Optional[str], count: int) -> List[bool]:
    if not raw:
        return [True] * count
    parts = [p.strip().lower() for p in raw.split(",")]
    result: List[bool] = []
    for i in range(count):
        if i < len(parts):
            result.append(parts[i] in ("true", "1", "yes"))
        else:
            result.append(True)
    return result


def _get_fs_path(url: str) -> str:
    return os.path.abspath(os.path.join(UPLOAD_DIR, os.path.basename(url)))


def _build_character_response(c: GameCharacter) -> CharacterResponse:
    return CharacterResponse(
        id=c.id,
        uid=c.uid,
        owner_id=c.owner_id,
        name=c.name,
        portrait_url=c.portrait_url,
        prompt=c.prompt,
        description=c.description,
        expressions=c.expressions or [],
        expression_descriptions=c.expression_descriptions or [],
        cg_images=c.cg_images or [],
        speaker_id=c.speaker_id,
        voice_status=c.voice_status,
        voice_sample_url=c.voice_sample_url,
        is_public=c.is_public,
        is_default=c.is_default,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


@router.post("", response_model=CharacterResponse)
async def create_character(
    name: str = Form(...),
    prompt: str = Form(...),
    description: Optional[str] = Form(None),
    is_public: bool = Form(False),
    speaker_id: Optional[str] = Form(None),
    portrait: UploadFile = File(...),
    expressions: Optional[List[UploadFile]] = File(None),
    cg_images: Optional[List[UploadFile]] = File(None),
    remove_bg_portrait: str = Form("true"),
    remove_bg_expressions: Optional[str] = Form(None),
    expression_descriptions: Optional[str] = Form(None),
    auto_analyze: str = Form("false"),
    voice_audio: Optional[UploadFile] = File(None, description="声音复刻音频样本（14-30秒，可选）"),
    voice_text: Optional[str] = Form(None, description="音频对应的说话文本（可选，配合voice_audio使用）"),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    portrait_url, _ = await _save_upload(portrait, "portrait_", remove_bg=remove_bg_portrait.lower() in ("true", "1", "yes"))

    expression_urls: List[str] = []
    expression_paths: List[str] = []
    if expressions:
        expr_remove_bg = _parse_remove_bg_list(remove_bg_expressions, len(expressions[:3]))
        for i, f in enumerate(expressions[:3]):
            url, fs_path = await _save_upload(f, f"expr_{i}_", remove_bg=expr_remove_bg[i])
            expression_urls.append(url)
            expression_paths.append(fs_path)

    cg_urls: List[str] = []
    if cg_images:
        for i, f in enumerate(cg_images[:3]):
            url, fs_path = await _save_upload(f, f"cg_{i}_", remove_bg=False)
            cg_urls.append(url)

    should_auto = auto_analyze.lower() in ("true", "1", "yes")
    expression_descriptions_list: List[str] = []
    if should_auto and expression_paths:
        expression_descriptions_list = await expression_service.analyze_expressions(expression_paths)
    elif expression_descriptions:
        try:
            expression_descriptions_list = json.loads(expression_descriptions)
        except (json.JSONDecodeError, TypeError):
            expression_descriptions_list = []
    if not expression_descriptions_list and expression_paths:
        expression_descriptions_list = await expression_service.analyze_expressions(expression_paths)

    resolved_speaker_id = speaker_id
    voice_sample_path = None
    if voice_audio and voice_audio.filename:
        audio_bytes = await voice_audio.read()
        if audio_bytes:
            original_ext = voice_audio.filename.split(".")[-1].lower() if voice_audio.filename else "wav"
            supported_formats = {"wav", "mp3", "ogg", "m4a", "aac", "pcm"}
            if original_ext not in supported_formats:
                original_ext = "wav"
            suffix = uuid.uuid4().hex[:10]
            sample_filename = f"voice_sample_u{current_user.user_id}_{suffix}.{original_ext}"
            sample_path = os.path.join(VOICE_SAMPLE_DIR, sample_filename)
            with open(sample_path, "wb") as f:
                f.write(audio_bytes)
            voice_sample_path = f"/uploads/tts/voice_samples/{sample_filename}"

    character = GameCharacter(
        uid=_generate_uid(db),
        owner_id=current_user.user_id,
        name=name,
        portrait_url=portrait_url,
        prompt=prompt,
        description=description,
        speaker_id=resolved_speaker_id,
        voice_sample_url=voice_sample_path,
        expressions=expression_urls or None,
        expression_descriptions=expression_descriptions_list or None,
        cg_images=cg_urls or None,
        is_public=is_public,
    )
    db.add(character)
    db.commit()
    db.refresh(character)

    return _build_character_response(character)


@router.get("", response_model=CharacterListResponse)
async def list_characters(
    tab: str = "my",
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    user_id = current_user.user_id
    if tab == "my":
        q = db.query(GameCharacter).filter(
            GameCharacter.owner_id == user_id,
            GameCharacter.is_default == False,
        )
    elif tab == "default":
        q = db.query(GameCharacter).filter(GameCharacter.is_default == True)
    elif tab == "borrowed":
        borrows = db.query(CharacterBorrow).filter(
            CharacterBorrow.user_id == user_id,
        ).all()
        borrow_map = {b.character_id: b for b in borrows}
        ids = [b.character_id for b in borrows]
        q = db.query(GameCharacter).filter(GameCharacter.id.in_(ids))
    elif tab == "public":
        q = db.query(GameCharacter).filter(
            GameCharacter.is_public == True,
            GameCharacter.owner_id != user_id,
            GameCharacter.is_default == False,
        )
    else:
        q = db.query(GameCharacter).filter(GameCharacter.owner_id == user_id)
    characters = q.order_by(GameCharacter.created_at.desc()).all()
    items = []
    for c in characters:
        resp = _build_character_response(c)
        if c.owner_id != user_id:
            if tab == "borrowed" and c.id in borrow_map:
                resp.speaker_id = borrow_map[c.id].speaker_id
            else:
                resp.speaker_id = None
        items.append(resp)
    return CharacterListResponse(characters=items)


@router.get("/{character_id}", response_model=CharacterResponse)
async def get_character(
    character_id: int,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    c = db.query(GameCharacter).filter(GameCharacter.id == character_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="角色不存在")
    if not c.is_public and not c.is_default and c.owner_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="无权访问该角色")
    resp = _build_character_response(c)
    if c.owner_id != current_user.user_id:
        borrow = db.query(CharacterBorrow).filter(
            CharacterBorrow.character_id == character_id,
            CharacterBorrow.user_id == current_user.user_id,
        ).first()
        resp.speaker_id = borrow.speaker_id if borrow else None
    return resp


@router.put("/{character_id}", response_model=CharacterResponse)
async def update_character(
    character_id: int,
    name: Optional[str] = Form(None),
    prompt: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    is_public: Optional[bool] = Form(None),
    speaker_id: Optional[str] = Form(None),
    portrait: Optional[UploadFile] = File(None),
    expressions: Optional[List[UploadFile]] = File(None),
    cg_images: Optional[List[UploadFile]] = File(None),
    remove_bg_portrait: str = Form("true"),
    remove_bg_expressions: Optional[str] = Form(None),
    expression_descriptions: Optional[str] = Form(None),
    auto_analyze: str = Form("false"),
    voice_audio: Optional[UploadFile] = File(None, description="声音复刻音频样本（14-30秒，可选）"),
    voice_text: Optional[str] = Form(None, description="音频对应的说话文本（可选，配合voice_audio使用）"),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    c = db.query(GameCharacter).filter(GameCharacter.id == character_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="角色不存在")
    if c.owner_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="只能编辑自己的角色")
    if c.is_default:
        raise HTTPException(status_code=403, detail="默认角色不可编辑")

    if name is not None:
        c.name = name
    if prompt is not None:
        c.prompt = prompt
    if description is not None:
        c.description = description
    if is_public is not None:
        c.is_public = is_public
    if speaker_id is not None:
        c.speaker_id = speaker_id
        c.voice_status = None
    if portrait is not None:
        c.portrait_url, _ = await _save_upload(portrait, "portrait_", remove_bg=remove_bg_portrait.lower() in ("true", "1", "yes"))
    if expressions is not None:
        expr_urls: List[str] = []
        expr_paths: List[str] = []
        expr_remove_bg = _parse_remove_bg_list(remove_bg_expressions, len(expressions[:3]))
        for i, f in enumerate(expressions[:3]):
            url, fs_path = await _save_upload(f, f"expr_{i}_", remove_bg=expr_remove_bg[i])
            expr_urls.append(url)
            expr_paths.append(fs_path)
        c.expressions = expr_urls or None
        should_auto = auto_analyze.lower() in ("true", "1", "yes")
        if should_auto and expr_paths:
            c.expression_descriptions = await expression_service.analyze_expressions(expr_paths)
        elif expression_descriptions:
            try:
                descs = json.loads(expression_descriptions)
            except (json.JSONDecodeError, TypeError):
                descs = []
            if descs:
                c.expression_descriptions = descs
        if not expression_descriptions and expr_paths and not should_auto:
            c.expression_descriptions = await expression_service.analyze_expressions(expr_paths)
    if expression_descriptions is not None and expressions is None:
        try:
            descs = json.loads(expression_descriptions)
        except (json.JSONDecodeError, TypeError):
            descs = []
        if descs:
            c.expression_descriptions = descs
    if cg_images is not None:
        cg_urls = []
        for i, f in enumerate(cg_images[:3]):
            url, _ = await _save_upload(f, f"cg_{i}_", remove_bg=False)
            cg_urls.append(url)
        c.cg_images = cg_urls or None

    voice_sample_path = None
    if voice_audio and voice_audio.filename:
        audio_bytes = await voice_audio.read()
        if audio_bytes:
            original_ext = voice_audio.filename.split(".")[-1].lower() if voice_audio.filename else "wav"
            supported_formats = {"wav", "mp3", "ogg", "m4a", "aac", "pcm"}
            if original_ext not in supported_formats:
                original_ext = "wav"
            suffix = uuid.uuid4().hex[:10]
            sample_filename = f"voice_sample_u{current_user.user_id}_{suffix}.{original_ext}"
            sample_path = os.path.join(VOICE_SAMPLE_DIR, sample_filename)
            with open(sample_path, "wb") as f:
                f.write(audio_bytes)
            voice_sample_path = f"/uploads/tts/voice_samples/{sample_filename}"
            c.voice_sample_url = voice_sample_path

    logger.info(f"[update] 准备 commit")
    db.commit()
    db.refresh(c)

    return _build_character_response(c)


@router.get("/{character_id}/voice-sample")
async def download_voice_sample(
    character_id: int,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    """下载角色的音色克隆音频样本"""
    c = db.query(GameCharacter).filter(GameCharacter.id == character_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="角色不存在")
    if not c.voice_sample_url:
        raise HTTPException(status_code=404, detail="该角色没有提供语音样本")

    sample_path = os.path.abspath(os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        c.voice_sample_url.lstrip("/"),
    ))
    if not os.path.exists(sample_path):
        raise HTTPException(status_code=404, detail="语音样本文件不存在")

    filename = os.path.basename(sample_path)
    return FileResponse(sample_path, media_type="audio/octet-stream", filename=filename)


@router.patch("/{character_id}/speaker-id", response_model=CharacterResponse)
async def update_character_speaker_id(
    character_id: int,
    body: UpdateSpeakerIdRequest,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    """更新角色或借阅记录的 speaker_id"""
    c = db.query(GameCharacter).filter(GameCharacter.id == character_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="角色不存在")

    if c.owner_id == current_user.user_id:
        c.speaker_id = body.speaker_id
    else:
        borrow = db.query(CharacterBorrow).filter(
            CharacterBorrow.character_id == character_id,
            CharacterBorrow.user_id == current_user.user_id,
        ).first()
        if not borrow:
            raise HTTPException(status_code=403, detail="未借阅该角色")
        borrow.speaker_id = body.speaker_id

    db.commit()
    db.refresh(c)
    resp = _build_character_response(c)
    if c.owner_id != current_user.user_id:
        borrow = db.query(CharacterBorrow).filter(
            CharacterBorrow.character_id == character_id,
            CharacterBorrow.user_id == current_user.user_id,
        ).first()
        resp.speaker_id = borrow.speaker_id if borrow else c.speaker_id
    return resp


@router.post("/{character_id}/remove-borrow")
async def remove_borrow(
    character_id: int,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    """移除借阅记录"""
    borrow = db.query(CharacterBorrow).filter(
        CharacterBorrow.character_id == character_id,
        CharacterBorrow.user_id == current_user.user_id,
    ).first()
    if not borrow:
        raise HTTPException(status_code=404, detail="未借阅该角色")
    db.delete(borrow)
    db.commit()
    return {"code": 200, "message": "已移除借阅"}


@router.delete("/{character_id}")
async def delete_character(
    character_id: int,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    c = db.query(GameCharacter).filter(GameCharacter.id == character_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="角色不存在")
    if c.owner_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="只能删除自己的角色")
    if c.is_default:
        raise HTTPException(status_code=403, detail="默认角色不可删除")

    # 删除关联的图片文件
    img_urls = []
    if c.portrait_url:
        img_urls.append(c.portrait_url)
    if c.expressions:
        img_urls.extend(c.expressions)
    if c.cg_images:
        img_urls.extend(c.cg_images)
    deleted_count = 0
    for url in img_urls:
        if url:
            fp = _get_fs_path(url)
            if os.path.isfile(fp):
                try:
                    os.remove(fp)
                    deleted_count += 1
                except Exception as e:
                    logger.warning(f"删除角色图片失败: {fp}, {e}")
    if deleted_count:
        logger.info(f"已删除角色 {character_id} 的 {deleted_count} 个图片文件")

    # 删除音色克隆的语音样本文件
    if c.voice_sample_url:
        sample_path = os.path.abspath(os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            c.voice_sample_url.lstrip("/"),
        ))
        if os.path.isfile(sample_path):
            try:
                os.remove(sample_path)
                logger.info(f"已删除角色 {character_id} 的语音样本: {sample_path}")
            except Exception as e:
                logger.warning(f"删除语音样本失败: {sample_path}, {e}")

    db.query(CharacterBorrow).filter(CharacterBorrow.character_id == character_id).delete()
    db.delete(c)
    db.commit()
    return {"code": 200, "message": "删除成功"}


@router.post("/{character_id}/borrow", response_model=CharacterResponse)
async def borrow_character(
    character_id: int,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    original = db.query(GameCharacter).filter(GameCharacter.id == character_id).first()
    if not original:
        raise HTTPException(status_code=404, detail="角色不存在")
    if not original.is_public and not original.is_default:
        raise HTTPException(status_code=403, detail="该角色不可借阅")

    existing = db.query(CharacterBorrow).filter(
        CharacterBorrow.character_id == character_id,
        CharacterBorrow.user_id == current_user.user_id,
    ).first()
    if existing:
        resp = _build_character_response(original)
        if original.owner_id != current_user.user_id:
            resp.speaker_id = existing.speaker_id
        return resp

    borrow = CharacterBorrow(
        character_id=character_id,
        user_id=current_user.user_id,
    )
    db.add(borrow)
    db.commit()
    logger.info(f"用户 {current_user.user_id} 借阅了角色 {character_id}")
    await game_ws_manager.broadcast(current_user.user_id, {
        "type": "character_update", "action": "borrowed",
    })
    resp = _build_character_response(original)
    if original.owner_id != current_user.user_id:
        resp.speaker_id = None
    return resp


@router.post("/borrow-by-uid", response_model=CharacterResponse)
async def borrow_character_by_uid(
    body: BorrowByUidRequest,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    original = db.query(GameCharacter).filter(GameCharacter.uid == body.uid).first()
    if not original:
        raise HTTPException(status_code=404, detail="角色不存在，请检查UID是否正确")

    existing = db.query(CharacterBorrow).filter(
        CharacterBorrow.character_id == original.id,
        CharacterBorrow.user_id == current_user.user_id,
    ).first()
    if existing:
        resp = _build_character_response(original)
        if original.owner_id != current_user.user_id:
            resp.speaker_id = existing.speaker_id
        return resp

    borrow = CharacterBorrow(
        character_id=original.id,
        user_id=current_user.user_id,
    )
    db.add(borrow)
    db.commit()
    logger.info(f"用户 {current_user.user_id} 通过UID借阅了角色 {original.uid}")
    await game_ws_manager.broadcast(current_user.user_id, {
        "type": "character_update", "action": "borrowed",
    })
    resp = _build_character_response(original)
    if original.owner_id != current_user.user_id:
        resp.speaker_id = None
    return resp


@router.get("/search/by-uid", response_model=CharacterResponse)
async def search_character_by_uid(
    uid: str = Query(..., description="角色UID"),
    db: Session = Depends(get_db),
):
    c = db.query(GameCharacter).filter(GameCharacter.uid == uid).first()
    if not c:
        raise HTTPException(status_code=404, detail="角色不存在")
    if not c.is_public and not c.is_default:
        raise HTTPException(status_code=404, detail="该角色不公开，无法通过UID搜索")
    resp = _build_character_response(c)
    resp.speaker_id = None
    return resp


class AiDesignPromptRequest(BaseModel):
    reference_name: str


async def _generate_ai_design_prompt(name: str) -> dict:
    """根据参考角色名，通过 AI 搜索并生成人设提示词（供 admin 和 用户端共用）"""
    from app.services.ai_request_manager import ai_request_manager
    from app.services.web_search_request_manager import WebSearchRequestManager

    PROMPT_SPEC = """请根据收集到的角色信息，生成一份完整的角色人设提示词。要求：
1. 角色基本信息：名称、来源作品、身份
2. 外貌特征：发型、服饰、标志性物品等
3. 性格特点：核心性格特质，详细描述
4. 说话风格：语气、常用口头禅、语速、语调特点
5. 行为习惯：标志性动作、小动作、待人接物方式
6. 背景故事：简要经历，动机，目标
7. 知识范围：擅长领域、知识储备特点

要求语言生动具体，用中文描述，字数 300-800 字。"""

    PROMPT_SYSTEM = """你是一个专业的视觉小说角色设计助手。你的任务是：
1. 使用 web_search 工具搜索参考角色的详细信息
2. 综合分析搜索结果，提取关键角色特征
3. 按照规范生成完整的角色人设提示词
4. 支持多轮迭代搜索，确保信息全面准确

注意：只输出最终的人设提示词，不要输出其他内容。"""

    search_manager = await WebSearchRequestManager.get_instance()
    if not search_manager:
        raise HTTPException(status_code=503, detail="搜索服务未就绪")

    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="请输入参考角色名")

    all_search_results = []
    search_queries = [
        f"{name} 角色介绍 人物设定",
        f"{name} 性格特点 说话风格",
        f"{name} 外貌描述 经典台词",
    ]

    for query in search_queries:
        try:
            result = await search_manager.search(query=query, count=5, summary=True)
            if result:
                pages = result.get("webPages", {}).get("value", []) if "webPages" in result else result.get("results", [])
                for page in pages[:5]:
                    snippet = page.get("summary") or page.get("snippet", "")
                    if snippet:
                        all_search_results.append(f"[来源:{page.get('name','')}]({page.get('url','')}): {snippet[:500]}")
                await asyncio.sleep(0.3)
        except Exception as e:
            logger.warning(f"搜索「{query}」失败: {e}")

    if not all_search_results:
        raise HTTPException(status_code=404, detail=f"未找到「{name}」的相关信息")

    search_context = "\n\n".join(all_search_results[:15])

    messages = [
        {"role": "system", "content": PROMPT_SYSTEM},
        {"role": "user", "content": f"参考角色名：{name}\n\n搜索到的信息：\n{search_context}\n\n{PROMPT_SPEC}"},
    ]

    try:
        # 优先使用用户自填 Key，否则使用系统公共 Key（管理后台场景）
        from app.core.user_context import current_deepseek_key
        from app.core.config import settings, get_deepseek_api_keys
        user_key = current_deepseek_key.get()
        if user_key:
            prompt_text = await ai_request_manager.make_request(
                request_id=f"ai_design_{uuid.uuid4().hex[:8]}",
                messages=messages,
                model="deepseek-v4-flash",
                temperature=0.5,
            )
        else:
            # 管理后台：使用系统公共 Key
            system_keys = get_deepseek_api_keys()
            if not system_keys:
                raise HTTPException(status_code=500, detail="系统未配置 DeepSeek API Key")
            import httpx
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    f"{settings.DEEPSEEK_BASE_URL}/chat/completions",
                    headers={"Authorization": f"Bearer {system_keys[0]}", "Content-Type": "application/json"},
                    json={"model": "deepseek-v4-flash", "messages": messages, "temperature": 0.5},
                )
                resp.raise_for_status()
                prompt_text = resp.json()["choices"][0]["message"]["content"]
        prompt_text = prompt_text.strip().strip("```").strip()
        if prompt_text.startswith("```"):
            prompt_text = prompt_text[3:].strip()
        if prompt_text.endswith("```"):
            prompt_text = prompt_text[:-3].strip()
        if prompt_text.startswith(("markdown", "text", "plaintext")):
            prompt_text = prompt_text.split("\n", 1)[-1].strip() if "\n" in prompt_text else ""

        return {"prompt": prompt_text}
    except Exception as e:
        logger.error(f"AI 生成提示词失败: {e}")
        raise HTTPException(status_code=500, detail=f"AI 生成失败: {str(e)}")


@router.post("/ai-design-prompt")
async def ai_design_character_prompt(
    body: AiDesignPromptRequest,
    current_user: TokenData = Depends(get_current_user_dep),
):
    """根据参考角色名，通过 AI 搜索并生成人设提示词（用户端，需登录）"""
    return await _generate_ai_design_prompt(body.reference_name)
