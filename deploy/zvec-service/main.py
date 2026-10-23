import zvec
import logging
import os
import hashlib
import time
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

os.environ.setdefault('HF_ENDPOINT', 'https://hf-mirror.com')
load_dotenv()

PORT = int(os.environ.get('PORT', '8080'))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    from sentence_transformers import SentenceTransformer
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    SENTENCE_TRANSFORMERS_AVAILABLE = False
    logger.warning("sentence-transformers 未安装，将使用 fallback embedding")

app = FastAPI(title="Zvec 向量数据库微服务", version="1.0.0")

collection = None
embedding_model = None
embedding_dim = 768
_initialized = False
_document_count = 0


# ─── 请求/响应模型 ──────────────────────────────────────────────

class AddDocRequest(BaseModel):
    document_id: str
    content: str
    metadata: Optional[Dict[str, Any]] = None

class AddDocsRequest(BaseModel):
    documents: List[AddDocRequest]

class SearchRequest(BaseModel):
    query: str
    n_results: int = 5
    where: Optional[Dict[str, Any]] = None

class FilterRequest(BaseModel):
    where: Optional[Dict[str, Any]] = None
    n_results: int = 1024

class DeleteRequest(BaseModel):
    document_id: str

class DeleteByDocIdRequest(BaseModel):
    doc_id: int


# ─── 嵌入引擎 ──────────────────────────────────────────────────

def _initialize_embedding_model():
    global embedding_model, embedding_dim
    if embedding_model is not None:
        return True
    if not SENTENCE_TRANSFORMERS_AVAILABLE:
        logger.warning("sentence-transformers 不可用")
        return False

    # 优先检查本地缓存
    try:
        from huggingface_hub import scan_cache_dir
        cache = scan_cache_dir()
        model_cached = any("bge-base-zh-v1.5" in r.repo_id for r in cache.repos)
        if model_cached:
            logger.info("模型已缓存，使用本地文件")
            old_endpoint = os.environ.get('HF_ENDPOINT')
            os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'
            try:
                embedding_model = SentenceTransformer('BAAI/bge-base-zh-v1.5', local_files_only=True)
                embedding_dim = 768
                logger.info("✅ 本地嵌入模型加载成功")
                return True
            finally:
                if old_endpoint is None:
                    del os.environ['HF_ENDPOINT']
                else:
                    os.environ['HF_ENDPOINT'] = old_endpoint
    except Exception:
        pass

    # 无缓存，尝试从 huggingface 下载（通过 hf-mirror 镜像）
    for source_name, endpoint, model_path in [
        ("hf-mirror", 'https://hf-mirror.com', 'BAAI/bge-base-zh-v1.5'),
        ("modelscope", None, None),
    ]:
        try:
            logger.info(f"📥 正在从 {source_name} 下载模型 (BAAI/bge-base-zh-v1.5)...")
            if source_name == "hf-mirror":
                old_endpoint = os.environ.get('HF_ENDPOINT')
                os.environ['HF_ENDPOINT'] = endpoint
                try:
                    embedding_model = SentenceTransformer(model_path)
                    embedding_dim = 768
                    logger.info(f"✅ 从 {source_name} 下载模型成功")
                    return True
                finally:
                    if old_endpoint is None:
                        del os.environ['HF_ENDPOINT']
                    else:
                        os.environ['HF_ENDPOINT'] = old_endpoint
            elif source_name == "modelscope":
                try:
                    from modelscope import snapshot_download
                    model_dir = snapshot_download('BAAI/bge-base-zh-v1.5')
                    embedding_model = SentenceTransformer(model_dir)
                    embedding_dim = 768
                    logger.info(f"✅ 从 modelscope 下载模型成功")
                    return True
                except ImportError:
                    logger.warning("modelscope 未安装，跳过")
                    continue
        except Exception as e:
            logger.warning(f"从 {source_name} 下载失败: {e}")
            continue

    logger.warning("⚠️  所有下载源均失败，使用 fallback")
    embedding_model = None
    return False


def _get_fallback_embedding(text: str) -> List[float]:
    text_hash = hashlib.md5(text.encode()).digest()
    embedding = []
    for i in range(embedding_dim):
        byte_val = text_hash[i % len(text_hash)]
        val = (byte_val / 255.0) * 2.0 - 1.0
        if i < len(text):
            char_val = ord(text[i % len(text)]) / 127.0 - 1.0
            val = (val + char_val) / 2.0
        embedding.append(val)
    return embedding


def _get_embedding(text: str) -> List[float]:
    if _initialize_embedding_model():
        try:
            embedding = embedding_model.encode(text, convert_to_numpy=True)
            return embedding.tolist()
        except Exception as e:
            logger.warning(f"⚠️  嵌入失败: {e}，使用 fallback")
            return _get_fallback_embedding(text)
    else:
        return _get_fallback_embedding(text)


_reranker = None

def _get_reranker():
    global _reranker
    if _reranker is not None:
        return _reranker
    try:
        from sentence_transformers import CrossEncoder
        from huggingface_hub import scan_cache_dir
        cache = scan_cache_dir()
        model_cached = any("bge-reranker-base" in r.repo_id for r in cache.repos)
        if model_cached:
            logger.info("重排序模型已缓存，使用本地文件")
            _reranker = CrossEncoder('BAAI/bge-reranker-base', local_files_only=True)
            return _reranker
        logger.info("📥 正在下载重排序模型 (BAAI/bge-reranker-base)...")
        _reranker = CrossEncoder('BAAI/bge-reranker-base')
        logger.info("✅ 重排序模型下载成功")
        return _reranker
    except Exception as e:
        logger.warning(f"⚠️  重排序模型加载失败: {e}")
        return None


# ─── 启动初始化 ────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    global collection, _initialized, _document_count
    try:
        zvec_data_path = "./zvecdb"
        schema = zvec.CollectionSchema(
            name="learning_documents",
            vectors=zvec.VectorSchema("embedding", zvec.DataType.VECTOR_FP32, embedding_dim),
            fields=[
                zvec.FieldSchema("content", zvec.DataType.STRING, nullable=True),
                zvec.FieldSchema("title", zvec.DataType.STRING, nullable=True),
                zvec.FieldSchema("category", zvec.DataType.STRING, nullable=True),
                zvec.FieldSchema("filename", zvec.DataType.STRING, nullable=True),
                zvec.FieldSchema("content_length", zvec.DataType.INT64, nullable=True),
                zvec.FieldSchema("type", zvec.DataType.STRING, nullable=True),
                zvec.FieldSchema("author", zvec.DataType.STRING, nullable=True),
                zvec.FieldSchema("document_id", zvec.DataType.STRING, nullable=True),
            ]
        )

        if os.path.exists(zvec_data_path):
            logger.info(f"📂 检测到已有向量数据库: {zvec_data_path}，将直接打开")
        else:
            logger.info(f"🆕 向量数据库不存在，将创建新的: {zvec_data_path}")

        collection = zvec.create_and_open(path=zvec_data_path, schema=schema)
        _initialized = True
        _document_count = 0
        if os.path.exists(zvec_data_path):
            try:
                zero_v = [0.0] * embedding_dim
                count_results = collection.query(
                    vectors=zvec.VectorQuery("embedding", vector=zero_v),
                    topk=1024
                )
                _document_count = len(count_results) if count_results else 0
            except Exception as e:
                logger.warning(f"无法获取已有文档数量: {e}")
        logger.info(f"✅ Zvec 向量数据库初始化成功，已有 {_document_count} 条文档")

        logger.info("📥 开始加载嵌入模型...")
        _initialize_embedding_model()
        logger.info("📥 开始加载重排序模型...")
        _get_reranker()
    except Exception as e:
        logger.error(f"❌ 向量数据库初始化失败: {e}")
        collection = None
        _initialized = False


# ─── API 端点 ──────────────────────────────────────────────────

@app.post("/add")
def add_document(body: AddDocRequest):
    if not _initialized or collection is None:
        raise HTTPException(status_code=503, detail="向量数据库未初始化")
    global _document_count
    try:
        embedding = _get_embedding(body.content)
        doc_fields = {
            "content": body.content,
            "title": "",
            "category": "",
            "filename": "",
            "content_length": len(body.content),
            "type": "",
            "author": "",
            "document_id": ""
        }
        if body.metadata:
            for key, value in body.metadata.items():
                if key in doc_fields:
                    doc_fields[key] = value
                elif key == "full_content":
                    doc_fields["content"] = value

        doc = zvec.Doc(
            id=body.document_id,
            vectors={"embedding": embedding},
            fields=doc_fields
        )
        collection.insert(doc)
        _document_count += 1
        logger.info(f"✅ 文档添加成功: {body.document_id}")
        return {"success": True, "document_id": body.document_id}
    except Exception as e:
        logger.error(f"❌ 文档添加失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/add-batch")
def add_documents(body: AddDocsRequest):
    if not _initialized or collection is None:
        raise HTTPException(status_code=503, detail="向量数据库未初始化")
    try:
        success_count = 0
        for doc in body.documents:
            try:
                add_document(doc)
                success_count += 1
            except Exception as e:
                logger.warning(f"文档 {doc.document_id} 添加失败: {e}")
        return {"success": True, "count": success_count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search")
def search(body: SearchRequest):
    if not _initialized or collection is None:
        raise HTTPException(status_code=503, detail="向量数据库未初始化")
    try:
        query_embedding = _get_embedding(body.query)

        pool_size = max(body.n_results * 5, 50)
        results = collection.query(
            vectors=zvec.VectorQuery("embedding", vector=query_embedding),
            topk=pool_size,
        )
        documents = []
        for result in results:
            doc = {
                "id": result.id,
                "content": result.fields.get("content", ""),
                "metadata": {k: v for k, v in result.fields.items() if k != "content"},
                "distance": 1.0 - result.score
            }
            if body.where:
                match = True
                for key, value in body.where.items():
                    if doc["metadata"].get(key) != value:
                        match = False
                        break
                if not match:
                    continue
            documents.append(doc)

        if documents:
            from rank_bm25 import BM25Okapi
            import jieba
            tokenized_corpus = [list(jieba.cut(d["content"])) for d in documents]
            bm25 = BM25Okapi(tokenized_corpus)
            tokenized_query = list(jieba.cut(body.query))
            bm25_scores = bm25.get_scores(tokenized_query)

            K = 60
            rrf = {}
            for rank, doc in enumerate(documents):
                rrf[doc["id"]] = rrf.get(doc["id"], 0) + 1.0 / (K + rank + 1)
            bm25_ranked = sorted(enumerate(bm25_scores), key=lambda x: x[1], reverse=True)
            for rank, (idx, score) in enumerate(bm25_ranked):
                if score > 0:
                    doc_id = documents[idx]["id"]
                    rrf[doc_id] = rrf.get(doc_id, 0) + 1.0 / (K + rank + 1)

            doc_by_id = {d["id"]: d for d in documents}
            ranked_ids = sorted(rrf.keys(), key=lambda x: rrf[x], reverse=True)
            documents = []
            for doc_id in ranked_ids:
                doc_by_id[doc_id]["rrf_score"] = rrf[doc_id]
                documents.append(doc_by_id[doc_id])
                if len(documents) >= body.n_results:
                    break

        if documents and len(documents) >= 3:
            reranker = _get_reranker()
            if reranker:
                pairs = [[body.query, d["content"][:512]] for d in documents]
                try:
                    scores = reranker.predict(pairs)
                    for doc, score in zip(documents, scores):
                        doc["rerank_score"] = float(score)
                    documents.sort(key=lambda x: x["rerank_score"], reverse=True)
                    documents = documents[:body.n_results]
                except Exception as e:
                    logger.warning(f"重排序失败，使用原始排序: {e}")

        logger.info(f"✅ 搜索完成: 找到 {len(documents)} 个结果")
        return {"documents": documents}
    except Exception as e:
        logger.error(f"❌ 搜索失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/filter")
def filter_query(body: FilterRequest):
    """原生 filter 查询，不走 embedding/BM25/重排序，直接 zvec filter"""
    if not _initialized or collection is None:
        raise HTTPException(status_code=503, detail="向量数据库未初始化")
    try:
        zero_v = [0.0] * embedding_dim
        results = collection.query(
            vectors=zvec.VectorQuery("embedding", vector=zero_v),
            topk=min(body.n_results, 100000),
        )
        documents = []
        for result in results:
            doc = {
                "id": result.id,
                "content": result.fields.get("content", ""),
                "metadata": {k: v for k, v in result.fields.items() if k != "content"},
                "distance": 1.0 - result.score,
            }
            documents.append(doc)

        # 不在 C 层做 filter（zvec 要求严格 schema），改由 Python 层过滤
        if body.where and documents:
            filtered = []
            for doc in documents:
                match = True
                for key, value in body.where.items():
                    if doc["metadata"].get(key) != value:
                        match = False
                        break
                if match:
                    filtered.append(doc)
            documents = filtered

        logger.info(f"✅ Filter 查询完成: 找到 {len(documents)} 个结果")
        return {"documents": documents}
    except Exception as e:
        logger.error(f"❌ Filter 查询失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/delete")
def delete_document(body: DeleteRequest):
    if not _initialized or collection is None:
        raise HTTPException(status_code=503, detail="向量数据库未初始化")
    global _document_count
    try:
        collection.delete(body.document_id)
        _document_count = max(0, _document_count - 1)
        logger.info(f"✅ 文档删除成功: {body.document_id}")
        return {"success": True}
    except Exception as e:
        logger.error(f"❌ 文档删除失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/delete-by-doc-id")
def delete_by_document_id(body: DeleteByDocIdRequest):
    if not _initialized or collection is None:
        raise HTTPException(status_code=503, detail="向量数据库未初始化")
    global _document_count
    try:
        results = collection.query(
            vectors=zvec.VectorQuery("embedding", vector=[0.0] * embedding_dim),
            topk=1024
        )
        deleted_count = 0
        for result in results:
            if result.fields.get("document_id") == str(body.doc_id):
                collection.delete(result.id)
                deleted_count += 1
        _document_count = max(0, _document_count - deleted_count)
        logger.info(f"✅ 删除文档 {body.doc_id} 的 {deleted_count} 条向量数据")
        return {"success": True, "deleted_count": deleted_count}
    except Exception as e:
        logger.error(f"❌ 删除向量数据失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/get/{document_id}")
def get_document(document_id: str):
    if not _initialized or collection is None:
        raise HTTPException(status_code=503, detail="向量数据库未初始化")
    try:
        results = collection.query(
            vectors=zvec.VectorQuery("embedding", vector=[0.0] * embedding_dim),
            topk=1024
        )
        for result in results:
            if result.id == document_id:
                return {
                    "id": result.id,
                    "content": result.fields.get("content", ""),
                    "metadata": {k: v for k, v in result.fields.items() if k != "content"}
                }
        raise HTTPException(status_code=404, detail="文档不存在")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 获取文档失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/count")
def count_documents():
    if not _initialized or collection is None:
        return {"count": 0}
    return {"count": _document_count}


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "initialized": _initialized,
        "document_count": _document_count,
        "embedding_model": embedding_model is not None,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
