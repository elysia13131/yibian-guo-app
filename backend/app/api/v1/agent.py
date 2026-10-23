"""Agent REST API 端点"""
from pathlib import Path
from typing import Optional
from datetime import datetime, timedelta
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import SessionLocal, get_db
from app.api.v1.auth import get_current_user_dep
from app.models.agent import Agent as AgentModel, ExpertTask
from app.models.agent import TaskContext, SessionMessage, WorkflowLog, AgentFeedback
from app.schemas.user import TokenData
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/agent", tags=["agent"])


def cleanup_old_tasks(user_id: int):
    """清理超过15天的任务记录"""
    db = SessionLocal()
    try:
        cutoff = datetime.now() - timedelta(days=15)
        old_tasks = (
            db.query(ExpertTask)
            .filter(ExpertTask.user_id == user_id, ExpertTask.started_at < cutoff)
            .all()
        )
        for task in old_tasks:
            from app.models.agent import ArtifactRecord
            for a in db.query(ArtifactRecord).filter(ArtifactRecord.task_id == task.id).all():
                if a.path:
                    try:
                        p = Path(a.path)
                        if p.exists():
                            p.unlink()
                    except Exception:
                        pass
            db.query(ArtifactRecord).filter(ArtifactRecord.task_id == task.id).delete()
            db.query(TaskContext).filter(TaskContext.task_id == task.id).delete()
            db.query(SessionMessage).filter(SessionMessage.task_id == task.id).delete()
            db.query(WorkflowLog).filter(WorkflowLog.task_id == task.id).delete()
            db.query(AgentFeedback).filter(AgentFeedback.task_id == task.id).delete()
            db.delete(task)
        if old_tasks:
            db.commit()
            logger.info(f"已清理用户 {user_id} 的 {len(old_tasks)} 条过期任务及其产物")
    except Exception as e:
        logger.warning(f"清理过期任务失败: {e}")
    finally:
        db.close()

router = APIRouter(prefix="/api/v1/agent", tags=["agent"])


@router.get("/agents")
async def list_agents(
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    agents = db.query(AgentModel).filter(AgentModel.is_active == True).all()
    return [
        {"id": a.id, "name": a.name, "role_desc": a.role_desc,
         "icon": a.icon, "phase": a.phase, "tools": a.tools}
        for a in agents
    ]


@router.get("/tasks")
async def list_tasks(
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    tasks = (
        db.query(ExpertTask)
        .filter(ExpertTask.user_id == token_data.user_id)
        .order_by(ExpertTask.started_at.desc())
        .all()
    )
    return [
        {"id": t.id, "query": t.query, "status": t.status,
         "summary": t.summary,
         "started_at": str(t.started_at),
         "completed_at": str(t.completed_at) if t.completed_at else None}
        for t in tasks
    ]


@router.get("/tasks/{task_id}")
async def get_task(
    task_id: str,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    task = (
        db.query(ExpertTask)
        .filter(ExpertTask.id == task_id, ExpertTask.user_id == token_data.user_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {
        "id": task.id, "query": task.query, "todo_list": task.todo_list,
        "status": task.status, "summary": task.summary,
        "error_message": task.error_message,
        "started_at": str(task.started_at),
        "completed_at": str(task.completed_at) if task.completed_at else None,
    }


@router.post("/tasks/{task_id}/abort")
async def abort_task(
    task_id: str,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    task = (
        db.query(ExpertTask)
        .filter(ExpertTask.id == task_id, ExpertTask.user_id == token_data.user_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {"message": "请通过 WebSocket 发送 {'action':'abort'} 来中断任务"}


@router.delete("/tasks/{task_id}")
async def delete_task(
    task_id: str,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    from app.models.agent import TaskContext, SessionMessage, WorkflowLog, AgentFeedback, ArtifactRecord

    task = (
        db.query(ExpertTask)
        .filter(ExpertTask.id == task_id, ExpertTask.user_id == token_data.user_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    # 先查出所有产物文件路径再删除
    artifact_records = db.query(ArtifactRecord).filter(ArtifactRecord.task_id == task_id).all()
    for a in artifact_records:
        if a.path:
            try:
                p = Path(a.path)
                if p.exists():
                    p.unlink()
                    logger.info(f"已删除产物文件: {a.path}")
            except Exception as e:
                logger.warning(f"产物文件删除失败: {a.path} - {e}")

    db.query(ArtifactRecord).filter(ArtifactRecord.task_id == task_id).delete()
    db.query(TaskContext).filter(TaskContext.task_id == task_id).delete()
    db.query(SessionMessage).filter(SessionMessage.task_id == task_id).delete()
    db.query(WorkflowLog).filter(WorkflowLog.task_id == task_id).delete()
    db.query(AgentFeedback).filter(AgentFeedback.task_id == task_id).delete()
    db.delete(task)
    db.commit()
    return {"message": "任务已删除"}


@router.get("/session")
async def get_session(
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    from app.models.agent import UserAgentSession
    session = (
        db.query(UserAgentSession)
        .filter(UserAgentSession.user_id == token_data.user_id)
        .first()
    )
    if not session:
        session = UserAgentSession(user_id=token_data.user_id, context_json={})
        db.add(session)
        db.commit()
    return {"context_json": session.context_json}


@router.delete("/session")
async def clear_session(
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    from app.models.agent import UserAgentSession
    session = (
        db.query(UserAgentSession)
        .filter(UserAgentSession.user_id == token_data.user_id)
        .first()
    )
    if session:
        session.context_json = {}
        db.commit()
    return {"message": "会话上下文已清除"}


@router.get("/tasks/{task_id}/messages")
async def get_task_messages(
    task_id: str,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    from app.models.agent import SessionMessage
    task = (
        db.query(ExpertTask)
        .filter(ExpertTask.id == task_id, ExpertTask.user_id == token_data.user_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    messages = (
        db.query(SessionMessage)
        .filter(SessionMessage.task_id == task_id)
        .order_by(SessionMessage.created_at.asc())
        .all()
    )
    return [
        {
            "id": m.id, "from_agent": m.from_agent, "to_agent": m.to_agent,
            "phase": m.phase, "type": m.type, "content": m.content,
            "tools_called": m.tools_called, "created_at": str(m.created_at),
        }
        for m in messages
    ]


class FeedbackRequest(BaseModel):
    rating: int
    feedback_text: Optional[str] = None


@router.post("/tasks/{task_id}/feedback")
async def submit_feedback(
    task_id: str,
    body: FeedbackRequest,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    from app.models.agent import AgentFeedback, ExpertTask
    task = db.query(ExpertTask).filter(
        ExpertTask.id == task_id, ExpertTask.user_id == token_data.user_id
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    feedback = AgentFeedback(
        task_id=task_id, user_id=token_data.user_id,
        rating=body.rating, feedback_text=body.feedback_text,
    )
    db.add(feedback)
    db.commit()
    return {"message": "感谢反馈"}


@router.get("/tasks/{task_id}/artifacts")
async def get_task_artifacts(
    task_id: str,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    from app.models.agent import ArtifactRecord
    task = (
        db.query(ExpertTask)
        .filter(ExpertTask.id == task_id, ExpertTask.user_id == token_data.user_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    artifacts = (
        db.query(ArtifactRecord)
        .filter(ArtifactRecord.task_id == task_id)
        .order_by(ArtifactRecord.created_at.asc())
        .all()
    )
    return [
        {
            "id": a.id,
            "artifact_type": a.artifact_type,
            "path": a.path,
            "title": a.title,
            "filename": a.filename,
            "created_at": str(a.created_at),
            "expires_at": str(a.expires_at) if a.expires_at else None,
        }
        for a in artifacts
    ]


@router.get("/skills")
async def list_skills():
    from app.services.agent_skills import skill_registry
    return skill_registry.list_skills()


@router.post("/skills/{skill_name}/execute")
async def execute_skill(
    skill_name: str,
    body: dict = {},
):
    from app.services.agent_skills import skill_registry
    try:
        result = await skill_registry.execute(skill_name, body)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/skills/{skill_name}/result")
async def get_skill_result(skill_name: str):
    from app.services.agent_skills import skill_registry
    result = await skill_registry.get_persisted_result(skill_name)
    if result is None:
        raise HTTPException(status_code=404, detail="该技能尚未执行过")
    return result
