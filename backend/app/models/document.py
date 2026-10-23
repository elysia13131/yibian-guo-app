from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Enum, Boolean, Float
from datetime import datetime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base
import enum


class DocumentStatus(str, enum.Enum):
    """文档解析状态"""
    WAITING = "waiting"
    PARSING = "parsing"
    COMPLETED = "completed"
    FAILED = "failed"


class DocumentType(str, enum.Enum):
    """文档类型"""
    PDF = "pdf"
    DOCX = "docx"
    TXT = "txt"
    MD = "md"


class Document(Base):
    """文档主表"""
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(500), nullable=False, comment="文档标题")
    filename = Column(String(500), nullable=False, comment="原始文件名")
    file_path = Column(String(1000), nullable=False, comment="文件存储路径")
    file_type = Column(String(20), nullable=False, comment="文件类型")
    file_size = Column(Integer, nullable=True, comment="文件大小(字节)")
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True, comment="所属用户ID")
    category = Column(String(200), nullable=True, comment="学科分类")
    is_public = Column(Boolean, default=False, nullable=False, comment="是否公开")
    content_hash = Column(String(64), nullable=True, comment="文件内容MD5哈希")
    view_count = Column(Integer, default=0, nullable=False, comment="浏览量")

    status = Column(String(50), default=DocumentStatus.WAITING, nullable=False, comment="解析状态")
    error_message = Column(Text, nullable=True, comment="解析错误信息")

    created_at = Column(DateTime(timezone=True), default=datetime.now, comment="创建时间")
    updated_at = Column(DateTime(timezone=True), nullable=True, comment="更新时间")
    parsed_at = Column(DateTime(timezone=True), nullable=True, comment="解析完成时间")

    last_read_chapter_id = Column(Integer, ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True, comment="最后阅读章节")

    chapters = relationship("Chapter", back_populates="document", cascade="all, delete-orphan", foreign_keys="Chapter.document_id")
    last_read_chapter = relationship("Chapter", foreign_keys=[last_read_chapter_id])
    reading_sessions = relationship("ReadingSession", back_populates="document", cascade="all, delete-orphan")
    flashcards = relationship("Flashcard", back_populates="document", cascade="all, delete-orphan")
    mind_map = relationship("MindMap", back_populates="document", uselist=False, cascade="all, delete-orphan")
    owner = relationship("User", back_populates="documents")


class Chapter(Base):
    """章节表"""
    __tablename__ = "chapters"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, comment="所属文档ID")

    title = Column(String(500), nullable=True, comment="章节标题")
    content = Column(Text, nullable=False, comment="章节内容")
    level = Column(Integer, default=1, comment="层级(1-3)")
    order_index = Column(Integer, default=0, comment="顺序位置")
    parent_id = Column(Integer, ForeignKey("chapters.id"), nullable=True, comment="父章节ID")

    start_offset = Column(Integer, nullable=True, comment="在原文档中的起始偏移")
    end_offset = Column(Integer, nullable=True, comment="在原文档中的结束偏移")

    created_at = Column(DateTime(timezone=True), default=datetime.now, comment="创建时间")

    document = relationship("Document", back_populates="chapters", foreign_keys=[document_id])
    parent = relationship("Chapter", remote_side=[id], foreign_keys=[parent_id])
    children = relationship("Chapter", back_populates="parent", cascade="all, delete-orphan")
    reading_records = relationship("ReadingRecord", back_populates="chapter", cascade="all, delete-orphan")


class ReadingSession(Base):
    """阅读会话表 - 记录每次打开文档的会话"""
    __tablename__ = "reading_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, comment="用户ID")
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, comment="文档ID")
    start_time = Column(DateTime(timezone=True), default=datetime.now, comment="开始时间")
    end_time = Column(DateTime(timezone=True), nullable=True, comment="结束时间")
    total_duration = Column(Integer, default=0, comment="总时长(秒)")

    user = relationship("User", back_populates="reading_sessions")
    document = relationship("Document", back_populates="reading_sessions")
    reading_records = relationship("ReadingRecord", back_populates="session", cascade="all, delete-orphan")


class ReadingRecord(Base):
    """阅读记录表 - 记录每个章节的阅读情况"""
    __tablename__ = "reading_records"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("reading_sessions.id"), nullable=False, comment="会话ID")
    chapter_id = Column(Integer, ForeignKey("chapters.id"), nullable=False, comment="章节ID")
    start_time = Column(DateTime(timezone=True), default=datetime.now, comment="开始时间")
    end_time = Column(DateTime(timezone=True), nullable=True, comment="结束时间")
    duration = Column(Integer, default=0, comment="阅读时长(秒)")
    is_completed = Column(Boolean, default=False, comment="是否已读完")
    progress = Column(Float, default=0, comment="阅读进度(0-100)")

    session = relationship("ReadingSession", back_populates="reading_records")
    chapter = relationship("Chapter", back_populates="reading_records")


class MindMap(Base):
    """思维导图表 - 存储文档的思维导图数据"""
    __tablename__ = "mind_maps"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, unique=True, comment="所属文档ID")
    name = Column(String(500), nullable=False, comment="思维导图名称")
    data = Column(Text, nullable=False, comment="思维导图JSON数据")
    status = Column(String(50), default="completed", nullable=False, comment="生成状态")
    created_at = Column(DateTime(timezone=True), default=datetime.now, comment="创建时间")
    updated_at = Column(DateTime(timezone=True), nullable=True, comment="更新时间")

    document = relationship("Document", back_populates="mind_map")


class DailyStats(Base):
    """每日统计表 - 每日学习统计汇总"""
    __tablename__ = "daily_stats"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(String(10), nullable=False, unique=True, index=True, comment="日期(YYYY-MM-DD)")
    total_duration = Column(Integer, default=0, comment="总学习时长(秒)")
    chapters_read = Column(Integer, default=0, comment="阅读章节数")
    documents_accessed = Column(Integer, default=0, comment="访问文档数")
    created_at = Column(DateTime(timezone=True), default=datetime.now, comment="创建时间")
    updated_at = Column(DateTime(timezone=True), nullable=True, comment="更新时间")
