import asyncio
import logging
import os
import uuid
import hashlib
from typing import Optional
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.models.character import GameCharacter
from app.services.tts_request_manager import tts_request_manager, TTSAPIError

logger = logging.getLogger(__name__)


TTS_AUDIO_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "uploads", "tts")
os.makedirs(TTS_AUDIO_DIR, exist_ok=True)

TTS_CACHE_DIR = os.path.join(TTS_AUDIO_DIR, "cache")
os.makedirs(TTS_CACHE_DIR, exist_ok=True)

TTS_UPLOAD_DIR = os.path.join(TTS_AUDIO_DIR, "voice_samples")
os.makedirs(TTS_UPLOAD_DIR, exist_ok=True)


def _cache_key(text: str, speaker_id: str, encoding: str = "mp3", speed_ratio: float = 1.0) -> str:
    """生成缓存 key"""
    raw = f"{speaker_id}:{text}:{encoding}:s{speed_ratio}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def _get_cache_path(cache_key: str, encoding: str = "mp3") -> str:
    """获取缓存文件路径"""
    return os.path.join(TTS_CACHE_DIR, f"{cache_key}.{encoding}")


class TTSService:

    async def synthesize_character_dialogue(
        self,
        text: str,
        character: GameCharacter,
        encoding: str = "mp3",
        speed_ratio: float = 1.0,
        user_api_key: Optional[str] = None,
    ) -> Optional[bytes]:
        """
        合成角色对话语音（v1 API，支持用户独立 API Key）
        """
        if not character.speaker_id:
            logger.warning(f"角色 {character.name} 未设置 speaker_id，跳过语音合成")
            return None

        cache_key = _cache_key(text, character.speaker_id, encoding, speed_ratio)
        cache_path = _get_cache_path(cache_key, encoding)

        if os.path.exists(cache_path):
            logger.info(f"TTS 缓存命中: {cache_key[:12]}...")
            with open(cache_path, "rb") as f:
                return f.read()

        try:
            audio_data = await tts_request_manager.synthesize_speech_v1(
                text=text,
                speaker_id=character.speaker_id,
                api_key=user_api_key or "",
                encoding=encoding,
                speed_ratio=speed_ratio,
            )

            with open(cache_path, "wb") as f:
                f.write(audio_data)

            logger.info(f"TTS 语音合成并缓存: {cache_key[:12]}...")
            return audio_data

        except TTSAPIError as e:
            logger.error(f"TTS 语音合成失败: {e}")
            return None

    async def synthesize_text(
        self,
        text: str,
        speaker_id: str,
        encoding: str = "mp3",
        speed_ratio: float = 1.0,
        user_api_key: Optional[str] = None,
    ) -> bytes:
        """
        通用语音合成（v1 API，支持用户独立 Key）
        """
        cache_key = _cache_key(text, speaker_id, encoding, speed_ratio)
        cache_path = _get_cache_path(cache_key, encoding)

        if os.path.exists(cache_path):
            logger.info(f"TTS 缓存命中: {cache_key[:12]}...")
            with open(cache_path, "rb") as f:
                return f.read()

        audio_data = await tts_request_manager.synthesize_speech_v1(
            text=text,
            speaker_id=speaker_id,
            api_key=user_api_key or "",
            encoding=encoding,
            speed_ratio=speed_ratio,
        )

        with open(cache_path, "wb") as f:
            f.write(audio_data)

        return audio_data

    async def clone_voice(
        self,
        speaker_id: str,
        audio_file_path: str,
        api_key: str,
        audio_format: str = "wav",
        language: int = 0,
        text: Optional[str] = None,
        enable_audio_denoise: Optional[bool] = None,
    ) -> dict:
        """
        音色复刻训练
        Args:
            speaker_id: 音色 ID
            audio_file_path: 音频文件路径
            api_key: 用户的火山引擎 API Key
            audio_format: 音频格式
            language: 语种
            text: 音频对应文本（可选）
            enable_audio_denoise: 是否降噪
        Returns:
            API 返回结果
        """
        with open(audio_file_path, "rb") as f:
            audio_data = f.read()

        result = await tts_request_manager.voice_clone(
            speaker_id=speaker_id,
            audio_data=audio_data,
            api_key=api_key,
            audio_format=audio_format,
            language=language,
            text=text,
            enable_audio_denoise=enable_audio_denoise,
        )
        return result

    async def get_voice_status(self, speaker_id: str, api_key: str) -> dict:
        """查询音色训练状态"""
        return await tts_request_manager.get_voice_status(speaker_id, api_key)


tts_service = TTSService()
