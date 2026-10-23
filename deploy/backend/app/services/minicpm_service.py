import json
import logging
import os
import base64
import re
import httpx
from typing import AsyncGenerator, List, Dict, Any, Optional

logger = logging.getLogger(__name__)

MINICPM_API_KEY = os.getenv("MINICPM_API_KEY", "")
MINICPM_BASE_URL = "https://api.modelbest.co/v1"
MINICPM_MODEL = "MiniCPM-V-4.6-Thinking"
MINICPM_MODEL_INSTRUCT = "MiniCPM-V-4.6-Instruct"


TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "搜索互联网获取实时信息。当用户询问新闻、最新事件、实时数据、或需要外部知识补充时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词，尽量简洁精确"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_knowledge",
            "description": "在用户的学习知识库中搜索。当用户询问课本内容、学习资料、专业知识时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词，尽量简洁精确"}
                },
                "required": ["query"]
            }
        }
    }
]


class MiniCPMService:
    """MiniCPM-V-4.6 多模态服务，支持 Thinking 模式流式输出"""

    def __init__(self):
        self.api_key = MINICPM_API_KEY
        self.base_url = MINICPM_BASE_URL
        self.model = MINICPM_MODEL
        self.timeout = httpx.Timeout(120.0, connect=30.0)
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self) -> httpx.AsyncClient:
        """获取共享的 httpx 客户端（单例，避免文件描述符泄漏）"""
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=self.timeout,
                limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
            )
        return self._client

    async def generate_text_stream(
        self, messages: List[Dict[str, Any]], model: Optional[str] = None, **kwargs
    ) -> AsyncGenerator[dict, None]:
        """流式生成，产出 {"step": "reasoning"|"content", "token": str}"""
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "Accept-Encoding": "identity"
        }

        data = {
            "model": model or self.model,
            "messages": messages,
            "stream": True,
            **kwargs
        }
        if "max_tokens" in data:
            del data["max_tokens"]

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
                        if delta.get("reasoning"):
                            yield {"step": "reasoning", "token": delta["reasoning"]}
                        if delta.get("content"):
                            yield {"step": "content", "token": delta["content"]}
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue
        except Exception as e:
            logger.error(f"MiniCPM stream error: {e}", exc_info=True)
            raise

    async def generate_text(
        self, messages: List[Dict[str, Any]], model: Optional[str] = None, **kwargs
    ) -> Dict[str, Any]:
        """非流式生成，返回完整响应"""
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        data = {
            "model": model or self.model,
            "messages": messages,
            **kwargs
        }
        if "max_tokens" in data:
            del data["max_tokens"]

        try:
            client = self._get_client()
            response = await client.post(url, headers=headers, json=data)
            response.raise_for_status()
            result = response.json()
            message = result["choices"][0]["message"]
            reasoning = message.get("reasoning", "") or message.get("reasoning_content", "") or ""
            content = message.get("content", "") or ""
            return {
                "reasoning": reasoning,
                "content": content,
                "usage": result.get("usage", {})
            }
        except Exception as e:
            logger.error(f"MiniCPM generate error: {e}", exc_info=True)
            raise

    async def tool_chat_stream(
        self,
        messages: List[Dict[str, Any]],
        user_id: int = 0,
        model: Optional[str] = None,
        **kwargs
    ) -> AsyncGenerator[dict, None]:
        """工具增强的流式聊天：支持多轮迭代工具调用"""
        from app.services.agent_tool_layer import invoke_tool

        current_messages = messages.copy()
        max_rounds = 5
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        client = self._get_client()

        for _round in range(max_rounds):
            payload = {
                "model": model or self.model,
                "messages": current_messages,
                "tools": TOOL_DEFINITIONS,
                "tool_choice": "auto",
                "stream": False,
            }

            try:
                resp = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                )
                resp.raise_for_status()
                result = resp.json()
                choice = result["choices"][0]
                msg = choice.get("message", {})
            except Exception as e:
                logger.error(f"MiniCPM tool_chat_stream round {_round} error: {e}", exc_info=True)
                current_messages.append({"role": "assistant", "content": f"工具调用出错: {str(e)}"})
                break

            tool_calls = msg.get("tool_calls", [])

            if msg.get("reasoning"):
                yield {"step": "thinking_reasoning", "token": msg["reasoning"]}
                yield {"step": "reasoning_done", "token": ""}

            if not tool_calls:
                # 模型不再需要调用工具，使用流式请求逐 token 输出最终回答
                stream_headers = {**headers, "Accept": "text/event-stream", "Accept-Encoding": "identity"}
                stream_payload = {
                    "model": model or self.model,
                    "messages": current_messages,
                    "stream": True,
                }
                try:
                    async with client.stream("POST", f"{self.base_url}/chat/completions", headers=stream_headers, json=stream_payload) as response:
                        response.raise_for_status()
                        async for line in response.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            p = line[6:].strip()
                            if p == "[DONE]":
                                break
                            try:
                                chunk = json.loads(p)
                                delta = chunk["choices"][0].get("delta", {})
                                if delta.get("reasoning"):
                                    yield {"step": "reasoning", "token": delta["reasoning"]}
                                if delta.get("content"):
                                    yield {"step": "content", "token": delta["content"]}
                            except (json.JSONDecodeError, KeyError, IndexError):
                                continue
                except Exception as e:
                    logger.error(f"MiniCPM tool_chat_stream final stream error: {e}", exc_info=True)
                    yield {"step": "error", "token": f"流式回复失败: {str(e)}"}
                return

            # 有工具调用：记录 assistant 消息（含 tool_calls）
            current_messages.append({"role": "assistant", "content": None, "tool_calls": tool_calls})

            for tc in tool_calls:
                func_name = tc.get("function", {}).get("name", "")
                try:
                    raw_args = tc.get("function", {}).get("arguments", "{}")
                    func_args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                except json.JSONDecodeError:
                    func_args = {"query": raw_args}

                result_str = await invoke_tool(func_name, func_args, user_id=user_id)
                yield {"step": "tool_call", "name": func_name, "input": func_args, "result": result_str[:200]}
                current_messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", ""),
                    "content": result_str,
                })

        # 超出最大轮次后的兜底流式输出
        stream_headers = {**headers, "Accept": "text/event-stream", "Accept-Encoding": "identity"}
        stream_payload = {"model": model or self.model, "messages": current_messages, "stream": True}
        try:
            async with client.stream("POST", f"{self.base_url}/chat/completions", headers=stream_headers, json=stream_payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    p = line[6:].strip()
                    if p == "[DONE]":
                        break
                    try:
                        chunk = json.loads(p)
                        delta = chunk["choices"][0].get("delta", {})
                        if delta.get("reasoning"):
                            yield {"step": "reasoning", "token": delta["reasoning"]}
                        if delta.get("content"):
                            yield {"step": "content", "token": delta["content"]}
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue
        except Exception as e:
            logger.error(f"MiniCPM tool_chat_stream fallback stream error: {e}", exc_info=True)
            yield {"step": "error", "token": f"流式回复失败: {str(e)}"}


minicpm_service = MiniCPMService()


async def analyze_images_in_content(content: str) -> str:
    """扫描文档内容中的图片占位符，调用 MiniCPM 分析图片后用文字描述替换"""
    img_placeholders = re.findall(r'\[图片:([^\]]+)\]', content)
    if not img_placeholders:
        return content

    descriptions = {}
    for p in img_placeholders:
        if p in descriptions:
            continue
        if not os.path.exists(p):
            descriptions[p] = f"[图片: {os.path.basename(p)}]"
            continue
        try:
            with open(p, 'rb') as f:
                b64 = base64.b64encode(f.read()).decode('utf-8')
            prompt = "请详细描述这张图片中的所有重要信息，包括文字内容、图表数据、公式、人物、场景等。如果包含文字请完整转录。"
            messages = [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}}
                ]
            }]
            result = await minicpm_service.generate_text(messages)
            desc = (result.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
            descriptions[p] = desc.strip()
        except Exception as e:
            logger.warning(f"分析图片失败 {p}: {e}")
            descriptions[p] = os.path.basename(p)

    result = content
    for p, desc in descriptions.items():
        result = result.replace(f"[图片:{p}]", f"[图片: {desc}]")
    logger.info(f"已分析 {len(descriptions)} 张图片并替换占位符")
    return result
