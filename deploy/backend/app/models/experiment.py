from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON, Boolean, Enum as SAEnum
from sqlalchemy.orm import relationship
from app.db.base import Base
import enum
from datetime import datetime


class ExperimentStatus(str, enum.Enum):
    COLLECTING = "collecting"
    KNOWLEDGE_READY = "knowledge_ready"
    WRITING = "writing"
    PENDING_REVIEW = "pending_review"
    COMPLETED = "completed"
    FAILED = "failed"


class ExperimentReport(Base):
    """实验报告项目表"""
    __tablename__ = "experiment_reports"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, comment="所属用户ID")
    title = Column(String(500), nullable=False, comment="实验名称")
    sections_config = Column(JSON, nullable=True, comment="用户要求的报告章节列表")
    courseware_file_path = Column(String(500), nullable=True, comment="参考课件文件路径")
    courseware_filename = Column(String(200), nullable=True, comment="参考课件原始文件名")
    status = Column(SAEnum(ExperimentStatus), default=ExperimentStatus.COLLECTING, nullable=False, comment="状态")
    knowledge_base = Column(JSON, nullable=True, comment="第一阶段建立的知识库 JSON")
    draft_content = Column(JSON, nullable=True, comment="生成的草稿章节列表")
    chat_history = Column(JSON, nullable=True, comment="交互对话历史")
    error_message = Column(Text, nullable=True, comment="错误信息")
    created_at = Column(DateTime(timezone=True), default=datetime.now, comment="创建时间")
    updated_at = Column(DateTime(timezone=True), default=datetime.now, onupdate=datetime.now, comment="更新时间")

    owner = relationship("User")
