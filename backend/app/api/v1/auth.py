from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from typing import Optional
import logging

from app.db.session import get_db
from app.schemas.user import UserCreate, UserLogin, UserResponse, UserSettingsUpdate, Token, TokenData, ResetPasswordRequest
from app.services.auth_service import (
    create_user,
    authenticate_user,
    create_access_token,
    decode_access_token,
    get_user_by_id,
    reset_password,
    delete_user
)
from app.models.user import User
from app.core.user_context import current_user_id, current_deepseek_key, current_somark_key, current_ark_key

logger = logging.getLogger(__name__)
router = APIRouter(tags=["auth"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


# 依赖项：从请求头中提取并验证 Token（必须在路由之前定义）
def get_current_user_dep(token: str = Depends(oauth2_scheme)) -> TokenData:
    """验证当前用户的依赖项"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无效的认证凭据",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    token_data = decode_access_token(token)
    if token_data is None:
        raise credentials_exception
    
    return token_data


async def get_optional_current_user_dep(token: Optional[str] = Depends(oauth2_scheme)) -> Optional[TokenData]:
    """可选的用户验证依赖项（不强制要求登录）"""
    if not token:
        return None
    
    try:
        token_data = decode_access_token(token)
        return token_data
    except:
        return None


@router.post("/register", response_model=Token)
async def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """用户注册"""
    try:
        user = create_user(db, user_data)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    
    # 生成 Token
    access_token = create_access_token(data={"sub": str(user.id)})
    
    return Token(
        access_token=access_token,
        user=UserResponse.model_validate(user)
    )


@router.post("/login", response_model=Token)
async def login(user_data: UserLogin, db: Session = Depends(get_db)):
    """用户登录"""
    user = authenticate_user(db, user_data.username, user_data.password)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账户已被禁用"
        )
    
    access_token = create_access_token(data={"sub": str(user.id)})
    
    return Token(
        access_token=access_token,
        user=UserResponse.model_validate(user)
    )


@router.get("/me", response_model=UserResponse)
async def get_me(token_data: TokenData = Depends(get_current_user_dep), db: Session = Depends(get_db)):
    """获取当前登录用户信息"""
    user = get_user_by_id(db, token_data.user_id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    return UserResponse.model_validate(user)


@router.put("/me/settings", response_model=UserResponse)
async def update_user_settings(
    settings: UserSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: TokenData = Depends(get_current_user_dep),
):
    """更新用户设置"""
    user = db.query(User).filter(User.id == current_user.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if settings.player_title is not None:
        user.player_title = settings.player_title
    if settings.api_key is not None:
        user.api_key = settings.api_key or None
    if settings.tts_api_key is not None:
        user.tts_api_key = settings.tts_api_key or None
    if settings.deepseek_api_key is not None:
        user.deepseek_api_key = settings.deepseek_api_key or None
    if settings.somark_api_key is not None:
        user.somark_api_key = settings.somark_api_key or None

    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)


@router.post("/reset-password", response_model=dict)
async def reset_user_password(request: ResetPasswordRequest, db: Session = Depends(get_db)):
    """重置用户密码（可选同时重置用户名）"""
    try:
        reset_password(db, request.email, request.verification_code, request.new_password, request.new_username)
        return {"success": True, "message": "密码重置成功"}
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.delete("/me", response_model=dict)
async def delete_my_account(token_data: TokenData = Depends(get_current_user_dep), db: Session = Depends(get_db)):
    """删除当前用户账号"""
    try:
        delete_user(db, token_data.user_id)
        return {"success": True, "message": "账号已删除"}
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )