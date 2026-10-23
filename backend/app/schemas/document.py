from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime
from app.models.document import DocumentStatus, DocumentType


class ChapterBase(BaseModel):
    title: Optional[str] = None
    content: str
    level: int = 1
    order_index: int = 0
    parent_id: Optional[int] = None


class ChapterCreate(ChapterBase):
    document_id: int


class ChapterUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    order_index: Optional[int] = None


class Chapter(ChapterBase):
    id: int
    document_id: int
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None
    created_at: datetime
    children: List["Chapter"] = []

    model_config = ConfigDict(from_attributes=True)


Chapter.model_rebuild()


class DocumentBase(BaseModel):
    title: str
    filename: str
    file_type: str
    file_size: Optional[int] = None


class DocumentCreate(DocumentBase):
    file_path: str


class DocumentUpdate(BaseModel):
    title: Optional[str] = None
    last_read_chapter_id: Optional[int] = None


class Document(DocumentBase):
    id: int
    owner_id: int
    file_path: str
    status: DocumentStatus
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    parsed_at: Optional[datetime] = None
    last_read_chapter_id: Optional[int] = None
    category: Optional[str] = None
    is_public: bool = False
    view_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class DocumentDetail(Document):
    chapters: List[Chapter] = []


class DocumentList(BaseModel):
    total: int
    items: List[Document]


class DocumentUploadResponse(BaseModel):
    success: bool
    document_id: Optional[int] = None
    message: str


class ChapterMergeRequest(BaseModel):
    chapter_ids: List[int]
    new_title: Optional[str] = None


class ChapterSplitRequest(BaseModel):
    chapter_id: int
    split_points: List[int]
    new_titles: Optional[List[str]] = None


class ChapterNavigation(BaseModel):
    current: Optional[Chapter] = None
    previous: Optional[Chapter] = None
    next: Optional[Chapter] = None


class ReadingSessionBase(BaseModel):
    document_id: int


class ReadingSessionCreate(ReadingSessionBase):
    pass


class ReadingSession(ReadingSessionBase):
    id: int
    start_time: datetime
    end_time: Optional[datetime] = None
    total_duration: int = 0

    model_config = ConfigDict(from_attributes=True)


class ReadingRecordBase(BaseModel):
    session_id: int
    chapter_id: int


class ReadingRecordCreate(ReadingRecordBase):
    pass


class ReadingRecordUpdate(BaseModel):
    end_time: Optional[datetime] = None
    duration: Optional[int] = None
    is_completed: Optional[bool] = None
    progress: Optional[float] = None


class ReadingRecord(ReadingRecordBase):
    id: int
    start_time: datetime
    end_time: Optional[datetime] = None
    duration: int = 0
    is_completed: bool = False
    progress: float = 0

    model_config = ConfigDict(from_attributes=True)


class DailyStatsBase(BaseModel):
    date: str


class DailyStats(DailyStatsBase):
    id: int
    total_duration: int = 0
    chapters_read: int = 0
    documents_accessed: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class LearningOverview(BaseModel):
    """学习总览统计"""
    total_study_minutes: int  # 总学习时长（分钟）
    weekly_study_minutes: int  # 本周学习时长（分钟）
    study_minutes_change: float  # 较上周的变化百分比
    study_efficiency: float  # 学习效率
    efficiency_change: float  # 效率变化百分比
    consecutive_study_days: int  # 连续学习天数
    total_chapters_read: int  # 总阅读章节数
    total_documents_accessed: int  # 总访问文档数


class WeeklyStats(BaseModel):
    """周统计数据"""
    day: str  # 星期几
    minutes: int  # 学习时长（分钟）


class Achievement(BaseModel):
    """成就数据"""
    title: str
    icon: str
    unlocked: bool


class AnalyticsResponse(BaseModel):
    """分析页面响应"""
    overview: LearningOverview
    weekly_data: List[WeeklyStats]
    achievements: List[Achievement]
