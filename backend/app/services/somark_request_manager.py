import asyncio
import logging
import json
import uuid
from typing import List, Optional, Dict, Any
import httpx
import os

from app.core.user_context import current_somark_key

logger = logging.getLogger(__name__)


class SoMarkAPIError(Exception):
    """SoMark API 错误"""
    pass


class SoMarkRequestManager:
    """
    统一的 SoMark 文档解析请求管理器
    - 管理用户 API Key
    - 支持请求取消
    速率控制交由 SoMark 官方管理
    """

    _instance = None
    _lock = asyncio.Lock()

    FEATURE_CONFIG = {
        "enable_text_cross_page": True,
        "enable_title_level_recognition": True,
        "enable_image_understanding": True,
    }

    BASE_URL = "https://somark.tech/api/v1/extract/acc_sync"

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
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self) -> httpx.AsyncClient:
        """获取共享的 httpx 客户端（单例，避免文件描述符泄漏）"""
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(600.0, connect=60.0),
                limits=httpx.Limits(max_connections=5, max_keepalive_connections=2),
            )
        return self._client

    async def acquire_key(self) -> str:
        """获取用户自填的 SoMark API Key"""
        user_key = current_somark_key.get()
        if not user_key:
            raise SoMarkAPIError("请在个人设置中配置你的 SoMark API Key")
        return user_key

    async def parse_document(
        self,
        file_path: str,
        output_formats: Optional[List[str]] = None,
        feature_config: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        使用 SoMark API 解析文档
        Args:
            file_path: 文档文件路径
            output_formats: 输出格式，默认 ["markdown", "json"]
            feature_config: 提取配置，默认启用文本跨页拼接和标题层级识别
            request_id: 请求 ID（可选）
        Returns:
            API 返回的 JSON 结果
        """
        if not request_id:
            request_id = str(uuid.uuid4())

        if output_formats is None:
            output_formats = ["json"]  # SoMark 不支持同时请求 json+markdown，只请求 json

        if feature_config is None:
            feature_config = dict(self.FEATURE_CONFIG)

        key = await self.acquire_key()

        task = asyncio.create_task(self._do_parse_document(
            key=key,
            file_path=file_path,
            output_formats=output_formats,
            feature_config=feature_config,
            request_id=request_id,
        ))
        self.active_requests[request_id] = task

        try:
            result = await task
            return result
        finally:
            self.active_requests.pop(request_id, None)

    async def _do_parse_document(
        self,
        key: str,
        file_path: str,
        output_formats: List[str],
        feature_config: Dict[str, Any],
        request_id: str = "",
    ) -> Dict[str, Any]:
        """执行实际的 SoMark API 请求"""
        if not os.path.exists(file_path):
            raise SoMarkAPIError(f"文件不存在: {file_path}")

        filename = os.path.basename(file_path)

        try:
            client = self._get_client()
            with open(file_path, "rb") as f:
                files = {
                    "file": (filename, f, "application/octet-stream"),
                }
                of_str = ",".join(output_formats) if isinstance(output_formats, list) else str(output_formats)
                data = {
                    "api_key": key,
                    "output_formats": of_str,
                    "feature_config": json.dumps(feature_config, ensure_ascii=False),
                }

                logger.info(f"SoMark 开始解析文档: {filename}, request_id={request_id}, output_formats={of_str}")
                response = await client.post(
                    self.BASE_URL,
                    data=data,
                    files=files,
                )
                response.raise_for_status()
                result = response.json()

                # Debug: log response structure
                result_keys = list(result.keys())
                logger.info(f"SoMark 响应结构: keys={result_keys}, code={result.get('code')}")

                biz_code = result.get("code")
                if biz_code not in (None, 0, 200):
                    error_msg = result.get("message", f"业务错误码 {biz_code}")
                    raise SoMarkAPIError(f"SoMark 业务错误: {error_msg}")

                logger.info(f"SoMark 解析完成: {filename}, request_id={request_id}")
                return result

        except httpx.HTTPStatusError as e:
            error_msg = f"SoMark HTTP {e.response.status_code}: {e}"
            if e.response.status_code in (401, 402):
                raise SoMarkAPIError("SoMark API Key 无效或余额不足，请检查个人设置中的 Key")
            try:
                detail = e.response.json()
                error_msg = f"SoMark API 错误: {detail}"
            except Exception:
                pass
            raise SoMarkAPIError(error_msg)

        except SoMarkAPIError:
            raise

        except Exception as e:
            raise SoMarkAPIError(f"SoMark 请求异常: {e}")

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

    def get_feature_config(self) -> Dict[str, Any]:
        """获取当前提取配置"""
        return dict(self.FEATURE_CONFIG)


somark_request_manager = SoMarkRequestManager()
