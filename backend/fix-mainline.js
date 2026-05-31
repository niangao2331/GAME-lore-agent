import { Pool } from 'pg';
const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'arknights_lore_new', user: 'postgres', password: 'postgres', ssl: false });

const MAINLINE_FIXES = [
  { pattern: /^(?:EP17|17-)/, topic: '相变临界', summary: '主线最新篇章。罗德岛与各方势力在伦蒂尼姆的博弈进入新阶段。源石的本质、文明的存续与毁灭等终极命题被深入探讨。博士的真实身份与过去进一步被揭示，普瑞赛斯的阴影始终笼罩。', entities: ['博士','阿米娅','凯尔希','普瑞赛斯','源石','伦蒂尼姆','卡兹戴尔','前文明'], series: ['反常光谱'] },
  { pattern: /^(?:EP16|16-)/, topic: '反常光谱', summary: '维多利亚局势进一步演变。深池与公爵们的博弈、伦蒂尼姆的未来走向成为焦点。维娜在推进之王身份与个人意志之间挣扎。更多关于维多利亚历史与阿斯兰王权的秘密被揭示。', entities: ['推进之王','阿米娅','深池','爱布拉娜','苇草','凯尔希','博士','伦蒂尼姆','维多利亚'], series: ['离解复合','相变临界'] },
  { pattern: /^(?:EP15|15-)/, topic: '离解复合', summary: '特雷西斯与特蕾西娅的最终对决。源石本质与文明的存续问题被深入探讨。阿米娅必须在复杂的情感与责任中做出抉择。源石计划、前文明遗产等宏大命题浮出水面，为后续剧情奠定基调。', entities: ['阿米娅','特蕾西娅','特雷西斯','凯尔希','博士','普瑞赛斯','源石','伦蒂尼姆','卡兹戴尔','前文明'], series: ['慈悲灯塔','反常光谱'] },
  { pattern: /^(?:EP14|14-)/, topic: '慈悲灯塔', summary: '主线维多利亚篇的高潮之一。特蕾西娅以某种形式"复活"，特雷西斯的计划进入最后阶段。阿米娅面对特蕾西娅时的复杂情感，魔王传承的真相被进一步揭示。众魂的汇聚与萨卡兹的命运成为核心议题。', entities: ['阿米娅','特蕾西娅','特雷西斯','凯尔希','W','logos','血魔大君','曼弗雷德','伦蒂尼姆','卡兹戴尔'], series: ['恶兆湍流','离解复合'] },
  { pattern: /^(?:EP13|13-)/, topic: '恶兆湍流', summary: '血魔大君杜卡雷的登场。他作为萨卡兹王庭之一的古老存在，其残忍与强大令局势更加危急。阿米娅一行人与之周旋，同时揭示更多萨卡兹古老传承与提卡兹文明的秘密。自救军与罗德岛的合作加深。', entities: ['阿米娅','血魔大君','杜卡雷','凯尔希','logos','特雷西斯','特蕾西娅','伦蒂尼姆'], series: ['惊霆无声','慈悲灯塔'] },
  { pattern: /^(?:EP12|12-)/, topic: '惊霆无声', summary: '伦蒂尼姆局势进一步恶化。萨卡兹的奇袭与城防军抵抗交织。阿米娅与logos的联合行动，揭露了更多关于魔王继承与古老萨卡兹遗产的秘密。自救军的行动遭遇重大挫折。', entities: ['阿米娅','logos','凯尔希','特雷西斯','特蕾西娅','曼弗雷德','赫德雷','伊内丝','伦蒂尼姆','卡兹戴尔'], series: ['淬火尘霾','恶兆湍流'] },
  { pattern: /^(?:EP11|11-)/, topic: '淬火尘霾', summary: '推进之王维娜的身世揭晓。她作为阿斯兰王室后裔的身份被揭示，面临是否继承王位的抉择。格拉斯哥帮的成员各自做出选择，维多利亚王位继承问题愈发复杂。蒸汽骑士的遗产成为关键。', entities: ['推进之王','因陀罗','摩根','达格达','阿勒黛','戴菲恩','特雷西斯','伦蒂尼姆','维多利亚'], series: ['破碎日冕','惊霆无声'] },
  { pattern: /^(?:EP10|10-)/, topic: '破碎日冕', summary: '罗德岛深入伦蒂尼姆，直面特雷西斯的军事委员会。阿米娅与可露希尔的潜入行动，揭示伦蒂尼姆被萨卡兹军队占领的真相。曼弗雷德、阿斯卡纶等角色登场，卡兹戴尔复国的野心逐渐显露。', entities: ['阿米娅','凯尔希','特雷西斯','曼弗雷德','阿斯卡纶','W','伊内丝','赫德雷','可露希尔','伦蒂尼姆','卡兹戴尔'], series: ['风暴瞭望','淬火尘霾'] },
  { pattern: /^(?:EP09|9-)/, topic: '风暴瞭望', summary: '维多利亚篇的开端。罗德岛前往维多利亚，遭遇深池组织的活动。风笛、号角登场，塔拉地区的独立运动浮出水面。伦蒂尼姆的权力真空成为各方势力争夺的焦点，特雷西斯与卡兹戴尔势力的介入使局势更加复杂。', entities: ['阿米娅','凯尔希','风笛','号角','深池','蔓德拉','特雷西斯','特蕾西娅','维多利亚','伦蒂尼姆','卡兹戴尔'], series: ['怒号光明','破碎日冕'] },
  { pattern: /^(?:EP07|7-)/, topic: '苦难摇篮', summary: '爱国者博卓卡斯替的篇章。罗德岛遭遇整合运动最坚固的盾牌——爱国者及其游击队。阿米娅与爱国者的理念碰撞，揭示了感染者问题的历史根源。爱国者最终战死，他的信念与坚持震撼了所有人。', entities: ['阿米娅','爱国者','凯尔希','W','塔露拉','霜星','游击队','整合运动','乌萨斯'], series: ['局部坏死','怒号光明'] },
  { pattern: /^(?:EP06|6-)/, topic: '局部坏死', summary: '霜星的最终章节。霜星与罗德岛在废墟中的死斗，最终霜星因矿石病恶化而倒下。她的遗言深深触动了阿米娅，"愿意加入罗德岛"成为最动人的誓言。雪怪小队全员牺牲，揭示了感染者抗争的残酷代价。', entities: ['阿米娅','霜星','雪怪小队','煌','灰喉','凯尔希','整合运动','切尔诺伯格'], series: ['靶向药物','苦难摇篮'] },
  { pattern: /^(?:EP05|5-)/, topic: '靶向药物', summary: '龙门与罗德岛联合行动的高潮。浮士德与梅菲斯特的关系被揭示，灰喉对感染者的态度转变。陈与塔露拉的宿命对决初现端倪。浮士德为保护梅菲斯特而牺牲，感染者悲剧进一步加深。', entities: ['陈','阿米娅','浮士德','梅菲斯特','灰喉','星熊','塔露拉','龙门','整合运动'], series: ['急性衰竭','局部坏死'] },
  { pattern: /^(?:EP04|4-)/, topic: '急性衰竭', summary: '罗德岛深入切尔诺伯格废墟，与整合运动干部交战。W的阴谋逐渐浮出水面，弑君者的背景被揭示。罗德岛遭遇了更深层的政治阴谋，涉及乌萨斯军方与感染者问题的复杂纠葛。', entities: ['阿米娅','W','弑君者','凯尔希','红','整合运动','乌萨斯','切尔诺伯格'], series: ['二次呼吸','靶向药物'] },
  { pattern: /^(?:EP03|3-)/, topic: '二次呼吸', summary: '罗德岛追踪整合运动在龙门的活动，遭遇霜星的雪怪小队。霜星的信念与阿米娅产生碰撞，双方虽有冲突但也互相理解。霜星展现了对感染者未来的不同思考，她的冻伤病情也逐渐显露。', entities: ['阿米娅','霜星','雪怪小队','浮士德','梅菲斯特','煌','龙门','整合运动'], series: ['异卵同生','急性衰竭'] },
  { pattern: /^(?:EP02|2-)/, topic: '异卵同生', summary: '罗德岛抵达龙门，与龙门近卫局合作应对整合运动的渗透。陈和星熊登场，企鹅物流的能天使、德克萨斯协助行动。米莎的身世揭开，揭示了她与碎骨的关系，以及感染者被利用的悲剧。', entities: ['阿米娅','陈','星熊','能天使','德克萨斯','米莎','碎骨','W','龙门','企鹅物流','近卫局'], series: ['黑暗时代·下','二次呼吸'] },
  { pattern: /^(?:EP01|1-)/, topic: '黑暗时代·下', summary: '博士被救出后，罗德岛在切尔诺伯格的逃亡之旅。遭遇梅菲斯特和浮士德率领的整合运动部队，Ace牺牲自己殿后。揭示了整合运动的残酷与感染者矛盾的激化。', entities: ['博士','阿米娅','Ace','梅菲斯特','浮士德','临光','杜宾','整合运动','切尔诺伯格'], series: ['黑暗时代·上','异卵同生'] },
  { pattern: /^(?:EP00|0-|TR-11|W2G|G2H)/, topic: '黑暗时代·上（序章）', summary: '罗德岛营救博士的行动。阿米娅带领小队深入切尔诺伯格的石棺设施，在整合运动的包围中将博士救出。展现了阿米娅的成长、整合运动的崛起，以及博士作为战术指挥官的初次登场。', entities: ['博士','阿米娅','杜宾','临光','Ace','整合运动','塔露拉','切尔诺伯格','乌萨斯'], series: ['黑暗时代·下'] },
];

const CH8_FIX = {
  topic: '怒号光明',
  summary: '整合运动篇的高潮。塔露拉的真实身份与被科西切控制的事实被揭露。陈与塔露拉的宿命对决，阿米娅继承科西切的戒指获得新力量。整合运动在切尔诺伯格撞击龙门的危机被化解，但代价惨重。揭示了科西切的阴谋与不死者诅咒。',
  entities: ['阿米娅','陈','塔露拉','科西切','凯尔希','W','九','魏彦吾','文月','龙门','切尔诺伯格'],
  series: ['苦难摇篮','风暴瞭望'],
};

async function main() {
  const docs = await pool.query(`
    SELECT document_id, title, metadata->'story_path'->>3 as stage
    FROM documents
    WHERE metadata ? 'topic_annotation' AND metadata->>'top_group' = '主线剧情'
  `);

  let fixed = 0;
  for (const doc of docs.rows) {
    const stage = doc.stage;
    let matched = null;

    if (/^(?:R8|M8|JT8|END8|EG-[1-5])/.test(stage)) {
      matched = CH8_FIX;
    } else {
      for (const fix of MAINLINE_FIXES) {
        if (fix.pattern.test(stage)) {
          matched = fix;
          break;
        }
      }
    }

    if (matched) {
      const annotation = {
        topic_name: matched.topic,
        summary: matched.summary,
        related_entities: matched.entities,
        related_series: matched.series,
      };
      await pool.query(`
        UPDATE documents
        SET metadata = jsonb_set(metadata, '{topic_annotation}', $1::jsonb, true),
            updated_at = NOW()
        WHERE document_id = $2
      `, [JSON.stringify(annotation), doc.document_id]);
      fixed++;
    }
  }

  console.log('Fixed ' + fixed + ' mainline documents');

  const verify = await pool.query(`
    SELECT metadata->'topic_annotation'->>'topic_name' as topic, COUNT(*) as cnt
    FROM documents
    WHERE metadata ? 'topic_annotation' AND metadata->>'top_group' = '主线剧情'
    GROUP BY topic
    ORDER BY cnt DESC
  `);

  console.log('\nMainline topic distribution after fix:');
  for (const row of verify.rows) {
    console.log('  ' + row.topic + ': ' + row.cnt);
  }

  await pool.end();
}

main().catch(err => {
  console.error(err);
  pool.end();
  process.exit(1);
});
