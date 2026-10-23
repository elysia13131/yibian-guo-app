from fastapi import WebSocket
from typing import Dict, Set, Optional
import json
import logging

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, Set[WebSocket]] = {}

    async def connect(self, document_id: int, websocket: WebSocket):
        await websocket.accept()
        if document_id not in self.active_connections:
            self.active_connections[document_id] = set()
        self.active_connections[document_id].add(websocket)
        logger.info(f"WebSocket connected for document {document_id}")

    def disconnect(self, document_id: int, websocket: WebSocket):
        if document_id in self.active_connections:
            self.active_connections[document_id].discard(websocket)
            if not self.active_connections[document_id]:
                del self.active_connections[document_id]
        logger.info(f"WebSocket disconnected for document {document_id}")

    async def send_progress(self, document_id: int, progress: int, status: str, message: str = ""):
        if document_id not in self.active_connections:
            return

        data = {
            "type": "progress",
            "document_id": document_id,
            "progress": progress,
            "status": status,
            "message": message
        }

        dead_connections = set()
        for websocket in self.active_connections[document_id]:
            try:
                await websocket.send_json(data)
            except Exception as e:
                logger.warning(f"Failed to send to WebSocket: {e}")
                dead_connections.add(websocket)

        for ws in dead_connections:
            self.active_connections[document_id].discard(ws)

    async def send_complete(self, document_id: int, success: bool, message: str = ""):
        if document_id not in self.active_connections:
            return

        data = {
            "type": "complete",
            "document_id": document_id,
            "success": success,
            "message": message
        }

        dead_connections = set()
        for websocket in self.active_connections[document_id]:
            try:
                await websocket.send_json(data)
            except Exception as e:
                logger.warning(f"Failed to send to WebSocket: {e}")
                dead_connections.add(websocket)

        for ws in dead_connections:
            self.active_connections[document_id].discard(ws)


class FlashcardWSManager:
    def __init__(self):
        self.active_connections: Dict[int, Set[WebSocket]] = {}

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        self.active_connections[user_id].add(websocket)
        logger.info(f"Flashcard WebSocket connected for user {user_id}")

    def disconnect(self, user_id: int, websocket: WebSocket):
        if user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        logger.info(f"Flashcard WebSocket disconnected for user {user_id}")

    async def send_task_update(self, user_id: int, task_data: dict):
        if user_id not in self.active_connections:
            logger.info(f"No active WebSocket for user {user_id}, skipping broadcast")
            return

        data = {
            "type": "task_update",
            **task_data
        }

        dead_connections = set()
        for websocket in self.active_connections[user_id]:
            try:
                await websocket.send_json(data)
            except Exception as e:
                logger.warning(f"Failed to send to Flashcard WebSocket: {e}")
                dead_connections.add(websocket)

        for ws in dead_connections:
            self.active_connections[user_id].discard(ws)

    async def broadcast_to_all(self, task_data: dict):
        for user_id in list(self.active_connections.keys()):
            await self.send_task_update(user_id, task_data)


class GameWSManager:
    def __init__(self):
        self.active_connections: Dict[int, Set[WebSocket]] = {}

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        self.active_connections[user_id].add(websocket)
        logger.info(f"Game WebSocket connected for user {user_id}")

    def disconnect(self, user_id: int, websocket: WebSocket):
        if user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        logger.info(f"Game WebSocket disconnected for user {user_id}")

    async def broadcast(self, user_id: int, data: dict):
        if user_id not in self.active_connections:
            return
        dead = set()
        for ws in self.active_connections[user_id]:
            try:
                await ws.send_json(data)
            except Exception as e:
                logger.warning(f"Game WS send failed: {e}")
                dead.add(ws)
        for ws in dead:
            self.active_connections[user_id].discard(ws)


manager = ConnectionManager()
flashcard_ws_manager = FlashcardWSManager()
game_ws_manager = GameWSManager()


class ExperimentWSManager:
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, user_id: int, report_id: int, websocket: WebSocket):
        key = f"{user_id}:{report_id}"
        if key not in self.active_connections:
            self.active_connections[key] = set()
        self.active_connections[key].add(websocket)
        logger.info(f"Experiment WS connected user={user_id} report={report_id}")

    def disconnect(self, user_id: int, report_id: int, websocket: WebSocket):
        key = f"{user_id}:{report_id}"
        if key in self.active_connections:
            self.active_connections[key].discard(websocket)
            if not self.active_connections[key]:
                del self.active_connections[key]
        logger.info(f"Experiment WS disconnected user={user_id} report={report_id}")

    async def broadcast(self, user_id: int, report_id: int, data: dict):
        key = f"{user_id}:{report_id}"
        if key not in self.active_connections:
            return
        dead = set()
        for ws in self.active_connections[key]:
            try:
                await ws.send_json(data)
            except Exception as e:
                logger.warning(f"Experiment WS send failed: {e}")
                dead.add(ws)
        for ws in dead:
            self.active_connections[key].discard(ws)


experiment_ws_manager = ExperimentWSManager()


class GraphBuildWSManager:
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, document_id: int, websocket: WebSocket):
        await websocket.accept()
        key = f"graph_{document_id}"
        if key not in self.active_connections:
            self.active_connections[key] = set()
        self.active_connections[key].add(websocket)

    def disconnect(self, document_id: int, websocket: WebSocket):
        key = f"graph_{document_id}"
        if key in self.active_connections:
            self.active_connections[key].discard(websocket)
            if not self.active_connections[key]:
                del self.active_connections[key]

    async def broadcast(self, document_id: int, data: dict):
        key = f"graph_{document_id}"
        if key not in self.active_connections:
            return
        dead = set()
        for ws in self.active_connections[key]:
            try:
                await ws.send_json(data)
            except Exception as e:
                logger.warning(f"Graph WS send failed: {e}")
                dead.add(ws)
        for ws in dead:
            self.active_connections[key].discard(ws)


graph_ws_manager = GraphBuildWSManager()