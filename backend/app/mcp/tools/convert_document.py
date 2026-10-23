import os
import json
import logging
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, Any

logger = logging.getLogger(__name__)

_PPT_MASTER_SCRIPTS = Path(__file__).resolve().parent.parent.parent.parent / "ppt-master" / "skills" / "ppt-master" / "scripts"
_SOURCE_TO_MD = _PPT_MASTER_SCRIPTS / "source_to_md"


def _resolve_path(path_str: str) -> Path:
    p = Path(path_str)
    if p.is_absolute():
        return p
    return Path.cwd() / p


def _run_script(script_path: Path, args: list, timeout: int = 120) -> dict:
    cmd = [sys.executable, str(script_path)] + args
    logger.info(f"执行: {' '.join(cmd)}")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "returncode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "stdout": "", "stderr": f"超时({timeout}s)", "returncode": -1}
    except Exception as e:
        return {"success": False, "stdout": "", "stderr": str(e), "returncode": -1}


async def convert_document(params: Dict[str, Any]) -> str:
    """将源文档（PDF / DOCX / URL / Markdown）转换为 Markdown 格式。

    利用 ppt-master 的文档转换脚本：
    - PDF → pdf_to_md.py
    - DOCX/DOC/HTML → doc_to_md.py
    - URL/网页 → web_to_md.py
    - Markdown → 直接返回内容

    Args:
        params: {
            "source": "文件路径或 URL（必填）",
            "type": "可选，auto/pdf/docx/url（默认 auto 自动检测）",
            "output_dir": "可选，输出目录（默认临时目录）",
        }
    Returns:
        JSON：{"success": true, "markdown": "转换后的内容", "file_path": "..."}
    """
    source = params.get("source", "").strip()
    if not source:
        return json.dumps({"success": False, "error": "source 不能为空"}, ensure_ascii=False)

    source_type = params.get("type", "auto").lower()
    output_dir = params.get("output_dir", tempfile.gettempdir())

    out_path = Path(output_dir) / "converted"
    out_path.mkdir(parents=True, exist_ok=True)

    if source.startswith(("http://", "https://")):
        result = _run_script(
            _SOURCE_TO_MD / "web_to_md.py",
            [source],
            timeout=60,
        )
        md_file = None
        for line in result["stdout"].split("\n"):
            if ".md" in line and "saved" in line.lower():
                words = line.split()
                for w in words:
                    if w.endswith(".md"):
                        md_file = w
                        break
        if not md_file:
            for f in Path.cwd().glob("*.md"):
                if source.split("/")[-1][:20] in str(f):
                    md_file = str(f)
                    break

        return json.dumps({
            "success": result["success"],
            "markdown": result["stdout"][:5000] if result["success"] else result["stderr"],
            "file_path": md_file or "",
            "stdout": result["stdout"],
            "stderr": result["stderr"],
        }, ensure_ascii=False)

    source_path = _resolve_path(source)
    if not source_path.exists():
        return json.dumps({"success": False, "error": f"文件不存在: {source_path}"}, ensure_ascii=False)

    ext = source_path.suffix.lower()

    if source_type == "pdf" or ext == ".pdf":
        result = _run_script(_SOURCE_TO_MD / "pdf_to_md.py", [str(source_path)], timeout=120)
    elif source_type in ("docx", "doc", "html") or ext in (".docx", ".doc", ".html", ".htm", ".epub", ".ipynb"):
        result = _run_script(_SOURCE_TO_MD / "doc_to_md.py", [str(source_path)], timeout=120)
    elif ext in (".md", ".markdown"):
        content = source_path.read_text(encoding="utf-8")
        return json.dumps({"success": True, "markdown": content, "file_path": str(source_path)}, ensure_ascii=False)
    else:
        result = _run_script(_SOURCE_TO_MD / "doc_to_md.py", [str(source_path)], timeout=120)

    md_output_path = source_path.with_suffix(".md")
    markdown = ""
    if md_output_path.exists():
        markdown = md_output_path.read_text(encoding="utf-8")[:10000]

    return json.dumps({
        "success": result["success"],
        "markdown": markdown or result["stdout"][:5000],
        "file_path": str(md_output_path) if md_output_path.exists() else "",
        "stdout": result["stdout"],
        "stderr": result["stderr"],
    }, ensure_ascii=False)
