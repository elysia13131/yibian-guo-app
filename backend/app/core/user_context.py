from contextvars import ContextVar
from typing import Optional
import logging

from starlette.types import ASGIApp, Scope, Receive, Send
from starlette.requests import Request

from app.db.session import SessionLocal
from app.services.auth_service import decode_access_token, get_user_by_id
from app.models.user import User

logger = logging.getLogger(__name__)

current_user_id: ContextVar[Optional[int]] = ContextVar('current_user_id', default=None)
current_deepseek_key: ContextVar[Optional[str]] = ContextVar('current_deepseek_key', default=None)
current_somark_key: ContextVar[Optional[str]] = ContextVar('current_somark_key', default=None)
current_ark_key: ContextVar[Optional[str]] = ContextVar('current_ark_key', default=None)


class UserKeyMiddleware:
    """ASGI 中间件：为每个已认证请求注入用户 API Key 到上下文变量"""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive)
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            try:
                token_data = decode_access_token(token)
                if token_data and token_data.user_id:
                    db = SessionLocal()
                    try:
                        user = db.query(User).filter(User.id == token_data.user_id).first()
                        if user:
                            current_user_id.set(user.id)
                            if user.deepseek_api_key:
                                current_deepseek_key.set(user.deepseek_api_key)
                            if user.somark_api_key:
                                current_somark_key.set(user.somark_api_key)
                            if user.api_key:
                                current_ark_key.set(user.api_key)
                    finally:
                        db.close()
            except Exception:
                pass

        await self.app(scope, receive, send)
