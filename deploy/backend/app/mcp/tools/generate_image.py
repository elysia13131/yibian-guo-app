import os
import json
import time
import logging
import tempfile
import re
from pathlib import Path
from typing import Dict, Any, Optional

from app.core.user_context import current_ark_key

logger = logging.getLogger(__name__)

VOLC_API_BASE = "https://ark.cn-beijing.volces.com/api/v3"
VOLC_IMAGE_ENDPOINT = f"{VOLC_API_BASE}/images/generations"
DEFAULT_MODEL = "doubao-seedream-4-0-250828"

# 统一输出目录
_OUTPUT_BASE = Path(__file__).resolve().parent.parent.parent / "_output" / "images"
_OUTPUT_BASE.mkdir(parents=True, exist_ok=True)

ASPECT_RATIO_SIZE_MAP = {
    "1:1": "2048x2048",
    "2:3": "1536x2048",
    "3:2": "2048x1536",
    "3:4": "1536x2048",
    "4:3": "2048x1536",
    "4:5": "1638x2048",
    "5:4": "2048x1638",
    "9:16": "1152x2048",
    "16:9": "2048x1152",
    "21:9": "2048x878",
}

SIZE_PRESETS = ["1K", "2K", "4K"]
ALL_ASPECT_RATIOS = list(ASPECT_RATIO_SIZE_MAP.keys())


def _get_api_key() -> str:
    user_key = current_ark_key.get()
    if not user_key:
        return ""
    return user_key


def _resolve_size(size_spec: str) -> str:
    size_spec = size_spec.strip()
    if "x" in size_spec:
        return size_spec
    if size_spec in ASPECT_RATIO_SIZE_MAP:
        return ASPECT_RATIO_SIZE_MAP[size_spec]
    if size_spec.upper() in SIZE_PRESETS:
        return "2048x2048"
    return "2048x2048"


async def generate_image(params: Dict[str, Any]) -> str:
    """调用火山引擎 Seedream 4.0 模型生成图片。

    支持两种模式：
    - 文生单图：根据文本提示词生成一张图片
    - 文生组图：根据文本提示词生成一组内容关联的图片（最多15张）

    Args:
        params: {
            "prompt": "图片描述文本（必填，建议不超过300汉字）",
            "mode": "single | group（默认single）",
            "count": "组图模式时生成的图片数量（1-15，默认4）",
            "size": "图片尺寸（例：2048x2048 或 1:1/16:9/9:16等宽高比，默认2048x2048）",
            "output_dir": "可选，输出目录",
            "filename": "可选，输出文件名（不含扩展名）",
            "watermark": "是否加水印（默认false）",
        }
    Returns:
        JSON 字符串：{"success": true, "images": ["path1", "path2", ...]}
    """
    prompt = params.get("prompt", "").strip()
    if not prompt:
        return json.dumps({"success": False, "error": "prompt 不能为空"}, ensure_ascii=False)

    api_key = _get_api_key()
    if not api_key:
        return json.dumps({
            "success": False,
            "error": "请在个人设置中配置你的火山引擎 API Key",
        }, ensure_ascii=False)

    mode = params.get("mode", "single")
    count = params.get("count", 4)
    size_spec = params.get("size", "2048x2048")
    watermark = params.get("watermark", False)
    output_dir = params.get("output_dir", "")
    filename = params.get("filename", "")

    resolved_size = _resolve_size(size_spec)
    model = os.environ.get("VOLCENGINE_MODEL") or DEFAULT_MODEL

    payload = {
        "model": model,
        "prompt": prompt,
        "size": resolved_size,
        "response_format": "url",
        "watermark": watermark,
    }

    if mode == "group":
        payload["sequential_image_generation"] = "auto"
        max_images = max(1, min(15, int(count)))
        payload["sequential_image_generation_options"] = {"max_images": max_images}
    else:
        payload["sequential_image_generation"] = "disabled"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    logger.info(f"火山引擎生图: model={model}, mode={mode}, size={resolved_size}")
    logger.info(f"  prompt: {prompt[:100]}...")

    try:
        import requests
        start = time.time()
        response = requests.post(
            VOLC_IMAGE_ENDPOINT,
            headers=headers,
            json=payload,
            timeout=300,
        )
        elapsed = time.time() - start
        logger.info(f"  响应耗时: {elapsed:.1f}s, 状态码: {response.status_code}")

        if response.status_code != 200:
            error_detail = response.text[:500]
            return json.dumps({
                "success": False,
                "error": f"API 请求失败 ({response.status_code})",
                "detail": error_detail,
            }, ensure_ascii=False)

        result = response.json()
        items = result.get("data") or []
        if not items:
            return json.dumps({"success": False, "error": "API 返回为空", "detail": str(result)[:300]}, ensure_ascii=False)

        save_dir = Path(output_dir) if output_dir else _OUTPUT_BASE
        save_dir.mkdir(parents=True, exist_ok=True)

        base_name = filename or re.sub(r'[^\w\u4e00-\u9fff]', '_', prompt)[:30]

        saved_paths = []
        for idx, item in enumerate(items):
            image_url = item.get("url") or item.get("b64_json", "")
            if not image_url:
                continue

            ext = ".jpeg"
            if count > 1 or mode == "group":
                fname = f"{base_name}_{idx + 1}{ext}"
            else:
                fname = f"{base_name}{ext}"

            save_path = save_dir / fname

            dl_resp = requests.get(image_url, timeout=120)
            if dl_resp.status_code == 200:
                save_path.write_bytes(dl_resp.content)
                saved_paths.append(str(save_path))
                logger.info(f"  图片已保存: {save_path} ({len(dl_resp.content) / 1024:.1f} KB)")
            else:
                saved_paths.append(image_url)

        return json.dumps({
            "success": len(saved_paths) > 0,
            "mode": mode,
            "model": model,
            "size": resolved_size,
            "images": saved_paths,
            "urls": [f"/api/v1/image/output/{Path(p).relative_to(_OUTPUT_BASE.parent).as_posix()}" for p in saved_paths if Path(p).exists()],
            "count": len(saved_paths),
        }, ensure_ascii=False)

    except Exception as e:
        logger.exception("图片生成失败")
        return json.dumps({"success": False, "error": str(e)}, ensure_ascii=False)
