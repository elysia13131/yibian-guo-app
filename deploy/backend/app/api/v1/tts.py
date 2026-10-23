import logging
import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.db.session import get_db
from app.api.v1.auth import get_current_user_dep
from app.schemas.user import TokenData
from app.models.character import GameCharacter
from app.services.tts_request_manager import TTSAPIError
from app.services.tts_service import tts_service

logger = logging.getLogger(__name__)

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(_THIS_DIR)))
TTS_UPLOAD_DIR = os.getenv("TTS_UPLOAD_DIR", "/uploads/tts")
os.makedirs(TTS_UPLOAD_DIR, exist_ok=True)

router = APIRouter(tags=["TTS"])


class SynthesizeRequest(BaseModel):
    text: str
    speaker_id: str
    character_id: Optional[int] = None
    encoding: str = "mp3"
    speed_ratio: float = 1.0


class VoiceCloneRequest(BaseModel):
    speaker_id: str
    language: int = 0
    text: Optional[str] = None
    enable_audio_denoise: Optional[bool] = None


class VoiceStatusRequest(BaseModel):
    speaker_id: str


@router.post("/tts/synthesize")
async def synthesize_speech(
    body: SynthesizeRequest,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    """
    语音合成：将文本合成为语音
    - 如果指定 character_id，使用该角色的 speaker_id（会覆盖 speaker_id 参数）
    - 默认角色使用系统预置音色 + 服务端 API Key
    - 其他角色使用用户自己的 API Key + 用户自己的 speaker_id
    - 返回音频文件（流式）
    """
    speaker_id = body.speaker_id
    use_server_key = False

    if body.character_id:
        character = db.query(GameCharacter).filter(
            GameCharacter.id == body.character_id
        ).first()
        if not character:
            raise HTTPException(status_code=404, detail="角色不存在")

        if character.is_default:
            if not character.speaker_id:
                raise HTTPException(status_code=400, detail="默认角色未配置系统音色ID")
            speaker_id = character.speaker_id
            use_server_key = True
        else:
            if character.speaker_id:
                speaker_id = character.speaker_id
            elif not speaker_id:
                raise HTTPException(status_code=400, detail="角色未设置 speaker_id，请先在个人设置中配置火山引擎音色ID")

    if not speaker_id:
        raise HTTPException(status_code=400, detail="请提供 speaker_id 或设置角色的 speaker_id")

    if use_server_key:
        server_key = os.environ.get("TTS_SERVER_API_KEY") or os.environ.get("ARK_API_KEY") or ""
        if not server_key:
            raise HTTPException(status_code=500, detail="服务端 TTS API Key 未配置，请联系管理员")
        api_key = server_key
    else:
        from app.models.user import User
        user = db.query(User).filter(User.id == current_user.user_id).first()
        api_key = user.tts_api_key if user else ""
        if not api_key:
            raise HTTPException(status_code=400, detail="请在个人设置中配置火山引擎 TTS API Key")

    try:
        audio_data = await tts_service.synthesize_text(
            text=body.text,
            speaker_id=speaker_id,
            encoding=body.encoding,
            speed_ratio=body.speed_ratio,
            user_api_key=api_key,
        )
    except TTSAPIError as e:
        raise HTTPException(status_code=502, detail=f"语音合成失败: {e}")

    temp_filename = f"tts_{uuid.uuid4().hex[:12]}.{body.encoding}"
    temp_path = os.path.join(TTS_UPLOAD_DIR, temp_filename)
    with open(temp_path, "wb") as f:
        f.write(audio_data)

    media_type = {
        "mp3": "audio/mpeg",
        "wav": "audio/wav",
        "pcm": "audio/pcm",
        "ogg_opus": "audio/ogg",
    }.get(body.encoding, "audio/mpeg")

    return FileResponse(temp_path, media_type=media_type, filename=temp_filename)


@router.post("/tts/voice-clone")
async def clone_voice(
    body: VoiceCloneRequest,
    file: UploadFile = File(..., description="用于复刻的音频样本文件"),
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    """音色复刻训练：上传音频样本训练新的音色"""
    from app.models.user import User
    user = db.query(User).filter(User.id == current_user.user_id).first()
    api_key = user.tts_api_key if user else ""
    if not api_key:
        raise HTTPException(status_code=400, detail="请先在个人设置中配置火山引擎 TTS API Key")

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="音频文件为空")

    audio_format = file.filename.split(".")[-1].lower() if file.filename else "wav"
    supported_formats = {"wav", "mp3", "ogg", "m4a", "aac", "pcm"}
    if audio_format not in supported_formats:
        audio_format = "wav"

    sample_dir = os.path.join(TTS_UPLOAD_DIR, "voice_samples")
    os.makedirs(sample_dir, exist_ok=True)
    sample_path = os.path.join(sample_dir, f"clone_{uuid.uuid4().hex[:12]}.{audio_format}")
    with open(sample_path, "wb") as f:
        f.write(audio_bytes)

    try:
        result = await tts_service.clone_voice(
            speaker_id=body.speaker_id,
            audio_file_path=sample_path,
            api_key=api_key,
            audio_format=audio_format,
            language=body.language,
            text=body.text,
            enable_audio_denoise=body.enable_audio_denoise,
        )
        return {"code": 200, "data": result}
    except TTSAPIError as e:
        raise HTTPException(status_code=502, detail=f"音色复刻失败: {e}")


@router.post("/tts/voice-status")
async def get_voice_status(
    body: VoiceStatusRequest,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    """查询音色训练状态"""
    from app.models.user import User
    user = db.query(User).filter(User.id == current_user.user_id).first()
    api_key = user.tts_api_key if user else ""
    if not api_key:
        raise HTTPException(status_code=400, detail="请先在个人设置中配置火山引擎 TTS API Key")

    try:
        result = await tts_service.get_voice_status(body.speaker_id, api_key)
        return {"code": 200, "data": result}
    except TTSAPIError as e:
        raise HTTPException(status_code=502, detail=f"查询失败: {e}")


@router.get("/tts/audio/{filename}")
async def get_tts_audio(filename: str):
    """获取缓存的 TTS 音频文件"""
    filepath = os.path.join(TTS_UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        filepath = os.path.join(TTS_UPLOAD_DIR, "cache", filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="音频文件不存在")

    ext = filename.split(".")[-1].lower()
    media_type = {
        "mp3": "audio/mpeg",
        "wav": "audio/wav",
        "pcm": "audio/pcm",
        "ogg": "audio/ogg",
    }.get(ext, "audio/mpeg")

    return FileResponse(filepath, media_type=media_type)
