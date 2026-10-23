import logging
from mcp.server.fastmcp import FastMCP

logger = logging.getLogger(__name__)

mcp = FastMCP("lingshu-mcp-server")

from app.mcp.tools.dispatch_tool_agent import dispatch_tool_agent
from app.mcp.tools.search_knowledge import search_knowledge
from app.mcp.tools.get_document import get_document
from app.mcp.tools.get_flashcards import get_flashcards
from app.mcp.tools.get_user_stats import get_user_stats
from app.mcp.tools.web_search import web_search
from app.mcp.tools.generate_pdf import generate_pdf
from app.mcp.tools.generate_docx import generate_docx
from app.mcp.tools.generate_pptx import generate_pptx
from app.mcp.tools.generate_image import generate_image
from app.mcp.tools.image_search import image_search
from app.mcp.tools.convert_document import convert_document
from app.mcp.tools.graph_qa import graph_qa
from app.mcp.tools.pptx_pipeline import create_pptx_project as pptx_create, save_svg_page as pptx_save_svg, save_notes as pptx_save_notes, export_pptx as pptx_export, save_pptx_image as pptx_save_image, read_project_file as pptx_read_file, read_summary as pptx_read_summary, save_project_file as pptx_save_file, read_skill_reference as pptx_read_ref, read_svg_page as pptx_read_svg
from app.mcp.tools.chart_antv import CHART_TOOLS
mcp.tool(name="dispatch_tool_agent")(dispatch_tool_agent)
mcp.tool(name="search_knowledge")(search_knowledge)
mcp.tool(name="get_document")(get_document)
mcp.tool(name="get_flashcards")(get_flashcards)
mcp.tool(name="get_user_stats")(get_user_stats)
mcp.tool(name="web_search")(web_search)
mcp.tool(name="generate_pdf")(generate_pdf)
mcp.tool(name="generate_docx")(generate_docx)
mcp.tool(name="generate_pptx")(generate_pptx)
mcp.tool(name="generate_image")(generate_image)
mcp.tool(name="image_search")(image_search)
mcp.tool(name="convert_document")(convert_document)
mcp.tool(name="graph_qa")(graph_qa)
mcp.tool(name="create_pptx_project")(pptx_create)
mcp.tool(name="save_svg_page")(pptx_save_svg)
mcp.tool(name="save_notes")(pptx_save_notes)
mcp.tool(name="ppt_export")(pptx_export)
mcp.tool(name="save_pptx_image")(pptx_save_image)
mcp.tool(name="read_project_file")(pptx_read_file)
mcp.tool(name="read_summary")(pptx_read_summary)
mcp.tool(name="save_project_file")(pptx_save_file)
mcp.tool(name="read_skill_reference")(pptx_read_ref)
mcp.tool(name="read_svg_page")(pptx_read_svg)
# 注册 AntV 图表工具
for _name, _info in CHART_TOOLS.items():
    mcp.tool(name=_name, description=_info["description"])(_info["func"])

def start_server():
    import sys
    import subprocess
    proc = subprocess.Popen(
        [sys.executable, "-m", "app.mcp.server"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return proc


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    mcp.run(transport="stdio")
