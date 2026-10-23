import asyncio
import logging
import os
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import httpx
import json

logger = logging.getLogger(__name__)


class WebSearchAPIError(Exception):
    """博查搜索 API 错误"""
    pass


class WebSearchKeyInfo:
    """博查搜索 API Key 信息"""

    def __init__(self, key: str, max_qps: int = 5):
        self.key = key
        self.max_qps = max_qps
        self.request_times: List[datetime] = []
        self.is_valid = True
        self.consecutive_errors = 0
        self.lock = asyncio.Lock()

    def get_wait_time(self) -> float:
        now = datetime.now()
        one_second_ago = now - timedelta(seconds=1)
        self.request_times = [t for t in self.request_times if t > one_second_ago]
        if len(self.request_times) >= self.max_qps:
            oldest = min(self.request_times)
            return max(0, 1.1 - (now - oldest).total_seconds())
        return 0

    async def record_request(self):
        async with self.lock:
            self.request_times.append(datetime.now())

    def is_available(self) -> bool:
        return self.is_valid

    def record_success(self):
        self.consecutive_errors = 0

    def record_error(self):
        self.consecutive_errors += 1
        if self.consecutive_errors >= 5:
            self.is_valid = False


class WebSearchRequestManager:
    """
    博查网页搜索请求管理器
    - 管理多个 API Key（硬编码）
    - 控制请求速率
    - 轮询切换可用 Key
    """

    _instance = None
    _lock = asyncio.Lock()

    API_KEYS = [
        key.strip()
        for key in os.getenv("BOCHA_API_KEYS_STR", "").split(",")
        if key.strip()
    ]

    BASE_URL = "https://api.bochaai.com/v1/web-search"
    TIMEOUT = 15.0

    def __init__(self):
        self.keys: List[WebSearchKeyInfo] = [WebSearchKeyInfo(k) for k in self.API_KEYS]
        self._key_index = 0
        self._client: Optional[httpx.AsyncClient] = None

    @classmethod
    async def get_instance(cls):
        if cls._instance is None:
            async with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    async def startup(self):
        self._client = httpx.AsyncClient(
            timeout=self.TIMEOUT,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
        logger.info(f"✅ 博查网页搜索管理器启动完成，共 {len(self.keys)} 个 API Key")

    def _get_next_available_key(self) -> Optional[WebSearchKeyInfo]:
        for _ in range(len(self.keys)):
            key = self.keys[self._key_index]
            self._key_index = (self._key_index + 1) % len(self.keys)
            if key.is_available():
                return key
        return None

    async def search(
        self,
        query: str,
        freshness: str = "noLimit",
        summary: bool = True,
        count: int = 10,
    ) -> Dict[str, Any]:
        if not self._client:
            raise WebSearchAPIError("博查搜索管理器未初始化")

        key = self._get_next_available_key()
        if key is None:
            raise WebSearchAPIError("所有 API Key 均不可用")

        wait_time = key.get_wait_time()
        if wait_time > 0:
            await asyncio.sleep(wait_time)

        payload = {
            "query": query,
            "freshness": freshness,
            "summary": summary,
            "count": min(count, 50),
        }

        try:
            await key.record_request()
            resp = await self._client.post(
                self.BASE_URL,
                headers={
                    "Authorization": f"Bearer {key.key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )

            if resp.status_code == 200:
                raw = resp.json()
                key.record_success()
                # 博查 API 响应包装在 data 字段中，自动解包
                return raw.get("data", raw)
            elif resp.status_code == 429:
                key.record_error()
                logger.warning(f"博查搜索速率限制，将重试: {query[:30]}")
                await asyncio.sleep(2)
                return await self.search(query, freshness, summary, count)
            else:
                key.record_error()
                raise WebSearchAPIError(f"博查搜索返回异常: {resp.status_code} {resp.text[:200]}")

        except httpx.TimeoutException:
            key.record_error()
            raise WebSearchAPIError("博查搜索请求超时")
        except httpx.RequestError as e:
            key.record_error()
            raise WebSearchAPIError(f"博查搜索请求失败: {e}")

    async def search_with_fallback(
        self,
        query: str,
        freshness: str = "noLimit",
        summary: bool = True,
        count: int = 8,
    ) -> Optional[Dict[str, Any]]:
        try:
            return await self.search(query, freshness, summary, count)
        except WebSearchAPIError as e:
            logger.error(f"博查搜索全部失败: {e}")
            return None


web_search_manager: Optional[WebSearchRequestManager] = None


async def startup():
    global web_search_manager
    web_search_manager = await WebSearchRequestManager.get_instance()
    await web_search_manager.startup()
