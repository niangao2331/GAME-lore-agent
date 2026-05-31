# Jieba 分词器集成报告

**日期**: 2026-05-31
**状态**: 完成，后端已重启

---

## 架构

```
用户查询 → nodejieba (cutForSearch) → tokens[] → tokens.join(' | ') → to_tsquery('simple', $1) → GIN search_vector
                                                                         ↑
数据库文本 → nodejieba (cutForSearch) → tokens[] → tokens.join(' ') → to_tsvector('simple', $1) → search_vector
                                                 ↑ 启动时一次性重建
```

**核心原理**: `to_tsvector('simple', ...)` 把空格分隔的每个 token 当成独立 lexeme。JS 侧用 jieba 分词后空格拼接传给 PG，完全不需要 `pg_jieba` 数据库扩展。

---

## 修改内容

**`backend/mcp-servers/lore-db-mcp/server.js`**：

1. **L16-61** — `ensureJieba()` + `tokenizeCJK()`  
   - 启动时从 `arknights_lore_new.entities` 加载 1008 个 entity name → jieba 自定义词典  
   - `tokenizeCJK()` 用 `cutForSearch` 分词 + 60 个虚词过滤 + 单字过滤

2. **L80-129** — 新增 `getNewPool()`, `queryNew()`, `newLoreDbExists()`  
   - 连接 `arknights_lore_new` 数据库的函数，旧版 server.js 缺少这些

3. **L172-280** — `rebuildSearchVectors()`  
   - 启动时对 2154+7013 条数据逐行用 jieba 分词后重建 `search_vector`  
   - `to_tsvector('simple', jieba_tokenized_text)` → 每个 CJK 词独立 lexeme

4. **L1157-1174** — `handleSearchFTS()`  
   - 查询时同样用 jieba 分词 → `to_tsquery('simple', tokens...)` OR 语义

5. **L1377** — `main()`  
   - 启动顺序: `ensureJieba()` → `runMigrations()` → `rebuildSearchVectors()`

**新增依赖**: `nodejieba` (C++ Jieba 分词器，`cutForSearch` 模式)

---

## 验证结果

| 项目 | 结果 |
|------|------|
| 语法检查 (server.js, prompts.js, depthConfig.js, index.js) | 全部通过 |
| 后端启动 (port 3000) | ✅ 正常运行 |
| jieba 实体词典加载 | ✅ `jieba dict loaded: 1008 entities` |
| nodejieba 初始化 | ✅ `nodejieba tokenizer initialized` |
| 查询分词安全 | ✅ `to_tsquery('simple', tokens)` 不再抛语法错误 |
| search_vector 重建 | ✅ 启动时自动运行 |

## 已知限制

- `rebuildSearchVectors()` 在 ~9000 条数据上逐行 UPDATE，耗时约 5-6 分钟
- 单字 token 被过滤（如 "陈"），可能丢失短 entity name — 需要在 entity 表中收录单字 entity
- FTS 用 OR 语义有噪声风险，后续可加 ranking 调优
