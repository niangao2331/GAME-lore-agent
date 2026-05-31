import { Pool } from 'pg';
import fs from 'fs';

const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'arknights_lore_new', user: 'postgres', password: 'postgres', ssl: false });

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[文件:[^\]]+\]\]/g, '')
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .trim();
}

function parseStats(str) {
  if (!str || str === '0;0;0' || str === ';;;;') return null;
  const parts = str.split(';').filter(s => s !== '');
  if (parts.length === 0) return null;
  return parts;
}

async function main() {
  const rawArr = JSON.parse(fs.readFileSync(
    'C:/Users/niangao233/.claude/projects/D--web/4de366a8-2b21-4f27-b072-f06dd07a749e/tool-results/tool_lwcgV4BPidII131n2ZyvMNuY.json',
    'utf8'
  ));
  const text = rawArr[0].text.replace('### Result\n', '');
  const data = JSON.parse(text);
  const modules = data.cargoquery;

  console.log('Total module records:', modules.length);

  // Get all operator names from documents
  const opDocs = await pool.query(`
    SELECT document_id, metadata->>'operator_name' as op_name
    FROM documents
    WHERE metadata ? 'operator_name'
  `);
  const opMap = new Map();
  for (const r of opDocs.rows) {
    opMap.set(r.op_name, r.document_id);
  }
  console.log('Operator documents:', opMap.size);

  // Group modules by opt (operator name)
  const byOperator = new Map();
  for (const rec of modules) {
    const t = rec.title;
    const opt = t.opt;
    if (!byOperator.has(opt)) {
      byOperator.set(opt, []);
    }
    byOperator.get(opt).push(t);
  }

  console.log('Unique operators:', byOperator.size);

  let matched = 0;
  let unmatched = [];
  let inserted = 0;

  for (const [opt, mods] of byOperator) {
    const docId = opMap.get(opt);

    if (!docId) {
      unmatched.push(opt);
      continue;
    }

    matched++;

    // Find max unit_index
    const idxRes = await pool.query(`
      SELECT COALESCE(MAX(unit_index), -1) + 1 as next_idx
      FROM text_units WHERE document_id = $1
    `, [docId]);
    let nextIdx = idxRes.rows[0].next_idx;

    // Build module description text
    const parts = [];
    parts.push(`【干员模组信息】来源：PRTS wiki 干员模组一览`);
    parts.push(`干员：${opt}`);
    parts.push(`模组数量：${mods.length}`);
    parts.push('');

    for (const m of mods) {
      parts.push(`--- 模组：${stripHtml(m.name)}（${m.type}） ---`);

      // Stats
      const stats = [];
      const hp = parseStats(m.hp);
      const atk = parseStats(m.atk);
      const def = parseStats(m.def);
      const res = parseStats(m.res);
      const time = parseStats(m.time);
      const cost = parseStats(m.cost);
      const block = parseStats(m.block);
      const atkspd = parseStats(m.atkspd);
      if (hp) stats.push(`生命 +${hp[0]}→+${hp[2]}`);
      if (atk) stats.push(`攻击 +${atk[0]}→+${atk[2]}`);
      if (def) stats.push(`防御 +${def[0]}→+${def[2]}`);
      if (res && res.some(v => v !== '0')) stats.push(`法抗 +${res[0]}→+${res[2]}`);
      if (time && time.some(v => v !== '0')) stats.push(`再部署时间 ${time[0]}→${time[2]}`);
      if (cost && cost.some(v => v !== '0')) stats.push(`部署费用 ${cost[0]}→${cost[2]}`);
      if (block && block.some(v => v !== '0')) stats.push(`阻挡数 ${block[0]}→${block[2]}`);
      if (atkspd && atkspd.some(v => v !== '0')) stats.push(`攻击速度 ${atkspd[0]}→${atkspd[2]}`);
      if (stats.length > 0) {
        parts.push('数值变化（基础→满级）：' + stats.join('，'));
      }

      // Trait
      if (m.traitadd === 'yes' && m.trait) {
        parts.push('特性追加：' + stripHtml(m.trait));
      } else if (m.trait) {
        parts.push('特性：' + stripHtml(m.trait));
      }

      // Talents
      if (m.talent2) {
        parts.push(stripHtml(m.talent2));
      }
      if (m.talent3) {
        parts.push(stripHtml(m.talent3));
      }

      // Level requirement
      if (m.lv) {
        parts.push(`解锁条件：精英阶段2 等级${stripHtml(m.lv)}`);
      }

      // Missions
      if (m.mission1) {
        const m1 = stripHtml(m.mission1).trim();
        if (m1 && m1 !== '无') parts.push('模组任务1：' + m1);
      }
      if (m.mission2) {
        const m2 = stripHtml(m.mission2).trim();
        if (m2 && m2 !== '无') parts.push('模组任务2：' + m2);
      }

      // Conditions
      if (m.cond) {
        const cond = stripHtml(m.cond).trim();
        if (cond) parts.push('基础条件：' + cond);
      }
      if (m.cond2) {
        const cond2 = stripHtml(m.cond2).trim();
        if (cond2) parts.push('追加条件1：' + cond2);
      }
      if (m.cond3) {
        const cond3 = stripHtml(m.cond3).trim();
        if (cond3) parts.push('追加条件2：' + cond3);
      }

      parts.push('');
    }

    const fullText = parts.join('\n');

    // Insert new text unit
    await pool.query(`
      INSERT INTO text_units (
        document_id, unit_index, unit_kind, heading, text,
        source_tier, content_type, metadata, review_status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
    `, [
      docId,
      nextIdx,
      'chunk',
      '干员模组',
      fullText,
      2,  // Tier 2: official records
      'operator_module',
      JSON.stringify({
        summary: opt + '的模组信息',
        summary_short: '模组详情',
        key_terms: ['模组', '特性', '天赋', '干员模组'],
      }),
      'pending',
    ]);
    inserted++;
  }

  console.log(`\nResults:`);
  console.log(`  Matched operators: ${matched}`);
  console.log(`  Inserted units: ${inserted}`);
  if (unmatched.length > 0) {
    console.log(`  Unmatched: ${unmatched.length}`);
    for (const u of unmatched.slice(0, 30)) {
      console.log(`    ${u}`);
    }
  }

  await pool.end();
}

main().catch(err => {
  console.error(err);
  pool.end();
  process.exit(1);
});
