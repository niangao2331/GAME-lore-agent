import pg from 'pg';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

const { Pool } = pg;

const DB_CONFIG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'arknights_lore_new',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  ssl: false,
};

export let adminPool = new Pool({
  ...DB_CONFIG,
  max: 8,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export function reconnectAdminPool() {
  adminPool = new Pool({
    ...DB_CONFIG,
    max: 8,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

export async function adminQuery(sql, params = []) {
  const client = await adminPool.connect();
  try {
    await client.query('SET search_path TO public');
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

export async function withAdminTransaction(fn) {
  const client = await adminPool.connect();
  try {
    await client.query('SET search_path TO public');
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
  await adminQuery(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      audit_id bigserial PRIMARY KEY,
      actor text NOT NULL,
      action text NOT NULL,
      target_type text NOT NULL,
      target_id text NOT NULL,
      before_data jsonb,
      after_data jsonb,
      note text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_admin_audit_target
      ON admin_audit_log(target_type, target_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS document_revisions (
      revision_id bigserial PRIMARY KEY,
      document_id bigint NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
      revision_kind varchar(40) NOT NULL,
      title text,
      subtitle text,
      document_data jsonb,
      units_data jsonb,
      created_by text NOT NULL,
      note text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_document_revisions_document
      ON document_revisions(document_id, created_at DESC);
  `);
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
