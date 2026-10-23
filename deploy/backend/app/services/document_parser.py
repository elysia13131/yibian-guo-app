import os
import re
import logging
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ParsedChapter:
    """解析后的章节信息"""
    title: Optional[str]
    content: str
    level: int
    order_index: int
    start_offset: int
    end_offset: int
    parent_id: Optional[int] = None


class DocumentParser:
    """文档内容解析器"""

    @staticmethod
    def parse_pdf(file_path: str, output_dir: str = "/uploads/tables") -> tuple:
        """
        text_blocks → 分组为行 → 合并标点行 → "".join()文本
        同一数据源：坐标+文本完全对齐，精准间隙检测
        间隙 >6%页高 → 插入图片占位符
        间隙 >3.5%页高 → 段落分隔
        """
        import os
        os.makedirs(output_dir, exist_ok=True)

        all_images_info = []

        # 检查系统是否有 libxcb，无则跳过 sopdf（避免 libxcb 报错）
        _has_libxcb = False
        try:
            import ctypes
            _has_libxcb = bool(ctypes.util.find_library("xcb"))
        except Exception:
            pass

        if _has_libxcb:
            try:
                import sopdf
                from PIL import Image
                import io

                page_texts = []
                img_counter = [0]

                from pypdf import PdfReader
                embedded_images_by_page = {}
                try:
                    pdf_reader = PdfReader(file_path)
                    for pi in range(len(pdf_reader.pages)):
                        pg = pdf_reader.pages[pi]
                        imgs = []
                        try:
                            for img in pg.images:
                                imgs.append(img.data)
                        except Exception:
                            pass
                        if imgs:
                            embedded_images_by_page[pi] = imgs
                except Exception as e:
                    logger.warning(f"pypdf 预提取失败: {e}")

                with sopdf.open(file_path) as doc:
                    for page_num in range(doc.page_count):
                        page = doc[page_num]

                        blocks = page.get_text_blocks()
                        if not blocks:
                            continue

                        page_rect = page.rect
                        pdf_h = page_rect.height if page_rect else 792

                        img_bytes = page.render(dpi=150)
                        pil_page = Image.open(io.BytesIO(img_bytes))
                        img_w, img_h = pil_page.size
                        scale_x = img_w / (page_rect.width if page_rect else 612)
                        scale_y = img_h / pdf_h

                        # 1. Group blocks by Y → raw coord_lines
                        sorted_b = sorted(blocks, key=lambda b: b.rect.y1, reverse=True)
                        raw_lines = []
                        for b in sorted_b:
                            done = False
                            for line in reversed(raw_lines):
                                if abs(b.rect.y1 - line[0].rect.y1) < 8:
                                    line.append(b)
                                    done = True
                                    break
                            if not done:
                                raw_lines.append([b])

                        if not raw_lines:
                            continue

                        # 2. Merge: (a) punctuation-only → previous line if close
                        #          (b) short orphan lines → nearest neighbor if close
                        merged_lines = []
                        for line in raw_lines:
                            line.sort(key=lambda b: b.rect.x0)
                            txt = "".join(b.text for b in line)
                            is_punct = all(c in '，。；：、！？…—·""''·,.;:!? \t' for c in txt)
                            is_short = len(txt) < 5 and not is_punct

                            if merged_lines and (is_punct or is_short):
                                prev = merged_lines[-1]
                                gap = prev[-1].rect.y0 - line[0].rect.y1
                                if gap < 18:
                                    prev.extend(line)
                                    continue
                            merged_lines.append(line)

                        # 3. Second pass: merge backward (short lines → next line)
                        final_lines = []
                        i = 0
                        while i < len(merged_lines):
                            line = merged_lines[i]
                            txt = "".join(b.text for b in line)
                            if len(txt) < 5 and final_lines:
                                prev = final_lines[-1]
                                gap = prev[-1].rect.y0 - line[0].rect.y1
                                if gap < 18:
                                    prev.extend(line)
                                    i += 1
                                    continue
                            final_lines.append(line)
                            i += 1

                        # 4. Re-sort each final line by X
                        for line in final_lines:
                            line.sort(key=lambda b: b.rect.x0)

                        page_embedded = embedded_images_by_page.get(page_num, [])
                        emb_idx = [0]

                        # 5. Build text with gap-based paragraph breaks and image insertion
                        output_parts = []

                        first_text = "".join(b.text for b in final_lines[0])
                        output_parts.append(first_text)
                        prev_y0 = final_lines[0][-1].rect.y0

                        for li in range(1, len(final_lines)):
                            curr_top = final_lines[li][0].rect.y1
                            gap = prev_y0 - curr_top
                            line_text = "".join(b.text for b in final_lines[li])

                            if gap < 0:
                                # Same line (overlap), just output
                                None

                            if gap > pdf_h * 0.06:
                                img_counter[0] += 1
                                pl = f"[IMG_PLACEHOLDER_{page_num + 1}_{img_counter[0]}]"

                                saved = False
                                if emb_idx[0] < len(page_embedded):
                                    data = page_embedded[emb_idx[0]]
                                    emb_idx[0] += 1
                                    ext = DocumentParser._detect_image_format(data)
                                    if ext:
                                        fn = f"img_p{page_num + 1}_{img_counter[0]}{ext}"
                                        fp = os.path.join(output_dir, fn)
                                        try:
                                            with open(fp, 'wb') as f:
                                                f.write(data)
                                            all_images_info.append({'placeholder': pl, 'path': fp})
                                            saved = True
                                        except Exception:
                                            pass

                                if not saved:
                                    x0 = min(b.rect.x0 for b in final_lines[li - 1] + final_lines[li])
                                    x1 = max(b.rect.x1 for b in final_lines[li - 1] + final_lines[li])
                                    px = int(30 * scale_x)
                                    py_t = int(max(30, gap * 0.3) * scale_y)
                                    py_b = int(max(30, gap * 0.3) * scale_y)
                                    cx0 = max(0, int(x0 * scale_x) - px)
                                    cx1 = min(img_w, int(x1 * scale_x) + px)
                                    cy0 = max(0, int((pdf_h - prev_y0) * scale_y) - py_t)
                                    cy1 = min(img_h, int((pdf_h - curr_top) * scale_y) + py_b)
                                    if cx1 > cx0 and cy1 > cy0:
                                        ri = pil_page.crop((cx0, cy0, cx1, cy1))
                                        fn = f"img_p{page_num + 1}_{img_counter[0]}.png"
                                        fp = os.path.join(output_dir, fn)
                                        ri.save(fp)
                                        all_images_info.append({'placeholder': pl, 'path': fp})
                                        saved = True

                                if not saved:
                                    logger.warning(f"图片提取失败: gap={gap:.0f}pt line='{line_text[:20]}'")

                                output_parts.append(pl)
                                output_parts.append("")  # paragraph break after image
                                output_parts.append(line_text)

                            elif gap > pdf_h * 0.035:
                                # Paragraph break
                                output_parts.append("")
                                output_parts.append(line_text)

                            else:
                                output_parts.append(line_text)

                            prev_y0 = final_lines[li][-1].rect.y0

                        page_text = "\n".join(output_parts)
                        page_texts.append(page_text)

                if page_texts:
                    full_text = "\n\n".join(page_texts)
                    protected_text = DocumentParser._finalize_text(full_text)
                    return protected_text, all_images_info

                # sopdf 返回空页，走 pypdf 坐标提取
                fb_text, _ = DocumentParser._pypdf_coordinate_extract(file_path, all_images_info)
                if fb_text.strip():
                    return DocumentParser._finalize_text(fb_text), all_images_info

            except Exception as e:
                logger.warning(f"sopdf 解析失败，回退到 PyPDF2: {e}")

        # PyPDF2 fallback（坐标感知版，类似 sopdf 的布局保留）
        fb_text, _ = DocumentParser._pypdf_coordinate_extract(file_path, all_images_info)
        return DocumentParser._finalize_text(fb_text), all_images_info

    @staticmethod
    def _pypdf_coordinate_extract(file_path: str, all_images_info: list) -> Tuple[str, list]:
        """使用 PyPDF2 的坐标信息提取文本，类似 sopdf 的布局保留。"""
        from pypdf import PdfReader
        reader = PdfReader(file_path)
        fb_page_texts = []
        for pi, pg in enumerate(reader.pages):
            try:
                page_rect = pg.mediabox
                pdf_h = float(page_rect.height) if page_rect else 792.0

                # 收集带坐标的文本片段
                blocks = []
                def _visitor(text, cm, tm, font_dict, font_size):
                    if not text.strip():
                        return
                    blocks.append((tm[4], tm[5], text))

                pg.extract_text(visitors=_visitor)
                if not blocks:
                    raw = pg.extract_text() or ""
                    if raw.strip():
                        fb_page_texts.append(raw)
                    continue

                # 排成阅读顺序（页面底部到顶部）
                blocks.sort(key=lambda b: -b[1])
                # 分⾏：Y 差距 < 6pt 视为同一行
                lines = []
                for bx, by, bt in blocks:
                    if lines and abs(by - lines[-1][0][1]) < 6:
                        lines[-1].append((bx, by, bt))
                    else:
                        lines.append([(bx, by, bt)])
                # 行内按 X 排序
                for line in lines:
                    line.sort(key=lambda p: p[0])
                # 合并标点/孤立短行
                merged = []
                for line in lines:
                    txt = "".join(p[2] for p in line)
                    is_punct = all(c in '，。；：、！？…—·""''·,.;:!? \t' for c in txt)
                    is_short = len(txt) < 5 and not is_punct
                    if merged and (is_punct or is_short):
                        gap = merged[-1][-1][1] - line[0][1]
                        if gap < 18:
                            merged[-1].extend(line)
                            continue
                    merged.append(line)
                # 短行向后合并
                final_lines = []
                i = 0
                while i < len(merged):
                    line = merged[i]
                    txt = "".join(p[2] for p in line)
                    if len(txt) < 5 and final_lines:
                        gap = final_lines[-1][-1][1] - line[0][1]
                        if gap < 18:
                            final_lines[-1].extend(line)
                            i += 1
                            continue
                    final_lines.append(line)
                    i += 1
                if not final_lines:
                    continue
                # 构建文本（带间隙检测）
                output_parts = []
                output_parts.append("".join(p[2] for p in final_lines[0]))
                prev_y0 = final_lines[0][-1][1]
                for li in range(1, len(final_lines)):
                    curr_top = final_lines[li][0][1]
                    gap = prev_y0 - curr_top
                    line_text = "".join(p[2] for p in final_lines[li])
                    if gap > pdf_h * 0.06:
                        output_parts.append(f"[IMG_PLACEHOLDER_{pi + 1}_1]")
                        output_parts.append("")
                        output_parts.append(line_text)
                    elif gap > pdf_h * 0.035:
                        output_parts.append("")
                        output_parts.append(line_text)
                    else:
                        output_parts.append(line_text)
                    prev_y0 = final_lines[li][-1][1]
                fb_page_texts.append("\n".join(output_parts))
            except Exception:
                try:
                    raw = pg.extract_text() or ""
                    if raw.strip():
                        fb_page_texts.append(raw)
                except Exception:
                    pass
        return "\n\n".join(fb_page_texts), all_images_info

    @staticmethod
    def _detect_image_format(data: bytes) -> Optional[str]:
        if data[:2] == b'\xff\xd8':
            return '.jpg'
        if data[:8] == b'\x89PNG\r\n\x1a\n':
            return '.png'
        if data[:4] == b'GIF8':
            return '.gif'
        if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            return '.webp'
        if data[:4] == b'MM\x00*' or data[:4] == b'II*\x00':
            return '.tiff'
        if data[:4] == b'%PDF':
            return None
        if len(data) < 20:
            return None
        return '.png'

    @staticmethod
    def _finalize_text(text: str) -> str:
        """最终清洗：占位符保护 + 清洗 + 章节分隔"""
        if not text:
            return text
        text = text.replace('\x00', '')

        # 保护占位符不被清洗破坏
        phs = []
        for m in re.finditer(r'\[IMG_PLACEHOLDER_\d+_\d+\]', text):
            phs.append((m.start(), m.end(), '\u200B' + m.group() + '\u200B', m.group()))
        for s, e, pr, org in reversed(phs):
            text = text[:s] + pr + text[e:]

        text = re.sub(r'\r\n', '\n', text)
        text = re.sub(r'\r', '\n', text)
        text = re.sub(r'[ \t]{2,}', ' ', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = text.strip()

        text = DocumentParser._separate_headings(text)
        text = text.replace('\u200B', '')
        return text

    @staticmethod
    def _separate_headings(text: str) -> str:
        # Step 1: split mid-line headings
        # "的挫折。 第一章" → "的挫折。\n第一章"
        mid_line_heads = [
            r'第[一二三四五六七八九十百千零\d]+[章节篇部分]',
            r'introduction|foreword|preface|chapter\s+[IVXLCDM\d]+',
        ]
        for p in mid_line_heads:
            text = re.sub(r'([。？?！!…\)」])\s*(' + p + r')(?=\s*[\n\S])', r'\1\n\2', text, flags=re.I)

        # Step 2: add \n\n before heading at line-start (strict patterns)
        line_start_patterns = [
            r'^第[一二三四五六七八九十百千零\d]+[章节篇部分]',
            r'^\d+\.[ \t\u3000].{5,}',
            r'^\d+[、．].{2,}',
            r'^[一二三四五六七八九十]+[、\.\u3000 \t].{2,}',
            r'^附录[A-Z]',
            r'^(引言|前言|绪论|导论)$',
            r'^第[一二三四五六七八九十百千零\d]+[讲节课]',
            r'^(Part|Section|Chapter)\s+[IVXLCDM\d]',
            r'^(知识点|考点|专题|单元|课时|习题)[一二三四五六七八九十\d]',
            r'^[（\(][一二三四五六七八九十百千零\d]+[）\)]\s*$',
            r'^[（\(][一二三四五六七八九十百千零\d]+[）\)]\s+\S',
        ]
        for pattern in line_start_patterns:
            text = re.sub(r'\n(?!\n)(' + pattern + r')', r'\n\n\1', text, flags=re.MULTILINE)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    @staticmethod
    def _format_docx_table(table) -> str:
        try:
            nsmap = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            html_rows = []

            for row in table.rows:
                html_cells = []
                for cell in row.cells:
                    colspan = 1
                    rowspan = 1
                    try:
                        tc_element = cell._tc
                        tc_pr = tc_element.find('.//w:tcPr', namespaces=nsmap) if hasattr(tc_element, 'find') else None
                        if tc_pr is not None:
                            gs = tc_pr.find('w:gridSpan', namespaces=nsmap)
                            if gs is not None and gs.get('{' + nsmap['w'] + '}val'):
                                colspan = int(gs.get('{' + nsmap['w'] + '}val'))
                            vm = tc_pr.find('w:vMerge', namespaces=nsmap)
                            if vm is not None:
                                rowspan = 2
                    except Exception:
                        pass
                    text = (cell.text or "").strip()
                    attrs = ''
                    if colspan > 1:
                        attrs += f' colspan="{colspan}"'
                    if rowspan > 1:
                        attrs += f' rowspan="{rowspan}"'
                    html_cells.append(f'<td{attrs}>{text}</td>')

                if html_cells:
                    html_rows.append('<tr>' + ''.join(html_cells) + '</tr>')

            if len(html_rows) < 2:
                return ""

            table_html = '<table style="border-collapse:collapse;width:100%">' + ''.join(html_rows) + '</table>'
            return "\n[表格开始]\n" + table_html + "\n[表格结束]"
        except Exception as e:
            logger.warning(f"Word 表格格式化失败，回退纯文本格式: {e}")
            formatted_rows = []
            for row in table.rows:
                cells = [cell.text.strip() if cell.text else "" for cell in row.cells]
                formatted_row = " | ".join(cells)
                if formatted_row.strip():
                    formatted_rows.append(formatted_row)
            if len(formatted_rows) < 2:
                return ""
            return "\n[表格开始]\n" + "\n".join(formatted_rows) + "\n[表格结束]"

    @staticmethod
    def parse_docx(file_path: str, output_dir: str = "/uploads/tables") -> tuple:
        import os
        import zipfile
        import re
        os.makedirs(output_dir, exist_ok=True)
        try:
            from docx import Document
            from docx.table import Table
            all_images_info = []
            doc = Document(file_path)
            image_mapping = {}
            try:
                with zipfile.ZipFile(file_path, 'r') as zip_ref:
                    media_files = [n for n in zip_ref.namelist()
                                   if n.startswith('word/media/') and not n.endswith('/')]
                    for idx, name in enumerate(media_files, 1):
                        try:
                            img_data = zip_ref.read(name)
                            if len(img_data) < 8:
                                continue
                            ext = os.path.splitext(name)[1].lower()
                            if ext not in ['.jpg', '.jpeg', '.png', '.gif', '.bmp']:
                                ext = '.png'
                            img_filename = f"docx_img{idx}{ext}"
                            img_filepath = os.path.join(output_dir, img_filename)
                            with open(img_filepath, 'wb') as f:
                                f.write(img_data)
                            image_mapping[name] = {'path': img_filepath, 'filename': img_filename}
                        except Exception as e:
                            logger.warning(f"DOCX图片读取失败 {name}: {e}")
            except Exception as e:
                logger.warning(f"DOCX图片提取过程出错: {e}")

            text_parts = []
            image_counter = [0]
            total_images = len(image_mapping)
            body = doc.element.body
            for child in body:
                if child.tag.endswith('p'):
                    para_text = []
                    drawings = child.xpath(".//*[local-name()='drawing']")
                    pics = child.xpath(".//*[local-name()='pic']")
                    if drawings or pics:
                        for run in child.iter():
                            if run.tag.endswith('t') and run.text:
                                para_text.append(run.text)
                        text = ''.join(para_text).strip()
                        if text:
                            text_parts.append(text)
                        if image_counter[0] < total_images:
                            image_counter[0] += 1
                            placeholder = f"[IMG_PLACEHOLDER_0_{image_counter[0]}]"
                            text_parts.append(placeholder)
                            media_name = list(image_mapping.keys())[image_counter[0] - 1]
                            all_images_info.append({
                                'placeholder': placeholder,
                                'path': image_mapping[media_name]['path']
                            })
                    else:
                        for run in child.iter():
                            if run.tag.endswith('t') and run.text:
                                para_text.append(run.text)
                        text = ''.join(para_text).strip()
                        if text:
                            text_parts.append(text)
                elif child.tag.endswith('tbl'):
                    table = Table(child)
                    table_text = DocumentParser._format_docx_table(table)
                    if table_text:
                        text_parts.append(table_text)

            full_text = "\n\n".join(text_parts)
            cleaned_text = DocumentParser._clean_text(full_text)
            return cleaned_text, all_images_info
        except Exception as e:
            logger.error(f"Word 文档解析失败: {e}")
            raise

    @staticmethod
    def parse_txt(file_path: str) -> str:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            return DocumentParser._clean_text(content)
        except UnicodeDecodeError:
            with open(file_path, 'r', encoding='gbk') as f:
                content = f.read()
            return DocumentParser._clean_text(content)
        except Exception as e:
            logger.error(f"TXT 文件解析失败: {e}")
            raise

    @staticmethod
    def parse_md(file_path: str) -> str:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        except UnicodeDecodeError:
            with open(file_path, 'r', encoding='gbk') as f:
                return f.read()
        except Exception as e:
            logger.error(f"Markdown 文件解析失败: {e}")
            raise

    @staticmethod
    def _clean_text(text: str) -> str:
        """清洗文本：规范化换行和空格，保留段落结构"""
        if not text:
            return text
        text = text.replace('\x00', '')
        placeholders = []
        for match in re.finditer(r'\[IMG_PLACEHOLDER_\d+_\d+\]', text):
            placeholder = f"__PLACEHOLDER_{len(placeholders)}__"
            placeholders.append((match.start(), match.end(), placeholder, match.group()))
        for start, end, placeholder, original in reversed(placeholders):
            text = text[:start] + placeholder + text[end:]
        text = re.sub(r'\r\n', '\n', text)           # 统一换行符
        text = re.sub(r'\r', '\n', text)
        text = re.sub(r'\n{3,}', '\n\n', text)       # 合并过多空行（3+ → 2）
        text = re.sub(r'[ \t]{2,}', ' ', text)       # 合并连续空格（2+ → 1），保留单个空格
        # 保留原文段落结构：不去除空行，只 strip 首尾
        lines = text.split('\n')
        # 去除每行首尾空白，但保留空行作为段落分隔
        lines = [l.strip() for l in lines]
        # 合并连续空行为单个空行
        result = []
        prev_empty = False
        for line in lines:
            if not line:
                if not prev_empty:
                    result.append('')
                    prev_empty = True
            else:
                result.append(line)
                prev_empty = False
        text = '\n'.join(result).strip()
        text = DocumentParser._separate_headings(text)
        for start, end, placeholder, original in placeholders:
            text = text.replace(placeholder, original)
        return text

    @staticmethod
    def parse_file_from_bytes(file_bytes: bytes, file_type: str, output_dir: str = "/uploads/tables") -> tuple:
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False, suffix=f'.{file_type}') as tmp_file:
            tmp_file.write(file_bytes)
            tmp_path = tmp_file.name
        try:
            return DocumentParser.parse_file(tmp_path, file_type, output_dir)
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except:
                    pass

    @staticmethod
    def parse_pptx(file_path: str) -> str:
        """解析 PPTX 文件，提取所有幻灯片中的文本"""
        try:
            from pptx import Presentation
            prs = Presentation(file_path)
            parts = []
            for i, slide in enumerate(prs.slides, 1):
                slide_texts = []
                for shape in slide.shapes:
                    if shape.has_text_frame:
                        for para in shape.text_frame.paragraphs:
                            t = para.text.strip()
                            if t:
                                slide_texts.append(t)
                    if shape.has_table:
                        table = shape.table
                        for row in table.rows:
                            row_texts = [cell.text.strip() for cell in row.cells]
                            slide_texts.append(' | '.join(row_texts))
                if slide_texts:
                    parts.append(f"[第{i}页]\n" + '\n'.join(slide_texts))
            return '\n\n'.join(parts) if parts else ""
        except ImportError:
            logger.error("python-pptx 未安装，无法解析 PPTX 文件")
            raise
        except Exception as e:
            logger.error(f"PPTX 文件解析失败: {e}")
            raise

    @staticmethod
    def parse_file(file_path: str, file_type: str, output_dir: str = "/uploads/tables") -> tuple:
        if file_type == 'pdf':
            return DocumentParser.parse_pdf(file_path, output_dir)
        elif file_type == 'docx':
            return DocumentParser.parse_docx(file_path, output_dir)
        elif file_type == 'txt':
            return DocumentParser.parse_txt(file_path), []
        elif file_type == 'md':
            return DocumentParser.parse_md(file_path), []
        elif file_type == 'pptx':
            return DocumentParser.parse_pptx(file_path), []
        else:
            raise ValueError(f"不支持的文件类型: {file_type}")


class QuizBankDetector:
    QUIZ_INDICATORS = [
        r'答案[：:]\s*[A-D]',
        r'答案[：:]\s*\d',
        r'正确答案',
        r'^\s*\d+\.\s*[\(（]',
        r'判断题|选择题|填空题|简答题',
        r'请选择|下列|以上都不对',
        r'^\s*\d+[、\.、]\s*[^答]',
        r'答[：:]',
    ]

    CHAPTER_PATTERNS = [
        re.compile(r'^第[一二三四五六七八九十百千零\d]+章\s+(.+)$'),
        re.compile(r'^(毛泽东思想及其历史地位)$'),
        re.compile(r'^(中国特色社会主义理论体系)$'),
        re.compile(r'^(习近平新时代中国特色社会主义思想)$'),
        re.compile(r'^(马克思主义基本原理)$'),
        re.compile(r'^(思想道德与法治)$'),
        re.compile(r'^(中国近现代史纲要)$'),
    ]

    QUESTION_COUNT_THRESHOLD = 2

    @classmethod
    def is_quiz_bank(cls, text: str) -> bool:
        """所有文档统一按题库模式处理"""
        return True

    @classmethod
    def _clean_text(cls, text: str) -> str:
        """预处理文本：规范化换行，去异常符号，保留段落结构"""
        text = text.replace('\x00', '\n').replace('\u0000', '\n')
        text = re.sub(r'\r\n', '\n', text)           # 统一换行
        text = re.sub(r'\r', '\n', text)
        text = re.sub(r'\n{3,}', '\n\n', text)       # 合并过多空行（3+→2）
        # 合并汉字之间的多余空格（不跨行）
        text = re.sub(r'(?<=[\u4e00-\u9fff])[^\S\n]+(?=[\u4e00-\u9fff])', '', text)
        # 合并汉字与数字/字母之间的多余空格（不跨行）
        text = re.sub(r'(?<=[\u4e00-\u9fff])[^\S\n]+(?=[\dA-Za-z])', '', text)
        text = re.sub(r'(?<=[\dA-Za-z])[^\S\n]+(?=[\u4e00-\u9fff])', '', text)
        # 清洗意外多出的符号：行首行尾多余空白、句间多余空格
        text = re.sub(r'[ \t]{2,}', ' ', text)       # 合并连续空格
        # 逐行处理，去除行首尾空白但保留空行作为段落分隔
        lines = text.split('\n')
        lines = [l.strip() for l in lines]
        text = '\n'.join(lines)
        return text

    @classmethod
    def split_into_questions(cls, text: str) -> List[Dict[str, Any]]:
        result = []
        text = cls._clean_text(text)
        lines = text.split('\n')
        current_question = []
        current_chapter = None
        pending_question_with_chapter = None
        in_question = False
        current_question_start_pattern = None

        top_question_pattern = re.compile(r'^(\d+)[、．.](?!\s*\d)(?!\s*$)\s*.{3,}')
        # 扩展 chapter_pattern，匹配题库常见章节名（含 markdown # 前缀和编号前缀）
        quiz_section_suffix = r'(练习题|思考题|简答题|单选题|多选题|判断题|填空题|名词解释|论述题|计算题|案例分析|综合题|问答题|是非题|配对题|排序题)'
        chapter_pattern = re.compile(
            r'^(?:#+\s*)?(?:第[一二三四五六七八九十百千零\d]+[章节篇]|导论$|.*' + quiz_section_suffix + r'\s*$)|'
            r'^[一二三四五六七八九十]+[.．、]\s*' + quiz_section_suffix
        )
        section_header_marker = r'^[一二三四五六七八九十]+[.．、]\s*(单选|多选|判断|简答|填空|论述|计算|名词解释)'
        subitem_patterns = [
            re.compile(r'^[（\(][一二三四五六七八九十\d]+[）\)]'),
            re.compile(r'^[①②③④⑤⑥⑦⑧⑨⑩]+'),
            re.compile(r'^\d+\.\d+'),
            re.compile(r'^[一二三四五六七八九十]+[.．、]'),
        ]
        footer_patterns = [
            re.compile(r'^By:'),
            re.compile(r'^张佳敏'),
            re.compile(r'^任涵'),
            re.compile(r'^[A-Za-z]+[,，]\s*[A-Za-z]+$'),
        ]

        def save_question():
            nonlocal current_question, current_chapter, pending_question_with_chapter
            if current_question:
                filtered_lines = []
                for line in current_question:
                    is_footer = False
                    for pattern in footer_patterns:
                        if pattern.match(line.strip()):
                            is_footer = True
                            break
                    if not is_footer:
                        filtered_lines.append(line)
                content = '\n'.join(filtered_lines).strip()
                if len(content) > 10:
                    result.append({
                        'chapter': pending_question_with_chapter or current_chapter,
                        'content': content
                    })
                current_question = []
                pending_question_with_chapter = None

        def is_subitem(line: str) -> bool:
            for pattern in subitem_patterns:
                if pattern.match(line):
                    return True
            match = re.match(r'^\d+\.\s+', line)
            if match:
                content_after_number = line[match.end():]
                if (('？' in content_after_number or '?' in content_after_number)
                    or any(kw in content_after_number[:10] for kw in ['如何', '什么', '为什么', '怎样', '怎么', '是否', '为啥'])):
                    return False
            return False

        def is_footer(line: str) -> bool:
            for pattern in footer_patterns:
                if pattern.match(line.strip()):
                    return True
            return False

        def is_top_question(line: str) -> bool:
            # 新匹配：纯数字开头紧接着中文（无分隔符），如 "1在布尔逻辑运算中"
            bare_digit_cjk = re.match(r'^(\d+)(?![\d\s\.、．])([\u4e00-\u9fff]{2,})', line)
            if bare_digit_cjk:
                return True

            dot_match = re.match(r'^(\d+)\.\s*', line)
            if dot_match:
                content_after_number = line[dot_match.end():]
                if ('？' in content_after_number or '?' in content_after_number
                    or any(kw in content_after_number[:10] for kw in ['如何', '什么', '为什么', '怎样', '怎么', '是否', '为啥', '认识', '理解'])):
                    return True
                if content_after_number and len(line) > 10:
                    first_char = content_after_number[0]
                    if first_char in ['"', '"', '\u201c', '\u201d', '\u2018', '\u2019', '《']:
                        return True
                if any(kw in content_after_number for kw in ['（了解', '（掌握', '（理解', '（分析']):
                    return True
                if content_after_number.startswith('20') or content_after_number.startswith('19'):
                    return True

            plain_digit_match = re.match(r'^(\d+)(?![、．.])', line)
            if plain_digit_match:
                content_after_number = line[plain_digit_match.end():]
                if ('？' in content_after_number or '?' in content_after_number
                    or any(kw in content_after_number[:10] for kw in ['如何', '什么', '为什么', '怎样', '怎么', '是否', '为啥', '认识', '理解'])):
                    return True
                if content_after_number and len(line) > 10:
                    first_char = content_after_number[0]
                    if first_char in ['"', '"', '\u201c', '\u201d', '\u2018', '\u2019', '《']:
                        return True

            if top_question_pattern.match(line):
                return True
            simple_match = re.match(r'^(\d+)[、．.]', line)
            if simple_match and not is_subitem(line):
                return True
            return False

        def has_same_start_pattern(line1: str, line2: str) -> bool:
            if not line1 or not line2:
                return False
            patterns_to_check = [
                (r'^第[一二三四五六七八九十百千零\d]+[章节篇]', r'^第[一二三四五六七八九十百千零\d]+[章节篇]'),
                (r'^\d+[、．]', r'^\d+[、．]'),
                (r'^\d+\.\s*', r'^\d+\.\s*'),
                (r'^\d+\s+', r'^\d+\s+'),
                (r'^[（\(][一二三四五六七八九十\d]+[）\)]', r'^[（\(][一二三四五六七八九十\d]+[）\)]'),
                (r'^[①②③④⑤⑥⑦⑧⑨⑩]+', r'^[①②③④⑤⑥⑦⑧⑨⑩]+'),
            ]
            for pattern1, pattern2 in patterns_to_check:
                if re.match(pattern1, line1) and re.match(pattern2, line2):
                    return True
            return False

        for line in lines:
            line_stripped = line.strip()
            if not line_stripped:
                # 空行：在题目内保留为段落分隔，不在题目内则跳过
                if current_question:
                    current_question.append('')
                continue
            if is_footer(line_stripped):
                continue
            chapter_match = chapter_pattern.match(line_stripped)
            if chapter_match:
                save_question()
                current_chapter = re.sub(r'^#+\s*', '', line_stripped)
                continue

            prev_was_new_question = False
            if is_top_question(line_stripped):
                if (current_question and current_question_start_pattern
                    and prev_was_new_question
                    and has_same_start_pattern(current_question_start_pattern, line_stripped)):
                    current_question.append(line_stripped)
                else:
                    save_question()
                    if current_chapter:
                        pending_question_with_chapter = current_chapter
                    current_question = [line_stripped]
                    in_question = True
                    current_question_start_pattern = line_stripped
                    prev_was_new_question = True
            elif in_question:
                if current_question and current_question_start_pattern:
                    first_line = current_question[0]
                    if has_same_start_pattern(first_line, line_stripped):
                        if ('？' in line_stripped or '?' in line_stripped
                            or any(kw in line_stripped[:15] for kw in ['如何', '什么', '为什么', '怎样', '怎么', '是否', '为啥', '认识', '理解', '把握'])):
                            if prev_was_new_question:
                                current_question.append(line_stripped)
                            else:
                                save_question()
                                if current_chapter:
                                    pending_question_with_chapter = current_chapter
                                current_question = [line_stripped]
                                current_question_start_pattern = line_stripped
                                prev_was_new_question = True
                        else:
                            current_question.append(line_stripped)
                    else:
                        current_question.append(line_stripped)
                        prev_was_new_question = False
                else:
                    current_question.append(line_stripped)
                    prev_was_new_question = False
            else:
                # 非题目、非章节、非子项：作为前导内容收集（可能在第一条题目之前）
                current_question.append(line_stripped)

        save_question()
        return result


class StructureAnalyzer:
    STRICT_HEADER_PATTERNS = [
        (re.compile(r'^#+\s+(.+)$'), 'md_header', 1),
        (re.compile(r'^第[一二三四五六七八九十百千零]+[章节篇部分]\s*$'), 'chapter_only', 1),
        (re.compile(r'^第[一二三四五六七八九十百千零\d]+[章节篇部分]\s+[^\s]'), 'chapter_with_title', 1),
        (re.compile(r'^第\d+[章节篇部分]\s*$'), 'chapter_only', 1),
        (re.compile(r'^第\d+[章节篇部分]\s+[^\s]'), 'chapter_with_title', 1),
        (re.compile(r'^\d+\.\s+(.{5,})$'), 'number_dot', 1),
        (re.compile(r'^\d+\.\d+\s+(.{5,})$'), 'number_dot_sub', 2),
        (re.compile(r'^[一二三四五六七八九十]+[、\.\s]\s*(.{5,})$'), 'chinese_number', 1),
        (re.compile(r'^[附录][A-Z][^题]?'), 'appendix', 1),
        (re.compile(r'^(引言|前言|绪论|导论|第一章|第二章|第三章|第四章|第五章|第六章|第七章|第八章|第九章|第十章|第十一章|第十二章|第十三章|第十四章|第十五章)$'), 'common_chapter', 1),
        (re.compile(r'^(第一节|第二节|第三节|第四节|第五节|第六节|第七节|第八节|第九节|第十节)$'), 'common_section', 2),
        (re.compile(r'^导论$'), 'common_chapter', 1),
        (re.compile(r'^[A-Z\s]{5,}$'), 'all_caps', 1),
        (re.compile(r'^\d+[、．.](.{2,})$'), 'short_numbered', 1),
        (re.compile(r'^[一二三四五六七八九十]+[、．](.{2,})$'), 'short_chinese', 1),
        (re.compile(r'^[（\(][一二三四五六七八九十百千零\d]+[）\)]\s*$'), 'paren_number', 1),
        (re.compile(r'^[（\(][一二三四五六七八九十百千零\d]+[）\)]\s+'), 'paren_number_title', 1),
        (re.compile(r'^(知识点|考点|专题|单元|课时|习题)[一二三四五六七八九十\d]'), 'edu_pattern', 1),
        (re.compile(r'^第[一二三四五六七八九十百千零\d]+[讲节课]'), 'lesson', 1),
        (re.compile(r'^(Part|Section|Chapter)\s+[IVXLCDM\d]+', re.I), 'english_part', 1),
    ]

    RELAXED_HEADER_PATTERNS = []

    @staticmethod
    def _is_likely_title(para: str, paragraphs: List[str], idx: int) -> bool:
        text = para.strip()
        if not text:
            return False
        if len(text) > 50:
            return False
        if len(text) < 2:
            return False
        if text.endswith(('。', '？', '！', '…', '：', ';', '；')):
            return False
        non_header_patterns = [
            r'^[（\(][^）\)]+[）\)]',
            r'^[①②③④⑤⑥⑦⑧⑨⑩]',
            r'^\d+\.\d+',
            r'^[A-Za-z]+[,，]\s*[A-Za-z]+',
            r'^(是|有|在|从|把|被|将|让|以|可|能|应该|必须|可以|会|要|没有)',
            r'^[，、；：]',
            r'^\([^）\)]+\)$',
            r'^\d+[种个类项点条位元个只次]',
            r'^[一二三四五六七八九十]+[是指为]',
            r'^[首先其次再次最后]',
            r'^第[一二三四五六七八九十\d]+[种个类项位]',
            r'^[一两]方面',
            r'^[一两]则',
        ]
        for p in non_header_patterns:
            if re.match(p, text):
                return False
        if re.match(r'^\d+$', text):
            return False
        if len(text) <= 3:
            return False
        if idx + 1 >= len(paragraphs):
            return False
        next_text = paragraphs[idx + 1].strip()
        if not next_text:
            return False
        if len(next_text) <= len(text) * 1.2 or len(next_text) <= 30:
            return False
        if any(p in text for p in ['。', '？', '！', '，', '；']):
            return False
        if len(text) > 40:
            return False
        content_starters = ['这是', '那是', '这些', '那些', '这个', '那个',
                            '这里', '那里', '然后', '接着', '此外', '另外',
                            '比如', '例如', '可以', '需要', '我们', '他们',
                            '它们', '大家', '所谓', '包括', '分为', '是指',
                            '即', '就是', '所谓', '也就是说',
                            '首先', '其次', '再次', '最后',
                            '一方面', '另一方面', '一是', '二是', '三是',
                            '换言之', '换句话说', '总的来说', '综上所述',
                            '由此可见', '事实上', '实际上', '本质上']
        for starter in content_starters:
            if text.startswith(starter):
                return False
        return True

    @staticmethod
    def analyze_structure(text: str, file_type: str = 'txt', use_ai_fallback: bool = True) -> List[ParsedChapter]:
        if not text.strip():
            return []
        if QuizBankDetector.is_quiz_bank(text):
            logger.info("检测到题库类型文档，使用题库分析")
            return StructureAnalyzer._analyze_quiz_bank(text)
        chapters = []
        if file_type == 'md':
            chapters = StructureAnalyzer._analyze_markdown(text)
        else:
            chapters = StructureAnalyzer._analyze_generic(text)
        if not chapters or len(chapters) == 1:
            if use_ai_fallback:
                logger.info("规则分析效果不佳，尝试使用 AI 分析...")
                chapters = StructureAnalyzer._try_ai_analysis(text)
        if not chapters:
            chapters = StructureAnalyzer._split_by_paragraphs(text)
        return chapters

    @staticmethod
    def _analyze_quiz_bank(text: str) -> List[ParsedChapter]:
        questions = QuizBankDetector.split_into_questions(text)
        chapters = []
        start_offset = 0
        current_chapter_title = None
        current_chapter_content = []
        chapter_counter = 0
        first_question_idx = 0

        def save_chapter(title, content_parts, insert_at=None):
            """在指定位置插入章节条目"""
            content = "\n\n".join(content_parts) if content_parts else ""
            ch = ParsedChapter(
                title=title, content=content,
                level=1, order_index=0,
                start_offset=0, end_offset=len(content),
            )
            if insert_at is not None and insert_at < len(chapters):
                chapters.insert(insert_at, ch)
                # Re-order
                for ci, c in enumerate(chapters):
                    c.order_index = ci
            else:
                ch.order_index = len(chapters)
                chapters.append(ch)

        for i, q in enumerate(questions):
            content = q['content']
            chapter_title = q.get('chapter')
            if chapter_title and chapter_title != current_chapter_title:
                if current_chapter_title is not None and current_chapter_content:
                    save_chapter(current_chapter_title, current_chapter_content, first_question_idx)
                current_chapter_title = chapter_title
                current_chapter_content = []
                chapter_counter = 0
                first_question_idx = len(chapters)
            chapter_counter += 1
            current_chapter_content.append(content)
            first_line = content.split('\n')[0][:30] if content else ""
            title = f"第{chapter_counter}题" + (f": {first_line}..." if first_line else "")
            chapters.append(ParsedChapter(
                title=title, content=content,
                level=2 if chapter_title else 1,
                order_index=len(chapters),
                start_offset=start_offset,
                end_offset=start_offset + len(content)))
            start_offset += len(content)

        if current_chapter_title is not None and current_chapter_content:
            save_chapter(current_chapter_title, current_chapter_content, first_question_idx)

        if not any(ch.level == 1 for ch in chapters):
            words = text.split('\n\n')
            for i, para in enumerate(words):
                if re.match(r'^(第[一二三四五六七八九十百千零\d]+[章节篇]|导论)', para.strip()):
                    chapters.insert(i, ParsedChapter(
                        title=para.strip(), content="",
                        level=1, order_index=i,
                        start_offset=0, end_offset=0))
        return chapters

    @staticmethod
    async def _try_ai_analysis_async(text: str) -> List[ParsedChapter]:
        try:
            from app.services.ai_document_analyzer import ai_document_analyzer
            result = await ai_document_analyzer.analyze_document(text)
            chapters = []
            start_offset = 0
            for i, section in enumerate(result.sections):
                end_offset = start_offset + len(section.content)
                chapters.append(ParsedChapter(
                    title=section.title, content=section.content,
                    level=section.level, order_index=i,
                    start_offset=start_offset, end_offset=end_offset))
                start_offset = end_offset
            return chapters
        except ImportError:
            return []
        except Exception as e:
            logger.error(f"AI 分析失败: {e}")
            return []

    @staticmethod
    def _try_ai_analysis(text: str) -> List[ParsedChapter]:
        return []

    @staticmethod
    def _analyze_markdown(text: str) -> List[ParsedChapter]:
        lines = text.split('\n')
        chapters = []
        current_content = []
        current_title = None
        current_level = 1
        start_offset = 0
        for line in lines:
            line = line.rstrip()
            header_match = re.match(r'^(#{1,3})\s+(.+)$', line)
            if header_match:
                if current_title is not None and current_content:
                    content = '\n'.join(current_content).strip()
                    if content:
                        end_offset = start_offset + len(content)
                        chapters.append(ParsedChapter(
                            title=current_title, content=content,
                            level=current_level, order_index=len(chapters),
                            start_offset=start_offset, end_offset=end_offset))
                        start_offset = end_offset
                current_title = header_match.group(2)
                current_level = len(header_match.group(1))
                current_content = []
            else:
                if current_title is not None:
                    current_content.append(line)
                elif line.strip():
                    current_title = "正文"
                    current_level = 1
                    current_content = [line]
        if current_title is not None and current_content:
            content = '\n'.join(current_content).strip()
            if content:
                end_offset = start_offset + len(content)
                chapters.append(ParsedChapter(
                    title=current_title, content=content,
                    level=current_level, order_index=len(chapters),
                    start_offset=start_offset, end_offset=end_offset))
        return chapters

    @staticmethod
    def _analyze_generic(text: str) -> List[ParsedChapter]:
        paragraphs = text.split('\n\n')
        chapters = []
        current_title = "正文"
        current_content = []
        current_level = 1
        start_offset = 0
        for idx, para in enumerate(paragraphs):
            para = para.strip()
            if not para:
                continue
            matched = False
            matched_level = 1
            for pattern, pattern_type, level in StructureAnalyzer.STRICT_HEADER_PATTERNS:
                match = pattern.match(para)
                if match:
                    if current_content:
                        content = '\n\n'.join(current_content).strip()
                        if content:
                            end_offset = start_offset + len(content)
                            chapters.append(ParsedChapter(
                                title=current_title, content=content,
                                level=current_level, order_index=len(chapters),
                                start_offset=start_offset, end_offset=end_offset))
                            start_offset = end_offset
                    if match.groups():
                        title = match.group(1).strip()
                    else:
                        title = para.strip()
                    if pattern_type == 'all_caps':
                        title = para.strip()
                    elif pattern_type == 'common_chapter':
                        title = para.strip()
                    elif pattern_type == 'common_section':
                        title = para.strip()
                        level = 2
                    current_title = title if title else "章节"
                    current_level = level
                    current_content = []
                    matched = True
                    break
            if not matched:
                header_match = re.match(r'^(#{1,3})\s+(.+)$', para)
                if header_match:
                    if current_content:
                        content = '\n\n'.join(current_content).strip()
                        if content:
                            end_offset = start_offset + len(content)
                            chapters.append(ParsedChapter(
                                title=current_title, content=content,
                                level=current_level, order_index=len(chapters),
                                start_offset=start_offset, end_offset=end_offset))
                            start_offset = end_offset
                    current_title = header_match.group(2).strip()
                    current_level = len(header_match.group(1))
                    current_content = []
                    matched = True
            if not matched:
                if StructureAnalyzer._is_likely_title(para, paragraphs, idx):
                    if current_content:
                        content = '\n\n'.join(current_content).strip()
                        if content:
                            end_offset = start_offset + len(content)
                            chapters.append(ParsedChapter(
                                title=current_title, content=content,
                                level=current_level, order_index=len(chapters),
                                start_offset=start_offset, end_offset=end_offset))
                            start_offset = end_offset
                    current_title = para
                    current_level = 2
                    current_content = []
                    matched = True
            if not matched:
                current_content.append(para)
        if current_content:
            content = '\n\n'.join(current_content).strip()
            if content:
                end_offset = start_offset + len(content)
                chapters.append(ParsedChapter(
                    title=current_title, content=content,
                    level=current_level, order_index=len(chapters),
                    start_offset=start_offset, end_offset=end_offset))
        return chapters

    @staticmethod
    def _split_by_paragraphs(text: str, max_paragraphs: int = 10) -> List[ParsedChapter]:
        paragraphs = text.split('\n\n')
        chapters = []
        if not paragraphs:
            return chapters
        chunk_size = max(1, len(paragraphs) // max_paragraphs + 1)
        for i in range(0, len(paragraphs), chunk_size):
            chunk = paragraphs[i:i + chunk_size]
            content = '\n\n'.join(chunk).strip()
            if content:
                first_line = chunk[0][:50] if chunk else "章节"
                title = f"{first_line}..." if len(chunk[0]) > 50 else first_line
                chapters.append(ParsedChapter(
                    title=title, content=content, level=1,
                    order_index=len(chapters),
                    start_offset=0, end_offset=len(content)))
        return chapters