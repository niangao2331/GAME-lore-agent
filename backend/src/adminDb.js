import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA = 'arknights_lore';

const DB_CONFIG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'arknights_lore',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  ssl: false,
};

export const adminPool = new Pool({
  ...DB_CONFIG,
  max: 8,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function adminQuery(sql, params = []) {
  const client = await adminPool.connect();
  try {
    await client.query(`SET search_path TO "${SCHEMA}", public`);
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

export async function withAdminTransaction(fn) {
  const client = await adminPool.connect();
  try {
    await client.query(`SET search_path TO "${SCHEMA}", public`);
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function runAdminMigrations() {
  const migrationPath = join(__dirname, '..', 'mcp-servers', 'lore-db-mcp', 'migrations', '002_admin_editor.sql');
  if (!existsSync(migrationPath)) return;
  const sql = readFileSync(migrationPath, 'utf-8');
  await adminQuery(sql);
}

export function getAdminActor(req) {
  return req.get('x-admin-actor') || req.ip || 'local-admin';
}

export function requireAdmin(req, res, next) {
  const token = process.env.ADMIN_TOKEN;
  const provided = req.get('x-admin-token') || req.query.admin_token;

  if (token) {
    if (provided === token) return next();
    res.status(401).json({ error: 'admin token required' });
    return;
  }

  const ip = req.ip || req.socket?.remoteAddress || '';
  const local = ip === '127.0.0.1'
    || ip === '::1'
    || ip === '::ffff:127.0.0.1'
    || ip.includes('localhost');

  if (local) return next();
  res.status(403).json({ error: 'admin access is local-only when ADMIN_TOKEN is not set' });
}
