"""@antv/mcp-server-chart 图表生成包装器（带 matplotlib 自动 fallback）

直接调用 AntV 图表渲染 API（与 @antv/mcp-server-chart 相同），
无需启动独立 MCP 子进程，零额外依赖。

当 AntV 公共 API 返回服务端错误（如 datetime is not defined）时，
自动 fallback 到 matplotlib 本地生成图表，无需任何外部服务。

支持 VIS_REQUEST_SERVER 环境变量切换图表渲染服务地址。
设置为私有部署的 gpt-vis-api 地址即可使用自建服务：
  VIS_REQUEST_SERVER=http://localhost:3100/generate
"""
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Optional

import httpx

from app.mcp.tools.chart_matplotlib import CHART_TOOLS as MPL_TOOLS, _OUTPUT_DIR
logger = logging.getLogger(__name__)

# 图表渲染服务地址
# 默认使用 AntV 公共 API；可通过 VIS_REQUEST_SERVER 环境变量切换到私有部署
VIS_API = os.environ.get("VIS_REQUEST_SERVER", "https://antv-studio.alipay.com/api/gpt-vis")


# ─── AntV API 调用 ───

async def _try_antv(chart_type: str, **kwargs) -> Optional[str]:
    """尝试调用 AntV API 生成图表，失败返回 None"""
    payload = {
        "type": chart_type,
        **kwargs,
        "source": "chart-visualization-skills",
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(VIS_API, json=payload)
            data = resp.json()
        if not data.get("success"):
            err = data.get("errorMessage", "图表生成失败")
            if "datetime" in err:
                logger.warning(f"AntV API 服务端错误 (datetime): {err}")
                return None
            logger.warning(f"AntV API 返回失败: {err}")
            return None
        url = data.get("url") or data.get("resultObj", "")
        return url if isinstance(url, str) else json.dumps(url, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"AntV API 调用异常: {e}")
        return None


async def _render_chart(chart_type: str, **kwargs) -> str:
    """调用图表渲染 API 生成图表，自动 fallback 到 matplotlib

    优先级:
      1. AntV API（或 VIS_REQUEST_SERVER 指定的私有服务）
      2. matplotlib 本地生成（零外部依赖）

    AntV 返回的图片会下载到本地 _output/charts/ 目录，
    赋予有意义的文件名（如 grouped_bar_xxx.png）。
    """
    # 1) AntV API
    antv_result = await _try_antv(chart_type, **kwargs)
    if antv_result is not None:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(antv_result)
                if resp.status_code == 200:
                    prefix = chart_type
                    filename = f"{prefix}_{uuid.uuid4().hex[:12]}.png"
                    filepath = _OUTPUT_DIR / filename
                    filepath.write_bytes(resp.content)
                    local_url = f"/api/v1/image/output/charts/{filename}"
                    logger.info(f"AntV 图片已保存到本地: {filepath} -> {local_url}")
                    return local_url
        except Exception as e:
            logger.warning(f"AntV 图片下载到本地失败，返回原始 URL: {e}")
        return antv_result

    # 2) Fallback to matplotlib
    logger.info(f"AntV API 不可用，自动 fallback 到 matplotlib 本地生成 ({chart_type})")
    func_name = f"generate_{chart_type}_chart"
    mpl_func = MPL_TOOLS.get(func_name, {}).get("func")
    if mpl_func:
        try:
            return await mpl_func(**kwargs)
        except Exception as e:
            raise RuntimeError(f"matplotlib 图表生成也失败: {e}")
    raise RuntimeError(f"不支持的图表类型: {chart_type}，且无 matplotlib fallback")


# ─── 图表工具函数 ───

async def generate_line_chart(data: list[dict], xField: str = "", yField: str = "", title: str = "",
                                seriesField: str = "", **kwargs) -> str:
    """生成折线图，用于展示数据随时间或连续变量的趋势"""
    return await _render_chart("line", data=data, xField=xField, yField=yField,
                                title=title, seriesField=seriesField, **kwargs)


async def generate_bar_chart(data: list[dict], xField: str = "", yField: str = "", title: str = "",
                               seriesField: str = "", **kwargs) -> str:
    """生成柱状图，用于比较不同分类的值"""
    return await _render_chart("bar", data=data, xField=xField, yField=yField,
                                title=title, seriesField=seriesField, **kwargs)


async def generate_column_chart(data: list[dict], xField: str = "", yField: str = "", title: str = "",
                                  seriesField: str = "", **kwargs) -> str:
    """生成条形图，用于垂直比较不同分类的值"""
    return await _render_chart("column", data=data, xField=xField, yField=yField,
                                title=title, seriesField=seriesField, **kwargs)


async def generate_pie_chart(data: list[dict], xField: str = "", yField: str = "", title: str = "",
                               seriesField: str = "", **kwargs) -> str:
    """生成饼图，用于展示数据占比"""
    return await _render_chart("pie", data=data, xField=xField, yField=yField,
                                title=title, seriesField=seriesField, **kwargs)


async def generate_area_chart(data: list[dict], xField: str = "", yField: str = "", title: str = "",
                                seriesField: str = "", **kwargs) -> str:
    """生成面积图，用于展示数据在连续变量下的趋势和总量"""
    return await _render_chart("area", data=data, xField=xField, yField=yField,
                                title=title, seriesField=seriesField, **kwargs)


async def generate_radar_chart(data: list[dict], xField: str = "", yField: str = "", title: str = "",
                                 seriesField: str = "", **kwargs) -> str:
    """生成雷达图，用于展示多维数据的综合表现"""
    return await _render_chart("radar", data=data, xField=xField, yField=yField,
                                title=title, seriesField=seriesField, **kwargs)


async def generate_scatter_chart(data: list[dict], xField: str = "", yField: str = "", title: str = "",
                                   seriesField: str = "", **kwargs) -> str:
    """生成散点图，用于展示两个变量之间的关系"""
    return await _render_chart("scatter", data=data, xField=xField, yField=yField,
                                title=title, seriesField=seriesField, **kwargs)


async def generate_funnel_chart(data: list[dict], xField: str = "", yField: str = "", title: str = "",
                                  **kwargs) -> str:
    """生成漏斗图，用于展示各阶段的数据流失"""
    return await _render_chart("funnel", data=data, xField=xField, yField=yField, title=title, **kwargs)


async def generate_heatmap_chart(data: list[dict], xField: str = "", yField: str = "", title: str = "",
                                   seriesField: str = "", **kwargs) -> str:
    """生成热力图，用于展示数据的密集程度和分布"""
    return await _render_chart("heatmap", data=data, xField=xField, yField=yField,
                                title=title, seriesField=seriesField, **kwargs)


async def generate_histogram_chart(data: list[dict], xField: str = "", title: str = "", **kwargs) -> str:
    """生成直方图，用于展示数据分布"""
    return await _render_chart("histogram", data=data, xField=xField, title=title, **kwargs)


async def generate_boxplot_chart(data: list[dict], xField: str = "", yField: str = "", title: str = "",
                                   **kwargs) -> str:
    """生成箱线图，用于展示数据分布的中位数、四分位数和异常值"""
    return await _render_chart("boxplot", data=data, xField=xField, yField=yField, title=title, **kwargs)


async def generate_dual_axes_chart(data: list[dict], xField: str = "", yFields: list = None,
                                     title: str = "", **kwargs) -> str:
    """生成双轴图，用于展示两个不同单位的变量关系"""
    return await _render_chart("dual_axes", data=data, xField=xField, yFields=yFields or [], title=title, **kwargs)


async def generate_waterfall_chart(data: list[dict], xField: str = "", yField: str = "", title: str = "",
                                     **kwargs) -> str:
    """生成瀑布图，用于展示数据的逐步变化过程"""
    return await _render_chart("waterfall", data=data, xField=xField, yField=yField, title=title, **kwargs)


async def generate_grouped_bar_chart(data: list[dict], xField: str = "", yField: str = "", title: str = "",
                                      seriesField: str = "", **kwargs) -> str:
    """生成分组柱状图，通过 seriesField 在分类轴并列展示多个系列"""
    return await _render_chart("grouped_bar", data=data, xField=xField, yField=yField,
                                title=title, seriesField=seriesField, **kwargs)


async def generate_stacked_bar_chart(data: list[dict], xField: str = "", yField: str = "", title: str = "",
                                      seriesField: str = "", **kwargs) -> str:
    """生成堆叠柱状图，通过 seriesField 在分类轴堆叠展示多个系列"""
    return await _render_chart("stacked_bar", data=data, xField=xField, yField=yField,
                                title=title, seriesField=seriesField, **kwargs)


CHART_TOOLS = {
    "generate_line_chart": {"func": generate_line_chart, "description": "生成折线图，用于展示数据随时间或连续变量的趋势"},
    "generate_bar_chart": {"func": generate_bar_chart, "description": "生成柱状图，用于比较不同分类的值"},
    "generate_column_chart": {"func": generate_column_chart, "description": "生成条形图，用于垂直比较不同分类的值"},
    "generate_pie_chart": {"func": generate_pie_chart, "description": "生成饼图，用于展示数据占比"},
    "generate_area_chart": {"func": generate_area_chart, "description": "生成面积图，用于展示数据在连续变量下的趋势和总量"},
    "generate_radar_chart": {"func": generate_radar_chart, "description": "生成雷达图，用于展示多维数据的综合表现"},
    "generate_scatter_chart": {"func": generate_scatter_chart, "description": "生成散点图，用于展示两个变量之间的关系"},
    "generate_funnel_chart": {"func": generate_funnel_chart, "description": "生成漏斗图，用于展示各阶段的数据流失"},
    "generate_heatmap_chart": {"func": generate_heatmap_chart, "description": "生成热力图，用于展示数据的密集程度和分布"},
    "generate_histogram_chart": {"func": generate_histogram_chart, "description": "生成直方图，用于展示数据分布"},
    "generate_boxplot_chart": {"func": generate_boxplot_chart, "description": "生成箱线图，用于展示数据分布的中位数、四分位数和异常值"},
    "generate_dual_axes_chart": {"func": generate_dual_axes_chart, "description": "生成双轴图，用于展示两个不同单位的变量关系"},
    "generate_waterfall_chart": {"func": generate_waterfall_chart, "description": "生成瀑布图，用于展示数据的逐步变化过程"},
    "generate_grouped_bar_chart": {"func": generate_grouped_bar_chart, "description": "生成分组柱状图，通过 seriesField 在分类轴并列展示多个系列，适合多产品/多维度对比"},
    "generate_stacked_bar_chart": {"func": generate_stacked_bar_chart, "description": "生成堆叠柱状图，通过 seriesField 在分类轴堆叠展示多个系列，适合展示构成比例"},
}
