#!/usr/bin/env node
import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import pg from 'pg';

const { Pool } = pg;

// ── Jieba tokenizer (lazy init, dictionary from DB) ──────────────────────────
let _jieba = null;

async function ensureJieba() {
  if (_jieba !== null) return;
  try {
    const nodejiebaModule = await import('nodejieba');
    const nodejieba = nodejiebaModule.default || nodejiebaModule;
    if (typeof nodejieba.cutForSearch !== 'function') {
      throw new Error('nodejieba cutForSearch API is unavailable');
    }
    // Load entity names as custom vocabulary so names like 塔露拉/魏彦吾
    // are recognized as single words instead of individual characters
    try {
      const p = getNewPool();
      const client = await p.connect();
      try {
        await client.query('SET search_path TO public');
        const r = await client.query(
          `SELECT name FROM entities WHERE review_status != $1 AND LENGTH(name) BETWEEN 2 AND 20`,
          ['rejected']
        );
        for (const row of r.rows) {
          try { nodejieba.insertWord(row.name); } catch {}
        }
        console.error(`jieba dict loaded: ${r.rows.length} entities`);
      } finally { client.release(); }
    } catch (err) {
      console.error('jieba entity dict load failed (continuing):', err.message);
    }
    _jieba = nodejieba;
    console.error('nodejieba tokenizer initialized');
  } catch {
    console.error('nodejieba not available — falling back to structural tokenizer');
    _jieba = false;
  }
}

function tokenizeCJK(text) {
  if (!_jieba) {
    return text.split(/[\s,，、。；;|/]+/).map(s => s.trim()).filter(s => s.length >= 2);
  }
  const fw = new Set([
    '的', '了', '呢', '吗', '啊', '吧', '着', '过', '与', '或', '而', '于',
    '以', '之', '因', '被', '把', '从', '对', '向', '到', '让', '给', '由',
    '此', '但', '如', '也', '还', '只', '才', '便', '即', '若', '虽', '然',
    '可', '能', '会', '就', '都', '又', '再', '那', '哪', '什', '么', '怎',
    '样', '些', '各', '很', '最', '更', '非', '常', '极', '是', '在', '有',
  ]);
  return _jieba.cutForSearch(text).filter(w => w.length >= 2 && !fw.has(w));
}

function buildWebsearchQuery(tokens, rawQuery) {
  const cleaned = tokens
    .map(t => String(t || '').trim())
    .filter(Boolean)
    .map(t => t.replace(/["\\]/g, ' ').trim())
    .filter(Boolean);

  return cleaned.length ? cleaned.join(' OR ') : rawQuery;
}

// ── Database config ──────────────────────────────────────────────────────
const DB_CONFIG = {
  host: '127.0.0.1',
  port: 5432,
  database: 'arknights_lore',
  user: 'postgres',
  password: '',
  ssl: false,
};
const NEW_DB_CONFIG = {
  ...DB_CONFIG,
  database: 'arknights_lore_new',
};
const SCHEMA = 'arknights_lore';

let pool = null;
let newPool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      ...DB_CONFIG,
      max: 8,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

function getNewPool() {
  if (!newPool) {
    newPool = new Pool({
      ...NEW_DB_CONFIG,
      max: 8,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return newPool;
}

async function query(sql, params = []) {
  const client = await getPool().connect();
  try {
    await client.query(`SET search_path TO "${SCHEMA}", public`);
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function queryNew(sql, params = []) {
  const client = await getNewPool().connect();
  try {
    await client.query('SET search_path TO public');
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function newLoreDbExists() {
  try {
    const result = await queryNew(`
      SELECT
        to_regclass('public.documents') IS NOT NULL AS has_documents,
        to_regclass('public.text_units') IS NOT NULL AS has_text_units
    `);
    return Boolean(result.rows[0]?.has_documents && result.rows[0]?.has_text_units);
  } catch {
    return false;
  }
}

function quoteIdent(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

// ── Migration runner ────────────────────────────────────────────────────────
async function runMigrations() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migrationDir = join(__dirname, 'migrations');
  try {
    const files = readdirSync(migrationDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = readFileSync(join(migrationDir, file), 'utf-8');
      try {
        await query(sql);
      } catch (err) {
        console.error(`Migration warning for ${file} (continuing):`, err.message);
      }
    }
    console.error('Database migrations applied successfully');
  } catch (err) {
    console.error('Migration warning (non-fatal):', err.message);
  }
}

// ── Search vector maintenance ───────────────────────────────────────────────

// Rebuild search_vector for all documents and text_units after jieba vocabulary
// has been loaded. The key insight: to_tsvector('simple', ...) treats each
// space-separated token as one lexeme. If we feed raw CJK text to to_tsvector,
// it concatenates all characters into one giant "word" (e.g. '塔露拉和陈的身世':1).
// To make CJK search work without pg_jieba, we must:
// 1. Tokenize with nodejieba on the JS side
// 2. Join tokens with spaces
// 3. Feed the space-joined string to to_tsvector('simple', ...)
// This produces a tsvector where each CJK word is an independent lexeme,
// matching plainto_tsquery('simple', jiebaTokens) on the query side.
async function rebuildSearchVectors() {
  if (!(await newLoreDbExists())) return;

  // Skip if jieba not available
  if (!_jieba || _jieba === false) {
    console.error('jieba not available — skipping search_vector rebuild (ILPKE fallback will be used)');
    return;
  }

  // Load entity dictionary for jieba first
  try {
    const r = await queryNew(
      `SELECT name FROM entities WHERE review_status != $1 AND LENGTH(name) BETWEEN 2 AND 20`,
      ['rejected']
    );
    for (const row of r.rows) {
      try { _jieba.insertWord(row.name); } catch {}
    }
    console.error(`jieba dict refreshed: ${r.rows.length} entities`);
  } catch (err) {
    console.error('jieba dict load for rebuild failed:', err.message);
  }

  const fw = new Set(['的','了','呢','吗','啊','吧','着','过','与','或','而','于','以','之','因','被','把','从','对','向','到','让','给','由','此','但','如','也','还','只','才','便','即','若','虽','然','可','能','会','就','都','又','再','那','哪','什','么','怎','样','些','各','很','最','更','非','常','极','是','在','有']);
  function tok(text) {
    if (!text) return '';
    return _jieba.cutForSearch(text).filter(w => w.length >= 2 && !fw.has(w)).join(' ');
  }

  const docs = await queryNew('SELECT COUNT(*)::int AS c FROM documents');
  const units = await queryNew('SELECT COUNT(*)::int AS c FROM text_units');
  const docTotal = docs.rows[0]?.c || 0;
  const unitTotal = units.rows[0]?.c || 0;

  console.error(`Rebuilding search_vector with jieba tokens: ${docTotal} documents, ${unitTotal} text_units...`);

  // Process documents in batches to avoid long-lock and memory issues
  const docClient = await getNewPool().connect();
  try {
    await docClient.query('SET search_path TO public');
    const { rows: docRows } = await docClient.query(
      'SELECT document_id, title, subtitle, metadata->>\'operator_name\' AS op_name, metadata->>\'operator_summary\' AS op_summary FROM documents'
    );
    let docCount = 0;
    const docBatch = [];
    for (const row of docRows) {
      docBatch.push({
        id: row.document_id,
        title: tok(row.title),
        subtitle: tok(row.subtitle),
        op_name: tok(row.op_name),
        op_summary: tok(row.op_summary),
      });
    }
    for (const b of docBatch) {
      await docClient.query(
        `UPDATE documents SET search_vector =
           setweight(to_tsvector('simple', $2), 'A') ||
           setweight(to_tsvector('simple', $3), 'B') ||
           setweight(to_tsvector('simple', $4), 'A') ||
           setweight(to_tsvector('simple', $5), 'B')
         WHERE document_id = $1`,
        [b.id, b.title, b.subtitle, b.op_name, b.op_summary]
      );
    }
    console.error(`  documents done: ${docBatch.length}`);
  } finally { docClient.release(); }

  // Process text_units in batches — single row per UPDATE is slow but correct
  const tuClient = await getNewPool().connect();
  try {
    await tuClient.query('SET search_path TO public');
    const { rows: tuRows } = await tuClient.query(
      'SELECT unit_id, heading, LEFT(text, 2000) AS text_chunk, metadata->>\'summary\' AS summary, metadata->>\'summary_short\' AS summary_short, metadata->>\'key_terms\' AS key_terms FROM text_units'
    );
    let tuCount = 0;
    for (const row of tuRows) {
      await tuClient.query(
        `UPDATE text_units SET search_vector =
           setweight(to_tsvector('simple', $2), 'A') ||
           setweight(to_tsvector('simple', $3), 'B') ||
           setweight(to_tsvector('simple', $4), 'C') ||
           setweight(to_tsvector('simple', $5), 'C') ||
           setweight(to_tsvector('simple', $6), 'C')
         WHERE unit_id = $1`,
        [row.unit_id, tok(row.heading), tok(row.text_chunk), tok(row.summary), tok(row.summary_short), tok(row.key_terms)]
      );
      tuCount++;
      if (tuCount % 500 === 0) console.error(`  text_units: ${tuCount}/${unitTotal}`);
    }
    console.error(`  text_units done: ${tuCount}`);
  } finally { tuClient.release(); }

  console.error('search_vector rebuild complete');
}

// ── Tool definitions ──────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'lore_db_status',
    description: '获取资料库连接状态和统计信息（domains、assets、tags 数量）',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lore_db_categories',
    description: '列出资料库分类树，可按 domain 过滤',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: '域名，默认 arknights' },
      },
    },
  },
  {
    name: 'lore_db_search',
    description: '按关键词、分类、标签搜索资料库资产。返回 asset_id、标题、分类、原文摘要。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词，匹配标题和原文' },
        category: { type: 'string', description: '分类 code 过滤。默认自动包含该分类的所有子分类' },
        tag: { type: 'string', description: '标签值过滤' },
        limit: { type: 'number', description: '返回数量上限，默认 50，最大 200' },
        offset: { type: 'number', description: '分页偏移，默认 0' },
        include_children: { type: 'boolean', description: '按分类过滤时是否自动包含子分类，默认 true' },
      },
    },
  },
  {
    name: 'lore_db_search_chunks',
    description: '搜索原文分块（asset_chunks）。适合查找精确引用和短语。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        category: { type: 'string', description: '分类 code 过滤' },
        tag: { type: 'string', description: '标签值过滤' },
        limit: { type: 'number', description: '返回数量上限，默认 20，最大 100' },
        offset: { type: 'number', description: '分页偏移，默认 0' },
      },
    },
  },
  {
    name: 'lore_db_read',
    description: '读取完整资产（含原文、标签、媒体变体）',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'number', description: '资产 ID' },
      },
      required: ['asset_id'],
    },
  },
  {
    name: 'lore_db_read_context',
    description: '展开 chunk 周围的上下文（前后各 N 个 chunk）',
    inputSchema: {
      type: 'object',
      properties: {
        chunk_id: { type: 'number', description: '块 ID' },
        radius: { type: 'number', description: '前后半径，默认 2，最大 10' },
      },
      required: ['chunk_id'],
    },
  },
  {
    name: 'lore_db_find_tags',
    description: '搜索标签（按值、别名、描述），支持模糊匹配',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词（可选，不传则列出热门标签）' },
        dim_code: { type: 'string', description: '标签维度过滤，如 CHARACTER, FACTION, EVENT' },
        limit: { type: 'number', description: '返回数量上限，默认 30，最大 100' },
      },
    },
  },
  {
    name: 'lore_db_search_by_tags',
    description: '按多个标签联合过滤资产（AND/OR 模式）',
    inputSchema: {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              value: { type: 'string', description: '标签值' },
              dim_code: { type: 'string', description: '标签维度' },
            },
          },
          description: '标签列表',
        },
        mode: { type: 'string', description: 'all=必须全部匹配, any=匹配任意一个。默认 any' },
        limit: { type: 'number', description: '返回数量上限，默认 50，最大 200' },
      },
      required: ['tags'],
    },
  },
  {
    name: 'lore_db_tag_neighbors',
    description: '查看标签的邻居标签（显式关系 + 共现关系）',
    inputSchema: {
      type: 'object',
      properties: {
        tag_id: { type: 'number', description: '标签 ID' },
        tag_value: { type: 'string', description: '标签值（如果没有 tag_id）' },
        dim_code: { type: 'string', description: '限定维度（与 tag_value 配合使用）' },
        include_relations: { type: 'boolean', description: '是否包含显式关系邻居，默认 true' },
        include_cooccurrence: { type: 'boolean', description: '是否包含共现邻居，默认 true' },
        limit: { type: 'number', description: '返回数量上限，默认 40，最大 200' },
      },
    },
  },
  {
    name: 'lore_db_related_assets',
    description: '通过标签关系查找与某个标签相关的资产',
    inputSchema: {
      type: 'object',
      properties: {
        tag_id: { type: 'number', description: '标签 ID' },
        tag_value: { type: 'string', description: '标签值（如果没有 tag_id）' },
        dim_code: { type: 'string', description: '限定维度（与 tag_value 配合使用）' },
        relation_depth: { type: 'number', description: '关系深度 0-2，默认 1' },
        limit: { type: 'number', description: '返回数量上限，默认 50，最大 200' },
      },
    },
  },
  {
    name: 'lore_db_list_relations',
    description: '列出标签之间的关系',
    inputSchema: {
      type: 'object',
      properties: {
        source_tag_id: { type: 'number', description: '源标签 ID' },
        target_tag_id: { type: 'number', description: '目标标签 ID' },
        rel_type: { type: 'string', description: '关系类型过滤' },
        review_status: { type: 'string', description: '审核状态过滤：pending, approved, rejected, needs_review' },
        limit: { type: 'number', description: '返回数量上限，默认 50，最大 200' },
      },
    },
  },
  {
    name: 'lore_db_relation_evidence',
    description: '读取关系证据详情（包含关联资产）',
    inputSchema: {
      type: 'object',
      properties: {
        rel_id: { type: 'number', description: '关系 ID' },
      },
      required: ['rel_id'],
    },
  },
  {
    name: 'lore_db_list_category_notes',
    description: '列出某个分类的备注',
    inputSchema: {
      type: 'object',
      properties: {
        category_id: { type: 'number', description: '分类 ID' },
      },
      required: ['category_id'],
    },
  },
  {
    name: 'lore_db_search_fts',
    description: 'PostgreSQL全文排名搜索，比ILIKE更快更精准。支持& (AND), | (OR), ! (NOT)布尔运算。中文词之间用&连接。示例: "莱茵&生命" "塞雷娅&实验" "罗德岛|巴别塔"',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'FTS查询。用&做AND, |做OR, !做NOT。单个词也可以。' },
        category: { type: 'string', description: '分类code过滤（可选）' },
        limit: { type: 'number', description: '返回数量上限，默认50，最大200' },
      },
      required: ['query'],
    },
  },
  {
    name: 'lore_db_entity_cooccurrence',
    description: '查找多个实体/关键词同时出现的资产。用于交叉验证：某个声明是否在多个来源中出现？两个角色在哪些故事线中同时登场？支持最少匹配数过滤。',
    inputSchema: {
      type: 'object',
      properties: {
        entities: {
          type: 'array',
          items: { type: 'string' },
          description: '实体名或关键词列表。如 ["莱茵生命", "塞雷娅", "赫默"]',
        },
        min_matches: { type: 'number', description: '最少匹配实体数，默认2。设为1等同于普通搜索。' },
        limit: { type: 'number', description: '返回数量上限，默认50，最大100' },
      },
      required: ['entities'],
    },
  },
  {
    name: 'lore_db_search_stats',
    description: '获取搜索查询的统计信息：按分类分布、叙事层级分布、最相关标签。用于在深入搜索前了解资料全貌，规划搜索策略。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索词' },
        category: { type: 'string', description: '分类过滤（可选）' },
      },
      required: ['query'],
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────

async function handleStatus() {
  try {
    const version = await query('SELECT version() AS version');
    const exists = await query(
      'SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS exists',
      [SCHEMA],
    );
    const schemaExists = exists.rows[0]?.exists;
    let domainCount = 0, assetCount = 0, tagCount = 0, chunkCount = 0;
    if (schemaExists) {
      const counts = await query(
        `SELECT
           (SELECT COUNT(*) FROM ${quoteIdent(SCHEMA)}.domains)::int AS domains,
           (SELECT COUNT(*) FROM ${quoteIdent(SCHEMA)}.assets)::int AS assets,
           (SELECT COUNT(*) FROM ${quoteIdent(SCHEMA)}.tags)::int AS tags`,
      );
      domainCount = counts.rows[0]?.domains || 0;
      assetCount = counts.rows[0]?.assets || 0;
      tagCount = counts.rows[0]?.tags || 0;
      const chunkTable = await query(
        `SELECT to_regclass($1) IS NOT NULL AS exists`,
        [`${SCHEMA}.asset_chunks`],
      );
      if (chunkTable.rows[0]?.exists) {
        const chunks = await query(
          `SELECT COUNT(*)::int AS chunks FROM ${quoteIdent(SCHEMA)}.asset_chunks`,
        );
        chunkCount = chunks.rows[0]?.chunks || 0;
      }
    }
    return {
      ok: true,
      connected: true,
      serverVersion: version.rows[0]?.version,
      schemaExists,
      domainCount,
      assetCount,
      tagCount,
      chunkCount,
    };
  } catch (err) {
    return { ok: false, connected: false, error: err.message };
  }
}

async function handleCategories(args) {
  const domain = args.domain || 'arknights';
  const result = await query(
    `SELECT c.category_id, c.parent_category_id, c.category_code, c.category_name, c.category_kind,
            c.description, c.sort_order,
            (SELECT COUNT(*) FROM ${quoteIdent(SCHEMA)}.category_notes cn WHERE cn.category_id = c.category_id)::int AS note_count
     FROM ${quoteIdent(SCHEMA)}.categories c
     JOIN ${quoteIdent(SCHEMA)}.domains d ON d.domain_id = c.domain_id
     WHERE d.domain_code = $1
     ORDER BY c.parent_category_id NULLS FIRST, c.sort_order, c.category_name`,
    [domain],
  );
  return result.rows;
}

async function handleSearch(args) {
  const domainCode = 'arknights';
  const limit = Math.min(Math.max(Number(args.limit || 50), 1), 200);
  const offset = Math.max(Number(args.offset || 0), 0);
  const includeChildren = args.include_children !== false;
  const schema = quoteIdent(SCHEMA);

  const clauses = [];
  const values = [domainCode];
  clauses.push(`d.domain_code = $1`);

  // Category filter
  if (args.category) {
    values.push(args.category);
    values.push(domainCode);
    if (includeChildren) {
      clauses.push(`c.category_id IN (
        WITH RECURSIVE sub AS (
          SELECT c2.category_id FROM ${schema}.categories c2
          JOIN ${schema}.domains d2 ON d2.domain_id = c2.domain_id
          WHERE c2.category_code = $${values.length - 1} AND d2.domain_code = $${values.length}
          UNION ALL
          SELECT c3.category_id FROM ${schema}.categories c3 JOIN sub s ON c3.parent_category_id = s.category_id
        )
        SELECT category_id FROM sub
      )`);
    } else {
      clauses.push(`c.category_code = $${values.length - 1}`);
    }
  }

  const queryParamIndex = args.query ? values.length + 1 : null;
  if (args.query) {
    values.push(`%${args.query}%`);
    clauses.push(`(a.title ILIKE $${values.length} OR a.subtitle ILIKE $${values.length} OR tc.full_text ILIKE $${values.length})`);
  }
  if (args.tag) {
    values.push(args.tag);
    clauses.push(`EXISTS (
      SELECT 1 FROM ${schema}.asset_tags at
      JOIN ${schema}.tags t ON t.tag_id = at.tag_id
     WHERE at.asset_id = a.asset_id
        AND at.deleted_at IS NULL
        AND (t.tag_value = $${values.length} OR t.canonical = $${values.length})
    )`);
  }

  const whereClause = clauses.join(' AND ');

  // Count
  const countResult = await query(
    `SELECT COUNT(*)::int AS total
     FROM ${schema}.assets a
     JOIN ${schema}.domains d ON d.domain_id = a.domain_id
     LEFT JOIN ${schema}.categories c ON c.category_id = a.category_id
     LEFT JOIN ${schema}.text_contents tc ON tc.asset_id = a.asset_id
     WHERE ${whereClause}`,
    values,
  );
  const total = countResult.rows[0]?.total ?? 0;

  // Order
  let orderClause = 'a.updated_at DESC';
  if (args.query && queryParamIndex !== null) {
    orderClause = `CASE WHEN a.title ILIKE $${queryParamIndex} THEN 0 WHEN a.subtitle ILIKE $${queryParamIndex} THEN 1 ELSE 2 END, a.updated_at DESC`;
  }

  values.push(limit);
  values.push(offset);

  const result = await query(
    `SELECT a.asset_id, a.asset_kind, a.title, a.subtitle, a.external_key,
            a.source_name, a.source_url, a.source_path, a.object_uri,
            a.mime_type, a.language_code, a.created_at, a.updated_at,
            c.category_code, c.category_name,
            tc.carrier_type, tc.character_name, tc.activity_name,
            LEFT(tc.full_text, 120) AS text_preview
     FROM ${schema}.assets a
     JOIN ${schema}.domains d ON d.domain_id = a.domain_id
     LEFT JOIN ${schema}.categories c ON c.category_id = a.category_id
     LEFT JOIN ${schema}.text_contents tc ON tc.asset_id = a.asset_id
     WHERE ${whereClause}
     ORDER BY ${orderClause}
     LIMIT $${values.length - 1}
     OFFSET $${values.length}`,
    values,
  );
  return { rows: result.rows, total };
}

async function handleSearchChunks(args) {
  const domainCode = 'arknights';
  const limit = Math.min(Math.max(Number(args.limit || 20), 1), 100);
  const offset = Math.max(Number(args.offset || 0), 0);
  const schema = quoteIdent(SCHEMA);

  const clauses = [];
  const values = [domainCode];
  clauses.push(`d.domain_code = $1`);
  clauses.push(`ac.deleted_at IS NULL`);

  if (args.category) {
    values.push(args.category);
    values.push(domainCode);
    clauses.push(`c.category_id IN (
      WITH RECURSIVE sub AS (
        SELECT c2.category_id FROM ${schema}.categories c2
        JOIN ${schema}.domains d2 ON d2.domain_id = c2.domain_id
        WHERE c2.category_code = $${values.length - 1} AND d2.domain_code = $${values.length}
        UNION ALL
        SELECT c3.category_id FROM ${schema}.categories c3 JOIN sub s ON c3.parent_category_id = s.category_id
      )
      SELECT category_id FROM sub
    )`);
  }

  if (args.tag) {
    values.push(args.tag);
    clauses.push(`EXISTS (
      SELECT 1 FROM ${schema}.asset_tags at2
      JOIN ${schema}.tags t2 ON t2.tag_id = at2.tag_id
      WHERE at2.asset_id = a.asset_id
        AND at2.deleted_at IS NULL
        AND (t2.tag_value = $${values.length} OR t2.canonical = $${values.length})
    )`);
  }

  const searchTerm = args.query?.trim();
  if (searchTerm) {
    values.push(`%${searchTerm}%`);
    clauses.push(`(
      ac.chunk_text ILIKE $${values.length}
      OR ac.heading ILIKE $${values.length}
      OR EXISTS (
        SELECT 1 FROM ${schema}.assets a2
        WHERE a2.asset_id = a.asset_id AND a2.title ILIKE $${values.length}
      )
    )`);
  }

  const whereClause = clauses.join(' AND ');

  // Count
  const countResult = await query(
    `SELECT COUNT(*)::int AS total
     FROM ${schema}.asset_chunks ac
     JOIN ${schema}.assets a ON a.asset_id = ac.asset_id
     JOIN ${schema}.domains d ON d.domain_id = a.domain_id
     LEFT JOIN ${schema}.categories c ON c.category_id = a.category_id
     WHERE ${whereClause}`,
    values,
  );
  const total = countResult.rows[0]?.total ?? 0;

  values.push(limit);
  values.push(offset);

  const result = await query(
    `SELECT ac.chunk_id, ac.asset_id, ac.chunk_index, ac.heading, ac.speaker,
            ac.start_offset, ac.end_offset, ac.token_estimate,
            LEFT(ac.chunk_text, 300) AS chunk_preview,
            a.title AS asset_title, a.asset_kind,
            c.category_code, c.category_name,
            tc.character_name, tc.activity_name
     FROM ${schema}.asset_chunks ac
     JOIN ${schema}.assets a ON a.asset_id = ac.asset_id
     JOIN ${schema}.domains d ON d.domain_id = a.domain_id
     LEFT JOIN ${schema}.categories c ON c.category_id = a.category_id
     LEFT JOIN ${schema}.text_contents tc ON tc.asset_id = a.asset_id
     WHERE ${whereClause}
     ORDER BY ac.chunk_index
     LIMIT $${values.length - 1}
     OFFSET $${values.length}`,
    values,
  );
  return { rows: result.rows, total };
}

async function handleRead(args) {
  const schema = quoteIdent(SCHEMA);
  const asset = await query(
    `SELECT a.*, c.category_code, c.category_name,
            tc.full_text, tc.char_count, tc.carrier_type, tc.narrative_layer,
            tc.mission_code, tc.character_name, tc.activity_name, tc.item_name,
            tc.skin_name, tc.enemy_name, tc.text_metadata
     FROM ${schema}.assets a
     LEFT JOIN ${schema}.categories c ON c.category_id = a.category_id
     LEFT JOIN ${schema}.text_contents tc ON tc.asset_id = a.asset_id
     WHERE a.asset_id = $1`,
    [args.asset_id],
  );
  if (!asset.rows[0]) return { error: `Asset not found: ${args.asset_id}` };

  const tags = await query(
    `SELECT t.tag_id, td.dim_code, td.dim_name, t.tag_value, t.canonical, t.aliases,
            at.confidence, at.annotated_by, at.review_status, at.evidence, at.note
     FROM ${schema}.asset_tags at
     JOIN ${schema}.tags t ON t.tag_id = at.tag_id
     JOIN ${schema}.tag_dimensions td ON td.dim_id = t.dim_id
     WHERE at.asset_id = $1 AND at.deleted_at IS NULL
     ORDER BY td.sort_order, t.tag_value`,
    [args.asset_id],
  );

  const variants = await query(
    `SELECT * FROM ${schema}.media_variants WHERE asset_id = $1 ORDER BY variant_kind, variant_id`,
    [args.asset_id],
  );

  return { ...asset.rows[0], tags: tags.rows, variants: variants.rows };
}

async function handleReadContext(args) {
  const radius = Math.min(Math.max(Number(args.radius || 2), 0), 10);
  const schema = quoteIdent(SCHEMA);

  const anchor = await query(
    `SELECT asset_id, chunk_index FROM ${schema}.asset_chunks WHERE chunk_id = $1`,
    [args.chunk_id],
  );
  if (!anchor.rows[0]) return { error: `Chunk not found: ${args.chunk_id}` };

  const { asset_id, chunk_index } = anchor.rows[0];

  const asset = await query(
    `SELECT a.asset_id, a.asset_kind, a.title, a.subtitle, a.source_name, a.source_url,
            c.category_code, c.category_name, tc.carrier_type, tc.character_name, tc.activity_name
     FROM ${schema}.assets a
     LEFT JOIN ${schema}.categories c ON c.category_id = a.category_id
     LEFT JOIN ${schema}.text_contents tc ON tc.asset_id = a.asset_id
     WHERE a.asset_id = $1`,
    [asset_id],
  );

  const chunks = await query(
    `SELECT chunk_id, chunk_index, heading, speaker, chunk_text, start_offset, end_offset, token_estimate
     FROM ${schema}.asset_chunks
     WHERE asset_id = $1 AND deleted_at IS NULL AND chunk_index BETWEEN $2 AND $3
     ORDER BY chunk_index`,
    [asset_id, chunk_index - radius, chunk_index + radius],
  );

  return { asset: asset.rows[0] || null, anchorChunkId: args.chunk_id, radius, chunks: chunks.rows };
}

async function handleFindTags(args) {
  const limit = Math.min(Math.max(Number(args.limit || 30), 1), 100);
  const searchTerm = args.query?.trim() || null;
  const schema = quoteIdent(SCHEMA);
  const values = [];
  const clauses = [];

  if (searchTerm) {
    values.push(`%${searchTerm}%`);
    clauses.push(`(
      t.tag_value ILIKE $${values.length}
      OR t.canonical ILIKE $${values.length}
      OR t.description ILIKE $${values.length}
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(t.aliases) a(alias) WHERE a.alias ILIKE $${values.length})
    )`);
  }

  if (args.dim_code?.trim()) {
    values.push(args.dim_code.trim());
    clauses.push(`td.dim_code = $${values.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  values.push(limit);

  const result = await query(
    `SELECT
       t.tag_id, td.dim_code, td.dim_name, t.tag_value, t.canonical, t.aliases,
       t.description, t.doc_count, t.media_count, t.total_asset_count
     FROM ${schema}.tags t
     JOIN ${schema}.tag_dimensions td ON td.dim_id = t.dim_id
     ${where}
     ORDER BY t.total_asset_count DESC, td.sort_order, t.tag_value
     LIMIT $${values.length}`,
    values,
  );
  return result.rows;
}

async function handleSearchByTags(args) {
  const tags = args.tags || [];
  if (!tags.length) return { rows: [], total: 0, error: 'tags required' };

  const mode = args.mode || 'any';
  const limit = Math.min(Math.max(Number(args.limit || 50), 1), 200);
  const schema = quoteIdent(SCHEMA);

  const tagIds = [];
  for (const t of tags) {
    let found;
    if (t.dim_code) {
      found = await query(
        `SELECT t.tag_id FROM ${schema}.tags t
         JOIN ${schema}.tag_dimensions td ON td.dim_id = t.dim_id
         WHERE (t.tag_value = $1 OR t.canonical = $1) AND td.dim_code = $2
         ORDER BY t.total_asset_count DESC LIMIT 1`,
        [t.value, t.dim_code],
      );
    } else {
      found = await query(
        `SELECT t.tag_id FROM ${schema}.tags t
         WHERE t.tag_value = $1 OR t.canonical = $1
         ORDER BY t.total_asset_count DESC LIMIT 1`,
        [t.value],
      );
    }
    if (found.rows[0]) tagIds.push(found.rows[0].tag_id);
  }

  if (!tagIds.length) return { rows: [], total: 0, hint: 'No matching tags found' };

  const havingClause = mode === 'all'
    ? `HAVING COUNT(DISTINCT at.tag_id) = ${tagIds.length}`
    : '';

  const result = await query(
    `SELECT a.asset_id, a.asset_kind, a.title, a.subtitle, a.source_name,
            c.category_code, c.category_name,
            tc.carrier_type, tc.character_name, tc.activity_name,
            LEFT(tc.full_text, 120) AS text_preview,
            COUNT(DISTINCT at.tag_id)::int AS matched_tag_count
     FROM ${schema}.asset_tags at
     JOIN ${schema}.assets a ON a.asset_id = at.asset_id
     LEFT JOIN ${schema}.categories c ON c.category_id = a.category_id
     LEFT JOIN ${schema}.text_contents tc ON tc.asset_id = a.asset_id
     WHERE at.tag_id = ANY($1) AND at.review_status <> 'rejected' AND at.deleted_at IS NULL
     GROUP BY a.asset_id, a.asset_kind, a.title, a.subtitle, a.source_name,
              c.category_code, c.category_name, tc.carrier_type, tc.character_name, tc.activity_name, tc.full_text
     ${havingClause}
     ORDER BY COUNT(DISTINCT at.tag_id) DESC, a.updated_at DESC
     LIMIT $2`,
    [tagIds, limit],
  );

  return {
    rows: result.rows,
    total: result.rows.length,
    matched_tag_ids: tagIds,
    mode,
  };
}

async function handleTagNeighbors(args) {
  const limit = Math.min(Math.max(Number(args.limit || 40), 1), 200);
  const includeRelations = args.include_relations !== false;
  const includeCooccurrence = args.include_cooccurrence !== false;
  const schema = quoteIdent(SCHEMA);

  let selector = '';
  const values = [];
  if (args.tag_id) {
    values.push(args.tag_id);
    selector = `t.tag_id = $1`;
  } else if (args.tag_value?.trim()) {
    values.push(args.tag_value.trim());
    selector = `(t.tag_value = $1 OR t.canonical = $1)`;
    if (args.dim_code?.trim()) {
      values.push(args.dim_code.trim());
      selector += ` AND td.dim_code = $2`;
    }
  } else {
    return { tag: null, relations: [], cooccurrence: [], error: 'tag_id or tag_value required' };
  }

  const tagResult = await query(
    `SELECT t.tag_id, td.dim_code, td.dim_name, t.tag_value, t.canonical, t.aliases,
            t.description, t.doc_count, t.media_count, t.total_asset_count
     FROM ${schema}.tags t
     JOIN ${schema}.tag_dimensions td ON td.dim_id = t.dim_id
     WHERE ${selector}
     ORDER BY t.total_asset_count DESC, t.tag_value
     LIMIT 1`,
    values,
  );
  const tag = tagResult.rows[0];
  if (!tag?.tag_id) return { tag: null, relations: [], cooccurrence: [] };

  const relValues = [tag.tag_id];
  if (args.rel_type?.trim()) {
    relValues.push(args.rel_type.trim());
  }
  relValues.push(limit);

  let relations = [];
  if (includeRelations) {
    relations = (await query(
      `SELECT tr.rel_id, tr.rel_type, tr.is_bidirectional, tr.confidence,
              tr.review_status, tr.evidence,
              CASE WHEN tr.source_tag_id = $1 THEN 'target' ELSE 'source' END AS direction,
              CASE WHEN tr.source_tag_id = $1 THEN tt.tag_id ELSE st.tag_id END AS neighbor_tag_id,
              CASE WHEN tr.source_tag_id = $1 THEN tt.tag_value ELSE st.tag_value END AS neighbor_tag_value,
              CASE WHEN tr.source_tag_id = $1 THEN ttd.dim_code ELSE std.dim_code END AS neighbor_dim_code
       FROM ${schema}.tag_relations tr
       JOIN ${schema}.tags st ON st.tag_id = tr.source_tag_id
       JOIN ${schema}.tag_dimensions std ON std.dim_id = st.dim_id
       JOIN ${schema}.tags tt ON tt.tag_id = tr.target_tag_id
       JOIN ${schema}.tag_dimensions ttd ON ttd.dim_id = tt.dim_id
       WHERE (tr.source_tag_id = $1 OR tr.target_tag_id = $1)
       ${args.rel_type?.trim() ? `AND tr.rel_type = $2` : ''}
       AND tr.review_status <> 'rejected'
       ORDER BY tr.confidence DESC, tr.updated_at DESC
       LIMIT $${relValues.length}`,
      relValues,
    )).rows;
  }

  let cooccurrence = [];
  if (includeCooccurrence) {
    cooccurrence = (await query(
      `SELECT CASE WHEN tc.tag_a_id = $1 THEN tc.tag_b_id ELSE tc.tag_a_id END AS neighbor_tag_id,
              t.tag_value AS neighbor_tag_value, td.dim_code AS neighbor_dim_code,
              tc.cooccurrence_count, tc.normalized_score
       FROM ${schema}.tag_cooccurrence tc
       JOIN ${schema}.tags t ON t.tag_id = CASE WHEN tc.tag_a_id = $1 THEN tc.tag_b_id ELSE tc.tag_a_id END
       JOIN ${schema}.tag_dimensions td ON td.dim_id = t.dim_id
       WHERE (tc.tag_a_id = $1 OR tc.tag_b_id = $1)
       ORDER BY tc.normalized_score DESC
       LIMIT $2`,
      [tag.tag_id, limit],
    )).rows;
  }

  return { tag, relations, cooccurrence };
}

async function handleRelatedAssets(args) {
  const limit = Math.min(Math.max(Number(args.limit || 50), 1), 200);
  const relationDepth = Math.min(Math.max(Number(args.relation_depth ?? 1), 0), 2);
  const schema = quoteIdent(SCHEMA);

  let selector = '';
  const values = [];
  if (args.tag_id) {
    values.push(args.tag_id);
    selector = `t.tag_id = $1`;
  } else if (args.tag_value?.trim()) {
    values.push(args.tag_value.trim());
    selector = `(t.tag_value = $1 OR t.canonical = $1)`;
    if (args.dim_code?.trim()) {
      values.push(args.dim_code.trim());
      selector += ` AND td.dim_code = $2`;
    }
  } else {
    return { rows: [], total: 0, error: 'tag_id or tag_value required' };
  }

  values.push(limit);
  const result = await query(
    `WITH RECURSIVE root_tag AS (
       SELECT t.tag_id
       FROM ${schema}.tags t
       JOIN ${schema}.tag_dimensions td ON td.dim_id = t.dim_id
       WHERE ${selector}
       ORDER BY t.total_asset_count DESC, t.tag_value
       LIMIT 1
     ),
     expanded_tags(tag_id, depth) AS (
       SELECT tag_id, 0 FROM root_tag
       UNION
       SELECT neighbors.neighbor_tag_id AS tag_id, et.depth + 1
       FROM expanded_tags et
       JOIN LATERAL (
          SELECT CASE WHEN tr.source_tag_id = et.tag_id THEN tr.target_tag_id ELSE tr.source_tag_id END AS neighbor_tag_id
          FROM ${schema}.tag_relations tr
          WHERE (tr.source_tag_id = et.tag_id OR tr.target_tag_id = et.tag_id)
            AND tr.review_status <> 'rejected'
          UNION
          SELECT CASE WHEN tc.tag_a_id = et.tag_id THEN tc.tag_b_id ELSE tc.tag_a_id END AS neighbor_tag_id
          FROM ${schema}.tag_cooccurrence tc
          WHERE tc.tag_a_id = et.tag_id OR tc.tag_b_id = et.tag_id
       ) neighbors ON TRUE
       WHERE et.depth < ${relationDepth}
     ),
     ranked_assets AS (
       SELECT at.asset_id, MIN(et.depth)::int AS relation_depth, COUNT(DISTINCT et.tag_id)::int AS matched_tag_count
       FROM ${schema}.asset_tags at
       JOIN expanded_tags et ON et.tag_id = at.tag_id
       WHERE at.review_status <> 'rejected' AND at.deleted_at IS NULL
       GROUP BY at.asset_id
     )
     SELECT
       a.asset_id, a.asset_kind, a.title, a.subtitle, a.source_name, a.source_url,
       c.category_code, c.category_name,
       tc.carrier_type, tc.character_name, tc.activity_name,
       LEFT(tc.full_text, 120) AS text_preview,
       ra.relation_depth, ra.matched_tag_count
     FROM ranked_assets ra
     JOIN ${schema}.assets a ON a.asset_id = ra.asset_id
     LEFT JOIN ${schema}.categories c ON c.category_id = a.category_id
     LEFT JOIN ${schema}.text_contents tc ON tc.asset_id = a.asset_id
     ORDER BY ra.relation_depth, ra.matched_tag_count DESC
     LIMIT $${values.length}`,
    values,
  );
  return { rows: result.rows, total: result.rows.length };
}

async function handleListRelations(args) {
  const limit = Math.min(Math.max(Number(args.limit || 50), 1), 200);
  const schema = quoteIdent(SCHEMA);
  const values = [];
  const clauses = [];

  if (args.source_tag_id) {
    values.push(args.source_tag_id);
    clauses.push(`tr.source_tag_id = $${values.length}`);
  }
  if (args.target_tag_id) {
    values.push(args.target_tag_id);
    clauses.push(`tr.target_tag_id = $${values.length}`);
  }
  if (args.rel_type) {
    values.push(args.rel_type);
    clauses.push(`tr.rel_type = $${values.length}`);
  }
  if (args.review_status) {
    values.push(args.review_status);
    clauses.push(`tr.review_status = $${values.length}`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  values.push(limit);

  const result = await query(
    `SELECT tr.*,
            st.tag_value AS source_tag_value, st.canonical AS source_canonical,
            tt.tag_value AS target_tag_value, tt.canonical AS target_canonical
     FROM ${schema}.tag_relations tr
     JOIN ${schema}.tags st ON st.tag_id = tr.source_tag_id
     JOIN ${schema}.tags tt ON tt.tag_id = tr.target_tag_id
     ${where}
     ORDER BY tr.updated_at DESC
     LIMIT $${values.length}`,
    values,
  );
  return result.rows;
}

async function handleRelationEvidence(args) {
  const schema = quoteIdent(SCHEMA);
  const result = await query(
    `WITH relation AS (
       SELECT tr.*,
              st.tag_value AS source_tag_value, std.dim_code AS source_dim_code,
              tt.tag_value AS target_tag_value, ttd.dim_code AS target_dim_code
       FROM ${schema}.tag_relations tr
       JOIN ${schema}.tags st ON st.tag_id = tr.source_tag_id
       JOIN ${schema}.tag_dimensions std ON std.dim_id = st.dim_id
       JOIN ${schema}.tags tt ON tt.tag_id = tr.target_tag_id
       JOIN ${schema}.tag_dimensions ttd ON ttd.dim_id = tt.dim_id
       WHERE tr.rel_id = $1
     )
     SELECT r.*,
            COALESCE(jsonb_agg(jsonb_build_object(
              'asset_id', a.asset_id,
              'title', a.title,
              'subtitle', a.subtitle,
              'category_code', c.category_code,
              'category_name', c.category_name,
              'source_name', a.source_name,
              'source_url', a.source_url,
              'carrier_type', tc.carrier_type,
              'text_preview', LEFT(tc.full_text, 700)
            ) ORDER BY evidence_asset.ordinality) FILTER (WHERE a.asset_id IS NOT NULL), '[]'::jsonb) AS evidence_assets
     FROM relation r
     LEFT JOIN LATERAL unnest(r.evidence_asset_ids) WITH ORDINALITY AS evidence_asset(asset_id, ordinality) ON TRUE
     LEFT JOIN ${schema}.assets a ON a.asset_id = evidence_asset.asset_id
     LEFT JOIN ${schema}.categories c ON c.category_id = a.category_id
     LEFT JOIN ${schema}.text_contents tc ON tc.asset_id = a.asset_id
     GROUP BY r.rel_id, r.source_tag_id, r.target_tag_id, r.rel_type, r.is_bidirectional,
              r.confidence, r.annotated_by, r.review_status, r.evidence,
              r.evidence_asset_ids, r.properties, r.created_at, r.updated_at,
              r.source_tag_value, r.source_dim_code, r.target_tag_value, r.target_dim_code`,
    [args.rel_id],
  );
  return result.rows[0] || null;
}

async function handleListCategoryNotes(args) {
  const schema = quoteIdent(SCHEMA);
  const result = await query(
    `SELECT note_id, category_id, content, author, created_at, updated_at
     FROM ${schema}.category_notes
     WHERE category_id = $1
     ORDER BY created_at ASC`,
    [args.category_id],
  );
  return result.rows;
}

// ── New handlers (search upgrade) ───────────────────────────────────────────

async function handleSearchFTS(args) {
  const domainCode = 'arknights';
  const limit = Math.min(Math.max(Number(args.limit || 50), 1), 200);
  const schema = quoteIdent(SCHEMA);

  const rawQuery = (args.query || '').trim();
  if (!rawQuery) return { rows: [], total: 0 };

  // Use jieba tokens for FTS, but keep the tsquery parser away from raw user
  // syntax. to_tsquery treats punctuation/operators inside tokens as syntax and
  // can raise PostgreSQL errors for ordinary mixed-language questions.
  const tokens = tokenizeCJK(rawQuery);
  const ftsQuery = buildWebsearchQuery(tokens, rawQuery);

  const values = [ftsQuery, domainCode];
  const catClause = [];
  if (args.category) {
    values.push(args.category);
    values.push(domainCode);
    catClause.push(`c.category_id IN (
      WITH RECURSIVE sub AS (
        SELECT c2.category_id FROM ${schema}.categories c2
        JOIN ${schema}.domains d2 ON d2.domain_id = c2.domain_id
        WHERE c2.category_code = $${values.length - 1} AND d2.domain_code = $${values.length}
        UNION ALL
        SELECT c3.category_id FROM ${schema}.categories c3 JOIN sub s ON c3.parent_category_id = s.category_id
      )
      SELECT category_id FROM sub
    )`);
  }
  const catJoin = catClause.length ? `AND ${catClause.join(' AND ')}` : '';

  values.push(limit);

  const result = await query(
    `WITH query_ts AS (SELECT websearch_to_tsquery('simple', $1) AS q)
     SELECT a.asset_id, a.asset_kind, a.title, a.subtitle, a.source_name,
            c.category_code, c.category_name,
            tc.carrier_type, tc.character_name, tc.activity_name,
            LEFT(COALESCE(tc.full_text, ''), 200) AS text_preview,
            GREATEST(
              COALESCE(ts_rank(to_tsvector('simple', COALESCE(a.title, '') || ' ' || COALESCE(a.subtitle, '')), qt.q), 0),
              COALESCE(ts_rank(tc.search_vector, qt.q), 0)
            ) AS rank
     FROM ${schema}.assets a
     JOIN ${schema}.domains d ON d.domain_id = a.domain_id
     LEFT JOIN ${schema}.categories c ON c.category_id = a.category_id
     LEFT JOIN ${schema}.text_contents tc ON tc.asset_id = a.asset_id
     CROSS JOIN query_ts qt
     WHERE d.domain_code = $2
       AND (to_tsvector('simple', COALESCE(a.title, '') || ' ' || COALESCE(a.subtitle, '')) @@ qt.q OR tc.search_vector @@ qt.q)
       ${catJoin}
     ORDER BY rank DESC
     LIMIT $${values.length}`,
    values,
  );
  return { rows: result.rows, total: result.rows.length };
}

async function handleEntityCooccurrence(args) {
  const entities = args.entities || [];
  if (entities.length < 1) return { rows: [], total: 0, error: 'At least one entity required' };
  if (entities.length === 1) {
    // Fall back to regular search
    return handleSearch({ query: entities[0], limit: args.limit || 50 });
  }

  const minMatches = Math.max(Number(args.min_matches || 2), 1);
  const limit = Math.min(Math.max(Number(args.limit || 50), 1), 100);
  const schema = quoteIdent(SCHEMA);

  // For each entity, find matching asset_ids, then find intersection
  const entityAssetIds = [];
  for (const entity of entities) {
    const result = await query(
      `SELECT DISTINCT a.asset_id
       FROM ${schema}.assets a
       LEFT JOIN ${schema}.text_contents tc ON tc.asset_id = a.asset_id
       LEFT JOIN ${schema}.asset_chunks ac ON ac.asset_id = a.asset_id
       WHERE a.title ILIKE $1 OR a.subtitle ILIKE $1 OR tc.full_text ILIKE $1 OR (ac.deleted_at IS NULL AND ac.chunk_text ILIKE $1)`,
      [`%${entity}%`],
    );
    entityAssetIds.push(new Set(result.rows.map(r => r.asset_id)));
  }

  // Count matches per asset
  const matchCounts = new Map();
  for (const idSet of entityAssetIds) {
    for (const id of idSet) {
      matchCounts.set(id, (matchCounts.get(id) || 0) + 1);
    }
  }

  // Filter by min_matches
  const qualifiedIds = [...matchCounts.entries()]
    .filter(([, count]) => count >= minMatches)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);

  if (!qualifiedIds.length) return { rows: [], total: 0, hint: 'No assets match the required number of entities' };

  const result = await query(
    `SELECT a.asset_id, a.asset_kind, a.title, a.subtitle, a.source_name,
            c.category_code, c.category_name,
            tc.carrier_type, tc.character_name, tc.activity_name,
            LEFT(tc.full_text, 120) AS text_preview
     FROM ${schema}.assets a
     LEFT JOIN ${schema}.categories c ON c.category_id = a.category_id
     LEFT JOIN ${schema}.text_contents tc ON tc.asset_id = a.asset_id
     WHERE a.asset_id = ANY($1)
     ORDER BY a.updated_at DESC`,
    [qualifiedIds],
  );

  return { rows: result.rows, total: result.rows.length, matched_entities: entities.length, min_matches: minMatches };
}

async function handleSearchStats(args) {
  const rawQuery = (args.query || '').trim();
  if (!rawQuery) return { total: 0, byCategory: [], byNarrativeLayer: [], topTags: [] };

  const schema = quoteIdent(SCHEMA);
  const searchTerm = `%${rawQuery}%`;

  // Total match count
  const totalRes = await query(
    `SELECT COUNT(DISTINCT a.asset_id)::int AS total
     FROM ${schema}.assets a
     LEFT JOIN ${schema}.text_contents tc ON tc.asset_id = a.asset_id
     LEFT JOIN ${schema}.asset_chunks ac ON ac.asset_id = a.asset_id
     WHERE a.title ILIKE $1 OR a.subtitle ILIKE $1 OR tc.full_text ILIKE $1 OR (ac.deleted_at IS NULL AND ac.chunk_text ILIKE $1)`,
    [searchTerm],
  );

  // By category
  const byCat = await query(
    `SELECT c.category_code, c.category_name, COUNT(DISTINCT a.asset_id)::int AS count
     FROM ${schema}.assets a
     LEFT JOIN ${schema}.text_contents tc ON tc.asset_id = a.asset_id
     LEFT JOIN ${schema}.asset_chunks ac ON ac.asset_id = a.asset_id
     LEFT JOIN ${schema}.categories c ON c.category_id = a.category_id
     WHERE a.title ILIKE $1 OR a.subtitle ILIKE $1 OR tc.full_text ILIKE $1 OR (ac.deleted_at IS NULL AND ac.chunk_text ILIKE $1)
     GROUP BY c.category_code, c.category_name
     ORDER BY count DESC
     LIMIT 20`,
    [searchTerm],
  );

  // By narrative layer
  const byLayer = await query(
    `SELECT tc.narrative_layer, COUNT(DISTINCT a.asset_id)::int AS count
     FROM ${schema}.assets a
     JOIN ${schema}.text_contents tc ON tc.asset_id = a.asset_id
     WHERE tc.full_text ILIKE $1
     GROUP BY tc.narrative_layer
     ORDER BY count DESC`,
    [searchTerm],
  );

  // Top tags
  const topTags = await query(
    `SELECT t.tag_value, td.dim_code, COUNT(DISTINCT a.asset_id)::int AS count
     FROM ${schema}.assets a
     LEFT JOIN ${schema}.text_contents tc ON tc.asset_id = a.asset_id
     LEFT JOIN ${schema}.asset_chunks ac ON ac.asset_id = a.asset_id
     JOIN ${schema}.asset_tags at2 ON at2.asset_id = a.asset_id AND at2.review_status <> 'rejected'
     JOIN ${schema}.tags t ON t.tag_id = at2.tag_id
     JOIN ${schema}.tag_dimensions td ON td.dim_id = t.dim_id
     WHERE a.title ILIKE $1 OR a.subtitle ILIKE $1 OR tc.full_text ILIKE $1 OR (ac.deleted_at IS NULL AND ac.chunk_text ILIKE $1)
     GROUP BY t.tag_value, td.dim_code
     ORDER BY count DESC
     LIMIT 30`,
    [searchTerm],
  );

  return {
    total: totalRes.rows[0]?.total || 0,
    byCategory: byCat.rows,
    byNarrativeLayer: byLayer.rows,
    topTags: topTags.rows,
  };
}

// ── Server ────────────────────────────────────────────────────────────────
const server = new Server(
  { name: 'lore-db-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result;
    switch (name) {
      case 'lore_db_status': result = await handleStatus(); break;
      case 'lore_db_categories': result = await handleCategories(args); break;
      case 'lore_db_search': result = await handleSearch(args); break;
      case 'lore_db_search_chunks': result = await handleSearchChunks(args); break;
      case 'lore_db_read': result = await handleRead(args); break;
      case 'lore_db_read_context': result = await handleReadContext(args); break;
      case 'lore_db_find_tags': result = await handleFindTags(args); break;
      case 'lore_db_search_by_tags': result = await handleSearchByTags(args); break;
      case 'lore_db_tag_neighbors': result = await handleTagNeighbors(args); break;
      case 'lore_db_related_assets': result = await handleRelatedAssets(args); break;
      case 'lore_db_list_relations': result = await handleListRelations(args); break;
      case 'lore_db_relation_evidence': result = await handleRelationEvidence(args); break;
      case 'lore_db_list_category_notes': result = await handleListCategoryNotes(args); break;
      case 'lore_db_search_fts': result = await handleSearchFTS(args); break;
      case 'lore_db_entity_cooccurrence': result = await handleEntityCooccurrence(args); break;
      case 'lore_db_search_stats': result = await handleSearchStats(args); break;
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('lore-db-mcp server started');

  ensureJieba().catch((err) => {
    console.error('jieba initialization failed:', err.message);
  });

  if (process.env.LORE_DB_RUN_MAINTENANCE === '1') {
    Promise.resolve()
      .then(() => runMigrations())
      .then(() => rebuildSearchVectors())
      .catch((err) => {
        console.error('Background database maintenance failed:', err.message);
      });
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
