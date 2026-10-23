import logging
import asyncio
import os
import zipfile
import secrets
import string
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session

from app.models.game import GameSave, GameTaskStatus, GameSaveBorrow
from app.models.character import GameCharacter, CharacterBorrow
from app.models.document import Document
from app.services.game_story_generator import game_story_generator
from app.services.somark_request_manager import somark_request_manager
from app.services.tts_service import tts_service
from app.core.websocket import game_ws_manager

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _generate_save_uid(db: Session) -> str:
    while True:
        uid = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(8))
        exists = db.query(GameSave).filter(GameSave.uid == uid).first()
        if not exists:
            return uid


class GameService:

    async def create_task_and_generate(
        self,
        db: Session,
        document_id: int,
        parse_mode: str,
        user_id: int,
        character_id: Optional[int] = None,
    ) -> GameSave:
        document = db.query(Document).filter(Document.id == document_id).first()
        if not document:
            raise ValueError("文档不存在")

        game_save = GameSave(
            owner_id=user_id,
            document_id=document_id,
            document_title=document.title,
            parse_mode=parse_mode,
            status=GameTaskStatus.GENERATING,
            uid=_generate_save_uid(db),
            created_at=_now(),
        )
        db.add(game_save)
        db.commit()
        db.refresh(game_save)

        asyncio.create_task(self._run_generation(game_save.id, document_id, parse_mode, character_id))

        return game_save

    async def _run_generation(
        self,
        save_id: int,
        document_id: int,
        parse_mode: str,
        character_id: Optional[int] = None,
    ) -> None:
        from app.db.session import SessionLocal
        db = SessionLocal()
        try:
            game_save = db.query(GameSave).filter(GameSave.id == save_id).first()
            if not game_save:
                logger.error(f"GameSave {save_id} 不存在")
                return

            document = db.query(Document).filter(Document.id == document_id).first()
            if not document:
                self._fail_save(db, game_save, "文档不存在")
                return

            character_prompt = None
            portrait_url = None
            expression_descriptions = None
            cg_images = None
            character_name = None
            character_expressions = None

            from app.models.user import User
            user = db.query(User).filter(User.id == game_save.owner_id).first()
            player_title = user.player_title or '同学' if user else '同学'

            if character_id:
                from app.models.character import GameCharacter
                char = db.query(GameCharacter).filter(GameCharacter.id == character_id).first()
                if char:
                    character_prompt = char.prompt
                    portrait_url = char.portrait_url
                    char_expr_list = char.expressions or []
                    char_expr_desc = char.expression_descriptions or []
                    expression_descriptions = [
                        desc for i, desc in enumerate(char_expr_desc)
                        if i < len(char_expr_list) and char_expr_list[i]
                    ]
                    cg_images = char.cg_images
                    character_name = char.name
                    character_expressions = char.expressions

            # PPTX 只能使用智能解析
            if parse_mode == 'normal' and document.file_type == 'pptx':
                parse_mode = 'smart'
                logger.info(f"PPTX 文件强制使用智能解析: doc_id={document_id}")

            if parse_mode == 'normal':
                content = await self._get_normal_content(db, document, character_prompt, character_name, player_title, expression_descriptions, portrait_url, cg_images)
            else:
                content = await self._get_smart_content(document, character_prompt, character_name, player_title, expression_descriptions, portrait_url, cg_images)

            sections = content.get("sections", [])
            if character_id:
                meta_expr_descs = expression_descriptions or []
                meta_section = {
                    "type": "_character_meta",
                    "character_id": character_id,
                    "character_name": character_name or "",
                    "portrait_url": portrait_url or "",
                    "expressions": character_expressions or [],
                    "expression_descriptions": meta_expr_descs,
                    "cg_images": cg_images or [],
                    "voice_sample_url": char.voice_sample_url if hasattr(char, 'voice_sample_url') else None,
                }
                if hasattr(char, 'speaker_id') and char.speaker_id:
                    meta_section["speaker_id"] = char.speaker_id
                elif hasattr(char, 'voice_status') and char.voice_status:
                    meta_section["voice_status"] = char.voice_status
                sections.insert(0, meta_section)
            game_save.sections = sections
            game_save.status = GameTaskStatus.COMPLETED
            game_save.updated_at = _now()
            db.commit()
            logger.info(f"游戏剧情生成完成: save_id={save_id}, sections={len(sections)}")
            await self._precache_tts_async(sections, save_id, game_save.owner_id)
            asyncio.create_task(game_ws_manager.broadcast(game_save.owner_id, {
                "type": "save_update", "action": "completed", "save_id": save_id,
            }))
        except Exception as e:
            logger.error(f"游戏剧情生成失败: {e}", exc_info=True)
            try:
                self._fail_save(db, db.query(GameSave).filter(GameSave.id == save_id).first(), str(e))
            except Exception:
                pass
        finally:
            self._cleanup_document(db, document_id)
            db.close()

    def _cleanup_document(self, db: Session, document_id: int) -> None:
        """清理 VN 专用临时文档（仅清理未解析的 /upload-only 文档，已解析的已有文档保留）"""
        try:
            import os
            document = db.query(Document).filter(Document.id == document_id).first()
            if not document:
                return

            # 安全检查：只有未解析的文档才清理（/upload-only 上传的临时文档）
            # 已有章节的已解析文档不得删除
            from app.models.document import Chapter
            chapter_count = db.query(Chapter).filter(Chapter.document_id == document_id).count()
            if chapter_count > 0:
                logger.info(f"文档 {document_id} 已有 {chapter_count} 个章节，跳过清理（非临时文档）")
                return

            if document.file_path:
                file_path = document.file_path
                if os.path.exists(file_path):
                    os.remove(file_path)
                    logger.info(f"已删除源文件: {file_path}")
            # 先解除外键引用或删除关联记录，再删除文档记录
            from app.models.flashcard import CardGroup, GenerationTask
            # CardGroup.document_id 为 NOT NULL，需删除关联的卡片组
            groups = db.query(CardGroup).filter(CardGroup.document_id == document_id).all()
            for g in groups:
                db.delete(g)
            db.query(GenerationTask).filter(GenerationTask.document_id == document_id).update(
                {"document_id": None}, synchronize_session=False
            )
            db.query(GameSave).filter(GameSave.document_id == document_id).update(
                {"document_id": None}, synchronize_session=False
            )
            db.query(Document).filter(Document.id == document_id).delete()
            db.commit()
            logger.info(f"已删除文档记录: ID={document_id}")
        except Exception as e:
            logger.warning(f"清理文档失败: {e}")
            db.rollback()

    def _fail_save(self, db: Session, game_save: GameSave, error: str) -> None:
        if game_save:
            game_save.status = GameTaskStatus.FAILED
            game_save.error_message = error
            game_save.updated_at = _now()
            db.commit()
            asyncio.create_task(game_ws_manager.broadcast(game_save.owner_id, {
                "type": "save_update", "action": "failed", "save_id": game_save.id,
            }))

    async def _precache_tts_async(self, sections: List[Dict[str, Any]], save_id: int, owner_id: int) -> None:
        """剧情生成后，预先合成开头几句对话的 TTS 音频到缓存"""
        PRECACHE_COUNT = 8
        try:
            meta = sections[0] if sections and sections[0].get("type") == "_character_meta" else None
            if not meta:
                return

            speaker_id = meta.get("speaker_id")
            char_name = meta.get("character_name", "")
            if not speaker_id:
                logger.info(f"[TTS预缓存] save_id={save_id} 角色 '{char_name}' 无 speaker_id，跳过")
                return

            from app.db.session import SessionLocal
            db = SessionLocal()
            try:
                char = db.query(GameCharacter).filter(
                    GameCharacter.id == meta.get("character_id")
                ).first()
                if not char:
                    logger.info(f"[TTS预缓存] save_id={save_id} 角色记录不存在，跳过")
                    return

                from app.models.user import User
                user = db.query(User).filter(User.id == owner_id).first()
                user_api_key = user.api_key if user else None
                # 默认角色使用系统 API Key
                if char.is_default and not user_api_key:
                    user_api_key = os.getenv("TTS_SERVER_API_KEY", "")

                dialogue_sections = [
                    s for s in sections[1:]
                    if s.get("type") in (None, "content", "title", "dialogue")
                    and s.get("text")
                    and not s.get("question")
                ]

                target = dialogue_sections[:PRECACHE_COUNT]
                logger.info(f"[TTS预缓存] save_id={save_id} 角色='{char_name}' 预合成 {len(target)} 句")

                for i, sec in enumerate(target):
                    text = sec.get("text", "").strip()
                    if not text:
                        continue
                    await tts_service.synthesize_character_dialogue(
                        text=text,
                        character=char,
                        user_api_key=user_api_key,
                    )
                    if (i + 1) % 3 == 0:
                        logger.info(f"[TTS预缓存] save_id={save_id} 已完成 {i+1}/{len(target)}")

                logger.info(f"[TTS预缓存] save_id={save_id} 完成，共合成 {len(target)} 句")
            finally:
                db.close()

        except Exception as e:
            logger.warning(f"[TTS预缓存] save_id={save_id} 出错（不影响游戏）: {e}")

    async def get_task_status(self, db: Session, task_id: int, user_id: int) -> Optional[GameSave]:
        game_save = db.query(GameSave).filter(
            GameSave.id == task_id,
            GameSave.owner_id == user_id,
        ).first()
        return game_save

    def get_user_saves(self, db: Session, user_id: int) -> List[GameSave]:
        owned = db.query(GameSave).filter(
            GameSave.owner_id == user_id,
        )
        borrowed_save_ids = db.query(GameSaveBorrow.save_id).filter(
            GameSaveBorrow.user_id == user_id,
        ).subquery()
        borrowed = db.query(GameSave).filter(GameSave.id.in_(borrowed_save_ids))
        return owned.union_all(borrowed).order_by(GameSave.created_at.desc()).all()

    def get_save_detail(self, db: Session, save_id: int, user_id: int) -> Optional[GameSave]:
        save = db.query(GameSave).filter(GameSave.id == save_id).first()
        if not save:
            return None
        if save.owner_id == user_id:
            return save
        borrow = db.query(GameSaveBorrow).filter(
            GameSaveBorrow.save_id == save_id,
            GameSaveBorrow.user_id == user_id,
        ).first()
        if borrow:
            return save
        return None

    def get_save_by_uid(self, db: Session, uid: str) -> Optional[GameSave]:
        return db.query(GameSave).filter(GameSave.uid == uid).first()

    def borrow_save(self, db: Session, original: GameSave, user_id: int) -> GameSave:
        existing = db.query(GameSaveBorrow).filter(
            GameSaveBorrow.save_id == original.id,
            GameSaveBorrow.user_id == user_id,
        ).first()
        if existing:
            return original
        borrow = GameSaveBorrow(
            save_id=original.id,
            user_id=user_id,
        )
        db.add(borrow)
        # 自动借阅存档绑定的角色（静默，不打散角色列表）
        if original.sections:
            sections = list(original.sections) if isinstance(original.sections, list) else []
            for sec in sections:
                char_id = sec.get("character_id") if isinstance(sec, dict) else None
                if char_id:
                    char_exists = db.query(GameCharacter).filter(GameCharacter.id == char_id).first()
                    if char_exists and char_exists.owner_id != user_id:
                        existing_cb = db.query(CharacterBorrow).filter(
                            CharacterBorrow.character_id == char_id,
                            CharacterBorrow.user_id == user_id,
                        ).first()
                        if not existing_cb:
                            db.add(CharacterBorrow(character_id=char_id, user_id=user_id))
                    break  # 只处理第一个角色元数据
        db.commit()
        return original

    def delete_save(self, db: Session, save_id: int, user_id: int) -> bool:
        game_save = db.query(GameSave).filter(
            GameSave.id == save_id,
            GameSave.owner_id == user_id,
        ).first()
        if not game_save:
            return False
        db.delete(game_save)
        db.commit()
        return True

    async def get_game_content(
        self,
        db: Session,
        document_id: int,
        parse_mode: str = 'smart',
        character_id: Optional[int] = None,
        user_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        document = db.query(Document).filter(Document.id == document_id).first()
        if not document:
            raise ValueError("文档不存在")

        character_prompt = None
        character_name = None
        expression_descriptions = None
        portrait_url = None
        cg_images = None

        from app.models.user import User
        user = db.query(User).filter(User.id == user_id).first() if user_id else None
        player_title = user.player_title or '同学' if user else '同学'

        if character_id:
            from app.models.character import GameCharacter
            char = db.query(GameCharacter).filter(GameCharacter.id == character_id).first()
            if char:
                character_prompt = char.prompt
                character_name = char.name
                char_expr_list = char.expressions or []
                char_expr_desc = char.expression_descriptions or []
                expression_descriptions = [
                    desc for i, desc in enumerate(char_expr_desc)
                    if i < len(char_expr_list) and char_expr_list[i]
                ]
                portrait_url = char.portrait_url
                cg_images = char.cg_images

        if parse_mode == 'normal':
            return await self._get_normal_content(db, document, character_prompt, character_name, player_title, expression_descriptions, portrait_url, cg_images)
        return await self._get_smart_content(document, character_prompt, character_name, player_title, expression_descriptions, portrait_url, cg_images)

    async def _get_normal_content(
        self,
        db: Session,
        document: Document,
        character_prompt: Optional[str] = None,
        character_name: Optional[str] = None,
        player_title: str = '同学',
        expression_descriptions: Optional[List[str]] = None,
        portrait_url: Optional[str] = None,
        cg_images: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        from app.services.document_parser import DocumentParser, StructureAnalyzer
        from app.services.document_service import document_service

        file_content = document_service._read_compressed_file(document.file_path)
        text, images_info = DocumentParser.parse_file_from_bytes(
            file_content, document.file_type, "/uploads/tables"
        )

        if not text.strip():
            raise ValueError("文档内容为空")

        # 将图片占位符替换为 [图片:path] 格式，再调用 MiniCPM 分析
        for img in images_info:
            text = text.replace(img["placeholder"], f"[图片:{img['path']}]")
        from app.services.minicpm_service import analyze_images_in_content
        text = await analyze_images_in_content(text)

        chapters = StructureAnalyzer.analyze_structure(text, document.file_type)

        sections: List[Dict[str, Any]] = []
        for ch in chapters:
            sections.append({"type": "title", "text": ch.title})
            content_lines = ch.content.split("\n")
            for line in content_lines:
                line = line.strip()
                if not line:
                    continue
                sections.append({"type": "content", "text": line})

        logger.info(f"规则解析: {len(chapters)} 个章节, {len(sections)} 个 sections")

        story_sections = await game_story_generator.generate_story_sections(
            sections=sections,
            document_title=document.title,
            character_prompt=character_prompt,
            character_name=character_name,
            player_title=player_title,
            expression_descriptions=expression_descriptions,
            portrait_url=portrait_url,
            cg_images=cg_images,
        )
        logger.info(f"最终返回: document_title={document.title}, story_sections 数量={len(story_sections)}")
        return {
            "document_title": document.title,
            "sections": story_sections,
        }

    def _extract_from_zip(self, zip_path: str) -> Optional[str]:
        """从压缩文件中提取原始文件并保存为临时文件，返回临时文件路径"""
        try:
            if not os.path.exists(zip_path):
                logger.warning(f"压缩文件不存在: {zip_path}")
                return None

            with zipfile.ZipFile(zip_path, 'r') as zf:
                file_list = zf.namelist()
                if not file_list:
                    logger.warning(f"压缩文件为空: {zip_path}")
                    return None

                original_filename = file_list[0]
                file_content = zf.read(original_filename)

                # 创建临时文件
                temp_dir = os.path.join(os.path.dirname(zip_path), 'temp')
                os.makedirs(temp_dir, exist_ok=True)
                temp_filename = f"{os.path.splitext(os.path.basename(zip_path))[0]}_{original_filename}"
                temp_path = os.path.join(temp_dir, temp_filename)

                with open(temp_path, 'wb') as f:
                    f.write(file_content)

                logger.info(f"从压缩文件中提取原始文件: {temp_path}")
                return temp_path
        except Exception as e:
            logger.error(f"解压文件失败: {e}", exc_info=True)
            return None

    async def _get_smart_content(
        self,
        document: Document,
        character_prompt: Optional[str] = None,
        character_name: Optional[str] = None,
        player_title: str = '同学',
        expression_descriptions: Optional[List[str]] = None,
        portrait_url: Optional[str] = None,
        cg_images: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        temp_file_path = None
        try:
            # 尝试从压缩文件中提取原始文件
            actual_file_path = document.file_path
            if document.file_path and document.file_path.endswith('.zip'):
                temp_file_path = self._extract_from_zip(document.file_path)
                if temp_file_path:
                    actual_file_path = temp_file_path
                else:
                    logger.warning(f"无法从压缩文件中提取原始文件，回退到普通解析: {document.file_path}")
                    from app.db.session import SessionLocal
                    db = SessionLocal()
                    try:
                        return await self._get_normal_content(db, document, character_prompt, character_name, player_title, expression_descriptions, portrait_url, cg_images)
                    finally:
                        db.close()

            somark_result = await somark_request_manager.parse_document(
                file_path=actual_file_path,
            )
            logger.info(f"SoMark API 解析成功: {len(somark_result.get('sections', []))} 个 sections")

            raw_sections = somark_result.get("sections", [])
            if not raw_sections:
                error_code = somark_result.get("code")
                if error_code not in (None, 0, 200):
                    logger.warning(f"SoMark 返回错误码 {error_code}: {somark_result.get('message', '')}，回退到普通解析")
                    from app.db.session import SessionLocal
                    db = SessionLocal()
                    try:
                        return await self._get_normal_content(db, document, character_prompt, character_name, player_title, expression_descriptions, portrait_url, cg_images)
                    finally:
                        db.close()

                sections = self._parse_markdown_to_sections(str(somark_result))
            else:
                sections = self._parse_somark_result(somark_result)

            if not sections:
                from app.db.session import SessionLocal
                db = SessionLocal()
                try:
                    return await self._get_normal_content(db, document, character_prompt, character_name, player_title, expression_descriptions, portrait_url, cg_images)
                finally:
                    db.close()

            logger.info(f"SoMark 解析结果: {len(sections)} 个 sections")
            story_sections = await game_story_generator.generate_story_sections(
                sections=sections,
                document_title=document.title,
                character_prompt=character_prompt,
                character_name=character_name,
                player_title=player_title,
                expression_descriptions=expression_descriptions,
                portrait_url=portrait_url,
                cg_images=cg_images,
            )
            logger.info(f"最终返回: document_title={document.title}, story_sections 数量={len(story_sections)}, "
                         f"首个类型={story_sections[0].get('type') if story_sections else 'N/A'}")
            return {
                "document_title": document.title,
                "sections": story_sections,
            }

        except Exception as e:
            logger.warning(f"SoMark 解析失败，回退到普通解析: {e}")
            from app.db.session import SessionLocal
            db = SessionLocal()
            try:
                return await self._get_normal_content(db, document, character_prompt, character_name, player_title, expression_descriptions, portrait_url, cg_images)
            finally:
                db.close()
        finally:
            # 清理临时文件
            if temp_file_path and os.path.exists(temp_file_path):
                try:
                    os.remove(temp_file_path)
                    logger.info(f"清理临时文件: {temp_file_path}")
                except Exception as e:
                    logger.warning(f"清理临时文件失败: {e}")

    def _parse_somark_result(self, result: Dict[str, Any]) -> List[Dict[str, Any]]:
        sections: List[Dict[str, Any]] = []
        raw_sections = result.get("sections", [])
        for sec in raw_sections:
            if isinstance(sec, dict):
                if sec.get("image"):
                    try:
                        sections.append({"type": "image", "text": sec.get("text", ""), "src": sec.get("image"), "alt": sec.get("text", "")})
                    except Exception:
                        pass
                else:
                    sections.append({"type": sec.get("type", "content"), "text": sec.get("text", "")})
        return sections

    def _parse_markdown_to_sections(self, markdown_text: str) -> List[Dict[str, Any]]:
        sections: List[Dict[str, Any]] = []
        lines = markdown_text.split("\n")
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if line.startswith("#"):
                sections.append({"type": "title", "text": line.lstrip("#").strip()})
            else:
                sections.append({"type": "content", "text": line})
        return sections


game_service = GameService()
