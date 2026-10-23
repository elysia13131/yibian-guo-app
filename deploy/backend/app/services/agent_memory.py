"""长期会话记忆服务 — 跨任务持久化上下文"""
import json
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class AgentMemory:
    """读写 UserAgentSession.context_json，管理记忆摘要"""

    KEY_USER_PROFILE = "user_profile"
    KEY_STRONG_AREAS = "strong_areas"
    KEY_WEAK_AREAS = "weak_areas"
    KEY_RECENT_QUERIES = "recent_queries"
    KEY_PREFERENCES = "preferences"

    @staticmethod
    async def load(user_id: int) -> dict:
        from app.models.agent import UserAgentSession
        from app.db.session import SessionLocal
        db = SessionLocal()
        try:
            session = db.query(UserAgentSession).filter(
                UserAgentSession.user_id == user_id
            ).first()
            if session and session.context_json:
                return session.context_json
            return {}
        finally:
            db.close()

    @staticmethod
    async def save(user_id: int, context: dict):
        from app.models.agent import UserAgentSession
        from app.db.session import SessionLocal
        db = SessionLocal()
        try:
            session = db.query(UserAgentSession).filter(
                UserAgentSession.user_id == user_id
            ).first()
            if not session:
                session = UserAgentSession(user_id=user_id, context_json={})
                db.add(session)
            session.context_json = context
            db.commit()
        finally:
            db.close()

    @staticmethod
    def build_full_context(context: dict) -> str:
        """构建用户上下文文本 — 画像 + 薄弱点 + 擅长领域（无对话历史）"""
        parts = []
        profile = context.get("user_profile", {})
        if profile:
            parts.append(f"## 用户信息\n{json.dumps(profile, ensure_ascii=False, indent=2)}")
        weak = context.get("weak_areas", [])
        if weak:
            parts.append(f"## 薄弱知识点\n{', '.join(weak)}")
        strong = context.get("strong_areas", [])
        if strong:
            parts.append(f"## 擅长领域\n{', '.join(strong)}")
        return "\n\n".join(parts) if parts else ""

    @staticmethod
    def build_profile_weak_context(context: dict) -> str:
        """仅用户画像 + 薄弱点（给 Planner）"""
        return AgentMemory.build_full_context(context)

    @staticmethod
    async def update_after_task(user_id: int, query: str, summary: str, context: dict):
        recent = context.setdefault("recent_queries", [])
        recent.append({
            "query": query,
            "summary": summary or "",
            "timestamp": datetime.now().isoformat(),
        })
        await AgentMemory.save(user_id, context)
