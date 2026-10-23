from datetime import datetime, timedelta, timezone
from typing import Optional
import hashlib
import hmac
import jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import User
from app.schemas.user import UserCreate, TokenData
from app.services.email_service import verify_code, is_email_verified


def hash_password(password: str) -> str:
    """使用 SHA256 + salt 哈希密码"""
    salt = settings.SECRET_KEY[:16]
    return hashlib.sha256((salt + password).encode()).hexdigest()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码"""
    return hmac.compare_digest(hash_password(plain_password), hashed_password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """创建 JWT Token"""
    to_encode = data.copy()
    
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(days=settings.JWT_EXPIRE_DAYS)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    
    return encoded_jwt


def decode_access_token(token: str) -> Optional[TokenData]:
    """解码 JWT Token"""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        user_id_str = payload.get("sub")
        if user_id_str is None:
            return None
        return TokenData(user_id=int(user_id_str))
    except jwt.PyJWTError:
        return None


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    """通过邮箱获取用户"""
    return db.query(User).filter(User.email == email).first()


def get_user_by_username(db: Session, username: str) -> Optional[User]:
    """通过用户名获取用户"""
    return db.query(User).filter(User.username == username).first()


def get_user_by_id(db: Session, user_id: int) -> Optional[User]:
    """通过ID获取用户"""
    return db.query(User).filter(User.id == user_id).first()


def create_user(db: Session, user_data) -> User:
    """创建新用户"""
    if not verify_code(user_data.email, user_data.verification_code):
        raise ValueError("验证码错误或已过期")

    existing_username = get_user_by_username(db, user_data.username)
    if existing_username:
        raise ValueError("该用户名已被注册")

    existing_email = get_user_by_email(db, user_data.email)
    if existing_email:
        raise ValueError("该邮箱已被注册")

    hashed_password = hash_password(user_data.password)

    db_user = User(
        email=user_data.email,
        username=user_data.username,
        hashed_password=hashed_password,
        is_active=True,
        is_verified=True
    )

    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    return db_user


def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
    """验证用户登录（支持用户名登录）"""
    user = get_user_by_username(db, username)
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    if not user.is_active:
        return None
    return user


def reset_password(db: Session, email: str, verification_code: str, new_password: str, new_username: Optional[str] = None) -> bool:
    """重置用户密码，可选同时重置用户名"""
    if not verify_code(email, verification_code):
        raise ValueError("验证码错误或已过期")

    user = get_user_by_email(db, email)
    if not user:
        raise ValueError("该邮箱未注册")

    hashed_password = hash_password(new_password)
    user.hashed_password = hashed_password
    if new_username and new_username.strip():
        user.username = new_username.strip()
    db.commit()

    return True


def delete_user(db: Session, user_id: int) -> bool:
    """删除用户及其相关数据"""
    user = get_user_by_id(db, user_id)
    if not user:
        raise ValueError("用户不存在")
    
    # 删除用户（级联删除相关数据）
    db.delete(user)
    db.commit()
    
    return True