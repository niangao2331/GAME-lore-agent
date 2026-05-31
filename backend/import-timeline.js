import { Pool } from 'pg';
import fs from 'fs';

const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'arknights_lore_new', user: 'postgres', password: 'postgres', ssl: false });

async function main() {
  const content = fs.readFileSync('D:/web/backend/terra_timeline.txt', 'utf8');

  // Clean up content
  let cleanContent = content
    .replace(/^泰拉年表\n跳转到导航\n跳转到搜索\n/, '')
    .replace(/\n导航菜单\n[\s\S]*$/, '');

  // Remove TOC and nav noise
  const lines = cleanContent.split('\n');
  const filtered = lines.filter(line => {
    const t = line.trim();
    if (!t) return false;
    if (t === '展开') return false;
    if (t === '目录') return false;
    if (t === '目' || t === '录') return false;
    if (/^\d+\.\d*\s/.test(t)) return false; // TOC entries like "1 结晶纪元之前"
    if (t.startsWith('本条目为泰拉大典')) return false;
    if (t.startsWith('本页面中的内容较多')) return false;
    if (t.startsWith('请自行决定是否查看')) return false;
    if (t.startsWith('这个页面或章节尚在编辑中')) return false;
    if (t.startsWith('注意：编辑及创建新节点')) return false;
    if (t.startsWith('出处编辑格式')) return false;
    if (t.startsWith('注释与链接')) return false;
    if (t.startsWith('分类：')) return false;
    if (t.startsWith('泰拉大典')) return false;
    if (t.startsWith('泰拉人名录')) return false;
    if (t.startsWith('附表')) return false;
    if (t.startsWith('编辑指引')) return false;
    if (t.startsWith('此页面最后编辑于')) return false;
    if (t.startsWith('本网站是由《明日方舟》游戏爱好者')) return false;
    if (t.startsWith('网站内使用的游戏图片')) return false;
    if (t.startsWith('除非另有声明')) return false;
    if (t.startsWith('隐私政策')) return false;
    if (t.startsWith('关于PRTS')) return false;
    if (t.startsWith('免责声明')) return false;
    if (t.startsWith('京ICP备')) return false;
    if (t.startsWith('手机版视图')) return false;
    if (t.startsWith('首页')) return false;
    if (t.startsWith('复制短链接')) return false;
    if (t.startsWith('支持我们')) return false;
    if (t.startsWith('赞助者一览')) return false;
    if (t.startsWith('反馈与建议')) return false;
    if (t.startsWith('当前活动')) return false;
    if (t.startsWith('新增干员')) return false;
    if (t.startsWith('干员一览')) return false;
    if (t.startsWith('通用')) return false;
    if (t.startsWith('档案')) return false;
    if (t.startsWith('玩法')) return false;
    if (t.startsWith('系统')) return false;
    if (t.startsWith('扩展')) return false;
    if (t.startsWith('趣味')) return false;
    if (t.startsWith('随机页面')) return false;
    if (t.startsWith('Mooncell主站')) return false;
    if (t.startsWith('官方网站')) return false;
    if (t.startsWith('友情链接')) return false;
    if (t.startsWith('最近更改')) return false;
    if (t.startsWith('编辑指南')) return false;
    if (t.startsWith('常用代码')) return false;
    if (t.startsWith('模板一览')) return false;
    if (t.startsWith('贡献分数')) return false;
    if (t.startsWith('收支一览')) return false;
    if (t.startsWith('特殊贡献')) return false;
    if (t.startsWith('日本語')) return false;
    if (t.startsWith('English')) return false;
    if (t.startsWith('中文')) return false;
    if (t.startsWith('链入页面')) return false;
    if (t.startsWith('相关更改')) return false;
    if (t.startsWith('特殊页面')) return false;
    if (t.startsWith('打印版本')) return false;
    if (t.startsWith('固定链接')) return false;
    if (t.startsWith('页面信息')) return false;
    if (t.startsWith('Cargo数据')) return false;
    if (t.startsWith('引用此页')) return false;
    if (t.startsWith('浏览属性')) return false;
    if (t.startsWith('热门页面')) return false;
    if (t.startsWith('菜单')) return false;
    if (t.startsWith('探索')) return false;
    if (t.startsWith('管理与编辑')) return false;
    if (t.startsWith('Languages')) return false;
    if (t.startsWith('工具')) return false;
    return true;
  });

  cleanContent = filtered.join('\n');

  // Prepend disclaimer
  const disclaimer = `【来源声明】本条目为PRTS wiki玩家共同整理的时间线（https://prts.wiki/w/泰拉年表），内容通过游戏内剧情推测，可能会出现偏差。非鹰角网络官方发布。仅可用于快速检索和定位剧情时间，重要信息请以游戏内实际剧情为准。\n\n【内容开始】\n\n`;
  cleanContent = disclaimer + cleanContent;

  console.log('Clean content length: ' + cleanContent.length);

  // Check if document already exists
  const existing = await pool.query(
    `SELECT document_id FROM documents WHERE external_key = $1`,
    ['prts-terra-timeline']
  );

  let docId;
  const docMetadata = {
    story_path: ['资料', '泰拉年表'],
    top_group: '参考资料',
    group_name: '泰拉年表',
    top_group_code: 'REF',
    imported_without_annotation: true,
    note: '本条目为PRTS wiki玩家共同整理的时间线，内容通过游戏内剧情推测，可能会出现偏差。非鹰角网络官方发布。仅可用于快速检索和定位剧情时间，重要信息请以游戏内实际剧情为准。',
    disclaimer: '玩家整理，非官方文字',
    content_source: 'community_compiled',
    page_base_title: '泰拉年表',
    import_source: 'prts_wiki',
    topic_annotation: {
      topic_name: '泰拉年表',
      summary: 'PRTS wiki玩家共同整理的全泰拉历史时间线，从前文明时期到1103年，涵盖所有已知历史事件的时间节点。',
      related_entities: ['泰拉', '前文明', '源石', '卡兹戴尔', '拉特兰', '炎国', '维多利亚', '乌萨斯', '萨尔贡', '伊比利亚', '莱塔尼亚', '哥伦比亚'],
      related_series: [],
    },
  };

  if (existing.rows.length > 0) {
    docId = existing.rows[0].document_id;
    await pool.query(
      `UPDATE documents
       SET title = $1, subtitle = $2, source_name = $3, source_uri = $4,
           source_tier = $5, content_type = $6, canon_status = $7,
           metadata = $8, updated_at = NOW()
       WHERE document_id = $9`,
      [
        '泰拉年表',
        'PRTS wiki玩家整理的时间线，通过游戏内剧情推测，非官方发布',
        'PRTS wiki - 玩家共同构筑的明日方舟中文Wiki',
        'https://prts.wiki/w/%E6%B3%B0%E6%8B%89%E5%B9%B4%E8%A1%A8',
        1,
        'timeline',
        'community_compiled',
        JSON.stringify(docMetadata),
        docId,
      ]
    );

    // Delete old text units and insert new one
    await pool.query(`DELETE FROM text_units WHERE document_id = $1`, [docId]);
    console.log('Updated document #' + docId + ', removed old text units');
  } else {
    const docResult = await pool.query(
      `INSERT INTO documents (external_key, title, subtitle, source_name, source_uri, source_tier,
        content_type, canon_status, metadata, review_status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) RETURNING document_id`,
      [
        'prts-terra-timeline',
        '泰拉年表',
        'PRTS wiki玩家整理的时间线，通过游戏内剧情推测，非官方发布',
        'PRTS wiki - 玩家共同构筑的明日方舟中文Wiki',
        'https://prts.wiki/w/%E6%B3%B0%E6%8B%89%E5%B9%B4%E8%A1%A8',
        1,
        'timeline',
        'community_compiled',
        JSON.stringify(docMetadata),
        'pending',
      ]
    );
    docId = docResult.rows[0].document_id;
    console.log('Created new document #' + docId);
  }

  // Insert text unit
  await pool.query(
    `INSERT INTO text_units (document_id, unit_index, unit_kind, heading, text,
      source_tier, content_type, metadata, review_status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
    [
      docId,
      0,
      'chunk',
      '泰拉年表全文',
      cleanContent,
      1,
      'timeline',
      JSON.stringify({
        summary: '泰拉历史时间线，从前文明到1103年',
        summary_short: '全泰拉历史时间线',
        key_terms: ['泰拉年表', '时间线', '历史', '前文明', '结晶纪元'],
      }),
      'pending',
    ]
  );

  console.log('Inserted text unit for document #' + docId);

  // Verify
  const verify = await pool.query(
    `SELECT d.document_id, d.title, d.source_tier, d.metadata->>'disclaimer' as disclaimer,
            d.metadata->>'note' as note, tu.text as content_preview
     FROM documents d
     LEFT JOIN text_units tu ON tu.document_id = d.document_id
     WHERE d.document_id = $1`,
    [docId]
  );

  const v = verify.rows[0];
  console.log('\nVerification:');
  console.log('  Title: ' + v.title);
  console.log('  Source tier: ' + v.source_tier);
  console.log('  Disclaimer: ' + v.disclaimer);
  console.log('  Note: ' + (v.note ? v.note.substring(0, 80) + '...' : 'N/A'));
  console.log('  Content length: ' + (v.content_preview ? v.content_preview.length : 0));

  await pool.end();
}

main().catch(err => {
  console.error(err);
  pool.end();
  process.exit(1);
});
