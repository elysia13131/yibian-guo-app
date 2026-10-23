import os
import re
import json
import logging
import tempfile
import subprocess
import sys
from pathlib import Path
from typing import Dict, Any

logger = logging.getLogger(__name__)

_PPT_MASTER_DIR = Path(__file__).resolve().parent.parent.parent.parent / "ppt-master"
_OUTPUT_BASE = Path(__file__).resolve().parent.parent.parent / "_output"
_PPT_MASTER_REPO = "https://github.com/hugohe3/ppt-master.git"
_PPT_MASTER_BRANCH = "main"
_PPT_MASTER_SPARSE = "skills/ppt-master/templates\nskills/ppt-master/references\ndocs\nexamples\n"  # 模板/参考/范例从 GitHub 拉取

def _ensure_ppt_master() -> Path:
    """确保 ppt-master 模板存在。脚本已提交到部署仓库，模板从 GitHub 按需拉取。"""
    templates_dir = _PPT_MASTER_DIR / "skills" / "ppt-master" / "templates"
    if templates_dir.exists() and (templates_dir / "layouts").exists():
        return _PPT_MASTER_DIR
    logger.info(f"ppt-master 模板缺失，从 GitHub 浅克隆: {_PPT_MASTER_REPO} ({_PPT_MASTER_SPARSE})")
    try:
        import subprocess, shutil
        # 保留已有的 scripts/ 目录（提交在仓库中的）
        scripts_backup = None
        scripts_dir = _PPT_MASTER_DIR / "skills" / "ppt-master" / "scripts"
        if scripts_dir.exists():
            scripts_backup = _PPT_MASTER_DIR / "skills" / "ppt-master" / ".scripts_bak"
            shutil.move(str(scripts_dir), str(scripts_backup))
        # 初始化 git 并 sparse checkout 模板
        if _PPT_MASTER_DIR.exists() and not (_PPT_MASTER_DIR / ".git").exists():
            shutil.rmtree(str(_PPT_MASTER_DIR), ignore_errors=True)
        _PPT_MASTER_DIR.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "init"], cwd=_PPT_MASTER_DIR, check=True, capture_output=True)
        subprocess.run(["git", "remote", "add", "origin", _PPT_MASTER_REPO], cwd=_PPT_MASTER_DIR, check=True, capture_output=True)
        subprocess.run(["git", "config", "core.sparseCheckout", "true"], cwd=_PPT_MASTER_DIR, check=True, capture_output=True)
        (_PPT_MASTER_DIR / ".git" / "info" / "sparse-checkout").write_text(_PPT_MASTER_SPARSE + "\n")
        subprocess.run(["git", "pull", "--depth=1", "origin", _PPT_MASTER_BRANCH], cwd=_PPT_MASTER_DIR, check=True, capture_output=True)
        # 恢复本地 scripts/
        if scripts_backup is not None and scripts_backup.exists():
            shutil.move(str(scripts_backup), str(scripts_dir))
        # 确保 references/ 也被拉取（ppt-master 仓库结构: skills/ppt-master/references/ 可能不在 sparse 路径中，但有些路径需要）
        logger.info("ppt-master 模板克隆成功")
        return _PPT_MASTER_DIR
    except Exception as e:
        logger.error(f"无法获取 ppt-master 模板: {e}")
        # 恢复 scripts 备份
        if scripts_backup is not None and scripts_backup.exists():
            shutil.move(str(scripts_backup), str(scripts_dir))
        raise RuntimeError(f"无法获取 ppt-master 模板: {e}")

_ensure_ppt_master()

_SKILL_DIR = _PPT_MASTER_DIR / "skills" / "ppt-master"
_SCRIPTS_DIR = _SKILL_DIR / "scripts"
_PROJECT_MANAGER = _SCRIPTS_DIR / "project_manager.py"
_FINALIZE_SVG = _SCRIPTS_DIR / "finalize_svg.py"
_SVG_TO_PPTX = _SCRIPTS_DIR / "svg_to_pptx.py"
_TOTAL_MD_SPLIT = _SCRIPTS_DIR / "total_md_split.py"
_SVG_QUALITY_CHECKER = _SCRIPTS_DIR / "svg_quality_checker.py"


def _find_chinese_font() -> str:
    candidates = [
        os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts', 'simhei.ttf'),
        os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts', 'msyh.ttc'),
        os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts', 'simsun.ttc'),
    ]
    for fp in candidates:
        if os.path.exists(fp):
            return fp
    return ""


def _strip_markdown(text: str) -> str:
    text = re.sub(r'\*\*\*(.+?)\*\*\*', r'\1', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'\*(.+?)\*', r'\1', text)
    text = re.sub(r'^[\*\-]\s+', '', text, flags=re.MULTILINE)
    text = text.replace('*', '')
    text = re.sub(r'`(.+?)`', r'\1', text)
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    text = text.replace('\u2003', '  ').replace('\u00a0', ' ')
    return text


def _run_script(script_path: Path, args: list, timeout: int = 60) -> dict:
    cmd = [sys.executable, str(script_path)] + args
    logger.info(f"执行脚本: {' '.join(cmd)}")
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(_PPT_MASTER_DIR),
        )
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "returncode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "stdout": "", "stderr": f"脚本超时({timeout}s)", "returncode": -1}
    except Exception as e:
        return {"success": False, "stdout": "", "stderr": str(e), "returncode": -1}


async def generate_pptx(params: Dict[str, Any]) -> str:
    """将 Markdown 文本内容生成为 PPTX 演示文稿。

    三种模式：
    - ppt-master（默认）：创建 ppt-master 项目，通过完整的 SVG 设计流程生成原生可编辑 PPTX
    - simple：使用 python-pptx 直接转换，快速生成基础 PPTX（纯文字排版）
    - export：对已有项目运行 finalize + svg_to_pptx 完成最终导出

    Args:
        params: {
            "title": "演示文稿标题",
            "content": "Markdown 格式的正文内容",
            "filename": "可选，输出文件名（不含扩展名）",
            "mode": "可选，'ppt-master'（默认）、'simple'、'export'",
            "project_path": "export 模式必填，已有项目路径",
            "format": "可选，画布格式：ppt169(默认)、ppt43 等"
        }
    Returns:
        PPTX 文件路径或项目路径（含下一步指引）
    """
    title = params.get("title", "演示文稿")
    content = params.get("content", "")
    filename = params.get("filename", re.sub(r'[\/\\:*?"<>|]', '_', title))
    mode = params.get("mode", "ppt-master")
    canvas_format = params.get("format", "ppt169")

    output_dir = _OUTPUT_BASE
    output_dir.mkdir(parents=True, exist_ok=True)

    if mode == "export":
        project_path = params.get("project_path", "")
        if not project_path or not Path(project_path).exists():
            return json.dumps({"error": "export 模式需要提供有效的 project_path"}, ensure_ascii=False)

        steps = []

        notes_path = Path(project_path) / "notes" / "total.md"
        if notes_path.exists():
            steps.append(("讲稿拆分", _TOTAL_MD_SPLIT, [str(project_path)]))
        else:
            steps.append(("讲稿拆分", None, []))

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
        for step_name, script, args in steps:
            if script is None:
                step_results.append({"step": step_name, "skipped": True})
                continue
            step_result = _run_script(script, args, timeout=180)
            step_results.append({
                "step": step_name,
                "success": step_result["success"],
                "detail": step_result["stdout"][:500] if step_result["success"] else step_result["stderr"],
            })
            if not step_result["success"]:
                return json.dumps({
                    "error": f"{step_name} 失败",
                    "detail": step_result["stderr"],
                    "project_path": project_path,
                    "steps": step_results,
                }, ensure_ascii=False)

        output_pptx = ""
        exports_dir = Path(project_path) / "exports"
        if exports_dir.exists():
            pptx_files = sorted(exports_dir.glob("*.pptx"))
            pptx_files = [f for f in pptx_files if not f.name.startswith("~$")]
            if pptx_files:
                output_pptx = str(pptx_files[-1])
        if not output_pptx:
            backup_dir = Path(project_path) / "backup"
            if backup_dir.exists():
                backup_subdirs = sorted(backup_dir.iterdir())
                if backup_subdirs:
                    pptx_files = sorted(backup_subdirs[-1].glob("*_svg.pptx"))
                    if pptx_files:
                        output_pptx = str(pptx_files[-1])

        return json.dumps({
            "success": True,
            "pptx_path": output_pptx,
            "project_path": project_path,
            "steps": step_results,
            "detail": step_results[-1].get("detail", ""),
        }, ensure_ascii=False)

    if mode == "simple":
        from pptx import Presentation
        from pptx.util import Inches, Pt
        from pptx.dml.color import RGBColor
        from pptx.enum.text import PP_ALIGN
        from pptx.oxml.ns import qn

        output_path = output_dir / f"{filename}.pptx"
        prs = Presentation()
        prs.slide_width = Inches(13.333)
        prs.slide_height = Inches(7.5)

        slide_layout = prs.slide_layouts[6]
        chinese_font = _find_chinese_font()
        has_cn = bool(chinese_font)

        def set_font(run, size=18, bold=False, color=None):
            run.font.size = Pt(size)
            run.font.bold = bold
            if color:
                run.font.color.rgb = RGBColor(*color)
            if has_cn:
                rPr = run._r.get_or_add_rPr()
                rPr.set(qn('a:ea'), '微软雅黑')

        def add_slide_with_text(title_text, body_text, is_title_slide=False):
            prs.slides.add_slide(slide_layout)
            if is_title_slide:
                txBox = prs.slides[-1].shapes.add_textbox(
                    Inches(1.5), Inches(2.5), Inches(10.333), Inches(2.0)
                )
                tf = txBox.text_frame
                tf.word_wrap = True
                p = tf.paragraphs[0]
                p.alignment = PP_ALIGN.CENTER
                run = p.add_run()
                run.text = title_text
                set_font(run, size=44, bold=True, color=(0x33, 0x33, 0x33))
            else:
                txBox = prs.slides[-1].shapes.add_textbox(
                    Inches(0.8), Inches(0.4), Inches(11.733), Inches(0.8)
                )
                tf = txBox.text_frame
                tf.word_wrap = True
                p = tf.paragraphs[0]
                p.alignment = PP_ALIGN.LEFT
                run = p.add_run()
                run.text = title_text
                set_font(run, size=28, bold=True, color=(0x33, 0x33, 0x33))

                bodyBox = prs.slides[-1].shapes.add_textbox(
                    Inches(0.8), Inches(1.5), Inches(11.733), Inches(5.5)
                )
                btf = bodyBox.text_frame
                btf.word_wrap = True
                first = True
                for line in body_text.split('\n'):
                    stripped = line.strip()
                    if not stripped:
                        continue
                    if first:
                        p = btf.paragraphs[0]
                        first = False
                    else:
                        p = btf.add_paragraph()
                    p.space_after = Pt(8)
                    run = p.add_run()
                    run.text = _strip_markdown(stripped)
                    set_font(run, size=16, color=(0x55, 0x55, 0x55))

        lines = content.split('\n')
        add_slide_with_text(title, "", is_title_slide=True)
        current_title = ""
        current_body = []
        slide_count = 1
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith('#'):
                if current_body and slide_count < 30:
                    add_slide_with_text(current_title or title, '\n'.join(current_body))
                    slide_count += 1
                current_title = stripped.lstrip('#').strip()
                current_body = []
            elif stripped.startswith('- ') or stripped.startswith('* '):
                current_body.append("• " + re.sub(r'^[\*\-]\s+', '', stripped))
            else:
                current_body.append(stripped)
                if len(current_body) >= 12 and slide_count < 30:
                    add_slide_with_text(current_title or title, '\n'.join(current_body))
                    slide_count += 1
                    current_body = []
        if current_body and slide_count < 30:
            add_slide_with_text(current_title or title, '\n'.join(current_body))

        prs.save(str(output_path))
        logger.info(f"PPTX (simple) 已生成: {output_path}")
        return json.dumps({"success": True, "pptx_path": str(output_path), "mode": "simple"}, ensure_ascii=False)

    project_path = output_dir / f"pptx_{filename}"
    if project_path.exists():
        import shutil
        shutil.rmtree(str(project_path))
    project_path.mkdir(parents=True, exist_ok=True)

    md_path = project_path / "sources" / f"{filename}.md"
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(f"# {title}\n\n{content}", encoding="utf-8")

    result_init = _run_script(
        _PROJECT_MANAGER,
        ["init", str(project_path.name), "--format", canvas_format, "--dir", str(project_path.parent)],
    )

    if not result_init["success"] and project_path.exists():
        md_path = project_path / "sources" / f"{filename}.md"
        md_path.parent.mkdir(parents=True, exist_ok=True)
        md_path.write_text(f"# {title}\n\n{content}", encoding="utf-8")
        result_init = {"success": True, "stdout": "项目目录已手动创建"}

    import_result = _run_script(
        _PROJECT_MANAGER,
        ["import-sources", str(project_path), str(md_path), "--move"],
    )

    skill_md_path = _SKILL_DIR / "SKILL.md"
    workflow_prompt = ""
    if skill_md_path.exists():
        workflow_prompt = (
            f"下一步：请读取 {skill_md_path}，遵循 ppt-master 工作流完成以下步骤：\n"
            f"1. 执行 Step 3-4 的 template 选项和 Strategist 设计确认\n"
            f"2. 根据内容逐页设计 SVG 页面，保存到 {project_path}/svg_output/\n"
            f"3. 完成后调用 generate_pptx 工具，mode='export', project_path='{project_path}'"
        )

    logger.info(f"ppt-master 项目已创建: {project_path}")

    return json.dumps({
        "success": True,
        "mode": "ppt-master",
        "project_path": str(project_path),
        "content_file": str(md_path),
        "format": canvas_format,
        "action": "project_created",
        "workflow_prompt": workflow_prompt,
        "detail": result_init.get("stdout", ""),
    }, ensure_ascii=False)