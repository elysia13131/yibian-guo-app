# Agent 工作流可视化设计

## 概述

为 Agent 工作流添加三层可视化：

1. **思考内容（Thinking View）** — 主Agent的推理过程以灰色小字流式显示，完成后自动折叠
2. **工作流状态指示线（Pipeline Timeline）** — 横向进度条 + 节点状态，实时显示 4 阶段（Intent→Planner→并行执行→Assembler）
3. **3D 会议桌（Three.js 场景）** — 可旋转视角的 3D 会议桌，Agent 围绕圆桌就坐，主Agent思考以 Timeline 显示，子Agent以对话气泡流式输出

## 架构

### 技术栈
- **前端框架**: React 19 + TypeScript
- **3D 引擎**: @react-three/fiber + @react-three/drei
- **动画**: motion (Framer Motion)
- **CSS**: Tailwind CSS 3
- **状态**: React Context + useState/useRef

### 数据流

```
后端 WebSocket ──→ Agent.tsx (WebSocket handler)
                         │
                         ├── orchestrator_thinking ──→ ThinkingPanel (灰色小字)
                         ├── workflow_node_update  ──→ PipelineTimeline (进度条)
                         ├── agent_start/message   ──→ 对话区 + 3D场景气泡
                         └── task_complete          ──→ 折叠thinking, 更新完成状态
```

### 组件树

```
Agent.tsx
├── ChatArea (主对话区)
│   ├── MessageBubble (用户消息)
│   ├── ThinkingBlock ← 新增 (灰色思考小字, 可折叠)
│   │   └── CollapsibleText
│   ├── AgentMessage (Agent回复)
│   └── ThinkingBlock (Assembler思考)
│
├── PipelineTimeline ← 新增 (工作流状态线)
│   ├── ProgressBar (横向进度条)
│   └── StageNode x4 (阶段节点)
│
├── SceneToggle ← 新增 (视图切换按钮)
│   ├── TimelineView (默认)
│   └── ConferenceTable3D ← 新增 (3D会议桌)
│       ├── Table (圆桌)
│       ├── AgentAvatar x8 (围绕桌子的Agent)
│       │   ├── CharacterModel (立方体/球形几何体)
│       │   ├── NameTag (Agent名称标签)
│       │   └── ThinkingTimeline (主Agent思考流)
│       ├── SpeechBubble (对话气泡, sprite)
│       └── OrbitControls (旋转控制)
│
├── TodoPanel (待办清单)
├── FlowPanel (流程图, 原有)
└── HistoryDrawer (历史记录)
```

## 消息流与状态管理

### WebSocket 消息扩展

| 消息类型 | 方向 | 触发 | payload |
|---------|------|------|---------|
| `orchestrator_thinking` | 后端→前端 | IntentAgent/PlannerAgent/AssemblerAgent 思考时 | `{task_id, content}` |

### 前端状态结构

```typescript
interface ThinkingState {
  taskId: string;
  content: string;       // 当前累积的思考内容
  collapsed: boolean;    // 是否折叠
  completed: boolean;    // 是否已完成(输出完毕)
}

interface WorkflowStage {
  id: 'intent' | 'planner' | 'execute' | 'assemble';
  label: string;
  status: 'waiting' | 'active' | 'done';
  detail?: string;       // 子状态信息
}

interface Agent3DState {
  agentId: string;
  name: string;
  icon: string;
  position: [number, number, number]; // 3D坐标
  message: string;       // 当前对话气泡内容
  speaking: boolean;     // 正在发言
}
```

## 模块设计

### 1. ThinkingBlock (思考内容)

**Props:**
```typescript
interface ThinkingBlockProps {
  thinking: string;
  agentName: string;
  agentIcon: string;
  isCompleted: boolean;
}
```

**行为:**
- 初始状态：展开显示完整思考内容，灰色斜体
- 收到 `task_complete` 或同阶段后续消息 → 自动折叠
- 用户点击可手动展开/折叠

### 2. PipelineTimeline (工作流状态线)

**Props:**
```typescript
interface PipelineTimelineProps {
  stages: WorkflowStage[];
}

interface WorkflowStage {
  id: string;
  label: string;
  status: 'waiting' | 'active' | 'done';
  detail?: string;
}
```

**行为:**
- 横向 4 段进度条（Inten→Plan→Exec→Assemble）
- active 节点有脉冲动画
- 节点下方显示详细状态文字
- 子Agent并行执行时展开显示子列表

### 3. ConferenceTable3D (3D 会议桌)

**Props:**
```typescript
interface ConferenceTable3DProps {
  agents: Agent3DState[];
  thinking: string;        // 主Agent思考流
  thinkingStage: string;   // 当前阶段
  onAgentClick?: (agentId: string) => void;
}
```

**行为:**
- 8个Agent围绕圆桌等距排列，面向圆心
- 当前发言的Agent高亮（发光边框）
- 主Agent思考流以 Timeline 形式浮现在桌子中心上方
- 子Agent的对话气泡使用 TextSprite 跟随 Agent 位置
- 支持鼠标拖拽旋转 + 滚轮缩放
- 点击Agent可聚焦查看

### 4. SceneToggle (视图切换)

**Props:**
```typescript
interface SceneToggleProps {
  activeView: 'timeline' | '3d';
  onToggle: (view: 'timeline' | '3d') => void;
}
```

**行为:**
- 两个按钮横向排列
- 默认选择 "工作流视图"（二维）
- 切换到 "3D会议桌" 时展开全屏 3D 场景
- 切换时用 motion 做过渡动画

## 性能考虑

- 3D 场景默认不挂载（lazy import + 条件渲染）
- 对话气泡使用 TextSprite 而非 HTML overlay（减少 reflow）
- 3D 场景在不可见时暂停动画循环
- thinking 内容超过 500 字时自动折叠

## 依赖新增

```json
{
  "@react-three/fiber": "^8.0.0",
  "@react-three/drei": "^9.0.0",
  "three": "^0.160.0"
}
```
