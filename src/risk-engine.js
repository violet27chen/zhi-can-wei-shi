'use strict';
/**
 * 智蚕卫士 · 风险研判引擎
 * 纯函数核心：输入一次监测数据，输出四段式结构化研判结果。
 *
 * 判定标准（各龄期核心阈值）：
 *   孵化~2龄  温度 26–28℃   湿度 85%–90%
 *   3龄       温度 28℃ 左右  湿度 80% 左右（判定容差 ±1℃ / ±5%）
 *   4龄       温度 24–26℃   湿度 70%–75%
 *   5龄       温度 22–24℃   湿度 70%–75%
 *   上簇期/蛹期 沿用 22–28℃ / 70%–75%（簇中与蛹体保护）
 *
 * 异常判定：
 *   温度过高 → 风险：桑蚕食欲减退、生长缓慢
 *   温度过低 → 风险：延长蚕龄、影响上蔟率
 *   湿度过大 → 高危：极易滋生细菌真菌，诱发蚕病
 *   湿度过小 → 风险：桑叶失水过快变蔫、蚕体水分流失、影响蜕皮和结茧
 * 另：温度跌破 22℃ 或越过 28℃ 通用硬线时，明确指出超出 AI 正常工作范围，要求人工介入查验。
 */

/* 各龄期标准：temp/humidity 的 [下限, 上限]；loose 为"左右"型容差龄期 */
const STAGE_STANDARDS = {
  '孵化': { temp: [26, 28], humidity: [85, 90], tempNote: '26–28℃', humidityNote: '85%–90%' },
  '1龄': { temp: [26, 28], humidity: [85, 90], tempNote: '26–28℃', humidityNote: '85%–90%' },
  '2龄': { temp: [26, 28], humidity: [85, 90], tempNote: '26–28℃', humidityNote: '85%–90%' },
  '3龄': { temp: [27, 29], humidity: [75, 85], tempNote: '28℃ 左右', humidityNote: '80% 左右', loose: true },
  '4龄': { temp: [24, 26], humidity: [70, 75], tempNote: '24–26℃', humidityNote: '70%–75%' },
  '5龄': { temp: [22, 24], humidity: [70, 75], tempNote: '22–24℃', humidityNote: '70%–75%' },
  '上簇期': { temp: [22, 28], humidity: [70, 75], tempNote: '22–28℃', humidityNote: '70%–75%' },
  '蛹期': { temp: [22, 28], humidity: [70, 75], tempNote: '22–28℃', humidityNote: '70%–75%' },
};

const STAGES = Object.keys(STAGE_STANDARDS);
const VENTILATION_LEVELS = ['良好', '一般', '不良'];
const MULBERRY_LEVELS = ['正常', '轻微萎蔫', '严重萎蔫'];
const SILKWORM_SIGNS = ['正常', '黄斑茧', '双宫茧', '蛹多', '薄皮茧', '软化病迹象', '僵病迹象'];

/* 通用硬线：无论何龄期，越线即超出 AI 正常工作范围 */
const TEMP_HARD_MIN = 22;
const TEMP_HARD_MAX = 28;

const REGION_WEIGHT = {
  tempHigh: 1.0,
  tempLow: 1.0,
  humidityHigh: 1.5,   // 高危因子
  humidityLow: 0.5,
  ventilationPoor: 0.5,
  disinfectMissing: 1.0,
  mulberrySevere: 1.0,
  mulberryMild: 0.5,
  cocoonSign: 0.5,
};

function clampNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 单次研判入口。payload 见表单字段；返回四段式结构。 */
function assess(input) {
  const region = String(input.region || '').trim() || '未命名区域';
  const stage = STAGES.includes(input.stage) ? input.stage : '4龄';
  const std = STAGE_STANDARDS[stage];
  const temp = clampNum(input.temp, NaN);
  const humidity = clampNum(input.humidity, NaN);
  const ventilation = VENTILATION_LEVELS.includes(input.ventilation) ? input.ventilation : '一般';
  const mulberry = MULBERRY_LEVELS.includes(input.mulberry) ? input.mulberry : '正常';
  const signs = Array.isArray(input.silkwormSigns)
    ? input.silkwormSigns.filter((s) => SILKWORM_SIGNS.includes(s) && s !== '正常')
    : [];
  const disinfected = Boolean(input.disinfected);
  const feedback = String(input.feedback || '').trim();

  const [tMin, tMax] = std.temp;
  const [hMin, hMax] = std.humidity;

  // ---------- 第一段：数据接收与状态评估 ----------
  const tempStatus = !Number.isFinite(temp) ? 'missing'
    : temp < tMin ? 'low-out' : temp > tMax ? 'high-out' : 'ok';
  const hardOut = Number.isFinite(temp) && (temp < TEMP_HARD_MIN || temp > TEMP_HARD_MAX);
  const tempNote = !Number.isFinite(temp) ? '温度数据缺失，按异常处理'
    : temp < tMin ? `低于该龄期下限 ${tMin}℃${hardOut ? `，且已跌破 ${TEMP_HARD_MIN}℃ 通用硬线，超出 AI 正常工作范围，要求人工介入查验` : ''}`
    : temp > tMax ? `高于该龄期上限 ${tMax}℃${hardOut ? `，且已越过 ${TEMP_HARD_MAX}℃ 通用硬线，超出 AI 正常工作范围，要求人工介入查验` : ''}`
    : '在该龄期标准区间内';
  const checks = [];
  checks.push({
    name: '温度', value: Number.isFinite(temp) ? `${temp.toFixed(1)}℃` : '未提供',
    standard: std.tempNote, status: tempStatus, note: tempNote,
  });
  const humStatus = !Number.isFinite(humidity) ? 'missing'
    : humidity > hMax ? 'danger'
    : humidity < hMin ? 'warn-low' : 'ok';
  checks.push({
    name: '湿度', value: Number.isFinite(humidity) ? `${Math.round(humidity)}%` : '未提供',
    standard: std.humidityNote, status: humStatus,
    note: !Number.isFinite(humidity) ? '湿度数据缺失，按异常处理'
      : humidity > hMax ? `高于该龄期上限 ${hMax}%：蚕座潮湿，极易滋生细菌真菌、诱发蚕病${stage === '3龄' ? '（3 龄按 80% 左右掌握）' : ''}`
      : humidity < hMin ? `低于该龄期下限 ${hMin}%：桑叶失水过快易变蔫，蚕体水分流失，影响蜕皮和结茧`
      : '在该龄期标准区间内',
  });
  checks.push({
    name: '通风', value: ventilation, standard: '良好', status: ventilation === '不良' ? 'warn' : 'ok',
    note: ventilation === '不良' ? '蚕座闷热，二氧化碳与病原浓度易积累' : '满足蚕座换气需求',
  });
  checks.push({
    name: '桑叶状态', value: mulberry, standard: '正常', status: mulberry === '正常' ? 'ok' : 'warn',
    note: mulberry === '严重萎蔫' ? '叶片失水变质，蚕体食下量与体质同步下降'
      : mulberry === '轻微萎蔫' ? '保鲜不足，注意采叶、运输与贮存环节' : '新鲜度合格',
  });
  checks.push({
    name: '消毒打卡', value: disinfected ? '今日已完成' : '今日未完成', standard: '每日 1 次',
    status: disinfected ? 'ok' : 'warn',
    note: disinfected ? '蚕座消毒流程闭合' : '消毒流程断档，病原交叉传播风险上升',
  });
  checks.push({
    name: '影像识别 · 蚕体/茧质', value: signs.length ? signs.join('、') : '未见异常', standard: '无病害迹象',
    status: signs.some((s) => s === '软化病迹象' || s === '僵病迹象') ? 'danger'
      : signs.length ? 'warn' : 'ok',
    note: signs.some((s) => s === '软化病迹象') ? '软化病为传染性病害的直接证据，须立即隔离'
      : signs.some((s) => s === '僵病迹象') ? '僵病孢子随气流扩散，为高度传染性信号'
      : signs.length ? '茧质异常提示上簇环境或体质问题' : '影像判读无异常',
  });

  // ---------- 第二段：风险定级与分区 ----------
  const factors = [];
  let weight = 0;
  const addFactor = (key, level, reason) => {
    factors.push({ key, level, reason });
    weight += REGION_WEIGHT[key] || 0.5;
  };

  const tempHigh = Number.isFinite(temp) && temp > tMax;
  const tempLow = Number.isFinite(temp) && temp < tMin;
  const humidityHigh = Number.isFinite(humidity) && humidity > hMax;
  const humidityLow = Number.isFinite(humidity) && humidity < hMin;
  const dataMissing = !Number.isFinite(temp) || !Number.isFinite(humidity);

  if (signs.includes('软化病迹象')) {
    addFactor('softening', 'A', '影像检出软化病迹象：该病由病原微生物感染引发，蚕体软化、排稀粪，群体内传染速度快，须按高危处置。');
  }
  if (signs.includes('僵病迹象')) {
    addFactor('mould', 'A', '影像检出僵病迹象：白僵菌孢子借气流与蚕座接触传播，高温高湿下增殖极快，须按高危处置。');
  }
  if (humidityHigh) {
    addFactor('humidityHigh', 'A', `湿度 ${Math.round(humidity)}% 超出该龄期上限 ${hMax}%（标准 ${std.humidityNote}）：湿度过大极易滋生细菌真菌、诱发蚕病，与高温叠加时为暴发条件，判高危。`);
  }
  if (tempHigh) {
    addFactor('tempHigh', 'C', `温度 ${temp.toFixed(1)}℃ 高于该龄期上限 ${tMax}℃（标准 ${std.tempNote}）：桑蚕食欲减退、生长缓慢，发育不齐拉长蚕期。${hardOut ? '且已超出 AI 正常工作范围，要求人工介入查验。' : ''}`);
  }
  if (tempLow) {
    addFactor('tempLow', 'C', `温度 ${temp.toFixed(1)}℃ 低于该龄期下限 ${tMin}℃（标准 ${std.tempNote}）：延长蚕龄、影响上蔟率。${hardOut ? '且已超出 AI 正常工作范围，要求人工介入查验。' : ''}`);
  }
  if (humidityLow) {
    addFactor('humidityLow', 'C', `湿度 ${Math.round(humidity)}% 低于该龄期下限 ${hMin}%（标准 ${std.humidityNote}）：桑叶失水过快易萎蔫，蚕体水分流失，影响蜕皮和结茧。`);
  }
  if (ventilation === '不良') {
    addFactor('ventilationPoor', 'C', '通风不良：蚕座闷热积湿，病原浓度与二氧化碳同步积累，蚕体抵抗力下降。');
  }
  if (!disinfected) {
    addFactor('disinfectMissing', 'C', '今日消毒打卡未完成：蚕座、蚕具消毒不到位是蚕病传播的主因之一，流程断档即风险敞口。');
  }
  if (mulberry === '严重萎蔫') {
    addFactor('mulberrySevere', 'C', '桑叶严重萎蔫：营养与水分摄入骤降，蚕体体质削弱后更易感染病原。');
  } else if (mulberry === '轻微萎蔫') {
    addFactor('mulberryMild', 'C', '桑叶轻微萎蔫：食下率下降，属早期营养风险信号。');
  }
  const cocoonSigns = signs.filter((s) => ['黄斑茧', '双宫茧', '薄皮茧', '蛹多'].includes(s));
  if (cocoonSigns.length) {
    addFactor('cocoonSign', 'C', `影像检出${cocoonSigns.join('、')}：提示上簇密度、簇中环境或蚕体体质存在偏差，影响茧质与丝质等级。`);
  }
  if (dataMissing) {
    addFactor('dataMissing', 'C', `${!Number.isFinite(temp) ? '温度' : ''}${!Number.isFinite(temp) && !Number.isFinite(humidity) ? '与' : ''}${!Number.isFinite(humidity) ? '湿度' : ''}数据缺失：AI 判读可信度受限，按疑似处理，要求人工补测补录。`);
  }
  if (feedback) {
    factors.push({ key: 'feedback', level: 'note', reason: `人工反馈已并入研判：「${feedback}」` });
  }

  let level = 'B';
  const levelA = factors.some((f) => f.level === 'A');
  const levelC = factors.some((f) => f.level === 'C');
  if (levelA || weight >= 2.5) level = 'A';
  else if (levelC) level = 'C';

  const LEVEL_NAMES = { A: 'A级：高危', B: 'B级：正常', C: 'C级：疑似' };
  const levelReasons = [];
  if (level === 'B') {
    levelReasons.push(`各监测维度均处于 ${stage} 标准区间（温度 ${std.tempNote}、湿度 ${std.humidityNote}），消毒、通风、桑叶与影像判读均未触发风险因子。`);
  } else {
    if (levelA) levelReasons.push('已出现传染性病害直接证据或湿度超出龄期上限的高危条件，按蚕病发病原理构成暴发条件。');
    if (weight >= 2.5 && !levelA) levelReasons.push(`风险因子加权分达 ${weight.toFixed(1)}（阈值 2.5），多因子叠加按高危防控。`);
    if (level === 'C' && !levelA) levelReasons.push('存在单一异常因子，尚未构成病害暴发条件，按疑似预警复核。');
    if (hardOut) levelReasons.push(`温度已越过 ${TEMP_HARD_MIN}–${TEMP_HARD_MAX}℃ 通用硬线：超出 AI 正常工作范围，已同步要求人工介入查验。`);
  }

  // ---------- 第三段：智能预警与指令 ----------
  const alerts = [];
  const interventions = [];
  const orders = [];

  if (level === 'A') {
    alerts.push({ color: 'red', text: `【红色警报】${region}（${stage}）判定为高危：${factors.filter((f) => f.level === 'A').map((f) => f.reason.split('：')[0]).join('；')}。立即启动疫区处置流程。` });
  } else if (level === 'C') {
    alerts.push({ color: 'yellow', text: `【黄色预警】${region}（${stage}）判定为疑似：存在待复核异常因子，24 小时内完成人工复核。` });
  }

  if (tempHigh) {
    interventions.push(`温度调控：遮阳通风、启用降温设备，将 ${region} 温度在 2 小时内回落至 ${std.tempNote} 区间，防止食欲减退、生长缓慢进一步加重；避免冷风直吹蚕座。`);
  }
  if (tempLow) {
    interventions.push(`温度调控：加温补湿平衡，将 ${region} 温度回升至 ${std.tempNote} 区间，防止延长蚕龄、影响上蔟率；升温时防止局部过热与煤气渗入。`);
  }
  if (humidityHigh) {
    interventions.push(`湿度调控（高危）：立即开窗排湿并使用吸湿材料，蚕座撒新鲜石灰粉或焦糠，将湿度压回 ${std.humidityNote} 区间；抑制细菌真菌滋生，切断蚕病诱发条件，雨天防雨水入室。`);
  }
  if (humidityLow) {
    interventions.push(`湿度调控：地面洒水或喷雾补湿、喂饲新鲜湿叶，将湿度回升至 ${std.humidityNote} 区间，防止桑叶失水变蔫与蚕体水分流失，保障蜕皮和结茧。`);
  }
  if (ventilation === '不良') {
    interventions.push('通风干预：调整门窗与通风口开度形成对流，排除蚕座湿气与二氧化碳，忌冷风直袭蚕体。');
  }
  if (mulberry !== '正常') {
    interventions.push('用叶干预：改为早晚采叶、松装快运、贮叶于阴凉湿茧箱；蔫叶、变质叶全部淘汰，不喂隔夜叶。');
  }

  if (level === 'A') {
    orders.push(`隔离分区：立即将 ${region} 分为「好蚕区 / 疑病区」两区，病蚕、弱蚕连同其蚕座沙一并移出销毁，切断群体传染链。`);
    orders.push(`划定查找范围：以 ${region} 为中心，同室相邻蚕匾与共用工器具列入排查圈，防止病害随人员与器具流动扩散至其他蚕房。`);
    orders.push('升级消毒：对该区及通道执行每日 2 次消毒（含地面、蚕具、人员鞋底踏消池），连续 3 天；周边蚕房各补 1 次消毒打卡。');
    orders.push('人工介入复核：AI 影像判读结论须由技术员现场复核，复核结果回填本系统后再评估是否解除警报。');
  } else if (level === 'C') {
    orders.push(`缩小人工范围：仅对 ${region} 人工复核，其余 B 级区域维持影像轮巡，减少人力摊薄。`);
    orders.push(`24 小时复检：重点核查${tempHigh || tempLow ? '温度回升/回落后蚕体食桑与发育整齐度' : '蚕座状态'}，复检结论回填系统。`);
    if (!disinfected) orders.push('补办消毒打卡：当日完成蚕座、蚕具及周边通道消毒，并在本系统补记打卡时间。');
    orders.push(`查找范围预划：若复检确认异常，排查圈即刻扩大到与 ${region} 共用桑叶筐、蚕网的所有区域。`);
  } else {
    orders.push('维持例行防控：按计划影像轮巡与每日报数，无需额外人工介入。');
  }

  // 一切正常时给出一整段说明（第四段之外的显式交代）
  const routineNote = level === 'B'
    ? `${region}（${stage}）当前温度 ${Number.isFinite(temp) ? temp.toFixed(1) + '℃' : '缺'}、湿度 ${Number.isFinite(humidity) ? Math.round(humidity) + '%' : '缺'}，均处于该龄期标准区间（温度 ${std.tempNote}、湿度 ${std.humidityNote}）；消毒打卡闭合、通风与桑叶状态正常、影像判读未见病害迹象。蚕体食桑与发育环境稳定，无需干预，请继续保持当前环境调控节奏、按计划消毒与影像轮巡即可。`
    : null;

  // ---------- 第四段：知识库沉淀 ----------
  const factorName = {
    tempHigh: '高温', tempLow: '低温',
    humidityHigh: '高湿', humidityLow: '低湿',
    ventilationPoor: '通风不良', disinfectMissing: '消毒断档',
    mulberrySevere: '桑叶严重萎蔫', mulberryMild: '桑叶萎蔫',
    cocoonSign: '茧质异常', softening: '软化病迹象', mould: '僵病迹象', dataMissing: '数据缺失',
  };
  // 标签主因子：A 级因子优先于 C 级因子，各自再按病害 > 温湿度 > 消毒排序
  const priority = ['softening', 'mould', 'tempHigh', 'tempLow', 'humidityHigh', 'humidityLow', 'disinfectMissing'];
  const byPriority = (lv) => priority.map((k) => factors.find((f) => f.key === k && f.level === lv)).find(Boolean);
  const mainFactor = byPriority('A') || byPriority('C')
    || factors.find((f) => f.level === 'A' || f.level === 'C');
  const riskName = level === 'A' ? '高危' : '疑似';
  const label = mainFactor
    ? `${stage}${factorName[mainFactor.key] || '复合因子'}引发的${riskName}${level === 'A' && (signs.includes('软化病迹象') || signs.includes('僵病迹象')) ? '病害' : '风险'}预警`
    : `${stage}全维正常维持常态防控`;
  const knowledge = {
    label,
    summary: `${region}｜${stage}｜温度 ${Number.isFinite(temp) ? temp.toFixed(1) + '℃' : '缺'}（标准 ${std.tempNote}）、湿度 ${Number.isFinite(humidity) ? Math.round(humidity) + '%' : '缺'}（标准 ${std.humidityNote}）｜${LEVEL_NAMES[level]}｜${label}`,
  };

  return {
    region, stage, level, levelName: LEVEL_NAMES[level],
    standard: { temp: std.tempNote, humidity: std.humidityNote },
    received: { region, stage, temp, humidity, ventilation, mulberry, silkwormSigns: signs, disinfected, feedback },
    checks, factors, weight: Number(weight.toFixed(1)),
    levelReasons, alerts, interventions, orders, routineNote,
    knowledge,
    recordedAt: new Date().toISOString(),
  };
}

export {
  assess,
  STAGES, STAGE_STANDARDS, VENTILATION_LEVELS, MULBERRY_LEVELS, SILKWORM_SIGNS,
  TEMP_HARD_MIN, TEMP_HARD_MAX,
};
