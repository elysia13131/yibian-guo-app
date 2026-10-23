import logging
import math
import re
import asyncio
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Dict, Any, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func, case, cast as sa_cast, Float

from app.models.flashcard import Flashcard, FlashcardReviewLog, FlashcardRating, FlashcardStatus, CardGroup, GenerationTask
from app.models.document import Document, Chapter
from app.models.user import User
from app.schemas.flashcard import (
    FlashcardCreate, FlashcardUpdate, FlashcardReviewRequest,
    FlashcardReviewLogCreate, FlashcardGenerateRequest
)
from app.services.flashcard_generator import flashcard_generator, GeneratedFlashcard

logger = logging.getLogger(__name__)

CHUNK_SIZE = 2000
MAX_CONCURRENT_TASKS = 20
MAX_RETRIES = 3
RETRY_DELAY = 2


def get_ws_manager():
    """延迟导入 WebSocket manager 以避免循环导入"""
    from app.core.websocket import flashcard_ws_manager
    return flashcard_ws_manager


class FlashcardService:
    """抽认卡服务类"""
    
    # FSRS默认参数（根据官方推荐）
    FSRS_DEFAULT_DIFFICULTY = 0.0
    FSRS_DEFAULT_STABILITY = 0.0
    FSRS_DEFAULT_RETRIEVABILITY = 0.0
    
    def __init__(self):
        # 尝试导入fsrs库
        try:
            import fsrs
            self.fsrs = fsrs
            self.FSRS_AVAILABLE = True
            logger.info("FSRS库加载成功")
        except ImportError as e:
            logger.warning(f"FSRS库不可用: {e}")
            self.fsrs = None
            self.FSRS_AVAILABLE = False
    
    def create_flashcard(self, db: Session, flashcard_data: FlashcardCreate, owner_id: int) -> Flashcard:
        """创建抽认卡"""
        # 验证文档存在且用户有权访问
        document = db.query(Document).filter(Document.id == flashcard_data.document_id).first()
        if not document:
            raise ValueError("文档不存在")
        
        if document.owner_id != owner_id and not document.is_public:
            raise ValueError("无权访问此文档")
        
        # 如果指定了章节，验证章节存在
        if flashcard_data.chapter_id:
            chapter = db.query(Chapter).filter(
                Chapter.id == flashcard_data.chapter_id,
                Chapter.document_id == flashcard_data.document_id
            ).first()
            if not chapter:
                raise ValueError("章节不存在")
        
        # 创建抽认卡
        flashcard = Flashcard(
            **flashcard_data.model_dump(),
            owner_id=owner_id,
            difficulty=self.FSRS_DEFAULT_DIFFICULTY,
            stability=self.FSRS_DEFAULT_STABILITY,
            retrievability=self.FSRS_DEFAULT_RETRIEVABILITY,
            status=FlashcardStatus.NEW,
            due=None,
            next_review=None,
            last_reviewed=None
        )
        
        db.add(flashcard)
        db.commit()
        db.refresh(flashcard)
        
        logger.info(f"抽认卡创建成功: id={flashcard.id}, document={flashcard.document_id}")
        return flashcard
    
    def get_flashcard(self, db: Session, flashcard_id: int, owner_id: int) -> Optional[Flashcard]:
        """获取单个抽认卡"""
        flashcard = db.query(Flashcard).filter(Flashcard.id == flashcard_id).first()
        
        if not flashcard:
            return None
        
        # 检查权限：所有者可以访问，公开抽认卡也可访问
        if flashcard.owner_id != owner_id and not flashcard.is_public:
            return None
        
        return flashcard
    
    def get_user_flashcards(
        self, 
        db: Session, 
        owner_id: int, 
        skip: int = 0, 
        limit: int = 100,
        document_id: Optional[int] = None,
        status: Optional[FlashcardStatus] = None
    ) -> List[Flashcard]:
        """获取用户的抽认卡列表（仅用户自己的卡片）"""
        query = db.query(Flashcard).filter(Flashcard.owner_id == owner_id)
        
        if document_id:
            query = query.filter(Flashcard.document_id == document_id)
        
        if status:
            query = query.filter(Flashcard.status == status)
        
        query = query.order_by(Flashcard.created_at.desc())
        
        if limit:
            query = query.offset(skip).limit(limit)
        
        return query.all()
    
    def get_available_flashcards(
        self,
        db: Session,
        user_id: int,
        skip: int = 0,
        limit: int = 100,
        document_id: Optional[int] = None,
        include_public: bool = True
    ) -> List[Flashcard]:
        """获取可用的抽认卡列表（用户自己的卡片 + 公开卡片）"""
        query = db.query(Flashcard).filter(
            or_(
                Flashcard.owner_id == user_id,
                Flashcard.is_public == True
            )
        )
        
        if document_id:
            query = query.filter(Flashcard.document_id == document_id)
        
        query = query.order_by(
            Flashcard.owner_id == user_id,  # 自己的卡片在前
            Flashcard.created_at.desc()
        )
        
        if limit:
            query = query.offset(skip).limit(limit)
        
        return query.all()
    
    def copy_flashcard_to_user(self, db: Session, flashcard_id: int, user_id: int) -> Optional[Flashcard]:
        """复制公开抽认卡到用户账户"""
        # 获取原始卡片
        original = db.query(Flashcard).filter(Flashcard.id == flashcard_id).first()
        if not original:
            return None
        
        # 检查是否已经是用户的卡片
        if original.owner_id == user_id:
            return original
        
        # 检查卡片是否公开（只有公开卡片可以被复制）
        if not original.is_public:
            return None
        
        # 创建副本
        copy_data = FlashcardCreate(
            question=original.question,
            answer=original.answer,
            document_id=original.document_id,
            chapter_id=original.chapter_id,
            source_text=original.source_text,
            is_public=False  # 副本默认不公开
        )
        
        # 创建新卡片
        try:
            new_card = self.create_flashcard(db, copy_data, user_id)
            new_card.ai_generated = original.ai_generated
            new_card.confidence = original.confidence
            new_card.source_text = original.source_text
            
            # 复制FSRS参数（重置为初始状态）
            new_card.difficulty = self.FSRS_DEFAULT_DIFFICULTY
            new_card.stability = self.FSRS_DEFAULT_STABILITY
            new_card.retrievability = self.FSRS_DEFAULT_RETRIEVABILITY
            new_card.status = FlashcardStatus.NEW
            new_card.due = None
            new_card.next_review = None
            new_card.last_reviewed = None
            new_card.reps = 0
            new_card.lapses = 0
            
            db.commit()
            db.refresh(new_card)
            
            logger.info(f"抽认卡复制成功: 从卡片{original.id}复制到用户{user_id}, 新卡片id={new_card.id}")
            return new_card
            
        except Exception as e:
            logger.error(f"复制抽认卡失败: {e}")
            db.rollback()
            return None
    
    def get_due_flashcards(self, db: Session, owner_id: int, limit: int = 100) -> List[Flashcard]:
        """获取到期的抽认卡（包括过期和今天到期的）"""
        now = datetime.now(timezone.utc)
        
        # 查询条件：状态为学习或复习，且到期时间小于等于现在，或为新建卡片
        query = db.query(Flashcard).filter(
            Flashcard.owner_id == owner_id,
            or_(
                # 新建卡片（从未复习过）
                and_(
                    Flashcard.status == FlashcardStatus.NEW,
                    Flashcard.reps == 0
                ),
                # 学习中或复习中的卡片，且已到期
                and_(
                    Flashcard.status.in_([FlashcardStatus.LEARNING, FlashcardStatus.REVIEW]),
                    Flashcard.due <= now
                )
            )
        ).order_by(
            Flashcard.due.asc() if Flashcard.due is not None else Flashcard.created_at.asc()
        )
        
        if limit:
            query = query.limit(limit)
        
        return query.all()
    
    def get_flashcard_stats(self, db: Session, owner_id: int) -> Dict[str, Any]:
        """获取抽认卡统计信息"""
        now = datetime.now(timezone.utc)
        
        # 总数统计
        total_cards = db.query(func.count(Flashcard.id)).filter(Flashcard.owner_id == owner_id).scalar()
        
        # 按状态统计
        new_cards = db.query(func.count(Flashcard.id)).filter(
            Flashcard.owner_id == owner_id,
            Flashcard.status == FlashcardStatus.NEW
        ).scalar()
        
        learning_cards = db.query(func.count(Flashcard.id)).filter(
            Flashcard.owner_id == owner_id,
            Flashcard.status == FlashcardStatus.LEARNING
        ).scalar()
        
        review_cards = db.query(func.count(Flashcard.id)).filter(
            Flashcard.owner_id == owner_id,
            Flashcard.status == FlashcardStatus.REVIEW
        ).scalar()
        
        # 到期卡片统计（包括学习中、复习中的到期卡片，以及新建卡片）
        due_learning_review = db.query(func.count(Flashcard.id)).filter(
            Flashcard.owner_id == owner_id,
            Flashcard.status.in_([FlashcardStatus.LEARNING, FlashcardStatus.REVIEW]),
            Flashcard.due <= now
        ).scalar()

        # 新建卡片（从未复习过的卡片）
        due_new = db.query(func.count(Flashcard.id)).filter(
            Flashcard.owner_id == owner_id,
            Flashcard.status == FlashcardStatus.NEW,
            Flashcard.reps == 0
        ).scalar()

        due_today = due_learning_review + due_new
        
        # 平均置信度
        avg_confidence = db.query(func.avg(Flashcard.confidence)).filter(
            Flashcard.owner_id == owner_id,
            Flashcard.confidence.isnot(None)
        ).scalar() or 0.0
        
        # 总复习次数
        total_reviews = db.query(func.count(FlashcardReviewLog.id)).filter(
            FlashcardReviewLog.flashcard_id.in_(
                db.query(Flashcard.id).filter(Flashcard.owner_id == owner_id)
            )
        ).scalar()
        
        # 平均评分（rating 是 VARCHAR，用 CASE 转数值再 avg）
        rating_numeric = sa_cast(
            case(
                (FlashcardReviewLog.rating == FlashcardRating.AGAIN.value, 1.0),
                (FlashcardReviewLog.rating == FlashcardRating.HARD.value, 2.0),
                (FlashcardReviewLog.rating == FlashcardRating.GOOD.value, 3.0),
                (FlashcardReviewLog.rating == FlashcardRating.EASY.value, 4.0),
                else_=0.0
            ),
            Float
        )
        avg_rating = db.query(func.avg(rating_numeric)).filter(
            FlashcardReviewLog.flashcard_id.in_(
                db.query(Flashcard.id).filter(Flashcard.owner_id == owner_id)
            )
        ).scalar() or 0.0
        
        return {
            "total_cards": total_cards or 0,
            "new_cards": new_cards or 0,
            "learning_cards": learning_cards or 0,
            "review_cards": review_cards or 0,
            "due_today": due_today or 0,
            "overdue": due_today or 0,
            "avg_confidence": float(avg_confidence),
            "total_reviews": total_reviews or 0,
            "avg_rating": avg_rating
        }

    def get_user_card_groups(self, db: Session, owner_id: int) -> List[CardGroup]:
        """获取用户的所有卡组"""
        from sqlalchemy.orm import joinedload
        return db.query(CardGroup).options(joinedload(CardGroup.document)).filter(
            CardGroup.owner_id == owner_id
        ).order_by(CardGroup.created_at.desc()).all()

    def get_card_group_with_flashcards(self, db: Session, group_id: int, owner_id: int) -> Optional[CardGroup]:
        """获取卡组及其包含的所有卡片"""
        from sqlalchemy.orm import joinedload
        
        group = db.query(CardGroup).options(
            joinedload(CardGroup.flashcards)
        ).filter(
            CardGroup.id == group_id,
            or_(CardGroup.owner_id == owner_id, CardGroup.is_public == True)
        ).first()
        return group

    def get_public_card_groups(self, db: Session, exclude_owner_id: int) -> List[CardGroup]:
        """获取公开卡组列表（包含所有用户的公开卡组）"""
        from sqlalchemy.orm import joinedload
        return db.query(CardGroup).options(joinedload(CardGroup.document)).filter(
            CardGroup.is_public == True
        ).order_by(CardGroup.created_at.desc()).all()

    def copy_group_to_user(self, db: Session, group_id: int, user_id: int) -> tuple:
        """复制卡组到用户账户，返回 (success, message, new_group_id)"""
        original_group = db.query(CardGroup).filter(
            CardGroup.id == group_id
        ).first()

        if not original_group:
            return (False, "卡组不存在", None)

        existing_same_name = db.query(CardGroup).filter(
            CardGroup.owner_id == user_id,
            CardGroup.name == original_group.name
        ).first()

        if existing_same_name:
            return (False, "你已有名为该名称的卡组", None)

        flashcards = db.query(Flashcard).filter(Flashcard.group_id == group_id).all()

        new_group = CardGroup(
            name=f"{original_group.name} (复制)",
            description=original_group.description,
            document_id=original_group.document_id,
            owner_id=user_id,
            card_count=len(flashcards),
            is_public=False
        )
        db.add(new_group)
        db.flush()

        for card in flashcards:
            new_card = Flashcard(
                question=card.question,
                answer=card.answer,
                document_id=card.document_id,
                chapter_id=card.chapter_id,
                source_text=card.source_text,
                ai_generated=card.ai_generated,
                confidence=card.confidence,
                owner_id=user_id,
                is_public=False,
                group_id=new_group.id,
                difficulty=self.FSRS_DEFAULT_DIFFICULTY,
                stability=self.FSRS_DEFAULT_STABILITY,
                retrievability=self.FSRS_DEFAULT_RETRIEVABILITY,
                status=FlashcardStatus.NEW,
                reps=0,
                lapses=0,
                is_multiple_choice=card.is_multiple_choice,
                options=card.options,
                correct_option_label=card.correct_option_label
            )
            db.add(new_card)

        db.commit()
        return (True, "卡组复制成功", new_group.id)

    def delete_card_group(self, db: Session, group_id: int, user_id: int) -> bool:
        """删除卡组（只能删除自己的卡组）"""
        group = db.query(CardGroup).filter(
            CardGroup.id == group_id,
            CardGroup.owner_id == user_id
        ).first()

        if not group:
            return False

        # 删除卡组内的所有卡片
        db.query(Flashcard).filter(Flashcard.group_id == group_id).delete()

        # 删除卡组本身
        db.delete(group)

        db.commit()
        return True

    def _split_content_into_chunks(self, content: str, chunk_size: int = CHUNK_SIZE) -> List[str]:
        """按段落/章节边界分割内容，避免截断段落，每块不超过 chunk_size"""
        if len(content) <= chunk_size:
            return [content] if content.strip() else []

        # 先按双换行（段落边界）拆
        paragraphs = re.split(r'\n\s*\n', content)
        paragraphs = [p.strip() for p in paragraphs if p.strip()]

        # 如果某段本身超过 chunk_size，按单换行再拆
        chunks = []
        soft_max = int(chunk_size * 1.5)  # 允许约2000左右，不严格限制
        for para in paragraphs:
            if len(para) <= chunk_size:
                # 尽量合并到当前块
                if chunks and len(chunks[-1]) + len(para) + 2 <= soft_max:
                    chunks[-1] += '\n\n' + para
                else:
                    chunks.append(para)
            else:
                # 段落太长，按单换行拆
                lines = para.split('\n')
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue
                    if len(line) <= chunk_size:
                        if chunks and len(chunks[-1]) + len(line) + 1 <= soft_max:
                            chunks[-1] += '\n' + line
                        else:
                            chunks.append(line)
                    else:
                        # 行也太长，硬截断
                        for i in range(0, len(line), chunk_size):
                            sub = line[i:i + chunk_size]
                            if chunks and len(chunks[-1]) + len(sub) <= soft_max:
                                chunks[-1] += sub
                            else:
                                chunks.append(sub)

        return chunks

    async def _process_chunk(self, chunk: str, chunk_index: int, max_cards_per_chunk: int, focus_text: Optional[str] = None) -> List[GeneratedFlashcard]:
        """处理单个文本块（带重试机制）"""
        for attempt in range(MAX_RETRIES):
            try:
                cards = await flashcard_generator.generate_from_text(chunk, max_cards_per_chunk, focus_text)
                logger.info(f"Chunk {chunk_index} 处理完成，生成 {len(cards)} 张卡片")
                return cards
            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    logger.warning(f"Chunk {chunk_index} 处理失败 (尝试 {attempt + 1}/{MAX_RETRIES}): {e}，{RETRY_DELAY}秒后重试")
                    await asyncio.sleep(RETRY_DELAY)
                else:
                    logger.error(f"Chunk {chunk_index} 处理失败，已达到最大重试次数: {e}")
                    return []

    async def generate_flashcards(
        self,
        db: Session,
        request: FlashcardGenerateRequest,
        owner_id: int
    ) -> Tuple[int, int, Optional[int]]:
        """生成抽认卡（异步并行处理）"""
        document = db.query(Document).filter(Document.id == request.document_id).first()
        if not document:
            raise ValueError("文档不存在")

        if document.owner_id != owner_id and not document.is_public:
            raise ValueError("无权访问此文档")

        from app.services.document_service import document_service
        content = document_service.get_full_content(db, request.document_id)

        if not content:
            raise ValueError("文档内容为空")

        from app.services.minicpm_service import analyze_images_in_content
        content = await analyze_images_in_content(content)

        chunks = self._split_content_into_chunks(content, CHUNK_SIZE)
        total_chunks = len(chunks)
        total_requested_cards = request.max_cards or 15
        logger.info(f"内容已分割为 {total_chunks} 个块，每块 {CHUNK_SIZE} 字符，总请求 {total_requested_cards} 张")

        task = GenerationTask(
            owner_id=owner_id,
            document_id=request.document_id,
            status="processing",
            total_chunks=total_chunks,
            processed_chunks=0,
            total_cards=0,
            max_cards=total_requested_cards,
            focus_text=request.focus_text
        )
        db.add(task)
        db.flush()
        task_id = task.id

        semaphore = asyncio.Semaphore(MAX_CONCURRENT_TASKS)
        focus = request.focus_text
        per_chunk = total_requested_cards // total_chunks

        async def process_with_semaphore(chunk: str, idx: int):
            async with semaphore:
                target = per_chunk + (total_requested_cards - per_chunk * total_chunks) if idx == total_chunks - 1 else per_chunk
                return await self._process_chunk(chunk, idx, target, focus)

        results = await asyncio.gather(*[
            process_with_semaphore(chunk, idx)
            for idx, chunk in enumerate(chunks)
        ])

        all_cards = []
        for chunk_cards in results:
            all_cards.extend(chunk_cards)

        task.processed_chunks = total_chunks
        task.total_cards = len(all_cards)

        # 先创建卡组
        card_group = CardGroup(
            name=request.group_name or f"{document.title} - 抽认卡组 {datetime.now().strftime('%Y%m%d %H:%M')}",
            description=f"从文档《{document.title}》生成",
            document_id=request.document_id,
            owner_id=owner_id,
            card_count=0,
            is_public=request.is_public
        )
        db.add(card_group)
        db.flush()
        group_id = card_group.id

        saved_count = 0
        for gen_card in all_cards:
            flashcard_data = FlashcardCreate(
                question=gen_card.question,
                answer=gen_card.answer,
                document_id=request.document_id,
                chapter_id=None,
                source_text=gen_card.source_text,
                is_public=request.is_public,
                group_id=group_id
            )
            try:
                flashcard = self.create_flashcard(db, flashcard_data, owner_id)
                flashcard.ai_generated = True
                flashcard.confidence = gen_card.confidence
                db.commit()
                saved_count += 1
            except Exception as e:
                logger.error(f"保存抽认卡失败: {e}")
                db.rollback()
                continue

        card_group.card_count = saved_count
        task.status = "completed"
        db.commit()

        logger.info(f"抽认卡生成完成: 处理 {total_chunks} 个块，保存 {saved_count} 张卡片，卡组ID: {group_id}")
        return total_chunks, saved_count, group_id

    def create_generation_task(self, db: Session, request: FlashcardGenerateRequest, owner_id: int) -> GenerationTask:
        """创建生成任务"""
        from app.services.document_service import document_service
        content = document_service.get_full_content(db, request.document_id)
        chunks = self._split_content_into_chunks(content, CHUNK_SIZE)

        task = GenerationTask(
            owner_id=owner_id,
            document_id=request.document_id,
            status="pending",
            total_chunks=len(chunks),
            processed_chunks=0,
            total_cards=0,
            max_cards=request.max_cards or 15,
            focus_text=request.focus_text,
            is_public=request.is_public
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        return task

    async def generate_flashcards_async(self, task_id: int, owner_id: int):
        """异步执行生成任务（后台运行）"""
        from app.db.session import SessionLocal
        db = SessionLocal()
        ws_manager = get_ws_manager()

        def make_task_dict(task):
            return {
                "id": task.id,
                "status": task.status,
                "document_id": task.document_id,
                "group_id": task.group_id,
                "total_chunks": task.total_chunks,
                "processed_chunks": task.processed_chunks,
                "total_cards": task.total_cards,
                "max_cards": task.max_cards,
                "focus_text": task.focus_text,
                "is_public": task.is_public,
                "error_message": task.error_message,
                "created_at": task.created_at.isoformat() if task.created_at else None
            }

        try:
            task = db.query(GenerationTask).filter(GenerationTask.id == task_id).first()
            if not task or task.status == "cancelled":
                db.close()
                return

            task.status = "processing"
            db.commit()
            await ws_manager.send_task_update(owner_id, {"task": make_task_dict(task)})

            document = db.query(Document).filter(Document.id == task.document_id).first()
            if not document:
                task.status = "failed"
                task.error_message = "文档不存在"
                db.commit()
                await ws_manager.send_task_update(owner_id, {"task": make_task_dict(task)})
                db.close()
                return

            from app.services.document_service import document_service
            content = document_service.get_full_content(db, task.document_id)
            if not content:
                task.status = "failed"
                task.error_message = "文档内容为空"
                db.commit()
                await ws_manager.send_task_update(owner_id, {"task": make_task_dict(task)})
                db.close()
                return

            from app.services.minicpm_service import analyze_images_in_content
            content = await analyze_images_in_content(content)

            chunks = self._split_content_into_chunks(content, CHUNK_SIZE)
            total_chunks = len(chunks)
            total_requested_cards = task.max_cards or 15
            logger.info(f"[Task {task_id}] 内容已分割为 {total_chunks} 个块，总请求 {total_requested_cards} 张卡片")

            semaphore = asyncio.Semaphore(MAX_CONCURRENT_TASKS)
            focus = task.focus_text
            per_chunk = total_requested_cards // total_chunks

            async def process_with_semaphore(chunk: str, idx: int):
                async with semaphore:
                    target = per_chunk + (total_requested_cards - per_chunk * total_chunks) if idx == total_chunks - 1 else per_chunk
                    return await self._process_chunk(chunk, idx, target, focus)

            # 并行处理所有chunks（每个chunk内部自动重试）
            results = await asyncio.gather(*[
                process_with_semaphore(chunk, idx)
                for idx, chunk in enumerate(chunks)
            ])

            task.processed_chunks = total_chunks

            all_cards = []
            for chunk_cards in results:
                all_cards.extend(chunk_cards)

            task.total_cards = len(all_cards)

            # 先创建卡组
            card_group = CardGroup(
                name=f"{document.title} - 抽认卡组 {datetime.now().strftime('%Y%m%d %H:%M')}",
                description=f"从文档《{document.title}》生成",
                document_id=task.document_id,
                owner_id=owner_id,
                card_count=0,
                is_public=task.is_public
            )
            db.add(card_group)
            db.flush()
            task.group_id = card_group.id

            saved_count = 0
            for gen_card in all_cards:
                try:
                    # 创建卡片
                    flashcard = Flashcard(
                        question=gen_card.question,
                        answer=gen_card.answer,
                        document_id=task.document_id,
                        chapter_id=None,
                        group_id=card_group.id,
                        source_text=gen_card.source_text,
                        is_public=task.is_public,
                        owner_id=owner_id,
                        ai_generated=True,
                        confidence=gen_card.confidence,
                        difficulty=self.FSRS_DEFAULT_DIFFICULTY,
                        stability=self.FSRS_DEFAULT_STABILITY,
                        retrievability=self.FSRS_DEFAULT_RETRIEVABILITY,
                        status=FlashcardStatus.NEW,
                        due=None,
                        next_review=None,
                        last_reviewed=None,
                        is_multiple_choice=gen_card.is_multiple_choice,
                        is_multiple=gen_card.is_multiple,
                        options=gen_card.options,
                        correct_option_label=gen_card.correct_option_label,
                        correct_option_labels=gen_card.correct_option_labels
                    )
                    db.add(flashcard)
                    saved_count += 1
                except Exception as e:
                    logger.error(f"保存抽认卡失败: {e}")
                    continue

            # 统一提交所有卡片
            db.refresh(card_group)
            task.total_cards = saved_count
            card_group.card_count = saved_count
            task.status = "completed"
            db.commit()
            logger.info(f"[Task {task_id}] 生成完成，保存 {saved_count} 张卡片，卡组 {card_group.id} card_count={card_group.card_count}，5秒后自动删除")

            await ws_manager.send_task_update(owner_id, {"task": make_task_dict(task), "action": "completed"})

            # 延迟5秒后自动删除已完成的任务
            asyncio.get_event_loop().call_later(5, lambda: self._delete_completed_task(task_id, owner_id))

        except Exception as e:
            logger.error(f"异步生成任务失败: {e}")
            try:
                task = db.query(GenerationTask).filter(GenerationTask.id == task_id).first()
                if task and task.status != "cancelled":
                    task.status = "failed"
                    task.error_message = str(e)
                    db.commit()
                    await ws_manager.send_task_update(owner_id, {"task": make_task_dict(task), "action": "failed"})
            except:
                pass
        finally:
            db.close()

    def _delete_completed_task(self, task_id: int, owner_id: int):
        """延迟删除已完成的任务（在独立线程中执行，带用户验证）"""
        import threading
        def delete_task():
            from app.db.session import SessionLocal
            db = SessionLocal()
            try:
                task = db.query(GenerationTask).filter(
                    GenerationTask.id == task_id,
                    GenerationTask.owner_id == owner_id
                ).first()
                if task and task.status == "completed":
                    db.delete(task)
                    db.commit()
                    logger.info(f"[Task {task_id}] 已自动删除")
            except Exception as e:
                logger.error(f"自动删除任务失败: {e}")
                db.rollback()
            finally:
                db.close()

        threading.Thread(target=delete_task, daemon=True).start()

    def get_generation_tasks(self, db: Session, owner_id: int) -> List[GenerationTask]:
        """获取用户的所有生成任务"""
        return db.query(GenerationTask).filter(
            GenerationTask.owner_id == owner_id
        ).order_by(GenerationTask.created_at.desc()).limit(10).all()

    def get_generation_task(self, db: Session, task_id: int, owner_id: int) -> Optional[GenerationTask]:
        """获取指定生成任务"""
        return db.query(GenerationTask).filter(
            GenerationTask.id == task_id,
            GenerationTask.owner_id == owner_id
        ).first()

    def cancel_generation_task(self, db: Session, task_id: int, owner_id: int):
        """取消生成任务（延迟5秒后自动删除）"""
        task = db.query(GenerationTask).filter(
            GenerationTask.id == task_id,
            GenerationTask.owner_id == owner_id
        ).first()
        if task:
            task.status = "cancelled"
            db.commit()
            logger.info(f"[Task {task_id}] 任务已取消，5秒后自动删除")

            # 延迟5秒后自动删除已取消的任务
            import asyncio
            asyncio.get_event_loop().call_later(5, lambda: self._delete_cancelled_task(task_id, owner_id))

    def _delete_cancelled_task(self, task_id: int, owner_id: int):
        """延迟删除已取消的任务（在独立线程中执行，带用户验证）"""
        import threading
        def delete_task():
            from app.db.session import SessionLocal
            db = SessionLocal()
            try:
                task = db.query(GenerationTask).filter(
                    GenerationTask.id == task_id,
                    GenerationTask.owner_id == owner_id
                ).first()
                if task and task.status == "cancelled":
                    db.delete(task)
                    db.commit()
                    logger.info(f"[Task {task_id}] 已自动删除")
            except Exception as e:
                logger.error(f"自动删除任务失败: {e}")
                db.rollback()
            finally:
                db.close()

        threading.Thread(target=delete_task, daemon=True).start()

    def delete_generation_task(self, db: Session, task_id: int):
        """删除生成任务（只删除任务记录，保留生成的卡片）"""
        task = db.query(GenerationTask).filter(GenerationTask.id == task_id).first()
        if task:
            # 注意：不要删除关联的 CardGroup 和 Flashcard，它们是用户的学习资料
            db.delete(task)
            db.commit()

    def update_flashcard(self, db: Session, flashcard_id: int, update_data: FlashcardUpdate, owner_id: int) -> Optional[Flashcard]:
        """更新抽认卡"""
        flashcard = self.get_flashcard(db, flashcard_id, owner_id)
        if not flashcard:
            return None
        
        # 更新字段
        update_dict = update_data.model_dump(exclude_unset=True)
        for key, value in update_dict.items():
            setattr(flashcard, key, value)
        
        flashcard.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(flashcard)
        
        return flashcard
    
    def delete_flashcard(self, db: Session, flashcard_id: int, owner_id: int) -> bool:
        """删除抽认卡"""
        flashcard = self.get_flashcard(db, flashcard_id, owner_id)
        if not flashcard:
            return False
        
        db.delete(flashcard)
        db.commit()
        
        logger.info(f"抽认卡已删除: id={flashcard_id}")
        return True
    
    def _initialize_fsrs_card(self):
        """初始化FSRS卡片（如果FSRS可用）"""
        if not self.FSRS_AVAILABLE:
            return None
        
        try:
            # 创建FSRS调度器
            scheduler = self.fsrs.Scheduler()
            # 创建新卡片
            card = self.fsrs.Card()
            return card
        except Exception as e:
            logger.error(f"初始化FSRS卡片失败: {e}")
            return None
    
    def _review_fsrs_card(self, fsrs_card, rating: FlashcardRating, review_time):
        """使用FSRS复习卡片（如果FSRS可用）"""
        if not self.FSRS_AVAILABLE:
            return None, None
        
        try:
            # 转换评分为FSRS格式
            rating_map = {
                FlashcardRating.AGAIN: self.fsrs.Rating.Again,
                FlashcardRating.HARD: self.fsrs.Rating.Hard,
                FlashcardRating.GOOD: self.fsrs.Rating.Good,
                FlashcardRating.EASY: self.fsrs.Rating.Easy
            }
            fsrs_rating = rating_map.get(rating, self.fsrs.Rating.Good)

            # 防止0值导致负幂运算异常
            if fsrs_card.stability is None or fsrs_card.stability < 0.01:
                fsrs_card.stability = 0.01
            if fsrs_card.difficulty is None or fsrs_card.difficulty < 0.01:
                fsrs_card.difficulty = 0.01
            
            # 应用复习
            scheduler = self.fsrs.Scheduler()
            new_card, review_log = scheduler.review_card(fsrs_card, fsrs_rating, review_time)
            
            # 返回更新后的卡片和复习日志
            return new_card, review_log
        except Exception as e:
            logger.error(f"FSRS复习失败: {e}")
            import traceback
            traceback.print_exc()
            return None, None
    
    def review_flashcard(
        self, 
        db: Session, 
        flashcard_id: int, 
        review_request: FlashcardReviewRequest, 
        owner_id: int,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> Optional[Flashcard]:
        """复习抽认卡（只能复习用户自己的卡片）"""
        flashcard = db.query(Flashcard).filter(Flashcard.id == flashcard_id).first()
        if not flashcard:
            return None
        
        # 检查卡片所有权：只能复习自己的卡片
        if flashcard.owner_id != owner_id:
            return None
        
        # 使用时区感知的 UTC 时间
        now = datetime.now(timezone.utc)
        
        # 计算已过天数
        elapsed_days = 0.0
        if flashcard.last_reviewed:
            # 确保 last_reviewed 有时区信息
            last_review = flashcard.last_reviewed
            if last_review.tzinfo is None:
                last_review = last_review.replace(tzinfo=timezone.utc)
            elapsed_days = (now - last_review).total_seconds() / 86400.0
        elif flashcard.created_at:
            created_at = flashcard.created_at
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            elapsed_days = (now - created_at).total_seconds() / 86400.0
        
        # 记录复习前的状态
        status_before = flashcard.status
        difficulty_before = flashcard.difficulty
        stability_before = flashcard.stability
        retrievability_before = flashcard.retrievability
        
        # 更新复习次数
        flashcard.reps += 1
        
        # 处理评分
        if review_request.rating == FlashcardRating.AGAIN:
            flashcard.lapses += 1
            # 重置为学习中
            flashcard.status = FlashcardStatus.LEARNING
            # 重置稳定性
            flashcard.stability = max(0.1, flashcard.stability * 0.5)
        else:
            # 更新状态
            if flashcard.status == FlashcardStatus.NEW:
                flashcard.status = FlashcardStatus.LEARNING
            elif flashcard.reps >= 3:  # 学习3次后转为复习
                flashcard.status = FlashcardStatus.REVIEW
        
        # 简单的FSRS-like算法（如果FSRS不可用）
        if not self.FSRS_AVAILABLE:
            # 简化的算法：根据评分调整难度和稳定性
            rating_weights = {
                FlashcardRating.AGAIN: 0.0,
                FlashcardRating.HARD: 0.5,
                FlashcardRating.GOOD: 1.0,
                FlashcardRating.EASY: 1.5
            }
            
            weight = rating_weights.get(review_request.rating, 1.0)
            
            # 调整难度
            flashcard.difficulty = max(0.0, min(1.0, 
                flashcard.difficulty + (0.1 if weight < 1.0 else -0.05)
            ))
            
            # 调整稳定性
            if weight > 0:
                flashcard.stability = flashcard.stability * (1.0 + weight * 0.5)
            else:
                flashcard.stability = max(0.1, flashcard.stability * 0.6)
            
            # 计算下次复习间隔（天数）
            if flashcard.status == FlashcardStatus.LEARNING:
                # 学习阶段：固定间隔
                interval_days = [1, 3, 7][min(flashcard.reps - 1, 2)]
            else:
                # 复习阶段：基于稳定性
                interval_days = max(1, int(flashcard.stability * 1.5))
            
            flashcard.scheduled_days = interval_days
            flashcard.due = now + timedelta(days=interval_days)
            flashcard.elapsed_days = elapsed_days
        
        else:
            # 使用真正的FSRS算法
            try:
                # 创建FSRS卡片对象
                fsrs_card = self.fsrs.Card()
                
                # 设置卡片状态 - 处理可能为None的值
                if flashcard.difficulty is not None:
                    fsrs_card.difficulty = flashcard.difficulty
                if flashcard.stability is not None:
                    fsrs_card.stability = flashcard.stability
                
                # 设置状态
                if flashcard.status == FlashcardStatus.REVIEW:
                    fsrs_card.state = self.fsrs.State.Review
                elif flashcard.status == FlashcardStatus.LEARNING and flashcard.lapses > 0:
                    fsrs_card.state = self.fsrs.State.Relearning
                else:
                    fsrs_card.state = self.fsrs.State.Learning
                
                # 设置时间（确保有时区）
                if flashcard.last_reviewed:
                    lr = flashcard.last_reviewed
                    if lr.tzinfo is None:
                        lr = lr.replace(tzinfo=timezone.utc)
                    fsrs_card.last_review = lr
                
                if flashcard.due:
                    d = flashcard.due
                    if d.tzinfo is None:
                        d = d.replace(tzinfo=timezone.utc)
                    fsrs_card.due = d
                
                # 应用复习
                new_card, _ = self._review_fsrs_card(fsrs_card, review_request.rating, now)
                
                if new_card:
                    # 更新卡片参数
                    if new_card.difficulty is not None:
                        flashcard.difficulty = new_card.difficulty
                    if new_card.stability is not None:
                        flashcard.stability = new_card.stability
                    
                    # 计算可提取性（可选）
                    flashcard.retrievability = 0.0
                    
                    flashcard.elapsed_days = elapsed_days
                    
                    # 更新到期时间
                    if new_card.due:
                        flashcard.due = new_card.due
                        # 计算间隔天数
                        interval_days = max(1, (new_card.due - now).total_seconds() / 86400.0)
                        flashcard.scheduled_days = interval_days
                    else:
                        # 回退到简化算法
                        if flashcard.status == FlashcardStatus.LEARNING:
                            interval_days = [1, 3, 7][min(flashcard.reps - 1, 2)]
                        else:
                            interval_days = max(1, int(flashcard.stability * 1.5)) if flashcard.stability else 1
                        flashcard.scheduled_days = interval_days
                        flashcard.due = now + timedelta(days=interval_days)
                    
                    # 更新状态
                    if new_card.state == self.fsrs.State.Learning:
                        flashcard.status = FlashcardStatus.LEARNING
                    elif new_card.state == self.fsrs.State.Relearning:
                        flashcard.status = FlashcardStatus.LEARNING
                    elif new_card.state == self.fsrs.State.Review:
                        flashcard.status = FlashcardStatus.REVIEW
                    
                    flashcard.next_review = flashcard.due
                    logger.info(f"✓ FSRS计算完成: difficulty={flashcard.difficulty}, stability={flashcard.stability}, due={flashcard.due}")
            except Exception as e:
                logger.error(f"✗ FSRS复习处理失败，使用简化算法: {e}")
                import traceback
                traceback.print_exc()
                # 回退到简化算法
                pass
        
        # 更新复习时间
        flashcard.last_reviewed = now
        flashcard.next_review = flashcard.due
        
        # 创建复习日志
        review_log = FlashcardReviewLog(
            flashcard_id=flashcard_id,
            rating=review_request.rating,
            duration_seconds=review_request.duration_seconds,
            difficulty_before=difficulty_before,
            stability_before=stability_before,
            retrievability_before=retrievability_before,
            difficulty_after=flashcard.difficulty,
            stability_after=flashcard.stability,
            retrievability_after=flashcard.retrievability,
            elapsed_days=elapsed_days,
            scheduled_days=flashcard.scheduled_days,
            status_before=status_before,
            status_after=flashcard.status,
            ip_address=ip_address,
            user_agent=user_agent
        )
        
        db.add(review_log)
        db.commit()
        db.refresh(flashcard)
        
        logger.info(f"抽认卡复习完成: id={flashcard_id}, rating={review_request.rating}, "
                   f"new_due={flashcard.due}, status={flashcard.status}")
        
        return flashcard


# 全局实例
flashcard_service = FlashcardService()