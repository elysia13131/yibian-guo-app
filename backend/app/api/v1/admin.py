import logging, os, json, uuid, asyncio
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from sqlalchemy.orm import Session
from PIL import Image
import io
from app.db.session import get_db
from app.models.character import GameCharacter
from app.services.remove_bg_client import remove_bg_async
from app.services.expression_service import expression_service

logger = logging.getLogger(__name__)

router = APIRouter()

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
BGM_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(_THIS_DIR))), 'static', 'bgm')
os.makedirs(BGM_DIR, exist_ok=True)

UPLOAD_DIR = os.getenv("CHARACTER_UPLOAD_DIR", "/uploads/characters")
os.makedirs(UPLOAD_DIR, exist_ok=True)


async def _save_upload(file: UploadFile, prefix: str = "", remove_bg: bool = True) -> tuple[str, str]:
    raw = await file.read()
    if remove_bg:
        try:
            raw = await remove_bg_async(raw)
        except Exception as e:
            logger.warning(f"背景移除服务不可用({prefix})，使用原图: {e}")
    img = Image.open(io.BytesIO(raw))
    output_image = img.convert("RGBA")
    filename = f"{prefix}{uuid.uuid4().hex[:12]}.png"
    filepath = os.path.join(UPLOAD_DIR, filename)
    output_image.save(filepath, format="PNG", optimize=True)
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

# Also add endpoint to serve BGM files for preview
@router.get("/admin/api/bgm/{filename}")
async def get_bgm_file(filename: str):
    filepath = os.path.join(BGM_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件不存在")
    media_type = "audio/wav" if filename.endswith('.wav') else "audio/mpeg" if filename.endswith('.mp3') else "audio/flac" if filename.endswith('.flac') else "audio/ogg"
    return FileResponse(filepath, media_type=media_type)

BGM_NAMES = {
    "bamboo_forest": "宁静竹林",
    "moon_lake": "月夜湖畔",
    "garden_morning": "晨光花园",
    "starry_walk": "星空漫步",
    "bookish": "书卷气息",
}


def _generate_uid() -> str:
    return uuid.uuid4().hex[:12]


@router.get("/admin", response_class=HTMLResponse)
async def admin_page():
    with open(os.path.join(os.path.dirname(__file__), 'admin.html'), 'r', encoding='utf-8') as f:
        return f.read()


@router.get("/admin/api/bgm")
async def list_bgm():
    files = []
    for fname in sorted(os.listdir(BGM_DIR)):
        if fname.endswith('.wav') or fname.endswith('.mp3') or fname.endswith('.ogg') or fname.endswith('.flac'):
            name = os.path.splitext(fname)[0]
            path = os.path.join(BGM_DIR, fname)
            files.append({
                "filename": fname,
                "name": BGM_NAMES.get(name, name),
                "size": round(os.path.getsize(path) / 1024 / 1024, 2),
            })
    return {"data": files}


@router.post("/admin/api/bgm/upload")
async def upload_bgm(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ('.wav', '.mp3', '.ogg', '.flac'):
        raise HTTPException(status_code=400, detail="仅支持 WAV/MP3/OGG/FLAC 格式")
    content = await file.read()
    filepath = os.path.join(BGM_DIR, file.filename)
    with open(filepath, 'wb') as f:
        f.write(content)
    logger.info(f"BGM 上传成功: {file.filename} ({len(content)}B)")
    return {"success": True, "filename": file.filename}


@router.delete("/admin/api/bgm/{filename}")
async def delete_bgm(filename: str):
    filepath = os.path.join(BGM_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件不存在")
    if filename not in [f for f in os.listdir(BGM_DIR) if f.endswith(('.wav','.mp3','.ogg','.flac'))]:
        raise HTTPException(status_code=400, detail="无效的文件名")
    os.remove(filepath)
    logger.info(f"BGM 删除成功: {filename}")
    return {"success": True}


@router.get("/admin/api/default-characters")
async def list_default_characters(db: Session = Depends(get_db)):
    chars = db.query(GameCharacter).filter(GameCharacter.is_default == True).order_by(GameCharacter.created_at.desc()).all()
    return {"data": [{
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "prompt": c.prompt,
        "portrait_url": c.portrait_url,
        "expressions": c.expressions or [],
        "expression_descriptions": c.expression_descriptions or [],
        "cg_images": c.cg_images or [],
        "created_at": c.created_at.isoformat() if c.created_at else "",
    } for c in chars]}


@router.post("/admin/api/default-characters")
async def create_default_character(
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
    db: Session = Depends(get_db),
):
    if not name.strip():
        raise HTTPException(status_code=400, detail="角色名称不能为空")
    if not prompt.strip():
        raise HTTPException(status_code=400, detail="角色提示词不能为空")

    portrait_url, _ = await _save_upload(
        portrait, "portrait_",
        remove_bg=remove_bg_portrait.lower() in ("true", "1", "yes")
    )

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

    char = GameCharacter(
        uid=uuid.uuid4().hex[:12],
        owner_id=1,
        name=name.strip(),
        prompt=prompt.strip(),
        description=description.strip() if description else None,
        portrait_url=portrait_url,
        expressions=expression_urls or None,
        expression_descriptions=expression_descriptions_list or None,
        cg_images=cg_urls or None,
        speaker_id=speaker_id or None,
        is_public=is_public,
        is_default=True,
        created_at=datetime.now(),
        updated_at=datetime.now(),
    )
    db.add(char)
    db.commit()
    db.refresh(char)
    logger.info(f"默认角色创建成功: ID={char.id}, name={char.name}")
    return {"success": True, "id": char.id, "name": char.name}


@router.delete("/admin/api/default-characters/{character_id}")
async def delete_default_character(character_id: int, db: Session = Depends(get_db)):
    char = db.query(GameCharacter).filter(GameCharacter.id == character_id, GameCharacter.is_default == True).first()
    if not char:
        raise HTTPException(status_code=404, detail="默认角色不存在")

    # 删除关联的图片文件
    img_urls = []
    if char.portrait_url:
        img_urls.append(char.portrait_url)
    if char.expressions:
        img_urls.extend(char.expressions)
    if char.cg_images:
        img_urls.extend(char.cg_images)
    for url in img_urls:
        if url:
            fp = os.path.abspath(os.path.join(UPLOAD_DIR, os.path.basename(url)))
            if os.path.isfile(fp):
                try:
                    os.remove(fp)
                except Exception as e:
                    logger.warning(f"删除默认角色图片失败: {fp}, {e}")

    # 删除音色克隆的语音样本文件
    if char.voice_sample_url:
        sample_path = os.path.abspath(os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            char.voice_sample_url.lstrip("/"),
        ))
        if os.path.isfile(sample_path):
            try:
                os.remove(sample_path)
            except Exception as e:
                logger.warning(f"删除默认角色语音样本失败: {sample_path}, {e}")

    db.delete(char)
    db.commit()
    logger.info(f"默认角色删除成功: ID={character_id}")
    return {"success": True}


# ── AI 角色设计提示词（管理后台，无需认证）──

from pydantic import BaseModel as PydanticBaseModel


class AdminAiDesignPromptRequest(PydanticBaseModel):
    reference_name: str


@router.post("/admin/api/characters/ai-design-prompt")
async def admin_ai_design_prompt(body: AdminAiDesignPromptRequest):
    """管理后台用：根据参考角色名生成人设提示词"""
    from app.api.v1.character import _generate_ai_design_prompt
    return await _generate_ai_design_prompt(body.reference_name)
