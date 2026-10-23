from fastapi import APIRouter, UploadFile, File, HTTPException, Query, Depends
from fastapi.responses import Response, FileResponse
import httpx
import logging
import io
import os
import uuid
import re
from pathlib import Path
from PIL import Image

from app.core.config import settings
from app.api.v1.auth import get_current_user_dep
from app.schemas.user import TokenData
from app.db.session import SessionLocal
from app.models.agent import ArtifactRecord
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Image Processing"])

UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/uploads")

# 上传图片返回公网 URL（供 Agnes 等第三方 API 调用）
@router.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="只支持图片文件")
    ext = os.path.splitext(file.filename or "img.png")[1] or ".png"
    filename = f"{uuid.uuid4().hex}{ext}"
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filepath = os.path.join(UPLOAD_DIR, filename)
    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)
    return {"url": f"/uploads/{filename}", "filename": filename}


@router.post("/remove-bg", responses={
    200: {
        "content": {"image/png": {}},
        "description": "返回去除背景后的 PNG 图片",
    }
})
async def remove_background(
    file: UploadFile = File(...),
    save: bool = Query(False, description="是否保存到服务器并返回 URL"),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="只支持图片文件")

    try:
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="上传的文件为空")

        input_image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无法解析图片: {e}")

    try:
        from rembg import remove as remove_bg
        output_image = remove_bg(input_image)
    except Exception as e:
        logger.error(f"背景移除失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"背景移除处理失败: {e}")

    buf = io.BytesIO()
    output_image.save(buf, format="PNG")
    png_data = buf.getvalue()

    if save:
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        filename = f"nobg_{uuid.uuid4().hex[:12]}.png"
        filepath = os.path.join(UPLOAD_DIR, filename)
        with open(filepath, "wb") as f:
            f.write(png_data)
        return {
            "url": f"/uploads/{filename}",
            "filename": filename,
            "size": len(png_data),
        }

    return Response(content=png_data, media_type="image/png")


@router.get("/ppt-preview/{project_path:path}/list", response_model=dict)
async def list_ppt_svgs(project_path: str):
    svg_dir = Path(project_path) / "svg_output"
    if not svg_dir.exists():
        return {"files": [], "count": 0}
    files = sorted(f.name for f in svg_dir.glob("*.svg"))
    files.sort(key=lambda x: [int(c) if c.isdigit() else c.lower() for c in re.split(r'(\d+)', x)])
    return {"files": files, "count": len(files)}


@router.get("/ppt-preview/{project_path:path}/config", response_model=dict)
async def get_ppt_config(project_path: str):
    from app.mcp.tools.pptx_pipeline import read_project_file
    config = {}
    for fn in ["design_spec.md", "spec_lock.md", "_summary.json"]:
        result = await read_project_file({"project_path": project_path, "filename": fn})
        import json
        config[fn] = json.loads(result)
    return config


@router.get("/ppt-preview/{project_path:path}", responses={
    200: {"content": {"image/svg+xml": {}}, "description": "返回 SVG 文件内容"},
})
async def serve_ppt_svg(project_path: str, file: str = Query(...)):
    svg_path = Path(project_path) / "svg_output" / file
    if not svg_path.exists():
        raise HTTPException(status_code=404, detail="SVG 文件不存在")
    if svg_path.suffix != ".svg":
        raise HTTPException(status_code=400, detail="只支持 SVG 文件")
    content = svg_path.read_text(encoding="utf-8")
    # 兜底：转义未转义的 &
    import re
    content = re.sub(r'&(?!(amp|lt|gt|quot|apos|nbsp|#[0-9]+|#x[0-9a-fA-F]+);)', '&amp;', content)
    return Response(content=content, media_type="image/svg+xml")


_OUTPUT_BASE = Path(__file__).resolve().parent.parent.parent / "_output"
_UPLOAD_BASE = Path(__file__).resolve().parent.parent.parent / "uploads"


@router.get("/output/{filename:path}")
async def download_output_file(filename: str):
    """下载 _output/ 目录下的文件（PPT/PDF/DOCX 等）"""
    file_path = _OUTPUT_BASE / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")
    media_type_map = {
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".mp3": "audio/mpeg",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
    }
    media_type = media_type_map.get(file_path.suffix.lower(), "application/octet-stream")
    headers = {"Content-Disposition": f'attachment; filename="{file_path.name}"'}
    return FileResponse(str(file_path), media_type=media_type, filename=file_path.name, headers=headers)


@router.get("/upload/{filename:path}")
async def download_upload_file(filename: str):
    """下载 uploads/ 目录中的文件（以附件形式下载）"""
    file_path = _UPLOAD_BASE / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(str(file_path), filename=file_path.name)


@router.post("/upload-parse")
async def upload_and_parse(file: UploadFile = File(...)):
    """上传文件并用 SoMark 解析为 Markdown，返回解析结果。

    支持格式：pdf, docx, pptx, ppt, png, jpg, jpeg, gif, webp
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="未提供文件名")
    ext = Path(file.filename).suffix.lower()
    allowed_exts = {'.pdf', '.docx', '.pptx', '.ppt', '.png', '.jpg', '.jpeg', '.gif', '.webp'}
    if ext not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"不支持的文件格式: {ext}")

    import tempfile
    from app.services.somark_request_manager import somark_request_manager

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="文件为空")

    is_image = ext in {'.png', '.jpg', '.jpeg', '.gif', '.webp'}

    if is_image:
        return {
            "success": True,
            "filename": file.filename,
            "type": "image",
            "markdown": f"[图片: {file.filename}] (图片解析待配置识图模型)",
            "note": "图片识图解析尚未配置",
        }

    # 文档类：SoMark 解析
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name

        try:
            somark_result = await somark_request_manager.parse_document(
                file_path=tmp_path,
                feature_config={
                    "enable_text_cross_page": False,
                    "enable_title_level_recognition": True,
                    "enable_image_understanding": True,
                },
            )
        finally:
            os.unlink(tmp_path)

        markdown_text = ""
        result_data = somark_result.get("data", somark_result)
        if isinstance(result_data, dict):
            result_inner = result_data.get("result", result_data)
            if isinstance(result_inner, dict):
                outputs = result_inner.get("outputs", result_inner)
                if isinstance(outputs, dict):
                    md = outputs.get("markdown", "")
                    if isinstance(md, str) and md.strip():
                        markdown_text = md

        if not markdown_text:
            raise HTTPException(status_code=500, detail="SoMark 解析结果为空")

        return {
            "success": True,
            "filename": file.filename,
            "type": "document",
            "markdown": markdown_text,
            "chars": len(markdown_text),
        }
    except HTTPException:
        raise
    except Exception as e:
        from app.services.somark_request_manager import SoMarkAPIError
        if isinstance(e, SoMarkAPIError):
            return {"success": False, "filename": file.filename, "type": "document", "need_api_key": True, "detail": str(e)}
        logger.error(f"文件解析失败: {e}")
        raise HTTPException(status_code=500, detail=f"文件解析失败: {e}")
