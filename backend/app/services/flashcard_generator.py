import asyncio
import logging
import json
import re
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from app.services.ai_request_manager import ai_request_manager

logger = logging.getLogger(__name__)


@dataclass
class GeneratedFlashcard:
    """生成的抽认卡"""
    question: str
    answer: str
    source_text: Optional[str] = None
    confidence: Optional[float] = None
    is_multiple_choice: bool = False
    is_multiple: bool = False
    options: Optional[List[Dict[str, str]]] = None
    correct_option_label: Optional[str] = None
    correct_option_labels: Optional[List[str]] = None


class FlashcardGenerator:
    """抽认卡生成器（支持侧重点 + 迭代）"""

    def _build_prompt_standard(self, side_focus_rule: str, content: str) -> str:
        return f"""你是一个教育专家，擅长从文本中提取关键知识点并生成练习题。

{side_focus_rule}

请根据以下文档内容，生成用于学习和复习的练习题。

要求：
1. 如果是题库类文档（包含大量题目/习题）：
   - 直接使用原题，已有答案作为解析
   - 每个题目生成一张卡
   - 选择题保留原选项，标记正确选项

2. 如果是普通文档：
   - 提取核心知识点，每个知识点至少生成一个问题
   - 约60%选择题（含2-3道多选题），约40%问答题
   - **务必生成尽可能多的卡片，越多越好**
   - 问题应覆盖内容中的大部分关键点，不留遗漏
   - 避免过于简单或过于细枝末节的问题

3. 选择题格式：
   - 单选题：4个选项(A/B/C/D)，标记 correct_option_label
   - 多选题：3-5个选项，is_multiple=true，标记 correct_option_labels
   - 答案必须包含【答案】和【解析】，逐项分析

4. 通用要求：
   - 问题严格基于原文，不凭空捏造
   - 中文输出，专业准确
   - 输出严格 JSON 数组，无额外文字

文档内容：
{content}
""" + self.EXAMPLE_JSON

    def _build_prompt_iteration(self, side_focus_rule: str, existing_count: int, target_count: int,
                                 existing_questions: str, content: str) -> str:
        return f"""之前你已从以下文档生成了 {existing_count} 张卡片，但数量还不够（目标 {target_count} 张）。

**请继续生成更多卡片**，确保覆盖之前未涉及的知识点。规则同上。

{side_focus_rule}

之前已生成的卡片问题列表（请勿重复）：
{existing_questions}

文档内容：
{content}
""" + self.EXAMPLE_JSON

    EXAMPLE_JSON = """
输出格式（严格JSON数组，不要markdown代码块）：
[{"question":"题干","answer":"【答案】要点\\n\\n【解析】详细分析","is_multiple_choice":false},
 {"question":"选择题题干","answer":"【答案】A\\n\\n【解析】A对因为...；B错因为...","is_multiple_choice":true,"is_multiple":false,"options":[{"label":"A","text":"..."}],"correct_option_label":"A"}]
只输出JSON数组，不要```json包裹："""

    def __init__(self):
        pass

    def _build_side_focus_rule(self, focus_text: Optional[str]) -> str:
        """构建侧重点指令"""
        if not focus_text or not focus_text.strip():
            return ""
        return f"""【最高优先级规则 - 覆盖所有其他要求】
用户指定侧重点：{focus_text.strip()}

请严格按此侧重点生成卡片：
- 如果用户要求"只要翻译题"，则只生成单词/句子翻译题
- 如果用户要求"侧重于XX知识点"，则只围绕该知识点出题
- 如果用户要求"只要选择题"，则只生成选择题
- 此规则优先于上述所有格式和数量要求
"""

    def _parse_json_response(self, response: str) -> Optional[List[Dict[str, str]]]:
        """解析JSON响应（容错处理 markdown 代码块、截断等）"""
        if not response or not response.strip():
            return None

        text = response.strip()

        # 去除 markdown 代码块包裹
        md_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
        if md_match:
            text = md_match.group(1).strip()

        # 找 JSON 数组边界
        start = text.find('[')
        end = text.rfind(']')
        json_str = None

        if start >= 0 and end > start:
            json_str = text[start:end + 1]
        elif start >= 0:
            # 数组未闭合，尝试补全：找到最后一个完整对象
            truncated = text[start:]
            brace_positions = [m.start() for m in re.finditer(r'\}', truncated)]
            for bpos in reversed(brace_positions):
                candidate = truncated[:bpos + 1] + ']'
                try:
                    result = json.loads(candidate)
                    logger.info(f"截断修复成功: 到位置 {bpos}")
                    return result
                except json.JSONDecodeError:
                    continue
            # 补全失败，继续尝试逐个对象提取
            json_str = truncated  # 标记为有内容但无法补全完整数组

        if not json_str and start < 0:
            return None

        # 尝试直接/补全解析
        if json_str:
            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                try:
                    fixed = re.sub(r',\s*([}\]])', r'\1', json_str)
                    return json.loads(fixed)
                except json.JSONDecodeError:
                    pass

        # 最终手段：逐个对象提取
        logger.warning(f"JSON数组整体解析失败，尝试逐个对象提取: {text[:100]}...")
        objects = []
        for m in re.finditer(r'\{[^{}]*\{[^{}]*\}[^{}]*\}|\{[^{}]*\}', text):
            try:
                obj = json.loads(m.group(0))
                if isinstance(obj, dict) and obj.get('question'):
                    objects.append(obj)
            except json.JSONDecodeError:
                continue
        if objects:
            logger.info(f"逐个对象提取成功: {len(objects)} 个")
            return objects
        logger.error(f"JSON解析失败: {text[:200]}...")
        return None

    def _cards_from_pairs(self, qa_pairs: List[Dict], content: str) -> List[GeneratedFlashcard]:
        """将 Q&A 对转为 GeneratedFlashcard 列表"""
        flashcards = []
        for pair in qa_pairs:
            question = pair.get("question", "").strip()
            answer = pair.get("answer", "").strip()
            if question and answer:
                confidence = min(1.0, 0.7 + (len(question) + len(answer)) / 500)
                source_text = content[:200] + "..." if len(content) > 200 else content
                is_multiple_choice = bool(pair.get("is_multiple_choice", False))
                is_multiple = bool(pair.get("is_multiple", False)) if is_multiple_choice else False
                options = pair.get("options") if is_multiple_choice else None
                correct_option_label = pair.get("correct_option_label") if is_multiple_choice and not is_multiple else None
                correct_option_labels = pair.get("correct_option_labels") if is_multiple_choice and is_multiple else None
                flashcards.append(GeneratedFlashcard(
                    question=question, answer=answer,
                    source_text=source_text, confidence=confidence,
                    is_multiple_choice=is_multiple_choice, is_multiple=is_multiple,
                    options=options, correct_option_label=correct_option_label,
                    correct_option_labels=correct_option_labels
                ))
        return flashcards

    async def generate_from_text(
        self, content: str, max_cards: int = 15, focus_text: Optional[str] = None, max_success: int = 5
    ) -> List[GeneratedFlashcard]:
        """从文本生成抽认卡（支持侧重点 + 迭代）"""
        if not content or not content.strip():
            return []

        logger.info(f"开始生成抽认卡，文本长度: {len(content)}, max_cards={max_cards}, focus={repr(focus_text)}")

        if len(content) > 10000:
            logger.warning(f"文本过长 ({len(content)} 字符)，截断")
            content = content[:10000] + "\n\n[内容已截断...]"

        side_focus = self._build_side_focus_rule(focus_text)
        all_flashcards = []
        existing_questions = []
        success_count = 0
        attempt = 0
        max_total_attempts = max_success * 3  # 防止无限重试

        while success_count < max_success and attempt < max_total_attempts:
            attempt += 1
            is_first = (success_count == 0)
            if is_first:
                prompt = self._build_prompt_standard(side_focus, content)
            else:
                prompt = self._build_prompt_iteration(
                    side_focus, len(all_flashcards), max_cards,
                    "\n".join(f"- {q}" for q in existing_questions), content)

            try:
                response = await asyncio.wait_for(
                    ai_request_manager.generate_text(
                        prompt=prompt, model="deepseek-v4-flash",
                        request_id=f"flashcard_{id(self)}_{attempt}",
                        temperature=0.3
                    ),
                    timeout=300.0
                )
                logger.info(f"尝试 {attempt} (成功 {success_count}/{max_success}): AI响应 {len(response)} 字符")

                qa_pairs = self._parse_json_response(response)
                if not qa_pairs:
                    logger.warning(f"尝试 {attempt}: JSON解析失败，将重试")
                    continue  # 重试

                batch = self._cards_from_pairs(qa_pairs, content)
                if not batch:
                    logger.warning(f"尝试 {attempt}: 无有效卡片，将重试")
                    continue  # 重试

                # 去重
                new_cards = []
                for card in batch:
                    if card.question not in existing_questions:
                        new_cards.append(card)
                        existing_questions.append(card.question)

                all_flashcards.extend(new_cards)
                success_count += 1
                logger.info(f"尝试 {attempt}: 新增 {len(new_cards)} 张，累计 {len(all_flashcards)} (成功 {success_count}/{max_success})")

                if len(all_flashcards) >= max_cards or (focus_text and focus_text.strip() and len(new_cards) > 0):
                    # 达到目标或侧重点模式有进展就停
                    break

            except asyncio.TimeoutError:
                logger.error(f"尝试 {attempt} 超时")
                if is_first:
                    break  # 首次超时退出
            except Exception as e:
                logger.error(f"尝试 {attempt} 失败: {e}")
                if is_first:
                    break  # 首次异常退出

        logger.info(f"共生成 {len(all_flashcards)} 张卡片")
        return all_flashcards

    async def generate_from_document(
        self, document_content: str, chapters_content: Optional[List[str]] = None,
        focus_text: Optional[str] = None
    ) -> List[GeneratedFlashcard]:
        """从文档内容生成抽认卡（支持按章节处理）"""
        all_flashcards = []
        if chapters_content:
            for i, chapter_content in enumerate(chapters_content):
                logger.info(f"处理第 {i+1} 章节，长度: {len(chapter_content)}")
                chapter_cards = await self.generate_from_text(chapter_content, focus_text=focus_text)
                for card in chapter_cards:
                    if card.source_text is None:
                        card.source_text = f"章节 {i+1}: {chapter_content[:100]}..."
                all_flashcards.extend(chapter_cards)
        else:
            all_flashcards = await self.generate_from_text(document_content, focus_text=focus_text)
        return all_flashcards


flashcard_generator = FlashcardGenerator()
