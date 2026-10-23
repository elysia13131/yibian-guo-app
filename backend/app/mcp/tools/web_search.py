import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)


async def web_search(params: Dict[str, Any]) -> str:
    """搜索互联网获取实时信息。

    Args:
        params: {"query": "搜索词", "count": 5}
    """
    query = params.get("query", "")
    count = params.get("count", 5)
    if not query:
        return "[错误] query 不能为空"

    from app.services.web_search_request_manager import web_search_request_manager
    results = await web_search_request_manager.search(query, top_k=count)
    if not results:
        return "未找到搜索结果"

    lines = [f"搜索 \"{query}\" 找到 {len(results)} 条结果："]
    for r in results:
        title = r.get("title", "")
        snippet = r.get("snippet", "")[:150]
        url = r.get("url", "")
        lines.append(f"\n## {title}\n{snippet}\n{url}")
    return "\n".join(lines)
