from sqlalchemy import Column, Integer, String, DateTime, Boolean
from datetime import datetime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class User(Base):
    """用户表"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True, comment="邮箱")
    username = Column(String(100), nullable=False, comment="用户名")
    hashed_password = Column(String(255), nullable=False, comment="加密密码")
    is_active = Column(Boolean, default=True, comment="是否激活")
    player_title = Column(String(50), nullable=False, server_default='同学', default='同学', comment="AI角色对你的称呼")
    api_key = Column(String(200), nullable=True, comment="火山引擎 ARK API Key（AI生图用）")
    tts_api_key = Column(String(200), nullable=True, comment="火山引擎 TTS API Key（语音合成用）")
    deepseek_api_key = Column(String(200), nullable=True, comment="DeepSeek API Key")
    somark_api_key = Column(String(200), nullable=True, comment="SoMark API Key（文档解析）")
    is_verified = Column(Boolean, default=False, comment="邮箱是否验证")
    created_at = Column(DateTime(timezone=True), default=datetime.now, comment="创建时间")
    updated_at = Column(DateTime(timezone=True), nullable=True, comment="更新时间")

    # 关联关系
    documents = relationship("Document", back_populates="owner")
    reading_sessions = relationship("ReadingSession", back_populates="user")
    flashcards = relationship("Flashcard", back_populates="owner")
    flashcard_groups = relationship("CardGroup", back_populates="owner")