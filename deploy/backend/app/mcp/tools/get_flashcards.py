import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)


async def get_flashcards(params: Dict[str, Any]) -> str:
    """查询用户的抽认卡。

    Args:
        params: {"group_id": int | None, "status": str | None, "limit": 20}
    """
    group_id = params.get("group_id")
    status = params.get("status")
    limit = params.get("limit", 20)

    from app.db.session import SessionLocal
    from app.models.flashcard import Flashcard

    db = SessionLocal()
    try:
        query = db.query(Flashcard)
        if group_id:
            query = query.filter(Flashcard.group_id == group_id)
        if status:
            query = query.filter(Flashcard.status == status)
        cards = query.limit(limit).all()

        if not cards:
            return "未找到抽认卡"

        lines = [f"找到 {len(cards)} 张抽认卡："]
        for c in cards:
            lines.append(f"\n- 问题: {c.question}\n  答案: {c.answer}")
        return "\n".join(lines)
    finally:
        db.close()
