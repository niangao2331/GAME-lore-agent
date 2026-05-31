const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'arknights_lore_new', user: 'postgres', password: 'postgres', ssl: false });

// ── Wiki text parsing ──────────────────────────────────────────────────────

function stripWikiMarkup(text) {
  if (!text) return '';
  return text
    // Remove templates like {{剧情角色立绘|...}}
    .replace(/\{\{[\s\S]*?\}\}/g, '')
    // Remove file embeds
    .replace(/\[\[文件:[^\]]+\]\]/g, '')
    .replace(/\[\[File:[^\]]+\]\]/g, '')
    // Remove references
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<ref[^>]*\/>/g, '')
    // Wiki links [[target|display]] -> display
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    // Wiki links [[target]] -> target
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    // <br> -> newline
    .replace(/<br\s*\/?>/gi, '\n')
    // Remove remaining HTML tags
    .replace(/<[^>]+>/g, '')
    // HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    // Clean up whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseWikiTableRows(tableText) {
  const characters = [];
  // Split by \n|- (possibly with trailing newline)
  const rows = tableText.split(/\n\|-\s*\n/);

  for (const row of rows) {
    const trimmed = row.trim();
    if (!trimmed) continue;
    // Skip header rows (contain ! for header cells)
    if (trimmed.includes('\n!')) continue;
    // Skip rows that start with ! (header)
    if (trimmed.startsWith('!')) continue;

    // Split cells: each cell starts with \n| (newline + pipe)
    const cells = trimmed.split(/\n\|/).map(c => c.trim()).filter(Boolean);

    if (cells.length < 2) continue;

    const nameCell = stripWikiMarkup(cells[0]).trim();
    const descCell = stripWikiMarkup(cells[1]).trim();
    const sourceCell = cells.length >= 3 ? stripWikiMarkup(cells[2]).trim() : '';

    if (!nameCell || !descCell) continue;
    if (nameCell === '名称/代号' || nameCell === '简介' || nameCell === '出处') continue;
    if (nameCell.startsWith('名称') || nameCell.startsWith('简介')) continue;

    // Strip leading | from cells that start with it (wiki table row split artifact)
    const cleanName = nameCell.startsWith('|') ? nameCell.slice(1) : nameCell;
    characters.push({ name: cleanName, description: descCell, source: sourceCell });
  }

  return characters;
}

function parseAllTables(wikitext) {
  // Parse the wiki page, extracting sections and tables
  const lines = wikitext.split('\n');
  const sections = [];

  // Section stack for hierarchy
  const sectionStack = [];
  let currentTableLines = [];
  let inTable = false;

  for (const line of lines) {
    // Section headers: === Title ===
    const sectionMatch = line.match(/^(=+)\s*(.+?)\s*\1$/);
    if (sectionMatch) {
      // Flush any open table
      if (inTable && currentTableLines.length > 0) {
        const tableText = currentTableLines.join('\n');
        const chars = parseWikiTableRows(tableText);
        if (chars.length > 0) {
          sections.push({
            sectionPath: sectionStack.map(s => s.title),
            title: sectionStack.length > 0 ? sectionStack[sectionStack.length - 1].title : '',
            characters: chars,
          });
        }
        currentTableLines = [];
        inTable = false;
      }

      const level = sectionMatch[1].length;
      const title = sectionMatch[2].trim();

      // Skip TOC-only and page-level headers
      if (title === '目录' || title === '剧情角色一览' || title === '注释与链接') continue;

      // Maintain hierarchy
      while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].level >= level) {
        sectionStack.pop();
      }
      sectionStack.push({ level, title });
      continue;
    }

    // Table start: {| or {| class=...
    if (line.trim().startsWith('{|')) {
      inTable = true;
      currentTableLines = [line];
      continue;
    }

    // Table end: |}
    if (inTable && line.trim() === '|}') {
      currentTableLines.push(line);
      const tableText = currentTableLines.join('\n');
      const chars = parseWikiTableRows(tableText);
      if (chars.length > 0) {
        sections.push({
          sectionPath: sectionStack.map(s => s.title),
          title: sectionStack.length > 0 ? sectionStack[sectionStack.length - 1].title : '(无标题)',
          characters: chars,
        });
      }
      currentTableLines = [];
      inTable = false;
      continue;
    }

    // Collect table lines
    if (inTable) {
      currentTableLines.push(line);
    }
  }

  // Flush remaining
  if (inTable && currentTableLines.length > 0) {
    const tableText = currentTableLines.join('\n');
    const chars = parseWikiTableRows(tableText);
    if (chars.length > 0) {
      sections.push({
        sectionPath: sectionStack.map(s => s.title),
        title: sectionStack.length > 0 ? sectionStack[sectionStack.length - 1].title : '(无标题)',
        characters: chars,
      });
    }
  }

  return sections;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const inputFile = args[0] || 'D:/web/backend/plot_characters_raw.txt';

  console.log('Reading:', inputFile);
  const wikitext = fs.readFileSync(inputFile, 'utf8');
  console.log('Size:', wikitext.length, 'bytes,', wikitext.split('\n').length, 'lines');

  const sections = parseAllTables(wikitext);
  console.log('Parsed', sections.length, 'sections');

  let totalChars = 0;
  for (const sec of sections) {
    totalChars += sec.characters.length;
    if (sec.characters.length > 0) {
      console.log('  [' + sec.characters.length + ']', sec.sectionPath.join(' > '));
    }
  }
  console.log('Total character entries:', totalChars);

  // Deduplicate by name
  const seenNames = new Set();
  const uniqueChars = [];
  for (const sec of sections) {
    for (const char of sec.characters) {
      if (!seenNames.has(char.name)) {
        seenNames.add(char.name);
        uniqueChars.push({ ...char });
      }
    }
  }
  console.log('Unique characters:', uniqueChars.length);

  // Build document content
  const disclaimer = [
    '【来源声明】',
    '本条目为PRTS wiki玩家共同整理的明日方舟剧情角色一览（https://prts.wiki/w/剧情角色一览），',
    '内容通过游戏内剧情整理而成，可能会出现偏差。',
    '非鹰角网络官方发布。仅可用于快速检索和定位剧情角色信息，重要信息请以游戏内实际剧情为准。',
    '',
    '本条目收录在剧情中正式出现、且未实装为游戏中干员的角色（含敌方势力）。',
    '',
  ].join('\n');

  const parts = [disclaimer, '【内容开始】', ''];

  for (const sec of sections) {
    if (sec.characters.length === 0) continue;
    const path = sec.sectionPath.join(' > ');
    parts.push(`## ${path}`);
    parts.push('');

    for (const char of sec.characters) {
      parts.push(`### ${char.name}`);
      parts.push(`简介：${char.description}`);
      if (char.source) {
        parts.push(`出处：${char.source}`);
      }
      parts.push('');
    }
  }

  const fullText = parts.join('\n');
  console.log('Content length:', fullText.length, 'chars');

  // Get all section paths (level 2 = top groups like 主题曲, 乐章 etc)
  const topGroups = [...new Set(sections.map(s => String(s.sectionPath[0] || '')))].filter(Boolean);

  const docMetadata = {
    story_path: ['资料', '剧情角色一览'],
    top_group: '参考资料',
    group_name: '剧情角色一览',
    top_group_code: 'REF',
    imported_without_annotation: true,
    note: '本条目为PRTS wiki玩家共同整理的剧情角色一览，通过游戏内剧情整理。非鹰角网络官方发布。仅可用于快速检索和定位剧情角色信息，重要信息请以游戏内实际剧情为准。',
    disclaimer: '玩家整理，非官方文字，仅供参考',
    content_source: 'community_compiled',
    page_base_title: '剧情角色一览',
    import_source: 'prts_wiki',
    topic_annotation: {
      topic_name: '明日方舟剧情角色一览',
      summary: 'PRTS wiki玩家共同整理的明日方舟全剧情NPC角色列表，涵盖主题曲、活动剧情、集成战略等所有剧情中出现的非可玩角色。按剧情章节/活动分类组织。',
      related_entities: uniqueChars.slice(0, 200).map(c => c.name),
      related_series: topGroups,
    },
  };

  // Check if document already exists
  const existing = await pool.query(
    `SELECT document_id FROM documents WHERE title = $1 AND metadata->>'page_base_title' = '剧情角色一览'`,
    ['剧情角色一览']
  );

  let docId;

  if (existing.rows.length > 0) {
    docId = existing.rows[0].document_id;
    await pool.query(
      `UPDATE documents
       SET subtitle = $1, source_name = $2, source_uri = $3,
           source_tier = $4, content_type = $5, canon_status = $6,
           metadata = $7, updated_at = NOW()
       WHERE document_id = $8`,
      [
        'PRTS wiki玩家整理的明日方舟剧情角色（NPC）列表，非官方发布，仅供参考',
        'PRTS wiki - 玩家共同构筑的明日方舟中文Wiki',
        'https://prts.wiki/w/%E5%89%A7%E6%83%85%E8%A7%92%E8%89%B2%E4%B8%80%E8%A7%88',
        1,
        'character_index',
        'community_compiled',
        JSON.stringify(docMetadata),
        docId,
      ]
    );
    // Remove old text units
    await pool.query(`DELETE FROM text_units WHERE document_id = $1`, [docId]);
    console.log('Updated document #' + docId + ', cleared old text units');
  } else {
    const docResult = await pool.query(
      `INSERT INTO documents (title, subtitle, source_name, source_uri, source_tier,
        content_type, canon_status, metadata, review_status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW()) RETURNING document_id`,
      [
        '剧情角色一览',
        'PRTS wiki玩家整理的明日方舟剧情角色（NPC）列表，非官方发布，仅供参考',
        'PRTS wiki - 玩家共同构筑的明日方舟中文Wiki',
        'https://prts.wiki/w/%E5%89%A7%E6%83%85%E8%A7%92%E8%89%B2%E4%B8%80%E8%A7%88',
        1,
        'character_index',
        'community_compiled',
        JSON.stringify(docMetadata),
        'pending',
      ]
    );
    docId = docResult.rows[0].document_id;
    console.log('Created new document #' + docId);
  }

  // Insert text unit (full text)
  await pool.query(
    `INSERT INTO text_units (document_id, unit_index, unit_kind, heading, text,
      source_tier, content_type, metadata, review_status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
    [
      docId,
      0,
      'chunk',
      '剧情角色一览全文',
      fullText,
      1,
      'character_index',
      JSON.stringify({
        summary: 'PRTS wiki玩家整理的明日方舟全剧情NPC角色列表，含角色简介和出场出处，按剧情章节分类',
        summary_short: '明日方舟剧情NPC角色一览',
        key_terms: ['剧情角色', 'NPC', '角色一览', '剧情人物', '敌方角色', '整合运动', '罗德岛'],
      }),
      'pending',
    ]
  );

  console.log('Inserted full text unit');

  // Also insert per-section text units for finer-grained retrieval
  console.log('\nInserting per-section text units...');
  let unitIdx = 1;
  for (const sec of sections) {
    if (sec.characters.length === 0) continue;

    const path = sec.sectionPath.join(' > ');
    let secText = `## ${path}\n\n`;
    for (const char of sec.characters) {
      secText += `### ${char.name}\n`;
      secText += `简介：${char.description}\n`;
      if (char.source) {
        secText += `出处：${char.source}\n`;
      }
      secText += '\n';
    }

    const names = sec.characters.map(c => c.name);

    await pool.query(
      `INSERT INTO text_units (document_id, unit_index, unit_kind, heading, text,
        source_tier, content_type, metadata, review_status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
      [
        docId,
        unitIdx,
        'chunk',
        path,
        secText.trim(),
        1,
        'character_index',
        JSON.stringify({
          summary: `剧情角色 - ${path}（${sec.characters.length}个角色）`,
          summary_short: path,
          key_terms: [...new Set([path.split(' > ').pop(), ...names.slice(0, 15)])],
        }),
        'pending',
      ]
    );
    unitIdx++;
  }
  console.log(`Inserted ${unitIdx - 1} per-section text units`);

  // Create/update entities for each unique character
  console.log('\nManaging character entities...');
  let entitiesCreated = 0;
  let entitiesUpdated = 0;

  for (const char of uniqueChars) {
    try {
      const existingEntity = await pool.query(
        `SELECT entity_id, properties FROM entities WHERE name = $1 AND entity_type = 'character'`,
        [char.name]
      );

      if (existingEntity.rows.length > 0) {
        const eid = existingEntity.rows[0].entity_id;
        const props = typeof existingEntity.rows[0].properties === 'string'
          ? JSON.parse(existingEntity.rows[0].properties)
          : (existingEntity.rows[0].properties || {});

        props.character_index = props.character_index || {};
        props.character_index.description = char.description;
        props.character_index.source = char.source;
        props.character_index.is_npc = true;
        props.character_index.import_source = 'prts_wiki_character_index';

        await pool.query(
          `UPDATE entities SET properties = $1, updated_at = NOW() WHERE entity_id = $2`,
          [JSON.stringify(props), eid]
        );
        entitiesUpdated++;
      } else {
        const summary = char.description.length > 500
          ? char.description.substring(0, 497) + '...'
          : char.description;

        await pool.query(
          `INSERT INTO entities (entity_type, name, summary, properties, review_status)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            'character',
            char.name,
            summary,
            JSON.stringify({
              character_index: {
                description: char.description,
                source: char.source,
                is_npc: true,
                import_source: 'prts_wiki_character_index',
              },
              source: 'prts_wiki_character_index',
              is_npc: true,
            }),
            'seeded',
          ]
        );
        entitiesCreated++;
      }
    } catch (err) {
      console.error(`  Error processing entity "${char.name}":`, err.message);
    }
  }

  console.log(`Entities: ${entitiesCreated} created, ${entitiesUpdated} updated`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('IMPORT COMPLETE');
  console.log('='.repeat(60));
  console.log(`Document ID:        ${docId}`);
  console.log(`Sections:           ${sections.length}`);
  console.log(`Total entries:      ${totalChars}`);
  console.log(`Unique characters:  ${uniqueChars.length}`);
  console.log(`Text units:         ${unitIdx}`);
  console.log(`New entities:       ${entitiesCreated}`);
  console.log(`Updated entities:   ${entitiesUpdated}`);
  console.log(`Content length:     ${fullText.length} chars`);
  console.log(`Source tier:        1 (玩家整理内容，仅供参考)`);
  console.log('='.repeat(60));

  await pool.end();
}

main().catch(err => {
  console.error('Import failed:', err);
  pool.end();
  process.exit(1);
});
