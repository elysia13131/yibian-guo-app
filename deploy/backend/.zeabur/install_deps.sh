#!/bin/bash
set -e

echo "=== 安装系统依赖 ==="

# 安装 LibreOffice（用于 DOCX → PDF 布局保留转换）
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
    libreoffice-writer-nogui \
    fonts-noto-cjk \
    fonts-wqy-microhei \
    fonts-wqy-zenhei

# 安装 sopdf 依赖的 X11 系统库
apt-get install -y -qq --no-install-recommends \
    libxcb1 \
    libxcb-xinerama0 \
    libxcb-icccm4 \
    libxcb-image0 \
    libxcb-keysyms1 \
    libxcb-randr0 \
    libxcb-render-util0 \
    libxcb-shape0 \
    libxcb-sync1 \
    libxcb-xfixes0 \
    libxcb-xkb1 \
    libxcb-xv0

ldconfig

# 安装 ffmpeg（用于音频格式转换，声音复刻训练需要将用户上传的音频转为 WAV）
apt-get install -y -qq --no-install-recommends ffmpeg

# 安装 git（用于克隆 ppt-master）
apt-get install -y -qq --no-install-recommends git

echo "=== LibreOffice 版本 ==="
soffice --version

echo "=== ffmpeg 版本 ==="
ffmpeg -version

echo "=== 克隆 ppt-master（SVG 转 PPTX 引擎）==="
if [ ! -d "ppt-master" ]; then
    git clone --depth 1 https://github.com/hugohe3/ppt-master.git ppt-master
    echo "ppt-master 克隆完成"
else
    echo "ppt-master 已存在，跳过克隆"
fi

echo "=== 安装 Python 依赖 ==="
pip install --no-cache-dir opencv-python-headless -i https://pypi.org/simple
pip install --no-cache-dir -r requirements.txt -i https://pypi.org/simple
# 确保 opencv-headless 不被其他依赖覆盖
pip install --no-cache-dir opencv-python-headless -i https://pypi.org/simple

echo "=== 依赖安装完成 ==="
