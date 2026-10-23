#!/bin/bash
set -e

echo "安装 rembg 依赖..."

pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple --timeout 600 rembg
pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple --timeout 300 Pillow
pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple --timeout 120 fastapi
pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple --timeout 120 "uvicorn[standard]"
pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple --timeout 120 python-multipart

echo "依赖安装完成"
