import asyncio
import logging
from typing import List, Dict, Any, Optional
import json
import re
from dataclasses import dataclass, asdict
from app.services.ai_request_manager import ai_request_manager

logger = logging.getLogger(__name__)


@dataclass
class DocumentSection:
    """文档章节"""
    title: Optional[str]
    content: str
    level: int = 1


@dataclass
class StructureAnalysisResult:
    """结构分析结果"""
    sections: List[DocumentSection]
    confidence: float
    total_chars: int


class AIDocumentAnalyzer:
    """AI 文档结构分析器"""

    MAX_SEGMENT_LENGTH = 2000
    OVERLAP_LENGTH = 100

    STRUCTURE_PROMPT_TEMPLATE = """请分析以下文档内容，将其解析为结构化的章节。

要求：
1. 题库类文档：
   - 严格以题目为最小单位划分
   - 每个题目必须包含标题（题目本身）和正文（题目的完整内容）
   - 题目标题和正文所属的大标题必须完全一样
   - 题目作为最小标题（level值最大，如2或3）
   - 自主识别比题目更大的标题（level值较小，如1）
2. 非题库类文档：自主分割章节，识别原文中的标题结构
3. 严格使用原文中的标题，不要修改
4. 严格使用原文内容，不要额外增减或修改
5. 保留每个章节的完整内容

请以 JSON 格式返回结果，格式如下：
{{
  "sections": [
    {{
      "title": "标题（严格使用原文）",
      "content": "章节的完整内容（严格使用原文）",
      "level": 1
    }}
  ]
}}

文档内容：
{content}"""

    COMBINE_PROMPT_TEMPLATE = """请将以下多个文档分段的结构分析结果合并为一个完整的文档结构。

分段分析结果（按顺序）：
{segment_results}

要求：
1. 保持所有章节的原始顺序
2. 合并相邻的重复章节（如果因为分段导致的重复）
3. 题库类文档：题目作为最小标题（level值最大），自主识别更大标题（level值较小）；非题库类文档：保持原有章节结构
4. 严格使用原文，不要额外增减或修改内容
5. 保持每个章节的完整内容
6. 不要遗漏任何内容

请以 JSON 格式返回合并后的结果：
{{
  "sections": [
    {{
      "title": "标题（严格使用原文）",
      "content": "章节完整内容（严格使用原文）",
      "level": 1
    }}
  ]
}}"""

    def __init__(self):
        pass

    def _split_document(self, content: str) -> List[str]:
        """将长文档分割成多个片段"""
        if len(content) <= self.MAX_SEGMENT_LENGTH:
            return [content]

        segments = []
        current_pos = 0
        content_length = len(content)

        while current_pos < content_length:
            end_pos = min(current_pos + self.MAX_SEGMENT_LENGTH, content_length)

            if end_pos < content_length:
                last_newline = content.rfind('\n\n', current_pos, end_pos)
                if last_newline > current_pos + self.MAX_SEGMENT_LENGTH // 2:
                    end_pos = last_newline + 2
                else:
                    last_period = content.rfind('。', current_pos, end_pos)
                    if last_period > current_pos + self.MAX_SEGMENT_LENGTH // 2:
                        end_pos = last_period + 1

            segment = content[current_pos:end_pos]
            segments.append(segment)

            current_pos = end_pos
            if current_pos < content_length:
                current_pos = max(current_pos - self.OVERLAP_LENGTH, 0)

        return segments

    async def _analyze_single_segment(self, segment: str, segment_index: int) -> Optional[Dict]:
        """分析单个文档片段，带超时机制"""
        try:
            prompt = self.STRUCTURE_PROMPT_TEMPLATE.format(content=segment)

            logger.info(f"正在分析文档片段 {segment_index + 1} (长度: {len(segment)})")
            logger.debug(f"Prompt 长度: {len(prompt)} 字符")

            # 添加超时机制，10分钟超时
            try:
                response = await asyncio.wait_for(
                    ai_request_manager.generate_text(
                        prompt=prompt,
                        model="deepseek-v4-flash",
                        request_id=f"doc_analyze_{segment_index}",
                        temperature=0.3,
                        max_tokens=8000
                    ),
                    timeout=600.0  # 10分钟超时
                )
                logger.info(f"文档片段 {segment_index + 1} AI 响应已收到，长度: {len(response)}")
            except asyncio.TimeoutError:
                logger.error(f"文档片段 {segment_index + 1} 分析超时（10分钟）")
                return None

            result = self._parse_json_response(response)

            if result and "sections" in result:
                logger.info(f"文档片段 {segment_index + 1} 分析完成，识别 {len(result['sections'])} 个章节")
                return result
            else:
                logger.warning(f"文档片段 {segment_index + 1} 解析结果无效: {result}")
                return None

        except Exception as e:
            logger.error(f"文档片段 {segment_index + 1} 分析失败: {e}")
            return None

    async def _analyze_segments_parallel(self, segments: List[str]) -> List[Optional[Dict]]:
        """并行分析多个文档片段"""
        tasks = []
        for i, segment in enumerate(segments):
            tasks.append(self._analyze_single_segment(segment, i))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        valid_results = []
        for result in results:
            if isinstance(result, dict) and "sections" in result:
                valid_results.append(result)
            elif result is not None and not isinstance(result, Exception):
                logger.warning(f"忽略无效的分析结果: {result}")
            elif isinstance(result, Exception):
                logger.error(f"分析任务异常: {result}")

        return valid_results

    async def _combine_segments(self, segment_results: List[Dict]) -> List[DocumentSection]:
        """合并多个片段的分析结果，使用规则合并"""
        if len(segment_results) == 1:
            sections = segment_results[0].get("sections", [])
            logger.info(f"单个片段，直接返回 {len(sections)} 个章节")
            return [DocumentSection(**s) for s in sections]

        logger.info(f"开始规则合并 {len(segment_results)} 个片段的分析结果")

        all_sections = []
        for seg_result in segment_results:
            sections = seg_result.get("sections", [])
            for s in sections:
                all_sections.append(DocumentSection(**s))

        merged_sections = self._merge_adjacent_sections(all_sections)

        logger.info(f"规则合并完成，共 {len(merged_sections)} 个章节")
        return merged_sections

    def _merge_adjacent_sections(self, sections: List[DocumentSection]) -> List[DocumentSection]:
        """合并相邻的重复章节"""
        if not sections:
            return []

        merged = []
        current = sections[0]

        for i in range(1, len(sections)):
            next_section = sections[i]

            if current.title == next_section.title and current.level == next_section.level:
                current = DocumentSection(
                    title=current.title,
                    content=current.content + "\n\n" + next_section.content,
                    level=current.level
                )
            else:
                merged.append(current)
                current = next_section

        merged.append(current)
        return merged

    def _parse_json_response(self, response: str) -> Optional[Dict]:
        """解析 JSON 响应"""
        try:
            json_match = re.search(r'\{[\s\S]*\}', response)
            if json_match:
                json_str = json_match.group(0)
                return json.loads(json_str)
            return json.loads(response)
        except json.JSONDecodeError:
            try:
                start = response.find('{')
                end = response.rfind('}') + 1
                if start >= 0 and end > start:
                    json_str = response[start:end]
                    return json.loads(json_str)
            except Exception:
                pass
            return None

    async def analyze_document(self, content: str) -> StructureAnalysisResult:
        """使用 AI 分析文档结构"""
        if not content or not content.strip():
            return StructureAnalysisResult(
                sections=[DocumentSection(title=None, content="", level=1)],
                confidence=0.0,
                total_chars=0
            )

        total_chars = len(content)
        logger.info(f"开始 AI 分析文档，总长度: {total_chars} 字符")

        segments = self._split_document(content)
        logger.info(f"文档已分割为 {len(segments)} 个片段")

        if len(segments) == 1:
            result = await self._analyze_single_segment(segments[0], 0)
            if result:
                sections = [DocumentSection(**s) for s in result.get("sections", [])]
            else:
                sections = [DocumentSection(title=None, content=content, level=1)]
        else:
            segment_results = await self._analyze_segments_parallel(segments)
            if segment_results:
                sections = await self._combine_segments(segment_results)
            else:
                sections = [DocumentSection(title=None, content=content, level=1)]

        if not sections:
            sections = [DocumentSection(title=None, content=content, level=1)]

        confidence = min(1.0, 0.5 + (len(sections) * 0.1))

        return StructureAnalysisResult(
            sections=sections,
            confidence=confidence,
            total_chars=total_chars
        )


ai_document_analyzer = AIDocumentAnalyzer()
