"""MCP 工具层 — 所有可被 Agent 调用的外部能力"""
import asyncio
import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)

MCP_TOOLS: Dict[str, Dict[str, Any]] = {
    "web_search": {
        "description": "搜索互联网获取实时信息。输入: query(搜索词), count(条数,默认5)。返回: 搜索结果摘要列表",
        "inputs": {"query": "str", "count": "int=5"},
        "timeout": 15,
    },
    "search_knowledge": {
        "description": "在用户的知识库中语义搜索。输入: query(搜索词), n_results(条数,默认5)。返回: 匹配的文档/章节片段",
        "inputs": {"query": "str", "n_results": "int=5"},
        "timeout": 10,
    },
    "graph_qa": {
        "description": "基于知识图谱回答问题。输入: query(问题), n_sources(检索节点数,默认5)。返回: 基于知识图谱的回答及来源节点",
        "inputs": {"query": "str", "n_sources": "int=5"},
        "timeout": 60,
    },
    "get_document": {
        "description": "获取指定文档的全文或指定章节内容。输入: document_id(int)或chapter_id(int)。返回: 文档/章节完整内容",
        "inputs": {"document_id": "int|null", "chapter_id": "int|null"},
        "timeout": 5,
    },
    "get_flashcards": {
        "description": "查询用户的抽认卡，返回卡片内容及FSRS记忆曲线参数(难度D/稳定性S/可提取性R/到期时间/计划天数/复习次数/遗忘次数)。输入: group_id(int,可选), status(str,可选)=new/learning/review/suspended, limit(int,默认20)。返回: 抽认卡列表含FSRS指标",
        "inputs": {"group_id": "int|null", "status": "str|null", "limit": "int=20"},
        "timeout": 5,
    },
    "get_user_stats": {
        "description": "获取用户的学习统计概况，包含抽认卡总数/待复习数/新卡片/学习中/平均难度D/平均稳定性S/复习次数。输入: user_id(int), days(int,默认30)。返回: 学习概况文本",
        "inputs": {"user_id": "int", "days": "int=30"},
        "timeout": 5,
    },
    "dispatch_tool_agent": {
        "description": "调用 ToolAgent LLM 循环，迭代调用工具生成产物（PPT/PDF/DOCX/图片）。输入: summary(str), specs(list[{agent_id, output, requirements, artifact_type}])。返回: 产物路径列表",
        "inputs": {"summary": "str", "specs": "list"},
        "timeout": 3600,
    },
    "generate_pdf": {
        "description": "将 Markdown 内容生成为 PDF 文件。输入: title(str), content(str), filename(str,可选)。返回: PDF 文件路径",
        "inputs": {"title": "str", "content": "str", "filename": "str|null"},
        "timeout": 30,
    },
    "generate_docx": {
        "description": "将 Markdown 内容生成为 Word (DOCX) 文件。输入: title(str), content(str), filename(str,可选)。返回: DOCX 文件路径",
        "inputs": {"title": "str", "content": "str", "filename": "str|null"},
        "timeout": 30,
    },
    "generate_pptx": {
        "description": "生成原生可编辑 PPTX 演示文稿。默认 mode='ppt-master'（创建项目→AI设计SVG→导出真实PPTX形状）。也支持 mode='simple'（python-pptx快速纯文字版）和 mode='export'（对已有项目运行finalize+svg_to_pptx）。输入: title(str), content(str), filename(str,可选), mode(str,可选), project_path(str,export必填), format(str,可选), transition(str,可选)=fade/push/wipe/split/random/none, animation(str,可选)=mixed/fade/none, animation_trigger(str,可选)=after-previous/on-click/with-previous。返回: JSON含pptx_path/project_path/action",
        "inputs": {"title": "str", "content": "str", "filename": "str|null", "mode": "str=ppt-master", "project_path": "str|null", "format": "str=ppt169", "transition": "str=fade", "animation": "str=mixed", "animation_trigger": "str=after-previous"},
        "timeout": 120,
    },
    "generate_image": {
        "description": "调用火山引擎 Seedream 4.0 生成图片。支持 mode='single'（文生单图）和 mode='group'（文生组图，最多15张）。输入: prompt(str), mode(str,可选)=single/group, count(int,可选)=1-15, size(str,可选)=2048x2048/16:9/1:1等, output_dir(str,可选)。返回: JSON含images路径列表",
        "inputs": {"prompt": "str", "mode": "str=single", "count": "int=4", "size": "str=2048x2048", "output_dir": "str|null", "filename": "str|null", "watermark": "bool=false"},
        "timeout": 60,
    },
    "convert_document": {
        "description": "将源文档（PDF/DOCX/URL/Markdown）转换为 Markdown 格式。利用 ppt-master 文档转换脚本。输入: source(str,必填,文件路径或URL), type(str,可选)=auto/pdf/docx/url。返回: JSON含markdown内容和file_path",
        "inputs": {"source": "str", "type": "str=auto"},
        "timeout": 120,
    },
    "create_pptx_project": {
        "description": "创建 ppt-master 项目，生成目录结构和设计规范。输入: title(str), content(str), filename(str,可选), format(str,可选)=ppt169。返回: JSON含project_path/design_spec/slide_plan",
        "inputs": {"title": "str", "content": "str", "filename": "str|null", "format": "str=ppt169"},
        "timeout": 30,
    },
    "save_svg_page": {
        "description": "保存一页 SVG 到 ppt-master 项目。输入: project_path(str), page_num(int), svg_content(str)。返回: JSON含page/path",
        "inputs": {"project_path": "str", "page_num": "int", "svg_content": "str"},
        "timeout": 10,
    },
    "save_notes": {
        "description": "保存讲稿到 ppt-master 项目。输入: project_path(str), notes_content(str)。返回: JSON含path",
        "inputs": {"project_path": "str", "notes_content": "str"},
        "timeout": 10,
    },
    "save_pptx_image": {
        "description": "把生成的图片复制到 ppt-master 项目的 images/ 目录。输入: project_path(str), image_path(str)。返回: JSON含project_path和relative_path",
        "inputs": {"project_path": "str", "image_path": "str", "filename": "str|null"},
        "timeout": 10,
    },
    "read_svg_page": {
        "description": "读取 ppt-master 项目中某页 SVG 的内容。输入: project_path(str), page_num(int)。返回: JSON含content",
        "inputs": {"project_path": "str", "page_num": "int"},
        "timeout": 10,
    },
    "read_project_file": {
        "description": "读取 ppt-master 项目中的文件内容（design_spec.md/spec_lock.md/slide_plan.md/_summary.json）。输入: project_path(str), filename(str)。返回: JSON含content",
        "inputs": {"project_path": "str", "filename": "str"},
        "timeout": 10,
    },
    "save_project_file": {
        "description": "保存设计文件到 ppt-master 项目（design_spec.md / spec_lock.md / slide_plan.md）。由 ToolAgent Strategist 阶段调用。输入: project_path(str), filename(str), content(str)。返回: JSON含保存结果",
        "inputs": {"project_path": "str", "filename": "str", "content": "str"},
        "timeout": 10,
    },
    "read_skill_reference": {
        "description": "读取 ppt-master 技能参考文档。可用路径: design_spec_reference / spec_lock_reference / strategist / shared_standards / canvas_formats / animations / layout:<布局名> / list_layouts。输入: path(str)。返回: 文档内容",
        "inputs": {"path": "str"},
        "timeout": 10,
    },
    "read_summary": {
        "description": "读取 ppt-master 项目的内容摘要JSON。输入: project_path(str)。返回: JSON含title和content",
        "inputs": {"project_path": "str"},
        "timeout": 10,
    },
    "ppt_export": {
        "description": "导出 ppt-master 项目为 PPTX。自动执行：SVG质量检查→讲稿拆分→后处理→导出。输入: project_path(str,必填)。返回: JSON含pptx_path和quality_warnings",
        "inputs": {"project_path": "str", "transition": "str=fade", "animation": "str=mixed", "animation_trigger": "str=after-previous", "auto_advance": "int|null"},
        "timeout": 120,
    },
}


async def invoke_tool(tool_name: str, params: dict, user_id: int = 0, **extra_kwargs) -> str:
    handler = _TOOL_HANDLERS.get(tool_name)
    if not handler:
        return f"[错误] 未知工具: {tool_name}"
    timeout = MCP_TOOLS.get(tool_name, {}).get("timeout", 10)
    try:
        result = await asyncio.wait_for(handler(params, user_id, **extra_kwargs), timeout=timeout)
        return result
    except asyncio.TimeoutError:
        return f"[超时] {tool_name} 在 {timeout}s 内未响应"
    except Exception as e:
        logger.exception(f"工具 {tool_name} 调用失败")
        return f"[错误] {tool_name} 调用失败: {str(e)}"


async def _tool_web_search(params: dict, user_id: int) -> str:
    from app.services.web_search_request_manager import WebSearchRequestManager
    manager = await WebSearchRequestManager.get_instance()
    if not manager:
        return "[错误] 搜索服务未就绪"
    result = await manager.search(
        query=params["query"], count=params.get("count", 5), summary=True
    )
    if not result:
        return "[空结果]"
    pages = result.get("webPages", {}).get("value", []) if "webPages" in result else result.get("results", [])
    lines = []
    for page in pages[:params.get("count", 5)]:
        snippet = page.get("summary") or page.get("snippet", "")
        url = page.get("url", "")
        name = page.get("name", "")
        if snippet:
            lines.append(f"- [{name}]({url}): {snippet[:300]}")
    return "\n".join(lines) if lines else "[空结果]"


async def _tool_search_knowledge(params: dict, user_id: int) -> str:
    from app.services.vector_db_service import vector_db_service
    if not vector_db_service:
        return "[错误] 知识库未就绪"
    results = vector_db_service.search(
        query=params["query"], n_results=params.get("n_results", 5)
    )
    if not results:
        return "[未找到相关文档]"
    lines = []
    for r in results:
        title = r.get("title", "无标题")
        content = r.get("content", "")[:400]
        lines.append(f"📄 {title}\n{content}")
    return "\n\n".join(lines)


async def _tool_graph_qa(params: dict, user_id: int) -> str:
    """基于知识图谱回答问题，返回实体及其关联节点的章节内容。"""
    from app.services.vector_db_service import vector_db_service
    import json

    if not vector_db_service:
        return "[错误] 知识库未就绪"

    query = params["query"]
    n_sources = params.get("n_sources", 5)

    # 1. 语义搜索找到相关 L1 实体
    results = vector_db_service.search(
        query=query, n_results=n_sources * 3
    )
    if not results:
        return "[未找到相关知识图谱节点]"

    # 过滤出 L1 实体节点，去重
    seen_nodes = set()
    entities = []
    for r in results:
        meta = r.get("metadata", {}) or {}
        if meta.get("node_type") == "entity" and meta.get("category") in ("L1",):
            nid = meta.get("node_id", "")
            if nid and nid not in seen_nodes:
                seen_nodes.add(nid)
                entities.append({
                    "node_id": nid,
                    "title": meta.get("title", ""),
                    "content": r.get("content", ""),
                    "document_id": meta.get("document_id", ""),
                    "parents": meta.get("parents", ""),
                })
                if len(entities) >= n_sources:
                    break

    if not entities:
        # 回退：直接搜索语义结果
        lines = []
        for r in results[:n_sources]:
            meta = r.get("metadata", {}) or {}
            title = meta.get("title") or r.get("title", "无标题")
            content = r.get("content", "")[:300]
            lines.append(f"📄 {title}\n{content}")
        return "（未找到知识图谱实体节点，以下为语义搜索结果）\n\n" + "\n\n".join(lines)

    # 2. 收集所有涉及的 document_id
    doc_ids = list({e["document_id"] for e in entities if e["document_id"]})

    # 3. 对每个 document 查询边（relation）
    entity_node_ids = {e["node_id"] for e in entities}
    related_pairs = []
    seen_edges = set()
    for did in doc_ids:
        edges = vector_db_service.query_by_filter(
            where={"document_id": did, "node_type": "relation"}
        )
        for edge in edges:
            em = edge.get("metadata", {}) or {}
            src = em.get("source_id", "")
            tgt = em.get("target_id", "")
            rel = em.get("relation_type", "")
            # 只取与被搜索实体相关的边
            if src in entity_node_ids or tgt in entity_node_ids:
                pair_key = f"{src}->{tgt}" if src < tgt else f"{tgt}->{src}"
                if pair_key not in seen_edges:
                    seen_edges.add(pair_key)
                    related_pairs.append((src, tgt, rel))

    # 4. 获取关联节点的信息
    related_entity_ids = set()
    for src, tgt, _ in related_pairs:
        if src in entity_node_ids:
            related_entity_ids.add(tgt)
        if tgt in entity_node_ids:
            related_entity_ids.add(src)

    related_entities = []
    if related_entity_ids:
        for reid in related_entity_ids:
            re_results = vector_db_service.query_by_filter(
                where={"node_id": reid}
            )
            for re in re_results:
                rem = re.get("metadata", {}) or {}
                if rem.get("node_type") == "entity":
                    related_entities.append({
                        "node_id": reid,
                        "title": rem.get("title", ""),
                        "content": re.get("content", ""),
                        "parents": rem.get("parents", ""),
                    })
                    break

    # 5. 获取章节内容
    def get_chapter_content(section_id: str) -> str:
        try:
            sid = int(section_id)
        except (ValueError, TypeError):
            return ""
        from app.db.session import SessionLocal
        from app.models.document import Chapter
        db = SessionLocal()
        try:
            ch = db.query(Chapter).filter(Chapter.id == sid).first()
            if ch:
                return f"【章节】{ch.title}\n{ch.content[:600]}"
            return ""
        except Exception:
            return ""
        finally:
            db.close()

    # 6. 格式化输出
    parts = [f"🔍 知识图谱回答 — 查询：{query}"]

    # 6a. 目标实体
    parts.append("\n📌 目标实体：")
    for e in entities:
        ch_lines = []
        if e["parents"]:
            try:
                section_ids = json.loads(e["parents"])
                for sid in section_ids[:3]:
                    ch = get_chapter_content(sid)
                    if ch:
                        ch_lines.append(ch)
            except (json.JSONDecodeError, TypeError):
                pass
        entity_text = f"▪ {e['title']}\n  {e['content'][:300]}"
        if ch_lines:
            entity_text += "\n  来源章节：\n  " + "\n  ".join(ch_lines)
        parts.append(entity_text)

    # 6b. 关联关系
    if related_pairs:
        parts.append("\n🔗 关联关系：")
        for src, tgt, rel in related_pairs:
            src_name = src
            tgt_name = tgt
            for e in entities + related_entities:
                if e["node_id"] == src:
                    src_name = e["title"]
                if e["node_id"] == tgt:
                    tgt_name = e["title"]
            parts.append(f"  {src_name} —[{rel}]→ {tgt_name}")

    # 6c. 关联节点
    if related_entities:
        parts.append("\n📎 关联节点：")
        for re in related_entities:
            ch_lines = []
            if re["parents"]:
                try:
                    section_ids = json.loads(re["parents"])
                    for sid in section_ids[:2]:
                        ch = get_chapter_content(sid)
                        if ch:
                            ch_lines.append(ch)
                except (json.JSONDecodeError, TypeError):
                    pass
            re_text = f"▪ {re['title']}\n  {re['content'][:200]}"
            if ch_lines:
                re_text += "\n  来源章节：\n  " + "\n  ".join(ch_lines)
            parts.append(re_text)

    return "\n\n".join(parts)


async def _tool_get_document(params: dict, user_id: int) -> str:
    from app.db.session import SessionLocal
    from app.models.document import Document, Chapter
    db = SessionLocal()
    try:
        if params.get("document_id"):
            doc = db.query(Document).filter(Document.id == params["document_id"]).first()
            if not doc:
                return "[文档不存在]"
            chapters = db.query(Chapter).filter(
                Chapter.document_id == doc.id
            ).order_by(Chapter.order_index).all()
            lines = [f"# {doc.title} ({doc.filename})"]
            for ch in chapters[:20]:
                lines.append(f"## {ch.title}\n{ch.content[:500]}")
            return "\n\n".join(lines)
        elif params.get("chapter_id"):
            ch = db.query(Chapter).filter(Chapter.id == params["chapter_id"]).first()
            if not ch:
                return "[章节不存在]"
            return f"## {ch.title}\n{ch.content}"
        return "[请指定 document_id 或 chapter_id]"
    finally:
        db.close()


async def _tool_get_flashcards(params: dict, user_id: int) -> str:
    from app.db.session import SessionLocal
    from app.models.flashcard import Flashcard
    from datetime import datetime
    db = SessionLocal()
    try:
        query = db.query(Flashcard).filter(Flashcard.owner_id == user_id)
        if params.get("group_id"):
            query = query.filter(Flashcard.group_id == params["group_id"])
        if params.get("status"):
            query = query.filter(Flashcard.status == params["status"])
        cards = query.limit(params.get("limit", 20)).all()
        if not cards:
            return "[暂无抽认卡]"
        now = datetime.now()
        lines = [f"找到 {len(cards)} 张抽认卡："]
        for c in cards:
            due_str = c.due.strftime("%m-%d %H:%M") if c.due else "未设定"
            overdue = (now - c.due).days if c.due and now > c.due else 0
            ahead_days = (c.due - now).days if c.due and c.due > now else 0
            due_info = (
                f"已逾期 {overdue} 天" if overdue > 0
                else f"距到期 {ahead_days} 天" if ahead_days > 0
                else "今天到期"
            ) if c.due else ""

            q = c.question[:100]
            if c.is_multiple_choice:
                a = (
                    f"选项: {c.options}, "
                    f"正确答案: {c.correct_option_labels or c.correct_option_label}"
                )
            else:
                a = c.answer[:200] if c.answer else ""
            lines.append(
                f"\n---\n"
                f"问题: {q}\n"
                f"答案: {a}\n"
                f"状态: {c.status} | 难度(D): {c.difficulty:.2f} | "
                f"稳定性(S): {c.stability:.2f} | 可提取性(R): {c.retrievability:.2f}\n"
                f"到期: {due_str} ({due_info}) | "
                f"排期: {c.scheduled_days:.1f} 天 | "
                f"复习: {c.reps} 次 | 遗忘: {c.lapses} 次"
            )
        return "\n".join(lines)
    finally:
        db.close()


async def _tool_get_user_stats(params: dict, user_id: int) -> str:
    from app.db.session import SessionLocal
    from app.models.flashcard import Flashcard, FlashcardReviewLog
    from app.models.document import ReadingSession
    from sqlalchemy import func
    from datetime import datetime, timedelta
    db = SessionLocal()
    try:
        uid = params.get("user_id", user_id)
        now = datetime.now()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_ago = today_start - timedelta(days=7)

        total_cards = db.query(func.count(Flashcard.id)).filter(
            Flashcard.owner_id == uid
        ).scalar() or 0

        due_today = db.query(func.count(Flashcard.id)).filter(
            Flashcard.owner_id == uid,
            Flashcard.due <= now,
            Flashcard.status.in_(["learning", "review"])
        ).scalar() or 0

        new_cards = db.query(func.count(Flashcard.id)).filter(
            Flashcard.owner_id == uid,
            Flashcard.status == "new"
        ).scalar() or 0

        learning_cards = db.query(func.count(Flashcard.id)).filter(
            Flashcard.owner_id == uid,
            Flashcard.status == "learning"
        ).scalar() or 0

        avg_difficulty = db.query(func.avg(Flashcard.difficulty)).filter(
            Flashcard.owner_id == uid
        ).scalar() or 0

        avg_stability = db.query(func.avg(Flashcard.stability)).filter(
            Flashcard.owner_id == uid
        ).scalar() or 0

        total_reviews = db.query(func.count(FlashcardReviewLog.id)).filter(
            FlashcardReviewLog.flashcard_id == Flashcard.id,
            Flashcard.owner_id == uid
        ).scalar() or 0

        today_reviews = db.query(func.count(FlashcardReviewLog.id)).filter(
            FlashcardReviewLog.flashcard_id == Flashcard.id,
            Flashcard.owner_id == uid,
            FlashcardReviewLog.review_time >= today_start
        ).scalar() or 0

        today_study_sec = (
            db.query(func.coalesce(func.sum(ReadingSession.total_duration), 0))
            .filter(ReadingSession.user_id == uid, ReadingSession.start_time >= today_start)
            .scalar() or 0
        )

        week_study_sec = (
            db.query(func.coalesce(func.sum(ReadingSession.total_duration), 0))
            .filter(ReadingSession.user_id == uid, ReadingSession.start_time >= week_ago)
            .scalar() or 0
        )

        today_study_min = round(today_study_sec / 60, 1)
        week_study_min = round(week_study_sec / 60, 1)
        daily_avg_min = round(week_study_min / 7, 1) if week_study_min > 0 else 0

        return (
            f"用户 {uid} 学习概况：\n"
            f"- 抽认卡总数: {total_cards} 张\n"
            f"  - 待复习(到期): {due_today} 张\n"
            f"  - 新卡片: {new_cards} 张\n"
            f"  - 学习中: {learning_cards} 张\n"
            f"- 卡片平均难度(D): {avg_difficulty:.2f}\n"
            f"- 卡片平均稳定性(S): {avg_stability:.2f}\n"
            f"- 今日学习: {today_study_min} 分钟\n"
            f"- 近7天学习总时长: {week_study_min} 分钟（日均 {daily_avg_min} 分钟）\n"
            f"- 今日复习卡片: {today_reviews} 张\n"
            f"- 累计复习次数: {total_reviews} 次"
        )
    finally:
        db.close()


async def _tool_dispatch_tool_agent(params: dict, user_id: int = 0, ws_send=None, task_id: str = "") -> str:
    from app.mcp.tools.dispatch_tool_agent import dispatch_tool_agent
    try:
        result = await dispatch_tool_agent(params, ws_send=ws_send, task_id=task_id)
        artifact_lines = []
        for a in result.get("artifacts", []):
            artifact_lines.append(f"- [{a['type']}] {a['title']}: {a['path']}")
        summary = result.get("summary", "")
        if artifact_lines:
            return f"{summary}\n\n产物：\n" + "\n".join(artifact_lines)
        return summary
    except Exception as e:
        err_str = str(e).replace('\u2705', '[OK]').replace('\u274c', '[ERR]')
        logger.error(f"ToolAgent 调用失败: {err_str}")
        return f"[错误] ToolAgent 调用失败: {err_str}"


async def _tool_generate_pdf(params: dict, user_id: int) -> str:
    from app.mcp.tools.generate_pdf import generate_pdf
    return await generate_pdf(params)


async def _tool_generate_docx(params: dict, user_id: int) -> str:
    from app.mcp.tools.generate_docx import generate_docx
    return await generate_docx(params)


async def _tool_generate_pptx(params: dict, user_id: int) -> str:
    from app.mcp.tools.generate_pptx import generate_pptx
    return await generate_pptx(params)


async def _tool_generate_image(params: dict, user_id: int) -> str:
    from app.mcp.tools.generate_image import generate_image
    return await generate_image(params)


async def _tool_convert_document(params: dict, user_id: int) -> str:
    from app.mcp.tools.convert_document import convert_document
    return await convert_document(params)


async def _tool_create_pptx_project(params: dict, user_id: int) -> str:
    from app.mcp.tools.pptx_pipeline import create_pptx_project
    return await create_pptx_project(params)


async def _tool_save_svg_page(params: dict, user_id: int) -> str:
    from app.mcp.tools.pptx_pipeline import save_svg_page
    return await save_svg_page(params)


async def _tool_save_notes(params: dict, user_id: int) -> str:
    from app.mcp.tools.pptx_pipeline import save_notes
    return await save_notes(params)


async def _tool_ppt_export(params: dict, user_id: int) -> str:
    from app.mcp.tools.pptx_pipeline import export_pptx
    return await export_pptx(params)


async def _tool_save_project_file(params: dict, user_id: int) -> str:
    from app.mcp.tools.pptx_pipeline import save_project_file
    return await save_project_file(params)


async def _tool_save_pptx_image(params: dict, user_id: int) -> str:
    from app.mcp.tools.pptx_pipeline import save_pptx_image
    return await save_pptx_image(params)


async def _tool_read_project_file(params: dict, user_id: int) -> str:
    from app.mcp.tools.pptx_pipeline import read_project_file
    return await read_project_file(params)


async def _tool_read_summary(params: dict, user_id: int) -> str:
    from app.mcp.tools.pptx_pipeline import read_summary
    return await read_summary(params)


async def _tool_read_svg_page(params: dict, user_id: int) -> str:
    from app.mcp.tools.pptx_pipeline import read_svg_page
    return await read_svg_page(params)


async def _tool_read_skill_reference(params: dict, user_id: int) -> str:
    from app.mcp.tools.pptx_pipeline import read_skill_reference
    return await read_skill_reference(params)


_TOOL_HANDLERS = {
    "web_search": _tool_web_search,
    "search_knowledge": _tool_search_knowledge,
    "graph_qa": _tool_graph_qa,
    "get_document": _tool_get_document,
    "get_flashcards": _tool_get_flashcards,
    "get_user_stats": _tool_get_user_stats,
    "dispatch_tool_agent": _tool_dispatch_tool_agent,
    "generate_pdf": _tool_generate_pdf,
    "generate_docx": _tool_generate_docx,
    "generate_pptx": _tool_generate_pptx,
    "generate_image": _tool_generate_image,
    "convert_document": _tool_convert_document,
    "create_pptx_project": _tool_create_pptx_project,
    "save_svg_page": _tool_save_svg_page,
    "save_notes": _tool_save_notes,
    "save_project_file": _tool_save_project_file,
    "save_pptx_image": _tool_save_pptx_image,
    "read_project_file": _tool_read_project_file,
    "read_summary": _tool_read_summary,
    "read_svg_page": _tool_read_svg_page,
    "read_skill_reference": _tool_read_skill_reference,
    "ppt_export": _tool_ppt_export,
}


def get_tool_descriptions(tool_names: list) -> str:
    lines = []
    for name in tool_names:
        if name in MCP_TOOLS:
            t = MCP_TOOLS[name]
            lines.append(
                f"- `[CALL_TOOL: {name}]` {t['description']}\n  参数: {t['inputs']}"
            )
    return "\n".join(lines)
