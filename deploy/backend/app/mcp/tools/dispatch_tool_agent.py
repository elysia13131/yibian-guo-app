import logging
from typing import List, Dict, Any, Optional, Callable, Awaitable
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class SpecItem(BaseModel):
    agent_id: str
    output: str
    requirements: str = ""
    artifact_type: str = ""


class DispatchInput(BaseModel):
    specs: List[SpecItem]


class ArtifactResult(BaseModel):
    type: str
    path: Optional[str] = ""
    title: str


class DispatchResult(BaseModel):
    artifacts: List[ArtifactResult] = []
    summary: str = ""


def _detect_artifact_type(requirements: str, agent_id: str) -> str:
    req_lower = requirements.lower()
    if any(kw in req_lower for kw in ["ppt", "pptx", "演示文稿", "幻灯片", "presentation", "slides"]):
        return "pptx"
    if any(kw in req_lower for kw in ["pdf", "导出pdf"]):
        return "pdf"
    if any(kw in req_lower for kw in ["docx", "word", "文档", "导出word"]):
        return "docx"
    if any(kw in req_lower for kw in ["chart", "图表", "趋势图", "柱状图", "饼图", "折线图"]):
        return "chart"
    if any(kw in req_lower for kw in ["mindmap", "思维导图", "脑图"]):
        return "mindmap"
    if any(kw in req_lower for kw in ["image", "图片", "插图", "生图", "配图"]):
        return "image"
    return "text"


async def dispatch_tool_agent(input_data: Dict[str, Any], ws_send: Optional[Callable[[dict], Awaitable[None]]] = None, task_id: str = "") -> Dict[str, Any]:
    from app.services.tool_agent import ToolAgent
    from app.services.agent_prompts import AGENT_DEFINITIONS

    specs = input_data.get("specs", [])
    dispatch_input = DispatchInput(**{"specs": specs})

    user_context = input_data.get("_user_context", "")

    # 从 specs 中取第一个 agent_id 查找对应 system_prompt
    first_spec = specs[0] if specs else {}
    agent_id = first_spec.get("agent_id", "ppt_agent")
    agent_registry = {a["id"]: a for a in AGENT_DEFINITIONS}
    agent_info = agent_registry.get(agent_id, {})
    system_prompt = agent_info.get("system_prompt", "")

    doppelganger = ToolAgent()
    await doppelganger.start()
    result = await doppelganger.execute(dispatch_input, ws_send=ws_send, task_id=task_id, user_context=user_context, system_prompt=system_prompt)
    return result.model_dump()
