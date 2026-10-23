# MCP 工具与 ToolAgent 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为标准 MCP 协议接入现有 Agent 系统，实现子 Agent 轻量工具 + ToolAgent 产物工具的分层架构。

**Architecture:** AssemblerAgent 通过 `dispatch_tool_agent` MCP 工具调用 ToolAgent，ToolAgent 按 DAG 依赖并行编排开源 MCP 和原生 MCP 工具链，子 Agent 保留现有轻量工具调用方式。

**Tech Stack:** `mcp` (Python SDK), `httpx`, `subprocess`, `asyncio`, `sentence-transformers`, `rank-bm25`, `jieba`

---

### Task 0: 安装依赖 + 创建目录结构

**Files:**
- Create: `backend/app/mcp/__init__.py`
- Create: `backend/app/mcp/tools/__init__.py`
- Create: `backend/app/mcp/memory/__init__.py`
- Create: `backend/app/services/tool_agent.py`

- [ ] **Step 1: 安装 mcp Python SDK**

```bash
cd e:\一遍过\backend
pip install mcp
```

- [ ] **Step 2: 创建目录结构**

```bash
mkdir -p app/mcp/tools app/mcp/memory
```

- [ ] **Step 3: 创建空 __init__.py 文件**

```bash
# 确保每个目录有 __init__.py
echo "" > app/mcp/__init__.py
echo "" > app/mcp/tools/__init__.py
echo "" > app/mcp/memory/__init__.py
```

- [ ] **Step 4: 创建 tool_agent.py 空占位**

```bash
echo "" > app/services/tool_agent.py
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: init mcp directory structure and dependencies"
```

---

### Task 1: 原生 MCP Server 框架

**Files:**
- Create: `backend/app/mcp/server.py`

- [ ] **Step 1: 创建 FastMCP 服务器框架**

写入 `backend/app/mcp/server.py`：

```python
import logging
from mcp.server.fastmcp import FastMCP

logger = logging.getLogger(__name__)

mcp = FastMCP("lingshu-mcp-server")

# ─── 工具注册（各工具在 tools/ 中实现，通过此文件 import） ───

from app.mcp.tools.dispatch_tool_agent import dispatch_tool_agent
mcp.tool(name="dispatch_tool_agent")(dispatch_tool_agent)

from app.mcp.tools.search_knowledge import search_knowledge
mcp.tool(name="search_knowledge")(search_knowledge)

from app.mcp.tools.get_document import get_document
mcp.tool(name="get_document")(get_document)

from app.mcp.tools.get_flashcards import get_flashcards
mcp.tool(name="get_flashcards")(get_flashcards)

from app.mcp.tools.get_user_stats import get_user_stats
mcp.tool(name="get_user_stats")(get_user_stats)

from app.mcp.tools.web_search import web_search
mcp.tool(name="web_search")(web_search)

# ─── Memory Resource ───

from app.mcp.memory.mcp_memory import get_memory, get_recent_memory
mcp.resource("memory://{user_id}")(get_memory)
mcp.resource("memory://{user_id}/recent")(get_recent_memory)


def start_server():
    """以子进程方式启动 MCP Server，返回 (process, client)"""
    import sys
    import subprocess
    proc = subprocess.Popen(
        [sys.executable, "-m", "app.mcp.server"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return proc


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    mcp.run(transport="stdio")
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/mcp/server.py
git commit -m "feat: add mcp server skeleton with tool registration"
```

---

### Task 2: dispatch_tool_agent 工具（ToolAgent 入口）

**Files:**
- Create: `backend/app/mcp/tools/dispatch_tool_agent.py`
- Modify: `backend/app/services/tool_agent.py`

- [ ] **Step 1: 创建 dispatch_tool_agent.py**

写入 `backend/app/mcp/tools/dispatch_tool_agent.py`：

```python
import asyncio
import logging
from typing import List, Dict, Any, Optional
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class SpecItem(BaseModel):
    agent_id: str
    output: str
    requirements: str = ""


class DispatchInput(BaseModel):
    summary: str
    specs: List[SpecItem]


class ArtifactResult(BaseModel):
    type: str
    path: str
    title: str


class DispatchResult(BaseModel):
    artifacts: List[ArtifactResult] = []
    summary: str = ""


async def dispatch_tool_agent(input_data: Dict[str, Any]) -> Dict[str, Any]:
    """根据总结产出编排 MCP 工具链，生成面向用户的产物。

    Args:
        input_data: {
            "summary": "AssemblerAgent 的完整总结文本",
            "specs": [
                {
                    "agent_id": "tutor_agent",
                    "output": "教学导师输出",
                    "requirements": "需要图表展示数据趋势"
                }
            ]
        }

    Returns:
        {
            "artifacts": [{"type": "pdf", "path": "/tmp/...", "title": "..."}],
            "summary": "执行报告"
        }
    """
    from app.services.tool_agent import ToolAgent

    dispatch_input = DispatchInput(**input_data)
    agent = ToolAgent()
    result = await agent.execute(dispatch_input)
    return result.model_dump()
```

- [ ] **Step 2: 实现 ToolAgent 类**

写入 `backend/app/services/tool_agent.py`：

```python
import asyncio
import logging
from typing import List, Dict, Any
from app.mcp.tools.dispatch_tool_agent import DispatchInput, DispatchResult, ArtifactResult

logger = logging.getLogger(__name__)


class ToolAgent:
    """工具调度 Agent：解析 specs，按 DAG 依赖并行执行 MCP 工具链"""

    async def execute(self, input_data: DispatchInput) -> DispatchResult:
        logger.info(f"ToolAgent 收到 {len(input_data.specs)} 个 agent specs")
        artifacts: List[ArtifactResult] = []

        for spec in input_data.specs:
            logger.info(f"  - {spec.agent_id}: {spec.requirements}")

        # ===== 暂存：后续 Phase 2 实现具体工具 =====
        # 目前返回空的执行结果，ToolAgent 已可被调用
        await asyncio.sleep(0.1)

        return DispatchResult(
            artifacts=artifacts,
            summary=f"已分析 {len(input_data.specs)} 个 agent 的产出需求"
        )
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/mcp/tools/dispatch_tool_agent.py backend/app/services/tool_agent.py
git commit -m "feat: add dispatch_tool_agent mcp tool and ToolAgent skeleton"
```

---

### Task 3: 现有轻量工具移植为 MCP 工具

**Files:**
- Create: `backend/app/mcp/tools/search_knowledge.py`
- Create: `backend/app/mcp/tools/get_document.py`
- Create: `backend/app/mcp/tools/get_flashcards.py`
- Create: `backend/app/mcp/tools/get_user_stats.py`
- Create: `backend/app/mcp/tools/web_search.py`

- [ ] **Step 1: search_knowledge 工具**

写入 `backend/app/mcp/tools/search_knowledge.py`：

```python
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)


async def search_knowledge(params: Dict[str, Any]) -> str:
    """在用户的知识库中语义搜索。

    Args:
        params: {"query": "搜索词", "n_results": 5}
    """
    query = params.get("query", "")
    n_results = params.get("n_results", 5)
    if not query:
        return "[错误] query 不能为空"

    from app.services.vector_db_service import vector_db_service
    documents = vector_db_service.search(query=query, n_results=n_results)
    if not documents:
        return "未找到相关结果"

    lines = [f"找到 {len(documents)} 个结果："]
    for i, doc in enumerate(documents):
        content = doc.get("content", "")[:200]
        title = doc.get("metadata", {}).get("title", "")
        lines.append(f"\n{i+1}. [{title}]\n{content}")
    return "\n".join(lines)
```

- [ ] **Step 2: get_document 工具**

写入 `backend/app/mcp/tools/get_document.py`：

```python
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)


async def get_document(params: Dict[str, Any]) -> str:
    """获取指定文档的全文或指定章节内容。

    Args:
        params: {"document_id": int, "chapter_id": int | None}
    """
    document_id = params.get("document_id")
    chapter_id = params.get("chapter_id")

    from app.db.session import SessionLocal
    from app.models.document import Document, Chapter
    from app.services.document_service import document_service

    db = SessionLocal()
    try:
        if chapter_id:
            chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
            if not chapter:
                return "[错误] 章节不存在"
            return f"# {chapter.title or ''}\n\n{chapter.content}"

        if document_id:
            doc = db.query(Document).filter(Document.id == document_id).first()
            if not doc:
                return "[错误] 文档不存在"
            content = document_service.get_full_content(db, document_id)
            return f"# {doc.title}\n\n{content}"

        return "[错误] 请提供 document_id 或 chapter_id"
    finally:
        db.close()
```

- [ ] **Step 3: get_flashcards 工具**

写入 `backend/app/mcp/tools/get_flashcards.py`：

```python
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)


async def get_flashcards(params: Dict[str, Any]) -> str:
    """查询用户的抽认卡。

    Args:
        params: {"group_id": int | None, "status": str | None, "limit": 20}
    """
    group_id = params.get("group_id")
    status = params.get("status")
    limit = params.get("limit", 20)

    from app.db.session import SessionLocal
    from app.models.flashcard import Flashcard

    db = SessionLocal()
    try:
        query = db.query(Flashcard)
        if group_id:
            query = query.filter(Flashcard.group_id == group_id)
        if status:
            query = query.filter(Flashcard.status == status)
        cards = query.limit(limit).all()

        if not cards:
            return "未找到抽认卡"

        lines = [f"找到 {len(cards)} 张抽认卡："]
        for c in cards:
            lines.append(f"\n- 问题: {c.question}\n  答案: {c.answer}")
        return "\n".join(lines)
    finally:
        db.close()
```

- [ ] **Step 4: get_user_stats 工具**

写入 `backend/app/mcp/tools/get_user_stats.py`：

```python
import logging
from typing import Dict, Any
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


async def get_user_stats(params: Dict[str, Any]) -> str:
    """获取用户的学习统计数据。

    Args:
        params: {"user_id": int, "days": 30}
    """
    user_id = params.get("user_id")
    days = params.get("days", 30)

    from app.db.session import SessionLocal
    from app.models.statistics import DailyStats

    if not user_id:
        return "[错误] user_id 不能为空"

    db = SessionLocal()
    try:
        since = datetime.now() - timedelta(days=days)
        stats = db.query(DailyStats).filter(
            DailyStats.user_id == user_id,
            DailyStats.date >= since
        ).order_by(DailyStats.date.desc()).all()

        if not stats:
            return f"近 {days} 天无学习记录"

        total_time = sum(s.study_minutes or 0 for s in stats)
        total_cards = sum(s.reviewed_cards or 0 for s in stats)
        return (
            f"近 {days} 天学习统计：\n"
            f"- 学习天数: {len(stats)}\n"
            f"- 总学习时长: {total_time} 分钟\n"
            f"- 复习卡片: {total_cards} 张"
        )
    finally:
        db.close()
```

- [ ] **Step 5: web_search 工具**

写入 `backend/app/mcp/tools/web_search.py`：

```python
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)


async def web_search(params: Dict[str, Any]) -> str:
    """搜索互联网获取实时信息。

    Args:
        params: {"query": "搜索词", "count": 5}
    """
    query = params.get("query", "")
    count = params.get("count", 5)
    if not query:
        return "[错误] query 不能为空"

    from app.services.web_search_request_manager import web_search_request_manager
    results = await web_search_request_manager.search(query, top_k=count)
    if not results:
        return "未找到搜索结果"

    lines = [f"搜索 \"{query}\" 找到 {len(results)} 条结果："]
    for r in results:
        title = r.get("title", "")
        snippet = r.get("snippet", "")[:150]
        url = r.get("url", "")
        lines.append(f"\n## {title}\n{snippet}\n{url}")
    return "\n".join(lines)
```

- [ ] **Step 6: 注册所有工具到 server.py**

读取 `backend/app/mcp/server.py`，在 `web_search` 注册语句之后新增 `register_all_tools` 函数（或保持原样——各工具已在顶部逐条注册）。

实际上 Task 1 中 server.py 已经注册了所有 6 个工具，无需额外修改。

- [ ] **Step 7: Commit**

```bash
git add backend/app/mcp/tools/
git commit -m "feat: port existing tools to mcp server"
```

---

### Task 4: Memory MCP — 封装 AgentMemory

**Files:**
- Create: `backend/app/mcp/memory/mcp_memory.py`

- [ ] **Step 1: 实现 Memory Resource**

写入 `backend/app/mcp/memory/mcp_memory.py`：

```python
import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)


async def get_memory(user_id: int) -> str:
    """获取用户长期记忆"""
    from app.services.agent_memory import AgentMemory
    context = await AgentMemory.load(user_id)
    summary = AgentMemory.build_memory_summary(context)
    return summary or "暂无记忆数据"


async def get_recent_memory(user_id: int, limit: int = 3) -> str:
    """获取用户最近查询记忆"""
    from app.services.agent_memory import AgentMemory
    context = await AgentMemory.load(user_id)
    recent = context.get("recent_queries", [])
    if not recent:
        return "暂无最近查询记录"
    lines = []
    for q in recent[-limit:]:
        query = q.get("query", "")
        timestamp = q.get("timestamp", "")
        lines.append(f"- [{timestamp}] {query}")
    return "\n".join(lines)
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/mcp/memory/mcp_memory.py
git commit -m "feat: wrap AgentMemory as mcp memory resource"
```

---

### Task 5: 工具 Handler 适配 — 让 CALL_TOOL 支持 MCP 工具

**Files:**
- Modify: `backend/app/services/agent_tool_layer.py`

当前 `invoke_tool()` 通过 `_TOOL_HANDLERS` 映射调用。需要为 `dispatch_tool_agent` 新增一个 handler。

- [ ] **Step 1: 在 _TOOL_HANDLERS 中注册 dispatch_tool_agent**

读取 `backend/app/services/agent_tool_layer.py`，在第 169-175 行 `_TOOL_HANDLERS` 字典中新增：

```python
_TOOL_HANDLERS = {
    "web_search": _tool_web_search,
    "search_knowledge": _tool_search_knowledge,
    "get_document": _tool_get_document,
    "get_flashcards": _tool_get_flashcards,
    "get_user_stats": _tool_get_user_stats,
    "dispatch_tool_agent": _tool_dispatch_tool_agent,
}
```

- [ ] **Step 2: 在 MCP_TOOLS 中注册 dispatch_tool_agent 的描述**

在 `MCP_TOOLS` 字典中新增：

```python
"dispatch_tool_agent": {
    "description": "根据总结内容调用 ToolAgent 生成面向用户的产物（PDF/PPT/图表/视频/思维导图等）。输入: summary(str), specs(list)。返回: 产物路径列表",
    "inputs": {"summary": "str", "specs": "list"},
    "timeout": 120,
},
```

- [ ] **Step 3: 实现 dispat.ch_tool_agent handler**

在 `_TOOL_HANDLERS` 定义之前新增 handler 函数：

```python
async def _tool_dispatch_tool_agent(params: dict, user_id: int = 0) -> str:
    """调用 ToolAgent 生成面向用户的产物"""
    from app.mcp.tools.dispatch_tool_agent import dispatch_tool_agent
    try:
        result = await dispatch_tool_agent(params)
        artifact_lines = []
        for a in result.get("artifacts", []):
            artifact_lines.append(f"- [{a['type']}] {a['title']}: {a['path']}")
        summary = result.get("summary", "")
        if artifact_lines:
            return f"{summary}\n\n生成产物：\n" + "\n".join(artifact_lines)
        return summary
    except Exception as e:
        logger.error(f"ToolAgent 调用失败: {e}")
        return f"[错误] ToolAgent 调用失败: {e}"
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/agent_tool_layer.py
git commit -m "feat: register dispatch_tool_agent in tool layer"
```

---

### Task 6: ToolAgent 注册 + AssemblerAgent Prompt

**Files:**
- Modify: `backend/app/services/agent_prompts.py`
- Modify: `backend/app/services/agentscope_workflow_prompts.py`

- [ ] **Step 1: 定义 TOOL_AGENT_PROMPT**

在 `backend/app/services/agent_prompts.py` 末尾新增：

```python
TOOL_AGENT_PROMPT = """你是一个工具调度员，负责将 AssemblerAgent 的总结产出转化为具体的面向用户的产物。

你的工作流程：
1. 接收 dispatch_tool_agent 调用（由 AssemblerAgent 发起）
2. 解析 summary（总结文本）和 specs（各 agent 产物的补充说明）
3. 根据 requirements 判断需要生成什么类型的产物
4. 编排工具调用链，按依赖关系调度执行
5. 返回产物路径

注意事项：
- 只做少量决策，主要执行：根据 specs 中的 requirements 判断工具类型
- 不要修改总结内容，保持原文
- 支持并行执行无依赖关系的工具
- 产物格式尽量通用（PDF/SVG/PNG/PPT/MP4）

最终返回 {artifacts: [...]} 和 summary。"""
```

- [ ] **Step 2: 在 AGENT_DEFINITIONS 注册 ToolAgent**

在 `agent_prompts.py` 的 `AGENT_DEFINITIONS` 列表中新增：

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

- [ ] **Step 3: 修改 AssemblerAgent Prompt 添加工具调用指令**

读取 `backend/app/services/agentscope_workflow_prompts.py`，找到 AssemblerAgent 的 Prompt 变量（搜索 `ASSEMBLER_AGENT_PROMPT` 或 `# ─── 阶段4: AssemblerAgent`），在末尾追加：

```
## 工具调用规则

如果你认为用户需要生成面向用户的实体产物（如 PDF 总结报告、思维导图、图表、PPT、视频等），
请调用 dispatch_tool_agent 工具，并按照以下规则构建参数：

- summary: 你的完整总结文本
- specs: 对每个子 Agent 产出逐一补充说明，每项包含：
  - agent_id: 子 Agent 标识
  - output: 该子 Agent 的完整输出
  - requirements: 需要什么类型的产物、内容侧重点

示例：
summary: "函数单调性是高中数学的核心概念..."
specs:
  - agent_id: "tutor_agent"
    output: "函数单调性是指..."
    requirements: "需要图表展示单调递增/递减曲线，生成思维导图"

不要替 ToolAgent 决定具体技术参数（字体、颜色、尺寸等），只说明内容需求和目标。
如果用户只需要纯文本回答，则不需要调用任何工具。
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/agent_prompts.py
git commit -m "feat: register ToolAgent and update AssemblerAgent prompt"
```

---

### Task 7: 启动时启动 MCP Server 子进程

**Files:**
- Modify: `backend/app/services/tool_agent.py`
- Modify: `backend/main.py`

- [ ] **Step 1: 实现 ToolAgent 进程管理**

读取 `backend/app/services/tool_agent.py`，替换为完整实现：

```python
import asyncio
import logging
import sys
import subprocess
from typing import Optional
from app.mcp.tools.dispatch_tool_agent import DispatchInput, DispatchResult

logger = logging.getLogger(__name__)


class ToolAgent:
    """工具调度 Agent：管理 MCP Server 子进程，编排工具调用"""

    _mcp_process: Optional[subprocess.Popen] = None

    async def start(self):
        """启动 MCP Server 子进程"""
        if self._mcp_process is not None:
            return
        logger.info("启动 MCP Server 子进程...")
        self._mcp_process = subprocess.Popen(
            [sys.executable, "-m", "app.mcp.server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        logger.info(f"MCP Server 已启动，PID: {self._mcp_process.pid}")

    async def stop(self):
        """停止 MCP Server 子进程"""
        if self._mcp_process:
            logger.info("停止 MCP Server 子进程...")
            self._mcp_process.terminate()
            self._mcp_process = None

    async def execute(self, input_data: DispatchInput) -> DispatchResult:
        logger.info(f"ToolAgent 收到 {len(input_data.specs)} 个 agent specs")
        artifacts = []

        for spec in input_data.specs:
            logger.info(f"  - {spec.agent_id}: {spec.requirements}")

        await asyncio.sleep(0.1)

        return DispatchResult(
            artifacts=artifacts,
            summary=f"已分析 {len(input_data.specs)} 个 agent 的产出需求"
        )


tool_agent = ToolAgent()
```

- [ ] **Step 2: 在 main.py lifespan 中管理 ToolAgent**

读取 `backend/main.py`，在 lifespan startup 中新增：

```python
# 在 "🚀 启动博查网页搜索服务..." 之前或之后添加
try:
    from app.services.tool_agent import tool_agent
    await tool_agent.start()
    logger.info("✅ MCP Server 启动完成")
except Exception as e:
    logger.error(f"❌ MCP Server 启动失败: {e}")
```

在 lifespan shutdown（`yield` 之后）新增：

```python
try:
    from app.services.tool_agent import tool_agent
    await tool_agent.stop()
except Exception:
    pass
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/tool_agent.py backend/main.py
git commit -m "feat: integrate MCP Server lifecycle with app startup"
```

---

### Task 8: 集成开源 MCP — filesystem

**Files:**
- Modify: `backend/app/services/tool_agent.py`

- [ ] **Step 1: 在 ToolAgent 中集成 filesystem MCP**

在 `backend/app/services/tool_agent.py` 的 `start()` 方法中新增 filesystem 子进程启动：

```python
import shutil
from pathlib import Path

# 在类中新增属性
self._open_source_mcps: dict = {}

# 在 start() 中新增
async def start(self):
    # ... 原有代码 ...

    # 启动开源 MCP 进程
    temp_dir = Path("./temp/mcp_output")
    temp_dir.mkdir(parents=True, exist_ok=True)

    try:
        proc = subprocess.Popen(
            ["npx", "-y", "@modelcontextprotocol/server-filesystem", str(temp_dir)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self._open_source_mcps["filesystem"] = proc
        logger.info(f"filesystem MCP 已启动，PID: {proc.pid}")
    except FileNotFoundError:
        logger.warning("npx 未安装，跳过 filesystem MCP")
    except Exception as e:
        logger.warning(f"filesystem MCP 启动失败: {e}")
```

- [ ] **Step 2: 在 stop() 中清理**

```python
async def stop(self):
    # ... 原有代码 ...
    for name, proc in self._open_source_mcps.items():
        try:
            proc.terminate()
            logger.info(f"{name} MCP 已停止")
        except Exception as e:
            logger.warning(f"{name} MCP 停止失败: {e}")
    self._open_source_mcps.clear()
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/tool_agent.py
git commit -m "feat: integrate filesystem mcp server"
```

---

### Task 9: 集成开源 MCP — puppeteer

**Files:**
- Modify: `backend/app/services/tool_agent.py`

- [ ] **Step 1: 在 start() 中新增 puppeteer**

在 filesystem 启动代码之后：

```python
try:
    proc = subprocess.Popen(
        ["npx", "-y", "@modelcontextprotocol/server-puppeteer"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    self._open_source_mcps["puppeteer"] = proc
    logger.info(f"puppeteer MCP 已启动，PID: {proc.pid}")
except Exception as e:
    logger.warning(f"puppeteer MCP 启动失败: {e}")
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/tool_agent.py
git commit -m "feat: integrate puppeteer mcp server"
```

---

### Task 10: 集成开源 MCP — excalidraw

**Files:**
- Modify: `backend/app/services/tool_agent.py`

- [ ] **Step 1: 在 start() 中新增 excalidraw**

在 puppeteer 启动代码之后：

```python
try:
    proc = subprocess.Popen(
        ["npx", "-y", "@modelcontextprotocol/server-excalidraw"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    self._open_source_mcps["excalidraw"] = proc
    logger.info(f"excalidraw MCP 已启动，PID: {proc.pid}")
except Exception as e:
    logger.warning(f"excalidraw MCP 启动失败: {e}")
```

- [ ] **Step 2: 在 Microservice requirements.txt 中添加依赖**

读取 `deploy/zvec-service/requirements.txt`，新增：

```
mcp
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/tool_agent.py deploy/zvec-service/requirements.txt
git commit -m "feat: integrate excalidraw mcp server and add mcp dep"
```

---

### Task 11: 端到端验证

- [ ] **Step 1: 启动后端**

```bash
cd e:\一遍过\backend
python main.py
```

检查日志：
```
INFO:__main__:🚀 启动 MCP Server 子进程...
INFO:__main__:✅ MCP Server 启动完成
INFO:app.services.tool_agent:filesystem MCP 已启动
INFO:app.services.tool_agent:puppeteer MCP 已启动
INFO:app.services.tool_agent:excalidraw MCP 已启动
```

- [ ] **Step 2: 测试轻量工具仍然可用**

```bash
# 测试 search_knowledge（需带 token）
curl -s http://localhost:8080/api/v1/documents/1/mindmap/generate
```

- [ ] **Step 3: 在 WebSocket 会话中测试 ToolAgent 调用**

通过前端页面发送一条涉及知识总结的请求，确认：
1. 子 Agent 正常执行并返回分析结论
2. AssemblerAgent 正常总结
3. 如果用户要求导出，dispatch_tool_agent 被调用
4. 返回产物路径

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: mcp agent tools phase 1 complete"
```
