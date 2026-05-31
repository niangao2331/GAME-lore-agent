import { Pool } from 'pg';

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  database: 'arknights_lore_new',
  user: 'postgres',
  password: 'postgres',
  ssl: false,
});

// 主题注释数据：每个大主题的详细注释
// 格式: { match: { group_name, prefix_pattern }, topic_name, annotation }
const TOPIC_ANNOTATIONS = [
  // ==================== 主线剧情 ====================
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP00|0-[0-9]|TR-11|W2G|G2H/ },
    topic_name: '黑暗时代·上（序章）',
    annotation: {
      summary: '罗德岛营救博士的行动。阿米娅带领小队深入切尔诺伯格的石棺设施，在整合运动的包围中将博士救出。展现了阿米娅的成长、整合运动的崛起，以及博士作为战术指挥官的初次登场。',
      related_entities: ['博士', '阿米娅', '杜宾', '临光', 'Ace', '整合运动', '塔露拉', '切尔诺伯格', '乌萨斯'],
      related_series: ['黑暗时代·下'],
    },
  },
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP01|1-[0-9]/ },
    topic_name: '黑暗时代·下',
    annotation: {
      summary: '博士被救出后，罗德岛在切尔诺伯格的逃亡之旅。遭遇梅菲斯特和浮士德率领的整合运动部队，Ace牺牲自己殿后。揭示了整合运动的残酷与感染者矛盾的激化。',
      related_entities: ['博士', '阿米娅', 'Ace', '梅菲斯特', '浮士德', '临光', '杜宾', '整合运动', '切尔诺伯格'],
      related_series: ['黑暗时代·上', '异卵同生'],
    },
  },
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP02|2-[0-9]/ },
    topic_name: '异卵同生',
    annotation: {
      summary: '罗德岛抵达龙门，与龙门近卫局合作应对整合运动的渗透。陈和星熊登场，企鹅物流的能天使、德克萨斯协助行动。米莎的身世揭开，揭示了她与碎骨的关系，以及感染者被利用的悲剧。',
      related_entities: ['阿米娅', '陈', '星熊', '能天使', '德克萨斯', '米莎', '碎骨', 'W', '龙门', '企鹅物流', '近卫局'],
      related_series: ['黑暗时代·下', '二次呼吸'],
    },
  },
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP03|3-[0-9]/ },
    topic_name: '二次呼吸',
    annotation: {
      summary: '罗德岛追踪整合运动在龙门的活动，遭遇霜星的雪怪小队。霜星的信念与阿米娅产生碰撞，双方虽有冲突但也互相理解。霜星展现了对感染者未来的不同思考，她的冻伤病情也逐渐显露。',
      related_entities: ['阿米娅', '霜星', '雪怪小队', '浮士德', '梅菲斯特', '煌', '龙门', '整合运动'],
      related_series: ['异卵同生', '急性衰竭'],
    },
  },
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP04|4-[0-9]/ },
    topic_name: '急性衰竭',
    annotation: {
      summary: '罗德岛深入切尔诺伯格废墟，与整合运动干部交战。W的阴谋逐渐浮出水面，弑君者的背景被揭示。罗德岛遭遇了更深层的政治阴谋，涉及乌萨斯军方与感染者问题的复杂纠葛。',
      related_entities: ['阿米娅', 'W', '弑君者', '凯尔希', '红', '整合运动', '乌萨斯', '切尔诺伯格'],
      related_series: ['二次呼吸', '靶向药物'],
    },
  },
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP05|5-[0-9]/ },
    topic_name: '靶向药物',
    annotation: {
      summary: '龙门与罗德岛联合行动的高潮。浮士德与梅菲斯特的关系被揭示，灰喉对感染者的态度转变。陈与塔露拉的宿命对决初现端倪。浮士德为保护梅菲斯特而牺牲，感染者悲剧进一步加深。',
      related_entities: ['陈', '阿米娅', '浮士德', '梅菲斯特', '灰喉', '星熊', '塔露拉', '龙门', '整合运动'],
      related_series: ['急性衰竭', '局部坏死'],
    },
  },
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP06|6-[0-9]/ },
    topic_name: '局部坏死',
    annotation: {
      summary: '霜星的最终章节。霜星与罗德岛在废墟中的死斗，最终霜星因矿石病恶化而倒下。她的遗言深深触动了阿米娅，"愿意加入罗德岛"成为最动人的誓言。雪怪小队全员牺牲，揭示了感染者抗争的残酷代价。',
      related_entities: ['阿米娅', '霜星', '雪怪小队', '煌', '灰喉', '凯尔希', '整合运动', '切尔诺伯格'],
      related_series: ['靶向药物', '苦难摇篮'],
    },
  },
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP07|7-[0-9]/ },
    topic_name: '苦难摇篮',
    annotation: {
      summary: '爱国者博卓卡斯替的篇章。罗德岛遭遇整合运动最坚固的盾牌——爱国者及其游击队。阿米娅与爱国者的理念碰撞，揭示了感染者问题的历史根源。爱国者最终战死，他的信念与坚持震撼了所有人。',
      related_entities: ['阿米娅', '爱国者', '凯尔希', 'W', '塔露拉', '霜星', '游击队', '整合运动', '乌萨斯'],
      related_series: ['局部坏死', '怒号光明'],
    },
  },
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP08|R8|M8|JT8|END8|EG-[1-5]|W|G/ },
    topic_name: '怒号光明',
    annotation: {
      summary: '整合运动篇的高潮。塔露拉的真实身份与被科西切控制的事实被揭露。陈与塔露拉的宿命对决，阿米娅继承科西切的戒指获得新力量。整合运动在切尔诺伯格撞击龙门的危机被化解，但代价惨重。揭示了科西切的阴谋与不死者诅咒。',
      related_entities: ['阿米娅', '陈', '塔露拉', '科西切', '凯尔希', 'W', '九', '魏彦吾', '文月', '龙门', '切尔诺伯格'],
      related_series: ['苦难摇篮', '风暴瞭望'],
    },
  },
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP09|9-[0-9]/ },
    topic_name: '风暴瞭望',
    annotation: {
      summary: '维多利亚篇的开端。罗德岛前往维多利亚，遭遇深池组织的活动。风笛、号角登场，塔拉地区的独立运动浮出水面。伦蒂尼姆的权力真空成为各方势力争夺的焦点，特雷西斯与卡兹戴尔势力的介入使局势更加复杂。',
      related_entities: ['阿米娅', '凯尔希', '风笛', '号角', '深池', '蔓德拉', '特雷西斯', '特蕾西娅', '维多利亚', '伦蒂尼姆', '卡兹戴尔'],
      related_series: ['怒号光明', '破碎日冕'],
    },
  },
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP10|10-[0-9]/ },
    topic_name: '破碎日冕',
    annotation: {
      summary: '罗德岛深入伦蒂尼姆，直面特雷西斯的军事委员会。阿米娅与可露希尔的潜入行动，揭示伦蒂尼姆被萨卡兹军队占领的真相。曼弗雷德、阿斯卡纶等角色登场，卡兹戴尔复国的野心逐渐显露。',
      related_entities: ['阿米娅', '凯尔希', '特雷西斯', '曼弗雷德', '阿斯卡纶', 'W', '伊内丝', '赫德雷', '可露希尔', '伦蒂尼姆', '卡兹戴尔'],
      related_series: ['风暴瞭望', '淬火尘霾'],
    },
  },
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP11|11-[0-9]/ },
    topic_name: '淬火尘霾',
    annotation: {
      summary: '推进之王维娜的身世揭晓。她作为阿斯兰王室后裔的身份被揭示，面临是否继承王位的抉择。格拉斯哥帮的成员各自做出选择，维多利亚王位继承问题愈发复杂。蒸汽骑士的遗产成为关键。',
      related_entities: ['推进之王', '因陀罗', '摩根', '达格达', '阿勒黛', '戴菲恩', '特雷西斯', '伦蒂尼姆', '维多利亚'],
      related_series: ['破碎日冕', '惊霆无声'],
    },
  },
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP12|12-[0-9]/ },
    topic_name: '惊霆无声',
    annotation: {
      summary: '伦蒂尼姆局势进一步恶化。萨卡兹的奇袭与城防军抵抗交织。阿米娅与logos的联合行动，揭露了更多关于魔王继承与古老萨卡兹遗产的秘密。自救军的行动遭遇重大挫折。',
      related_entities: ['阿米娅', 'logos', '凯尔希', '特雷西斯', '特蕾西娅', '曼弗雷德', '赫德雷', '伊内丝', '伦蒂尼姆', '卡兹戴尔'],
      related_series: ['淬火尘霾', '恶兆湍流'],
    },
  },
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP13|13-[0-9]/ },
    topic_name: '恶兆湍流',
    annotation: {
      summary: '血魔大君杜卡雷的登场。他作为萨卡兹王庭之一的古老存在，其残忍与强大令局势更加危急。阿米娅一行人与之周旋，同时揭示更多萨卡兹古老传承与提卡兹文明的秘密。自救军与罗德岛的合作加深。',
      related_entities: ['阿米娅', '血魔大君', '杜卡雷', '凯尔希', 'logos', '特雷西斯', '特蕾西娅', '伦蒂尼姆'],
      related_series: ['惊霆无声', '慈悲灯塔'],
    },
  },
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP14|14-[0-9]|EG-6/ },
    topic_name: '慈悲灯塔',
    annotation: {
      summary: '主线维多利亚篇的高潮之一。特蕾西娅以某种形式"复活"，特雷西斯的计划进入最后阶段。阿米娅面对特蕾西娅时的复杂情感，魔王传承的真相被进一步揭示。众魂的汇聚与萨卡兹的命运成为核心议题。',
      related_entities: ['阿米娅', '特蕾西娅', '特雷西斯', '凯尔希', 'W', 'logos', '血魔大君', '曼弗雷德', '伦蒂尼姆', '卡兹戴尔'],
      related_series: ['恶兆湍流', '离解复合'],
    },
  },
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP15|15-[0-9]|EG-[7-9]/ },
    topic_name: '离解复合',
    annotation: {
      summary: '特雷西斯与特蕾西娅的最终对决。源石本质与文明的存续问题被深入探讨。阿米娅必须在复杂的情感与责任中做出抉择。源石计划、前文明遗产等宏大命题浮出水面，为后续剧情奠定基调。',
      related_entities: ['阿米娅', '特蕾西娅', '特雷西斯', '凯尔希', '博士', '普瑞赛斯', '源石', '伦蒂尼姆', '卡兹戴尔', '前文明'],
      related_series: ['慈悲灯塔', '反常光谱'],
    },
  },
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP16|16-[0-9]|EG-10/ },
    topic_name: '反常光谱',
    annotation: {
      summary: '维多利亚局势进一步演变。深池与公爵们的博弈、伦蒂尼姆的未来走向成为焦点。维娜在推进之王身份与个人意志之间挣扎。更多关于维多利亚历史与阿斯兰王权的秘密被揭示。',
      related_entities: ['推进之王', '阿米娅', '深池', '爱布拉娜', '苇草', '凯尔希', '博士', '伦蒂尼姆', '维多利亚'],
      related_series: ['离解复合', '相变临界'],
    },
  },
  {
    match: { top_group: '主线剧情', prefix_pattern: /^EP17|17-[0-9]|EG-11/ },
    topic_name: '相变临界',
    annotation: {
      summary: '主线最新篇章。罗德岛与各方势力在伦蒂尼姆的博弈进入新阶段。源石的本质、文明的存续与毁灭等终极命题被深入探讨。博士的真实身份与过去进一步被揭示，普瑞赛斯的阴影始终笼罩。',
      related_entities: ['博士', '阿米娅', '凯尔希', '普瑞赛斯', '源石', '伦蒂尼姆', '卡兹戴尔', '前文明'],
      related_series: ['反常光谱'],
    },
  },

  // ==================== 活动支线 ====================
  {
    match: { group_name: '支线', prefix_pattern: /^GT/ },
    topic_name: '骑兵与猎人',
    annotation: {
      summary: '首个Side Story。斯卡蒂为寻找失踪的猎人同伴来到卡西米尔，与格拉尼共同追寻"宝藏"的真相。揭示了阿戈尔与深海猎人的秘密，以及斯卡蒂背负的沉重过去。',
      related_entities: ['斯卡蒂', '格拉尼', '幽灵鲨', '凯尔希', '卡西米尔', '阿戈尔', '深海猎人'],
      related_series: ['覆潮之下', '愚人号', '生路'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^OF/ },
    topic_name: '火蓝之心',
    annotation: {
      summary: '罗德岛前往汐斯塔度假，卷入黑曜石音乐节与火山危机。锡兰、黑的身世被揭示，赫尔曼市长的野心与汐斯塔的存亡成为核心矛盾。展现了干员们轻松愉快的日常与严肃的抉择并存。',
      related_entities: ['锡兰', '黑', '赫尔曼', '克洛宁', '艾雅法拉', '天火', '汐斯塔', '火山'],
      related_series: [],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^CB/ },
    topic_name: '喧闹法则',
    annotation: {
      summary: '龙门黑帮之间的权力斗争。莫斯提马与企鹅物流在龙门的故事。拉特兰铳使的介入，以及莫斯提马堕天使身份的揭示。展现了龙门地下世界的复杂生态。',
      related_entities: ['莫斯提马', '能天使', '德克萨斯', '可颂', '空', '拜松', '鼠王', '槐琥', '龙门', '拉特兰', '企鹅物流'],
      related_series: ['吾导先路', '崔林特尔梅之金'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^DM/ },
    topic_name: '生于黑夜',
    annotation: {
      summary: 'W的过去被完整揭示。她在巴别塔时期的经历，与特蕾西娅、伊内丝、赫德雷的关系。萨卡兹内战的历史，巴别塔的兴衰，以及W从雇佣兵到整合运动的转变。',
      related_entities: ['W', '特蕾西娅', '伊内丝', '赫德雷', '凯尔希', '特雷西斯', '巴别塔', '卡兹戴尔'],
      related_series: ['巴别塔'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^TW/ },
    topic_name: '沃伦姆德的薄暮',
    annotation: {
      summary: '莱塔尼亚的沃伦姆德城镇遭遇感染者与非感染者之间的冲突。亚叶、铃兰与安托医生的故事。揭示了莱塔尼亚对感染者的迫害，以及冬灵族古老传说的真相。',
      related_entities: ['亚叶', '铃兰', '安托', '泥岩', '莱塔尼亚', '沃伦姆德', '冬灵族'],
      related_series: [],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^RI/ },
    topic_name: '密林悍将归来',
    annotation: {
      summary: '嘉维尔回到故乡阿卡胡拉雨林，卷入部落间的纷争与考古队的事件。森蚺、燧石等角色登场，揭示了萨尔贡雨林中独特的部族文化与古老科技遗迹。',
      related_entities: ['嘉维尔', '森蚺', '燧石', '特米米', '萨尔贡', '阿卡胡拉', '源石技艺'],
      related_series: [],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^MN/ },
    topic_name: '玛莉娅·临光',
    annotation: {
      summary: '卡西米尔的骑士竞技。玛莉娅·临光为守护家族荣耀参加骑士竞技，揭露了商业联合会控制下骑士竞技的黑暗面。瑕光与鞭刃的故事，为长夜临光铺垫。',
      related_entities: ['玛莉娅·临光', '瑕光', '鞭刃', '佐菲娅', '白金', '砾', '卡西米尔', '商业联合会'],
      related_series: ['长夜临光'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^MB/ },
    topic_name: '孤岛风云',
    annotation: {
      summary: '哥伦比亚的曼斯菲尔德监狱。山与卡夫卡、罗宾等人策划越狱，揭露了杰西卡家族的阴谋与监狱实验的真相。莱茵生命前成员与哥伦比亚资本力量的博弈。',
      related_entities: ['山', '卡夫卡', '罗宾', '杰西卡', '塞雷娅', '缪尔赛思', '哥伦比亚', '曼斯菲尔德监狱'],
      related_series: ['绿野幻梦', '孤星'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^WR/ },
    topic_name: '画中人',
    annotation: {
      summary: '炎国的岁兽相关故事。夕的画中世界被揭示，年与夕的姐妹关系展现。揭示了炎国对岁兽碎片的控制与利用，以及"岁"这一古老存在的恐怖力量。',
      related_entities: ['年', '夕', '乌有', '炎国', '岁', '岁兽', '司岁台'],
      related_series: ['将进酒', '登临意', '怀黍离', '相见欢'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^OD/ },
    topic_name: '源石尘行动',
    annotation: {
      summary: '明日方舟与彩虹六号的联动活动。彩虹小队在泰拉世界的冒险，面对源石与感染者的陌生现实。展现了两个世界观的碰撞与融合。',
      related_entities: ['灰烬', '闪击', '霜华', '战车', '彩虹六号', '源石', '萨尔贡'],
      related_series: ['水晶箭行动'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^WD/ },
    topic_name: '遗尘漫步',
    annotation: {
      summary: '凯尔希的过去被揭示。她在不同历史时期的行动，与沙皇、科西切等历史人物的交集。展现了凯尔希作为长生者的孤独与坚守，以及她对泰拉文明的守护。',
      related_entities: ['凯尔希', '异客', '沙皇', '乌萨斯', '萨尔贡', '卡兹戴尔', '长生者'],
      related_series: [],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^SV/ },
    topic_name: '覆潮之下',
    annotation: {
      summary: '深海线的重要篇章。斯卡蒂回到阿戈尔故乡盐风城，遭遇深海教会与"海嗣"的阴谋。歌蕾蒂娅登场，深海猎人的真相与阿戈尔的危机被揭示。',
      related_entities: ['斯卡蒂', '歌蕾蒂娅', '幽灵鲨', '深海猎人', '海嗣', '深海教会', '阿戈尔', '盐风城'],
      related_series: ['骑兵与猎人', '愚人号', '生路'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^DH/ },
    topic_name: '多索雷斯假日',
    annotation: {
      summary: '陈离开龙门后的故事。与林雨霞在多索雷斯度假城市的冒险，卷入市长坎黛拉的权力游戏。陈的转型与成长，以及玻利瓦尔三方势力的复杂博弈。',
      related_entities: ['陈', '林雨霞', '诗怀雅', '星熊', '坎黛拉', '龙舌兰', '羽毛笔', '多索雷斯', '玻利瓦尔'],
      related_series: [],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^NL/ },
    topic_name: '长夜临光',
    annotation: {
      summary: '卡西米尔骑士竞技的巅峰对决。临光回归卡西米尔，挑战商业联合会的统治。揭示了卡西米尔社会结构的深层矛盾，无胄盟、监正会、商业联合会的三方博弈。',
      related_entities: ['临光', '耀骑士', '玛莉娅·临光', '瑕光', '鞭刃', '白金', '砾', '青金', '罗素', '卡西米尔', '商业联合会'],
      related_series: ['玛莉娅·临光'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^BI/ },
    topic_name: '风雪过境',
    annotation: {
      summary: '谢拉格的变革。银灰推动谢拉格现代化，遭遇保守派的抵制。初雪、崖心的家庭矛盾被揭示。耶拉冈德的真实身份——初雪的真正力量来源被揭示。',
      related_entities: ['银灰', '初雪', '崖心', '角峰', '讯使', '灵知', '耶拉', '谢拉格', '耶拉冈德'],
      related_series: ['雪山降临1101'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^IW/ },
    topic_name: '将进酒',
    annotation: {
      summary: '岁兽线的重要篇章。年的另一个姐妹"令"登场。围绕酒盏与岁相的争斗，揭示了更多关于岁兽分裂与炎国封印的历史。左乐、老鲤等角色活跃。',
      related_entities: ['年', '夕', '令', '老鲤', '左乐', '炎国', '岁', '岁相', '司岁台'],
      related_series: ['画中人', '登临意', '怀黍离', '相见欢'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^GA/ },
    topic_name: '吾导先路',
    annotation: {
      summary: '拉特兰的故事。莫斯提马与菲亚梅塔的过去被揭示，拉特兰的律法与萨卡兹的苦难形成对比。安多恩的理想与现实的冲突，"殉道者"的道路选择。',
      related_entities: ['莫斯提马', '菲亚梅塔', '安多恩', '见行者', '蕾缪安', '拉特兰', '律法', '萨卡兹'],
      related_series: ['喧闹法则', '崔林特尔梅之金', '众生行记'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^SN/ },
    topic_name: '愚人号',
    annotation: {
      summary: '深海线的又一重要篇章。阿戈尔的城市伊比利亚沿海遭遇海嗣入侵。幽灵鲨/归溟幽灵鲨的觉醒，斯卡蒂与歌蕾蒂娅再度联手。阿戈尔的傲慢与海嗣的进化成为核心矛盾。',
      related_entities: ['斯卡蒂', '歌蕾蒂娅', '幽灵鲨', '归溟幽灵鲨', '海嗣', '深海教会', '阿戈尔', '伊比利亚', '格兰法洛'],
      related_series: ['骑兵与猎人', '覆潮之下', '生路'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^LE/ },
    topic_name: '尘影余音',
    annotation: {
      summary: '莱塔尼亚的音乐与法术。黑键与白垩的故事，巫王残党与双子女皇的博弈。揭示了莱塔尼亚独特的源石技艺体系——音乐法术，以及巫王统治时期的黑暗历史。',
      related_entities: ['黑键', '白垩', '芙蓉', '车尔尼', '格特鲁德', '巫王', '双子女皇', '莱塔尼亚'],
      related_series: ['崔林特尔梅之金'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^DV/ },
    topic_name: '绿野幻梦',
    annotation: {
      summary: '莱茵生命的故事。多萝西的实验与理想，揭示了哥伦比亚科学界的伦理困境。赫默与塞雷娅的关系进一步揭示，斐尔迪南的野心，以及炎魔事件的余波。',
      related_entities: ['多萝西', '赫默', '塞雷娅', '缪尔赛思', '斐尔迪南', '帕尔维斯', '莱茵生命', '哥伦比亚', '炎魔事件'],
      related_series: ['孤星', '未许之地'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^IC/ },
    topic_name: '理想城：长夏狂欢季',
    annotation: {
      summary: '杜林地下城市的冒险。嘉维尔与特米米探索杜林文明的遗迹，遭遇机械与天灾的威胁。至简、鸿雪等角色登场，揭示了杜林文明独特的生存哲学。',
      related_entities: ['嘉维尔', '特米米', '至简', '鸿雪', '杜林', '阿卡胡拉', '萨尔贡'],
      related_series: ['密林悍将归来'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^IS/ },
    topic_name: '叙拉古人',
    annotation: {
      summary: '叙拉古黑帮的家族斗争。德克萨斯回到叙拉古，面对拉普兰德与家族的过去。揭示了叙拉古独特的家族制度、移动城市与叙拉古人的文化特质。伺夜的改革理想与现实的冲突。',
      related_entities: ['德克萨斯', '拉普兰德', '伺夜', '斥罪', '子月', '乔万娜', '西西里夫人', '叙拉古', '家族'],
      related_series: [],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^FC/ },
    topic_name: '照我以火',
    annotation: {
      summary: '苇草的身世揭晓。她是深池领袖爱布拉娜的妹妹，维多利亚王位继承者之一。塔拉地区的独立运动，深池组织的内部矛盾，以及苇草寻找自我身份的过程。',
      related_entities: ['苇草', '爱布拉娜', '深池', '蔓德拉', '塔拉', '维多利亚'],
      related_series: ['风暴瞭望', '破碎日冕'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^WB/ },
    topic_name: '登临意',
    annotation: {
      summary: '岁兽线的新篇章。重岳（年的大哥）的故事被揭示。玉门城的迁移与岁相的威胁，炎国军方与江湖门派的合作。更多关于岁兽兄弟姐妹的信息被透露。',
      related_entities: ['重岳', '年', '令', '夕', '左乐', '大哥', '玉门', '炎国', '岁', '岁相'],
      related_series: ['画中人', '将进酒', '怀黍离', '相见欢'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^CF/ },
    topic_name: '落叶逐火',
    annotation: {
      summary: '明日方舟与怪物猎人的联动。泰拉世界与怪物的遭遇，展现了跨界合作与狩猎文化。',
      related_entities: ['麒麟X夜刀', '黑角', '怪物猎人'],
      related_series: [],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^CW/ },
    topic_name: '孤星',
    annotation: {
      summary: '莱茵生命篇的高潮。克丽斯腾突破星荚、触碰天空真相的故事。塞雷娅、赫默、缪尔赛思、多萝西等角色的命运交织。星荚的本质、前文明遗产、哥伦比亚的天空骗局被揭示。',
      related_entities: ['克丽斯腾', '塞雷娅', '赫默', '缪尔赛思', '多萝西', '斐尔迪南', '帕尔维斯', '霍尔海雅', '莱茵生命', '哥伦比亚', '星荚', '前文明'],
      related_series: ['绿野幻梦', '未许之地'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^HE/ },
    topic_name: '空想花庭',
    annotation: {
      summary: '拉特兰周边的修道院故事。揭示了拉特兰律法的局限与萨卡兹难民的困境。圣约送葬人的任务与信仰危机，展现了宗教理想与现实苦难之间的张力。',
      related_entities: ['圣约送葬人', '阿尔图罗', '蕾缪安', '空构', '菲亚梅塔', '拉特兰', '萨卡兹'],
      related_series: ['吾导先路', '崔林特尔梅之金', '众生行记'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^SL/ },
    topic_name: '火山旅梦',
    annotation: {
      summary: '多利的梦境与火山小镇的故事。羊之主多利的往事被揭示，艾雅法拉与火山研究的背景。温暖治愈的基调下隐藏着关于源石与自然的思考。',
      related_entities: ['艾雅法拉', '多利', '羊之主', '汐斯塔', '火山', '源石'],
      related_series: ['火蓝之心'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^CV/ },
    topic_name: '不义之财',
    annotation: {
      summary: '哥伦比亚拓荒地的故事。冰酿的复仇与正义的追寻，揭示了哥伦比亚西部拓荒时代的黑暗面——资本对工人的剥削与黑钢国际的灰色地带。',
      related_entities: ['冰酿', '涤火杰西卡', '杰西卡', '黑钢国际', '哥伦比亚'],
      related_series: [],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^ZT/ },
    topic_name: '崔林特尔梅之金',
    annotation: {
      summary: '莱塔尼亚的巅峰篇章。巫王与双子女皇的终极对决，黑键的身世与成长。阿尔图罗的"源石技艺"与群体情绪的操控。揭示了莱塔尼亚最深的秘密——金律乐章的本质。',
      related_entities: ['黑键', '白垩', '巫王', '双子女皇', '阿尔图罗', '薇薇安娜', '车尔尼', '莱塔尼亚', '金律乐章'],
      related_series: ['尘影余音', '吾导先路', '众生行记'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^RS/ },
    topic_name: '银心湖列车',
    annotation: {
      summary: '谢拉格的列车之旅。哈洛德·克雷加文与谢拉格的商业谈判，银灰的国际化布局。欢乐轻松的基调下展现了谢拉格对外开放后的新气象。',
      related_entities: ['银灰', '锏', '哈洛德', '谢拉格', '喀兰贸易'],
      related_series: ['风雪过境', '雪山降临1101'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^HS/ },
    topic_name: '怀黍离',
    annotation: {
      summary: '岁兽线的新篇章。黍（年的姐妹）的故事，大荒城的农业奇迹与岁相的威胁。揭示了炎国对岁兽碎片的利用方式，以及"大炎"这个农业文明的根基。',
      related_entities: ['黍', '年', '令', '夕', '重岳', '左乐', '大荒城', '炎国', '岁', '岁相'],
      related_series: ['画中人', '将进酒', '登临意', '相见欢'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^CR/ },
    topic_name: '水晶箭行动',
    annotation: {
      summary: '明日方舟与彩虹六号的第二次联动。彩虹小队再次来到泰拉世界，面对新的威胁与阴谋。',
      related_entities: ['艾拉', '医生', '双月', 'iana', '彩虹六号', '哥伦比亚'],
      related_series: ['源石尘行动'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^BB/ },
    topic_name: '巴别塔',
    annotation: {
      summary: '巴别塔时期的往事。博士、凯尔希、特蕾西娅在萨卡兹内战中的故事。揭示了博士失忆前的身份——"预言家"与源石计划。特雷西娅的理想与悲剧，巴别塔从希望到毁灭的过程。',
      related_entities: ['博士', '特蕾西娅', '凯尔希', '特雷西斯', 'W', '阿斯卡纶', '巴别塔', '卡兹戴尔', '源石计划', '前文明'],
      related_series: ['生于黑夜', '慈悲灯塔'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^BP/ },
    topic_name: '生路',
    annotation: {
      summary: '深海线的最新篇章。阿戈尔向陆地求援，斯卡蒂与歌蕾蒂娅面对海嗣进化的新威胁。揭示了阿戈尔社会结构的真相，以及海嗣与泰拉文明共存的渺茫可能。',
      related_entities: ['斯卡蒂', '歌蕾蒂娅', '幽灵鲨', '乌尔比安', '海嗣', '深海猎人', '阿戈尔', '伊比利亚'],
      related_series: ['骑兵与猎人', '覆潮之下', '愚人号'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^AS/ },
    topic_name: '太阳甩在身后',
    annotation: {
      summary: '萨尔贡的沙漠之城。佩佩的考古冒险，揭示了萨尔贡古代文明与源石的隐秘联系。热情奔放的故事基调，展现了萨尔贡独特的文化风貌。',
      related_entities: ['佩佩', '娜仁图亚', '萨尔贡', '源石'],
      related_series: [],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^DT/ },
    topic_name: '泰拉饭',
    annotation: {
      summary: '明日方舟与迷宫饭的联动。冒险者们在泰拉世界的美食探险，将迷宫饭的美食文化与泰拉的种族特色相结合。轻松有趣的跨界故事。',
      related_entities: ['玛露西尔', '莱欧斯', '森西', '奇尔查克', '迷宫饭'],
      related_series: [],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^GO/ },
    topic_name: '追迹日落以西',
    annotation: {
      summary: '维多利亚的工业城市。维娜在伦蒂尼姆之外的冒险，蒸汽骑士的遗产与工人阶级的觉醒。揭示了维多利亚社会变革的另一面。',
      related_entities: ['推进之王', '维娜', '戴菲恩', '蒸汽骑士', '维多利亚', '伦蒂尼姆'],
      related_series: ['破碎日冕', '淬火尘霾'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^PV/ },
    topic_name: '揭幕者们',
    annotation: {
      summary: '新沃尔西尼的狂欢节。拉普兰德与德克萨斯的再次相遇，叙拉古新秩序的建立与挑战。展现了叙拉古变革后的新面貌与旧势力的反扑。',
      related_entities: ['拉普兰德', '德克萨斯', '忍冬', '弑君者', '新沃尔西尼', '叙拉古'],
      related_series: ['叙拉古人'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^EP-/ },
    topic_name: '出苍白海',
    annotation: {
      summary: '伊比利亚沿海的冒险。揭示伊比利亚大静谧之后的重建与苦难。新角色与深海线的进一步延伸。',
      related_entities: ['伊比利亚', '深海猎人', '海嗣', '阿戈尔'],
      related_series: ['覆潮之下', '愚人号', '生路'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^OR/ },
    topic_name: '相见欢',
    annotation: {
      summary: '岁兽线的新篇章。年与姐妹们在炎国的再次聚首，更多关于岁兽与炎国的秘密被揭示。百灶城的危机与岁的觉醒威胁。',
      related_entities: ['年', '令', '夕', '黍', '重岳', '炎国', '岁', '岁相', '百灶城'],
      related_series: ['画中人', '将进酒', '登临意', '怀黍离'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^EA/ },
    topic_name: '挽歌燃烧殆尽',
    annotation: {
      summary: '卡西米尔的故事。玛恩纳·临光的过去被揭示，商业联合会的新阴谋。展现了卡西米尔社会变迁中普通骑士的挣扎与坚守。',
      related_entities: ['玛恩纳', '临光', '托兰', '卡西米尔', '商业联合会'],
      related_series: ['玛莉娅·临光', '长夜临光'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^MT/ },
    topic_name: '众生行记',
    annotation: {
      summary: '拉特兰的最新篇章。拉特兰面临前所未有的危机，律法本身出现异变。安多恩、菲亚梅塔、莫斯提马等角色的命运交织。揭示了拉特兰律法的本质与萨卡兹苦难的根源联系。',
      related_entities: ['安多恩', '菲亚梅塔', '莫斯提马', '圣约送葬人', '阿尔图罗', '蕾缪安', '拉特兰', '律法', '萨卡兹'],
      related_series: ['吾导先路', '空想花庭', '崔林特尔梅之金'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^AD/ },
    topic_name: '红丝绒',
    annotation: {
      summary: '莱塔尼亚的剧院故事。关于艺术与疯狂、表演与真实的探讨。揭示了莱塔尼亚文化圈内部的黑暗面。',
      related_entities: ['莱塔尼亚'],
      related_series: ['尘影余音', '崔林特尔梅之金'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^AT/ },
    topic_name: '墟',
    annotation: {
      summary: '东国的怪谈故事。忍者的传承与鬼族的传说，展现了东国独特的妖怪文化与现代社会的碰撞。',
      related_entities: ['东国'],
      related_series: [],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^SS/ },
    topic_name: '无忧梦呓',
    annotation: {
      summary: '关于梦境与现实边界的探索。揭示了源石技艺对精神层面的影响，以及梦境中潜藏的危机。',
      related_entities: ['源石技艺'],
      related_series: [],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^OS/ },
    topic_name: '雪山降临1101',
    annotation: {
      summary: '谢拉格的最新篇章。耶拉冈德的真实力量展现，谢拉格面对的外部威胁与内部团结。揭示了谢拉格在现代化进程中的新挑战。',
      related_entities: ['耶拉', '银灰', '初雪', '崖心', '灵知', '谢拉格', '耶拉冈德'],
      related_series: ['风雪过境', '银心湖列车'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^UR/ },
    topic_name: '未许之地',
    annotation: {
      summary: '哥伦比亚的航天故事。星荚之外的探索，揭示了泰拉世界天空的秘密。与莱茵生命、孤星线有紧密联系。',
      related_entities: ['克丽斯腾', '莱茵生命', '哥伦比亚', '星荚', '天空'],
      related_series: ['绿野幻梦', '孤星'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^ME/ },
    topic_name: '雅赛努斯复仇记',
    annotation: {
      summary: '米诺斯的故事。古希腊风格的城邦政治与神话传说，展现了米诺斯文明独特的文化魅力。',
      related_entities: ['米诺斯'],
      related_series: [],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^TA/ },
    topic_name: '辞岁行',
    annotation: {
      summary: '岁兽线的延伸。关于年兽传说与炎国新年的故事，展现了炎国传统文化的魅力与岁的威胁。',
      related_entities: ['年', '夕', '令', '黍', '重岳', '炎国', '岁'],
      related_series: ['画中人', '将进酒', '登临意', '怀黍离', '相见欢'],
    },
  },
  {
    match: { group_name: '支线', prefix_pattern: /^PA/ },
    topic_name: '人们，我们',
    annotation: {
      summary: '乌萨斯的故事。关于人民、革命与压迫的深刻探讨，揭示了乌萨斯帝国内部的社会矛盾与变革渴望。',
      related_entities: ['乌萨斯', '感染者'],
      related_series: ['乌萨斯的孩子们'],
    },
  },

  // ==================== 别传/插曲（剧情）====================
  {
    match: { group_name: '剧情', prefix_pattern: /^SW/ },
    topic_name: '战地秘闻',
    annotation: {
      summary: '关于战争、记忆与牺牲的短篇故事集。通过不同角色的视角展现了切尔诺伯格事件后的余波，以及罗德岛成员们的内心世界。',
      related_entities: ['罗德岛', '整合运动', '切尔诺伯格'],
      related_series: [],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^AF/ },
    topic_name: '洪炉示岁',
    annotation: {
      summary: '炎国新年的故事。年的初次正式登场，展现了炎国传统文化与年的特殊能力。罗德岛在炎国的新年庆典中遭遇意外事件。',
      related_entities: ['年', '炎国', '罗德岛'],
      related_series: ['画中人', '将进酒', '登临意', '怀黍离', '相见欢'],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^SA/ },
    topic_name: '午间逸话',
    annotation: {
      summary: '罗德岛干员们的日常故事集。轻松温馨的基调下展现了干员们在战斗之外的日常生活与人际关系。',
      related_entities: ['罗德岛'],
      related_series: [],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^SV/ },
    topic_name: '乌萨斯的孩子们',
    annotation: {
      summary: '熊熊们的故事。乌萨斯学生自治团成员们在切尔诺伯格事件后的遭遇。凛冬、真理、古米等人的过去被揭示，展现了战争对儿童的残酷影响。',
      related_entities: ['凛冬', '真理', '古米', '烈夏', '乌萨斯', '切尔诺伯格', '整合运动'],
      related_series: ['人们，我们'],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^FA/ },
    topic_name: '踏寻往昔之风',
    annotation: {
      summary: '干员们的往事追忆。通过多个短篇故事揭示了干员们加入罗德岛之前的经历，以及他们内心深处的执念与成长。',
      related_entities: ['罗德岛'],
      related_series: [],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^BH/ },
    topic_name: '此地之外',
    annotation: {
      summary: '泰拉各地的故事集。展现了泰拉世界不同地区、不同种族人们的生活状态与命运，扩展了明日方舟的世界观。',
      related_entities: ['泰拉'],
      related_series: [],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^PL/ },
    topic_name: '灯火序曲',
    annotation: {
      summary: '罗德岛与整合运动冲突后的过渡篇章。多个短篇故事展现了各方势力在切尔诺伯格事件后的动向，以及新角色的初次登场。',
      related_entities: ['罗德岛', '整合运动', '切尔诺伯格'],
      related_series: [],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^VI/ },
    topic_name: '如我所见',
    annotation: {
      summary: '博士视角的故事。通过博士的回忆与思考，揭示了罗德岛成立初期的历史，以及博士与凯尔希、阿米娅之间的复杂关系。',
      related_entities: ['博士', '凯尔希', '阿米娅', '罗德岛'],
      related_series: ['巴别塔'],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^PS/ },
    topic_name: '红松林',
    annotation: {
      summary: '卡西米尔骑士竞技的幕后故事。红松骑士团的成员们为理想而战，揭示了卡西米尔骑士竞技商业化对骑士精神的冲击。',
      related_entities: ['焰尾', '远牙', '灰毫', '正义骑士号', '卡西米尔', '骑士竞技'],
      related_series: ['玛莉娅·临光', '长夜临光'],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^TB/ },
    topic_name: '阴云火花',
    annotation: {
      summary: '澄闪的故事。揭示了维多利亚感染者的困境，以及感染者社区在面对压迫时的团结与抗争。',
      related_entities: ['澄闪', '维多利亚', '感染者'],
      related_series: [],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^TC/ },
    topic_name: '未尽篇章',
    annotation: {
      summary: '卡西米尔故事的补充。揭示了长夜临光事件之后，卡西米尔各势力的后续发展，以及角色的命运走向。',
      related_entities: ['卡西米尔', '商业联合会'],
      related_series: ['玛莉娅·临光', '长夜临光'],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^AW/ },
    topic_name: '日暮寻路',
    annotation: {
      summary: '临光家族的故事。玛嘉烈·临光在离开卡西米尔后的旅程，追寻骑士精神的真谛。揭示了临光家族的荣耀与牺牲。',
      related_entities: ['临光', '耀骑士', '玛莉娅·临光', '卡西米尔'],
      related_series: ['玛莉娅·临光', '长夜临光'],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^BW/ },
    topic_name: '好久不见',
    annotation: {
      summary: '轻松的日常故事。干员们在罗德岛上的温馨互动，展现了战斗之外的轻松时刻与人情味。',
      related_entities: ['罗德岛'],
      related_series: [],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^DC/ },
    topic_name: '春分',
    annotation: {
      summary: '炎国的乡村故事。关于传统、信仰与变革的探讨，展现了炎国农村社会的风貌与矛盾。',
      related_entities: ['炎国'],
      related_series: [],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^FD/ },
    topic_name: '眠于树影之中',
    annotation: {
      summary: '萨米的故事。揭示了萨米地区与邪魔、自然精魂相关的独特文化，以及萨米人与自然的特殊关系。',
      related_entities: ['萨米', '邪魔', '自然'],
      related_series: ['探索者的银凇止境'],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^TG/ },
    topic_name: '去咧嘴谷',
    annotation: {
      summary: '哥伦比亚的矿业城镇故事。揭示了源石工业对普通人生活的影响，以及哥伦比亚西部开发过程中的社会问题。',
      related_entities: ['哥伦比亚', '源石'],
      related_series: [],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^KR/ },
    topic_name: '熔炉"还魂"记',
    annotation: {
      summary: '萨卡兹的故事。关于萨卡兹亡者的传说与熔炉的神秘力量，揭示了萨卡兹种族与死亡、记忆相关的独特文化。',
      related_entities: ['萨卡兹', '卡兹戴尔'],
      related_series: ['生于黑夜', '巴别塔'],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^SE/ },
    topic_name: '我们明日见',
    annotation: {
      summary: '关于希望与坚持的故事。在泰拉的黑暗中，人们仍然寻找光明与未来。展现了普通人在绝境中的韧性。',
      related_entities: ['泰拉'],
      related_series: [],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^FM/ },
    topic_name: '镜中集',
    annotation: {
      summary: '关于记忆与身份的哲思故事。通过"镜子"这一意象，探讨了人们如何面对自己的过去与真实的自我。',
      related_entities: [],
      related_series: [],
    },
  },
  {
    match: { group_name: '剧情', prefix_pattern: /^CG/ },
    topic_name: '十字路口',
    annotation: {
      summary: '关于选择与命运的故事。在人生的十字路口，角色们面临艰难抉择，展现了不同道路的可能性与代价。',
      related_entities: [],
      related_series: [],
    },
  },

  // ==================== 集成战略 ====================
  {
    match: { group_name: '集成战略', prefix_pattern: /^RO/ },
    topic_name: '集成战略系列',
    annotation: {
      summary: 'roguelike模式的剧情系列。刻俄柏的灰蕈迷境、傀影与猩红孤钻、水月与深蓝之树、探索者的银凇止境、萨卡兹的无终奇语、岁的界园志异等主题，通过随机探索展现了泰拉各区域的独特故事。',
      related_entities: ['刻俄柏', '傀影', '水月', '萨米', '萨卡兹', '岁', '集成战略'],
      related_series: [],
    },
  },
  {
    match: { group_name: '刻俄柏的灰蕈迷境', prefix_pattern: /^RO/ },
    topic_name: '刻俄柏的灰蕈迷境',
    annotation: {
      summary: '首个集成战略主题。刻俄柏在神秘的灰蕈迷境中的冒险，充满奇幻与荒诞元素的梦境之旅。',
      related_entities: ['刻俄柏', '灰蕈迷境'],
      related_series: ['傀影与猩红孤钻', '水月与深蓝之树'],
    },
  },

  // ==================== 生息演算 ====================
  {
    match: { group_name: '沙中之火', prefix_pattern: /^RA/ },
    topic_name: '沙中之火',
    annotation: {
      summary: '首个生息演算主题。在萨尔贡沙漠中建立据点、收集资源、抵御威胁的生存模式。',
      related_entities: ['萨尔贡', '生息演算'],
      related_series: ['沙洲遗闻'],
    },
  },
  {
    match: { group_name: '生息演算', prefix_pattern: /^RA/ },
    topic_name: '生息演算系列',
    annotation: {
      summary: '生存建设模式的剧情系列。沙中之火、沙洲遗闻、重启锚点等主题，展现了泰拉各地的资源争夺与基地建设故事。',
      related_entities: ['萨尔贡', '生息演算'],
      related_series: ['沙中之火'],
    },
  },

  // ==================== 四月辑录 ====================
  {
    match: { group_name: '四月辑录', prefix_pattern: /^APF|^BF|^IM|^LTTB|^RE|^UO/ },
    topic_name: '四月辑录',
    annotation: {
      summary: '愚人节特别活动合集。包含断罪者的挑战状、泰拉说唱之夜、狂弹要塞、投资大师课、黑色博士坠落、主播U等轻松有趣的跨界与搞笑内容。',
      related_entities: ['断罪者', '主播U', 'U-official'],
      related_series: [],
    },
  },

  // ==================== 特殊 ====================
  {
    match: { group_name: '特殊', prefix_pattern: /^CR/ },
    topic_name: '危机合约',
    annotation: {
      summary: '高难度挑战模式。不同时期的危机合约剧情，展现了罗德岛面对极端危险任务时的应对。',
      related_entities: ['罗德岛', '危机合约'],
      related_series: [],
    },
  },
  {
    match: { group_name: '特殊', prefix_pattern: /^NL-HD/ },
    topic_name: '长夜临光隐藏剧情',
    annotation: {
      summary: '长夜临光的隐藏剧情补充。揭示了卡西米尔骑士竞技背后更深层的秘密。',
      related_entities: ['临光', '卡西米尔'],
      related_series: ['玛莉娅·临光', '长夜临光'],
    },
  },
];

// 主执行函数
async function main() {
  console.log('开始标注数据库中的剧情主题...');

  // 获取所有有story_path的documents
  const docsResult = await pool.query(`
    SELECT document_id, title, metadata->'story_path' as story_path, metadata->>'group_name' as group_name, metadata->>'top_group' as top_group
    FROM documents
    WHERE metadata ? 'story_path'
  `);

  console.log(`找到 ${docsResult.rows.length} 条有story_path的document记录`);

  let updated = 0;
  let skipped = 0;
  const unmatched = [];

  for (const doc of docsResult.rows) {
    const stage = doc.story_path[3] || '';
    const groupName = doc.group_name || '';
    const topGroup = doc.top_group || '';

    // 查找匹配的主题
    let matched = null;
    for (const topic of TOPIC_ANNOTATIONS) {
      const m = topic.match;
      if (m.top_group && topGroup !== m.top_group) continue;
      if (m.group_name && groupName !== m.group_name) continue;
      if (m.prefix_pattern && !m.prefix_pattern.test(stage)) continue;
      matched = topic;
      break;
    }

    if (!matched) {
      unmatched.push({ id: doc.document_id, title: doc.title, stage, group: groupName, top: topGroup });
      skipped++;
      continue;
    }

    // 更新metadata
    const annotation = {
      topic_name: matched.topic_name,
      summary: matched.annotation.summary,
      related_entities: matched.annotation.related_entities,
      related_series: matched.annotation.related_series,
    };

    await pool.query(`
      UPDATE documents
      SET metadata = jsonb_set(
        metadata,
        '{topic_annotation}',
        $1::jsonb,
        true
      ),
      updated_at = NOW()
      WHERE document_id = $2
    `, [JSON.stringify(annotation), doc.document_id]);

    updated++;
  }

  console.log(`\n更新完成:`);
  console.log(`  已更新: ${updated}`);
  console.log(`  未匹配: ${skipped}`);

  if (unmatched.length > 0) {
    console.log(`\n未匹配的记录 (前20条):`);
    for (const u of unmatched.slice(0, 20)) {
      console.log(`  #${u.id}: ${u.title} [${u.top}/${u.group}] stage=${u.stage}`);
    }
  }

  await pool.end();
}

main().catch(err => {
  console.error('执行失败:', err);
  pool.end();
  process.exit(1);
});
