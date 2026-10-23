"""3-Agent 工作流编排 — Intent → Planner → Assembler"""
import json
import logging
from typing import Dict, List, Optional, Callable, Awaitable

from agentscope.agent import ReActAgent
from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import Msg
from agentscope.pipeline import MsgHub

from app.agentscope_config import create_model, create_memory, create_long_term_memory
from app.agentscope_workflow_prompts import (
    INTENT_AGENT_PROMPT,
    PLANNER_AGENT_PROMPT,
    ASSEMBLER_AGENT_PROMPT,
)
from app.services.agent_prompts import AGENT_DEFINITIONS

logger = logging.getLogger(__name__)


async def create_workflow_agents():
    """创建 3 个工作流 Agent 实例"""
    model = await create_model(stream=False)
    memory = create_memory()
    formatter = OpenAIChatFormatter()

    intent_agent = ReActAgent(
        name="intent_agent",
        sys_prompt=INTENT_AGENT_PROMPT,
        model=model,
        formatter=formatter,
        toolkit=None,
        memory=memory,
        max_iters=1,
    )

    planner_agent = ReActAgent(
        name="planner_agent",
        sys_prompt=PLANNER_AGENT_PROMPT,
        model=model,
        formatter=formatter,
        toolkit=None,
        memory=memory,
        max_iters=1,
    )

    assembler_agent = ReActAgent(
        name="assembler_agent",
        sys_prompt=ASSEMBLER_AGENT_PROMPT,
        model=model,
        formatter=formatter,
        toolkit=None,
        memory=memory,
        max_iters=1,
    )

    return {
        "intent_agent": intent_agent,
        "planner_agent": planner_agent,
        "assembler_agent": assembler_agent,
    }
