# MCP 工具与 ToolAgent 架构设计

## 1. 整体架构

```
用户提问
  │
  ├─ IntentAgent            ← 分析意图
  ├─ PlannerAgent           ← 规划子 Agent 清单
  │
  ├─ [子 Agent 并行执行]     ← 只分析，给结论
  │  知识管家  → search_knowledge, get_document
  │  教学导师  → search_knowledge
  │  题库专家  → get_flashcards
  │  ... 等
  │
  ├─ AssemblerAgent         ← 总结所有子 Agent 结论
  │    │
  │    ├─ 纯文本回答 → 直接返回给用户
  │    │
  │    └─ 需要生成实体产物(PDF/PPT/图表/视频/思维导图) →
  │         └─ 通过 MCP 工具 dispatch_tool_agent 调用 ToolAgent
  │               ├─ filesystem (读写临时文件)
  │               ├─ puppeteer (HTML → PDF/截图)
  │               ├─ excalidraw (图表绘制)
  │               ├─ generate-mindmap (思维导图生成)
  │               ├─ generate-ppt (PPT 生成)
  │               ├─ generate-video (视频生成)
  │               └─ memory (长期记忆读写)
  │
  └─ 返回最终结果 + 产物路径
```

### 工具权限分层

| 层级 | 调用方 | 工具类型 | 面向用户 |
|------|--------|---------|---------|
| 轻量工具 | 子 Agent | `search_knowledge`, `get_document`, `get_flashcards` | ❌ 不面向用户 |
| 产物工具 | ToolAgent | `dispatch_tool_agent` 中编排的所有 MCP | ✅ 面向用户 |

## 2. AssemblerAgent → ToolAgent 通信协议

AssemblerAgent 通过标准 MCP 工具 `dispatch_tool_agent` 调用 ToolAgent。

### MCP 工具定义

```python
{
    "name": "dispatch_tool_agent",
    "description": "根据总结内容调用 ToolAgent 生成面向用户的产物（PDF/PPT/图表/视频/思维导图等）",
    "inputs": {
        "summary": "str",          # AssemblerAgent 的完整总结文本
        "specs": "list"            # 每个子 Agent 产物的补充说明
    }
}
```

### specs 字段结构

```json
[
    {
        "agent_id": "tutor_agent",
        "output": "教学导师的完整输出文本",
        "requirements": "需要图表展示函数单调性曲线；生成思维导图"
    },
    {
        "agent_id": "knowledge_agent",
        "output": "知识管家的完整输出文本",
        "requirements": "导出为 PDF 格式"
    },
    {
        "agent_id": "quiz_agent",
        "output": "题库专家的完整输出",
        "requirements": "将错题生成复习视频"
    }
]
```

### ToolAgent 的处理流程

```
dispatch_tool_agent(summary, specs)
  │
  ├─ 1. 解析 specs，识别每个 agent 的产出需求
  │     （图表、PDF、PPT、视频、思维导图等）
  │
  ├─ 2. 构建工具调用 DAG（依赖关系图）
  │     ├─ Node: (tool_name, params, depends_on)
  │     └─ Edge: 文件依赖关系
  │
  ├─ 3. 按 DAG 拓扑序执行
  │     ├─ 无依赖的节点并行执行
  │     └─ 有依赖的节点等待上游完成
  │
  ├─ 4. 收集所有产物路径
  │
  └─ 5. 返回 {artifacts: [...], summary: "执行报告"}
```

## 3. 原生 MCP 服务器

### 目录结构

```
backend/app/mcp/
├── __init__.py
├── server.py                # FastMCP 应用，注册所有原生工具
├── tools/
│   ├── __init__.py
│   ├── search_knowledge.py  # 向量知识库搜索
│   ├── get_document.py      # 文档/章节获取
│   ├── get_flashcards.py    # 抽认卡查询
│   ├── get_user_stats.py    # 学习统计
│   ├── web_search.py        # 网络搜索
│   ├── generate_pdf.py      # 内容 → PDF
│   ├── generate_ppt.py      # 内容 → PPT
│   ├── generate_mindmap.py  # 内容 → 思维导图
│   ├── generate_video.py    # 内容 → 讲解视频
│   └── dispatch_tool_agent.py  # ToolAgent 入口（调用所有 MCP 编排）
└── memory/
    └── mcp_memory.py        # AgentMemory → MCP Memory Server 封装
```

### MCP Server 注册

```python
# server.py
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("lingshu-mcp-server")

# 注册所有工具
mcp.tool()(dispatch_tool_agent)
mcp.tool()(search_knowledge)
mcp.tool()(get_document)
# ... 等

# 注册 Memory Resource
mcp.resource("memory://{user_id}")(get_memory)
mcp.resource("memory://{user_id}/recent")(get_recent_memory)
```

### 开源 MCP 集成

开源 MCP 进程由 ToolAgent 通过 subprocess 启动和管理：

```python
# ToolAgent 启动外部 MCP 进程
import subprocess
import json

mcp_processes = {
    "filesystem": subprocess.Popen(
        ["npx", "-y", "@modelcontextprotocol/server-filesystem", "./temp"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE
    ),
    "puppeteer": subprocess.Popen(
        ["npx", "-y", "@modelcontextprotocol/server-puppeteer"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE
    ),
}
```

## 4. ToolAgent 注册

在 `agent_prompts.py` 的 `AGENT_DEFINITIONS` 中新增：

```python
{
    "id": "tool_agent",
    "name": "工具调度员",
    "role_desc": "负责根据总结产出编排 MCP 工具链，生成 PDF/PPT/图表/视频/思维导图等面向用户的产物",
    "system_prompt": TOOL_AGENT_PROMPT,
    "tools": ["dispatch_tool_agent"],
    "icon": "🛠️",
    "phase": 3,
}
```

## 5. AssemblerAgent Prompt 修改

当前 AssemblerAgent 负责总结各子 Agent 产出。新增指令：

```
在需要生面向用户的产物（PDF/PPT/图表/视频/思维导图等）时，
调用 dispatch_tool_agent 工具。

参数构建规则：
- summary: 你的完整总结文本
- specs: 对每个子 Agent 产出逐一补充说明
  - requirements 字段描述：需要什么类型的产物、内容侧重点
  - 例如："需要图表展示数据趋势"、"导出为 PDF"、"生成讲解视频"

不要替 ToolAgent 决定具体技术参数（字体、颜色、尺寸等），
只说明内容需求和目标。
```

## 6. 执行模式

### DAG 调度

ToolAgent 收到 `dispatch_tool_agent` 调用后，构建依赖 DAG：

```
无依赖节点（可并行）:
  ├─ filesystem.write(summary.md)
  ├─ excalidraw.draw(chart_spec)
  └─ generate-mindmap.create(spec)

有依赖节点（串行等待）:
  ├─ filesystem.write(summary.md) → puppeteer.html_to_pdf()
  └─ filesystem.write(summary.md) → generate-ppt.create()
```

### 产物返回格式

```json
{
    "artifacts": [
        {"type": "pdf", "path": "/tmp/output/summary.pdf", "title": "函数单调性总结"},
        {"type": "mindmap", "path": "/tmp/output/mindmap.svg", "title": "函数单调性知识图谱"},
        {"type": "chart", "path": "/tmp/output/chart.png", "title": "函数图像示意"}
    ],
    "summary": "已生成 3 个产物：PDF 总结报告、思维导图、函数图像图表"
}
```

## 7. 实施阶段

| 阶段 | 内容 | 文件 |
|------|------|------|
| Phase 1 | MCP Server 框架 + `dispatch_tool_agent` 实现 | `backend/app/mcp/` 新目录 |
| Phase 2 | 原生工具接入（generate-pdf, generate-ppt, generate-mindmap 等） | `mcp/tools/` 各文件 |
| Phase 3 | 集成开源 MCP（filesystem, puppeteer, excalidraw, memory） | ToolAgent 进程管理 |
| Phase 4 | AssemblerAgent Prompt 修改 + ToolAgent 注册 | `agent_prompts.py`, `agent_orchestrator.py` |
| Phase 5 | 端到端测试 + 上线 | - |
