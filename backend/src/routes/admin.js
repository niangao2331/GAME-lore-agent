import express from 'express';
import { adminQuery, getAdminActor, requireAdmin, withAdminTransaction } from '../adminDb.js';

const REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected', 'needs_review']);
const CLAIM_STATUSES = new Set(['unverified', 'verified', 'inferred', 'disputed', 'outdated', 'rejected']);

function jsonValue(value, fallback) {
  if (value == null) return fallback;
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

function buildSetClause(values, fields, startIndex = 1) {
  const sets = [];
  const params = [];
  let index = startIndex;
  for (const [key, value] of Object.entries(fields)) {
    const cast = ['evidence', 'entities', 'metadata', 'text_metadata'].includes(key) ? '::jsonb' : '';
    sets.push(`${key} = $${index++}${cast}`);
    params.push(value);
  }
  return { sets, params, nextIndex: index };
}

function splitChunks(text, maxChars = 1800) {
  const paragraphs = String(text || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs.length ? paragraphs : [String(text || '')]) {
    if ((current + '\n\n' + paragraph).trim().length > maxChars && current.trim()) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current = (current ? `${current}\n\n${paragraph}` : paragraph);
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [''];
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

async function fetchAsset(client, assetId) {
  const asset = await client.query(
    `SELECT a.*, c.category_code, c.category_name,
            tc.full_text, tc.char_count, tc.carrier_type, tc.narrative_layer,
            tc.mission_code, tc.character_name, tc.activity_name, tc.item_name,
            tc.skin_name, tc.enemy_name, tc.timeline_label, tc.timeline_year,
            tc.timeline_sort_key, tc.text_metadata
     FROM assets a
     LEFT JOIN categories c ON c.category_id = a.category_id
     LEFT JOIN text_contents tc ON tc.asset_id = a.asset_id
     WHERE a.asset_id = $1`,
    [assetId],
  );
  return asset.rows[0] || null;
}

async function rebuildChunks(client, assetId, fullText) {
  const chunks = splitChunks(fullText);
  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i];
    const charCount = text.length;
    const existing = await client.query(
      `SELECT chunk_id FROM asset_chunks WHERE asset_id = $1 AND chunk_index = $2`,
      [assetId, i],
    );
    if (existing.rows[0]) {
      await client.query(
        `UPDATE asset_chunks
         SET chunk_text = $1, start_offset = NULL, end_offset = NULL,
             deleted_at = NULL, updated_at = now()
         WHERE chunk_id = $2`,
        [text, existing.rows[0].chunk_id],
      );
    } else {
      await client.query(
        `INSERT INTO asset_chunks(asset_id, chunk_index, chunk_text)
         VALUES ($1, $2, $3)`,
        [assetId, i, text],
      );
    }
  }

  await client.query(
    `UPDATE asset_chunks
     SET deleted_at = now(), updated_at = now()
     WHERE asset_id = $1 AND chunk_index >= $2`,
    [assetId, chunks.length],
  );
  return chunks.length;
}

export function setupAdminRoutes(app) {
  const router = express.Router();
  router.use(requireAdmin);

  router.get('/assets', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const values = [];
    const clauses = [];

    if (req.query.query) {
      values.push(`%${req.query.query}%`);
      clauses.push(`(a.title ILIKE $${values.length} OR a.subtitle ILIKE $${values.length} OR tc.full_text ILIKE $${values.length})`);
    }
    if (req.query.category) {
      values.push(req.query.category);
      clauses.push(`c.category_code = $${values.length}`);
    }
    if (req.query.tag) {
      values.push(req.query.tag);
      clauses.push(`EXISTS (
        SELECT 1 FROM asset_tags at
        JOIN tags t ON t.tag_id = at.tag_id
        WHERE at.asset_id = a.asset_id
          AND at.review_status <> 'rejected'
          AND at.deleted_at IS NULL
          AND (t.tag_value = $${values.length} OR t.canonical = $${values.length})
      )`);
    }
    if (req.query.review_status) {
      values.push(req.query.review_status);
      clauses.push(`EXISTS (
        SELECT 1 FROM asset_tags at
        WHERE at.asset_id = a.asset_id AND at.review_status = $${values.length} AND at.deleted_at IS NULL
      )`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    values.push(limit, offset);
    const result = await adminQuery(
      `SELECT a.asset_id, a.asset_kind, a.title, a.subtitle, a.source_name, a.source_url,
              c.category_code, c.category_name, tc.carrier_type, tc.narrative_layer,
              LEFT(tc.full_text, 220) AS text_preview
       FROM assets a
       LEFT JOIN categories c ON c.category_id = a.category_id
       LEFT JOIN text_contents tc ON tc.asset_id = a.asset_id
       ${where}
       ORDER BY a.updated_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    res.json({ rows: result.rows, total: result.rows.length });
  });

  router.get('/assets/:assetId', async (req, res) => {
    const assetId = Number(req.params.assetId);
    const asset = await adminQuery(
      `SELECT a.*, c.category_code, c.category_name,
              tc.full_text, tc.char_count, tc.carrier_type, tc.narrative_layer,
              tc.mission_code, tc.character_name, tc.activity_name, tc.item_name,
              tc.skin_name, tc.enemy_name, tc.timeline_label, tc.timeline_year,
              tc.timeline_sort_key, tc.text_metadata
       FROM assets a
       LEFT JOIN categories c ON c.category_id = a.category_id
       LEFT JOIN text_contents tc ON tc.asset_id = a.asset_id
       WHERE a.asset_id = $1`,
      [assetId],
    );
    if (!asset.rows[0]) return res.status(404).json({ error: 'asset not found' });

    const tags = await adminQuery(
      `SELECT at.asset_tag_id, at.asset_id, at.tag_id, td.dim_code, td.dim_name,
              t.tag_value, t.canonical, t.aliases, at.confidence, at.annotated_by,
              at.review_status, at.evidence, at.note, at.deleted_at
       FROM asset_tags at
       JOIN tags t ON t.tag_id = at.tag_id
       JOIN tag_dimensions td ON td.dim_id = t.dim_id
       WHERE at.asset_id = $1
       ORDER BY at.deleted_at NULLS FIRST, td.sort_order, t.tag_value`,
      [assetId],
    );
    const chunks = await adminQuery(
      `SELECT chunk_id, chunk_index, heading, speaker, chunk_text, char_count,
              review_status, note, deleted_at, updated_at
       FROM asset_chunks
       WHERE asset_id = $1
       ORDER BY chunk_index`,
      [assetId],
    );
    const revisions = await adminQuery(
      `SELECT revision_id, revision_kind, title, subtitle, created_by, created_at, note
       FROM asset_revisions
       WHERE asset_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [assetId],
    );
    const claims = await adminQuery(
      `SELECT cr.claim_id, cr.claim_text, cr.status, cr.confidence, ce.evidence_id, ce.chunk_id, ce.evidence_type
       FROM claim_evidence ce
       JOIN claim_records cr ON cr.claim_id = ce.claim_id
       WHERE ce.asset_id = $1 AND ce.deleted_at IS NULL AND cr.deleted_at IS NULL
       ORDER BY cr.updated_at DESC`,
      [assetId],
    );

    res.json({ asset: asset.rows[0], tags: tags.rows, chunks: chunks.rows, revisions: revisions.rows, claims: claims.rows });
  });

  router.patch('/assets/:assetId', async (req, res) => {
    const assetId = Number(req.params.assetId);
    const assetFields = pick(req.body, ['title', 'subtitle', 'source_name', 'source_url', 'source_path', 'language_code']);
    const textFields = pick(req.body, ['carrier_type', 'narrative_layer', 'mission_code', 'character_name', 'activity_name', 'item_name', 'skin_name', 'enemy_name', 'timeline_label', 'timeline_year', 'timeline_sort_key']);

    const result = await withAdminTransaction(async (client) => {
      const before = await fetchAsset(client, assetId);
      if (!before) throw new Error('asset not found');

      if (Object.keys(assetFields).length) {
        const { sets, params, nextIndex } = buildSetClause(assetFields, assetFields, 1);
        params.push(assetId);
        await client.query(`UPDATE assets SET ${sets.join(', ')}, updated_at = now() WHERE asset_id = $${nextIndex}`, params);
      }
      if (Object.keys(textFields).length) {
        const { sets, params, nextIndex } = buildSetClause(textFields, textFields, 1);
        params.push(assetId);
        await client.query(`UPDATE text_contents SET ${sets.join(', ')} WHERE asset_id = $${nextIndex}`, params);
      }

      const after = await fetchAsset(client, assetId);
      await audit(client, req, 'asset.update', 'asset', assetId, before, after);
      return after;
    });

    res.json({ ok: true, asset: result });
  });

  router.patch('/assets/:assetId/text', async (req, res) => {
    const assetId = Number(req.params.assetId);
    const fullText = String(req.body.full_text ?? '');
    const note = req.body.note || 'text edit';

    const result = await withAdminTransaction(async (client) => {
      const before = await fetchAsset(client, assetId);
      if (!before) throw new Error('asset not found');

      await client.query(
        `INSERT INTO asset_revisions(asset_id, revision_kind, title, subtitle, full_text, metadata, created_by, note)
         VALUES ($1, 'text', $2, $3, $4, $5::jsonb, $6, $7)`,
        [assetId, before.title, before.subtitle, before.full_text || '', JSON.stringify(before.metadata || {}), getAdminActor(req), 'before text edit'],
      );
      await client.query(
        `UPDATE text_contents
         SET full_text = $1
         WHERE asset_id = $2`,
        [fullText, assetId],
      );
      await client.query(`UPDATE assets SET updated_at = now() WHERE asset_id = $1`, [assetId]);
      const chunkCount = await rebuildChunks(client, assetId, fullText);
      const after = await fetchAsset(client, assetId);
      await audit(client, req, 'asset.text.update', 'asset', assetId, before, after, note);
      return { asset: after, chunkCount };
    });

    res.json({ ok: true, ...result });
  });

  router.post('/assets/:assetId/rebuild-chunks', async (req, res) => {
    const assetId = Number(req.params.assetId);
    const result = await withAdminTransaction(async (client) => {
      const before = await fetchAsset(client, assetId);
      if (!before) throw new Error('asset not found');
      const chunkCount = await rebuildChunks(client, assetId, before.full_text || '');
      await audit(client, req, 'asset.chunks.rebuild', 'asset', assetId, null, { chunkCount });
      return { chunkCount };
    });
    res.json({ ok: true, ...result });
  });

  router.get('/tags', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const values = [];
    const clauses = [];
    if (req.query.query) {
      values.push(`%${req.query.query}%`);
      clauses.push(`(t.tag_value ILIKE $${values.length} OR t.canonical ILIKE $${values.length})`);
    }
    if (req.query.dim_code) {
      values.push(req.query.dim_code);
      clauses.push(`td.dim_code = $${values.length}`);
    }
    values.push(limit);
    const result = await adminQuery(
      `SELECT t.*, td.dim_code, td.dim_name
       FROM tags t
       JOIN tag_dimensions td ON td.dim_id = t.dim_id
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY t.total_asset_count DESC, t.tag_value
       LIMIT $${values.length}`,
      values,
    );
    res.json({ rows: result.rows });
  });

  router.post('/tags', async (req, res) => {
    const { dim_code, tag_value, canonical, aliases, description } = req.body;
    if (!dim_code || !tag_value) return res.status(400).json({ error: 'dim_code and tag_value are required' });

    const result = await withAdminTransaction(async (client) => {
      const dim = await client.query(`SELECT dim_id FROM tag_dimensions WHERE dim_code = $1`, [dim_code]);
      if (!dim.rows[0]) throw new Error('tag dimension not found');
      const inserted = await client.query(
        `INSERT INTO tags(dim_id, tag_value, canonical, aliases, description, metadata)
         VALUES ($1, $2, $3, $4::jsonb, $5, '{}'::jsonb)
         ON CONFLICT (dim_id, tag_value)
         DO UPDATE SET canonical = EXCLUDED.canonical, aliases = EXCLUDED.aliases,
                       description = EXCLUDED.description, updated_at = now()
         RETURNING *`,
        [dim.rows[0].dim_id, tag_value, canonical || null, JSON.stringify(jsonValue(aliases, [])), description || null],
      );
      await audit(client, req, 'tag.upsert', 'tag', inserted.rows[0].tag_id, null, inserted.rows[0]);
      return inserted.rows[0];
    });
    res.json({ ok: true, tag: result });
  });

  router.post('/assets/:assetId/tags', async (req, res) => {
    const assetId = Number(req.params.assetId);
    const { tag_id, dim_code, tag_value, confidence = 1, evidence = {}, note = null } = req.body;

    const result = await withAdminTransaction(async (client) => {
      let resolvedTagId = tag_id;
      if (!resolvedTagId) {
        if (!dim_code || !tag_value) throw new Error('tag_id or dim_code/tag_value required');
        const dim = await client.query(`SELECT dim_id FROM tag_dimensions WHERE dim_code = $1`, [dim_code]);
        if (!dim.rows[0]) throw new Error('tag dimension not found');
        const tag = await client.query(
          `INSERT INTO tags(dim_id, tag_value, canonical, aliases, metadata)
           VALUES ($1, $2, $2, '[]'::jsonb, '{}'::jsonb)
           ON CONFLICT (dim_id, tag_value) DO UPDATE SET updated_at = now()
           RETURNING tag_id`,
          [dim.rows[0].dim_id, tag_value],
        );
        resolvedTagId = tag.rows[0].tag_id;
      }

      const before = await client.query(`SELECT * FROM asset_tags WHERE asset_id = $1 AND tag_id = $2`, [assetId, resolvedTagId]);
      const upserted = await client.query(
        `INSERT INTO asset_tags(asset_id, tag_id, confidence, annotated_by, review_status, evidence, note, deleted_at)
         VALUES ($1, $2, $3, 'human', 'approved', $4::jsonb, $5, NULL)
         ON CONFLICT (asset_id, tag_id)
         DO UPDATE SET confidence = EXCLUDED.confidence, annotated_by = 'human',
                       review_status = 'approved', evidence = EXCLUDED.evidence,
                       note = EXCLUDED.note, deleted_at = NULL, updated_at = now()
         RETURNING *`,
        [assetId, resolvedTagId, confidence, JSON.stringify(evidence || {}), note],
      );
      await audit(client, req, 'asset_tag.upsert', 'asset_tag', upserted.rows[0].asset_tag_id, before.rows[0] || null, upserted.rows[0]);
      return upserted.rows[0];
    });
    res.json({ ok: true, assetTag: result });
  });

  router.patch('/asset-tags/:assetTagId', async (req, res) => {
    const assetTagId = Number(req.params.assetTagId);
    const fields = pick(req.body, ['confidence', 'annotated_by', 'review_status', 'note']);
    if (req.body.evidence !== undefined) fields.evidence = JSON.stringify(jsonValue(req.body.evidence, {}));
    if (fields.review_status && !REVIEW_STATUSES.has(fields.review_status)) return res.status(400).json({ error: 'invalid review_status' });

    const result = await withAdminTransaction(async (client) => {
      const before = await client.query(`SELECT * FROM asset_tags WHERE asset_tag_id = $1`, [assetTagId]);
      if (!before.rows[0]) throw new Error('asset tag not found');
      const { sets, params, nextIndex } = buildSetClause(fields, fields, 1);
      params.push(assetTagId);
      const updated = await client.query(
        `UPDATE asset_tags SET ${sets.join(', ')}, updated_at = now() WHERE asset_tag_id = $${nextIndex} RETURNING *`,
        params,
      );
      await audit(client, req, 'asset_tag.update', 'asset_tag', assetTagId, before.rows[0], updated.rows[0]);
      return updated.rows[0];
    });
    res.json({ ok: true, assetTag: result });
  });

  router.delete('/asset-tags/:assetTagId', async (req, res) => {
    const assetTagId = Number(req.params.assetTagId);
    await withAdminTransaction(async (client) => {
      const before = await client.query(`SELECT * FROM asset_tags WHERE asset_tag_id = $1`, [assetTagId]);
      if (!before.rows[0]) throw new Error('asset tag not found');
      const updated = await client.query(
        `UPDATE asset_tags SET review_status = 'rejected', deleted_at = now(), updated_at = now() WHERE asset_tag_id = $1 RETURNING *`,
        [assetTagId],
      );
      await audit(client, req, 'asset_tag.soft_delete', 'asset_tag', assetTagId, before.rows[0], updated.rows[0]);
    });
    res.json({ ok: true });
  });

  router.get('/claims', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const values = [];
    const clauses = [`deleted_at IS NULL`];
    if (req.query.query) {
      values.push(`%${req.query.query}%`);
      clauses.push(`(claim_text ILIKE $${values.length} OR summary ILIKE $${values.length})`);
    }
    if (req.query.status) {
      values.push(req.query.status);
      clauses.push(`status = $${values.length}`);
    }
    if (req.query.entity) {
      values.push(req.query.entity);
      clauses.push(`entities ? $${values.length}`);
    }
    values.push(limit);
    const result = await adminQuery(
      `SELECT * FROM claim_records
       WHERE ${clauses.join(' AND ')}
       ORDER BY updated_at DESC
       LIMIT $${values.length}`,
      values,
    );
    res.json({ rows: result.rows });
  });

  router.post('/claims', async (req, res) => {
    const { claim_text, summary, status = 'unverified', source_type = 'manual', source_ref, entities = [], confidence = 0.5, note } = req.body;
    if (!claim_text) return res.status(400).json({ error: 'claim_text is required' });
    if (!CLAIM_STATUSES.has(status)) return res.status(400).json({ error: 'invalid status' });

    const result = await withAdminTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO claim_records(claim_text, summary, status, source_type, source_ref, entities, confidence, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
         RETURNING *`,
        [claim_text, summary || null, status, source_type, source_ref || null, JSON.stringify(jsonValue(entities, [])), confidence, note || null, getAdminActor(req)],
      );
      await audit(client, req, 'claim.create', 'claim', inserted.rows[0].claim_id, null, inserted.rows[0]);
      return inserted.rows[0];
    });
    res.json({ ok: true, claim: result });
  });

  router.patch('/claims/:claimId', async (req, res) => {
    const claimId = Number(req.params.claimId);
    const fields = pick(req.body, ['claim_text', 'summary', 'status', 'source_type', 'source_ref', 'confidence', 'note']);
    if (req.body.entities !== undefined) fields.entities = JSON.stringify(jsonValue(req.body.entities, []));
    fields.updated_by = getAdminActor(req);
    if (fields.status && !CLAIM_STATUSES.has(fields.status)) return res.status(400).json({ error: 'invalid status' });

    const result = await withAdminTransaction(async (client) => {
      const before = await client.query(`SELECT * FROM claim_records WHERE claim_id = $1`, [claimId]);
      if (!before.rows[0]) throw new Error('claim not found');
      const { sets, params, nextIndex } = buildSetClause(fields, fields, 1);
      params.push(claimId);
      const updated = await client.query(
        `UPDATE claim_records SET ${sets.join(', ')}, updated_at = now() WHERE claim_id = $${nextIndex} RETURNING *`,
        params,
      );
      await audit(client, req, 'claim.update', 'claim', claimId, before.rows[0], updated.rows[0]);
      return updated.rows[0];
    });
    res.json({ ok: true, claim: result });
  });

  router.post('/claims/:claimId/evidence', async (req, res) => {
    const claimId = Number(req.params.claimId);
    const { asset_id, chunk_id, evidence_type = 'supports', quote, note } = req.body;
    const result = await withAdminTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO claim_evidence(claim_id, asset_id, chunk_id, evidence_type, quote, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [claimId, asset_id || null, chunk_id || null, evidence_type, quote || null, note || null, getAdminActor(req)],
      );
      await audit(client, req, 'claim_evidence.create', 'claim_evidence', inserted.rows[0].evidence_id, null, inserted.rows[0]);
      return inserted.rows[0];
    });
    res.json({ ok: true, evidence: result });
  });

  router.delete('/claims/:claimId/evidence/:evidenceId', async (req, res) => {
    const evidenceId = Number(req.params.evidenceId);
    await withAdminTransaction(async (client) => {
      const before = await client.query(`SELECT * FROM claim_evidence WHERE evidence_id = $1`, [evidenceId]);
      if (!before.rows[0]) throw new Error('evidence not found');
      const updated = await client.query(`UPDATE claim_evidence SET deleted_at = now() WHERE evidence_id = $1 RETURNING *`, [evidenceId]);
      await audit(client, req, 'claim_evidence.soft_delete', 'claim_evidence', evidenceId, before.rows[0], updated.rows[0]);
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
      const revision = await client.query(`SELECT * FROM asset_revisions WHERE revision_id = $1`, [revisionId]);
      if (!revision.rows[0]) throw new Error('revision not found');
      const rev = revision.rows[0];
      const before = await fetchAsset(client, rev.asset_id);
      if (!before) throw new Error('asset not found');

      await client.query(
        `INSERT INTO asset_revisions(asset_id, revision_kind, title, subtitle, full_text, metadata, created_by, note)
         VALUES ($1, 'restore_backup', $2, $3, $4, $5::jsonb, $6, $7)`,
        [rev.asset_id, before.title, before.subtitle, before.full_text || '', JSON.stringify(before.metadata || {}), getAdminActor(req), `backup before restoring revision ${revisionId}`],
      );
      await client.query(
        `UPDATE assets SET title = COALESCE($1, title), subtitle = $2, updated_at = now() WHERE asset_id = $3`,
        [rev.title, rev.subtitle, rev.asset_id],
      );
      if (rev.full_text != null) {
        await client.query(
          `UPDATE text_contents SET full_text = $1 WHERE asset_id = $2`,
          [rev.full_text, rev.asset_id],
        );
        await rebuildChunks(client, rev.asset_id, rev.full_text);
      }
      const after = await fetchAsset(client, rev.asset_id);
      await audit(client, req, 'revision.restore', 'asset', rev.asset_id, before, after, `restored revision ${revisionId}`);
      return after;
    });
    res.json({ ok: true, asset: result });
  });

  app.use('/api/admin', router);
}
