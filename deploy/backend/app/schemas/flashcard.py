from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime
from app.models.flashcard import FlashcardRating, FlashcardStatus, GenerationTaskStatus


class GenerationTaskBase(BaseModel):
    document_id: int
    max_cards: Optional[int] = 15
    is_public: bool = False


class GenerationTaskCreate(GenerationTaskBase):
    pass


class GenerationTaskResponse(BaseModel):
    id: int
    document_id: int
    status: str
    total_chunks: int
    processed_chunks: int
    total_cards: int
    max_cards: int = 15
    focus_text: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class GenerationTaskListResponse(BaseModel):
    tasks: List[GenerationTaskResponse]
    active_count: int


class CardGroupBase(BaseModel):
    name: str
    description: Optional[str] = None
    document_id: int
    is_public: bool = False
    category: Optional[str] = None


class CardGroupCreate(CardGroupBase):
    pass


class CardGroup(CardGroupBase):
    id: int
    owner_id: int
    card_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None
    document_title: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class CardGroupWithFlashcards(CardGroup):
    flashcards: List["Flashcard"] = []


class PublicGroupsByCategory(BaseModel):
    """按学科分类的公开卡组"""
    category: str
    groups: List[CardGroup]


class FlashcardBase(BaseModel):
    """抽认卡基础模型"""
    question: str
    answer: str
    document_id: int
    chapter_id: Optional[int] = None
    group_id: Optional[int] = None
    source_text: Optional[str] = None
    is_public: bool = False
    is_multiple_choice: bool = False
    options: Optional[List[Dict[str, Any]]] = None
    correct_option_label: Optional[str] = None


class FlashcardCreate(FlashcardBase):
    """创建抽认卡"""
    pass


class FlashcardUpdate(BaseModel):
    """更新抽认卡"""
    question: Optional[str] = None
    answer: Optional[str] = None
    difficulty: Optional[float] = None
    stability: Optional[float] = None
    retrievability: Optional[float] = None
    due: Optional[datetime] = None
    status: Optional[FlashcardStatus] = None
    is_public: Optional[bool] = None


class Flashcard(FlashcardBase):
    """抽认卡响应模型"""
    id: int
    owner_id: int
    ai_generated: bool = True
    confidence: Optional[float] = None
    group_id: Optional[int] = None

    difficulty: float = 0.0
    stability: float = 0.0
    retrievability: float = 0.0
    due: Optional[datetime] = None
    elapsed_days: float = 0.0
    scheduled_days: float = 0.0
    reps: int = 0
    lapses: int = 0

    status: FlashcardStatus = FlashcardStatus.NEW
    last_reviewed: Optional[datetime] = None
    next_review: Optional[datetime] = None

    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class FlashcardReviewLogBase(BaseModel):
    """抽认卡复习日志基础模型"""
    rating: FlashcardRating
    duration_seconds: float = 0.0
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None


class FlashcardReviewLogCreate(FlashcardReviewLogBase):
    """创建复习日志"""
    flashcard_id: int


class FlashcardReviewLog(FlashcardReviewLogBase):
    """抽认卡复习日志响应模型"""
    id: int
    flashcard_id: int
    review_time: datetime
    
    # 复习前后的FSRS参数
    difficulty_before: Optional[float] = None
    stability_before: Optional[float] = None
    retrievability_before: Optional[float] = None
    difficulty_after: Optional[float] = None
    stability_after: Optional[float] = None
    retrievability_after: Optional[float] = None
    
    # 时间间隔
    elapsed_days: Optional[float] = None
    scheduled_days: Optional[float] = None
    
    # 复习状态
    status_before: Optional[str] = None
    status_after: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True)


class FlashcardReviewRequest(BaseModel):
    """抽认卡复习请求"""
    rating: FlashcardRating
    duration_seconds: float = 0.0


class FlashcardGenerateRequest(BaseModel):
    """生成抽认卡请求"""
    document_id: int
    chapter_ids: Optional[List[int]] = None
    max_cards: Optional[int] = 15
    focus_text: Optional[str] = None
    group_name: Optional[str] = None
    is_public: bool = False


class FlashcardGenerateResponse(BaseModel):
    """生成抽认卡响应"""
    success: bool
    message: str
    generated_count: int = 0
    total_count: int = 0
    flashcard_ids: Optional[List[int]] = None
    group_id: Optional[int] = None


class FlashcardList(BaseModel):
    """抽认卡列表响应"""
    total: int
    items: List[Flashcard]


class FlashcardDueList(BaseModel):
    """到期抽认卡列表"""
    total: int
    due_today: int
    overdue: int
    items: List[Flashcard]


class FlashcardStats(BaseModel):
    """抽认卡统计"""
    total_cards: int
    new_cards: int
    learning_cards: int
    review_cards: int
    due_today: int
    overdue: int
    avg_confidence: float
    total_reviews: int
    avg_rating: Optional[float] = None


class FSRSParameters(BaseModel):
    """FSRS算法参数"""
    difficulty: float
    stability: float
    retrievability: float
    due: Optional[datetime] = None
    elapsed_days: float
    scheduled_days: float
    reps: int
    lapses: int