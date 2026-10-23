import logging
import httpx
import os
import asyncio
from typing import Optional

logger = logging.getLogger(__name__)

_REMBG_BASE_URL = os.getenv("REMBG_SERVICE_URL", "http://127.0.0.1:8081")
_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    """获取共享的 httpx 客户端（单例，避免文件描述符泄漏）"""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0),
            limits=httpx.Limits(max_connections=5, max_keepalive_connections=2),
        )
    return _client


async def remove_bg_async(raw: bytes, timeout: float = 30.0) -> bytes:
    for attempt in range(2):
        try:
            client = _get_client()
            resp = await client.post(
                f"{_REMBG_BASE_URL}/remove-bg",
                files={"file": ("image.png", raw, "image/png")},
            )
            resp.raise_for_status()
            return resp.content
        except Exception as e:
            logger.warning(f"rembg 请求失败(尝试{attempt+1}/2): {e}")
            if attempt == 0:
                await asyncio.sleep(0.5)
                continue
    raise ConnectionError("rembg 服务不可用")


async def startup():
    try:
        client = _get_client()
        resp = await client.get(f"{_REMBG_BASE_URL}/health")
        if resp.status_code == 200:
            logger.info(f"✅ rembg 去背景服务已就绪 ({_REMBG_BASE_URL})")
            return
    except Exception:
        pass
    logger.warning(f"rembg 服务未就绪 ({_REMBG_BASE_URL})，保存角色时将自动重试")


def shutdown():
    pass
