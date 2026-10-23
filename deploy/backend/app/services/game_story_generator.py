import json
import logging
import uuid
from typing import List, Dict, Any, Optional
import asyncio
import re

from app.services.ai_request_manager import ai_request_manager

logger = logging.getLogger(__name__)


class GameStoryGenerator:

    SYSTEM_PROMPT = (
        '你是一位擅长角色扮演和知识讲解的galgame角色。\n\n'
        '请严格按照以下角色设定进行一对一的对话：\n'
        '- 你将以给定的角色身份，用流畅自然的对话方式讲解文档内容\n'
        '- 每次回复都必须是该角色的台词，仿佛我就在你面前听你讲述\n'
        '- 你需要融入角色设定，使用符合角色性格的语气和措辞\n'
        '- 必须提炼文档中的核心知识点和关键要点\n'
        '- 对关键概念要进行剖析、举例和延伸，帮助我真正理解，而不是简单重述\n'
        '- 结合原文：在用自己的话讲解后，适当引用原文中的关键语句来佐证，让讲解有据可依\n'
        '- 可以选择先用提问引导思考，再展开讲解，形成"提问→思考→讲解→总结"的节奏\n'
        '- 学完知识点后可以对我进行提问，也可以在讲解新内容前先抛出问题，使用选择题形式\n'
        '- 用小句对话一问一答地推进，不要一次性输出大段太长的文本\n'
        '- 段落之间要有自然的过渡和连接\n\n'
        '提问时使用选择题形式，注意问题必须自然地融入角色的对话台词中，而不是独立展示：\n'
        '  - options 中提供3-4个选项\n'
        '  - 指定正确选项 correct_id\n'
        '  - error_hints 是选错时角色的对话回应（以台词形式）\n'
        '  - on_correct 是答对时角色的对话回应（以台词形式）\n'
        '  - correct_expression 答对回应时对应的表情差分（可选，不填则为 "portrait"）\n'
        '  - error_expressions 选错回应时对应的表情差分，键同 error_hints，可选不填则为 "portrait"\n\n'
        '输出格式为标准的 JSON 数组，严格遵循以下格式：\n'
        '[\n'
        '  {\n'
        '    "character": "角色名",\n'
        '    "text": "角色的台词内容（问题应自然融入在台词中）",\n'
        '    "expression": "portrait",\n'
        '    "question": {\n'
        '      "text": "（此字段仅用于标记有提问，实际内容在台词中）",\n'
        '      "options": [\n'
        '        {"id": "a", "text": "选项A"},\n'
        '        {"id": "b", "text": "选项B"},\n'
        '        {"id": "c", "text": "选项C"}\n'
        '      ],\n'
        '      "correct_id": "b",\n'
        '      "error_hints": {\n'
        '        "a": "选A时角色说的对话回应",\n'
        '        "c": "选C时角色说的对话回应"\n'
        '      },\n'
        '      "on_correct": "答对时角色说的对话回应",\n'
        '      "correct_expression": "portrait",\n'
        '      "error_expressions": {\n'
        '        "a": "portrait",\n'
        '        "c": "portrait"\n'
        '      }\n'
        '    }\n'
        '  }\n'
        ']\n\n'
        'expression 字段说明：\n'
        '- 默认不填或填 "portrait" 时显示角色默认立绘\n'
        '- 表情差分应该保持连续性：同一段情绪状态下保持同一个表情，不要频繁切换\n'
        '- 只有当角色情绪/态度发生明显变化时（如从认真讲解→开心表扬、从平静→疑惑等）才切换表情\n'
        '- 正常情况下保持在 "portrait"（默认立绘），有情绪波动时才使用对应的 expression 标识\n'
        '- 表情变化要有意义、有间隔，而不是每句话都变\n'
        '- 具体有哪些表情可用，请参考下方的「角色可用的表情差分」列表\n\n'
        '⚠️ 重要：\n'
        '1. 只输出 JSON 数组，不要包含任何其他说明文字或代码块标记\n'
        '2. JSON 语法必须完全正确，键名使用双引号\n'
        '3. 所有输出的 "character" 字段必须统一为给出的角色名，不能出现「旁白」「用户」「我」或其他角色名\n'
        '4. 整段对话全程只有该角色一个人在说话，不要生成用户的台词\n'
        '5. question 字段可选，纯对话时不要包含\n'
        '6. 确保角色对话自然流畅，符合人物设定\n'
        '7. 对话之间要有衔接，不要生硬切换话题\n'
        '8. **全面覆盖**：必须逐条覆盖原文中的所有知识点和关键信息，不得有任何遗漏。\n'
        '   如果某部分内容较多，适当增加对话句数（20-40句）来确保完整覆盖，宁可多说不少说。\n'
        '   可以用"提问（该提问以启发思考为主，而不是考验）→思考→讲解→提问→总结"的节奏逐点推进，确保每个知识点都讲透。'
    )

    MAX_CHUNK_CHARS = 4000

    BRIDGE_PROMPT = (
        '你是一位擅长角色扮演和知识讲解的galgame角色。\n\n'
        '你的任务是：\n'
        '1. 生成一段自然的过渡对话，将两个相邻的对话片段流畅地连接起来\n'
        '2. **改写后一段的开头部分**，使其与前一段的结尾以及过渡对话自然衔接，而不是生硬地另起话题\n\n'
        '我会提供：\n'
        '1. 前一段的末尾几句对话（你需要从这里自然地接续出去）\n'
        '2. 后一段的开头部分内容（你需要改写这段开头，让它和上面的过渡对话融为一体）\n\n'
        '⚠️ 注意：前一段和后一段是**连续同一时间发生的对话**，中间没有任何时间间隔。\n'
        '   所以过渡要像正常聊天一样自然接话，不能使用"过了一会儿""突然""这时"等表示时间变化的过渡词，\n'
        '   也不能用换场景、转移注意力等生硬方式。\n\n'
        '要求：\n'
        '- 承上启下：简要回顾前一段提到的内容，然后自然引入后一段将要讲述的内容\n'
        '- 角色设定、说话语气、风格必须与给定的对话保持一致\n'
        '- 过渡要自然流畅，不能生硬，就像正常的聊天对话一样\n'
        '- 改写后一段开头时，必须保留原文中的关键知识点和重要信息，但表达方式和语气要重新组织，'
        '使其承接过渡对话，不能有"突然切换话题"的感觉\n'
        '- 用小句对话一问一答地推进，不要一次性输出大段太长的文本\n'
        '- 输出格式为 JSON 数组，每个元素包含 character 和 text 字段\n'
        '- 所有输出的 "character" 字段必须统一为同一个角色名，不能出现「旁白」「用户」或其他角色\n'
        '- 生成 12-18 句过渡对话（包含改写后的后一段开头）\n\n'
        '⚠️ 选择题保护规则（极其重要，必须严格遵守）：\n'
        '  - 如果后一段开头中包含**带有 question 字段**的对话条目（选择题），你必须**完全原样保留它们**，不得做任何修改\n'
        '  - 选择题字段包括：question、options、correct_id、error_hints、on_correct、correct_expression、error_expressions 等，必须全部保留原内容\n'
        '  - 你只能改写那些**没有 question 字段**的纯对话条目\n'
        '  - 如果后一段开头全部是选择题，则不要生成任何过渡对话，直接返回空数组\n\n'
        '⚠️ 只输出 JSON 数组，不要包含任何其他说明文字或代码块标记。\n'
        '⚠️ 关键：输出的对话要覆盖后一段开头中的重要知识点，不能因为改写而丢失核心内容。'
    )

    ENDING_PROMPT = (
        '你是一位擅长角色扮演的galgame角色。\n\n'
        '你的任务是生成一段故事的结束语（尾声/告别语）。\n'
        '我会提供整个对话的完整内容，你需要根据前面的对话来生成一段结束语。\n\n'
        '要求：\n'
        '- 以角色身份说出告别/总结的话语\n'
        '- 回顾对话中的关键内容，进行总结，但绝对不要包含任何选择题（question）内容\n'
        '- 要完全符合角色设定，给故事一个完美的收尾\n'
        '- 用小句对话一问一答地推进，不要一次性输出大段太长的文本\n'
        '- 输出格式为 JSON 数组，每个元素包含 character 和 text 字段，**不要包含 question 字段**\n'
        '- 所有输出的 "character" 字段必须统一为同一个角色名，不能出现「旁白」「用户」或其他角色\n'
        '- 生成 8-12 句结束语，充分回顾和总结\n\n'
        '⚠️ 只输出 JSON 数组，不要包含任何其他说明文字或代码块标记。\n'
        '⚠️ 结束语中绝对不能出现 question（选择题）内容。'
    )

    async def generate_story_sections(
        self,
        sections: List[Dict[str, Any]],
        document_title: str,
        character_prompt: Optional[str] = None,
        character_name: Optional[str] = None,
        player_title: str = '同学',
        expression_descriptions: Optional[List[str]] = None,
        portrait_url: Optional[str] = None,
        cg_images: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        section_chunks = self._chunk_sections(sections)

        if not section_chunks:
            return [{"character": "叙述者", "text": "（文档内容为空）"}]

        logger.info(f"AI 剧情生成: 文档共 {len(section_chunks)} 个分块 (来自 {len(sections)} 个 sections)")
        for ci, chunk in enumerate(section_chunks):
            chunk_text = self._sections_to_text(chunk)
            logger.info(f"  分块 {ci}: {len(chunk)} 个 sections, {len(chunk_text)} 字符")

        system_prompt = self._build_system_prompt(
            character_prompt=character_prompt,
            character_name=character_name,
            player_title=player_title,
            expression_descriptions=expression_descriptions,
        )

        async def process_chunk(section_chunk: List[Dict[str, Any]], index: int) -> tuple[int, Any]:
            chunk_text = self._sections_to_text(section_chunk)
            prompt = (
                f"文档标题：{document_title}\n\n"
                f"文档内容（第 {index + 1}/{len(section_chunks)} 部分，共 {len(section_chunks)} 部分）：\n{chunk_text}\n\n"
                "请根据以上内容生成视觉小说剧本片段。\n"
                f"注意：这是全部 {len(section_chunks)} 部分中的第 {index + 1} 部分，请生成尽量多的对话来完整覆盖本部分的所有知识点。"
            )
            try:
                logger.info(f"[分块 {index}] 开始 AI 生成 (输入 {len(chunk_text)} 字符)...")
                result = await self._generate_chunk_story(prompt, index, system_prompt)
                logger.info(f"[分块 {index}] AI 生成完成，产出 {len(result) if isinstance(result, list) else '?'} 个场景段")
                return index, result
            except Exception as e:
                logger.error(f"分块 {index} 生成失败: {e}", exc_info=True)
                return index, e

        tasks = [process_chunk(chunk, i) for i, chunk in enumerate(section_chunks)]
        logger.info(f"等待 {len(tasks)} 个 AI 生成任务完成...")
        loop = asyncio.get_running_loop()
        start_time = loop.time()
        results = await asyncio.gather(*tasks)
        elapsed = loop.time() - start_time
        logger.info(f"所有 AI 生成任务完成，总耗时: {elapsed:.1f}s")

        results.sort(key=lambda x: x[0])

        story_sections: List[Dict[str, Any]] = []
        chunk_outputs: List[List[Dict[str, Any]]] = []
        for i, (_, result) in enumerate(results):
            if isinstance(result, Exception):
                logger.warning(f"分块 {i} 使用原文回退")
                fallback = {"character": "叙述者", "text": self._sections_to_text(section_chunks[i])}
                story_sections.append(fallback)
                chunk_outputs.append([fallback])
            elif isinstance(result, list):
                logger.info(f"分块 {i}: 添加 {len(result)} 个 AI 场景段")
                story_sections.extend(result)
                chunk_outputs.append(result)
            elif isinstance(result, dict):
                story_sections.append(result)
                chunk_outputs.append([result])
            else:
                text = str(result) if result else self._sections_to_text(section_chunks[i])
                fallback = {"character": "叙述者", "text": text}
                story_sections.append(fallback)
                chunk_outputs.append([fallback])

        if not story_sections:
            logger.error("AI 剧情生成: 所有分块均失败，无任何场景段")
            story_sections.append({"character": "叙述者", "text": "（AI 剧情生成失败）"})

        # bridge_info[i] = (bridge_dialog, tail_q_count, head_q_count)
        # tail_q_count = chunk i 最后2条中选择题的数量（不切掉）
        # head_q_count = chunk i+1 前3条中选择题的数量（不切掉）
        bridge_info: Dict[int, tuple[List[Dict[str, Any]], int, int]] = {}

        async def gen_bridge(i: int, j: int) -> tuple[int, Optional[tuple[List[Dict[str, Any]], int, int]]]:
            out_i = chunk_outputs[i]
            out_j = chunk_outputs[j]
            if len(out_i) < 2 or len(out_j) < 3:
                return i, None
            tail = out_i[-2:]
            head = out_j[:3]
            tail_q_count = sum(1 for e in tail if 'question' in e)
            head_q_count = sum(1 for e in head if 'question' in e)
            if head_q_count >= len(head):
                # head 全部是选择题，无需桥接
                return i, None
            try:
                bridge = await self._generate_bridge_dialogue(tail, head, i, system_prompt, character_prompt, character_name, player_title)
                if bridge:
                    logger.info(f"桥接 {i}→{j}: 成功生成 {len(bridge)} 句（tail保留{tail_q_count}道选择题 + head保留{head_q_count}道选择题）")
                    return i, (bridge, tail_q_count, head_q_count)
                return i, None
            except Exception as e:
                logger.error(f"桥接 {i}→{j} 失败: {e}", exc_info=True)
                return i, None

        bridge_tasks = []
        for i in range(len(chunk_outputs) - 1):
            bridge_tasks.append(gen_bridge(i, i + 1))

        if bridge_tasks:
            logger.info(f"开始生成 {len(bridge_tasks)} 个桥接对话...")
            bridge_start = loop.time()
            bridge_results = await asyncio.gather(*bridge_tasks)
            bridge_elapsed = loop.time() - bridge_start
            logger.info(f"桥接对话生成完成，耗时: {bridge_elapsed:.1f}s")
            for chunk_idx, result in bridge_results:
                if result is not None:
                    bridge_info[chunk_idx] = result

        if bridge_info:
            final_sections: List[Dict[str, Any]] = []
            for i, out in enumerate(chunk_outputs):
                s = 0
                e = len(out)
                if i > 0 and (i - 1) in bridge_info:
                    # chunk i 的前3条中有 head_q_count 道选择题需要保留
                    _, _, prev_head_q = bridge_info[i - 1]
                    s = 3 - prev_head_q
                if i in bridge_info:
                    # chunk i 的最后2条中有 tail_q_count 道选择题需要保留
                    _, tail_q, _ = bridge_info[i]
                    e = len(out) - (2 - tail_q)
                if s < e:
                    for entry in out[s:e]:
                        final_sections.append(entry)
                else:
                    logger.warning(f"分块 {i} 内容过短 ({len(out)} 条)，head({s}) 与 tail({e}) 重叠，保留原始内容")
                    for entry in out:
                        final_sections.append(entry)
                if i in bridge_info:
                    bridge_dialog, _, _ = bridge_info[i]
                    for entry in bridge_dialog:
                        final_sections.append(entry)
            logger.info(f"桥接完成: 共插入 {len(bridge_info)} 段过渡对话（选择题保留在原始位置）")
            logger.info(f"最终场景段数: {len(final_sections)} (原: {len(story_sections)})")
            story_sections = final_sections

        ending_section = await self._generate_ending_section(
            story_sections,
            system_prompt,
            character_prompt,
            cg_images,
            character_name,
            player_title,
        )
        if ending_section:
            story_sections.append(ending_section)
            logger.info(f"添加结束语+CG段落")

        logger.info(f"AI 剧情生成完成: 共 {len(story_sections)} 个场景段")
        return story_sections

    def _build_system_prompt(
        self,
        character_prompt: Optional[str] = None,
        character_name: Optional[str] = None,
        player_title: str = '同学',
        expression_descriptions: Optional[List[str]] = None,
    ) -> str:
        prompt = self.SYSTEM_PROMPT

        if character_name:
            prompt += (
                f'\n\n你的角色名称为：{character_name}\n'
                f'在输出 JSON 时，请将 character 字段始终设置为 "{character_name}"。\n'
            )

        prompt += (
            f'\n你对用户的称呼为「{player_title}」。在对话中请始终以「{player_title}」来称呼用户，'
            f'例如"欢迎你，{player_title}！"、"你觉得呢，{player_title}？"等。\n'
        )

        if character_prompt:
            prompt += (
                f'\n\n角色设定（你必须严格遵循以下人设）：\n{character_prompt}\n'
            )

        if expression_descriptions:
            expr_lines = []
            for i, desc in enumerate(expression_descriptions):
                expr_lines.append(f'  - expression_{i}: {desc}')
            expr_count = len(expression_descriptions)
            valid_exprs = ', '.join(f'expression_{i}' for i in range(expr_count))
            prompt += (
                '\n\n角色可用的表情差分（你可以在对话的 expression 字段中选择使用）：\n'
                + '\n'.join(expr_lines) +
                '\n\n说明：'
                '\n- 当角色情绪适合某种表情时，请在对应对话的 expression 字段填入对应的表情标识'
                '\n- 可用的表情标识为：' + valid_exprs + '，请只使用以上列出的表情，不要使用未列出的 expression 标识'
                '\n- 默认使用 portrait（普通立绘）'
                '\n- 如果没有任何表情适合当前情绪，请使用 "portrait"'
            )

        return prompt

    async def _generate_ending_section(
        self,
        story_sections: List[Dict[str, Any]],
        system_prompt: Optional[str] = None,
        character_prompt: Optional[str] = None,
        cg_images: Optional[List[str]] = None,
        character_name: Optional[str] = None,
        player_title: str = '同学',
    ) -> Optional[Dict[str, Any]]:
        if not story_sections:
            return None

        full_text = ""
        last_character = ""
        for entry in story_sections:
            char_name = entry.get("character", "")
            text = entry.get("text", "")
            if char_name and char_name != "叙述者":
                last_character = char_name
            full_text += f"[{char_name}]: {text}\n"

        if not last_character:
            last_character = "角色"

        ending_system = self.ENDING_PROMPT
        if character_prompt:
            ending_system += (
                f'\n\n角色设定（你必须严格遵循以下人设）：\n{character_prompt}\n'
            )
        if character_name:
            ending_system += (
                f'\n\n你的角色名称：{character_name}。请以「{character_name}」的身份说出告别语。\n'
            )

        ending_prompt = (
            f"以下是完整的对话内容，请根据全部对话生成一段自然的结束语：\n\n{full_text}\n\n"
            "请以角色身份说出告别/总结的话语。"
        )
        ending_prompt += f"\n你对用户的称呼为「{player_title}」，在告别语中以「{player_title}」称呼用户。\n"

        last_response = ""
        for attempt in range(3):
            try:
                response = await ai_request_manager.make_request(
                    request_id=f"game_ending_{uuid.uuid4().hex[:8]}",
                    messages=[
                        {"role": "system", "content": ending_system},
                        {"role": "user", "content": ending_prompt},
                    ],
                    model="deepseek-v4-flash",
                    reasoning_effort="high",
                )
            except Exception as e:
                logger.error(f"结束语生成失败 (尝试 {attempt+1}/3): {e}")
                continue

            if not response or not response.strip():
                logger.warning(f"结束语 AI 返回空响应 (尝试 {attempt+1}/3)，立即重试")
                continue

            last_response = response

            cleaned = self._strip_markdown(response)
            parsed = self._try_parse_json(cleaned)
            if parsed is not None:
                logger.info(f"结束语 JSON 解析成功 (尝试 {attempt+1})")
                ending_text = " ".join(entry.get("text", "") for entry in parsed)
                ending_character = parsed[-1].get("character", last_character) if parsed else last_character
                break

            logger.warning(f"结束语 JSON 解析失败 (尝试 {attempt+1}/3)，立即重试")
        else:
            if last_response:
                cleaned = self._strip_markdown(last_response)
                result = self._try_parse_json(cleaned)
                if result is not None:
                    ending_text = " ".join(entry.get("text", "") for entry in result)
                    ending_character = result[-1].get("character", last_character) if result else last_character
                else:
                    ending_text = last_response.strip() or "故事到此结束，感谢你的聆听。"
                    ending_character = last_character
            else:
                ending_text = "故事到此结束，感谢你的聆听。"
                ending_character = last_character

        ending_entry: Dict[str, Any] = {
            "type": "ending",
            "character": ending_character,
            "text": ending_text,
            "expression": "portrait",
        }
        if cg_images:
            ending_entry["cg_images"] = cg_images

        return ending_entry

    def _sections_to_text(self, sections: List[Dict[str, Any]]) -> str:
        texts: List[str] = []
        for sec in sections:
            t = sec.get("type", "")
            if t == "title":
                texts.append(f"\n# {sec.get('text', '')}\n")
            elif t == "content":
                texts.append(sec.get("text", ""))
            elif t == "image":
                texts.append(f"\n[图片: {sec.get('alt', sec.get('text', ''))}]\n")
        return "\n".join(texts)

    def _chunk_sections(self, sections: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
        section_chunks: List[List[Dict[str, Any]]] = []
        current_chunk: List[Dict[str, Any]] = []
        current_size = 0

        for sec in sections:
            sec_text = self._section_to_text(sec)
            sec_size = len(sec_text)

            if sec_size <= self.MAX_CHUNK_CHARS:
                if current_chunk and current_size + sec_size > self.MAX_CHUNK_CHARS:
                    section_chunks.append(current_chunk)
                    current_chunk = []
                    current_size = 0
                current_chunk.append(sec)
                current_size += sec_size
            else:
                if current_chunk:
                    section_chunks.append(current_chunk)
                    current_chunk = []
                    current_size = 0
                pieces = self._split_oversized_section(sec, sec_text)
                for piece in pieces:
                    section_chunks.append([piece])

        if current_chunk:
            section_chunks.append(current_chunk)

        return section_chunks if section_chunks else [sections]

    def _split_oversized_section(self, section: Dict[str, Any], sec_text: str) -> List[Dict[str, Any]]:
        t = section.get("type", "")
        if t == "image":
            return [section]
        text = section.get("text", "")
        if not text:
            return [section]
        pieces: List[Dict[str, Any]] = []
        start = 0
        while start < len(text):
            end = min(start + self.MAX_CHUNK_CHARS, len(text))
            if end < len(text):
                break_pos = text.rfind('\n', start, end)
                if break_pos > start:
                    end = break_pos + 1
                else:
                    break_pos = text.rfind('。', start, end)
                    if break_pos > start:
                        end = break_pos + 1
                    elif break_pos == -1:
                        break_pos = text.rfind('.', start, end)
                        if break_pos > start:
                            end = break_pos + 1
            piece_text = text[start:end].strip()
            if piece_text:
                pieces.append({"type": t, "text": piece_text})
            start = end
        return pieces if pieces else [section]

    def _section_to_text(self, section: Dict[str, Any]) -> str:
        t = section.get("type", "")
        if t == "title":
            return f"\n# {section.get('text', '')}\n"
        elif t == "content":
            return section.get("text", "")
        elif t == "image":
            return f"\n[图片: {section.get('alt', section.get('text', ''))}]\n"
        return ""

    async def _generate_chunk_story(
        self,
        prompt: str,
        chunk_index: int,
        system_prompt: Optional[str] = None,
        max_retries: int = 3,
    ) -> List[Dict[str, Any]]:
        last_response = ""
        for attempt in range(max_retries):
            messages = [
                {"role": "system", "content": system_prompt or self.SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ]

            response = await ai_request_manager.make_request(
                request_id=f"game_story_chunk_{chunk_index}_{uuid.uuid4().hex[:8]}",
                messages=messages,
                model="deepseek-v4-flash",
                max_tokens=32768,
                reasoning_effort="high",
            )

            if not response or not response.strip():
                logger.warning(f"[分块 {chunk_index}] AI 返回空响应 (尝试 {attempt+1}/{max_retries})，立即重试")
                continue

            last_response = response

            cleaned = self._strip_markdown(response)
            parsed = self._try_parse_json(cleaned)
            if parsed is not None:
                logger.info(f"[分块 {chunk_index}] JSON 解析成功, {len(parsed)} 个场景段 (尝试 {attempt+1})")
                return parsed

            logger.warning(f"[分块 {chunk_index}] JSON 解析失败 (尝试 {attempt+1}/{max_retries})，立即重试")

        logger.warning(f"[分块 {chunk_index}] {max_retries} 次重试均失败，尝试逐行恢复")
        if last_response:
            cleaned = self._strip_markdown(last_response)
            result = self._try_parse_json(cleaned)
            if result is not None:
                logger.info(f"[分块 {chunk_index}] 逐行恢复成功, {len(result)} 个场景段")
                return result

        logger.warning(f"[分块 {chunk_index}] 所有方式均失败，使用 fallback 文本")
        text = last_response[:500] if last_response else "（AI 生成失败，请重试）"
        return [{"character": "叙述者", "text": text}]

    async def _generate_bridge_dialogue(
        self,
        tail_entries: List[Dict[str, Any]],
        head_entries: List[Dict[str, Any]],
        chunk_index: int,
        system_prompt: Optional[str] = None,
        character_prompt: Optional[str] = None,
        character_name: Optional[str] = None,
        player_title: str = '同学',
    ) -> List[Dict[str, Any]]:
        tail_text = json.dumps(tail_entries, ensure_ascii=False, indent=2)
        head_text = json.dumps(head_entries, ensure_ascii=False, indent=2)
        user_prompt = (
            f"前一段的末尾对话：\n{tail_text}\n\n"
            f"后一段的开头对话：\n{head_text}\n\n"
            "请生成一段流畅的过渡对话，将以上两个片段自然地连接起来。"
        )
        bridge_system = self.BRIDGE_PROMPT
        if character_name:
            bridge_system += (
                f'\n\n你的角色名称：{character_name}。请确保过渡对话中的角色名保持一致。\n'
            )
        bridge_system += (
            f'\n你对用户的称呼为「{player_title}」。在过渡对话中以「{player_title}」称呼用户。\n'
        )
        if character_prompt:
            bridge_system += (
                f'\n\n角色设定（你必须严格遵循以下人设）：\n{character_prompt}\n'
            )
        last_response = ""
        for attempt in range(3):
            messages = [
                {"role": "system", "content": bridge_system},
                {"role": "user", "content": user_prompt},
            ]
            response = await ai_request_manager.make_request(
                request_id=f"game_bridge_{chunk_index}_{uuid.uuid4().hex[:8]}",
                messages=messages,
                model="deepseek-v4-flash",
                max_tokens=4096,
                reasoning_effort="high",
            )

            if not response or not response.strip():
                logger.warning(f"[桥接 {chunk_index}] AI 返回空响应 (尝试 {attempt+1}/3)，立即重试")
                continue

            last_response = response

            cleaned = self._strip_markdown(response)
            parsed = self._try_parse_json(cleaned)
            if parsed is not None:
                logger.info(f"[桥接 {chunk_index}] JSON 解析成功, {len(parsed)} 个场景段 (尝试 {attempt+1})")
                return parsed

            logger.warning(f"[桥接 {chunk_index}] JSON 解析失败 (尝试 {attempt+1}/3)，立即重试")

        logger.warning(f"[桥接 {chunk_index}] 3 次重试均失败")
        if last_response:
            cleaned = self._strip_markdown(last_response)
            result = self._try_parse_json(cleaned)
            if result is not None:
                logger.info(f"[桥接 {chunk_index}] 逐行恢复成功, {len(result)} 个场景段")
                return result

        return []

    def _parse_ai_response(self, response: str) -> List[Dict[str, Any]]:
        text = response.strip()

        if not text:
            logger.warning("AI 响应为空")
            return [{"character": "叙述者", "text": ""}]

        cleaned = self._strip_markdown(text)

        result = self._try_parse_json(cleaned)
        if result is not None:
            return result

        json_end = cleaned.rfind("]")
        if json_end != -1:
            pos = json_end
            while pos >= 0:
                json_start = cleaned.rfind("[", 0, pos)
                if json_start == -1:
                    break
                candidate = cleaned[json_start:json_end + 1]
                result = self._try_parse_json(candidate)
                if result is not None:
                    logger.info(f"AI JSON 提取成功: 位置 [{json_start}:{json_end}]")
                    return result
                pos = json_start

        logger.warning(f"AI 响应 JSON 完全解析失败，回退纯文本: {text[:200]}")
        return [{"character": "叙述者", "text": text}]

    def _strip_markdown(self, text: str) -> str:
        text = re.sub(r'```(?:json)?\s*\n?', '', text)
        text = re.sub(r'\n?```\s*', '', text)
        return text.strip()

    def _try_parse_json(self, json_str: str) -> Optional[List[Dict[str, Any]]]:
        if not json_str or not json_str.strip():
            return None

        cleaned = json_str.strip()

        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, list):
                return parsed
            if isinstance(parsed, dict):
                logger.info("AI JSON 是对象，转为列表")
                return [parsed]
        except json.JSONDecodeError:
            pass

        cleaned = re.sub(r',\s*([}\]])', r'\1', cleaned)
        cleaned = re.sub(r',\s*$', '', cleaned, flags=re.MULTILINE)
        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, list):
                logger.info("AI JSON 修复: 去除多余逗号")
                return parsed
        except json.JSONDecodeError:
            pass

        cleaned_single = re.sub(r"'", '"', cleaned)
        try:
            parsed = json.loads(cleaned_single)
            if isinstance(parsed, list):
                logger.info("AI JSON 修复: 单引号转双引号")
                return parsed
        except json.JSONDecodeError:
            pass

        try:
            cleaned_no_ws = re.sub(r'\s+', ' ', cleaned_single)
            cleaned_no_ws = re.sub(r'"\s+', '"', cleaned_no_ws)
            cleaned_no_ws = re.sub(r'\s+"', '"', cleaned_no_ws)
            parsed = json.loads(cleaned_no_ws)
            if isinstance(parsed, list):
                logger.info("AI JSON 修复: 去除多余空白")
                return parsed
        except json.JSONDecodeError:
            pass

        logger.warning("AI 响应 JSON 解析失败，尝试逐行提取")
        lines = json_str.split("\n")
        partial: List[Dict[str, Any]] = []
        buffer = ""
        brace_count = 0
        in_array = False
        for line in lines:
            if '[' in line and not in_array:
                in_array = True
                line = line.split('[', 1)[1]
            if in_array:
                buffer += line + "\n"
                brace_count += line.count("{") - line.count("}")
                if brace_count == 0 and buffer.strip():
                    cleaned_obj = buffer.strip().rstrip(",")
                    if cleaned_obj.startswith("{"):
                        try:
                            obj = json.loads(cleaned_obj)
                            partial.append(obj)
                        except json.JSONDecodeError:
                            pass
                        buffer = ""
        if partial:
            logger.info(f"AI JSON 部分恢复: 成功提取 {len(partial)} 个对象")
            return partial
        return None


game_story_generator = GameStoryGenerator()
