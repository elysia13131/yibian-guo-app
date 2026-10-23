import asyncio
import logging
import json
from typing import List, Dict, Any, Optional
import httpx
import uuid

from app.core.user_context import current_deepseek_key
from app.core.config import settings

logger = logging.getLogger(__name__)


class AIAPIError(Exception):
    """AI API 错误"""
    pass


class AIRequestManager:
    """
    统一的 AI 请求管理器
    - 管理用户 API Key
    - 支持请求取消
    速率控制交由模型官方管理
    """

    _instance = None
    _lock = asyncio.Lock()

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
        """获取或创建共享 HTTP 客户端（复用连接，防止文件描述符泄漏）"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(120.0, connect=30.0),
                limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
            )
        return self._client

    async def acquire_key(self) -> str:
        """获取用户自填的 DeepSeek API Key"""
        user_key = current_deepseek_key.get()
        if not user_key:
            raise AIAPIError("请在个人设置中配置你的 DeepSeek API Key")
        return user_key

    async def make_request(
        self,
        request_id: str,
        messages: List[Dict[str, str]],
        model: str = "deepseek-v4-flash",
        **kwargs
    ) -> str:
        """发送 AI 请求（仅使用用户自填的 DeepSeek API Key）"""
        key = await self.acquire_key()

        # 记录请求概览
        user_msg_count = sum(1 for m in messages if m.get("role") == "user")
        total_chars = sum(len(m.get("content", "")) for m in messages)
        logger.info(f"[{request_id}] >>> 发送 AI 请求 | 消息数: {len(messages)} | 用户消息: {user_msg_count} | 总字符: {total_chars}")
        if messages:
            last_content = messages[-1].get("content", "")
            logger.info(f"[{request_id}] >>> 请求内容预览(前300字): {last_content[:300]}")

        url = f"{settings.DEEPSEEK_BASE_URL}/chat/completions"
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        }
        data = {
            "model": model,
            "messages": messages,
            **kwargs
        }

        max_retries = 3
        for attempt in range(max_retries):
            try:
                client = self._get_client()
                response = await client.post(url, headers=headers, json=data)
                response.raise_for_status()
                result = response.json()

                content = result["choices"][0]["message"]["content"]
                usage = result.get("usage", {})
                logger.info(f"[{request_id}] <<< AI 响应成功 | token: 输入={usage.get('prompt_tokens','?')} 输出={usage.get('completion_tokens','?')} 总计={usage.get('total_tokens','?')}")
                logger.info(f"[{request_id}] <<< AI 响应内容(前500字): {content[:500]}")
                if len(content) > 500:
                    logger.info(f"[{request_id}] <<< AI 响应剩余部分(第501-1000字): {content[500:1000]}")
                return content

            except httpx.HTTPStatusError as e:
                status = e.response.status_code
                response_body = e.response.text if hasattr(e.response, 'text') else 'N/A'
                logger.error(f"[{request_id}] HTTP 错误: {status} | 响应体: {response_body[:500]}")

                if status in (401, 402):
                    raise AIAPIError("DeepSeek API Key 无效或余额不足，请检查个人设置中的 Key")

                if status == 429:
                    logger.warning(f"[{request_id}] 速率限制，等待后重试 ({attempt+1}/{max_retries})...")
                    await asyncio.sleep(5)
                    continue

                raise AIAPIError(f"HTTP {status}: {e}")

            except Exception as e:
                logger.error(f"[{request_id}] 请求异常: {type(e).__name__}: {e}", exc_info=True)
                if attempt < max_retries - 1:
                    logger.warning(f"[{request_id}] 重试 ({attempt+2}/{max_retries})...")
                    await asyncio.sleep(1)
                    continue
                raise AIAPIError(f"Request error: {e}")

    async def make_request_stream(
        self,
        request_id: str,
        messages: List[Dict[str, str]],
        model: str = "deepseek-v4-flash",
        **kwargs
    ):
        """发送 AI 请求（流式，仅使用用户自填的 DeepSeek API Key）"""
        key = await self.acquire_key()

        user_msg_count = sum(1 for m in messages if m.get("role") == "user")
        total_chars = sum(len(m.get("content", "")) for m in messages)
        logger.info(f"[{request_id}] >>> 流式 AI 请求 | 消息数: {len(messages)} | 总字符: {total_chars}")

        url = f"{settings.DEEPSEEK_BASE_URL}/chat/completions"
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        }
        data = {
            "model": model,
            "messages": messages,
            "stream": True,
            **kwargs
        }

        max_retries = 3
        for attempt in range(max_retries):
            try:
                client = self._get_client()
                async with client.stream("POST", url, headers=headers, json=data) as response:
                        response.raise_for_status()
                        full_content = ""
                        tool_calls_acc = {}
                        async for line in response.aiter_lines():
                            if line.startswith("data: "):
                                chunk = line[6:].strip()
                                if chunk == "[DONE]":
                                    break
                                try:
                                    chunk_data = json.loads(chunk)
                                    delta = chunk_data.get("choices", [{}])[0].get("delta", {})
                                    content_piece = delta.get("content", "")
                                    if content_piece:
                                        full_content += content_piece
                                        yield {"type": "token", "content": content_piece}
                                    reasoning_piece = delta.get("reasoning_content", "")
                                    if reasoning_piece:
                                        yield {"type": "reasoning", "content": reasoning_piece}
                                    tc_delta = delta.get("tool_calls")
                                    if tc_delta:
                                        for tc in tc_delta:
                                            idx = tc.get("index", 0)
                                            if idx not in tool_calls_acc:
                                                tool_calls_acc[idx] = {
                                                    "id": tc.get("id", ""),
                                                    "type": tc.get("type", "function"),
                                                    "function": {"name": "", "arguments": ""}
                                                }
                                            fn = tc.get("function", {})
                                            if fn.get("name"):
                                                tool_calls_acc[idx]["function"]["name"] = fn["name"]
                                            if fn.get("arguments"):
                                                tool_calls_acc[idx]["function"]["arguments"] += fn["arguments"]
                                            if tc.get("id"):
                                                tool_calls_acc[idx]["id"] = tc["id"]
                                except json.JSONDecodeError:
                                    continue

                        if tool_calls_acc:
                            sorted_calls = [tool_calls_acc[i] for i in sorted(tool_calls_acc)]
                            logger.info(f"[{request_id}] <<< 流式工具调用完成: {[c['function']['name'] for c in sorted_calls]}")
                            yield {"type": "tool_calls", "tool_calls": sorted_calls}
                        else:
                            usage = {"total_tokens": len(full_content)}
                            logger.info(f"[{request_id}] <<< 流式 AI 响应完成 | 总字符: {len(full_content)}")
                            yield {"type": "done", "full_content": full_content}
                        return

            except httpx.HTTPStatusError as e:
                status = e.response.status_code
                if status in (402, 401):
                    yield {"type": "error", "message": "DeepSeek API Key 无效或余额不足，请检查个人设置中的 Key"}
                    return
                logger.error(f"[{request_id}] 流式 HTTP 错误: {status}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(1)
                    continue
                yield {"type": "error", "message": f"HTTP {status}"}
                return

            except Exception as e:
                logger.error(f"[{request_id}] 流式请求异常: {e}")
                if attempt < max_retries - 1:
                    logger.warning(f"[{request_id}] 重试 ({attempt+2}/{max_retries})...")
                    await asyncio.sleep(1)
                    continue
                yield {"type": "error", "message": str(e)}
                return

    async def generate_text(
        self,
        prompt: str,
        model: str = "deepseek-v4-flash",
        request_id: Optional[str] = None,
        **kwargs
    ) -> str:
        """生成文本"""
        if not request_id:
            request_id = str(uuid.uuid4())

        messages = [{"role": "user", "content": prompt}]
        return await self.make_request(request_id, messages, model, **kwargs)

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


ai_request_manager = AIRequestManager()
