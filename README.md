# 智能学习平台

一个面向个人的智能学习平台，整合书本知识、复习资料，通过 AI 辅助和科学记忆方法实现高效学习。

## 仓库说明

本项目涉及两个仓库，用途完全不同，请勿混淆：

| 仓库 | 用途 | 内容范围 | 可见性 |
| --- | --- | --- | --- |
| `yibian-guo-app`（本仓库） | 完整源码仓库，用于开发、查阅与版本管理 | 前端、后端、Android 客户端、部署配置、文档 | 公开 |
| `yibian-guo-backend` | **仅用于部署**，由 Zeabur 拉取构建并发布 | 只保留后端运行所需文件，不含前端源码与开发文档 | 私有 |

- 日常开发、功能提交请在本仓库进行。
- 本仓库中的 `deploy/backend/` 是部署目录，内容与部署仓库对应；部署仓库由该目录同步而来。
- 部署仓库仅承担线上构建与发布，**请勿直接在 `yibian-guo-backend` 中开发或修改代码**。

## 技术栈

### 前端
- React 18 + TypeScript
- Vite
- TailwindCSS
- React Router v6

### 后端
- Python FastAPI
- SQLAlchemy ORM
- Alembic 数据库迁移
- PostgreSQL 数据库
- ChromaDB 向量数据库
- DeepSeek AI API
- FSRS 间隔重复算法

## 项目结构

```
.
├── frontend/              # 前端项目
│   ├── src/
│   │   ├── components/   # 组件
│   │   ├── pages/        # 页面
│   │   ├── hooks/        # 自定义 Hook
│   │   ├── utils/        # 工具函数
│   │   ├── api/          # API 调用
│   │   └── types/        # TypeScript 类型
│   └── ...
├── backend/               # 后端项目
│   ├── app/
│   │   ├── core/         # 核心配置
│   │   ├── db/           # 数据库相关
│   │   ├── api/          # API 路由
│   │   ├── models/       # 数据模型
│   │   ├── schemas/      # Pydantic 模式
│   │   └── services/     # 业务逻辑
│   ├── alembic/          # 数据库迁移
│   └── ...
└── docker-compose.yml     # Docker 服务配置
```

## 快速开始

### 前置要求
- Python 3.10+
- Node.js 18+
- Docker 和 Docker Compose

### 1. 启动数据库服务

```bash
docker-compose up -d
```

### 2. 后端设置

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# 编辑 .env 文件配置 API keys
alembic upgrade head
python main.py
```

### 3. 前端设置

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

## 功能特性

- 文档管理：上传和管理学习资料
- 知识提取：AI 自动从文档中提取知识内容
- 智能抽认卡：自动生成抽认卡
- 思维导图：可视化知识结构
- 科学复习：基于 FSRS 间隔重复算法
- AI 问答：基于 RAG 的智能问答
- 知识盲点检测：识别薄弱环节
- 数据统计：学习进度可视化
