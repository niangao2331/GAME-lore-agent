#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import pg from 'pg';

const { Pool } = pg;

const DB_CONFIG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'lore_db',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  ssl: false,
};

let pool = null;

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

async function query(sql, params = []) {
  const client = await getPool().connect();
  try {
    await client.query('SET search_path TO public');
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

function clampLimit(value, fallback, max) {
  return Math.min(Math.max(Number(value || fallback), 1), max);
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringArray(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,，、;；|/]+/).map(v => v.trim()).filter(Boolean);
  }
  return null;
}

function smallintArray(value) {
  const raw = Array.isArray(value) ? value : (value == null ? [] : [value]);
  const arr = raw.map(Number).filter(v => Number.isInteger(v) && v >= 1 && v <= 5);
  return arr.length ? arr : null;
}

function documentIdFromArgs(args) {
  return numberOrNull(args.document_id ?? args.asset_id);
}

function unitIdFromArgs(args) {
  return numberOrNull(args.unit_id ?? args.chunk_id);
}

function termsForBrowse(rawQuery) {
  const terms = String(rawQuery || '')
    .split(/[\s,，、。；;|/&]+/)
    .map(t => t.trim())
    .filter(Boolean)
    .map(t => `%${t}%`);
  return terms.length ? terms : null;
}

const documentSelect = `
  d.document_id,
  d.document_id AS asset_id,
  d.external_key,
  d.title,
  d.subtitle,
  d.source_name,
  d.source_uri,
  d.source_uri AS source_url,
  d.source_tier,
  d.content_type,
  d.canon_status,
  d.perspective_scope,
  d.metadata,
  d.review_status,
  d.ai_usage_notes,
  d.created_at,
  d.updated_at,
  d.metadata->>'top_group' AS top_group,
  d.metadata->>'group_name' AS group_name,
  d.metadata->'story_path' AS story_path,
  d.metadata->>'operator_name' AS operator_name,
  d.metadata->>'operator_summary' AS operator_summary
`;

async function relationInfo(name) {
  const result = await query(
    `SELECT c.relkind
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = $1`,
    [name],
  );
  const relkind = result.rows[0]?.relkind || null;
  return {
    exists: Boolean(relkind),
    kind: relkind === 'm' ? 'materialized_view' : relkind === 'v' ? 'view' : relkind === 'r' ? 'table' : relkind,
  };
}

async function tableCount(name) {
  const info = await relationInfo(name);
  if (!info.exists) return null;
  const result = await query(`SELECT COUNT(*)::int AS count FROM ${name}`);
  return result.rows[0]?.count ?? 0;
}

async function columnExists(table, column) {
  const result = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return result.rowCount > 0;
}

async function missingSearchVectors(table) {
  const info = await relationInfo(table);
  if (!info.exists) return null;
  if (!(await columnExists(table, 'search_vector'))) return null;
  const result = await query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE search_vector IS NULL`);
  return result.rows[0]?.count ?? 0;
}

async function getCacheHealth(baseCounts = null) {
  const counts = baseCounts || (await query(`
    SELECT
      current_database() AS database,
      (SELECT COUNT(*) FROM documents)::int AS documents,
      (SELECT COUNT(*) FROM text_units)::int AS text_units,
      (SELECT COUNT(*) FROM entities)::int AS entities,
      (SELECT COUNT(*) FROM entity_aliases)::int AS entity_aliases,
      (SELECT COUNT(*) FROM entity_mentions)::int AS entity_mentions,
      to_regproc('public.search_evidence_optimized') IS NOT NULL AS has_search_evidence_optimized,
      to_regproc('public.browse_tree_optimized') IS NOT NULL AS has_browse_tree_optimized,
      to_regclass('public.document_stats') IS NOT NULL AS has_document_stats
  `)).rows[0];

  const browseRelation = await relationInfo('document_stats');
  const browseRows = browseRelation.exists ? await tableCount('document_stats') : null;
  const documentVectorsMissing = await missingSearchVectors('documents');
  const textUnitVectorsMissing = await missingSearchVectors('text_units');
  const warnings = [];
  const recommendedActions = [];

  if (counts.documents > 0 && browseRelation.exists && browseRows === 0) {
    warnings.push('browse_cache_empty_but_documents_exist');
    recommendedActions.push('refresh_document_stats');
  }
  if (counts.documents > 0 && documentVectorsMissing > 0) {
    warnings.push('document_search_vectors_missing');
    recommendedActions.push('rebuild_search_vectors');
  }
  if (counts.text_units > 0 && textUnitVectorsMissing > 0) {
    warnings.push('text_unit_search_vectors_missing');
    recommendedActions.push('rebuild_search_vectors');
  }
  if (!counts.has_search_evidence_optimized) warnings.push('optimized_search_function_missing');
  if (!counts.has_browse_tree_optimized) warnings.push('optimized_browse_function_missing');

  return {
    tables: {
      documents: counts.documents,
      text_units: counts.text_units,
      entities: counts.entities,
      entity_aliases: counts.entity_aliases,
      entity_mentions: counts.entity_mentions,
    },
    search: {
      has_search_function: counts.has_search_evidence_optimized,
      has_browse_function: counts.has_browse_tree_optimized,
      document_vectors_missing: documentVectorsMissing,
      text_unit_vectors_missing: textUnitVectorsMissing,
    },
    browse_cache: {
      exists: browseRelation.exists,
      kind: browseRelation.kind,
      rows: browseRows,
      healthy: !(counts.documents > 0 && browseRelation.exists && browseRows === 0),
    },
    warnings,
    recommended_actions: [...new Set(recommendedActions)],
    healthy: warnings.length === 0,
  };
}

const TOOLS = [
  {
    name: 'lore_db_status',
    description: 'Get database connection status and document/text unit/entity counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lore_db_categories',
    description: 'Browse new lore document groups from document_stats. This replaces legacy category browsing.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional terms used to count relevant text units.' },
        source_tiers: { type: 'array', items: { type: 'number' }, description: 'Optional source tiers, e.g. [1,2].' },
        content_types: { type: 'array', items: { type: 'string' }, description: 'Optional document content types.' },
        top_groups: { type: 'array', items: { type: 'string' }, description: 'Optional top-level groups.' },
        group_names: { type: 'array', items: { type: 'string' }, description: 'Optional group names.' },
        only_relevant: { type: 'boolean', description: 'When query is set, return only documents with relevant units.' },
        limit: { type: 'number', description: 'Default 100, max 300.' },
      },
    },
  },
  {
    name: 'lore_db_search',
    description: 'Search lore database documents and text units. Returns document_id/unit_id plus legacy aliases asset_id/chunk_id.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms matched against title, metadata, headings, summaries, and text.' },
        source_tiers: { type: 'array', items: { type: 'number' } },
        content_types: { type: 'array', items: { type: 'string' } },
        top_groups: { type: 'array', items: { type: 'string' } },
        group_names: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number', description: 'Default 50, max 200.' },
        offset: { type: 'number', description: 'Default 0.' },
      },
    },
  },
  {
    name: 'lore_db_search_chunks',
    description: 'Search text_units for passage-level evidence. Returns unit_id and chunk_id compatibility alias.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms.' },
        document_id: { type: 'number', description: 'Optional new document id.' },
        asset_id: { type: 'number', description: 'Compatibility alias for document_id.' },
        source_tiers: { type: 'array', items: { type: 'number' } },
        content_types: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number', description: 'Default 20, max 100.' },
        offset: { type: 'number', description: 'Default 0.' },
        browse: { type: 'boolean', description: 'Set true to intentionally list chunks without a query.' },
        list_recent: { type: 'boolean', description: 'Alias for browse.' },
      },
    },
  },
  {
    name: 'lore_db_read',
    description: 'Read one document from the lore database with all text_units. asset_id is accepted as document_id alias.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: { type: 'number', description: 'New document id.' },
        asset_id: { type: 'number', description: 'Compatibility alias for document_id.' },
        include_units: { type: 'boolean', description: 'Default true.' },
      },
    },
  },
  {
    name: 'lore_db_read_context',
    description: 'Read text_units around a unit_id. chunk_id is accepted as unit_id alias.',
    inputSchema: {
      type: 'object',
      properties: {
        unit_id: { type: 'number', description: 'New text unit id.' },
        chunk_id: { type: 'number', description: 'Compatibility alias for unit_id.' },
        radius: { type: 'number', description: 'Default 2, max 10.' },
      },
    },
  },
  {
    name: 'lore_db_find_tags',
    description: 'Resolve entities and aliases. This replaces legacy tag lookup.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Entity name or alias.' },
        entity_type: { type: 'string', description: 'Optional entity type filter.' },
        dim_code: { type: 'string', description: 'Compatibility alias for entity_type.' },
        limit: { type: 'number', description: 'Default 30, max 100.' },
      },
    },
  },
  {
    name: 'lore_db_search_by_tags',
    description: 'Find documents by entity names or aliases. tags are interpreted as entities.',
    inputSchema: {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              value: { type: 'string' },
              entity_id: { type: 'number' },
              dim_code: { type: 'string' },
              entity_type: { type: 'string' },
            },
          },
        },
        mode: { type: 'string', description: 'all or any. Default any.' },
        limit: { type: 'number', description: 'Default 50, max 200.' },
      },
      required: ['tags'],
    },
  },
  {
    name: 'lore_db_search_fts',
    description: 'Ranked evidence search backed by search_evidence_optimized on the lore database.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms. Operators such as & are tolerated as separators.' },
        source_tiers: { type: 'array', items: { type: 'number' } },
        content_types: { type: 'array', items: { type: 'string' } },
        document_ids: { type: 'array', items: { type: 'number' } },
        group_names: { type: 'array', items: { type: 'string' } },
        top_groups: { type: 'array', items: { type: 'string' } },
        title_contains: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number', description: 'Default 50, max 200.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'lore_db_entity_cooccurrence',
    description: 'Find documents where multiple entity names/aliases co-occur.',
    inputSchema: {
      type: 'object',
      properties: {
        entities: { type: 'array', items: { type: 'string' } },
        min_matches: { type: 'number', description: 'Default 2.' },
        limit: { type: 'number', description: 'Default 50, max 100.' },
      },
      required: ['entities'],
    },
  },
  {
    name: 'lore_db_search_stats',
    description: 'Return summary counts for a query across documents, content types, tiers, groups, and entities.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms.' },
        limit: { type: 'number', description: 'Default 30, max 100.' },
      },
    },
  },
];

async function handleStatus() {
  const counts = await query(`
    SELECT
      current_database() AS database,
      (SELECT COUNT(*) FROM documents)::int AS documents,
      (SELECT COUNT(*) FROM text_units)::int AS text_units,
      (SELECT COUNT(*) FROM entities)::int AS entities,
      (SELECT COUNT(*) FROM entity_aliases)::int AS entity_aliases,
      (SELECT COUNT(*) FROM entity_mentions)::int AS entity_mentions,
      to_regproc('public.search_evidence_optimized') IS NOT NULL AS has_search_evidence_optimized,
      to_regproc('public.browse_tree_optimized') IS NOT NULL AS has_browse_tree_optimized,
      to_regclass('public.document_stats') IS NOT NULL AS has_document_stats
  `);
  const row = counts.rows[0];
  return {
    ok: true,
    runtime: DB_CONFIG.database || 'lore_db',
    legacy_runtime_disabled: true,
    tools: TOOLS.map(t => t.name),
    ...row,
    cache_health: await getCacheHealth(row),
  };
}

async function handleCategories(args = {}) {
  const limit = clampLimit(args.limit, 100, 300);
  const health = await getCacheHealth();
  if (health.tables.documents > 0 && health.browse_cache.exists && !health.browse_cache.healthy) {
    return {
      rows: [],
      total: 0,
      warning: 'browse_cache_empty_but_documents_exist',
      recommended_action: 'refresh_document_stats',
      cache_health: health,
    };
  }
  const result = await query(
    `SELECT * FROM browse_tree_optimized($1::text[], $2::smallint[], $3::text[], $4::text[], $5::text[], $6::boolean, $7::integer)`,
    [
      termsForBrowse(args.query),
      smallintArray(args.source_tiers),
      stringArray(args.content_types),
      stringArray(args.top_groups),
      stringArray(args.group_names),
      Boolean(args.only_relevant),
      limit,
    ],
  );
  return { rows: result.rows, total: result.rows.length, cache_health: health };
}

async function handleSearchFTS(args = {}) {
  const rawQuery = String(args.query || '').trim();
  if (!rawQuery) return { rows: [], total: 0 };
  const limit = clampLimit(args.limit, 50, 200);
  const result = await query(
    `SELECT *, document_id AS asset_id, unit_id AS chunk_id
     FROM search_evidence_optimized($1::text, $2::smallint[], $3::text[], $4::bigint[], $5::text[], $6::text[], $7::text[], $8::integer)`,
    [
      rawQuery,
      smallintArray(args.source_tiers),
      stringArray(args.content_types),
      Array.isArray(args.document_ids) ? args.document_ids.map(Number).filter(Number.isFinite) : null,
      stringArray(args.group_names),
      stringArray(args.top_groups),
      stringArray(args.title_contains),
      limit,
    ],
  );
  return { rows: result.rows, total: result.rows.length };
}

async function handleSearch(args = {}) {
  const rawQuery = String(args.query || '').trim();
  if (!rawQuery) return handleCategories({ ...args, only_relevant: false, limit: args.limit || 50 });

  const offset = Math.max(Number(args.offset || 0), 0);
  const limit = clampLimit(args.limit, 50, 200);
  const values = [
    rawQuery,
    smallintArray(args.source_tiers),
    stringArray(args.content_types),
    stringArray(args.top_groups),
    stringArray(args.group_names),
    limit,
    offset,
  ];
  const result = await query(
    `WITH evidence AS (
       SELECT *
       FROM search_evidence_optimized($1::text, $2::smallint[], $3::text[], NULL::bigint[], $5::text[], $4::text[], NULL::text[], $6::integer + $7::integer + 25)
     ),
     ranked AS (
       SELECT DISTINCT ON (e.document_id)
         e.document_id,
         e.document_id AS asset_id,
         e.unit_id,
         e.unit_id AS chunk_id,
         e.unit_index,
         e.document_title AS title,
         e.subtitle,
         e.source_name,
         e.source_uri,
         e.source_uri AS source_url,
         e.source_tier,
         e.content_type,
         e.canon_status,
         e.top_group,
         e.group_name,
         e.operator_name,
         e.text_preview,
         e.summary_short,
         e.evidence_lane,
         e.score
       FROM evidence e
       ORDER BY e.document_id, e.score DESC, e.unit_index ASC
     )
     SELECT *
     FROM ranked
     ORDER BY score DESC, source_tier ASC, document_id ASC
     LIMIT $6 OFFSET $7`,
    values,
  );
  return { rows: result.rows, total: result.rows.length };
}

async function handleSearchChunks(args = {}) {
  const rawQuery = String(args.query || '').trim();
  const documentId = documentIdFromArgs(args);
  const limit = clampLimit(args.limit, 20, 100);
  const offset = Math.max(Number(args.offset || 0), 0);

  if (!rawQuery && !documentId && !args.browse && !args.list_recent) {
    return {
      rows: [],
      total: 0,
      warning: 'query_or_document_id_required',
      message: 'Pass query/document_id for evidence search, or set browse/list_recent=true to intentionally list sample chunks.',
    };
  }

  const clauses = [];
  const values = [];
  if (rawQuery) {
    values.push(`%${rawQuery}%`);
    clauses.push(`(
      d.title ILIKE $${values.length}
      OR d.subtitle ILIKE $${values.length}
      OR tu.heading ILIKE $${values.length}
      OR tu.speaker ILIKE $${values.length}
      OR tu.scene_code ILIKE $${values.length}
      OR tu.text ILIKE $${values.length}
      OR tu.metadata->>'summary' ILIKE $${values.length}
      OR tu.metadata->>'summary_short' ILIKE $${values.length}
    )`);
  }
  if (documentId) {
    values.push(documentId);
    clauses.push(`tu.document_id = $${values.length}`);
  }
  const sourceTiers = smallintArray(args.source_tiers);
  if (sourceTiers) {
    values.push(sourceTiers);
    clauses.push(`d.source_tier = ANY($${values.length}::smallint[])`);
  }
  const contentTypes = stringArray(args.content_types);
  if (contentTypes) {
    values.push(contentTypes);
    clauses.push(`d.content_type = ANY($${values.length}::text[])`);
  }
  values.push(limit, offset);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const result = await query(
    `SELECT
       tu.unit_id,
       tu.unit_id AS chunk_id,
       tu.document_id,
       tu.document_id AS asset_id,
       tu.unit_index,
       tu.unit_kind,
       tu.heading,
       tu.speaker,
       tu.scene_code,
       LEFT(tu.text, 900) AS text_preview,
       LEFT(tu.text, 900) AS chunk_text,
       tu.metadata->>'summary_short' AS summary_short,
       tu.metadata->>'summary' AS summary,
       tu.review_status,
       d.title AS document_title,
       d.title,
       d.subtitle,
       d.source_name,
       d.source_uri,
       d.source_uri AS source_url,
       d.source_tier,
       d.content_type
     FROM text_units tu
     JOIN documents d ON d.document_id = tu.document_id
     ${where}
     ORDER BY
       CASE WHEN $${values.length - 1}::int IS NULL THEN 0 ELSE 0 END,
       d.source_tier ASC,
       tu.document_id ASC,
       tu.unit_index ASC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return { rows: result.rows, total: result.rows.length };
}

async function handleRead(args = {}) {
  const documentId = documentIdFromArgs(args);
  if (!documentId) return { error: 'document_id or asset_id is required' };

  const doc = await query(`SELECT ${documentSelect} FROM documents d WHERE d.document_id = $1`, [documentId]);
  if (!doc.rows[0]) {
    const available = await query(
      `SELECT document_id, document_id AS asset_id, title, source_name, content_type
       FROM documents
       ORDER BY document_id
       LIMIT 8`,
    );
    const bounds = await query(`SELECT MIN(document_id) AS min_document_id, MAX(document_id) AS max_document_id FROM documents`);
    return {
      error: 'document not found',
      document_id: documentId,
      asset_id: documentId,
      id_bounds: bounds.rows[0] || null,
      available_documents: available.rows,
      hint: 'Use one of the available document_id values or search first; IDs may not start at 1.',
    };
  }

  const includeUnits = args.include_units !== false;
  const units = includeUnits
    ? (await query(
      `SELECT
         unit_id,
         unit_id AS chunk_id,
         document_id,
         document_id AS asset_id,
         unit_index,
         unit_kind,
         heading,
         speaker,
         scene_code,
         text,
         text AS chunk_text,
         source_tier,
         content_type,
         is_direct_scene,
         metadata,
         review_status,
         created_at,
         updated_at
       FROM text_units
       WHERE document_id = $1
       ORDER BY unit_index, unit_id`,
      [documentId],
    )).rows
    : [];

  const entities = (await query(
    `SELECT DISTINCT e.entity_id, e.entity_type, e.name, e.name_en, e.summary, e.review_status
     FROM entity_mentions em
     JOIN entities e ON e.entity_id = em.entity_id
     WHERE em.document_id = $1 AND em.review_status <> 'rejected'
     ORDER BY e.entity_type, e.name
     LIMIT 200`,
    [documentId],
  )).rows;

  return {
    ...doc.rows[0],
    full_text: units.map(u => u.text).filter(Boolean).join('\n\n'),
    char_count: units.reduce((sum, u) => sum + String(u.text || '').length, 0),
    units,
    chunks: units,
    entities,
  };
}

async function handleReadContext(args = {}) {
  const unitId = unitIdFromArgs(args);
  if (!unitId) return { error: 'unit_id or chunk_id is required' };
  const radius = Math.min(Math.max(Number(args.radius || 2), 0), 10);

  const anchor = await query(
    `SELECT tu.*, d.title AS document_title
     FROM text_units tu
     JOIN documents d ON d.document_id = tu.document_id
     WHERE tu.unit_id = $1`,
    [unitId],
  );
  if (!anchor.rows[0]) return { error: 'unit not found', unit_id: unitId, chunk_id: unitId };

  const row = anchor.rows[0];
  const doc = await query(`SELECT ${documentSelect} FROM documents d WHERE d.document_id = $1`, [row.document_id]);
  const units = await query(
    `SELECT
       unit_id,
       unit_id AS chunk_id,
       document_id,
       document_id AS asset_id,
       unit_index,
       unit_kind,
       heading,
       speaker,
       scene_code,
       text,
       text AS chunk_text,
       metadata,
       review_status
     FROM text_units
     WHERE document_id = $1 AND unit_index BETWEEN $2 AND $3
     ORDER BY unit_index, unit_id`,
    [row.document_id, row.unit_index - radius, row.unit_index + radius],
  );

  return {
    document: doc.rows[0] || null,
    asset: doc.rows[0] || null,
    anchorUnitId: unitId,
    anchorChunkId: unitId,
    radius,
    units: units.rows,
    chunks: units.rows,
  };
}

async function handleFindTags(args = {}) {
  const rawQuery = String(args.query || '').trim();
  const limit = clampLimit(args.limit, 30, 100);
  const entityType = String(args.entity_type || args.dim_code || '').trim();

  if (rawQuery) {
    const result = await query(
      `SELECT *
       FROM resolve_entities_optimized($1::text, $2::integer)
       WHERE ($3::text IS NULL OR entity_type = $3)
       ORDER BY match_score DESC, document_count DESC, name`,
      [rawQuery, limit, entityType || null],
    );
    return {
      rows: result.rows.map(row => ({
        ...row,
        tag_id: row.entity_id,
        tag_value: row.name,
        dim_code: row.entity_type,
      })),
      total: result.rows.length,
    };
  }

  const result = await query(
    `SELECT e.entity_id, e.entity_type, e.name, e.name_en, e.summary, e.review_status,
            COALESCE(jsonb_agg(ea.alias ORDER BY ea.alias) FILTER (WHERE ea.alias IS NOT NULL), '[]'::jsonb) AS aliases,
            COUNT(DISTINCT em.document_id)::int AS document_count
     FROM entities e
     LEFT JOIN entity_aliases ea ON ea.entity_id = e.entity_id
     LEFT JOIN entity_mentions em ON em.entity_id = e.entity_id
     WHERE ($1::text IS NULL OR e.entity_type = $1)
     GROUP BY e.entity_id
     ORDER BY document_count DESC, e.name
     LIMIT $2`,
    [entityType || null, limit],
  );
  return {
    rows: result.rows.map(row => ({
      ...row,
      tag_id: row.entity_id,
      tag_value: row.name,
      dim_code: row.entity_type,
    })),
    total: result.rows.length,
  };
}

async function resolveTagEntityIds(tags) {
  const ids = [];
  for (const tag of tags || []) {
    if (tag?.entity_id || tag?.tag_id) {
      ids.push(Number(tag.entity_id || tag.tag_id));
      continue;
    }
    const value = String(tag?.value || tag?.tag_value || '').trim();
    if (!value) continue;
    const entityType = String(tag.entity_type || tag.dim_code || '').trim();
    const found = await query(
      `SELECT e.entity_id
       FROM entities e
       LEFT JOIN entity_aliases ea ON ea.entity_id = e.entity_id
       WHERE ($2::text IS NULL OR e.entity_type = $2)
         AND (e.name = $1 OR e.name_en = $1 OR ea.alias = $1 OR e.name ILIKE '%' || $1 || '%' OR ea.alias ILIKE '%' || $1 || '%')
       ORDER BY CASE WHEN e.name = $1 THEN 0 WHEN ea.alias = $1 THEN 1 ELSE 2 END, e.name
       LIMIT 1`,
      [value, entityType || null],
    );
    if (found.rows[0]) ids.push(Number(found.rows[0].entity_id));
  }
  return [...new Set(ids)].filter(Number.isFinite);
}

async function handleSearchByTags(args = {}) {
  const entityIds = await resolveTagEntityIds(args.tags || []);
  if (!entityIds.length) return { rows: [], total: 0, error: 'No matching entities found' };
  const mode = String(args.mode || 'any').toLowerCase() === 'all' ? 'all' : 'any';
  const limit = clampLimit(args.limit, 50, 200);

  const result = await query(
    `WITH matches AS (
       SELECT em.document_id,
              COUNT(DISTINCT em.entity_id)::int AS matched_entity_count,
              jsonb_agg(DISTINCT jsonb_build_object('entity_id', e.entity_id, 'name', e.name, 'entity_type', e.entity_type)) AS matched_entities
       FROM entity_mentions em
       JOIN entities e ON e.entity_id = em.entity_id
       WHERE em.entity_id = ANY($1::bigint[]) AND em.review_status <> 'rejected'
       GROUP BY em.document_id
     )
     SELECT ${documentSelect},
            m.matched_entity_count,
            m.matched_entities,
            LEFT(tu.text, 300) AS text_preview
     FROM matches m
     JOIN documents d ON d.document_id = m.document_id
     LEFT JOIN LATERAL (
       SELECT text FROM text_units WHERE document_id = d.document_id ORDER BY unit_index LIMIT 1
     ) tu ON TRUE
     WHERE ($2::text = 'any' OR m.matched_entity_count >= cardinality($1::bigint[]))
     ORDER BY m.matched_entity_count DESC, d.source_tier ASC, d.title
     LIMIT $3`,
    [entityIds, mode, limit],
  );
  return { rows: result.rows, total: result.rows.length, entity_ids: entityIds, mode };
}

async function handleEntityCooccurrence(args = {}) {
  const entities = (args.entities || []).map(v => String(v || '').trim()).filter(Boolean);
  if (!entities.length) return { rows: [], total: 0, error: 'At least one entity required' };
  const entityIds = await resolveTagEntityIds(entities.map(value => ({ value })));
  const minMatches = Math.min(Math.max(Number(args.min_matches || Math.min(2, entityIds.length)), 1), entityIds.length || 1);
  const limit = clampLimit(args.limit, 50, 100);
  if (!entityIds.length) return { rows: [], total: 0, error: 'No matching entities found' };

  const result = await query(
    `WITH matches AS (
       SELECT em.document_id,
              COUNT(DISTINCT em.entity_id)::int AS matched_entity_count,
              jsonb_agg(DISTINCT jsonb_build_object('entity_id', e.entity_id, 'name', e.name, 'entity_type', e.entity_type)) AS matched_entities
       FROM entity_mentions em
       JOIN entities e ON e.entity_id = em.entity_id
       WHERE em.entity_id = ANY($1::bigint[]) AND em.review_status <> 'rejected'
       GROUP BY em.document_id
       HAVING COUNT(DISTINCT em.entity_id) >= $2
     )
     SELECT ${documentSelect},
            m.matched_entity_count,
            m.matched_entities,
            LEFT(tu.text, 400) AS text_preview
     FROM matches m
     JOIN documents d ON d.document_id = m.document_id
     LEFT JOIN LATERAL (
       SELECT text FROM text_units WHERE document_id = d.document_id ORDER BY unit_index LIMIT 1
     ) tu ON TRUE
     ORDER BY m.matched_entity_count DESC, d.source_tier ASC, d.title
     LIMIT $3`,
    [entityIds, minMatches, limit],
  );
  return { rows: result.rows, total: result.rows.length, entity_ids: entityIds, min_matches: minMatches };
}

async function handleSearchStats(args = {}) {
  const rawQuery = String(args.query || '').trim();
  const limit = clampLimit(args.limit, 30, 100);
  if (!rawQuery) return { total: 0, byContentType: [], bySourceTier: [], byGroup: [], topEntities: [] };
  const term = `%${rawQuery}%`;

  const stats = await query(
    `WITH matched_documents AS (
       SELECT DISTINCT d.document_id, d.content_type, d.source_tier, d.metadata
       FROM documents d
       LEFT JOIN text_units tu ON tu.document_id = d.document_id
       WHERE d.title ILIKE $1
          OR d.subtitle ILIKE $1
          OR d.metadata::text ILIKE $1
          OR tu.heading ILIKE $1
          OR tu.text ILIKE $1
          OR tu.metadata::text ILIKE $1
     ),
     total AS (
       SELECT COUNT(*)::int AS total FROM matched_documents
     ),
     by_content_type AS (
       SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.count DESC), '[]'::jsonb) AS rows
       FROM (
         SELECT content_type, COUNT(*)::int AS count
         FROM matched_documents
         GROUP BY content_type
         ORDER BY count DESC
         LIMIT $2
       ) t
     ),
     by_source_tier AS (
       SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.source_tier), '[]'::jsonb) AS rows
       FROM (
         SELECT source_tier, COUNT(*)::int AS count
         FROM matched_documents
         GROUP BY source_tier
         ORDER BY source_tier
       ) t
     ),
     by_group AS (
       SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.count DESC), '[]'::jsonb) AS rows
       FROM (
         SELECT metadata->>'top_group' AS top_group, metadata->>'group_name' AS group_name, COUNT(*)::int AS count
         FROM matched_documents
         GROUP BY metadata->>'top_group', metadata->>'group_name'
         ORDER BY count DESC
         LIMIT $2
       ) t
     ),
     top_entities AS (
       SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.count DESC, t.name), '[]'::jsonb) AS rows
       FROM (
         SELECT e.entity_id, e.entity_type, e.name, COUNT(DISTINCT em.document_id)::int AS count
         FROM entity_mentions em
         JOIN entities e ON e.entity_id = em.entity_id
         JOIN matched_documents md ON md.document_id = em.document_id
         GROUP BY e.entity_id
         ORDER BY count DESC, e.name
         LIMIT $2
       ) t
     )
     SELECT total.total,
            by_content_type.rows AS by_content_type,
            by_source_tier.rows AS by_source_tier,
            by_group.rows AS by_group,
            top_entities.rows AS top_entities
     FROM total, by_content_type, by_source_tier, by_group, top_entities`,
    [term, limit],
  );

  const row = stats.rows[0] || {};
  return {
    total: row.total || 0,
    byContentType: row.by_content_type || [],
    bySourceTier: row.by_source_tier || [],
    byGroup: row.by_group || [],
    topEntities: row.top_entities || [],
  };
}

const server = new Server(
  { name: 'lore-db-mcp', version: '2.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
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
      case 'lore_db_search_fts': result = await handleSearchFTS(args); break;
      case 'lore_db_entity_cooccurrence': result = await handleEntityCooccurrence(args); break;
      case 'lore_db_search_stats': result = await handleSearchStats(args); break;
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`lore-db-mcp server started against ${DB_CONFIG.database}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
