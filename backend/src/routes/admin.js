import express from 'express';
import { adminQuery, getAdminActor, requireAdmin, withAdminTransaction } from '../adminDb.js';

const REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected', 'needs_review', 'seeded']);
const CANON_STATUSES = new Set(['official', 'semi_official', 'non_canon', 'unknown']);

function jsonValue(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function pick(input, allowed) {
  const out = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(input, key)) out[key] = input[key];
  }
  return out;
}

function buildSetClause(fields, startIndex = 1) {
  const sets = [];
  const params = [];
  let index = startIndex;
  for (const [key, value] of Object.entries(fields)) {
    const cast = ['metadata', 'properties'].includes(key) ? '::jsonb' : '';
    sets.push(`${key} = $${index++}${cast}`);
    params.push(value);
  }
  return { sets, params, nextIndex: index };
}

async function audit(client, req, action, targetType, targetId, beforeData, afterData, note = null) {
  await client.query(
    `INSERT INTO admin_audit_log(actor, action, target_type, target_id, before_data, after_data, note)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      getAdminActor(req),
      action,
      targetType,
      String(targetId),
      beforeData == null ? null : JSON.stringify(beforeData),
      afterData == null ? null : JSON.stringify(afterData),
      note,
    ],
  );
}

async function refreshDocumentVector(client, documentId) {
  await client.query(
    `UPDATE documents
     SET search_vector =
       setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
       setweight(to_tsvector('simple', COALESCE(subtitle, '')), 'B') ||
       setweight(to_tsvector('simple', COALESCE(metadata->>'operator_name', '')), 'A') ||
       setweight(to_tsvector('simple', COALESCE(metadata->>'operator_summary', '')), 'B'),
       updated_at = now()
     WHERE document_id = $1`,
    [documentId],
  );
}

async function refreshUnitVector(client, unitId) {
  await client.query(
    `UPDATE text_units
     SET search_vector =
       setweight(to_tsvector('simple', COALESCE(heading, '')), 'A') ||
       setweight(to_tsvector('simple', COALESCE(text, '')), 'B') ||
       setweight(to_tsvector('simple', COALESCE(metadata->>'summary', '')), 'C') ||
       setweight(to_tsvector('simple', COALESCE(metadata->>'summary_short', '')), 'C') ||
       setweight(to_tsvector('simple', COALESCE(metadata->>'key_terms', '')), 'C'),
       updated_at = now()
     WHERE unit_id = $1`,
    [unitId],
  );
}

async function fetchDocument(client, documentId) {
  const result = await client.query(
    `SELECT d.*,
            d.metadata->>'top_group' AS top_group,
            d.metadata->>'group_name' AS group_name,
            d.metadata->>'operator_name' AS operator_name,
            d.metadata->>'operator_summary' AS operator_summary
     FROM documents d
     WHERE d.document_id = $1`,
    [documentId],
  );
  return result.rows[0] || null;
}

async function snapshotDocument(client, documentId, req, revisionKind, note) {
  const doc = await fetchDocument(client, documentId);
  if (!doc) throw new Error('document not found');
  const units = await client.query(
    `SELECT * FROM text_units WHERE document_id = $1 ORDER BY unit_index, unit_id`,
    [documentId],
  );
  await client.query(
    `INSERT INTO document_revisions(document_id, revision_kind, title, subtitle, document_data, units_data, created_by, note)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
    [
      documentId,
      revisionKind,
      doc.title,
      doc.subtitle,
      JSON.stringify(doc),
      JSON.stringify(units.rows),
      getAdminActor(req),
      note,
    ],
  );
  return { doc, units: units.rows };
}

async function rebuildMentionsForDocument(client, documentId, req) {
  const before = await client.query(`SELECT * FROM entity_mentions WHERE document_id = $1`, [documentId]);
  await client.query(`DELETE FROM entity_mentions WHERE document_id = $1`, [documentId]);

  const entities = await client.query(
    `SELECT e.entity_id, e.name, e.name_en,
            COALESCE(array_agg(ea.alias) FILTER (WHERE ea.alias IS NOT NULL), ARRAY[]::text[]) AS aliases
     FROM entities e
     LEFT JOIN entity_aliases ea ON ea.entity_id = e.entity_id
     WHERE e.review_status <> 'rejected'
     GROUP BY e.entity_id
     ORDER BY e.entity_id`,
  );
  const units = await client.query(
    `SELECT unit_id, unit_index, heading, text FROM text_units WHERE document_id = $1 ORDER BY unit_index`,
    [documentId],
  );
  const doc = await client.query(`SELECT title, subtitle FROM documents WHERE document_id = $1`, [documentId]);
  const titleText = `${doc.rows[0]?.title || ''} ${doc.rows[0]?.subtitle || ''}`;
  let inserted = 0;

  for (const entity of entities.rows) {
    const names = [entity.name, entity.name_en, ...(entity.aliases || [])]
      .map(v => String(v || '').trim())
      .filter(v => v.length >= 2);
    if (!names.length) continue;
    const titleMatch = names.some(name => titleText.includes(name));
    for (const unit of units.rows) {
      const text = `${unit.heading || ''}\n${unit.text || ''}`;
      const matched = names.find(name => text.includes(name));
      if (!matched && !titleMatch) continue;
      const index = matched ? text.indexOf(matched) : -1;
      const snippet = index >= 0
        ? text.slice(Math.max(0, index - 80), index + matched.length + 120)
        : titleText.slice(0, 180);
      await client.query(
        `INSERT INTO entity_mentions(entity_id, document_id, unit_id, role, salience, title_match, context_snippet, annotated_by, review_status)
         VALUES ($1, $2, $3, 'mentioned', $4, $5, $6, 'admin_rebuild', 'approved')`,
        [entity.entity_id, documentId, unit.unit_id, titleMatch ? 0.8 : 0.5, titleMatch, snippet],
      );
      inserted++;
      if (matched) break;
    }
  }

  await audit(client, req, 'mentions.rebuild', 'document', documentId, before.rows, { inserted });
  return { inserted, deleted: before.rows.length };
}

export function setupAdminRoutes(app) {
  const router = express.Router();
  router.use(requireAdmin);

  router.get('/documents', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const values = [];
    const clauses = [];

    if (req.query.query) {
      values.push(`%${req.query.query}%`);
      clauses.push(`(
        d.title ILIKE $${values.length}
        OR d.subtitle ILIKE $${values.length}
        OR d.source_name ILIKE $${values.length}
        OR d.metadata::text ILIKE $${values.length}
        OR EXISTS (
          SELECT 1 FROM text_units tu
          WHERE tu.document_id = d.document_id
            AND (tu.heading ILIKE $${values.length} OR tu.text ILIKE $${values.length} OR tu.metadata::text ILIKE $${values.length})
        )
      )`);
    }
    if (req.query.content_type) {
      values.push(req.query.content_type);
      clauses.push(`d.content_type = $${values.length}`);
    }
    if (req.query.source_tier) {
      values.push(Number(req.query.source_tier));
      clauses.push(`d.source_tier = $${values.length}`);
    }
    if (req.query.review_status) {
      values.push(req.query.review_status);
      clauses.push(`d.review_status = $${values.length}`);
    }
    if (req.query.entity) {
      values.push(`%${req.query.entity}%`);
      clauses.push(`EXISTS (
        SELECT 1
        FROM entity_mentions em
        JOIN entities e ON e.entity_id = em.entity_id
        LEFT JOIN entity_aliases ea ON ea.entity_id = e.entity_id
        WHERE em.document_id = d.document_id
          AND (e.name ILIKE $${values.length} OR e.name_en ILIKE $${values.length} OR ea.alias ILIKE $${values.length})
      )`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    values.push(limit, offset);
    const result = await adminQuery(
      `SELECT d.document_id, d.external_key, d.title, d.subtitle, d.source_name, d.source_uri,
              d.source_tier, d.content_type, d.canon_status, d.review_status,
              d.metadata->>'top_group' AS top_group,
              d.metadata->>'group_name' AS group_name,
              d.metadata->>'operator_name' AS operator_name,
              COUNT(tu.unit_id)::int AS unit_count,
              LEFT(MIN(tu.text), 240) AS text_preview,
              d.updated_at
       FROM documents d
       LEFT JOIN text_units tu ON tu.document_id = d.document_id
       ${where}
       GROUP BY d.document_id
       ORDER BY d.updated_at DESC, d.document_id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    res.json({ rows: result.rows, total: result.rows.length });
  });

  router.post('/documents', async (req, res) => {
    const body = req.body || {};
    if (!body.title) return res.status(400).json({ error: 'title is required' });
    const sourceTier = Number(body.source_tier || 1);
    if (sourceTier < 1 || sourceTier > 5) return res.status(400).json({ error: 'source_tier must be 1-5' });
    const canonStatus = body.canon_status || 'official';
    if (!CANON_STATUSES.has(canonStatus)) return res.status(400).json({ error: 'invalid canon_status' });
    if (body.review_status && !REVIEW_STATUSES.has(body.review_status)) return res.status(400).json({ error: 'invalid review_status' });

    const result = await withAdminTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO documents(external_key, title, subtitle, source_name, source_uri, source_tier, content_type, canon_status,
                               perspective_scope, provenance_hash, metadata, review_status, ai_usage_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
         RETURNING *`,
        [
          body.external_key || null,
          body.title,
          body.subtitle || null,
          body.source_name || null,
          body.source_uri || body.source_url || null,
          sourceTier,
          body.content_type || 'event_story',
          canonStatus,
          body.perspective_scope || null,
          body.provenance_hash || null,
          JSON.stringify(jsonValue(body.metadata, {})),
          body.review_status || 'pending',
          body.ai_usage_notes || null,
        ],
      );
      await refreshDocumentVector(client, inserted.rows[0].document_id);
      const after = await fetchDocument(client, inserted.rows[0].document_id);
      await audit(client, req, 'document.create', 'document', after.document_id, null, after);
      return after;
    });
    res.json({ ok: true, document: result });
  });

  router.get('/documents/:documentId', async (req, res) => {
    const documentId = Number(req.params.documentId);
    const document = await adminQuery(
      `SELECT d.*,
              d.metadata->>'top_group' AS top_group,
              d.metadata->>'group_name' AS group_name,
              d.metadata->>'operator_name' AS operator_name,
              d.metadata->>'operator_summary' AS operator_summary
       FROM documents d
       WHERE d.document_id = $1`,
      [documentId],
    );
    if (!document.rows[0]) return res.status(404).json({ error: 'document not found' });

    const units = await adminQuery(
      `SELECT * FROM text_units WHERE document_id = $1 ORDER BY unit_index, unit_id`,
      [documentId],
    );
    const mentions = await adminQuery(
      `SELECT em.*, e.entity_type, e.name, e.name_en
       FROM entity_mentions em
       JOIN entities e ON e.entity_id = em.entity_id
       WHERE em.document_id = $1
       ORDER BY em.review_status, em.salience DESC, e.name`,
      [documentId],
    );
    const revisions = await adminQuery(
      `SELECT revision_id, revision_kind, title, subtitle, created_by, note, created_at
       FROM document_revisions
       WHERE document_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [documentId],
    );
    res.json({ document: document.rows[0], units: units.rows, mentions: mentions.rows, revisions: revisions.rows });
  });

  router.patch('/documents/:documentId', async (req, res) => {
    const documentId = Number(req.params.documentId);
    const fields = pick(req.body || {}, [
      'external_key', 'title', 'subtitle', 'source_name', 'source_uri', 'source_tier', 'content_type',
      'canon_status', 'perspective_scope', 'provenance_hash', 'review_status', 'ai_usage_notes',
    ]);
    if (req.body.source_url && !fields.source_uri) fields.source_uri = req.body.source_url;
    if (req.body.metadata !== undefined) fields.metadata = JSON.stringify(jsonValue(req.body.metadata, {}));
    if (fields.review_status && !REVIEW_STATUSES.has(fields.review_status)) return res.status(400).json({ error: 'invalid review_status' });
    if (fields.canon_status && !CANON_STATUSES.has(fields.canon_status)) return res.status(400).json({ error: 'invalid canon_status' });

    const result = await withAdminTransaction(async (client) => {
      const before = await fetchDocument(client, documentId);
      if (!before) throw new Error('document not found');
      await snapshotDocument(client, documentId, req, 'metadata_edit', req.body.note || 'before document metadata edit');
      if (Object.keys(fields).length) {
        const { sets, params, nextIndex } = buildSetClause(fields);
        params.push(documentId);
        await client.query(`UPDATE documents SET ${sets.join(', ')}, updated_at = now() WHERE document_id = $${nextIndex}`, params);
      }
      await refreshDocumentVector(client, documentId);
      const after = await fetchDocument(client, documentId);
      await audit(client, req, 'document.update', 'document', documentId, before, after);
      return after;
    });
    res.json({ ok: true, document: result });
  });

  router.delete('/documents/:documentId', async (req, res) => {
    const documentId = Number(req.params.documentId);
    const result = await withAdminTransaction(async (client) => {
      const before = await fetchDocument(client, documentId);
      if (!before) throw new Error('document not found');
      await snapshotDocument(client, documentId, req, 'delete_backup', req.body?.note || 'before document delete');
      await client.query(`DELETE FROM documents WHERE document_id = $1`, [documentId]);
      await audit(client, req, 'document.delete', 'document', documentId, before, null);
      return { deleted: true };
    });
    res.json({ ok: true, ...result });
  });

  router.post('/documents/:documentId/text-units', async (req, res) => {
    const documentId = Number(req.params.documentId);
    const body = req.body || {};
    if (!body.text) return res.status(400).json({ error: 'text is required' });
    if (body.review_status && !REVIEW_STATUSES.has(body.review_status)) return res.status(400).json({ error: 'invalid review_status' });

    const result = await withAdminTransaction(async (client) => {
      const doc = await fetchDocument(client, documentId);
      if (!doc) throw new Error('document not found');
      await snapshotDocument(client, documentId, req, 'unit_create', body.note || 'before text unit create');
      const nextIndex = body.unit_index ?? (await client.query(
        `SELECT COALESCE(MAX(unit_index), -1) + 1 AS next_index FROM text_units WHERE document_id = $1`,
        [documentId],
      )).rows[0].next_index;
      const inserted = await client.query(
        `INSERT INTO text_units(document_id, unit_index, unit_kind, heading, speaker, scene_code, text, source_tier,
                                content_type, is_direct_scene, metadata, review_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
         RETURNING *`,
        [
          documentId,
          Number(nextIndex),
          body.unit_kind || 'chunk',
          body.heading || null,
          body.speaker || null,
          body.scene_code || null,
          body.text,
          Number(body.source_tier || doc.source_tier),
          body.content_type || doc.content_type,
          Boolean(body.is_direct_scene),
          JSON.stringify(jsonValue(body.metadata, {})),
          body.review_status || 'pending',
        ],
      );
      await refreshUnitVector(client, inserted.rows[0].unit_id);
      await refreshDocumentVector(client, documentId);
      const after = (await client.query(`SELECT * FROM text_units WHERE unit_id = $1`, [inserted.rows[0].unit_id])).rows[0];
      await audit(client, req, 'text_unit.create', 'text_unit', after.unit_id, null, after);
      return after;
    });
    res.json({ ok: true, unit: result });
  });

  router.patch('/text-units/:unitId', async (req, res) => {
    const unitId = Number(req.params.unitId);
    const fields = pick(req.body || {}, [
      'unit_index', 'unit_kind', 'heading', 'speaker', 'scene_code', 'text', 'source_tier',
      'content_type', 'is_direct_scene', 'review_status',
    ]);
    if (req.body.metadata !== undefined) fields.metadata = JSON.stringify(jsonValue(req.body.metadata, {}));
    if (fields.review_status && !REVIEW_STATUSES.has(fields.review_status)) return res.status(400).json({ error: 'invalid review_status' });

    const result = await withAdminTransaction(async (client) => {
      const before = await client.query(`SELECT * FROM text_units WHERE unit_id = $1`, [unitId]);
      if (!before.rows[0]) throw new Error('text unit not found');
      await snapshotDocument(client, before.rows[0].document_id, req, 'unit_edit', req.body.note || 'before text unit edit');
      if (Object.keys(fields).length) {
        const { sets, params, nextIndex } = buildSetClause(fields);
        params.push(unitId);
        await client.query(`UPDATE text_units SET ${sets.join(', ')}, updated_at = now() WHERE unit_id = $${nextIndex}`, params);
      }
      await refreshUnitVector(client, unitId);
      await refreshDocumentVector(client, before.rows[0].document_id);
      const after = await client.query(`SELECT * FROM text_units WHERE unit_id = $1`, [unitId]);
      await audit(client, req, 'text_unit.update', 'text_unit', unitId, before.rows[0], after.rows[0]);
      return after.rows[0];
    });
    res.json({ ok: true, unit: result });
  });

  router.delete('/text-units/:unitId', async (req, res) => {
    const unitId = Number(req.params.unitId);
    await withAdminTransaction(async (client) => {
      const before = await client.query(`SELECT * FROM text_units WHERE unit_id = $1`, [unitId]);
      if (!before.rows[0]) throw new Error('text unit not found');
      await snapshotDocument(client, before.rows[0].document_id, req, 'unit_delete', req.body?.note || 'before text unit delete');
      await client.query(`DELETE FROM text_units WHERE unit_id = $1`, [unitId]);
      await refreshDocumentVector(client, before.rows[0].document_id);
      await audit(client, req, 'text_unit.delete', 'text_unit', unitId, before.rows[0], null);
    });
    res.json({ ok: true });
  });

  router.post('/documents/:documentId/rebuild-mentions', async (req, res) => {
    const documentId = Number(req.params.documentId);
    const result = await withAdminTransaction(async (client) => {
      if (!(await fetchDocument(client, documentId))) throw new Error('document not found');
      return rebuildMentionsForDocument(client, documentId, req);
    });
    res.json({ ok: true, ...result });
  });

  router.get('/entities', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const values = [];
    const clauses = [];
    if (req.query.query) {
      values.push(`%${req.query.query}%`);
      clauses.push(`(e.name ILIKE $${values.length} OR e.name_en ILIKE $${values.length} OR e.summary ILIKE $${values.length} OR ea.alias ILIKE $${values.length})`);
    }
    if (req.query.entity_type) {
      values.push(req.query.entity_type);
      clauses.push(`e.entity_type = $${values.length}`);
    }
    if (req.query.review_status) {
      values.push(req.query.review_status);
      clauses.push(`e.review_status = $${values.length}`);
    }
    values.push(limit);
    const result = await adminQuery(
      `SELECT e.*,
              COALESCE(jsonb_agg(DISTINCT ea.alias) FILTER (WHERE ea.alias IS NOT NULL), '[]'::jsonb) AS aliases,
              COUNT(DISTINCT em.document_id)::int AS document_count
       FROM entities e
       LEFT JOIN entity_aliases ea ON ea.entity_id = e.entity_id
       LEFT JOIN entity_mentions em ON em.entity_id = e.entity_id
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       GROUP BY e.entity_id
       ORDER BY document_count DESC, e.name
       LIMIT $${values.length}`,
      values,
    );
    res.json({ rows: result.rows });
  });

  router.post('/entities', async (req, res) => {
    const body = req.body || {};
    if (!body.name) return res.status(400).json({ error: 'name is required' });
    if (body.review_status && !REVIEW_STATUSES.has(body.review_status)) return res.status(400).json({ error: 'invalid review_status' });
    const result = await withAdminTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO entities(entity_type, name, name_en, summary, properties, review_status)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (entity_type, name)
         DO UPDATE SET name_en = EXCLUDED.name_en, summary = EXCLUDED.summary,
                       properties = EXCLUDED.properties, review_status = EXCLUDED.review_status,
                       updated_at = now()
         RETURNING *`,
        [
          body.entity_type || 'character',
          body.name,
          body.name_en || null,
          body.summary || null,
          JSON.stringify(jsonValue(body.properties, {})),
          body.review_status || 'pending',
        ],
      );
      await audit(client, req, 'entity.upsert', 'entity', inserted.rows[0].entity_id, null, inserted.rows[0]);
      return inserted.rows[0];
    });
    res.json({ ok: true, entity: result });
  });

  router.get('/entities/:entityId', async (req, res) => {
    const entityId = Number(req.params.entityId);
    const entity = await adminQuery(`SELECT * FROM entities WHERE entity_id = $1`, [entityId]);
    if (!entity.rows[0]) return res.status(404).json({ error: 'entity not found' });
    const aliases = await adminQuery(`SELECT * FROM entity_aliases WHERE entity_id = $1 ORDER BY confidence DESC, alias`, [entityId]);
    const mentions = await adminQuery(
      `SELECT em.*, d.title AS document_title, tu.heading, tu.unit_index
       FROM entity_mentions em
       JOIN documents d ON d.document_id = em.document_id
       LEFT JOIN text_units tu ON tu.unit_id = em.unit_id
       WHERE em.entity_id = $1
       ORDER BY em.salience DESC, d.title
       LIMIT 200`,
      [entityId],
    );
    res.json({ entity: entity.rows[0], aliases: aliases.rows, mentions: mentions.rows });
  });

  router.patch('/entities/:entityId', async (req, res) => {
    const entityId = Number(req.params.entityId);
    const fields = pick(req.body || {}, ['entity_type', 'name', 'name_en', 'summary', 'review_status']);
    if (req.body.properties !== undefined) fields.properties = JSON.stringify(jsonValue(req.body.properties, {}));
    if (fields.review_status && !REVIEW_STATUSES.has(fields.review_status)) return res.status(400).json({ error: 'invalid review_status' });
    const result = await withAdminTransaction(async (client) => {
      const before = await client.query(`SELECT * FROM entities WHERE entity_id = $1`, [entityId]);
      if (!before.rows[0]) throw new Error('entity not found');
      if (Object.keys(fields).length) {
        const { sets, params, nextIndex } = buildSetClause(fields);
        params.push(entityId);
        await client.query(`UPDATE entities SET ${sets.join(', ')}, updated_at = now() WHERE entity_id = $${nextIndex}`, params);
      }
      const after = await client.query(`SELECT * FROM entities WHERE entity_id = $1`, [entityId]);
      await audit(client, req, 'entity.update', 'entity', entityId, before.rows[0], after.rows[0]);
      return after.rows[0];
    });
    res.json({ ok: true, entity: result });
  });

  router.post('/entities/:entityId/aliases', async (req, res) => {
    const entityId = Number(req.params.entityId);
    const body = req.body || {};
    if (!body.alias) return res.status(400).json({ error: 'alias is required' });
    const result = await withAdminTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO entity_aliases(entity_id, alias, alias_kind, source, confidence)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (entity_id, alias)
         DO UPDATE SET alias_kind = EXCLUDED.alias_kind, source = EXCLUDED.source, confidence = EXCLUDED.confidence
         RETURNING *`,
        [entityId, body.alias, body.alias_kind || 'alias', body.source || 'manual', Number(body.confidence ?? 1)],
      );
      await audit(client, req, 'entity_alias.upsert', 'entity_alias', inserted.rows[0].alias_id, null, inserted.rows[0]);
      return inserted.rows[0];
    });
    res.json({ ok: true, alias: result });
  });

  router.delete('/aliases/:aliasId', async (req, res) => {
    const aliasId = Number(req.params.aliasId);
    await withAdminTransaction(async (client) => {
      const before = await client.query(`SELECT * FROM entity_aliases WHERE alias_id = $1`, [aliasId]);
      if (!before.rows[0]) throw new Error('alias not found');
      await client.query(`DELETE FROM entity_aliases WHERE alias_id = $1`, [aliasId]);
      await audit(client, req, 'entity_alias.delete', 'entity_alias', aliasId, before.rows[0], null);
    });
    res.json({ ok: true });
  });

  router.post('/mentions', async (req, res) => {
    const body = req.body || {};
    if (!body.entity_id || !body.document_id) return res.status(400).json({ error: 'entity_id and document_id are required' });
    if (body.review_status && !REVIEW_STATUSES.has(body.review_status)) return res.status(400).json({ error: 'invalid review_status' });
    const result = await withAdminTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO entity_mentions(entity_id, document_id, unit_id, role, salience, title_match, direct_action,
                                     context_snippet, annotated_by, review_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          Number(body.entity_id),
          Number(body.document_id),
          body.unit_id ? Number(body.unit_id) : null,
          body.role || 'mentioned',
          Number(body.salience ?? 0.5),
          Boolean(body.title_match),
          Boolean(body.direct_action),
          body.context_snippet || null,
          getAdminActor(req),
          body.review_status || 'approved',
        ],
      );
      await audit(client, req, 'entity_mention.create', 'entity_mention', inserted.rows[0].mention_id, null, inserted.rows[0]);
      return inserted.rows[0];
    });
    res.json({ ok: true, mention: result });
  });

  router.patch('/mentions/:mentionId', async (req, res) => {
    const mentionId = Number(req.params.mentionId);
    const fields = pick(req.body || {}, ['role', 'salience', 'title_match', 'direct_action', 'context_snippet', 'review_status']);
    if (fields.review_status && !REVIEW_STATUSES.has(fields.review_status)) return res.status(400).json({ error: 'invalid review_status' });
    const result = await withAdminTransaction(async (client) => {
      const before = await client.query(`SELECT * FROM entity_mentions WHERE mention_id = $1`, [mentionId]);
      if (!before.rows[0]) throw new Error('mention not found');
      if (Object.keys(fields).length) {
        const { sets, params, nextIndex } = buildSetClause(fields);
        params.push(mentionId);
        await client.query(`UPDATE entity_mentions SET ${sets.join(', ')} WHERE mention_id = $${nextIndex}`, params);
      }
      const after = await client.query(`SELECT * FROM entity_mentions WHERE mention_id = $1`, [mentionId]);
      await audit(client, req, 'entity_mention.update', 'entity_mention', mentionId, before.rows[0], after.rows[0]);
      return after.rows[0];
    });
    res.json({ ok: true, mention: result });
  });

  router.delete('/mentions/:mentionId', async (req, res) => {
    const mentionId = Number(req.params.mentionId);
    await withAdminTransaction(async (client) => {
      const before = await client.query(`SELECT * FROM entity_mentions WHERE mention_id = $1`, [mentionId]);
      if (!before.rows[0]) throw new Error('mention not found');
      await client.query(`DELETE FROM entity_mentions WHERE mention_id = $1`, [mentionId]);
      await audit(client, req, 'entity_mention.delete', 'entity_mention', mentionId, before.rows[0], null);
    });
    res.json({ ok: true });
  });

  router.get('/audit', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const values = [];
    const clauses = [];
    if (req.query.target_type) {
      values.push(req.query.target_type);
      clauses.push(`target_type = $${values.length}`);
    }
    if (req.query.target_id) {
      values.push(String(req.query.target_id));
      clauses.push(`target_id = $${values.length}`);
    }
    values.push(limit);
    const result = await adminQuery(
      `SELECT * FROM admin_audit_log
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY created_at DESC
       LIMIT $${values.length}`,
      values,
    );
    res.json({ rows: result.rows });
  });

  router.post('/revisions/:revisionId/restore', async (req, res) => {
    const revisionId = Number(req.params.revisionId);
    const result = await withAdminTransaction(async (client) => {
      const revision = await client.query(`SELECT * FROM document_revisions WHERE revision_id = $1`, [revisionId]);
      if (!revision.rows[0]) throw new Error('revision not found');
      const rev = revision.rows[0];
      const doc = rev.document_data;
      const units = Array.isArray(rev.units_data) ? rev.units_data : [];
      const before = await fetchDocument(client, rev.document_id);
      if (!before) throw new Error('document not found');
      await snapshotDocument(client, rev.document_id, req, 'restore_backup', `backup before restoring revision ${revisionId}`);
      await client.query(
        `UPDATE documents
         SET external_key = $1, title = $2, subtitle = $3, source_name = $4, source_uri = $5,
             source_tier = $6, content_type = $7, canon_status = $8, perspective_scope = $9,
             provenance_hash = $10, metadata = $11::jsonb, review_status = $12,
             ai_usage_notes = $13, updated_at = now()
         WHERE document_id = $14`,
        [
          doc.external_key,
          doc.title,
          doc.subtitle,
          doc.source_name,
          doc.source_uri,
          doc.source_tier,
          doc.content_type,
          doc.canon_status,
          doc.perspective_scope,
          doc.provenance_hash,
          JSON.stringify(doc.metadata || {}),
          doc.review_status,
          doc.ai_usage_notes,
          rev.document_id,
        ],
      );
      await client.query(`DELETE FROM text_units WHERE document_id = $1`, [rev.document_id]);
      for (const unit of units) {
        await client.query(
          `INSERT INTO text_units(document_id, unit_index, unit_kind, heading, speaker, scene_code, text, source_tier,
                                  content_type, is_direct_scene, metadata, review_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
           RETURNING unit_id`,
          [
            rev.document_id,
            unit.unit_index,
            unit.unit_kind,
            unit.heading,
            unit.speaker,
            unit.scene_code,
            unit.text,
            unit.source_tier,
            unit.content_type,
            unit.is_direct_scene,
            JSON.stringify(unit.metadata || {}),
            unit.review_status,
          ],
        );
      }
      await refreshDocumentVector(client, rev.document_id);
      const restoredUnits = await client.query(`SELECT unit_id FROM text_units WHERE document_id = $1`, [rev.document_id]);
      for (const unit of restoredUnits.rows) await refreshUnitVector(client, unit.unit_id);
      const after = await fetchDocument(client, rev.document_id);
      await audit(client, req, 'document.restore', 'document', rev.document_id, before, after, `restored revision ${revisionId}`);
      return after;
    });
    res.json({ ok: true, document: result });
  });

  app.use('/api/admin', router);
}
