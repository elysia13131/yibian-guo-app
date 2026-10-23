from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime


class GameTaskCreate(BaseModel):
    document_id: int
    parse_mode: str = "smart"
    character_id: Optional[int] = None


class GameTaskResponse(BaseModel):
    task_id: int
    status: str
    document_title: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class GameTaskStatusResponse(BaseModel):
    task_id: int
    status: str
    document_title: str
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class GameContentResponse(BaseModel):
    document_title: str
    sections: List[Dict[str, Any]]

    model_config = ConfigDict(from_attributes=True)


class GameSaveListItem(BaseModel):
    id: int
    uid: Optional[str] = None
    document_id: Optional[int] = None
    document_title: str
    parse_mode: str
    status: str
    is_public: bool = False
    owner_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class GameSaveListResponse(BaseModel):
    saves: List[GameSaveListItem]


class GameSaveDetailResponse(BaseModel):
    id: int
    uid: Optional[str] = None
    document_id: Optional[int] = None
    document_title: str
    parse_mode: str
    status: str
    is_public: bool = False
    sections: Optional[List[Dict[str, Any]]] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class BorrowSaveRequest(BaseModel):
    save_uid: str
