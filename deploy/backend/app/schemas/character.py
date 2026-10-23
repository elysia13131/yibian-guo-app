from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime


class CharacterCreate(BaseModel):
    name: str
    prompt: str
    is_public: bool = False
    speaker_id: Optional[str] = None


class CharacterUpdate(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    is_public: Optional[bool] = None
    speaker_id: Optional[str] = None


class CharacterResponse(BaseModel):
    id: int
    uid: str
    owner_id: int
    name: str
    description: Optional[str] = None
    portrait_url: str
    prompt: str
    expressions: Optional[List[str]] = None
    expression_descriptions: Optional[List[str]] = None
    cg_images: Optional[List[str]] = None
    speaker_id: Optional[str] = None
    voice_status: Optional[str] = None
    voice_sample_url: Optional[str] = None
    is_public: bool
    is_default: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class BorrowByUidRequest(BaseModel):
    uid: str


class UpdateSpeakerIdRequest(BaseModel):
    speaker_id: str


class CharacterListResponse(BaseModel):
    characters: List[CharacterResponse]
