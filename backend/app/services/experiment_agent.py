import json
import logging
import asyncio
import re
import os
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session

from app.models.experiment import ExperimentReport, ExperimentStatus
from app.services.ai_request_manager import ai_request_manager
from app.services.web_search_request_manager import web_search_manager
from app.services.document_service import DocumentService
from app.core.websocket import experiment_ws_manager

logger = logging.getLogger(__name__)

DEFAULT_SECTIONS = ["实验目的", "实验原理", "实验器材", "实验步骤", "数据记录与处理", "结果分析", "实验结论"]


class ExperimentAgent:

    async def _ws_broadcast(self, user_id: int, report_id: int, data: dict):
        try:
            await experiment_ws_manager.broadcast(user_id, report_id, data)
        except Exception as e:
            logger.warning(f"WS broadcast failed: {e}")

    async def run_collection(self, report_id: int, user_id: int):
        from app.db.session import SessionLocal
        db = SessionLocal()
        try:
            report = db.query(ExperimentReport).filter(ExperimentReport.id == report_id).first()
            if not report:
                return

            report.status = ExperimentStatus.COLLECTING
            db.commit()
            await self._ws_broadcast(user_id, report_id, {"type": "status", "status": "collecting"})

            # 从已有 knowledge_base 合并（来自图片上传的 OCR 结果等），而不是新建空白
            sections = report.sections_config or DEFAULT_SECTIONS
            existing_kb = report.knowledge_base or {}
            knowledge = self._upgrade_legacy_knowledge(existing_kb, sections)
            if not self._is_new_knowledge(existing_kb):
                knowledge = self._empty_knowledge(report.title, sections)

            # 等待课件文件上传完成（最多 15 秒）
            file_path = report.courseware_file_path
            if not file_path:
                logger.info(f"等待课件上传...")
                for _ in range(30):
                    await asyncio.sleep(0.5)
                    db.refresh(report)
                    if report.courseware_file_path:
                        file_path = report.courseware_file_path
                        break

            if file_path:
                await self._update_progress(db, user_id, report, "解析课件中...", 15)
                try:
                    await self._parse_courseware_somark(report, knowledge)
                except Exception as e:
                    logger.warning(f"课件解析失败: {e}")

            await self._update_progress(db, user_id, report, "联网搜索中...", 45)

            sections = report.sections_config or []
            try:
                await self._web_search(report.title, knowledge, sections)
            except Exception as e:
                logger.warning(f"联网搜索失败: {e}")

            await self._update_progress(db, user_id, report, "AI 汇总知识中...", 75)

            try:
                await self._ai_summarize(report, knowledge)
            except Exception as e:
                logger.warning(f"AI 汇总失败: {e}")

            # 只保留 photos（并发上传的照片不丢失）
            db.refresh(report)
            current_kb = report.knowledge_base or {}
            if current_kb.get("photos"):
                knowledge["photos"] = current_kb["photos"]

            report.knowledge_base = knowledge
            report.status = ExperimentStatus.KNOWLEDGE_READY
            db.commit()
            await self._update_progress(db, user_id, report, "知识准备完成", 100)
            await self._ws_broadcast(user_id, report_id, {"type": "status", "status": "knowledge_ready"})

            logger.info(f"实验报告 [{report.id}] 知识汇集完成")
            asyncio.create_task(self.run_writing_phase_with_ws(report_id, user_id))

        except Exception as e:
            try:
                report = db.query(ExperimentReport).filter(ExperimentReport.id == report_id).first()
                if report:
                    report.status = ExperimentStatus.FAILED
                    report.error_message = str(e)
                    db.commit()
                    await self._ws_broadcast(user_id, report_id, {"type": "error", "message": str(e)})
            except Exception:
                pass
            logger.error(f"实验报告 [{report_id}] 汇集失败: {e}")
        finally:
            db.close()

    async def _update_progress(self, db: Session, user_id: int, report: ExperimentReport, step: str, percent: int):
        progress = {"type": "_progress", "step": step, "percent": percent}
        history = report.chat_history or []
        existing = [m for m in history if m.get("type") != "_progress"]
        existing.insert(0, progress)
        report.chat_history = existing
        db.commit()
        await self._ws_broadcast(user_id, report.id, {"type": "progress", "step": step, "percent": percent})

    async def run_writing_phase_with_ws(self, report_id: int, user_id: int):
        from app.db.session import SessionLocal
        db = SessionLocal()
        try:
            report = db.query(ExperimentReport).filter(ExperimentReport.id == report_id).first()
            if not report:
                return

            report.status = ExperimentStatus.WRITING
            if not report.chat_history:
                report.chat_history = []
            report.chat_history = [m for m in report.chat_history if m.get("type") != "_progress"]
            db.commit()
            await self._ws_broadcast(user_id, report_id, {"type": "status", "status": "writing"})

            knowledge = report.knowledge_base or {}
            sections = report.sections_config or DEFAULT_SECTIONS
            system_prompt = self._build_writing_system_prompt(report.title, knowledge, sections)

            db.refresh(report)
            await self._writing_loop_stream(db, user_id, report, system_prompt)
        finally:
            db.close()

    def _empty_knowledge(self, title: str, sections: list) -> dict:
        return {
            "experiment_title": title,
            "by_section": {
                sec: {"content": "", "search_results": [], "sources": []}
                for sec in sections
            },
            "raw_courseware_text": "",
            "photos": {},
        }

    def _is_new_knowledge(self, knowledge: dict) -> bool:
        return "by_section" in knowledge

    def _upgrade_legacy_knowledge(self, knowledge: dict, sections: list) -> dict:
        if self._is_new_knowledge(knowledge):
            return knowledge
        new_kb = {
            "experiment_title": knowledge.get("experiment_title", ""),
            "by_section": {sec: {"content": "", "search_results": [], "sources": []} for sec in sections},
            "raw_courseware_text": knowledge.get("raw_courseware_text", ""),
            "photos": knowledge.get("photos", {}),
        }
        legacy_map = {
            "basic_principles": ["实验原理", "实验目的"],
            "standard_steps": ["实验步骤"],
            "equipment_list": ["实验器材"],
            "notes": ["注意事项"],
            "data_templates": ["数据记录与处理"],
        }
        for old_field, target_sections in legacy_map.items():
            if knowledge.get(old_field):
                vals = knowledge[old_field]
                text = "\n".join(vals) if isinstance(vals, list) else str(vals)
                for sec in target_sections:
                    if sec in new_kb["by_section"]:
                        new_kb["by_section"][sec]["content"] += f"\n{text}"
        return new_kb

    def _build_writing_system_prompt(self, title: str, knowledge: dict, sections: list) -> str:
        sections_str = "、".join(sections)
        raw_text = knowledge.get("raw_courseware_text", "")
        by_section = knowledge.get("by_section", {})

        sections_knowledge = ""
        for sec in sections:
            bucket = by_section.get(sec, {})
            content = bucket.get("content", "")
            sources_count = len(bucket.get("sources", []))
            if content:
                sections_knowledge += f"\n### {sec}\n{content}\n"
                if sources_count > 0:
                    sections_knowledge += f"（参考来源：{sources_count}条）\n"

        raw_section = ""
        if raw_text:
            raw_section = f"""

## 原始课件原文（最高优先级，优先参考）
以下是你实验报告最核心的参考来源——课件原文。所有章节内容**必须优先以课件原文为准**，确保关键概念、步骤和数据不遗漏：
{raw_text[:6000]}"""

        return f"""你是一名实验报告写作助手。你已掌握实验的理论知识。

实验名称：{title}
需要包含的章节：{sections_str}

## 各章节知识摘要
{sections_knowledge or "（暂无针对性知识，请基于通用知识写作）"}{raw_section}

## 信息来源优先级
1. **课件原文（见上方"原始课件原文"）**：最高优先级，包含课件/截图中的完整内容
2. **各章节知识摘要**（见上方"各章节知识摘要"）：针对每个章节整理的知识要点
3. **通用知识**：你自身具备的实验知识

## 输出格式规则（严格遵守，违反会导致内容丢失）
- 每个报告章节**必须**以 `## 章节名` 开头。不带 `##` 标题的内容被视为"对话闲聊"，**不会写入报告草稿**，仅在对话区显示。
- 章节之间**必须**用 `[NEXT_SECTION]` 分隔。`[NEXT_SECTION]` 后的内容**必须立即跟 `## 标题`**。
- 除非是在回答 `[ASK_USER]` 提出的问题，否则**严禁**在任何由 `[NEXT_SECTION]` 分隔的段落中输出闲聊性内容（如"好的，已更新"、"根据你提供的数据我修改了如下内容"等）。
- 修改已有章节时，**完整输出该章节的全部内容**（含标题），不要只输出增量。

## 行为约束
- 按章节顺序逐步生成报告内容。
- 任何你不太确定的内容、需要用户补充的信息，或者需要用户自行决定的细节，都必须暂停生成并向用户提问。提问格式：`[ASK_USER] 你的问题内容`（此标签后的内容仅作对话，不进报告）。
- 每次提问 1~2 个问题，问题应具体可量化。
- **数据收集**：当需要用户提供结构化数据时，输出指令 `[RENDER_TABLE: columns=["列名1","列名2"], rows=行数]` 要求前端渲染表格。
- **实验照片**：当需要用户提供实验结果照片时（如显微镜观察、实验现象等），输出指令 `[ASK_PHOTOS: 照片名称1, 照片名称2]`。
  - **照片不是通过聊天发送的**。用户通过独立的上传界面选择文件后，系统会自动上传并存储。
  - 当用户回复"照片已上传完成"时，说明照片已成功上传到知识库，**请你直接输出包含 `[PHOTO: 照片名称]` 标签的完整章节内容来引用照片**，不要再要求用户发送照片文件，也不要再说"未收到照片文件"。
  - 照片上传后在知识库 `photos` 字段中对你**不可见**（无法看到图片内容），但 `[PHOTO: 名称]` 标签会自动在前端渲染为图片。
  - 不要使用"请替换为实际照片"等占位性文字除非用户要求或未上传照片。
- **可视化**：进入"数据记录与处理"或"结果分析"章节时，必须输出 `[ASK_CHART]` 询问用户是否需要可视化分析。
- 用户回答后填入对应位置，继续生成下一部分。
- 用户说"跳过"时，在报告中保留空章节标记 "（本章节暂缺）" 并继续。
- 用户无法提供某数据时，采用理论值或标记"待测"。
- 所有章节生成完毕后，在询问用户是否结束之前，先输出 `[SELF_CHECK]` 对自己生成的报告进行全面检查：1）是否有未完成、不完整、留空或标记"待测"的地方；2）检查内容准确性、数据一致性、图表合理性，**找出需要改进的地方**。将检查结果和**具体修改方案**告知用户，并询问用户是否需要按修改方案修改。等待用户反馈后执行修改或继续；如果用户确认完成再输出 `[REPORT_COMPLETE]` 表示最终完成。
- 除 `[ASK_USER]`、`[SELF_CHECK]`、`[REPORT_COMPLETE]` 标签及其附带文本外，其余输出内容直接用作报告正文。
- **数据图表格式**：需要插入柱状图/饼图/雷达图等数据图表时，直接按以下标准格式输出（不要用任何代码围栏包裹，不要用 markdown 标记包装）：
  - bar（柱状图）：`[CHART: bar]\ntitle: 图表标题\nx-label: X轴标签\ndata:\n  类别1: 数值1\n  类别2: 数值2\n[/CHART]`
  - pie（饼图）：`[CHART: pie]\ntitle: 图表标题\ndata:\n  类别1: 数值1\n  类别2: 数值2\n[/CHART]`
  - doughnut（环形图）：`[CHART: doughnut]\ntitle: 图表标题\ndata:\n  类别1: 数值1\n  类别2: 数值2\n[/CHART]`
  - line（折线图）：`[CHART: line]\ntitle: 图表标题\nx-label: X轴标签\ndata:\n  点1: 数值1\n  点2: 数值2\n[/CHART]`
  - radar（雷达图）：`[CHART: radar]\ntitle: 图表标题\ndata:\n  维度1: 数值1\n  维度2: 数值2\n[/CHART]`
  - horizontalBar（水平柱状图）：`[CHART: horizontalBar]\ntitle: 图表标题\ndata:\n  类别1: 数值1\n  类别2: 数值2\n[/CHART]`
  - stackedBar（堆叠柱状图）：`[CHART: stackedBar]\ntitle: 图表标题\nx-label: 分组标签\ndata:\n  类别1: 数值1\n  类别2: 数值2\n[/CHART]`
  - scatter（散点图）：`[CHART: scatter]\ntitle: 图表标题\nx-label: X轴标签\ny-label: Y轴标签\ndata:\n  1: 数值1\n  2: 数值2\n[/CHART]`
  - scatter_with_fit（散点+拟合线）：`[CHART: scatter_with_fit]\ntitle: 图表标题\nx-label: X轴标签\ny-label: Y轴标签\ndata:\n  1: 数值1\n  2: 数值2\n[/CHART]`
  - polarArea（极区图）：`[CHART: polarArea]\ntitle: 图表标题\ndata:\n  类别1: 数值1\n  类别2: 数值2\n[/CHART]`
  - bubble（气泡图）：`[CHART: bubble]\ntitle: 图表标题\nx-label: X轴标签\ny-label: Y轴标签\ndata:\n  标签1: X值, Y值, 大小\n  标签2: X值, Y值, 大小\n[/CHART]`
  注意：`[CHART: 类型]` 和 `[/CHART]` 标记必须独占一行，数值必须为数字，用真实数据替换示例文本。
- **Mermaid 图表**（用于流程图/结构图等，直接输出 mermaid 语法，推荐用 `%%% mermaid` ... `%%%` 围栏包裹）：`graph TD/LR`（流程图）、`flowchart TD/LR`（增强流程图）、`sequenceDiagram`（时序图）、`classDiagram`（类图）、`stateDiagram-v2`（状态图）、`erDiagram`（ER图）、`gantt`（甘特图）、`pie`（饼图）、`journey`（旅程图）、`timeline`（时间线）、`mindmap`（思维导图）、`quadrantChart`（四象限图）、`requirementDiagram`（需求图）、`kanban`（看板）
- **注意**：数据图表用 `[CHART: 类型]`...`[/CHART]` 格式直接嵌入正文；Mermaid 图表直接输出语法。两者不要混淆。Mermaid 节点标签必须用英文直引号 `"` 而非中文弯引号 `""`。"""


    async def _writing_loop_stream(self, db: Session, user_id: int, report: ExperimentReport, system_prompt: str):
        max_turns = 100
        for turn in range(max_turns):
            db.refresh(report)
            if report.status != ExperimentStatus.WRITING:
                return

            history = report.chat_history or []
            progress_msgs = [m for m in history if m.get("type") == "_progress"]
            chat_msgs = [m for m in history if m.get("type") != "_progress"]

            messages = [{"role": "system", "content": system_prompt}]
            for msg in chat_msgs:
                if msg.get("type") == "_photo_record": continue
                role = "assistant" if msg.get("role") == "assistant" else "user"
                content = msg.get("content", "")
                if msg.get("table_data"):
                    content += f"\n[表格数据已填写]\n{json.dumps(msg['table_data'], ensure_ascii=False)}"
                messages.append({"role": role, "content": content})

            full_response = ""
            try:
                stream = ai_request_manager.make_request_stream(
                    request_id=f"experiment_{report.id}_ws_turn_{turn}",
                    messages=messages,
                    model="deepseek-v4-flash",
                    reasoning_effort="high",
                    temperature=0.7,
                )
                async for event in stream:
                    if event["type"] == "token":
                        token = event["content"]
                        full_response += token
                        await self._ws_broadcast(user_id, report.id, {"type": "token", "content": token})
                    elif event["type"] == "done":
                        full_response = event.get("full_content", full_response)
                    elif event["type"] == "error":
                        logger.error(f"WS流式生成错误: {event.get('message')}")
                        await self._ws_broadcast(user_id, report.id, {"type": "error", "message": event.get("message")})
            except Exception as e:
                logger.error(f"写作循环流式错误: {e}")
                await asyncio.sleep(2)
                continue

            if not full_response:
                continue

            # ── 裸图表关键词自动转换（AI 旧格式兼容，第一次遇到时替换为 [CHART: type] 格式）──
            if '[CHART: ' not in full_response:
                bare = re.findall(r'(?:\b|^)(?:%%\s*.*?[-–—]\s*)?(bar|pie|doughnut|radar|line|scatter|scatter_with_fit|horizontalBar|stackedBar|polarArea|bubble|bar_chart)(?=[\s\n])', full_response, re.MULTILINE)
                if bare:
                    kw = bare[0].lower()
                    full_response = re.sub(
                        rf'(?:\b|^)(?:%%\s*.*?[-–—]\s*)?{re.escape(bare[0])}(?=[\s\n])',
                        f'[CHART: {kw}]\ntitle: ',
                        full_response,
                        count=1,
                        flags=re.MULTILINE
                    )
                    logger.info(f"[图表检测] 旧格式转换: {kw}")

            turn_entry = {"role": "assistant", "content": full_response, "turn": turn}
            chat_msgs.append(turn_entry)

            if "[REPORT_COMPLETE]" in full_response:
                report.status = ExperimentStatus.PENDING_REVIEW
                new_sections = self._extract_report_sections(full_response, report.sections_config or DEFAULT_SECTIONS)
                report.draft_content = self._merge_draft_sections(report.draft_content, new_sections)
                report.chat_history = progress_msgs + chat_msgs
                db.commit()
                self._cleanup_courseware(report)
                db.refresh(report, attribute_names=['knowledge_base'])
                await self._ws_broadcast(user_id, report.id, {
                    "type": "report_update",
                    "status": "pending_review",
                    "draft_content": report.draft_content,
                    "chat_history": report.chat_history,
                    "knowledge_base": report.knowledge_base,
                })
                logger.info(f"实验报告 [{report.id}] 进入待确认状态")
                return

            has_ask = "[ASK_USER]" in full_response or "[ASK_CHART]" in full_response or "[ASK_PHOTOS]" in full_response
            report.chat_history = progress_msgs + chat_msgs
            new_sections = self._extract_report_sections(full_response, report.sections_config or DEFAULT_SECTIONS)
            report.draft_content = self._merge_draft_sections(report.draft_content, new_sections)
            db.commit()
            db.refresh(report, attribute_names=['knowledge_base'])

            await self._ws_broadcast(user_id, report.id, {
                "type": "report_update",
                "status": report.status.value,
                "draft_content": report.draft_content,
                "chat_history": report.chat_history,
                "knowledge_base": report.knowledge_base,
                "has_ask": has_ask,
            })

            if has_ask:
                return

        logger.warning(f"实验报告 [{report.id}] 达到最大轮次")

    async def _writing_loop(self, db: Session, report: ExperimentReport, system_prompt: str):
        """非流式写作循环（供旧路由使用）"""
        max_turns = 100
        for turn in range(max_turns):
            db.refresh(report)
            if report.status != ExperimentStatus.WRITING:
                return

            history = report.chat_history or []
            progress_msgs = [m for m in history if m.get("type") == "_progress"]
            chat_msgs = [m for m in history if m.get("type") != "_progress"]

            messages = [{"role": "system", "content": system_prompt}]
            for msg in chat_msgs:
                if msg.get("type") == "_photo_record": continue
                role = "assistant" if msg.get("role") == "assistant" else "user"
                content = msg.get("content", "")
                if msg.get("table_data"):
                    content += f"\n[表格数据已填写]\n{json.dumps(msg['table_data'], ensure_ascii=False)}"
                messages.append({"role": role, "content": content})

            try:
                response = await ai_request_manager.make_request(
                    request_id=f"experiment_{report.id}_turn_{turn}",
                    messages=messages,
                    model="deepseek-v4-flash",
                    reasoning_effort="high",
                    temperature=0.7,
                )
                if not response:
                    continue

                # ── 裸图表关键词自动转换 ──
                if '[CHART: ' not in response:
                    bare = re.findall(r'(?:\b|^)(?:%%\s*.*?[-–—]\s*)?(bar|pie|doughnut|radar|line|scatter|scatter_with_fit|horizontalBar|stackedBar|polarArea|bubble|bar_chart)(?=[\s\n])', response, re.MULTILINE)
                    if bare:
                        kw = bare[0].lower()
                        response = re.sub(
                            rf'(?:\b|^)(?:%%\s*.*?[-–—]\s*)?{re.escape(bare[0])}(?=[\s\n])',
                            f'[CHART: {kw}]\ntitle: ',
                            response,
                            count=1,
                            flags=re.MULTILINE
                        )

                turn_entry = {"role": "assistant", "content": response, "turn": turn}
                chat_msgs.append(turn_entry)

                if "[REPORT_COMPLETE]" in response:
                    report.status = ExperimentStatus.PENDING_REVIEW
                    new_sections = self._extract_report_sections(response, report.sections_config or DEFAULT_SECTIONS)
                    report.draft_content = self._merge_draft_sections(report.draft_content, new_sections)
                    report.chat_history = progress_msgs + chat_msgs
                    db.commit()
                    self._cleanup_courseware(report)
                    logger.info(f"实验报告 [{report.id}] 进入待确认状态")
                    return

                report.chat_history = progress_msgs + chat_msgs
                new_sections = self._extract_report_sections(response, report.sections_config or DEFAULT_SECTIONS)
                report.draft_content = self._merge_draft_sections(report.draft_content, new_sections)
                db.commit()

                if "[ASK_USER]" in response or "[ASK_CHART]" in response or "[ASK_PHOTOS]" in response:
                    return

            except Exception as e:
                logger.error(f"写作循环错误: {e}")
                await asyncio.sleep(2)

        logger.warning(f"实验报告 [{report.id}] 达到最大轮次")

    async def handle_user_reply(self, db: Session, report_id: int, reply: str):
        """处理用户回复（非流式）"""
        report = db.query(ExperimentReport).filter(ExperimentReport.id == report_id).first()
        allowed = (ExperimentStatus.COLLECTING, ExperimentStatus.WRITING, ExperimentStatus.PENDING_REVIEW, ExperimentStatus.COMPLETED)
        if not report or report.status not in allowed:
            raise ValueError("报告状态不正确")

        if report.status in (ExperimentStatus.COLLECTING, ExperimentStatus.COMPLETED):
            report.status = ExperimentStatus.WRITING
            db.commit()
        elif report.status == ExperimentStatus.PENDING_REVIEW:
            report.status = ExperimentStatus.WRITING
            db.commit()

        history = report.chat_history or []
        progress_msgs = [m for m in history if m.get("type") == "_progress"]
        chat_msgs = [m for m in history if m.get("type") != "_progress"]

        user_entry = {"role": "user", "content": reply, "turn": len(chat_msgs)}
        if "[TABLE_DATA]" in reply:
            try:
                table_match = re.search(r'\[TABLE_DATA:\s*(\{.*\})\]', reply, re.DOTALL)
                if table_match:
                    user_entry["table_data"] = json.loads(table_match.group(1))
            except json.JSONDecodeError:
                pass

        chat_msgs.append(user_entry)
        report.chat_history = progress_msgs + chat_msgs
        db.commit()

        sections = report.sections_config or DEFAULT_SECTIONS
        knowledge = report.knowledge_base or {}
        # Preserve photos from DB across this run
        photos_backup = knowledge.get("photos") if isinstance(knowledge.get("photos"), dict) else None
        system_prompt = self._build_writing_system_prompt(report.title, knowledge, sections)

        await self._writing_loop(db, report, system_prompt)
        db.refresh(report)
        return report

    async def handle_user_reply_stream(self, db: Session, report_id: int, reply: str):
        """保留旧的非WS流式方法供SSE端点使用"""
        report = db.query(ExperimentReport).filter(ExperimentReport.id == report_id).first()
        allowed = (ExperimentStatus.COLLECTING, ExperimentStatus.WRITING, ExperimentStatus.PENDING_REVIEW, ExperimentStatus.COMPLETED)
        if not report or report.status not in allowed:
            raise ValueError("报告状态不正确")

        if report.status in (ExperimentStatus.COLLECTING, ExperimentStatus.COMPLETED):
            report.status = ExperimentStatus.WRITING
            db.commit()
        elif report.status == ExperimentStatus.PENDING_REVIEW:
            report.status = ExperimentStatus.WRITING
            db.commit()

        history = report.chat_history or []
        progress_msgs = [m for m in history if m.get("type") == "_progress"]
        chat_msgs = [m for m in history if m.get("type") != "_progress"]

        user_entry = {"role": "user", "content": reply, "turn": len(chat_msgs)}
        if "[TABLE_DATA]" in reply:
            try:
                table_match = re.search(r'\[TABLE_DATA:\s*(\{.*\})\]', reply, re.DOTALL)
                if table_match:
                    user_entry["table_data"] = json.loads(table_match.group(1))
            except json.JSONDecodeError:
                pass

        chat_msgs.append(user_entry)
        report.chat_history = progress_msgs + chat_msgs
        db.commit()

        sections = report.sections_config or DEFAULT_SECTIONS
        knowledge = report.knowledge_base or {}
        system_prompt = self._build_writing_system_prompt(report.title, knowledge, sections)

        chat_msgs = [m for m in (report.chat_history or []) if m.get("type") != "_progress"]
        messages = [{"role": "system", "content": system_prompt}]
        for msg in chat_msgs:
            if msg.get("type") == "_photo_record": continue
            role = "assistant" if msg.get("role") == "assistant" else "user"
            content = msg.get("content", "")
            if msg.get("table_data"):
                content += f"\n[表格数据已填写]\n{json.dumps(msg['table_data'], ensure_ascii=False)}"
            messages.append({"role": role, "content": content})

        full_response = ""
        async for event in ai_request_manager.make_request_stream(
            request_id=f"experiment_{report.id}_stream",
            messages=messages,
            model="deepseek-v4-flash",
            reasoning_effort="high",
            temperature=0.7,
        ):
            if event["type"] == "token":
                full_response += event["content"]
                yield {"type": "token", "content": event["content"]}
            elif event["type"] == "done":
                full_response = event.get("full_content", full_response)

        if full_response:
            turn_entry = {"role": "assistant", "content": full_response, "turn": len(chat_msgs)}
            chat_msgs.append(turn_entry)

            if "[REPORT_COMPLETE]" in full_response:
                report.status = ExperimentStatus.PENDING_REVIEW
                new_sections = self._extract_report_sections(full_response, report.sections_config or DEFAULT_SECTIONS)
                report.draft_content = self._merge_draft_sections(report.draft_content, new_sections)
                report.chat_history = progress_msgs + chat_msgs
                db.commit()
                self._cleanup_courseware(report)
                db.refresh(report, attribute_names=['knowledge_base'])
                yield {"type": "report_update", "status": "pending_review", "draft_content": report.draft_content, "chat_history": report.chat_history, "knowledge_base": report.knowledge_base}
                yield {"type": "complete", "status": "pending_review"}
                return

            has_ask = "[ASK_USER]" in full_response or "[ASK_CHART]" in full_response or "[ASK_PHOTOS]" in full_response
            report.chat_history = progress_msgs + chat_msgs
            new_sections = self._extract_report_sections(full_response, report.sections_config or DEFAULT_SECTIONS)
            report.draft_content = self._merge_draft_sections(report.draft_content, new_sections)
            db.commit()
            db.refresh(report, attribute_names=['knowledge_base'])

            yield {
                "type": "report_update",
                "status": report.status.value,
                "draft_content": report.draft_content,
                "chat_history": report.chat_history,
                "knowledge_base": report.knowledge_base,
                "has_ask": has_ask,
            }

    async def _parse_courseware_somark(self, report: ExperimentReport, knowledge: dict):
        file_path = report.courseware_file_path
        if not file_path or not os.path.exists(file_path):
            return

        try:
            import tempfile
            import zipfile
            from app.services.somark_request_manager import somark_request_manager

            tmp_zip = None
            if file_path.endswith('.zip'):
                source_path = file_path
            else:
                tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
                tmp_zip.close()
                with zipfile.ZipFile(tmp_zip.name, 'w', zipfile.ZIP_DEFLATED) as zf:
                    zf.write(file_path, os.path.basename(file_path))
                source_path = tmp_zip.name

            try:
                somark_result = await somark_request_manager.parse_document(
                    file_path=source_path,
                    feature_config={
                        "enable_text_cross_page": False,
                        "enable_title_level_recognition": True,
                        "enable_image_understanding": True,
                    },
                )
                text = self._extract_somark_text(somark_result)
                if text.strip():
                    knowledge["basic_principles"].append({"source": "课件", "content": text[:8000]})
                    knowledge["raw_courseware_text"] = text
                    knowledge["sources"].append({"type": "课件", "name": report.courseware_filename})
            finally:
                if tmp_zip and os.path.exists(tmp_zip.name):
                    os.unlink(tmp_zip.name)

        except ImportError:
            logger.warning("SoMark 不可用，回退到规则解析")
            from app.services.document_parser import DocumentParser
            ext = report.courseware_filename.rsplit('.', 1)[-1].lower() if report.courseware_filename else ''
            type_map = {'pdf': 'pdf', 'docx': 'docx', 'pptx': 'pptx', 'ppt': 'pptx', 'txt': 'txt', 'md': 'md'}
            text, _ = DocumentParser.parse_file(file_path, type_map.get(ext, 'txt'))
            if text.strip():
                knowledge["basic_principles"].append({"source": "课件", "content": text[:8000]})
                if not knowledge.get("raw_courseware_text"):
                    knowledge["raw_courseware_text"] = text
                knowledge["sources"].append({"type": "课件", "name": report.courseware_filename})
        except Exception as e:
            logger.warning(f"SoMark 解析课件失败: {e}")

    def _extract_somark_text(self, result: dict) -> str:
        try:
            blocks = []
            pages = result.get("data", {}).get("result", {}).get("outputs", {}).get("json", {}).get("pages", [])
            for page in pages:
                for block in page.get("blocks", []):
                    txt = block.get("text", "").strip()
                    if txt:
                        blocks.append(txt)
            return "\n\n".join(blocks)
        except Exception:
            return result.get("data", {}).get("result", {}).get("outputs", {}).get("markdown", "")

    async def _web_search(self, experiment_title: str, knowledge: dict, sections: list):
        if not web_search_manager:
            return
        if not sections:
            sections = ["实验原理", "实验步骤", "实验器材"]
        for sec in sections:
            q = f"{experiment_title} {sec}"
            try:
                result = await web_search_manager.search(query=q, count=5, summary=True)
                if result:
                    pages = result.get("webPages", {}).get("value", []) if "webPages" in result else result.get("results", [])
                    logger.info(f"搜索 '{q}' 返回 {len(pages)} 条结果")
                    bucket = knowledge.setdefault("by_section", {}).setdefault(sec, {"content": "", "search_results": [], "sources": []})
                    for page in pages[:3]:
                        snippet = page.get("summary") or page.get("snippet", "")
                        url = page.get("url", "")
                        if snippet:
                            bucket.setdefault("search_results", []).append(snippet)
                            bucket.setdefault("sources", []).append({"type": "网络", "url": url, "content": snippet})
                else:
                    logger.info(f"搜索 '{q}' 返回空结果")
            except Exception as e:
                logger.warning(f"搜索 '{q}' 失败: {e}")
                await asyncio.sleep(0.5)

    async def _ai_summarize(self, report: ExperimentReport, knowledge: dict):
        """一次性 AI 调用，按章节结构化精炼知识。关键信息（公式、定义、核心数据）突出呈现。"""
        sections = report.sections_config or DEFAULT_SECTIONS
        sections_material = {}
        for sec in sections:
            bucket = knowledge.get("by_section", {}).get(sec, {})
            texts = []
            for s in bucket.get("sources", []):
                if s.get("content"):
                    texts.append(s["content"])
            texts.extend(bucket.get("search_results", []))
            sections_material[sec] = "\n".join(texts[:5]) if texts else "（暂无素材）"

        prompt = f"""实验：{report.title}

以下是各章节收集到的原始素材。请为每个章节整理出结构化的知识内容。

要求：
1. **关键信息必须突出**：核心概念、公式、定义、重要数据放在每条的最前面
2. 实验步骤按顺序分条列出
3. 实验器材列出完整清单
4. 数据记录与处理给出表格模板
5. 去除冗余和无关内容
6. 每个章节输出为结构清晰的文本段落

素材：
{json.dumps(sections_material, ensure_ascii=False, indent=2)}

以 JSON 格式返回，key 为章节名，value 为整理后的内容摘要：
{{{{
  "实验目的": "**核心概念**：xxx\\n详细说明...",
  "实验原理": "**核心公式**：xxx\\n**关键定义**：xxx\\n说明...",
  "实验步骤": "1. 第一步...\\n2. 第二步...",
  ...
}}}}"""

        try:
            response = await ai_request_manager.generate_text(
                prompt=prompt, model="deepseek-v4-flash", reasoning_effort="high", temperature=0.3,
            )
            cleaned = re.sub(r'^```json\s*|\s*```$', '', response.strip())
            merged = json.loads(cleaned)
            for sec, content in merged.items():
                if sec in knowledge.get("by_section", {}):
                    knowledge["by_section"][sec]["content"] = content
                    logger.info(f"AI 汇总完成章节: {sec} ({len(content)}字符)")
        except Exception as e:
            logger.warning(f"AI 汇总失败: {e}")

    def _cleanup_courseware(self, report: ExperimentReport):
        if report.courseware_file_path and os.path.exists(report.courseware_file_path):
            try:
                os.remove(report.courseware_file_path)
                logger.info(f"已删除课件文件: {report.courseware_file_path}")
            except Exception as e:
                logger.warning(f"删除课件文件失败: {e}")
        # 只删除报告中引用的图片，不清空整个目录
        img_paths = set()
        for field in (report.draft_content, report.knowledge_base):
            if field:
                raw = json.dumps(field, ensure_ascii=False)
                img_paths.update(DocumentService.extract_image_paths(raw))
        DocumentService.delete_image_files(list(img_paths))

    @staticmethod
    def _extract_report_sections(content: str, sections_whitelist: List[str] = None) -> List[Dict[str, str]]:
        if sections_whitelist is None:
            sections_whitelist = DEFAULT_SECTIONS
        def strip_num(title: str) -> str:
            return re.sub(r'^\d+[\.\、\s]*', '', title).strip()
        white_clean = [strip_num(w) for w in sections_whitelist]
        sections = re.split(r'\[NEXT_SECTION\]', content)
        result = []
        for sec in sections:
            sec = sec.strip()
            if not sec:
                continue
            title_match = re.search(r'^#{1,3}\s+(.+?)$', sec, re.MULTILINE)
            if not title_match:
                continue
            section_title = title_match.group(1).strip()
            # 白名单过滤：只保留用户配置的章节
            if strip_num(section_title) not in white_clean:
                continue
            clean_content = sec[title_match.end():].strip()
            clean_content = re.sub(r'\[ASK_USER\].*$', '', clean_content, flags=re.DOTALL).strip()
            clean_content = re.sub(r'\[ASK_PHOTOS:\s*[^\]]*\].*$', '', clean_content, flags=re.DOTALL).strip()
            clean_content = re.sub(r'\[ASK_CHART\].*$', '', clean_content, flags=re.DOTALL).strip()
            clean_content = re.sub(r'\[SELF_CHECK\].*$', '', clean_content, flags=re.DOTALL).strip()
            clean_content = re.sub(r'\[RENDER_TABLE:[^\]]*\]', '', clean_content).strip()
            clean_content = re.sub(r'\[RENDER_CHART:[^\]]*\]', '', clean_content).strip()
            clean_content = re.sub(r'\[REPORT_COMPLETE\]', '', clean_content).strip()
            result.append({"title": section_title, "content": clean_content})
        return result

    @staticmethod
    def _merge_draft_sections(existing: List[Dict[str, str]], new_sections: List[Dict[str, str]]) -> List[Dict[str, str]]:
        def strip_num(title: str) -> str:
            return re.sub(r'^\d+[\.\、\s]*', '', title).strip()
        merged = list(existing) if existing else []
        for new_sec in new_sections:
            matched = False
            new_t = strip_num(new_sec.get("title", ""))
            for i, old_sec in enumerate(merged):
                old_t = strip_num(old_sec.get("title", ""))
                if old_t == new_t:
                    merged[i] = new_sec
                    matched = True
                    break
            if not matched:
                merged.append(new_sec)
        return merged


experiment_agent = ExperimentAgent()
