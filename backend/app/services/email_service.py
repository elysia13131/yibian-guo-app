import random
import string
import smtplib
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict
import logging
import asyncio
from concurrent.futures import ThreadPoolExecutor

from app.core.config import settings

logger = logging.getLogger(__name__)

verification_codes: Dict[str, dict] = {}

_executor = ThreadPoolExecutor(max_workers=2)


def generate_verification_code(length: int = 6) -> str:
    """生成6位数字验证码"""
    return ''.join(random.choices(string.digits, k=length))


def send_verification_email(to_email: str, code: str, purpose: str = "register") -> bool:
    """发送验证码到邮箱"""
    if not settings.EMAIL_USER or not settings.EMAIL_PASS:
        logger.warning("邮箱配置未设置，跳过发送验证码")
        return False

    try:
        msg = EmailMessage()
        subject = "一遍过 - 注册验证码" if purpose == "register" else "一遍过 - 重置密码验证码"
        msg['Subject'] = subject
        msg['From'] = settings.EMAIL_USER
        msg['To'] = to_email

        title = "欢迎注册一遍过" if purpose == "register" else "重置密码验证"
        html_content = f"""
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
            <h2 style="color: #2563eb;">{title}</h2>
            <p>您的验证码是：</p>
            <div style="background: #f3f4f6; padding: 20px; text-align: center; font-size: 32px; letter-spacing: 8px; border-radius: 8px; margin: 20px 0;">
                <strong style="color: #2563eb;">{code}</strong>
            </div>
            <p style="color: #6b7280; font-size: 14px;">验证码有效期为10分钟，请勿泄露给他人。</p>
        </div>
        """

        msg.set_content(html_content, subtype='html')

        timeout = 10
        if settings.EMAIL_SECURE:
            server = smtplib.SMTP_SSL(settings.EMAIL_HOST, settings.EMAIL_PORT, timeout=timeout)
        else:
            server = smtplib.SMTP(settings.EMAIL_HOST, settings.EMAIL_PORT, timeout=timeout)
            server.starttls()
        server.login(settings.EMAIL_USER, settings.EMAIL_PASS)
        server.send_message(msg)
        server.quit()

        logger.info(f"验证码已发送至: {to_email}")
        return True

    except Exception as e:
        logger.error(f"发送验证码失败: {e}")
        return False


def send_verification_email_async(to_email: str, code: str, purpose: str = "register") -> None:
    """异步发送验证码邮件"""
    loop = asyncio.get_event_loop()
    loop.run_in_executor(_executor, send_verification_email, to_email, code, purpose)


def store_verification_code(email: str, code: str, expire_minutes: int = 10) -> None:
    """存储验证码"""
    verification_codes[email] = {
        'code': code,
        'expires_at': datetime.now(timezone.utc) + timedelta(minutes=expire_minutes),
        'verified': False
    }


def verify_code(email: str, code: str) -> bool:
    """验证验证码"""
    if email not in verification_codes:
        return False

    record = verification_codes[email]

    if datetime.now(timezone.utc) > record['expires_at']:
        del verification_codes[email]
        return False

    if record['code'] != code:
        return False

    record['verified'] = True
    return True


def is_email_verified(email: str) -> bool:
    """检查邮箱是否已验证"""
    if email not in verification_codes:
        return False
    return verification_codes[email].get('verified', False)


def cleanup_expired_codes() -> None:
    """清理过期验证码"""
    now = datetime.now(timezone.utc)
    expired = [email for email, record in verification_codes.items()
               if now > record['expires_at']]
    for email in expired:
        del verification_codes[email]


def send_register_verification_code(email: str) -> dict:
    """发送注册验证码"""
    if not email:
        return {"success": False, "message": "邮箱地址不能为空"}

    code = generate_verification_code()
    success = send_verification_email(email, code, purpose="register")

    if success:
        store_verification_code(email, code)
        return {"success": True, "message": "验证码已发送", "expires_in": 600}
    else:
        return {"success": False, "message": "发送失败，请检查邮箱配置"}


def send_reset_password_code(email: str) -> dict:
    """发送重置密码验证码"""
    if not email:
        return {"success": False, "message": "邮箱地址不能为空"}

    code = generate_verification_code()
    success = send_verification_email(email, code, purpose="reset")

    if success:
        store_verification_code(email, code)
        return {"success": True, "message": "验证码已发送", "expires_in": 600}
    else:
        return {"success": False, "message": "发送失败，请检查邮箱配置"}
