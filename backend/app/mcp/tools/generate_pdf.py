import os
import re
import logging
import tempfile
from pathlib import Path
from typing import Dict, Any, Optional

import httpx

logger = logging.getLogger(__name__)

_OUTPUT_BASE = Path(__file__).resolve().parent.parent.parent / "_output"
_OUTPUT_BASE.mkdir(parents=True, exist_ok=True)

_API_IMAGE_PREFIX = "/api/v1/image/output/"

_FONT_CACHE = None

_IMAGE_PATTERN = re.compile(r'!\[([^\]]*)\]\(([^)]+)\)')


async def _resolve_image_src(src: str) -> Optional[str]:
    """将图片源（远程 URL、API 路径或本地路径）解析为临时文件路径"""
    if src.startswith(('http://', 'https://')):
        return await _download_image(src)
    if src.startswith('file:///'):
        src = src[8:]
    if src.startswith(_API_IMAGE_PREFIX):
        local_path = (_OUTPUT_BASE / src[len(_API_IMAGE_PREFIX):]).resolve()
        if local_path.exists():
            return str(local_path)
    p = Path(src)
    if p.exists():
        return str(p)
    return None


def _find_chinese_font() -> str:
    global _FONT_CACHE
    if _FONT_CACHE:
        return _FONT_CACHE
    candidates = [
        os.path.join(os.path.dirname(__file__), '..', '..', 'static', 'fonts', 'NotoSansSC-Regular.ttf'),
        os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts', 'simhei.ttf'),
        os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts', 'msyh.ttc'),
        os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts', 'simsun.ttc'),
    ]
    for fp in candidates:
        if os.path.exists(fp):
            _FONT_CACHE = fp
            return fp
    _FONT_CACHE = ""
    return ""


def _strip_markdown(text: str) -> str:
    text = re.sub(r'\*\*\*(.+?)\*\*\*', r'\1', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'\*(.+?)\*', r'\1', text)
    text = re.sub(r'^[\*\-]\s+', '', text, flags=re.MULTILINE)
    text = text.replace('*', '')
    text = re.sub(r'`(.+?)`', r'\1', text)
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    text = text.replace('\u2003', '  ').replace('\u00a0', ' ')
    text = _IMAGE_PATTERN.sub(r'[图片: \1]', text)
    return text


async def _download_image(url: str) -> Optional[str]:
    """下载远程图片到临时文件，返回路径"""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            suffix = Path(url.split('?')[0]).suffix or '.png'
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            tmp.write(resp.content)
            tmp.close()
            return tmp.name
    except Exception as e:
        logger.warning(f"图片下载失败 {url}: {e}")
        return None


async def generate_pdf(params: Dict[str, Any]) -> str:
    """将 Markdown 文本内容生成为 PDF 文件，支持嵌入远程图片。

    Args:
        params: {
            "title": "文档标题",
            "content": "Markdown 格式的正文内容（支持 ![alt](url) 图片）",
            "filename": "可选，输出文件名（不含扩展名）"
        }
    Returns:
        生成的 PDF 文件路径
    """
    from fpdf import FPDF

    title = params.get("title", "文档")
    content = params.get("content", "")
    filename = params.get("filename", re.sub(r'[\/\\:*?"<>|]', '_', title))

    output_dir = _OUTPUT_BASE
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{filename}.pdf"

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    font_path = _find_chinese_font()
    has_cn = bool(font_path)
    if has_cn:
        pdf.add_font('CNSans', '', font_path, uni=True)
        pdf.set_font('CNSans', size=14)
    else:
        pdf.set_font("Helvetica", size=14)

    pdf.cell(0, 10, title, ln=True, align='C')
    pdf.ln(4)

    lines = content.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        try:
            # 检测图片行
            img_match = _IMAGE_PATTERN.search(stripped)
            if img_match:
                alt_text = img_match.group(1)
                img_src = img_match.group(2)
                img_path = await _resolve_image_src(img_src)
                if img_path:
                    is_temp = img_src.startswith(('http://', 'https://'))
                    try:
                        pdf.image(img_path, w=160)
                        pdf.ln(4)
                    except Exception as e:
                        logger.warning(f"PDF 嵌入图片失败: {e}")
                        pdf.multi_cell(0, 6, f"[图片: {alt_text}]")
                    finally:
                        if is_temp:
                            os.unlink(img_path)
                else:
                    pdf.multi_cell(0, 6, f"[图片: {alt_text}]")
                i += 1
                continue

            if not stripped:
                pdf.ln(2)
                i += 1
                continue

            if stripped.startswith('#'):
                level = len(stripped.split(' ')[0])
                text = stripped.lstrip('#').strip()
                if has_cn:
                    pdf.set_font('CNSans', size={1: 16, 2: 14, 3: 12}.get(level, 12))
                else:
                    pdf.set_font("Helvetica", size={1: 16, 2: 14, 3: 12}.get(level, 12))
                pdf.multi_cell(0, 8, text)
                pdf.ln(2)
                if has_cn:
                    pdf.set_font('CNSans', size=11)
                else:
                    pdf.set_font("Helvetica", size=11)

            elif stripped.startswith('|') and stripped.endswith('|'):
                sep_line = lines[i + 1].strip() if i + 1 < len(lines) else ''
                if re.match(r'^\|[-\s:|]+\|$', sep_line):
                    header = [c.strip() for c in stripped.strip('|').split('|')]
                    rows = []
                    j = i + 2
                    while j < len(lines):
                        rl = lines[j].strip()
                        if rl.startswith('|') and rl.endswith('|'):
                            cells = [c.strip() for c in rl.strip('|').split('|')]
                            rows.append(cells)
                            j += 1
                        else:
                            break
                    col_w = max(180 // max(len(header), 1), 15)
                    cfg = ('CNSans', 9) if has_cn else ("Helvetica", 9)
                    pdf.set_font(cfg[0], 'B', size=cfg[1])
                    for ci, h in enumerate(header):
                        pdf.cell(col_w, 7, h[:int(col_w/2)], border=1, align='C')
                    pdf.ln()
                    pdf.set_font(cfg[0], size=cfg[1])
                    for row in rows:
                        for ci, cell_text in enumerate(row):
                            pdf.cell(col_w, 7, cell_text[:int(col_w/2)], border=1, align='C')
                        pdf.ln()
                    pdf.ln(3)
                    if has_cn:
                        pdf.set_font('CNSans', size=11)
                    else:
                        pdf.set_font("Helvetica", size=11)
                    i = j
                    continue
                else:
                    pdf.multi_cell(0, 6, _strip_markdown(stripped))
            else:
                pdf.multi_cell(0, 6, _strip_markdown(stripped))
        except Exception as e:
            logger.warning(f"PDF 渲染跳过第{i+1}行: {str(e)[:60]}")
        i += 1

    pdf.output(str(output_path))
    logger.info(f"PDF 已生成: {output_path}")
    return str(output_path)
