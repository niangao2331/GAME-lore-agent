# 数据库自动入库指南

这个目录保存 lore 数据库的 dump 文件、结构化空模板，以及 `databases.json` 注册表。当前项目的入库方式已经偏向自动化：Agent 负责抓取、清洗、写入 PostgreSQL、导出 dump、注册数据库，再由 `scripts/db-setup.js` 在启动或初始化时恢复并检查运行时缓存。

适用对象：

- 需要新增一个游戏/作品资料库的 Agent
- 需要补充已有资料库内容的 Agent
- 需要让前端和 MCP 工具自动识别新数据库的维护者

## 快速入口

从项目根目录 `D:\web` 执行：

```powershell
# 初始化所有已注册数据库；已存在的库会跳过，但会做运行时缓存检查
cd D:\web\backend
npm install
npm run db:setup

# 只初始化一个数据库
node ..\scripts\db-setup.js wuwa

# 强制删除并重建一个数据库；会丢弃该库本地未导出的数据
node ..\scripts\db-setup.js wuwa --force
```

如果只是新增 dump 和注册项，一般不需要手动创建数据库；`db-setup.js` 会读取 `database/databases.json`，自动创建数据库、恢复 dump，并检查/修复搜索向量和 `document_stats` 缓存。

## 当前目录

```text
database/
  databases.json
  README.md
  structured/
    structured_lore_schema.sql
    structured_lore_blank.dump
  arknights/
    arknights_lore_new.dump
  1999/
    1999.dump
    scripts/
    data/
  wuwa/
    wuwa.dump
    scripts/
    data/
  yuan/
    yuanshen.dump
```

`structured/structured_lore_blank.dump` 是通用空库模板。新增资料库时优先使用它，而不是从已有作品库复制数据。

## Agent 入库总流程

推荐把每次入库当成一条可重复流水线：

1. 建目录：在 `database/<db-id>/` 下放 `scripts/`、`data/`、最终 dump。
2. 采集：脚本抓取或读取原始资料，原始 JSON/HTML/文本保存在 `data/`。
3. 清洗：转换成结构化记录，保留来源、分组、标题、正文、实体、别名。
4. 建库：从空模板恢复到本地 PostgreSQL，或直接在目标库执行 schema。
5. 插入：使用脚本批量写入 `documents`、`text_units`、`entities` 等表。
6. 验证：检查数量、抽样文本、搜索结果、实体命中、目录浏览。
7. 导出：用 `pg_dump --format=custom` 生成 dump。
8. 注册：在 `databases.json` 里添加或更新 `dumpFile`、`version`、`env.PGDATABASE`。
9. 重放：运行 `db:setup` 或目标库 `--force`，确认 dump 可恢复。

Agent 做完入库后，至少要留下：

- 可复跑的采集/插入脚本
- 采集进度或原始数据文件
- 新的 `.dump`
- 已更新的 `databases.json`
- 简短的验收记录，例如数量、缺失项、抽样结果

## 注册表格式

`database/databases.json` 是前端和初始化脚本识别数据库的唯一入口。

```json
{
  "databases": [
    {
      "id": "my-game",
      "name": "我的游戏资料库",
      "dumpFile": "my-game/my-game.dump",
      "version": 1,
      "env": {
        "PGDATABASE": "my_game_structured"
      }
    }
  ]
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 稳定短 ID。建议只用小写字母、数字、连字符。 |
| `name` | 是 | 前端展示名。 |
| `dumpFile` | 是 | 相对 `database/` 的 dump 路径。 |
| `version` | 建议 | 人工维护版本号；内容有明显变化就递增。 |
| `env.PGDATABASE` | 是 | PostgreSQL 数据库名。建议用小写字母、数字、下划线。 |

注意：`db-setup.js` 发现数据库已存在时默认不会覆盖数据，只会做运行时缓存维护。需要验证 dump 能否完整恢复时，用 `<db-id> --force`。

## 核心数据模型

当前 MCP server 主要依赖结构化 lore schema。Agent 入库时优先保证这些表质量：

```text
documents
  text_units
    entity_mentions

entities
  entity_aliases
  entity_relations

events
  event_participants

claims
  claim_evidence
```

最低可用数据集是 `documents + text_units`。如果希望 Agent 能按角色、地点、组织检索，还需要 `entities + entity_aliases + entity_mentions`。

### `documents`

每一行是一篇资料，例如主线章节、活动章节、角色档案、物品说明、世界观文档。

关键字段：

| 字段 | 说明 |
| --- | --- |
| `external_key` | 外部唯一键，建议稳定可复用，例如 `main_01_001`、`char_amiya_profile`。 |
| `title` | 标题，必填。 |
| `subtitle` | 副标题或章节名。 |
| `source_name` | 来源名称，例如官网、游戏内文本、Wiki 页面。 |
| `source_uri` | 原始链接或本地文件路径。 |
| `source_tier` | 可信度分级，见下文。 |
| `content_type` | 内容类型，见下文。 |
| `canon_status` | `canonical`、`ambiguous`、`non_canon`。 |
| `perspective_scope` | `in_universe`、`narrator`、`mixed`、`unknown`。 |
| `metadata` | JSONB 元数据，影响目录浏览和搜索过滤。 |
| `review_status` | `pending`、`approved`、`rejected`。 |
| `ai_usage_notes` | 给 Agent 的使用限制，例如“含玩家推测，不可当作正史”。 |

推荐 `metadata`：

```json
{
  "top_group": "主线剧情",
  "group_name": "第一章",
  "story_path": ["主线", "第一章", "上篇"],
  "operator_name": "角色名",
  "operator_summary": "角色一句话简介",
  "source_file": "database/my-game/data/main_01.json",
  "scraped_at": "2026-06-10",
  "ingest_agent": "codex"
}
```

`top_group`、`group_name`、`story_path`、`operator_name`、`operator_summary` 会被搜索和目录函数直接使用。不要把所有信息都塞进标题，目录字段要规整。

### `text_units`

每篇文档拆成多个文本片段，按 `unit_index` 从 0 递增。

关键字段：

| 字段 | 说明 |
| --- | --- |
| `document_id` | 所属文档。 |
| `unit_index` | 文档内顺序。 |
| `unit_kind` | `paragraph`、`dialogue`、`stage_direction`、`narration`、`heading`、`summary`、`metadata_block`。 |
| `heading` | 片段标题。 |
| `speaker` | 对话说话人。 |
| `scene_code` | 场景或关卡代码。 |
| `text` | 正文，必填。 |
| `source_tier` | 可覆盖文档级来源分级。 |
| `content_type` | 可覆盖文档级内容类型。 |
| `is_direct_scene` | 是否游戏内直接剧情场景。 |
| `metadata` | 片段级摘要、关键词、情绪、来源定位等。 |

推荐 `metadata`：

```json
{
  "summary": "这一段发生了什么，尽量客观。",
  "summary_short": "短摘要",
  "summary_type": "plot",
  "summary_confidence": "high",
  "key_terms": ["角色名", "地点名", "组织名"],
  "raw_index": 12
}
```

`summary`、`summary_short`、`key_terms` 对 Agent 很重要。它们能让 `lore_db_search_fts` 更快找到证据。

### `entities`

实体包括角色、组织、地点、物品、概念、事件、阵营、种族、职业、称号。

常用 `entity_type`：

| 值 | 含义 |
| --- | --- |
| `character` | 角色 |
| `organization` | 组织 |
| `location` | 地点 |
| `item` | 物品 |
| `concept` | 概念 |
| `event` | 事件 |
| `faction` | 阵营 |
| `race` | 种族 |
| `class` | 职业 |
| `title` | 称号 |

实体入库建议：

- `name` 使用最常见中文名或主名称。
- `name_en` 保存英文名、罗马音或官方外文名。
- 别名、称号、缩写、译名写入 `entity_aliases`，不要只写在 `summary`。
- `entity_mentions` 尽量关联到具体 `unit_id`，这样 Agent 可以读上下文。

### 插入顺序

有外键约束，批量导入时按这个顺序最稳：

```text
documents
text_units
entities
entity_aliases
entity_mentions
entity_relations
events
event_participants
claims
claim_evidence
```

实际脚本里建议用事务；失败时回滚，避免半成品污染库。

## 推荐自动插入脚本形态

每个资料库可以有自己的 `database/<db-id>/scripts/insert_to_db.py` 或 `.js`。脚本职责是“读取已清洗数据并写库”，不要在同一个脚本里无限混合抓取、清洗、入库、导出。

Python 伪代码：

```python
import json
import psycopg2
from psycopg2.extras import Json

conn = psycopg2.connect(
    host="127.0.0.1",
    port=5432,
    dbname="my_game_structured",
    user="postgres",
)

with conn:
    with conn.cursor() as cur:
        with open(r"D:\web\database\my-game\data\stories.json", encoding="utf-8") as f:
            stories = json.load(f)

        for story in stories:
            cur.execute(
                """
                INSERT INTO documents (
                  external_key, title, subtitle, source_name, source_uri,
                  source_tier, content_type, canon_status, perspective_scope,
                  metadata, review_status
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'approved')
                ON CONFLICT (external_key) DO UPDATE SET
                  title = EXCLUDED.title,
                  subtitle = EXCLUDED.subtitle,
                  source_name = EXCLUDED.source_name,
                  source_uri = EXCLUDED.source_uri,
                  metadata = EXCLUDED.metadata,
                  updated_at = now()
                RETURNING document_id
                """,
                (
                    story["external_key"],
                    story["title"],
                    story.get("subtitle"),
                    story.get("source_name"),
                    story.get("source_uri"),
                    story.get("source_tier", 3),
                    story.get("content_type", "story"),
                    story.get("canon_status", "canonical"),
                    story.get("perspective_scope", "narrator"),
                    Json(story.get("metadata", {})),
                ),
            )
            document_id = cur.fetchone()[0]

            cur.execute("DELETE FROM text_units WHERE document_id = %s", (document_id,))
            for i, unit in enumerate(story["text_units"]):
                cur.execute(
                    """
                    INSERT INTO text_units (
                      document_id, unit_index, unit_kind, heading, speaker,
                      scene_code, text, source_tier, content_type,
                      is_direct_scene, metadata, review_status
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'approved')
                    """,
                    (
                        document_id,
                        i,
                        unit.get("unit_kind", "paragraph"),
                        unit.get("heading"),
                        unit.get("speaker"),
                        unit.get("scene_code"),
                        unit["text"],
                        unit.get("source_tier"),
                        unit.get("content_type"),
                        unit.get("is_direct_scene", False),
                        Json(unit.get("metadata", {})),
                    ),
                )
```

脚本要求：

- 使用 UTF-8 读写文件。
- 使用参数化 SQL，不拼接用户文本。
- 用 `external_key` 做幂等更新。
- 对同一文档的片段可先删后插，确保 `unit_index` 连续。
- 把 `source_uri`、`source_file`、`raw_index` 留下来，方便回溯。
- 不确定、推测、社区二创内容要降低 `source_tier` 并写清 `ai_usage_notes`。

## 来源分级和内容类型

`source_tier`：

| 值 | 含义 |
| --- | --- |
| `1` | 游戏内直接剧情、原文、关卡文本。 |
| `2` | 官方设定集、档案、制作人访谈。 |
| `3` | 官方宣传、官网角色介绍、PV 文案。 |
| `4` | 官方衍生、动画、漫画、广播剧等。 |
| `5` | 玩家推测、社区考据、非官方整理。 |

`content_type`：

| 值 | 含义 |
| --- | --- |
| `story` | 剧情文本 |
| `operator_profile` | 角色档案 |
| `world_document` | 世界观文档 |
| `event_record` | 活动记录 |
| `voice_line` | 语音文本 |
| `item_description` | 物品说明 |
| `miscellaneous` | 其他 |

Agent 回答事实问题时会优先采信 tier 1-2。低 tier 内容必须在摘要或使用说明中标出不确定性。

## 导出 dump

内容写入并验证后，导出 custom format dump：

```powershell
cd D:\web
pg_dump -h 127.0.0.1 -p 5432 -U postgres -d my_game_structured --format=custom --no-owner --no-privileges -f database\my-game\my-game.dump
```

如果 PostgreSQL 不在 PATH，Windows 常见位置：

```powershell
& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" -h 127.0.0.1 -p 5432 -U postgres -d my_game_structured --format=custom --no-owner --no-privileges -f D:\web\database\my-game\my-game.dump
```

导出后必须重放验证：

```powershell
cd D:\web\backend
node ..\scripts\db-setup.js my-game --force
```

看到 restored、runtime cache check complete，并且没有关键 warning，才算 dump 可交付。

## 运行时缓存和搜索优化

`db-setup.js` 会调用 `backend/src/dbMaintenance.js`，自动做这些事：

- 数据库不存在时，从 `dumpFile` 创建并恢复。
- 已存在且未 `--force` 时，保留本地数据。
- 检查 `search_evidence_optimized`、`browse_tree_optimized`、`document_stats`。
- 必要时应用 `backend/mcp-servers/lore-db-mcp/migrations/004_query_optimization.sql`。
- 修复缺失的 `search_vector`。
- 刷新 `document_stats` 浏览缓存。

RAG/向量相关的 `005_rag_infrastructure.sql` 不是默认必需项。只有确认 PostgreSQL 已安装 `pgvector`，并且有 embedding worker 消费 `embedding_jobs` 时再启用。

## MCP 验收方式

资料库恢复后，当前 Agent 查询侧主要使用这些工具：

| 工具 | 用途 |
| --- | --- |
| `lore_db_status` | 查看连接状态和表数量。 |
| `lore_db_categories` | 浏览目录分组。 |
| `lore_db_search_fts` | 首选证据搜索。 |
| `lore_db_search` | 文档和片段混合搜索。 |
| `lore_db_search_chunks` | 片段级搜索或浏览。 |
| `lore_db_read` | 读取完整文档。 |
| `lore_db_read_context` | 围绕某个片段扩展上下文。 |
| `lore_db_find_tags` | 解析实体和别名。 |
| `lore_db_search_by_tags` | 按实体找文档。 |
| `lore_db_entity_cooccurrence` | 查多个实体共现。 |
| `lore_db_search_stats` | 查搜索分布和统计。 |

验收清单：

- `lore_db_status` 的 `documents`、`text_units` 数量符合预期。
- `lore_db_categories` 能看到 `top_group` 和 `group_name`。
- 用 5-10 个核心角色、地点、章节标题搜索，结果能命中正确文档。
- 对核心事实使用 `lore_db_read` 或 `lore_db_read_context` 能读到原文证据。
- `lore_db_find_tags` 能解析主名称、别名、英文名或缩写。
- 低可信度资料不会和正史混在一起，`source_tier` 与 `ai_usage_notes` 清楚。

## Agent 数据质量标准

入库时优先保证“可查、可读、可追溯”：

- 可查：标题、分组、摘要、关键词、实体别名都要填。
- 可读：`text_units.text` 保留原文，不要只存摘要。
- 可追溯：每条文档要有 `source_name`、`source_uri` 或 `metadata.source_file`。
- 可复跑：脚本重复执行不会产生重复文档。
- 可区分：官方、社区、推测、非正史内容分层清楚。
- 可抽样：留下检查结果或样本，方便后续 Agent 判断是否可靠。

不要这样做：

- 不要只导入长文档而不拆 `text_units`。
- 不要把所有字段都塞进 `metadata`，核心字段要落表。
- 不要让 `unit_index` 混乱或重复。
- 不要丢失原始来源。
- 不要把玩家推测标成 `source_tier = 1`。
- 不要修改无关资料库 dump。

## 常用命令

```powershell
# 项目根目录
cd D:\web

# 查看注册项
Get-Content .\database\databases.json

# 初始化所有数据库
cd .\backend
npm run db:setup

# 初始化单个数据库
node ..\scripts\db-setup.js res1999

# 强制重建单个数据库
node ..\scripts\db-setup.js res1999 --force

# 启动后端
npm start
```

PostgreSQL 环境变量可按需设置：

```powershell
$env:PGHOST = "127.0.0.1"
$env:PGPORT = "5432"
$env:PGUSER = "postgres"
$env:PGPASSWORD = "your-password"
```

## 依赖

- Node.js，可运行 `backend` 的 npm scripts。
- PostgreSQL 15+。
- `psql`、`pg_restore`、`pg_dump` 在 PATH，或安装在常见 Windows PostgreSQL 目录。
- 可选：`pgvector`，仅 RAG/embedding 功能需要。

Windows 安装 PostgreSQL：

```powershell
winget install PostgreSQL.PostgreSQL.17
```

Ubuntu / Debian：

```bash
sudo apt install postgresql postgresql-contrib
```

macOS：

```bash
brew install postgresql
```
