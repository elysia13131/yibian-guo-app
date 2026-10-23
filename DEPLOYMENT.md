# 部署说明文档

## 项目结构

```
一遍过/
├── backend/          # 后端服务（部署在 Zeabur）
├── frontend/         # 前端应用（Capacitor Android APK）
└── docker-compose.yml
```

## 环境配置

本系统支持开发（development）和生产（production）两种环境，在不同环境中使用相应的数据库配置。

### 环境变量说明

系统通过 `ENVIRONMENT` 环境变量确定当前运行环境：
- `ENVIRONMENT=development` - 开发环境（默认）
- `ENVIRONMENT=production` - 生产环境

环境配置优先级：
1. 系统会首先加载 `.env.{environment}` 文件（例如 `.env.development` 或 `.env.production`）
2. 如果找不到对应文件，则加载 `.env` 文件
3. 最后加载系统环境变量

### 配置文件示例

#### 开发环境（`.env.development`）
```bash
ENVIRONMENT=development
DATABASE_URL=sqlite:///./learning.db
DEEPSEEK_API_KEYS_STR=your_api_key_1,your_api_key_2
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
CHROMA_HOST=localhost
CHROMA_PORT=8001
CORS_ORIGINS=http://localhost:5173,capacitor://localhost
```

#### 生产环境（`.env.production`）
```bash
ENVIRONMENT=production
DATABASE_URL=postgresql://user:pass@host:5432/dbname
DEEPSEEK_API_KEYS_STR=your_api_key_1,your_api_key_2,your_api_key_3
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
CHROMA_HOST=your-chroma-host
CHROMA_PORT=8000
CORS_ORIGINS=https://your-app.com,capacitor://localhost
PORT=8000
```

### 不同环境的数据库配置
- **开发环境**：默认使用 SQLite 数据库，无需额外安装数据库服务，适合快速开发和测试
- **生产环境**：使用 PostgreSQL 数据库，需要配置正确的数据库连接字符串

### 环境切换方法

#### 本地开发
1. 创建 `.env.development` 文件并配置开发环境变量
2. 启动应用时自动加载开发配置
3. 或者手动设置环境变量：`export ENVIRONMENT=development`

#### 生产部署（Zeabur）
1. 在 Zeabur 控制台设置 `ENVIRONMENT=production`
2. 配置生产环境所需的所有环境变量
3. 无需上传 `.env.production` 文件，直接在控制台设置即可

## 向量数据库配置

### 功能说明
系统集成了 ChromaDB 向量数据库，用于：
- 文档向量化存储
- 语义搜索
- RAG（检索增强生成）

### 自动配置机制
向量数据库支持自动配置，无需额外设置：
1. **优先远程连接**：系统首先尝试连接配置的远程 ChromaDB 服务
2. **自动回退本地模式**：如果远程连接失败，自动使用本地持久化模式
3. **数据持久化**：本地模式数据存储在 `./chroma_data/` 目录

### 本地开发环境

#### 选项 1：使用 Docker 启动 ChromaDB
```bash
docker-compose up -d chromadb
```

ChromaDB 将运行在：
- 主机：`localhost`
- 端口：`8001`

#### 选项 2：使用本地模式（无需 Docker）
直接启动后端服务，系统会自动创建本地向量数据库。

### 生产环境配置

向量数据库已**自动配置**，无需额外设置：
- 如果有远程 ChromaDB 服务，配置 `CHROMA_HOST` 和 `CHROMA_PORT` 环境变量
- 如果没有远程服务，系统会自动使用本地持久化模式
- 本地数据自动存储在 `./chroma_data/` 目录（已添加到 .gitignore）

### 向量数据库 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/vector-db/upload` | POST | 上传文档文件（PDF/Word/Markdown/TXT） |
| `/api/v1/vector-db/search` | GET | 语义搜索文档 |
| `/api/v1/vector-db/document/{id}` | GET | 获取文档详情 |
| `/api/v1/vector-db/document/{id}` | DELETE | 删除文档 |
| `/api/v1/vector-db/count` | GET | 统计文档数量 |
| `/api/v1/vector-db/add-text` | POST | 直接添加文本内容 |

#### 文档上传示例
```bash
curl -X POST "https://your-api.com/api/v1/vector-db/upload" \
  -F "file=@document.pdf" \
  -F "title=我的文档" \
  -F "category=学习资料"
```

#### 搜索示例
```bash
curl "https://your-api.com/api/v1/vector-db/search?query=机器学习&n_results=5"
```

## 一、后端部署（Zeabur）

### 1. 准备工作

确保你需要：
- Zeabur 账号
- GitHub/GitLab 账号
- DeepSeek API Keys

### 2. 配置环境变量

在 Zeabur 控制台中配置以下环境变量（生产环境配置）：

```
ENVIRONMENT=production
DATABASE_URL=postgresql://user:pass@host:5432/dbname
DEEPSEEK_API_KEYS_STR=key1,key2,key3
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
CHROMA_HOST=your-chroma-host
CHROMA_PORT=8000
CORS_ORIGINS=capacitor://localhost
PORT=8000
```

**重要说明：**
- `ENVIRONMENT=production` 必须设置，以启用生产环境配置
- `DATABASE_URL` 必须是有效的 PostgreSQL 连接字符串（Zeabur 提供 PostgreSQL 服务）
- `DEEPSEEK_API_KEYS_STR` 使用逗号分隔的多个 API Key，系统会自动轮询使用
- `CORS_ORIGINS` 应包含你的前端应用地址（如果是 Web 应用）和 `capacitor://localhost`（Android 应用）
- `CHROMA_HOST` 和 `CHROMA_PORT` 是**可选的**，如果不配置，系统会自动使用本地向量数据库

### 3. 部署步骤

1. 将项目推送到 GitHub/GitLab

2. 在 Zeabur 中导入项目

3. 选择 `backend` 目录作为部署目录

4. 配置服务类型为 `Python`

5. 配置启动命令：
```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

6. 配置环境变量（见上方）

7. 启动服务

## 二、前端 Android APK 生成

### 前置要求

- Node.js 18+
- Android Studio
- JDK 17+
- Android SDK

### 生成步骤

#### 1. 开发模式（本地测试）

```bash
cd frontend
npm install
npm run dev
```

#### 2. 构建 APK

```bash
cd frontend

# 1. 构建前端
npm run build

# 2. 同步到 Capacitor
npx cap sync

# 3. 打开 Android Studio
npx cap open android
```

#### 4. 在 Android Studio 中

1. 等待 Gradle 同步完成
2. 点击 Build → Build Bundle(s) / APK(s) → Build APK(s)
3. APK 文件位置：`android/app/build/outputs/apk/debug/`

#### 5. 生成发布版 APK

在 Android Studio 中：

1. Build → Generate Signed Bundle / APK
2. 选择 APK
3. 配置密钥库
4. 选择 release 构建变体
5. 点击 Finish

### Capacitor 常用命令

```bash
# 同步 Web 资源
npx cap sync

# 仅同步 Android
npx cap sync android

# 打开 Android Studio
npx cap open android

# 添加插件
npm install @capacitor/camera
npx cap sync
```

## 三、本地开发环境

### 启动数据库（可选）

开发环境默认使用 SQLite 数据库，无需启动 PostgreSQL。如果需要使用 PostgreSQL 和 ChromaDB 进行完整功能测试，可以启动 Docker 服务：

```bash
docker-compose up -d
```

这将会启动：
- PostgreSQL 数据库（端口 5432）
- ChromaDB 向量数据库（端口 8001）

**注意**：如果仅使用 SQLite 和本地向量数据库模式进行开发，可以跳过此步骤。

### 后端开发

1. **配置开发环境**：
   - 复制 `.env.example` 到 `.env.development`
   - 修改 `.env.development` 中的配置（默认已配置 SQLite 数据库）
   - 或者直接使用默认配置，系统会自动使用 `.env.development`

2. **启动后端服务**：

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

**开发环境特点**：
- 默认使用 SQLite 数据库，无需安装 PostgreSQL
- 自动加载 `.env.development` 配置文件
- 向量数据库自动配置（远程或本地模式）
- 适合快速开发和测试

### 前端开发

```bash
cd frontend
npm install
npm run dev
```

## 四、API 端点

### 基础端点
- `GET /` - 欢迎页面
- `GET /health` - 健康检查

### AI 端点
- `POST /api/v1/ai/generate` - 生成文本
- `POST /api/v1/ai/batch-generate` - 批量生成
- `GET /api/v1/ai/usage` - API Key 使用情况

### 向量数据库端点
- `POST /api/v1/vector-db/upload` - 上传文档文件
- `GET /api/v1/vector-db/search` - 语义搜索
- `GET /api/v1/vector-db/document/{id}` - 获取文档
- `DELETE /api/v1/vector-db/document/{id}` - 删除文档
- `GET /api/v1/vector-db/count` - 统计文档数量
- `POST /api/v1/vector-db/add-text` - 添加文本内容

## 五、注意事项

1. **前后端分离架构：
   - 后端：Zeabur 部署，提供 API
   - 前端：Android APK，独立运行

2. **CORS 配置：
   - 确保后端 CORS 配置包含 `capacitor://localhost`

3. **API 地址：
   - 前端需要配置后端 API 地址为 Zeabur 提供的 URL

4. **DeepSeek API Keys：
   - 使用多个 Key 用逗号分隔
   - 系统会自动轮询使用

5. **环境配置：
   - 开发环境使用 SQLite 数据库，生产环境使用 PostgreSQL
   - 通过 `ENVIRONMENT` 环境变量切换环境
   - Zeabur 部署时必须设置 `ENVIRONMENT=production`

6. **向量数据库：
   - **自动配置**：无需额外配置，系统会自动选择最优模式
   - 本地开发：使用 Docker 启动 ChromaDB（端口 8001）或使用本地模式
   - 生产环境：可选配置远程 ChromaDB，否则自动使用本地持久化模式
   - 本地数据存储在 `./chroma_data/`（已添加到 .gitignore）
   - 支持 PDF、Word、Markdown、TXT 格式文件上传
