# 「灵枢空间」任务拆分

> 关联设计文档: `2026-05-12-lingshu-space-design.md`
> 日期: 2026-05-12

---

## Phase 1：核心引擎搭建

### Task 1.1 — 创建 EventBus 事件系统
- **文件:** `src/game/EventBus.ts`
- **内容:**
  - 实现发布/订阅模式的事件总线
  - 定义完整的事件类型接口 `GameEvents`
  - 导出单例 `eventBus`
  - 单元测试: 验证 on/emit/off 基本功能
- **产出:** EventBus.ts + 类型定义

### Task 1.2 — 创建场景管理器
- **文件:** `src/game/SceneManager.ts`
- **内容:**
  - `init(container)` — 创建 Three.js 场景、渲染器、基础光照
  - `dispose()` — 清理所有资源
  - 默认配置: 灰色地面、环境光、方向光
  - 暴露 `scene`, `renderer`, `camera` 引用
- **产出:** SceneManager.ts

### Task 1.3 — 创建玩家控制器 (WASD)
- **文件:** `src/game/PlayerController.ts`
- **内容:**
  - WASD 键盘移动 + Shift 加速
  - PointerLockControls 鼠标视角旋转
  - 移动速度可配置 (默认 5m/s)
  - 高度锁定 (1.6m)
  - 碰撞检测 (简单 AABB 边界)
  - `lock()/unlock()` 方法供对话时调用
- **产出:** PlayerController.ts

### Task 1.4 — 创建占位角色系统
- **文件:** `src/game/CharacterManager.ts`
- **内容:**
  - 角色数据结构定义
  - 创建占位角色 (CapsuleGeometry + Canvas 材质名字标签)
  - 角色属性: id, name, role, position
  - `createCharacter(config)` / `removeCharacter(id)`
  - 暴露角色列表供其他模块查询
- **产出:** CharacterManager.ts (包含类型定义)

### Task 1.5 — 游戏引擎入口
- **文件:** `src/game/index.ts`
- **内容:**
  - `createGame(container, config)` 工厂函数
  - 组装 SceneManager + PlayerController + CharacterManager
  - 启动渲染循环
  - `destroyGame()` 清理函数
  - 暴露 `eventBus` 供 React 层使用
- **产出:** index.ts

### Task 1.6 — LingShuSpace React 组件（基础版）
- **文件:** `src/components/LingShuSpace.tsx`
- **内容:**
  - useEffect 挂载/卸载游戏引擎
  - 占位 UI（加载指示器）
  - 替换 Agent.tsx 中的 ConferenceTable3D 引用
- **产出:** LingShuSpace.tsx + Agent.tsx 修改

---

## Phase 2：交互与对话

### Task 2.1 — 交互检测系统
- **文件:** `src/game/InteractionSystem.ts`
- **内容:**
  - 每帧计算玩家相机 ↔ 各角色的欧几里得距离
  - 距离 < 3m 时发射 `interaction:available` 事件
  - 距离 ≥ 3m 或切换目标时发射 `interaction:unavailable`
  - 返回最近角色引用
- **产出:** InteractionSystem.ts

### Task 2.2 — 交互提示 UI
- **修改:** GameHUD / LingShuSpace.tsx
- **内容:**
  - 监听 `interaction:available` → 显示 "按 F 与 [角色名] 对话"
  - 监听 `interaction:unavailable` → 隐藏提示
  - F 键监听 → 发射 `dialogue:start` 事件
  - 动画: 提示淡入淡出
- **产出:** HUD 交互提示

### Task 2.3 — 对话面板 UI
- **文件:** `src/components/DialoguePanel.tsx`
- **内容:**
  - 对话面板布局: 角色头像 + 名称 + 回复区域 + 选项/输入
  - **预设话题:** 3-5 个快捷按钮（"帮我分析这个文档"、"你有什么建议" 等）
  - **自由输入:** 输入框 + 发送按钮，Enter 发送
  - **流式回复:** 逐 chunk 渲染，打字机效果
  - 状态管理: idle → selecting → waiting → streaming → completed
  - 关闭: ESC / 点击关闭按钮 / 走远 (>3m)
  - 淡入淡出过渡动画
- **产出:** DialoguePanel.tsx

### Task 2.4 — WebSocket 消息扩展
- **修改:** `src/hooks/useGameWebSocket.ts`
- **内容:**
  - 扩展消息处理: 订阅 `agent_world_state`, `agent_state_update`, `agent_dialogue_chunk`
  - 发送消息: `agent_dialogue_start`, `agent_dialogue_cancel`
  - 状态管理: 维护 agents Map<id, AgentState>
  - 通过 eventBus 同步到 Three.js
- **产出:** 扩展后的 useGameWebSocket

### Task 2.5 — 对话系统与后端联调
- **修改:** DialoguePanel.tsx + useGameWebSocket.ts
- **内容:**
  - 快捷选项/自由输入 → 发送 WebSocket 消息
  - 接收流式 chunk → 追加到回复区域
  - 接收 `is_final=true` → 状态置为 completed
  - 错误处理: 显示错误提示，重试按钮
- **产出:** 完整对话流程

---

## Phase 3：动画与行为

### Task 3.1 — 角色状态机
- **修改:** `src/game/CharacterManager.ts`
- **内容:**
  - 实现状态机: idle → lookAt → talking → discuss → idle
  - 状态转换: 通过 eventBus 监听 `dialogue:start/end`, `agent:speaking`
  - 状态变更时发射 `character:stateChanged` 事件
- **产出:** 角色状态机

### Task 3.2 — TWEEN 补间动画
- **修改:** `src/game/CharacterManager.ts`
- **内容:**
  - idle: Y 轴轻微浮动 (sin 波，±0.05)
  - lookAt: 平滑旋转面向用户 (lerp)
  - talking: 轻微上下点头 + 随机手势
  - 引入 tween.js 或自定义补间工具
- **产出:** 角色动画系统

### Task 3.3 — 移动端虚拟摇杆
- **文件:** `src/components/VirtualJoystick.tsx`
- **内容:**
  - 双摇杆布局: 左下移动 + 右半屏旋转
  - 摇杆 UI: 圆形底座 + 可拖动的拇指
  - 触控事件: touchstart/move/end → 输出标准化方向向量
  - 移动端检测 (isMobile) → 动态切换输入模式
- **产出:** VirtualJoystick.tsx

### Task 3.4 — 移动端适配 PlayerController
- **修改:** `src/game/PlayerController.ts`
- **内容:**
  - 桌面/移动端输入模式切换
  - 虚拟摇杆输入绑定
  - 触控旋转视角（右半屏滑动）
  - 靠近角色时显示"对话"按钮（替代 F 键）
- **产出:** 移动端操控可用

---

## Phase 4：模型接入

### Task 4.1 — 模型加载器
- **新建/修改:** `src/game/CharacterManager.ts`
- **内容:**
  - 支持 PMX (MMDLoader) 和 GLTF 格式
  - 异步加载 + 进度回调
  - 占位几何体 → 真实模型的平滑过渡
  - 模型缓存，避免重复加载
- **产出:** 模型加载系统

### Task 4.2 — VMD 动画集成
- **修改:** `src/game/CharacterManager.ts`
- **内容:**
  - 加载 VMD 动作文件
  - 绑定到角色模型
  - 按状态切换动画: idle → gene_stand, talking → gene_normal, etc.
  - 复用 firefly-vmd-player.html 中的加载逻辑
- **产出:** VMD 动画播放

### Task 4.3 — 场景模型替换
- **修改:** `src/game/SceneManager.ts`
- **内容:**
  - 加载 GLB/GLTF 场景模型
  - 替换占位地面和环境
  - 碰撞检测适配新场景
- **产出:** 真实场景渲染

---

## Phase 5：打磨

### Task 5.1 — 讨论模式
- **内容:**
  - 后端推送多个 agent 同时讨论 → 角色面向彼此做手势
  - 讨论气泡浮层
- **产出:** 讨论动画

### Task 5.2 — 小地图
- **修改:** `src/components/GameHUD.tsx`
- **内容:**
  - 圆形/方形小地图，显示玩家位置 + 角色图标
  - 点击角色图标可传送（后续可选）
- **产出:** 小地图 HUD

### Task 5.3 — 性能优化
- **内容:**
  - LOD 模型切换
  - 视锥剔除
  - 纹理压缩
  - draw call 合并
- **产出:** 性能达标

### Task 5.4 — 综合测试与修复
- **内容:**
  - 跨浏览器兼容性测试
  - 移动端真机测试
  - WebSocket 断连重试
  - 3D 场景内存泄漏排查
- **产出:** 稳定版本