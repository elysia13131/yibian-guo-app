from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
import logging
import json
import asyncio
import re
import base64
import os
import unicodedata
from app.services.ai_service import ai_service
from app.services.minicpm_service import minicpm_service
from app.db.session import get_db
from app.models.document import ReadingSession, ReadingRecord, DailyStats, Document, Chapter, DocumentStatus
from app.schemas.document import (
    ReadingSessionCreate, ReadingSession as ReadingSessionSchema,
    ReadingRecordCreate, ReadingRecordUpdate, ReadingRecord as ReadingRecordSchema,
    DailyStats as DailyStatsSchema, LearningOverview, WeeklyStats, Achievement,
    AnalyticsResponse
)
from app.api.v1.auth import get_current_user_dep
from app.schemas.user import TokenData

logger = logging.getLogger(__name__)
router = APIRouter(tags=["analysis"])


class QuestionAnalysisRequest(BaseModel):
    question: str
    content: Optional[str] = None
    options: Optional[List[str]] = None
    answer: Optional[str] = None
    knowledge_points: Optional[List[str]] = None


class QuestionAnalysisResponse(BaseModel):
    knowledge_points: List[str]
    analysis: str
    answer: Optional[str] = None
    related_questions: List[dict]
    related_paragraphs: List[dict]


@router.post("/analyze-question", response_model=QuestionAnalysisResponse)
async def analyze_question(request: QuestionAnalysisRequest):
    """分析题目，生成知识点关联和解析"""
    try:
        prompt_parts = []

        prompt_parts.append(f"题目：{request.question}")

        if request.content:
            content_preview = request.content.replace("\n", " ")
            prompt_parts.append(f"题目正文：{content_preview}")

        if request.options:
            prompt_parts.append("选项：")
            for i, opt in enumerate(request.options):
                prompt_parts.append(f"  {chr(65+i)}. {opt}")

        prompt_parts.append("\n请从以下三方面分析：")
        prompt_parts.append("1. 知识点：列出涉及的知识点")
        prompt_parts.append("2. 解析：简要解析题目")
        prompt_parts.append("3. 答案：给出答案（如果能判断）")

        prompt = "\n".join(prompt_parts)

        result = await ai_service.generate_text(
            prompt,
            temperature=0.3
        )

        logger.info(f"AI原始返回: {result}")

        knowledge_points = []
        answer = None

        lines = result.strip().split("\n") if result else []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if (line.startswith("知识点：") or line.startswith("知识点:")) and ":" in line:
                kp_part = line.split(":", 1)[1].strip()
                kp_part = kp_part.replace("、", ",").replace("，", ",")
                knowledge_points = [kp.strip() for kp in kp_part.split(",") if kp.strip()][:3]
            elif (line.startswith("答案：") or line.startswith("答案:")) and ":" in line:
                answer_part = line.split(":", 1)[1].strip()
                if answer_part and answer_part not in ["无", "无法判断", "无法确定", "不能确定"]:
                    answer = answer_part

        if request.knowledge_points:
            for kp in request.knowledge_points:
                if kp not in knowledge_points:
                    knowledge_points.append(kp)
            knowledge_points = knowledge_points[:3]

        if request.answer:
            answer = None

        return QuestionAnalysisResponse(
            knowledge_points=knowledge_points if knowledge_points else ["基础知识"],
            analysis=result or "AI 分析暂未生成内容",
            answer=answer,
            related_questions=[],
            related_paragraphs=[]
        )
    except Exception as e:
        logger.error(f"题目分析失败: {e}")
        return QuestionAnalysisResponse(
            knowledge_points=["基础知识"],
            analysis="分析生成失败",
            answer=None,
            related_questions=[],
            related_paragraphs=[]
        )


@router.post("/analyze-question-stream")
async def analyze_question_stream(request: QuestionAnalysisRequest):
    """流式分析题目，使用 MiniCPM-V-4.6-Thinking 多模态模型，支持图片理解"""
    content_parts = []

    text = f"题目：{request.question}"
    if request.content:
        content_preview = request.content.replace("\n", " ")
        text += f"\n题目正文：{content_preview}"
    if request.options:
        text += "\n选项："
        for i, opt in enumerate(request.options):
            text += f"\n{chr(65+i)}. {opt}"

    text += "\n\n请严格按照以下 Markdown 格式分析（如有公式请使用 $...$ 行内或 $$...$$ 独立行展现）："
    text += "\n\n#### 1. 知识点"
    text += "\n列出本题涉及的所有知识点/考点，每行一个，并简要说明如何应用。"
    text += "\n\n#### 2. 解析"
    text += "\n逐步推导解题过程，包括："
    text += "\n- 梳理已知条件与所求目标"
    text += "\n- 关键原理、公式或逻辑的引用"
    text += "\n- 每一步的推理与运算过程"
    text += "\n- 最终结论"
    text += "\n\n#### 3. 答案"
    text += "\n明确给出最终答案。若有多个小问，分点列出。"

    content_parts.append({"type": "text", "text": text})

    if request.content:
        img_paths = re.findall(r'\[图片:([^\]]+)\]', request.content)
        for p in img_paths:
            if os.path.exists(p):
                try:
                    with open(p, 'rb') as f:
                        b64 = base64.b64encode(f.read()).decode('utf-8')
                    content_parts.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{b64}"}
                    })
                except Exception as e:
                    logger.warning(f"读取图片失败 {p}: {e}")

    messages = [{"role": "user", "content": content_parts}]

    def normalize_text(text: str) -> str:
        chars = {
            '\u2212': '-', '\u2215': '/', '\u00D7': '\u00d7',
            '\u00B7': '*', '\u2013': '-', '\u2014': '--',
            '\uFF0D': '-', '\uFF0F': '/',
        }
        for old, new in chars.items():
            text = text.replace(old, new)
        return text

    async def event_stream():
        full_reasoning = ""
        full_content = ""
        try:
            async for chunk in minicpm_service.generate_text_stream(messages):
                step = chunk["step"]
                token = normalize_text(chunk["token"])
                if step == "reasoning":
                    full_reasoning += token
                    yield f"data: {json.dumps({'step': 'reasoning', 'token': token, 'full': full_reasoning})}\n\n"
                elif step == "content":
                    full_content += token
                    yield f"data: {json.dumps({'step': 'content', 'token': token, 'full': full_content})}\n\n"

            if not full_content and not full_reasoning:
                result = await minicpm_service.generate_text(messages)
                full_reasoning = normalize_text(result.get("reasoning", ""))
                full_content = normalize_text(result.get("content", ""))
                if full_reasoning:
                    yield f"data: {json.dumps({'step': 'reasoning', 'token': full_reasoning, 'full': full_reasoning})}\n\n"
                if full_content:
                    yield f"data: {json.dumps({'step': 'content', 'token': full_content, 'full': full_content})}\n\n"

            yield f"data: {json.dumps({'done': True, 'reasoning': full_reasoning, 'content': full_content})}\n\n"
        except Exception as e:
            logger.error(f"MiniCPM流式分析失败: {e}", exc_info=True)
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.get("/stream-test")
async def stream_test():
    """测试流式端点"""
    async def test_stream():
        for i in range(10):
            token = f"token{i}"
            yield f"data: {json.dumps({'token': token, 'full': ''.join([f'token{j}' for j in range(i+1)])})}\n\n"
            await asyncio.sleep(0.2)
        yield f"data: {json.dumps({'done': True, 'full': ''.join([f'token{j}' for j in range(10)])})}\n\n"

    return StreamingResponse(
        test_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.get("/related-questions/{question_id}")
async def get_related_questions(question_id: str, limit: int = 5):
    """获取相关题目"""
    try:
        doc = vector_db_service.get_document(question_id)
        if not doc:
            raise HTTPException(status_code=404, detail="题目未找到")

        results = vector_db_service.search(query=doc["content"], n_results=limit + 1)

        related = [
            {
                "id": r["id"],
                "content": r["content"][:200] + "..." if len(r["content"]) > 200 else r["content"],
                "distance": round(r["distance"], 3),
                "metadata": r.get("metadata", {})
            }
            for r in results if r["id"] != question_id
        ][:limit]

        return {"success": True, "related_questions": related}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取相关题目失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sessions", response_model=ReadingSessionSchema)
async def create_reading_session(
    request: ReadingSessionCreate,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """创建阅读会话"""
    session = ReadingSession(document_id=request.document_id, user_id=token_data.user_id)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.put("/sessions/{session_id}/end", response_model=ReadingSessionSchema)
async def end_reading_session(
    session_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """结束阅读会话"""
    session = db.query(ReadingSession).filter(
        ReadingSession.id == session_id,
        ReadingSession.user_id == token_data.user_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话未找到")

    session.end_time = datetime.now(timezone.utc)
    if session.start_time and session.end_time:
        session.total_duration = int((session.end_time - session.start_time).total_seconds())

    db.commit()
    db.refresh(session)

    # 更新每日统计
    update_daily_stats(db, session.end_time.date(), token_data.user_id)

    return session


@router.post("/records", response_model=ReadingRecordSchema)
async def create_reading_record(
    request: ReadingRecordCreate,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """创建阅读记录"""
    session = db.query(ReadingSession).filter(
        ReadingSession.id == request.session_id,
        ReadingSession.user_id == token_data.user_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话未找到")

    record = ReadingRecord(
        session_id=request.session_id,
        chapter_id=request.chapter_id
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.put("/records/{record_id}", response_model=ReadingRecordSchema)
async def update_reading_record(
    record_id: int,
    request: ReadingRecordUpdate,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """更新阅读记录"""
    record = db.query(ReadingRecord).filter(ReadingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="记录未找到")

    session = db.query(ReadingSession).filter(
        ReadingSession.id == record.session_id,
        ReadingSession.user_id == token_data.user_id
    ).first()
    if not session:
        raise HTTPException(status_code=403, detail="无权访问此记录")

    update_data = request.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(record, field, value)

    db.commit()
    db.refresh(record)
    return record


@router.get("/overview", response_model=LearningOverview)
async def get_learning_overview(
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取学习总览统计"""
    today = datetime.now().date()
    week_start = today - timedelta(days=today.weekday())
    last_week_start = week_start - timedelta(weeks=1)
    last_week_end = week_start - timedelta(days=1)

    user_filter = ReadingSession.user_id == token_data.user_id

    # 总学习时长（分钟）
    total_seconds = db.query(func.sum(ReadingSession.total_duration))\
        .filter(user_filter).scalar() or 0
    total_minutes = round(total_seconds / 60)

    # 本周学习时长（分钟）
    weekly_seconds = db.query(func.sum(ReadingSession.total_duration))\
        .filter(user_filter)\
        .filter(ReadingSession.start_time >= week_start).scalar() or 0
    weekly_minutes = round(weekly_seconds / 60)

    # 上周学习时长（分钟）
    last_weekly_seconds = db.query(func.sum(ReadingSession.total_duration))\
        .filter(user_filter)\
        .filter(ReadingSession.start_time >= last_week_start)\
        .filter(ReadingSession.start_time <= last_week_end).scalar() or 0
    last_weekly_minutes = round(last_weekly_seconds / 60)

    # 学习时长变化
    study_minutes_change = 0
    if last_weekly_minutes > 0:
        study_minutes_change = round(((weekly_minutes - last_weekly_minutes) / last_weekly_minutes) * 100, 1)

    # 连续学习天数
    consecutive_days = calculate_consecutive_days(db, token_data.user_id)

    # 总阅读章节数
    total_chapters = db.query(func.count(ReadingRecord.id))\
        .join(ReadingSession)\
        .filter(ReadingSession.user_id == token_data.user_id)\
        .filter(ReadingRecord.is_completed == True).scalar() or 0

    # 本周完成章节数
    weekly_chapters = db.query(func.count(ReadingRecord.id))\
        .join(ReadingSession)\
        .filter(ReadingSession.user_id == token_data.user_id)\
        .filter(ReadingSession.start_time >= week_start)\
        .filter(ReadingRecord.is_completed == True).scalar() or 0

    # 上周完成章节数
    last_weekly_chapters = db.query(func.count(ReadingRecord.id))\
        .join(ReadingSession)\
        .filter(ReadingSession.user_id == token_data.user_id)\
        .filter(ReadingSession.start_time >= last_week_start)\
        .filter(ReadingSession.start_time <= last_week_end)\
        .filter(ReadingRecord.is_completed == True).scalar() or 0

    # 总访问文档数
    total_documents = db.query(func.count(func.distinct(ReadingSession.document_id)))\
        .filter(user_filter).scalar() or 0

    # 计算学习效率 = (完成的章节数 / 学习小时数) * 10，上限100%
    study_efficiency = 0.0
    total_hours = total_minutes / 60
    if total_hours > 0 and total_chapters > 0:
        efficiency_score = min(100, (total_chapters / total_hours) * 10)
        study_efficiency = round(efficiency_score, 1)

    # 计算本周效率
    weekly_hours = weekly_minutes / 60
    weekly_efficiency = 0.0
    if weekly_hours > 0 and weekly_chapters > 0:
        weekly_efficiency = min(100, (weekly_chapters / weekly_hours) * 10)

    # 计算上周效率
    last_weekly_hours = last_weekly_minutes / 60
    last_weekly_efficiency = 0.0
    if last_weekly_hours > 0 and last_weekly_chapters > 0:
        last_weekly_efficiency = min(100, (last_weekly_chapters / last_weekly_hours) * 10)

    # 效率变化百分比
    efficiency_change = 0
    if last_weekly_efficiency > 0:
        efficiency_change = round(((weekly_efficiency - last_weekly_efficiency) / last_weekly_efficiency) * 100, 1)

    return LearningOverview(
        total_study_minutes=total_minutes,
        weekly_study_minutes=weekly_minutes,
        study_minutes_change=study_minutes_change,
        study_efficiency=study_efficiency,
        efficiency_change=efficiency_change,
        consecutive_study_days=consecutive_days,
        total_chapters_read=total_chapters,
        total_documents_accessed=total_documents
    )


@router.get("/analytics", response_model=AnalyticsResponse)
async def get_analytics(
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取完整的分析数据"""
    overview = await get_learning_overview(token_data, db)

    week_days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    today = datetime.now().date()
    week_start = today - timedelta(days=today.weekday())

    weekly_data = []
    for i in range(7):
        day_date = week_start + timedelta(days=i)
        day_start = datetime.combine(day_date, datetime.min.time())
        day_end = datetime.combine(day_date, datetime.max.time())

        day_seconds = db.query(func.sum(ReadingSession.total_duration))\
            .filter(ReadingSession.user_id == token_data.user_id)\
            .filter(ReadingSession.start_time >= day_start)\
            .filter(ReadingSession.start_time <= day_end).scalar() or 0
        day_minutes = round(day_seconds / 60)

        weekly_data.append(WeeklyStats(
            day=week_days[i],
            minutes=day_minutes
        ))

    achievements = [
        Achievement(title="连续学习7天", icon="award", unlocked=overview.consecutive_study_days >= 7),
        Achievement(title="学习时长1000分钟", icon="clock", unlocked=overview.total_study_minutes >= 1000),
        Achievement(title="掌握100个概念", icon="target", unlocked=overview.total_chapters_read >= 100),
        Achievement(title="月度学习之星", icon="trending-up", unlocked=overview.weekly_study_minutes >= 600)
    ]

    return AnalyticsResponse(
        overview=overview,
        weekly_data=weekly_data,
        achievements=achievements
    )


def calculate_consecutive_days(db: Session, user_id: int) -> int:
    """计算连续学习天数"""
    today = datetime.now().date()
    consecutive_days = 0

    daily_stats = db.query(DailyStats)\
        .filter(DailyStats.total_duration > 0)\
        .order_by(desc(DailyStats.date))\
        .all()

    if not daily_stats:
        return 0

    latest_date = datetime.strptime(daily_stats[0].date, "%Y-%m-%d").date()
    if latest_date != today and latest_date != today - timedelta(days=1):
        return 0

    expected_date = today
    for stat in daily_stats:
        stat_date = datetime.strptime(stat.date, "%Y-%m-%d").date()
        if stat_date == expected_date or stat_date == expected_date - timedelta(days=1):
            consecutive_days += 1
            expected_date = stat_date - timedelta(days=1)
        else:
            break

    return consecutive_days


def update_daily_stats(db: Session, date_obj, user_id: int):
    """更新每日统计"""
    date_str = date_obj.strftime("%Y-%m-%d")
    day_start = datetime.combine(date_obj, datetime.min.time())
    day_end = datetime.combine(date_obj, datetime.max.time())

    day_seconds = db.query(func.sum(ReadingSession.total_duration))\
        .filter(ReadingSession.user_id == user_id)\
        .filter(ReadingSession.start_time >= day_start)\
        .filter(ReadingSession.start_time <= day_end).scalar() or 0

    day_chapters = db.query(func.count(ReadingRecord.id))\
        .join(ReadingSession)\
        .filter(ReadingSession.user_id == user_id)\
        .filter(ReadingSession.start_time >= day_start)\
        .filter(ReadingSession.start_time <= day_end)\
        .filter(ReadingRecord.is_completed == True).scalar() or 0

    day_documents = db.query(func.count(func.distinct(ReadingSession.document_id)))\
        .filter(ReadingSession.user_id == user_id)\
        .filter(ReadingSession.start_time >= day_start)\
        .filter(ReadingSession.start_time <= day_end).scalar() or 0

    daily_stat = db.query(DailyStats).filter(DailyStats.date == date_str).first()
    if not daily_stat:
        daily_stat = DailyStats(date=date_str)
        db.add(daily_stat)

    daily_stat.total_duration = day_seconds
    daily_stat.chapters_read = day_chapters
    daily_stat.documents_accessed = day_documents

    db.commit()


@router.get("/documents/{document_id}/progress")
async def get_document_reading_progress(
    document_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取文档的阅读进度"""
    document = db.query(Document).filter(
        Document.id == document_id,
        Document.owner_id == token_data.user_id
    ).first()
    if not document:
        raise HTTPException(status_code=404, detail="文档未找到")

    max_level_result = db.query(func.max(Chapter.level))\
        .filter(Chapter.document_id == document_id).scalar()

    if max_level_result is None:
        return {
            "document_id": document_id,
            "total_chapters": 0,
            "read_chapters": 0,
            "progress_percent": 0
        }

    max_level = max_level_result

    total_chapters = db.query(func.count(Chapter.id))\
        .filter(Chapter.document_id == document_id)\
        .filter(Chapter.level == max_level).scalar() or 0

    if total_chapters == 0:
        return {
            "document_id": document_id,
            "total_chapters": 0,
            "read_chapters": 0,
            "progress_percent": 0
        }

    read_chapters = db.query(ReadingRecord.chapter_id)\
        .join(ReadingSession)\
        .join(Chapter)\
        .filter(ReadingSession.user_id == token_data.user_id)\
        .filter(ReadingSession.document_id == document_id)\
        .filter(Chapter.level == max_level)\
        .distinct().count()

    progress_percent = round((read_chapters / total_chapters) * 100) if total_chapters > 0 else 0

    return {
        "document_id": document_id,
        "total_chapters": total_chapters,
        "read_chapters": read_chapters,
        "progress_percent": progress_percent
    }


@router.get("/documents/progress")
async def get_all_documents_progress(
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取所有文档的阅读进度"""
    documents = db.query(Document).filter(
        Document.status == DocumentStatus.COMPLETED,
        Document.owner_id == token_data.user_id
    ).all()

    result = []
    for doc in documents:
        max_level_result = db.query(func.max(Chapter.level))\
            .filter(Chapter.document_id == doc.id).scalar()

        if max_level_result is None:
            continue

        max_level = max_level_result

        total_chapters = db.query(func.count(Chapter.id))\
            .filter(Chapter.document_id == doc.id)\
            .filter(Chapter.level == max_level).scalar() or 0

        read_chapters = 0
        if total_chapters > 0:
            read_chapters = db.query(ReadingRecord.chapter_id)\
                .join(ReadingSession)\
                .join(Chapter)\
                .filter(ReadingSession.user_id == token_data.user_id)\
                .filter(ReadingSession.document_id == doc.id)\
                .filter(Chapter.level == max_level)\
                .distinct().count()

        progress_percent = round((read_chapters / total_chapters) * 100) if total_chapters > 0 else 0

        result.append({
            "document_id": doc.id,
            "total_chapters": total_chapters,
            "read_chapters": read_chapters,
            "progress_percent": progress_percent
        })

    return {"documents": result}