# 「灵枢空间」项目设计文档

> 版本: v1.0 | 日期: 2026-05-12 | 状态: 待审阅

---

## 一、项目概述

### 1.1 目标

将现有的 3D 会议桌场景（ConferenceTable3D）升级为一个**第一人称可操控的 3D RPG 交互空间**，用户在其中以第一人称视角自由行动，与「灵枢」（主控 Agent）和各子 Agent 进行面对面对话。

### 1.2 核心体验

- 像玩 RPG 游戏一样在 3D 空间中自由走动
- 走近角色 → 看到对话选项 → 按 F 键或点击触发对话
- 对话时角色播放表情动画，实时流式显示回复内容
- 灵枢和子 Agent 有简单的自主行为（待机动画、面向用户、讨论动画）

### 1.3 与现有系统的关系

```
现有系统                          灵枢空间
┌─────────────┐                 ┌──────────────┐
│ Agent 页面   │ ──替换3D视图──→ │ LingShuSpace │
│ + 时间线面板 │                 │ + 3D 游戏场景 │
│ + 思考内容   │                 │ + 对话系统    │
└─────────────┘                 └──────────────┘
        │                               │
        └──── 共用后端 WebSocket ───────┘
        └──── 共用 agent_orchestrator ──┘
```

**保留：** ThinkingBlock（思考内容展示）、PipelineTimeline（工作流状态）作为 HUD 覆盖元素
**替换：** ConferenceTable3D → LingShuSpace 3D 场景

---

## 二、整体架构

### 2.1 架构图

```
┌──────────────────────────────────────────────────────────┐
│                    React App (路由不变)                    │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │              LingShuSpace 页面组件                   │  │
│  │                                                    │  │
│  │  ┌──────────────────┐   ┌──────────────────────┐  │  │
│  │  │  Three.js 引擎    │   │   React UI 覆盖层     │  │  │
│  │  │                  │   │                      │  │  │
│  │  │ • 场景管理       │   │  ┌────────────────┐  │  │  │
│  │  │ • 玩家控制器     │   │  │ 小地图          │  │  │  │
│  │  │ • 角色系统       │   │  ├────────────────┤  │  │  │
│  │  │ • 碰撞检测       │   │  │ 对话面板        │  │  │  │
│  │  │ • 动画播放       │   │  ├────────────────┤  │  │  │
│  │  │ • 相机系统       │   │  │ 交互提示(F键)   │  │  │  │
│  │  │ • 输入处理       │   │  ├────────────────┤  │  │  │
│  │  │                  │   │  │ 思考内容浮层    │  │  │  │
│  │  └────────┬─────────┘   │  ├────────────────┤  │  │  │
│  │           │             │  │ 工作流状态条    │  │  │  │
│  │           │             │  └────────────────┘  │  │  │
│  │           └─── 事件总线 (EventBus) ───┘        │  │  │
│  └────────────────────────────────────────────────────┘  │
│                          │                               │
│                    WebSocket                             │
│                          │                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │           后端 API / agent_orchestrator              │  │
│  │   • agent 状态推送 (speaking, thinking, message)     │  │
│  │   • 对话请求/响应 (流式)                              │  │
│  │   • 工作流事件推送                                    │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 2.2 核心原则

| 原则 | 说明 |
|------|------|
| **职责分离** | Three.js 只管渲染和输入，React 只管 UI 和数据。通过事件总线通信，不直接互相调用 |
| **无运行时耦合** | Three.js 场景可以作为独立模块加载，不依赖 React 渲染周期 |
| **渐进增强** | 先实现核心移动+对话，再逐步添加动画、物理、特效 |
| **模型可替换** | 角色模型、场景模型通过配置注入，不与代码耦合 |

---

## 三、模块设计

### 3.1 场景模块（SceneManager）

**职责：** 管理 3D 场景的生命周期、光照、环境

```
SceneManager
├── 场景初始化/销毁
├── 光照系统 (环境光 + 方向光)
├── 地面/地板
├── 环境装饰（后续模型替换）
└── 天空盒/背景
```

**初始实现：** 简洁的室内地面 + 网格辅助线 + 基础光照，后续替换模型
**文件：** `frontend/src/game/SceneManager.ts`

### 3.2 玩家控制器（PlayerController）

**职责：** 处理用户输入，控制第一人称相机移动

```
PlayerController
├── 桌面端: WASD 移动 + 鼠标旋转视角
├── 移动端: 虚拟摇杆 (左半屏移动 + 右半屏旋转)
├── 碰撞检测 (与场景边界、角色碰撞)
├── 高度固定 (1.6m 眼高)
└── 移动速度配置
```

**实现方案：**

| 平台 | 移动 | 视角 | 实现方式 |
|------|------|------|----------|
| 桌面 | WASD / 方向键 | 鼠标移动 + PointerLock | PointerLockControls |
| 移动 | 左半屏虚拟摇杆 | 右半屏滑动 | 自定义触控层 |

**输入状态机：**

```
[空闲] ──WASD按下──→ [移动中] ──松开──→ [空闲]
  │                      │
  └── 鼠标移动 ──→ 视角旋转（始终）
```

**文件：** `frontend/src/game/PlayerController.ts`

### 3.3 角色系统（CharacterManager）

**职责：** 管理场景中所有角色的创建、动画、状态同步

#### 3.3.1 角色类型

```
角色层级:
  ├── 灵枢 (主控 Agent)  — 特殊标记，位于场景中央或高处
  └── 子 Agent × N       — 分布在场景各处
```

#### 3.3.2 角色状态机

```
         ┌──────────┐
    ┌──→ │  待机     │ ←──┐
    │    │ (idle)    │    │
    │    └─────┬─────┘    │
    │          │ 用户靠近  │ 对话结束
    │    ┌─────▼─────┐    │
    │    │  注视用户  │    │
    │    │ (lookAt)   │    │
    │    └─────┬─────┘    │
    │          │ 触发对话  │
    │    ┌─────▼─────┐    │
    │    │  对话中    │ ───┘
    │    │ (talking)  │
    │    └─────┬─────┘
    │          │ 后端推送思考/讨论事件
    │    ┌─────▼─────┐
    └─── │  讨论动画  │
         │ (discuss)  │
         └────────────┘
```

#### 3.3.3 动画系统

| 状态 | 动画 | 说明 |
|------|------|------|
| idle | 待机呼吸/微动 | 默认状态，轻微浮动 |
| lookAt | 转身面向用户 | 头部/身体朝向用户位置 |
| talking | 说话动画 | 嘴部动作 + 手势 |
| discuss | 讨论动画 | 面向其他 agent 做手势 |

**初始实现：** 用简单的 TWEEN 补间实现旋转和浮动效果。模型到位后可替换为骨骼动画（VMD）。

**角色模型占位：** 初期用不同颜色的柱体/胶囊体 + 名字标签。用户后续提供 PMX/GLTF 模型后一键替换。

**文件：** `frontend/src/game/CharacterManager.ts`

### 3.4 交互系统（InteractionSystem）

**职责：** 检测玩家与角色的距离，触发交互提示

```
InteractionSystem
├── 距离检测 (玩家 ↔ 各角色)
├── 交互提示显示 ("按 F 与 xxx 对话")
├── 最近角色追踪
└── F 键 / 点击事件转发
```

**交互距离：** 3 米（可配置）

```
用户移动 → 每帧检测距离 → 距离 < 3m?
                              │
                     ┌────是──┴──否──┐
                     ▼               ▼
              显示交互提示        隐藏提示
              (按F对话 xxx)     记录最近角色=null
                     │
                F键按下?
              ┌──是──┴──否──┐
              ▼              ▼
         触发对话流程      继续等待
```

**文件：** `frontend/src/game/InteractionSystem.ts`

### 3.5 对话系统（DialogueSystem）

**职责：** 管理对话流程的 UI 和状态

```
DialogueSystem (React 组件)
├── 触发方式: F 键 / 点击交互提示
├── 对话面板:
│   ├── 角色头像 + 名称 + 状态指示
│   ├── 预设话题选项 (3-5 个快捷按钮)
│   ├── 自由输入框 (可切换)
│   └── 流式回复显示区
├── 对话状态:
│   ├── idle — 无对话
│   ├── selecting — 显示选项
│   ├── waiting — 等待 AI 回复
│   ├── streaming — 流式接收回复
│   └── completed — 回复完成
└── 关闭: ESC / 走远 / 点击关闭按钮
```

**对话流程：**

```
用户靠近角色 → 显示 "按 F 对话"
      │
   F键按下
      │
      ▼
进入对话模式 (玩家锁定，角色面向用户)
      │
      ├── 快捷选项: 点击预设话题 → 发送给后端
      │                                    │
      └── 自由输入: 输入文字 → 发送给后端 ─┘
                                           │
                                           ▼
                              后端 agent 处理 (流式)
                                           │
                                           ▼
                              前端流式渲染回复 + 角色说话动画
                                           │
                                           ▼
                              用户关闭 / 走远 → 退出对话模式
```

**文件：** `frontend/src/components/DialoguePanel.tsx`

### 3.6 事件总线（EventBus）

**职责：** Three.js 和 React 之间的通信桥梁

```typescript
// 事件类型定义
interface GameEvents {
  // Three.js → React
  'agent:approached': { agentId: string; distance: number };
  'agent:left': { agentId: string };
  'interaction:available': { agentId: string; agentName: string };
  'interaction:unavailable': void;

  // React → Three.js
  'dialogue:start': { agentId: string };
  'dialogue:end': { agentId: string };
  'agent:speaking': { agentId: string; speaking: boolean };
  'agent:thinking': { agentId: string; content: string };
  'player:lock': boolean; // 锁定/解锁玩家移动
  'scene:teleport': { x: number; y: number; z: number };
}
```

**文件：** `frontend/src/game/EventBus.ts`

---

## 四、数据流设计

### 4.1 WebSocket 消息协议（扩展现有协议）

```typescript
// 新增消息类型
interface AgentWorldState {
  type: 'agent_world_state';
  agents: Array<{
    agent_id: string;
    name: string;
    role: string;        // 'orchestrator' | 'expert'
    position_x: number;
    position_z: number;
    state: 'idle' | 'talking' | 'thinking' | 'discussing';
    current_message?: string;
    thinking_content?: string;
  }>;
}

interface AgentDialogueResponse {
  type: 'agent_dialogue_chunk';
  agent_id: string;
  chunk: string;          // 流式 chunk
  is_final: boolean;
}

interface AgentDialogueStart {
  type: 'agent_dialogue_start';
  agent_id: string;
  user_message: string;
}
```

### 4.2 连接管理

```
页面加载 → 创建 WebSocket 连接
              │
              ├── 接收 agent_world_state → 更新角色状态
              ├── 接收 agent_dialogue_chunk → 流式渲染
              ├── 接收 orchestrator_thinking → 更新灵枢思考状态
              └── 发送 agent_dialogue_start → 发起对话

页面卸载 → 关闭 WebSocket + 清理 3D 资源
```

---

## 五、移动端适配

### 5.1 虚拟摇杆

```
┌──────────────────────────┐
│                          │
│   ┌──────┐    ┌──────┐   │
│   │ 移动  │    │ 视角  │   │
│   │ 摇杆  │    │ 旋转  │   │
│   │      │    │      │   │
│   └──────┘    └──────┘   │
│   (左半屏)    (右半屏)    │
│                          │
│     [交互提示 / 对话面板]  │
│                          │
└──────────────────────────┘
```

| 元素 | 位置 | 说明 |
|------|------|------|
| 移动摇杆 | 左下角 | 固定位置虚拟摇杆，拇指操控 |
| 视角旋转 | 右半屏 | 滑动旋转视角 |
| 对话面板 | 底部弹出 | 自适应高度，带关闭按钮 |
| F 键替代 | 交互按钮 | 靠近角色时右下角显示对话按钮 |

### 5.2 响应式断点

| 断点 | 输入方式 | 说明 |
|------|----------|------|
| ≥768px | 键盘+鼠标 | PointerLock + WASD |
| <768px | 触控 | 虚拟摇杆 + 触控按钮 |

---

## 六、文件结构

```
frontend/src/
├── game/                          # Three.js 独立游戏引擎
│   ├── index.ts                   # 统一导出 + 初始化入口
│   ├── EventBus.ts                # 事件总线
│   ├── SceneManager.ts            # 场景管理
│   ├── PlayerController.ts        # 玩家控制器 (WASD/触控)
│   ├── CharacterManager.ts        # 角色管理 (创建/动画/状态)
│   ├── InteractionSystem.ts       # 交互检测系统
│   └── types.ts                   # 游戏内部类型定义
│
├── components/
│   ├── LingShuSpace.tsx            # 灵枢空间主组件 (替换 ConfTable3D)
│   ├── DialoguePanel.tsx           # 对话面板 UI
│   ├── GameHUD.tsx                 # HUD 覆盖层 (小地图/状态)
│   ├── VirtualJoystick.tsx         # 移动端虚拟摇杆
│   ├── ThinkingBlock.tsx           # [保留] 思考内容展示
│   ├── PipelineTimeline.tsx        # [保留] 工作流时间线
│   └── SceneToggle.tsx             # [修改] 添加"灵枢空间"选项
│
├── hooks/
│   └── useGameWebSocket.ts        # [扩展现有] 增加 agent 状态订阅
│
└── types/
    └── index.ts                    # [扩展] 添加游戏相关类型
```

**前端根目录：**

```
frontend/
├── public/
│   └── models/                     # 角色模型目录 (用户后续放置)
│       ├── lingshu/                # 灵枢模型
│       └── agents/                 # 子 Agent 模型
│
├── ammo.wasm.js                    # [保留] 物理引擎
├── ammo.wasm.wasm                  # [保留] 物理引擎 WASM
│
└── firefly-vmd-player.html        # [保留] VMD 动作查看器
```

---

## 七、与现有系统的兼容

### 7.1 保留的功能

| 组件 | 处理方式 |
|------|----------|
| ThinkingBlock | 作为 HUD 浮层，显示灵枢的思考内容 |
| PipelineTimeline | 作为底部状态条，半透明悬浮 |
| SceneToggle | 改为三选项：工作流 / 3D会议(旧) / 灵枢空间(新) |
| useGameWebSocket | 扩展消息类型，增加 agent 状态同步 |

### 7.2 移除/替换

| 旧组件 | 处理 |
|--------|------|
| ConferenceTable3D.tsx | 替换为 LingShuSpace.tsx |
| GLTF RobotExpressive 模型引用 | 移除，改用配置化模型加载 |

---

## 八、实现阶段

### Phase 1：核心引擎搭建
- EventBus 事件系统
- SceneManager 基础场景
- PlayerController (WASD + 碰撞)
- 占位角色系统 (几何体 + 标签)

### Phase 2：交互与对话
- InteractionSystem 距离检测
- DialoguePanel UI 组件
- 预设话题 + 自由输入
- WebSocket 消息扩展

### Phase 3：动画与行为
- 角色状态机 (idle → lookAt → talking)
- TWEEN 补间动画
- 移动端虚拟摇杆适配

### Phase 4：模型接入
- 用户提供的灵枢模型加载
- 子 Agent 模型加载
- VMD 动画集成
- 场景模型替换

### Phase 5：打磨
- 讨论模式动画
- 特效与过渡
- 性能优化
- 错误处理

---

## 九、API 扩展（后端）

### 9.1 新增 WebSocket 消息

| 方向 | 消息类型 | 说明 |
|------|----------|------|
| S→C | `agent_world_state` | 全量 agent 状态同步 |
| S→C | `agent_state_update` | 单个 agent 状态变更 |
| C→S | `agent_dialogue_start` | 用户发起对话 |
| S→C | `agent_dialogue_chunk` | AI 流式回复 |
| C→S | `agent_dialogue_cancel` | 取消当前对话 |

### 9.2 需要后端配合

- `agent_world_state` 推送：在 orchestrator 初始化时发送 agent 列表和位置
- `agent_state_update` 推送：agent 开始思考/说话/完成时推送状态
- 对话接口：复用现有的 agent 对话 WebSocket 逻辑

---

## 十、非功能需求

| 类别 | 要求 |
|------|------|
| 性能 | 桌面端 ≥30fps，移动端 ≥24fps |
| 内存 | 3D 场景内存 ≤200MB |
| 加载时间 | 首屏加载 ≤5s (含模型) |
| 浏览器 | Chrome 90+, Safari 15+, Edge 90+ |
| 移动端 | iOS Safari 15+, Android Chrome 90+ |

---

## 十一、风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| PointerLock API 在移动端不可用 | 移动端操控体验差 | 虚拟摇杆方案兜底 |
| 大量 3D 模型加载慢 | 用户体验差 | 渐进式加载 + 占位几何体 |
| 后端 WebSocket 消息量大 | 性能下降 | 节流推送 + 增量更新 |
| 与现有路由系统冲突 | 页面切换时 3D 场景残留 | 严格的挂载/卸载生命周期管理 |

---

## 十二、术语表

| 术语 | 说明 |
|------|------|
| **灵枢** | 主控 Agent，相当于 orchestrator，负责协调所有子 Agent |
| **子 Agent** | 各领域专家 Agent，分布在世界中供对话 |
| **灵枢空间** | 3D 可交互世界的总称 |
| **PointerLock** | 浏览器 API，锁定鼠标指针用于第一人称视角控制 |
| **EventBus** | 发布/订阅模式的事件通信总线 |