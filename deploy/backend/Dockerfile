FROM python:3.11-slim

# 安装 LibreOffice（headless 模式，无 GUI 依赖）
RUN apt-get update && \
    apt-get install -y --no-install-recommends libreoffice-core libreoffice-writer libreoffice-impress libreoffice-calc && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Python 依赖
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 应用代码
COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
