"""Agent WebSocket 管理器"""
from __future__ import annotations
import asyncio
import json
import logging
import sys
import traceback
from typing import Optional, Dict
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


def _inject_user_keys(user_id: int):
    """为 WebSocket 连接注入用户 API Key 到上下文变量（绕过 ASGI 中间件）"""
    from app.core.user_context import current_user_id, current_deepseek_key
    from app.db.session import SessionLocal
    from app.models.user import User
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            current_user_id.set(user_id)
            if user.deepseek_api_key:
                current_deepseek_key.set(user.deepseek_api_key)
    finally:
        db.close()


class AgentWSManager:
    def __init__(self):
        self.connections: Dict[int, WebSocket] = {}
        self.conversations: Dict[int, list[dict]] = {}  # user_id -> [{role, content}, ...]
        self._task_conv_start: Dict[int, int] = {}  # user_id -> conv offset for current task
        # 会话上下文隔离与恢复（仅内存，不写库）
        self._saved_contexts: Dict[int, Dict[str, list[dict]]] = {}  # user_id -> {task_id: [conv]}
        self.active_task_id: Dict[int, Optional[str]] = {}  # user_id -> current session task_id

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        self.connections[user_id] = websocket
        self.conversations.setdefault(user_id, [])
        self._saved_contexts.setdefault(user_id, {})
        self.active_task_id[user_id] = None
        logger.info(f"Agent WS 用户 {user_id} 已连接")
        print(f"[AGENT_WS] 用户 {user_id} 已连接", flush=True)

    async def disconnect(self, user_id: int):
        self._save_current_context(user_id)
        self.connections.pop(user_id, None)
        self.conversations.pop(user_id, None)
        self._saved_contexts.pop(user_id, None)
        self.active_task_id.pop(user_id, None)
        self._task_conv_start.pop(user_id, None)
        logger.info(f"Agent WS 用户 {user_id} 已断开")

    async def send(self, user_id: int, data: dict):
        ws = self.connections.get(user_id)
        if ws:
            try:
                await ws.send_json(data)
            except Exception:
                self.connections.pop(user_id, None)

    def _save_current_context(self, user_id: int):
        """将当前对话上下文缓存到 _saved_contexts，实现会话隔离"""
        task_id = self.active_task_id.get(user_id)
        if task_id and user_id in self.conversations:
            self._saved_contexts.setdefault(user_id, {})[task_id] = list(self.conversations[user_id])

    async def handle(self, user_id: int, websocket: WebSocket):
        print(f"[AGENT_WS] handle called for user {user_id}", flush=True)
        from app.services.agent_orchestrator import get_orchestrator, remove_orchestrator
        from app.models.agent import ExpertTask, TaskStatus
        from app.db.session import SessionLocal
        from app.api.v1.agent import cleanup_old_tasks
        import uuid
        from datetime import datetime

        try:
            await self.connect(user_id, websocket)
            # WebSocket 绕过 ASGI 中间件，需手动注入用户 API Key
            _inject_user_keys(user_id)
            print(f"[AGENT_WS] user {user_id} connected successfully", flush=True)
        except Exception as e:
            print(f"[AGENT_WS] connect failed for user {user_id}: {e}", flush=True)
            import traceback
            traceback.print_exc()
            return

        current_task_id = None

        async def ws_send(data: dict):
            await self.send(user_id, data)

        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    await ws_send({"type": "error", "message": "无效的JSON"})
                    continue

                action = msg.get("action", "")

                if action == "ping":
                    await ws_send({"type": "pong"})

                elif action == "switch_task":
                    target_task_id = msg.get("task_id")
                    if not target_task_id:
                        await ws_send({"type": "error", "message": "缺少 task_id"})
                        continue
                    self._save_current_context(user_id)
                    self.active_task_id[user_id] = target_task_id
                    saved = self._saved_contexts.get(user_id, {}).get(target_task_id)
                    if saved is not None:
                        self.conversations[user_id] = list(saved)
                    else:
                        self.conversations[user_id] = []
                        self._saved_contexts.setdefault(user_id, {})[target_task_id] = []
                    self._task_conv_start[user_id] = len(self.conversations[user_id])
                    logger.info(f"用户 {user_id} 切换到任务 {target_task_id}，上下文 {len(self.conversations[user_id])} 条")

                elif action == "chat":
                    text = msg.get("text", "").strip()

                    # 会话上下文隔离：如果携带了会话 task_id，确保 active_task_id 一致
                    session_task_id = msg.get("task_id")
                    if session_task_id and session_task_id != self.active_task_id.get(user_id):
                        self._save_current_context(user_id)
                        self.active_task_id[user_id] = session_task_id
                        saved = self._saved_contexts.get(user_id, {}).get(session_task_id)
                        if saved is not None:
                            self.conversations[user_id] = list(saved)
                        else:
                            self.conversations[user_id] = []
                            self._saved_contexts.setdefault(user_id, {})[session_task_id] = []
                        self._task_conv_start[user_id] = len(self.conversations[user_id])
                    user_mode = msg.get("mode", "detailed")
                    safe_text = text[:50].encode('gbk', errors='replace').decode('gbk')
                    print(f"[AGENT_WS] 收到 chat: text={safe_text}... mode={user_mode}", flush=True)
                    if not text:
                        await ws_send({"type": "error", "message": "请输入问题"})
                        continue

                    # 检查是否有 ToolAgent 正在等待用户反馈
                    from app.services.toolagent_state import get_toolagent_task_id, get_input_queue
                    waiting_task_id = get_toolagent_task_id(user_id)
                    if waiting_task_id:
                        input_queue = get_input_queue(waiting_task_id)
                        if input_queue:
                            await input_queue.put(text)
                            continue

                    orchestrator = get_orchestrator(user_id)
                    from app.services.agent_orchestrator import ensure_agentscope_agents
                    await ensure_agentscope_agents(user_id)
                    task_id = str(uuid.uuid4())
                    current_task_id = task_id

                    self.conversations.setdefault(user_id, []).append({"role": "user", "content": text})

                    conv = self.conversations.get(user_id, [])
                    context_history = ""
                    if conv:
                        lines = ["## 当前任务上下文"]
                        for entry in conv:
                            role = entry.get("role", "")
                            content = entry.get("content", "")
                            if role == "user":
                                lines.append(f"用户：{content}")
                            else:
                                lines.append(f"AI：{content}")
                        context_history = "\n".join(lines)

                    db = SessionLocal()
                    try:
                        task = ExpertTask(
                            id=task_id, user_id=user_id, query=text,
                            todo_list=[], status=TaskStatus.IN_PROGRESS,
                        )
                        db.add(task)
                        db.commit()
                    finally:
                        db.close()

                    async def capturing_ws_send(data: dict):
                        await ws_send(data)

                    try:
                        summary = await orchestrator.run_task(task_id, text, capturing_ws_send, context_history=context_history, mode=user_mode)

                        if summary:
                            self.conversations[user_id].append({"role": "ai", "content": summary})
                        self._task_conv_start[user_id] = len(self.conversations[user_id])
                        if len(self.conversations[user_id]) > 40:
                            self.conversations[user_id] = self.conversations[user_id][-40:]
                        self._save_current_context(user_id)
                        db = SessionLocal()
                        try:
                            task = db.query(ExpertTask).filter(
                                ExpertTask.id == task_id
                            ).first()
                            if task:
                                task.summary = summary
                                task.todo_list = orchestrator._current_todo_list
                                task.status = TaskStatus.COMPLETED
                                task.completed_at = datetime.now()
                                db.commit()
                        finally:
                            db.close()
                    except Exception as e:
                        logger.exception(f"任务执行失败: {task_id}")
                        db = SessionLocal()
                        try:
                            task = db.query(ExpertTask).filter(
                                ExpertTask.id == task_id
                            ).first()
                            if task:
                                task.status = TaskStatus.FAILED
                                task.error_message = str(e)
                                db.commit()
                        finally:
                            db.close()
                        await ws_send({
                            "type": "task_error",
                            "task_id": task_id,
                            "message": str(e),
                        })
                    finally:
                        current_task_id = None

                    cleanup_old_tasks(user_id)

                elif action == "clear_context":
                    self._save_current_context(user_id)
                    self.conversations[user_id] = []
                    self._task_conv_start[user_id] = 0
                    task_id = self.active_task_id.get(user_id)
                    if task_id:
                        self._saved_contexts.get(user_id, {}).pop(task_id, None)
                    self.active_task_id[user_id] = None
                    await ws_send({"type": "context_cleared", "message": "会话上下文已清空"})
                    logger.info(f"用户 {user_id} 清空了会话上下文")

                elif action == "abort":
                    if current_task_id:
                        orchestrator = get_orchestrator(user_id)
                        orchestrator.abort()
                        await ws_send({
                            "type": "task_error",
                            "task_id": current_task_id,
                            "message": "用户中断",
                        })
                        current_task_id = None

        except WebSocketDisconnect as e:
            if current_task_id:
                orchestrator = get_orchestrator(user_id)
                orchestrator.abort()
            logger.info(f"Agent WS 用户 {user_id} 断开连接")
            return
        except Exception as e:
            logger.error(f"Agent WS 错误: {e}\n{traceback.format_exc()}")
        finally:
            if current_task_id:
                orchestrator = get_orchestrator(user_id)
                orchestrator.abort()
            remove_orchestrator(user_id)
            await self.disconnect(user_id)


agent_ws_manager = AgentWSManager()
