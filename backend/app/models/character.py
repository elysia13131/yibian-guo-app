from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON, Boolean
from sqlalchemy.orm import relationship
from app.db.base import Base
from datetime import datetime


class GameCharacter(Base):
    """游戏角色表"""
    __tablename__ = "game_characters"

    id = Column(Integer, primary_key=True, index=True)
    uid = Column(String(12), unique=True, nullable=True, comment="唯一分享标识")
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, comment="所属用户ID")
    name = Column(String(100), nullable=False, comment="角色名称")
    description = Column(Text, nullable=True, comment="角色描述")
    portrait_url = Column(String(500), nullable=False, comment="立绘URL")
    prompt = Column(Text, nullable=False, comment="人设提示词")
    expressions = Column(JSON, nullable=True, comment="表情差分图片URL列表")
    expression_descriptions = Column(JSON, nullable=True, comment="表情描述列表")
    cg_images = Column(JSON, nullable=True, comment="结算CG图片URL列表")
    speaker_id = Column(String(100), nullable=True, comment="发布者自己的音色ID")
    voice_status = Column(String(20), nullable=True, comment="声音状态")
    voice_sample_url = Column(String(500), nullable=True, comment="音色克隆用的音频样本URL")
    is_public = Column(Boolean, default=False, comment="是否公开可借阅")
    is_default = Column(Boolean, default=False, comment="是否系统默认角色")
    created_at = Column(DateTime(timezone=True), default=datetime.now, comment="创建时间")
    updated_at = Column(DateTime(timezone=True), default=datetime.now, onupdate=datetime.now, comment="更新时间")

    owner = relationship("User")


class CharacterBorrow(Base):
    """角色借阅记录表"""
    __tablename__ = "character_borrows"

    id = Column(Integer, primary_key=True, index=True)
    character_id = Column(Integer, ForeignKey("game_characters.id"), nullable=False, comment="被借阅的角色ID")
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, comment="借阅者用户ID")
    speaker_id = Column(String(100), nullable=True, comment="借阅者自己的音色ID（可选）")
    created_at = Column(DateTime(timezone=True), default=datetime.now, comment="借阅时间")

    character = relationship("GameCharacter")
    user = relationship("User")
