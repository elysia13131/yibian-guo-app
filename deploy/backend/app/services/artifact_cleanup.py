import asyncio
import logging
import shutil
from datetime import datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)

_cleanup_task: asyncio.Task | None = None

_TEMP_RENDER_DIR = Path(__file__).resolve().parent.parent / ".temp" / "client_render"
_TEMP_MAX_AGE = timedelta(hours=2)


async def _cleanup_temp_render_dirs():
    """清理超过2小时未使用的前端渲染临时目录"""
    if not _TEMP_RENDER_DIR.exists():
        return
    now = datetime.now()
    for child in _TEMP_RENDER_DIR.iterdir():
        if not child.is_dir():
            continue
        try:
            mtime = datetime.fromtimestamp(child.stat().st_mtime)
            if now - mtime > _TEMP_MAX_AGE:
                shutil.rmtree(child, ignore_errors=True)
                logger.info(f"已清理过期渲染临时目录: {child.name}")
        except Exception as e:
            logger.warning(f"清理渲染临时目录失败: {child.name} - {e}")


async def _cleanup_loop():
    """每分钟检查一次过期产物和临时文件，删除文件和数据库记录"""
    logger.info("产物过期清理任务已启动")
    while True:
        try:
            await asyncio.sleep(60)
            await _cleanup_temp_render_dirs()
            from app.db.session import SessionLocal
            from app.models.agent import ArtifactRecord
            db = SessionLocal()
            try:
                now = datetime.now()
                expired = (
                    db.query(ArtifactRecord)
                    .filter(ArtifactRecord.expires_at.isnot(None))
                    .filter(ArtifactRecord.expires_at < now)
                    .all()
                )
                for record in expired:
                    if record.path:
                        try:
                            p = Path(record.path)
                            if p.exists():
                                p.unlink()
                                logger.info(f"已删除过期产物文件: {record.path}")
                        except Exception as e:
                            logger.warning(f"删除过期产物文件失败: {record.path} - {e}")
                    db.delete(record)
                if expired:
                    db.commit()
                    logger.info(f"已清理 {len(expired)} 个过期产物")
            except Exception as e:
                logger.warning(f"产物过期清理循环异常: {e}")
            finally:
                db.close()
        except asyncio.CancelledError:
            logger.info("产物过期清理任务已取消")
            break
        except Exception as e:
            logger.warning(f"产物过期清理循环异常: {e}")


def start_cleanup_scheduler():
    global _cleanup_task
    if _cleanup_task is None or _cleanup_task.done():
        _cleanup_task = asyncio.create_task(_cleanup_loop())
        logger.info("产物过期清理调度器已启动")


def stop_cleanup_scheduler():
    global _cleanup_task
    if _cleanup_task and not _cleanup_task.done():
        _cleanup_task.cancel()
        _cleanup_task = None
        logger.info("产物过期清理调度器已停止")
