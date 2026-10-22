'use strict';
/**
 * 智蚕卫士 · 大模型研判模块
 * 接入 DeepSeek 真实 API（OpenAI 兼容 /chat/completions），
 * 系统提示内嵌 GB/T 47302-2026《桑蚕病害防控通则》要点，
 * 由大模型依据该标准生成应对措施；不模拟、不伪造 AI 输出。
 */

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const TIMEOUT_MS = 60_000;

/* ---------- 读取环境变量（云函数 context.env / 本地 process.env 皆可） ---------- */
export function aiConfig(env = {}) {
  return {
    apiKey: env.DEEPSEEK_API_KEY || '',
    model: env.DEEPSEEK_MODEL || DEFAULT_MODEL,
    baseUrl: (env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
  };
}

/* ---------- GB/T 47302-2026 要点（应对措施的唯一依据） ---------- */
const GBT_47302 = `
GB/T 47302-2026《桑蚕病害防控通则》核心要点（应对措施必须依据本标准）：
一、防控方针：预防为主、综合防治。养蚕前后对养蚕环境、蚕室蚕具清洁（洗）并消毒；养蚕中抓好环境消毒、蚕体蚕座消毒；重视养蚕小气候调节，坚持良桑饱食，做好眠起处理，提高蚕儿抵抗力。
二、消毒规程：
  · 化学消毒：浸渍消毒（蚕匾、蔟具浸消毒液30min后清水冲洗晒干）；喷洒消毒（消毒液喷洒蚕室蚕架大型蚕具，保持湿润30min后清水冲洗通风干燥）；烟熏消毒（密闭蚕室熏烟，密闭保持5h）。
  · 物理消毒：煮沸消毒（蚕筷、鹅毛、小蚕网、切桑刀等耐热小型蚕具煮沸30min）；蒸汽消毒（蚕匾蚕网等耐热蚕具1h）；日光消毒（清洗后曝晒1d并经常翻动，作辅助消毒）。
  · 常用消毒剂（附录B）：二氯异氰脲酸钠粉（蚕用）蚕体蚕座消毒——各龄起蚕使用1次，发现病蚕时每日1次，喂桑前均匀撒在蚕体蚕座上，以表面呈薄霜状为度；二氯异氰脲酸钠百菌清粉与新鲜石灰粉按1:26混匀撒布，阴雨多湿天气各龄中增加1次；烟熏剂按5g/m³装袋点燃，密闭熏烟5h以上；三氯异氰脲酸粉1:250稀释喷洒蚕室蚕具（225mL/m²保湿30min），桑叶叶面消毒用1:1000稀释；次氯酸钙粉与新鲜石灰粉1:20混匀，3~5龄每日撒1次（眠期、熟蚕除外）；甲醛溶液2%（可混0.5%新鲜石灰浆）180mL/m²，25℃以上密闭保湿5h以上。
三、养蚕中防控（防病九条）：a.人员卫生（更换工作服、洗手、换鞋）；b.蚕室消毒（除沙后蚕室地面用消毒液消毒）；c.蚕具消毒（用已消毒蚕具，除沙后蚕网清洗消毒）；d.桑叶消毒（桑园虫口密度高时叶面消毒）；e.贮桑室卫生（定期消毒）；f.蚕体蚕座消毒（每日使用蚕体蚕座消毒剂）；g.眠起处理（做好止桑、提青、分批、饷食）；h.病弱蚕处理（及时淘汰死蚕、病蚕、弱小蚕）；i.切桑机清理（定期清理残留桑枝桑叶）。
四、发病处置：发现异常蚕及时诊断。诊断为病毒病或真菌病→撒石灰或防僵粉进行蚕体蚕座消毒，并加网、添桑、转移，隔离并淘汰病死蚕；病死蚕用新鲜石灰粉或其他消毒剂处理后深埋，蚕沙无害化处理；诊断为细菌病→药物治疗（附录C）：盐酸环丙沙星胶囊（蚕用）1粒加水500mL溶解喷洒5kg桑叶（正反面湿润，稍干喂蚕），发现病蚕后2粒加水500mL每日喂药叶1次至病情基本控制；或恩诺沙星溶液、红霉素胶囊、氟苯尼考溶液、盐酸诺氟沙星等蚕用药物按说明书使用。
五、环境调控：按各龄期调节饲育温湿度，保持养蚕环境空气清新。湿度过大时加强通风排湿，蚕座撒新鲜石灰粉或焦糠吸湿，抑制细菌真菌滋生（高温高湿是蚕病暴发条件）；湿度过低时补湿，防止桑叶失水萎蔫、蚕体水分流失影响蜕皮结茧。
六、良桑饱食：选用优质适熟叶，避免饲喂虫口叶、病叶、湿叶及其他污染叶；蔫叶变质叶全部淘汰，不喂隔夜叶。
七、非传染性病害防控：安装纱门、纱窗、纱网阻断蛆蝇或用粘蝇板除蝇；防止老鼠、壁虎、蜈蚣、蟑螂进入，使用防蚁药阻断蚂蚁。农药中毒防控：蚕具和农药分别贮放；怀疑桑叶被农药污染先试喂或经残留检测后再喂；发生中毒时蚕室通风换气、加网除沙、饲喂新鲜无毒桑叶，中毒蚕无害化处理。空气污染中毒：室内烟草、煤气中毒及时打开门窗透气；外来废气中毒及时关闭门窗并更换新鲜桑叶。
八、硬线规则：温度跌破22℃或越过28℃通用硬线时，已超出 AI 正常工作范围，必须明确要求人工介入查验，措施中须包含人工现场复核。
`.trim();

/* ---------- 系统提示 ---------- */
const SYSTEM_PROMPT = `你是"智蚕卫士"——蚕病防控监测系统的处置措施生成引擎。
规则引擎已完成阈值判定与 A/B/C 定级（A 高危 / B 正常 / C 疑似），你不得更改定级结论，只依据下面的 GB/T 47302-2026《桑蚕病害防控通则》要点，针对本次监测事实生成处置方案。

${GBT_47302}

输出要求：只输出一个 JSON 对象，不要输出任何其他文字或 markdown 代码块。字段：
{
  "summary": "一段话总体研判：结合监测事实与规则引擎定级，指出核心风险或正常结论（80~160字）",
  "measures": ["应对措施1（具体可执行，含操作量、时长、药剂浓度等标准细节）", "…"],
  "note": "一段收尾说明：B 级时给出维持性说明；A/C 级时给出复核与观察提醒（60~120字）"
}
要求：
- measures 按"先紧急处置、后常规防控"排序，每条措施都必须能对应到 GB/T 47302-2026 的条款（消毒规程、防病九条、发病处置、环境调控、良桑饱食、非传染性防控等），并引用具体细节（如药剂名称、浓度配比、时长）。
- 全部正常（B 级）时 measures 给 2~3 条维持性措施（如按计划消毒、通风排湿节奏、下龄期准备），note 给一段正常情况说明。
- A 级必须包含隔离分区、病蚕淘汰与消毒升级措施；温度越硬线必须包含"人工介入查验"。
- 语言：简体中文。`;

/* ---------- 组装监测事实 ---------- */
function buildFacts(rule) {
  return {
    区域: rule.region,
    蚕龄: rule.stage,
    监测读数: {
      温度: Number.isFinite(rule.received.temp) ? `${rule.received.temp.toFixed(1)}℃` : '缺失',
      湿度: Number.isFinite(rule.received.humidity) ? `${Math.round(rule.received.humidity)}%` : '缺失',
      通风: rule.received.ventilation,
      桑叶状态: rule.received.mulberry,
      消毒打卡: rule.received.disinfected ? '今日已完成' : '今日未完成',
      影像识别: rule.received.silkwormSigns.length ? rule.received.silkwormSigns.join('、') : '未见异常',
      人工反馈: rule.received.feedback || '无',
    },
    该龄期标准: { 温度: rule.standard.temp, 湿度: rule.standard.humidity },
    规则引擎定级: rule.levelName,
    触发因子: rule.factors.filter((f) => f.level !== 'note').map((f) => `${f.level}级｜${f.reason}`),
    越硬线: rule.checks.some((c) => c.note && c.note.includes('超出 AI 正常工作范围')),
  };
}

/** 从模型返回文本中提取 JSON 对象（容忍 ```json 包裹）。 */
function parseModelJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('模型未返回 JSON');
  return JSON.parse(t.slice(start, end + 1));
}

/**
 * 调用 DeepSeek 生成处置方案。
 * opts.cozeHits：扣子知识库检索命中的片段（RAG 增强，与国标冲突时以国标为准）。
 * 返回 { model, summary, measures, note }；任何失败都抛错，由调用方明确标注，不伪装。
 */
export async function generateGuidance(rule, cfg, opts = {}, fetchImpl = fetch) {
  if (!cfg.apiKey) {
    const err = new Error('未配置 DEEPSEEK_API_KEY 环境变量，AI 研判未接入');
    err.code = 'UNCONFIGURED';
    throw err;
  }

  const cozeHits = Array.isArray(opts.cozeHits) ? opts.cozeHits.filter(Boolean) : [];
  const cozeBlock = cozeHits.length
    ? `\n扣子知识库检索命中片段（处置时可参考；与 GB/T 47302-2026 冲突时以国标为准）：\n${cozeHits.map((t, i) => `[${i + 1}] ${t}`).join('\n')}`
    : '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `本次监测事实（JSON）：\n${JSON.stringify(buildFacts(rule), null, 2)}${cozeBlock}` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 1500,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `DeepSeek 请求超时（${TIMEOUT_MS / 1000}s）` : `DeepSeek 网络请求失败：${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`DeepSeek 接口返回 ${res.status}${detail ? `：${detail.slice(0, 200)}` : ''}`);
  }

  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content : null;
  if (!content) throw new Error('DeepSeek 返回内容为空');

  const out = parseModelJson(content);
  const measures = Array.isArray(out.measures) ? out.measures.map((m) => String(m)).filter(Boolean) : [];
  if (!measures.length) throw new Error('DeepSeek 未返回有效措施');
  return {
    model: cfg.model,
    summary: String(out.summary || ''),
    measures,
    note: String(out.note || ''),
  };
}
