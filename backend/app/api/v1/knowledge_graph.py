import json, logging, asyncio
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from app.services.knowledge_graph_service import knowledge_graph_service
from app.core.websocket import graph_ws_manager
from app.db.session import get_db
from fastapi import Depends
from sqlalchemy.orm import Session
from app.models.document import Document, Chapter
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/graph", tags=["knowledge-graph"])


@router.get("/l1/{document_id}")
async def get_l1_nodes(document_id: str, section_id: str = Query(None)):
    try:
        loop = asyncio.get_running_loop()
        if section_id:
            nodes, edges = await asyncio.gather(
                loop.run_in_executor(None, knowledge_graph_service.get_nodes_by_section, document_id, section_id),
                loop.run_in_executor(None, knowledge_graph_service.get_edges_by_document, document_id, "L1"),
            )
        else:
            nodes, edges = await asyncio.gather(
                loop.run_in_executor(None, knowledge_graph_service.get_nodes_by_document, document_id, "L1"),
                loop.run_in_executor(None, knowledge_graph_service.get_edges_by_document, document_id, "L1"),
            )
        return {"nodes": nodes, "edges": edges, "level": "L1", "truncated": len(nodes) >= 1024 or len(edges) >= 1024}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/node/{node_id}")
async def get_node_detail(node_id: str):
    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, knowledge_graph_service.get_node_detail, node_id)
        if result.get("node") is None:
            raise HTTPException(status_code=404, detail="Node not found")
        return {"node": result["node"], "relations": result["relations"]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class BuildTestRequest(BaseModel):
    """测试用：构建请求"""
    document_id: int = 1


@router.post("/build-test")
async def build_test_graph(req: BuildTestRequest, db: Session = Depends(get_db)):
    """测试端点：提交知识图谱构建任务到后台 Worker，不阻塞"""
    doc_id_num = req.document_id
    # 从数据库读取章节（只使用叶子章节，避免父子重复）
    chapters = db.query(Chapter).filter(Chapter.document_id == doc_id_num).order_by(Chapter.id).all()
    if not chapters:
        raise HTTPException(status_code=404, detail=f"文档 {doc_id_num} 没有章节数据")
    parent_ids = {c.parent_id for c in chapters if c.parent_id is not None}
    sections = [{"id": str(c.id), "title": c.title or "", "content": c.content or ""}
                for c in chapters if c.id not in parent_ids]
    logger.info(f"提交知识图谱构建任务: document_id={doc_id_num}, sections={len(sections)}")
    try:
        from app.services.graph_build_worker import submit_graph_build
        submit_graph_build(doc_id_num, sections, is_public=True)
        return {
            "status": "submitted",
            "document_id": str(doc_id_num),
            "sections_count": len(sections),
        }
    except Exception as e:
        logger.exception(f"知识图谱构建提交失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.websocket("/ws/{document_id}")
async def graph_websocket(websocket: WebSocket, document_id: int):
    await graph_ws_manager.connect(document_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, Exception):
        graph_ws_manager.disconnect(document_id, websocket)


@router.websocket("/ws/events")
async def graph_events_websocket(websocket: WebSocket):
    await graph_ws_manager.connect(0, websocket)
    try:
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, Exception):
        graph_ws_manager.disconnect(0, websocket)


@router.get("/search")
async def search_nodes(q: str = Query(...), level: str = Query(""), limit: int = Query(20)):
    try:
        loop = asyncio.get_running_loop()
        results = await loop.run_in_executor(None, knowledge_graph_service.search_nodes, q, level, limit)
        return {"results": results, "total": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
async def get_stats():
    try:
        loop = asyncio.get_running_loop()
        stats = await loop.run_in_executor(None, knowledge_graph_service.get_stats)
        return stats
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/levels/{document_id}")
async def get_document_levels(document_id: str):
    try:
        loop = asyncio.get_running_loop()
        levels = await loop.run_in_executor(None, knowledge_graph_service.get_document_levels, document_id)
        return levels
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/node/{node_id}/trace")
async def trace_node(node_id: str):
    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, knowledge_graph_service.trace_node, node_id)
        if result.get("node") is None:
            raise HTTPException(status_code=404, detail="Node not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/edges/batch")
async def batch_edges(body: dict):
    """批量查询一组节点之间的边（替代逐节点串行调用）"""
    try:
        node_ids = set(body.get("node_ids", []))
        if not node_ids:
            return {"edges": []}
        loop = asyncio.get_running_loop()
        edges = await loop.run_in_executor(None, knowledge_graph_service.get_edges_batch, node_ids)
        return {"edges": edges}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
