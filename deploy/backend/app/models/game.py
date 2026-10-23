from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON, Boolean, Enum as SAEnum
from sqlalchemy.orm import relationship
from app.db.base import Base
import enum
from datetime import datetime


class GameTaskStatus(str, enum.Enum):
    GENERATING = "generating"
    COMPLETED = "completed"
    FAILED = "failed"


class GameSave(Base):
    """游戏存档表"""
    __tablename__ = "game_saves"

    id = Column(Integer, primary_key=True, index=True)
    uid = Column(String(12), unique=True, nullable=True, comment="唯一分享标识")
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, comment="所属用户ID")
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=True, comment="关联文档ID")
    document_title = Column(String(500), nullable=False, comment="文档标题")
    parse_mode = Column(String(50), default="smart", comment="解析模式: normal/smart")
    status = Column(String(50), default=GameTaskStatus.GENERATING, nullable=False, comment="状态")
    sections = Column(JSON, nullable=True, comment="生成的剧情剧本")
    is_public = Column(Boolean, default=False, comment="是否公开可借阅")
    error_message = Column(Text, nullable=True, comment="错误信息")
    created_at = Column(DateTime(timezone=True), default=datetime.now, comment="创建时间")
    updated_at = Column(DateTime(timezone=True), nullable=True, comment="完成/更新时间")

    owner = relationship("User")
    document = relationship("Document")


class GameSaveBorrow(Base):
    """存档借阅记录表"""
    __tablename__ = "save_borrows"

    id = Column(Integer, primary_key=True, index=True)
    save_id = Column(Integer, ForeignKey("game_saves.id"), nullable=False, comment="被借阅的存档ID")
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, comment="借阅者用户ID")
    created_at = Column(DateTime(timezone=True), default=datetime.now, comment="借阅时间")

    save = relationship("GameSave")
    user = relationship("User")
