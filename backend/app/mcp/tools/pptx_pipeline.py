import os
import re
import json
import logging
import tempfile
import subprocess
import sys
import shutil
from pathlib import Path
from typing import Dict, Any

logger = logging.getLogger(__name__)

_PPT_MASTER_DIR = Path(__file__).resolve().parent.parent.parent.parent / "ppt-master"
_SKILL_DIR = _PPT_MASTER_DIR / "skills" / "ppt-master"
_TEMPLATES_DIR = _SKILL_DIR / "templates"
_REFERENCES_DIR = _SKILL_DIR / "references"
_LAYOUTS_DIR = _TEMPLATES_DIR / "layouts"
_SCRIPTS_DIR = _SKILL_DIR / "scripts"
_PROJECT_MANAGER = _SCRIPTS_DIR / "project_manager.py"
_FINALIZE_SVG = _SCRIPTS_DIR / "finalize_svg.py"
_SVG_TO_PPTX = _SCRIPTS_DIR / "svg_to_pptx.py"
_TOTAL_MD_SPLIT = _SCRIPTS_DIR / "total_md_split.py"
_SVG_QUALITY_CHECKER = _SCRIPTS_DIR / "svg_quality_checker.py"

# 统一输出目录
_OUTPUT_BASE = Path(__file__).resolve().parent.parent.parent / "_output"
_OUTPUT_BASE.mkdir(parents=True, exist_ok=True)


def _build_design_spec(title: str, content: str) -> str:
    return (
        "# Design Specification — " + title + "\n\n"
        "## I. Project Overview\n"
        "- **Title**: " + title + "\n"
        "- **Format**: PPT 16:9 (1280×720)\n"
        "- **Target Audience**: 学习用户\n\n"
        "## II. Style Direction\n"
        "- **Tone**: 专业清晰\n"
        "- **Visual Style**: 简洁现代、信息层级分明\n"
        "- **Color Strategy**: 以蓝色系为主色调\n\n"
        "## III. Color Palette\n"
        "| Role | Hex | Usage |\n"
        "|------|-----|-------|\n"
        "| Primary | #2563EB | 主标题、重点强调 |\n"
        "| Secondary | #3B82F6 | 副标题、图例 |\n"
        "| Accent | #F59E0B | 关键数据高亮 |\n"
        "| Background | #FFFFFF | 幻灯片背景 |\n"
        "| Text Primary | #1E293B | 正文文字 |\n"
        "| Text Secondary | #64748B | 辅助说明 |\n\n"
        "## IV. Typography\n"
        "- **Title**: System Sans-serif, 36-44pt, Bold\n"
        "- **Heading**: System Sans-serif, 24-28pt, Bold\n"
        "- **Body**: System Sans-serif, 16-18pt\n\n"
        "## V. Content Outline\n"
        "见 slide_plan.md\n\n"
        "## VI. Page Rhythm\n"
        "封面 anchor → 内容 dense → 总结 breathing\n"
    )


def _build_spec_lock(title: str) -> str:
    return (
        '{\n'
        '  "project_name": "' + title + '",\n'
        '  "canvas": {"width": 1280, "height": 720, "format": "ppt169"},\n'
        '  "colors": {\n'
        '    "primary": "#2563EB", "secondary": "#3B82F6",\n'
        '    "accent": "#F59E0B", "background": "#FFFFFF",\n'
        '    "text_primary": "#1E293B", "text_secondary": "#64748B"\n'
        '  },\n'
        '  "typography": {"title_size": 40, "heading_size": 26, "body_size": 17, "font_family": "System Sans-serif"},\n'
        '  "icons": {"library": "phosphor", "size": 32},\n'
        '  "animation": "fade", "transition": "fade"\n'
        '}\n'
    )


def _build_slide_plan(title: str, content: str) -> str:
    lines = content.split("\n")
    headings = [l.strip().lstrip("#").strip() for l in lines if l.strip().startswith("##")]
    heading_count = len(headings) if headings else 5
    total_pages = min(heading_count + 2, 12)

    plan = "# 幻灯片计划 — " + title + "\n\n"
    plan += "## 第1页: 封面\n"
    plan += "- 标题: " + title + "\n- 副标题: 学习总结\n- 布局: 全幅居中\n\n"

    if headings:
        for i, h in enumerate(headings[:total_pages - 2], 2):
            plan += "## 第{}页: {}\n".format(i, h)
            plan += "- 展开" + h + "的详细内容\n- 使用卡片/列表布局\n\n"

    last_page = total_pages
    plan += "## 第{}页: 总结\n".format(last_page)
    plan += "- 关键要点回顾\n- 后续建议\n- 布局: 双栏\n"

    return plan


def _run_script(script_path: Path, args: list, timeout: int = 60) -> dict:
    cmd = [sys.executable, str(script_path)] + args
    logger.info(f"执行脚本: {' '.join(cmd)}")
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=timeout, cwd=str(_PPT_MASTER_DIR))
        stdout = result.stdout.decode("utf-8", errors="replace").strip()
        stderr = result.stderr.decode("utf-8", errors="replace").strip()
        return {"success": result.returncode == 0, "stdout": stdout, "stderr": stderr}
    except subprocess.TimeoutExpired:
        return {"success": False, "stdout": "", "stderr": f"超时({timeout}s)"}
    except Exception as e:
        return {"success": False, "stdout": "", "stderr": str(e)}


async def create_pptx_project(params: Dict[str, Any]) -> str:
    """创建 ppt-master 项目，生成目录结构和设计规范文件。

    Args:
        params: {
            "title": "演示文稿标题",
            "content": "Markdown 格式内容",
            "filename": "可选，输出文件名前缀",
            "format": "可选，ppt169(默认)/ppt43",
        }
    Returns:
        JSON: project_path + 各文件路径
    """
    title = params.get("title", "演示文稿")
    content = params.get("content", "")
    filename = params.get("filename", re.sub(r'[\/\\:*?"<>|]', '_', title)[:30])
    canvas_format = params.get("format", "ppt169")

    output_dir = _OUTPUT_BASE
    output_dir.mkdir(parents=True, exist_ok=True)
    project_path = output_dir / f"pptx_{filename}"
    if project_path.exists():
        shutil.rmtree(str(project_path))
    project_path.mkdir(parents=True, exist_ok=True)

    md_path = project_path / "sources" / f"{filename}.md"
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(f"# {title}\n\n{content}", encoding="utf-8")

    _run_script(_PROJECT_MANAGER, ["init", str(project_path.name), "--format", canvas_format, "--dir", str(project_path.parent)])
    _run_script(_PROJECT_MANAGER, ["import-sources", str(project_path), str(md_path), "--move"])

    (project_path / "svg_output").mkdir(parents=True, exist_ok=True)
    (project_path / "notes").mkdir(parents=True, exist_ok=True)

    summary_file = project_path / "_summary.json"
    summary_file.write_text(json.dumps({"title": title, "content": content}, ensure_ascii=False), encoding="utf-8")

    return json.dumps({
        "success": True,
        "project_path": str(project_path),
        "title": title,
        "canvas": "1280x720",
        "available_files": ["design_spec.md", "spec_lock.md", "slide_plan.md", "_summary.json"],
        "dirs": {"svg_output": str(project_path / "svg_output"), "notes": str(project_path / "notes")},
    }, ensure_ascii=False)


async def save_svg_page(params: Dict[str, Any]) -> str:
    """保存一页 SVG 到 ppt-master 项目。

    Args:
        params: {
            "project_path": "项目路径",
            "page_num": 页码（从1开始）,
            "svg_content": "SVG 代码文本",
        }
    Returns:
        JSON: 保存结果
    """
    project_path = Path(params.get("project_path", ""))
    page_num = int(params.get("page_num", 1))
    svg_content = params.get("svg_content", "")

    if not project_path.exists():
        return json.dumps({"success": False, "error": f"项目不存在: {project_path}"}, ensure_ascii=False)
    if not svg_content:
        return json.dumps({"success": False, "error": "svg_content 为空"}, ensure_ascii=False)

    svg_dir = project_path / "svg_output"
    svg_dir.mkdir(parents=True, exist_ok=True)

    svg_path = svg_dir / f"page_{page_num}.svg"
    # 净化 SVG：确保 XML 合法
    import re as _re
    cleaned = svg_content.strip()
    cleaned = _re.sub(r'&(?!(amp|lt|gt|quot|apos|nbsp|#[0-9]+|#x[0-9a-fA-F]+);)', '&amp;', cleaned)
    svg_path.write_text(cleaned, encoding="utf-8")

    return json.dumps({
        "success": True,
        "page": page_num,
        "path": str(svg_path),
        "chars": len(svg_content),
        "total_pages": len(list(svg_dir.glob("*.svg"))),
    }, ensure_ascii=False)


async def read_svg_page(params: Dict[str, Any]) -> str:
    """读取项目中某页 SVG 的内容。

    Args:
        params: {
            "project_path": "项目路径",
            "page_num": 页码（从1开始）,
        }
    Returns:
        JSON: SVG 内容
    """
    project_path = Path(params.get("project_path", ""))
    page_num = int(params.get("page_num", 0))

    if not project_path.exists():
        return json.dumps({"success": False, "error": f"项目不存在: {project_path}"}, ensure_ascii=False)

    svg_dir = project_path / "svg_output"
    svg_path = svg_dir / f"page_{page_num}.svg"

    if not svg_path.exists():
        return json.dumps({"success": False, "error": f"第{page_num}页 SVG 不存在", "available": sorted(p.stem for p in svg_dir.glob("*.svg"))}, ensure_ascii=False)

    content = svg_path.read_text(encoding="utf-8")
    return json.dumps({
        "success": True,
        "page": page_num,
        "content": content,
        "chars": len(content),
    }, ensure_ascii=False)


async def save_notes(params: Dict[str, Any]) -> str:
    """保存讲稿到 ppt-master 项目。

    Args:
        params: {
            "project_path": "项目路径",
            "notes_content": "讲稿内容（每页用 # 第N页：标题 分割）",
        }
    Returns:
        JSON: 保存结果
    """
    project_path = Path(params.get("project_path", ""))
    notes_content = params.get("notes_content", "")

    if not project_path.exists():
        return json.dumps({"success": False, "error": f"项目不存在: {project_path}"}, ensure_ascii=False)

    notes_dir = project_path / "notes"
    notes_dir.mkdir(parents=True, exist_ok=True)

    notes_path = notes_dir / "total.md"
    notes_path.write_text(notes_content, encoding="utf-8")

    return json.dumps({"success": True, "path": str(notes_path)}, ensure_ascii=False)


ALLOWED_PROJECT_FILES = {"design_spec.md", "spec_lock.md", "slide_plan.md"}


async def save_project_file(params: Dict[str, Any]) -> str:
    """保存项目设计文件到 ppt-master 项目（design_spec.md / spec_lock.md / slide_plan.md）。

    由 ToolAgent 的 Strategist 阶段调用，根据内容分析写入定制化的设计文件。

    Args:
        params: {
            "project_path": "项目路径",
            "filename": "文件名（design_spec.md / spec_lock.md / slide_plan.md）",
            "content": "文件内容",
        }
    Returns:
        JSON: 保存结果
    """
    project_path = Path(params.get("project_path", ""))
    filename = params.get("filename", "")
    content = params.get("content", "")

    if not project_path.exists():
        return json.dumps({"success": False, "error": f"项目不存在: {project_path}"}, ensure_ascii=False)
    if filename not in ALLOWED_PROJECT_FILES:
        return json.dumps({"success": False, "error": f"不允许的文件名: {filename}，允许: {sorted(ALLOWED_PROJECT_FILES)}"}, ensure_ascii=False)
    if not content:
        return json.dumps({"success": False, "error": "content 为空"}, ensure_ascii=False)

    file_path = project_path / filename
    file_path.write_text(content, encoding="utf-8")

    return json.dumps({
        "success": True,
        "filename": filename,
        "path": str(file_path),
        "chars": len(content),
    }, ensure_ascii=False)


async def save_pptx_image(params: Dict[str, Any]) -> str:
    """把生成的图片复制到 ppt-master 项目的 images/ 目录，供 SVG 引用。

    Args:
        params: {
            "project_path": "项目路径",
            "image_path": "图片源路径（generate_image 的返回值之一）",
            "filename": "可选，保存文件名（不含扩展名）",
        }
    Returns:
        JSON: 项目内图片路径
    """
    project_path = Path(params.get("project_path", ""))
    image_path = params.get("image_path", "")
    filename = params.get("filename", "")

    if not project_path.exists():
        return json.dumps({"success": False, "error": f"项目不存在: {project_path}"}, ensure_ascii=False)
    if not image_path or not Path(image_path).exists():
        return json.dumps({"success": False, "error": f"图片不存在: {image_path}"}, ensure_ascii=False)

    import shutil
    images_dir = project_path / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    src = Path(image_path)
    if filename:
        dest = images_dir / f"{filename}{src.suffix}"
    else:
        dest = images_dir / src.name

    shutil.copy2(str(src), str(dest))

    return json.dumps({
        "success": True,
        "project_path": str(dest),
        "relative_path": f"images/{dest.name}",
    }, ensure_ascii=False)


SAFE_FILES = {"design_spec.md", "spec_lock.md", "slide_plan.md", "_summary.json", "sources"}

SKILL_REFERENCE_PATHS = {
    "design_spec_reference": _TEMPLATES_DIR / "design_spec_reference.md",
    "spec_lock_reference": _TEMPLATES_DIR / "spec_lock_reference.md",
    "strategist": _REFERENCES_DIR / "strategist.md",
    "shared_standards": _REFERENCES_DIR / "shared-standards.md",
    "executor_base": _REFERENCES_DIR / "executor-base.md",
    "canvas_formats": _REFERENCES_DIR / "canvas-formats.md",
    "animations": _REFERENCES_DIR / "animations.md",
}

LAYOUT_NAMES = sorted(
    d.name for d in _LAYOUTS_DIR.iterdir() if d.is_dir() and (d / "design_spec.md").exists()
)


async def read_skill_reference(params: Dict[str, Any]) -> str:
    """读取技能参考文档、范例或示例。

    可读取：
    ppt-master:
    - design_spec_reference / spec_lock_reference — 设计规范编写指南
    - strategist — Strategist 完整工作流
    - shared_standards — 跨阶段共享标准
    - canvas_formats — 画布格式
    - animations — 动画配置
    - layout:<layout_name> — 读取某个布局模板的 design_spec
    - list_layouts — 列出可用布局模板
    - example:<name> — 读取范例项目的设计文件
    - list_examples — 列出可用范例
    - docs:<path> — 读取 docs 目录下的文档
    - list_docs — 列出可用文档

    Args:
        params: {
            "skill": "ppt-master（默认 ppt-master）",
            "path": "参考文档路径",
        }
    Returns:
        JSON: 文件内容或列表
    """
    skill = params.get("skill", "ppt-master").strip()
    ref_path = params.get("path", "").strip()

    if not ref_path:
        return json.dumps({
            "success": False, "error": "path 必填",
            "available": sorted(SKILL_REFERENCE_PATHS.keys()) + [
                "layout:<name>", "list_layouts",
                "example:<name>", "list_examples",
                "docs:<path>", "list_docs",
            ],
        }, ensure_ascii=False)

    # --- 布局模板 ---
    if ref_path == "list_layouts":
        return json.dumps({"success": True, "layouts": LAYOUT_NAMES, "count": len(LAYOUT_NAMES)}, ensure_ascii=False)

    if ref_path.startswith("layout:"):
        layout_name = ref_path[len("layout:"):].strip()
        layout_spec = _LAYOUTS_DIR / layout_name / "design_spec.md"
        if not layout_spec.exists():
            return json.dumps({
                "success": False, "error": f"布局模板不存在: {layout_name}",
                "available_layouts": LAYOUT_NAMES,
            }, ensure_ascii=False)
        content = layout_spec.read_text(encoding="utf-8")
        return json.dumps({
            "success": True, "path": ref_path, "filename": f"layouts/{layout_name}/design_spec.md",
            "content": content, "chars": len(content),
        }, ensure_ascii=False)

    # --- 范例项目 ---
    _EXAMPLES_DIR = _PPT_MASTER_DIR / "examples"
    if ref_path == "list_examples":
        examples = sorted(
            d.name for d in _EXAMPLES_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")
        ) if _EXAMPLES_DIR.exists() else []
        return json.dumps({"success": True, "examples": examples, "count": len(examples)}, ensure_ascii=False)

    if ref_path.startswith("example:"):
        example_name = ref_path[len("example:"):].strip()
        example_dir = _EXAMPLES_DIR / example_name
        if not example_dir.exists():
            examples = sorted(d.name for d in _EXAMPLES_DIR.iterdir() if d.is_dir()) if _EXAMPLES_DIR.exists() else []
            return json.dumps({
                "success": False, "error": f"范例不存在: {example_name}",
                "available": examples,
            }, ensure_ascii=False)
        # 读取范例的关键设计文件
        result = {"success": True, "example": example_name, "files": {}}
        for key_file in ["design_spec.md", "spec_lock.md", "slide_plan.md"]:
            fp = example_dir / key_file
            if fp.exists():
                result["files"][key_file] = fp.read_text(encoding="utf-8")[:8000]  # 限制长度
        # 列出可用子目录
        subdirs = [d.name for d in example_dir.iterdir() if d.is_dir()]
        if subdirs:
            result["subdirs"] = sorted(subdirs)
        return json.dumps(result, ensure_ascii=False)

    # --- 文档 ---
    _DOCS_DIR = _PPT_MASTER_DIR / "docs"
    if ref_path == "list_docs":
        docs = []
        if _DOCS_DIR.exists():
            for f in _DOCS_DIR.rglob("*"):
                if f.is_file() and f.suffix in (".md", ".txt"):
                    docs.append(str(f.relative_to(_DOCS_DIR)).replace("\\", "/"))
        return json.dumps({"success": True, "docs": sorted(docs), "count": len(docs)}, ensure_ascii=False)

    if ref_path.startswith("docs:"):
        doc_rel = ref_path[len("docs:"):].strip().replace("\\", "/")
        doc_path = _DOCS_DIR / doc_rel
        if not doc_path.exists() or not doc_path.is_file():
            return json.dumps({
                "success": False, "error": f"文档不存在: {doc_rel}",
                "hint": "使用 list_docs 查看可用文档",
            }, ensure_ascii=False)
        content = doc_path.read_text(encoding="utf-8")
        return json.dumps({
            "success": True, "path": ref_path, "filename": doc_rel,
            "content": content[:10000], "chars": len(content),
        }, ensure_ascii=False)

    # --- 原有参考文档 ---
    file_path = SKILL_REFERENCE_PATHS.get(ref_path)
    if not file_path or not file_path.exists():
        return json.dumps({
            "success": False, "error": f"未知参考文档: {ref_path}",
            "available": sorted(SKILL_REFERENCE_PATHS.keys()),
        }, ensure_ascii=False)

    content = file_path.read_text(encoding="utf-8")
    return json.dumps({
        "success": True, "path": ref_path, "filename": file_path.name,
        "content": content, "chars": len(content),
    }, ensure_ascii=False)


async def read_template_layout(params: Dict[str, Any]) -> str:
    """读取模板布局目录中的 SVG 文件列表和 design_spec。

    Args:
        params: {
            "project_path": "项目路径（用于输出反馈）",
            "layout_name": "模板名称（如 medical_university, anthropic）",
        }
    Returns:
        JSON: 模板目录下的 SVG 文件列表和 design_spec 内容
    """
    layout_name = params.get("layout_name", "")
    if not layout_name:
        return json.dumps({"success": False, "error": "layout_name 必填"}, ensure_ascii=False)

    layout_dir = _LAYOUTS_DIR / layout_name
    if not layout_dir.exists() or not layout_dir.is_dir():
        return json.dumps({
            "success": False, "error": f"布局模板不存在: {layout_name}",
            "available_layouts": LAYOUT_NAMES,
        }, ensure_ascii=False)

    svg_files = sorted(f.name for f in layout_dir.glob("*.svg"))
    design_spec_path = layout_dir / "design_spec.md"
    design_spec_content = design_spec_path.read_text(encoding="utf-8") if design_spec_path.exists() else ""

    return json.dumps({
        "success": True,
        "layout_name": layout_name,
        "svg_files": svg_files,
        "svg_count": len(svg_files),
        "design_spec": design_spec_content,
    }, ensure_ascii=False)


async def read_project_file(params: Dict[str, Any]) -> str:
    """读取 ppt-master 项目中的文件内容（design_spec.md / spec_lock.md / slide_plan.md / _summary.json）。

    Args:
        params: {
            "project_path": "项目路径",
            "filename": "文件名（如 design_spec.md, spec_lock.md, slide_plan.md）",
        }
    Returns:
        JSON: 文件内容
    """
    project_path = Path(params.get("project_path", ""))
    filename = params.get("filename", "")

    if not project_path.exists():
        return json.dumps({"success": False, "error": f"项目不存在: {project_path}"}, ensure_ascii=False)
    if not filename:
        return json.dumps({"success": False, "error": "filename 必填"}, ensure_ascii=False)

    file_path = project_path / filename
    if not file_path.exists():
        available = [f.name for f in project_path.iterdir() if f.is_file() and f.name in SAFE_FILES]
        return json.dumps({"success": False, "error": f"文件不存在: {filename}", "available": available}, ensure_ascii=False)

    content = file_path.read_text(encoding="utf-8")
    return json.dumps({
        "success": True,
        "filename": filename,
        "content": content,
        "chars": len(content),
    }, ensure_ascii=False)


async def read_summary(params: Dict[str, Any]) -> str:
    """读取项目中的内容摘要。

    Args:
        params: {
            "project_path": "项目路径",
        }
    Returns:
        JSON: title + content
    """
    project_path = Path(params.get("project_path", ""))
    if not project_path.exists():
        return json.dumps({"success": False, "error": f"项目不存在: {project_path}"}, ensure_ascii=False)

    summary_file = project_path / "_summary.json"
    if not summary_file.exists():
        return json.dumps({"success": False, "error": "_summary.json 不存在"}, ensure_ascii=False)

    content = summary_file.read_text(encoding="utf-8")
    return content


async def export_pptx(params: Dict[str, Any]) -> str:
    """导出 ppt-master 项目为 PPTX 文件。

    自动执行：讲稿拆分 → SVG 后处理 → PPTX 导出

    Args:
        params: {
            "project_path": "项目路径（必填）",
            "transition": "可选，fade/push/wipe/split/random/none（默认fade）",
            "animation": "可选，mixed/fade/none（默认mixed）",
            "animation_trigger": "可选，after-previous/on-click/with-previous",
            "auto_advance": "可选，自动翻页秒数",
        }
    Returns:
        JSON: pptx_path + steps 详情
    """
    project_path = params.get("project_path", "")
    if not project_path or not Path(project_path).exists():
        return json.dumps({"error": "有效的 project_path 必填"}, ensure_ascii=False)

    steps = []
    notes_path = Path(project_path) / "notes" / "total.md"
    if notes_path.exists():
        steps.append(("讲稿拆分", _TOTAL_MD_SPLIT, [str(project_path)]))
    else:
        steps.append(("讲稿拆分", None, []))

    steps.append(("SVG 质量检查", _SVG_QUALITY_CHECKER, [str(project_path)]))
    steps.append(("SVG 后处理", _FINALIZE_SVG, [str(project_path)]))

    transition = params.get("transition", "fade")
    animation = params.get("animation", "mixed")
    animation_trigger = params.get("animation_trigger", "after-previous")
    auto_advance = params.get("auto_advance", "")

    export_args = [project_path, "-s", "final"]
    if transition:
        export_args.extend(["-t", transition])
    if animation:
        export_args.extend(["-a", animation])
    if animation_trigger:
        export_args.extend(["--animation-trigger", animation_trigger])
    if auto_advance:
        export_args.extend(["--auto-advance", str(auto_advance)])

    steps.append(("PPTX 导出", _SVG_TO_PPTX, export_args))

    step_results = []
    quality_warnings = []
    for step_name, script, args in steps:
        if script is None:
            step_results.append({"step": step_name, "skipped": True})
            continue
        sr = _run_script(script, args, timeout=180)
        step_results.append({
            "step": step_name, "success": sr["success"],
            "detail": sr["stdout"][:500] if sr["success"] else sr["stderr"],
        })
        if step_name == "SVG 质量检查" and not sr["success"]:
            quality_warnings.append(sr["stderr"])
            continue
        if not sr["success"]:
            return json.dumps({"success": False, "error": f"{step_name} 失败", "detail": sr["stderr"], "steps": step_results}, ensure_ascii=False)

    output_pptx = ""
    exports_dir = Path(project_path) / "exports"
    if exports_dir.exists():
        pptx_files = sorted(exports_dir.glob("*.pptx"))
        pptx_files = [f for f in pptx_files if not f.name.startswith("~$")]
        if pptx_files:
            output_pptx = str(pptx_files[-1])

    return json.dumps({
        "success": True, "pptx_path": output_pptx, "project_path": project_path,
        "steps": step_results, "detail": step_results[-1].get("detail", ""),
        "quality_warnings": quality_warnings,
        "output_base": str(_OUTPUT_BASE),
    }, ensure_ascii=False)


def cleanup_project(project_path_str: str) -> dict:
    """导出成功后删除项目中间文件，只保留 PPTX。

    Args:
        project_path_str: 项目路径
    Returns:
        {"success": bool, "pptx_path": str 或 ""}
    """
    project_path = Path(project_path_str)
    if not project_path.exists():
        return {"success": False, "error": "项目路径不存在"}

    # 查找最终 PPTX
    exports_dir = project_path / "exports"
    output_pptx = ""
    if exports_dir.exists():
        pptx_files = sorted(exports_dir.glob("*.pptx"))
        pptx_files = [f for f in pptx_files if not f.name.startswith("~$")]
        if pptx_files:
            output_pptx = str(pptx_files[-1])

    if output_pptx:
        pptx_path = Path(output_pptx)
        dest = _OUTPUT_BASE / pptx_path.name
        shutil.copy2(str(pptx_path), str(dest))

    shutil.rmtree(str(project_path))

    return {"success": True, "pptx_path": dest if output_pptx else ""}
