import logging
import io
import sys
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import Response
import uvicorn

logging.basicConfig(level=logging.INFO, stream=sys.stderr)
logger = logging.getLogger("remove_bg_service")

app = FastAPI(title="Rembg 独立服务")

REMOVE_BG_SERVICE_PORT = 8081


@app.post("/remove-bg")
async def remove_bg(file: UploadFile = File(...)):
    raw = await file.read()
    logger.info(f"收到去背景请求: 大小={len(raw)} bytes")
    from PIL import Image as PILImage
    from rembg import remove as remove_bg_func
    input_image = PILImage.open(io.BytesIO(raw)).convert("RGB")
    output_image = remove_bg_func(input_image)
    buf = io.BytesIO()
    output_image.save(buf, format="PNG")
    logger.info(f"去背景完成: {len(buf.getvalue())} bytes")
    return Response(content=buf.getvalue(), media_type="image/png")


@app.get("/health")
async def health():
    return {"status": "healthy"}


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else REMOVE_BG_SERVICE_PORT
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
