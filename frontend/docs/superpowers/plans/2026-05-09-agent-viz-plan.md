# Agent 工作流可视化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Agent 工作流添加 Thinking 灰色思考小字、Pipeline Timeline 工作流状态线、3D 会议桌三个可视化模块。

**Architecture:**
- ThinkingBlock: Agent.tsx 内新增组件，灰色斜体小字显示推理过程，`orchestrator_thinking` WS 消息驱动
- PipelineTimeline: Agent.tsx 内新增组件，横向4段进度条，阶段节点状态由 `workflow_node_update` 映射
- ConferenceTable3D: @react-three/fiber Canvas 场景，lazy import，仅当切换到3D视图时挂载
- SceneToggle: 切换 Timeline/3D 视图，motion 动画过渡

**Tech Stack:** React 19, TypeScript, Tailwind CSS 3, motion (动画), @react-three/fiber + drei + three (3D)

---
## 文件结构

### 后端修改
- `app/services/agent_orchestrator.py` — 在 3-Agent Pipeline 各阶段推送 `orchestrator_thinking` 消息

### 前端创建
- `src/components/ThinkingBlock.tsx` — 灰色思考小字组件，流式接收，自动折叠
- `src/components/PipelineTimeline.tsx` — 横向工作流状态线
- `src/components/SceneToggle.tsx` — 2D/3D 视图切换按钮
- `src/components/ConferenceTable3D.tsx` — Three.js 3D 会议桌

### 前端修改
- `src/pages/Agent.tsx` — 新增 WS 消息处理、集成 ThinkingBlock/PipelineTimeline/SceneToggle/ConferenceTable3D
- `package.json` — 添加 @react-three/fiber, @react-three/drei, three 依赖

---

### Task 1: 后端推送 orchestrator_thinking 消息

**Files:**
- Modify: `backend/app/services/agent_orchestrator.py` (在 _run_workflow_pipeline 中各阶段推送)

- [ ] **Step 1: IntentAgent 推理推送**

找到 `agent_orchestrator.py` 的 `_run_workflow_pipeline` 方法中 IntentAgent 调用处。在 `await intent_agent(intent_msg)` 执行前，推送一条 thinking：

```python
# 在 intent_agent 调用之前
await ws_send({
    "type": "orchestrator_thinking", "task_id": task_id,
    "content": f"🤔 正在分析用户请求...\n{query}",
})
```

- [ ] **Step 2: IntentAgent 结果推送**

在 IntentAgent 返回后，推送完整输出：

```python
await ws_send({
    "type": "orchestrator_thinking", "task_id": task_id,
    "content": f"📋 意图分析完成: {intent_text}",
})
```

- [ ] **Step 3: PlannerAgent 推理推送**

在 PlannerAgent 调用前和调用后分别推送：

```python
await ws_send({
    "type": "orchestrator_thinking", "task_id": task_id,
    "content": f"📝 正在规划并行待办清单...",
})

# Planner 返回后
await ws_send({
    "type": "orchestrator_thinking", "task_id": task_id,
    "content": f"🗂️ 规划 {len(todo_list)} 个并行待办:\n" + "\n".join(f"- {t['description']}" for t in todo_list),
})
```

- [ ] **Step 4: AssemblerAgent 推理推送**

在 Assembler 开始前推送：

```python
await ws_send({
    "type": "orchestrator_thinking", "task_id": task_id,
    "content": f"✍️ 正在整合 {len(all_outputs)} 个Agent的产出...",
})
```

- [ ] **Step 5: 编译验证**

```bash
python -c "import py_compile; py_compile.compile('app/services/agent_orchestrator.py', doraise=True); print('OK')"
cd e:\一遍过\backend
```

Expected: `OK`

---

### Task 2: 前端新增 ThinkingBlock 组件

**Files:**
- Create: `frontend/src/components/ThinkingBlock.tsx`

- [ ] **Step 1: 创建 ThinkingBlock 组件**

```tsx
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface ThinkingBlockProps {
  content: string
  isCompleted: boolean
}

export default function ThinkingBlock({ content, isCompleted }: ThinkingBlockProps) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (isCompleted && content.length > 100) setCollapsed(true)
  }, [isCompleted, content])

  if (!content) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-sm text-stone-400 italic border-l-2 border-stone-300/40 pl-3 py-1 mb-2 cursor-pointer select-none hover:bg-stone-100/30 rounded-r transition-colors"
      onClick={() => setCollapsed(!collapsed)}
    >
      <div className="flex items-start gap-1">
        <span className="text-stone-300 text-xs mt-0.5 shrink-0">🤔</span>
        <div className="min-w-0 flex-1">
          {collapsed ? (
            <span className="text-stone-400 truncate block">
              {content.slice(0, 80)}{content.length > 80 ? '...' : ''}
            </span>
          ) : (
            <span className="whitespace-pre-wrap text-stone-500 text-xs leading-relaxed">
              {content}
            </span>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed) }}
          className="shrink-0 text-stone-300 hover:text-stone-500 transition-colors"
        >
          {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
        </button>
      </div>
    </motion.div>
  )
}
```

---

### Task 3: 前端新增 PipelineTimeline 组件

**Files:**
- Create: `frontend/src/components/PipelineTimeline.tsx`

- [ ] **Step 1: 创建 PipelineTimeline 组件**

```tsx
import { motion } from 'motion/react'

export interface StageInfo {
  id: string
  label: string
  status: 'waiting' | 'active' | 'done'
  detail?: string
}

interface PipelineTimelineProps {
  stages: StageInfo[]
  currentTaskId: string | null
}

const stageIcons: Record<string, string> = {
  intent: '🎯',
  planner: '📋',
  execute: '⚡',
  assemble: '🎨',
}

export default function PipelineTimeline({ stages, currentTaskId }: PipelineTimelineProps) {
  if (!currentTaskId || stages.length === 0) return null

  const doneCount = stages.filter(s => s.status === 'done').length
  const totalCount = stages.length

  return (
    <div className="bg-white/60 backdrop-blur-sm rounded-xl border border-stone-200/60 p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-medium text-stone-500">工作流进度</div>
        <div className="text-xs text-stone-400">{doneCount}/{totalCount}</div>
      </div>

      {/* Progress Bar */}
      <div className="flex gap-1 mb-3">
        {stages.map((stage) => (
          <div
            key={stage.id}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${
              stage.status === 'done' ? 'bg-emerald-400' :
              stage.status === 'active' ? 'bg-amber-400' :
              'bg-stone-200'
            }`}
          />
        ))}
      </div>

      {/* Stage Nodes */}
      <div className="flex justify-between">
        {stages.map((stage) => (
          <div key={stage.id} className="flex flex-col items-center gap-1 min-w-0 flex-1">
            <motion.div
              animate={stage.status === 'active' ? {
                scale: [1, 1.15, 1],
                transition: { repeat: Infinity, duration: 2 },
              } : {}}
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs transition-colors ${
                stage.status === 'done' ? 'bg-emerald-100 text-emerald-600' :
                stage.status === 'active' ? 'bg-amber-100 text-amber-600 ring-2 ring-amber-300' :
                'bg-stone-100 text-stone-400'
              }`}
            >
              {stageIcons[stage.id] || '●'}
            </motion.div>
            <div className={`text-[10px] text-center leading-tight ${
              stage.status === 'done' ? 'text-emerald-600 font-medium' :
              stage.status === 'active' ? 'text-amber-700 font-medium' :
              'text-stone-400'
            }`}>
              {stage.label}
            </div>
            {stage.detail && stage.status !== 'waiting' && (
              <div className="text-[9px] text-stone-400 text-center leading-tight max-w-[80px] truncate">
                {stage.detail}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

### Task 4: 前端新增 SceneToggle 组件

**Files:**
- Create: `frontend/src/components/SceneToggle.tsx`

- [ ] **Step 1: 创建 SceneToggle 组件**

```tsx
import { motion } from 'motion/react'
import { PanelRightOpen, Globe } from 'lucide-react'

interface SceneToggleProps {
  activeView: 'timeline' | '3d'
  onToggle: (view: 'timeline' | '3d') => void
}

export default function SceneToggle({ activeView, onToggle }: SceneToggleProps) {
  return (
    <div className="flex bg-stone-100 rounded-lg p-0.5 gap-0.5">
      <button
        onClick={() => onToggle('timeline')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
          activeView === 'timeline'
            ? 'bg-white text-stone-800 shadow-sm'
            : 'text-stone-500 hover:text-stone-700'
        }`}
      >
        <PanelRightOpen className="w-3.5 h-3.5" />
        工作流
      </button>
      <button
        onClick={() => onToggle('3d')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
          activeView === '3d'
            ? 'bg-white text-stone-800 shadow-sm'
            : 'text-stone-500 hover:text-stone-700'
        }`}
      >
        <Globe className="w-3.5 h-3.5" />
        3D会议
      </button>
    </div>
  )
}
```

---

### Task 5: 前端创建 ConferenceTable3D 组件

**Files:**
- Create: `frontend/src/components/ConferenceTable3D.tsx`

- [ ] **Step 1: 创建 3D 会议桌组件**

```tsx
import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Text, OrbitControls, Sphere, Line } from '@react-three/drei'
import * as THREE from 'three'

interface Agent3DState {
  agentId: string
  name: string
  icon: string
  message?: string
  speaking?: boolean
  thinking?: string
}

interface ConferenceTable3DProps {
  agents: Agent3DState[]
  thinkingContent: string
  thinkingStage: string
}

function AgentAvatar({ agent, index, total }: { agent: Agent3DState; index: number; total: number }) {
  const ref = useRef<THREE.Mesh>(null!)
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2
  const radius = 4.5
  const x = Math.cos(angle) * radius
  const z = Math.sin(angle) * radius

  useFrame((state) => {
    if (agent.speaking) {
      ref.current.position.y = 0.3 + Math.sin(state.clock.elapsedTime * 3) * 0.1
    }
  })

  return (
    <group position={[x, 0.3, z]}>
      {/* Agent body */}
      <mesh ref={ref} castShadow>
        <sphereGeometry args={[0.4, 16, 16]} />
        <meshStandardMaterial
          color={agent.speaking ? '#f59e0b' : '#6366f1'}
          emissive={agent.speaking ? '#f59e0b' : '#000000'}
          emissiveIntensity={agent.speaking ? 0.3 : 0}
        />
      </mesh>
      {/* Name label */}
      <Text
        position={[0, -0.7, 0]}
        fontSize={0.2}
        color="#94a3b8"
        anchorX="center"
        anchorY="top"
      >
        {agent.name}
      </Text>
      {/* Speech bubble */}
      {agent.speaking && agent.message && (
        <Text
          position={[x > 0 ? 1.2 : -1.2, 0.6, 0]}
          fontSize={0.15}
          color="#e2e8f0"
          maxWidth={2}
          anchorX={x > 0 ? 'left' : 'right'}
          anchorY="bottom"
        >
          {agent.message.slice(0, 60)}
        </Text>
      )}
    </group>
  )
}

function Table() {
  return (
    <group position={[0, -0.1, 0]}>
      {/* Table surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <cylinderGeometry args={[2.5, 2.5, 0.08, 32]} />
        <meshStandardMaterial color="#1e293b" metalness={0.3} roughness={0.7} />
      </mesh>
      {/* Table edge glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[2.48, 2.6, 32]} />
        <meshBasicMaterial color="#475569" transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function ThinkingTimeline({ content, stage }: { content: string; stage: string }) {
  if (!content) return null
  const lines = content.split('\n').filter(Boolean).slice(-3)

  return (
    <group position={[0, 2.2, 0]}>
      {lines.map((line, i) => (
        <Text
          key={i}
          position={[0, -i * 0.3, 0]}
          fontSize={0.12}
          color="#a3a3a3"
          anchorX="center"
          anchorY="top"
          maxWidth={6}
        >
          {line.slice(0, 50)}
        </Text>
      ))}
    </group>
  )
}

export default function ConferenceTable3D({ agents, thinkingContent, thinkingStage }: ConferenceTable3DProps) {
  return (
    <div className="w-full h-[500px] rounded-xl overflow-hidden border border-stone-200/60 bg-gradient-to-b from-stone-900 to-stone-950">
      <Canvas camera={{ position: [8, 6, 8], fov: 45 }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 10, 5]} intensity={0.8} castShadow />
        <pointLight position={[0, 4, 0]} intensity={0.3} color="#6366f1" />
        <spotLight position={[0, 8, 0]} angle={0.5} penumbra={0.5} intensity={0.2} color="#a78bfa" />

        <Table />
        {agents.map((agent, i) => (
          <AgentAvatar key={agent.agentId} agent={agent} index={i} total={agents.length} />
        ))}
        <ThinkingTimeline content={thinkingContent} stage={thinkingStage} />

        {/* Floor */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#0f172a" />
        </mesh>

        <OrbitControls
          enablePan={false}
          minDistance={4}
          maxDistance={16}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 2.5}
        />
      </Canvas>
    </div>
  )
}
```

---

### Task 6: 后端 orchestrator_thinking 推送（Agent 产出流式推送）

**Files:**
- Modify: `backend/app/services/agent_orchestrator.py` (在 _run_parallel_agentscope 中推送子Agent thinking)

- [ ] **Step 1: 在 MsgHub 并行执行前推送**

```python
await ws_send({
    "type": "orchestrator_thinking", "task_id": task_id,
    "content": f"🚀 开始并行执行 {len(units)} 个Agent...",
})
```

- [ ] **Step 2: 编译验证**

```bash
python -c "import py_compile; py_compile.compile('app/services/agent_orchestrator.py', doraise=True); print('OK')"
```

Expected: `OK`

---

### Task 7: 集成到 Agent.tsx

**Files:**
- Modify: `frontend/src/pages/Agent.tsx` — 集成所有新组件

- [ ] **Step 1: 添加 import**

```tsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import ThinkingBlock from '../components/ThinkingBlock'
import PipelineTimeline from '../components/PipelineTimeline'
import SceneToggle from '../components/SceneToggle'
```

注意: ConferenceTable3D 使用 React.lazy 动态导入

```tsx
const ConferenceTable3D = React.lazy(() => import('../components/ConferenceTable3D'))
import React from 'react' // 确保 React 已 import
```

- [ ] **Step 2: 添加新状态**

```tsx
const [thinkingContent, setThinkingContent] = useState('')
const [thinkingCompleted, setThinkingCompleted] = useState(false)
const [activeView, setActiveView] = useState<'timeline' | '3d'>('timeline')
```

- [ ] **Step 3: WS onmessage 中新增 orchestrator_thinking 处理**

在 `switch(data.type)` 中添加:

```tsx
case 'orchestrator_thinking':
  setThinkingContent(data.content)
  setThinkingCompleted(false)
  break
```

修改 `task_complete` 和 `orchestrator_summary` 处理:

```tsx
case 'orchestrator_summary':
  setIsStreaming(false)
  setStreamingContent('')
  setThinkingCompleted(true)
  setMessages(prev => [...prev, { id: `sum-${Date.now()}`, role: 'orchestrator', content: data.content }])
  setLoading(false)
  break

case 'task_complete':
  setLoading(false)
  setThinkingCompleted(true)
  if (data.task_id) setCurrentTaskId(data.task_id)
  break
```

- [ ] **Step 4: 计算 stages 映射**

```tsx
const stages = useMemo(() => {
  const stageMap: Record<string, { label: string; status: 'waiting' | 'active' | 'done'; detail?: string }> = {
    intent: { label: '意图理解', status: 'waiting' },
    planner: { label: '任务规划', status: 'waiting' },
    execute: { label: '并行执行', status: 'waiting' },
    assemble: { label: '结果汇编', status: 'waiting' },
  }

  // 根据 WS 消息推导当前阶段
  if (thinkingContent.includes('意图分析完成')) {
    stageMap.intent.status = 'done'
    stageMap.planner.status = 'active'
  } else if (thinkingContent.includes('规划')) {
    stageMap.intent.status = 'done'
    stageMap.planner.status = 'done'
    stageMap.execute.status = 'active'
  } else if (thinkingContent.includes('整合') || thinkingContent.includes('Agent的产出')) {
    stageMap.intent.status = 'done'
    stageMap.planner.status = 'done'
    stageMap.execute.status = 'done'
    stageMap.assemble.status = 'active'
  } else if (thinkingCompleted) {
    stageMap.intent.status = 'done'
    stageMap.planner.status = 'done'
    stageMap.execute.status = 'done'
    stageMap.assemble.status = 'done'
  } else if (thinkingContent.includes('分析')) {
    stageMap.intent.status = 'active'
  }

  // 子Agent执行细节
  if (todos.length > 0) {
    const doneTodos = todos.filter(t => t.status === 'done').length
    stageMap.execute.detail = `${doneTodos}/${todos.length}`
  }

  return Object.entries(stageMap).map(([id, s]) => ({ id, ...s }))
}, [thinkingContent, thinkingCompleted, todos])
```

- [ ] **Step 5: 构建 3D Agent 状态**

```tsx
const agent3DStates = useMemo(() => {
  const agentMap = new Map<string, { message: string; speaking: boolean }>()
  // 从最近的 agent_message 中提取
  for (const msg of messages) {
    if (msg.role === 'agent' && msg.agent_id) {
      agentMap.set(msg.agent_id, {
        message: msg.content || '',
        speaking: msg.done === false,
      })
    }
  }
  const agentIds = ['knowledge_agent', 'tutor_agent', 'quiz_agent', 'review_planner',
    'companion_agent', 'clinical_agent', 'analytics_agent', 'methods_agent']
  const agentNames: Record<string, string> = {
    knowledge_agent: '知识管家', tutor_agent: '教学导师', quiz_agent: '题库专家',
    review_planner: '复习规划', companion_agent: '陪伴助手', clinical_agent: '临床顾问',
    analytics_agent: '分析专家', methods_agent: '方法专家',
  }
  const agentIcons: Record<string, string> = {
    knowledge_agent: '📚', tutor_agent: '🧠', quiz_agent: '📝',
    review_planner: '🗓️', companion_agent: '💚', clinical_agent: '🏥',
    analytics_agent: '📊', methods_agent: '🔬',
  }
  return agentIds.map(aid => ({
    agentId: aid,
    name: agentNames[aid] || aid,
    icon: agentIcons[aid] || '🤖',
    message: agentMap.get(aid)?.message || '',
    speaking: agentMap.get(aid)?.speaking || false,
  }))
}, [messages])
```

- [ ] **Step 6: 渲染新组件**

找到 `Agent.tsx` 的返回 JSX，在 header 下方添加：

```tsx
<div className="px-4 flex items-center justify-between gap-3 pt-2 pb-0 flex-shrink-0">
  <PipelineTimeline stages={stages} currentTaskId={currentTaskId} />
</div>
```

在对话区，用户消息之后、streamingContent/Agent回复之前添加 ThinkingBlock：

```tsx
{/* Thinking 思考内容（在所有消息最上方） */}
<ThinkingBlock content={thinkingContent} isCompleted={thinkingCompleted} />

{/* 现有消息渲染... */}
```

在 header 与对话区之间添加 SceneToggle：

```tsx
<div className="px-4 flex items-center justify-end gap-2 pt-1 pb-0 flex-shrink-0">
  <SceneToggle activeView={activeView} onToggle={setActiveView} />
</div>
```

在对话区底部/侧边添加条件渲染的 3D 场景：

```tsx
<AnimatePresence>
  {activeView === '3d' && (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="px-4 pb-4"
    >
      <React.Suspense fallback={
        <div className="w-full h-[500px] rounded-xl bg-stone-100 flex items-center justify-center text-stone-400">
          加载 3D 场景...
        </div>
      }>
        <ConferenceTable3D
          agents={agent3DStates}
          thinkingContent={thinkingContent}
          thinkingStage={stages.find(s => s.status === 'active')?.id || ''}
        />
      </React.Suspense>
    </motion.div>
  )}
</AnimatePresence>
```

---

### Task 8: 安装 Three.js 依赖

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: 安装依赖**

```bash
cd e:\一遍过\frontend
npm install @react-three/fiber@^8.0.0 @react-three/drei@^9.0.0 three@^0.160.0
```

Expected: `added X packages` 无错误

- [ ] **Step 2: 验证编译**

```bash
cd e:\一遍过\frontend
npx tsc --noEmit --skipLibCheck 2>&1 | head -30
```

Expected: 无 TypeScript 错误（或仅 minor 类型警告）

---

### Task 9: 端到端验证

- [ ] **Step 1: 重启后端**

```bash
taskkill /F /PID <main.py pid>
cd e:\一遍过\backend
python main.py --no-reload
```

- [ ] **Step 2: 重启前端**

```bash
cd e:\一遍过\frontend
npm run dev
```

- [ ] **Step 3: 发送测试查询**

打开 `http://localhost:5173/agent`，发送 "帮我总结心脏的四个腔室结构和体循环路径"

Expected:
- 灰色 thinking 小字显示 IntentAgent 分析 → PlannerAgent 规划 → 并行执行 → Assembler 汇编
- PipelineTimeline 节点依次从 waiting → active → done
- 点击 "3D会议" 按钮，显示 3D 场景，Agent 围绕圆桌旋转
- 子Agent输出时，3D 中对应 Agent 高亮 + 对话气泡

---

### Spec Coverage Check

| Spec 需求 | 对应 Task | 状态 |
|-----------|-----------|------|
| ThinkingBlock 灰色小字，流式 | Task 1 (后端推送) + Task 2 (ThinkingBlock) + Task 7 (集成) | ✅ |
| 完成后自动折叠 | Task 2 (useEffect auto-collapse) | ✅ |
| PipelineTimeline 横向进度条 | Task 3 (PipelineTimeline) + Task 7 (stages映射) | ✅ |
| 阶段节点实时状态 | Task 7 (useMemo stages) | ✅ |
| 3D 会议桌可旋转视角 | Task 5 (OrbitControls) | ✅ |
| 子Agent对话气泡 | Task 5 (Speech bubble via Text) | ✅ |
| 主Agent思考 Timeline | Task 5 (ThinkingTimline component) | ✅ |
| 3D lazy import | Task 7 (React.lazy) | ✅ |
| SceneToggle 切换视图 | Task 4 + Task 7 (activeView state) | ✅ |
