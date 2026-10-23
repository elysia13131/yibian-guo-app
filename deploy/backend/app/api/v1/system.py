import logging
import subprocess
import os
import signal
import asyncio
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse
from app.api.v1.auth import get_current_user_dep
from app.schemas.user import TokenData

logger = logging.getLogger(__name__)

router = APIRouter(tags=["system"])

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent.parent


@router.post("/system/update", response_model=dict)
async def system_update(
    token_data: TokenData = Depends(get_current_user_dep),
):
    """从 GitHub 拉取最新代码并重启服务"""
    try:
        result = subprocess.run(
            ["git", "pull"],
            cwd=str(BACKEND_DIR),
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            logger.error(f"git pull 失败: {result.stderr}")
            raise HTTPException(status_code=500, detail=f"git pull 失败: {result.stderr}")

        logger.info(f"git pull 成功: {result.stdout}")
        return {"success": True, "message": "更新成功，正在重启...", "output": result.stdout}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="git pull 超时")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="当前环境不支持 git 操作")


@router.post("/system/restart", response_model=dict)
async def system_restart(
    token_data: TokenData = Depends(get_current_user_dep),
):
    """重启后端服务"""
    asyncio.create_task(_delayed_restart())
    return {"success": True, "message": "正在重启服务..."}


@router.get("/system/version", response_model=dict)
async def system_version(
    token_data: TokenData = Depends(get_current_user_dep),
):
    """获取当前版本信息（Git commit hash）"""
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(BACKEND_DIR),
            capture_output=True, text=True, timeout=10,
        ).stdout.strip()
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(BACKEND_DIR),
            capture_output=True, text=True, timeout=10,
        ).stdout.strip()
        return {"success": True, "commit": commit, "branch": branch}
    except Exception as e:
        return {"success": True, "commit": "unknown", "branch": "unknown", "error": str(e)}


async def _delayed_restart():
    """延迟 1 秒后重启进程"""
    await asyncio.sleep(1)
    logger.info("正在重启后端服务...")
    os.kill(os.getpid(), signal.SIGTERM)


@router.get("/download/apk")
async def download_apk():
    """下载最新 APK 安装包"""
    # 优先从项目目录下的 update/ 查找，其次从根目录 /update 查找
    local_path = BACKEND_DIR / "update" / "app-debug.apk"
    root_path = Path("/update/app-debug.apk")
    apk_path = local_path if local_path.is_file() else root_path
    if not apk_path.is_file():
        raise HTTPException(status_code=404, detail="APK 文件不存在")
    return FileResponse(
        str(apk_path),
        media_type="application/vnd.android.package-archive",
        filename="app-debug.apk",
    )
