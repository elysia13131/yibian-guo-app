from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json

from app.api.v1.ai import router as ai_router
from app.api.v1.vector_db import router as vector_db_router
from app.api.v1.documents import router as documents_router
from app.api.v1.analysis import router as analysis_router
from app.api.v1.auth import router as auth_router
from app.api.v1.email import router as email_router
from app.api.v1.flashcards import router as flashcards_router
from app.api.v1.game import router as game_router
from app.api.v1.image import router as image_router
from app.api.v1.character import router as character_router
from app.api.v1.tts import router as tts_router
from app.api.v1.experiment import router as experiment_router
from app.api.v1.system import router as system_router
from app.api.v1.knowledge_graph import router as knowledge_graph_router

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(ai_router, prefix="/ai", tags=["AI"])
api_router.include_router(vector_db_router, prefix="/vector-db", tags=["Vector Database"])
api_router.include_router(documents_router, prefix="/documents", tags=["Documents"])
api_router.include_router(analysis_router, prefix="/analysis", tags=["Analysis"])
api_router.include_router(auth_router, prefix="/auth", tags=["Auth"])
api_router.include_router(email_router)
api_router.include_router(flashcards_router, prefix="/flashcards", tags=["Flashcards"])
api_router.include_router(game_router, tags=["Game"])
api_router.include_router(image_router, prefix="/image", tags=["Image Processing"])
api_router.include_router(character_router, prefix="/characters", tags=["Character"])
api_router.include_router(tts_router, tags=["TTS"])
api_router.include_router(experiment_router)
api_router.include_router(system_router)
api_router.include_router(knowledge_graph_router)


@api_router.get("/test")
async def test_endpoint():
    return {"message": "API v1 测试端点"}


class ChatRequest(BaseModel):
    message: str
    deep_think: bool = False
    stream: bool = True


@api_router.post("/chat")
async def chat_endpoint(req: ChatRequest):
    """普通聊天端点（流式），用于 Agent 页面"正常"模式"""
    from app.services.ai_request_manager import ai_request_manager

    async def stream_response():
        model = "deepseek-v4-flash"
        messages = [{"role": "user", "content": req.message}]

        kwargs = {}
        if req.deep_think:
            kwargs["reasoning_effort"] = "high"

        async for event in ai_request_manager.make_request_stream(
            request_id=f"chat_{id(req)}",
            messages=messages,
            model=model,
            **kwargs,
        ):
            if event["type"] == "token":
                yield f"data: {json.dumps({'content': event['content']})}\n\n"
            elif event["type"] == "reasoning":
                reasoning = event["content"]
                yield f"data: {json.dumps({'content': f'<think>{reasoning}</think>'})}\n\n"
            elif event["type"] == "done":
                yield "data: [DONE]\n\n"
                return
            elif event["type"] == "error":
                yield f"data: {json.dumps({'content': event['message'], 'error': True})}\n\n"
                yield "data: [DONE]\n\n"
                return

    if req.stream:
        return StreamingResponse(
            stream_response(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    else:
        from app.services.ai_request_manager import ai_request_manager
        try:
            text = await ai_request_manager.generate_text(req.message)
            return {"content": text}
        except Exception as e:
            return {"content": f"错误: {e}"}


@api_router.get("/test-web-search")
async def test_web_search(q: str = "惯性实验"):
    """测试博查网页搜索 API"""
    from app.services.web_search_request_manager import web_search_manager
    if not web_search_manager:
        return {"error": "博查搜索未初始化"}
    try:
        result = await web_search_manager.search(query=q, count=3, summary=True)
        pages = []
        if result:
            raw_pages = result.get("webPages", {}).get("value", [])
            for p in raw_pages[:3]:
                pages.append({
                    "title": p.get("name", ""),
                    "url": p.get("url", ""),
                    "snippet": p.get("snippet", ""),
                    "summary": p.get("summary", ""),
                })
        return {"success": True, "query": q, "total": len(pages), "results": pages}
    except Exception as e:
        return {"success": False, "error": str(e)}
