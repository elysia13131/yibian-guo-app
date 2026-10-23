from typing import List, Dict, Any, Optional
import logging
import os
import hashlib
import json
import asyncio
import functools
import threading
from concurrent.futures import ThreadPoolExecutor


def _suppress_stdout_fd():
    """重定向 C 层 stdout 到 nul，返回用于恢复的原 stdout fd"""
    devnull = os.open(os.devnull, os.O_WRONLY)
    old_fd = os.dup(1)
    os.dup2(devnull, 1)
    os.close(devnull)
    return old_fd


def _restore_stdout_fd(old_fd):
    """恢复 C 层 stdout"""
    os.dup2(old_fd, 1)
    os.close(old_fd)

logger = logging.getLogger(__name__)

# 服务器模式下禁用 tqdm 进度条
os.environ.setdefault('TQDM_DISABLE', '1')

ZVEC_SERVICE_URL = os.getenv("ZVEC_SERVICE_URL")

if ZVEC_SERVICE_URL:
    _USE_HTTP_MODE = True
    logger.info(f"🌐 ZVEC_SERVICE_URL 已设置，使用微服务模式: {ZVEC_SERVICE_URL}")
    import httpx
else:
    _USE_HTTP_MODE = False
    logger.info("🔧 ZVEC_SERVICE_URL 未设置，使用本地模式")
    import zvec
    import atexit
    import time
    os.environ.setdefault('HF_ENDPOINT', 'https://hf-mirror.com')
    try:
        from sentence_transformers import SentenceTransformer
        SENTENCE_TRANSFORMERS_AVAILABLE = True
    except Exception:
        SENTENCE_TRANSFORMERS_AVAILABLE = False
        logger.warning("sentence-transformers 不可用，将使用 fallback embedding")


_thread_ctx = threading.local()

class VectorDBService:

    def __init__(self):
        self.embedding_dim = 768
        self._document_count = 0
        self._executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="zvec")
        self._bg_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="zvec_bg")
        self._known_document_ids: set[str] = set()
        self._doc_ids_lock = threading.Lock()
        self.embedding_model = None
        self._embedding_failed = False
        self._use_fallback = False

        if _USE_HTTP_MODE:
            self._http_client = httpx.Client(timeout=30.0)
            self._initialized = True
            logger.info(f"✅ 向量数据库 HTTP 客户端就绪")
        else:
            self.collection = None
            self.embedding_model = None
            self._initialized = False
            self._init_failed = False
            self._embedding_failed = False
            self._use_fallback = False
            atexit.register(self._cleanup)
            self._initialize_embedding_model()

    def _cleanup(self):
        if self.collection is not None:
            try:
                self.collection.flush()
                logger.info("zvec 数据库已刷新并释放锁")
            except Exception:
                pass

    def ensure_initialized(self) -> bool:
        if _USE_HTTP_MODE:
            try:
                resp = self._http_client.get(f"{ZVEC_SERVICE_URL}/health", timeout=5.0)
                if resp.status_code == 200:
                    data = resp.json()
                    self._document_count = data.get("document_count", 0)
                    logger.info(f"✅ zvec 微服务连接成功，已有 {self._document_count} 条文档")
                    return True
                else:
                    logger.error(f"❌ zvec 微服务返回异常: {resp.status_code}")
                    return False
            except Exception as e:
                logger.error(f"❌ zvec 微服务连接失败: {e}")
                return False
        return self._ensure_initialized_local()

    def _ensure_initialized_local(self) -> bool:
        if self._initialized and self.collection:
            return True
        if self._init_failed and self.collection is None:
            logger.info("尝试重新初始化向量数据库...")
            self._init_failed = False
        try:
            zvec_data_path = "./zvecdb"
            schema = zvec.CollectionSchema(
                name="learning_documents",
                vectors=zvec.VectorSchema("embedding", zvec.DataType.VECTOR_FP32, self.embedding_dim),
                fields=[
                    zvec.FieldSchema("content", zvec.DataType.STRING, nullable=True),
                    zvec.FieldSchema("title", zvec.DataType.STRING, nullable=True),
                    zvec.FieldSchema("category", zvec.DataType.STRING, nullable=True),
                    zvec.FieldSchema("filename", zvec.DataType.STRING, nullable=True),
                    zvec.FieldSchema("content_length", zvec.DataType.INT64, nullable=True),
                    zvec.FieldSchema("type", zvec.DataType.STRING, nullable=True),
                    zvec.FieldSchema("author", zvec.DataType.STRING, nullable=True),
                    zvec.FieldSchema("document_id", zvec.DataType.STRING, nullable=True),
                    zvec.FieldSchema("node_id", zvec.DataType.STRING, nullable=True),
                    zvec.FieldSchema("node_type", zvec.DataType.STRING, nullable=True),
                    zvec.FieldSchema("level", zvec.DataType.STRING, nullable=True),
                    zvec.FieldSchema("source_id", zvec.DataType.STRING, nullable=True),
                    zvec.FieldSchema("target_id", zvec.DataType.STRING, nullable=True),
                    zvec.FieldSchema("relation_type", zvec.DataType.STRING, nullable=True),
                    zvec.FieldSchema("community_id", zvec.DataType.STRING, nullable=True),
                    zvec.FieldSchema("parents", zvec.DataType.STRING, nullable=True),
                ]
            )
            if os.path.exists(zvec_data_path):
                logger.info(f"📂 检测到已有向量数据库: {zvec_data_path}，将直接打开")
                last_err = None
                for retry in range(5):
                    try:
                        self.collection = zvec.open(path=zvec_data_path)
                        last_err = None
                        break
                    except Exception as open_err:
                        last_err = open_err
                        if "lock" in str(open_err).lower():
                            logger.warning(f"数据库被锁定（第{retry+1}次），等待重试: {open_err}")
                            time.sleep(2)
                        else:
                            raise
                if last_err:
                    raise last_err
            else:
                logger.info(f"🆕 向量数据库不存在，将创建新的: {zvec_data_path}")
                self.collection = zvec.create_and_open(path=zvec_data_path, schema=schema)
            self._initialized = True
            self._document_count = 0
            count_note = ""
            if os.path.exists(zvec_data_path):
                try:
                    zero_v = [0.0] * self.embedding_dim
                    count_results = self.collection.query(
                        vectors=zvec.VectorQuery("embedding", vector=zero_v),
                        topk=1024
                    )
                    self._document_count = len(count_results) if count_results else 0
                    if self._document_count >= 1024:
                        count_note = "(至少)"
                except Exception as e:
                    logger.warning(f"无法获取已有文档数量: {e}")
            logger.info(f"✅ Zvec数据库初始化成功{count_note}，已有 {self._document_count} 条文档")
            return True
        except Exception as e:
            logger.error(f"❌ 向量数据库初始化失败: {e}")
            self.collection = None
            self._initialized = False
            self._init_failed = True
            return False

    def _initialize_embedding_model(self):
        if self.embedding_model is not None:
            return True
        if self._embedding_failed:
            return False
        if not SENTENCE_TRANSFORMERS_AVAILABLE:
            logger.warning("sentence-transformers 不可用")
            return False
        try:
            logger.info("📥 正在加载本地嵌入模型 (BAAI/bge-base-zh-v1.5)...")
            old_endpoint = os.environ.get('HF_ENDPOINT')
            os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'
            try:
                from huggingface_hub import scan_cache_dir
                cache = scan_cache_dir()
                model_cached = any("bge-base-zh-v1.5" in r.repo_id for r in cache.repos)
                if model_cached:
                    logger.info("模型已缓存，使用本地文件")
                    self.embedding_model = SentenceTransformer(
                        'BAAI/bge-base-zh-v1.5', local_files_only=True
                    )
                else:
                    logger.info("模型未缓存，需要下载...")
                    self.embedding_model = SentenceTransformer('BAAI/bge-base-zh-v1.5')
            finally:
                if old_endpoint is None:
                    del os.environ['HF_ENDPOINT']
                else:
                    os.environ['HF_ENDPOINT'] = old_endpoint
            self.embedding_dim = 768
            logger.info("✅ 本地嵌入模型加载成功")
            return True
        except Exception as e:
            logger.warning(f"⚠️  加载嵌入模型失败: {e}，使用 fallback")
            self.embedding_model = None
            self._embedding_failed = True
            return False

    def _get_fallback_embedding(self, text: str) -> List[float]:
        text_hash = hashlib.md5(text.encode()).digest()
        embedding = []
        for i in range(self.embedding_dim):
            byte_val = text_hash[i % len(text_hash)]
            val = (byte_val / 255.0) * 2.0 - 1.0
            if i < len(text):
                char_val = ord(text[i % len(text)]) / 127.0 - 1.0
                val = (val + char_val) / 2.0
            embedding.append(val)
        return embedding

    def _get_embedding(self, text: str) -> List[float]:
        if _USE_HTTP_MODE:
            self._use_fallback = True
            return self._get_fallback_embedding(text)
        if self._initialize_embedding_model():
            try:
                embedding = self.embedding_model.encode(text, convert_to_numpy=True)
                return embedding.tolist()
            except Exception as e:
                logger.warning(f"⚠️  本地嵌入模型失败: {e}，使用 fallback")
                self._use_fallback = True
                return self._get_fallback_embedding(text)
        else:
            self._use_fallback = True
            return self._get_fallback_embedding(text)

    def _get_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        """批量生成嵌入向量（一次 encode，内部自动 batch）"""
        if _USE_HTTP_MODE:
            self._use_fallback = True
            return [self._get_fallback_embedding(t) for t in texts]
        if self._initialize_embedding_model():
            try:
                embeddings = self.embedding_model.encode(texts, convert_to_numpy=True, batch_size=32)
                return [emb.tolist() for emb in embeddings]
            except Exception as e:
                logger.warning(f"⚠️  批量嵌入失败: {e}，逐个回退")
                return [self._get_embedding(t) for t in texts]
        else:
            self._use_fallback = True
            return [self._get_fallback_embedding(t) for t in texts]

    def _get_reranker(self):
        if _USE_HTTP_MODE:
            return None
        lazy = "_reranker" in self.__dict__
        if not lazy:
            try:
                from sentence_transformers import CrossEncoder
                self._reranker = CrossEncoder('BAAI/bge-reranker-base')
            except Exception as e:
                logger.warning(f"重排序模型加载失败: {e}")
                self._reranker = None
        return self._reranker

    def add_document(
        self,
        document_id: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        if _USE_HTTP_MODE:
            try:
                resp = self._http_client.post(
                    f"{ZVEC_SERVICE_URL}/add",
                    json={"document_id": document_id, "content": content, "metadata": metadata},
                    timeout=30.0,
                )
                resp.raise_for_status()
                self._document_count += 1
                self._remember_document_id(metadata)
                logger.info(f"✅ 文档添加成功（微服务）: {document_id}")
                return True
            except Exception as e:
                logger.error(f"❌ 文档添加失败（微服务）: {e}")
                return False

        if not self._ensure_initialized_local():
            logger.error("向量数据库未初始化")
            return False
        try:
            embedding = self._get_embedding(content)
            doc_fields = {
                "content": content,
                "title": "",
                "category": "",
                "filename": "",
                "content_length": len(content),
                "type": "",
                "author": "",
                "document_id": ""
            }
            if metadata:
                for key, value in metadata.items():
                    if key in doc_fields:
                        doc_fields[key] = value
                    elif key == "full_content":
                        doc_fields["content"] = value
                doc_fields["type"] = json.dumps(metadata, ensure_ascii=False)
                if "level" in metadata:
                    doc_fields["category"] = metadata["level"]
            doc = zvec.Doc(
                id=document_id,
                vectors={"embedding": embedding},
                fields=doc_fields
            )
            _old_stdout = _suppress_stdout_fd()
            try:
                self.collection.insert(doc)
            finally:
                _restore_stdout_fd(_old_stdout)
            self._document_count += 1
            self._remember_document_id(metadata)
            logger.info(f"✅ 文档添加成功: {document_id}")
            return True
        except Exception as e:
            logger.error(f"❌ 文档添加失败: {e}")
            return False

    def add_documents(
        self,
        documents: List[Dict[str, Any]]
    ) -> bool:
        if _USE_HTTP_MODE:
            try:
                docs_payload = [
                    {"document_id": d["id"], "content": d["content"], "metadata": d.get("metadata")}
                    for d in documents
                ]
                resp = self._http_client.post(
                    f"{ZVEC_SERVICE_URL}/add-batch",
                    json={"documents": docs_payload},
                    timeout=60.0,
                )
                resp.raise_for_status()
                data = resp.json()
                self._document_count += data.get('count', 0)
                logger.info(f"✅ 批量文档添加成功（微服务）: {data.get('count', 0)} 条")
                return True
            except Exception as e:
                logger.error(f"❌ 批量文档添加失败（微服务）: {e}")
                return False

        # 本地模式：调用真正的批量方法
        return self.add_documents_batch(documents)

    def add_documents_batch(self, documents: List[Dict[str, Any]]) -> bool:
        """批量添加文档（一次性生成所有 embedding + 批量 insert + 单次 flush）"""
        if _USE_HTTP_MODE:
            return self.add_documents(documents)

        if not self._ensure_initialized_local():
            logger.error("向量数据库未初始化")
            return False

        # 过滤空内容文档，按序处理
        valid = [d for d in documents if d.get("content", "").strip()]
        if not valid:
            return True

        try:
            texts = [d["content"] for d in valid]
            embeddings = self._get_embeddings_batch(texts)

            docs = []
            for i, doc_data in enumerate(valid):
                embedding = embeddings[i]
                doc_fields = {
                    "content": doc_data["content"],
                    "title": "",
                    "category": "",
                    "filename": "",
                    "content_length": len(doc_data["content"]),
                    "type": "",
                    "author": "",
                    "document_id": "",
                }
                metadata = doc_data.get("metadata")
                if metadata:
                    for key, value in metadata.items():
                        if key in doc_fields:
                            doc_fields[key] = value
                        elif key == "full_content":
                            doc_fields["content"] = value
                    doc_fields["type"] = json.dumps(metadata, ensure_ascii=False)
                    if "level" in metadata:
                        doc_fields["category"] = metadata["level"]

                doc = zvec.Doc(
                    id=doc_data["id"],
                    vectors={"embedding": embedding},
                    fields=doc_fields,
                )
                docs.append(doc)

            _old_stdout = _suppress_stdout_fd()
            try:
                self.collection.insert(docs)
                self.collection.flush()
            finally:
                _restore_stdout_fd(_old_stdout)
            self._document_count += len(docs)
            for d in valid:
                self._remember_document_id(d.get("metadata"))
            logger.info(f"✅ 批量文档添加成功: {len(docs)} 条")
            return True
        except Exception as e:
            logger.error(f"❌ 批量文档添加失败: {e}")
            return False

    def _remember_document_id(self, metadata: Optional[Dict]) -> None:
        """记录文档的 document_id（用于分页查询时完整枚举）"""
        if metadata and "document_id" in metadata:
            did = str(metadata["document_id"])
            if did:
                with self._doc_ids_lock:
                    self._known_document_ids.add(did)

    def forget_document_id(self, document_id: str) -> None:
        """主动遗忘一个 document_id（删除文档后调用）"""
        if document_id:
            with self._doc_ids_lock:
                self._known_document_ids.discard(document_id)

    @property
    def known_document_ids(self) -> set:
        with self._doc_ids_lock:
            return set(self._known_document_ids)

    def _should_paginate(self, where: Optional[Dict]) -> bool:
        """判断是否需要分页：当 n_results > 1024 时必须分页，否则底层单次查询截断数据。"""
        if where is None:
            return True
        return True  # 始终允许分页，避免大文档单次查询也只拿 1024 条

    def _query_single_batch(
        self,
        where: Optional[Dict[str, Any]] = None,
        topk: int = 1024,
    ) -> List[Dict[str, Any]]:
        """单次查询，内部函数不对外暴露分页逻辑
        
        where 支持两种格式：
        - 平铺 dict: {"key": "value", ...}  → 转为 "key = "value" and ..."
        - Chroma 风格: {"$and": [...], ...}  → 原样传递为 JSON (HTTP模式) 或尝试转换为字符串
        exclude_ids: 可选，排除已查到的 ID 列表（需底层支持 $nin）
        """
        try:
            filter_expr = None
            if where:
                # 检测 Chroma 风格 (含 $and/$or/$nin 等操作符)
                has_operator = any(k.startswith("$") for k in where.keys())
                if has_operator:
                    # 直接序列化为 JSON filter 字符串（ZVec 本地模式支持 JSON filter）
                    filter_expr = json.dumps(where)
                else:
                    parts = []
                    for key, value in where.items():
                        if isinstance(value, str):
                            parts.append(f'{key} = "{value}"')
                        else:
                            parts.append(f"{key} = {value}")
                    filter_expr = " and ".join(parts)
            zero_v = [0.0] * self.embedding_dim
            results = self.collection.query(
                vectors=zvec.VectorQuery("embedding", vector=zero_v),
                topk=topk,
                filter=filter_expr,
            )
            docs = []
            for result in results:
                meta = {k: v for k, v in result.fields.items() if k != "content"}
                if isinstance(meta.get("type"), str) and meta["type"].startswith("{"):
                    try:
                        parsed = json.loads(meta.pop("type"))
                        meta.update(parsed)
                    except json.JSONDecodeError:
                        pass
                docs.append({
                    "id": result.id,
                    "content": result.fields.get("content", ""),
                    "metadata": meta,
                    "distance": 1.0 - result.score,
                })
            return docs
        except Exception as e:
            logger.error(f"❌ 按条件查询失败: {e}")
            return []

    def query_by_filter(
        self,
        where: Optional[Dict[str, Any]] = None,
        n_results: int = 1024,
    ) -> List[Dict[str, Any]]:
        """按字段条件查询，不走 embedding 相似度，直接返回匹配的所有记录。

        支持分页：底层 filter 最大限制 1024 条，超过时自动拆分为逐文档查询。
        """
        if _USE_HTTP_MODE:
            try:
                resp = self._http_client.post(
                    f"{ZVEC_SERVICE_URL}/filter",
                    json={"n_results": n_results, "where": where or {}},
                    timeout=30.0,
                )
                resp.raise_for_status()
                data = resp.json()
                return data.get("documents", [])
            except Exception as e:
                logger.error(f"❌ 按条件查询失败（微服务）: {e}")
                return []

        if not self._ensure_initialized_local():
            logger.error("向量数据库未初始化")
            return []

        # 不需要分页：直接单次查询
        if n_results <= 1024 or not self._should_paginate(where):
            return self._query_single_batch(where=where, topk=n_results)

        # 需要分页：先查第一批，再逐文档补全
        first_batch = self._query_single_batch(where=where, topk=1024)
        if len(first_batch) < 1024:
            return first_batch[:n_results]

        seen_ids = {r["id"] for r in first_batch}
        all_results = list(first_batch)

        # 合并已知 document_id + 第一批中新出现的 document_id
        doc_ids = self.known_document_ids
        for r in first_batch:
            did = r.get("metadata", {}).get("document_id", "")
            if did:
                doc_ids.add(did)

        if not doc_ids:
            logger.warning("⚠️ 全库 >1024 条但无已知 document_id，分页不完整")
            return all_results[:n_results]

        # 逐文档查询补全（含单文档 $nin 分页，多轮遍历直到拿满或全部耗尽）
        pass_changed = True
        while len(all_results) < n_results and pass_changed:
            pass_changed = False
            for doc_id in sorted(doc_ids):  # 排序确保每轮遍历顺序稳定
                if len(all_results) >= n_results:
                    break
                doc_seen = set()  # 本文档本轮已见 ID
                doc_exhausted = False
                while len(all_results) < n_results and not doc_exhausted:
                    doc_where_base = {"document_id": doc_id}
                    if where:
                        doc_where_base.update(where)
                    if doc_seen:
                        doc_where = {"$and": [doc_where_base, {"id": {"$nin": list(doc_seen)}}]}
                    else:
                        doc_where = doc_where_base
                    doc_results = self._query_single_batch(where=doc_where, topk=1024)
                    new_count = 0
                    for r in doc_results:
                        if r["id"] not in seen_ids:
                            seen_ids.add(r["id"])
                            all_results.append(r)
                            new_count += 1
                            pass_changed = True
                            if len(all_results) >= n_results:
                                break
                    for r in doc_results:
                        doc_seen.add(r["id"])
                    if len(doc_results) < 1024:
                        doc_exhausted = True  # 返回不足 1024，该文档已无更多数据
                    if len(doc_seen) > 50000:
                        logger.warning(f"⚠️ 文档 {doc_id} 已排除 {len(doc_seen)} 个 ID，跳过")
                        doc_exhausted = True

        return all_results[:n_results]

    def search(
        self,
        query: str,
        n_results: int = 5,
        where: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        if _USE_HTTP_MODE:
            try:
                resp = self._http_client.post(
                    f"{ZVEC_SERVICE_URL}/search",
                    json={"query": query, "n_results": n_results, "where": where},
                    timeout=30.0,
                )
                resp.raise_for_status()
                data = resp.json()
                documents = data.get("documents", [])
                logger.info(f"✅ 搜索完成（微服务）: 找到 {len(documents)} 个结果")
                return documents
            except Exception as e:
                logger.error(f"❌ 搜索失败（微服务）: {e}")
                return []

        if not self._ensure_initialized_local():
            logger.error("向量数据库未初始化")
            return []
        try:
            query_embedding = self._get_embedding(query)

            pool_size = min(max(n_results * 5, 50), 1024)
            filter_expr = None
            if where:
                parts = []
                for key, value in where.items():
                    if isinstance(value, str):
                        parts.append(f'{key} = "{value}"')
                    else:
                        parts.append(f"{key} = {value}")
                filter_expr = " and ".join(parts)
            results = self.collection.query(
                vectors=zvec.VectorQuery("embedding", vector=query_embedding),
                topk=pool_size,
                filter=filter_expr,
            )
            documents = []
            for result in results:
                meta = {k: v for k, v in result.fields.items() if k != "content"}
                if isinstance(meta.get("type"), str) and meta["type"].startswith("{"):
                    try:
                        parsed = json.loads(meta.pop("type"))
                        meta.update(parsed)
                    except json.JSONDecodeError:
                        pass
                doc = {
                    "id": result.id,
                    "content": result.fields.get("content", ""),
                    "metadata": meta,
                    "distance": 1.0 - result.score
                }
                if where:
                    match = True
                    for key, value in where.items():
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
                tokenized_query = list(jieba.cut(query))
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
                    if len(documents) >= n_results:
                        break

            if documents and len(documents) >= 3:
                reranker = self._get_reranker()
                if reranker:
                    pairs = [[query, d["content"][:512]] for d in documents]
                    try:
                        scores = reranker.predict(pairs)
                        for doc, score in zip(documents, scores):
                            doc["rerank_score"] = float(score)
                        documents.sort(key=lambda x: x["rerank_score"], reverse=True)
                        documents = documents[:n_results]
                    except Exception as e:
                        logger.warning(f"重排序失败，使用原始排序: {e}")

            logger.info(f"✅ 搜索完成: 找到 {len(documents)} 个结果")
            return documents
        except Exception as e:
            logger.error(f"❌ 搜索失败: {e}")
            return []

    def delete_document(self, document_id: str) -> bool:
        if _USE_HTTP_MODE:
            try:
                resp = self._http_client.post(
                    f"{ZVEC_SERVICE_URL}/delete",
                    json={"document_id": document_id},
                )
                resp.raise_for_status()
                self._document_count = max(0, self._document_count - 1)
                logger.info(f"✅ 文档删除成功（微服务）: {document_id}")
                return True
            except Exception as e:
                logger.error(f"❌ 文档删除失败（微服务）: {e}")
                return False

        if not self._ensure_initialized_local():
            logger.error("向量数据库未初始化")
            return False
        try:
            self.collection.delete(document_id)
            self.collection.flush()
            self._document_count = max(0, self._document_count - 1)
            logger.info(f"✅ 文档删除成功: {document_id}")
            return True
        except Exception as e:
            logger.error(f"❌ 文档删除失败: {e}")
            return False

    def delete_documents_batch(self, document_ids: List[str]) -> int:
        """批量删除文档（多次 delete + 单次 flush）"""
        if not document_ids:
            return 0

        if _USE_HTTP_MODE:
            # 微服务模式：fallback 到逐条删除
            deleted = 0
            for did in document_ids:
                if self.delete_document(did):
                    deleted += 1
            return deleted

        if not self._ensure_initialized_local():
            return 0

        deleted = 0
        for did in document_ids:
            try:
                self.collection.delete(did)
                deleted += 1
            except Exception:
                pass
        if deleted > 0:
            self.collection.flush()
            self._document_count = max(0, self._document_count - deleted)
            logger.info(f"✅ 批量删除成功: {deleted} 条")
        return deleted

    def delete_search_and_batch(self, where: Dict[str, Any]) -> int:
        """搜索匹配条件的文档并批量删除（search + batch delete，单次 flush）
        
        这是 delete_by_document_id 的通用版本，通过 where 条件过滤。
        """
        if _USE_HTTP_MODE:
            # 微服务模式：搜索后逐条删除
            results = self.search(query=" ", n_results=200, where=where)
            ids = [r["id"] for r in results if r.get("id")]
            return self.delete_documents_batch(ids)

        if not self._ensure_initialized_local():
            return 0

        try:
            pool_size = 1024
            zero_v = [0.0] * self.embedding_dim
            # 构建 filter 表达式
            filter_expr = None
            if where:
                parts = []
                for key, value in where.items():
                    if isinstance(value, str):
                        parts.append(f'{key} = "{value}"')
                    else:
                        parts.append(f"{key} = {value}")
                filter_expr = " and ".join(parts)
            results = self.collection.query(
                vectors=zvec.VectorQuery("embedding", vector=zero_v),
                topk=pool_size,
                filter=filter_expr,
            )
            ids_to_delete = [result.id for result in results]
            return self.delete_documents_batch(ids_to_delete)
        except Exception as e:
            logger.error(f"❌ 批量搜索删除失败: {e}")
            return 0

    def delete_by_document_id(self, doc_id: int, category: Optional[str] = None) -> int:
        if _USE_HTTP_MODE:
            try:
                body = {"doc_id": doc_id}
                if category:
                    body["category"] = category
                resp = self._http_client.post(
                    f"{ZVEC_SERVICE_URL}/delete-by-doc-id",
                    json=body,
                )
                resp.raise_for_status()
                data = resp.json()
                deleted = data.get("deleted_count", 0)
                self._document_count = max(0, self._document_count - deleted)
                logger.info(f"✅ 删除文档 {doc_id} 的 {deleted} 条向量数据（微服务）")
                return deleted
            except Exception as e:
                logger.error(f"❌ 删除向量数据失败（微服务）: {e}")
                return 0

        if not self._ensure_initialized_local():
            logger.error("向量数据库未初始化")
            return 0
        try:
            filter_expr = f'document_id = "{doc_id}"'
            if category:
                filter_expr += f' and category = "{category}"'
            zero_v = [0.0] * self.embedding_dim
            results = self.collection.query(
                vectors=zvec.VectorQuery("embedding", vector=zero_v),
                topk=1024,
                filter=filter_expr,
            )
            deleted_count = 0
            for result in results:
                self.collection.delete(result.id)
                deleted_count += 1
            self._document_count = max(0, self._document_count - deleted_count)
            logger.info(f"✅ 删除文档 {doc_id} 的 {deleted_count} 条向量数据（category={category})")
            return deleted_count
        except Exception as e:
            logger.error(f"❌ 删除向量数据失败: {e}")
            return 0

    def get_document(self, document_id: str) -> Optional[Dict[str, Any]]:
        if _USE_HTTP_MODE:
            try:
                resp = self._http_client.get(f"{ZVEC_SERVICE_URL}/get/{document_id}")
                if resp.status_code == 404:
                    return None
                resp.raise_for_status()
                return resp.json()
            except Exception as e:
                logger.error(f"❌ 获取文档失败（微服务）: {e}")
                return None

        if not self._ensure_initialized_local():
            logger.error("向量数据库未初始化")
            return None
        try:
            # 使用 filter 精确匹配，避免扫描全部 1024 条结果
            filter_expr = f'id = "{document_id}"'
            results = self.collection.query(
                vectors=zvec.VectorQuery("embedding", vector=[0.0] * self.embedding_dim),
                topk=1,
                filter=filter_expr,
            )
            for result in results:
                if result.id == document_id:
                    return {
                        "id": result.id,
                        "content": result.fields.get("content", ""),
                        "metadata": {k: v for k, v in result.fields.items() if k != "content"}
                    }
            return None
        except Exception as e:
            logger.error(f"❌ 获取文档失败: {e}")
            return None

    def count_documents(self) -> int:
        if _USE_HTTP_MODE:
            try:
                resp = self._http_client.get(f"{ZVEC_SERVICE_URL}/count")
                resp.raise_for_status()
                data = resp.json()
                self._document_count = data.get("count", 0)
                return self._document_count
            except Exception as e:
                logger.error(f"❌ 统计文档失败（微服务）: {e}")
                return 0

        if not self._ensure_initialized_local():
            return 0
        try:
            return self._document_count
        except Exception as e:
            logger.error(f"❌ 统计文档失败: {e}")
            return 0

    # ── 异步包装方法（在线程池中执行同步操作，避免阻塞事件循环） ──

    def use_background_executor(self):
        """将当前线程的向量操作切换到后台专用线程池，避免阻塞主线程池"""
        _thread_ctx.executor = self._bg_executor

    def use_normal_executor(self):
        """恢复当前线程的向量操作为默认线程池"""
        _thread_ctx.executor = self._executor

    async def _run(self, func, *args, **kwargs):
        """在 ThreadPoolExecutor 中执行同步函数"""
        loop = asyncio.get_running_loop()
        executor = getattr(_thread_ctx, 'executor', self._executor)
        return await loop.run_in_executor(
            executor, functools.partial(func, *args, **kwargs)
        )

    async def async_search(self, query: str = " ", n_results: int = 200,
                           where: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """异步非阻塞搜索"""
        return await self._run(self.search, query, n_results, where)

    async def async_add_document(self, document_id: str, content: str,
                                 metadata: Optional[Dict[str, Any]] = None) -> bool:
        """异步非阻塞添加文档"""
        return await self._run(self.add_document, document_id, content, metadata)

    async def async_add_documents_batch(self, documents: List[Dict[str, Any]]) -> bool:
        """异步非阻塞批量添加文档"""
        return await self._run(self.add_documents_batch, documents)

    async def async_delete_document(self, document_id: str) -> bool:
        """异步非阻塞删除文档"""
        return await self._run(self.delete_document, document_id)

    async def async_delete_documents_batch(self, document_ids: List[str]) -> int:
        """异步非阻塞批量删除文档"""
        return await self._run(self.delete_documents_batch, document_ids)

    async def async_delete_search_and_batch(self, where: Dict[str, Any]) -> int:
        """异步非阻塞搜索并批量删除"""
        return await self._run(self.delete_search_and_batch, where)

    async def async_get_document(self, document_id: str) -> Optional[Dict[str, Any]]:
        """异步非阻塞获取文档"""
        return await self._run(self.get_document, document_id)

    async def async_delete_by_document_id(self, doc_id: int, category: Optional[str] = None) -> int:
        """异步非阻塞按文档ID删除"""
        return await self._run(self.delete_by_document_id, doc_id, category)

    async def async_get_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        """异步非阻塞批量 embedding 计算（CPU密集）"""
        return await self._run(self._get_embeddings_batch, texts)

    async def async_query_by_filter(
        self,
        where: Optional[Dict[str, Any]] = None,
        n_results: int = 1024,
    ) -> List[Dict[str, Any]]:
        """异步非阻塞按条件查询"""
        return await self._run(self.query_by_filter, where, n_results)

    async def async_add_documents(self, documents: List[Dict[str, Any]]) -> bool:
        """异步非阻塞批量添加文档（路由到 add_documents / add_documents_batch）"""
        return await self._run(self.add_documents, documents)

try:
    vector_db_service = VectorDBService()
except Exception as e:
    logger.error(f"❌ 向量数据库服务初始化失败: {e}")
    vector_db_service = None