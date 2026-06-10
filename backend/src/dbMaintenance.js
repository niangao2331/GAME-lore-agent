import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import pg from 'pg';

const { Pool } = pg;

function pgEnv(env = {}) {
  return { ...process.env, ...env };
}

function pgConfig(database, env = {}) {
  const merged = pgEnv(env);
  return {
    host: merged.PGHOST || '127.0.0.1',
    port: Number(merged.PGPORT || 5432),
    database,
    user: merged.PGUSER || 'postgres',
    password: merged.PGPASSWORD || '',
    ssl: false,
  };
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function findPgBin(name) {
  const paths = [
    `C:\\Program Files\\PostgreSQL\\17\\bin\\${name}.exe`,
    `C:\\Program Files\\PostgreSQL\\16\\bin\\${name}.exe`,
    `C:\\Program Files\\PostgreSQL\\15\\bin\\${name}.exe`,
  ];
  for (const path of paths) if (existsSync(path)) return path;
  try {
    execFileSync(name, ['--version'], { encoding: 'utf-8', stdio: 'pipe' });
    return name;
  } catch {
    return null;
  }
}

// Each maintenance operation uses a short-lived pool so startup checks never
// keep a stale connection to a database that may be recreated during setup.
async function withPool(database, env, fn) {
  const pool = new Pool(pgConfig(database, env));
  try {
    return await fn(pool);
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function databaseExists(dbName, env = {}) {
  return withPool('postgres', env, async (pool) => {
    const result = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    return result.rowCount > 0;
  });
}

export async function createDatabase(dbName, env = {}) {
  return withPool('postgres', env, async (pool) => {
    await pool.query(`CREATE DATABASE ${quoteIdent(dbName)} WITH ENCODING 'UTF8'`);
  });
}

export function restoreDatabase(dbName, dumpPath, env = {}) {
  const pgRestore = findPgBin('pg_restore');
  if (!pgRestore) throw new Error('pg_restore not found');
  const merged = pgEnv(env);
  execFileSync(pgRestore, [
    '-h', merged.PGHOST || '127.0.0.1',
    '-p', String(merged.PGPORT || 5432),
    '-U', merged.PGUSER || 'postgres',
    '-d', dbName,
    '--no-owner',
    '--no-privileges',
    dumpPath,
  ], {
    env: merged,
    stdio: 'inherit',
  });
}

async function regClass(pool, name) {
  const result = await pool.query('SELECT to_regclass($1) AS oid', [`public.${name}`]);
  return Boolean(result.rows[0]?.oid);
}

async function regProc(pool, signature) {
  const result = await pool.query('SELECT to_regprocedure($1) AS oid', [signature]);
  return Boolean(result.rows[0]?.oid);
}

async function columnExists(pool, table, column) {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return result.rowCount > 0;
}

async function countTable(pool, table) {
  if (!(await regClass(pool, table))) return null;
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdent(table)}`);
  return result.rows[0]?.count ?? 0;
}

async function missingVectors(pool, table) {
  if (!(await regClass(pool, table))) return null;
  if (!(await columnExists(pool, table, 'search_vector'))) return null;
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdent(table)} WHERE search_vector IS NULL`);
  return result.rows[0]?.count ?? 0;
}

async function documentStatsInfo(pool) {
  const result = await pool.query(
    `SELECT c.relkind
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'document_stats'`,
  );
  if (!result.rows[0]) return { exists: false, kind: null, rows: null, healthy: false };
  const rows = await countTable(pool, 'document_stats');
  const relkind = result.rows[0].relkind;
  return {
    exists: true,
    kind: relkind === 'm' ? 'materialized_view' : relkind === 'v' ? 'view' : 'table',
    rows,
    healthy: true,
  };
}

export async function inspectDatabaseRuntime(dbName, env = {}) {
  return withPool(dbName, env, async (pool) => {
    await pool.query('SET search_path TO public');
    const documents = await countTable(pool, 'documents');
    const textUnits = await countTable(pool, 'text_units');
    const browseCache = await documentStatsInfo(pool);
    const documentVectorsMissing = await missingVectors(pool, 'documents');
    const textUnitVectorsMissing = await missingVectors(pool, 'text_units');
    const hasRefreshDocumentStats = await regProc(pool, 'refresh_document_stats()');
    const hasSearchFunction = await regProc(pool, 'search_evidence_optimized(text,smallint[],text[],bigint[],text[],text[],text[],integer)');
    const hasBrowseFunction = await regProc(pool, 'browse_tree_optimized(text[],smallint[],text[],text[],text[],boolean,integer)');
    const warnings = [];
    const recommendedActions = [];

    if (documents > 0 && browseCache.exists && browseCache.rows === 0) {
      browseCache.healthy = false;
      warnings.push('browse_cache_empty_but_documents_exist');
      recommendedActions.push('refresh_document_stats');
    }
    if (documents > 0 && documentVectorsMissing > 0) {
      warnings.push('document_search_vectors_missing');
      recommendedActions.push('rebuild_search_vectors');
    }
    if (textUnits > 0 && textUnitVectorsMissing > 0) {
      warnings.push('text_unit_search_vectors_missing');
      recommendedActions.push('rebuild_search_vectors');
    }
    if (!hasSearchFunction) warnings.push('optimized_search_function_missing');
    if (!hasBrowseFunction) warnings.push('optimized_browse_function_missing');

    return {
      database: dbName,
      tables: {
        documents,
        text_units: textUnits,
      },
      search: {
        has_search_function: hasSearchFunction,
        has_browse_function: hasBrowseFunction,
        document_vectors_missing: documentVectorsMissing,
        text_unit_vectors_missing: textUnitVectorsMissing,
      },
      browse_cache: browseCache,
      maintenance: {
        has_refresh_document_stats: hasRefreshDocumentStats,
      },
      warnings,
      recommended_actions: [...new Set(recommendedActions)],
      healthy: warnings.length === 0,
    };
  });
}

async function rebuildSearchVectors(pool, health) {
  // The optimization migration adds triggers for new writes; this backfills
  // existing restored data so search works immediately after a dump restore.
  if (health.search.document_vectors_missing > 0) {
    await pool.query(`
      UPDATE documents
      SET search_vector =
        setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(subtitle, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(metadata->>'operator_name', '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(metadata->>'operator_summary', '')), 'B')
      WHERE search_vector IS NULL
    `);
  }
  if (health.search.text_unit_vectors_missing > 0) {
    await pool.query(`
      UPDATE text_units
      SET search_vector =
        setweight(to_tsvector('simple', COALESCE(heading, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(text, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(metadata->>'summary', '')), 'C') ||
        setweight(to_tsvector('simple', COALESCE(metadata->>'summary_short', '')), 'C')
      WHERE search_vector IS NULL
    `);
  }
}

async function refreshBrowseCache(pool, health) {
  if (!health.browse_cache.exists || health.browse_cache.healthy) return;
  if (health.maintenance.has_refresh_document_stats) {
    try {
      await pool.query('SELECT refresh_document_stats()');
      return;
    } catch (err) {
      if (health.browse_cache.kind !== 'materialized_view') throw err;
    }
  }
  if (health.browse_cache.kind === 'materialized_view') {
    await pool.query('REFRESH MATERIALIZED VIEW document_stats');
  }
}

export async function repairDatabaseRuntime(dbName, env = {}) {
  const before = await inspectDatabaseRuntime(dbName, env);
  if (before.healthy) return { before, after: before, actions: [] };

  const actions = [];
  await withPool(dbName, env, async (pool) => {
    await pool.query('SET search_path TO public');
    if (before.recommended_actions.includes('rebuild_search_vectors')) {
      await rebuildSearchVectors(pool, before);
      actions.push('rebuild_search_vectors');
    }
    if (before.recommended_actions.includes('refresh_document_stats')) {
      await refreshBrowseCache(pool, before);
      actions.push('refresh_document_stats');
    }
  });

  const after = await inspectDatabaseRuntime(dbName, env);
  return { before, after, actions };
}

async function applySqlFile(dbName, env, sqlPath) {
  if (!sqlPath || !existsSync(sqlPath)) return false;
  const sql = readFileSync(sqlPath, 'utf-8');
  await withPool(dbName, env, async (pool) => {
    await pool.query('SET search_path TO public');
    await pool.query(sql);
  });
  return true;
}

export async function prepareDatabase(dbConfig, options = {}) {
  const dbName = dbConfig.env?.PGDATABASE || dbConfig.id;
  const env = dbConfig.env || {};
  const dumpPath = options.dumpPath;
  const exists = await databaseExists(dbName, env);
  let restored = false;

  if (!exists) {
    if (!dumpPath || !existsSync(dumpPath)) {
      throw new Error(`Database "${dbName}" does not exist and dump is unavailable`);
    }
    await createDatabase(dbName, env);
    restoreDatabase(dbName, dumpPath, env);
    restored = true;
  }

  let maintenance = await repairDatabaseRuntime(dbName, env);

  // Older dumps may contain only the base schema. Apply the optional query
  // optimization migration lazily so registered databases stay compatible.
  const shouldApplyOptimization = options.optimizationSqlPath
    && maintenance.after.tables.documents !== null
    && maintenance.after.tables.text_units !== null
    && (
      !maintenance.after.search.has_search_function
      || !maintenance.after.search.has_browse_function
      || !maintenance.after.browse_cache.exists
      || maintenance.after.search.document_vectors_missing === null
      || maintenance.after.search.text_unit_vectors_missing === null
    );

  if (shouldApplyOptimization && await applySqlFile(dbName, env, options.optimizationSqlPath)) {
    const afterMigration = await repairDatabaseRuntime(dbName, env);
    maintenance = {
      before: maintenance.before,
      after: afterMigration.after,
      actions: ['apply_query_optimization_migration', ...maintenance.actions, ...afterMigration.actions],
    };
  }

  return {
    database: dbName,
    existed: exists,
    restored,
    maintenance,
  };
}
