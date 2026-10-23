"""feedback_optimizer Skill — 反馈统计 + Agent组合优化建议"""
import json
import logging
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List

from app.services.agent_skills import BaseSkill, skill_registry

logger = logging.getLogger(__name__)


def _extract_agent_combos(todo_list: list) -> List[str]:
    """从 todo_list 中提取所有 Agent 组合（按 assignees 排序 + 去重）"""
    combos = set()
    for todo in todo_list:
        assignees = todo.get("assignees", [])
        if len(assignees) > 0:
            combo = "+".join(sorted(assignees))
            combos.add(combo)
    return sorted(combos)


def _combo_to_names(combo: str) -> str:
    """将 agent_id 组合转为可读名称"""
    from app.services.agent_prompts import AGENT_DEFINITIONS
    name_map = {a["id"]: a.get("icon", "🤖") + a["name"] for a in AGENT_DEFINITIONS}
    ids = combo.split("+")
    return " + ".join(name_map.get(aid, aid) for aid in ids)


class FeedbackOptimizerSkill(BaseSkill):
    name = "feedback_optimizer"
    description = "分析所有用户的Agent反馈数据，统计哪些Agent组合获得的踩最多，返回优化建议"
    params_schema = {
        "min_samples": "int=3 (最少反馈样本数，低于此数的组合不纳入统计，默认3)",
        "days": "int=30 (回溯天数，默认30)",
    }

    async def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        min_samples = int(params.get("min_samples", 3))
        days = int(params.get("days", 30))

        from app.db.session import SessionLocal
        from app.models.agent import AgentFeedback, ExpertTask
        from sqlalchemy import func

        db = SessionLocal()
        try:
            cutoff = datetime.now() - timedelta(days=days)

            # 查询最近 N 天的反馈数据，关联 task 获取 todo_list
            rows = (
                db.query(AgentFeedback.rating, AgentFeedback.task_id, ExpertTask.todo_list)
                .join(ExpertTask, AgentFeedback.task_id == ExpertTask.id)
                .filter(AgentFeedback.created_at >= cutoff)
                .all()
            )

            if not rows:
                return {
                    "summary": f"近 {days} 天暂无反馈数据，无法生成优化建议",
                    "combo_stats": [],
                    "recommendations": [],
                    "total_feedbacks": 0,
                }

            # 按agent组合聚合
            combo_likes: Dict[str, int] = defaultdict(int)
            combo_dislikes: Dict[str, int] = defaultdict(int)
            combo_total: Dict[str, int] = defaultdict(int)
            combo_samples: Dict[str, int] = defaultdict(int)

            for rating, task_id, todo_list in rows:
                combos = _extract_agent_combos(todo_list or [])
                for combo in combos:
                    combo_total[combo] += rating  # 累加评分（1或-1）
                    if rating == 1:
                        combo_likes[combo] += 1
                    else:
                        combo_dislikes[combo] += 1
                    combo_samples[combo] += 1

            # 计算统计
            combo_stats = []
            for combo in sorted(combo_samples.keys()):
                n = combo_samples[combo]
                if n < min_samples:
                    continue
                likes = combo_likes.get(combo, 0)
                dislikes = combo_dislikes.get(combo, 0)
                satisfaction = (likes / n) * 100 if n > 0 else 0
                combo_stats.append({
                    "combo": combo,
                    "display_name": _combo_to_names(combo),
                    "samples": n,
                    "likes": likes,
                    "dislikes": dislikes,
                    "satisfaction_pct": round(satisfaction, 1),
                })

            combo_stats.sort(key=lambda x: x["satisfaction_pct"])

            # 生成推荐建议
            recommendations = []
            poor_combos = [c for c in combo_stats if c["satisfaction_pct"] < 50]
            good_combos = [c for c in combo_stats if c["satisfaction_pct"] >= 80]

            if poor_combos:
                for c in poor_combos[:3]:
                    recommendations.append(
                        f"⚠️ 避免组合 {c['display_name']}（满意度 {c['satisfaction_pct']}%，{c['dislikes']} 次踩）"
                    )
            if good_combos:
                for c in good_combos[:3]:
                    recommendations.append(
                        f"✅ 推荐组合 {c['display_name']}（满意度 {c['satisfaction_pct']}%，{c['likes']} 次赞）"
                    )

            if not recommendations:
                recommendations.append("ℹ️ 当前数据不足以形成明确建议，继续收集更多反馈")

            summary = (
                f"反馈分析完成：近 {days} 天共 {len(rows)} 条反馈，"
                f"覆盖 {len(combo_stats)} 种Agent组合。"
            )
            if poor_combos:
                summary += f" 低满意度组合 {len(poor_combos)} 个。"
            if good_combos:
                summary += f" 高满意度组合 {len(good_combos)} 个。"

            return {
                "summary": summary,
                "combo_stats": combo_stats,
                "recommendations": recommendations,
                "total_feedbacks": len(rows),
                "analyzed_at": datetime.now().isoformat(),
            }
        finally:
            db.close()


skill_registry.register(FeedbackOptimizerSkill())
