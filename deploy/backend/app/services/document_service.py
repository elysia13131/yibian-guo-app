import os
import re
import logging
import zipfile
import uuid
import tempfile
import asyncio
from typing import List, Optional, Dict, Any, Callable, Tuple
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.document import Document, Chapter, DocumentStatus, DocumentType, MindMap
from app.schemas.document import DocumentCreate, ChapterCreate
from app.services.document_parser import DocumentParser, StructureAnalyzer, ParsedChapter
from app.services.ai_request_manager import ai_request_manager

try:
    from app.services.vector_db_service import vector_db_service
    VECTOR_DB_AVAILABLE = True
except Exception as e:
    logger.warning(f"向量数据库服务不可用: {e}")
    vector_db_service = None
    VECTOR_DB_AVAILABLE = False

logger = logging.getLogger(__name__)

# 图片路径正则
IMG_PATTERN = re.compile(r'\[图片:([^\]]+)\]')

ProgressCallback = Callable[[int, str, str], None]


class DocumentService:
    """文档服务类"""

    _UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/uploads")

    def __init__(self, upload_dir: str = None):
        self.upload_dir = upload_dir or self._UPLOAD_DIR
        os.makedirs(self.upload_dir, exist_ok=True)

    @staticmethod
    def extract_image_paths(text: str) -> List[str]:
        """从文本中提取所有 [图片:path] 的图片路径，返回规范化的绝对路径列表"""
        paths = []
        for m in IMG_PATTERN.finditer(text):
            raw_path = m.group(1).strip().replace("\\", "/")
            # 解析为绝对路径
            if raw_path.startswith("./"):
                resolved = os.path.abspath(raw_path)
            elif raw_path.startswith("/"):
                resolved = raw_path  # 绝对路径，直接使用
            else:
                resolved = os.path.abspath(raw_path)
            paths.append(resolved)
        return paths

    @staticmethod
    def delete_image_files(paths: List[str]):
        """安全删除图片文件列表"""
        for fp in paths:
            if fp and os.path.isfile(fp):
                try:
                    os.remove(fp)
                    logger.info(f"已删除图片: {fp}")
                except Exception as e:
                    logger.warning(f"删除图片失败: {fp}, {e}")

    def create_document(
        self,
        db: Session,
        title: str,
        filename: str,
        file_content: bytes,
        file_type: str,
        owner_id: int = None,
        category: str = None
    ) -> Document:
        """创建文档记录并保存文件（保留原始格式，不上传时转换PDF）"""
        import hashlib
        file_path = self._save_file(filename, file_content, file_type)
        content_hash = hashlib.md5(file_content).hexdigest()

        document = Document(
            title=title,
            filename=filename,
            file_path=file_path,
            file_type=file_type,
            file_size=len(file_content),
            content_hash=content_hash,
            status=DocumentStatus.WAITING,
            owner_id=owner_id,
            category=category
        )

        db.add(document)
        db.commit()
        db.refresh(document)

        return document

    @staticmethod
    def _extract_somark_result(result: Dict[str, Any]) -> Tuple[List[Dict], str]:
        """
        从 SoMark API 标准响应中提取 blocks 和 markdown 文本
        返回 (blocks列表, markdown文本)
        支持格式:
          1. data.result.outputs.json.pages[].blocks[]
          2. data.result.outputs.json 直接为 blocks 数组
          3. data.result.outputs.markdown
        """
        markdown_text = ""
        all_blocks = []

        def _collect_from(obj):
            nonlocal all_blocks
            if isinstance(obj, dict):
                # 格式1: {pages: [{blocks: [...]}]}
                pages = obj.get("pages", [])
                if pages:
                    for page in pages:
                        if isinstance(page, dict):
                            blocks = page.get("blocks", [])
                            if isinstance(blocks, list):
                                all_blocks.extend(blocks)
                # 格式1变体: {blocks: [...]}
                blocks = obj.get("blocks", [])
                if isinstance(blocks, list):
                    all_blocks.extend(blocks)
            elif isinstance(obj, list):
                # 格式2: 直接是 blocks 数组
                all_blocks.extend(obj)

        result_data = result.get("data", result)
        if isinstance(result_data, dict):
            result_inner = result_data.get("result", result_data)
            if isinstance(result_inner, dict):
                outputs = result_inner.get("outputs", result_inner)
                if isinstance(outputs, dict):
                    md = outputs.get("markdown", "")
                    if isinstance(md, str) and md.strip():
                        markdown_text = md
                    json_output = outputs.get("json", {})
                    _collect_from(json_output)

        if all_blocks:
            return all_blocks, markdown_text
        if not markdown_text:
            return [], ""
        return [], markdown_text

    def get_categories(self, db: Session, owner_id: int = None) -> List[str]:
        """获取所有用户的共享分类"""
        categories = db.query(Document.category).filter(
            Document.category.isnot(None)
        ).distinct().all()
        return [cat[0] for cat in categories if cat[0]]

    def get_public_documents_by_category(self, db: Session) -> Dict[str, List[Document]]:
        """获取所有公共文档，按分类分组"""
        public_docs = db.query(Document).filter(
            Document.is_public == True,
            Document.status == DocumentStatus.COMPLETED
        ).order_by(Document.created_at.desc()).all()
        
        result = {}
        for doc in public_docs:
            category = doc.category or "未分类"
            if category not in result:
                result[category] = []
            result[category].append(doc)
        return result

    def _save_file(self, filename: str, content: bytes, file_type: str) -> str:
        """保存文件到磁盘（压缩形式）"""
        file_id = str(uuid.uuid4())
        ext = self._get_file_extension(file_type)
        original_name = f"{file_id}{ext}"
        zip_filename = f"{file_id}.zip"
        file_path = os.path.join(self.upload_dir, zip_filename)
        file_path = file_path.replace('\\', '/')

        with zipfile.ZipFile(file_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(original_name, content)

        logger.info(f"文件已压缩保存: {file_path}")
        return file_path

    def _read_compressed_file(self, file_path: str, original_filename: str = None) -> bytes:
        """从压缩文件中读取原始文件内容"""
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"压缩文件不存在: {file_path}")

        with zipfile.ZipFile(file_path, 'r') as zf:
            if original_filename:
                return zf.read(original_filename)
            else:
                filenames = zf.namelist()
                if filenames:
                    return zf.read(filenames[0])
                raise ValueError("压缩文件为空")

    def _parse_pdf_visual(self, file_content: bytes, file_type: str) -> tuple:
        """视觉解析已移除，直接返回空以使用规则解析"""
        return "", []

    @staticmethod
    def _get_file_extension(file_type: str) -> str:
        """获取文件扩展名"""
        ext_map = {
            'pdf': '.pdf',
            'docx': '.docx',
            'txt': '.txt',
            'md': '.md'
        }
        return ext_map.get(file_type, '.txt')

    def parse_document(self, db: Session, document_id: int, progress_callback: ProgressCallback = None, use_ai: bool = False, parse_mode: str = 'visual') -> bool:
        """解析文档并划分章节
        Args:
            parse_mode: 'visual' (默认，视觉AI解析，失败时自动回退规则解析) 或 'normal' (规则解析)
        """
        document = db.query(Document).filter(Document.id == document_id).first()
        if not document:
            logger.error(f"文档不存在: {document_id}")
            return False

        try:
            document.status = DocumentStatus.PARSING
            db.commit()

            if progress_callback:
                progress_callback(5, "parsing", "正在读取文件...")

            # 从压缩文件中读取内容
            file_content = self._read_compressed_file(document.file_path)

            text = ""
            images_info = []

            if parse_mode == 'visual' and document.file_type == 'pdf':
                if progress_callback:
                    progress_callback(10, "parsing", "正在使用视觉AI解析PDF...")
                text, images_info = self._parse_pdf_visual(file_content, document.file_type)

            if not text.strip():
                if progress_callback:
                    progress_callback(15, "parsing", "正在使用规则解析...")
                text, images_info = DocumentParser.parse_file_from_bytes(file_content, document.file_type)

            if not text.strip():
                raise ValueError("文档内容为空或无法提取")

            if progress_callback:
                if use_ai:
                    progress_callback(20, "parsing", "正在使用 AI 分析文档结构...")
                else:
                    progress_callback(20, "parsing", "正在分析文档结构...")

            if use_ai:
                logger.info(f"AI 解析已在异步任务中处理，跳过同步解析")
                chapters = []
            else:
                chapters = StructureAnalyzer.analyze_structure(text, document.file_type)

            if not use_ai and not chapters:
                chapters = [ParsedChapter(
                    title=document.title,
                    content=text,
                    level=1,
                    order_index=0,
                    start_offset=0,
                    end_offset=len(text)
                )]

            # 如果有图片信息，将图片占位符替换成真正的图片
            if images_info and chapters:
                chapters = self._replace_image_placeholders(chapters, images_info)

            if progress_callback:
                progress_callback(40, "parsing", "正在保存章节...")

            self._delete_chapters(db, document_id)
            
            # 清理旧向量数据，防止重新解析后出现重复题目
            if VECTOR_DB_AVAILABLE and vector_db_service:
                try:
                    vector_db_service.delete_by_document_id(document_id, "question")
                except Exception as e:
                    logger.warning(f"清理文档 {document_id} 旧向量失败: {e}")
            
            saved_chapters = self._save_chapters(db, document_id, chapters, use_ai=use_ai)

            if progress_callback:
                progress_callback(80, "parsing", "正在完成...")

            document.status = DocumentStatus.COMPLETED
            document.parsed_at = datetime.now(timezone.utc)
            document.error_message = None
            db.commit()

            if progress_callback:
                progress_callback(100, "completed", "解析完成")

            # 保留压缩文件，以便后续重新解析
            # 注意：暂时不移除源文件，文件会一直保留在压缩包中
            logger.info(f"文档解析完成，保留压缩源文件: {document.file_path}")

            try:
                self._submit_kg_build(db, document_id, document.is_public)
            except Exception as e:
                logger.warning(f"知识图谱构建提交失败: {e}")

            logger.info(f"文档解析完成: {document_id}, 共 {len(saved_chapters)} 个章节")
            return True

        except Exception as e:
            logger.error(f"文档解析失败: {document_id}, 错误: {e}")
            import traceback
            traceback.print_exc()

            error_str = str(e).lower()

            if document.file_type == 'docx':
                if 'crc' in error_str or 'bad zip' in error_str or 'zipfile' in error_str:
                    user_message = "Word文档解析失败，文档中的图片可能已损坏。建议：将文档转换为PDF格式后重新上传，PDF转换过程会自动修复图片问题。"
                else:
                    user_message = f"Word文档解析失败: {str(e)}。建议：将文档转换为PDF格式后重新上传。"
            elif document.file_type == 'pdf':
                user_message = f"PDF解析失败: {str(e)}"
            else:
                user_message = f"文档解析失败: {str(e)}"

            document.status = DocumentStatus.FAILED
            document.error_message = user_message
            db.commit()
            if progress_callback:
                progress_callback(0, "failed", user_message)
            return False

    def _replace_image_placeholders(self, chapters: List[ParsedChapter], images_info: List[Dict]) -> List[ParsedChapter]:
        """将章节内容中的图片占位符替换成真正的图片标记"""
        # 创建占位符到图片路径的映射（转为相对于 uploads 的路径）
        placeholder_map = {}
        for img in images_info:
            placeholder = img['placeholder']
            abs_path = img['path']
            # 转为相对路径：uploads/tables/somark_p1.png
            rel_path = abs_path.replace('\\', '/')
            # 提取 /uploads/ 之后的部分
            idx = rel_path.find('/uploads/')
            if idx >= 0:
                rel_path = rel_path[idx + 1:]  # uploads/tables/...
            placeholder_map[placeholder] = rel_path
        
        for chapter in chapters:
            # 检查章节内容中是否有占位符
            replaced = False
            for placeholder, path in placeholder_map.items():
                if placeholder in chapter.content:
                    # 替换占位符为图片标记
                    chapter.content = chapter.content.replace(placeholder, f"\n[图片:{path}]\n")
                    replaced = True
                    logger.info(f"在章节 '{chapter.title}' 中替换了图片占位符 {placeholder}")
            
            # 更新结束偏移（因为替换可能改变了长度）
            if replaced:
                chapter.end_offset = chapter.start_offset + len(chapter.content)
        
        return chapters

    def _delete_chapters(self, db: Session, document_id: int):
        """删除文档的所有章节"""
        # 先清空所有引用该文档章节的 last_read_chapter_id
        db.query(Document).filter(
            Document.last_read_chapter_id.in_(
                db.query(Chapter.id).filter(Chapter.document_id == document_id)
            )
        ).update({Document.last_read_chapter_id: None}, synchronize_session=False)
        db.flush()
        chapters = db.query(Chapter).filter(Chapter.document_id == document_id).all()
        for chapter in chapters:
            db.delete(chapter)
        db.commit()

    def _save_chapters(self, db: Session, document_id: int, chapters: List[ParsedChapter], use_ai: bool = False) -> List[Chapter]:
        """保存章节到数据库，返回已保存的 Chapter 对象列表"""
        current_parent_id = None
        saved_chapters = []  # 保存已创建的 Chapter 对象
        for parsed_chapter in chapters:
            chapter = Chapter(
                document_id=document_id,
                title=parsed_chapter.title,
                content=parsed_chapter.content,
                level=parsed_chapter.level,
                order_index=parsed_chapter.order_index,
                start_offset=parsed_chapter.start_offset,
                end_offset=parsed_chapter.end_offset,
                parent_id=current_parent_id if parsed_chapter.level == 2 else None
            )
            db.add(chapter)
            db.flush()
            saved_chapters.append(chapter)
            
            if parsed_chapter.level == 1:
                current_parent_id = chapter.id
        
        db.commit()

        if VECTOR_DB_AVAILABLE and vector_db_service:
            try:
                batch_docs = []
                for chapter in saved_chapters:
                    if chapter.content.strip():
                        chapter_title = chapter.title or ""
                        batch_docs.append({
                            "id": f"q_{document_id}_{chapter.id}",
                            "content": chapter.content,
                            "metadata": {
                                "title": chapter_title,
                                "category": "question",
                                "document_id": str(document_id),
                            }
                        })
                if batch_docs:
                    vector_db_service.add_documents_batch(batch_docs)
                logger.info(f"已将 {len(batch_docs)} 个章节以题目类型存入向量数据库")
            except Exception as e:
                logger.warning(f"存入向量数据库失败: {e}")
        return saved_chapters

    def _split_into_paragraphs(self, content: str) -> List[str]:
        """将内容分割成段落"""
        paragraphs = content.split('\n\n')
        result = []
        for para in paragraphs:
            para = para.strip()
            if para:
                lines = para.split('\n')
                current_para = []
                for line in lines:
                    line = line.strip()
                    if line:
                        current_para.append(line)
                        if len(line) > 100 and len(current_para) > 1:
                            result.append('\n'.join(current_para))
                            current_para = []
                if current_para:
                    result.append('\n'.join(current_para))
        return result

    def get_document(self, db: Session, document_id: int) -> Optional[Document]:
        """获取文档"""
        return db.query(Document).filter(Document.id == document_id).first()

    def get_public_document_by_hash(self, db: Session, content_hash: str) -> Optional[Document]:
        """通过内容哈希查找已存在的公共文档"""
        return db.query(Document).filter(
            Document.content_hash == content_hash,
            Document.is_public == True,
        ).first()

    def get_private_document_by_hash(self, db: Session, content_hash: str, owner_id: int) -> Optional[Document]:
        """通过内容哈希查找当前用户已存在的私密文档"""
        return db.query(Document).filter(
            Document.content_hash == content_hash,
            Document.is_public == False,
            Document.owner_id == owner_id,
        ).first()

    def get_documents(self, db: Session, owner_id: int = None, skip: int = 0, limit: int = 100) -> List[Document]:
        """获取文档列表"""
        query = db.query(Document)
        if owner_id is not None:
            query = query.filter(Document.owner_id == owner_id)
        return query.order_by(Document.created_at.desc()).offset(skip).limit(limit).all()

    def get_chapters(self, db: Session, document_id: int) -> List[Chapter]:
        """获取文档的所有章节"""
        return db.query(Chapter).filter(Chapter.document_id == document_id).order_by(Chapter.order_index).all()

    def get_chapter(self, db: Session, chapter_id: int) -> Optional[Chapter]:
        """获取单个章节"""
        return db.query(Chapter).filter(Chapter.id == chapter_id).first()

    def get_chapter_navigation(self, db: Session, chapter_id: int) -> Dict[str, Optional[Chapter]]:
        """获取章节导航（上一章/下一章）"""
        chapter = self.get_chapter(db, chapter_id)
        if not chapter:
            return {"current": None, "previous": None, "next": None}

        chapters = self.get_chapters(db, chapter.document_id)
        chapter_ids = [c.id for c in chapters]

        try:
            idx = chapter_ids.index(chapter_id)
        except ValueError:
            idx = -1

        prev_chapter = chapters[idx - 1] if idx > 0 else None
        next_chapter = chapters[idx + 1] if idx < len(chapters) - 1 else None

        return {
            "current": chapter,
            "previous": prev_chapter,
            "next": next_chapter
        }

    def get_full_content(self, db: Session, document_id: int) -> str:
        """获取文档完整内容"""
        chapters = self.get_chapters(db, document_id)
        content_parts = []
        for chapter in chapters:
            if chapter.title:
                content_parts.append(f"## {chapter.title}")
            content_parts.append(chapter.content)
        return "\n\n".join(content_parts)

    def update_last_read_chapter(self, db: Session, document_id: int, chapter_id: int) -> bool:
        """更新最后阅读的章节"""
        document = self.get_document(db, document_id)
        if not document:
            return False

        document.last_read_chapter_id = chapter_id
        db.commit()
        return True

    def delete_document(self, db: Session, document_id: int) -> bool:
        """删除文档"""
        document = db.query(Document).filter(Document.id == document_id).first()
        if not document:
            return False

        # 判断文档是否是公开的（L3重建需要）
        is_public = document.is_public if hasattr(document, 'is_public') else False

        document.last_read_chapter_id = None
        db.commit()

        # 提取并删除文档关联的图片文件（在删除章节前读取内容）
        chapters = db.query(Chapter).filter(Chapter.document_id == document_id).all()
        all_img_paths = []
        for ch in chapters:
            all_img_paths.extend(self.extract_image_paths(ch.content or ""))
        self.delete_image_files(all_img_paths)

        self._delete_chapters(db, document_id)

        # 清理向量数据库中的 question 条目
        if VECTOR_DB_AVAILABLE and vector_db_service:
            try:
                deleted_count = vector_db_service.delete_by_document_id(document_id, "question")
                logger.info(f"已清理文档 {document_id} 的 {deleted_count} 个向量条目")
            except Exception as e:
                logger.warning(f"清理文档 {document_id} 向量条目失败: {e}")

        if document.file_path and os.path.exists(document.file_path):
            try:
                os.remove(document.file_path)
            except Exception as e:
                logger.warning(f"删除文件失败: {document.file_path}, {e}")

        # 解除外键引用后再删除文档
        from app.models.flashcard import CardGroup, GenerationTask
        # CardGroup.document_id 为 NOT NULL，需删除关联的卡片组
        groups = db.query(CardGroup).filter(CardGroup.document_id == document_id).all()
        for g in groups:
            db.delete(g)
        db.query(GenerationTask).filter(GenerationTask.document_id == document_id).update(
            {"document_id": None}, synchronize_session=False
        )
        from app.models.game import GameSave
        db.query(GameSave).filter(GameSave.document_id == document_id).update(
            {"document_id": None}, synchronize_session=False
        )

        db.delete(document)
        db.commit()

        # ── 取消正在运行的知识图谱构建 + 删除该文档的知识图谱数据 ──
        try:
            from app.services.knowledge_graph_service import knowledge_graph_service
            from app.services.graph_build_worker import cancel_graph_build
            import asyncio
            cancel_graph_build(document_id)
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # 已在运行的 event loop 中，用 create_task 避免冲突
                loop.create_task(
                    knowledge_graph_service.delete_document_kg(str(document_id))
                )
                logger.info(f"已提交文档 {document_id} 的知识图谱清理任务")
            else:
                kg_result = loop.run_until_complete(
                    knowledge_graph_service.delete_document_kg(str(document_id))
                )
                logger.info(f"已清理文档 {document_id} 的知识图谱数据: {kg_result}")

        except Exception as e:
            logger.warning(f"清理知识图谱数据失败: {e}")

        return True

    def merge_chapters(self, db: Session, document_id: int, chapter_ids: List[int], new_title: str = None) -> dict:
        """合并多个章节为一个"""
        if len(chapter_ids) < 2:
            raise ValueError("至少需要选择2个章节才能合并")

        chapters = db.query(Chapter).filter(
            Chapter.id.in_(chapter_ids),
            Chapter.document_id == document_id
        ).order_by(Chapter.order_index).all()

        if len(chapters) != len(chapter_ids):
            raise ValueError("部分章节未找到")

        merged_content = "\n".join([ch.content for ch in chapters])
        min_order = min([ch.order_index for ch in chapters])
        max_order = max([ch.order_index for ch in chapters])
        level = chapters[0].level
        
        # 获取所有章节，找到正确的 parent_id
        all_chapters_before = self.get_chapters(db, document_id)
        current_parent_id = None
        for ch in reversed(all_chapters_before):
            if ch.order_index < min_order and ch.level == 1:
                current_parent_id = ch.id
                break

        # 删除原章节
        for ch in chapters:
            db.delete(ch)
        db.flush()
        
        # 更新后续章节的 order_index
        offset = -(len(chapters) - 1)
        later_chapters = db.query(Chapter).filter(
            Chapter.document_id == document_id,
            Chapter.order_index > max_order
        ).order_by(Chapter.order_index).all()
        
        logger.info(f"📋 需要更新的后续章节数量: {len(later_chapters)}")
        
        for ch in later_chapters:
            ch.order_index += offset
        
        db.flush()

        # 创建新章节
        new_chapter = Chapter(
            document_id=document_id,
            title=new_title or chapters[0].title or "合并章节",
            content=merged_content,
            level=level,
            order_index=min_order,
            parent_id=current_parent_id if level == 2 else None
        )

        db.add(new_chapter)
        db.commit()
        db.refresh(new_chapter)
        
        # 验证并确保所有 parent_id 正确
        all_chapters_after = self.get_chapters(db, document_id)
        verify_parent_id = None
        for ch in all_chapters_after:
            if ch.level == 1:
                verify_parent_id = ch.id
            ch.parent_id = verify_parent_id if ch.level == 2 else None
        
        db.commit()
        
        logger.info(f"✅ 合并完成，创建新章节: {new_chapter.title}")

        # 更新向量数据库 - 只更新受影响的部分
        if VECTOR_DB_AVAILABLE and vector_db_service:
            # 删除原章节的向量数据（使用稳定的 chapter.id）
            for ch in chapters:
                if ch.content.strip():
                    try:
                        vector_db_service.delete_document(f"q_{document_id}_{ch.id}")
                        logger.info(f"🗑️ 已删除旧章节向量数据: {ch.title} (id={ch.id})")
                    except:
                        pass
            
            # 添加新创建的章节的向量数据
            if new_chapter.content.strip():
                chapter_title = new_chapter.title or ""
                vector_db_service.add_document(
                    document_id=f"q_{document_id}_{new_chapter.id}",
                    content=new_chapter.content,
                    metadata={
                        "title": chapter_title,
                        "category": "question",
                        "document_id": str(document_id),
                    }
                )
            logger.info(f"✅ 已将合并后的新章节添加到向量数据库")

        # 重建当前文档的知识图谱
        try:
            doc = self.get_document(db, document_id)
            self._submit_kg_build(db, document_id, doc.is_public if doc else False)
        except Exception as e:
            logger.warning(f"合并后知识图谱重建提交失败: {e}")

        return {"id": new_chapter.id, "title": new_chapter.title, "content": merged_content}

    def _extract_title_from_content(self, content: str) -> str:
        """从内容中自动提取标题"""
        lines = content.strip().split('\n')
        if not lines:
            return "无标题"

        first_line = lines[0].strip()

        # 如果第一行匹配题目格式，使用第一行作为标题
        question_patterns = [
            r'^\d+[、．.]\s*',
            r'^\d+\.',
        ]
        for pattern in question_patterns:
            if re.match(pattern, first_line):
                # 截取前30个字符作为标题
                title = re.sub(pattern, '', first_line)
                return title[:50] if len(title) > 50 else title

        # 如果第一行是简短文本（小于30字符），直接作为标题
        if len(first_line) <= 30 and not first_line.endswith(('。', '？', '！')):
            return first_line

        # 否则返回空标题，使用默认标题
        return "无标题"

    def split_chapter(self, db: Session, document_id: int, chapter_id: int,
                      split_points: List[int], new_titles: List[str] = None) -> List[dict]:
        """分割一个章节为多个"""
        chapter = db.query(Chapter).filter(
            Chapter.id == chapter_id,
            Chapter.document_id == document_id
        ).first()

        if not chapter:
            raise ValueError("章节未找到")

        if len(split_points) < 1:
            raise ValueError("至少需要1个分割点")

        split_points = sorted(set(split_points))
        # 统一换行符，确保和前端计算一致
        content = chapter.content.replace('\r\n', '\n').replace('\r', '\n')
        if split_points[-1] >= len(content):
            raise ValueError("分割点位置无效")

        parts = []
        start = 0
        for i, point in enumerate(split_points):
            if point > start:
                parts.append(content[start:point])
            start = point
        if start < len(content):
            parts.append(content[start:])

        # 自动识别标题
        titles = []
        for part_content in parts:
            if new_titles and len(new_titles) > len(titles):
                titles.append(new_titles[len(titles)])
            else:
                titles.append(self._extract_title_from_content(part_content))

        level = chapter.level
        
        # 获取所有章节
        all_chapters_before = self.get_chapters(db, document_id)
        
        # 找到当前章节前面最近的 level=1 章节
        current_parent_id = chapter.parent_id
        for ch in reversed(all_chapters_before):
            if ch.order_index < chapter.order_index and ch.level == 1:
                current_parent_id = ch.id
                break
        
        logger.info(f"📋 原章节信息: id={chapter.id}, order={chapter.order_index}, level={level}, parent_id={current_parent_id}")
        
        # 删除原章节
        for ch in db.query(Chapter).filter(Chapter.id == chapter_id).all():
            db.delete(ch)
        db.flush()
        
        # 获取原章节后面的所有章节，并更新它们的 order_index
        offset = len(parts) - 1
        later_chapters = db.query(Chapter).filter(
            Chapter.document_id == document_id,
            Chapter.order_index > chapter.order_index
        ).order_by(Chapter.order_index).all()
        
        logger.info(f"📋 需要更新的后续章节数量: {len(later_chapters)}")
        
        for ch in later_chapters:
            ch.order_index += offset
        
        db.flush()

        new_chapters = []
        # 创建新章节
        for i, (part_content, title) in enumerate(zip(parts, titles)):
            new_chapter = Chapter(
                document_id=document_id,
                title=title,
                content=part_content,
                level=level,
                order_index=chapter.order_index + i,
                parent_id=current_parent_id if level == 2 else None
            )
            db.add(new_chapter)
            new_chapters.append(new_chapter)
        
        db.commit()

        # 刷新新章节
        for nc in new_chapters:
            db.refresh(nc)
        
        logger.info(f"✅ 新章节创建完成，共 {len(new_chapters)} 个")
        
        # 验证一下
        all_chapters_after = self.get_chapters(db, document_id)
        logger.info(f"📋 所有章节数量: {len(all_chapters_after)}")
        verify_parent_id = None
        for ch in all_chapters_after:
            if ch.level == 1:
                verify_parent_id = ch.id
                logger.info(f"  章节: {ch.title} (order={ch.order_index}, id={ch.id})")
            elif ch.level == 2:
                logger.info(f"  题目: {ch.title} (order={ch.order_index}, parent_id={ch.parent_id})")

        # 更新向量数据库 - 只更新受影响的部分
        if VECTOR_DB_AVAILABLE and vector_db_service:
            # 删除原章节的向量数据（使用稳定的 chapter.id）
            if chapter.content.strip():
                try:
                    vector_db_service.delete_document(f"q_{document_id}_{chapter.id}")
                    logger.info(f"🗑️ 已删除旧章节向量数据: {chapter.title} (id={chapter.id})")
                except:
                    pass
            
            # 添加新创建的章节的向量数据
            for nc in new_chapters:
                if nc.content.strip():
                    chapter_title = nc.title or ""
                    vector_db_service.add_document(
                        document_id=f"q_{document_id}_{nc.id}",
                        content=nc.content,
                        metadata={
                            "title": chapter_title,
                            "category": "question",
                            "document_id": str(document_id),
                        }
                    )
            logger.info(f"✅ 已将 {len([nc for nc in new_chapters if nc.content.strip()])} 个新章节添加到向量数据库")

        # 重建当前文档的知识图谱
        try:
            doc = self.get_document(db, document_id)
            self._submit_kg_build(db, document_id, doc.is_public if doc else False)
        except Exception as e:
            logger.warning(f"分割后知识图谱重建提交失败: {e}")

        return [{"id": nc.id, "title": nc.title, "content": nc.content} for nc in new_chapters]

    def delete_single_chapter(self, db: Session, document_id: int, chapter_id: int):
        """删除单个章节"""
        chapter = db.query(Chapter).filter(
            Chapter.id == chapter_id,
            Chapter.document_id == document_id
        ).first()

        if not chapter:
            raise ValueError("章节未找到")

        db.delete(chapter)
        db.commit()

        self._reorder_chapters(db, document_id)

        # 只删除该章节对应的向量数据
        if VECTOR_DB_AVAILABLE and vector_db_service:
            try:
                vector_db_service.delete_document(f"q_{document_id}_{chapter.id}")
                logger.info(f"🗑️ 已删除章节 {chapter.id} 的向量数据")
            except Exception as e:
                logger.warning(f"删除章节向量数据失败: {e}")

        # 重建当前文档的知识图谱
        try:
            doc = self.get_document(db, document_id)
            self._submit_kg_build(db, document_id, doc.is_public if doc else False)
        except Exception as e:
            logger.warning(f"删除后知识图谱重建提交失败: {e}")

    def _import_to_vector_db(self, db: Session, document_id: int):
        """将文档的章节导入向量数据库"""
        if not VECTOR_DB_AVAILABLE or not vector_db_service:
            logger.warning("向量数据库不可用，跳过导入")
            return

        chapters = self.get_chapters(db, document_id)

        try:
            batch_docs = []
            for chapter in chapters:
                if chapter.content.strip():
                    chapter_title = chapter.title or ""
                    batch_docs.append({
                        "id": f"q_{document_id}_{chapter.id}",
                        "content": chapter.content,
                        "metadata": {
                            "title": chapter_title,
                            "category": "question",
                            "document_id": str(document_id),
                        }
                    })
            if batch_docs:
                vector_db_service.add_documents_batch(batch_docs)
            logger.info(f"已将 {len(batch_docs)} 个章节以题目类型存入向量数据库")
        except Exception as e:
            logger.warning(f"导入向量数据库失败: {e}")

    def _update_single_chapter_in_vector_db(self, db: Session, chapter):
        """只更新单个章节的向量数据库数据"""
        if not VECTOR_DB_AVAILABLE or not vector_db_service:
            logger.warning("向量数据库不可用，跳过更新")
            return

        document_id = chapter.document_id

        try:
            if chapter.content.strip():
                # 删除旧的（如果存在）
                try:
                    vector_db_service.delete_document(f"q_{document_id}_{chapter.id}")
                except:
                    pass
                
                # 添加新的
                chapter_title = chapter.title or ""
                vector_db_service.add_document(
                    document_id=f"q_{document_id}_{chapter.id}",
                    content=chapter.content,
                    metadata={
                        "title": chapter_title,
                        "category": "question",
                        "document_id": str(document_id),
                    }
                )
                logger.info(f"已更新章节 {chapter.id} 的向量数据")
        except Exception as e:
            logger.warning(f"更新向量数据库失败: {e}")

    def _submit_kg_build(self, db: Session, document_id: int, is_public: bool = False):
        """提交当前文档的知识图谱构建任务（只使用叶子章节，chapter.id 作为 section ID）"""
        try:
            from app.services.graph_build_worker import submit_graph_build
            db_chapters = self.get_chapters(db, document_id)
            parent_ids = {ch.parent_id for ch in db_chapters if ch.parent_id is not None}
            leaf_chapters = [ch for ch in db_chapters if ch.id not in parent_ids and ch.content.strip()]
            if not leaf_chapters:
                logger.info(f"文档 {document_id} 无叶子章节，跳过 KG 构建")
                return
            sections = [
                {"id": str(ch.id), "title": ch.title, "content": ch.content}
                for ch in leaf_chapters
            ]
            submit_graph_build(int(document_id), sections, is_public=is_public)
            logger.info(f"知识图谱构建任务已提交: {document_id}, 叶子章节数={len(leaf_chapters)}")
        except Exception as e:
            logger.warning(f"知识图谱构建提交失败: {e}")

    def _reorder_chapters(self, db: Session, document_id: int):
        """重新排序章节"""
        chapters = db.query(Chapter).filter(
            Chapter.document_id == document_id
        ).order_by(Chapter.order_index).all()

        for i, ch in enumerate(chapters):
            ch.order_index = i

        db.commit()

    def retry_parse(self, db: Session, document_id: int, progress_callback: ProgressCallback = None) -> bool:
        """重新解析文档"""
        document = self.get_document(db, document_id)
        if not document:
            return False

        document.status = DocumentStatus.WAITING
        document.error_message = None
        db.commit()

        return self.parse_document(db, document_id, progress_callback)

    def parse_document_somark(
        self,
        db: Session,
        document_id: int,
        progress_callback: ProgressCallback = None,
    ) -> bool:
        """
        使用 SoMark 智能解析文档（同步包装，供线程池调用）
        开启：标题识别 + 图片理解
        关闭：文本跨页拼接
        """
        import asyncio
        import tempfile
        from app.services.somark_request_manager import somark_request_manager, SoMarkAPIError

        document = self.get_document(db, document_id)
        if not document:
            logger.error(f"文档不存在: {document_id}")
            return False

        try:
            document.status = DocumentStatus.PARSING
            db.commit()

            if progress_callback:
                progress_callback(5, "parsing", "正在读取文件...")

            sofile_content = self._read_compressed_file(document.file_path)
            sofile_ext = self._get_file_extension(document.file_type)

            # PDF 超过 250 页则分段
            pdf_chunks = []
            if document.file_type == 'pdf':
                from pypdf import PdfReader
                import io as io_module
                try:
                    reader = PdfReader(io_module.BytesIO(sofile_content))
                    total_pages = len(reader.pages)
                    if total_pages > 250:
                        from pypdf import PdfWriter
                        for start in range(0, total_pages, 250):
                            writer = PdfWriter()
                            for i in range(start, min(start + 250, total_pages)):
                                writer.add_page(reader.pages[i])
                            buf = io_module.BytesIO()
                            writer.write(buf)
                            buf.seek(0)
                            pdf_chunks.append(buf.getvalue())
                        logger.info(f"PDF {total_pages} 页拆分为 {len(pdf_chunks)} 段")
                        if progress_callback:
                            progress_callback(10, "parsing", f"PDF {total_pages} 页已拆分为 {len(pdf_chunks)} 段")
                    else:
                        pdf_chunks = [sofile_content]
                except Exception as e:
                    logger.warning(f"PDF 页数检查失败: {e}")
                    pdf_chunks = [sofile_content]
            else:
                pdf_chunks = [sofile_content]

            feature_config = {"enable_text_cross_page": False, "enable_title_level_recognition": True, "enable_image_understanding": True}
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            all_blocks = []
            all_markdown_parts = []
            for chunk_idx, chunk_data in enumerate(pdf_chunks):
                chunk_label = f" 第{chunk_idx+1}段" if len(pdf_chunks) > 1 else ""
                with tempfile.NamedTemporaryFile(delete=False, suffix=sofile_ext) as tmp:
                    tmp.write(chunk_data)
                    tmp_path = tmp.name
                try:
                    if progress_callback:
                        progress_callback(15 + chunk_idx * 5, "parsing", f"正在使用 SoMark 智能解析{chunk_label}...")
                    somark_result = loop.run_until_complete(
                        somark_request_manager.parse_document(file_path=tmp_path, feature_config=feature_config))
                finally:
                    os.unlink(tmp_path)
                chunk_blocks, chunk_md = DocumentService._extract_somark_result(somark_result)
                if chunk_blocks:
                    all_blocks.extend(chunk_blocks)
                if chunk_md:
                    all_markdown_parts.append(chunk_md)
            if not all_blocks:
                raise ValueError("SoMark 解析结果为空")
            blocks = all_blocks
            somark_markdown = '\n\n'.join(all_markdown_parts) if all_markdown_parts else ''

            # 下载所有图片
            images_info = []
            image_dir = self.upload_dir + "/tables"
            os.makedirs(image_dir, exist_ok=True)
            img_counter = [0]
            img_map = {}

            for b in blocks:
                img_url = b.get("img_url", "")
                if img_url and img_url not in img_map:
                    img_counter[0] += 1
                    try:
                        import httpx
                        resp = httpx.get(img_url, timeout=30)
                        if resp.status_code == 200:
                            ext = ".png"
                            ct = resp.headers.get("content-type", "")
                            if "jpeg" in ct or "jpg" in ct:
                                ext = ".jpg"
                            elif "gif" in ct:
                                ext = ".gif"
                            img_name = f"somark_p{img_counter[0]}{ext}"
                            img_path = os.path.join(image_dir, img_name)
                            with open(img_path, "wb") as f:
                                f.write(resp.content)
                            placeholder = f"[IMG_PLACEHOLDER_0_{img_counter[0]}]"
                            images_info.append({"placeholder": placeholder, "path": img_path})
                            img_map[img_url] = placeholder
                    except Exception as img_e:
                        logger.warning(f"SoMark 图片下载失败: {img_url} - {img_e}")

            if progress_callback:
                progress_callback(60, "parsing", "正在直接使用 SoMark 结果构建章节...")

            # 直接按 blocks 顺序构建章节，不经过 StructureAnalyzer
            chapters = []
            current_title = None
            current_level = 1
            current_content_parts = []

            def flush_chapter():
                nonlocal current_title, current_content_parts
                content = "\n\n".join(current_content_parts).strip() if current_content_parts else ""
                if current_title is None and content:
                    # 有内容但无标题 → 以文档标题作为章节标题
                    current_title = document.title or "(未命名)"
                if current_title is None:
                    return
                ch = ParsedChapter(
                    title=current_title,
                    content=content,
                    level=current_level,
                    order_index=len(chapters),
                    start_offset=0,
                    end_offset=len(content),
                )
                chapters.append(ch)
                current_title = None
                current_content_parts = []

            for b in blocks:
                btype = b.get("type", "")
                txt = b.get("content", "").strip()
                img_url = b.get("img_url", "")

                # 图片占位符
                pl = img_map.get(img_url, "")
                if pl:
                    if current_title is None:
                        current_title = "(图片)"
                        current_level = 2
                    current_content_parts.append(pl)
                    continue

                if not txt:
                    continue

                # 标题 → 章节边界
                if btype == "title":
                    title_level = b.get("title_level", 1) or 1
                    flush_chapter()
                    current_title = txt
                    current_level = title_level
                    continue

                # cate（选择题组/分类题）→ 也作为章节边界，内嵌下一题题干
                if btype == "cate":
                    flush_chapter()
                    # cate 块内容作为独立章节
                    current_title = txt[:60]
                    current_level = 2
                    current_content_parts = []
                    ch = ParsedChapter(
                        title=current_title,
                        content=txt,
                        level=current_level,
                        order_index=len(chapters),
                        start_offset=0,
                        end_offset=len(txt),
                    )
                    chapters.append(ch)
                    current_title = None
                    current_content_parts = []
                    continue

                # blank（填空下划线占位）→ 跳过，不加入内容
                if btype == "blank":
                    continue

                # table → 包裹标记
                if btype == "table":
                    current_content_parts.append(f"[表格开始]\n{txt}\n[表格结束]")
                    continue

                # 普通文本
                current_content_parts.append(txt)

            flush_chapter()

            if not chapters:
                # 没有章节边界，整个文档作为一个章节
                chapters = [ParsedChapter(
                    title=document.title,
                    content="\n\n".join(
                        img_map.get(b.get("img_url", ""), b.get("content", ""))
                        for b in blocks
                    ),
                    level=1,
                    order_index=0,
                    start_offset=0,
                    end_offset=0,
                )]

            if images_info and chapters:
                chapters = self._replace_image_placeholders(chapters, images_info)

            # 清理拼接产生的 markdown # 残留
            for ch in chapters:
                ch.title = re.sub(r'^#+\s*', '', ch.title) if ch.title else ch.title
                if ch.content:
                    ch.content = re.sub(r'\n#+\s+', '\n', ch.content)  # 内容中的行首 #

            self._delete_chapters(db, document_id)
            self._save_chapters(db, document_id, chapters, use_ai=True)

            if use_rule_parsing:
                try:
                    if progress_callback:
                        progress_callback(58, "parsing", "正在进行二次规则排版...")
                    # 优先用 SoMark 原始 markdown，回退到拼接章节
                    so_md_text = somark_markdown
                    if not so_md_text:
                        so_md_parts = []
                        for ch in chapters:
                            prefix = '#' * max(ch.level or 1, 1)
                            so_md_parts.append(f"{prefix} {ch.title or ''}")
                            if ch.content:
                                so_md_parts.append(ch.content)
                            so_md_parts.append('')
                        so_md_text = '\n'.join(so_md_parts).strip()
                    if so_md_text:
                        rule_chapters = StructureAnalyzer.analyze_structure(so_md_text, 'md')
                        if rule_chapters:
                            self._delete_chapters(db, document_id)
                            self._save_chapters(db, document_id, rule_chapters, use_ai=True)
                            chapters = rule_chapters
                            logger.info(f"二次规则排版完成，使用规则排版结果: {document_id}")
                        else:
                            logger.info(f"二次规则排版未生成章节，保留 SoMark 结果")
                    else:
                        logger.info(f"SoMark 输出为空，跳過二次排版")
                except Exception as e:
                    logger.warning(f"二次规则排版失败，保留 SoMark 结果: {e}")

            try:
                if VECTOR_DB_AVAILABLE and vector_db_service:
                    vector_db_service.delete_by_document_id(document_id, "question")
                self._import_to_vector_db(db, document_id)
                logger.info(f"SoMark 解析后向量数据库导入完成: {document_id}")
            except Exception as e:
                logger.warning(f"SoMark 解析后导入向量数据库失败: {e}")

            try:
                self._submit_kg_build(db, document_id, document.is_public)
            except Exception as e:
                logger.warning(f"知识图谱构建提交失败: {e}")

            if progress_callback:
                progress_callback(80, "parsing", "正在完成...")

            document.status = DocumentStatus.COMPLETED
            document.error_message = None
            db.commit()

            if progress_callback:
                progress_callback(100, "completed", "SoMark 解析完成")

            logger.info(f"SoMark 解析成功: {document_id}, 共 {len(chapters)} 个章节")
            return True

        except SoMarkAPIError as e:
            logger.error(f"SoMark API 解析失败: {e}")
            document.status = DocumentStatus.FAILED
            document.error_message = str(e)
            db.commit()
            if progress_callback:
                progress_callback(100, "failed", f"SoMark 解析失败: {e}")
            return False
        except Exception as e:
            logger.error(f"SoMark 解析异常: {e}")
            document.status = DocumentStatus.FAILED
            document.error_message = str(e)
            db.commit()
            if progress_callback:
                progress_callback(100, "failed", f"解析失败: {e}")
            return False

    async def parse_document_somark_async(
        self,
        db: Session,
        document_id: int,
        progress_callback: ProgressCallback = None,
        use_rule_parsing: bool = False,
    ) -> bool:
        """
        使用 SoMark 智能解析文档（异步，在事件循环中直接调用）
        """
        import tempfile
        import httpx
        from app.services.somark_request_manager import somark_request_manager, SoMarkAPIError

        document = self.get_document(db, document_id)
        if not document:
            return False

        try:
            document.status = DocumentStatus.PARSING
            db.commit()

            if progress_callback:
                progress_callback(5, "parsing", "正在读取文件...")

            sofile_content = self._read_compressed_file(document.file_path)
            sofile_ext = self._get_file_extension(document.file_type)

            with tempfile.NamedTemporaryFile(delete=False, suffix=sofile_ext) as tmp:
                tmp.write(sofile_content)
                tmp_path = tmp.name

            try:
                if progress_callback:
                    progress_callback(15, "parsing", "正在使用 SoMark 智能解析...")

                feature_config = {
                    "enable_text_cross_page": False,
                    "enable_title_level_recognition": True,
                    "enable_image_understanding": True,
                }

                somark_result = await somark_request_manager.parse_document(
                    file_path=tmp_path,
                    feature_config=feature_config,
                )
            finally:
                os.unlink(tmp_path)

            if progress_callback:
                progress_callback(40, "parsing", "SoMark 解析完成，正在处理结果...")

            logger.info(f"SoMark 原始响应 keys: {list(somark_result.keys())}")

            blocks, markdown_text = DocumentService._extract_somark_result(somark_result)
            if not blocks:
                raise ValueError("SoMark 解析结果为空")

            # 先异步下载所有图片
            image_dir = self.upload_dir + "/tables"
            os.makedirs(image_dir, exist_ok=True)
            images_info = []
            img_counter = [0]
            img_map = {}

            async with httpx.AsyncClient(timeout=30) as client:
                for b in blocks:
                    img_url = b.get("img_url", "")
                    if img_url and img_url not in img_map:
                        img_counter[0] += 1
                        try:
                            resp = await client.get(img_url)
                            if resp.status_code == 200:
                                ext = ".png"
                                ct = resp.headers.get("content-type", "")
                                if "jpeg" in ct or "jpg" in ct:
                                    ext = ".jpg"
                                img_name = f"somark_p{img_counter[0]}{ext}"
                                img_path = os.path.join(image_dir, img_name)
                                with open(img_path, "wb") as f:
                                    f.write(resp.content)
                                placeholder = f"[IMG_PLACEHOLDER_0_{img_counter[0]}]"
                                images_info.append({"placeholder": placeholder, "path": img_path})
                                img_map[img_url] = placeholder
                        except Exception as img_e:
                            logger.warning(f"SoMark 图片下载失败: {img_url} - {img_e}")

            if progress_callback:
                progress_callback(50, "parsing", "正在构建章节...")

            if use_rule_parsing:
                # 二次规则排版：拼 full_text → analyze_structure
                full_parts = []
                for b in blocks:
                    txt = b.get("content", "").strip()
                    img_url = b.get("img_url", "")
                    btype = b.get("type", "")
                    pl = img_map.get(img_url, "")
                    if pl:
                        full_parts.append(pl)
                    elif btype == "table" and txt:
                        full_parts.append(f"[表格开始]\n{txt}\n[表格结束]")
                    elif btype == "title":
                        lv = b.get("title_level", 1) or 1
                        full_parts.append(f"{'#' * lv} {txt}")
                    elif txt:
                        full_parts.append(txt)

                full_text = "\n\n".join(full_parts)
                chapters = StructureAnalyzer.analyze_structure(full_text)
                if not chapters:
                    chapters = [ParsedChapter(
                        title=document.title, content=full_text,
                        level=1, order_index=0,
                        start_offset=0, end_offset=len(full_text),
                    )]
            else:
                # 直接路径：按 block type 构建章节
                chapters = []
                current_title = None
                current_level = 1
                current_content_parts = []

                def flush_chapter():
                    nonlocal current_title, current_content_parts
                    content = "\n\n".join(current_content_parts).strip() if current_content_parts else ""
                    if current_title is None and content:
                        current_title = document.title or "(未命名)"
                    if current_title is None:
                        return
                    ch = ParsedChapter(
                        title=current_title, content=content, level=current_level,
                        order_index=len(chapters), start_offset=0, end_offset=len(content))
                    chapters.append(ch)
                    current_title = None
                    current_content_parts = []

                for b in blocks:
                    btype = b.get("type", "")
                    txt = b.get("content", "").strip()
                    img_url = b.get("img_url", "")
                    pl = img_map.get(img_url, "")
                    if pl:
                        if current_title is None:
                            current_title = "(图片)"
                            current_level = 2
                        current_content_parts.append(pl)
                        continue
                    if not txt and btype != 'title':
                        continue
                    if btype == "title":
                        lv = b.get("title_level", 1) or 1
                        flush_chapter()
                        current_title = txt
                        current_level = lv
                    elif btype == "cate":
                        flush_chapter()
                        current_title = txt[:60]
                        current_level = 2
                        current_content_parts = []
                        ch = ParsedChapter(title=current_title, content=txt, level=current_level,
                                          order_index=len(chapters), start_offset=0, end_offset=len(txt))
                        chapters.append(ch)
                        current_title = None
                        current_content_parts = []
                    elif btype == "blank":
                        continue
                    elif btype == "table":
                        current_content_parts.append(f"[表格开始]\n{txt}\n[表格结束]")
                    else:
                        current_content_parts.append(txt)
                flush_chapter()

            if not chapters:
                chapters = [ParsedChapter(
                    title=document.title,
                    content="\n\n".join(
                        img_map.get(b.get("img_url", ""), b.get("content", ""))
                        for b in blocks
                    ),
                    level=1,
                    order_index=0,
                    start_offset=0,
                    end_offset=0,
                )]

            if images_info and chapters:
                chapters = self._replace_image_placeholders(chapters, images_info)

            # 清理拼接产生的 markdown # 残留
            for ch in chapters:
                ch.title = re.sub(r'^#+\s*', '', ch.title) if ch.title else ch.title
                if ch.content:
                    ch.content = re.sub(r'\n#+\s+', '\n', ch.content)  # 内容中的行首 #

            self._delete_chapters(db, document_id)
            # 非阻塞：在线程池中执行同步数据库+向量操作
            await asyncio.to_thread(self._save_chapters, db, document_id, chapters, True)

            try:
                if VECTOR_DB_AVAILABLE and vector_db_service:
                    # 非阻塞：在线程池中执行向量数据库操作
                    await asyncio.to_thread(vector_db_service.delete_by_document_id, document_id, "question")
                await asyncio.to_thread(self._import_to_vector_db, db, document_id)
                logger.info(f"SoMark 解析后向量数据库导入完成: {document_id}")
            except Exception as e:
                logger.warning(f"SoMark 解析后导入向量数据库失败: {e}")

            # 后台触发知识图谱构建
            try:
                await asyncio.to_thread(self._submit_kg_build, db, document_id, document.is_public)
                logger.info(f"SoMark 解析后知识图谱构建任务已提交: {document_id}")
            except Exception as e:
                logger.warning(f"SoMark 解析后知识图谱构建提交失败: {e}")

            if progress_callback:
                progress_callback(80, "parsing", "正在完成...")

            document.status = DocumentStatus.COMPLETED
            document.error_message = None
            db.commit()

            if progress_callback:
                progress_callback(100, "completed", "SoMark 解析完成")
            return True

        except SoMarkAPIError as e:
            logger.error(f"SoMark API 解析失败: {e}")
            document.status = DocumentStatus.FAILED
            document.error_message = str(e)
            db.commit()
            if progress_callback:
                progress_callback(100, "failed", f"SoMark 解析失败: {e}")
            return False
        except Exception as e:
            logger.error(f"SoMark 解析异常: {e}")
            document.status = DocumentStatus.FAILED
            document.error_message = str(e)
            db.commit()
            if progress_callback:
                progress_callback(100, "failed", f"解析失败: {e}")
            return False

    def get_popular_documents(self, db: Session, limit: int = 5) -> List[Document]:
        """获取浏览量最高的公开文档"""
        return db.query(Document).filter(
            Document.is_public == True,
            Document.status == DocumentStatus.COMPLETED
        ).order_by(Document.view_count.desc()).limit(limit).all()

    def search_documents(self, db: Session, query: str, owner_id: int = None) -> List[dict]:
        """
        搜索文档：
        1. 精确匹配文档名
        2. 向量搜索内容
        3. 返回公共文档 + 用户的私密文档，包含匹配内容片段
        """
        logger.info(f"🔍 开始搜索文档: query='{query}', owner_id={owner_id}")

        # 构建查询条件
        base_query = db.query(Document).filter(
            Document.status == DocumentStatus.COMPLETED
        )

        # 只允许访问公共文档或自己的文档
        if owner_id:
            base_query = base_query.filter(
                (Document.is_public == True) | (Document.owner_id == owner_id)
            )
        else:
            base_query = base_query.filter(Document.is_public == True)

        # 检查数据库中有多少符合条件的文档
        total_count = base_query.count()
        logger.info(f"🔍 数据库中符合条件的文档数: {total_count}")

        # 向量搜索结果缓存（doc_id -> {content, distance}）
        doc_content_map = {}

        # 3. 向量搜索内容（先执行，获取每个文档的最佳匹配内容）
        if VECTOR_DB_AVAILABLE and vector_db_service:
            try:
                search_results = vector_db_service.search(query, n_results=20)
                logger.info(f"🔍 向量搜索找到: {len(search_results) if search_results else 0} 个结果")
                if search_results:
                    for result in search_results:
                        doc_id = result.get('metadata', {}).get('document_id')
                        if doc_id:
                            doc_id_int = int(doc_id)
                            content = result.get('content', '')
                            distance = result.get('distance', 1.0)
                            metadata = result.get('metadata', {})
                            # 只保存相似度最高（distance最小）的内容
                            if doc_id_int not in doc_content_map or distance < doc_content_map[doc_id_int]['distance']:
                                doc_content_map[doc_id_int] = {
                                    'content': content,
                                    'distance': distance,
                                    'chapter_title': metadata.get('title', ''),
                                    'chapter_order': metadata.get('chapter_order'),
                                    'category': metadata.get('category', '')
                                }
            except Exception as e:
                logger.warning(f"向量搜索失败: {e}")

        # 1. 精确匹配文档名
        exact_match = base_query.filter(Document.title == query).first()
        if exact_match:
            logger.info(f"🔍 精确匹配找到: {exact_match.title} (id={exact_match.id})")
            return [{
                'document': exact_match,
                'match_content': None,
                'match_distance': None,
                'match_type': 'exact'
            }]

        # 2. 模糊匹配文档名（优先）
        title_matches = base_query.filter(
            Document.title.contains(query)
        ).order_by(Document.created_at.desc()).limit(10).all()
        logger.info(f"🔍 模糊匹配找到: {len(title_matches)} 个文档")

        # 获取向量搜索匹配到的文档ID
        vector_doc_ids = set(doc_content_map.keys())
        vector_docs = []
        if vector_doc_ids:
            vector_docs = base_query.filter(Document.id.in_(list(vector_doc_ids))).all()
            logger.info(f"🔍 向量匹配找到: {len(vector_docs)} 个文档")

        # 合并结果，去重
        seen_ids = set()
        result = []

        # 先添加标题匹配的
        for doc in title_matches:
            if doc.id not in seen_ids:
                seen_ids.add(doc.id)
                result.append({
                    'document': doc,
                    'match_content': None,
                    'match_distance': None,
                    'match_type': 'title'
                })

        # 再添加向量匹配的
        for doc in vector_docs:
            if doc.id not in seen_ids:
                seen_ids.add(doc.id)
                match_info = doc_content_map.get(doc.id, {})
                result.append({
                    'document': doc,
                    'match_content': match_info.get('content', ''),
                    'match_distance': match_info.get('distance', None),
                    'match_type': 'vector',
                    'chapter_title': match_info.get('chapter_title', ''),
                    'chapter_order': match_info.get('chapter_order'),
                    'category': match_info.get('category', '')
                })

        logger.info(f"🔍 最终返回: {len(result)} 个文档")
        # 最多返回20个结果
        return result[:20]

    def increment_view_count(self, db: Session, document_id: int):
        """增加文档浏览量"""
        document = self.get_document(db, document_id)
        if document:
            document.view_count = (document.view_count or 0) + 1
            db.commit()
            return True
        return False

    def get_mindmap(self, db: Session, document_id: int) -> Optional[MindMap]:
        """获取文档的思维导图"""
        return db.query(MindMap).filter(MindMap.document_id == document_id).first()

    def generate_mindmap(self, db: Session, document_id: int, regenerate: bool = False, model: str = "deepseek-v4-flash"):
        """生成文档的思维导图"""
        document = self.get_document(db, document_id)
        if not document:
            logger.error(f"文档不存在: {document_id}")
            return

        # 检查是否需要重新生成
        if not regenerate:
            existing_mindmap = self.get_mindmap(db, document_id)
            if existing_mindmap:
                if existing_mindmap.status == "generating":
                    logger.info(f"思维导图正在生成中，跳过: {document_id}")
                    return
                logger.info(f"思维导图已存在，跳过生成: {document_id}")
                return

        # 创建 "generating" 状态的思维导图记录，这样前端可以知道正在生成
        existing_mindmap = self.get_mindmap(db, document_id)
        if existing_mindmap and existing_mindmap.status == "generating":
            logger.info(f"思维导图正在生成中: {document_id}")
            return

        # 先创建一个 generating 状态的记录
        mindmap_record = MindMap(
            document_id=document_id,
            name=document.title,
            data="",
            status="generating",
            created_at=datetime.now(),
            updated_at=datetime.now()
        )
        db.add(mindmap_record)
        db.commit()
        logger.info(f"思维导图生成任务已创建: {document_id}")

        try:
            # 获取文档的所有章节
            chapters = self.get_chapters(db, document_id)
            if not chapters:
                logger.error(f"文档没有章节: {document_id}")
                return

            # 提取所有章节内容（支持1级和2级）
            chapter_contents = []
            current_level1_title = None
            current_level1_content = ""
            
            # 先尝试按一级+二级聚合
            for chapter in chapters:
                if chapter.level == 1:
                    # 保存上一个一级章节
                    if current_level1_title is not None and current_level1_content:
                        chapter_contents.append({
                            'title': current_level1_title,
                            'content': current_level1_content
                        })
                    current_level1_title = chapter.title or '无标题'
                    current_level1_content = chapter.content or ""
                elif chapter.level == 2 and current_level1_content:
                    # 将二级章节内容追加到当前一级章节
                    current_level1_content += "\n\n" + (chapter.title or "") + "\n" + (chapter.content or "")
            
            # 保存最后一个一级章节
            if current_level1_title is not None and current_level1_content:
                chapter_contents.append({
                    'title': current_level1_title,
                    'content': current_level1_content
                })
            
            # 如果没有一级章节，直接使用所有章节内容
            if not chapter_contents:
                logger.info(f"文档没有一级章节，直接使用所有章节内容")
                for chapter in chapters:
                    if chapter.content:
                        chapter_contents.append({
                            'title': chapter.title or '无标题',
                            'content': chapter.content
                        })

            if not chapter_contents:
                logger.error(f"文档没有一级章节: {document_id}")
                return

            # 分块处理
            chunks = self._split_into_chunks(chapter_contents, max_chunk_size=4000)
            logger.info(f"文档分为 {len(chunks)} 个块进行处理")

            # 并行处理每个块
            import asyncio
            
            # 执行所有任务
            async def process_chunks():
                tasks = []
                for i, chunk in enumerate(chunks):
                    tasks.append(self._analyze_chunk_for_mindmap(chunk, i, model))
                return await asyncio.gather(*tasks)
            
            results = asyncio.run(process_chunks())

            # 整合结果
            mindmap_data = self._integrate_mindmap_results(results, document.title)

            # 保存思维导图（更新已有的记录）
            mindmap_record.data = mindmap_data
            mindmap_record.name = document.title
            mindmap_record.status = "completed"
            mindmap_record.updated_at = datetime.now()
            db.commit()
            logger.info(f"思维导图生成完成: {document_id}")

        except Exception as e:
            logger.error(f"生成思维导图失败: {document_id}, 错误: {e}")
            # 更新状态为失败
            try:
                mindmap_record.data = ""
                mindmap_record.status = "failed"
                mindmap_record.updated_at = datetime.now()
                db.commit()
            except:
                pass
            import traceback
            traceback.print_exc()

    def _split_into_chunks(self, chapter_contents: List[Dict], max_chunk_size: int = 4000) -> List[List[Dict]]:
        """将章节内容分块"""
        chunks = []
        current_chunk = []
        current_size = 0

        for chapter in chapter_contents:
            chapter_size = len(chapter['content'])
            if current_size + chapter_size > max_chunk_size:
                if current_chunk:
                    chunks.append(current_chunk)
                current_chunk = [chapter]
                current_size = chapter_size
            else:
                current_chunk.append(chapter)
                current_size += chapter_size

        if current_chunk:
            chunks.append(current_chunk)

        return chunks

    async def _analyze_chunk_for_mindmap(self, chunk: List[Dict], chunk_index: int, model: str = "deepseek-v4-flash") -> Dict:
        """分析单个块以生成思维导图部分"""
        try:
            # 构建提示词
            content = "\n\n".join([f"# {ch['title']}\n{ch['content']}" for ch in chunk])
            prompt = """请分析以下文档内容，为每个知识点生成思维导图节点结构（最多4层）。

{}

【输出格式】
请严格按照以下JSON格式输出，每个节点都是一个独立的思维导图节点：
json
{{
  "name": "根节点：文档核心主题",
  "children": [
    {{
      "name": "一级主题节点1",
      "children": [
        {{
          "name": "二级主题节点1-1",
          "children": [
            {{
              "name": "三级详细内容节点1-1-1",
              "children": [
                {{
                  "name": "四级叶子节点【详细知识点】：这是叶子节点的完整内容，应该包含：概念的精确定义、工作原理、主要特点、典型应用场景、需要注意的关键点等详细信息。例如：'马克思主义中国化的理论成果：是指马克思主义基本原理同中国具体实际相结合而产生的系列理论成果，包括毛泽东思想和中国特色社会主义理论体系，特点是革命性与实践性相统一...'"
                }}
              ]
            }},
            {{
              "name": "三级详细内容节点1-1-2",
              "children": [{{"name": "四级叶子节点..."}}]
            }}
          ]
        }},
        {{
          "name": "二级主题节点1-2",
          "children": [...]
        }}
      ]
    }},
    {{
      "name": "一级主题节点2",
      "children": [...]
    }}
  ]
}}

【重要要求】
1. 不要使用"第1题"、"题目1"、"第2题"等题号格式
2. 每个节点的name字段应该是完整的知识点内容，不是简短标题
3. 叶子节点（最内层）内容要非常详细，包含定义、原理、特点、应用等完整信息
4. name字段的内容就是思维导图上显示的节点文字
5. 只输出JSON，不要包含任何解释或其他文字""".format(content)

            # 调用AI分析
            messages = [
                {"role": "system", "content": "你是一个专业的思维导图生成助手。你需要将文档内容转化为树状的思维导图节点结构。每个节点代表一个知识点，节点的name字段就是思维导图上显示的文字。"},
                {"role": "user", "content": prompt}
            ]
            result = await ai_request_manager.make_request(
                request_id=f"mindmap_{chunk_index}",
                messages=messages,
                model=model,
                temperature=0.3
            )

            # 记录原始返回内容
            logger.info(f"块 {chunk_index} AI原始返回: {result[:500] if result else 'empty'}...")

            # 解析结果
            import json
            
            def extract_valid_json(text: str) -> dict:
                """从文本中提取有效的 JSON"""
                import re
                
                # 移除代码块标记（如 ```json ... ``` 或 ``` ... ```）
                text = re.sub(r'```json\s*', '', text)
                text = re.sub(r'```\s*', '', text)
                
                # 尝试直接解析
                try:
                    return json.loads(text)
                except json.JSONDecodeError:
                    pass
                
                # 尝试匹配 JSON 对象（非贪婪，从第一个 { 到最后一个 }）
                # 使用更智能的方法：找所有可能的 JSON 起始位置
                start_positions = [m.start() for m in re.finditer(r'\{', text)]
                
                for start in start_positions:
                    for end_offset in range(len(text) - 1, start, -1):
                        if text[end_offset] == '}':
                            try:
                                candidate = text[start:end_offset + 1]
                                result = json.loads(candidate)
                                # 检查是否是有效的思维导图结构
                                if isinstance(result, dict) and 'name' in result:
                                    logger.info(f"成功从位置 {start}-{end_offset} 提取到有效JSON")
                                    return result
                            except json.JSONDecodeError:
                                continue
                
                return None
            
            # 尝试从结果中提取 JSON
            parsed = extract_valid_json(result)
            if parsed:
                return parsed
            
            # 如果提取失败，记录详细信息用于调试
            logger.warning(f"块 {chunk_index} 返回的不是有效JSON: {result[:500] if result else 'empty'}...")
            return {"name": "未分析", "children": []}

        except Exception as e:
            logger.error(f"分析块 {chunk_index} 失败: {e}")
            return {"name": "未分析", "children": []}

    def _integrate_mindmap_results(self, results: List[Dict], document_title: str) -> str:
        """整合多个块的分析结果"""
        # 合并所有子节点
        all_children = []
        for result in results:
            if 'children' in result:
                all_children.extend(result.get('children', []))

        # 去重
        unique_children = self._deduplicate_children(all_children)

        # 构建最终的思维导图
        mindmap = {
            "name": document_title,
            "children": unique_children
        }

        import json
        return json.dumps(mindmap, ensure_ascii=False)

    def _deduplicate_children(self, children: List) -> List:
        """去重子节点"""
        seen = set()
        unique = []

        for child in children:
            # 如果是字符串，转为字典格式
            if isinstance(child, str):
                child = {"name": child, "children": []}
            
            if not isinstance(child, dict):
                continue
                
            name = child.get('name', '')
            if name not in seen:
                seen.add(name)
                if 'children' in child and child['children']:
                    child['children'] = self._deduplicate_children(child['children'])
                unique.append(child)

        return unique

document_service = DocumentService()
