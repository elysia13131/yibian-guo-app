import enum
import uuid
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, JSON
from app.db.base import Base


def uuid4_str() -> str:
    return str(uuid.uuid4())


class TaskStatus(str, enum.Enum):
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


class Agent(Base):
    """子Agent注册表"""
    __tablename__ = "agents"

    id = Column(String(50), primary_key=True)
    name = Column(String(100), nullable=False)
    role_desc = Column(Text, nullable=False)
    system_prompt = Column(Text, nullable=False)
    tools = Column(JSON, nullable=True)
    icon = Column(String(10), nullable=True)
    phase = Column(Integer, default=1)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now)


class ExpertTask(Base):
    """一次任务记录"""
    __tablename__ = "expert_tasks"

    id = Column(String(36), primary_key=True, default=uuid4_str)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    query = Column(Text, nullable=False)
    todo_list = Column(JSON, nullable=False)
    status = Column(String(20), default=TaskStatus.IN_PROGRESS)
    summary = Column(Text, nullable=True)
    started_at = Column(DateTime, default=datetime.now)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)


class TaskContext(Base):
    """子Agent共享的一次性任务上下文（任务完成后归档）"""
    __tablename__ = "task_contexts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String(36), ForeignKey("expert_tasks.id"), unique=True, index=True)
    context_json = Column(JSON, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now)


class SessionMessage(Base):
    """所有消息日志"""
    __tablename__ = "session_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String(36), ForeignKey("expert_tasks.id"), index=True)
    from_agent = Column(String(50), nullable=False)
    to_agent = Column(String(50), nullable=True)
    phase = Column(String(20), nullable=True)
    type = Column(String(20), default="message")
    content = Column(Text, nullable=False)
    agent_raw = Column(Text, nullable=True)
    tools_called = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.now)


class UserAgentSession(Base):
    """主Agent与用户的长期会话（跨任务持久化）"""
    __tablename__ = "user_agent_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, index=True)
    context_json = Column(JSON, nullable=False, default=dict)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class WorkflowLog(Base):
    """流程可视化日志"""
    __tablename__ = "workflow_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String(36), ForeignKey("expert_tasks.id"), index=True)
    event_type = Column(String(30), nullable=True)
    payload = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.now)


class AgentFeedback(Base):
    """用户对 Agent 输出的反馈"""
    __tablename__ = "agent_feedbacks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String(36), ForeignKey("expert_tasks.id"), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    rating = Column(Integer, nullable=False)  # 1=赞, -1=踩
    feedback_text = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.now)


class SkillResult(Base):
    """Skill 执行结果持久化"""
    __tablename__ = "skill_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    skill_name = Column(String(100), nullable=False, unique=True, index=True)
    result_json = Column(JSON, nullable=False)
    summary = Column(Text, nullable=True)
    executed_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class ArtifactRecord(Base):
    """ToolAgent 生成的产物记录"""
    __tablename__ = "artifact_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String(36), ForeignKey("expert_tasks.id"), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    artifact_type = Column(String(20), nullable=False)
    path = Column(String(500), nullable=True)
    title = Column(String(200), nullable=True)
    filename = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    expires_at = Column(DateTime, nullable=True)
