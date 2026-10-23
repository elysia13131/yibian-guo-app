import asyncio
from typing import Dict, Optional

_toolagent_input_queues: Dict[str, asyncio.Queue] = {}
_toolagent_task_ids: Dict[str, str] = {}  # user_id -> task_id


def get_input_queue(task_id: str) -> Optional[asyncio.Queue]:
    return _toolagent_input_queues.get(task_id)


def set_input_queue(task_id: str, queue: asyncio.Queue):
    _toolagent_input_queues[task_id] = queue


def remove_input_queue(task_id: str):
    _toolagent_input_queues.pop(task_id, None)


def get_toolagent_task_id(user_id: int) -> Optional[str]:
    return _toolagent_task_ids.get(str(user_id))


def set_toolagent_task_id(user_id: int, task_id: str):
    _toolagent_task_ids[str(user_id)] = task_id


def clear_toolagent_task_id(user_id: int):
    _toolagent_task_ids.pop(str(user_id), None)
