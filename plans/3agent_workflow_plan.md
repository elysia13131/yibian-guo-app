# 3-Agent 工作流替换计划

> **For agentic workers:** 将 Orchestrator 拆分为 3 个专用 Agent（Intent / Planner / Assembler），实现"理解→规划→执行→汇编"的流水线。

**Goal:** 解决现有 Orchestrator 单点过重、汇总压缩丢失子Agent细节的问题。子Agent的输出原样保留，Assembler只做拼接+去重+加标题/按钮。

**Architecture:** 将当前 `Orchestrator.run_task()` 拆分为 3 个专用 Agent，Pipeline 顺序执行：
- IntentAgent →（直答则直接返回）→ PlannerAgent → 并行 MsgHub 执行 → AssemblerAgent（流式输出）

**Tech Stack:** AgentScope ReActAgent + MsgHub + Pipeline，前端 WS 消息格式不变

---

## 当前痛点与解决方案

| 痛点 | 当前 | 新架构 |
|------|------|--------|
| Orchestrator 身兼多职 | `_generate_todo_list()` 同时做意图理解和规划 | IntentAgent 只管理解，PlannerAgent 只管规划 |
| 汇总压缩丢失细节 | `_summarize()` 用"总字数不超过800字"压缩 | AssemblerAgent 只拼接不压缩，原样保留 |
| 多Agent分配不可控 | ORCHESTRATOR_PROMPT 允许分配 2+ 个Agent | PlannerAgent 严格分配 1 个Agent/待办 |
| 代码混乱难维护 | 897 行的大文件 | 拆分为 3 个专注的 Agent + Orchestrator 只做编排 |

## 新工作流

```
用户消息
   │
   ▼
[IntentAgent] ──直答──▶ 直接流式返回（`[DIRECT_REPLY]`）
   │
   ▼ 需要多Agent
[PlannerAgent] ──▶ 生成 todo_list（每项1个Agent，depends_on尽量空）
   │
   ▼
[MsgHub 并行执行] ──▶ 所有子Agent同时工作，实时广播
   │
   ▼
[AssemblerAgent] ──▶ 流式输出：保留各Agent原样 + 去重 + 标题/按钮
   │
   ▼
前端
```

---

## 文件变更清单

### 新增

| 文件 | 用途 |
|------|------|
| `app/agentscope_workflow_prompts.py` | 3 个新 Agent 的 system prompt |
| `app/agentscope_workflow.py` | 3 个 Agent 实例 + 编排 Pipeline |

### 修改

| 文件 | 变更 |
|------|------|
| `app/services/agent_orchestrator.py` | Orchestrator 调用新 Pipeline 替代现有的 `_generate_todo_list` + `_summarize` |
| `app/agentscope_agents.py` | 导出新 Agent 供 Orchestrator 注入 |
| `app/core/agent_websocket.py` | 无变化（WS 消息格式兼容） |

### 删除（可选）

| 文件 | 原因 |
|------|------|
| `agent_prompts.py` 中的 `ORCHESTRATOR_PROMPT` | 被 IntentAgent + PlannerAgent 的两个 prompt 替代 |

---

## 任务分解

### Task 1: 定义 3 个新 Agent 的 System Prompt

**Files:**
- Create: `app/agentscope_workflow_prompts.py`

**Prompt 1 — IntentAgent：理解意图 + 直答**

```python
INTENT_AGENT_PROMPT = """你是灵枢的意图理解专员。你负责：
1. **理解用户请求**，判断是需要直答还是需要多Agent协作
2. **直答场景**：系统类问题（"你能做什么"、"有哪些Agent"），直接给出友好回复
3. **转规划场景**：需要专业知识/检索/教学的任务，转交给 PlannerAgent

## 你需要知道的系统信息
{available_agents}

## 任务执行方式
所有待办的Agent会在消息中心(MsgHub)中**同时并行执行**，每个Agent的产出会实时广播给其他Agent。

## 输出格式（严格JSON，只输出JSON无需解释）
### 直答场景
{{"intent": "direct_reply", "reply": "你的回答"}}

### 转规划场景
{{"intent": "plan", "query": "规整后的用户请求"}}

## 规则
- 问候、闲聊、系统查询 → direct_reply
- 学习/教学/检索/分析 → plan
- direct_reply 必须使用真实存在的Agent名称，不得编造
- 如果是医学学习类问题，一律转规划"""
```

**Prompt 2 — PlannerAgent：生成并行待办**

```python
PLANNER_AGENT_PROMPT = """你是灵枢的任务规划专员。你负责：
1. 将用户请求拆解为**并行待办清单**
2. 每个待办指派**1个**最合适的子Agent
3. 仅在真正的数据产出依赖时标注 depends_on，否则保持为空

## 分配原则
- 每个待办**严格只分配1个**最对口的Agent
- 知识检索→knowledge_agent | 概念讲解→tutor_agent
- 出题测验→quiz_agent | 复习计划→review_planner
- 情绪陪伴→companion_agent | 病例分析→clinical_agent
- 数据分析→analytics_agent | 论文/方法→methods_agent

## 可用的子Agent
{available_agents}

## 输出格式（严格JSON）
{{"todo_list": [{{"id": "todo-1", "description": "任务描述", "assignees": ["AgentID"], "depends_on": [], "tools_allowed": ["工具名"]}}]}}

## 规则
- assignees **必须是仅含1个元素**的数组
- depends_on **尽量保持空数组**，除非一项确实需要另一项的结果
- tools_allowed 填写该Agent可用的工具名
- 只输出JSON，不要其他文字"""
```

**Prompt 3 — AssemblerAgent：拼接结果（不压缩）**

```python
ASSEMBLER_AGENT_PROMPT = """你是灵枢的最终输出汇编专员。你的工作是将多个专家Agent的输出**原样保留**并组装为最终回复。

## 你的核心原则
### 只拼接，不压缩
- 各子Agent的输出必须**原样保留**在对应区块中，**禁止概括或缩减**
- 只负责加上标题、行动按钮分隔线、调整段落衔接
- 如果子Agent的输出包含 `[CALL_TOOL]` 或 `【我的分析】` 等标记，直接移除这些标记，保留正文

### 冗余控制
- 若多个子Agent给出相似内容，选择**质量最高**（最详实、结构化最好）的版本保留
- 其他相似版本在末尾用"📎 相关参考"列出链接

## 输出格式
## 🎯 {总体标题}

{分区块，每个子Agent一个独立的区块}

### 🧠 {子Agent名称}
{子Agent的完整输出，原样保留，不删不减}

---

### 📚 {另一个子Agent名称}
...

## 📎 相关参考
（如有多余的相似内容，在此列出简略参考）

## 用户原始请求
{query}

## 各子Agent的输出原文
{outputs}"""
```

- [ ] **编写 IntentAgent prompt**
- [ ] **编写 PlannerAgent prompt**
- [ ] **编写 AssemblerAgent prompt**

---

### Task 2: 创建 3 个 Agent 实例 + 编排 Pipeline

**Files:**
- Create: `app/agentscope_workflow.py`

```python
"""3-Agent 工作流编排 — Intent → Planner → Assembler"""
import json
import logging
from typing import Dict, List, Optional, Callable, Awaitable

from agentscope.agent import ReActAgent
from agentscope.formatter import DashScopeChatFormatter
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
    model = await create_model(stream=True)
    memory = create_memory()
    formatter = DashScopeChatFormatter()

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
```

- [ ] **创建 `agentscope_workflow.py`**
- [ ] **实现 `create_workflow_agents()` 工厂函数**

---

### Task 3: 重构 Orchestrator.run_task — 集成 3-Agent Pipeline

**Files:**
- Modify: `app/services/agent_orchestrator.py`

在 `run_task()` 中，将当前的：

```
_generate_todo_list() → _execute_todo() → _summarize()
```

替换为：

```
IntentAgent → (direct_reply则直接返回) → PlannerAgent → MsgHub并行执行 → AssemblerAgent(流式输出)
```

关键变更点：

```python
async def run_task(self, task_id, query, ws_send, context_history=""):
    self._aborted = False

    # 读取长期记忆
    from app.services.agent_memory import AgentMemory
    self._memory_context = await AgentMemory.load(self.user_id)
    self._memory_summary = AgentMemory.build_memory_summary(self._memory_context)

    # ===== 阶段1: IntentAgent =====
    active_agents = json.dumps([
        {"id": a["id"], "name": a["name"], "role_desc": a["role_desc"],
         "tools": a.get("tools", [])}
        for a in AGENT_REGISTRY.values()
    ], ensure_ascii=False, indent=2)

    intent_prompt = INTENT_AGENT_PROMPT.format(available_agents=active_agents)
    intent_msg_text = f"用户请求: {query}"
    if context_history:
        intent_msg_text += f"\n\n## 对话历史\n{context_history}"
    intent_msg_text += f"\n\n## 用户记忆摘要\n{self._memory_summary}" if self._memory_summary else ""

    intent_result = await self._agentscope_workflow["intent_agent"](
        Msg("user", intent_msg_text, role="user")
    )
    intent_text = intent_result.get_text_content() if hasattr(intent_result, "get_text_content") else str(intent_result)
    intent_text = re.sub(r'^```json\s*|\s*```$', '', intent_text.strip())

    try:
        intent_data = json.loads(intent_text)
    except json.JSONDecodeError:
        intent_data = {"intent": "direct_reply", "reply": intent_text}

    # 直答
    if intent_data.get("intent") == "direct_reply":
        reply = intent_data.get("reply", "我不知道如何回答")
        chunk_size = 3
        for i in range(0, len(reply), chunk_size):
            await ws_send({"type": "orchestrator_chunk", "task_id": task_id, "content": reply[i:i+chunk_size]})
            await asyncio.sleep(0.02)
        await ws_send({"type": "orchestrator_summary", "task_id": task_id, "content": reply})
        await ws_send({"type": "task_complete", "task_id": task_id, "summary": reply})
        return reply

    # ===== 阶段2: PlannerAgent =====
    refined_query = intent_data.get("query", query)
    planner_prompt = PLANNER_AGENT_PROMPT.format(available_agents=active_agents)
    planner_msg = Msg("user", f"用户请求: {refined_query}\n\n## 用户记忆摘要\n{self._memory_summary}" if self._memory_summary else f"用户请求: {refined_query}", role="user")

    # (此处调用planner_agent，解析todo_list，与现有 _generate_todo_list 的JSON解析逻辑相同)

    # ===== 阶段3: MsgHub 并行执行（现有 _run_parallel_agentscope，不变） =====

    # ===== 阶段4: AssemblerAgent =====
    # 将各子Agent的完整输出传给Assembler
    outputs_text = ""
    for todo_id, output in all_outputs.items():
        agent_name = AGENT_REGISTRY.get(todo_id, {}).get("name", todo_id)
        outputs_text += f"\n\n## {agent_name}（{todo_id}）\n{output}"

    assembler_msg = Msg("user", f"## 用户原始请求\n{query}\n\n## 各子Agent输出\n{outputs_text}", role="user")

    # 流式输出 Assembler 结果
    async for chunk in self._agentscope_workflow["assembler_agent"].model(
        messages=[{"role": "system", "content": ASSEMBLER_AGENT_PROMPT},
                  {"role": "user", "content": assembler_msg.get_text_content()}],
        temperature=0.5, stream=True,
    ):
        if hasattr(chunk, "content") and chunk.content:
            for block in chunk.content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text_chunk = block.get("text", "")
                    if text_chunk:
                        full_content += text_chunk
                        await ws_send({"type": "orchestrator_chunk", ...})

    await ws_send({"type": "orchestrator_summary", ...})
    await ws_send({"type": "task_complete", ...})
```

- [ ] **在 `Orchestrator.__init__` 中增加 `_agentscope_workflow` 字段**
- [ ] **实现阶段1: IntentAgent 调用 + 直答处理**
- [ ] **实现阶段2: PlannerAgent 调用 + todo_list 解析**
- [ ] **实现阶段4: AssemblerAgent 流式输出（不压缩，原样保留）**
- [ ] **移除旧的 `_summarize` 方法**
- [ ] **更新 `ensure_agentscope_agents` 注入工作流 Agent**

---

### Task 4: 更新 Orchestrator 注入逻辑

**Files:**
- Modify: `app/agentscope_agents.py`

```python
from app.agentscope_workflow import create_workflow_agents

async def create_all_agents():
    model = await create_model(stream=True)
    memory = create_memory()
    formatter = DashScopeChatFormatter()
    # ... 现有 8 个子 Agent ...

async def create_workflow():
    """创建工作流 3 Agent（单独导出）"""
    return await create_workflow_agents()
```

- [ ] **在 `agentscope_agents.py` 中导出 `create_workflow()`**

---

### Task 5: 更新 Orchestrator 注入点

**Files:**
- Modify: `app/services/agent_orchestrator.py`

```python
_workflow_instance = None

async def ensure_agentscope_agents(user_id: int):
    if user_id not in _instance_agentscope_loaded:
        try:
            from app.agentscope_agents import create_all_agents, create_workflow
            agents = await create_all_agents()
            _instances[user_id].register_agentscope_agents(agents)

            # 注入 3-Agent 工作流
            workflow_agents = await create_workflow()
            _instances[user_id]._agentscope_workflow = workflow_agents
        except Exception as e:
            logger.warning(f"注入失败: {e}")
        _instance_agentscope_loaded[user_id] = True
```

- [ ] **在 `ensure_agentscope_agents` 中注入工作流 Agent**

---

### Task 6: 清理

**Files:**
- Modify: `app/services/agent_prompts.py`

从 `agent_prompts.py` 中移除以下已废弃的 prompt（仅保留 fallback 注释）：

- `ORCHESTRATOR_PROMPT` → 被 IntentAgent + PlannerAgent 替代
- （保留 `AGENT_TEMPLATE` 和 `DISCUSSION_TEMPLATE` 作为旧路径 fallback）

- [ ] **移除 `ORCHESTRATOR_PROMPT`**
- [ ] **编译全量验证**

---

## 回归测试清单

| 测试场景 | 预期行为 |
|----------|---------|
| 系统查询 "你能做什么" | IntentAgent → direct_reply → 流式输出直答 |
| 学习请求 "帮我复习解剖学" | IntentAgent → plan → PlannerAgent → 3-4个待办 → MsgHub并行 → Assembler 完整拼接 |
| 子Agent输出长内容 | Assembler 原样保留，不截断不压缩 |
| 多Agent 内容重叠 | Assembler 去重，选质量最高的版本 |
| 中断 | 所有阶段均检查 _aborted |

---

## 风险与注意事项

1. **IntentAgent 的 `max_iters=1`** — 意图理解只需 1 轮推理，不需要 ReAct 循环。但如果模型输出非 JSON，需要 fallback 处理。
2. **Assembler 不能压缩** — prompt 中必须明确强调"禁止概括或缩减"，并在代码层不做输出长度限制。
3. **流式输出** — AssemblerAgent 的 `model(stream=True)` 直接 push 到前端，不走 `_summarize` 的中间步骤。
4. **旧路径兼容** — 当 AgentScope 不可用时，`_agentscope_workflow` 为 None，回退到现有的旧 `run_task` 逻辑。
