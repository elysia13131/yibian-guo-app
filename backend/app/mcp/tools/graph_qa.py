"""Graph RAG 问答工具：基于知识图谱的检索增强问答"""
import json
import os
import httpx
import logging

logger = logging.getLogger(__name__)


async def graph_qa(params: dict) -> str:
    """使用知识图谱回答问题的 MCP 工具。

    Args:
        params: {"query": "用户问题", "n_sources": 5}
    """
    query = params.get("query", "")
    n_sources = params.get("n_sources", 5)

    if not query.strip():
        return "请提供问题"

    try:
        from app.services.knowledge_graph_service import knowledge_graph_service

        related_nodes = knowledge_graph_service.search_nodes(query, level="L3", limit=n_sources * 2)

        if not related_nodes:
            related_nodes = knowledge_graph_service.search_nodes(query, limit=n_sources * 2)

        if not related_nodes:
            return "知识图谱中未找到与问题相关的节点"

        context_parts = []
        source_nodes = []
        visited = set()
        for node in related_nodes[:n_sources]:
            node_id = node.get("node_id", "")
            if node_id in visited:
                continue
            visited.add(node_id)
            detail = knowledge_graph_service.get_node_detail(node_id)
            if detail and detail.get("node"):
                n = detail["node"]
                title = n.get("title", "")
                content = n.get("content", "")
                level = n.get("level", "")
                community = n.get("community_id", "")
                rels = detail.get("relations", [])
                rel_desc = "; ".join(
                    f"{r.get('relation_type', '关联')} -> {r.get('target_id', '')}"
                    for r in rels[:3]
                )
                entry = f"[{level}] {title}"
                if content:
                    entry += f": {content[:200]}"
                if rel_desc:
                    entry += f" | 关系: {rel_desc}"
                if community:
                    entry += f" | 社区: {community}"
                context_parts.append(entry)
                source_nodes.append(node_id)

        if not context_parts:
            return "知识图谱中未找到与问题相关的节点"

        context = "\n".join(context_parts)
        prompt = f"""你是一个基于知识图谱的教育助手。请根据以下知识图谱中的实体信息回答用户问题。

知识图谱上下文：
{context}

用户问题：{query}

请基于图谱中的知识点给出准确、详细的回答。如果图谱信息不足以回答问题，请说明。"""

        api_base = os.getenv("MINICPM_API_BASE", "https://api.modelbest.co/v1")
        api_key = os.getenv("MINICPM_API_KEY", "")
        model = os.getenv("MINICPM_MODEL", "MiniCPM-V-4.6-Instruct")

        async with httpx.AsyncClient(timeout=60) as client:
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
            answer = result["choices"][0]["message"]["content"]

        sources_str = ", ".join(source_nodes)
        return f"{answer}\n\n📚 来源知识节点: {sources_str}"

    except Exception as e:
        logger.error(f"Graph QA 失败: {e}")
        return f"知识图谱问答处理失败: {e}"
