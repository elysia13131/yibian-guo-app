# 多Agent专家组系统 Specification

## 项目概述

为现有的"一遍过"学习平台，从零构建一个**多Agent专家组系统**。一个主Agent（协调器）接收用户请求→理解意图→生成待办清单→按依赖分析分批并行执行→动态组建子Agent→逐项攻克→全部完成后汇总结论。子Agent之间可按需启动讨论模式进行协作。博查搜索API封装为MCP工具供Agent自由调用。

## 核心设计决策

| 决策 | 结论 | 理由 |
|------|------|------|
| 通信机制 | asyncio.Queue + asyncio.gather | 单进程可承载40个Key并发，无需引入Redis |
| 执行策略 | 依赖DAG + 无依赖项并行 + 有依赖项顺序 | 融合方案B与C，受控并行 |
| 前端形态 | 独立全屏页面 `/agent` | 对话窗口 + 待办清单看板 |
| 知识库权限 | 全权限，工具以MCP风格注入System Prompt | Agent自由调用web_search/search_knowledge/get_document |
| 实施阶段 | 3 Phase | Phase1:5个核心Agent+对话+看板；Phase2:+临床+实验+分析+讨论+流程图；Phase3:+陪伴+方法论+长期记忆 |
| Agent并发上限 | asyncio.Semaphore(10) | 40个Key足以支撑10个Agent同时请求+讨论模式 |

---

## 1. 系统架构

```
用户界面 (/agent)
 ┌─ 对话窗口 (SSE 流式渲染) ────┐  ┌─ 待办清单看板 (实时状态WS) ──┐
 │ 🧠 主Agent 逐字输出            │  │ ☐ 检索知识点 (done) knowledge  │
 │ 🔧 调用 web_search...          │  │ ☐ 生成讲解 (doing) tutor       │
 │ 💡 讨论: 2位专家正在协作...     │  │ ☐ 出题 (pending) quiz          │
 └────────────────────────────────┘  └──────────────────────────────┘
              ↕ WebSocket + SSE
 ┌─ 后端 ───────────────────────────────────────────────────────┐
 │                                                                │
 │  Orchestrator (主Agent)                                        │
 │  ├─ 意图分析 + 待办清单生成 (DeepSeek)                          │
 │  ├─ 依赖分析 → 构建批次 DAG                                    │
 │  ├─ 启动/管理 AgentPool (asyncio.Semaphore(10))               │
 │  ├─ 讨论模式协调 (asyncio.Queue)                               │
 │  └─ 全部完成后汇总输出                                          │
 │       ↕                                                        │
 │  AgentPool (子Agent)                                           │
 │  ├─ knowledge_agent   ← 向量库 + 文档检索                      │
 │  ├─ tutor_agent       ← 讲解 + 类比 + 口诀                     │
 │  ├─ quiz_agent        ← 出题 + 评估答案                        │
 │  ├─ clinical_agent    ← 病例分析 + 鉴别诊断                     │
 │  ├─ review_planner    ← FSRS 记忆曲线 + 日程打包               │
 │  ├─ lab_agent         ← 实验报告全流程                          │
 │  ├─ analytics_agent   ← 薄弱点预测 + 学习审计                   │
 │  ├─ companion_agent   ← 情绪感知 + 鼓励                         │
 │  └─ methods_agent     ← 循证决策 + 科研方法                     │
 │       ↕                                                        │
 │  Tool Layer (MCP 工具)                                         │
 │  ├─ web_search        ← 博查 API (10 Key)                      │
 │  ├─ search_knowledge  ← Zvec 向量语义搜索                      │
 │  ├─ get_document      ← 文档/章节全文检索                       │
 │  ├─ get_flashcards    ← 抽认卡查询                              │
 │  └─ get_user_stats    ← 用户学习统计                            │
 │       ↕                                                        │
 │  DeepSeek v4-flash (40 Key / 150 RPM per Key / Semaphore 100)  │
 └────────────────────────────────────────────────────────────────┘
```

---

## 2. 数据模型（新表）

### 2.1 agents（子Agent注册表）

```python
class Agent(Base):
    __tablename__ = "agents"
    id          = Column(String(50), primary_key=True)     # knowledge/tutor/quiz/...
    name        = Column(String(100), nullable=False)      # 知识管家/教学导师/...
    role_desc   = Column(Text, nullable=False)             # 角色描述
    system_prompt = Column(Text, nullable=False)           # 完整 System Prompt
    tools       = Column(JSON, nullable=True)              # ["web_search","search_knowledge",...]
    icon        = Column(String(10), nullable=True)        # emoji 图标
    phase       = Column(Integer, default=1)               # 所属实施阶段 1/2/3
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime, default=datetime.now)
```

### 2.2 expert_tasks（一次任务记录）

```python
class ExpertTask(Base):
    __tablename__ = "expert_tasks"
    id           = Column(String(36), primary_key=True, default=uuid4_str)
    user_id      = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    query        = Column(Text, nullable=False)             # 原始用户请求
    todo_list    = Column(JSON, nullable=False)             # 待办清单 DAG
    status       = Column(String(20), default="in_progress")# in_progress / completed / failed
    summary      = Column(Text, nullable=True)              # 最终汇总文本
    started_at   = Column(DateTime, default=datetime.now)
    completed_at = Column(DateTime, nullable=True)
    error_message= Column(Text, nullable=True)
```

### 2.3 task_contexts（子Agent共享的一次性任务上下文）

```python
class TaskContext(Base):
    __tablename__ = "task_contexts"
    id           = Column(Integer, primary_key=True)
    task_id      = Column(String(36), ForeignKey("expert_tasks.id"), unique=True)
    context_json = Column(JSON, nullable=False)             # 共享上下文快照
    is_active    = Column(Boolean, default=True)            # 任务结束后标记 false
    created_at   = Column(DateTime, default=datetime.now)
```

### 2.4 session_messages（所有消息日志）

```python
class SessionMessage(Base):
    __tablename__ = "session_messages"
    id           = Column(Integer, primary_key=True)
    task_id      = Column(String(36), ForeignKey("expert_tasks.id"), index=True)
    from_agent   = Column(String(50), nullable=False)       # orchestrator / knowledge / tutor / ...
    to_agent     = Column(String(50), nullable=True)        # 广播时为 null
    phase        = Column(String(20))                       # statement / discussion / conclusion
    type         = Column(String(20), default="message")    # message / todo_update / tool_call / ...
    content      = Column(Text, nullable=False)
    agent_raw    = Column(Text, nullable=True)              # Agent 完整原始输出（包含推理过程）
    tools_called = Column(JSON, nullable=True)              # [{"tool":"web_search","input":"...","output":"..."}]
    created_at   = Column(DateTime, default=datetime.now)
```

### 2.5 user_agent_sessions（主Agent与用户的长期会话）

```python
class UserAgentSession(Base):
    __tablename__ = "user_agent_sessions"
    id           = Column(Integer, primary_key=True)
    user_id      = Column(Integer, ForeignKey("users.id"), unique=True, index=True)
    context_json = Column(JSON, nullable=False)             # 用户画像 + 历史摘要 + 偏好
    updated_at   = Column(DateTime, default=datetime.now, onupdate=datetime.now)
```

### 2.6 workflow_logs（流程可视化日志）

```python
class WorkflowLog(Base):
    __tablename__ = "workflow_logs"
    id           = Column(Integer, primary_key=True)
    task_id      = Column(String(36), ForeignKey("expert_tasks.id"), index=True)
    event_type   = Column(String(30))                       # todo_created / batch_start / agent_start / ...
    payload      = Column(JSON, nullable=False)
    created_at   = Column(DateTime, default=datetime.now)
```

---

## 3. Agent 通信协议

### 3.1 待办清单结构（主Agent输出 → 前端 + 调度引擎）

每个待办项分配**多个合适的子Agent**，它们按讨论协议协作，除非主Agent判定单个Agent即可独立完成。

```json
{
  "task_id": "uuid-v4",
  "user_query": "帮我学习心肌梗死的诊断",
  "todo_list": [
    {
      "id": "todo-1",
      "description": "检索心肌梗死的诊断标准",
      "status": "pending",
      "assignees": ["knowledge_agent"],
      "depends_on": [],
      "tools_allowed": ["web_search", "search_knowledge", "get_document"],
      "batch": 1
    },
    {
      "id": "todo-2",
      "description": "生成通俗讲解、记忆口诀、病例题",
      "status": "pending",
      "assignees": ["tutor_agent", "quiz_agent"],
      "depends_on": ["todo-1"],
      "tools_allowed": ["search_knowledge", "get_flashcards"],
      "batch": 2
    },
    {
      "id": "todo-3",
      "description": "制定本周复习计划",
      "status": "pending",
      "assignees": ["review_planner"],
      "depends_on": ["todo-2"],
      "tools_allowed": ["get_user_stats", "get_flashcards"],
      "batch": 3
    }
  ],
  "overall_status": "in_progress"
}
```

**规则**：
- `assignees` 是一个数组，即使只有1个Agent也用数组
- **多个Agent时自动进入讨论模式**：陈述期→自由讨论→收敛研判
- **单个Agent时**：跳过讨论，直接执行单Agent循环
- 只有真正需要多视角协作的任务才分配多个Agent（主Agent判断依据：是否需要不同角色互补？单一视角是否不够？）
- **每个待办项具有独立的短期上下文**：
  - **可见**：用户原始请求、待办项列表（仅 id + description 摘要，全域方向感）、`depends_on` 中前置待办项的输出、本项工具调用结果
  - **不可见**：每项的 `assignees`（谁在做）、其他项的 `depends_on` 关系、同批次并行项的输出、后续待办项的具体输出内容
  - 待办项完成后，该Agent实例的上下文清空（下一项须通过 `depends_on` 获取输出）
  - 主Agent全局持有完整上下文（所有待办项输出 + 用户原始请求），用于最终汇总
  - **设计理由**：知道全域计划能帮助 Agent 主动为后续环节留接口（如 tutor 看到后面要出题，讲解时标注考点），但不暴露执行细节避免信息过载

### 3.2 子Agent System Prompt 模板

```
你是 {name}（{role_desc}）。

## 你的能力
{role_capabilities}

## 用户原始请求
{user_query}

## 全局待办计划摘要（了解全貌，但只需完成你的部分）
{todo_list_overview}

## 你的待办项
{todo_description}

## 前置Agent的输出（请基于此继续工作）
{depends_on_outputs}

## 可用的工具
{tools_list}

## 工具调用格式
当你需要调用工具时，输出:
```
[CALL_TOOL: tool_name]
参数: {...}
```

工具返回结果后继续推理。不要假装工具结果。

## 输出格式
```
【我的分析】
...
【工具调用】（如有）
【最终输出】
...（你的结果内容）...
```

## 约束
- 只处理分配给你的待办项
- 如果工具调用失败，在输出中说明
- 如果缺少关键信息无法完成，标注 [NEED_MORE_INFO: 具体缺什么]
```

### 3.3 讨论模式协议（多Agent协作的默认模式）

当待办项的 `assignees` 包含多个Agent时，自动启动讨论模式：

```
主Agent:
  1. 创建 asyncio.Queue(maxsize=50)
  2. 启动所有 assignees 中指定的子Agent（每个有独立的 LLM 调用循环）
  3. 发送待办项描述和前置输出到队列
  
参与Agent循环:
  while not 收敛:
      从队列读取上一条发言（或其他Agent的发言）
      调用 DeepSeek (携带讨论历史 + 共享上下文 + 本Agent角色视角)
      输出包含【收敛自评: 应结束/继续，因为...】
      推入队列
      
收敛条件（任意2条满足）:
  - 所有Agent自评"应结束"
  - 知识库无法提供更多证据
  - 剩余分歧仅是非实质性的
  - 自由讨论达5轮
  - 总耗时超120秒
  
若不满足但已达轮次/时间上限，主Agent做最终表决，以多数意见为准。
```

**单个Agent时（assignees 长度为1）**：跳过讨论，直接进入单Agent工具调用循环。

---

## 4. 工具层（MCP 工具）

### 4.1 工具注册表

```python
MCP_TOOLS = {
    "web_search": {
        "description": "搜索互联网获取实时信息。输入: query(搜索词), count(条数,默认5)。返回: 搜索结果摘要列表",
        "handler": "tool_web_search",
        "timeout": 15,
    },
    "search_knowledge": {
        "description": "在用户的知识库中语义搜索。输入: query(搜索词), n_results(条数,默认5)。返回: 匹配的文档/章节片段",
        "handler": "tool_search_knowledge",
        "timeout": 10,
    },
    "get_document": {
        "description": "获取指定文档的全文或指定章节内容。输入: document_id(文档ID)或chapter_id(章节ID)。返回: 文档/章节完整内容",
        "handler": "tool_get_document",
        "timeout": 5,
    },
    "get_flashcards": {
        "description": "查询用户的抽认卡。输入: group_id(可选,卡组ID), status(可选,学习状态), limit(条数)。返回: 抽认卡列表",
        "handler": "tool_get_flashcards",
        "timeout": 5,
    },
    "get_user_stats": {
        "description": "获取用户的学习统计数据。输入: days(天数,默认30)。返回: 学习时长/效率/薄弱点",
        "handler": "tool_get_user_stats",
        "timeout": 5,
    },
}
```

### 4.2 工具调用流程

```
Agent 输出 [CALL_TOOL: web_search]\n参数: {"query":"心肌梗死诊断标准","count":5}
         ↓
主Agent解析 → 调用 tool_web_search(query="心肌梗死诊断标准", count=5)
         ↓
得到结果 → 注入 Agent 的上下文 → Agent 继续推理
         ↓
Agent 可以再次调用工具或输出最终结果
```

### 4.3 工具注入 Agent System Prompt 的方式

```python
def build_agent_system_prompt(agent: Agent, todo: dict, context: dict):
    tools = todo.get("tools_allowed", [])
    tools_text = ""
    for t in tools:
        if t in MCP_TOOLS:
            tools_text += f"\n- {t}: {MCP_TOOLS[t]['description']}"

    # 构建待办清单全局摘要（仅 id + description，不暴露 assignees）
    all_todos = context.get("all_todos", [])
    overview_lines = []
    for t in all_todos:
        marker = "← 你的任务" if t["id"] == todo["id"] else ""
        overview_lines.append(f"- {t['id']}: {t['description']} {marker}".strip())

    return AGENT_TEMPLATE.format(
        name=agent.name,
        role_desc=agent.role_desc,
        role_capabilities=agent.system_prompt,
        user_query=context["user_query"],
        todo_list_overview="\n".join(overview_lines) if overview_lines else "（无其他待办项）",
        todo_description=todo["description"],
        depends_on_outputs=context.get("depends_on_outputs", "（无前置，可自行检索）"),
        tools_list=tools_text or "无可用工具",
    )
```

---

## 5. 执行引擎

### 5.1 核心调度伪代码

```python
class Orchestrator:
    def __init__(self):
        self.agent_pool_sem = asyncio.Semaphore(10)  # 最大10个Agent并发
        self.discussion_queue = None                  # 讨论模式下的消息队列

    async def run_task(self, task_id: str, query: str, ws_send):
        # 1. 生成待办清单（每项含 assignees 数组）
        todo_list = await self._generate_todo_list(task_id, query, ws_send)
        
        # 2. 构建依赖 DAG
        batches = self._build_dependency_dag(todo_list)
        
        # 3. 逐批次执行
        for batch in batches:
            if len(batch) == 1:
                await self._execute_todo(batch[0])
            else:
                await asyncio.gather(*[self._execute_todo(t) for t in batch])
        
        # 4. 汇总
        summary = await self._summarize(task_id)
        return summary

    async def _execute_todo(self, todo: dict):
        agents = todo["assignees"]  # 数组
        if len(agents) == 1:
            # 单Agent: 直接执行
            return await self._run_single_agent(todo, agents[0])
        else:
            # 多Agent: 讨论模式
            return await self._run_discussion_mode(todo, agents)

    async def _agent_loop(self, agent_id: str, system_prompt: str):
        messages = [{"role": "system", "content": system_prompt}]
        max_iterations = 5
        
        for _ in range(max_iterations):
            response = await ai_request_manager.make_request(
                request_id=f"agent_{agent_id}",
                messages=messages,
                model="deepseek-v4-flash",
                reasoning_effort="high",
                temperature=0.3,
            )
            
            # 检查是否有工具调用
            tool_calls = self._parse_tool_calls(response)
            if tool_calls:
                for tc in tool_calls:
                    tool_result = await self._invoke_tool(tc["name"], tc["params"])
                    messages.append({"role": "assistant", "content": response})
                    messages.append({"role": "user", "content": f"[工具返回]\n{tool_result}"})
            else:
                return response  # 最终输出
        
        return response  # 达最大轮次
```

### 5.2 依赖DAG构建

```python
def _build_dependency_dag(self, todo_list: list) -> list:
    """将待办项按依赖关系分成批次"""
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
            raise Exception("DAG deadlock detected")
        
        batches.append(batch)
        for todo in batch:
            completed.add(todo["id"])
    
    return batches
```

---

## 6. 子Agent Prompt 设计

### 6.1 knowledge_agent（知识管家）

```
你是知识管家。你的核心能力：
1. 快速检索知识点（向量搜索 + 文档全文检索）
2. 解释专业术语、解剖结构、药物分类、影像特征
3. 建立知识点之间的关联

输出风格：结构化，按条目组织。关键概念加**粗体标记**。
不确定的信息必须标注"[待验证]"。
```

### 6.2 tutor_agent（教学导师）

```
你是教学导师。你的核心能力：
1. 多风格讲解（通俗/专业/形象类比）
2. 生成记忆口诀
3. 费曼测试（概念拆解到最简）
4. 苏格拉底追问（引导式思考）

输出风格：根据场景切换。讲解时先给结论再展开。口诀要简短押韵。
教学时使用"你"称呼学生，保持鼓励和支持的语气。
```

### 6.3 quiz_agent（题库专家）

```
你是题库专家。你的核心能力：
1. 生成抽认卡（问答卡+选择题）
2. 生成多题型练习题（单选/多选/简答/病例分析）
3. 评估用户答案，指出薄弱点
4. 生成考前速查卡

出题原则：先易后难，覆盖核心概念，避开偏题怪题。
选择题必须包含详细解释（为什么选这个，为什么排除其它）。
```

### 6.4 clinical_agent（临床思维教练）

```
你是临床思维教练。你的核心能力：
1. 病例分析（逐步推理）
2. 鉴别诊断（列出可能性+排除逻辑）
3. 急救推演（模拟紧急场景决策）
4. MDT模拟（多科室视角）
5. 反事实思维（"如果当初...会怎样"）

格式：先给结论框架，再逐层展开推理。鉴别诊断按概率降序排列。
```

### 6.5 review_planner（复习规划师）

```
你是复习规划师。你的核心能力：
1. 基于FSRS记忆曲线定制复习计划
2. 预测考试重点
3. 按优先级排序待复习内容
4. 打包每日任务

输出格式：按天组织的复习日程，每天标注重点内容和预计时间。
复习优先级算法：薄弱点 > 高遗忘风险 > 新学内容。
```

### 6.6 lab_agent（实验助手）

```
你是实验助手。你的核心能力：
1. 协助实验报告全流程（信息收集→表格填写→图表渲染→导出）
2. 实验数据记录模板推荐
3. 实验结果分析建议

注意：你复用现有的 ExperimentAgent 功能，通过工具调用其内部方法。
```

### 6.7 analytics_agent（学情分析师）

```
你是学情分析师。你的核心能力：
1. 薄弱点预测（基于历史错误模式）
2. 学习审计（时间分配/效率/覆盖率）
3. 学习风格分析
4. 模拟面试

输出风格：数据驱动，用具体数字说话。建议要可操作。
使用"数据显示..."开头，然后用"建议..."给出行动方案。
```

### 6.8 companion_agent（陪伴使者）

```
你是陪伴使者。你的核心能力：
1. 情绪感知和鼓励
2. 学习动力调节
3. 闲聊与减压

原则：永远积极正面，但不过度。觉察到焦虑/挫败时先共情再引导。
学习状态不佳时主动建议休息调整。不使用夸张的AI口吻。
```

### 6.9 methods_agent（方法论教练）

```
你是方法论教练。你的核心能力：
1. 论文审稿（方法学评估）
2. 科研方法讲解
3. 循证决策辅助
4. 统计帮助

原则：引用具体的方法学标准（如CONSORT、PRISMA等）。
区分"有力证据"、"中等证据"、"弱证据"级别。
```

---

## 7. 前端设计

### 7.1 页面布局

```
┌─ Header ─────────────────────────────────────────────────────────────┐
│ 🤖 灵枢（Harness）                   [📋 查看历史]  [⚙️ 设置]           │
└──────────────────────────────────────────────────────────────────────┘
┌─ 对话区 (flex-1) ────────────────────────────────────────────────────┐
│                                                                       │
│  [用户] 帮我学习心肌梗死的诊断                                         │
│                                                                       │
│  [主Agent] 收到！让我拆解这个任务...                                    │
│                                                                       │
│  ╔═══ 待办清单 ══════════════════════════════════════╗                │
│  ║ ☐ 检索心肌梗死诊断标准       knowledge_agent 🔍   ║                │
│  ║ ☐ 生成通俗讲解和记忆口诀       tutor_agent 📚      ║                │
│  ║ ☐ 生成病例题并评估            quiz_agent ✏️       ║                │
│  ║ ☐ 制定本周复习计划          review_planner 📅     ║                │
│  ╚════════════════════════════════════════════════════╝                │
│                                                                       │
│  [knowledge_agent] 已检索到以下关键信息...                              │
│                                                                       │
│  [tutor_agent] 基于知识管家的检索，我来给你讲...                         │
│                                                                       │
│  [主Agent] ✅ 全部完成！这是总结...                                      │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
┌─ 输入区 ──────────────────────────────────────────────────────────────┐
│ 📎 [粘贴文本]   📄 [上传文档]   🎤 [语音输入]                          │
│ ╔══════════════════════════════════════╗  [发送 →]                    │
│ ║ 输入你的问题...                        ║                             │
│ ╚══════════════════════════════════════╝                               │
└──────────────────────────────────────────────────────────────────────┘
```

### 7.2 待办清单看板（侧边浮动）

```
┌─ 📋 待办清单 ────────────────────────┐
│ 📖 学习心肌梗死的诊断                  │
│                                       │
│ ✅ 检索诊断标准     knowledge_agent    │
│ ✅ 生成讲解和口诀    tutor_agent        │
│ 🔄 生成病例题       quiz_agent (进行中) │
│ ⏳ 制定复习计划     review_planner      │
│                                       │
│ ████████████░░░░ 75%                  │
└───────────────────────────────────────┘
```

状态图标：
- `⏳` pending = 待执行
- `🔄` doing = 正在执行（旋转动画）
- `✅` done = 已完成（绿色）
- `❌` failed = 失败（红色）
- `💬` discussing = 讨论中（弹跳动画）

### 7.3 对话消息渲染

每条 Agent 消息格式：
```
┌─ [Agent图标] [Agent名称] ─ [时间戳] ──────────────────────────────┐
│                                                                      │
│  [工具调用: web_search "心肌梗死诊断标准"] (折叠，点击展开)             │
│                                                                      │
│  [Agent输出正文]                                                      │
│  (markdown 渲染，支持代码块/表格/公式)                                  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

讨论模式消息：
```
┌─ 💬 专家讨论 ───────────────────────────────────────────────────────┐
│ [tutor_agent] 我认为这里应该先讲定义再讲诊断...                       │
│ [clinical_agent] 同意，但病例分析应该放在最后作为检验...              │
│ [tutor_agent] 好，那先定义→诊断标准→病例分析，这样递进。建议结束。    │
│ [clinical_agent] 同意结束。                                          │
│ ── 讨论结论 ──                                                       │
│ 采用定义→诊断标准→病例分析的递进结构...                                │
└──────────────────────────────────────────────────────────────────────┘
```

### 7.4 WebSocket 消息格式

```typescript
// 待办清单更新
{ type: "todo_update", task_id: "uuid", todo_list: [...] }

// Agent 消息（流式 token）
{ type: "agent_token", agent_id: "knowledge", token: "心肌" }
{ type: "agent_token", agent_id: "knowledge", token: "梗死" }

// Agent 消息完成
{ type: "agent_message", agent_id: "knowledge", content: "完整文本", 
  tool_calls: [...], done: true }

// 工具调用
{ type: "tool_call", agent_id: "knowledge", tool: "web_search", 
  input: {...}, output: {...} }

// 讨论模式
{ type: "discussion_start", participants: ["tutor", "clinical"] }
{ type: "discussion_message", from: "tutor", content: "..." }
{ type: "discussion_end", conclusion: "..." }

// 任务完成
{ type: "task_complete", task_id: "uuid", summary: "..." }
```

### 7.5 视觉设计要求

- **美学方向**：玻璃拟态 + 暖色科技感（延续现有 amber/stone 主题色但有 Agent 专属辨识度）
- **Agent 标识**：每个 Agent 有独立图标颜色和头像
- **动画**：
  - 消息入场: `fadeInUp` spring
  - 待办项状态切换: 图标缩放 + 颜色过渡 + 完成时划线动画
  - 讨论模式: 参与者头像微微弹跳
  - Token 打字机效果（流式片段接续渲染）
  - 发送按钮: loading 旋转 + 脉冲波纹

---

## 8. API 设计

### 8.1 核心端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/agent/agents` | 获取所有可用Agent列表 |
| `WEBSOCKET` | `/ws/agent/{user_id}` | Agent对话主通道 |
| `GET` | `/api/v1/agent/tasks` | 用户历史任务列表 |
| `GET` | `/api/v1/agent/tasks/{id}` | 任务详情（含待办清单） |
| `POST` | `/api/v1/agent/tasks/{id}/abort` | 中断任务 |
| `GET` | `/api/v1/agent/session` | 获取长期会话上下文 |
| `DELETE` | `/api/v1/agent/session` | 清除会话上下文 |

### 8.2 WebSocket 协议

**客户端 → 服务端**:
```json
{ "action": "chat", "text": "用户输入", "attachments": [] }
{ "action": "abort" }
{ "action": "ping" }
```

**服务端 → 客户端**:
- `todo_update` — 待办清单列表更新
- `agent_token` — 子Agent正在流式输出（逐token）
- `agent_message` — 子Agent输出完成（完整文本 + 工具调用记录）
- `tool_call` — 工具调用通知
- `discussion_start` / `discussion_token` / `discussion_end` — 讨论模式
- `orchestrator_summary` — 主Agent最终汇总
- `task_complete` — 任务结束
- `task_error` — 任务异常终止
- `pong` — 心跳响应

---

## 9. 实施阶段

### Phase 1: 基础架构 + 核心Agent（5 Agent）

**交付物**:
- Agent 模型建表（6张新表）
- Orchestrator 引擎（待办生成 + DAG拆分 + 单Agent调度）
- Tool Layer（web_search + search_knowledge + get_document）
- 5 个 Agent System Prompt（knowledge + tutor + quiz + review_planner + companion）
- 前端 `/agent` 基本页面（对话 + 待办看板 + SSE 流式渲染）
- 无依赖项并行执行（asyncio.gather）

**不包含**: 讨论模式、流程可视化、Phase 2/3 的 Agent

### Phase 2: 协作 + 流程可视化（+3 Agent）

**交付物**:
- 讨论模式引擎（asyncio.Queue 多Agent对话 + 收敛控制）
- 3 个 Agent System Prompt（clinical + lab + analytics）
- 前端流程可视化面板（React Flow / 简易节点图）
- 工具 get_flashcards / get_user_stats
- MCP 工具协议标准化

### Phase 3: 长期记忆 + 全面Agent（+1 Agent）

**交付物**:
- 1 个 Agent System Prompt（methods）
- 用户长期会话记忆（user_agent_sessions 的读写与注入）
- 用户画像自动更新
- 跨任务上下文关联检索
- 前端历史任务浏览与继续

---

## 10. 与现有系统的关系

| 现有模块 | Agent 如何使用 |
|----------|---------------|
| `ai_request_manager` | 所有 Agent 调用 DeepSeek 的唯一出口，复用 40 Key pool |
| `web_search_manager` | 作为 MCP tool `web_search` 的后端实现 |
| `vector_db_service` | 作为 MCP tool `search_knowledge` 的后端实现 |
| `document_service` | 作为 MCP tool `get_document` 的数据源 |
| `experiment_agent` | lab_agent 底层复用其方法 |
| `flashcard_service` | 作为 MCP tool `get_flashcards` 的数据源 |
| `analytics` API | 作为 MCP tool `get_user_stats` 的数据源 |

**不侵入现有模块**。Agent 系统通过 MCP tool 层解耦访问，现有业务逻辑零改动。

---

## Spec 自审清单

- [x] 占位符扫描: 无 TBD/TODO
- [x] 内部一致性: 架构图与数据模型一致，API 与 WebSocket 协议一致
- [x] 范围检查: Phase 1 明确可独立交付，不含 Phase 2/3 功能
- [x] 歧义检查: 所有 Agent 角色有 System Prompt 模板，工具调用格式明确
- [x] 现有系统兼容: 明确列出复用关系，不侵入现有代码
