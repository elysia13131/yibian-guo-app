import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)


async def get_document(params: Dict[str, Any]) -> str:
    """获取指定文档的全文或指定章节内容。

    Args:
        params: {"document_id": int, "chapter_id": int | None}
    """
    document_id = params.get("document_id")
    chapter_id = params.get("chapter_id")

    from app.db.session import SessionLocal
    from app.models.document import Document, Chapter
    from app.services.document_service import document_service

    db = SessionLocal()
    try:
        if chapter_id:
            chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
            if not chapter:
                return "[错误] 章节不存在"
            return f"# {chapter.title or ''}\n\n{chapter.content}"

        if document_id:
            doc = db.query(Document).filter(Document.id == document_id).first()
            if not doc:
                return "[错误] 文档不存在"
            content = document_service.get_full_content(db, document_id)
            return f"# {doc.title}\n\n{content}"

        return "[错误] 请提供 document_id 或 chapter_id"
    finally:
        db.close()
