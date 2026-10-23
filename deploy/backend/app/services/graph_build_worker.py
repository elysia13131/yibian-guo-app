"""知识图谱后台异步构建 Worker + WebSocket 事件广播"""
import asyncio
import json
import logging
from typing import Optional

from app.core.websocket import graph_ws_manager

logger = logging.getLogger(__name__)

graph_build_queue: asyncio.Queue = None
_worker_task: Optional[asyncio.Task] = None
_main_loop: Optional[asyncio.AbstractEventLoop] = None

# 取消机制：doc_id → asyncio.Event
_cancel_events: dict[int, asyncio.Event] = {}


def cancel_graph_build(document_id: int):
    """取消正在运行的知识图谱构建（文档删除或重解析时调用）"""
    ev = _cancel_events.pop(document_id, None)
    if ev:
        ev.set()
        logger.info(f"已发送图谱构建取消信号: document_id={document_id}")


async def _graph_build_worker():
    logger.info("知识图谱后台构建 Worker 已启动")
    doc_id = 0
    while True:
        try:
            task = await graph_build_queue.get()
            task_type = task.get("type", "kg_build")

            # ── 文档知识图谱构建 ──
            doc_id = task["document_id"]
            sections = task["sections"]
            user_id = task.get("user_id", 0)
            is_public = task.get("is_public", False)

            logger.info(f"开始后台构建知识图谱: document_id={doc_id}, sections={len(sections)}")
            payload = {
                "type": "graph_build_start",
                "document_id": doc_id,
                "total_sections": len(sections),
            }
            await graph_ws_manager.broadcast(doc_id, payload)
            await graph_ws_manager.broadcast(0, payload)

            from app.services.knowledge_graph_service import knowledge_graph_service
            from app.db.session import SessionLocal
            from app.models.document import Document

            # 检查文档是否还存在
            db = SessionLocal()
            try:
                doc = db.query(Document).filter(Document.id == int(doc_id)).first()
                if not doc:
                    logger.info(f"知识图谱构建已跳过: document_id={doc_id} 已被删除")
                    _cancel_events.pop(doc_id, None)
                    continue
            finally:
                db.close()

            # 注册取消事件
            cancel_ev = asyncio.Event()
            _cancel_events[int(doc_id)] = cancel_ev

            try:
                result = await knowledge_graph_service.build_knowledge_graph(
                    str(doc_id), sections, is_public=is_public, cancel_ev=cancel_ev,
                )

                # 构建完成后检查文档是否依然存在
                db = SessionLocal()
                try:
                    doc = db.query(Document).filter(Document.id == int(doc_id)).first()
                    if not doc:
                        logger.info(f"知识图谱构建后清理: document_id={doc_id} 在构建中已被删除")
                        knowledge_graph_service.delete_document_kg(str(doc_id))
                        continue
                    # 刷新 is_public（防止构建中途切换）
                    actual_is_public = doc.is_public if doc.is_public is not None else False
                    knowledge_graph_service.update_document_public_status(str(doc_id), actual_is_public)
                finally:
                    db.close()

                complete_payload = {
                    "type": "graph_build_complete",
                    "document_id": doc_id,
                    "result": result,
                }
                await graph_ws_manager.broadcast(doc_id, complete_payload)
                await graph_ws_manager.broadcast(0, complete_payload)
                logger.info(f"知识图谱后台构建完成: document_id={doc_id}")
            except asyncio.CancelledError:
                logger.info(f"知识图谱构建已取消并清理: document_id={doc_id}")
                cancel_payload = {
                    "type": "graph_build_cancelled",
                    "document_id": doc_id,
                    "reason": "文档已删除或重解析",
                }
                try:
                    await graph_ws_manager.broadcast(doc_id, cancel_payload)
                except Exception:
                    pass
            finally:
                _cancel_events.pop(int(doc_id), None)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"知识图谱后台构建出错: {e}", exc_info=True)
            _cancel_events.pop(int(doc_id), None)
            error_payload = {
                "type": "graph_build_error",
                "document_id": doc_id,
                "error": str(e),
            }
            try:
                await graph_ws_manager.broadcast(doc_id, error_payload)
                await graph_ws_manager.broadcast(0, error_payload)
            except Exception:
                pass


def ensure_worker():
    global graph_build_queue, _worker_task, _main_loop
    if graph_build_queue is None:
        graph_build_queue = asyncio.Queue()
    # 获取或复用运行中的事件循环
    try:
        _main_loop = asyncio.get_running_loop()
    except RuntimeError:
        # 非异步上下文：尝试从主线程获取（FastAPI/uvicorn）
        import threading
        main_thread = threading.main_thread()
        for t in threading.enumerate():
            if t is main_thread:
                try:
                    _main_loop = asyncio.get_event_loop()
                    if not _main_loop.is_running():
                        _main_loop = None
                    break
                except RuntimeError:
                    continue
    if _main_loop is None or _main_loop.is_closed():
        logger.error("无法获取运行中的事件循环，知识图谱构建任务将不会执行")
        return
    if _worker_task is None or _worker_task.done():
        _worker_task = _main_loop.create_task(_graph_build_worker())
        logger.info(f"知识图谱 Worker 已绑定到事件循环: {id(_main_loop)}")


def submit_graph_build(document_id: int, sections: list, user_id: int = 0, is_public: bool = False):
    global _main_loop
    # 取消同一文档的旧构建（重解析场景）
    cancel_graph_build(document_id)
    ensure_worker()
    if _main_loop is None or _main_loop.is_closed():
        logger.error("知识图谱构建提交失败: 主事件循环不可用")
        return
    _main_loop.call_soon_threadsafe(
        graph_build_queue.put_nowait,
        {"document_id": document_id, "sections": sections, "user_id": user_id, "is_public": is_public},
    )


def submit_l3_rebuild():
    """提交L3全量重建任务（文档删除后调用）"""
    global _main_loop
    ensure_worker()
    if _main_loop is None or _main_loop.is_closed():
        logger.error("L3重建提交失败: 主事件循环不可用")
        return
    _main_loop.call_soon_threadsafe(
        graph_build_queue.put_nowait,
        {"type": "l3_rebuild"},
    )


async def shutdown():
    global _worker_task
    if _worker_task and not _worker_task.done():
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
        _worker_task = None
