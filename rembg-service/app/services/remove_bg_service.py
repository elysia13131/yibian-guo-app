import logging
import io
import sys
import os
import traceback
from contextlib import asynccontextmanager
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import Response, JSONResponse
import uvicorn

logging.basicConfig(level=logging.INFO, stream=sys.stderr)
logger = logging.getLogger("remove_bg_service")

REMOVE_BG_SERVICE_PORT = 8081
_rembg_session = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _rembg_session
    try:
        logger.info("📥 正在预加载 rembg 模型 (u2net)...")
        from rembg import new_session
        _rembg_session = new_session("u2net")
        logger.info("✅ rembg 模型加载成功")
    except Exception as e:
        logger.error(f"❌ rembg 模型预加载失败: {e}")
        logger.error(traceback.format_exc())
    yield


app = FastAPI(title="Rembg 独立服务", lifespan=lifespan)


@app.post("/remove-bg")
async def remove_bg(file: UploadFile = File(...)):
    try:
        raw = await file.read()
        logger.info(f"收到去背景请求: 大小={len(raw)} bytes")

        from PIL import Image as PILImage
        from rembg import remove as remove_bg_func

        input_image = PILImage.open(io.BytesIO(raw)).convert("RGB")

        if _rembg_session is not None:
            output_image = remove_bg_func(input_image, session=_rembg_session)
        else:
            output_image = remove_bg_func(input_image)

        buf = io.BytesIO()
        output_image.save(buf, format="PNG")
        result = buf.getvalue()
        logger.info(f"去背景完成: {len(result)} bytes")
        return Response(content=result, media_type="image/png")
    except Exception as e:
        logger.error(f"❌ 去背景处理失败: {e}")
        logger.error(traceback.format_exc())
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "traceback": traceback.format_exc()}
        )


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "model_loaded": _rembg_session is not None
    }


if __name__ == "__main__":
    port = int(os.getenv("PORT", str(REMOVE_BG_SERVICE_PORT)))
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    logger.info(f"启动 rembg 服务，端口: {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
