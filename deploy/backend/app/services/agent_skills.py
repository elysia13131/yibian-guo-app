"""Skills 技能系统 — 可注册、可持久化、可扩展的能力单元"""
import json
import logging
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


class BaseSkill:
    """技能基类"""
    name: str = ""
    description: str = ""
    params_schema: Dict[str, str] = {}

    async def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError


class SkillRegistry:
    """技能注册中心"""

    def __init__(self):
        self._skills: Dict[str, BaseSkill] = {}

    def register(self, skill: BaseSkill):
        self._skills[skill.name] = skill
        logger.info(f"✅ 注册技能: {skill.name} — {skill.description}")

    def get(self, name: str) -> Optional[BaseSkill]:
        return self._skills.get(name)

    def list_skills(self) -> List[Dict[str, str]]:
        return [
            {"name": s.name, "description": s.description, "params_schema": s.params_schema}
            for s in self._skills.values()
        ]

    async def execute(self, name: str, params: Dict[str, Any]) -> Dict[str, Any]:
        skill = self.get(name)
        if not skill:
            raise ValueError(f"未知技能: {name}")
        result = await skill.execute(params)
        await self._persist(name, result)
        return result

    async def _persist(self, skill_name: str, result: Dict[str, Any]):
        """持久化技能执行结果"""
        try:
            from app.db.session import SessionLocal
            from app.models.agent import SkillResult
            db = SessionLocal()
            try:
                record = db.query(SkillResult).filter(
                    SkillResult.skill_name == skill_name
                ).first()
                if not record:
                    record = SkillResult(skill_name=skill_name, result_json={}, summary="")
                    db.add(record)
                record.result_json = result
                record.summary = result.get("summary", str(result)[:500])
                record.executed_at = datetime.now()
                db.commit()
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"持久化技能结果失败 [{skill_name}]: {e}")

    async def get_persisted_result(self, skill_name: str) -> Optional[Dict[str, Any]]:
        """读取最近一次持久化的执行结果"""
        try:
            from app.db.session import SessionLocal
            from app.models.agent import SkillResult
            db = SessionLocal()
            try:
                record = db.query(SkillResult).filter(
                    SkillResult.skill_name == skill_name
                ).first()
                if record:
                    return record.result_json
                return None
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"读取技能结果失败 [{skill_name}]: {e}")
            return None


skill_registry = SkillRegistry()
