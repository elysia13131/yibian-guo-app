"""matplotlib 本地图表生成模块

作为 AntV API 的自动 fallback，当 AntV 公共 API 返回服务端错误时，
自动使用 matplotlib 在本地生成图表，零外部依赖。
"""
import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np

# ─── 中文字体配置 ───
_CHINESE_FONTS = [
    "Microsoft YaHei", "SimHei", "WenQuanYi Micro Hei",
    "Noto Sans CJK SC", "Source Han Sans SC",
    "PingFang SC", "Hiragino Sans GB", "STHeiti",
]
_available_fonts = {f.name for f in matplotlib.font_manager.fontManager.ttflist}
for _font in _CHINESE_FONTS:
    if _font in _available_fonts:
        matplotlib.rcParams["font.sans-serif"] = [_font] + matplotlib.rcParams["font.sans-serif"]
        matplotlib.rcParams["axes.unicode_minus"] = False
        break

logger = logging.getLogger(__name__)

_OUTPUT_DIR = Path(__file__).resolve().parent.parent.parent / "_output" / "charts"
_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def _save_chart(fig: plt.Figure, prefix: str = "chart") -> str:
    """保存 matplotlib 图表到 _output/charts/ 并返回可访问的 URL"""
    filename = f"{prefix}_{uuid.uuid4().hex[:12]}.png"
    filepath = _OUTPUT_DIR / filename
    fig.savefig(str(filepath), dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    url = f"/api/v1/image/output/charts/{filename}"
    logger.info(f"matplotlib 图表已保存: {filepath} -> {url}")
    return url


def _ensure_data(data: list[dict], xField: str, yField: str):
    """提取 x 和 y 数据，处理缺失字段"""
    xField = xField or "x"
    yField = yField or "y"
    x_raw = []
    y_raw = []
    for item in data:
        x_val = item.get(xField, "")
        y_val = item.get(yField, 0)
        try:
            y_val = float(y_val)
        except (TypeError, ValueError):
            y_val = 0
        x_raw.append(x_val)
        y_raw.append(y_val)
    return x_raw, y_raw


async def generate_line_chart(data: list[dict], xField: str = "", yField: str = "",
                               title: str = "", seriesField: str = "", **kwargs) -> str:
    """生成折线图"""
    fig, ax = plt.subplots(figsize=(10, 5))
    if seriesField and seriesField in data[0] if data else False:
        series = {}
        for item in data:
            key = str(item.get(seriesField, "default"))
            if key not in series:
                series[key] = {"x": [], "y": []}
            x_val = item.get(xField or "x", "")
            y_val = item.get(yField or "y", 0)
            try:
                y_val = float(y_val)
            except (TypeError, ValueError):
                y_val = 0
            series[key]["x"].append(str(x_val))
            series[key]["y"].append(y_val)
        for s_key, s_data in series.items():
            ax.plot(s_data["x"], s_data["y"], marker="o", label=s_key)
        ax.legend()
    else:
        x_raw, y_raw = _ensure_data(data, xField, yField)
        ax.plot(x_raw, y_raw, marker="o", linewidth=2)
    if title:
        ax.set_title(title, fontsize=14, pad=15)
    ax.set_xlabel(xField or "x")
    ax.set_ylabel(yField or "y")
    fig.autofmt_xdate(rotation=30)
    fig.tight_layout()
    return _save_chart(fig, "line")


async def generate_bar_chart(data: list[dict], xField: str = "", yField: str = "",
                              title: str = "", seriesField: str = "", **kwargs) -> str:
    """生成柱状图"""
    fig, ax = plt.subplots(figsize=(10, 5))
    x_raw, y_raw = _ensure_data(data, xField, yField)
    x_pos = range(len(x_raw))
    if seriesField:
        unique_series = list(dict.fromkeys(str(item.get(seriesField, "default")) for item in data))
        series_data = {s: [] for s in unique_series}
        for item in data:
            s = str(item.get(seriesField, "default"))
            y_val = item.get(yField or "y", 0)
            try:
                y_val = float(y_val)
            except (TypeError, ValueError):
                y_val = 0
            series_data[s].append(y_val)
        n_series = len(unique_series)
        width = 0.8 / n_series
        for i, s in enumerate(unique_series):
            positions = [p + i * width for p in x_pos]
            ax.bar(positions, series_data[s], width, label=s)
        ax.legend()
        ax.set_xticks([p + width * (n_series - 1) / 2 for p in x_pos])
    else:
        ax.bar(x_raw, y_raw)
        ax.bar(x_pos, y_raw)
        ax.set_xticks(x_pos)
    ax.set_xticklabels(x_raw, rotation=30, ha="right")
    if title:
        ax.set_title(title, fontsize=14, pad=15)
    ax.set_xlabel(xField or "x")
    ax.set_ylabel(yField or "y")
    fig.tight_layout()
    return _save_chart(fig, "bar")


async def generate_column_chart(data: list[dict], xField: str = "", yField: str = "",
                                 title: str = "", seriesField: str = "", **kwargs) -> str:
    """生成条形图（水平柱状图）"""
    fig, ax = plt.subplots(figsize=(10, 6))
    x_raw, y_raw = _ensure_data(data, xField, yField)
    y_pos = range(len(x_raw))
    ax.barh(y_pos, y_raw)
    ax.set_yticks(y_pos)
    ax.set_yticklabels(x_raw)
    ax.invert_yaxis()
    if title:
        ax.set_title(title, fontsize=14, pad=15)
    ax.set_xlabel(yField or "y")
    fig.tight_layout()
    return _save_chart(fig, "column")


async def generate_pie_chart(data: list[dict], xField: str = "", yField: str = "",
                              title: str = "", seriesField: str = "", **kwargs) -> str:
    """生成饼图"""
    fig, ax = plt.subplots(figsize=(8, 8))
    x_raw, y_raw = _ensure_data(data, xField, yField)
    wedges, texts, autotexts = ax.pie(y_raw, labels=x_raw, autopct="%1.1f%%",
                                       startangle=90, textprops={"fontsize": 10})
    if title:
        ax.set_title(title, fontsize=14, pad=15)
    fig.tight_layout()
    return _save_chart(fig, "pie")


async def generate_area_chart(data: list[dict], xField: str = "", yField: str = "",
                               title: str = "", seriesField: str = "", **kwargs) -> str:
    """生成面积图"""
    fig, ax = plt.subplots(figsize=(10, 5))
    x_raw, y_raw = _ensure_data(data, xField, yField)
    ax.fill_between(range(len(x_raw)), y_raw, alpha=0.4)
    ax.plot(range(len(x_raw)), y_raw, linewidth=2)
    ax.set_xticks(range(len(x_raw)))
    ax.set_xticklabels(x_raw, rotation=30, ha="right")
    if title:
        ax.set_title(title, fontsize=14, pad=15)
    ax.set_xlabel(xField or "x")
    ax.set_ylabel(yField or "y")
    fig.tight_layout()
    return _save_chart(fig, "area")


async def generate_radar_chart(data: list[dict], xField: str = "", yField: str = "",
                                title: str = "", seriesField: str = "", **kwargs) -> str:
    """生成雷达图"""
    categories = [str(item.get(xField or "x", "")) for item in data]
    values = []
    for item in data:
        v = item.get(yField or "y", 0)
        try:
            v = float(v)
        except (TypeError, ValueError):
            v = 0
        values.append(v)

    N = len(categories)
    angles = np.linspace(0, 2 * np.pi, N, endpoint=False).tolist()
    values += values[:1]
    angles += angles[:1]

    fig, ax = plt.subplots(figsize=(8, 8), subplot_kw={"projection": "polar"})
    ax.plot(angles, values, "o-", linewidth=2)
    ax.fill(angles, values, alpha=0.25)
    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(categories, fontsize=10)
    if title:
        ax.set_title(title, fontsize=14, pad=20)
    fig.tight_layout()
    return _save_chart(fig, "radar")


async def generate_scatter_chart(data: list[dict], xField: str = "", yField: str = "",
                                  title: str = "", seriesField: str = "", **kwargs) -> str:
    """生成散点图"""
    fig, ax = plt.subplots(figsize=(10, 6))
    x_raw, y_raw = _ensure_data(data, xField, yField)
    if seriesField:
        series = set(str(item.get(seriesField, "")) for item in data)
        for s in series:
            sx = [float(item.get(xField or "x", 0)) if str(item.get(seriesField, "")) == s else None for item in data]
            sy = [float(item.get(yField or "y", 0)) if str(item.get(seriesField, "")) == s else None for item in data]
            sx = [v for v in sx if v is not None]
            sy = [v for v in sy if v is not None]
            ax.scatter(sx, sy, label=s, alpha=0.7)
        ax.legend()
    else:
        x_num = []
        y_num = []
        for item in data:
            try:
                x_num.append(float(item.get(xField or "x", 0)))
                y_num.append(float(item.get(yField or "y", 0)))
            except (TypeError, ValueError):
                pass
        ax.scatter(x_num, y_num, alpha=0.7)
    if title:
        ax.set_title(title, fontsize=14, pad=15)
    ax.set_xlabel(xField or "x")
    ax.set_ylabel(yField or "y")
    fig.tight_layout()
    return _save_chart(fig, "scatter")


async def generate_funnel_chart(data: list[dict], xField: str = "", yField: str = "",
                                 title: str = "", **kwargs) -> str:
    """生成漏斗图"""
    fig, ax = plt.subplots(figsize=(8, 6))
    x_raw, y_raw = _ensure_data(data, xField, yField)
    max_val = max(y_raw) if y_raw else 1
    for i, (label, val) in enumerate(zip(x_raw, y_raw)):
        width = val / max_val
        left = (1 - width) / 2
        ax.barh(i, width, left=left, height=0.6, edgecolor="white", linewidth=1.5)
        ax.text(0.5, i, f"{label}: {val}", ha="center", va="center",
                fontsize=10, fontweight="bold", color="white")
    ax.set_yticks([])
    if title:
        ax.set_title(title, fontsize=14, pad=15)
    ax.set_xlim(0, 1)
    fig.tight_layout()
    return _save_chart(fig, "funnel")


async def generate_heatmap_chart(data: list[dict], xField: str = "", yField: str = "",
                                  title: str = "", seriesField: str = "", **kwargs) -> str:
    """生成热力图"""
    if not data:
        fig, ax = plt.subplots(figsize=(6, 4))
        ax.text(0.5, 0.5, "无数据", ha="center", va="center", fontsize=14)
        if title:
            ax.set_title(title)
        return _save_chart(fig)

    xField = xField or "x"
    yField = yField or "y"
    all_x = sorted(set(str(item.get(xField, "")) for item in data))
    all_y = sorted(set(str(item.get(yField or "series", "")) for item in data))
    if not all_y:
        all_y = ["value"]
    matrix = np.zeros((len(all_y), len(all_x)))
    for item in data:
        xi = all_x.index(str(item.get(xField, "")))
        yi = all_y.index(str(item.get(yField or "series", "value")))
        val = item.get("value", 0)
        try:
            val = float(val)
        except (TypeError, ValueError):
            val = 0
        matrix[yi, xi] = val

    fig, ax = plt.subplots(figsize=(max(8, len(all_x) * 0.8), max(6, len(all_y) * 0.8)))
    im = ax.imshow(matrix, cmap="YlOrRd", aspect="auto")
    plt.colorbar(im, ax=ax)
    ax.set_xticks(range(len(all_x)))
    ax.set_xticklabels(all_x, rotation=45, ha="right")
    ax.set_yticks(range(len(all_y)))
    ax.set_yticklabels(all_y)
    for i in range(len(all_y)):
        for j in range(len(all_x)):
            ax.text(j, i, f"{matrix[i, j]:.1f}", ha="center", va="center", fontsize=9)
    if title:
        ax.set_title(title, fontsize=14, pad=15)
    fig.tight_layout()
    return _save_chart(fig, "heatmap")


async def generate_histogram_chart(data: list[dict], xField: str = "", title: str = "", **kwargs) -> str:
    """生成直方图"""
    fig, ax = plt.subplots(figsize=(10, 5))
    xField = xField or "x"
    values = []
    for item in data:
        v = item.get(xField, 0)
        try:
            v = float(v)
        except (TypeError, ValueError):
            continue
        values.append(v)
    if values:
        ax.hist(values, bins="auto", edgecolor="white", alpha=0.7)
    if title:
        ax.set_title(title, fontsize=14, pad=15)
    ax.set_xlabel(xField)
    ax.set_ylabel("频数")
    fig.tight_layout()
    return _save_chart(fig, "histogram")


async def generate_boxplot_chart(data: list[dict], xField: str = "", yField: str = "",
                                  title: str = "", **kwargs) -> str:
    """生成箱线图"""
    fig, ax = plt.subplots(figsize=(10, 6))
    if not data:
        ax.text(0.5, 0.5, "无数据", ha="center", va="center", fontsize=14)
        if title:
            ax.set_title(title)
        return _save_chart(fig)

    xField = xField or "x"
    yField = yField or "y"
    groups = {}
    for item in data:
        key = str(item.get(xField, "all"))
        val = item.get(yField, 0)
        try:
            val = float(val)
        except (TypeError, ValueError):
            continue
        if key not in groups:
            groups[key] = []
        groups[key].append(val)

    labels = list(groups.keys())
    values_list = list(groups.values())
    bp = ax.boxplot(values_list, labels=labels, patch_artist=True)
    for patch in bp["boxes"]:
        patch.set_alpha(0.6)
    if title:
        ax.set_title(title, fontsize=14, pad=15)
    ax.set_ylabel(yField)
    fig.autofmt_xdate(rotation=30)
    fig.tight_layout()
    return _save_chart(fig, "boxplot")


async def generate_dual_axes_chart(data: list[dict], xField: str = "", yFields: list = None,
                                    title: str = "", **kwargs) -> str:
    """生成双轴图"""
    fig, ax1 = plt.subplots(figsize=(10, 5))
    yFields = yFields or []
    xField = xField or "x"
    x_raw = [str(item.get(xField, "")) for item in data]

    if len(yFields) >= 1:
        y1 = []
        for item in data:
            v = item.get(yFields[0], 0)
            try:
                v = float(v)
            except (TypeError, ValueError):
                v = 0
            y1.append(v)
        color1 = kwargs.get("color", "#1890ff")
        ax1.plot(x_raw, y1, marker="o", color=color1, label=yFields[0])
        ax1.set_ylabel(yFields[0], color=color1)
        ax1.tick_params(axis="y", labelcolor=color1)

    if len(yFields) >= 2:
        ax2 = ax1.twinx()
        y2 = []
        for item in data:
            v = item.get(yFields[1], 0)
            try:
                v = float(v)
            except (TypeError, ValueError):
                v = 0
            y2.append(v)
        color2 = kwargs.get("color2", "#f5222d")
        ax2.plot(x_raw, y2, marker="s", color=color2, label=yFields[1])
        ax2.set_ylabel(yFields[1], color=color2)
        ax2.tick_params(axis="y", labelcolor=color2)
        lines1, labels1 = ax1.get_legend_handles_labels()
        lines2, labels2 = ax2.get_legend_handles_labels()
        ax1.legend(lines1 + lines2, labels1 + labels2, loc="upper left")

    if title:
        ax1.set_title(title, fontsize=14, pad=15)
    ax1.set_xlabel(xField)
    fig.autofmt_xdate(rotation=30)
    fig.tight_layout()
    return _save_chart(fig, "dual_axes")


async def generate_waterfall_chart(data: list[dict], xField: str = "", yField: str = "",
                                    title: str = "", **kwargs) -> str:
    """生成瀑布图"""
    fig, ax = plt.subplots(figsize=(10, 5))
    x_raw, y_raw = _ensure_data(data, xField, yField)
    cumulative = 0
    bottoms = []
    heights = []
    for val in y_raw:
        bottoms.append(cumulative)
        if val >= 0:
            heights.append(val)
        else:
            heights.append(val)
            bottoms[-1] = cumulative + val
        cumulative += val

    colors = ["#52c41a" if v >= 0 else "#f5222d" for v in y_raw]
    ax.bar(range(len(x_raw)), y_raw, bottom=bottoms, color=colors, edgecolor="white", width=0.6)
    ax.plot([-0.5, len(x_raw) - 0.5], [cumulative, cumulative], "r--", linewidth=1, label=f"总计: {cumulative:.1f}")
    ax.legend()
    ax.set_xticks(range(len(x_raw)))
    ax.set_xticklabels(x_raw, rotation=30, ha="right")
    if title:
        ax.set_title(title, fontsize=14, pad=15)
    ax.set_ylabel(yField or "y")
    fig.tight_layout()
    return _save_chart(fig, "waterfall")


async def generate_grouped_bar_chart(data: list[dict], xField: str = "", yField: str = "",
                                      title: str = "", seriesField: str = "", **kwargs) -> str:
    """生成分组柱状图，通过 seriesField 在分类轴并列展示多个系列"""
    fig, ax = plt.subplots(figsize=(10, 5))
    xField = xField or "x"
    yField = yField or "y"
    seriesField = seriesField or "series"

    categories = sorted(set(str(item.get(xField, "")) for item in data))
    series_names = sorted(set(str(item.get(seriesField, "default")) for item in data))

    series_vals = {s: {} for s in series_names}
    for item in data:
        cat = str(item.get(xField, ""))
        s = str(item.get(seriesField, "default"))
        val = item.get(yField, 0)
        try:
            val = float(val)
        except (TypeError, ValueError):
            val = 0
        series_vals[s][cat] = val

    x_pos = range(len(categories))
    n_series = len(series_names)
    bar_width = 0.8 / n_series
    colors = plt.cm.Set2.colors[:n_series] if n_series <= 8 else None

    for i, s in enumerate(series_names):
        vals = [series_vals[s].get(cat, 0) for cat in categories]
        positions = [p + i * bar_width for p in x_pos]
        ax.bar(positions, vals, bar_width, label=s, color=colors[i] if colors else None)

    ax.set_xticks([p + bar_width * (n_series - 1) / 2 for p in x_pos])
    ax.set_xticklabels(categories, rotation=30, ha="right")
    ax.legend()
    if title:
        ax.set_title(title, fontsize=14, pad=15)
    ax.set_xlabel(xField)
    ax.set_ylabel(yField)
    fig.tight_layout()
    return _save_chart(fig, "grouped_bar")


async def generate_stacked_bar_chart(data: list[dict], xField: str = "", yField: str = "",
                                      title: str = "", seriesField: str = "", **kwargs) -> str:
    """生成堆叠柱状图，通过 seriesField 在分类轴堆叠展示多个系列"""
    fig, ax = plt.subplots(figsize=(10, 5))
    xField = xField or "x"
    yField = yField or "y"
    seriesField = seriesField or "series"

    categories = sorted(set(str(item.get(xField, "")) for item in data))
    series_names = sorted(set(str(item.get(seriesField, "default")) for item in data))

    series_vals = {s: {} for s in series_names}
    for item in data:
        cat = str(item.get(xField, ""))
        s = str(item.get(seriesField, "default"))
        val = item.get(yField, 0)
        try:
            val = float(val)
        except (TypeError, ValueError):
            val = 0
        series_vals[s][cat] = val

    x_pos = range(len(categories))
    bar_width = 0.6
    colors = plt.cm.Set2.colors[:len(series_names)] if len(series_names) <= 8 else None

    bottoms = [0] * len(categories)
    for i, s in enumerate(series_names):
        vals = [series_vals[s].get(cat, 0) for cat in categories]
        ax.bar(x_pos, vals, bar_width, label=s, bottom=bottoms, color=colors[i] if colors else None)
        for j in range(len(categories)):
            bottoms[j] += vals[j]

    ax.set_xticks(x_pos)
    ax.set_xticklabels(categories, rotation=30, ha="right")
    ax.legend()
    if title:
        ax.set_title(title, fontsize=14, pad=15)
    ax.set_xlabel(xField)
    ax.set_ylabel(yField)
    fig.tight_layout()
    return _save_chart(fig, "stacked_bar")


CHART_TOOLS = {
    "generate_line_chart": {"func": generate_line_chart, "description": "折线图（matplotlib fallback）"},
    "generate_bar_chart": {"func": generate_bar_chart, "description": "柱状图（matplotlib fallback）"},
    "generate_column_chart": {"func": generate_column_chart, "description": "条形图（matplotlib fallback）"},
    "generate_pie_chart": {"func": generate_pie_chart, "description": "饼图（matplotlib fallback）"},
    "generate_area_chart": {"func": generate_area_chart, "description": "面积图（matplotlib fallback）"},
    "generate_radar_chart": {"func": generate_radar_chart, "description": "雷达图（matplotlib fallback）"},
    "generate_scatter_chart": {"func": generate_scatter_chart, "description": "散点图（matplotlib fallback）"},
    "generate_funnel_chart": {"func": generate_funnel_chart, "description": "漏斗图（matplotlib fallback）"},
    "generate_heatmap_chart": {"func": generate_heatmap_chart, "description": "热力图（matplotlib fallback）"},
    "generate_histogram_chart": {"func": generate_histogram_chart, "description": "直方图（matplotlib fallback）"},
    "generate_boxplot_chart": {"func": generate_boxplot_chart, "description": "箱线图（matplotlib fallback）"},
    "generate_dual_axes_chart": {"func": generate_dual_axes_chart, "description": "双轴图（matplotlib fallback）"},
    "generate_waterfall_chart": {"func": generate_waterfall_chart, "description": "瀑布图（matplotlib fallback）"},
    "generate_grouped_bar_chart": {"func": generate_grouped_bar_chart, "description": "分组柱状图（matplotlib），通过 seriesField 区分系列，在分类轴并列展示多个系列"},
    "generate_stacked_bar_chart": {"func": generate_stacked_bar_chart, "description": "堆叠柱状图（matplotlib），通过 seriesField 区分系列，在分类轴堆叠展示多个系列"},
}