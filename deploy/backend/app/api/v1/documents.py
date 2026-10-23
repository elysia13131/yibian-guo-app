from fastapi import APIRouter, WebSocket, WebSocketDisconnect, UploadFile, File, Form, HTTPException, Depends, BackgroundTasks, Query, Body
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import logging
import asyncio
import os
import tempfile
import math
from datetime import datetime, timezone

from app.db.session import get_db
from app.models.document import DocumentStatus
from app.schemas.document import (
    Document as DocumentSchema,
    DocumentDetail,
    DocumentList,
    Chapter as ChapterSchema,
    ChapterNavigation,
    ChapterMergeRequest,
    ChapterSplitRequest
)
from app.services.document_service import document_service
from app.core.websocket import manager
from app.api.v1.auth import get_current_user_dep, get_optional_current_user_dep
from app.schemas.user import TokenData
from app.services.knowledge_graph_service import knowledge_graph_service

class MindmapGenerateRequest(BaseModel):
    model: str = "deepseek-v4-flash"

logger = logging.getLogger(__name__)
router = APIRouter(tags=["documents"])


def get_file_type(filename: str) -> str:
    """从文件名获取文件类型"""
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    type_map = {
        'pdf': 'pdf',
        'docx': 'docx',
        'txt': 'txt',
        'md': 'md',
        'ppt': 'pptx',
        'pptx': 'pptx',
    }
    return type_map.get(ext, 'txt')


def model_to_dict(model):
    """将 SQLAlchemy 模型转换为字典"""
    if model is None:
        return None
    result = {}
    for column in model.__table__.columns:
        value = getattr(model, column.name)
        if hasattr(value, 'isoformat'):
            value = value.isoformat()
        elif hasattr(value, 'value'):
            value = value.value
        result[column.name] = value
    return result


@router.websocket("/ws/{document_id}")
async def websocket_endpoint(websocket: WebSocket, document_id: int):
    """WebSocket端点，用于实时获取文档解析进度"""
    await manager.connect(document_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(document_id, websocket)


async def parse_with_progress(document_id: int, use_ai: bool = False):
    """带进度回调的解析函数"""
    from app.db.session import SessionLocal
    from app.services.document_parser import DocumentParser, StructureAnalyzer, ParsedChapter

    loop = asyncio.get_running_loop()

    def progress_callback(progress: int, status: str, message: str):
        loop.call_soon_threadsafe(
            lambda: asyncio.ensure_future(
                manager.send_progress(document_id, progress, status, message)
            )
        )

    try:
        db = SessionLocal()
        try:
            # 先查询文档，确保获取到最新的信息
            document = document_service.get_document(db, document_id)
            if document:
                logger.info(f"📖 异步任务中获取到文档信息: document_id={document_id}, file_path={document.file_path}")

            if use_ai:
                # AI解析：直接在这里异步处理，避免事件循环问题
                logger.info(f"使用 AI 分析文档: {document_id}")

                # 立即设置文档状态为解析中
                document.status = DocumentStatus.PARSING
                db.commit()
                db.refresh(document)
                logger.info(f"📝 文档状态已更新为解析中: document_id={document_id}")

                if progress_callback:
                    progress_callback(5, "parsing", "正在读取文件...")

                # 从压缩文件中读取内容
                file_content = document_service._read_compressed_file(document.file_path)
                text, images_info = DocumentParser.parse_file_from_bytes(file_content, document.file_type)

                if not text.strip():
                    raise ValueError("文档内容为空或无法提取")

                if progress_callback:
                    progress_callback(20, "parsing", "正在使用 AI 分析文档结构...")

                # 直接异步调用AI分析
                chapters = await StructureAnalyzer._try_ai_analysis_async(text)

                if not chapters:
                    logger.error("AI 分析失败，不回退到规则分析")
                    raise ValueError("AI 分析失败，请重试")

                if progress_callback:
                    progress_callback(40, "parsing", "正在保存章节...")

                # 保存章节
                document_service._delete_chapters(db, document_id)
                document_service._save_chapters(db, document_id, chapters, use_ai=use_ai)

                # AI解析完成后，手动导入向量数据库
                if use_ai:
                    try:
                        document_service._import_to_vector_db(db, document_id)
                    except Exception as e:
                        logger.warning(f"导入向量数据库失败: {e}")

                # 后台触发知识图谱构建（使用实际 chapter.id 作为 section ID）
                try:
                    document_service._submit_kg_build(db, document_id, document.is_public)
                    logger.info(f"AI 解析后知识图谱构建任务已提交: {document_id}")
                except Exception as e:
                    logger.warning(f"AI 解析后知识图谱构建提交失败: {e}")

                if progress_callback:
                    progress_callback(80, "parsing", "正在完成...")

                # 更新文档状态
                document.status = DocumentStatus.COMPLETED
                document.parsed_at = datetime.now(timezone.utc)
                document.error_message = None
                db.commit()

                if progress_callback:
                    progress_callback(100, "completed", "解析完成")

                # 保留压缩文件，以便后续重新解析
                logger.info(f"文档解析完成，保留压缩源文件: {document.file_path}")

                logger.info(f"文档解析完成: {document_id}, 共 {len(chapters)} 个章节")
                await manager.send_complete(document_id, True, "解析完成")
            else:
                # 非AI解析：使用原有的同步方法（在 executor 中运行避免阻塞事件循环）
                loop = asyncio.get_running_loop()
                success = await loop.run_in_executor(
                    None, document_service.parse_document,
                    db, document_id, progress_callback, use_ai)
                if success:
                    await manager.send_complete(document_id, True, "解析完成")
                else:
                    await manager.send_complete(document_id, False, "解析失败")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"解析任务失败: {e}")
        await manager.send_complete(document_id, False, str(e))


async def parse_with_somark(document_id: int, use_rule_parsing: bool = False):
    """使用 SoMark 智能解析文档"""
    from app.db.session import SessionLocal

    loop = asyncio.get_running_loop()

    def progress_callback(progress: int, status: str, message: str):
        loop.call_soon_threadsafe(
            lambda: asyncio.ensure_future(
                manager.send_progress(document_id, progress, status, message)
            )
        )

    try:
        db = SessionLocal()
        try:
            document = document_service.get_document(db, document_id)
            if document:
                logger.info(f"SoMark 解析任务开始: document_id={document_id}, use_rule_parsing={use_rule_parsing}")

            success = await document_service.parse_document_somark_async(
                db=db,
                document_id=document_id,
                progress_callback=progress_callback,
                use_rule_parsing=use_rule_parsing,
            )

            if success:
                await manager.send_complete(document_id, True, "SoMark 解析完成")
            else:
                await manager.send_complete(document_id, False, "SoMark 解析失败")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"SoMark 解析任务失败: {e}")
        await manager.send_complete(document_id, False, str(e))


@router.post("/{document_id}/reparse-somark", response_model=dict)
async def reparse_document_somark(
    document_id: int,
    use_rule_parsing: bool = Query(False, alias="use_rule_parsing"),
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    """使用 SoMark 智能重新解析文档"""
    document = document_service.get_document(db, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档未找到")

    if document.owner_id != token_data.user_id:
        raise HTTPException(status_code=403, detail="无权操作此文档")

    asyncio.create_task(parse_with_somark(document_id, use_rule_parsing=use_rule_parsing))

    return {
        "success": True,
        "message": "SoMark 解析任务已启动",
    }


@router.post("/upload-only", response_model=dict)
async def upload_document_only(
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """上传文档但不解析（仅存储，供游戏模式使用）"""
    try:
        file_type = get_file_type(file.filename)
        if file_type not in ['pdf', 'docx', 'txt', 'md', 'pptx']:
            raise HTTPException(status_code=400, detail="不支持的文件格式")

        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="文件内容为空")

        document = document_service.create_document(
            db=db,
            title=title or file.filename,
            filename=file.filename,
            file_content=content,
            file_type=file_type,
            owner_id=token_data.user_id,
        )
        db.commit()
        db.refresh(document)

        logger.info(f"📄 文档上传成功（未解析）: ID={document.id}")
        return {
            "success": True,
            "document_id": document.id,
            "message": "文档上传成功",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"文档上传失败: {e}")
        raise HTTPException(status_code=500, detail=f"文档上传失败: {str(e)}")


@router.post("/upload", response_model=dict)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    is_public: Optional[bool] = Form(False),
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """上传文档（需要登录）"""
    try:
        logger.info("📥 收到上传请求")

        file_type = get_file_type(file.filename)
        if file_type not in ['pdf', 'docx', 'txt', 'md', 'pptx']:
            raise HTTPException(status_code=400, detail="不支持的文件格式，仅支持 PDF、DOCX、PPTX、TXT、MD")

        content = await file.read()
        logger.info(f"📄 文件读取完成，大小: {len(content)} 字节")

        if not content:
            raise HTTPException(status_code=400, detail="文件内容为空")

        # ── 内容去重检查 ──
        import hashlib
        content_hash = hashlib.md5(content).hexdigest()

        if is_public:
            existing = document_service.get_public_document_by_hash(db, content_hash)
            if existing:
                raise HTTPException(
                    status_code=409,
                    detail=f"公共文档库中已存在相同内容的文档「{existing.title}」(ID: {existing.id})，不可重复上传为公开文档。如需要请上传为私密文档。"
                )
        else:
            existing = document_service.get_private_document_by_hash(db, content_hash, token_data.user_id)
            if existing:
                raise HTTPException(
                    status_code=409,
                    detail=f"你的私密文档库中已存在相同内容的文档「{existing.title}」(ID: {existing.id})，不可重复上传。"
                )

        doc_title = title or file.filename

        logger.info("📝 开始创建文档记录")
        document = document_service.create_document(
            db=db,
            title=doc_title,
            filename=file.filename,
            file_content=content,
            file_type=file_type,
            owner_id=token_data.user_id,
            category=category
        )

        document.is_public = is_public
        db.commit()

        logger.info(f"✅ 文档已创建，ID: {document.id}, 状态: {document.status}")

        # 确保文档立即在数据库中可查询
        db.refresh(document)
        logger.info(f"🔄 刷新文档后状态: {document.status}")

        # 再次查询确认文档存在
        verify_doc = document_service.get_document(db, document.id)
        logger.info(f"🔍 验证文档存在: {verify_doc is not None}, ID: {verify_doc.id if verify_doc else None}")

        # 查询所有文档，看看新文档是否在列表中
        all_docs = document_service.get_documents(db)
        logger.info(f"📋 当前所有文档数量: {len(all_docs)}, IDs: {[d.id for d in all_docs]}")

        # 在后台启动解析任务，不使用当前请求的数据库会话
        logger.info("🚀 启动后台解析任务")
        asyncio.create_task(parse_with_progress(document.id, use_ai=False))

        response = {
            "success": True,
            "document_id": document.id,
            "message": "文档上传成功，正在解析..."
        }
        logger.info(f"📤 返回响应: {response}")
        return response
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"文档上传失败: {e}")
        raise HTTPException(status_code=500, detail=f"文档上传失败: {str(e)}")


@router.get("/categories", response_model=list[str])
async def get_categories(
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取当前用户的所有自定义分类"""
    categories = document_service.get_categories(db, owner_id=token_data.user_id)
    return categories


@router.get("/public", response_model=dict)
async def get_public_documents(
    db: Session = Depends(get_db)
):
    """获取所有公共文档，按分类分组"""
    docs_by_category = document_service.get_public_documents_by_category(db)

    result = {}
    for category, docs in docs_by_category.items():
        result[category] = [model_to_dict(doc) for doc in docs]

    return result


@router.get("/popular", response_model=List[dict])
async def get_popular_documents(
    limit: int = 3,
    db: Session = Depends(get_db)
):
    """获取浏览量最高的公开文档"""
    from app.models.document import Document

    # 查询浏览量最高的公开文档
    popular_docs = db.query(Document).filter(
        Document.is_public == True,
        Document.status == DocumentStatus.COMPLETED
    ).order_by(Document.view_count.desc()).limit(limit).all()

    return [model_to_dict(doc) for doc in popular_docs]


@router.get("", response_model=DocumentList)
async def list_documents(
    skip: int = 0,
    limit: int = 100,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取当前用户的文档列表"""
    documents = document_service.get_documents(db, owner_id=token_data.user_id, skip=skip, limit=limit)
    logger.info(f"📋 从数据库查询到 {len(documents)} 个文档，IDs: {[d.id for d in documents]}")
    items = [model_to_dict(doc) for doc in documents]
    total = len(items)
    logger.info(f"📋 转换后返回 {total} 个文档，IDs: {[item['id'] for item in items]}")
    return {"total": total, "items": items}


@router.get("/search", response_model=List[dict])
async def search_documents(
    q: str = Query(..., description="搜索关键词"),
    db: Session = Depends(get_db)
):
    """
    搜索文档（暂时只搜索公共文档）：
    - 支持精确匹配文档名、模糊匹配文档名、向量搜索内容
    - 返回匹配内容片段并高亮搜索词
    """
    if not q or not q.strip():
        raise HTTPException(status_code=400, detail="搜索关键词不能为空")

    logger.info(f"🔍 开始搜索文档: q={q}")

    try:
        search_results = document_service.search_documents(db, q, owner_id=None)
        logger.info(f"🔍 搜索完成，找到 {len(search_results)} 个文档")

        result = []
        for item in search_results:
            try:
                doc = item['document']
                doc_dict = model_to_dict(doc)
                doc_dict['match_content'] = item.get('match_content')
                doc_dict['match_distance'] = item.get('match_distance')
                doc_dict['match_type'] = item.get('match_type')

                # 如果有匹配内容，进行关键词高亮处理
                if doc_dict['match_content']:
                    content = doc_dict['match_content']
                    # 截取匹配内容片段（保留搜索词所在位置及其前后各50个字符）
                    q_len = len(q)
                    idx = content.find(q)
                    if idx != -1:
                        start = max(0, idx - 50)
                        end = min(len(content), idx + q_len + 50)
                        snippet = content[start:end]
                        if start > 0:
                            snippet = "..." + snippet
                        if end < len(content):
                            snippet = snippet + "..."
                        doc_dict['match_snippet'] = snippet
                    else:
                        doc_dict['match_snippet'] = content[:100] + "..." if len(content) > 100 else content

                    # 高亮处理：替换搜索词为带高亮标记的版本（用于前端渲染）
                    highlighted = content.replace(q, f"<mark>{q}</mark>")
                    doc_dict['highlighted_content'] = highlighted

                    # 添加跳转信息
                    doc_dict['match_chapter_title'] = item.get('chapter_title', '')
                    doc_dict['match_chapter_order'] = item.get('chapter_order')
                    doc_dict['match_category'] = item.get('category', '')

                result.append(doc_dict)
            except Exception as e:
                logger.error(f"转换文档失败: {e}, doc_id={doc.id if hasattr(doc, 'id') else 'unknown'}")
                continue

        return result
    except Exception as e:
        logger.error(f"搜索失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"搜索失败: {str(e)}")


@router.get("/{document_id}", response_model=dict)
async def get_document(
    document_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取文档详情"""
    document = document_service.get_document(db, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档未找到")

    # 检查权限：所有者可以访问，公开文档登录用户也可以访问
    if document.owner_id != token_data.user_id and not document.is_public:
        raise HTTPException(status_code=403, detail="无权访问此文档")

    chapters = document_service.get_chapters(db, document_id)
    chapters_data = [model_to_dict(ch) for ch in chapters]

    doc_data = model_to_dict(document)
    doc_data['chapters'] = chapters_data

    return doc_data


@router.get("/{document_id}/chapters", response_model=List[dict])
async def get_document_chapters(
    document_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取文档的所有章节"""
    document = document_service.get_document(db, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档未找到")
    if document.owner_id != token_data.user_id and not document.is_public:
        raise HTTPException(status_code=403, detail="无权访问此文档")

    chapters = document_service.get_chapters(db, document_id)
    return [model_to_dict(ch) for ch in chapters]


@router.get("/{document_id}/content", response_model=dict)
async def get_document_full_content(
    document_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取文档完整内容"""
    document = document_service.get_document(db, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档未找到")
    if document.owner_id != token_data.user_id and not document.is_public:
        raise HTTPException(status_code=403, detail="无权访问此文档")

    content = document_service.get_full_content(db, document_id)
    return {"success": True, "content": content}


@router.get("/chapters/{chapter_id}", response_model=dict)
async def get_chapter(
    chapter_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取单个章节"""
    chapter = document_service.get_chapter(db, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节未找到")

    document = document_service.get_document(db, chapter.document_id)
    if document and document.owner_id != token_data.user_id and not document.is_public:
        raise HTTPException(status_code=403, detail="无权访问此文档")

    document_service.update_last_read_chapter(db, chapter.document_id, chapter_id)

    return model_to_dict(chapter)


@router.post("/{document_id}/chapters/merge", response_model=dict)
async def merge_chapters(
    document_id: int,
    request: ChapterMergeRequest,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """合并多个章节为一个"""
    document = document_service.get_document(db, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档未找到")
    if document.owner_id != token_data.user_id:
        raise HTTPException(status_code=403, detail="无权访问此文档")

    try:
        result = document_service.merge_chapters(db, document_id, request.chapter_ids, request.new_title)
        return {"success": True, "data": result}
    except Exception as e:
        logger.error(f"合并章节失败: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{document_id}/chapters/split", response_model=dict)
async def split_chapter(
    document_id: int,
    request: ChapterSplitRequest,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """分割一个章节为多个"""
    document = document_service.get_document(db, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档未找到")
    if document.owner_id != token_data.user_id:
        raise HTTPException(status_code=403, detail="无权访问此文档")

    try:
        result = document_service.split_chapter(
            db, document_id, request.chapter_id,
            request.split_points, request.new_titles
        )
        return {"success": True, "data": result}
    except Exception as e:
        logger.error(f"分割章节失败: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{document_id}/chapters/{chapter_id}", response_model=dict)
async def delete_chapter(
    document_id: int,
    chapter_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """删除单个章节"""
    document = document_service.get_document(db, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档未找到")
    if document.owner_id != token_data.user_id:
        raise HTTPException(status_code=403, detail="无权访问此文档")

    try:
        document_service.delete_single_chapter(db, document_id, chapter_id)
        return {"success": True, "message": "章节已删除"}
    except Exception as e:
        logger.error(f"删除章节失败: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/chapters/{chapter_id}/navigation", response_model=dict)
async def get_chapter_navigation(
    chapter_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取章节导航（上一章/下一章）"""
    chapter = document_service.get_chapter(db, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节未找到")

    document = document_service.get_document(db, chapter.document_id)
    if document and document.owner_id != token_data.user_id and not document.is_public:
        raise HTTPException(status_code=403, detail="无权访问此文档")

    nav = document_service.get_chapter_navigation(db, chapter_id)

    return {
        "success": True,
        "current": model_to_dict(nav["current"]) if nav["current"] else None,
        "previous": model_to_dict(nav["previous"]) if nav["previous"] else None,
        "next": model_to_dict(nav["next"]) if nav["next"] else None
    }


@router.delete("/{document_id}", response_model=dict)
async def delete_document(
    document_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """删除文档"""
    document = document_service.get_document(db, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档未找到")
    if document.owner_id != token_data.user_id:
        raise HTTPException(status_code=403, detail="无权访问此文档")

    success = document_service.delete_document(db, document_id)
    if not success:
        raise HTTPException(status_code=404, detail="文档未找到")

    return {"success": True, "message": "文档删除成功"}


@router.put("/{document_id}/last-read", response_model=dict)
async def update_last_read(
    document_id: int,
    chapter_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """更新最后阅读的章节"""
    document = document_service.get_document(db, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档未找到")
    if document.owner_id != token_data.user_id:
        raise HTTPException(status_code=403, detail="无权访问此文档")

    success = document_service.update_last_read_chapter(db, document_id, chapter_id)
    if not success:
        raise HTTPException(status_code=404, detail="文档或章节未找到")

    return {"success": True, "message": "阅读位置已更新"}


@router.put("/{document_id}/public", response_model=dict)
async def toggle_public_status(
    document_id: int,
    is_public: Optional[bool] = None,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """切换文档的公开/私密状态"""
    document = document_service.get_document(db, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档未找到")
    if document.owner_id != token_data.user_id:
        raise HTTPException(status_code=403, detail="无权访问此文档")

    # 如果指定了状态则使用指定值，否则切换当前状态
    if is_public is not None:
        document.is_public = is_public
    else:
        document.is_public = not document.is_public

    db.commit()
    db.refresh(document)

    # 更新知识图谱中 L1 节点的公开状态并重建 L3
    try:
        loop = asyncio.get_running_loop()
        kg_updated = await loop.run_in_executor(
            None, knowledge_graph_service.update_document_public_status,
            str(document_id), document.is_public,
        )
        l3_result = await knowledge_graph_service.incremental_update_l3(str(document_id))
        logger.info(f"知识图谱已更新: {kg_updated} 个节点, L3={l3_result}")
    except Exception as e:
        logger.warning(f"知识图谱公开状态更新失败: {e}")
        kg_updated = 0

    status_text = document.is_public and "公开" or "私密"
    logger.info(f"✅ 文档 {document_id} 已设置为 {status_text}")

    return {
        "success": True,
        "message": f"文档已设置为 {status_text}",
        "is_public": document.is_public,
        "kg_updated": kg_updated
    }


@router.post("/{document_id}/view", response_model=dict)
async def increment_view_count(
    document_id: int,
    db: Session = Depends(get_db)
):
    """增加文档浏览量（用于从首页链接点击时）"""
    document = document_service.get_document(db, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档未找到")

    # 增加浏览量
    document.view_count = (document.view_count or 0) + 1
    db.commit()
    db.refresh(document)

    return {
        "success": True,
        "view_count": document.view_count
    }


@router.get("/{document_id}/mindmap", response_model=dict)
async def get_mindmap(
    document_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取文档的思维导图"""
    document = document_service.get_document(db, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档未找到")

    # 检查权限：所有者可以访问，公开文档登录用户也可以访问
    if document.owner_id != token_data.user_id and not document.is_public:
        raise HTTPException(status_code=403, detail="无权访问此文档")

    mindmap = document_service.get_mindmap(db, document_id)
    if not mindmap:
        return {"success": False, "message": "思维导图未生成", "status": "not_generated", "data": None}

    return {
        "success": True,
        "message": "获取思维导图成功",
        "status": mindmap.status,
        "data": mindmap.data if mindmap.status == "completed" else None
    }


@router.post("/{document_id}/mindmap/generate", response_model=dict)
async def generate_mindmap(
    document_id: int,
    background_tasks: BackgroundTasks,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
    body: MindmapGenerateRequest = Body(default=MindmapGenerateRequest())
):
    """生成文档的思维导图"""
    document = document_service.get_document(db, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档未找到")

    # 检查权限：所有者可以访问，公开文档登录用户也可以访问
    if document.owner_id != token_data.user_id and not document.is_public:
        raise HTTPException(status_code=403, detail="无权访问此文档")

    if document.status != DocumentStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="文档尚未解析完成，无法生成思维导图")

    # 检查是否已经存在思维导图
    existing_mindmap = document_service.get_mindmap(db, document_id)
    if existing_mindmap:
        return {
            "success": True,
            "message": "思维导图已存在",
            "data": existing_mindmap.data
        }

    # 启动后台任务生成思维导图
    background_tasks.add_task(document_service.generate_mindmap, db, document_id, model=body.model)

    return {
        "success": True,
        "message": "思维导图生成任务已启动，稍后刷新查看"
    }


@router.post("/{document_id}/mindmap/regenerate", response_model=dict)
async def regenerate_mindmap(
    document_id: int,
    background_tasks: BackgroundTasks,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
    body: MindmapGenerateRequest = Body(default=MindmapGenerateRequest())
):
    """重新生成文档的思维导图"""
    document = document_service.get_document(db, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档未找到")

    # 检查权限：只有所有者可以重新生成
    if document.owner_id != token_data.user_id:
        raise HTTPException(status_code=403, detail="无权执行此操作")

    if document.status != DocumentStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="文档尚未解析完成，无法生成思维导图")

    # 启动后台任务重新生成思维导图
    background_tasks.add_task(document_service.generate_mindmap, db, document_id, regenerate=True, model=body.model)

    return {
        "success": True,
        "message": "思维导图重新生成任务已启动，稍后刷新查看"
    }


async def _images_to_pdf_volumes(images: List[bytes], output_dir: str) -> List[str]:
    """将图片列表转为 PDF 文件，超过 300 页或 190MB 则分卷。
    返回 PDF 文件路径列表。"""
    from fpdf import FPDF
    from PIL import Image as PILImage
    import io

    MAX_PAGES = 300
    MAX_SIZE = 190 * 1024 * 1024

    volumes = []
    current_pages = 0
    vol_idx = 1
    pdf = FPDF(unit="mm", format="A4")
    pdf.set_auto_page_break(auto=False)

    for img_bytes in images:
        try:
            img = PILImage.open(io.BytesIO(img_bytes)).convert("RGB")
            w_mm, h_mm = img.width * 0.2646, img.height * 0.2646
            pw, ph = 210, 297
            scale = min(pw / w_mm, ph / h_mm)
            fw, fh = w_mm * scale, h_mm * scale
            x, y = (pw - fw) / 2, (ph - fh) / 2

            pdf.add_page()
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
                img.save(tmp.name, "JPEG", quality=85)
                pdf.image(tmp.name, x=x, y=y, w=fw, h=fh)
                os.unlink(tmp.name)

            current_pages += 1

            # 检查是否需要分卷
            if current_pages >= MAX_PAGES:
                vol_path = os.path.join(output_dir, f"photos_{vol_idx}.pdf")
                pdf.output(vol_path)
                file_size = os.path.getsize(vol_path)
                if file_size > MAX_SIZE:
                    logger.warning(f"PDF 分卷 {vol_idx} 超过 190MB ({file_size / 1024 / 1024:.1f}MB)")
                volumes.append(vol_path)
                pdf = FPDF(unit="mm", format="A4")
                pdf.set_auto_page_break(auto=False)
                current_pages = 0
                vol_idx += 1
        except Exception as e:
            logger.warning(f"图片处理失败，跳过: {e}")

    # 最后一卷
    if current_pages > 0:
        vol_path = os.path.join(output_dir, f"photos_{vol_idx}.pdf")
        pdf.output(vol_path)
        volumes.append(vol_path)

    return volumes


@router.post("/upload-photos", response_model=dict)
async def upload_photos(
    files: List[UploadFile] = File(...),
    title: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    is_public: Optional[bool] = Form(False),
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    """上传多张照片，转为 PDF 后经 SoMark 解析存入文档"""
    from app.services.somark_request_manager import somark_request_manager
    from app.services.document_parser import StructureAnalyzer, ParsedChapter
    from app.schemas.document import DocumentCreate

    if not files:
        raise HTTPException(status_code=400, detail="请至少上传一张照片")

    allowed = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}
    valid_images = []
    for f in files:
        if f.content_type and f.content_type in allowed:
            valid_images.append(await f.read())
        else:
            logger.warning(f"跳过不支持的文件: {f.filename} ({f.content_type})")

    if not valid_images:
        raise HTTPException(status_code=400, detail="没有有效的图片文件")

    # 创建文档记录
    doc_title = title or f"{len(valid_images)}张照片"
    file_content = valid_images[0]  # 占位
    document = document_service.create_document(
        db=db, title=doc_title, filename=f"{doc_title}.photos",
        file_content=file_content, file_type="pdf",
        owner_id=token_data.user_id, category=category,
    )
    document.is_public = is_public
    document.status = DocumentStatus.PARSING
    db.commit()

    # 照片转 PDF
    output_dir = "/uploads/photos_pdf"
    os.makedirs(output_dir, exist_ok=True)
    pdf_paths = await _images_to_pdf_volumes(valid_images, output_dir)

    if not pdf_paths:
        document.status = DocumentStatus.FAILED
        document.error_message = "照片转 PDF 失败"
        db.commit()
        raise HTTPException(status_code=500, detail="照片转 PDF 失败")

    # 并发 SoMark 解析
    somark_results = []
    async def parse_one(path: str):
        try:
            result = await somark_request_manager.parse_document(file_path=path)
            return result
        except Exception as e:
            logger.error(f"SoMark 解析失败 {path}: {e}")
            return None

    tasks = [parse_one(p) for p in pdf_paths]
    results = await asyncio.gather(*tasks)

    # 合并所有 SoMark 结果
    all_blocks = []
    for result in results:
        if result is None:
            continue
        blocks, _ = document_service._extract_somark_result(result)
        if blocks:
            all_blocks.extend(blocks)

    if not all_blocks:
        document.status = DocumentStatus.FAILED
        document.error_message = "SoMark 解析结果为空"
        db.commit()
        raise HTTPException(status_code=500, detail="图片解析失败")

    # 使用二次规则解析合并结果
    import httpx
    image_dir = "/uploads/tables"
    os.makedirs(image_dir, exist_ok=True)
    images_info = []
    img_counter = [0]
    img_map = {}

    async with httpx.AsyncClient(timeout=30) as client:
        for b in all_blocks:
            img_url = b.get("img_url", "")
            if img_url and img_url not in img_map:
                img_counter[0] += 1
                try:
                    resp = await client.get(img_url)
                    if resp.status_code == 200:
                        ext = ".png"
                        ct = resp.headers.get("content-type", "")
                        if "jpeg" in ct or "jpg" in ct:
                            ext = ".jpg"
                        img_name = f"somark_p{img_counter[0]}{ext}"
                        img_path = os.path.join(image_dir, img_name)
                        with open(img_path, "wb") as f:
                            f.write(resp.content)
                        placeholder = f"[IMG_PLACEHOLDER_0_{img_counter[0]}]"
                        images_info.append({"placeholder": placeholder, "path": img_path})
                        img_map[img_url] = placeholder
                except Exception as img_e:
                    logger.warning(f"SoMark 图片下载失败: {img_url} - {img_e}")

    # 合并所有区块文本
    full_parts = []
    for b in all_blocks:
        txt = b.get("content", "").strip()
        img_url = b.get("img_url", "")
        btype = b.get("type", "")
        pl = img_map.get(img_url, "")
        if pl:
            full_parts.append(pl)
        elif btype == "table" and txt:
            full_parts.append(f"[表格开始]\n{txt}\n[表格结束]")
        elif txt:
            full_parts.append(txt)

    full_text = "\n\n".join(full_parts)

    # 二次规则解析：遍历所有结果 -> 章节
    chapters = StructureAnalyzer.analyze_structure(full_text)
    if not chapters:
        chapters = [ParsedChapter(
            title=doc_title, content=full_text,
            level=1, order_index=0,
            start_offset=0, end_offset=len(full_text),
        )]

    if images_info and chapters:
        chapters = document_service._replace_image_placeholders(chapters, images_info)

    document_service._delete_chapters(db, document.id)
    document_service._save_chapters(db, document.id, chapters, use_ai=True)

    # 导入向量数据库
    try:
        from app.services.vector_db_service import vector_db_service, VECTOR_DB_AVAILABLE
        if VECTOR_DB_AVAILABLE and vector_db_service:
            vector_db_service.delete_by_document_id(document.id)
        document_service._import_to_vector_db(db, document.id)
    except Exception as e:
        logger.warning(f"向量数据库导入失败: {e}")

    # 后台触发知识图谱构建
    try:
        document_service._submit_kg_build(db, document.id, document.is_public)
        logger.info(f"照片上传后知识图谱构建任务已提交: {document.id}")
    except Exception as e:
        logger.warning(f"照片上传后知识图谱构建提交失败: {e}")

    document.error_message = None
    db.commit()

    # 清理临时 PDF
    for p in pdf_paths:
        try:
            os.unlink(p)
        except Exception:
            pass

    return {
        "success": True,
        "document_id": document.id,
        "total_images": len(valid_images),
        "total_volumes": len(pdf_paths),
        "message": f"{len(valid_images)} 张照片上传并解析完成",
    }


# ── 文档原文件预览（LibreOffice 转图片）──

import hashlib
import glob as glob_mod
import shutil

CONVERTED_DIR = os.environ.get("CONVERTED_DIR", "/uploads/converted")

class PreviewRequest(BaseModel):
    file_path: str

@router.post("/preview", response_model=dict)
async def preview_document(req: PreviewRequest):
    file_path = os.path.normpath(req.file_path)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="文件不存在")

    ext = os.path.splitext(file_path)[1].lower()
    basename = os.path.basename(file_path)

    file_hash = hashlib.md5(open(file_path, "rb").read()).hexdigest()
    cache_dir = os.path.join(CONVERTED_DIR, file_hash)

    # 已缓存则直接返回
    if os.path.isdir(cache_dir):
        cached = sorted(glob_mod.glob(os.path.join(cache_dir, "*.png")))
        if cached:
            urls = [f"/uploads/converted/{file_hash}/{os.path.basename(p)}" for p in cached]
            return {"type": "image", "pages": urls, "cached": True}

    # PDF: iframe 直显
    if ext == ".pdf":
        url = f"/uploads/{basename}" if file_path.startswith("/uploads") else file_path
        return {"type": "pdf", "url": url}

    # TXT/CSV/MD: 直接返回文本
    if ext in (".txt", ".csv", ".md"):
        try:
            content = open(file_path, "r", encoding="utf-8").read()
        except:
            content = open(file_path, "r", encoding="gbk").read()
        return {"type": "text", "content": content, "filename": basename}

    # 图片: 直接返回
    if ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"):
        url = f"/uploads/{basename}" if file_path.startswith("/uploads") else file_path
        return {"type": "image", "pages": [url]}

    # Office 文档: LibreOffice 转图片 (async subprocess 不阻塞主线程)
    os.makedirs(cache_dir, exist_ok=True)

    try:
        proc = await asyncio.create_subprocess_exec(
            "libreoffice", "--headless", "--convert-to", "png",
            f"--outdir", cache_dir,
            file_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60.0)
        if proc.returncode != 0:
            err = stderr.decode("utf-8", errors="replace")[:200]
            logger.error(f"LibreOffice 转换失败: {err}")
            shutil.rmtree(cache_dir, ignore_errors=True)
            raise HTTPException(status_code=500, detail="文档转换失败，请确认文件格式正确")

        pages = sorted(glob_mod.glob(os.path.join(cache_dir, "*.png")))
        if not pages:
            shutil.rmtree(cache_dir, ignore_errors=True)
            raise HTTPException(status_code=500, detail="文档转换后无输出图片")

        urls = [f"/uploads/converted/{file_hash}/{os.path.basename(p)}" for p in pages]
        return {"type": "image", "pages": urls, "cached": False}

    except asyncio.TimeoutError:
        try: proc.kill()
        except: pass
        shutil.rmtree(cache_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail="文档转换超时，请尝试较小的文件")
    except HTTPException:
        raise
    except Exception as e:
        shutil.rmtree(cache_dir, ignore_errors=True)
        logger.error(f"文档预览转换异常: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"文档转换异常: {str(e)}")
