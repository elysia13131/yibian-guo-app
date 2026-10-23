# AgentScope 替换计划

## 1. AgentScope 概览

### 1.1 定位

AgentScope 是阿里巴巴通义实验室 SysML 团队开发的开源生产级多智能体框架（Apache-2.0 协议）。GitHub Star 14k+，最新 v1.0.x，要求 Python ≥ 3.10。

### 1.2 三位一体架构

```
AgentScope Core       → 智能体构建 + 消息系统 + Pipeline 编排
AgentScope Runtime    → 安全沙箱 + 分布式部署 + K8s 编排
AgentScope Studio     → 可视化调试 + 全链路追踪 + 评估
```

### 1.3 框架对比：AgentScope vs 自建

| 特性 | 当前自建 | AgentScope |
|------|---------|-----------|
| Agent 抽象 | 手动编排 `AGENT_REGISTRY` | `ReActAgent` / `DialogAgent` / `UserAgent` 内置 |
| Agent 间通信 | `ws_send` + `asyncio.gather` | `MsgHub` 自动广播 + 实时推送 |
| Pipeline 编排 | 手写 `_build_dependency_dag` | `sequential_pipeline` / `FanoutPipeline` 声明式 |
| 工具系统 | `MCP_TOOLS` + `_TOOL_HANDLERS` | `Toolkit` + `register_tool_function` + `MCP` 原生支持 |
| 长期记忆 | 自建 `AgentMemory` | `LongTermMemoryBase` 内置（动态/静态模式） |
| 流式输出 | 手动 `orchestrator_chunk` | Model 内置 `stream=True` + Agent 自动流式 |
| 实时中断 | abort 标记 | 原生 `interrupt()` + 自定义处理钩子 |
| 可观测性 | 无 | OpenTelemetry 追踪 + Studio 可视化 |
| 分布式 | 无 | Runtime + Serverless（K8s / 函数计算） |

---

## 2. 当前系统架构 vs AgentScope 映射

### 2.1 当前结构图

```
用户 → WS
        ↓
Orchestrator (自建)
   ├── _generate_todo_list()      → 生成待办（调用 AI）
   ├── _execute_todo()             → 串行/并行执行子 Agent
   │     ├── knowledge_agent       → 自建 AGENT_TEMPLATE
   │     ├── tutor_agent           → 自建 AGENT_TEMPLATE
   │     ├── quiz_agent            → 自建 AGENT_TEMPLATE
   │     ├── review_planner        → 自建 AGENT_TEMPLATE
   │     ├── companion_agent       → 自建 AGENT_TEMPLATE
   │     ├── clinical_agent        → 自建 AGENT_TEMPLATE
   │     ├── analytics_agent       → 自建 AGENT_TEMPLATE
   │     └── methods_agent         → 自建 AGENT_TEMPLATE
   ├── _run_discussion_mode()      → 3+ Agent 讨论（asyncio.gather）
   └── _summarize()                → 汇总（流式输出）
        ↓
WS → 前端 Agent.tsx
```

### 2.2 AgentScope 映射图

```
AgentScope ReActAgent (Orchestrator)
   │
   ├── toolkit (工具集)
   │     ├── 生成待办 PlanNotebook
   │     └── 调用子 Agent 的工具函数
   │
   ├── MsgHub / sequential_pipeline
   │     ├── knowledge_agent_module  → ReActAgent
   │     ├── tutor_agent_module      → ReActAgent
   │     ├── quiz_agent_module       → ReActAgent
   │     ├── review_planner_module   → ReActAgent
   │     ├── companion_agent_module  → ReActAgent
   │     ├── clinical_agent_module   → ReActAgent
   │     ├── analytics_agent_module  → ReActAgent
   │     └── methods_agent_module    → ReActAgent
   │
   └── memory (InMemoryMemory + LongTermMemory)
```

---

## 3. 替换步骤

### Phase A: 基础设施（1-2天）

#### A1. 安装 AgentScope

```bash
pip install agentscope
# 或从源码
git clone https://github.com/modelscope/agentscope.git
cd agentscope && pip install -e .
```

#### A2. 模型配置适配

当前使用 `ai_request_manager` 调用 DeepSeek API。AgentScope 通过 `ModelWrapper` 统一抽象：

```python
from agentscope.model import OpenAIChatModel

# 适配 DeepSeek（兼容 OpenAI API 格式）
model = OpenAIChatModel(
    config_name="deepseek-v4",
    model_name="deepseek-v4-flash",
    api_key=os.environ["DEEPSEEK_API_KEY"],
    base_url="https://api.deepseek.com/v1",
    stream=True,          # 流式输出
)
```

需要补回 `ai_request_manager` 的 API Key 轮询、限流逻辑——AgentScope 单 Model 实例只支持单 Key，需要自行包装本地 Key 池（§5.1 风险项）。

#### A3. 工具系统迁移

当前 `MCP_TOOLS` / `invoke_tool` 迁移到 AgentScope `Toolkit`：

```python
from agentscope.tool import Toolkit
from agentscope.service import ServiceResponse, ServiceExecStatus

async def web_search(query: str, count: int = 5) -> str:
    """搜索互联网获取实时信息"""
    result = await actual_search_function(query, count)
    return result

toolkit = Toolkit()
toolkit.register_tool_function(web_search)
toolkit.register_tool_function(search_knowledge)
toolkit.register_tool_function(get_document)
toolkit.register_tool_function(get_flashcards)
# ... 注册所有现有工具
```

#### A4. Memory 迁移

当前 `AgentMemory`（UserAgentSession 表）→ AgentScope `InMemoryMemory` + `LongTermMemoryBase`：

```python
from agentscope.memory import InMemoryMemory, LongTermMemoryBase

memory = InMemoryMemory()               # 短期记忆（当前对话）
long_term_memory = LongTermMemoryBase(  # 长期记忆（跨会话）
    memory_store=db_memory_store,
    mode="agent_control",               # Agent 自主控制
)
```

---

### Phase B: Agent 定义与 Prompt 迁移（2-3天）

#### B1. 子 Agent → ReActAgent

当前每个子 Agent 用 `AGENT_TEMPLATE` 格式化 prompt，替换为：

```python
from agentscope.agent import ReActAgent
from agentscope.formatter import DashScopeChatFormatter

knowledge_agent = ReActAgent(
    name="knowledge_agent",
    sys_prompt=KNOWLEDGE_AGENT_PROMPT,   # 复用现有 prompt
    model=model,
    formatter=DashScopeChatFormatter(),
    toolkit=knowledge_toolkit,           # web_search + search_knowledge + get_document
    memory=InMemoryMemory(),
    max_iters=5,                         # 原 max_iterations
)
```

按此模式逐一迁移 8 个子 Agent：

| 当前 Agent | AgentScope 类型 | 工具 |
|-----------|----------------|------|
| knowledge_agent | ReActAgent | web_search, search_knowledge, get_document |
| tutor_agent | ReActAgent | search_knowledge |
| quiz_agent | ReActAgent | web_search |
| review_planner | ReActAgent | search_knowledge, get_flashcards |
| companion_agent | ReActAgent | 无（纯对话） |
| clinical_agent | ReActAgent | web_search, search_knowledge |
| analytics_agent | ReActAgent | get_user_stats |
| methods_agent | ReActAgent | web_search, search_knowledge, get_document |

#### B2. Orchestrator → ReActAgent + PlanNotebook

当前 Orchestrator 的核心逻辑是：
1. 理解意图 → 生成 todo_list（`_generate_todo_list`）
2. 按依赖顺序执行（`_build_dependency_dag`）
3. 汇总输出（`_summarize`）

AgentScope 的 `PlanNotebook` 天然支持这种模式：

```python
from agentscope.plan import PlanNotebook

planner = PlanNotebook()
# Agent 通过工具函数操作 plan：
# - create_plan(tasks)      → 生成待办清单
# - execute_task(task_id)   → 执行单个待办
# - update_plan(task_id, status) → 更新状态
# - get_next_tasks()         → 获取可执行的下一个任务
```

Orchestrator prompt 中的 todo_list 生成逻辑可以直接嵌入 `sys_prompt`：

```python
orchestrator = ReActAgent(
    name="harness",
    sys_prompt=ORCHESTRATOR_PROMPT,   # 复用现有 prompt
    model=model,
    formatter=DashScopeMultiAgentFormatter(),      # 多Agent场景
    toolkit=orchestrator_toolkit,                  # 包含 create_plan 等工具
    plan_notebook=planner,             # 规划能力
    memory=memory,
    long_term_memory=long_term_memory,
    long_term_memory_mode="agent_control",
    max_iters=20,
)
```

#### B3. 讨论模式 → MsgHub

当前 `_run_discussion_mode` 用 `asyncio.gather` 模拟讨论 → AgentScope `MsgHub` 原生广播：

```python
from agentscope.pipeline import MsgHub

async with MsgHub(
    participants=[tutor_agent, clinical_agent, methods_agent],
    announcement=Msg("system", "请就以下问题展开多视角讨论...", "system"),
    enable_auto_broadcast=True,
) as hub:
    await tutor_agent()       # 每个发言自动广播给其他人
    await clinical_agent()    # 能看到 tutor 的观点
    await methods_agent()     # 能看到前两人的观点
```

`MsgHub` 原生支持：
- 自动广播：每个参与者的回复自动分发给所有其他参与者
- 动态管理：`hub.add()` / `hub.delete()` 动态增减参与者
- 手动广播：`hub.broadcast(msg)` 可控
- 实时中断：`agent.interrupt(msg)` 随时打断

---

### Phase C: WS 层 + 前端适配（1-2天）

#### C1. WebSocket 集成

当前 WS handler（`agent_websocket.py`）需要用 AgentScope 的消息格式对接：

```python
# 核心变化：接收用户消息 → 调 AgentScope agent.reply()
async def handle_chat(user_id, text):
    user_msg = Msg("user", text, role="user")

    async for chunk in orchestrator(model.stream=True):
        # AgentScope 流式输出会自动 yield
        await ws_send({
            "type": "orchestrator_chunk",
            "content": chunk,
        })

    final = await orchestrator.reply(user_msg)
    await ws_send({
        "type": "orchestrator_summary",
        "content": final.get_text_content(),
    })
```

关键变化：
- AgentScope 的 `stream=True` 自动处理流式，无需手动 `_summarize`
- `Msg` 对象替代字符串消息（结构化的 sender/role/content/metadata）
- 中断通过 `agent.interrupt()` 替代 `abort` 标记

#### C2. 前端适配

前端 `Agent.tsx` 的 WebSocket 消息格式基本不变（`orchestrator_chunk` / `orchestrator_summary`），但 AgentScope Studio 提供了更强大的替代方案：

- **可选**：直接对接 AgentScope Studio（WebSocket 协议兼容）
- **保留**：现有前端不变，只改 WS 数据源
- 流式输出格式从 `{type, task_id, content}` → AgentScope 原生 token 流

---

### Phase D: 验证与上线（1天）

#### D1. 回归测试清单

| 测试项 | 当前 | AgentScope |
|--------|------|-----------|
| 直答（"你能做什么"） | `direct_reply` 流式 | `ReActAgent` 自动回复 |
| 单 Agent 任务（"搜索..."） | `_execute_todo` | `sequential_pipeline` |
| 双 Agent 协作（"讲解+检索"） | `_execute_todo` ×2 | `sequential_pipeline` |
| 讨论模式（3+ Agent） | `_run_discussion_mode` | `MsgHub` |
| 流式输出 | `orchestrator_chunk` | Model `stream=True` |
| 长期记忆 | `AgentMemory` | `LongTermMemory` |
| 反馈优化 | `feedback_optimizer skill` | 保留（业务层） |
| 技能系统 | `SkillRegistry` | 保留（业务层） |

#### D2. 关键指标对比

- 首次 token 延迟：持平（模型调用一样）
- 讨论模式吞吐量：**提升**（并行 + `MsgHub` 广播优化）
- 代码量：自建 ~2000 行 → AgentScope ~800 行 **减少 60%**
- 可观测性：无 → Studio 可视化 **显著提升**

---

## 4. 文件变更清单

### 新增文件

| 文件 | 内容 |
|------|------|
| `backend/app/agentscope_config.py` | AgentScope 配置初始化（model / toolkit / formatter） |
| `backend/app/agentscope_agents.py` | 所有子 Agent 的 ReActAgent 实例化 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `backend/app/services/agent_prompts.py` | 精简 prompt（AgentScope 自动处理格式） |
| `backend/app/services/agent_orchestrator.py` | **重写**：ReActAgent + PlanNotebook 替代手写编排 |
| `backend/app/services/agent_tool_layer.py` | 迁移到 `Toolkit.register_tool_function` |
| `backend/app/services/agent_memory.py` | 迁移到 `LongTermMemoryBase` |
| `backend/app/services/agent_feedback_analyzer.py` | 保留不动（业务层，不依赖框架） |
| `backend/app/services/agent_skills.py` | 保留不动 |
| `backend/app/core/agent_websocket.py` | WS 消息封装，适配 AgentScope 的 Msg 格式 |
| `backend/main.py` | 移除 `ai_request_manager` 启动逻辑 |

### 删除文件（可选）

| 文件 | 原因 |
|------|------|
| `backend/app/services/ai_request_manager.py` | AgentScope ModelWrapper 替代 |
| `backend/app/services/agent_feedback_analyzer.py` | **不删除**（业务层保留） |

---

## 5. 风险与注意事项

### 5.1 兼容性

- AgentScope 要求 **Python ≥ 3.10** — 当前项目已满足
- 模型 API：DeepSeek 兼容 OpenAI 格式，`OpenAIChatModel` 可直接使用
- `ai_request_manager` 的 API Key 轮询逻辑：AgentScope 未内置多 Key 负载均衡，可能需要自行包装

### 5.2 学习成本

- 团队需熟悉 AgentScope 的 `Msg` / `MsgHub` / `Pipeline` 概念
- 中文文档完善（doc.agentscope.io），社区活跃（Discord + 钉钉）

### 5.3 渐进式替换策略（推荐）

```
Phase A → 基础设施（安装 + 模型 + 工具）       1-2天
Phase B → Agent 定义（逐个替换子 Agent）       2-3天
    策略：先在 _execute_todo 中逐个替换
    Day 1: knowledge_agent + tutor_agent + quiz_agent
    Day 2: review_planner + companion_agent + clinical_agent
    Day 3: analytics_agent + methods_agent + 讨论模式
Phase C → WS 层 + 前端适配                   1-2天
Phase D → 验证 + 上线                        1天
```

### 5.4 保留的自有代码

| 模块 | 保留原因 |
|------|---------|
| `SkillRegistry` + `feedback_optimizer` | 业务层技能系统，框架无关 |
| `HistoryDrawer.tsx` | 前端组件，框架无关 |
| `FeedbackButtons.tsx` + API | 反馈采集，框架无关 |
| `FormattedText.tsx` | 前端渲染，框架无关 |
| `agent_memory.py` 的概念 | 可转为 `LongTermMemoryBase` 的数据源 |
| 8 个 Agent Prompt | 直接作为 `sys_prompt` 参数传入 |
| `expert_tasks` / `session_messages` 表 | 历史记录数据源，保留 |

---

## 6. 关键代码示例

### 6.1 完整迁移示例：knowledge_agent

```python
# 当前
async def _execute_todo(self, task_id, todo, ws_send):
    agent_info = AGENT_REGISTRY["knowledge_agent"]
    system_prompt = AGENT_TEMPLATE.format(
        name=agent_info["name"],
        role_desc=agent_info["role_desc"],
        capabilities=agent_info["system_prompt"],
        ...
    )
    messages = [{"role": "system", "content": system_prompt}]
    response = await ai_request_manager.make_request(...)
    ...

# 迁移后
knowledge_agent = ReActAgent(
    name="knowledge_agent",
    sys_prompt=KNOWLEDGE_AGENT_PROMPT,
    model=model,
    formatter=formatter,
    toolkit=knowledge_toolkit,
    memory=InMemoryMemory(),
    max_iters=5,
)

result = await knowledge_agent(Msg("user", query, "user"))
```

### 6.2 完整迁移示例：讨论模式

```python
# 当前
async def _run_discussion_mode(self, task_id, agents_info, todo, ws_send):
    results = {}
    queue = asyncio.Queue()
    async def agent_participant(aid, info):
        response = await self._agent_loop(...)
        results[aid] = response
    tasks = [agent_participant(...)]
    await asyncio.wait_for(asyncio.gather(*tasks), timeout=120)

# 迁移后
async def discuss(topic: str):
    async with MsgHub(
        participants=[tutor, clinical, methods],
        announcement=Msg("system", f"讨论主题: {topic}", "system"),
    ) as hub:
        await tutor()
        await clinical()
        await methods()
    # 各 Agent 的 memory 中自动保留了讨论记录
```

### 6.3 Pipeline 编排

```python
# 当前
batches = self._build_dependency_dag(todo_list)
for batch in batches:
    if len(batch) == 1:
        result = await self._execute_todo(task_id, batch[0], ws_send)
    else:
        results = await asyncio.gather(*[
            self._execute_todo(task_id, todo, ws_send) for todo in batch
        ])

# 迁移后 - 声明式 pipeline
from agentscope.pipeline import sequential_pipeline, FanoutPipeline

# 串行：依赖链
await sequential_pipeline([knowledge_agent, tutor_agent], msg)

# 扇出：并行执行
results = await FanoutPipeline([quiz_agent, review_planner])(msg)

# 混合：声明式 DAG
pipeline = SequentialPipeline([
    knowledge_agent,                              # Step 1
    FanoutPipeline([tutor_agent, companion_agent]),  # Step 2（并行）
    summarizer,                                    # Step 3
])
```

---

## 7. 总结

| 指标 | 当前自建 | AgentScope 替换后 |
|------|---------|-----------------|
| 代码行数（agent 相关） | ~2500 行 | ~800 行 |
| Agent 间通信 | 手动 WS 推送 | MsgHub 自动广播 |
| Pipeline 编排 | 手写 DAG | 声明式 Pipeline |
| 流式输出 | 手动 chunk | Model 内置 |
| 可观测性 | 无 | Studio + OpenTelemetry |
| 实时中断 | abort 标记 | 原生 interrupt() |
| 长期记忆 | 自建 | 内置 LongTermMemory |
| 分布式部署 | 不支持 | Runtime + K8s |
| 维护成本 | 高 | 低（社区维护框架） |
