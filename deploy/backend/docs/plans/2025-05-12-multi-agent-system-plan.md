# 多Agent专家组系统 — 实现计划

> **For agentic workers:** Execute task by task, commit after each, verify before moving on.

**Goal:** 从零构建多Agent专家组系统：主Agent协调器 + 9个子Agent + MCP工具层 + WebSocket实时通信 + 独立Agent前端页面

**Architecture:** 后端新增 `agent_orchestrator.py` / `agent_tool_layer.py` / `agent_prompts.py` / `agent_websocket.py` / `agent.py`(模型)。前端新增 `/agent` 全屏页面。所有Agent复用 `ai_request_manager` 40 Key池。

**Tech Stack:** Python + FastAPI + WebSocket + SQLAlchemy + DeepSeek v4-flash + asyncio + React + TypeScript + motion/react

---

## Phase 1: 基础架构 + 5 核心 Agent + 前端 Agent 页面

**交付标准**: 用户可在 `/agent` 提问，主Agent生成待办清单推送，5个子Agent按DAG分批并行执行（单Agent直接循环，多Agent自动讨论协作），前端实时展示。

### 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `backend/app/models/agent.py` | Create | 6表：Agent/ExpertTask/TaskContext/SessionMessage/UserAgentSession/WorkflowLog |
| `backend/app/services/agent_tool_layer.py` | Create | MCP工具注册 + 5 handler |
| `backend/app/services/agent_prompts.py` | Create | Orchestrator + 9 Agent Prompt |
| `backend/app/services/agent_orchestrator.py` | Create | 调度引擎（清单→DAG→批次→Agent循环） |
| `backend/app/core/agent_websocket.py` | Create | WS处理器 |
| `backend/app/api/v1/agent.py` | Create | REST端点 |
| `backend/main.py` | Modify | 注册路由 + WS + seed |
| `frontend/src/pages/Agent.tsx` | Create | 对话窗 + 看板 + WS |
| `frontend/src/App.tsx` | Modify | 添加 /agent 路由 |

---

### Task 1: 数据库模型

**Files:** Create `backend/app/models/agent.py`, Modify `backend/main.py`

- [ ] **Step 1: 创建 agent.py**

```python
import enum, uuid
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, JSON
from app.db.base import Base

def uuid4_str() -> str:
    return str(uuid.uuid4())

class TaskStatus(str, enum.Enum):
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"

class Agent(Base):
    __tablename__ = "agents"
    id = Column(String(50), primary_key=True)
    name = Column(String(100), nullable=False)
    role_desc = Column(Text, nullable=False)
    system_prompt = Column(Text, nullable=False)
    tools = Column(JSON, nullable=True)
    icon = Column(String(10), nullable=True)
    phase = Column(Integer, default=1)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now)

class ExpertTask(Base):
    __tablename__ = "expert_tasks"
    id = Column(String(36), primary_key=True, default=uuid4_str)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    query = Column(Text, nullable=False)
    todo_list = Column(JSON, nullable=False)
    status = Column(String(20), default=TaskStatus.IN_PROGRESS)
    summary = Column(Text, nullable=True)
    started_at = Column(DateTime, default=datetime.now)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)

class TaskContext(Base):
    __tablename__ = "task_contexts"
    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String(36), ForeignKey("expert_tasks.id"), unique=True, index=True)
    context_json = Column(JSON, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now)

class SessionMessage(Base):
    __tablename__ = "session_messages"
    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String(36), ForeignKey("expert_tasks.id"), index=True)
    from_agent = Column(String(50), nullable=False)
    to_agent = Column(String(50), nullable=True)
    phase = Column(String(20), nullable=True)
    type = Column(String(20), default="message")
    content = Column(Text, nullable=False)
    agent_raw = Column(Text, nullable=True)
    tools_called = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.now)

class UserAgentSession(Base):
    __tablename__ = "user_agent_sessions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, index=True)
    context_json = Column(JSON, nullable=False, default=dict)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

class WorkflowLog(Base):
    __tablename__ = "workflow_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String(36), ForeignKey("expert_tasks.id"), index=True)
    event_type = Column(String(30), nullable=True)
    payload = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.now)
```

- [ ] **Step 2: main.py 添加模型导入**

```python
# 在 main.py 顶部 import 区域添加
from app.models.agent import Agent, ExpertTask, TaskContext, SessionMessage, UserAgentSession, WorkflowLog
```

- [ ] **Step 3: main.py 添加 Agent seed**

在 `lifespan` startup 中 `_ensure_missing_columns()` 之后添加：
```python
# Seed 默认 Agent 数据
try:
    async with engine.begin() as conn:
        from sqlalchemy import select
        from app.models.agent import Agent as AgentModel
        result = await conn.execute(select(AgentModel).limit(1))
        if result.first() is None:
            from app.services.agent_prompts import AGENT_DEFINITIONS
            for agent_def in AGENT_DEFINITIONS:
                await conn.execute(AgentModel.__table__.insert().values(
                    id=agent_def["id"], name=agent_def["name"],
                    role_desc=agent_def["role_desc"], system_prompt=agent_def["system_prompt"],
                    tools=agent_def.get("tools", []), icon=agent_def.get("icon", "🤖"),
                    phase=agent_def.get("phase", 1), is_active=agent_def.get("is_active", True),
                ))
            logger.info(f"✅ Seed {len(AGENT_DEFINITIONS)} 个Agent完成")
except Exception as e:
    logger.warning(f"Agent seed 失败: {e}")
```

- [ ] **Step 4: 编译验证**

Run: `python -c "from app.models.agent import Agent; print('OK')"` (cwd: backend)

---

### Task 2: MCP 工具层

**Files:** Create `backend/app/services/agent_tool_layer.py`

- [ ] **Step 1: 创建文件**

完整代码见 Spec §4 —— 包含 `MCP_TOOLS` 字典 + 5 个 `_tool_*` handler + `invoke_tool()` + `get_tool_descriptions()`。每个 handler 通过懒导入复用现有服务（web_search_manager / vector_db_service / document_service / flashcard模型 / DailyStats模型）。

- [ ] **Step 2: 编译验证**

Run: `python -c "import py_compile; py_compile.compile('app/services/agent_tool_layer.py', doraise=True); print('OK')"` (cwd: backend)

---

### Task 3: Agent System Prompt

**Files:** Create `backend/app/services/agent_prompts.py`

- [ ] **Step 1: 创建文件**

包含：
- `ORCHESTRATOR_PROMPT` — 主Agent清单生成模板。待办项中 `assignees` 为**数组**，主Agent判断每个待办项需要的子Agent角色（可以1个或多個），1个时单独执行，多个时自动讨论协作。
- `AGENT_TEMPLATE` — 子Agent通用模板（含 `{name}/{role_desc}/{capabilities}/{user_query}/{todo_description}/{depends_on_outputs}/{tools_list}` 占位符）。支持讨论模式（接收其他Agent发言 + 输出【收敛自评】）
- `DISCUSSION_TEMPLATE` — 讨论模式专用模板（含其他Agent发言历史 + 本角色视角 + 收敛自评要求）
- 5 个核心 Agent 的完整 Prompt（KNOWLEDGE/TUTOR/QUIZ/REVIEW_PLANNER/COMPANION）
- 4 个 Phase 2/3 Agent 的占位 Prompt，`is_active=False`
- `AGENT_DEFINITIONS` 列表

完整内容见 Spec §6。

- [ ] **Step 2: 编译验证**

Run: `python -c "import py_compile; py_compile.compile('app/services/agent_prompts.py', doraise=True); print('OK')"` (cwd: backend)

---

### Task 4: 执行引擎（含讨论模式）

**Files:** Create `backend/app/services/agent_orchestrator.py`

- [ ] **Step 1: 创建文件**

核心类 `Orchestrator`，包含方法：

| 方法 | 职责 |
|------|------|
| `run_task(task_id, query, ws_send)` | 入口：生成清单→DAG→批次→循环→汇总 |
| `_generate_todo_list()` | 调用 DeepSeek 生成清单 JSON（每项含 `assignees` 数组），解析失败时 fallback |
| `_build_dependency_dag()` | 按 depends_on 拓扑排序分批次 |
| `_execute_todo()` | **核心调度**：`len(assignees)==1` → 单Agent循环；`>1` → 讨论模式 |
| `_run_single_agent()` | 构建 System Prompt + 注入前置输出 + 调用 _agent_loop |
| `_agent_loop()` | 多轮对话循环：调用 DeepSeek → 检测 `[CALL_TOOL]` → 注入工具结果 → 最多5轮 |
| `_run_discussion_mode()` | 多Agent协作：asyncio.Queue → 陈述→讨论→收敛→结论 |
| `_parse_tool_calls()` | 正则提取 `[CALL_TOOL: xxx]\n参数: {...}` |
| `_extract_final_output()` | 提取 `【最终输出】` 段落 |
| `_summarize()` | 汇总所有 Agent 输出 → 最终回复 |
| `abort()` | 设置中断标志 |
| `get_orchestrator(user_id)` / `remove_orchestrator(user_id)` | 实例管理 |

关键参数：
- `asyncio.Semaphore(10)` 控制并发
- Agent 循环 `max_iterations=5`
- 工具调用上限 3 次
- 模型 `deepseek-v4-flash`, `reasoning_effort="high"`, `temperature=0.3`
- **上下文注入**：每个Agent收到 `{user_query}` + `{todo_list_overview}`（全域计划摘要，仅 id+description，不暴露 assignees）+ `{depends_on_outputs}`（前置输出）。`_execute_todo` 中传入 `all_todos` 构建 overview

完整伪代码见 Spec §5。

- [ ] **Step 2: 编译验证**

Run: `python -c "from app.services.agent_orchestrator import Orchestrator; print('OK')"` (cwd: backend)

---

### Task 5: WebSocket 处理器

**Files:** Create `backend/app/core/agent_websocket.py`

- [ ] **Step 1: 创建文件**

类 `AgentWSManager`：
- `connect(user_id, ws)` / `disconnect(user_id)` / `send(user_id, data)`
- `handle(user_id, websocket)` — 主循环：
  - 接收 `{"action":"chat","text":"..."}` → 创建 `ExpertTask` → `Orchestrator.run_task()` → 完成后更新 DB
  - 接收 `{"action":"abort"}` → `Orchestrator.abort()`
  - 接收 `{"action":"ping"}` → `{"type":"pong"}`
  - 断开时清理 `Orchestrator` 实例

- [ ] **Step 2: 编译验证**

Run: `python -c "import py_compile; py_compile.compile('app/core/agent_websocket.py', doraise=True); print('OK')"` (cwd: backend)

---

### Task 6: REST API

**Files:** Create `backend/app/api/v1/agent.py`

- [ ] **Step 1: 创建文件**

端点的 Flavor：
```
GET  /api/v1/agent/agents          → 返回所有 is_active=True 的 Agent
GET  /api/v1/agent/tasks           → 用户最近 30 个任务（按 started_at desc）
GET  /api/v1/agent/tasks/{id}      → 任务详情（含 todo_list, summary）
POST /api/v1/agent/tasks/{id}/abort → 提示通过 WebSocket 中断
GET  /api/v1/agent/session         → 获取 UserAgentSession.context_json
DELETE /api/v1/agent/session       → 清空会话上下文
```

所有端点需要 `get_current_user` 依赖。

- [ ] **Step 2: 编译验证**

Run: `python -c "import py_compile; py_compile.compile('app/api/v1/agent.py', doraise=True); print('OK')"` (cwd: backend)

---

### Task 7: 后端集成

**Files:** Modify `backend/main.py`

- [ ] **Step 1: 添加 REST 路由**

```python
from app.api.v1.agent import router as agent_router
app.include_router(agent_router)
```

- [ ] **Step 2: 添加 WebSocket 路由**

```python
from app.core.agent_websocket import agent_ws_manager

@app.websocket("/ws/agent/{user_id}")
async def agent_websocket(websocket: WebSocket, user_id: int):
    await agent_ws_manager.handle(user_id, websocket)
```

- [ ] **Step 3: 编译验证**

Run: `python -c "import py_compile; py_compile.compile('main.py', doraise=True); print('OK')"` (cwd: backend)

- [ ] **Step 4: 启动验证**

Run: `python main.py` → check stdout: `✅ Seed 9 个Agent完成` → `curl http://localhost:8080/api/v1/agent/agents`

---

### Task 8: 前端 Agent 页面

**Files:** Create `frontend/src/pages/Agent.tsx`, Modify `frontend/src/App.tsx`

- [ ] **Step 1: 创建 Agent.tsx**

完整 React 组件，结构：

```
┌─ Header: "🤖 智能学习助手" + 完成进度 ────────────────────┐
├─ 对话区 (flex-1, overflow-y-auto) ────────────────────────┤
│  messages.map → 每条: [头像] [气泡: agent名 + 内容 + 工具调用折叠] │
│  toolCalls.filter('calling') → "正在调用 xxx..." 加载提示     │
│  loading && 无回复 → 三点弹跳等待动画                           │
├─ 待办看板 (todos.length > 0 时显示) ───────────────────────┤
│  横向 scroll，每张卡片: [Agent标签] [状态图标] [描述]           │
└─ 输入区: [输入框] + [发送/中断按钮] ────────────────────────┘
```

关键 hooks：
- `useEffect` 建立 WS 连接 `ws://localhost:8080/ws/agent/{userId}`
- `ws.onmessage` 处理全部 `todo_update/agent_message/tool_call/tool_call_result/orchestrator_summary/task_complete/task_error` 消息
- `handleSend()` 发 `{"action":"chat","text":"..."}`
- `handleAbort()` 发 `{"action":"abort"}`
- 支持 Enter 发送

状态管理：
- `todos: TodoItem[]` — 待办清单
- `messages: AgentMessage[]` — 对话消息
- `toolCalls: ToolCallNotification[]` — 工具调用通知
- `loading: boolean` — 任务进行中
- `orchestratorSummary: string | null` — 最终汇总

组件参数：`AGENT_COLORS` 颜色映射 + `STATUS_CONFIG` 状态配置

- [ ] **Step 2: App.tsx 添加路由**

```tsx
import AgentPage from './pages/Agent'
// Routes 中添加:
<Route path="/agent" element={<LoginPromptWrapper><AgentPage /></LoginPromptWrapper>} />
// isFullPageRoute 数组中添加 '/agent'
```

- [ ] **Step 3: 编译验证**

Run: `cd e:\一遍过\frontend ; npx tsc --noEmit 2>&1 | Select-String "error TS"` (cwd: frontend)
Expected: 无输出

---

### Task 9: 端到端验证

- [ ] **Step 1: 后端启动验证**

Run: `cd backend ; python main.py`
Check: stdout `✅ Seed 9 个Agent完成` + `http://localhost:8080/api/v1/agent/agents` 返回 5 个激活 Agent + `http://localhost:8080/health` 返回 200

- [ ] **Step 2: 前端启动验证**

Run: `cd frontend ; npm run dev` → `http://localhost:5173/agent` 页面渲染

- [ ] **Step 3: 功能测试**

1. 登录 → `/agent` → 输入 "解释什么是心肌梗死"
2. 观察：待办看板出现，状态从 pending→doing→done
3. 观察：工具调用通知（web_search 等）
4. 观察：最终汇总
5. 测试中断按钮

---

## Phase 2: +2 Agent + React Flow 流程可视化 + 3面板布局

**交付标准**: clinical_agent（临床思维教练）+ analytics_agent（学情分析师）上线，前端三面板布局（待办看板 + 对话区仅主Agent输出 + React Flow 讨论可视化），流程面板节点为Agent、边为通信、点击预览内容。lab_agent 已移除。

**Phase 2 Agent 总数**: 7 个活跃（Phase 1 的 5 个 + clinical + analytics）

**前端布局**:
```
┌─ 待办清单看板 (w-72, 左侧固定) ──┬─ 对话区 (flex-1, 仅主Agent输出) ──┐
│                                   │                                   │
│  📖 任务摘要                       │  [用户] 帮我分析一个急性胸痛病例     │
│  ────────────────────              │                                   │
│  ✅ todo-1: 检索诊断标准           │  [主Agent] 收到！已拆解为3个待办... │
│  🔄 todo-2: 讲解+出题 (进行中)     │                                   │
│     ┌─ 📚 tutor                   │                                   │
│     ├─ ✏️ quiz                    │                                   │
│     └─ 💬 讨论中...                │                                   │
│  ⏳ todo-3: 复习计划               │  [主Agent] ✅ 全部完成！汇总...    │
│                                   │                                   │
└───────────────────────────────────┴───────────────────────────────────┘

┌─ 流程可视化面板 (讨论模式时弹出/展开) ──────────────────────────────────┐
│  [React Flow 节点图]                                                    │
│                                                                         │
│  ┌─────────┐    消息边    ┌─────────┐                                  │
│  │ 📚 tutor │─────→──────│ ✏️ quiz  │                                  │
│  │ (思考中) │             │ (等待中) │                                  │
│  └─────────┘             └─────────┘                                  │
│                                                                         │
│  点击节点 → 状态卡片 (活跃中/思考中/等待中)                               │
│  点击边   → 消息预览面板 (交流内容)                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

**子Agent输出规则**：
- 子Agent的中间输出**不在对话区渲染**，用户不可直接看到
- 子Agent的输出仅在流程可视化面板的**边点击预览**中可见
- 主Agent的汇总输出在对话区流式显示，是用户看到的唯一Agent输出
- 工具调用通知在待办清单看板中标记（如 "🔧 web_search"）而非对话区

---

### 文件结构（Phase 2 改动）

| 文件 | 操作 | 职责 |
|------|------|------|
| `frontend/package.json` | **Modify** | 添加 `@xyflow/react` 依赖 |
| `frontend/src/pages/Agent.tsx` | **Rewrite** | 三面板布局：待办看板 + 对话区(仅主Agent) + 流程面板入口 |
| `frontend/src/components/FlowPanel.tsx` | **Create** | React Flow 节点图：Agent节点 + 消息边 + 点击交互 |
| `frontend/src/components/TodoPanel.tsx` | **Create** | 待办清单侧边看板组件 |
| `backend/app/services/agent_prompts.py` | **Modify** | clinical + analytics 完整 Prompt |
| `backend/app/services/agent_orchestrator.py` | **Modify** | 讨论模式推送 workflow 消息 + 结论增强 |
| `backend/app/api/v1/agent.py` | **Modify** | 新增 messages 端点 |

---

### Task 10: 安装 @xyflow/react

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: 安装依赖**

Run: `cd e:\一遍过\frontend ; npm install @xyflow/react`
Expected: 安装成功，版本约为 12.x

- [ ] **Step 2: 验证导入**

Run: `cd e:\一遍过\frontend ; node -e "require('@xyflow/react'); console.log('OK')"`

---

### Task 11: TodoPanel 组件 — 待办清单看板

**Files:**
- Create: `frontend/src/components/TodoPanel.tsx`
- Modify: `frontend/src/pages/Agent.tsx`（集成 TodoPanel）

- [ ] **Step 1: 创建 TodoPanel.tsx**

```tsx
import { motion, AnimatePresence } from 'motion/react'
import { Check, Loader2, ChevronRight, Sparkles, Users } from 'lucide-react'

interface TodoItem {
  id: string
  description: string
  assignees: string[]
  status: 'pending' | 'doing' | 'done' | 'failed'
  depends_on: string[]
  batch: number
  discussion?: boolean
}

const AGENT_ICONS: Record<string, string> = {
  knowledge_agent: '🔍', tutor_agent: '📚', quiz_agent: '✏️',
  review_planner: '📅', companion_agent: '💛', clinical_agent: '🩺',
  analytics_agent: '📊', methods_agent: '📖',
}

interface Props {
  todos: TodoItem[]
  currentDiscussionTodoId: string | null
  onTodoClick: (todoId: string) => void
}

export default function TodoPanel({ todos, currentDiscussionTodoId, onTodoClick }: Props) {
  if (todos.length === 0) return null

  const doneCount = todos.filter(t => t.status === 'done').length

  return (
    <div className="w-72 flex-shrink-0 border-r border-stone-200/60 bg-white/60 backdrop-blur-xl flex flex-col h-full">
      <div className="px-4 py-3 border-b border-stone-200/40 flex items-center justify-between">
        <span className="text-sm font-semibold text-stone-700 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-500" />
          待办清单
        </span>
        <span className="text-xs text-stone-400 bg-stone-100 px-2 py-0.5 rounded-full">
          {doneCount}/{todos.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <AnimatePresence>
          {todos.map(todo => {
            const isDiscussing = currentDiscussionTodoId === todo.id
            return (
              <motion.div
                key={todo.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2 }}
                className={`rounded-xl border p-3 cursor-pointer transition-all ${
                  isDiscussing ? 'border-purple-300 bg-purple-50/60 ring-1 ring-purple-200' :
                  todo.status === 'done' ? 'border-emerald-200/60 bg-emerald-50/30' :
                  todo.status === 'doing' ? 'border-amber-200/60 bg-amber-50/30' :
                  todo.status === 'failed' ? 'border-rose-200/60 bg-rose-50/30' :
                  'border-stone-200/60 bg-white/50 hover:border-amber-200/40'
                }`}
                onClick={() => onTodoClick(todo.id)}
              >
                <div className="flex items-start gap-2">
                  <span className="flex-shrink-0 mt-0.5">
                    {todo.status === 'done' ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : todo.status === 'doing' ? (
                      <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                    ) : todo.status === 'failed' ? (
                      <span className="w-4 h-4 rounded-full border-2 border-rose-400 block" />
                    ) : (
                      <span className="w-4 h-4 rounded-full border-2 border-stone-300 block" />
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-stone-700 leading-snug">{todo.description}</p>
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      {todo.assignees.map(a => (
                        <span key={a} className="text-[10px] text-stone-400">
                          {AGENT_ICONS[a] || '🤖'}
                        </span>
                      ))}
                      {todo.assignees.length > 1 && (
                        <span className="text-[10px] text-purple-400 flex items-center gap-0.5">
                          <Users className="w-2.5 h-2.5" />
                          讨论中
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 编译验证**

Run: `cd e:\一遍过\frontend ; npx tsc --noEmit 2>&1 | Select-String "error TS"`
Expected: 零错误

---

### Task 12: FlowPanel 组件 — React Flow 节点图

**Files:**
- Create: `frontend/src/components/FlowPanel.tsx`

- [ ] **Step 1: 创建 FlowPanel.tsx**

```tsx
import { useCallback, useState, useMemo } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  type Node, type Edge, type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { motion, AnimatePresence } from 'motion/react'
import { X, MessageCircle, Loader2, Zap } from 'lucide-react'

interface FlowNodeData {
  agent_id: string
  agent_name: string
  agent_icon: string
  status: 'active' | 'thinking' | 'waiting'
}

interface FlowEdgeData {
  from_agent: string
  to_agent: string
  content: string
  timestamp: number
}

interface Props {
  visible: boolean
  nodes: { id: string; data: FlowNodeData }[]
  edges: { id: string; source: string; target: string; data: FlowEdgeData }[]
  onClose: () => void
}

const AGENT_COLORS: Record<string, string> = {
  knowledge_agent: '#f59e0b', tutor_agent: '#8b5cf6', quiz_agent: '#10b981',
  review_planner: '#f43f5e', companion_agent: '#ec4899',
  clinical_agent: '#06b6d4', analytics_agent: '#6366f1',
}

function AgentNode({ data, selected }: { data: FlowNodeData; selected: boolean }) {
  const statusColors = {
    active: 'ring-emerald-400 bg-emerald-50',
    thinking: 'ring-amber-400 bg-amber-50',
    waiting: 'ring-stone-300 bg-stone-50',
  }
  const pulses = data.status === 'thinking'

  return (
    <div className={`px-3 py-2 rounded-xl border-2 ring-2 ${statusColors[data.status]} ${selected ? 'scale-105' : ''} transition-all`}>
      <div className="flex items-center gap-2">
        <span className="text-lg">{data.data.agent_icon}</span>
        <span className="text-xs font-semibold text-stone-700">{data.data.agent_name}</span>
        {pulses && (
          <Loader2 className="w-3 h-3 text-amber-500 animate-spin" />
        )}
      </div>
      <span className={`text-[10px] mt-1 block ${
        data.data.status === 'active' ? 'text-emerald-600' :
        data.data.status === 'thinking' ? 'text-amber-600' : 'text-stone-400'
      }`}>
        {data.data.status === 'active' ? '活跃中' :
         data.data.status === 'thinking' ? '思考中' : '等待中'}
      </span>
    </div>
  )
}

export default function FlowPanel({ visible, nodes, edges, onClose }: Props) {
  const [selectedEdge, setSelectedEdge] = useState<FlowEdgeData | null>(null)

  const rfNodes: Node[] = useMemo(() => nodes.map((n, i) => ({
    id: n.id,
    type: 'default',
    position: { x: 100 + (i * 220), y: 150 },
    data: n.data,
    style: { background: 'transparent', border: 'none', padding: 0, width: 'auto' },
  })), [nodes])

  const rfEdges: Edge[] = useMemo(() => edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: true,
    label: '💬',
    style: { stroke: '#a78bfa', strokeWidth: 2 },
    markerEnd: { type: 'arrowclosed' as const, color: '#a78bfa' },
    data: e.data,
  })), [edges])

  const onEdgeClick = useCallback((_: any, edge: Edge) => {
    setSelectedEdge(edge.data as FlowEdgeData)
  }, [])

  if (!visible) return null

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 300 }}
      exit={{ opacity: 0, height: 0 }}
      className="absolute bottom-20 left-72 right-0 bg-white/95 backdrop-blur-xl border-t border-purple-200 shadow-lg z-30"
    >
      <div className="flex items-center justify-between px-4 py-2 bg-purple-50/60 border-b border-purple-100">
        <span className="text-sm font-semibold text-purple-700 flex items-center gap-2">
          <Zap className="w-4 h-4" />
          专家协作流程
        </span>
        <button onClick={onClose} className="text-purple-400 hover:text-purple-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex h-[calc(100%-40px)]">
        <div className="flex-1">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onEdgeClick={onEdgeClick}
            nodeTypes={{ default: AgentNode }}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={true}
          >
            <Background color="#f3f4f6" gap={20} />
            <Controls />
            <MiniMap nodeStrokeColor="#d4d4d8" nodeColor="#faf5ff" maskColor="rgba(0,0,0,0.05)" />
          </ReactFlow>
        </div>

        <AnimatePresence>
          {selectedEdge && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="border-l border-purple-200 bg-white/90 backdrop-blur-sm overflow-y-auto p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <MessageCircle className="w-4 h-4 text-purple-500" />
                <span className="text-xs font-semibold text-purple-600">
                  {selectedEdge.from_agent} → {selectedEdge.to_agent}
                </span>
              </div>
              <p className="text-sm text-stone-700 whitespace-pre-wrap break-words">
                {selectedEdge.content}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
```

- [ ] **Step 2: 编译验证**

Run: `cd e:\一遍过\frontend ; npx tsc --noEmit 2>&1 | Select-String "error TS"`
Expected: 零错误

---

### Task 13: 重写 Agent.tsx — 三面板布局 + 仅主Agent对话

**Files:**
- Rewrite: `frontend/src/pages/Agent.tsx`

- [ ] **Step 1: 重写 Agent.tsx 核心架构**

新架构关键变化：
1. **待办清单看板** — 左侧固定 280px，`<TodoPanel>` 组件
2. **对话区** — 仅渲染 `orchestrator_summary` 和 `task_complete` 到消息列表，子Agent的 `agent_message` **不**渲染到对话区
3. **流程面板** — 讨论模式时底部弹出 `<FlowPanel>`，接收 `workflow_*` WS消息构建节点/边
4. 状态新增：`flowNodes`, `flowEdges`, `currentDiscussionTodoId`

```tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useAuth } from '../hooks/useAuth'
import { Send, Sparkles, X, Loader2, ExternalLink } from 'lucide-react'
import TodoPanel from '../components/TodoPanel'
import FlowPanel from '../components/FlowPanel'

interface TodoItem {
  id: string
  description: string
  assignees: string[]
  status: 'pending' | 'doing' | 'done' | 'failed'
  depends_on: string[]
  batch: number
}

interface FlowNodeData { agent_id: string; agent_name: string; agent_icon: string; status: 'active' | 'thinking' | 'waiting' }
interface FlowEdgeData { from_agent: string; to_agent: string; content: string; timestamp: number }

export default function AgentPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [messages, setMessages] = useState<{ id: string; role: string; content: string; tool_calls?: any[] }[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const [flowVisible, setFlowVisible] = useState(false)
  const [flowNodes, setFlowNodes] = useState<{ id: string; data: FlowNodeData }[]>([])
  const [flowEdges, setFlowEdges] = useState<{ id: string; source: string; target: string; data: FlowEdgeData }[]>([])
  const [currentDiscussionTodoId, setCurrentDiscussionTodoId] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])
  useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])

  useEffect(() => {
    if (!user?.id) return
    const ws = new WebSocket(`ws://localhost:8080/ws/agent/${user.id}`)
    wsRef.current = ws
    ws.onopen = () => setWsConnected(true)
    ws.onclose = () => setWsConnected(false)
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      switch (data.type) {
        case 'todo_update':
          setTodos(data.todo_list)
          break

        // 仅主Agent汇总消息进入对话区
        case 'orchestrator_summary':
          setMessages(prev => [...prev, { id: `summary-${Date.now()}`, role: 'orchestrator', content: data.content }])
          setLoading(false)
          break

        // 子Agent消息不进入对话区（仅用于flowPanel）
        case 'agent_message':
          // 不渲染到对话区
          break

        case 'tool_call':
          // 不在对话区渲染，在待办看板标记即可
          break

        // 流程可视化消息
        case 'workflow_nodes':
          setFlowNodes(data.nodes.map((n: any) => ({ id: n.id, data: n.data })))
          setFlowVisible(true)
          break
        case 'workflow_node_update':
          setFlowNodes(prev => prev.map(n => n.id === data.node_id ? { ...n, data: { ...n.data, status: data.status } } : n))
          break
        case 'workflow_edge':
          setFlowEdges(prev => [...prev, { id: data.edge_id, source: data.from, target: data.to, data: { from_agent: data.from, to_agent: data.to, content: data.content, timestamp: Date.now() } }])
          break
        case 'discussion_end':
          setFlowVisible(false)
          setCurrentDiscussionTodoId(null)
          setTimeout(() => { setFlowNodes([]); setFlowEdges([]) }, 2000)
          break

        case 'task_complete':
          setLoading(false)
          break
        case 'task_error':
          setLoading(false)
          setMessages(prev => [...prev, { id: `err-${Date.now()}`, role: 'system', content: `❌ ${data.message}` }])
          break
      }
    }
    return () => { ws.close() }
  }, [user?.id])

  const handleSend = () => {
    if (!input.trim() || loading || !wsRef.current) return
    const text = input.trim()
    setInput('')
    setLoading(true)
    setTodos([])
    setMessages([{ id: `u-${Date.now()}`, role: 'user', content: text }])
    setFlowNodes([])
    setFlowEdges([])
    setFlowVisible(false)
    wsRef.current.send(JSON.stringify({ action: 'chat', text }))
  }

  const handleAbort = () => { wsRef.current?.send(JSON.stringify({ action: 'abort' })); setLoading(false) }
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }

  const renderContent = (content: string) => {
    const jumpRegex = /\[JUMP_TO:\s*([^\]]+)\]\s*(.+)/g
    const parts: { type: 'text' | 'jump'; text: string; path?: string }[] = []
    let lastIndex = 0, match: RegExpExecArray | null
    while ((match = jumpRegex.exec(content)) !== null) {
      if (match.index > lastIndex) parts.push({ type: 'text', text: content.slice(lastIndex, match.index) })
      parts.push({ type: 'jump', text: match[2].trim(), path: match[1].trim() })
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < content.length) parts.push({ type: 'text', text: content.slice(lastIndex) })
    if (parts.length === 0) parts.push({ type: 'text', text: content })
    return parts
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-b from-stone-50 via-amber-50/20 to-stone-50">
      <header className="flex items-center justify-between px-4 py-3 bg-white/80 backdrop-blur-xl border-b border-stone-200/60 flex-shrink-0">
        <h1 className="text-lg font-bold text-stone-800 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-500" />
          灵枢（Harness）
        </h1>
        <div className="flex items-center gap-3">
          {wsConnected && <span className="flex items-center gap-1 text-xs text-emerald-500"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />已连接</span>}
          {todos.length > 0 && <span className="text-xs text-stone-500 bg-stone-100 px-2 py-1 rounded-full">{todos.filter(t => t.status === 'done').length}/{todos.length}</span>}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        <TodoPanel todos={todos} currentDiscussionTodoId={currentDiscussionTodoId} onTodoClick={(id) => setCurrentDiscussionTodoId(id)} />

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scrollbar-thin">
            <AnimatePresence>
              {messages.map((msg, i) => (
                <motion.div key={msg.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: i * 0.02 }}
                  className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}
                >
                  {msg.role !== 'user' && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-sm shadow-sm">🧠</div>
                  )}
                  <div className={`max-w-[80%] ${msg.role === 'user' ? 'bg-amber-500 text-white rounded-2xl rounded-tr-sm' : 'bg-white/70 backdrop-blur-sm border border-stone-100 rounded-2xl rounded-tl-sm'} px-4 py-2.5`}>
                    {msg.role !== 'user' && <p className="text-xs font-semibold text-amber-600 mb-0.5">灵枢</p>}
                    {renderContent(msg.content).map((p, pi) =>
                      p.type === 'jump' ? (
                        <button key={pi} onClick={() => navigate(p.path!)}
                          className="mt-2 w-full flex items-center gap-2 bg-gradient-to-r from-amber-50 to-orange-50 hover:from-amber-100 hover:to-orange-100 border border-amber-200 rounded-xl px-4 py-3 text-sm text-stone-700 transition-all group"
                        ><ExternalLink className="w-4 h-4 text-amber-500 group-hover:translate-x-0.5 transition-transform" /><span>{p.text}</span></button>
                      ) : (<p key={pi} className="text-sm whitespace-pre-wrap break-words">{p.text}</p>)
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {loading && messages.length <= 1 && (
              <div className="flex items-center gap-3 pl-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center"><Sparkles className="w-4 h-4 text-white" /></div>
                <div className="flex gap-1">{[0,1,2].map(d => <div key={d} className="w-2 h-2 rounded-full bg-amber-400" style={{ animation: `bounce 0.6s ${d*0.15}s infinite` }} />)}</div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="border-t border-stone-200/60 bg-white/80 backdrop-blur-xl p-3 flex-shrink-0">
            <div className="flex items-center gap-2">
              <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                placeholder="输入你的学习问题..." disabled={loading}
                className="flex-1 px-4 py-3 bg-stone-50 border border-stone-200 rounded-2xl focus:ring-2 focus:ring-amber-400/50 focus:border-amber-300 outline-none transition-all text-stone-700 placeholder-stone-400 disabled:opacity-50"
              />
              {loading ? (
                <button onClick={handleAbort} className="flex-shrink-0 w-11 h-11 rounded-2xl bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 transition-colors"><X className="w-5 h-5" /></button>
              ) : (
                <button onClick={handleSend} disabled={!input.trim()} className="flex-shrink-0 w-11 h-11 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg shadow-amber-200/50"><Send className="w-5 h-5" /></button>
              )}
            </div>
          </div>
        </div>

        <FlowPanel visible={flowVisible} nodes={flowNodes} edges={flowEdges} onClose={() => setFlowVisible(false)} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 编译验证**

Run: `cd e:\一遍过\frontend ; npx tsc --noEmit 2>&1 | Select-String "error TS"`
Expected: 零错误

---

### Task 14: Orchestrator 讨论模式 — 推送 workflow 消息

**Files:**
- Modify: `backend/app/services/agent_orchestrator.py`

- [ ] **Step 1: _run_discussion_mode 中新增 workflow 推送**

在 `_run_discussion_mode` 方法开头，讨论启动后推送节点初始化：

```python
# 讨论启动后立即推送节点
agent_ids = todo.get("assignees", [])
agents_info = {a: AGENT_REGISTRY.get(a) for a in agent_ids if AGENT_REGISTRY.get(a)}

node_list = [{"id": aid, "data": {"agent_id": aid, "agent_name": info["name"], "agent_icon": info.get("icon", "🤖"), "status": "active"}} for aid, info in agents_info.items()]
await ws_send({"type": "workflow_nodes", "task_id": task_id, "nodes": node_list})
```

- [ ] **Step 2: agent_participant 中推送状态变更**

在 Agent 发言时推送 `workflow_node_update` 和 `workflow_edge`：

```python
# Agent 发言前标记为 thinking
await ws_send({"type": "workflow_node_update", "task_id": task_id, "node_id": aid, "status": "thinking"})

# Agent 发言后
await ws_send({"type": "workflow_node_update", "task_id": task_id, "node_id": aid, "status": "waiting"})

# 创建边（消息）
msg_id = f"edge_{aid}_{round_idx}"
await ws_send({"type": "workflow_edge", "task_id": task_id, "edge_id": msg_id, "from": aid, "to": "discussion", "content": response[:500]})
```

- [ ] **Step 3: discussion_end 前推送最终状态**

```python
for aid in agents_info:
    await ws_send({"type": "workflow_node_update", "task_id": task_id, "node_id": aid, "status": "active"})
```

- [ ] **Step 4: 编译验证**

Run: `cd e:\一遍过\backend ; python -c "import py_compile; py_compile.compile('app/services/agent_orchestrator.py', doraise=True); print('OK')"`

---

### Task 15: clinical_agent + analytics_agent Prompt

（内容不变，与 Plan 原有 Task 10/11 完全相同，此处省略重复代码，执行时按原 Task 10/11 操作）

---

### Task 16: API 端点 + 编译验证

- [ ] **Step 1: 新增 messages 端点**（代码见原 Task 14）
- [ ] **Step 2: 前后端编译**
- [ ] **Step 3: 端到端验证**

---

## Phase 3: +1 Agent + 长期记忆 + 历史浏览 + 反馈机制 + 系统优化

**交付标准**: methods_agent（方法论教练）上线，跨任务长期会话记忆启用，历史任务侧边抽屉可浏览/回顾，用户可对Agent输出评分反馈，系统经性能优化后全链路稳定运行。

**Phase 3 Agent 总数**: 8 个活跃（Phase 2 的 7 个 + methods_agent）

**核心新增能力**:
1. **methods_agent** — 科研方法指导、论文结构审稿、循证医学决策、文献批判性阅读
2. **长期会话记忆** — `UserAgentSession` 读写，跨任务持久化上下文（用户画像、知识薄弱点、学习偏好），Orchestrator 启动时注入历史摘要
3. **历史任务浏览** — 前端左侧可收起侧边抽屉，展示最近 30 条任务记录，点击可回顾完整对话
4. **Agent 反馈机制** — 用户对主Agent汇总点赞/踩，反馈数据存入新增的 `agent_feedbacks` 表
5. **系统优化** — 讨论模式超时兜底、重试机制、WS 心跳保活、Prompt 精简

**新增文件结构**:

| 文件 | 操作 | 职责 |
|------|------|------|
| `frontend/src/components/HistoryDrawer.tsx` | **Create** | 历史任务侧边抽屉组件 |
| `frontend/src/components/FeedbackButtons.tsx` | **Create** | Agent汇总点赞/踩按钮组件 |
| `backend/app/services/agent_memory.py` | **Create** | 长期会话记忆读写服务 |
| `backend/app/services/agent_prompts.py` | **Modify** | methods_agent 完整 Prompt + 激活 + 记忆注入占位 |
| `backend/app/services/agent_orchestrator.py` | **Modify** | 记忆注入 + 超时优化 + 重试机制 |
| `backend/app/api/v1/agent.py` | **Modify** | 新增 feedback 端点 |
| `backend/app/models/agent.py` | **Modify** | 新增 AgentFeedback 表 |
| `backend/main.py` | **Modify** | 导入 AgentFeedback 确保建表 |
| `frontend/src/pages/Agent.tsx` | **Modify** | 集成 HistoryDrawer + FeedbackButtons + WS 心跳 |

---

### Task 17: methods_agent 完整 Prompt + 激活

**Files:**
- Modify: `backend/app/services/agent_prompts.py`

- [ ] **Step 1: 编写 METHODS_AGENT_PROMPT**

完整的 methods_agent 系统提示词，覆盖以下能力：

| 能力 | 说明 |
|------|------|
| 论文结构审稿 | 摘要→引言→方法→结果→讨论→结论，逐段评审逻辑漏洞 |
| 研究设计评估 | 队列研究/病例对照/RCT/系统评价的偏倚风险评估 |
| 循证医学决策 | PICO框架构建临床问题 + 证据等级分级（GRADE/Oxford CEBM） |
| 文献批判性阅读 | 识别混淆变量、选择偏倚、发表偏倚、利益冲突 |
| 统计方法指导 | 选择合适的检验方法、解读 p 值/置信区间/效应量 |
| 科研伦理 | 知情同意、伦理审查、数据完整性、作者署名规范 |

Prompt 示例内容：
```python
METHODS_AGENT_PROMPT = """你是方法论教练（Methods Coach）。核心能力：
1. 论文结构审稿（IMRaD格式逐段评审）
2. 研究设计评估（偏倚风险评估 + 证据等级分级）
3. 循证医学决策（PICO框架 + GRADE分级）
4. 文献批判性阅读（混淆变量 + 偏倚识别）
5. 统计方法指导（检验选择 + 效应量解读）
6. 科研伦理（知情同意、数据完整性、署名规范）

输出风格：
- 审稿时使用结构化评审：**[章节]** → 问题 → 建议 → 证据等级
- 决策时使用 PICO 框架清晰呈现
- 在不确定时标注 "[需进一步信息]"

输出格式示例：
## 📋 论文审稿
### 摘要
- **问题**: xxxx
- **建议**: xxxx
- **证据等级**: 中（缺少...）

## 📊 研究设计评估
| 维度 | 评估 | 风险等级 |
|------|------|---------|
| 选择偏倚 | ... | 低/中/高 |

## 💡 循证建议
P：xxx
I：xxx
C：xxx
O：xxx
GRADE 推荐强度：强/弱"""

# 在 AGENT_DEFINITIONS 中将 methods_agent 的 is_active 改为 True
```

- [ ] **Step 2: 更新 AGENT_DEFINITIONS 激活 methods_agent**

```python
{
    "id": "methods_agent",
    "name": "方法论教练",
    "role_desc": "负责论文审稿、研究设计评估、循证医学决策、统计指导、科研伦理",
    "system_prompt": METHODS_AGENT_PROMPT,
    "tools": ["web_search", "search_knowledge", "get_document"],
    "icon": "📖",
    "phase": 3,
    "is_active": True,  # 改为 True
},
```

- [ ] **Step 3: AGENT_REGISTRY 可见性检查**

确认 `agent_orchestrator.py` 的 `AGENT_REGISTRY` 构建逻辑（第 19 行）会自动包含 methods_agent：
```python
AGENT_REGISTRY = {a["id"]: a for a in AGENT_DEFINITIONS if a.get("is_active", True)}
```
此时 `is_active=True`，methods_agent 自动进入注册表。

- [ ] **Step 4: 编译验证**

```bash
cd e:\一遍过\backend
python -c "import py_compile; py_compile.compile('app/services/agent_prompts.py', doraise=True); print('OK')"
```

---

### Task 18: 长期会话记忆

**Files:**
- Create: `backend/app/services/agent_memory.py`
- Modify: `backend/app/services/agent_prompts.py`（ORCHESTRATOR_PROMPT 添加记忆注入占位）
- Modify: `backend/app/services/agent_orchestrator.py`（启动时读取记忆、结束时更新记忆）

- [ ] **Step 1: 创建 agent_memory.py**

```python
"""长期会话记忆服务 — 跨任务持久化上下文"""
import json
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

class AgentMemory:
    """读写 UserAgentSession.context_json，管理记忆摘要"""

    # 记忆键路径常量
    KEY_USER_PROFILE = "user_profile"       # 用户画像（专业、学年、偏好）
    KEY_STRONG_AREAS = "strong_areas"       # 掌握较好的知识点列表
    KEY_WEAK_AREAS = "weak_areas"           # 薄弱知识点列表
    KEY_RECENT_QUERIES = "recent_queries"   # 最近 10 条查询摘要
    KEY_PREFERENCES = "preferences"         # 学习偏好（讲解风格、出题难度）

    @staticmethod
    async def load(user_id: int) -> dict:
        """从数据库读取 UserAgentSession.context_json"""
        from app.models.agent import UserAgentSession
        from app.db.session import SessionLocal
        db = SessionLocal()
        try:
            session = db.query(UserAgentSession).filter(
                UserAgentSession.user_id == user_id
            ).first()
            if session and session.context_json:
                return session.context_json
            return {}
        finally:
            db.close()

    @staticmethod
    async def save(user_id: int, context: dict):
        """写入 UserAgentSession.context_json"""
        from app.models.agent import UserAgentSession
        from app.db.session import SessionLocal
        db = SessionLocal()
        try:
            session = db.query(UserAgentSession).filter(
                UserAgentSession.user_id == user_id
            ).first()
            if not session:
                session = UserAgentSession(user_id=user_id, context_json={})
                db.add(session)
            session.context_json = context
            db.commit()
        finally:
            db.close()

    @staticmethod
    def build_memory_summary(context: dict) -> str:
        """构建可读的记忆摘要，供 Orchestrator Prompt 注入"""
        parts = []
        profile = context.get("user_profile", {})
        if profile:
            parts.append(f"用户信息: {json.dumps(profile, ensure_ascii=False)}")

        weak = context.get("weak_areas", [])
        if weak:
            parts.append(f"薄弱知识点: {', '.join(weak[:5])}")

        strong = context.get("strong_areas", [])
        if strong:
            parts.append(f"擅长领域: {', '.join(strong[:3])}")

        recent = context.get("recent_queries", [])
        if recent:
            summaries = [q.get("summary", q.get("query", "")) for q in recent[-3:]]
            parts.append(f"最近查询: {' | '.join(summaries)}")

        return "\n".join(parts) if parts else ""  # 无记忆时返回空字符串，prompt 中不展示该区块

    @staticmethod
    async def update_after_task(user_id: int, query: str, summary: str, context: dict):
        """任务结束后更新记忆"""
        # 更新最近查询
        recent = context.setdefault("recent_queries", [])
        recent.append({
            "query": query[:100],
            "summary": summary[:200] if summary else "",
            "timestamp": datetime.now().isoformat(),
        })
        if len(recent) > 10:
            context["recent_queries"] = recent[-10:]

        # 保存
        await AgentMemory.save(user_id, context)
```

- [ ] **Step 2: ORCHESTRATOR_PROMPT 添加记忆注入占位（条件性）**

在 prompt 开头 `你是灵枢（Harness）的任务协调器。...` 之后、`1. **理解用户意图**` 之前添加 `{memory_summary}` 占位。**注意**：无记忆时 `memory_summary=""` 该区块自动消失，不浪费 token：

```python
ORCHESTRATOR_PROMPT = """你是灵枢（Harness）的任务协调器。灵枢是一个多Agent学习辅助系统。
{memory_summary}## 处理流程
1. **理解用户意图**：...
```

这样 `{memory_summary}` 紧贴 `## 处理流程`，无记忆时 format 替换为 `""`，两行合并成一行，视觉无影响；有记忆时 format 注入的文本自带换行，自然分隔。

- [ ] **Step 3: Orchestrator.run_task + _generate_todo_list 注入记忆**

在 `run_task` 开头读取记忆，并传递给 `_generate_todo_list`：

```python
async def run_task(self, task_id: str, query: str, ws_send) -> str:
    self._aborted = False

    # 读取长期记忆
    from app.services.agent_memory import AgentMemory
    self._memory_context = await AgentMemory.load(self.user_id)
    self._memory_summary = AgentMemory.build_memory_summary(self._memory_context)

    todo_list = await self._generate_todo_list(task_id, query, ws_send, memory_summary=self._memory_summary)
    ...
```

`_generate_todo_list` 函数签名和 format 调用同步修改：

```python
async def _generate_todo_list(self, task_id: str, query: str, ws_send,
                                memory_summary: str = "") -> List[dict]:
    ...
    system_prompt = ORCHESTRATOR_PROMPT.format(
        available_agents=active_agents,
        memory_summary=memory_summary,
    )
    ...
```

- [ ] **Step 4: Orchestrator 结束后更新记忆**

```python
# 在 run_task 返回前
try:
    await AgentMemory.update_after_task(
        self.user_id, query, summary, self._memory_context
    )
except Exception as e:
    logger.warning(f"记忆更新失败: {e}")
```

- [ ] **Step 5: compile + migrate 验证**

```bash
cd e:\一遍过\backend
python -c "from app.services.agent_memory import AgentMemory; print('OK')"
python -c "from app.services.agent_orchestrator import Orchestrator; print('OK')"
```

---

### Task 19: 历史任务浏览 — 前端侧边抽屉

**Files:**
- Create: `frontend/src/components/HistoryDrawer.tsx`
- Modify: `frontend/src/pages/Agent.tsx`（集成抽屉入口 + 历史加载）

- [ ] **Step 1: 创建 HistoryDrawer.tsx**

```tsx
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { History, X, ChevronRight, Clock, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react'

interface HistoryItem {
  id: string
  query: string
  status: string
  summary: string | null
  started_at: string
  completed_at: string | null
}

interface Props {
  visible: boolean
  onClose: () => void
  onSelectTask: (taskId: string) => void
  userId: number | undefined
}

export default function HistoryDrawer({ visible, onClose, onSelectTask, userId }: Props) {
  const [tasks, setTasks] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!visible || !userId) return
    setLoading(true)
    fetch(`/api/v1/agent/tasks`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    })
      .then(r => r.json())
      .then(data => { setTasks(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [visible, userId])

  const statusIcon = (s: string) => {
    if (s === 'completed') return <CheckCircle className="w-4 h-4 text-emerald-500" />
    if (s === 'failed') return <AlertCircle className="w-4 h-4 text-rose-400" />
    return <Clock className="w-4 h-4 text-amber-400" />
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ x: -320 }}
          animate={{ x: 0 }}
          exit={{ x: -320 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="absolute left-0 top-0 bottom-0 w-80 bg-white/95 backdrop-blur-xl border-r border-stone-200 shadow-2xl z-40 flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200/60">
            <span className="text-sm font-semibold text-stone-700 flex items-center gap-2">
              <History className="w-4 h-4 text-amber-500" />
              历史任务
            </span>
            <button onClick={onClose} className="text-stone-400 hover:text-stone-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              <div className="text-center text-sm text-stone-400 py-8">加载中...</div>
            ) : tasks.length === 0 ? (
              <div className="text-center text-sm text-stone-400 py-8">暂无历史记录</div>
            ) : (
              tasks.map(task => (
                <button key={task.id} onClick={() => { onSelectTask(task.id); onClose() }}
                  className="w-full text-left rounded-xl border border-stone-200/60 bg-white/50 p-3 hover:border-amber-200/40 hover:bg-amber-50/30 transition-all group"
                >
                  <div className="flex items-start gap-2">
                    <span className="flex-shrink-0 mt-0.5">{statusIcon(task.status)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-stone-700 truncate">{task.query}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-stone-400">
                          {task.started_at ? new Date(task.started_at).toLocaleString('zh-CN') : ''}
                        </span>
                        <ChevronRight className="w-3 h-3 text-stone-300 group-hover:text-amber-400 transition-colors ml-auto" />
                      </div>
                      {task.summary && (
                        <p className="text-[11px] text-stone-500 mt-1 line-clamp-2">{task.summary}</p>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: 集成到 Agent.tsx Header**

在 Header 右侧区域添加历史按钮：
```tsx
// 状态新增
const [historyVisible, setHistoryVisible] = useState(false)

// Header 渲染（返回按钮右侧、标题左侧或右侧）
<button onClick={() => setHistoryVisible(true)}
  className="flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800 transition-colors"
>
  <History className="w-4 h-4" />
  历史
</button>

// 历史抽屉（最外层，z-50 确保在最上层）
<HistoryDrawer
  visible={historyVisible}
  onClose={() => setHistoryVisible(false)}
  onSelectTask={(taskId) => { /* 加载历史任务消息 */ }}
  userId={user?.id}
/>
```

- [ ] **Step 3: 加载历史任务对话（含完整消息）**

`onSelectTask` 处理函数同时获取 task 详情和 messages，还原完整对话：

```tsx
const handleLoadHistory = async (taskId: string) => {
  try {
    const token = localStorage.getItem('token')
    const headers = { 'Authorization': `Bearer ${token}` }

    const [taskRes, msgsRes] = await Promise.all([
      fetch(`/api/v1/agent/tasks/${taskId}`, { headers }),
      fetch(`/api/v1/agent/tasks/${taskId}/messages`, { headers }),
    ])
    const task = await taskRes.json()
    const msgs = await msgsRes.json()

    const histMessages: { id: string; role: string; content: string }[] = [
      { id: `hist-q-${taskId}`, role: 'user', content: task.query },
    ]

    // 提取主Agent汇总消息（from_agent=orchestrator 或 type=orchestrator_summary）
    const summaries = msgs.filter((m: any) =>
      m.from_agent === 'orchestrator' || m.type === 'orchestrator_summary'
    )
    if (summaries.length > 0) {
      summaries.forEach((s: any) => {
        histMessages.push({ id: `hist-a-${Date.now()}`, role: 'orchestrator', content: s.content })
      })
    } else if (task.summary) {
      histMessages.push({ id: `hist-a-${Date.now()}`, role: 'orchestrator', content: task.summary })
    }

    setMessages(histMessages)
  } catch {}
}
```

- [ ] **Step 4: 编译验证**

```bash
cd e:\一遍过\frontend
npx tsc --noEmit 2>&1 | Select-String "error TS"
```

---

### Task 20: Agent 反馈机制

**Files:**
- Modify: `backend/app/models/agent.py`（新增 Feedback 表）
- Create: `frontend/src/components/FeedbackButtons.tsx`
- Modify: `backend/app/api/v1/agent.py`（新增 feedback 端点）
- Modify: `frontend/src/pages/Agent.tsx`（集成反馈按钮）

- [ ] **Step 1: 新增 Feedback 模型**

```python
class AgentFeedback(Base):
    """用户对 Agent 输出的反馈"""
    __tablename__ = "agent_feedbacks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String(36), ForeignKey("expert_tasks.id"), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    rating = Column(Integer, nullable=False)  # 1=赞, -1=踩
    feedback_text = Column(Text, nullable=True)  # 可选文字反馈
    created_at = Column(DateTime, default=datetime.now)
```

- [ ] **Step 1.5: main.py 添加 AgentFeedback 导入**

`Base.metadata.create_all()` 依赖模型导入来发现新表。在 `main.py` 第 17 行的 import 中添加 `AgentFeedback`：

```python
from app.models.agent import Agent, ExpertTask, TaskContext, SessionMessage, \
    UserAgentSession, WorkflowLog, AgentFeedback
```

- [ ] **Step 2: 创建 FeedbackButtons.tsx**

```tsx
import { useState } from 'react'
import { ThumbsUp, ThumbsDown } from 'lucide-react'

interface Props {
  taskId: string | null
  visible: boolean
}

export default function FeedbackButtons({ taskId, visible }: Props) {
  const [submitted, setSubmitted] = useState<'like' | 'dislike' | null>(null)

  if (!visible || !taskId) return null

  const submit = async (rating: number) => {
    try {
      await fetch(`/api/v1/agent/tasks/${taskId}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ rating, feedback_text: '' }),
      })
      setSubmitted(rating === 1 ? 'like' : 'dislike')
    } catch {}
  }

  return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-stone-100">
      <span className="text-xs text-stone-400">这个回答有帮助吗？</span>
      <button onClick={() => submit(1)} disabled={submitted !== null}
        className={`p-1.5 rounded-lg transition-colors ${submitted === 'like' ? 'bg-emerald-100 text-emerald-600' : 'text-stone-400 hover:text-emerald-500 hover:bg-emerald-50'}`}
      ><ThumbsUp className="w-3.5 h-3.5" /></button>
      <button onClick={() => submit(-1)} disabled={submitted !== null}
        className={`p-1.5 rounded-lg transition-colors ${submitted === 'dislike' ? 'bg-rose-100 text-rose-600' : 'text-stone-400 hover:text-rose-500 hover:bg-rose-50'}`}
      ><ThumbsDown className="w-3.5 h-3.5" /></button>
    </div>
  )
}
```

- [ ] **Step 3: 新增 feedback REST 端点**

在 `backend/app/api/v1/agent.py` 中添加：

```python
from pydantic import BaseModel

class FeedbackRequest(BaseModel):
    rating: int
    feedback_text: Optional[str] = None

@router.post("/tasks/{task_id}/feedback")
async def submit_feedback(
    task_id: str,
    body: FeedbackRequest,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
):
    from app.models.agent import AgentFeedback, ExpertTask
    task = db.query(ExpertTask).filter(
        ExpertTask.id == task_id, ExpertTask.user_id == token_data.user_id
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    feedback = AgentFeedback(
        task_id=task_id, user_id=token_data.user_id,
        rating=body.rating, feedback_text=body.feedback_text,
    )
    db.add(feedback)
    db.commit()
    return {"message": "感谢反馈"}
```

- [ ] **Step 4: 集成到 Agent.tsx**

在最适合时机显示反馈按钮——基于 `currentTaskId` 变化 + `!loading`，确保每个已完成任务都显示按钮：

```tsx
// 新增状态
const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)

// handleSend 中保存 taskId（本地生成，与后端一致）
const handleSend = () => {
  ...
  const newTaskId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  setCurrentTaskId(newTaskId)
  setLoading(true)
  ...
}

// 在 task_complete WS 消息处理中标记可反馈
// 消息列表中，每条主Agent汇总下方显示反馈按钮：
{
  msg.role === 'orchestrator' && !loading && (
    <FeedbackButtons taskId={currentTaskId} visible={true} />
  )
}

// 新任务开始时隐藏上一任务的反馈按钮
case 'todo_update':
  setTodos(data.todo_list)
  // 如果有新的待办清单，说明是新任务，重置反馈状态
  break
```

**注意**：`task_complete` WS 消息中会携带 `task_id`，可以据此设置 `currentTaskId`。更稳健的做法是在 WS `task_complete` 中更新：

```tsx
case 'task_complete':
  setLoading(false)
  if (data.task_id) setCurrentTaskId(data.task_id)
  break
```

- [ ] **Step 5: 编译验证**

```bash
cd e:\一遍过\backend
python -c "from app.models.agent import AgentFeedback; print('OK')"

cd e:\一遍过\frontend
npx tsc --noEmit 2>&1 | Select-String "error TS"
```

---

### Task 21: 系统优化与稳定性

**Files:**
- Modify: `backend/app/services/agent_orchestrator.py`
- Modify: `backend/app/core/agent_websocket.py`

- [ ] **Step 1: 讨论模式超时兜底**

`_run_discussion_mode` 中已有 `asyncio.wait_for(..., timeout=120)`，但超时后应返回已有部分结果而非空字符串：

```python
try:
    await asyncio.wait_for(discussion_coordinator(), timeout=120)
except asyncio.TimeoutError:
    logger.warning(f"讨论超时: task={task_id}")
    # 超时后仍然收集已有结果
    if results:
        conclusion = self._extract_discussion_conclusion(list(results.values()))
        todo["output"] = conclusion
        return conclusion
    return "[讨论超时，部分结果可能不完整]"
```

- [ ] **Step 2: Agent 调用重试机制**

`_agent_loop` 中对模型调用失败增加自动重试（最多 2 次）：

```python
for iteration in range(max_iterations):
    if self._aborted:
        return "[中断]"

    retry_count = 0
    response = None
    while retry_count < 2:
        try:
            response = await ai_request_manager.make_request(...)
            break
        except Exception as e:
            retry_count += 1
            logger.warning(f"Agent {agent_id} 第{iteration}轮 第{retry_count}次重试: {e}")
            await asyncio.sleep(1)
    if not response:
        ...
```

- [ ] **Step 3: WebSocket 心跳保活**

前端 WS 连接后启动定时 ping（每 30 秒），防止反向代理/防火墙断连：

```tsx
// Agent.tsx — ws.onopen 中
const pingInterval = setInterval(() => {
  ws.send(JSON.stringify({ action: 'ping' }))
}, 30000)

// ws.onclose 中
clearInterval(pingInterval)
```

- [ ] **Step 4: Prompt 精简优化**

> **合并注意**：本步骤修改 `ORCHESTRATOR_PROMPT`，而 T18 Step 2 也在其中添加了 `{memory_summary}` 占位。**请确保 T18 的任务先执行**，然后本步骤在 T18 的基础上进行精简，保留 `{memory_summary}` 占位不动。

根据 Phase 1/2 运行经验，精简 ORCHESTRATOR_PROMPT。**目标**：从当前约 50 行压缩到不超过 35 行。

| 操作 | 说明 |
|------|------|
| 移除 ` ```json` 代码块标记 | 用纯文本 JSON schema 替代，减少 4 行 |
| "分配Agent的决策原则" 4→3 条（保留场景→Agent映射） | 保持 1个/2个/3+个场景示例，用更紧凑的格式写出，**不丢掉关键映射参考** |
| 删除重复的"输出格式二选一"说明 | prompt 末尾已有，开头不再重复，减少 3 行 |
| "规则" 5 条→3 条 | 合并 assignees 数组要求和 depends_on 要求 |
| 合并"简单直答规则"和"输出格式二选一" | 放在 prompt 最后作为收尾强调 |

精简后的结构：
```
1. 角色定义（1行）
2. 处理流程（理解→拆解→分配→标记→路由，5行）
3. 可用Agent + JSON（10行）
4. 决策原则（3行，保留场景→Agent映射示例）
5. 输出格式JSON schema（8行）
6. 最终规则（直答/清单二选一 + 禁止编造Agent名，6行）
```

- [ ] **Step 5: 全链路回归验证**

```bash
# 后端编译
cd e:\一遍过\backend
python -c "from app.services.agent_orchestrator import Orchestrator; print('OK')"
python -c "from app.core.agent_websocket import agent_ws_manager; print('OK')"
python -c "from app.api.v1.agent import router; print('OK')"
python -c "from app.models.agent import AgentFeedback; print('OK')"

# 前端编译
cd e:\一遍过\frontend
npx tsc --noEmit 2>&1 | Select-String "error TS"

# 启动验证
cd e:\一遍过\backend
python main.py  # 检查 Seed 消息：8 个活跃 Agent
```

---

## Phase 4（未来预留）

| 内容 | 说明 |
|------|------|
| 多Agent视觉化编辑 | 拖拽编排Agent工作流（类n8n） |
| **消息总线讨论模式** | 基于 `asyncio.Queue` 的并发共享历史，解决 Phase 2 各说各话问题 |
| 自定义Agent注册 | 用户可自行定义Agent角色和工具 |
| Agent市场 | 社区共享Agent配置 |
| 知识图谱集成 | Agent输出自动关联知识图谱节点 |
| 语音交互 | ASR + TTS 全语音Agent交互 |

---

## 自审清单

- [x] lab_agent 已从所有注册/定义中移除
- [x] 前端三面板布局：待办看板 + 对话区(仅主Agent) + 流程面板
- [x] 子Agent输出不在对话区渲染，仅在流程面板边预览中可见
- [x] React Flow 节点=Agent（活跃中/思考中/等待中），边=通信消息
- [x] 点击边可预览交流内容
- [x] 新增 workflow_nodes / workflow_node_update / workflow_edge WS消息类型
- [x] Phase 2 共 7 个活跃 Agent（5+2）
- [ ] Phase 3: methods_agent 激活，共计 8 个活跃 Agent
- [ ] Phase 3: 长期会话记忆（UserAgentSession 读写 + prompt 注入）
- [ ] Phase 3: 历史任务侧边抽屉（HistoryDrawer 组件）
- [ ] Phase 3: Agent 输出反馈机制（点赞/踩 + DB 持久化）
- [ ] Phase 3: 系统优化（超时兜底 + 重试机制 + WS 心跳 + Prompt 精简）
