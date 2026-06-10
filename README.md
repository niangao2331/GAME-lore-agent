# GAME Lore Agent — 游戏资料库智能问答平台
<img width="2333" height="1206" alt="image" src="https://github.com/user-attachments/assets/b2422574-a984-4f3e-a5d1-b59eba74959e" />

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

一个基于 **AI Agent + 结构化数据库** 的多游戏资料库智能问答平台。支持自然语言查询游戏剧情、角色、世界观，通过 MCP（Model Context Protocol）协议与 PostgreSQL 资料库交互，提供带引用溯源的深度 lore 分析。

这个项目旨在解决游戏在碎片化叙事时文案工作者和玩家需要花费大量时间查询/核对原有设定和剧情。碎片化叙事游戏的显著特点就是游戏设定分布在多个角落多段剧情，而没有一个统一的设定集告诉玩家或者文案编辑“这里发生了什么”。

得益于数据库和agent，该项目可以将以往繁琐的查询核对工作压缩至两到三分钟。使用方法也非常简单只需要描述你需要的内容，agent会自行调度查询所有资料并给出报告。同时项目也提供了空白数据库和入库指南，您可以自行搭建属于您自己的数据库。

从性能和经济实惠角度来说，我更推荐使用deepseekv4pro来进行查询，虽然flash也是可以使用的，但是在面对海量的文本和隐藏在游戏中的各种暗线以及蛛丝马迹，pro的注意力表现明显更好。

agent内核基于https://github.com/Lianues/Iris ，当然如果你想要换成其他agent也是没有问题的。

作者小群：1020622167

部署后访问 `http://localhost:3000`

---

## ✨ 核心功能

| 功能 | 说明 |
|------|------|
| 🤖 **AI 智能问答** | 基于 DeepSeek / OpenAI 等大模型，通过工具调用检索数据库后回答 |
| 📚 **多游戏资料库** | 内置 6 个游戏资料库：明日方舟、原神、重返未来 1999、鸣潮、边狱巴士，以及空白模板 |
| 🔍 **结构化检索** | 支持全文搜索（FTS）、向量搜索（pgvector）、分类树浏览、实体关联查询 |
| 📖 **引用溯源** | 每个回答标注数据来源 tier 等级，可追溯至原始文档和具体文本单元 |
| 🎨 **可切换深度** | Quick / Deep / Structured 三种调研深度，适配不同复杂度的问题 |
| 🛠️ **管理后台** | 完整的文档/实体/文本单元 CRUD，支持审核状态管理和版本快照 |
| 🔄 **数据库热切换** | 运行时切换不同游戏资料库，无需重启服务 |

---

## 🏗️ 技术架构

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   Backend       │────▶│   PostgreSQL    │
│  (Vanilla JS)   │◀────│  (Express.js)   │◀────│   (lore DBs)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                        │
        │                 ┌──────┴──────┐
        │                 │  MCP Server │
        │                 │ (lore-db)   │
        │                 └──────┬──────┘
        │                        │
        └───────────────▶  LLM API (DeepSeek/OpenAI)
```

- **前端**：原生 HTML/CSS/JS，无框架依赖，支持 Markdown 渲染和流式输出
- **后端**：Express + ES Modules，Agent 架构驱动 LLM 交互
- **数据库**：PostgreSQL + pgvector + pg_trgm，预置多游戏结构化资料
- **协议**：MCP（Model Context Protocol）标准化工具调用

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18
- PostgreSQL ≥ 15（建议 17）
- Windows / Linux / macOS

### 1. 克隆仓库

```bash
git clone https://github.com/niangao2331/GAME-lore-agent.git
cd GAME-lore-agent
```

### 2. 配置环境

```bash
cp .env.example .env
# 编辑 .env，填入你的 PostgreSQL 连接信息和 Admin Token
```

`.env` 示例：
```env
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=arknights_lore_new
PGUSER=postgres
PGPASSWORD=你的密码
ADMIN_TOKEN=你的管理令牌（可选）
```

### 3. 安装依赖

```bash
cd backend
npm install
```

### 4. 初始化数据库

```bash
# 自动创建所有游戏资料库并导入 dump
npm run db:setup

# 或强制重建（会清空现有数据）
npm run db:reset
```

### 5. 启动服务

```bash
npm start
# 或开发模式（自动重载）
npm run dev
```

访问 http://localhost:3000 即可使用。

---

## 📁 项目结构

```
GAME-lore-agent/
├── frontend/              # 前端界面
│   ├── index.html         # 主界面（聊天 + 设置）
│   ├── admin.html         # 管理后台
│   ├── css/               # 样式文件
│   └── js/                # 前端逻辑
├── backend/
│   ├── src/               # 服务端源码
│   │   ├── index.js       # Express 入口
│   │   ├── Agent.js       # AI Agent 核心
│   │   ├── LLMClient.js   # 大模型 API 客户端
│   │   ├── MCPRegistry.js # MCP 服务器管理
│   │   ├── routes/        # API 路由（chat, admin, sessions, config）
│   │   └── ...
│   ├── mcp-servers/       # MCP 服务实现
│   │   └── lore-db-mcp/   # 资料库查询 MCP Server
│   ├── skills/            # AI Skill 提示词模板
│   │   ├── lore-arknights/    # 明日方舟专用
│   │   ├── lore-generic/      # 通用模板
│   │   └── lore-intel/        # 深度分析模板
│   └── data/              # 运行时数据（sessions 等）
├── database/              # 资料库 dump 和注册表
│   ├── databases.json     # 资料库注册配置
│   ├── arknights/         # 明日方舟
│   ├── 1999/              # 重返未来 1999
│   ├── LB/                # 边狱巴士
│   ├── wuwa/              # 鸣潮
│   ├── yuan/              # 原神
│   └── structured/        # 空白模板 + schema
├── scripts/
│   └── db-setup.js        # 数据库初始化脚本
└── .env.example           # 环境变量模板
```

---

## 🗄️ 资料库说明

| 资料库 | 标识 | 内容 |
|--------|------|------|
| 明日方舟 | `arknights` | 主线/活动剧情、角色档案、世界观文档 |
| 原神 | `yuanshen` | 任务剧情、角色故事、地区设定 |
| 重返未来 1999 | `res1999` | 主线剧情、角色资料、活动故事 |
| 鸣潮 | `wuwa` | 主线剧情、角色档案、世界观 |
| 边狱巴士 | `limbus` | 章节剧情、罪人背景、都市设定 |
| 空白模板 | `structured-blank` | 空表结构，可用于自建资料库 |

资料库采用统一的结构化 schema：
- **documents** — 文档级（标题、来源、可信度 tier、正史状态）
- **text_units** — 文本单元级（段落/对话，含 speaker、scene 等元数据）
- **entities** — 实体（角色、组织、地点）
- **entity_aliases** / **entity_mentions** — 实体别名和提及关系

---

## 🛠️ 管理后台

访问 `http://localhost:3000/admin`，输入 `ADMIN_TOKEN` 后使用。

支持功能：
- 📄 文档检索、创建、编辑、删除
- 📝 文本单元管理（增删改查）
- 👤 实体管理（角色/组织/地点）
- 🔗 实体别名与提及重建
- 📋 审核状态追踪（pending / approved / needs_review / seeded / rejected）
- 🕐 版本快照与审计日志

---

## ⚙️ 配置说明

### 前端设置（运行时）

点击界面右上角 ⚙️ 设置：
- **API Key**：你的 DeepSeek / OpenAI API Key
- **Base URL**：API  endpoint（默认 `https://api.deepseek.com`）
- **模型**：如 `deepseek-v4-pro`、`gpt-4o`
- **资料库**：切换当前查询的数据库
- **深度**：Quick（快速）/ Deep（深度）/ Structured（结构化分析）

### 后端环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PGHOST` | PostgreSQL 主机 | `127.0.0.1` |
| `PGPORT` | PostgreSQL 端口 | `5432` |
| `PGDATABASE` | 默认数据库 | `arknights_lore_new` |
| `PGUSER` | 数据库用户名 | `postgres` |
| `PGPASSWORD` | 数据库密码 | - |
| `ADMIN_TOKEN` | 管理后台令牌 | - |
| `PORT` | 服务端口 | `3000` |

---

## 📄 许可证

[MIT](LICENSE)

---

> 本项目为个人学习与研究用途，所有游戏 lore 数据版权归原作者及开发商所有。
