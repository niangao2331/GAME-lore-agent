#!/usr/bin/env node
/**
 * Database setup — reads database/databases.json and initializes all registered databases.
 *
 * Usage:
 *   node scripts/db-setup.js              # init all databases
 *   node scripts/db-setup.js <db-id>      # init specific database
 *   node scripts/db-setup.js --force      # force recreate all
 *   node scripts/db-setup.js <db-id> --force
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { prepareDatabase } from '../backend/src/dbMaintenance.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const REGISTRY_PATH = join(PROJECT_ROOT, 'database', 'databases.json');
let registry;
try {
  registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
} catch (err) {
  console.error(`[ERROR] Cannot read ${REGISTRY_PATH}: ${err.message}`);
  process.exit(1);
}

const DB_HOST = process.env.PGHOST || '127.0.0.1';
const DB_PORT = process.env.PGPORT || '5432';
const DB_USER = process.env.PGUSER || 'postgres';
const DB_PASS = process.env.PGPASSWORD || '';
const OPTIMIZATION_SQL_PATH = join(PROJECT_ROOT, 'backend', 'mcp-servers', 'lore-db-mcp', 'migrations', '004_query_optimization.sql');

const args = process.argv.slice(2);
const targetDb = args.find(a => !a.startsWith('--'));
const force = args.includes('--force');

function exec(cmd, silent) {
  return execSync(cmd, {
    encoding: 'utf-8',
    stdio: silent ? ['pipe', 'pipe', 'pipe'] : 'inherit',
    env: DB_PASS ? { ...process.env, PGPASSWORD: DB_PASS } : process.env,
  });
}

function findBin(name) {
  const paths = [
    `C:\\Program Files\\PostgreSQL\\17\\bin\\${name}.exe`,
    `C:\\Program Files\\PostgreSQL\\16\\bin\\${name}.exe`,
    `C:\\Program Files\\PostgreSQL\\15\\bin\\${name}.exe`,
  ];
  for (const p of paths) if (existsSync(p)) return p;
  try { execSync(`${name} --version`, { encoding: 'utf-8', stdio: 'pipe' }); return name; } catch { return null; }
}

function quoteIdent(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid PostgreSQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function dbExists(name) {
  try {
    const out = exec(`"${psql}" -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = ${quoteLiteral(name)}"`, true);
    return out.trim() === '1';
  } catch { return false; }
}

function createDb(name) {
  const dbIdent = quoteIdent(name);
  exec(`"${psql}" -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${quoteLiteral(name)} AND pid <> pg_backend_pid();"`, true);
  exec(`"${psql}" -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d postgres -c "DROP DATABASE IF EXISTS ${dbIdent};"`, true);
  exec(`"${psql}" -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d postgres -c "CREATE DATABASE ${dbIdent} WITH ENCODING 'UTF8';"`, true);
}

function restoreDb(name, dumpPath) {
  exec(`"${pgRestore}" -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d ${name} --no-owner --no-privileges "${dumpPath}"`);
}

const psql = findBin('psql');
const pgRestore = findBin('pg_restore');
if (!psql || !pgRestore) {
  console.error('[ERROR] PostgreSQL not found.');
  console.error('Install:');
  console.error('  Windows: winget install PostgreSQL.PostgreSQL.17');
  console.error('  Linux:   sudo apt install postgresql postgresql-contrib');
  console.error('  macOS:   brew install postgresql');
  process.exit(1);
}

const databases = registry.databases || [];
if (!databases.length) {
  console.error('[ERROR] No databases registered in databases.json');
  process.exit(1);
}

let targetDbs;
if (targetDb) {
  targetDbs = databases.filter(d => d.id === targetDb);
  if (!targetDbs.length) {
    console.error(`[ERROR] Database "${targetDb}" not found in registry.`);
    console.error('Registered databases:');
    databases.forEach(d => console.error(`  - ${d.id}: ${d.name}`));
    process.exit(1);
  }
} else {
  targetDbs = databases;
}

console.log('=== Database Setup ===\n');
console.log(`Found ${targetDbs.length} database(s) to process.\n`);

let success = 0;
let skipped = 0;
let maintained = 0;

for (const db of targetDbs) {
  const dbName = db.env?.PGDATABASE || db.id;
  const dumpPath = join(PROJECT_ROOT, 'database', db.dumpFile);

  console.log(`--- ${db.name} (${db.id}) ---`);

  if (!existsSync(dumpPath)) {
    console.error(`  [ERROR] Dump not found: ${dumpPath}`);
    continue;
  }
  const sizeMB = (statSync(dumpPath).size / 1024 / 1024).toFixed(1);
  console.log(`  [OK] dump: ${dumpPath} (${sizeMB} MB)`);

  const exists = dbExists(dbName);
  if (exists && !force) {
    console.log(`  [SKIP] Database "${dbName}" already exists; preserving data.`);
    try {
      const prepared = await prepareDatabase(db, { dumpPath, optimizationSqlPath: OPTIMIZATION_SQL_PATH });
      const maintenance = prepared.maintenance;
      const actions = maintenance.actions.length ? maintenance.actions.join(', ') : 'none';
      console.log(`  [OK] Runtime cache check complete. actions=${actions}, healthy=${maintenance.after.healthy}`);
      if (maintenance.after.warnings.length) {
        console.log(`  [WARN] ${maintenance.after.warnings.join(', ')}`);
      }
      maintained++;
    } catch (err) {
      console.log(`  [WARN] Runtime cache check failed: ${err.message}`);
    }
    skipped++;
    continue;
  }

  if (exists && force) {
    console.log(`  [WARN] Database "${dbName}" will be DROPPED and recreated.`);
  }

  // A force run intentionally recreates the database so the registered dump can be replayed end to end.
  console.log(`  [ACTION] Creating database "${dbName}"...`);
  createDb(dbName);
  console.log(`  [OK] Created.`);

  console.log(`  [ACTION] Restoring dump...`);
  restoreDb(dbName, dumpPath);
  console.log(`  [OK] Restored.`);

  try {
    const prepared = await prepareDatabase(db, { dumpPath, optimizationSqlPath: OPTIMIZATION_SQL_PATH });
    const maintenance = prepared.maintenance;
    const actions = maintenance.actions.length ? maintenance.actions.join(', ') : 'none';
    console.log(`  [OK] Runtime cache check complete. actions=${actions}, healthy=${maintenance.after.healthy}`);
    if (maintenance.after.warnings.length) {
      console.log(`  [WARN] ${maintenance.after.warnings.join(', ')}`);
    }
    maintained++;
  } catch (err) {
    console.log(`  [WARN] Runtime cache check failed: ${err.message}`);
  }

  success++;
}

console.log(`\n=== Done ===`);
console.log(`Initialized: ${success}, Skipped: ${skipped}, Runtime cache checked: ${maintained}`);
if (success > 0) {
  console.log('Start the app with: npm start');
}
