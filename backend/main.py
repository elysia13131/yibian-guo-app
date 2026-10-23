from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from dotenv import load_dotenv
import logging
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from app.core.config import settings
from app.db.session import engine
from app.db.base import Base
from app.api.v1.api import api_router
from app.api.v1.admin import router as admin_router
from app.models.agent import Agent, ExpertTask, TaskContext, SessionMessage, UserAgentSession, WorkflowLog, AgentFeedback, SkillResult
from app.core.user_context import UserKeyMiddleware

# 注册 Skills（import 触发自注册）
import app.services.agent_feedback_analyzer  # noqa: F401


def _ensure_missing_columns():
    """检查并直接添加模型中存在但数据库缺少的列（处理 Zeabur 升级场景）"""
    try:
        from sqlalchemy import inspect, text
        inspector = inspect(engine)

        # ── users 表 ──
        if 'users' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('users')]
            if 'player_title' not in columns:
                logger.info("📥 检测到 users 表缺少 player_title 列，正在添加...")
                with engine.begin() as conn:
                    conn.execute(text(
                        "ALTER TABLE users ADD COLUMN player_title VARCHAR(50) NOT NULL DEFAULT '同学'"
                    ))
                logger.info("✅ player_title 列添加成功")
            if 'api_key' not in columns:
                logger.info("📥 检测到 users 表缺少 api_key 列，正在添加...")
                with engine.begin() as conn:
                    conn.execute(text(
                        "ALTER TABLE users ADD COLUMN api_key VARCHAR(200)"
                    ))
                logger.info("✅ api_key 列添加成功")
            if 'deepseek_api_key' not in columns:
                logger.info("📥 检测到 users 表缺少 deepseek_api_key 列，正在添加...")
                with engine.begin() as conn:
                    conn.execute(text(
                        "ALTER TABLE users ADD COLUMN deepseek_api_key VARCHAR(200)"
                    ))
                logger.info("✅ deepseek_api_key 列添加成功")
            if 'somark_api_key' not in columns:
                logger.info("📥 检测到 users 表缺少 somark_api_key 列，正在添加...")
                with engine.begin() as conn:
                    conn.execute(text(
                        "ALTER TABLE users ADD COLUMN somark_api_key VARCHAR(200)"
                    ))
                logger.info("✅ somark_api_key 列添加成功")
            if 'tts_api_key' not in columns:
                logger.info("📥 检测到 users 表缺少 tts_api_key 列，正在添加...")
                with engine.begin() as conn:
                    conn.execute(text(
                        "ALTER TABLE users ADD COLUMN tts_api_key VARCHAR(200)"
                    ))
                logger.info("✅ tts_api_key 列添加成功")

        # ── game_characters 表 ──
        if 'game_characters' in inspector.get_table_names():
            char_columns = [col['name'] for col in inspector.get_columns('game_characters')]
            char_missing = {
                'uid': "ALTER TABLE game_characters ADD COLUMN uid VARCHAR(12) UNIQUE",
                'description': "ALTER TABLE game_characters ADD COLUMN description TEXT",
                'speaker_id': "ALTER TABLE game_characters ADD COLUMN speaker_id VARCHAR(100)",
                'voice_status': "ALTER TABLE game_characters ADD COLUMN voice_status VARCHAR(20)",
                'voice_sample_url': "ALTER TABLE game_characters ADD COLUMN voice_sample_url VARCHAR(500)",
                'cg_images': "ALTER TABLE game_characters ADD COLUMN cg_images JSON",
                'expression_descriptions': "ALTER TABLE game_characters ADD COLUMN expression_descriptions JSON",
                'is_default': "ALTER TABLE game_characters ADD COLUMN is_default BOOLEAN DEFAULT false",
                'borrowed_from_id': "ALTER TABLE game_characters ADD COLUMN borrowed_from_id INTEGER",
                'is_public': "ALTER TABLE game_characters ADD COLUMN is_public BOOLEAN DEFAULT false",
            }
            for col, sql in char_missing.items():
                if col not in char_columns:
                    logger.info(f"📥 检测到 game_characters 表缺少 {col} 列，正在添加...")
                    with engine.begin() as conn:
                        conn.execute(text(sql))
                    logger.info(f"✅ {col} 列添加成功")

        # ── game_saves 表 ──
        if 'game_saves' in inspector.get_table_names():
            gs_columns = [col['name'] for col in inspector.get_columns('game_saves')]
            gs_missing = {
                'uid': "ALTER TABLE game_saves ADD COLUMN uid VARCHAR(12) UNIQUE",
                'borrowed_from_id': "ALTER TABLE game_saves ADD COLUMN borrowed_from_id INTEGER",
                'is_public': "ALTER TABLE game_saves ADD COLUMN is_public BOOLEAN DEFAULT false",
            }
            for col, sql in gs_missing.items():
                if col not in gs_columns:
                    logger.info(f"📥 检测到 game_saves 表缺少 {col} 列，正在添加...")
                    with engine.begin() as conn:
                        conn.execute(text(sql))
                    logger.info(f"✅ {col} 列添加成功")
            # document_id 改为可空（允许文档被清理后保存孤立的 GameSave）
            for col_info in inspector.get_columns('game_saves'):
                if col_info['name'] == 'document_id' and not col_info.get('nullable', True):
                    if engine.dialect.name == 'postgresql':
                        with engine.begin() as conn:
                            conn.execute(text("ALTER TABLE game_saves ALTER COLUMN document_id DROP NOT NULL"))
                            logger.info("✅ game_saves.document_id 已改为可空")

        # ── character_borrows 表（借阅角色）──
        if 'character_borrows' not in inspector.get_table_names():
            logger.info("📥 检测到缺少 character_borrows 表，正在创建...")
            with engine.begin() as conn:
                conn.execute(text("""
                    CREATE TABLE character_borrows (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        character_id INTEGER NOT NULL REFERENCES game_characters(id),
                        user_id INTEGER NOT NULL REFERENCES users(id),
                        speaker_id VARCHAR(100),
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
                conn.execute(text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_character_borrows ON character_borrows(character_id, user_id)"
                ))
            logger.info("✅ character_borrows 表创建成功")

        # ── save_borrows 表（借阅存档）──
        if 'save_borrows' not in inspector.get_table_names():
            logger.info("📥 检测到缺少 save_borrows 表，正在创建...")
            with engine.begin() as conn:
                conn.execute(text("""
                    CREATE TABLE save_borrows (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        save_id INTEGER NOT NULL REFERENCES game_saves(id),
                        user_id INTEGER NOT NULL REFERENCES users(id),
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
                conn.execute(text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_save_borrows ON save_borrows(save_id, user_id)"
                ))
            logger.info("✅ save_borrows 表创建成功")

        # ── flashcards 表 ──
        if 'flashcards' in inspector.get_table_names():
            fc_columns = [col['name'] for col in inspector.get_columns('flashcards')]
            fc_missing = {
                'is_multiple': "ALTER TABLE flashcards ADD COLUMN is_multiple BOOLEAN DEFAULT false",
                'correct_option_labels': "ALTER TABLE flashcards ADD COLUMN correct_option_labels JSON",
                'group_id': "ALTER TABLE flashcards ADD COLUMN group_id INTEGER REFERENCES flashcard_groups(id)",
            }
            for col, sql in fc_missing.items():
                if col not in fc_columns:
                    logger.info(f"📥 检测到 flashcards 表缺少 {col} 列，正在添加...")
                    with engine.begin() as conn:
                        conn.execute(text(sql))
                    logger.info(f"✅ {col} 列添加成功")

        # ── flashcard_groups 表 ──
        if 'flashcard_groups' in inspector.get_table_names():
            for col_info in inspector.get_columns('flashcard_groups'):
                if col_info['name'] == 'document_id' and not col_info.get('nullable', True):
                    if engine.dialect.name == 'postgresql':
                        with engine.begin() as conn:
                            conn.execute(text("ALTER TABLE flashcard_groups ALTER COLUMN document_id DROP NOT NULL"))
                            logger.info("✅ flashcard_groups.document_id 已改为可空")

        # ── flashcard_generation_tasks 表 ──
        if 'flashcard_generation_tasks' in inspector.get_table_names():
            for col_info in inspector.get_columns('flashcard_generation_tasks'):
                if col_info['name'] == 'document_id' and not col_info.get('nullable', True):
                    if engine.dialect.name == 'postgresql':
                        with engine.begin() as conn:
                            conn.execute(text("ALTER TABLE flashcard_generation_tasks ALTER COLUMN document_id DROP NOT NULL"))
                            logger.info("✅ flashcard_generation_tasks.document_id 已改为可空")
            # 添加 focus_text 列
            existing_cols = {c['name'] for c in inspector.get_columns('flashcard_generation_tasks')}
            if 'focus_text' not in existing_cols:
                col_type = 'TEXT' if engine.dialect.name == 'postgresql' else 'TEXT'
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE flashcard_generation_tasks ADD COLUMN focus_text {col_type}"))
                    logger.info("✅ flashcard_generation_tasks.focus_text 列已添加")

        # ── artifact_records 表 ──
        if 'artifact_records' in inspector.get_table_names():
            ar_columns = [col['name'] for col in inspector.get_columns('artifact_records')]
            if 'expires_at' not in ar_columns:
                logger.info("检测到 artifact_records 表缺少 expires_at 列，正在添加...")
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE artifact_records ADD COLUMN expires_at TIMESTAMP"))
                logger.info("expires_at 列添加成功")

        # ── documents 表 ──
        if 'documents' in inspector.get_table_names():
            doc_columns = [col['name'] for col in inspector.get_columns('documents')]
            doc_missing = {}
            doc_col_defs = {
                'is_public': "ALTER TABLE documents ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT false",
                'content_hash': "ALTER TABLE documents ADD COLUMN content_hash VARCHAR(64)",
                'view_count': "ALTER TABLE documents ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0",
                'category': "ALTER TABLE documents ADD COLUMN category VARCHAR(200)",
                'file_size': "ALTER TABLE documents ADD COLUMN file_size INTEGER",
                'error_message': "ALTER TABLE documents ADD COLUMN error_message TEXT",
                'parsed_at': "ALTER TABLE documents ADD COLUMN parsed_at TIMESTAMP",
                'last_read_chapter_id': "ALTER TABLE documents ADD COLUMN last_read_chapter_id INTEGER REFERENCES chapters(id)",
            }
            for col, sql in doc_col_defs.items():
                if col not in doc_columns:
                    logger.info(f"📥 检测到 documents 表缺少 {col} 列，正在添加...")
                    try:
                        with engine.begin() as conn:
                            conn.execute(text(sql))
                        logger.info(f"✅ {col} 列添加成功")
                    except Exception as e:
                        logger.warning(f"⚠️  添加列 {col} 失败: {e}")

    except Exception as e:
        logger.warning(f"⚠️  检查/添加缺失列失败: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_dotenv()
    Base.metadata.create_all(bind=engine)
    _ensure_missing_columns()

    # Seed 默认 Agent 数据
    try:
        from sqlalchemy import select
        with engine.begin() as conn:
            result = conn.execute(select(Agent).limit(1))
            if result.first() is None:
                from app.services.agent_prompts import AGENT_DEFINITIONS
                for agent_def in AGENT_DEFINITIONS:
                    conn.execute(Agent.__table__.insert().values(
                        id=agent_def["id"], name=agent_def["name"],
                        role_desc=agent_def["role_desc"], system_prompt=agent_def["system_prompt"],
                        tools=agent_def.get("tools", []), icon=agent_def.get("icon", "🤖"),
                        phase=agent_def.get("phase", 1), is_active=agent_def.get("is_active", True),
                    ))
                logger.info(f"✅ Seed {len(AGENT_DEFINITIONS)} 个Agent完成")
    except Exception as e:
        logger.warning(f"Agent seed 跳过: {e}")

    logger.info("🚀 启动向量数据库服务...")
    try:
        from app.services.vector_db_service import vector_db_service, ZVEC_SERVICE_URL
        if vector_db_service:
            ok = vector_db_service.ensure_initialized()
            if not ok and ZVEC_SERVICE_URL:
                logger.warning("⚠️  zvec 微服务连接失败，向量功能可能受限")
        logger.info("✅ 向量数据库初始化完成")
    except Exception as e:
        logger.error(f"❌ 向量数据库初始化出错: {e}")

    logger.info("🚀 启动后台清理任务...")

    try:
        from app.services.remove_bg_client import startup as rembg_startup
        await rembg_startup()
    except Exception as e:
        logger.warning(f"rembg 服务启动失败: {e}")

    logger.info("🚀 启动博查网页搜索服务...")
    try:
        from app.services.web_search_request_manager import startup as web_search_startup
        await web_search_startup()
        logger.info("✅ 博查网页搜索服务启动完成")
    except Exception as e:
        logger.error(f"❌ 博查网页搜索服务启动失败: {e}")

    try:
        from app.services.tool_agent import tool_agent
        await tool_agent.start()
    except Exception as e:
        logger.warning(f"MCP Server 启动失败: {e}")

    logger.info("🚀 启动知识图谱后台构建 Worker...")
    try:
        from app.services.graph_build_worker import ensure_worker
        ensure_worker()
        logger.info("✅ 知识图谱后台构建 Worker 启动完成")
    except Exception as e:
        logger.warning(f"知识图谱 Worker 启动失败: {e}")

    logger.info("启动产物过期清理调度器...")
    try:
        from app.services.artifact_cleanup import start_cleanup_scheduler
        start_cleanup_scheduler()
        logger.info("产物过期清理调度器启动完成")
    except Exception as e:
        logger.warning(f"产物过期清理调度器启动失败: {e}")

    yield

    try:
        from app.services.tool_agent import tool_agent
        await tool_agent.stop()
    except Exception:
        pass

    try:
        from app.services.remove_bg_client import shutdown as rembg_shutdown
        rembg_shutdown()
    except Exception:
        pass


app = FastAPI(
    title="智能学习平台 API",
    description="基于 AI 的个人智能学习平台后端 API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(UserKeyMiddleware)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """记录所有 HTTP 请求"""
    logger.info(f"📨 收到请求: {request.method} {request.url}")
    logger.info(f"  请求头: {dict(request.headers)}")

    try:
        response = await call_next(request)
        logger.info(f"📤 响应状态: {response.status_code}")
        return response
    except Exception as e:
        logger.error(f"❌ 请求处理出错: {e}")
        raise


@app.get("/")
async def root():
    return {"message": "欢迎使用智能学习平台 API"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


app.include_router(api_router)
app.include_router(admin_router)
from app.api.v1.agent import router as agent_router
app.include_router(agent_router)

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))

uploads_dir = "/uploads"
os.makedirs(uploads_dir, exist_ok=True)
os.makedirs(os.path.join(uploads_dir, "tables"), exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

update_dir = os.path.join(_BASE_DIR, "update")
os.makedirs(update_dir, exist_ok=True)
app.mount("/update", StaticFiles(directory=update_dir), name="update")


# ─── AI API 反向代理（生产环境绕过 Zeabur 网络限制） ──────────
import httpx
from starlette.responses import StreamingResponse, Response


MODELBEST_TARGET = "https://api.modelbest.co/v1"

@app.api_route("/api/modelbest/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def modelbest_proxy(request: Request, path: str):
    """反向代理 /api/modelbest → https://api.modelbest.cn/v1（与 Vite 开发代理一致）"""
    target_url = f"{MODELBEST_TARGET}/{path}"
    headers = {k: v for k, v in request.headers.items()
               if k.lower() not in ("host", "content-length")}
    body = await request.body()
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=30.0)) as client:
        req = client.build_request(request.method, target_url,
                                   headers=headers, content=body)
        resp = await client.send(req, stream=True)
        if resp.headers.get("content-type", "").startswith("text/event-stream"):
            return StreamingResponse(
                resp.aiter_bytes(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
                status_code=resp.status_code,
            )
        return Response(
            content=await resp.aread(),
            status_code=resp.status_code,
            headers=dict(resp.headers),
        )


# WebSocket 端点
from app.core.websocket import flashcard_ws_manager

@app.websocket("/ws/flashcards/{user_id}")
async def websocket_flashcards(websocket: WebSocket, user_id: int):
    await flashcard_ws_manager.connect(user_id, websocket)
    try:
        await websocket.send_json({"type": "subscribed", "user_id": user_id})
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except Exception:
        pass
    finally:
        flashcard_ws_manager.disconnect(user_id, websocket)

from app.core.agent_websocket import agent_ws_manager

@app.websocket("/ws/agent/{user_id}")
async def agent_websocket(websocket: WebSocket, user_id: int):
    print(f"[MAIN] agent websocket connecting user={user_id}", flush=True)
    try:
        await agent_ws_manager.handle(user_id, websocket)
    except Exception as e:
        print(f"[MAIN] agent websocket error: {e}", flush=True)
        import traceback
        traceback.print_exc()
        try:
            await websocket.close(code=1011)
        except:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8080,
        reload=True,
    )
