import logging
import sys
import json
from pathlib import Path
from typing import Dict, Any, Optional

_OUTPUT_BASE = Path(__file__).resolve().parent.parent.parent / "_output"

logger = logging.getLogger(__name__)

_PPT_SCRIPTS_DIR: Optional[Path] = None


def _ensure_ppt_scripts_importable() -> Optional[Path]:
    global _PPT_SCRIPTS_DIR
    if _PPT_SCRIPTS_DIR:
        return _PPT_SCRIPTS_DIR
    candidates = [
        Path(__file__).resolve().parent.parent.parent.parent / "ppt-master" / "skills" / "ppt-master" / "scripts",
        Path("./ppt-master/skills/ppt-master/scripts").resolve(),
    ]
    for p in candidates:
        if p.exists() and (p / "image_search.py").exists():
            _PPT_SCRIPTS_DIR = p
            if str(p) not in sys.path:
                sys.path.insert(0, str(p))
            return p
    return None


async def image_search(params: Dict[str, Any]) -> str:
    """在互联网上搜索开放许可的图片并下载到项目目录。

    Args:
        params: {
            "query": "搜索关键词（必填），如 'offshore wind farm'",
            "project_path": "项目路径（必填），图片将下载到 project_path/images/",
            "filename": "保存的文件名（必填），如 cover_bg.jpg",
            "orientation": "可选，landscape/portrait/square/any，默认 landscape",
            "strict_no_attribution": "可选，是否只接受免署名图片，默认 false",
        }
    Returns:
        JSON: 下载结果
    """
    query = params.get("query", "")
    project_path = params.get("project_path", "")
    filename = params.get("filename", "")
    orientation = params.get("orientation", "landscape")
    strict = params.get("strict_no_attribution", False)

    if not query or not filename:
        return json.dumps({"success": False, "error": "query, filename 必填"}, ensure_ascii=False)

    if not project_path:
        project_path = str(_OUTPUT_BASE)

    scripts_dir = _ensure_ppt_scripts_importable()
    if not scripts_dir:
        return json.dumps({"success": False, "error": "ppt-master skills 目录未找到"}, ensure_ascii=False)

    output_dir = Path(project_path) / "images"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / filename

    try:
        from image_search import search_and_download
        from image_sources.provider_common import ImageSearchRequest, build_attribution_text, ensure_json_parent

        request = ImageSearchRequest(
            query=query,
            filename=filename,
            slide=params.get("slide", ""),
            orientation=orientation,
        )

        candidate, provider_name, stage = search_and_download(
            providers=["openverse", "wikimedia", "pexels", "pixabay"],
            request=request,
            output_path=output_path,
            strict_no_attribution=strict,
            save_candidates=True,
        )

        if not candidate or not output_path.exists():
            return json.dumps({"success": False, "error": f"未能从任何供应商找到匹配图片: {query}"}, ensure_ascii=False)

        attribution_text = build_attribution_text(filename, candidate) if candidate.license_tier == "attribution-required" else ""

        sources_path = ensure_json_parent(output_dir / "image_sources.json")
        sources_data = []
        if sources_path.exists():
            sources_data = json.loads(sources_path.read_text(encoding="utf-8"))
        sources_data.append({
            "filename": filename,
            "slide": params.get("slide", filename),
            "provider": provider_name,
            "license_tier": candidate.license_tier,
            "attribution_text": attribution_text,
            "title": candidate.title,
            "author": candidate.author,
            "source_url": candidate.source_page_url,
        })
        sources_path.write_text(json.dumps(sources_data, indent=2, ensure_ascii=False), encoding="utf-8")

        return json.dumps({
            "success": True,
            "filename": filename,
            "path": str(output_path),
            "url": f"/api/v1/image/output/{Path(str(output_path)).relative_to(_OUTPUT_BASE).as_posix()}",
            "provider": provider_name,
            "license_tier": candidate.license_tier,
            "attribution_text": attribution_text,
            "attribution_required": candidate.license_tier == "attribution-required",
            "title": candidate.title,
            "author": candidate.author,
        }, ensure_ascii=False)

    except Exception as e:
        logger.error(f"图片搜索失败: {e}", exc_info=True)
        return json.dumps({"success": False, "error": f"图片搜索失败: {e}"}, ensure_ascii=False)
