import asyncio
import logging
from typing import List, Optional, Dict, Any, Callable, AsyncGenerator
from collections import deque
import httpx
import json
from app.core.config import settings
from app.core.user_context import current_deepseek_key
import os

logger = logging.getLogger(__name__)


class APIKeyManager:
    """API Key 管理类"""

    def __init__(self, api_keys: List[str]):
        self.api_keys = api_keys
        self.current_index = 0
        self.key_status: Dict[str, bool] = {key: True for key in api_keys}
        self.key_usage: Dict[str, int] = {key: 0 for key in api_keys}

    def get_next_key(self) -> Optional[str]:
        """获取下一个可用的 API Key"""
        if not self.api_keys:
            return None

        start_index = self.current_index
        while True:
            key = self.api_keys[self.current_index]
            if self.key_status.get(key, True):
                self.current_index = (self.current_index + 1) % len(self.api_keys)
                self.key_usage[key] += 1
                return key

            self.current_index = (self.current_index + 1) % len(self.api_keys)
            if self.current_index == start_index:
                return None

    def mark_key_busy(self, key: str):
        """标记 API Key 为忙"""
        self.key_status[key] = False

    def mark_key_available(self, key: str):
        """标记 API Key 为可用"""
        self.key_status[key] = True

    def mark_key_invalid(self, key: str):
        """标记 API Key 为无效"""
        if key in self.key_status:
            del self.key_status[key]
        if key in self.api_keys:
            self.api_keys.remove(key)
            if self.current_index >= len(self.api_keys) and self.api_keys:
                self.current_index = 0


class TaskQueue:
    """任务队列"""

    def __init__(self, max_concurrent: int = 5):
        self.queue = deque()
        self.running = 0
        self.max_concurrent = max_concurrent
        self.lock = asyncio.Lock()

    async def enqueue(self, task: Callable, *args, **kwargs):
        """入队任务"""
        future = asyncio.Future()
        self.queue.append((task, args, kwargs, future))
        await self._process_queue()
        return await future

    async def _process_queue(self):
        """处理队列"""
        async with self.lock:
            while self.queue and self.running < self.max_concurrent:
                task, args, kwargs, future = self.queue.popleft()
                self.running += 1
                asyncio.create_task(self._execute_task(task, args, kwargs, future))

    async def _execute_task(self, task: Callable, args: tuple, kwargs: dict, future: asyncio.Future):
        """执行任务"""
        try:
            result = await task(*args, **kwargs)
            future.set_result(result)
        except Exception as e:
            future.set_exception(e)
        finally:
            self.running -= 1
            await self._process_queue()


class DeepSeekAPIError(Exception):
    """DeepSeek API 错误"""
    pass


class AIService:
    """AI 服务类 - 直接使用 DeepSeek API"""

    def __init__(self):
        api_keys_str = os.getenv("DEEPSEEK_API_KEYS_STR", "")
        api_keys = [
            key.strip() for key in api_keys_str.split(",")
            if key.strip()
        ]
        self.api_key_manager = APIKeyManager(api_keys)
        self.task_queue = TaskQueue(max_concurrent=max(len(api_keys), 1))
        self.base_url = settings.DEEPSEEK_BASE_URL
        self.timeout = httpx.Timeout(60.0, connect=30.0)
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self) -> httpx.AsyncClient:
        """获取共享的 httpx 客户端（单例，避免文件描述符泄漏）"""
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=self.timeout,
                limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
            )
        return self._client

    async def _make_request(
        self,
        api_key: str,
        model: str,
        messages: List[Dict[str, str]],
        **kwargs
    ) -> str:
        """发送请求到 DeepSeek API"""
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        data = {
            "model": model,
            "messages": messages,
            **kwargs
        }

        try:
            client = self._get_client()
            response = await client.post(url, headers=headers, json=data)
            response.raise_for_status()
            result = response.json()
            return result["choices"][0]["message"]["content"]
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                raise DeepSeekAPIError(f"Invalid API key: {api_key[:8]}...")
            elif e.response.status_code == 429:
                raise DeepSeekAPIError(f"Rate limit exceeded for key: {api_key[:8]}...")
            else:
                raise DeepSeekAPIError(f"HTTP error {e.response.status_code}: {e}")
        except httpx.RequestError as e:
            raise DeepSeekAPIError(f"Request error: {e}")
        except (KeyError, IndexError) as e:
            raise DeepSeekAPIError(f"Invalid response format: {e}")

    async def generate_text(self, prompt: str, model: str = "deepseek-v4-flash", **kwargs) -> str:
        """生成文本（仅使用用户自填的 DeepSeek API Key）"""
        api_key = current_deepseek_key.get()
        if not api_key:
            raise Exception("请在个人设置中配置你的 DeepSeek API Key")

        async def _task():
            messages = [{"role": "user", "content": prompt}]
            try:
                result = await self._make_request(api_key, model, messages, **kwargs)
                return result
            except DeepSeekAPIError as e:
                logger.error(f"API error: {e}")
                if "invalid" in str(e).lower():
                    raise Exception("DeepSeek API Key 无效，请检查个人设置中的 Key 是否正确")
                elif "rate limit" in str(e).lower():
                    await asyncio.sleep(5)
                    raise
                raise
            except Exception as e:
                logger.error(f"Error: {e}")
                raise

        return await self.task_queue.enqueue(_task)

    async def generate_text_stream(self, prompt: str, model: str = "deepseek-v4-flash", **kwargs) -> AsyncGenerator[str, None]:
        """流式生成文本，逐个 token 产出（仅使用用户自填的 DeepSeek API Key）"""
        api_key = current_deepseek_key.get()
        if not api_key:
            raise Exception("请在个人设置中配置你的 DeepSeek API Key")

        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "Accept-Encoding": "identity"
        }

        data = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": True,
            **kwargs
        }

        try:
            client = self._get_client()
            async with client.stream("POST", url, headers=headers, json=data) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        chunk = json.loads(payload)
                        delta = chunk["choices"][0].get("delta", {})
                        token = delta.get("content", "")
                        if token:
                            yield token
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue
        except Exception as e:
            logger.error(f"Stream API error: {e}", exc_info=True)
            raise

    async def batch_generate(self, prompts: List[str], **kwargs) -> List[str]:
        """批量生成文本"""
        tasks = [self.generate_text(prompt, **kwargs) for prompt in prompts]
        return await asyncio.gather(*tasks)

    def get_key_usage(self) -> Dict[str, int]:
        """获取 API Key 使用情况"""
        return self.api_key_manager.key_usage


ai_service = AIService()
