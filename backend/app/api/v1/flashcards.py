from fastapi import APIRouter, Depends, HTTPException, Query, Request, BackgroundTasks
from sqlalchemy.orm import Session
from typing import Optional, List, Dict
import logging

from app.db.session import get_db
from app.models.user import User
from app.models.flashcard import FlashcardStatus
from app.schemas.flashcard import (
    Flashcard, FlashcardCreate, FlashcardUpdate, FlashcardList, FlashcardDueList,
    FlashcardStats, FlashcardReviewLog, FlashcardReviewRequest,
    FlashcardGenerateRequest, FlashcardGenerateResponse,
    CardGroup, CardGroupWithFlashcards, PublicGroupsByCategory,
    GenerationTaskResponse, GenerationTaskListResponse
)
from app.schemas.user import TokenData
from app.services.flashcard_service import flashcard_service
from app.api.v1.auth import get_current_user_dep

logger = logging.getLogger(__name__)
router = APIRouter(prefix="", tags=["flashcards"])


def model_to_dict(model):
    """将 SQLAlchemy 模型转换为字典"""
    if model is None:
        return None
    result = {}
    for column in model.__table__.columns:
        value = getattr(model, column.name)
        if hasattr(value, 'isoformat'):
            value = value.isoformat()
        elif hasattr(value, 'value'):
            value = value.value
        # 处理JSON类型
        if column.name in ['options'] and value is not None:
            if isinstance(value, str):
                import json
                try:
                    value = json.loads(value)
                except:
                    pass
        result[column.name] = value
    return result


@router.post("/generate", response_model=GenerationTaskResponse)
async def generate_flashcards(
    request: FlashcardGenerateRequest,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """从文档生成抽认卡（异步处理）"""
    try:
        logger.info(f"收到生成抽认卡请求: document_id={request.document_id}, "
                   f"max_cards={request.max_cards}")

        task = flashcard_service.create_generation_task(db, request, token_data.user_id)

        background_tasks.add_task(
            flashcard_service.generate_flashcards_async,
            task.id,
            token_data.user_id
        )

        return GenerationTaskResponse(
            id=task.id,
            document_id=request.document_id,
            status=task.status,
            total_chunks=task.total_chunks,
            processed_chunks=task.processed_chunks,
            total_cards=task.total_cards,
            max_cards=task.max_cards,
            focus_text=task.focus_text,
            created_at=task.created_at
        )

    except ValueError as e:
        logger.error(f"创建生成任务失败: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"创建生成任务异常: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"创建生成任务失败: {str(e)}")


@router.get("/tasks", response_model=GenerationTaskListResponse)
async def get_generation_tasks(
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取用户的生成任务列表"""
    try:
        tasks = flashcard_service.get_generation_tasks(db, token_data.user_id)
        active_count = sum(1 for t in tasks if t.status in ["pending", "processing"])
        return GenerationTaskListResponse(
            tasks=[GenerationTaskResponse(
                id=t.id,
                document_id=t.document_id,
                status=t.status,
                total_chunks=t.total_chunks,
                processed_chunks=t.processed_chunks,
                total_cards=t.total_cards,
                max_cards=t.max_cards,
                focus_text=t.focus_text,
                error_message=t.error_message,
                created_at=t.created_at
            ) for t in tasks],
            active_count=active_count
        )
    except Exception as e:
        logger.error(f"获取生成任务失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取生成任务失败: {str(e)}")


@router.get("/tasks/{task_id}", response_model=GenerationTaskResponse)
async def get_generation_task(
    task_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取指定生成任务的进度"""
    try:
        task = flashcard_service.get_generation_task(db, task_id, token_data.user_id)
        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")
        return GenerationTaskResponse(
            id=task.id,
            document_id=task.document_id,
            status=task.status,
            total_chunks=task.total_chunks,
            processed_chunks=task.processed_chunks,
            total_cards=task.total_cards,
            max_cards=task.max_cards,
            focus_text=task.focus_text,
            error_message=task.error_message,
            created_at=task.created_at
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取生成任务失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取生成任务失败: {str(e)}")


@router.post("/tasks/{task_id}/cancel")
async def cancel_generation_task(
    task_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """取消生成任务"""
    try:
        task = flashcard_service.get_generation_task(db, task_id, token_data.user_id)
        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")

        if task.status in ["completed", "failed"]:
            raise HTTPException(status_code=400, detail="任务已完成或失败，无法取消")

        flashcard_service.cancel_generation_task(db, task_id, token_data.user_id)

        return {"message": "任务已取消"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"取消生成任务失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"取消生成任务失败: {str(e)}")


@router.delete("/tasks/{task_id}")
async def delete_generation_task(
    task_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """删除生成任务"""
    try:
        task = flashcard_service.get_generation_task(db, task_id, token_data.user_id)
        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")

        if task.status not in ["failed", "cancelled"]:
            raise HTTPException(status_code=400, detail="只能删除失败或已取消的任务")

        flashcard_service.delete_generation_task(db, task_id)
        return {"message": "任务已删除"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除生成任务失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"删除生成任务失败: {str(e)}")


@router.get("", response_model=FlashcardList)
async def list_flashcards(
    skip: int = 0,
    limit: int = 100,
    document_id: Optional[int] = Query(None, description="按文档筛选"),
    status: Optional[str] = Query(None, description="按状态筛选"),
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取用户的抽认卡列表"""
    try:
        # 转换状态字符串为枚举
        status_enum = None
        if status:
            from app.models.flashcard import FlashcardStatus
            try:
                status_enum = FlashcardStatus(status)
            except ValueError:
                raise HTTPException(status_code=400, detail="无效的状态值")
        
        flashcards = flashcard_service.get_user_flashcards(
            db, token_data.user_id, skip, limit, document_id, status_enum
        )
        
        items = [model_to_dict(card) for card in flashcards]
        total = len(items)
        
        return FlashcardList(total=total, items=items)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取抽认卡列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取抽认卡列表失败: {str(e)}")


@router.get("/public", response_model=FlashcardList)
async def get_public_flashcards(
    skip: int = 0,
    limit: int = 100,
    document_id: Optional[int] = Query(None, description="按文档筛选"),
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取公开抽认卡（其他用户创建的公开卡片）"""
    try:
        # 查询公开卡片
        from app.models.flashcard import Flashcard
        query = db.query(Flashcard).filter(
            Flashcard.is_public == True,
            Flashcard.owner_id != token_data.user_id  # 排除用户自己的卡片
        )
        
        if document_id:
            query = query.filter(Flashcard.document_id == document_id)
        
        query = query.order_by(Flashcard.created_at.desc())
        
        if limit:
            query = query.offset(skip).limit(limit)
        
        flashcards = query.all()
        items = [model_to_dict(card) for card in flashcards]
        total = len(items)
        
        return FlashcardList(total=total, items=items)
        
    except Exception as e:
        logger.error(f"获取公开抽认卡失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取公开抽认卡失败: {str(e)}")


@router.get("/groups", response_model=None)
async def get_card_groups(
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取用户的抽认卡卡组列表"""
    try:
        from app.services.flashcard_service import flashcard_service
        groups = flashcard_service.get_user_card_groups(db, token_data.user_id)
        result = []
        for g in groups:
            group_dict = {
                "id": g.id,
                "name": g.name,
                "description": g.description,
                "document_id": g.document_id,
                "is_public": g.is_public,
                "category": g.document.category if g.document else None,
                "owner_id": g.owner_id,
                "card_count": g.card_count,
                "created_at": g.created_at.isoformat() if g.created_at else None,
                "updated_at": g.updated_at.isoformat() if g.updated_at else None,
                "document_title": g.document.title if g.document else None
            }
            result.append(group_dict)
        return result
    except Exception as e:
        logger.error(f"获取卡组列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取卡组列表失败: {str(e)}")


@router.get("/groups/public")
async def get_public_groups(
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取公开卡组列表"""
    logger.info(f"用户 {token_data.user_id} 请求获取公开卡组")
    
    try:
        from app.models.flashcard import CardGroup
        all_groups = db.query(CardGroup).all()
        logger.info(f"数据库中总共有 {len(all_groups)} 个卡组")
        for g in all_groups:
            logger.info(f"  卡组 {g.id}: {g.name}, public={g.is_public}, owner={g.owner_id}")
        
        groups = flashcard_service.get_public_card_groups(db, token_data.user_id)
        logger.info(f"找到 {len(groups)} 个公开卡组")
        
        result = []
        for g in groups:
            group_dict = {
                "id": g.id,
                "name": g.name,
                "description": g.description,
                "document_id": g.document_id,
                "is_public": g.is_public,
                "category": g.document.category if g.document else None,
                "owner_id": g.owner_id,
                "card_count": g.card_count,
                "created_at": g.created_at.isoformat() if g.created_at else None,
                "updated_at": g.updated_at.isoformat() if g.updated_at else None,
                "document_title": g.document.title if g.document else None
            }
            result.append(group_dict)
        
        logger.info(f"返回 {len(result)} 个公开卡组数据")
        return result
    except Exception as e:
        logger.error(f"获取公开卡组失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取公开卡组失败: {str(e)}")


@router.get("/groups/public/test")
async def test_public_groups():
    """测试端点"""
    return [{"id": 1, "name": "test", "description": None, "document_id": 1, "is_public": True, "category": "test", "owner_id": 1, "card_count": 0, "created_at": None, "updated_at": None, "document_title": "test"}]


@router.get("/groups/public/by-category")
async def get_public_groups_by_category(
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取按学科分类的公开卡组"""
    try:
        groups = flashcard_service.get_public_card_groups(db, token_data.user_id)

        # 按学科分类（使用文档的category）
        category_map: Dict[str, List[Dict]] = {}
        for group in groups:
            category = group.document.category if group.document and group.document.category else "未分类"
            if category not in category_map:
                category_map[category] = []
            category_map[category].append({
                "id": group.id,
                "name": group.name,
                "description": group.description,
                "document_id": group.document_id,
                "is_public": group.is_public,
                "category": group.document.category if group.document else None,
                "owner_id": group.owner_id,
                "card_count": group.card_count,
                "created_at": group.created_at.isoformat() if group.created_at else None,
                "updated_at": group.updated_at.isoformat() if group.updated_at else None,
                "document_title": group.document.title if group.document else None
            })

        # 转换为列表格式
        result = [
            {"category": cat, "groups": grps}
            for cat, grps in sorted(category_map.items())  # 按学科名称排序
        ]
        return result
    except Exception as e:
        logger.error(f"获取分类公开卡组失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取分类公开卡组失败: {str(e)}")


@router.post("/groups/{group_id}/copy")
async def copy_group(
    group_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """复制卡组到用户账户"""
    try:
        success, message, new_group_id = flashcard_service.copy_group_to_user(db, group_id, token_data.user_id)
        if not success:
            raise HTTPException(status_code=400, detail=message)
        return {"message": message, "group_id": new_group_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"复制卡组失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"复制卡组失败: {str(e)}")


@router.put("/groups/{group_id}/toggle-public")
async def toggle_group_public(
    group_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """切换卡组的公开状态"""
    try:
        from app.models.flashcard import CardGroup
        
        group = db.query(CardGroup).filter(
            CardGroup.id == group_id,
            CardGroup.owner_id == token_data.user_id
        ).first()
        
        if not group:
            raise HTTPException(status_code=404, detail="卡组不存在或无权修改")
        
        group.is_public = not group.is_public
        db.commit()
        
        logger.info(f"用户 {token_data.user_id} 切换卡组 {group_id} 公开状态为 {group.is_public}")
        
        return {
            "message": "卡组公开状态已更新",
            "is_public": group.is_public
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"切换卡组公开状态失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"切换失败: {str(e)}")


@router.delete("/groups/{group_id}")
async def delete_card_group(
    group_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """删除卡组（只能删除自己的卡组）"""
    try:
        success = flashcard_service.delete_card_group(db, group_id, token_data.user_id)
        if not success:
            raise HTTPException(status_code=404, detail="卡组不存在或无权删除")
        return {"message": "卡组删除成功！"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除卡组失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"删除卡组失败: {str(e)}")


@router.get("/groups/{group_id}", response_model=CardGroupWithFlashcards)
async def get_card_group_with_flashcards(
    group_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取卡组及其包含的抽认卡"""
    try:
        group = flashcard_service.get_card_group_with_flashcards(db, group_id, token_data.user_id)
        if not group:
            raise HTTPException(status_code=404, detail="卡组不存在")

        # 手动构建响应，确保flashcards正确序列化
        flashcards_data = []
        for card in group.flashcards:
            flashcards_data.append(model_to_dict(card))

        # 构建返回对象
        from app.schemas.flashcard import Flashcard
        return CardGroupWithFlashcards(
            id=group.id,
            name=group.name,
            description=group.description,
            document_id=group.document_id,
            is_public=group.is_public,
            category=group.document.category if group.document else None,
            owner_id=group.owner_id,
            card_count=group.card_count,
            created_at=group.created_at,
            updated_at=group.updated_at,
            document_title=group.document.title if group.document else None,
            flashcards=[Flashcard(**data) for data in flashcards_data]
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取卡组详情失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取卡组详情失败: {str(e)}")


@router.get("/due", response_model=FlashcardDueList)
async def get_due_flashcards(
    limit: int = 100,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取到期的抽认卡（用于每日复习）"""
    try:
        flashcards = flashcard_service.get_due_flashcards(db, token_data.user_id, limit)
        
        now = datetime.now(timezone.utc)
        due_today = 0
        overdue = 0
        
        for card in flashcards:
            if card.due and card.due.date() == now.date():
                due_today += 1
            elif card.due and card.due < now:
                overdue += 1
            elif not card.due:  # 新建卡片
                due_today += 1
        
        items = [model_to_dict(card) for card in flashcards]
        total = len(items)
        
        return FlashcardDueList(
            total=total,
            due_today=due_today,
            overdue=overdue,
            items=items
        )
        
    except Exception as e:
        logger.error(f"获取到期抽认卡失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取到期抽认卡失败: {str(e)}")


@router.get("/stats", response_model=FlashcardStats)
async def get_flashcard_stats(
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取抽认卡统计信息"""
    try:
        stats = flashcard_service.get_flashcard_stats(db, token_data.user_id)
        return FlashcardStats(**stats)
    except Exception as e:
        logger.error(f"获取抽认卡统计失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取抽认卡统计失败: {str(e)}")


@router.get("/{flashcard_id}", response_model=dict)
async def get_flashcard(
    flashcard_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取单个抽认卡"""
    flashcard = flashcard_service.get_flashcard(db, flashcard_id, token_data.user_id)
    if not flashcard:
        raise HTTPException(status_code=404, detail="抽认卡未找到")
    
    return model_to_dict(flashcard)


@router.post("", response_model=dict)
async def create_flashcard(
    flashcard_data: FlashcardCreate,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """创建手动抽认卡"""
    try:
        flashcard = flashcard_service.create_flashcard(db, flashcard_data, token_data.user_id)
        return model_to_dict(flashcard)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"创建抽认卡失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"创建抽认卡失败: {str(e)}")


@router.put("/{flashcard_id}", response_model=dict)
async def update_flashcard(
    flashcard_id: int,
    update_data: FlashcardUpdate,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """更新抽认卡"""
    flashcard = flashcard_service.update_flashcard(db, flashcard_id, update_data, token_data.user_id)
    if not flashcard:
        raise HTTPException(status_code=404, detail="抽认卡未找到")
    
    return model_to_dict(flashcard)


@router.post("/{flashcard_id}/copy", response_model=dict)
async def copy_flashcard(
    flashcard_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """复制公开抽认卡到用户账户"""
    try:
        # 复制卡片
        new_card = flashcard_service.copy_flashcard_to_user(db, flashcard_id, token_data.user_id)
        
        if not new_card:
            raise HTTPException(status_code=400, detail="无法复制该抽认卡")
        
        return {
            "success": True,
            "message": "抽认卡复制成功",
            "flashcard_id": new_card.id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"复制抽认卡失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"复制抽认卡失败: {str(e)}")


@router.delete("/{flashcard_id}", response_model=dict)
async def delete_flashcard(
    flashcard_id: int,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """删除抽认卡"""
    success = flashcard_service.delete_flashcard(db, flashcard_id, token_data.user_id)
    if not success:
        raise HTTPException(status_code=404, detail="抽认卡未找到")
    
    return {"success": True, "message": "抽认卡删除成功"}


@router.post("/{flashcard_id}/review", response_model=dict)
async def review_flashcard(
    flashcard_id: int,
    review_request: FlashcardReviewRequest,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """复习抽认卡"""
    try:
        # 获取客户端信息（简化处理）
        ip_address = None
        user_agent = None
        
        flashcard = flashcard_service.review_flashcard(
            db, flashcard_id, review_request, token_data.user_id, ip_address, user_agent
        )
        
        if not flashcard:
            raise HTTPException(status_code=404, detail="抽认卡未找到")
        
        return model_to_dict(flashcard)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"复习抽认卡失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"复习抽认卡失败: {str(e)}")


@router.get("/{flashcard_id}/logs", response_model=List[dict])
async def get_flashcard_review_logs(
    flashcard_id: int,
    limit: int = 50,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取抽认卡的复习日志"""
    from app.models.flashcard import FlashcardReviewLog
    
    # 先验证用户有权访问该抽认卡
    flashcard = flashcard_service.get_flashcard(db, flashcard_id, token_data.user_id)
    if not flashcard:
        raise HTTPException(status_code=404, detail="抽认卡未找到")
    
    logs = db.query(FlashcardReviewLog).filter(
        FlashcardReviewLog.flashcard_id == flashcard_id
    ).order_by(
        FlashcardReviewLog.review_time.desc()
    ).limit(limit).all()
    
    return [model_to_dict(log) for log in logs]


@router.get("/documents/{document_id}", response_model=FlashcardList)
async def get_document_flashcards(
    document_id: int,
    skip: int = 0,
    limit: int = 100,
    token_data: TokenData = Depends(get_current_user_dep),
    db: Session = Depends(get_db)
):
    """获取文档关联的抽认卡"""
    from app.models.document import Document
    
    # 验证文档存在且用户有权访问
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="文档未找到")
    
    if document.owner_id != token_data.user_id and not document.is_public:
        raise HTTPException(status_code=403, detail="无权访问此文档")
    
    flashcards = flashcard_service.get_user_flashcards(
        db, token_data.user_id, skip, limit, document_id, None
    )
    
    items = [model_to_dict(card) for card in flashcards]
    total = len(items)
    
    return FlashcardList(total=total, items=items)


# 导入datetime
from datetime import datetime, timezone