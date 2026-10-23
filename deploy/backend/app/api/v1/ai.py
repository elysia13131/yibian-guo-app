from fastapi import APIRouter, HTTPException
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
import json
import asyncio
import logging
from fastapi.responses import StreamingResponse

from app.services.ai_service import ai_service
from app.services.minicpm_service import minicpm_service

logger = logging.getLogger(__name__)

router = APIRouter()


class ToolChatRequest(BaseModel):
    messages: List[Dict[str, Any]]
    user_id: int = 0
    enable_tools: bool = True
    temperature: Optional[float] = None
    model: Optional[str] = None


@router.post("/tool-chat-stream")
async def tool_chat_stream(request: ToolChatRequest):
    """工具增强的流式聊天，支持知识库搜索和网络搜索"""
    async def event_stream():
        try:
            kwargs = {}
            if request.temperature is not None:
                kwargs["temperature"] = request.temperature
            if request.model is not None:
                kwargs["model"] = request.model
            if request.enable_tools:
                async for chunk in minicpm_service.tool_chat_stream(
                    request.messages, user_id=request.user_id, **kwargs
                ):
                    yield f"data: {json.dumps(chunk)}\n\n"
            else:
                async for chunk in minicpm_service.generate_text_stream(
                    request.messages, **kwargs
                ):
                    yield f"data: {json.dumps(chunk)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            logger.error(f"tool_chat_stream error: {e}", exc_info=True)
            yield f"data: {json.dumps({'step': 'error', 'token': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/generate")
async def generate_text(prompt: str):
    """生成文本"""
    try:
        result = await ai_service.generate_text(prompt)
        return {"success": True, "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch-generate")
async def batch_generate_text(prompts: List[str]):
    """批量生成文本"""
    try:
        results = await ai_service.batch_generate(prompts)
        return {"success": True, "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/usage")
async def get_key_usage():
    """获取 API Key 使用情况"""
    usage = ai_service.get_key_usage()
    return {"success": True, "usage": usage}