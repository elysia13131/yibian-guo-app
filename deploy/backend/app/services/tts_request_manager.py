import asyncio
import logging
import json
import uuid
import base64
from typing import List, Optional, Dict, Any
import httpx

logger = logging.getLogger(__name__)


class TTSAPIError(Exception):
    """TTS API 错误"""
    pass


class TTSRequestManager:
    """
    火山引擎 TTS 请求管理器
    使用用户提供的 API Key（不再内置硬编码 Key）
    """

    _instance = None
    _lock = asyncio.Lock()

    BASE_URL = "https://openspeech.bytedance.com/api/v3/tts"
    V1_BASE_URL = "https://openspeech.bytedance.com/api/v1/tts"

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self._initialized = True
        self.active_requests: Dict[str, asyncio.Task] = {}
        self.semaphore = asyncio.Semaphore(10)
        self._client: Optional[httpx.AsyncClient] = None

        logger.info("TTS 请求管理器已初始化（使用用户 API Key）")

    def _get_client(self) -> httpx.AsyncClient:
        """获取共享的 httpx 客户端（单例，避免文件描述符泄漏）"""
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(120.0, connect=30.0),
                limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
            )
        return self._client

    def _build_headers(self, key: str, resource_id: Optional[str] = None) -> Dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "X-Api-Key": key,
            "X-Api-Request-Id": str(uuid.uuid4()),
        }
        if resource_id:
            headers["X-Api-Resource-Id"] = resource_id
        return headers

    async def _make_request(
        self,
        endpoint: str,
        payload: Dict[str, Any],
        key: str,
        resource_id: Optional[str] = None,
        timeout: float = 60.0,
    ) -> Dict[str, Any]:
        """执行 TTS API 请求（JSON 响应）"""
        url = f"{self.BASE_URL}/{endpoint}"
        headers = self._build_headers(key, resource_id)

        try:
            client = self._get_client()
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            result = response.json()

            code = result.get("code")
            if code not in (None, 0, 200, 3000):
                error_msg = result.get("message", f"错误码 {code}")
                raise TTSAPIError(f"TTS API 错误: {error_msg}")

            return result

        except httpx.HTTPStatusError as e:
            error_msg = f"HTTP {e.response.status_code}"
            if e.response.status_code == 401:
                error_msg = f"TTS API Key 无效: {key[:12]}..."
            elif e.response.status_code == 429:
                error_msg = f"TTS 请求频率超限: {key[:12]}..."
                await asyncio.sleep(5)
            else:
                try:
                    detail = e.response.json()
                    error_msg = f"TTS API 错误: {detail}"
                except Exception:
                    error_msg = f"HTTP {e.response.status_code}: {e.response.text[:200]}"
            raise TTSAPIError(error_msg)

        except Exception as e:
            raise TTSAPIError(f"TTS 请求异常: {e}")

    async def voice_clone(
        self,
        speaker_id: str,
        audio_data: bytes,
        api_key: str,
        audio_format: str = "wav",
        language: int = 0,
        text: Optional[str] = None,
        enable_audio_denoise: Optional[bool] = None,
        request_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        音色复刻训练
        Args:
            speaker_id: 唯一音色代号（需从控制台获取）
            audio_data: 音频二进制数据
            api_key: 用户的火山引擎 API Key
            audio_format: 音频格式
            language: 语种 (0=中文)
            text: 音频对应文本（可选）
            enable_audio_denoise: 是否开启降噪
            request_id: 请求 ID（可选）
        Returns:
            API 返回的训练结果
        """
        if not api_key:
            raise TTSAPIError("TTS 复刻: 未提供 API Key")

        if not request_id:
            request_id = str(uuid.uuid4())

        async with self.semaphore:
            audio_b64 = base64.b64encode(audio_data).decode("utf-8")

            payload: Dict[str, Any] = {
                "speaker_id": speaker_id,
                "audio": {
                    "data": audio_b64,
                    "format": audio_format,
                },
                "language": language,
            }

            extra_params: Dict[str, Any] = {}
            if text:
                payload["text"] = text
            if enable_audio_denoise is not None:
                extra_params["enable_audio_denoise"] = enable_audio_denoise
            if extra_params:
                payload["extra_params"] = extra_params

            task = asyncio.create_task(
                self._make_request("voice_clone", payload, api_key, resource_id="seed-icl-2.0")
            )
            self.active_requests[request_id] = task

            try:
                result = await task
                logger.info(f"音色复刻训练完成: speaker_id={speaker_id}")
                return result
            finally:
                self.active_requests.pop(request_id, None)

    async def get_voice_status(
        self,
        speaker_id: str,
        api_key: str,
        request_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        查询音色训练状态
        Args:
            speaker_id: 唯一音色代号
            api_key: 用户的火山引擎 API Key
            request_id: 请求 ID（可选）
        Returns:
            音色训练状态信息
        """
        if not api_key:
            raise TTSAPIError("TTS 查询: 未提供 API Key")

        if not request_id:
            request_id = str(uuid.uuid4())

        async with self.semaphore:
            payload = {"speaker_id": speaker_id}

            task = asyncio.create_task(
                self._make_request("get_voice", payload, api_key, resource_id="seed-icl-2.0")
            )
            self.active_requests[request_id] = task

            try:
                result = await task
                logger.info(f"查询音色状态完成: speaker_id={speaker_id}, status={result.get('status')}")
                return result
            finally:
                self.active_requests.pop(request_id, None)

    async def synthesize_speech_v1(
        self,
        text: str,
        speaker_id: str,
        api_key: str,
        encoding: str = "mp3",
        speed_ratio: float = 1.0,
        request_id: Optional[str] = None,
    ) -> bytes:
        """
        语音合成（v1 API）
        Args:
            text: 合成文本
            speaker_id: 音色 ID
            api_key: 用户的火山引擎 API Key
            encoding: 音频编码
            speed_ratio: 语速
            request_id: 请求 ID（可选）
        Returns:
            音频二进制数据
        """
        if not api_key:
            raise TTSAPIError("TTS 合成: 未提供 API Key")

        if not request_id:
            request_id = str(uuid.uuid4())

        async with self.semaphore:
            payload = {
                "app": {"cluster": "volcano_icl"},
                "user": {"uid": request_id},
                "audio": {
                    "voice_type": speaker_id,
                    "encoding": encoding,
                    "speed_ratio": speed_ratio,
                },
                "request": {
                    "reqid": request_id,
                    "text": text,
                    "operation": "query",
                },
            }

            task = asyncio.create_task(
                self._do_synthesize_v1(api_key, payload, request_id)
            )
            self.active_requests[request_id] = task

            try:
                audio_data = await task
                logger.info(f"语音合成(v1)完成: text_len={len(text)}, speaker_id={speaker_id}")
                return audio_data
            finally:
                self.active_requests.pop(request_id, None)

    async def _do_synthesize_v1(
        self,
        api_key: str,
        payload: Dict[str, Any],
        request_id: str,
    ) -> bytes:
        """执行 v1 API 语音合成（返回 base64 编码音频）"""
        headers = {
            "Content-Type": "application/json",
            "X-Api-Key": api_key,
            "X-Api-Request-Id": request_id,
        }

        try:
            client = self._get_client()
            response = await client.post(self.V1_BASE_URL, headers=headers, json=payload)
            response.raise_for_status()

            result = response.json()
            code = result.get("code")
            message = result.get("message")
            data_b64 = result.get("data")

            if not data_b64:
                raise TTSAPIError(f"TTS(v1) 合成返回空音频: {message or 'no data'}")

            if code not in (None, 0, 200, 3000):
                raise TTSAPIError(f"TTS(v1) 合成失败: {message or f'错误码 {code}'}")

            audio_bytes = base64.b64decode(data_b64)

            if not audio_bytes or len(audio_bytes) < 50:
                raise TTSAPIError(f"TTS(v1) 合成返回空音频")

            logger.info(f"TTS(v1) 合成成功: {len(audio_bytes)} bytes")
            return audio_bytes

        except httpx.HTTPStatusError as e:
            error_msg = f"HTTP {e.response.status_code}"
            if e.response.status_code == 401:
                error_msg = f"TTS API Key 无效: {api_key[:12]}..."
            elif e.response.status_code == 429:
                error_msg = f"TTS 请求频率超限: {api_key[:12]}..."
                await asyncio.sleep(5)
            else:
                try:
                    detail = e.response.json()
                    error_msg = f"TTS API 错误: {detail}"
                except Exception:
                    error_msg = f"HTTP {e.response.status_code}: {e.response.text[:200]}"
            raise TTSAPIError(error_msg)

        except (json.JSONDecodeError, ValueError) as e:
            raise TTSAPIError(f"TTS(v1) 响应解析失败: {e}")

        except Exception as e:
            raise TTSAPIError(f"TTS(v1) 合成请求异常: {e}")

    def cancel_request(self, request_id: str) -> bool:
        """取消请求"""
        if request_id in self.active_requests:
            task = self.active_requests[request_id]
            task.cancel()
            del self.active_requests[request_id]
            return True
        return False

    def get_active_count(self) -> int:
        """获取活动请求数"""
        return len(self.active_requests)


tts_request_manager = TTSRequestManager()
