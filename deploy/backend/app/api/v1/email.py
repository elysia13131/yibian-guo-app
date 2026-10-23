from fastapi import APIRouter, HTTPException, Depends, status, BackgroundTasks
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.email_service import (
    send_register_verification_code,
    send_reset_password_code,
    verify_code,
    is_email_verified,
    generate_verification_code,
    store_verification_code,
    send_verification_email,
)

router = APIRouter(prefix="/email", tags=["email"])


class SendCodeRequest(BaseModel):
    email: EmailStr


class SendResetCodeRequest(BaseModel):
    email: EmailStr


class VerifyCodeRequest(BaseModel):
    email: EmailStr
    code: str


class CodeResponse(BaseModel):
    success: bool
    message: str
    expires_in: int = 0


def send_email_background(to_email: str, code: str, purpose: str):
    """后台发送邮件"""
    send_verification_email(to_email, code, purpose)


@router.post("/send-code", response_model=CodeResponse)
async def send_verification_code(request: SendCodeRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """发送注册验证码到邮箱"""
    if not request.email:
        return CodeResponse(success=False, message="邮箱地址不能为空")

    code = generate_verification_code()
    store_verification_code(request.email, code)

    background_tasks.add_task(send_email_background, request.email, code, "register")

    return CodeResponse(
        success=True,
        message="验证码已发送",
        expires_in=600
    )


@router.post("/send-reset-code", response_model=CodeResponse)
async def send_reset_code(request: SendResetCodeRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """发送重置密码验证码到邮箱"""
    if not request.email:
        return CodeResponse(success=False, message="邮箱地址不能为空")

    code = generate_verification_code()
    store_verification_code(request.email, code)

    background_tasks.add_task(send_email_background, request.email, code, "reset")

    return CodeResponse(
        success=True,
        message="验证码已发送",
        expires_in=600
    )


@router.post("/verify-code", response_model=CodeResponse)
async def verify_verification_code(request: VerifyCodeRequest, db: Session = Depends(get_db)):
    """验证邮箱验证码"""
    if verify_code(request.email, request.code):
        return CodeResponse(
            success=True,
            message="验证成功",
            expires_in=0
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码错误或已过期"
        )
