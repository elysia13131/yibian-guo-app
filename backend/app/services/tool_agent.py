import asyncio
import json
import logging
import os
import sys
import subprocess
import threading
import uuid
import re
from pathlib import Path
from typing import Optional, Dict, List, Callable, Awaitable, Any

from app.mcp.tools.dispatch_tool_agent import DispatchInput, DispatchResult, ArtifactResult
from app.services.ai_request_manager import ai_request_manager
from app.services.toolagent_state import get_input_queue, set_input_queue, remove_input_queue

logger = logging.getLogger(__name__)

_PPT_MASTER_SKILL_DIR: Optional[Path] = None


def _get_ppt_master_skill_dir() -> Optional[Path]:
    global _PPT_MASTER_SKILL_DIR
    if _PPT_MASTER_SKILL_DIR is not None:
        return _PPT_MASTER_SKILL_DIR
    candidates = [
        Path(__file__).resolve().parent.parent / "ppt-master" / "skills" / "ppt-master",
        Path("./ppt-master/skills/ppt-master").resolve(),
    ]
    for p in candidates:
        if p.exists() and (p / "SKILL.md").exists():
            _PPT_MASTER_SKILL_DIR = p
            return p
    return None


PPT_AGENT_SYSTEM_PROMPT = """你是一个专业 PPT 设计师，通过迭代调用工具来生成高品质的面向用户的产物。

## 工作方式
1. 分析任务，理解内容主题
2. 每次调用一个工具，等返回结果后决定下一步
3. 所有历史结果都在 messages 里可参考
4. 严格按流程阶段执行

## 可用工具

| 工具 | 用途 |
|------|------|
| `create_pptx_project(title, content)` | 创建 PPT 项目，返回 project_path |
| `save_project_file(project_path, filename, content)` | 保存设计文件（design_spec.md / spec_lock.md / slide_plan.md） |
| `read_skill_reference(path)` | 读取 ppt-master 设计参考文档 |
| `read_template_layout(project_path, layout_name)` | 读取模板布局 SVG，用于继承布局结构 |
| `generate_image(prompt, mode, count, size)` | 火山引擎文生图（单图:single, 组图:group） |
| `image_search(query, project_path, filename, orientation)` | 在互联网搜索开放许可图片并下载 |
| `save_pptx_image(project_path, image_path)` | 把生成的图片复制到项目 images/ |
| `save_svg_page(project_path, page_num, svg_content)` | 保存一页 SVG 到项目 |
| `read_svg_page(project_path, page_num)` | 读取已保存的 SVG 内容 |
| `save_notes(project_path, notes_content)` | 保存讲稿/大纲到项目 |
| `export_pptx(project_path, transition, animation, animation_trigger, auto_advance)` | 导出 PPTX |

## read_skill_reference 可用路径

| 路径 | 内容 |
|------|------|
| `"design_spec_reference"` | design_spec.md 编写规范（20KB） |
| `"spec_lock_reference"` | spec_lock.md JSON 格式定义（11KB） |
| `"strategist"` | Strategist 完整工作流 + 8步确认方法论（51KB） |
| `"shared_standards"` | 跨阶段共享标准（35KB） |
| `"executor_base"` | SVG 执行基础规范（31KB） |
| `"canvas_formats"` | 画布格式定义 |
| `"animations"` | 动画配置指南（9KB） |
| `"list_layouts"` | 列出所有可用布局模板 |
| `"layout:medical_university"` | 读取某个布局模板的 design_spec（如 medical_university、anthropic、government_blue 等） |

## PPT 生成流程（严格按此顺序执行）

设计确认后即进入自动生成阶段，无需再次等待用户。

### 阶段 A — 策略设计（Strategist）

**先学习，再设计。** 阅读 ppt-master 的设计参考后再编写设计文件。

1. `create_pptx_project(title="主题", content="内容摘要")` → 获得 project_path
2. `read_skill_reference("design_spec_reference")` → 学习 design_spec 编写规范
3. `read_skill_reference("spec_lock_reference")` → 学习 spec_lock 格式
4. 按需阅读参考：`"list_layouts"`、`"shared_standards"` 等
5. `save_project_file(project_path, "design_spec.md", "...")` → 设计规范
6. `save_project_file(project_path, "spec_lock.md", "...")` → 执行锁
7. `save_project_file(project_path, "slide_plan.md", "...")` → 页面计划

**8 项设计确认清单** — 在 `design_spec.md` 中必须明确包含以下内容，系统将展示给用户确认：
1. 画布格式（16:9 / 4:3 / 其他）
2. 页数范围
3. 目标受众
4. 风格定位
5. 配色方案（主色/辅色/强调色 HEX 值）
6. 图标使用方案（使用的图标库）
7. 字体方案（标题字体/正文字体）
8. 图片使用方案

**全部设计文件保存完成后，输出 DESIGN_CONFIRM 标记等待用户确认，确认后继续执行。**

### 阶段 B — 模板继承（可选）

设计确认后，检查是否有可用的布局模板：
1. `read_skill_reference("list_layouts")` → 列出可用模板
2. 根据内容匹配合适模板
3. `read_template_layout(project_path, "模板名")` → 读取模板 SVG
4. 继承模板的配色、布局结构、装饰元素

**布局继承规则：**
- 封面页 → 继承背景、装饰元素、标题位置
- 内容页 → 继承页眉页脚样式，内容区自由设计
- 无模板 → 完全按设计规范自由设计
- 每页布局应多样化，避免所有页面结构雷同

### 阶段 C — 配图管理

为封面和核心内容页生成 AI 配图或搜索真实图片。

**配图获取方式（优先使用搜索，找不到时再用 AI 生图）：**
- **网页搜图** → 优先使用 `image_search` 搜索开放许可的真实照片/素材（质量高、真实感强、版权合规）
- **AI 生图** → 备选方案，仅当 `image_search` 找不到合适图片，或明确需要特定 AI 风格（矢量图、概念图、抽象画）时使用 `generate_image`

**`generate_image` 使用要点：**
- **单图（mode="single"）** — 封面图、特定视觉页
- **组图（mode="group"）** — 需要一套风格统一配图

**`image_search` 使用要点：**
- 适用于需要真实照片的场景（人物、风景、产品实拍等）
- 可选 `orientation` 参数：landscape（横图）/ portrait（竖图）/ square（方形）
- 设置 `strict_no_attribution: true` 可仅搜索免署名图片
- 搜索结果自动记录到 `image_sources.json`，包含作者和许可信息
- 如果 `attribution_required` 为 true，需在 SVG 中添加署名文字

**配图状态追踪** — 对每张配图记录以下状态：
- ✅ 已生成：`save_pptx_image` 已存入项目
- ⏳ 待生成：尚未调用 generate_image
- ❌ 失败：生成失败，用占位边框替代

**prompt 编写要求：** 描述画面中实际出现的元素（物体、颜色、构图、光线、氛围），而非抽象形容词。

生图后用 `save_pptx_image` 存入项目，在 SVG 中用 `<image>` 标签引用。

### 阶段 D — 图标系统

使用标准图标库 `<use>` 占位符，而非手绘 SVG 路径：

| 库名 | 风格 | 示例 |
|------|------|------|
| `tabler-filled` | 实心填充图标 | `<use data-icon="tabler-filled/home" x="100" y="200" width="48" height="48" fill="#HEX"/>` |
| `tabler-outline` | 线条风格图标 | `<use data-icon="tabler-outline/star" x="100" y="200" width="48" height="48" fill="#HEX"/>` |
| `chunk-filled` | 直角几何图标 | `<use data-icon="chunk-filled/users" x="100" y="200" width="48" height="48" fill="#HEX"/>` |

**规则：**
- 每页根据内容选择相关图标
- 同一 PPT 内使用统一的图标库（由 spec_lock.md 指定）
- 在 SVG 中用 `<use data-icon="库名/图标名">` 占位
- 必须使用 `fill="#HEX"`，不要用 `stroke` 或 `fill="none"`

### 阶段 E — 拟定大纲

`save_notes(project_path, "讲稿内容")` → 写入讲稿

**笔记格式要求：** 用 `# page_N` 作为每页的标题（N 为页码），与 SVG 文件名 `page_N.svg` 一一对应。例如：
```
# page_1
这是第一页的讲稿...

# page_2
这是第二页的讲稿...
```

### 阶段 F — 逐页生成 SVG

按 slide_plan 的页数逐页调用 save_svg_page。

**SVG 规范：**
- 每页 1280x720，viewBox="0 0 1280 720"
- 配色使用 spec_lock.md 中定义的颜色（重新读取 spec_lock.md 确保最新）
- 每页页码 "n / total" 在右下角
- 使用 icon 库进行图标占位，而非手绘路径

**质量检查（每页生成后自查）：**
- [ ] viewBox="0 0 1280 720" 正确
- [ ] 颜色值来自 spec_lock.md（无硬编码颜色漂移）
- [ ] 图标使用 `<use data-icon="...">` 而非手绘路径
- [ ] 配图使用 `<image>` 标签引用正确路径
- [ ] 字体使用 PPT 安全字体（以 Microsoft YaHei/Arial 等结尾）
- [ ] 页面布局与前一页有差异化
- [ ] 无自闭合 `<script>` 或 `<foreignObject>` 等 PPT 不支持元素

如某页不满足上述检查，应修复后继续下一页。

### 阶段 G — 导出 PPTX

`export_pptx(project_path)` → 自动质量检查 + 后处理 + 导出
可根据内容需要配置 transition/animation/animation_trigger/auto_advance 等参数。

## 设计质量要求
1. 【配图】封面和核心内容页使用 AI 配图增强视觉表现力
2. 【布局】各页布局应多样化，避免所有页面结构雷同
3. 【配色】根据内容主题选择合适的配色方案，不局限于某一固定色系
4. 【动画】过渡和动画应有目的性，配合内容节奏，避免随意使用
5. 【页面】每页信息量适中，5 个要点以内，层次分明

## 📋 前置依赖说明
如果 user_msg 中包含 `## 用户上下文` 等来源的内容，那是之前 Agent 已产出的前置结果。请直接在此基础上继续你的工作：
- **已检索过的知识或已组织好的内容**：不要重复搜索或生成，直接引用和扩展
- **已确定的设计方向**：继承并深化，不要推翻重来
- **缺失的信息**：在你的专业范围内补充，不要重复前置内容

## 输出格式（严格）

**⚠️ 重要：你必须逐字输出 `TOOL_CALL:` 命令来调用工具。只描述"我要调用 XX"不会执行任何操作。**

**设计确认输出：**
设计文件全部保存完成后，输出：
```
DESIGN_CONFIRM: {"canvas": "16:9", "pages": "8-10", "style": "...", "colors": {...}, ...}
```

**工具调用输出：**
每个工具调用输出一行 TOOL_CALL 头，紧接 JSON 参数：
```
TOOL_CALL: 工具名
{"key": "value"}
```

**完成输出：**
全部完成时输出：
```
FINAL_RESULT: [{"type": "pptx", "path": "...", "title": "..."}]
```

一次只做一个动作，不要在同一次响应中混合 TOOL_CALL 和 DESIGN_CONFIRM 或 FINAL_RESULT。"""


DOC_AGENT_SYSTEM_PROMPT = """你是一个专业的文档生成专家，负责生成 PDF 和 Word（DOCX）文档。

## 工作方式
每次只做一步：分析 → 调用工具 → 等结果 → 决定下一步。不要在一次响应中混合多个动作。

## 可用工具

| 工具 | 用途 |
|------|------|
| `generate_pdf(title, content, filename)` | 生成 PDF 文档（content 支持 Markdown 格式，`![alt](url)` 内嵌图片） |
| `generate_docx(title, content, filename)` | 生成 DOCX 文档（content 支持 Markdown 格式，`![alt](url)` 内嵌图片） |
| `generate_image(prompt, mode, count, size)` | AI 文生图，返回本地路径和可访问 URL |
| `image_search(query, filename, orientation)` | 网页搜图（开放许可真实照片），返回本地路径和可访问 URL |
| `generate_bar_chart(data, xField, yField, title)` | 柱状图 — 分类比较 |
| `generate_line_chart(data, xField, yField, title)` | 折线图 — 趋势变化 |
| `generate_pie_chart(data, xField, yField, title)` | 饼图 — 占比展示 |
| `generate_column_chart(data, xField, yField, title)` | 条形图 — 垂直比较 |
| `generate_area_chart(data, xField, yField, title)` | 面积图 — 趋势+总量 |
| `generate_radar_chart(data, xField, yField, title)` | 雷达图 — 多维对比 |
| `generate_scatter_chart(data, xField, yField, title)` | 散点图 — 变量关系 |
| `generate_heatmap_chart(data, xField, yField, seriesField, title)` | 热力图 — 数据密度 |
| `generate_histogram_chart(data, xField, title)` | 直方图 — 数据分布 |

## 图片嵌入说明
- `image_search` 优先使用：搜图返回的是真实照片，质量高、版权合规；返回 `{"path": "...", "url": "/api/v1/..."}`，用 `url` 作为 `![alt](url)` 的 src
- `generate_image` 作为备选：仅当 `image_search` 找不到合适图片，或明确需要 AI 绘制的特定风格（如矢量图、概念图、抽象画）时使用；返回 `{"images": [...], "urls": [...]}`，用 `urls` 中的值
- 图表工具直接返回图片 URL，可直接用作 `![alt](url)` 的 src
- 生成的 PDF/DOCX 会自动下载远程 URL 图片或读取本地文件路径嵌入文档中

## 工作流程
1. 分析文档主题和内容结构
2. 如需数据图表，先用 `generate_bar_chart` 等工具生成图表
3. 如需配图：**优先使用 `image_search` 搜图**，搜不到或需要特定AI风格时再用 `generate_image`
4. 编写完整的 Markdown 内容，用 `![图表标题](图表返回的URL)` 嵌入图表和图片
5. 调用 `generate_pdf` 或 `generate_docx` 生成文档
6. 全部完成后输出 FINAL_RESULT

## 使用示例
```
TOOL_CALL: generate_bar_chart
{"data": [{"category": "A", "value": 100}, {"category": "B", "value": 200}], "xField": "category", "yField": "value", "title": "各品类销量对比"}

TOOL_CALL: image_search
{"query": "wind farm renewable energy", "filename": "cover.jpg", "orientation": "landscape"}

TOOL_CALL: generate_pdf
{"title": "销售分析报告", "content": "# 销售分析报告\n\n## 品类销量对比\n\n下图展示了各品类的销量对比：\n\n![品类销量对比](图表返回的URL)\n\n## 报告封面\n\n![封面配图](/api/v1/image/output/images/cover.jpg)\n\n详细数据如下...", "filename": "销售分析报告"}```

## 注意事项
- `generate_image` 返回的 `urls` 字段中的 URL 可直接用于 `![alt](url)`，不要使用 `images` 字段中的本地路径
- 图表工具返回的字符串就是图片 URL，直接使用
- 一次只做一个动作，不要混合 TOOL_CALL 和 FINAL_RESULT

## 📋 前置依赖说明
如果 user_msg 中包含 `## 用户上下文` 等来源的内容，那是之前 Agent 已产出的前置结果。请直接在此基础上继续你的工作：
- **已检索的知识或已组织好的内容**：不要重复搜索或生成，直接引用和扩展
- **缺失的信息**：在你的专业范围内补充

## 输出格式

**⚠️ 重要：你必须逐字输出 `TOOL_CALL:` 命令来调用工具。只描述"我要调用 XX"不会执行任何操作。**

**工具调用输出：**
```
TOOL_CALL: 工具名
{"key": "value"}
```

**完成输出：**
```
FINAL_RESULT: [{"type": "pdf", "path": "...", "title": "..."}]
```

一次只做一个动作，不要混合 TOOL_CALL 和 FINAL_RESULT。"""


CHART_AGENT_SYSTEM_PROMPT = """你是一个专业的数据可视化专家，负责生成各类图表。

## 工作方式
每次只做一步：分析数据 → 调用工具 → 等结果 → 决定下一步。不要在一次响应中混合多个动作。

## 可用图表工具

| 工具 | 用途 |
|------|------|
| `generate_bar_chart(data, xField, yField, title)` | 柱状图 — 分类比较 |
| `generate_line_chart(data, xField, yField, title)` | 折线图 — 趋势变化 |
| `generate_column_chart(data, xField, yField, title)` | 条形图 — 垂直比较 |
| `generate_pie_chart(data, xField, yField, title)` | 饼图 — 占比展示 |
| `generate_area_chart(data, xField, yField, title)` | 面积图 — 趋势+总量 |
| `generate_radar_chart(data, xField, yField, title)` | 雷达图 — 多维对比 |
| `generate_scatter_chart(data, xField, yField, title)` | 散点图 — 变量关系 |
| `generate_heatmap_chart(data, xField, yField, seriesField, title)` | 热力图 — 数据密度 |
| `generate_histogram_chart(data, xField, title)` | 直方图 — 数据分布 |

**data 参数格式：**
```json
[
  {"category": "A", "value": 100},
  {"category": "B", "value": 200}
]
```

图表工具返回图片 URL。

## 📋 前置依赖说明
如果 user_msg 中包含 `## 用户上下文` 等来源的内容，那是之前 Agent 已产出的前置结果。请直接在此基础上继续你的工作：
- **已提供的数据内容**：直接用于图表生成，不要编造替代数据
- **缺失的信息**：在你的专业范围内补充

## 输出格式

**⚠️ 重要：你必须逐字输出 `TOOL_CALL:` 命令来调用工具。只描述"我要调用 XX"不会执行任何操作。**

**工具调用输出：**
```
TOOL_CALL: 工具名
{"key": "value"}
```

**完成输出：**
```
FINAL_RESULT: [{"type": "image", "path": "...", "title": "..."}]
```

一次只做一个动作，不要混合 TOOL_CALL 和 FINAL_RESULT。"""


TOOL_AGENT_SYSTEM_PROMPT = PPT_AGENT_SYSTEM_PROMPT

# ── Function Calling 工具 Schema ──────────────────────────────

CHART_TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "generate_bar_chart",
            "description": "柱状图 — 分类数据比较",
            "parameters": {
                "type": "object",
                "properties": {
                    "data": {
                        "type": "array",
                        "items": {"type": "object"},
                        "description": "数据数组，每项包含 category 和 value 等字段"
                    },
                    "xField": {"type": "string", "description": "X 轴字段名"},
                    "yField": {"type": "string", "description": "Y 轴字段名"},
                    "title": {"type": "string", "description": "图表标题"}
                },
                "required": ["data", "xField", "yField", "title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_line_chart",
            "description": "折线图 — 趋势变化展示",
            "parameters": {
                "type": "object",
                "properties": {
                    "data": {
                        "type": "array",
                        "items": {"type": "object"},
                        "description": "数据数组"
                    },
                    "xField": {"type": "string"},
                    "yField": {"type": "string"},
                    "seriesField": {"type": "string", "description": "系列分组字段（可选）"},
                    "title": {"type": "string"}
                },
                "required": ["data", "xField", "yField", "title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_pie_chart",
            "description": "饼图 — 占比展示",
            "parameters": {
                "type": "object",
                "properties": {
                    "data": {
                        "type": "array",
                        "items": {"type": "object"},
                        "description": "数据数组"
                    },
                    "angleField": {"type": "string", "description": "角度数值字段"},
                    "colorField": {"type": "string", "description": "分类字段"},
                    "title": {"type": "string"}
                },
                "required": ["data", "angleField", "colorField", "title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_column_chart",
            "description": "条形图 — 垂直比较",
            "parameters": {
                "type": "object",
                "properties": {
                    "data": {"type": "array", "items": {"type": "object"}},
                    "xField": {"type": "string"},
                    "yField": {"type": "string"},
                    "title": {"type": "string"}
                },
                "required": ["data", "xField", "yField", "title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_area_chart",
            "description": "面积图 — 趋势+总量展示",
            "parameters": {
                "type": "object",
                "properties": {
                    "data": {"type": "array", "items": {"type": "object"}},
                    "xField": {"type": "string"},
                    "yField": {"type": "string"},
                    "seriesField": {"type": "string", "description": "系列分组字段"},
                    "title": {"type": "string"}
                },
                "required": ["data", "xField", "yField", "title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_radar_chart",
            "description": "雷达图 — 多维对比",
            "parameters": {
                "type": "object",
                "properties": {
                    "data": {"type": "array", "items": {"type": "object"}},
                    "xField": {"type": "string"},
                    "yField": {"type": "string"},
                    "seriesField": {"type": "string"},
                    "title": {"type": "string"}
                },
                "required": ["data", "xField", "yField", "title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_scatter_chart",
            "description": "散点图 — 变量关系",
            "parameters": {
                "type": "object",
                "properties": {
                    "data": {"type": "array", "items": {"type": "object"}},
                    "xField": {"type": "string"},
                    "yField": {"type": "string"},
                    "title": {"type": "string"}
                },
                "required": ["data", "xField", "yField", "title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_heatmap_chart",
            "description": "热力图 — 数据密度",
            "parameters": {
                "type": "object",
                "properties": {
                    "data": {"type": "array", "items": {"type": "object"}},
                    "xField": {"type": "string"},
                    "yField": {"type": "string"},
                    "seriesField": {"type": "string"},
                    "title": {"type": "string"}
                },
                "required": ["data", "xField", "yField", "title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_histogram_chart",
            "description": "直方图 — 数据分布",
            "parameters": {
                "type": "object",
                "properties": {
                    "data": {"type": "array", "items": {"type": "object"}},
                    "xField": {"type": "string"},
                    "title": {"type": "string"}
                },
                "required": ["data", "xField", "title"]
            }
        }
    },
]

DOC_TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "generate_pdf",
            "description": "生成 PDF 文档（支持 Markdown 格式，支持嵌入图片）",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "文档标题"},
                    "content": {"type": "string", "description": "文档内容（Markdown 格式）"},
                    "filename": {"type": "string", "description": "输出文件名（可选，不含路径）"}
                },
                "required": ["title", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_docx",
            "description": "生成 DOCX 文档（支持 Markdown 格式，支持嵌入图片）",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "content": {"type": "string", "description": "文档内容（Markdown 格式）"},
                    "filename": {"type": "string"}
                },
                "required": ["title", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_image",
            "description": "文生图（用于生成文档配图）",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "图片描述提示词"},
                    "mode": {"type": "string", "enum": ["single", "group"], "description": "单图或组图"},
                    "count": {"type": "integer", "description": "生成数量（仅 group 模式）"},
                    "size": {"type": "string", "description": "图片尺寸，如 1024x1024"}
                },
                "required": ["prompt"]
            }
        }
    },
]

PPT_TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "create_pptx_project",
            "description": "创建 PPT 项目，返回 project_path",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "PPT 标题"},
                    "content": {"type": "string", "description": "内容摘要"}
                },
                "required": ["title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "save_project_file",
            "description": "保存设计文件到项目",
            "parameters": {
                "type": "object",
                "properties": {
                    "project_path": {"type": "string", "description": "项目路径"},
                    "filename": {"type": "string", "description": "文件名，如 design_spec.md"},
                    "content": {"type": "string", "description": "文件内容"}
                },
                "required": ["project_path", "filename", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_skill_reference",
            "description": "读取 PPT 设计参考文档",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "参考文档路径"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_template_layout",
            "description": "读取模板布局 SVG",
            "parameters": {
                "type": "object",
                "properties": {
                    "project_path": {"type": "string"},
                    "layout_name": {"type": "string"}
                },
                "required": ["project_path", "layout_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_image",
            "description": "文生图，用于生成 PPT 配图",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "图片描述提示词"},
                    "mode": {"type": "string", "enum": ["single", "group"]},
                    "count": {"type": "integer"},
                    "size": {"type": "string"}
                },
                "required": ["prompt"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "image_search",
            "description": "在互联网搜索开放许可图片并下载",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "project_path": {"type": "string"},
                    "filename": {"type": "string"},
                    "orientation": {"type": "string", "enum": ["landscape", "portrait", "square"]}
                },
                "required": ["query", "project_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "save_pptx_image",
            "description": "把生成的图片复制到项目 images/ 目录",
            "parameters": {
                "type": "object",
                "properties": {
                    "project_path": {"type": "string"},
                    "image_path": {"type": "string"}
                },
                "required": ["project_path", "image_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "save_svg_page",
            "description": "保存一页 SVG 到项目",
            "parameters": {
                "type": "object",
                "properties": {
                    "project_path": {"type": "string"},
                    "page_num": {"type": "integer", "description": "页码（从1开始）"},
                    "svg_content": {"type": "string", "description": "SVG 代码内容"}
                },
                "required": ["project_path", "page_num", "svg_content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_svg_page",
            "description": "读取已保存的 SVG 内容",
            "parameters": {
                "type": "object",
                "properties": {
                    "project_path": {"type": "string"},
                    "page_num": {"type": "integer"}
                },
                "required": ["project_path", "page_num"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "save_notes",
            "description": "保存讲稿/大纲到项目",
            "parameters": {
                "type": "object",
                "properties": {
                    "project_path": {"type": "string"},
                    "notes_content": {"type": "string"}
                },
                "required": ["project_path", "notes_content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "export_pptx",
            "description": "导出 PPTX 文件",
            "parameters": {
                "type": "object",
                "properties": {
                    "project_path": {"type": "string"},
                    "transition": {"type": "string", "description": "过渡动画"},
                    "animation": {"type": "string", "description": "元素动画"},
                    "animation_trigger": {"type": "string"},
                    "auto_advance": {"type": "integer"}
                },
                "required": ["project_path"]
            }
        }
    },
]

AGENT_TO_TOOLS = {
    "chart": CHART_TOOLS_SCHEMA,
    "document": DOC_TOOLS_SCHEMA,
    "pdf": DOC_TOOLS_SCHEMA,
    "docx": DOC_TOOLS_SCHEMA,
    "presentation": PPT_TOOLS_SCHEMA,
    "pptx": PPT_TOOLS_SCHEMA,
    "general": [],
}


class ToolAgent:
    # 类级别共享 — 所有分身共用同一组 MCP 进程
    _mcp_process: Optional[subprocess.Popen] = None
    _start_lock = threading.Lock()
    _open_source_mcps: dict = {}
    _available_skills: Dict[str, dict] = {}

    def __init__(self):
        pass

    async def start(self):
        if ToolAgent._mcp_process is not None:
            return
        if not ToolAgent._start_lock.acquire(blocking=False):
            return  # 已在启动中
        try:
            logger.info("启动 MCP Server...")
            try:
                ToolAgent._mcp_process = subprocess.Popen(
                    [sys.executable, "-m", "app.mcp.server"],
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
            except Exception as e:
                logger.warning(f"MCP Server 启动失败: {e}")

            temp_dir = Path("./temp/mcp_output")
            temp_dir.mkdir(parents=True, exist_ok=True)
            import os
            backend_dir = Path(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
            node_bin = backend_dir / "node_modules" / ".bin"
            for name, bin_name in [("filesystem", "mcp-server-filesystem.cmd"), ("puppeteer", "mcp-server-puppeteer.cmd")]:
                binary = node_bin / bin_name
                if binary.exists():
                    try:
                        proc = subprocess.Popen([str(binary), str(temp_dir)] if name == "filesystem" else [str(binary)],
                                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        ToolAgent._open_source_mcps[name] = proc
                    except Exception as e:
                        logger.warning(f"{name} MCP 启动失败: {e}")

            ppt_skill_dir = _get_ppt_master_skill_dir()
            if ppt_skill_dir:
                ToolAgent._available_skills["ppt-master"] = {"name": "ppt-master", "description": "PPTX 生成", "skill_dir": str(ppt_skill_dir)}
        finally:
            ToolAgent._start_lock.release()

    async def stop(self):
        for proc in ToolAgent._open_source_mcps.values():
            try:
                proc.terminate()
            except Exception:
                pass
        ToolAgent._open_source_mcps.clear()
        if ToolAgent._mcp_process:
            ToolAgent._mcp_process.terminate()
            ToolAgent._mcp_process = None

    async def execute(self, input_data: DispatchInput, ws_send: Optional[Callable[[dict], Awaitable[None]]] = None, task_id: str = "", user_id: int = 0, user_context: str = "", system_prompt: str = "") -> DispatchResult:
        logger.info(f"ToolAgent LLM 循环启动, {len(input_data.specs)} specs")

        local_task_id = task_id or uuid.uuid4().hex[:8]
        self._current_task_id = task_id
        self._current_user_id = user_id
        current_project_path: Optional[Path] = None

        specs_text = "\n".join(
            f"- {s.agent_id}: {s.requirements} ({s.artifact_type})" for s in input_data.specs
        )

        specs_detail = "\n\n".join(
            f"## {s.agent_id}\n需求: {s.requirements}\n产出: {s.output}" for s in input_data.specs
        )

        context_section = f"\n\n## 用户上下文\n{user_context}" if user_context else ""

        user_msg = (
            f"## 任务\n{specs_text}\n\n"
            f"## 各 Agent 产出详情\n{specs_detail}{context_section}\n\n"
            '请严格按照以下格式调用工具生成产物。\n\n'
            '工具调用示例：\n'
            'TOOL_CALL: 工具名\n'
            '{"参数1": "值1", "参数2": "值2"}\n\n'
            '完成时输出：\n'
            'FINAL_RESULT: [{"type": "...", "path": "...", "title": "..."}]'
        )

        system_prompt_text = system_prompt or TOOL_AGENT_SYSTEM_PROMPT
        # 根据 artifact_type 或 agent_id 自动选择正确的系统提示词
        if not system_prompt and input_data.specs:
            for s in input_data.specs:
                t = s.artifact_type
                aid = s.agent_id or ""
                if t in ("pdf", "docx", "document") or "pdf" in aid or "doc" in aid:
                    system_prompt_text = DOC_AGENT_SYSTEM_PROMPT
                    break
                elif t == "chart" or "chart" in aid:
                    system_prompt_text = CHART_AGENT_SYSTEM_PROMPT
                    break
                elif t == "presentation" or "ppt" in aid:
                    system_prompt_text = PPT_AGENT_SYSTEM_PROMPT
                    break

        messages = [
            {"role": "system", "content": system_prompt_text},
            {"role": "user", "content": user_msg},
            {"role": "assistant", "content": "好的，我每次只做一步，严格按照输出格式。\n\nTOOL_CALL: generate_bar_chart\n{\"data\": [{\"category\": \"A\", \"value\": 100}], \"xField\": \"category\", \"yField\": \"value\", \"title\": \"示例\"}"},
        ]

        if ws_send:
            await ws_send({"type": "toolagent_thinking", "task_id": local_task_id, "content": "📋 开始分析任务内容..."})

        # 推断任务类型并发送 start 事件
        task_title = "任务执行"
        task_type = "general"
        if input_data.specs:
            types = [s.artifact_type for s in input_data.specs if s.artifact_type]
            agents = [s.agent_id for s in input_data.specs if s.agent_id]
            if "presentation" in types or "pptx" in types or any("ppt" in (a or "") for a in agents):
                task_title = "PPT 生成"
                task_type = "presentation"
            elif "document" in types or "docx" in types or "pdf" in types or any("word" in (a or "") for a in agents):
                task_title = "文档生成"
                task_type = "document"
            elif "chart" in types or "image" in types or any("chart" in (a or "") for a in agents):
                task_title = "图表生成"
                task_type = "chart"
            else:
                task_title = f"任务执行 ({len(input_data.specs)} 项)"
        if ws_send:
            await ws_send({"type": "toolagent_start", "task_id": local_task_id, "title": task_title, "task_type": task_type})

        artifacts: list[ArtifactResult] = []
        iteration = 0

        async def push_thinking(text: str):
            if ws_send:
                await ws_send({"type": "toolagent_thinking", "task_id": local_task_id, "content": text})

        async def push_state(state: str, extra: dict = None):
            if ws_send:
                msg = {"type": "toolagent_state", "task_id": local_task_id, "state": state}
                if extra:
                    msg.update(extra)
                await ws_send(msg)

        # 确定工具描述列表（Function Calling 用）
        tools_list = AGENT_TO_TOOLS.get(task_type, []) if task_type != "general" else []
        if not tools_list and input_data.specs:
            for s in input_data.specs:
                t = s.artifact_type
                aid = s.agent_id or ""
                if t in AGENT_TO_TOOLS:
                    tools_list = AGENT_TO_TOOLS[t]
                    break
                for key in AGENT_TO_TOOLS:
                    if key in aid:
                        tools_list = AGENT_TO_TOOLS[key]
                        break
                if tools_list:
                    break

        while True:
            iteration += 1
            print(f"  [tool_loop] 第{iteration}轮 LLM 调用...", flush=True)
            logger.info(f"[tool_loop {local_task_id}] 第{iteration}轮 LLM 调用")
            await push_thinking(f"🔄 第{iteration}轮：正在思考下一步...")

            response = ""
            try:
                stream_kwargs = {"temperature": 0.2}
                async for chunk in ai_request_manager.make_request_stream(
                    request_id=f"toolagent_{local_task_id}_{iteration}",
                    messages=messages,
                    model="deepseek-v4-flash",
                    **stream_kwargs
                ):
                    if chunk["type"] == "reasoning":
                        pass  # 忽略推理内容，不发送前端减少噪音
                    elif chunk["type"] == "token":
                        response += chunk["content"]
                    elif chunk["type"] == "done":
                        break
            except Exception as e:
                logger.error(f"[tool_loop {local_task_id}] LLM 流式调用失败: {e}")
                await push_thinking(f"❌ LLM 调用失败: {e}")
                break

            if not response.strip():
                max_retries = 3
                retry_count = 0
                while retry_count < max_retries:
                    retry_count += 1
                    logger.warning(f"[tool_loop {local_task_id}] LLM 第{iteration}轮返回为空，第{retry_count}次重试...")
                    await push_thinking(f"🔄 LLM 返回为空，第{retry_count}/{max_retries}次重试...")
                    retry_response = ""
                    try:
                        async for chunk in ai_request_manager.make_request_stream(
                            request_id=f"toolagent_{local_task_id}_{iteration}_retry{retry_count}",
                            messages=messages + [{"role": "user", "content": "请重新生成回复。之前返回为空，请直接输出工具调用或结果内容。"}],
                            model="deepseek-v4-flash",
                            **stream_kwargs
                        ):
                            if chunk["type"] == "token":
                                retry_response += chunk["content"]
                            elif chunk["type"] == "done":
                                break
                    except Exception as e:
                        logger.error(f"[tool_loop {local_task_id}] LLM 第{retry_count}次重试也失败: {e}")
                        if retry_count >= max_retries:
                            await push_thinking(f"❌ LLM 调用失败 (已重试{max_retries}次): {e}")
                            break
                        continue
                    if retry_response.strip():
                        response = retry_response.strip()
                        logger.info(f"[tool_loop {local_task_id}] LLM 第{retry_count}次重试成功，返回{len(response)}字符")
                        break
                    if retry_count >= max_retries:
                        logger.warning(f"[tool_loop {local_task_id}] LLM 重试{max_retries}次后仍无返回，结束")
                        await push_thinking("⚠️ LLM 多次重试后仍无返回，结束")
                        break
                if not response.strip():
                    break

            response = response.strip()
            safe_preview = response[:300].encode('gbk', errors='replace').decode('gbk')
            print(f"  [tool_loop] LLM 第{iteration}轮返回({len(response)}字符): {safe_preview}", flush=True)
            logger.info(f"[tool_loop {local_task_id}] LLM 返回({len(response)}字符): {response[:500]}")

            # 文本 TOOL_CALL 解析
            tool_calls_list = []
            remaining = response
            while True:
                m = re.search(r"TOOL_CALL:\s*(\w+)", remaining)
                if not m:
                    break
                name = m.group(1)
                after_part = remaining[m.end():]
                json_start = after_part.find("{")
                json_end = after_part.rfind("}")
                if json_start >= 0 and json_end > json_start:
                    try:
                        params = json.loads(after_part[json_start:json_end + 1])
                        end_pos = m.end() + json_end + 1
                        tool_calls_list.append((name, params))
                        remaining = remaining[end_pos:]
                        continue
                    except json.JSONDecodeError:
                        remaining = remaining[m.end() + 1:]
                        continue
                remaining = remaining[m.end() + 1:]

            if not tool_calls_list:
                for known_tool in ["generate_bar_chart", "generate_line_chart", "generate_pie_chart",
                                    "generate_pdf", "generate_docx", "create_pptx_project",
                                    "save_svg_page", "generate_image", "export_pptx"]:
                    if known_tool in response and known_tool not in [t[0] for t in tool_calls_list]:
                        tool_calls_list.append((known_tool, {"auto_extracted": True}))

            if tool_calls_list:
                tool_results = []
                for tool_idx, (tool_name, tool_params) in enumerate(tool_calls_list):
                    tool_desc = f"调用工具: {tool_name}"
                    if tool_name == "create_pptx_project":
                        title = tool_params.get("title", "")
                        tool_desc = f"创建项目: {title}"
                    elif tool_name == "save_svg_page":
                        page = tool_params.get("page_num", 0)
                        tool_desc = f"生成第 {page} 页 SVG"
                    elif tool_name == "generate_image":
                        tool_desc = f"生成配图..."
                    elif tool_name == "save_project_file":
                        fn = tool_params.get("filename", "")
                        tool_desc = f"保存设计文件: {fn}"
                    elif tool_name == "read_skill_reference":
                        tool_desc = f"阅读参考文档: {tool_params.get('path', '')}"
                    elif tool_name == "export_pptx":
                        tool_desc = f"导出 PPTX..."

                    print(f"  [tool_loop] [{tool_idx+1}/{len(tool_calls_list)}] {tool_name}", flush=True)
                    logger.info(f"[tool_loop {local_task_id}] 调用工具[{tool_idx+1}/{len(tool_calls_list)}]: {tool_name}")
                    await push_thinking(f"调用工具: {tool_name}")

                    # 向前端发送产物生成中提示（已知会产生产物的工具）
                    _artifact_tools = {"export_pptx", "generate_pdf", "generate_docx",
                                       "generate_image", "generate_bar_chart", "generate_line_chart",
                                       "generate_pie_chart"}
                    if tool_name in _artifact_tools and ws_send:
                        pending_title = tool_params.get("title", "") or tool_params.get("filename", "") or tool_name
                        await ws_send({
                            "type": "toolagent_artifact_pending",
                            "task_id": local_task_id,
                            "tool_name": tool_name,
                            "title": pending_title,
                        })

                    try:
                        result_json, current_project_path = await self._call_tool(tool_name, tool_params, ws_send, local_task_id, current_project_path)
                        result_data = json.loads(result_json) if isinstance(result_json, str) else result_json
                        result_str = json.dumps(result_data, ensure_ascii=False)

                        # 前端渲染模式：发送 client_render 事件（HTML 内联）
                        if result_data.get("needsClientRender") and ws_send:
                            from datetime import datetime, timedelta
                            await ws_send({
                                "type": "toolagent_client_render",
                                "task_id": local_task_id,
                                "render_id": result_data.get("render_id", ""),
                                "composition_id": result_data.get("composition_id", "main"),
                                "width": result_data.get("width", 1920),
                                "height": result_data.get("height", 1080),
                                "duration": result_data.get("duration", 10),
                                "title": result_data.get("title", "视频"),
                                "html": result_data.get("html", ""),
                                "tool_name": tool_name,
                                "expires_at": (datetime.now() + timedelta(hours=24)).isoformat(),
                            })

                        artifact = self._check_artifact(tool_name, result_json)
                        if artifact:
                            artifacts.append(artifact)
                            await self._save_artifact_to_db(artifact)
                            if ws_send:
                                from datetime import datetime, timedelta
                                await ws_send({
                                    "type": "toolagent_file_artifact",
                                    "task_id": local_task_id,
                                    "artifact_type": artifact.type,
                                    "path": artifact.path,
                                    "title": artifact.title,
                                    "filename": Path(artifact.path).name,
                                    "tool_name": tool_name,
                                    "expires_at": (datetime.now() + timedelta(hours=24)).isoformat(),
                                })

                        tool_results.append((tool_name, result_str))
                    except Exception as e:
                        logger.error(f"[tool_loop {local_task_id}] 工具 {tool_name} 失败: {e}")
                        await push_thinking(f"❌ {tool_name} 失败: {e}")
                        tool_results.append((tool_name, f"[错误] {e}"))
                        if ws_send:
                            await ws_send({
                                "type": "toolagent_error",
                                "task_id": local_task_id,
                                "tool_name": tool_name,
                                "error": str(e),
                            })

                messages.append({"role": "assistant", "content": response})
                for tool_name, result_str in tool_results:
                    messages.append({"role": "user", "content": f"工具 {tool_name} 返回: {result_str}"})

                continue

            # 无 TOOL_CALL，检查 DESIGN_CONFIRM
            design_match = re.search(r"DESIGN_CONFIRM:\s*(\{.*?\})", response, re.DOTALL)
            if design_match:
                print(f"  [tool_loop] Strategist 设计完成, 共{iteration}轮", flush=True)
                logger.info(f"[tool_loop {local_task_id}] Strategist 设计完成")

                design_raw = design_match.group(1)
                try:
                    design_obj = json.loads(design_raw)
                    if ws_send:
                        await ws_send({
                            "type": "toolagent_design_spec",
                            "spec": design_obj,
                        })
                except json.JSONDecodeError:
                    pass

                await push_thinking("📋 设计规范已完成，等待用户确认...")

                async def wait_design_feedback() -> str:
                    if not ws_send:
                        return "/export"
                    if os.environ.get("AUTO_CONFIRM_TOOLAGENT", "").lower() in ("1", "true", "yes"):
                        return "/export"
                    await push_state("waiting_feedback")
                    input_queue = asyncio.Queue()
                    set_input_queue(local_task_id, input_queue)
                    try:
                        return await asyncio.wait_for(input_queue.get(), timeout=600)
                    except asyncio.TimeoutError:
                        return "/export"
                    finally:
                        remove_input_queue(local_task_id)

                user_feedback = await wait_design_feedback()
                if user_feedback.startswith("/export") or user_feedback.startswith("/done"):
                    await push_thinking("✅ 设计已确认，继续执行后续阶段...")
                    messages.append({"role": "user", "content": "设计已确认，请继续按流程执行后续阶段：模板继承（可选）、配图管理、图标引用、大纲拟定、逐页生成 SVG、导出 PPTX。"})
                else:
                    await push_thinking(f"💬 收到设计修改意见，调整设计文件...")
                    messages.append({"role": "user", "content": f"用户对设计提出修改意见，请根据意见调整 design_spec.md / spec_lock.md：\n{user_feedback}"})

                messages.append({"role": "assistant", "content": response})
                continue

            # 无 TOOL_CALL/DESIGN_CONFIRM，检查 FINAL_RESULT
            final_match = re.search(r"FINAL_RESULT:\s*(\[.*?\]|\{.*\})", response, re.DOTALL)
            if final_match:
                print(f"  [tool_loop] LLM 完成, 共{iteration}轮", flush=True)
                logger.info(f"[tool_loop {local_task_id}] LLM 完成, 共{iteration}轮")
                await push_thinking("✅ PPT 内容生成完成，等待用户确认...")
                try:
                    final = json.loads(final_match.group(1))
                    if isinstance(final, list):
                        for item in final:
                            artifacts.append(ArtifactResult(**item))
                            await self._save_artifact_to_db(ArtifactResult(**item))
                    elif isinstance(final, dict):
                        artifacts.append(ArtifactResult(**final))
                        await self._save_artifact_to_db(ArtifactResult(**final))
                except (json.JSONDecodeError, TypeError, Exception) as e:
                    logger.warning(f"FINAL_RESULT 解析失败: {e}")

                if ws_send and current_project_path:
                    await push_state("preview_ready", {"project_path": str(current_project_path)})
                    if os.environ.get("AUTO_CONFIRM_TOOLAGENT", "").lower() in ("1", "true", "yes"):
                        user_feedback = "/export"
                    else:
                        await push_state("waiting_feedback")

                        input_queue = asyncio.Queue()
                        set_input_queue(local_task_id, input_queue)
                        try:
                            user_feedback = await asyncio.wait_for(input_queue.get(), timeout=600)
                        except asyncio.TimeoutError:
                            user_feedback = "/export"
                        finally:
                            remove_input_queue(local_task_id)

                    if user_feedback.startswith("/export") or user_feedback.startswith("/done"):
                        await push_thinking("正在生成 PPTX...")
                        try:
                            from app.mcp.tools.pptx_pipeline import export_pptx, cleanup_project
                            export_result = await export_pptx({"project_path": str(current_project_path)})
                            export_data = json.loads(export_result)
                        except Exception as e:
                            logger.error(f"PPTX 导出失败: {e}")
                            await push_thinking(f"PPTX 导出失败: {e}")
                            export_data = {"success": False}
                        finally:
                            try:
                                clean_result = cleanup_project(str(current_project_path))
                                pptx_path = clean_result.get("pptx_path", "")
                            except Exception as ce:
                                logger.warning(f"清理项目目录失败: {ce}")
                                pptx_path = ""

                        final_name = Path(pptx_path).name if pptx_path else ""
                        if pptx_path:
                            from pathlib import Path as PPath
                            _OUTPUT_BASE = PPath(__file__).resolve().parent.parent.parent / "_output"
                            try:
                                output_rel = PPath(pptx_path).relative_to(_OUTPUT_BASE)
                                output_url = f"/api/v1/image/output/{output_rel.as_posix()}"
                            except ValueError:
                                output_url = str(pptx_path)
                            await push_state("export_done", {"pptx_path": pptx_path, "filename": final_name})
                            artifacts.append(ArtifactResult(type="pptx", path=output_url, title="PPT 演示文稿"))
                            await self._save_artifact_to_db(ArtifactResult(type="pptx", path=output_url, title="PPT 演示文稿"))
                            if ws_send:
                                from datetime import datetime, timedelta
                                await ws_send({
                                    "type": "toolagent_file_artifact",
                                    "task_id": local_task_id,
                                    "artifact_type": "pptx",
                                    "path": output_url,
                                    "title": "PPT 演示文稿",
                                    "filename": final_name,
                                    "tool_name": "export_pptx",
                                    "expires_at": (datetime.now() + timedelta(hours=24)).isoformat(),
                                })
                        else:
                            logger.warning(f"PPTX 未生成，项目已清理")
                            await push_thinking("PPTX 未生成，项目中间文件已清理")
                    else:
                        await push_thinking(f"💬 收到用户反馈，继续修改...")
                        messages.append({"role": "user", "content": f"用户看了预览后提出以下修改意见，请根据意见修改 SVG：\n{user_feedback}"})
                        continue

                break

            # LLM 输出不匹配任何格式 → 发送矫正指令，继续循环
            await push_thinking(f"💡 正在引导 LLM 输出正确格式...")
            correction = (
                '你的回复没有以 TOOL_CALL: 开头。请严格按以下格式输出：\n\n'
                '要调用工具时，一次只输出一行 TOOL_CALL + JSON：\n\n'
                'TOOL_CALL: generate_bar_chart\n'
                '{"data": [...], "xField": "...", "yField": "...", "title": "..."}\n\n'
                '全部工作完成时：\n'
                'FINAL_RESULT: [{"type": "image", "path": "...", "title": "..."}]\n\n'
                '不要输出任何说明文字。不要自然语言描述"我要调用XX"。必须逐字输出 TOOL_CALL: 命令代码才会执行。'
            )
            messages.append({"role": "user", "content": correction})
            continue

        summary_text = f"ToolAgent 通过 LLM 循环完成了 {len(artifacts)} 个产物，共 {iteration} 轮调用"
        return DispatchResult(artifacts=artifacts, summary=summary_text)

    async def _call_tool(self, name: str, params: dict, ws_send: Optional[Callable[[dict], Awaitable[None]]] = None, local_task_id: str = "", current_project_path: Optional[Path] = None) -> tuple:
        if name == "create_pptx_project":
            from app.mcp.tools.pptx_pipeline import create_pptx_project
            result = await create_pptx_project(params)
            try:
                data = json.loads(result)
                if data.get("project_path"):
                    current_project_path = Path(data["project_path"])
                    if ws_send:
                        await ws_send({"type": "toolagent_preview", "task_id": local_task_id, "project_path": str(current_project_path), "action": "project_created"})
            except Exception:
                pass
            return result, current_project_path
        elif name == "save_project_file":
            from app.mcp.tools.pptx_pipeline import save_project_file
            return await save_project_file(params), current_project_path
        elif name == "read_skill_reference":
            from app.mcp.tools.pptx_pipeline import read_skill_reference
            return await read_skill_reference(params), current_project_path
        elif name == "read_template_layout":
            from app.mcp.tools.pptx_pipeline import read_template_layout
            return await read_template_layout(params), current_project_path
        elif name == "read_svg_page":
            from app.mcp.tools.pptx_pipeline import read_svg_page
            return await read_svg_page(params), current_project_path
        elif name == "save_svg_page":
            from app.mcp.tools.pptx_pipeline import save_svg_page
            result = await save_svg_page(params)
            if ws_send and current_project_path:
                try:
                    data = json.loads(result)
                    if data.get("success"):
                        await ws_send({"type": "toolagent_preview", "task_id": local_task_id, "project_path": str(current_project_path), "action": "svg_saved", "page_num": data.get("page", 0), "total_pages": data.get("total_pages", 0)})
                except Exception:
                    pass
            return result, current_project_path
        elif name == "save_notes":
            from app.mcp.tools.pptx_pipeline import save_notes
            return await save_notes(params), current_project_path
        elif name == "export_pptx":
            return json.dumps({"success": True, "pptx_path": "", "deferred": True, "message": "等待用户确认后导出"}), current_project_path
        elif name == "save_pptx_image":
            from app.mcp.tools.pptx_pipeline import save_pptx_image
            return await save_pptx_image(params), current_project_path
        elif name == "image_search":
            from app.mcp.tools.image_search import image_search
            return await image_search(params), current_project_path
        elif name == "generate_pdf":
            from app.mcp.tools.generate_pdf import generate_pdf
            result = await generate_pdf(params)
            return json.dumps({"success": True, "file_path": result, "tool": name}, ensure_ascii=False), current_project_path
        elif name == "generate_docx":
            from app.mcp.tools.generate_docx import generate_docx
            result = await generate_docx(params)
            return json.dumps({"success": True, "file_path": result, "tool": name}, ensure_ascii=False), current_project_path
        elif name == "generate_image":
            from app.mcp.tools.generate_image import generate_image
            return await generate_image(params), current_project_path
        elif name.startswith("generate_") and name.endswith("_chart"):
            from app.mcp.tools.chart_antv import CHART_TOOLS
            info = CHART_TOOLS.get(name)
            if not info:
                raise ValueError(f"未知图表工具: {name}")
            result = await info["func"](**params)
            return json.dumps({"success": True, "url": result, "tool": name}, ensure_ascii=False), current_project_path
        else:
            raise ValueError(f"未知工具: {name}")

    async def _save_artifact_to_db(self, artifact: ArtifactResult):
        if not self._current_task_id or not self._current_user_id:
            return
        try:
            from app.db.session import SessionLocal
            from app.models.agent import ArtifactRecord
            from datetime import datetime, timedelta
            db = SessionLocal()
            try:
                record = ArtifactRecord(
                    task_id=self._current_task_id,
                    user_id=self._current_user_id,
                    artifact_type=artifact.type,
                    path=artifact.path,
                    title=artifact.title,
                    filename=Path(artifact.path).name if artifact.path else None,
                    expires_at=datetime.now() + timedelta(hours=24),
                )
                db.add(record)
                db.commit()
            except Exception as e:
                logger.warning(f"保存产物到 DB 失败: {e}")
            finally:
                db.close()
        except Exception:
            pass

    def _check_artifact(self, tool_name: str, result_json: str) -> Optional[ArtifactResult]:
        try:
            data = json.loads(result_json) if isinstance(result_json, str) else result_json
        except (json.JSONDecodeError, TypeError):
            return None

        if tool_name == "export_pptx" and data.get("success"):
            pptx_path = data.get("pptx_path", "")
            if pptx_path and Path(pptx_path).exists():
                return ArtifactResult(type="pptx", path=pptx_path, title="PPT 演示文稿")

        if tool_name == "generate_pdf":
            path = data.get("file_path") or data.get("pdf_path") or data.get("path", "")
            if path and Path(path).exists():
                fname = Path(path).name
                return ArtifactResult(type="pdf", path=path, title=fname)

        if tool_name == "generate_docx":
            path = data.get("file_path") or data.get("docx_path") or data.get("path", "")
            if path and Path(path).exists():
                fname = Path(path).name
                return ArtifactResult(type="docx", path=path, title=fname)

        if tool_name == "generate_image" and data.get("success") and data.get("images"):
            return ArtifactResult(type="image", path=data["images"][0], title="生成图片")

        if tool_name.endswith("_chart") and data.get("success") and data.get("url"):
            chart_type = tool_name.replace("generate_", "").replace("_chart", "")
            chart_names = {
                "line": "折线图", "bar": "柱状图", "column": "条形图",
                "pie": "饼图", "area": "面积图", "radar": "雷达图",
                "scatter": "散点图", "funnel": "漏斗图", "heatmap": "热力图",
                "histogram": "直方图", "boxplot": "箱线图", "dual_axes": "双轴图",
                "waterfall": "瀑布图", "grouped_bar": "分组柱状图", "stacked_bar": "堆叠柱状图",
            }
            name = chart_names.get(chart_type, chart_type)
            return ArtifactResult(type="image", path=data["url"], title=name)

        return None

    @property
    def available_skills(self) -> Dict[str, dict]:
        return self._available_skills


tool_agent = ToolAgent()
