import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)


async def search_knowledge(params: Dict[str, Any]) -> str:
    """在用户的知识库中语义搜索。

    Args:
        params: {"query": "搜索词", "n_results": 5}
    """
    query = params.get("query", "")
    n_results = params.get("n_results", 5)
    if not query:
        return "[错误] query 不能为空"

    from app.services.vector_db_service import vector_db_service
    documents = vector_db_service.search(query=query, n_results=n_results)
    if not documents:
        return "未找到相关结果"

    lines = [f"找到 {len(documents)} 个结果："]
    for i, doc in enumerate(documents):
        content = doc.get("content", "")[:200]
        title = doc.get("metadata", {}).get("title", "")
        lines.append(f"\n{i+1}. [{title}]\n{content}")
    return "\n".join(lines)
