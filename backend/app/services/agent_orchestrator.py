"""多Agent专家组系统 — 主Agent协调器"""
import asyncio
import json
import logging
import re
from typing import Dict, List, Optional, Callable, Awaitable

from app.services.ai_request_manager import ai_request_manager
from app.services.agent_prompts import (
    AGENT_TEMPLATE,
    DISCUSSION_TEMPLATE,
    AGENT_DEFINITIONS,
)
from app.agentscope_workflow_prompts import (
    INTENT_AGENT_PROMPT,
    PLANNER_AGENT_PROMPT,
    ASSEMBLER_AGENT_PROMPT,
)
from app.services.agent_tool_layer import invoke_tool, get_tool_descriptions
from app.services.toolagent_state import set_toolagent_task_id, clear_toolagent_task_id

# 导入技能系统注册（技能在 import 时自注册）
import app.services.agent_feedback_analyzer  # noqa: F401
from app.services.agent_skills import skill_registry

# AgentScope 集成
from agentscope.message import Msg
from agentscope.pipeline import MsgHub

logger = logging.getLogger(__name__)

AGENT_REGISTRY = {a["id"]: a for a in AGENT_DEFINITIONS if a.get("is_active", True)}


class Orchestrator:
    def __init__(self, user_id: int):
        self.user_id = user_id
        self._aborted = False
        self._current_todo_list: List[dict] = []
        self._agentscope_agents: Dict[str, object] = {}
        self._agentscope_workflow: Dict[str, object] = {}
        self._mode = "detailed"

    def register_agentscope_agents(self, agents: Dict[str, object]):
        self._agentscope_agents = agents
        logger.info(f"已注入 {len(agents)} 个子 Agent")

    def register_agentscope_workflow(self, workflow: Dict[str, object]):
        self._agentscope_workflow = workflow
        logger.info(f"已注入 3-Agent 工作流")

    @property
    def _enable_agentscope(self) -> bool:
        return len(self._agentscope_agents) > 0

    def _enable_workflow(self) -> bool:
        return len(self._agentscope_workflow) > 0

    def abort(self):
        self._aborted = True

    async def run_task(self, task_id: str, query: str, ws_send: Callable[[dict], Awaitable[None]],
                       context_history: str = "", mode: str = "detailed",
                       resume_todo_list: Optional[list] = None) -> str:
        """执行完整任务 — 3-Agent Pipeline
        
        resume_todo_list: 不为 None 时跳过 Intent/Planner，直接执行待办并汇编
        """
        self._aborted = False
        self._mode = mode

        if resume_todo_list is not None:
            self._current_todo_list = resume_todo_list
            return await self._execute_and_assemble(task_id, query, ws_send)

        # ===== 3-Agent 工作流路径（直接调用 AI，无需 AgentScope） =====
        return await self._run_workflow_pipeline(task_id, query, ws_send, context_history)

    async def _run_workflow_pipeline(self, task_id: str, query: str,
                                      ws_send, context_history: str = "") -> str:
        """3-Agent 工作流流水线：Intent → Planner → MsgHub执行 → Assembler"""
        active_agents = json.dumps([
            {"id": a["id"], "name": a["name"], "role_desc": a["role_desc"],
             "tools": a.get("tools", [])}
            for a in AGENT_REGISTRY.values()
        ], ensure_ascii=False, indent=2)

        # ===== 阶段1: IntentAgent（流式输出思考链） =====
        await ws_send({
            "type": "orchestrator_thinking", "task_id": task_id,
            "content": f"🤔 正在分析用户请求...\n{query}",
        })
        intent_parts = [f"用户请求: {query}"]
        intent_parts.append(f"\n\n## 可用的子Agent\n{active_agents}")
        if context_history:
            intent_parts.append(f"\n## 对话历史\n{context_history}")

        intent_messages = [
            {"role": "system", "content": INTENT_AGENT_PROMPT},
            {"role": "user", "content": "\n".join(intent_parts)},
        ]
        intent_text = ""
        try:
            async for chunk in ai_request_manager.make_request_stream(
                request_id=f"intent_{task_id}",
                messages=intent_messages, model="deepseek-v4-flash",
                reasoning_effort="high", temperature=0.3,
            ):
                if chunk["type"] == "reasoning":
                    await ws_send({
                        "type": "orchestrator_reasoning", "task_id": task_id,
                        "content": chunk['content'],
                    })
                elif chunk["type"] == "token":
                    intent_text += chunk["content"]
                elif chunk["type"] == "done":
                    break
        except Exception as e:
            logger.warning(f"IntentAgent 流式异常: {e}")

        # 更鲁棒的 JSON 提取
        def _extract_intent_json(raw: str) -> dict:
            t = raw.strip()
            for pat in [r'```json\s*([\s\S]*?)```', r'```\s*([\s\S]*?)```', r'(\{[\s\S]*\})']:
                m = re.search(pat, t)
                if m:
                    try:
                        return json.loads(m.group(1).strip())
                    except json.JSONDecodeError:
                        continue
            try:
                return json.loads(t)
            except json.JSONDecodeError:
                return {"intent": "direct_reply", "reply": raw.strip()}

        intent_data = _extract_intent_json(intent_text)
        intent_desc = intent_data.get("intent", "unknown")
        if intent_desc == "direct_reply":
            summary = f"📋 意图分析完成: 直答 → {intent_data.get('reply', '')[:80]}"
        else:
            summary = f"📋 意图分析完成: 规划路径 → {intent_data.get('query', '')[:80]}"
        await ws_send({
            "type": "orchestrator_thinking", "task_id": task_id,
            "content": summary,
        })

        if self._aborted:
            return "[任务已中断]"

        # 直答路径：直接使用意图分析的 reply 字段，不再额外调用 AI
        if intent_data.get("intent") == "direct_reply":
            reply = intent_data.get("reply", "我不知道如何回答")

            # 流式输出（兼容中英文）
            words = reply.split(" ")
            if len(words) > 1:
                # 英文/空格分隔文本 → 逐词
                for i, word in enumerate(words):
                    if self._aborted:
                        break
                    sep = " " if i < len(words) - 1 else ""
                    await ws_send({"type": "orchestrator_chunk", "task_id": task_id, "content": word + sep})
                    await asyncio.sleep(0.02)
            else:
                # 中文/无空格文本 → 逐字符
                for ch in reply:
                    if self._aborted:
                        break
                    await ws_send({"type": "orchestrator_chunk", "task_id": task_id, "content": ch})
                    await asyncio.sleep(0.025)

            await ws_send({"type": "orchestrator_summary", "task_id": task_id, "content": reply})

            tool_calls = intent_data.get("tool_calls", [])
            for tc in tool_calls:
                tool_name = tc.get("name", "")
                tool_params = tc.get("params", {})
                if not tool_name:
                    continue

                # 为意图分析注入前文上下文
                if tool_name == "dispatch_tool_agent":
                    context_parts = [f"## 用户原始请求\n{query}"]
                    if context_history:
                        context_parts.append(f"\n\n## 对话历史\n{context_history}")
                    if tool_params.get("summary"):
                        tool_params["summary"] = f"{context_parts[0]}\n\n## AI 回复\n{tool_params['summary']}"
                    tool_params["_user_context"] = "\n".join(context_parts)

                await ws_send({
                    "type": "orchestrator_thinking", "task_id": task_id,
                    "content": f"🔧 调用工具: {tool_name}",
                })
                try:
                    set_toolagent_task_id(self.user_id, task_id)
                    await invoke_tool(tool_name, tool_params, self.user_id, ws_send=ws_send, task_id=task_id)
                except Exception as e:
                    logger.warning(f"[{task_id}] 直答工具调用失败: {tool_name} - {e}")
                finally:
                    clear_toolagent_task_id(self.user_id)

            await ws_send({"type": "task_complete", "task_id": task_id, "summary": reply})

            # 直答内容加入长期记忆和上下文
            try:
                from app.services.agent_memory import AgentMemory
                await AgentMemory.update_after_task(self.user_id, query, reply, None)
            except Exception as e:
                logger.warning(f"[{task_id}] 直答记忆更新失败: {e}")

            return reply

        # ===== 阶段2: PlannerAgent（流式输出思考链） =====
        refined_query = intent_data.get("query", query)
        await ws_send({
            "type": "orchestrator_thinking", "task_id": task_id,
            "content": "📝 正在规划并行待办清单...",
        })
        planner_parts = [f"用户请求: {refined_query}"]
        planner_parts.append(f"\n\n## 可用的子Agent\n{active_agents}")
        planner_parts.append(f"\n## 意图分析结果\n{intent_text}")

        planner_messages = [
            {"role": "system", "content": PLANNER_AGENT_PROMPT},
            {"role": "user", "content": "\n".join(planner_parts)},
        ]
        planner_text = ""
        try:
            async for chunk in ai_request_manager.make_request_stream(
                request_id=f"planner_{task_id}",
                messages=planner_messages, model="deepseek-v4-flash",
                reasoning_effort="high", temperature=0.3,
            ):
                if chunk["type"] == "reasoning":
                    await ws_send({
                        "type": "orchestrator_reasoning", "task_id": task_id,
                        "content": chunk['content'],
                    })
                elif chunk["type"] == "token":
                    planner_text += chunk["content"]
                elif chunk["type"] == "done":
                    break
        except Exception as e:
            logger.warning(f"PlannerAgent 流式异常: {e}")

        # 更鲁棒的 JSON 提取：查找 ```json...```、```...```、或 {...} 结构
        def _extract_planner_json(raw: str) -> tuple[Optional[dict], str]:
            t = raw.strip()
            m = re.search(r'```json\s*([\s\S]*?)```', t)
            if m:
                candidate = m.group(1).strip()
                try:
                    return json.loads(candidate), candidate
                except json.JSONDecodeError:
                    pass
            m = re.search(r'```\s*([\s\S]*?)```', t)
            if m:
                candidate = m.group(1).strip()
                try:
                    return json.loads(candidate), candidate
                except json.JSONDecodeError:
                    pass
            m = re.search(r'(\{[\s\S]*\})', t)
            if m:
                candidate = m.group(1).strip()
                try:
                    return json.loads(candidate), candidate
                except json.JSONDecodeError:
                    pass
            try:
                return json.loads(t), t
            except json.JSONDecodeError:
                return None, t

        parsed_data, json_text = _extract_planner_json(planner_text)

        if parsed_data is not None:
            data = parsed_data
        else:
            logger.error(f"PlannerAgent 输出非JSON，生成默认 todo_list: {planner_text[:200]}")
            data = {"todo_list": []}

        todo_list = data.get("todo_list", [])
        if not todo_list:
            todo_list = [{
                "id": "main-1", "description": refined_query,
                "assignees": [],
                "depends_on": [],
                "subtasks": [{
                    "id": "sub-1-1", "description": refined_query,
                    "assignees": ["tutor_agent"], "tools_allowed": ["search_knowledge", "graph_qa"],
                }],
            }]

        # 扁平化主项+子项 → 平铺 todo_list（标记 is_main/parent_id）
        flat_todo_list = []
        for main in todo_list:
            subs = main.pop("subtasks", [])
            main.setdefault("is_main", True)
            main.setdefault("status", "pending")
            main.setdefault("output", "")
            main.setdefault("assignees", [])
            main.setdefault("depends_on", [])
            flat_todo_list.append(main)

            for sub in subs:
                sub.setdefault("status", "pending")
                sub.setdefault("output", "")
                sub.setdefault("depends_on", [])
                sub.setdefault("tools_allowed", [])
                sub["parent_id"] = main["id"]
                flat_todo_list.append(sub)

        # 兼容无子项的 todo_list（旧格式fallback）
        if not any(t.get("is_main") for t in flat_todo_list):
            for t in flat_todo_list:
                t.setdefault("assignees", ["tutor_agent"])
                t.setdefault("depends_on", [])
                t.setdefault("tools_allowed", [])
                t.setdefault("output", "")
                t.setdefault("is_main", False)

        for i, todo in enumerate(flat_todo_list):
            if "id" not in todo:
                todo["id"] = f"todo-{i+1}"

        todo_list = flat_todo_list

        self._current_todo_list = todo_list
        await ws_send({"type": "pipeline_checkpoint", "task_id": task_id, "todo_list": todo_list})
        return await self._execute_and_assemble(task_id, query, ws_send, context_history)

    async def _execute_and_assemble(self, task_id: str, query: str, ws_send, context_history: str = "") -> str:
        """执行 todo_list + Assembler 汇编（供 run_task 和 resume 共用）"""
        todo_list = self._current_todo_list
        if self._aborted:
            return "[任务已中断]"

        await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})

        # 推送规划结果
        plan_lines = "\n".join(f"- {t['description']}（{', '.join(AGENT_REGISTRY.get(a,{}).get('name',a) for a in t['assignees'])}）" for t in todo_list)
        await ws_send({
            "type": "orchestrator_thinking", "task_id": task_id,
            "content": f"🗂️ 规划 {len(todo_list)} 个并行待办:\n{plan_lines[:300]}",
        })

        # ===== 阶段3: 串行主项 + 并行子项 =====
        all_outputs = {}
        main_tasks = [t for t in todo_list if t.get("is_main")]
        subtask_map: Dict[str, list] = {}
        for t in todo_list:
            pid = t.get("parent_id")
            if pid:
                subtask_map.setdefault(pid, []).append(t)

        if main_tasks:
            # 主项串行执行（按 depends_on 确定顺序）
            main_batches = self._build_dependency_dag(main_tasks)
            await ws_send({
                "type": "orchestrator_thinking", "task_id": task_id,
                "content": f"🗂️ 共 {len(main_tasks)} 个主项，{sum(len(subtask_map.get(m['id'],[])) for m in main_tasks)} 个子项，按主项串行执行",
            })

            last_main_outputs: list = []
            for batch in main_batches:
                if self._aborted:
                    break
                for main in batch:
                    # 单一前置：仅注入上一个主项的子项产出（覆盖模式，不累积）
                    dep_context_parts = []
                    for desc, out in last_main_outputs:
                        if out:
                            dep_context_parts.append(f"### {desc}\n{out}")
                    dep_context = "\n\n".join(dep_context_parts)

                    subs = subtask_map.get(main["id"], [])
                    main["status"] = "doing"
                    for sub in subs:
                        sub["status"] = "doing"
                    await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})

                    if not subs:
                        result = await self._execute_todo(task_id, main, ws_send)
                        all_outputs[main["id"]] = result
                        last_main_outputs = [(main["description"], result or "")]
                    else:
                        all_valid = all(
                            sub.get("assignees") and len(sub["assignees"]) == 1
                            and sub["assignees"][0] in AGENT_REGISTRY
                            for sub in subs
                        )
                        if not all_valid:
                            for sub in subs:
                                sub["status"] = "failed"
                                sub["output"] = "[错误] 无可用Agent"
                            await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})
                        else:
                            async def run_sub(sub: dict, dep_ctx: str = dep_context) -> str:
                                aid = sub["assignees"][0]
                                agent = self._agentscope_agents.get(aid)
                                agent_info = AGENT_REGISTRY.get(aid, {})
                                if not agent and not agent_info:
                                    sub["status"] = "failed"
                                    sub["output"] = f"[错误] Agent {aid} 不可用"
                                    await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})
                                    return ""

                                sys_prompt = (getattr(agent, 'sys_prompt', '') if agent else '') or agent_info.get("system_prompt", "")

                                # 工具 Agent 特殊路径：每次新建实例支持并行分身
                                TOOL_AGENT_IDS = ['ppt_agent', 'pdf_word_agent', 'chart_agent']
                                if aid in TOOL_AGENT_IDS:
                                    from app.services.tool_agent import ToolAgent
                                    from app.mcp.tools.dispatch_tool_agent import DispatchInput, SpecItem

                                    depends_text = self._build_depends_text(sub)
                                    user_context_parts = []
                                    if dep_ctx:
                                        user_context_parts.append(f"## 前置主项产出\n{dep_ctx}")
                                    if depends_text:
                                        user_context_parts.append(f"## 前置输出（其他 Agent 已完成的产出，请在此基础上继续）\n{depends_text}")
                                    user_context = "\n\n".join(user_context_parts)

                                    doppelganger = ToolAgent()
                                    await doppelganger.start()
                                    system_prompt = agent_info.get("system_prompt", "")
                                    result = await doppelganger.execute(
                                        DispatchInput(
                                            specs=[SpecItem(agent_id=aid, output="", requirements=sub['description'], artifact_type="general")],
                                        ),
                                        ws_send=ws_send,
                                        task_id=task_id,
                                        user_id=self.user_id,
                                        user_context=user_context,
                                        system_prompt=system_prompt,
                                    )

                                    sub["status"] = "done"

                                    final_output = result.summary
                                    if result.artifacts:
                                        artifact_lines = [f"- {a.type}: {a.title}" for a in result.artifacts]
                                        final_output += "\n\n**生成产物:**\n" + "\n".join(artifact_lines)

                                    sub["output"] = final_output

                                    await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})

                                    await ws_send({
                                        "type": "agent_message", "task_id": task_id,
                                        "agent_id": aid, "todo_id": sub.get("id", ""),
                                        "agent_name": agent_info.get("name", aid),
                                        "agent_icon": agent_info.get("icon", "🤖"),
                                        "content": final_output, "tool_calls": [], "done": True,
                                    })
                                    return final_output

                                depends_text = self._build_depends_text(sub)
                                tools_text = get_tool_descriptions(sub.get("tools_allowed", []))

                                parts = [f"## 当前任务\n{sub['description']}"]
                                if tools_text:
                                    parts.append(f"## 可用工具\n{tools_text}")
                                if dep_ctx:
                                    parts.append(f"## 前置主项产出\n{dep_ctx}")
                                if depends_text:
                                    parts.append(f"## 前置输出（其他 Agent 已完成的产出，请在此基础上继续）\n{depends_text}")

                                messages = [
                                    {"role": "system", "content": sys_prompt},
                                    {"role": "user", "content": "\n\n".join(parts)},
                                ]

                                await ws_send({
                                    "type": "agent_start", "task_id": task_id,
                                    "agent_id": aid, "todo_id": sub.get("id", ""),
                                    "agent_name": agent_info.get("name", aid),
                                })
                                await ws_send({
                                    "type": "agent_message", "task_id": task_id,
                                    "agent_id": aid, "todo_id": sub.get("id", ""),
                                    "agent_name": agent_info.get("name", aid),
                                    "agent_icon": agent_info.get("icon", "🤖"),
                                    "content": "", "tool_calls": [], "done": False,
                                })

                                tool_history = []
                                iteration = 0
                                while True:
                                    if self._aborted:
                                        sub["output"] = sub.get("output") or "[中断]"
                                        sub["status"] = "failed"
                                        await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})
                                        return "[中断]"

                                    logger.info(f"[{task_id}] 子项 {sub['id']} Agent {aid} 流式调用第{iteration}轮")
                                    full_content = ""
                                    reasoning_content = None
                                    error = None

                                    max_retries = 3
                                    for retry in range(max_retries):
                                        full_content = ""
                                        reasoning_content = None
                                        error = None
                                        try:
                                            stream_gen = ai_request_manager.make_request_stream(
                                                request_id=f"sub_{task_id}_{aid}_{iteration}",
                                                messages=messages, model="deepseek-v4-flash",
                                                reasoning_effort="high", temperature=0.3,
                                            )
                                            async for chunk in stream_gen:
                                                if chunk["type"] == "token":
                                                    full_content += chunk["content"]
                                                    await ws_send({
                                                        "type": "agent_chunk", "task_id": task_id,
                                                        "agent_id": aid, "todo_id": sub.get("id", ""),
                                                        "content": chunk["content"],
                                                    })
                                                elif chunk["type"] == "reasoning":
                                                    reasoning_content = (reasoning_content or "") + chunk.get("content", "")
                                                elif chunk["type"] == "done":
                                                    break
                                                elif chunk["type"] == "error":
                                                    error = chunk.get("message", "stream error")
                                                    logger.warning(f"[{task_id}] 子项 {sub['id']} 流错误: {error}")
                                                    break
                                        except Exception as e:
                                            error = str(e)
                                            logger.warning(f"[{task_id}] 子项 {sub['id']} 流异常: {error}")

                                        if not error:
                                            break
                                        if retry < max_retries - 1:
                                            wait = 2 ** retry
                                            logger.info(f"[{task_id}] 子项 {sub['id']} 第{retry+1}次重试，等待{wait}s...")
                                            await asyncio.sleep(wait)

                                    iteration += 1

                                    if error or not full_content:
                                        if not full_content:
                                            sub["output"] = f"[错误] {aid} 无响应"
                                            sub["status"] = "failed"
                                            await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})
                                            return ""
                                        final_output = self._extract_final_output(full_content)
                                        sub["output"] = final_output
                                        sub["status"] = "done"
                                        await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})
                                        await ws_send({
                                            "type": "agent_message", "task_id": task_id,
                                            "agent_id": aid, "todo_id": sub.get("id", ""),
                                            "agent_name": agent_info.get("name", aid),
                                            "agent_icon": agent_info.get("icon", "🤖"),
                                            "content": final_output, "tool_calls": tool_history, "done": True,
                                        })
                                        return final_output

                                    tool_calls = self._parse_tool_calls(full_content)
                                    if tool_calls:
                                        thinking_step = self._extract_thinking(full_content)
                                        if thinking_step:
                                            await ws_send({
                                                "type": "agent_message", "task_id": task_id,
                                                "agent_id": aid, "todo_id": sub.get("id", ""),
                                                "agent_name": agent_info.get("name", aid),
                                                "agent_icon": agent_info.get("icon", "🤖"),
                                                "content": thinking_step, "tool_calls": [], "done": False,
                                            })
                                        # 先推送所有 tool_call 事件（立即展示给前端）
                                        for tc in tool_calls:
                                            tool_name, tool_params = tc["name"], tc["params"]
                                            tool_params.setdefault("user_id", self.user_id)
                                            await ws_send({
                                                "type": "tool_call", "task_id": task_id,
                                                "agent_id": aid, "tool": tool_name,
                                                "input": tool_params,
                                            })
                                        # 并行执行所有工具调用
                                        async def exec_one(tc: dict) -> dict:
                                            name = tc["name"]
                                            params = tc["params"]
                                            params.setdefault("user_id", self.user_id)
                                            result = await invoke_tool(name, params, self.user_id)
                                            return {"tool": name, "input": params, "output": result}
                                        tool_results = await asyncio.gather(
                                            *[exec_one(tc) for tc in tool_calls],
                                            return_exceptions=True,
                                        )
                                        # 收集结果
                                        for res in tool_results:
                                            if isinstance(res, Exception):
                                                tool_history.append({
                                                    "tool": "unknown", "input": {},
                                                    "output": f"[并行执行异常: {res}]",
                                                })
                                            else:
                                                tool_history.append(res)
                                        # 仅追加一次 assistant 消息 + 所有工具结果
                                        asst_msg = {"role": "assistant", "content": full_content}
                                        if reasoning_content:
                                            asst_msg["reasoning_content"] = reasoning_content
                                        messages.append(asst_msg)
                                        for tc, res in zip(tool_calls, tool_results):
                                            result_str = str(res) if isinstance(res, Exception) else res
                                            messages.append({
                                                "role": "user",
                                                "content": f"[工具返回: {tc['name']}]\n{result_str}",
                                            })
                                        await ws_send({
                                            "type": "tool_call_result", "task_id": task_id,
                                            "agent_id": aid,
                                            "calls": tool_history,
                                        })
                                    else:
                                        final_output = self._extract_final_output(full_content)
                                        sub["output"] = final_output
                                        sub["status"] = "done"
                                        await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})
                                        await ws_send({
                                            "type": "agent_message", "task_id": task_id,
                                            "agent_id": aid, "todo_id": sub.get("id", ""),
                                            "agent_name": agent_info.get("name", aid),
                                            "agent_icon": agent_info.get("icon", "🤖"),
                                            "content": final_output, "tool_calls": tool_history, "done": True,
                                        })
                                        return final_output

                                return ""

                            # 并行执行所有子项
                            sub_tasks = [run_sub(sub) for sub in subs]
                            sub_results = await asyncio.gather(*sub_tasks, return_exceptions=True)
                            for sub, result in zip(subs, sub_results):
                                if isinstance(result, Exception):
                                    logger.warning(f"[{task_id}] 子项 {sub['id']} 异常: {result}")
                                    sub["output"] = f"[执行异常: {result}]"
                                    sub["status"] = "failed"
                                elif result and result != "[中断]":
                                    all_outputs[sub["id"]] = result
                                else:
                                    sub["output"] = sub.get("output") or "[无输出]"
                                    sub["status"] = "failed" if result == "[中断]" else "done" if sub.get("output") else "failed"

                            await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})

                            # 累积模式：当前主项的子项产出追加到 last_main_outputs
                            current_outputs = [
                                (sub["description"], sub.get("output", ""))
                                for sub in subs
                            ]
                            last_main_outputs.extend(current_outputs)

                    main["status"] = "done"
                await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})

            # 发送规划总结
            plan_lines = "\n".join(
                f"- {t['description']}（{', '.join(AGENT_REGISTRY.get(a,{}).get('name',a) for a in t['assignees'])}）"
                for t in todo_list if t.get("is_main")
            )
            await ws_send({
                "type": "orchestrator_thinking", "task_id": task_id,
                "content": f"✅ 主项执行完成，共 {len(main_tasks)} 个主项，{len(all_outputs)} 项产出",
            })
        else:
            # 无主项标记，退化并行（兼容旧格式 fallback）
            await ws_send({
                "type": "orchestrator_thinking", "task_id": task_id,
                "content": f"🗂️ 共 {len(todo_list)} 个待办，并行执行",
            })
            if all(
                t.get("assignees") and len(t["assignees"]) == 1
                and t["assignees"][0] in AGENT_REGISTRY
                for t in todo_list
            ):
                all_outputs = await self._run_parallel_agentscope(
                    task_id, todo_list, ws_send, query, context_history
                )
            else:
                for todo in todo_list:
                    todo["status"] = "failed"
                    todo["output"] = "[错误] 无可用Agent"
                await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})

        if self._aborted or not all_outputs:
            for t in todo_list:
                if t["status"] not in ("done", "failed"):
                    t["status"] = "failed"
            if self._aborted:
                await ws_send({"type": "task_error", "task_id": task_id, "message": "用户中断"})
                return "[任务已中断]"
            # 即使有失败的 Agent，也尝试汇编（部分结果好过无结果）
            if not any(t.get("output") for t in todo_list):
                await ws_send({"type": "task_error", "task_id": task_id, "message": "无Agent产出"})
                return "[无产出]"

        # ===== 阶段4: AssemblerAgent（AI汇总，衔接各Agent产出） =====
        outputs_text = ""
        for todo in todo_list:
            if not todo.get("output"):
                continue
            if todo.get("is_main"):
                continue
            aid = todo.get("assignees", [""])[0]
            agent_name = AGENT_REGISTRY.get(aid, {}).get("name", aid)
            output = todo.get("output", "")
            if output:
                outputs_text += f"\n\n## {agent_name}\n{output}"

        await ws_send({
            "type": "orchestrator_thinking", "task_id": task_id,
            "content": f"✍️ 正在衔接 {len([t for t in todo_list if t.get('output')])} 个Agent的产出...",
        })

        if self._mode == "concise":
            assembler_prompt = f"""你是一个内容总结助手。你的任务是将多个专家Agent的产出**总结为简洁的要点**，形成一个连贯、完整的回答。

## 规则（严格遵守）
1. **总结要点** — 提取每个Agent的核心信息，用简洁的语言呈现
2. **保留关键数据** — 不要丢掉重要的数据、定义、机制描述
3. **按主题重组** — 不要按Agent分块，按主题/逻辑顺序组织
4. **保留表格** — 如果Agent以表格形式输出了结构化信息，请完整保留该表格
5. **控制字数** — 总字数不超过600字
6. **工具调度员产出简化** — 工具调度员的输出包含工具调用细节，只需说明它最终产出了什么（如"已生成PPT《xxx》"、"已导出PDF文档"等），不要罗列其执行步骤

## 输出格式
先用1-2句总体引语概括回答，然后以要点形式呈现核心内容。"""
        else:
            assembler_prompt = f"""你是一个内容衔接助手。你的任务是将多个专家Agent的产出**自然地衔接在一起**，形成一个连贯、完整的回答。

## 规则（严格遵守）
1. **不要新增内容** — 不要添加任何专家没有提到的信息、解释或建议
2. **不要删除任何内容** — 保留每个Agent产出的全部要点，包括表格、列表等结构化格式
3. **完整保留表格** — 如果Agent以表格形式输出了结构化信息，请**完整保留该表格**，不要压缩或改写
4. **只做衔接和整理** — 用过渡语句连接各部分，按逻辑顺序排列
5. **如果多个Agent有相似内容**，合并去重但保留信息量
6. **保留各Agent的输出格式** — 不要改写或压缩原内容
7. **工具调度员产出简化** — 工具调度员的输出包含工具调用细节，只需说明它最终产出了什么（如"已生成PPT《xxx》"、"已导出PDF文档"等），不要罗列其执行步骤

## 输出格式
先用1-2句总体引语概括回答，然后按逻辑顺序呈现各Agent的产出，各部分之间用自然的过渡语句连接。"""

        assembler_user_text = f"## 用户原始请求\n{query}\n\n## 各子Agent输出\n{outputs_text}"

        logger.info(f"[{task_id}] 开始流式汇编")
        full_content = ""
        stream_count = 0
        try:
            stream_messages = [
                {"role": "system", "content": assembler_prompt},
                {"role": "user", "content": assembler_user_text},
            ]
            async for chunk in ai_request_manager.make_request_stream(
                request_id=f"assembler_{task_id}",
                messages=stream_messages,
                model="deepseek-v4-flash",
                temperature=0.3,
            ):
                if chunk["type"] == "reasoning":
                    await ws_send({
                        "type": "orchestrator_reasoning", "task_id": task_id,
                        "content": chunk['content'],
                    })
                elif chunk["type"] == "token":
                    stream_count += 1
                    full_content += chunk["content"]
                    await ws_send({"type": "orchestrator_chunk", "task_id": task_id, "content": chunk["content"]})
                elif chunk["type"] == "done":
                    break
            logger.info(f"[{task_id}] 流式完成，共 {stream_count} 个chunk")
        except Exception as e:
            logger.warning(f"流式汇编降级: {e}")
            full_content = outputs_text.strip()

        if not full_content.strip():
            full_content = outputs_text.strip() or "无Agent产出"

        await ws_send({"type": "orchestrator_summary", "task_id": task_id, "content": full_content})
        await ws_send({"type": "task_complete", "task_id": task_id, "summary": full_content})

        # 更新长期记忆
        try:
            from app.services.agent_memory import AgentMemory
            await AgentMemory.update_after_task(
                self.user_id, query, full_content, None
            )
        except Exception as e:
            logger.warning(f"记忆更新失败: {e}")

        return full_content

    def _build_dependency_dag(self, todo_list: list) -> list:
        batches = []
        completed = set()
        while len(completed) < len(todo_list):
            batch = []
            for todo in todo_list:
                if todo["id"] in completed:
                    continue
                if all(dep in completed for dep in todo.get("depends_on", [])):
                    todo["batch"] = len(batches) + 1
                    batch.append(todo)
            if not batch:
                logger.error(f"DAG死锁: {[t['id'] for t in todo_list if t['id'] not in completed]}")
                for t in todo_list:
                    if t["id"] not in completed:
                        t["batch"] = len(batches) + 1
                        batch.append(t)
            batches.append(batch)
            for todo in batch:
                completed.add(todo["id"])
        return batches

    async def _execute_todo(self, task_id: str, todo: dict, ws_send) -> str:
        agents = todo.get("assignees", [])
        if len(agents) <= 1:
            return await self._run_single_agent(task_id, todo, ws_send)
        else:
            return await self._run_discussion_mode(task_id, todo, ws_send)

    async def _run_single_agent(self, task_id: str, todo: dict, ws_send) -> str:
        agent_id = todo["assignees"][0] if todo.get("assignees") else "tutor_agent"
        agent_info = AGENT_REGISTRY.get(agent_id)
        if not agent_info:
            error_msg = f"[错误] 未知Agent: {agent_id}"
            todo["output"] = error_msg
            todo["status"] = "failed"
            return error_msg

        # AgentScope 路径（渐进式替换）
        if self._enable_agentscope and agent_id in self._agentscope_agents:
            return await self._execute_agentscope_agent(task_id, agent_id, todo, ws_send)

        depends_text = self._build_depends_text(todo)
        tools_text = get_tool_descriptions(todo.get("tools_allowed", []))
        overview_text = self._build_overview_text(todo)

        await ws_send({
            "type": "agent_start", "task_id": task_id,
            "agent_id": agent_id, "todo_id": todo.get("id",""), "agent_name": agent_info.get("name", agent_id),
        })
        await ws_send({
            "type": "agent_message", "task_id": task_id,
            "agent_id": agent_id, "todo_id": todo.get("id",""),
            "agent_name": agent_info.get("name", agent_id),
            "agent_icon": agent_info.get("icon", "🤖"),
            "content": "", "tool_calls": [], "done": False,
        })

        system_prompt = AGENT_TEMPLATE.format(
            name=agent_info["name"],
            role_desc=agent_info["role_desc"],
            capabilities=agent_info["system_prompt"],
            user_query="（见全局计划摘要）",
            todo_list_overview=overview_text,
            todo_description=todo["description"],
            depends_on_outputs=depends_text or "（无前置，可自行检索）",
            tools_list=tools_text or "无可用工具",
        )

        return await self._agent_loop(task_id, agent_id, system_prompt, todo, ws_send)

    async def _execute_agentscope_agent(self, task_id: str, agent_id: str,
                                         todo: dict, ws_send) -> str:
        """使用流式输出执行 AgentScope Agent"""
        agent = self._agentscope_agents[agent_id]
        agent_info = AGENT_REGISTRY.get(agent_id, {})
        depends_text = self._build_depends_text(todo)
        overview_text = self._build_overview_text(todo)
        sys_prompt = getattr(agent, 'sys_prompt', '') or agent_info.get("system_prompt", "")
        tools_text = get_tool_descriptions(todo.get("tools_allowed", []))

        parts = [f"## 当前任务\n{todo['description']}"]
        if tools_text:
            parts.append(f"## 可用工具\n{tools_text}")
        if depends_text:
            parts.append(f"## 前置输出（其他 Agent 已完成的产出，请在此基础上继续）\n{depends_text}")
        parts.append(overview_text)

        messages = [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": "\n\n".join(parts)},
        ]

        await ws_send({
            "type": "agent_start", "task_id": task_id,
            "agent_id": agent_id, "todo_id": todo.get("id",""), "agent_name": agent_info.get("name", agent_id),
        })

        await ws_send({
            "type": "agent_message", "task_id": task_id,
            "agent_id": agent_id, "todo_id": todo.get("id",""),
            "agent_name": agent_info.get("name", agent_id),
            "agent_icon": agent_info.get("icon", "🤖"),
            "content": "", "tool_calls": [], "done": False,
        })

        full_content = ""
        try:
            stream_gen = ai_request_manager.make_request_stream(
                request_id=f"as_{task_id}_{agent_id}",
                messages=messages, model="deepseek-v4-flash",
                reasoning_effort="high", temperature=0.3,
            )
            async for chunk in stream_gen:
                if chunk["type"] == "token":
                    full_content += chunk["content"]
                    await ws_send({
                        "type": "agent_chunk", "task_id": task_id,
                        "agent_id": agent_id, "content": chunk["content"],
                        "todo_id": todo.get("id", ""),
                    })
                elif chunk["type"] == "done":
                    break
        except Exception as e:
            logger.warning(f"AgentScope {agent_id} 流式异常: {e}")

        output = full_content or "[无输出]"
        todo["output"] = output
        todo["status"] = "done"
        await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": [todo]})
        await ws_send({
            "type": "agent_message", "task_id": task_id,
            "agent_id": agent_id, "todo_id": todo.get("id",""),
            "agent_name": agent_info.get("name", agent_id),
            "agent_icon": agent_info.get("icon", "🤖"),
            "content": output, "tool_calls": [], "done": True,
        })
        return output

    async def _run_discussion_mode(self, task_id: str, todo: dict, ws_send) -> str:
        agent_ids = todo.get("assignees", [])

        # AgentScope MsgHub 路径：所有参与者都已注册为 ReActAgent
        if self._enable_agentscope and all(aid in self._agentscope_agents for aid in agent_ids):
            return await self._run_agentscope_discussion(task_id, agent_ids, todo, ws_send)

        agents_info = {a: AGENT_REGISTRY.get(a) for a in agent_ids}
        agents_info = {k: v for k, v in agents_info.items() if v}
        if not agents_info:
            return "[错误] 所有Agent不可用"

        # 推送 workflow 节点初始化
        node_list = [
            {"id": aid, "data": {"agent_id": aid, "agent_name": info["name"],
             "agent_icon": info.get("icon", "🤖"), "status": "active"}}
            for aid, info in agents_info.items()
        ]
        await ws_send({"type": "workflow_nodes", "task_id": task_id, "nodes": node_list})

        queue: asyncio.Queue = asyncio.Queue(maxsize=50)
        depends_text = self._build_depends_text(todo)
        tools_text = get_tool_descriptions(todo.get("tools_allowed", []))
        overview_text = self._build_overview_text(todo)

        initial_message = (
            f"## 待办项\n{todo['description']}\n\n"
            f"## 前置输出（其他 Agent 已完成的产出，请在此基础上继续）\n{depends_text or '（无前置）'}\n\n"
            f"各位专家请从各自专业视角出发讨论。"
        )
        await queue.put(initial_message)

        await ws_send({
            "type": "discussion_start", "task_id": task_id,
            "participants": list(agents_info.keys()),
        })

        results = {}

        async def agent_participant(aid: str, agent: dict):
            discussion_history = initial_message
            agent_ids_list = list(agents_info.keys())
            for round_idx in range(5):
                if self._aborted:
                    return
                system_prompt = DISCUSSION_TEMPLATE.format(
                    name=agent["name"],
                    role_desc=agent["role_desc"],
                    capabilities=agent["system_prompt"],
                    user_query="（见全局计划摘要）",
                    todo_list_overview=overview_text,
                    todo_description=todo["description"],
                    depends_on_outputs=depends_text or "（无前置）",
                    tools_list=tools_text or "无可用工具",
                    discussion_history=discussion_history,
                )
                messages = [{"role": "system", "content": system_prompt}]
                # 推送 thinking 状态
                await ws_send({"type": "workflow_node_update", "task_id": task_id, "node_id": aid, "status": "thinking"})

                response = await ai_request_manager.make_request(
                    request_id=f"discuss_{task_id}_{aid}_{round_idx}",
                    messages=messages, model="deepseek-v4-flash",
                    reasoning_effort="high", temperature=0.3,
                )
                if not response:
                    return

                tool_calls = self._parse_tool_calls(response)
                for tc in tool_calls:
                    tool_name, tool_params = tc["name"], tc["params"]
                    tool_params.setdefault("user_id", self.user_id)
                    tool_result = await invoke_tool(tool_name, tool_params, self.user_id)
                    response += f"\n[工具返回: {tool_name}]\n{tool_result}"

                # 推送 workflow 边（指向列表中下一个Agent，形成循环）
                idx = agent_ids_list.index(aid)
                next_aid = agent_ids_list[(idx + 1) % len(agent_ids_list)]
                await ws_send({
                    "type": "workflow_edge", "task_id": task_id,
                    "edge_id": f"edge_{aid}_{round_idx}",
                    "from": aid, "to": next_aid,
                    "content": response[:500],
                })
                # 推送 waiting 状态
                await ws_send({
                    "type": "workflow_node_update", "task_id": task_id,
                    "node_id": aid, "status": "waiting",
                })

                await ws_send({
                    "type": "discussion_message", "task_id": task_id,
                    "from": aid, "content": response,
                })

                discussion_history += f"\n\n### {agent['name']}（第{round_idx+1}轮）\n{response}"

                if "【收敛自评】" in response and "应结束" in response.split("【收敛自评】")[-1][:20]:
                    results[aid] = response
                    return

                await queue.put(response)

            results[aid] = response

        async def discussion_coordinator():
            tasks = [agent_participant(aid, info) for aid, info in agents_info.items()]
            await asyncio.gather(*tasks)

        try:
            await asyncio.wait_for(discussion_coordinator(), timeout=120)
        except asyncio.TimeoutError:
            logger.warning(f"讨论超时: task={task_id}")
            if not results:
                return "[讨论超时，部分结果可能不完整]"

        # 推送最终状态
        for aid in agents_info:
            await ws_send({
                "type": "workflow_node_update", "task_id": task_id,
                "node_id": aid, "status": "active",
            })

        await ws_send({
            "type": "discussion_end", "task_id": task_id,
            "participants": list(results.keys()),
        })

        conclusion = self._extract_discussion_conclusion(list(results.values()))
        todo["output"] = conclusion
        todo["status"] = "done"
        await ws_send({
            "type": "agent_message", "task_id": task_id,
            "agent_id": "discussion", "agent_name": "专家讨论",
            "agent_icon": "💬",
            "content": conclusion, "tool_calls": [], "done": True,
        })
        return conclusion

    async def _run_agentscope_discussion(self, task_id: str, agent_ids: list,
                                          todo: dict, ws_send) -> str:
        """使用 AgentScope MsgHub 实现实时广播讨论"""
        participants = [self._agentscope_agents[aid] for aid in agent_ids if aid in self._agentscope_agents]
        if not participants:
            return "[错误] 无可用Agent"

        agent_ids_in_hub = [aid for aid in agent_ids if aid in self._agentscope_agents]
        agents_info = {aid: AGENT_REGISTRY.get(aid, {}) for aid in agent_ids_in_hub}
        depends_text = self._build_depends_text(todo)
        overview_text = self._build_overview_text(todo)

        # 推送 workflow 节点初始化
        node_list = [
            {"id": aid, "data": {"agent_id": aid, "agent_name": info.get("name", aid),
             "agent_icon": info.get("icon", "🤖"), "status": "active"}}
            for aid, info in agents_info.items()
        ]
        await ws_send({"type": "workflow_nodes", "task_id": task_id, "nodes": node_list})
        await ws_send({
            "type": "discussion_start", "task_id": task_id,
            "participants": agent_ids_in_hub,
        })

        topic = (
            f"## 当前任务\n{todo['description']}\n\n"
            f"## 前置输出（其他 Agent 已完成的产出，请在此基础上继续）\n{depends_text or '（无前置）'}\n\n"
        )
        responses = {aid: "" for aid in agent_ids_in_hub}

        async with MsgHub(
            participants=participants,
            announcement=Msg("system", topic, "system"),
            enable_auto_broadcast=True,
        ) as hub:
            for round_idx in range(5):
                if self._aborted:
                    break
                for idx, (aid, agent) in enumerate(zip(agent_ids_in_hub, participants)):
                    if self._aborted:
                        break
                    await ws_send({
                        "type": "workflow_node_update", "task_id": task_id,
                        "node_id": aid, "status": "thinking",
                    })
                    try:
                        result = await agent()
                        text = result.get_text_content() if hasattr(result, "get_text_content") else str(result)
                    except Exception as e:
                        text = f"[Agent {aid} 响应异常: {e}]"
                        logger.warning(f"AgentScope讨论 {aid} 第{round_idx}轮错误: {e}")

                    responses[aid] = text

                    # 推送 workflow 边
                    next_aid = agent_ids_in_hub[(idx + 1) % len(agent_ids_in_hub)]
                    await ws_send({
                        "type": "workflow_edge", "task_id": task_id,
                        "edge_id": f"edge_{aid}_{round_idx}_as",
                        "from": aid, "to": next_aid,
                        "content": text[:500],
                    })
                    await ws_send({
                        "type": "workflow_node_update", "task_id": task_id,
                        "node_id": aid, "status": "waiting",
                    })
                    await ws_send({
                        "type": "discussion_message", "task_id": task_id,
                        "from": aid, "content": text,
                    })

        # 推送最终状态
        for aid in agents_info:
            await ws_send({
                "type": "workflow_node_update", "task_id": task_id,
                "node_id": aid, "status": "active",
            })
        await ws_send({
            "type": "discussion_end", "task_id": task_id,
            "participants": list(responses.keys()),
        })

        conclusion = self._extract_discussion_conclusion(list(responses.values()))
        todo["output"] = conclusion
        todo["status"] = "done"
        await ws_send({
            "type": "agent_message", "task_id": task_id,
            "agent_id": "discussion", "agent_name": "专家讨论",
            "agent_icon": "💬",
            "content": conclusion, "tool_calls": [], "done": True,
        })
        return conclusion

    async def _run_parallel_agentscope(self, task_id: str, todo_list: list,
                                        ws_send, query: str,
                                        context_history: str = "") -> dict:
        """所有待办的 Agent 使用手动循环并行执行，无迭代/工具调用上限"""
        for todo in todo_list:
            todo["status"] = "doing"
        await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})

        async def run_single(aid: str, todo: dict) -> str:
            agent = self._agentscope_agents.get(aid)
            agent_info = AGENT_REGISTRY.get(aid, {})
            if not agent and not agent_info:
                todo["status"] = "failed"
                todo["output"] = f"[错误] Agent {aid} 不可用"
                await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})
                return ""

            sys_prompt = (getattr(agent, 'sys_prompt', '') if agent else '') or agent_info.get("system_prompt", "")

            depends_text = self._build_depends_text(todo)
            tools_text = get_tool_descriptions(todo.get("tools_allowed", []))

            parts = [f"## 当前任务\n{todo['description']}"]
            if tools_text:
                parts.append(f"## 可用工具\n{tools_text}")
            if depends_text:
                parts.append(f"## 前置输出（其他 Agent 已完成的产出，请在此基础上继续）\n{depends_text}")

            messages = [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": "\n\n".join(parts)},
            ]

            await ws_send({
                "type": "agent_start", "task_id": task_id,
                "agent_id": aid, "todo_id": todo.get("id",""), "agent_name": agent_info.get("name", aid),
            })

            # 先发送空消息创建气泡，让后续 agent_chunk 有地方显示
            await ws_send({
                "type": "agent_message", "task_id": task_id,
                "agent_id": aid, "todo_id": todo.get("id",""),
                "agent_name": agent_info.get("name", aid),
                "agent_icon": agent_info.get("icon", "🤖"),
                "content": "", "tool_calls": [], "done": False,
            })

            tool_history = []
            iteration = 0

            while True:
                if self._aborted:
                    todo["output"] = todo.get("output") or "[中断]"
                    todo["status"] = "failed"
                    await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})
                    return "[中断]"

                logger.info(f"[{task_id}] Agent {aid} 开始流式调用，第{iteration}轮")
                full_content = ""
                reasoning_content = None
                error = None

                try:
                    stream_gen = ai_request_manager.make_request_stream(
                        request_id=f"agent_{task_id}_{aid}_{iteration}",
                        messages=messages, model="deepseek-v4-flash",
                        reasoning_effort="high", temperature=0.3,
                    )
                    async for chunk in stream_gen:
                        if chunk["type"] == "token":
                            token = chunk["content"]
                            full_content += token
                            await ws_send({
                                "type": "agent_chunk", "task_id": task_id,
                                "agent_id": aid, "todo_id": todo.get("id",""), "content": token,
                            })
                        elif chunk["type"] == "reasoning":
                            reasoning_content = (reasoning_content or "") + chunk.get("content", "")
                        elif chunk["type"] == "done":
                            break
                        elif chunk["type"] == "error":
                            error = chunk.get("message", "stream error")
                            logger.warning(f"[{task_id}] Agent {aid} 流错误: {error}")
                            break
                except Exception as e:
                    error = str(e)
                    logger.warning(f"[{task_id}] Agent {aid} 流异常: {error}")

                iteration += 1

                if error or not full_content:
                    if not full_content:
                        todo["output"] = f"[错误] {aid} 无响应"
                        todo["status"] = "failed"
                        await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})
                        return ""
                    final_output = self._extract_final_output(full_content)
                    todo["output"] = final_output
                    todo["status"] = "done"
                    await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})
                    await ws_send({
                        "type": "agent_message", "task_id": task_id,
                        "agent_id": aid, "todo_id": todo.get("id",""),
                        "agent_name": agent_info.get("name", aid),
                        "agent_icon": agent_info.get("icon", "🤖"),
                        "content": final_output, "tool_calls": tool_history, "done": True,
                    })
                    return final_output

                tool_calls = self._parse_tool_calls(full_content)
                if tool_calls:
                    thinking_step = self._extract_thinking(full_content)
                    if thinking_step:
                        await ws_send({
                            "type": "agent_message", "task_id": task_id,
                            "agent_id": aid, "todo_id": todo.get("id",""),
                            "agent_name": agent_info.get("name", aid),
                            "agent_icon": agent_info.get("icon", "🤖"),
                            "content": thinking_step, "tool_calls": [], "done": False,
                        })
                    asst_msg = {"role": "assistant", "content": full_content}
                    if reasoning_content:
                        asst_msg["reasoning_content"] = reasoning_content
                    for tc in tool_calls:
                        tool_name, tool_params = tc["name"], tc["params"]
                        tool_params.setdefault("user_id", self.user_id)
                        await ws_send({
                            "type": "tool_call", "task_id": task_id,
                            "agent_id": aid, "tool": tool_name,
                            "input": tool_params,
                        })
                        tool_result = await invoke_tool(tool_name, tool_params, self.user_id)
                        tool_history.append({
                            "tool": tool_name, "input": tool_params,
                            "output": tool_result,
                        })
                    messages.append(asst_msg)
                    for entry in tool_history:
                        messages.append({
                            "role": "user",
                            "content": f"[工具返回: {entry['tool']}]\n{entry['output']}",
                        })
                    await ws_send({
                        "type": "tool_call_result", "task_id": task_id,
                        "agent_id": aid,
                        "calls": tool_history,
                    })
                else:
                    final_output = self._extract_final_output(full_content)
                    todo["output"] = final_output
                    todo["status"] = "done"
                    await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})
                    await ws_send({
                        "type": "agent_message", "task_id": task_id,
                        "agent_id": aid, "todo_id": todo.get("id",""),
                        "agent_name": agent_info.get("name", aid),
                        "agent_icon": agent_info.get("icon", "🤖"),
                        "content": final_output, "tool_calls": tool_history, "done": True,
                    })
                    return final_output

            return ""

        all_outputs = {}
        tasks = []
        for todo in todo_list:
            aid = todo["assignees"][0]
            tasks.append(run_single(aid, todo))

        if not tasks:
            await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})
            return {}

        results = await asyncio.gather(*tasks, return_exceptions=True)

        for todo, result in zip(todo_list, results):
            if isinstance(result, Exception):
                logger.warning(f"[{task_id}] Agent {todo['assignees'][0]} 异常: {result}")
                todo["output"] = f"[执行异常: {result}]"
                todo["status"] = "failed"
            elif result:
                all_outputs[todo["id"]] = result
                todo["output"] = result
                todo["status"] = "done" if result != "[中断]" else "failed"
            else:
                todo["output"] = todo.get("output") or "[无输出]"
                todo["status"] = "failed"

        await ws_send({"type": "todo_update", "task_id": task_id, "todo_list": todo_list})
        logger.info(f"[{task_id}] 并行执行完成，{len(all_outputs)}/{len(todo_list)} 个待办产出")
        return all_outputs

    def _extract_discussion_conclusion(self, responses: list) -> str:
        lines = ["## 💬 讨论结论"]
        for r in responses:
            m = re.search(r'【立场陈述】\s*\n*(.*?)(?=\n【收敛自评】|\Z)', r, re.DOTALL)
            if m:
                lines.append(f"- {m.group(1).strip()[:300]}")
        if len(lines) <= 1:
            lines.append("（讨论完成，详见各Agent发言）")
        return "\n\n".join(lines)

    async def _agent_loop(self, task_id: str, agent_id: str, system_prompt: str,
                          todo: dict, ws_send) -> str:
        messages = [{"role": "system", "content": system_prompt}]
        tool_history = []
        iteration = 0

        while True:
            if self._aborted:
                return "[中断]"

            logger.info(f"[{task_id}] Agent {agent_id} 开始流式调用（旧路径），第{iteration}轮")
            full_content = ""
            reasoning_content = None
            error = None

            try:
                stream_gen = ai_request_manager.make_request_stream(
                    request_id=f"agent_{task_id}_{agent_id}_{iteration}",
                    messages=messages, model="deepseek-v4-flash",
                    reasoning_effort="high", temperature=0.3,
                )
                async for chunk in stream_gen:
                    if chunk["type"] == "token":
                        token = chunk["content"]
                        full_content += token
                        await ws_send({
                            "type": "agent_chunk", "task_id": task_id,
                            "agent_id": agent_id, "content": token,
                            "todo_id": todo.get("id", ""),
                        })
                    elif chunk["type"] == "reasoning":
                        reasoning_content = (reasoning_content or "") + chunk.get("content", "")
                    elif chunk["type"] == "done":
                        break
                    elif chunk["type"] == "error":
                        error = chunk.get("message", "stream error")
                        break
            except Exception as e:
                error = str(e)
                logger.warning(f"[{task_id}] Agent {agent_id} 流异常: {error}")

            iteration += 1

            if error or not full_content:
                if not full_content:
                    error_msg = f"[错误] {agent_id} 无响应"
                    todo["output"] = error_msg
                    todo["status"] = "failed"
                    return error_msg
                final_output = self._extract_final_output(full_content)
                todo["output"] = final_output
                todo["status"] = "done"
                agent_info = AGENT_REGISTRY.get(agent_id, {})
                await ws_send({
                    "type": "agent_message", "task_id": task_id,
                    "agent_id": agent_id, "todo_id": todo.get("id",""),
                    "agent_name": agent_info.get("name", agent_id),
                    "agent_icon": agent_info.get("icon", "🤖"),
                    "content": final_output, "tool_calls": tool_history, "done": True,
                })
                return final_output

            tool_calls = self._parse_tool_calls(full_content)
            if tool_calls:
                thinking_step = self._extract_thinking(full_content)
                if thinking_step:
                    agent_info = AGENT_REGISTRY.get(agent_id, {})
                    await ws_send({
                        "type": "agent_message", "task_id": task_id,
                        "agent_id": agent_id, "todo_id": todo.get("id",""),
                        "agent_name": agent_info.get("name", agent_id),
                        "agent_icon": agent_info.get("icon", "🤖"),
                        "content": thinking_step, "tool_calls": [], "done": False,
                    })
                asst_msg = {"role": "assistant", "content": full_content}
                if reasoning_content:
                    asst_msg["reasoning_content"] = reasoning_content
                for tc in tool_calls:
                    tool_name, tool_params = tc["name"], tc["params"]
                    tool_params.setdefault("user_id", self.user_id)
                    await ws_send({
                        "type": "tool_call", "task_id": task_id,
                        "agent_id": agent_id, "tool": tool_name,
                        "input": tool_params,
                    })
                    tool_result = await invoke_tool(tool_name, tool_params, self.user_id)
                    tool_history.append({
                        "tool": tool_name, "input": tool_params,
                        "output": tool_result,
                    })
                messages.append(asst_msg)
                for entry in tool_history:
                    messages.append({
                        "role": "user",
                        "content": f"[工具返回: {entry['tool']}]\n{entry['output']}",
                    })
                await ws_send({
                    "type": "tool_call_result", "task_id": task_id,
                    "agent_id": agent_id,
                    "calls": tool_history,
                })
            else:
                final_output = self._extract_final_output(full_content)
                todo["output"] = final_output
                todo["status"] = "done"
                agent_info = AGENT_REGISTRY.get(agent_id, {})
                await ws_send({
                    "type": "agent_message", "task_id": task_id,
                    "agent_id": agent_id,
                    "agent_name": agent_info.get("name", agent_id),
                    "agent_icon": agent_info.get("icon", "🤖"),
                    "content": final_output, "tool_calls": tool_history, "done": True,
                })
                return final_output

        return ""

    def _parse_tool_calls(self, response: str) -> list:
        result = []

        # Format 1: [CALL_TOOL: name]\n参数: {...}
        pattern = r'\[CALL_TOOL:\s*(\w+)\]\s*\n\s*参数:\s*(\{[^}]+\})'
        matches = re.findall(pattern, response)
        for tool_name, params_str in matches:
            try:
                params = json.loads(params_str)
                result.append({"name": tool_name, "params": params})
            except json.JSONDecodeError:
                continue

        # Format 2: TOOL_CALL: name\n{...}（用于 tool_agent，需处理嵌套花括号）
        remaining = response
        while True:
            m = re.search(r"TOOL_CALL:\s*(\w+)", remaining)
            if not m:
                break
            name = m.group(1)
            after_part = remaining[m.end():]
            json_start = after_part.find("{")
            if json_start >= 0:
                try:
                    decoder = json.JSONDecoder()
                    params, parsed_end = decoder.raw_decode(after_part, json_start)
                    result.append({"name": name, "params": params})
                    remaining = remaining[m.end() + json_start + parsed_end:]
                    continue
                except (json.JSONDecodeError, ValueError):
                    remaining = remaining[m.end() + 1:]
                    continue
            remaining = remaining[m.end() + 1:]

        return result

    def _extract_final_output(self, response: str) -> str:
        m = re.search(r'【最终输出】\s*\n*(.*)', response, re.DOTALL)
        if m:
            text = m.group(1).strip()
            clean = re.sub(r'\[CALL_TOOL:.*?\].*?(?=\n[^\s]|\Z)', '', text, flags=re.DOTALL)
            clean = re.sub(r'TOOL_CALL:\s*\w+', '', clean)
            return clean.strip() or text
        clean = re.sub(r'\[CALL_TOOL:.*?\].*?(?=\n[^\s]|\Z)', '', response, flags=re.DOTALL)
        clean = re.sub(r'TOOL_CALL:\s*\w+', '', clean)
        return re.sub(r'【我的分析】.*?(\n|$)', '', clean, count=1).strip() or response.strip()

    def _extract_thinking(self, response: str) -> str:
        """提取 AI 响应中的分析/推理过程（去除工具调用标记）"""
        text = re.sub(r'\[CALL_TOOL:.*?\]\s*参数:\s*\{[^}]*\}', '', response, flags=re.DOTALL)
        text = text.replace('【工具调用】', '').strip()
        text = re.sub(r'\n{3,}', '\n\n', text).strip()
        if not text or len(text) < 10:
            return ""
        return text

    def _build_depends_text(self, todo: dict, _visited: set = None) -> str:
        """递归收集所有深层前置依赖的输出"""
        if _visited is None:
            _visited = set()
        parts = []
        for dep_id in todo.get("depends_on", []):
            if dep_id in _visited:
                continue
            _visited.add(dep_id)
            for t in self._current_todo_list:
                if t["id"] == dep_id:
                    if t.get("output"):
                        parts.append(f"### {dep_id}\n{t['output']}")
                    parts.append(self._build_depends_text(t, _visited))
                    break
        return "\n\n".join(p for p in parts if p)

    def _build_overview_text(self, todo: dict) -> str:
        lines = []
        for t in self._current_todo_list:
            marker = " ← 你的任务" if t["id"] == todo["id"] else ""
            lines.append(f"- {t['id']}: {t['description']}{marker}")
        return "\n".join(lines)

    async def _summarize(self, task_id: str, query: str, outputs: dict, ws_send,
                          context_history: str = "", mode: str = "detailed") -> str:
        lines = [f"用户请求: {query}\n"]
        for todo_id, output in outputs.items():
            if output:
                lines.append(f"### {todo_id}\n{output}")

        NL2 = '\n\n'

        if mode == "concise":
            prompt = f"""将以下专家Agent的输出汇总为一个简洁、结构清晰的总回复。

{NL2.join(lines)}

要求：
1. 先给总体结论（1-2句）
2. 分条列出各维度要点
3. 给出行动建议
4. 友善鼓励的语气
5. 保留表格等结构化信息
6. 总字数不超过600字"""
        else:
            prompt = f"""将以下专家Agent的输出整合为一个连贯、完整的回复，保留全部内容。

{NL2.join(lines)}

要求：
1. 先给总体结论（1-2句）
2. 保留所有子Agent的完整内容，不要删减
3. 保留表格、列表等结构化格式
4. 用过渡语句连接各部分
5. 友善鼓励的语气"""

        # 流式输出
        full_content = ""
        try:
            logger.info(f"[{task_id}] 开始流式汇总")
            stream_count = 0

            async for chunk in ai_request_manager.make_request_stream(
                request_id=f"summary_{task_id}",
                messages=[
                    {"role": "system", "content": "你是一个学习辅助助手，负责汇总专家意见。"},
                    {"role": "user", "content": prompt},
                ],
                model="deepseek-v4-flash",
                temperature=0.5,
            ):
                if chunk["type"] == "token":
                    stream_count += 1
                    full_content += chunk["content"]
                    await ws_send({"type": "orchestrator_chunk", "task_id": task_id, "content": chunk["content"]})
                elif chunk["type"] == "done":
                    break
                elif chunk["type"] == "error":
                        logger.error(f"流式汇总失败，降级为非流式: {chunk.get('message', '')}")
                        raise Exception(chunk.get("message", "stream error"))
            logger.info(f"[{task_id}] 流式完成，共 {stream_count} 个chunk，总长度 {len(full_content)}")
        except Exception as e:
            logger.warning(f"流式汇总降级: {e}")
            if self._enable_agentscope:
                from app.agentscope_config import get_cached_model
                model = await get_cached_model()
                full_text = ""
                stream_gen = await model(
                    messages=[{"role": "system", "content": "你是一个学习辅助助手，负责汇总专家意见。"},
                              {"role": "user", "content": prompt}],
                    temperature=0.5,
                )
                async for chunk in stream_gen:
                    if hasattr(chunk, "content") and chunk.content:
                        for block in chunk.content:
                            if isinstance(block, dict) and block.get("type") == "text":
                                full_text += block.get("text", "")
                full_content = full_text.strip()
            else:
                full_content = await ai_request_manager.generate_text(
                    prompt=prompt, model="deepseek-v4-flash", temperature=0.5,
                )

        await ws_send({"type": "orchestrator_summary", "task_id": task_id, "content": full_content})
        await ws_send({"type": "task_complete", "task_id": task_id, "summary": full_content})
        return full_content


_instances: Dict[int, Orchestrator] = {}


_instance_agentscope_loaded: Dict[int, bool] = {}


async def ensure_agentscope_agents(user_id: int):
    """确保 AgentScope Agent 已注入到用户的 Orchestrator（在 async 上下文中调用）"""
    if user_id not in _instance_agentscope_loaded:
        try:
            from app.agentscope_agents import create_all_agents, create_workflow
            agents = await create_all_agents()
            _instances[user_id].register_agentscope_agents(agents)

            # 注入 3-Agent 工作流
            workflow = await create_workflow()
            _instances[user_id].register_agentscope_workflow(workflow)
        except Exception as e:
            logger.warning(f"AgentScope Agent 注入失败（当前仍走旧路径）: {e}")
        _instance_agentscope_loaded[user_id] = True


def get_orchestrator(user_id: int) -> Orchestrator:
    if user_id not in _instances:
        _instances[user_id] = Orchestrator(user_id)
    return _instances[user_id]


def remove_orchestrator(user_id: int):
    _instances.pop(user_id, None)
