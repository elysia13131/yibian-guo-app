from pydantic import BaseModel, EmailStr, ConfigDict
from typing import Optional
from datetime import datetime


class UserBase(BaseModel):
    email: EmailStr
    username: str


class UserCreate(UserBase):
    password: str
    verification_code: str


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(UserBase):
    id: int
    is_active: bool
    is_verified: bool
    player_title: str = '同学'
    api_key: Optional[str] = None
    tts_api_key: Optional[str] = None
    deepseek_api_key: Optional[str] = None
    somark_api_key: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserSettingsUpdate(BaseModel):
    player_title: str = '同学'
    api_key: Optional[str] = None
    tts_api_key: Optional[str] = None
    deepseek_api_key: Optional[str] = None
    somark_api_key: Optional[str] = None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class TokenData(BaseModel):
    user_id: Optional[int] = None


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    verification_code: str
    new_password: str
    new_username: Optional[str] = None