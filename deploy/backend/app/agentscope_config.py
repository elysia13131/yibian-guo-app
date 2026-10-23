"""AgentScope 配置初始化 — 模型 / 工具 / Memory"""
import asyncio
import collections
import copy
import logging
from datetime import datetime, timedelta
from typing import List, Optional

from agentscope.model import OpenAIChatModel
from agentscope.tool import Toolkit, ToolResponse
from agentscope.memory import InMemoryMemory, LongTermMemoryBase
from agentscope.message import Msg
from agentscope.model._model_response import ChatResponse

logger = logging.getLogger(__name__)


# ============================================================
# 模型包装 — 过滤 DeepSeek 的 thinking 块
# ============================================================


def _clean_messages(messages):
    """清理消息列表中的 thinking 块（从消息历史中移除 reasoning_content）"""
    cleaned = []
    for msg in messages:
        if isinstance(msg, dict):
            msg = dict(msg)
            if "reasoning_content" in msg:
                del msg["reasoning_content"]
            if "content" in msg and isinstance(msg["content"], list):
                msg["content"] = [b for b in msg["content"] if isinstance(b, dict) and b.get("type") != "thinking"]
            cleaned.append(msg)
        else:
            cleaned.append(msg)
    return cleaned


class DeepSeekModel(OpenAIChatModel):
    """DeepSeek 专用模型包装，自动过滤 thinking 块"""

    def __call__(self, *args, **kwargs):
        # 清理输入消息中的 thinking 块
        if "messages" in kwargs:
            kwargs["messages"] = _clean_messages(kwargs.get("messages", []))
        elif len(args) > 0 and isinstance(args[0], list):
            args = (_clean_messages(args[0]),) + args[1:]

        is_stream = kwargs.get("stream", self.stream)
        # Parent __call__ is async def, calling it returns a coroutine
        coro = super().__call__(*args, **kwargs)

        if is_stream:
            # stream=True: 返回 coroutine，await 后得到 async_generator
            async def stream_coro():
                inner_gen = await coro
                return _wrap_stream_gen(inner_gen)
            return stream_coro()
        else:
            # stream=False: 返回 coroutine，await 后得到过滤后的 ChatResponse
            async def wrapper():
                result = await coro
                if isinstance(result, ChatResponse) and result.content:
                    filtered = [b for b in result.content if not (isinstance(b, dict) and b.get("type") == "thinking")]
                    if len(filtered) != len(result.content):
                        result = copy.copy(result)
                        result.content = filtered
                return result
            return wrapper()


def _wrap_stream_gen(inner_gen):
    """将原始 AsyncGenerator 包装为过滤后的 AsyncGenerator（同步方法返回 async_generator）"""
    async def gen():
        async for chunk in inner_gen:
            if isinstance(chunk, ChatResponse) and chunk.content:
                filtered = [b for b in chunk.content if not (isinstance(b, dict) and b.get("type") == "thinking")]
                if len(filtered) != len(chunk.content):
                    chunk = copy.copy(chunk)
                    chunk.content = filtered
            yield chunk
    return gen()


# ============================================================
# 工具注册 — 包装现有 _tool_* 函数为 AgentScope 格式
# ============================================================

async def _tool_wrapper(tool_name: str, **kwargs):
    """通用包装器：调用现有 agent_tool_layer 的工具函数"""
    from app.services.agent_tool_layer import invoke_tool
    user_id = kwargs.pop("_user_id", 0)
    return await invoke_tool(tool_name, kwargs, user_id)


def build_knowledge_toolkit() -> Toolkit:
    """知识管家的工具集"""
    tk = Toolkit()
    tk.register_tool_function(_tool_web_search)
    tk.register_tool_function(_tool_search_knowledge)
    tk.register_tool_function(_tool_graph_qa)
    tk.register_tool_function(_tool_get_document)
    return tk


def build_tutor_toolkit() -> Toolkit:
    tk = Toolkit()
    tk.register_tool_function(_tool_search_knowledge)
    tk.register_tool_function(_tool_graph_qa)
    return tk


def build_quiz_toolkit() -> Toolkit:
    tk = Toolkit()
    tk.register_tool_function(_tool_web_search)
    return tk


def build_review_toolkit() -> Toolkit:
    tk = Toolkit()
    tk.register_tool_function(_tool_search_knowledge)
    tk.register_tool_function(_tool_graph_qa)
    tk.register_tool_function(_tool_get_flashcards)
    return tk


def build_clinical_toolkit() -> Toolkit:
    tk = Toolkit()
    tk.register_tool_function(_tool_web_search)
    tk.register_tool_function(_tool_search_knowledge)
    tk.register_tool_function(_tool_graph_qa)
    return tk


def build_analytics_toolkit() -> Toolkit:
    tk = Toolkit()
    tk.register_tool_function(_tool_get_user_stats)
    return tk


def build_methods_toolkit() -> Toolkit:
    tk = Toolkit()
    tk.register_tool_function(_tool_web_search)
    tk.register_tool_function(_tool_search_knowledge)
    tk.register_tool_function(_tool_graph_qa)
    tk.register_tool_function(_tool_get_document)
    return tk


def build_orchestrator_toolkit() -> Toolkit:
    """Orchestrator 的工具集（含所有子 Agent 工具 + plan 相关）"""
    tk = Toolkit()
    tk.register_tool_function(_tool_web_search)
    tk.register_tool_function(_tool_search_knowledge)
    tk.register_tool_function(_tool_get_document)
    tk.register_tool_function(_tool_get_flashcards)
    tk.register_tool_function(_tool_get_user_stats)
    return tk


# ============================================================
# AgentScope 格式化工具函数（每个函数的 docstring 会被 AgentScope 解析为 JSON Schema）
# ============================================================

async def _tool_web_search(query: str, count: int = 5) -> ToolResponse:
    """搜索互联网获取实时信息。

    Args:
        query: 搜索词
        count: 返回结果条数，默认5
    """
    result = await _tool_wrapper("web_search", query=query, count=count)
    return ToolResponse(content=result)


async def _tool_search_knowledge(query: str, n_results: int = 5) -> ToolResponse:
    """在用户的知识库中语义搜索。

    Args:
        query: 搜索内容
        n_results: 返回条数，默认5
    """
    result = await _tool_wrapper("search_knowledge", query=query, n_results=n_results)
    return ToolResponse(content=result)


async def _tool_graph_qa(query: str, n_sources: int = 5) -> ToolResponse:
    """基于知识图谱回答问题。

    Args:
        query: 用户问题
        n_sources: 检索的图谱节点数，默认5
    """
    result = await _tool_wrapper("graph_qa", query=query, n_sources=n_sources)
    return ToolResponse(content=result)


async def _tool_get_document(document_id: int = None, chapter_id: int = None) -> ToolResponse:
    """获取指定文档或章节的完整内容。

    Args:
        document_id: 文档ID
        chapter_id: 章节ID
    """
    result = await _tool_wrapper("get_document", document_id=document_id, chapter_id=chapter_id)
    return ToolResponse(content=result)


async def _tool_get_flashcards(group_id: int = None, status: str = None, limit: int = 20) -> ToolResponse:
    """查询用户的抽认卡（flashcards）。

    Args:
        group_id: 分组ID（可选）
        status: 学习状态（可选）
        limit: 返回条数，默认20
    """
    result = await _tool_wrapper("get_flashcards", group_id=group_id, status=status, limit=limit)
    return ToolResponse(content=result)


async def _tool_get_user_stats(user_id: int = 0, days: int = 30) -> ToolResponse:
    """获取用户的学习统计数据。

    Args:
        user_id: 用户ID
        days: 统计天数，默认30
    """
    result = await _tool_wrapper("get_user_stats", user_id=user_id, days=days)
    return ToolResponse(content=result)


# ============================================================
# Memory — 短期记忆 + 长期记忆
# ============================================================


class DbLongTermMemory(LongTermMemoryBase):
    """基于 UserAgentSession 数据库表的长期记忆实现"""

    def __init__(self, user_id: int):
        super().__init__()
        self.user_id = user_id

    async def record(self, msgs: list, **kwargs) -> None:
        """将消息记录到长期记忆数据库"""
        pass

    async def retrieve(self, msg: object, limit: int = 5, **kwargs) -> str:
        """从长期记忆中检索相关信息"""
        return ""


def create_memory() -> InMemoryMemory:
    """创建短期记忆"""
    return InMemoryMemory()


def create_long_term_memory(user_id: int) -> DbLongTermMemory:
    """创建长期记忆"""
    return DbLongTermMemory(user_id)
