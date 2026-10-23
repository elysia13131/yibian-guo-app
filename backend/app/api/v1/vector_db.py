from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from typing import List, Optional, Dict, Any
from app.services.vector_db_service import vector_db_service
from docx import Document
import markdown
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


def extract_text_from_pdf(file: UploadFile) -> str:
    """从PDF文件提取文本"""
    try:
        import sopdf
        text = ""
        pdf_bytes = file.file.read()
        with sopdf.open(stream=pdf_bytes) as doc:
            for page_num in range(doc.page_count):
                page = doc[page_num]
                text += page.get_text() or ""
        return text
    except Exception as e:
        logger.error(f"PDF提取失败: {e}")
        raise HTTPException(status_code=400, detail="无法解析PDF文件")


def extract_text_from_docx(file: UploadFile) -> str:
    """从Word文件提取文本"""
    try:
        doc = Document(file.file)
        text = "\n".join([paragraph.text for paragraph in doc.paragraphs])
        return text
    except Exception as e:
        logger.error(f"Word提取失败: {e}")
        raise HTTPException(status_code=400, detail="无法解析Word文件")


def extract_text_from_markdown(file: UploadFile) -> str:
    """从Markdown文件提取文本"""
    try:
        content = file.file.read().decode('utf-8')
        html = markdown.markdown(content)
        return content
    except Exception as e:
        logger.error(f"Markdown提取失败: {e}")
        raise HTTPException(status_code=400, detail="无法解析Markdown文件")


def extract_text_from_txt(file: UploadFile) -> str:
    """从文本文件提取文本"""
    try:
        content = file.file.read().decode('utf-8')
        return content
    except Exception as e:
        logger.error(f"文本提取失败: {e}")
        raise HTTPException(status_code=400, detail="无法解析文本文件")


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    category: Optional[str] = Form(None)
):
    """上传文档到向量数据库"""
    try:
        file_extension = file.filename.split(".")[-1].lower()
        
        content = ""
        if file_extension == "pdf":
            content = extract_text_from_pdf(file)
        elif file_extension == "docx":
            content = extract_text_from_docx(file)
        elif file_extension == "md":
            content = extract_text_from_markdown(file)
        elif file_extension == "txt":
            content = extract_text_from_txt(file)
        else:
            raise HTTPException(status_code=400, detail="不支持的文件格式")
        
        if not content or len(content.strip()) == 0:
            raise HTTPException(status_code=400, detail="文档内容为空")
        
        document_id = f"{file.filename}_{len(content)}"
        
        metadata = {
            "filename": file.filename,
            "title": title or file.filename,
            "category": category or "未分类",
            "content_length": len(content)
        }
        
        success = vector_db_service.add_document(
            document_id=document_id,
            content=content,
            metadata=metadata
        )
        
        if not success:
            raise HTTPException(status_code=500, detail="添加文档到向量数据库失败")
        
        return {
            "success": True,
            "message": "文档上传成功",
            "document_id": document_id,
            "metadata": metadata
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"文档上传失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/search")
async def search_documents(
    query: str,
    n_results: int = 5,
    category: Optional[str] = None
):
    """搜索相似文档"""
    try:
        where = None
        if category:
            where = {"category": category}
        
        results = vector_db_service.search(
            query=query,
            n_results=n_results,
            where=where
        )
        
        return {
            "success": True,
            "query": query,
            "results": results
        }
        
    except Exception as e:
        logger.error(f"搜索失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/document/{document_id}")
async def get_document(document_id: str):
    """获取文档详情"""
    try:
        document = vector_db_service.get_document(document_id)
        if not document:
            raise HTTPException(status_code=404, detail="文档未找到")
        
        return {
            "success": True,
            "document": document
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取文档失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/document/{document_id}")
async def delete_document(document_id: str):
    """删除文档"""
    try:
        success = vector_db_service.delete_document(document_id)
        if not success:
            raise HTTPException(status_code=404, detail="文档未找到")
        
        return {
            "success": True,
            "message": "文档删除成功"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除文档失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/count")
async def count_documents():
    """统计文档数量"""
    try:
        count = vector_db_service.count_documents()
        
        return {
            "success": True,
            "count": count
        }
        
    except Exception as e:
        logger.error(f"统计文档失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/add-text")
async def add_text_document(
    content: str,
    title: Optional[str] = None,
    category: Optional[str] = None
):
    """直接添加文本内容到向量数据库"""
    try:
        if not content or len(content.strip()) == 0:
            raise HTTPException(status_code=400, detail="内容不能为空")
        
        import uuid
        document_id = str(uuid.uuid4())
        
        metadata = {
            "title": title or "未命名文档",
            "category": category or "未分类",
            "content_length": len(content),
            "type": "text"
        }
        
        success = vector_db_service.add_document(
            document_id=document_id,
            content=content,
            metadata=metadata
        )
        
        if not success:
            raise HTTPException(status_code=500, detail="添加文档失败")
        
        return {
            "success": True,
            "message": "文档添加成功",
            "document_id": document_id,
            "metadata": metadata
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"添加文档失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
