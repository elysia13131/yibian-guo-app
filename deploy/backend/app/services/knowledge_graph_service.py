from typing import List, Dict, Any, Optional
import logging
import json
import os
import asyncio

import httpx

from app.services.vector_db_service import vector_db_service

logger = logging.getLogger(__name__)


class KnowledgeGraphService:

    def __init__(self):
        self._vector = vector_db_service
        self._rebuild_lock = asyncio.Lock()

    async def add_node(
        self,
        node_id: str,
        title: str,
        content: str,
        level: str,
        document_id: str,
        community_id: str = "",
        parents: str = "",
        aliases: str = "",
        source_level: str = "",
        source_docs: str = "",
        is_public: bool = False,
    ) -> dict:
        metadata: Dict[str, Any] = {
            "node_id": node_id,
            "node_type": "entity",
            "title": title,
            "level": level,
            "document_id": document_id,
            "community_id": community_id,
            "parents": parents,
            "aliases": aliases,
            "source_level": source_level,
            "source_docs": source_docs,
            "is_public": "1" if is_public else "0",
            "source_id": "",
            "target_id": "",
            "relation_type": "",
        }
        doc_id = f"kg_{node_id}"
        success = await self._vector.async_add_document(
            document_id=doc_id,
            content=content,
            metadata=metadata,
        )
        return {"success": success, "id": doc_id, "node_id": node_id}

    async def add_relation(
        self,
        source_id: str,
        target_id: str,
        relation_type: str,
        level: str,
        document_id: str,
        inference_distance: int = 1,
    ) -> dict:
        node_id = f"{source_id}-{target_id}-{level}-d{inference_distance}"
        metadata: Dict[str, Any] = {
            "node_id": node_id,
            "node_type": "relation",
            "title": relation_type,
            "level": level,
            "document_id": document_id,
            "community_id": "",
            "parents": "",
            "source_id": source_id,
            "target_id": target_id,
            "relation_type": relation_type,
            "inference_distance": inference_distance,
        }
        doc_id = f"kg_{node_id}"
        content = f"{source_id} -> {target_id}: {relation_type}"
        success = await self._vector.async_add_document(
            document_id=doc_id,
            content=content,
            metadata=metadata,
        )
        return {"success": success, "id": doc_id, "node_id": node_id}

    def get_nodes_by_document(self, document_id: str, level: str) -> list:
        results = self._vector.query_by_filter(where={"document_id": document_id, "level": level}, n_results=50000)
        nodes = [r for r in results if r.get("metadata", {}).get("node_type") == "entity"]
        external_ids = set()
        node_ids_have = {n["metadata"]["node_id"] for n in nodes if n.get("metadata", {}).get("node_id")}
        # 1) 补上 merged_into 指向的目标实体
        for n in nodes:
            merged_into = n.get("metadata", {}).get("merged_into", "")
            if merged_into and merged_into not in node_ids_have and merged_into not in external_ids:
                external_ids.add(merged_into)
        # 2) 补上跨文档边引用的外部实体
        edges = self._vector.query_by_filter(where={"document_id": document_id, "level": level}, n_results=50000)
        for e in edges:
            meta = e.get("metadata", {})
            if meta.get("node_type") != "relation":
                continue
            src = meta.get("source_id", "")
            dst = meta.get("target_id", "")
            if src and src not in node_ids_have and src not in external_ids:
                external_ids.add(src)
            if dst and dst not in node_ids_have and dst not in external_ids:
                external_ids.add(dst)
        if external_ids:
            for eid in external_ids:
                try:
                    r = self._vector.query_by_filter(where={"node_id": eid})
                    for item in r:
                        if item.get("metadata", {}).get("node_type") == "entity" and item not in nodes:
                            nodes.append(item)
                except Exception:
                    pass
        return nodes

    def get_edges_by_document(self, document_id: str, level: str) -> list:
        results = self._vector.query_by_filter(where={"document_id": document_id, "level": level}, n_results=50000)
        return self._format_edges(results)

    def get_nodes_by_section(self, document_id: str, section_id: str) -> list:
        """按章节获取节点"""
        results = self._vector.query_by_filter(where={"document_id": document_id, "level": "L1"}, n_results=50000)
        nodes = []
        for r in results:
            meta = r.get("metadata", {})
            if meta.get("node_type") != "entity":
                continue
            parents_raw = meta.get("parents", "")
            try:
                parents = json.loads(parents_raw) if parents_raw else []
            except (json.JSONDecodeError, TypeError):
                parents = []
            if str(section_id) in [str(p) for p in parents]:
                nodes.append(r)
        return nodes

    async def async_get_nodes_by_document(self, document_id: str, level: str) -> list:
        results = await self._vector.async_query_by_filter(
            where={"document_id": document_id, "level": level}
        )
        return [r for r in results if r.get("metadata", {}).get("node_type") == "entity"]

    async def async_get_edges_by_document(self, document_id: str, level: str) -> list:
        results = await self._vector.async_query_by_filter(
            where={"document_id": document_id, "level": level}
        )
        return self._format_edges(results)

    @staticmethod
    def _format_edges(results: list) -> list:
        """将边数据中的 metadata 字段提升到顶层（前端期望 source/target/relation_type 在顶层）"""
        formatted = []
        for r in results:
            if r.get("metadata", {}).get("node_type") != "relation":
                continue
            meta = r.get("metadata", {})
            formatted.append({
                "source": meta.get("source_id", ""),
                "target": meta.get("target_id", ""),
                "relation_type": meta.get("relation_type", ""),
                "inference_distance": meta.get("inference_distance", 1),
                "id": r.get("id", ""),
                "metadata": meta,
            })
        return formatted

    async def _rewrite_edges_for_entity(self, document_id: str, old_entity_id: str, new_entity_id: str, level: str):
        """将文档中所有引用 old_entity_id 的边改写为 new_entity_id（批量版本）"""
        where = {"document_id": document_id, "level": level}
        results = await self._vector.async_query_by_filter(where=where)
        edges = [r for r in results if r.get("metadata", {}).get("node_type") == "relation"]
        to_delete = []
        new_relations = []  # 收集所有新边，最后批量创建
        for edge in edges:
            meta = edge.get("metadata", {})
            src = meta.get("source_id", "")
            dst = meta.get("target_id", "")
            rtype = meta.get("relation_type", "")
            edge_doc_id = edge.get("id", "")
            if not edge_doc_id:
                continue
            new_src = new_entity_id if src == old_entity_id else src
            new_dst = new_entity_id if dst == old_entity_id else dst
            if new_src == new_dst:
                # 合并后两端指向同一实体，该边无意义，直接删除
                to_delete.append(edge_doc_id)
            elif src != new_src or dst != new_dst:
                # 删除旧边，创建新边
                to_delete.append(edge_doc_id)
                new_relations.append((new_src, new_dst, rtype, level, document_id))
        # 批量创建新边
        if new_relations:
            batch_docs = []
            for src, dst, rtype, lvl, did in new_relations:
                node_id = f"{src}-{dst}-{level}-d1"
                batch_docs.append({
                    "id": f"kg_{node_id}",
                    "content": f"{src} -> {dst}: {rtype}",
                    "metadata": {
                        "node_id": node_id,
                        "node_type": "relation",
                        "title": rtype,
                        "level": lvl,
                        "document_id": did,
                        "community_id": "",
                        "parents": "",
                        "source_id": src,
                        "target_id": dst,
                        "relation_type": rtype,
                        "inference_distance": 1,
                    },
                })
            await self._vector.async_add_documents_batch(batch_docs)
        if to_delete:
            await self._vector.async_delete_documents_batch(to_delete)

    def get_nodes_by_section(self, document_id: str, section_id: str) -> list:
        results = self._vector.query_by_filter(where={"document_id": document_id, "level": "L1"})
        l1_entities = [r for r in results if r.get("metadata", {}).get("node_type") == "entity"]
        if not section_id:
            return l1_entities
        filtered = []
        for doc in l1_entities:
            parents_raw = doc.get("metadata", {}).get("parents", "")
            if not parents_raw:
                continue
            try:
                parents_list = json.loads(parents_raw)
            except (json.JSONDecodeError, TypeError):
                continue
            if isinstance(parents_list, list) and section_id in parents_list:
                filtered.append(doc)
            elif isinstance(parents_list, str) and parents_list == section_id:
                filtered.append(doc)
        return filtered

    async def delete_by_document(self, document_id: str, level: str = "") -> int:
        where: Dict[str, Any] = {"document_id": document_id}
        if level:
            where["level"] = level
        deleted = await self._vector.async_delete_search_and_batch(where)
        if deleted:
            logger.info(f"已删除文档 {document_id} 的 {deleted} 个{level}图谱节点")
        return deleted

    def search_nodes(self, query: str, level: str = "", limit: int = 20) -> list:
        if not query.strip():
            # 空查询：直接 filter 全量实体节点，不走语义搜索
            results = self._vector.query_by_filter(where={"node_type": "entity"}, n_results=limit * 3)
        else:
            results = self._vector.search(query=query, n_results=limit * 3)
        if level:
            results = [r for r in results
                       if r.get("metadata", {}).get("level") == level
                       and r.get("metadata", {}).get("node_type") == "entity"]
        return results[:limit]

    def get_node_detail(self, node_id: str) -> dict:
        node = self._vector.get_document(f"kg_{node_id}")
        if node is None:
            return {"node": None, "relations": []}

        all_items = self._vector.query_by_filter(where=None, n_results=50000)
        relations = [
            r for r in all_items
            if r.get("metadata", {}).get("node_type") == "relation"
            and (r.get("metadata", {}).get("source_id") == node_id
                 or r.get("metadata", {}).get("target_id") == node_id)
        ]
        return {"node": node, "relations": relations}

    def trace_node(self, node_id: str) -> dict:
        """溯源：显示节点合并轨迹（L1→L3映射链）"""
        node = self._vector.get_document(f"kg_{node_id}")
        if node is None:
            return {"node": None, "relations": []}

        all_items = self._vector.query_by_filter(where={"level": "L1"}, n_results=200000)
        relations = [
            r for r in all_items
            if r.get("metadata", {}).get("node_type") == "relation"
            and (r.get("metadata", {}).get("source_id") == node_id
                 or r.get("metadata", {}).get("target_id") == node_id)
        ]
        return {"node": node, "relations": relations}

    def get_edges_batch(self, node_ids: set) -> list:
        """批量查询一组节点之间的边（只查一次 DB，替代逐节点调用）"""
        all_items = self._vector.query_by_filter(where={"level": "L1"}, n_results=50000)
        relations = [
            r for r in all_items
            if r.get("metadata", {}).get("node_type") == "relation"
        ]
        result = []
        for rel in relations:
            meta = rel.get("metadata", {})
            src = meta.get("source_id")
            tgt = meta.get("target_id")
            if src in node_ids and tgt in node_ids:
                result.append(rel)
        return result

    def get_document_levels(self, document_id: str) -> dict:
        levels = {"l1": False}
        results = self._vector.query_by_filter(where={"document_id": document_id})
        for doc in results:
            level = doc.get("metadata", {}).get("level", "")
            if level == "L1":
                levels["l1"] = True
                break
        return levels

    def update_document_public_status(self, document_id: str, is_public: bool) -> int:
        """更新文档所有 L1 节点的公开状态（批量操作）。"""
        nodes = self.get_nodes_by_document(document_id, "L1")
        if not nodes:
            return 0
        batch_docs = []
        status_flag = "1" if is_public else "0"
        for doc in nodes:
            meta = doc.get("metadata", {})
            nid = meta.get("node_id", "")
            if nid:
                existing = self._vector.get_document(f"kg_{nid}")
                if existing:
                    existing["metadata"]["is_public"] = status_flag
                    batch_docs.append({
                        "id": f"kg_{nid}",
                        "content": existing.get("content", ""),
                        "metadata": existing["metadata"],
                    })
        if batch_docs:
            self._vector.add_documents_batch(batch_docs)
            logger.info(f"已批量更新文档 {document_id} 的 {len(batch_docs)} 个 L1 节点公开状态为 is_public={is_public}")
        return len(batch_docs)

    def get_stats(self) -> dict:
        all_docs = self._vector.query_by_filter(where=None, n_results=50000)
        total_nodes = 0
        total_edges = 0
        total_documents: set = set()
        level_counts: Dict[str, int] = {"L1": 0}

        for doc in all_docs:
            meta = doc.get("metadata", {})
            node_type = meta.get("node_type", "")
            if node_type == "entity":
                total_nodes += 1
            elif node_type == "relation":
                total_edges += 1

            doc_id = meta.get("document_id", "")
            if doc_id:
                total_documents.add(doc_id)

            level = meta.get("level", "")
            if level in level_counts:
                level_counts[level] += 1

        return {
            "total_nodes": total_nodes,
            "total_edges": total_edges,
            "total_documents": len(total_documents),
            "levels": level_counts,
        }

    def trace_node(self, node_id: str) -> dict:
        trace_result = {"node": None, "path": []}
        node = self._vector.get_document(f"kg_{node_id}")
        if node is None:
            return trace_result

        meta = node.get("metadata", {})
        trace_result["node"] = node
        trace_result["path"].append({
            "level": meta.get("level", ""),
            "node_id": node_id,
            "title": meta.get("title", ""),
            "source_level": meta.get("source_level", ""),
        })

        parents_raw = meta.get("parents", "")
        try:
            parent_ids = json.loads(parents_raw) if parents_raw else []
        except (json.JSONDecodeError, TypeError):
            parent_ids = []

        if parent_ids:
            all_parents = self._vector.query_by_filter(where=None, n_results=50000)
            parent_map = {}
            for doc in all_parents:
                nid = doc.get("metadata", {}).get("node_id", "")
                if nid in parent_ids:
                    parent_map[nid] = doc

            for pid in parent_ids[:10]:
                parent = parent_map.get(pid)
                if parent is None:
                    continue
                pm = parent.get("metadata", {})
                step = {
                    "level": pm.get("level", ""),
                    "node_id": pid,
                    "title": pm.get("title", ""),
                }

                pp_raw = pm.get("parents", "")
                try:
                    section_ids = json.loads(pp_raw) if pp_raw else []
                except (json.JSONDecodeError, TypeError):
                    section_ids = []

                if pm.get("level") == "L1" and section_ids:
                    step["section_ids"] = section_ids
                    step["document_id"] = pm.get("document_id", "")

                trace_result["path"].append(step)

        return trace_result

    # ── 公共 JSON 解析工具 ──

    @staticmethod
    def _clean_json_response(raw: str) -> Optional[str]:
        """清理 MiniCPM 返回文本中的 markdown 代码块，返回纯净 JSON 字符串"""
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()
        return cleaned

    @staticmethod
    def _repair_json(text: str) -> str:
        """修复 MiniCPM 常见的 JSON 格式问题（缺逗号、值引号等）"""
        import re
        # } 后跟 { 之间缺逗号（跨行或同行）
        text = re.sub(r'}\s*{', '},{', text)
        # "key": 中文值 缺引号
        text = re.sub(r':\s*([\u4e00-\u9fff][\u4e00-\u9fff\w]*)\s*([,}])', r': "\1"\2', text)
        return text

    @staticmethod
    def _parse_json_response(raw) -> Optional[dict]:
        """解析 MiniCPM 返回为 JSON 对象，失败返回 None"""
        if not isinstance(raw, str):
            if isinstance(raw, list):
                texts = []
                for part in raw:
                    if isinstance(part, dict) and part.get("type") == "text":
                        texts.append(part.get("text", ""))
                    elif isinstance(part, str):
                        texts.append(part)
                raw = "".join(texts)
            else:
                raw = str(raw)
        try:
            cleaned = knowledge_graph_service._clean_json_response(raw)
            cleaned = knowledge_graph_service._repair_json(cleaned)
            return json.loads(cleaned)
        except (json.JSONDecodeError, Exception):
            return None

    async def extract_knowledge_points(self, text: str, section_id: str, document_id: str) -> dict:
        prompt = (
            "你是一个知识图谱提取助手。请从以下文本中提取知识点实体和它们之间的关系。\n\n"
            "要求：\n"
            "1. 实体（entity）：尽量多地提取所有可独立理解的知识点（概念、公式、定义、定理、术语、方法、人名、时间、地点等），每个知识点的粒度适中，不要过大或过小。\n"
            "2. 关系（relation）：提取实体之间的语义关系，关系类型用简短的动词短语描述（如\"推导出\"、\"包含\"、\"用于\"、\"依赖\"、\"属于\"、\"示例\"等）\n"
            "3. 每个实体要有唯一的 id（英文或拼音，简短）、title（中文名称）、content（从原文中摘录的详细内容）\n"
            "4. 每个关系要有 source_id、target_id、relation_type\n"
            "5. 宁可多提取也不要遗漏，即使实体之间没有明显关系也先提取出来\n\n"
            "请直接输出 JSON，不要使用 markdown 代码块，不要包含任何其他文字。\n"
            "数组元素之间必须用逗号分隔，严格遵循 JSON 语法：\n"
            "{\n"
            '  "entities": [\n'
            '    {"id": "entity_id1", "title": "实体名称1", "content": "实体1的详细内容"},\n'
            '    {"id": "entity_id2", "title": "实体名称2", "content": "实体2的详细内容"}\n'
            "  ],\n"
            '  "relations": [\n'
            '    {"source_id": "entity_id1", "target_id": "entity_id2", "relation_type": "关系类型"}\n'
            "  ]\n"
            "}\n\n"
            "文本：\n"
            f"{text}"
        )

        # 重试：HTTP 失败 + JSON 解析失败 都重试，最多 3 次
        for attempt in range(1, 4):
            raw_content = await self._call_llm_with_retry(prompt, max_retries=1, timeout=180)
            if not raw_content:
                logger.warning(f"知识提取 LLM 返回空 (第{attempt}次)")
                await asyncio.sleep(1.5 ** attempt)
                continue

            result = self._parse_json_response(raw_content)
            if result is not None:
                return {
                    "entities": result.get("entities", []),
                    "relations": result.get("relations", []),
                }

            logger.warning(
                f"MiniCPM 返回非 JSON，将重试 (第{attempt}/3次): {raw_content[:200]}"
            )
            await asyncio.sleep(1.5 ** attempt)

        logger.error(f"知识提取失败，已达最大重试次数，section={section_id}")
        return {"entities": [], "relations": []}

    def _make_safe_id(self, original_id) -> str:
        if not original_id:
            return ""
        if isinstance(original_id, list):
            original_id = str(original_id[0]) if original_id else ""
        if not isinstance(original_id, str):
            original_id = str(original_id)
        if all(c.isascii() and (c.isalnum() or c in '_-') for c in original_id):
            return original_id
        import hashlib
        return f"id_{hashlib.md5(original_id.encode()).hexdigest()[:8]}"

    async def build_l1_graph(self, document_id: str, sections: list, is_public: bool = False) -> dict:
        # ── 查询所有已有 L1 实体节点，建立 title → node_id 映射（三级跨文档合并） ──
        existing = await self._vector.async_query_by_filter(
            where={"level": "L1"}, n_results=50000
        )
        existent_title_map = {}  # title → node_id (Level 1)
        existent_entities_for_l23 = []  # [{nid, title, content}] for Level 2+3
        for doc in existing:
            meta = doc.get("metadata", {})
            if meta.get("node_type") == "entity":
                nid = meta.get("node_id", "")
                title = meta.get("title", "")
                existent_title_map[title] = nid
                existent_entities_for_l23.append({"nid": nid, "title": title, "content": doc.get("content", "")})

        tasks = [
            self.extract_knowledge_points(section["content"], section["id"], document_id)
            for section in sections
        ]
        results = await asyncio.gather(*tasks)

        id_map = {}
        seen_entities = set()
        all_entities: list = []
        all_relations: list = []
        section_entity_map: dict = {}

        for idx, result in enumerate(results):
            section_id = sections[idx]["id"]
            entities = result.get("entities", [])
            relations = result.get("relations", [])

            section_entity_map[section_id] = []
            for entity in entities:
                eid = entity.get("id", "")
                if not eid:
                    logger.warning(f"跳过无 id 的实体: {entity}")
                    continue
                safe_id = self._make_safe_id(eid)
                title = entity.get("title", "")

                # Level 1: 精确标题匹配
                existing_id = existent_title_map.get(title)
                if existing_id:
                    id_map[eid] = existing_id
                    section_entity_map[section_id].append(existing_id)
                    logger.info(f"精确合并节点「{title}」→ {existing_id}")
                    continue

                id_map[eid] = safe_id
                entity["id"] = safe_id
                if safe_id not in seen_entities:
                    seen_entities.add(safe_id)
                    all_entities.append((section_id, eid, entity))
                    section_entity_map[section_id].append(safe_id)

            for relation in relations:
                source = relation.get("source_id", "")
                target = relation.get("target_id", "")
                rtype = relation.get("relation_type", "")
                if isinstance(source, (dict, list)):
                    source = str(source) if not isinstance(source, list) else (str(source[0]) if source else "")
                if isinstance(target, (dict, list)):
                    target = str(target) if not isinstance(target, list) else (str(target[0]) if target else "")
                if source and target and rtype:
                    relation["source_id"] = id_map.get(source, self._make_safe_id(source))
                    relation["target_id"] = id_map.get(target, self._make_safe_id(target))
                    all_relations.append(relation)

        # Level 2+3: Embedding + LLM 跨文档语义匹配
        if all_entities and existent_entities_for_l23:
            new_entity_list = all_entities  # [(section_id, eid, entity)]
            new_titles = [ent.get("title", "") for _, _, ent in new_entity_list]
            exist_titles = [e["title"] for e in existent_entities_for_l23]

            new_embs = await self._vector.async_get_embeddings_batch(new_titles)
            exist_embs = await self._vector.async_get_embeddings_batch(exist_titles)

            if new_embs and exist_embs and len(new_embs) == len(new_titles) and len(exist_embs) == len(exist_titles):
                import numpy as np
                new_arr = np.array(new_embs)
                exist_arr = np.array(exist_embs)

                matched: Dict[str, str] = {}  # safe_id → existing_nid
                candidate_pairs: list = []

                for i, (sid, eid, ent) in enumerate(new_entity_list):
                    safe_id = ent["id"]
                    if safe_id in matched:
                        continue
                    for j, ex_ent in enumerate(existent_entities_for_l23):
                        ex_nid = ex_ent["nid"]
                        sim = float(np.dot(new_arr[i], exist_arr[j]) / (
                            np.linalg.norm(new_arr[i]) * np.linalg.norm(exist_arr[j]) + 1e-10
                        ))
                        if sim >= 0.9:
                            # Level 2: 高相似度直接合并
                            matched[safe_id] = ex_nid
                            break
                        elif sim >= 0.6:
                            candidate_pairs.append((safe_id, ex_nid, ent.get("title", ""), ex_ent["title"],
                                                    ent.get("content", ""), ex_ent.get("content", ""), sim))

                # Level 3: LLM 验证 0.6-0.9
                if candidate_pairs:
                    async def _verify(ni, nj, ti, tj, ci, cj, sim):
                        if ni in matched:
                            return None
                        prompt = (
                            f"实体去重判断：以下两个来自不同文档的实体是否指代同一知识点（即相似度很高、应合并去重）？"
                            f"只回答 yes 或 no，不要输出其他内容。\n\n"
                            f"实体A: {ti}\n"
                            f"A 的描述: {(ci or '')[:80]}\n\n"
                            f"实体B: {tj}\n"
                            f"B 的描述: {(cj or '')[:80]}\n\n"
                            f"注意：如果两者是同一知识点的不同表述（如同义词、简称、不同翻译），回答 yes 进行合并。"
                        )
                        answer = await self._call_llm_with_retry(prompt)
                        if answer and answer.strip().lower().startswith("yes"):
                            return (ni, nj)
                        return None

                    llm_tasks = [_verify(ni, nj, ti, tj, ci, cj, sim) for ni, nj, ti, tj, ci, cj, sim in candidate_pairs]
                    llm_results = await asyncio.gather(*llm_tasks)
                    for r in llm_results:
                        if r:
                            ni, nj = r
                            if ni not in matched:
                                matched[ni] = nj

                # 应用 Level 2+3 匹配结果：改写关系 + 更新 section_entity_map
                if matched:
                    matched_safe_ids = set(matched.keys())
                    # 更新 all_relations：将新实体的 ID 替换为已有实体的 ID
                    for rel in all_relations:
                        rs = rel.get("source_id", "")
                        rt = rel.get("target_id", "")
                        if rs in matched:
                            rel["source_id"] = matched[rs]
                        if rt in matched:
                            rel["target_id"] = matched[rt]
                    # 更新 section_entity_map
                    for sec_id, nid_list in section_entity_map.items():
                        for k, nid in enumerate(nid_list):
                            if nid in matched:
                                nid_list[k] = matched[nid]
                    # 更新 id_map（让原始 eid 指向已有节点）
                    for _, eid_orig, ent in new_entity_list:
                        safe_id = ent["id"]
                        if safe_id in matched:
                            id_map[eid_orig] = matched[safe_id]
                    # 从 all_entities 中移除已匹配的（它们不需要创建新节点）
                    all_entities = [
                        (sid, eid, ent) for sid, eid, ent in all_entities
                        if ent["id"] not in matched_safe_ids
                    ]
                    logger.info(f"跨文档语义合并: Level2/3 matched {len(matched)} 个实体")

        # ── 批量添加实体节点和关系到向量库 ──
        if all_entities or all_relations:
            batch_docs = []
            for section_id, _eid, entity in all_entities:
                metadata: Dict[str, Any] = {
                    "node_id": entity["id"],
                    "node_type": "entity",
                    "title": entity.get("title", ""),
                    "level": "L1",
                    "document_id": document_id,
                    "community_id": "",
                    "parents": json.dumps([f"{document_id}:{section_id}"], ensure_ascii=False),
                    "aliases": "",
                    "source_level": "",
                    "source_docs": "",
                    "is_public": "1" if is_public else "0",
                    "source_id": "",
                    "target_id": "",
                    "relation_type": "",
                }
                batch_docs.append({
                    "id": f"kg_{entity['id']}",
                    "content": entity.get("content", ""),
                    "metadata": metadata,
                })

            for relation in all_relations:
                src = relation.get("source_id", "")
                tgt = relation.get("target_id", "")
                rtype = relation.get("relation_type", "")
                node_id = f"{src}-{tgt}-L1-d1"
                metadata: Dict[str, Any] = {
                    "node_id": node_id,
                    "node_type": "relation",
                    "title": rtype,
                    "level": "L1",
                    "document_id": document_id,
                    "community_id": "",
                    "parents": "",
                    "source_id": src,
                    "target_id": tgt,
                    "relation_type": rtype,
                    "inference_distance": 1,
                }
                batch_docs.append({
                    "id": f"kg_{node_id}",
                    "content": f"{src} -> {tgt}: {rtype}",
                    "metadata": metadata,
                })

            if batch_docs:
                await self._vector.async_add_documents_batch(batch_docs)

        return {
            "total_entities": len(all_entities),
            "total_relations": len(all_relations),
            "section_count": len(sections),
        }

    async def delete_l1_graph(self, document_id: str) -> int:
        return await self.delete_by_document(document_id, level="L1")

    async def _cross_section_process(self, document_id: str, is_public: bool = False) -> dict:
        """跨章节实体对齐和合并。

        在 L1 构建完成后、L2 社区检测之前执行。
        通过向量相似度找到跨章节的同义实体并合并（主/副标题格式），
        不创建新的语义关系边，只做实体合并。
        """
        from collections import defaultdict

        # Step 1: 获取该文档的所有 L1 实体，按章节分组
        all_l1 = await self._vector.async_query_by_filter(
            where={"document_id": document_id, "level": "L1"},
        )
        l1_entities = [
            r for r in all_l1
            if r.get("metadata", {}).get("node_type") == "entity"
        ]

        if len(l1_entities) < 2:
            return {"merged_entities": 0}

        section_entities: Dict[str, list] = defaultdict(list)
        entity_map: Dict[str, dict] = {}

        for doc in l1_entities:
            meta = doc.get("metadata", {})
            nid = meta.get("node_id", "")
            title = meta.get("title", "")
            content = doc.get("content", "") or ""
            parents_raw = meta.get("parents", "")
            try:
                parents = json.loads(parents_raw) if parents_raw else []
            except (json.JSONDecodeError, TypeError):
                parents = []
            section_id = str(parents[0]) if isinstance(parents, list) and parents else "unknown"
            section_entities[section_id].append((nid, title, content))
            entity_map[nid] = {"title": title, "content": content, "section_id": section_id}

        if len(section_entities) < 2:
            return {"merged_entities": 0}

        # Step 2: 向量相似度预筛选 — 跨章节实体对齐（三级合并）
        candidate_pairs: list = []
        alignment_groups: Dict[str, list] = {}  # group_id → member entity IDs
        entity_to_canonical: Dict[str, str] = {}  # entity_id → canonical_id
        next_group_id = 0

        def _make_alignment_group(nid_a: str, nid_b: str):
            """将两个实体归入同一对齐组，返回规范ID"""
            nonlocal next_group_id
            if nid_a in entity_to_canonical:
                canon = entity_to_canonical[nid_a]
                entity_to_canonical[nid_b] = canon
                alignment_groups[canon].append(nid_b)
                return canon
            if nid_b in entity_to_canonical:
                canon = entity_to_canonical[nid_b]
                entity_to_canonical[nid_a] = canon
                alignment_groups[canon].append(nid_a)
                return canon
            canon = nid_a
            entity_to_canonical[nid_a] = canon
            entity_to_canonical[nid_b] = canon
            alignment_groups[canon] = [nid_a, nid_b]
            return canon

        # Level 1: 标题精确匹配
        title_to_ids = {}
        for nid, data in entity_map.items():
            t = data["title"]
            if t and t in title_to_ids:
                other = title_to_ids[t]
                if other not in entity_to_canonical or nid not in entity_to_canonical:
                    _make_alignment_group(other, nid)
            title_to_ids[t] = nid

        # Level 2+3: Embedding + LLM 验证
        all_ids = [nid for nid in entity_map.keys() if nid not in entity_to_canonical]
        all_titles = [entity_map[nid]["title"] for nid in all_ids]
        embeddings = await self._vector.async_get_embeddings_batch(all_titles)

        if embeddings and len(embeddings) == len(all_ids):
            for i in range(len(all_ids)):
                if all_ids[i] in entity_to_canonical:
                    continue
                nid_i = all_ids[i]
                sec_i = entity_map[nid_i]["section_id"]
                for j in range(i + 1, len(all_ids)):
                    if all_ids[j] in entity_to_canonical:
                        continue
                    nid_j = all_ids[j]
                    if entity_map[nid_j]["section_id"] == sec_i:
                        continue  # 跳过同章节
                    sim = self._cosine_similarity(embeddings[i], embeddings[j])
                    if sim >= 0.9:
                        # 高相似度直接合并（不添加"等价于"边）
                        _make_alignment_group(nid_i, nid_j)
                    elif sim >= 0.6:
                        candidate_pairs.append((nid_i, nid_j, sim))

        # LLM 验证边界情况 (0.6 ~ 0.85)
        if candidate_pairs:
            async def _verify_alignment(ni: str, nj: str, sim: float):
                if ni in entity_to_canonical or nj in entity_to_canonical:
                    return None
                t_a = entity_map[ni]["title"]
                t_b = entity_map[nj]["title"]
                c_a = (entity_map[ni].get("content", "") or "")[:80]
                c_b = (entity_map[nj].get("content", "") or "")[:80]
                s_a = entity_map[ni]["section_id"]
                s_b = entity_map[nj]["section_id"]
                prompt = (
                    f"实体去重判断：以下两个来自不同章节的实体是否指代同一知识点（即相似度很高、应合并去重）？"
                    f"只回答 yes 或 no，不要输出其他内容。\n\n"
                    f"实体A（章节{s_a}）: {t_a}\n"
                    f"A 的描述: {c_a}\n\n"
                    f"实体B（章节{s_b}）: {t_b}\n"
                    f"B 的描述: {c_b}\n\n"
                    f"注意：如果两者是同一知识点的不同表述（如同义词、简称、不同翻译），回答 yes 进行合并。"
                )
                answer = await self._call_llm_with_retry(prompt)
                if answer and answer.strip().lower().startswith("yes"):
                    return (ni, nj)
                return None

            tasks = [_verify_alignment(ni, nj, sim) for ni, nj, sim in candidate_pairs]
            results = await asyncio.gather(*tasks)
            for r in results:
                if r is None:
                    continue
                ni, nj = r
                _make_alignment_group(ni, nj)

        # ── 跨章节实体合并 ──
        # 将同一对齐组中的非规范实体合并到规范实体中（删除 + 改写边 + 更新标题）
        merged_count = 0
        delete_ids: List[str] = []
        canon_updates = []  # 收集标题更新的实体，最后批量写入

        def _split_titles(title: str) -> list:
            """将可能包含 ' / ' 的标题分割为独立片段"""
            return [t.strip() for t in title.split(" / ") if t.strip()]

        for canon_id, member_ids in alignment_groups.items():
            # 收集该组所有唯一标题（如果已有" / "格式，先分割再收集）
            all_titles_seen = set(_split_titles(entity_map[canon_id]["title"]))
            # 收集所有章节ID
            all_sections_seen = {entity_map[canon_id]["section_id"]}
            for mid in member_ids:
                if mid == canon_id:
                    continue
                mt = entity_map[mid]["title"]
                for t in _split_titles(mt):
                    all_titles_seen.add(t)
                all_sections_seen.add(entity_map[mid]["section_id"])

                # 1. 改写指向该实体的边
                await self._rewrite_edges_for_entity(document_id, mid, canon_id, "L1")
                # 2. 批量删除已合并的非规范实体节点
                delete_ids.append(f"kg_{mid}")
                merged_count += 1

            # 3. 更新规范实体的标题（主 / 副标题格式）
            if len(all_titles_seen) > 1:
                titles_list = list(all_titles_seen)
                new_title = " / ".join(titles_list)
                # 删除旧实体节点，用新标题重新添加
                delete_ids.append(f"kg_{canon_id}")
                canon_updates.append({
                    "id": f"kg_{canon_id}",
                    "content": entity_map[canon_id].get("content", ""),
                    "metadata": {
                        "node_id": canon_id,
                        "node_type": "entity",
                        "title": new_title,
                        "level": "L1",
                        "document_id": document_id,
                        "community_id": "",
                        "parents": json.dumps(list(all_sections_seen), ensure_ascii=False),
                        "aliases": "",
                        "source_level": "",
                        "source_docs": "",
                        "is_public": "1" if is_public else "0",
                        "source_id": "",
                        "target_id": "",
                        "relation_type": "",
                    },
                })
                # 更新内存中的标题
                entity_map[canon_id]["title"] = new_title

        # 批量删除已合并的旧实体节点
        if delete_ids:
            await self._vector.async_delete_documents_batch(delete_ids)

        if canon_updates:
            await self._vector.async_add_documents_batch(canon_updates)

        logger.info(
            f"跨章节处理完成: merged_entities={merged_count}"
        )
        return {
            "merged_entities": merged_count,
        }

    async def _cross_document_semantic_merge(self, document_id: str, is_public: bool = False) -> dict:
        """跨文档语义实体合并（三级合并）。

        在 build_l1_graph 和 _cross_section_process 之后执行。
        将该文档的新实体与已有其他文档的实体做三级合并：
        Level 1: 标题精确匹配
        Level 2: embedding 相似度 >= 0.9 → 直接合并
        Level 3: 0.6 ~ 0.9 → LLM 验证 → 合并
        """
        from collections import defaultdict

        # 获取该文档当前所有 L1 实体
        doc_l1 = await self._vector.async_query_by_filter(
            where={"document_id": document_id, "level": "L1"},
        )
        doc_entities = [
            d for d in doc_l1
            if d.get("metadata", {}).get("node_type") == "entity"
        ]
        if not doc_entities:
            return {"merged_entities": 0, "llm_verified": 0}

        # 获取其他文档的 L1 实体
        other_l1 = await self._vector.async_query_by_filter(
            where={"level": "L1"}, n_results=50000
        )
        other_entities = [
            d for d in other_l1
            if d.get("metadata", {}).get("node_type") == "entity"
            and d.get("metadata", {}).get("document_id") != document_id
        ]
        if not other_entities:
            return {"merged_entities": 0, "llm_verified": 0}

        # 构建 this doc 的 entity map: nid → {title, content}
        doc_entity_map = {}
        for d in doc_entities:
            meta = d.get("metadata", {})
            nid = meta.get("node_id", "")
            if nid:
                doc_entity_map[nid] = {
                    "title": meta.get("title", ""),
                    "content": d.get("content", ""),
                    "metadata": meta,
                }

        # 构建 other docs 的 title → node_id 映射（Level 1）和 nid → title 列表（Level 2+3）
        other_title_map = {}  # title → [node_id, ...]
        other_entity_list = []  # [{nid, title, content}]
        for d in other_entities:
            meta = d.get("metadata", {})
            nid = meta.get("node_id", "")
            title = meta.get("title", "")
            if nid and title:
                other_title_map.setdefault(title, []).append(nid)
                other_entity_list.append({"nid": nid, "title": title, "content": d.get("content", ""), "metadata": meta})

        merged_count = 0
        llm_verified = 0
        delete_ids = []
        merge_updates = []
        canon_updates = []  # 收集 _sync_parents_to_canon 返回的 batch_doc，最后批量写入

        # 构建 other entity 查找映射
        other_entity_by_nid = {e["nid"]: e for e in other_entity_list}

        # Level 1: 标题精确匹配
        title_matched_doc = set()
        for nid, data in doc_entity_map.items():
            title = data["title"]
            if title and title in other_title_map:
                canon = other_title_map[title][0]
                # 改写边 + 标记 merged_into（不物理删除，保留文档级可见性）
                await self._rewrite_edges_for_entity(document_id, nid, canon, "L1")
                doc_meta_l1 = doc_entity_map[nid]["metadata"]
                merge_updates.append({
                    "id": f"kg_{nid}",
                    "content": doc_entity_map[nid].get("content", ""),
                    "metadata": {
                        **{k: v for k, v in doc_meta_l1.items()},
                        "merged_into": canon,
                    },
                })
                # 同步 parents 到 canon 实体
                canon_info = other_entity_by_nid.get(canon)
                if canon_info:
                    update = await self._sync_parents_to_canon(
                        nid, canon,
                        doc_entity_map[nid]["metadata"],
                        canon_info["metadata"],
                        canon_info.get("content", ""),
                        document_id,
                    )
                    if update:
                        canon_updates.append(update)
                title_matched_doc.add(nid)
                merged_count += 1
                logger.info(f"跨文档精确合并「{title}」→ {canon}")

        # Level 2+3: Embedding + LLM 验证（匹配尚未被合并的 doc 实体）
        remaining_doc = [
            nid for nid in doc_entity_map if nid not in title_matched_doc
        ]
        if remaining_doc and other_entity_list:
            remaining_titles = [doc_entity_map[nid]["title"] for nid in remaining_doc]
            doc_embs = await self._vector.async_get_embeddings_batch(remaining_titles)
            other_titles = [e["title"] for e in other_entity_list]
            other_embs = await self._vector.async_get_embeddings_batch(other_titles)

            if doc_embs and len(doc_embs) == len(remaining_doc) and other_embs and len(other_embs) == len(other_entity_list):
                # 对齐组管理
                entity_to_canonical = {}
                alignment_groups = {}
                existing_canonical = {}  # other nid → its current canonical
                for e in other_entity_list:
                    existing_canonical[e["nid"]] = e["nid"]

                def _make_group(doc_nid, other_nid):
                    nonlocal merged_count, llm_verified
                    canon = other_nid
                    if doc_nid in entity_to_canonical:
                        return
                    if other_nid in entity_to_canonical:
                        canon = entity_to_canonical[other_nid]
                    entity_to_canonical[doc_nid] = canon
                    alignment_groups.setdefault(canon, set()).add(doc_nid)
                    alignment_groups[canon].add(other_nid)

                # Batch 相似度计算
                import numpy as np
                doc_arr = np.array(doc_embs)
                other_arr = np.array(other_embs)
                candidate_pairs = []

                for i, doc_nid in enumerate(remaining_doc):
                    if doc_nid in entity_to_canonical:
                        continue
                    for j, other_entity in enumerate(other_entity_list):
                        other_nid = other_entity["nid"]
                        if other_nid in entity_to_canonical:
                            continue
                        sim = float(np.dot(doc_arr[i], other_arr[j]) / (
                            np.linalg.norm(doc_arr[i]) * np.linalg.norm(other_arr[j]) + 1e-10
                        ))
                        if sim >= 0.9:
                            _make_group(doc_nid, other_nid)
                            merged_count += 1
                        elif sim >= 0.6:
                            candidate_pairs.append((doc_nid, other_nid,
                                                    doc_entity_map[doc_nid]["title"],
                                                    other_entity["title"],
                                                    doc_entity_map[doc_nid].get("content", ""),
                                                    other_entity.get("content", ""), sim))

                # LLM 验证 0.6-0.9
                if candidate_pairs:
                    async def _verify(ni, nj, ti, tj, ci, cj, sim):
                        if ni in entity_to_canonical or nj in entity_to_canonical:
                            return None
                        prompt = (
                            f"实体去重判断：以下两个来自不同文档的实体是否指代同一知识点（即相似度很高、应合并去重）？"
                            f"只回答 yes 或 no，不要输出其他内容。\n\n"
                            f"实体A: {ti}\n"
                            f"A 的描述: {(ci or '')[:80]}\n\n"
                            f"实体B: {tj}\n"
                            f"B 的描述: {(cj or '')[:80]}\n\n"
                            f"注意：如果两者是同一知识点的不同表述（如同义词、简称、不同翻译），回答 yes 进行合并。"
                        )
                        answer = await self._call_llm_with_retry(prompt)
                        if answer and answer.strip().lower().startswith("yes"):
                            return (ni, nj)
                        return None

                    tasks = [_verify(ni, nj, ti, tj, ci, cj, sim) for ni, nj, ti, tj, ci, cj, sim in candidate_pairs]
                    results = await asyncio.gather(*tasks)
                    for r in results:
                        if r is None:
                            continue
                        ni, nj = r
                        if ni not in entity_to_canonical and nj not in entity_to_canonical:
                            _make_group(ni, nj)
                            llm_verified += 1
                            merged_count += 1

                # 执行合并（doc 实体 → other 规范实体）
                for doc_nid, canon_nid in entity_to_canonical.items():
                    if doc_nid == canon_nid:
                        continue
                    await self._rewrite_edges_for_entity(document_id, doc_nid, canon_nid, "L1")
                    # 不物理删除，而是标记 merged_into 保留文档级可见性
                    doc_meta_orig = doc_entity_map[doc_nid]["metadata"]
                    merge_updates.append({
                        "id": f"kg_{doc_nid}",
                        "content": doc_entity_map[doc_nid].get("content", ""),
                        "metadata": {
                            **{k: v for k, v in doc_meta_orig.items()},
                            "merged_into": canon_nid,
                        },
                    })
                    # 同步 parents 到 canon 实体
                    canon_info = other_entity_by_nid.get(canon_nid)
                    if canon_info:
                        update = await self._sync_parents_to_canon(
                            doc_nid, canon_nid,
                            doc_entity_map[doc_nid]["metadata"],
                            canon_info["metadata"],
                            canon_info.get("content", ""),
                            document_id,
                        )
                        if update:
                            canon_updates.append(update)

        if merge_updates:
            await self._vector.async_add_documents_batch(merge_updates)

        if canon_updates:
            await self._vector.async_add_documents_batch(canon_updates)

        logger.info(
            f"跨文档语义合并完成: merged={merged_count}, llm_verified={llm_verified}"
        )
        return {
            "merged_entities": merged_count,
            "llm_verified": llm_verified,
        }

    async def _sync_parents_to_canon(self, doc_nid: str, canon_nid: str, doc_meta: dict, canon_meta: dict, canon_content: str, document_id: str) -> Optional[dict]:
        """将 doc 实体的来源章节合并到 canon 实体的 parents 中。

        返回 batch_doc dict 供调用方批量写入，无变化时返回 None。
        """
        doc_parents_raw = doc_meta.get("parents", "")
        canon_parents_raw = canon_meta.get("parents", "")
        doc_parents = json.loads(doc_parents_raw) if doc_parents_raw else []
        canon_parents = json.loads(canon_parents_raw) if canon_parents_raw else []
        # 为 doc 的 parents 补上 document_id 前缀（如果是旧格式）
        doc_prefixed = []
        for p in doc_parents:
            if ":" not in str(p):
                doc_prefixed.append(f"{document_id}:{p}")
            else:
                doc_prefixed.append(p)
        merged = list(dict.fromkeys(canon_parents + doc_prefixed))  # dedup, keep order
        if set(merged) == set(canon_parents):
            return None  # 无变化
        canon_doc_id = canon_meta.get("document_id", "")
        parents_str = json.dumps(merged, ensure_ascii=False)
        return {
            "id": f"kg_{canon_nid}",
            "content": canon_content,
            "metadata": {
                "node_id": canon_nid,
                "node_type": "entity",
                "title": canon_meta.get("title", ""),
                "level": "L1",
                "document_id": canon_doc_id,
                "community_id": canon_meta.get("community_id", ""),
                "parents": parents_str,
                "aliases": canon_meta.get("aliases", ""),
                "source_level": canon_meta.get("source_level", ""),
                "source_docs": canon_meta.get("source_docs", ""),
                "is_public": canon_meta.get("is_public", "0"),
                "source_id": "",
                "target_id": "",
                "relation_type": "",
            },
        }

    async def _apply_transitive_inference(self, document_id: str) -> dict:
        """传递推理：如果 A→B 和 B→C 存在，则推理出 A→C。

        合成真实关系类型路径（如"包含→并列"），而非使用"传递推理"占位。
        推理出的边带 inference_distance（跳数），用于前端力模拟衰减。
        支持多跳传递（最多 MAX_HOPS 跳）。
        """
        # 具有传递性的关系类型白名单
        TRANSITIVE_TYPES = {
            "包含", "推导出", "导致", "等价于", "前置于",
            "隶属于", "包含于", "包括", "前提是", "特例于",
            "属于", "组成", "由...组成", "包括有", "含有",
            "引伸出", "延伸出", "衍生出", "来源于", "来自于",
            "前后置", "并列", "父子", "引用",
        }
        MAX_HOPS = 3

        edges = await self.async_get_edges_by_document(document_id, "L1")

        # 邻接表: src → [(dst, rtype)]
        adj: Dict[str, list] = {}
        # 已存在的边集合（避免重复创建）
        direct_edge_set: set = set()
        transitive_edge_set: set = set()

        for doc in edges:
            meta = doc.get("metadata", {})
            src = meta.get("source_id", "")
            dst = meta.get("target_id", "")
            rtype = meta.get("relation_type", "")
            dist = meta.get("inference_distance", 1)
            if src and dst and rtype in TRANSITIVE_TYPES:
                adj.setdefault(src, []).append((dst, rtype))
                if dist == 1:
                    direct_edge_set.add((src, dst))
                else:
                    transitive_edge_set.add((src, dst))

        inferred = 0
        batch_relations = []  # 收集所有推理边，最后批量创建

        # BFS 多跳传递推理
        for src in list(adj.keys()):
            # BFS 队列: (current_node, current_path_types, depth, path_nodes)
            queue = [(src, [], 0, [src])]
            visited_at_depth: Dict[str, int] = {src: 0}
            while queue:
                current, path_types, depth, path_nodes = queue.pop(0)
                if depth >= MAX_HOPS:
                    continue
                if current not in adj:
                    continue
                for next_dst, next_rtype in adj[current]:
                    if next_dst in path_nodes:
                        continue  # 防止环
                    new_types = path_types + [next_rtype]
                    new_depth = depth + 1
                    new_path = path_nodes + [next_dst]
                    if new_depth >= 2:
                        # 已经走了至少2步，可以创建传递边
                        infer_relation_type = "→".join(new_types)
                        infer_key = (src, next_dst)
                        # 如果已有直接边或已被传递推理过，跳过
                        if infer_key in direct_edge_set or infer_key in transitive_edge_set:
                            continue
                        node_id = f"{src}-{next_dst}-L1-d{new_depth}"
                        batch_relations.append({
                            "id": f"kg_{node_id}",
                            "content": f"{src} -> {next_dst}: {infer_relation_type}",
                            "metadata": {
                                "node_id": node_id,
                                "node_type": "relation",
                                "title": infer_relation_type,
                                "level": "L1",
                                "document_id": document_id,
                                "community_id": "",
                                "parents": "",
                                "source_id": src,
                                "target_id": next_dst,
                                "relation_type": infer_relation_type,
                                "inference_distance": new_depth,
                            },
                        })
                        inferred += 1
                        transitive_edge_set.add(infer_key)
                    # 继续 BFS（不重复已访问节点）
                    prev_depth = visited_at_depth.get(next_dst)
                    if prev_depth is None or new_depth < prev_depth:
                        visited_at_depth[next_dst] = new_depth
                        queue.append((next_dst, new_types, new_depth, new_path))

        if batch_relations:
            await self._vector.async_add_documents_batch(batch_relations)

        logger.info(f"传递推理完成: 新增 {inferred} 条边（最多 {MAX_HOPS} 跳）")
        return {"inferred_edges": inferred}

    async def delete_document_kg(self, document_id: str) -> dict:
        """删除文档的所有KG数据，并为相关联的文档增量重建跨文档关系。"""
        # 先获取该文档的 L1 实体 ID，用于之后找出相关联的文档
        doc_l1 = await self._vector.async_query_by_filter(
            where={"document_id": document_id, "level": "L1"},
        )
        deleted_entity_ids = set()
        for d in doc_l1:
            nid = d.get("metadata", {}).get("node_id", "")
            if nid:
                deleted_entity_ids.add(nid)

        l1_deleted = await self.delete_l1_graph(document_id)

        # 增量构建：只重建引用了该文档实体的其他文档（加锁串行）
        remaining_rebuilt = 0
        if deleted_entity_ids:
            async with self._rebuild_lock:
                try:
                    # 查询所有其他文档的边，找到引用已删除实体的文档
                    all_edges = self._vector.query_by_filter(
                        where={"level": "L1"}, n_results=50000
                    )
                    related_ids = set()
                    for edge in all_edges:
                        meta = edge.get("metadata", {})
                        src = meta.get("source_id", "")
                        tgt = meta.get("target_id", "")
                        edge_doc_id = meta.get("document_id", "")
                        if (src in deleted_entity_ids or tgt in deleted_entity_ids) and edge_doc_id != document_id:
                            related_ids.add(edge_doc_id)

                    for rid in related_ids:
                        try:
                            await self._cross_document_semantic_merge(rid, is_public=True)
                        except Exception as e:
                            logger.warning(f"跨文档合并失败 (document_id={rid}): {e}")
                        try:
                            await self._apply_transitive_inference(rid)
                        except Exception as e:
                            logger.warning(f"传递推理失败 (document_id={rid}): {e}")
                        remaining_rebuilt += 1
                except Exception as e:
                    logger.warning(f"增量重建跨文档关系失败: {e}")

        logger.info(f"已删除文档 {document_id} 的KG数据: L1={l1_deleted}, 关联文档增量重建={remaining_rebuilt}")
        return {"l1_deleted": l1_deleted, "remaining_rebuilt": remaining_rebuilt}

    def _get_llm_client(self) -> httpx.AsyncClient:
        """获取共享的 httpx 客户端（单例，避免文件描述符泄漏）"""
        if not hasattr(self, '_llm_client') or self._llm_client is None:
            self._llm_client = httpx.AsyncClient(
                timeout=120.0,
                limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
            )
        return self._llm_client

    async def _call_llm_with_retry(self, prompt: str, max_retries: int = 3, timeout: int = 120) -> Optional[str]:
        api_base = os.getenv("MINICPM_API_BASE", "https://api.modelbest.co/v1")
        api_key = os.getenv("MINICPM_API_KEY", "")
        model = os.getenv("MINICPM_MODEL", "MiniCPM-V-4.6-Instruct")

        client = self._get_llm_client()
        for attempt in range(1, max_retries + 1):
            try:
                resp = await client.post(
                    f"{api_base}/chat/completions",
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.3,
                    },
                    headers={"Authorization": f"Bearer {api_key}"},
                )
                result = resp.json()
                content = result["choices"][0]["message"]["content"]
                # 某些多模态 API 可能将 content 返回为列表
                if isinstance(content, list):
                    texts = []
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            texts.append(part.get("text", ""))
                        elif isinstance(part, str):
                            texts.append(part)
                    content = "".join(texts)
                return content
            except Exception as e:
                logger.warning(f"LLM 调用失败 (第{attempt}/{max_retries}次): {e}")
                import traceback
                logger.warning(f"LLM 调用 traceback:\n{traceback.format_exc()}")
                if attempt < max_retries:
                    wait = 1.5 ** attempt
                    await asyncio.sleep(wait)
        return None

    def _compute_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        try:
            return vector_db_service._get_embedding(texts)
        except Exception:
            try:
                return [vector_db_service._get_embedding(t) for t in texts]
            except Exception as e:
                logger.warning(f"批量 embedding 失败: {e}")
                return []

    def _cosine_similarity(self, a: List[float], b: List[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        na = sum(x * x for x in a) ** 0.5
        nb = sum(y * y for y in b) ** 0.5
        if na == 0 or nb == 0:
            return 0.0
        return dot / (na * nb)

    async def build_knowledge_graph(self, document_id: str, sections: list, is_public: bool = False, cancel_ev = None) -> dict:
        """构建完整知识图谱。cancel_ev 为 asyncio.Event，set 时中断构建并清理。"""
        result = {"l1": {}}

        async def _check():
            if cancel_ev and cancel_ev.is_set():
                logger.info(f"知识图谱构建取消: {document_id}")
                await self.delete_l1_graph(document_id)
                raise asyncio.CancelledError(f"graph build cancelled: {document_id}")

        try:
            await _check()
            await self.delete_l1_graph(document_id)
            l1_result = await self.build_l1_graph(document_id, sections, is_public=is_public)
            result["l1"] = l1_result
            logger.info(f"L1 知识图谱构建完成: {document_id}")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception(f"L1 知识图谱构建失败: {e}")
            result["l1"] = {"error": str(e)}

        try:
            await _check()
            cross_result = await self._cross_section_process(document_id, is_public=is_public)
            result["cross_section"] = cross_result
            logger.info(f"跨章节处理完成: {document_id}")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception(f"跨章节处理失败: {e}")
            result["cross_section"] = {"error": str(e)}

        try:
            await _check()
            cross_doc_result = await self._cross_document_semantic_merge(document_id, is_public=is_public)
            result["cross_doc_merge"] = cross_doc_result
            logger.info(f"跨文档语义合并完成: {document_id}")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception(f"跨文档语义合并失败: {e}")
            result["cross_doc_merge"] = {"error": str(e)}

        try:
            await _check()
            inference_result = await self._apply_transitive_inference(document_id)
            result["transitive_inference"] = inference_result
            logger.info(f"传递推理完成: {document_id}")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"传递推理失败: {e}")
            result["transitive_inference"] = {"error": str(e)}

        # flush 确保所有数据可见
        try:
            self._vector.collection.flush()
        except Exception:
            pass

        return result


    async def incremental_update_l3(self, document_id: str) -> dict:
        """文档公开/私密切换后，增量重建相关联文档的 L3 跨文档关系（加锁串行）。"""
        # 获取该文档的 L1 实体 node_id
        doc_l1 = self.get_nodes_by_document(document_id, "L1")
        entity_ids = {n.get("metadata", {}).get("node_id", "") for n in doc_l1 if n.get("metadata", {}).get("node_id", "")}
        if not entity_ids:
            return {"rebuilt": 0}

        async with self._rebuild_lock:
            # 查找引用了这些实体的其他文档
            all_nodes = self._vector.query_by_filter(
                where={"level": "L1"}, n_results=50000
            )
            related_ids = set()
            for node in all_nodes:
                meta = node.get("metadata", {})
                src = meta.get("source_id", "")
                tgt = meta.get("target_id", "")
                node_doc_id = meta.get("document_id", "")
                if (src in entity_ids or tgt in entity_ids) and node_doc_id != document_id:
                    related_ids.add(node_doc_id)

            rebuilt = 0
            for rid in related_ids:
                try:
                    await self._cross_document_semantic_merge(rid, is_public=True)
                    await self._apply_transitive_inference(rid)
                    rebuilt += 1
                except Exception as e:
                    logger.warning(f"增量 L3 重建失败 (document_id={rid}): {e}")

        logger.info(f"文档 {document_id} 公开状态切换后 L3 增量重建: {rebuilt} 个关联文档")
        return {"rebuilt": rebuilt}


knowledge_graph_service = KnowledgeGraphService()
