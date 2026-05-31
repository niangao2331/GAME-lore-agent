import { Pool } from 'pg';

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  database: 'arknights_lore_new',
  user: 'postgres',
  password: 'postgres',
  ssl: false,
});

// ═══════════════════════════════════════════════════════════════════════════
// ORACLE DATABASE 入库脚本
// 来源: PRTS wiki "外部剧情资料" 分类 → ORACLE_DATABASE 子分类
// 内容: 明日方舟官方ARG解谜活动中揭示的剧情文本
// Tier: 1 (鹰角官方直接发布内容，玩家从解谜中获取的官方原文)
// ═══════════════════════════════════════════════════════════════════════════

// ── 数据库连接配置 ──────────────────────────────────────────────────────
const DB_CONFIG = {
  host: '127.0.0.1', port: 5432, database: 'arknights_lore_new',
  user: 'postgres', password: 'postgres', ssl: false,
};

// ═══════════════════════════════════════════════════════════════════════════
// 入库内容定义
// 每个条目: { external_key, title, subtitle, source_uri, content_type,
//             topic_annotation, units: [{ heading, text, metadata }],
//             entities: [{ name, entity_type, summary }] }
// ═══════════════════════════════════════════════════════════════════════════

const DOCUMENTS = [

  // ────────────────────────────────────────────────────────────────
  // 1. 来自可露希尔的信件 (回声测试 2018)
  // ────────────────────────────────────────────────────────────────
  {
    external_key: 'oracle-2beta-closure-letter',
    title: '来自可露希尔的信件',
    subtitle: '「回声测试」隐藏ARG解谜 — 可露希尔致博士的加密信件',
    source_name: 'PRTS wiki - ORACLE DATABASE / 明日方舟回声测试 (2018)',
    source_uri: 'https://prts.wiki/w/ORACLE_DATABASE/index/2beta_test',
    source_tier: 1,
    content_type: 'arg_lore',
    canon_status: 'official',
    review_status: 'pending',
    metadata: {
      story_path: ['外部剧情资料', 'ORACLE_DATABASE', '来自可露希尔的信件'],
      top_group: '外部剧情资料',
      group_name: 'ORACLE_DATABASE',
      top_group_code: 'EXTERNAL',
      arg_source: '回声测试 (2018/07/11)',
      puzzle_method: 'Base64 + OTP + XOR Cipher',
      imported_without_annotation: false,
      content_source: 'official_arg',
      import_source: 'prts_wiki_oracle_database',
      note: '解密过程: 收集各关卡中单字母角色(E/R/O/U/S/C/L)的斜杠符号呼号，拼接Base64编码→拼出CLOSURE代号→用X-7剧情揭示的OTP密钥→XOR运算→Windows-1252解码获得明文信件。',
      topic_annotation: {
        topic_name: '来自可露希尔的信件',
        summary: '明日方舟首次ARG解谜——回声测试期间（2018年7月），可露希尔通过关卡剧情中隐藏的加密信息向博士发送了一封OTP加密信件，预告博士即将"消失"以及她正在罗德岛深渊中提取PRTS系统信息。',
        related_entities: ['可露希尔', '博士', 'PRTS'],
        related_series: ['回声测试'],
      },
    },
    units: [
      {
        heading: '可露希尔致博士的信件',
        text: `【官方ARG解密原文 — 来自可露希尔的信件】

再过几周你就会消失。你可能不会再认得所有人，也不会记得你做过什么。

但当"你"重新回到深层时，"你"也许还会记得做过什么。

抱歉我没能在测试结束时现身。我正试图从深渊中获取一些对PRTS有用的信息。

我们很快就会再见。

署名：closure`,
        metadata: {
          summary: '可露希尔在回声测试期间发给博士的秘密信件，预告博士的失忆和她正在深渊中为PRTS提取信息。',
          summary_short: '可露希尔的加密告别信',
          key_terms: ['可露希尔', '博士', 'PRTS', '深渊', '失忆', 'Closure', 'Leader One', '回声测试'],
          content_language: 'zh',
          perspective_note: '可露希尔（罗德岛工程部主管、PRTS系统工程师）的直接通信，属于Tier 1官方内容。信中"深渊"后在第15章揭示为罗德岛本舰隐藏核心区域。',
        },
      },
    ],
    entities: [
      { name: '可露希尔', entity_type: 'character', summary: '罗德岛舰船可靠性工程师、PRTS系统工程师，萨卡兹族，代号Closure。开源软件倡导者，喜欢碳酸水和傍晚的咖啡，也是最初的ARG谜题发送者。' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  // 2. 欢迎回家，博士 (PV1 2019)
  // ────────────────────────────────────────────────────────────────
  {
    external_key: 'oracle-pv1-welcome-home',
    title: '欢迎回家，博士',
    subtitle: '「PV1」隐藏ARG解谜 — Leader One致记录者的信件',
    source_name: 'PRTS wiki - ORACLE DATABASE / 明日方舟PV1 (2019)',
    source_uri: 'https://prts.wiki/w/ORACLE_DATABASE/index/pv1',
    source_tier: 1,
    content_type: 'arg_lore',
    canon_status: 'official',
    review_status: 'pending',
    metadata: {
      story_path: ['外部剧情资料', 'ORACLE_DATABASE', '欢迎回家博士'],
      top_group: '外部剧情资料',
      group_name: 'ORACLE_DATABASE',
      top_group_code: 'EXTERNAL',
      arg_source: 'PV1 (2019/03/10)',
      puzzle_method: '视频逐帧提取→QR码拼接→URL发现',
      imported_without_annotation: false,
      content_source: 'official_arg',
      import_source: 'prts_wiki_oracle_database',
      note: '解密过程: PV1视频2分56秒后逐帧检查发现隐藏图块→调整亮度/旋转/缩放→拼合为缺角QR码→补全定位标记→扫描得14字母字符串KHYPERGRYPHCOM→组合背景中隐藏的"/next"→访问官网/next页面获得信件。',
      topic_annotation: {
        topic_name: '欢迎回家，博士',
        summary: 'PV1中隐藏的ARG谜题——通过QR码拼图导向可露希尔（Leader One）写给"记录者"的信，以及一段合成音广播鼓励聆听者成为"带回希望的人"。PV1中还隐藏了梅尔维尔《白鲸》的引用——"all mortal greatness is but disease"。',
        related_entities: ['可露希尔', '记录者', '阿米娅', '暴行', '博士'],
        related_series: ['PV1'],
      },
    },
    units: [
      {
        heading: '可露希尔致记录者的信件',
        text: `【官方ARG解密原文 — 来自Leader One的信件】

用户名: <GRACEADADIJKSTRA>
发件人: Leader One

大雪让我们的行程慢了下来。罗德岛不得不调整接下来的计划。

不过慢一点未必是坏事。我们有更多的时间去思考——关于接下来要面对的事物。

署名: -C

收件人: Recorder（记录者）`,
        metadata: {
          summary: '可露希尔（代号Leader One）发给记录者的信件，告知罗德岛因大雪调整计划，认为放慢脚步有更多时间思考。',
          summary_short: 'Leader One致记录者的雪中信件',
          key_terms: ['可露希尔', '记录者', 'Leader One', '罗德岛', 'PV1'],
          content_language: 'zh',
          perspective_note: '可露希尔的直接通信。收件人"记录者"是公测前官微叙事中的神秘人物。',
        },
      },
      {
        heading: '合成音广播：带回希望的人',
        text: `【官方ARG解密原文 — 合成音广播转录】

男性合成音："你现在需要成为——"
女性合成音："——那个带回希望的人。"

（对应PV1末尾"Welcome home, Doctor"场景）`,
        metadata: {
          summary: 'PV1末尾的合成音广播，指引聆听者成为"带回希望的人"——即博士的角色。',
          summary_short: '带回希望的人',
          key_terms: ['博士', '希望', '欢迎回家', 'PV1'],
          content_language: 'zh',
        },
      },
      {
        heading: 'PV1隐藏文字：白鲸引文',
        text: `【官方ARG解密原文 — PV1早期版本隐藏二进制文本】

"For all men tragically great are made so through a certain morbidness... all mortal greatness is but disease."

—— Herman Melville, "Moby-Dick" Chapter XVI

（来自赫尔曼·梅尔维尔《白鲸》第十六章）
译文："因为所有悲剧性的伟人都是经由某种病态而造就的……所有凡人的伟大都不过是疾病。"`,
        metadata: {
          summary: 'PV1初版（2017年9月8日）Hypergryph版权标志周围隐藏的二进制ASCII文本，引用梅尔维尔《白鲸》。',
          summary_short: '《白鲸》引文：凡人的伟大不过是疾病',
          key_terms: ['白鲸', 'Melville', 'Moby Dick', '伟大', '疾病', 'PV1'],
          content_language: 'en',
          perspective_note: '此引用可能暗示源石病（Oripathy）与"伟大"之间的悖论关系——感染使人强大也使人毁灭。',
        },
      },
    ],
    entities: [
      { name: '记录者', entity_type: 'character', summary: '公测前明日方舟官微叙事中的神秘第一人称叙述者，真实身份不明。曾混入罗德岛、被近卫局扣留、与企鹅物流合作。协助E.E.埃里克森撰写《大地巡旅》。' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  // 3. 记录者的记录 (PV2 2019)
  // ────────────────────────────────────────────────────────────────
  {
    external_key: 'oracle-pv2-recorder',
    title: '记录者的记录',
    subtitle: '「PV2」隐藏ARG解谜 — 记录者初见阿米娅的叙述',
    source_name: 'PRTS wiki - ORACLE DATABASE / 明日方舟PV2 (2019)',
    source_uri: 'https://prts.wiki/w/ORACLE_DATABASE/index/pv2',
    source_tier: 1,
    content_type: 'arg_lore',
    canon_status: 'official',
    review_status: 'pending',
    metadata: {
      story_path: ['外部剧情资料', 'ORACLE_DATABASE', '记录者的记录'],
      top_group: '外部剧情资料',
      group_name: 'ORACLE_DATABASE',
      top_group_code: 'EXTERNAL',
      arg_source: 'PV2 (2019/04/30)',
      puzzle_method: '摩斯密码→企鹅物流运单追踪→扫雷+数独→物理包裹+透明罗盘→ITA2+Unicode',
      imported_without_annotation: false,
      content_source: 'official_arg',
      import_source: 'prts_wiki_oracle_database',
      note: '解密过程: 历时239天（2019/4/30–12/25），是明日方舟首个线上线下混合ARG。PV中斜杠→摩斯密码→IMDb编号→官网/future图片→喧闹法则QR码→企鹅物流运单追踪→Minesweeper+Sudoku→物理包裹透明罗盘→坐标定位→ITA2+Unicode解码获得最终明文。其中"originium controlled her mind"作为隐藏发现暗示源石与阿米娅的关系。',
      topic_annotation: {
        topic_name: '记录者的记录',
        summary: 'PV2中藏有明日方舟最复杂的ARG谜题之一——横跨239天、需要物理包裹的线上线下混合解谜。最终解密文本是记录者叙述初次在沙漠营地遇见年幼阿米娅的经历，由特蕾西娅（议长）将阿米娅引荐给记录者。附加发现"源石控制她的思维"暗示阿米娅与源石及文明的深层联系。',
        related_entities: ['记录者', '阿米娅', '特蕾西娅', '可露希尔', '企鹅物流'],
        related_series: ['PV2', '喧闹法则'],
      },
    },
    units: [
      {
        heading: '源石控制她的思维',
        text: `【官方ARG解密原文 — 旧官网隐藏数字串解密】

旧版ak.hypergryph.com网站上"WE ARE HEADING EAST"文字中隐藏的数字串：
1288293294166933, 22563, 1050601, 69862651081006

全部以base-36转换后拼接得到：
"originium controlled her mind"
（源石控制她的思维）

注：此发现暗示源石与阿米娅之间存在深层连接，可能与"文明的存续"（Civilight Eterna）和第14章揭示的魔王传承有关。`,
        metadata: {
          summary: '旧版官网隐藏数字串经base-36转换后揭示的密文——"源石控制她的思维"，暗示源石与阿米娅之间存在深层连接。',
          summary_short: '源石控制她',
          key_terms: ['源石', '阿米娅', '文明的存续', '思维控制', 'Originium', 'PV2'],
          content_language: 'en',
          perspective_note: '此密文含义未完全明确，可能指向阿米娅与源石的某种共生/寄生关系，或与"魔王"传承体制有关。',
        },
      },
      {
        heading: '记录者初见阿米娅',
        text: `【官方ARG解密原文 — 记录者的最终叙述】

我第一次遇到她的时候，她正和那个人一起，艰难地从沙漠返回营地。

起初我并没有在意这个女孩，但是冥冥之中感觉到——她和过去我所见到的所有的孩子都不一样。

她的眼神里有风沙磨不掉的东西。即使是那个严酷的地方，也没能从她的脸上带走那份温柔。

议长似乎比我更早发现了这一点。她把这个孩子带到我面前，对我说：

"这就是我要你帮助照顾的孩子。她的名字是——"

阿米娅。`,
        metadata: {
          summary: '记录者回忆初次在沙漠营地见到阿米娅——特蕾西娅（议长）将年幼的阿米娅托付给记录者照顾。',
          summary_short: '记录者初见阿米娅的叙述',
          key_terms: ['记录者', '阿米娅', '特蕾西娅', '议长', '沙漠', '初次见面', 'PV2'],
          content_language: 'zh',
          perspective_note: '记录者的第一人称直接叙述。"那个人"/"议长"即特蕾西娅。这是记录者在公测后的首次出现——公测前他在官微叙事中曾有活跃，公测后仅在此ARG中露面。',
        },
      },
      {
        heading: '塞壬唱片的礼物',
        text: `【官方ARG解密 — 塞壬唱片首张EP预告】

2019年11月18日，@企鹅物流微博发布网易云音乐动态链接。
该动态包含ITA2编码，解码为"DJ OKAWARI"。
日本邮政条形码读取为"20191119"。
配文: "À demain!"（法语: "明天见!"）

2019年11月19日，明日方舟首张EP《Speed of Light》正式上线——由DJ OKAWARI作曲、二宫爱演唱。`,
        metadata: {
          summary: '企鹅物流微博发布的谜题——ITA2编码指向DJ OKAWARI→预告明日方舟首张EP《Speed of Light》上线。',
          summary_short: '首张EP Speed of Light预告',
          key_terms: ['塞壬唱片', 'DJ OKAWARI', 'Speed of Light', '企鹅物流', 'EP'],
          content_language: 'zh',
          perspective_note: '这是企鹅物流（in-universe物流公司）通过微博发布的信息，展示塞壬唱片作为泰拉世界观内音乐厂牌的设定。',
        },
      },
    ],
    entities: [
      { name: '特蕾西娅', entity_type: 'character', summary: '卡兹戴尔的前魔王，巴别塔的创立者之一，阿米娅的前任。拥有"文明的存续"能力，在萨卡兹内战中死于特雷西斯之手。被记录者称为"议长"。' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  // 4. 特蕾西娅的绝笔 (PV3 2021)
  // ────────────────────────────────────────────────────────────────
  {
    external_key: 'oracle-pv3-theresa-letter',
    title: '特蕾西娅的绝笔',
    subtitle: '「PV3」隐藏ARG解谜 — 特蕾西娅致凯尔希的信件与阿米娅的留言',
    source_name: 'PRTS wiki - ORACLE DATABASE / 明日方舟PV3 (2021)',
    source_uri: 'https://prts.wiki/w/ORACLE_DATABASE/index/pv3',
    source_tier: 1,
    content_type: 'arg_lore',
    canon_status: 'official',
    review_status: 'pending',
    metadata: {
      story_path: ['外部剧情资料', 'ORACLE_DATABASE', '特蕾西娅的绝笔'],
      top_group: '外部剧情资料',
      group_name: 'ORACLE_DATABASE',
      top_group_code: 'EXTERNAL',
      arg_source: 'PV3 (2021/04/27)',
      puzzle_method: 'ASCII解码→官网关键词→凯撒密码→国际象棋坐标→萨卡兹文字谱→棱镜光路→Unicode',
      imported_without_annotation: false,
      content_source: 'official_arg',
      import_source: 'prts_wiki_oracle_database',
      note: '解密过程: PV3中隐藏ASCII数字串→解码为"the only monster"→层层递进的关键词访问官网→图片中的Unicode编码→国际象棋坐标→棱镜光路→萨卡兹文字符号→最终获得特蕾西娅致凯尔希的信件完整录音及阿米娅的留言录音。横跨8张图片。',
      topic_annotation: {
        topic_name: '特蕾西娅的绝笔',
        summary: 'PV3的ARG解谜揭示了两段重要的音频内容——特蕾西娅生前录给凯尔希的最后信件，其中回忆了凯尔希对她讲述的关于星空、大地和文明的知识；以及阿米娅的简短录音"博士会一直待在我身边的对吧？"。这是特蕾西娅思想世界的最核心展现。',
        related_entities: ['特蕾西娅', '凯尔希', '阿米娅', '博士'],
        related_series: ['PV3', '巴别塔', '慈悲灯塔'],
      },
    },
    units: [
      {
        heading: '特蕾西娅致凯尔希的信件',
        text: `【官方ARG解密原文 — 特蕾西娅给凯尔希的最后信件录音】

凯尔希，当你读到这封信时，最后一幕一定已经上演。

你说过，星荚之外的星星，是航行在星海航道上的方舟。

你说过，我们脚下的大地，不过是包裹在一颗天体上的泥壳。

你说的那些奇妙的事物……凯尔希，我记住了。我全都记住了。

—— 特蕾西娅`,
        metadata: {
          summary: '特蕾西娅生前给凯尔希留下的最后语音信件。她回忆凯尔希对她讲述的关于星空、大地和方舟的知识，并说"我全都记住了"——展现了两人之间深厚的情感纽带和在巴别塔时期共同持有的理想。',
          summary_short: '特蕾西娅回忆凯尔希的教导',
          key_terms: ['特蕾西娅', '凯尔希', '星荚', '方舟', '星海航道', '巴别塔', 'PV3'],
          content_language: 'zh',
          perspective_note: '特蕾西娅的直接语音。这段内容说明凯尔希曾向特蕾西娅分享关于前文明和宇宙的知识，特蕾西娅将这些知识牢记于心。与第14章"慈悲灯塔"中特蕾西娅的复活和遗产有直接关联。',
        },
      },
      {
        heading: '阿米娅的录音',
        text: `【官方ARG解密原文 — 阿米娅的留言录音】

"博士会一直待在我身边的对吧？"

—— 阿米娅`,
        metadata: {
          summary: '阿米娅的简短语音留言——"博士会一直待在我身边的对吧？"',
          summary_short: '博士会一直在我身边',
          key_terms: ['阿米娅', '博士', '陪伴', 'PV3'],
          content_language: 'zh',
          perspective_note: '阿米娅对博士的依赖和信任。这句话可以作为理解阿米娅-博士关系的核心锚点。',
        },
      },
      {
        heading: '核心密文：唯一的怪物是你的心',
        text: `【官方ARG解密原文 — PV3中的核心密文链】

1. "the only monster is your mind"
   （唯一的怪物是你的心）
   来源: PV3画面中的ASCII码解码 + PV1中13秒处同名语句

2. "The moment you reading this, the ending act must already be played."
   （当你读到此时，最后一幕定已上演）
   来源: 官网/unite图片Unicode编码

3. "You said the stars beyond skyveil are arks sailing through the stellar lane..."
   （你说过，星荚之外的星星，是航行在星海航道上的方舟……）
   来源: 官网/yourmind图片Unicode编码`,
        metadata: {
          summary: 'PV3 ARG中揭示的三段核心密文："唯一的怪物是你的心"、"当你读到此时最后一幕定已上演"、以及特蕾西娅回忆凯尔希对星空方舟的描述。',
          summary_short: '唯一的怪物是你的心',
          key_terms: ['monster', 'mind', '星荚', '方舟', '特蕾西娅', '凯尔希', 'PV3'],
          content_language: 'en',
          perspective_note: '"the only monster is your mind"首先出现于PV1，后在PV3中被再次引用——暗示"内心的怪物"是贯穿明日方舟的核心主题之一。',
        },
      },
    ],
    entities: [],
  },

  // ────────────────────────────────────────────────────────────────
  // 5. 销钉 (PV4 2024)
  // ────────────────────────────────────────────────────────────────
  {
    external_key: 'oracle-pv4-lynchpin',
    title: '销钉',
    subtitle: '「PV4」隐藏ARG解谜 — 博士的磁带录音、销钉文档与普瑞赛斯的心理测试',
    source_name: 'PRTS wiki - ORACLE DATABASE / 明日方舟PV4 (2024)',
    source_uri: 'https://prts.wiki/w/ORACLE_DATABASE/index/pv4',
    source_tier: 1,
    content_type: 'arg_lore',
    canon_status: 'official',
    review_status: 'pending',
    metadata: {
      story_path: ['外部剧情资料', 'ORACLE_DATABASE', '销钉'],
      top_group: '外部剧情资料',
      group_name: 'ORACLE_DATABASE',
      top_group_code: 'EXTERNAL',
      arg_source: 'PV4 (2024/04/27)',
      puzzle_method: 'ITA2解码→纵横填字（ALGOL/星名）→多普勒频移→摩斯密码→物理磁带包裹→Code49条形码→GBC编码',
      imported_without_annotation: false,
      content_source: 'official_arg',
      import_source: 'prts_wiki_oracle_database',
      note: '解密过程: 五周年PV4中隐藏了明日方舟史上最复杂的ARG。第一阶段: ITA2码→官网→纵横填字（7颗恒星名）→用户名为ELCARO（ORACLE反写，博士前文明代号"预言家"）、密码11708102（回声测试日期反写）→获得磁带图像。第二阶段: 约30名玩家收到实体包裹（含磁带+蓝色纸片），磁带含博士4段录音→GBC解码→"警惕你自己，源石目标已经改变，相信Ama-10"。第三阶段: 聂鲁达诗句+Code49条形码→"OVERCONTACT BINARY"相接双星→新网站/bymyside→普瑞赛斯的13问心理测试。',
      topic_annotation: {
        topic_name: '销钉',
        summary: '五周年PV4的ARG"销钉"是明日方舟最庞大、信息密度最高的ARG。揭示了多项关键前文明设定：博士（预言家ORACLE）的4段磁带录音（关于保存者计划、深蓝之树、天堂支点、伐木工寓言），"销钉"技术文档（非侵入式思想植入），普瑞赛斯的心理测试，以及"源石目标已经改变"的核心警告。',
        related_entities: ['博士', '普瑞赛斯', '凯尔希', '弗里斯顿', '缪尔赛思', '推进之王', 'Ama-10', '预言家'],
        related_series: ['PV4', '巴别塔', '慈悲灯塔', '离解复合'],
      },
    },
    units: [
      {
        heading: '博士的磁带录音 · 保管者',
        text: `【官方ARG解密原文 — 博士磁带录音1：保管者】

TT 3月9日 209年 16:29

我和他做了最后一次辩论。就在保存者计划正式启动的前一天。

他说服不了我。我也说服不了他。

"我会留在这里。"他说。"等到所有人都离开以后。我是泰拉上的最后一个蠢人。"

他还说："如果有一天你改变主意了——你知道在哪里能找到我。"

弗里斯顿……再见。谢谢你。

—— 博士（CV: 冯骏骅）`,
        metadata: {
          summary: '博士的磁带录音1：回忆与弗里斯顿的最后辩论——保存者计划启动前夕，弗里斯顿选择作为"泰拉上最后一个蠢人"留守。',
          summary_short: '博士与弗里斯顿的告别',
          key_terms: ['弗里斯顿', '保存者计划', '石棺', '博士', '前文明', 'PV4'],
          content_language: 'zh',
          perspective_note: '博士（预言家ORACLE）的直接录音。弗里斯顿即"保存者"——孤星活动中揭示为哥伦比亚地下保存前文明遗存的存在。这卷磁带说明博士与弗里斯顿在保存者计划启动前就有密切联系。',
        },
      },
      {
        heading: '博士的磁带录音 · 培育者',
        text: `【官方ARG解密原文 — 博士磁带录音2：培育者】

TT 12月23日 228年 02:16

陆：

深蓝之树的那群"大朋友们"的组织样本，环境适应性分析已经做完了。

结果非常好——它们能从毁灭中幸存。

也许比我们所有人都活得更久。

—— 博士（CV: 冯骏骅）`,
        metadata: {
          summary: '博士的磁带录音2：致"陆"，报告深蓝之树相关生物的组织样本环境适应性分析结果——它们能从毁灭中幸存。',
          summary_short: '深蓝之树生物能幸存于毁灭',
          key_terms: ['深蓝之树', '水月', '海嗣', '环境适应性', '培育者', '前文明', '博士', 'PV4'],
          content_language: 'zh',
          perspective_note: '深蓝之树是前文明的四大计划之一（与保存者计划、天堂支点、源石计划并列），与水月/海嗣/阿戈尔线有紧密关联。收件人"陆"的身份未知。',
        },
      },
      {
        heading: '博士的磁带录音 · 安保',
        text: `【官方ARG解密原文 — 博士磁带录音3：安保】

TT 1月16日 229年 09:46

艾德：

我们算过了。人造天体最后会变成轨道上的墓碑。

天堂支点是很强大的武器——但它打不倒真正的敌人。

敌人不在外面。敌人在这里。

—— 博士（CV: 冯骏骅）`,
        metadata: {
          summary: '博士的磁带录音3：致"艾德"——天堂支点作为武器无法打倒真正的敌人，因为敌人不来自外部。',
          summary_short: '天堂支点打不倒真正的敌人',
          key_terms: ['天堂支点', '人造天体', '轨道', '敌人', '前文明', '博士', 'PV4'],
          content_language: 'zh',
          perspective_note: '天堂支点是前文明四大计划之一的武器系统。"敌人不在外面，在这里"——暗示前文明面临的真正威胁来自内部，可能与源石或某种认知层面上的威胁有关。',
        },
      },
      {
        heading: '博士的磁带录音 · 伐木工寓言',
        text: `【官方ARG解密原文 — 博士磁带录音4：伐木工】

有一片树林。伐木工来了又走，一棵树倒下，又一棵树倒下。

有一棵树倒下时，树脂从断口涌出来，粘住了旁边的断枝。

树继续倒下。树脂继续涌出。

最后——

一切都停下了。透明的树脂吞没了整片树林。

没有声音。没有风。没有时间。

只有一枚琥珀。

（机器女声报出4位数字，经GBC解码得隐藏信息）`,
        metadata: {
          summary: '博士的磁带录音4：一片关于伐木工与树脂的寓言——树木不断被砍伐，最终一切被透明树脂吞没，成为一枚凝固的琥珀。隐藏信息经GBC解码为"警惕你自己，源石目标已经改变，相信Ama-10"。',
          summary_short: '伐木工与琥珀',
          key_terms: ['伐木工', '琥珀', '寓言', '源石', 'Ama-10', '前文明', '博士', 'PV4'],
          content_language: 'zh',
          perspective_note: '这则寓言可能是对源石计划本身的隐喻——"伐木工"是毁灭文明的力量，"树脂"是源石，"琥珀"是文明的最终形态（被源石封存）。隐藏信息中的Ama-10即凯尔希。',
        },
      },
      {
        heading: '隐藏信息：相信Ama-10',
        text: `【官方ARG解密原文 — 磁带中隐藏的GBC编码信息】

"警惕你自己。
源石目标已经改变。
相信Ama-10。"

—— 来自博士磁带录音中隐藏的4位数字序列，经国标区位码（GBC）解码`,
        metadata: {
          summary: '磁带中隐藏的警告信息——警惕自己、源石目标已改变、相信Ama-10（凯尔希）。',
          summary_short: '源石目标已改变，相信Ama-10',
          key_terms: ['源石', 'Ama-10', '凯尔希', '警惕', '前文明', '博士', 'GBC', 'PV4'],
          content_language: 'zh',
          perspective_note: '"源石目标已经改变"是对源石计划初衷的颠覆性揭示——源石可能不再按照最初设计运行。Ama-10是凯尔希的前文明编号，"相信Ama-10"说明博士（预言家）在关键决策上将信任交付给了凯尔希。',
        },
      },
      {
        heading: '销钉技术文档',
        text: `【官方ARG解密原文 — "销钉"技术说明文档】

术语: 销钉（Lynchpin）/ 灰质销钉

一种非侵入式思想植入技术。

用于增强领航员的亚空间感知和记忆容量。

—— 前文明技术文档（片段）`,
        metadata: {
          summary: '前文明技术文档中的"销钉"定义——一种非侵入式思想植入技术，增强领航员的亚空间感知和记忆容量。',
          summary_short: '非侵入式思想植入技术',
          key_terms: ['销钉', 'Lynchpin', '思想植入', '领航员', '亚空间感知', '前文明', 'PV4'],
          content_language: 'zh',
          perspective_note: '"销钉"技术可能与博士的失忆和恢复有关——"非侵入式思想植入"暗示博士的记忆是被某种外部技术修改或压制的。',
        },
      },
      {
        heading: '普瑞赛斯的心理测试（代表性题目）',
        text: `【官方ARG解密原文 — 普瑞赛斯心理测试（bymyside页面）】

引导对话由普瑞赛斯口吻进行，核心提问包括：

"一个个体生命和整个文明，哪一个更重要？"

"如果一个文明注定会毁灭，你还会为它的存续而努力吗？"

"你愿意为了文明的存续牺牲什么？"

"我们和其他文明，是否应该以同样的标准衡量？"

"你相信希望吗？"

测试包含13个问题，仅能以"同意"或"不同意"回答。其中7个与文明有关的问题的结果将被归档并同步——影响游戏内特定剧情节点（如15-17）。

—— 测试界面话语："请相信，你所做的一切选择都是有意义的。"`,
        metadata: {
          summary: '普瑞赛斯（前文明时期博士的同事）设置的心理测试——13个问题涉及个体生命价值、文明存续、希望等主题，7个与文明有关的问题结果影响游戏剧情。',
          summary_short: '普瑞赛斯的文明价值测试',
          key_terms: ['普瑞赛斯', '心理测试', '文明存续', '希望', '选择', '博士', 'PV4', 'bymyside'],
          content_language: 'zh',
          perspective_note: '普瑞赛斯以引导者身份出现——整个测试的语调温和但带有深层的不安。暗示普瑞赛斯（或其残余意识）仍在观察和测试博士的选择。',
        },
      },
    ],
    entities: [
      { name: '普瑞赛斯', entity_type: 'character', summary: '前文明时期博士的同事，与博士关系密切。在巴别塔回忆和PV4 ARG中均有出现。可能以某种形式在当代泰拉存在。"普瑞赛斯的阴影始终笼罩"是主线后期的重要主题。' },
      { name: '弗里斯顿', entity_type: 'character', summary: '前文明"保存者计划"的执行者，在孤星活动中被揭示为哥伦比亚地下保存前文明遗存的存在。曾在保存者计划启动前与博士（预言家ORACLE）进行最后一次辩论。自称"泰拉上的最后一个蠢人"。' },
      { name: '预言家', entity_type: 'character', summary: '博士在前文明时期的代号——ORACLE，也是博士失忆前的真实身份。参与了前文明的四大计划（源石计划、保存者计划、深蓝之树、天堂支点）的决策和执行。' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  // 6. 真·断罪者的挑战状 (2020四月辑录)
  // ────────────────────────────────────────────────────────────────
  {
    external_key: 'oracle-aprilfool-conviction',
    title: '真·断罪者的挑战状',
    subtitle: '「四月辑录2020」隐藏ARG — 断罪者的谜题挑战',
    source_name: 'PRTS wiki - ORACLE DATABASE / 明日方舟愚人节活动 (2020)',
    source_uri: 'https://prts.wiki/w/ORACLE_DATABASE/index/WHY_SO_MYSTERIOUS',
    source_tier: 1,
    content_type: 'arg_lore',
    canon_status: 'official',
    review_status: 'pending',
    metadata: {
      story_path: ['外部剧情资料', 'ORACLE_DATABASE', '真·断罪者的挑战状'],
      top_group: '外部剧情资料',
      group_name: 'ORACLE_DATABASE',
      top_group_code: 'EXTERNAL',
      arg_source: '四月辑录2020 (2020/04/01)',
      puzzle_method: 'QR码→官网特设页→企鹅物流运单追踪→Base64',
      imported_without_annotation: false,
      content_source: 'official_arg',
      import_source: 'prts_wiki_oracle_database',
      note: '解密过程: 2020年愚人节活动剧情QR码→官网特设页面→完成挑战→获得断罪者兑换码。理智为正时页面出现神秘符号→Base64解码→企鹅物流运单#520→隐藏书籍页。底部隐藏字符→Base64解码→英文留言："请不要介意，随意解谜。这谜题不难，只是为了好玩。请照顾好断罪者。"',
      topic_annotation: {
        topic_name: '真·断罪者的挑战状',
        summary: '2020年愚人节活动中隐藏的小型ARG——玩家完成断罪者的挑战后可通过解密获得隐藏留言："请不要介意，随意解谜。这谜题不难，只是为了好玩。请照顾好断罪者。"展示了鹰角通过ARG与玩家轻松互动的一面。',
        related_entities: ['断罪者'],
        related_series: ['四月辑录2020'],
      },
    },
    units: [
      {
        heading: '隐藏留言',
        text: `【官方ARG解密原文 — 真·断罪者的挑战状隐藏留言】

"请不要介意，随意解谜。
这谜题不难，只是为了好玩。
请照顾好断罪者。"

—— 来自企鹅物流运单追踪#025页面的隐藏Base64编码`,
        metadata: {
          summary: '愚人节ARG的隐藏留言——"这谜题不难，只是为了好玩。请照顾好断罪者。"',
          summary_short: '请照顾好断罪者',
          key_terms: ['断罪者', '愚人节', 'ARG', '企鹅物流', '断罪'],
          content_language: 'zh',
          perspective_note: '这是明日方舟ARG中少有的轻松幽默内容——非严肃剧情线索，而是制作组通过谜题与玩家群体的一次互动游戏。',
        },
      },
    ],
    entities: [
      { name: '断罪者', entity_type: 'character', summary: '2020年愚人节活动中可通过解谜免费获取的特种干员。自称"正义的断罪者"，实际风格荒诞搞笑。在后续愚人节活动中也偶有客串。' },
    ],
  },

  // ────────────────────────────────────────────────────────────────
  // 7. 额外信号：Outbreak (2025)
  // ────────────────────────────────────────────────────────────────
  {
    external_key: 'oracle-outbreak-signal',
    title: '额外信号：Outbreak',
    subtitle: '「罗德岛新本部修建工程日志」隐藏信号 — 系统崩溃日志',
    source_name: 'PRTS wiki - ORACLE DATABASE / 明日方舟官方动态 (2025)',
    source_uri: 'https://prts.wiki/w/ORACLE_DATABASE/index/outbreak',
    source_tier: 1,
    content_type: 'arg_lore',
    canon_status: 'official',
    review_status: 'pending',
    metadata: {
      story_path: ['外部剧情资料', 'ORACLE_DATABASE', '额外信号Outbreak'],
      top_group: '外部剧情资料',
      group_name: 'ORACLE_DATABASE',
      top_group_code: 'EXTERNAL',
      arg_source: '罗德岛新本部修建工程日志 (2025/04/18)',
      puzzle_method: '纸模折纸→QR码→官网隐藏页面→系统日志',
      imported_without_annotation: false,
      content_source: 'official_arg',
      import_source: 'prts_wiki_oracle_database',
      note: '解密过程: 2025年4月18日官方发布《罗德岛新本部修建工程日志》动态→第六张图的源石折纸模板拼合→QR码→扫描→官网/pcs页面→显示一段异常的系统崩溃日志，标题为"OUTBREAK"，背景含有音频。日志中出现了多个经典的计算机错误标记（0xDEADBEEF, 0xFEEDFACE, buffer overflow等）。',
      topic_annotation: {
        topic_name: '额外信号：Outbreak',
        summary: '第十五章"离解复合"后发布的ARG——通过折纸QR码导向一段以"OUTBREAK"为标题的系统崩溃日志。日志中的二进制序列和错误代码暗示PRTS或前文明系统出现了某种"爆发"式异常，可能与源石或内在威胁有关。',
        related_entities: ['PRTS', '罗德岛'],
        related_series: ['离解复合'],
      },
    },
    units: [
      {
        heading: '系统崩溃日志',
        text: `【官方ARG原文 — Outbreak系统日志】

ATTACHMENT > Primitive C Service

[00:00.000] ❯ Danger.
[00:02.100] ❯ b'\\xde\\xad\\xbe\\xef' FATAL EXCEPTION
[00:03.800] ❯ 0xFEEDFACE: Illegal instruction encountered during execution.
[00:05.300] ❯ kernel: [ERROR] Buffer overflow detected at 0x7fff5fbff000
[00:11.500] ❯ *** Error in './d.out': free(): invalid pointer: 0x0000000000401020 ***
[00:15.500] ❯ 10001001 11100011 10010110 01100100 10010101 00000001 01011011 10011010
[00:26.000] ❯ OUTBREAK.

（背景音频："额外信号：Outbreak"）`,
        metadata: {
          summary: '通过罗德岛新本部修建工程日志动态中隐藏的折纸QR码发现的系统崩溃日志——标题为OUTBREAK，包含经典计算机错误标记和二进制序列。',
          summary_short: 'PRTS系统崩溃Outbreak日志',
          key_terms: ['Outbreak', 'PRTS', '系统崩溃', '0xDEADBEEF', '罗德岛本部', '折纸', 'QR码', '离解复合'],
          content_language: 'en',
          perspective_note: '日志中的0xDEADBEEF、0xFEEDFACE等错误代码是经典的程序调试标记，出现在"官方"系统日志中暗示这是一段被故意构造的异常记录——可能是PRTS内部某种"爆发"的预警信号。二进制序列的含义暂未完全解读。',
        },
      },
    ],
    entities: [],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 导入执行
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   ORACLE DATABASE 资料入库             ║');
  console.log('║   来源: PRTS wiki 外部剧情资料分类     ║');
  console.log('║   数据库: arknights_lore_new (public)  ║');
  console.log('╚══════════════════════════════════════════╝\n');

  let docsCreated = 0;
  let docsUpdated = 0;
  let unitsInserted = 0;
  let entitiesCreated = 0;
  let entitiesUpdated = 0;

  for (const docDef of DOCUMENTS) {
    console.log(`\n── ${docDef.title} ──`);

    // ── 1. 创建或更新 documents 记录 ──
    const existing = await pool.query(
      `SELECT document_id FROM documents WHERE external_key = $1`,
      [docDef.external_key],
    );

    let docId;
    if (existing.rows.length > 0) {
      docId = existing.rows[0].document_id;
      await pool.query(
        `UPDATE documents
         SET title = $1, subtitle = $2, source_name = $3, source_uri = $4,
             source_tier = $5, content_type = $6, canon_status = $7,
             metadata = $8, review_status = $9, updated_at = NOW()
         WHERE document_id = $10`,
        [
          docDef.title, docDef.subtitle, docDef.source_name, docDef.source_uri,
          docDef.source_tier, docDef.content_type, docDef.canon_status,
          JSON.stringify(docDef.metadata), docDef.review_status, docId,
        ],
      );
      // 清除旧 text_units
      await pool.query(`DELETE FROM text_units WHERE document_id = $1`, [docId]);
      docsUpdated++;
      console.log(`  ✓ 更新 document #${docId}，清除旧 text_units`);
    } else {
      const result = await pool.query(
        `INSERT INTO documents (external_key, title, subtitle, source_name, source_uri,
          source_tier, content_type, canon_status, metadata, review_status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) RETURNING document_id`,
        [
          docDef.external_key, docDef.title, docDef.subtitle, docDef.source_name,
          docDef.source_uri, docDef.source_tier, docDef.content_type, docDef.canon_status,
          JSON.stringify(docDef.metadata), docDef.review_status,
        ],
      );
      docId = result.rows[0].document_id;
      docsCreated++;
      console.log(`  ✓ 创建 document #${docId}`);
    }

    // ── 2. 创建 text_units ──
    for (let i = 0; i < docDef.units.length; i++) {
      const unit = docDef.units[i];
      await pool.query(
        `INSERT INTO text_units (document_id, unit_index, unit_kind, heading, text,
          source_tier, content_type, metadata, review_status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
        [
          docId,
          i,
          'chunk',
          unit.heading,
          unit.text,
          docDef.source_tier,
          docDef.content_type,
          JSON.stringify(unit.metadata),
          docDef.review_status,
        ],
      );
      unitsInserted++;
    }
    console.log(`  ✓ 插入 ${docDef.units.length} 个 text_units`);

    // ── 3. 创建/更新 entities ──
    for (const ent of docDef.entities) {
      try {
        const existingEnt = await pool.query(
          `SELECT entity_id, properties FROM entities WHERE name = $1 AND entity_type = $2`,
          [ent.name, ent.entity_type],
        );
        if (existingEnt.rows.length > 0) {
          const eid = existingEnt.rows[0].entity_id;
          const props = typeof existingEnt.rows[0].properties === 'string'
            ? JSON.parse(existingEnt.rows[0].properties)
            : (existingEnt.rows[0].properties || {});
          props.oracle_database = props.oracle_database || {};
          props.oracle_database.arg_source = true;
          props.oracle_database.import_time = new Date().toISOString();
          if (ent.summary) props.oracle_database.summary = ent.summary;

          await pool.query(
            `UPDATE entities SET properties = $1, summary = COALESCE(NULLIF(summary, ''), $2), updated_at = NOW() WHERE entity_id = $3`,
            [JSON.stringify(props), ent.summary, eid],
          );
          entitiesUpdated++;
        } else {
          await pool.query(
            `INSERT INTO entities (entity_type, name, summary, properties, review_status)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              ent.entity_type, ent.name, ent.summary,
              JSON.stringify({
                oracle_database: { arg_source: true, import_time: new Date().toISOString() },
                source: 'prts_wiki_oracle_database',
              }),
              'seeded',
            ],
          );
          entitiesCreated++;
        }
      } catch (err) {
        console.error(`  ⚠ 处理实体 "${ent.name}" 时出错: ${err.message}`);
      }
    }
    if (docDef.entities.length > 0) {
      console.log(`  ✓ 实体: ${entitiesCreated} 新建, ${entitiesUpdated} 更新`);
    }
  }

  // ── 刷新物化视图 ──
  try {
    await pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY document_stats`);
    console.log('\n  ✓ 已刷新 document_stats 物化视图');
  } catch (err) {
    console.log(`\n  ⚠ 刷新物化视图跳过: ${err.message}`);
  }

  // ── 总结 ──
  console.log('\n' + '═'.repeat(60));
  console.log('入库完成');
  console.log('═'.repeat(60));
  console.log(`Document:   ${docsCreated} 新建, ${docsUpdated} 更新`);
  console.log(`Text Units: ${unitsInserted} 条`);
  console.log(`Entities:   ${entitiesCreated} 新建, ${entitiesUpdated} 更新`);
  console.log(`Database:   arknights_lore_new (public)`);
  console.log(`Source:     PRTS wiki / ORACLE DATABASE`);
  console.log(`Tier:       1`);
  console.log('═'.repeat(60));

  await pool.end();
}

main().catch(err => {
  console.error('导入失败:', err);
  pool.end();
  process.exit(1);
});
