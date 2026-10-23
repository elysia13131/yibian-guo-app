"""Agent 实例化 — 所有子 Agent 的 ReActAgent 定义（Phase B 就绪）"""
import logging

from agentscope.agent import ReActAgent
from agentscope.formatter import OpenAIChatFormatter

from app.agentscope_config import (
    create_model, create_memory, create_long_term_memory,
    build_knowledge_toolkit, build_tutor_toolkit, build_quiz_toolkit,
    build_review_toolkit, build_clinical_toolkit, build_analytics_toolkit,
    build_methods_toolkit,
)
from app.services.agent_prompts import (
    KNOWLEDGE_AGENT_PROMPT, TUTOR_AGENT_PROMPT, QUIZ_AGENT_PROMPT,
    REVIEW_PLANNER_PROMPT, COMPANION_PROMPT, CLINICAL_AGENT_PROMPT,
    ANALYTICS_AGENT_PROMPT, METHODS_AGENT_PROMPT,
)

logger = logging.getLogger(__name__)


async def create_all_agents():
    """创建并返回所有 Agent 实例"""
    model = await create_model(stream=False)
    memory = create_memory()
    formatter = OpenAIChatFormatter()

    knowledge_agent = ReActAgent(
        name="knowledge_agent",
        sys_prompt=KNOWLEDGE_AGENT_PROMPT,
        model=model,
        formatter=formatter,
        toolkit=build_knowledge_toolkit(),
        memory=memory,
        max_iters=999,
    )

    tutor_agent = ReActAgent(
        name="tutor_agent",
        sys_prompt=TUTOR_AGENT_PROMPT,
        model=model,
        formatter=formatter,
        toolkit=build_tutor_toolkit(),
        memory=memory,
        max_iters=999,
    )

    quiz_agent = ReActAgent(
        name="quiz_agent",
        sys_prompt=QUIZ_AGENT_PROMPT,
        model=model,
        formatter=formatter,
        toolkit=build_quiz_toolkit(),
        memory=memory,
        max_iters=999,
    )

    review_planner = ReActAgent(
        name="review_planner",
        sys_prompt=REVIEW_PLANNER_PROMPT,
        model=model,
        formatter=formatter,
        toolkit=build_review_toolkit(),
        memory=memory,
        max_iters=999,
    )

    companion_agent = ReActAgent(
        name="companion_agent",
        sys_prompt=COMPANION_PROMPT,
        model=model,
        formatter=formatter,
        toolkit=None,
        memory=memory,
        max_iters=999,
    )

    clinical_agent = ReActAgent(
        name="clinical_agent",
        sys_prompt=CLINICAL_AGENT_PROMPT,
        model=model,
        formatter=formatter,
        toolkit=build_clinical_toolkit(),
        memory=memory,
        max_iters=999,
    )

    analytics_agent = ReActAgent(
        name="analytics_agent",
        sys_prompt=ANALYTICS_AGENT_PROMPT,
        model=model,
        formatter=formatter,
        toolkit=build_analytics_toolkit(),
        memory=memory,
        max_iters=999,
    )

    methods_agent = ReActAgent(
        name="methods_agent",
        sys_prompt=METHODS_AGENT_PROMPT,
        model=model,
        formatter=formatter,
        toolkit=build_methods_toolkit(),
        memory=memory,
        max_iters=999,
    )

    return {
        "knowledge_agent": knowledge_agent,
        "tutor_agent": tutor_agent,
        "quiz_agent": quiz_agent,
        "review_planner": review_planner,
        "companion_agent": companion_agent,
        "clinical_agent": clinical_agent,
        "analytics_agent": analytics_agent,
        "methods_agent": methods_agent,
    }


async def create_workflow():
    """创建工作流 3 Agent（单独导出供 Orchestrator 注入）"""
    from app.agentscope_workflow import create_workflow_agents
    return await create_workflow_agents()
