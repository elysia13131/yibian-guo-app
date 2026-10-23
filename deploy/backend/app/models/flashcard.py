from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Enum, Boolean, Float, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base
import enum
from datetime import datetime, timedelta


class FlashcardRating(str, enum.Enum):
    AGAIN = "again"
    HARD = "hard"
    GOOD = "good"
    EASY = "easy"


class FlashcardStatus(str, enum.Enum):
    NEW = "new"
    LEARNING = "learning"
    REVIEW = "review"
    SUSPENDED = "suspended"
    BURIED = "buried"


class GenerationTaskStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class GenerationTask(Base):
    """抽认卡生成任务"""
    __tablename__ = "flashcard_generation_tasks"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    group_id = Column(Integer, ForeignKey("flashcard_groups.id"), nullable=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    status = Column(String(50), default=GenerationTaskStatus.PENDING, nullable=False)
    total_chunks = Column(Integer, default=0)
    processed_chunks = Column(Integer, default=0)
    total_cards = Column(Integer, default=0)
    max_cards = Column(Integer, default=15)
    focus_text = Column(Text, nullable=True)
    is_public = Column(Boolean, default=False)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.now)
    updated_at = Column(DateTime(timezone=True), nullable=True)

    owner = relationship("User")
    group = relationship("CardGroup")
    document = relationship("Document")


class CardGroup(Base):
    """抽认卡卡片组"""
    __tablename__ = "flashcard_groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, comment="组名称")
    description = Column(Text, nullable=True, comment="组描述")
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=True, comment="关联文档ID")
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, comment="所属用户ID")
    card_count = Column(Integer, default=0, comment="卡片数量")
    is_public = Column(Boolean, default=False, comment="是否公开")
    created_at = Column(DateTime(timezone=True), default=datetime.now, comment="创建时间")
    updated_at = Column(DateTime(timezone=True), nullable=True, comment="更新时间")

    owner = relationship("User", back_populates="flashcard_groups")
    document = relationship("Document")
    flashcards = relationship("Flashcard", back_populates="card_group", cascade="all, delete-orphan")


class Flashcard(Base):
    """抽认卡主表"""
    __tablename__ = "flashcards"

    id = Column(Integer, primary_key=True, index=True)

    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, comment="所属文档ID")
    chapter_id = Column(Integer, ForeignKey("chapters.id"), nullable=True, comment="所属章节ID")
    group_id = Column(Integer, ForeignKey("flashcard_groups.id"), nullable=True, comment="所属卡片组ID")

    question = Column(Text, nullable=False, comment="问题")
    answer = Column(Text, nullable=False, comment="答案")
    
    # 选择题相关
    is_multiple_choice = Column(Boolean, default=False, comment="是否为选择题")
    is_multiple = Column(Boolean, default=False, comment="是否为多选题（多选）")
    options = Column(JSON, nullable=True, comment="选项 [{\"label\": \"A\", \"text\": \"选项内容\"}, ...]")
    correct_option_labels = Column(JSON, nullable=True, comment="正确选项标签列表（多选题） ['A', 'C']")
    correct_option_label = Column(String(10), nullable=True, comment="正确选项标签 (单选 A/B/C/D)")

    ai_generated = Column(Boolean, default=True, comment="是否由AI生成")
    source_text = Column(Text, nullable=True, comment="生成卡片的源文本片段")
    confidence = Column(Float, default=0.0, comment="AI生成置信度")

    difficulty = Column(Float, default=0.0, comment="难度 (D)")
    stability = Column(Float, default=0.0, comment="稳定性 (S)")
    retrievability = Column(Float, default=0.0, comment="可提取性 (R)")
    due = Column(DateTime(timezone=True), nullable=True, comment="到期时间")
    elapsed_days = Column(Float, default=0.0, comment="已过天数")
    scheduled_days = Column(Float, default=0.0, comment="计划天数")
    reps = Column(Integer, default=0, comment="复习次数")
    lapses = Column(Integer, default=0, comment="遗忘次数")

    status = Column(String(50), default=FlashcardStatus.NEW, nullable=False, comment="卡片状态")
    last_reviewed = Column(DateTime(timezone=True), nullable=True, comment="最后一次复习时间")
    next_review = Column(DateTime(timezone=True), nullable=True, comment="下次复习时间")

    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, comment="所属用户ID")
    is_public = Column(Boolean, default=False, comment="是否公开")

    created_at = Column(DateTime(timezone=True), default=datetime.now, comment="创建时间")
    updated_at = Column(DateTime(timezone=True), nullable=True, comment="更新时间")

    document = relationship("Document", back_populates="flashcards")
    chapter = relationship("Chapter")
    owner = relationship("User", back_populates="flashcards")
    review_logs = relationship("FlashcardReviewLog", back_populates="flashcard", cascade="all, delete-orphan")
    card_group = relationship("CardGroup", back_populates="flashcards")


class FlashcardReviewLog(Base):
    """抽认卡复习日志"""
    __tablename__ = "flashcard_review_logs"

    id = Column(Integer, primary_key=True, index=True)
    flashcard_id = Column(Integer, ForeignKey("flashcards.id"), nullable=False, comment="抽认卡ID")
    
    # 复习详情
    rating = Column(String(20), nullable=False, comment="评分 (again/hard/good/easy)")
    review_time = Column(DateTime(timezone=True), default=datetime.now, comment="复习时间")
    duration_seconds = Column(Float, default=0.0, comment="复习耗时（秒）")
    
    # 复习前后的FSRS参数
    difficulty_before = Column(Float, comment="复习前难度")
    stability_before = Column(Float, comment="复习前稳定性")
    retrievability_before = Column(Float, comment="复习前可提取性")
    difficulty_after = Column(Float, comment="复习后难度")
    stability_after = Column(Float, comment="复习后稳定性")
    retrievability_after = Column(Float, comment="复习后可提取性")
    
    # 时间间隔
    elapsed_days = Column(Float, comment="已过天数")
    scheduled_days = Column(Float, comment="计划天数")
    
    # 复习状态
    status_before = Column(String(50), comment="复习前状态")
    status_after = Column(String(50), comment="复习后状态")
    
    # 元数据
    ip_address = Column(String(45), nullable=True, comment="IP地址")
    user_agent = Column(String(500), nullable=True, comment="用户代理")

    # 关系
    flashcard = relationship("Flashcard", back_populates="review_logs")