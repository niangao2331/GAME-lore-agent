#!/usr/bin/env node
// Structured plan test suite v2
// Improvements:
// 1. Series full expansion — once a series is identified, pull ALL its docs
// 2. Non-typical query fallback — text search when anchors+supplements < 10
// 3. Long CJK chunk decomposition for >8-char chunks

import { writeFileSync } from 'fs';
import pg from 'pg';
const { Pool } = pg;

const DB_CONFIG = {
  host: '127.0.0.1', port: 5432, database: 'arknights_lore_new',
  user: 'postgres', password: 'postgres', max: 8,
  connectionTimeoutMillis: 5000,
};
const pool = new Pool(DB_CONFIG);

async function queryNew(sql, params = []) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

function uniqueStrings(values, limit = 30) {
  return [...new Set((values || []).map(v => String(v || '').trim()).filter(Boolean))].slice(0, limit);
}

function stripActivityCode(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/^[A-Z]{2,5}\d?(?:-[A-Z]{1,4})*(?:-\d+)?\s+/u, '')
    .replace(/^[A-Z]{2,5}\d?\s+/u, '').trim() || value;
}

function documentSeriesKey(row) {
  const title = String(row.title || row.document_title || '');
  const stage = title.split(/\s+/)[0] || title;
  const eventMatch = stage.match(/^([A-Z]{2,4})(?:-[A-Z])?-(?:ST)?\d+/i) ||
    stage.match(/^([A-Z]{2,4})-ST-?\d+/i);
  if (eventMatch) {
    const path = Array.isArray(row.document_story_path || row.story_path) ?
      row.document_story_path || row.story_path : [];
    const visible = stripActivityCode(path[path.length - 1] || row.group_name ||
      row.document_title || `${eventMatch[1].toUpperCase()} series`);
    return { key: `${eventMatch[1].toUpperCase()} series`, displayKey: visible,
      titleContains: [eventMatch[1].toUpperCase()] };
  }
  const mainlineMatch = stage.match(/^(\d{1,2})-/);
  if (mainlineMatch) {
    return { key: `EP${String(mainlineMatch[1]).padStart(2, '0')} mainline`,
      displayKey: `EP${String(mainlineMatch[1]).padStart(2, '0')} mainline`,
      titleContains: [`${mainlineMatch[1]}-`] };
  }
  const path = Array.isArray(row.document_story_path || row.story_path) ?
    row.document_story_path || row.story_path : [];
  const fallback = path[path.length - 1] || row.group_name || row.top_group ||
    row.title || row.document_title || 'story';
  return { key: fallback, displayKey: stripActivityCode(fallback), titleContains: [] };
}

function evidenceLane(tier, contentType) {
  if (Number(tier) === 1) return 'story';
  if (Number(tier) === 2) return 'official_record';
  if (Number(tier) === 3) return 'in_universe_publication';
  if (contentType === 'system_text' || contentType === 'enemy_profile') return 'system_or_profile';
  return 'weak_or_character_voice';
}

// ── Enhanced CJK extraction ──
// Handles ANY length CJK text, including chunks >8 chars that compactSearchTerms skips

function extractAllCJKTerms(str, minSize = 3, maxSize = 4) {
  const cleaned = str.replace(/[^一-鿿]/g, '');
  if (cleaned.length < minSize) return [];
  const terms = [];
  for (const size of [minSize, maxSize]) {
    for (let i = 0; i <= cleaned.length - size; i++) {
      terms.push(cleaned.slice(i, i + size));
    }
  }
  return terms;
}

// Split text by separators but also keep raw chunks >2 chars
function extractSearchTerms(rawQuery) {
  const raw = String(rawQuery || '').trim();
  if (!raw) return [];
  // Split by separators
  const parts = raw.split(/[\s,，、。；;|/]+/).map(s => s.trim()).filter(Boolean);
  // CJK chunks of reasonable length
  const cleaned = raw.replace(/[的了呢吗啊吧？?！!。，“”"':：]+/g, ' ').trim();
  const cjkChunks = cleaned.match(/[一-鿿A-Za-z0-9·-]{2,18}/g) || [];
  // Extract 3-4 gram windows from all CJK content
  const cjkWindows = extractAllCJKTerms(raw, 3, 4);
  // Also extract 2-gram windows but only keep ones >= 2 chars and not purely punctuation
  const all2grams = [];
  for (const chunk of cjkChunks) {
    const cjk = chunk.replace(/[^一-鿿]/g, '');
    if (cjk.length >= 2 && cjk.length <= 8) {
      for (let i = 0; i <= cjk.length - 2; i++) {
        all2grams.push(cjk.slice(i, i + 2));
      }
    }
  }
  return uniqueStrings([
    raw,
    ...parts.filter(t => t.length >= 2),
    ...cjkChunks.filter(t => t.length >= 2),
    ...cjkWindows,
    ...all2grams,
  ], 30);
}

// ── Structured plan v2 ──

async function runStructuredPlan(query) {
  const searchTerms = extractSearchTerms(query);

  // Separate terms for different search layers
  const anchorTerms = uniqueStrings([
    query,
    ...searchTerms.filter(t => t.length >= 3),
  ], 20).map(t => `%${t}%`);

  const supplementTerms = uniqueStrings([
    query,
    ...searchTerms.filter(t => t.length >= 3),
  ], 12).map(t => `%${t}%`);

  // Step 1: Anchor search (title + operator fields)
  const anchorResult = await queryNew(
    `SELECT document_id, title, subtitle, source_tier, content_type,
            metadata->>'top_group' AS top_group,
            metadata->>'group_name' AS group_name,
            metadata->'story_path' AS story_path
     FROM documents
     WHERE title ILIKE ANY($1::text[])
        OR metadata->>'operator_name' ILIKE ANY($1::text[])
        OR metadata->>'operator_summary' ILIKE ANY($1::text[])
     ORDER BY
        CASE WHEN title ILIKE ANY($1::text[]) THEN 0
             WHEN metadata->>'operator_name' ILIKE ANY($1::text[]) THEN 1
             ELSE 2 END,
        source_tier ASC, title ASC
     LIMIT 50`,
    [anchorTerms]
  );

  // Step 2: Supplement search (summary + heading + key_terms)
  let supplementDocs = [];
  if (supplementTerms.length > 0) {
    const suppResult = await queryNew(
      `SELECT DISTINCT d.document_id, d.title, d.subtitle, d.source_tier, d.content_type,
              d.metadata->>'top_group' AS top_group,
              d.metadata->>'group_name' AS group_name,
              d.metadata->'story_path' AS story_path
       FROM documents d
       JOIN text_units tu ON tu.document_id = d.document_id
       WHERE tu.heading ILIKE ANY($1::text[])
          OR tu.metadata->>'summary' ILIKE ANY($1::text[])
          OR tu.metadata->>'summary_short' ILIKE ANY($1::text[])
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(
              COALESCE(tu.metadata->'key_terms', '[]'::jsonb)) kt(value)
            WHERE kt.value ILIKE ANY($1::text[])
          )
       ORDER BY d.source_tier ASC, d.title ASC
       LIMIT 40`,
      [supplementTerms]
    );
    supplementDocs = suppResult.rows;
  }

  // Step 3: Fallback text search (for non-typical queries where anchors+supplements are thin)
  let fallbackDocs = [];
  const combinedTotal = anchorResult.rows.length + supplementDocs.length;
  if (combinedTotal < 10 && supplementTerms.length > 0) {
    // Broader search including raw text — used ONLY for series discovery
    const fbResult = await queryNew(
      `SELECT DISTINCT d.document_id, d.title, d.subtitle, d.source_tier, d.content_type,
              d.metadata->>'top_group' AS top_group,
              d.metadata->>'group_name' AS group_name,
              d.metadata->'story_path' AS story_path
       FROM documents d
       JOIN text_units tu ON tu.document_id = d.document_id
       WHERE tu.text ILIKE ANY($1::text[])
          OR d.title ILIKE ANY($1::text[])
       ORDER BY d.source_tier ASC, d.title ASC
       LIMIT 30`,
      [supplementTerms]
    );
    fallbackDocs = fbResult.rows;
  }

  // Merge all found docs
  const foundDocs = [...anchorResult.rows];
  const seenIds = new Set(anchorResult.rows.map(d => d.document_id));
  for (const doc of supplementDocs) {
    if (!seenIds.has(doc.document_id)) { foundDocs.push(doc); seenIds.add(doc.document_id); }
  }
  for (const doc of fallbackDocs) {
    if (!seenIds.has(doc.document_id)) { foundDocs.push(doc); seenIds.add(doc.document_id); }
  }

  // Series analysis from found docs
  const seriesMap = new Map();
  const laneMap = new Map();
  for (const doc of foundDocs) {
    const series = documentSeriesKey(doc);
    const lane = evidenceLane(doc.source_tier, doc.content_type);

    const existing = seriesMap.get(series.key) || {
      key: series.key, display_name: series.displayKey,
      title_contains: series.titleContains, document_count: 0,
      source_tiers: new Set(), document_ids: [],
    };
    existing.document_count++;
    existing.source_tiers.add(Number(doc.source_tier));
    existing.document_ids.push(doc.document_id);
    seriesMap.set(series.key, existing);

    const laneExisting = laneMap.get(lane) || { lane, count: 0 };
    laneExisting.count++;
    laneMap.set(lane, laneExisting);
  }

  // ── Series expansion: pull ALL docs for identified series ──
  // Only expand when enough docs were directly matched (prevents noise-series expansion)
  for (const [key, info] of seriesMap) {
    if (!info.title_contains?.length) continue;
    if (info.document_count < 3) continue; // need at least 3 direct matches

    const prefix = info.title_contains[0];
    const expandPattern = prefix.match(/^\d+-$/)
      ? `${prefix}%`
      : `${prefix}-%`;

    const expandResult = await queryNew(
      `SELECT document_id, title, subtitle, source_tier, content_type,
              metadata->>'top_group' AS top_group,
              metadata->>'group_name' AS group_name,
              metadata->'story_path' AS story_path
       FROM documents
       WHERE title LIKE $1
       ORDER BY title ASC`,
      [expandPattern]
    );

    // Only expand if matched docs cover >= 20% of total series, or at least 5 matches
    const totalSeriesSize = expandResult.rows.length;
    if (totalSeriesSize === 0) continue;
    const matchRatio = info.document_count / totalSeriesSize;
    if (info.document_count < 5 && matchRatio < 0.2) continue;

    const newIds = [];
    const oldIds = new Set(info.document_ids.map(String));
    for (const doc of expandResult.rows) {
      if (!oldIds.has(String(doc.document_id))) {
        newIds.push(doc.document_id);
      }
      if (!seenIds.has(doc.document_id)) {
        foundDocs.push(doc);
        seenIds.add(doc.document_id);
        const lane = evidenceLane(doc.source_tier, doc.content_type);
        const laneExisting = laneMap.get(lane) || { lane, count: 0 };
        laneExisting.count++;
        laneMap.set(lane, laneExisting);
      }
    }
    info.document_count = totalSeriesSize;
    info.document_ids = expandResult.rows.map(d => d.document_id);
    info.expanded_by = newIds.length;

    const unitResult = await queryNew(
      `SELECT COUNT(*)::int as unit_count FROM text_units WHERE document_id = ANY($1::bigint[])`,
      [info.document_ids]
    );
    info.total_units = unitResult.rows[0].unit_count;
  }

  // Rename series via key_terms
  for (const [key, info] of seriesMap) {
    if (!info.title_contains?.length || info.document_ids.length < 2) continue;
    try {
      const termsResult = await queryNew(
        `SELECT kt.value as term, COUNT(DISTINCT tu.document_id)::int as doc_count
         FROM text_units tu,
              jsonb_array_elements_text(COALESCE(tu.metadata->'key_terms', '[]'::jsonb)) kt(value)
         WHERE tu.document_id = ANY($1::bigint[])
           AND length(kt.value) >= 2
         GROUP BY kt.value
         ORDER BY doc_count DESC, CHAR_LENGTH(kt.value) DESC
         LIMIT 15`,
        [info.document_ids]
      );
      const minDocs = Math.max(2, Math.ceil(info.document_count * 0.25));
      const topTerm = termsResult.rows.find(r =>
        !/^[A-Z]{2,4}$/.test(r.term || '') &&
        !/^\d/.test(r.term || '') &&
        Number(r.doc_count) >= minDocs
      );
      if (topTerm) info.display_name = topTerm.term;
    } catch {}
  }

  // Sort and rank
  const eventSeries = [...seriesMap.values()]
    .filter(s => s.title_contains?.length > 0 && s.source_tiers.has(1))
    .sort((a, b) => b.document_count - a.document_count);

  const mainlineSeries = [...seriesMap.values()]
    .filter(s => !s.title_contains?.length && s.source_tiers.has(1))
    .sort((a, b) => b.document_count - a.document_count);

  const rankedSeries = [...eventSeries, ...mainlineSeries].slice(0, 6);

  const expansionGain = [...seriesMap.values()]
    .reduce((sum, s) => sum + (s.expanded_by || 0), 0);

  return {
    query,
    total_docs: foundDocs.length,
    anchors: anchorResult.rows.length,
    supplements: supplementDocs.length,
    fallback: fallbackDocs.length,
    expansion_gain: expansionGain,
    lanes: [...laneMap.values()],
    series: rankedSeries.map(s => ({
      name: s.display_name || s.key,
      title_contains: s.title_contains,
      count: s.document_count,
      expanded_by: s.expanded_by || 0,
      tiers: [...s.source_tiers],
      // Total units estimate for coverage measurement
      total_units_estimate: s.total_units || 0,
    })),
    search_terms: uniqueStrings(searchTerms, 8),
  };
}

// ── Scoring ──

function scoreResult(result) {
  let score = 0;
  const reasons = [];

  const lanes = new Set(result.lanes.map(l => l.lane));
  if (lanes.has('story')) { score += 10; reasons.push('story'); }
  if (lanes.has('official_record')) { score += 10; reasons.push('profile'); }
  if (lanes.has('in_universe_publication')) { score += 5; reasons.push('T3pub'); }

  const eventSeries = result.series.filter(s => s.title_contains?.length > 0);
  if (eventSeries.length >= 2) { score += 10; reasons.push(`${eventSeries.length} events`); }
  else if (eventSeries.length >= 1) { score += 5; }

  if (result.total_docs > 0) { score += 10; reasons.push('has docs'); }
  else { score = -100; reasons.push('ZERO'); return { score, reasons }; }

  if (result.anchors > 0) { score += 5; reasons.push('anchors'); }
  if (result.supplements > 0) { score += 5; reasons.push('suppl'); }

  // NEW: expansion coverage bonus
  if (result.expansion_gain > 0) { score += 10; reasons.push(`expand+${result.expansion_gain}`); }

  // NEW: high coverage per series
  const avgSeriesCoverage = eventSeries.length > 0
    ? eventSeries.reduce((s, es) => s + es.count, 0) / eventSeries.length : 0;
  if (avgSeriesCoverage >= 15) { score += 5; reasons.push('deep coverage'); }

  if (result.total_docs >= 30) { score += 5; reasons.push('broad'); }

  return { score, reasons };
}

async function main() {
  const queries = [
    '莱茵生命',
    '罗德岛',
    '深海猎人',
    '整合运动',
    '塞雷娅',
    '克丽斯腾',
    '凯尔希',
    '阿米娅',
    '绿野幻梦',
    '孤星',
    '多萝西的承诺',
    '塞雷娅什么时候成为总辖',
    '赫默和伊芙利特的关系',
    '塞雷娅和赫默的关系',
    '凯尔希和博士的关系',
    // ── Non-typical queries ──
    '那个在哥伦比亚搞科研的组织',
    '谁杀了特蕾西娅',
    '炎魔事件是怎么回事',
    '源石技艺的起源',
    '阿米娅的亲生父母',
  ];

  const results = [];
  let totalScore = 0, passCount = 0, failCount = 0;

  console.log('='.repeat(90));
  console.log('STRUCTURED PLAN TEST SUITE v2');
  console.log('='.repeat(90));

  for (const query of queries) {
    process.stdout.write(`Testing: "${query}"... `);
    const result = await runStructuredPlan(query);
    const { score, reasons } = scoreResult(result);
    totalScore += score;

    if (score < 0) { console.log(`FAIL (${score})`); failCount++; }
    else { console.log(`OK (${score})`); passCount++; }

    results.push({
      query, score, reasons,
      docs: result.total_docs,
      a: result.anchors, s: result.supplements, f: result.fallback, exp: result.expansion_gain,
      lanes: result.lanes.map(l => `${l.lane}:${l.count}`),
      series: result.series.map(s =>
        `${s.name}[${(s.title_contains||[]).join(',')}](${s.count}${s.expanded_by ? '+' + s.expanded_by : ''})`),
      terms: result.search_terms,
    });
  }

  // Table
  console.log('\n' + '='.repeat(90));
  console.log('RESULTS');
  console.log('='.repeat(90));
  console.log(`${'Query'.padEnd(22)} Score  Docs A  S  F  Exp Series`);
  console.log('-'.repeat(90));
  for (const r of results) {
    const q = r.query.padEnd(20).slice(0, 20);
    const ser = r.series.slice(0, 2).map(s => s.split('[')[0]).join(',');
    const serInfo = r.series.slice(0, 3).map(s => {
      const parts = s.match(/^(.+?)\[([^\]]+)\]\((\d+)(?:\+(\d+))?\)$/);
      if (parts) {
        const name = parts[1], code = parts[2], count = parts[3], exp = parts[4];
        return exp ? `${name}(${count}+${exp})` : `${name}(${count})`;
      }
      return s.slice(0, 30);
    }).join(', ');
    console.log(`${q} ${String(r.score).padStart(4)} ${String(r.docs).padStart(4)} ${String(r.a).padStart(2)} ${String(r.s).padStart(2)} ${String(r.f).padStart(2)} ${String(r.exp).padStart(3)} ${serInfo}`);
  }

  console.log('-'.repeat(90));
  console.log(`Pass: ${passCount}/${queries.length}  Fail: ${failCount}  Score: ${totalScore}  Avg: ${(totalScore/queries.length).toFixed(1)}`);

  // Show non-typical results in detail
  console.log('\n--- Non-typical queries detail ---');
  const ntQueries = queries.slice(15);
  for (const r of results.filter(r => ntQueries.includes(r.query))) {
    console.log(`\n"${r.query}" (score: ${r.score})`);
    console.log(`  docs: ${r.docs} (a:${r.a} s:${r.s} f:${r.f} exp:${r.exp})`);
    console.log(`  lanes: ${r.lanes.join(', ')}`);
    console.log(`  series: ${r.series.join(' | ')}`);
    console.log(`  terms: ${(r.terms||[]).join(', ')}`);
  }

  writeFileSync('test-structured-results.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: { pass: passCount, fail: failCount, totalScore, avgScore: (totalScore/queries.length).toFixed(1), totalQueries: queries.length },
    results,
  }, null, 2));
  console.log(`\nReport written to test-structured-results.json`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
