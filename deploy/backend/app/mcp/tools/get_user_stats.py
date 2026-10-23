import logging
from typing import Dict, Any
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


async def get_user_stats(params: Dict[str, Any]) -> str:
    """获取用户的学习统计数据。

    Args:
        params: {"user_id": int, "days": 30}
    """
    user_id = params.get("user_id")
    days = params.get("days", 30)

    from app.db.session import SessionLocal
    from app.models.statistics import DailyStats

    if not user_id:
        return "[错误] user_id 不能为空"

    db = SessionLocal()
    try:
        since = datetime.now() - timedelta(days=days)
        stats = db.query(DailyStats).filter(
            DailyStats.user_id == user_id,
            DailyStats.date >= since
        ).order_by(DailyStats.date.desc()).all()

        if not stats:
            return f"近 {days} 天无学习记录"

        total_time = sum(s.study_minutes or 0 for s in stats)
        total_cards = sum(s.reviewed_cards or 0 for s in stats)
        return (
            f"近 {days} 天学习统计：\n"
            f"- 学习天数: {len(stats)}\n"
            f"- 总学习时长: {total_time} 分钟\n"
            f"- 复习卡片: {total_cards} 张"
        )
    finally:
        db.close()
