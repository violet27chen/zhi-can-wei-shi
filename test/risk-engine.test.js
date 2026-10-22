'use strict';
/* 智蚕卫士 · 风险研判引擎单元测试（零依赖，node test/risk-engine.test.js） */

import assert from 'node:assert';
import { assess, STAGES, STAGE_STANDARDS, TEMP_HARD_MIN, TEMP_HARD_MAX } from '../src/risk-engine.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (e) { console.error(`  FAIL - ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const base = { region: '测试房', stage: '4龄', temp: 25, humidity: 72, ventilation: '良好', mulberry: '正常', silkwormSigns: [], disinfected: true };

/* ---------- 龄期标准表 ---------- */
test('龄期表覆盖 孵化/1-5龄/上簇期/蛹期', () => {
  assert.deepStrictEqual(STAGES, ['孵化', '1龄', '2龄', '3龄', '4龄', '5龄', '上簇期', '蛹期']);
});
test('孵化~2龄共用 26–28℃ / 85%–90%', () => {
  for (const s of ['孵化', '1龄', '2龄']) {
    assert.deepStrictEqual(STAGE_STANDARDS[s].temp, [26, 28]);
    assert.deepStrictEqual(STAGE_STANDARDS[s].humidity, [85, 90]);
  }
});
test('3龄为"左右"型：27–29℃ / 75%–85% 容差', () => {
  assert.deepStrictEqual(STAGE_STANDARDS['3龄'].temp, [27, 29]);
  assert.deepStrictEqual(STAGE_STANDARDS['3龄'].humidity, [75, 85]);
});
test('4龄 24–26℃ / 70%–75%；5龄 22–24℃ / 70%–75%', () => {
  assert.deepStrictEqual(STAGE_STANDARDS['4龄'].temp, [24, 26]);
  assert.deepStrictEqual(STAGE_STANDARDS['5龄'].temp, [22, 24]);
  assert.deepStrictEqual(STAGE_STANDARDS['5龄'].humidity, [70, 75]);
});
test('通用硬线 22–28℃', () => {
  assert.strictEqual(TEMP_HARD_MIN, 22);
  assert.strictEqual(TEMP_HARD_MAX, 28);
});

/* ---------- 正常判定 ---------- */
test('4龄标准内 → B 级，正常话术 routineNote 生成', () => {
  const r = assess(base);
  assert.strictEqual(r.level, 'B');
  assert.ok(r.routineNote && r.routineNote.includes('处于该龄期标准区间'));
  assert.ok(r.knowledge.label.includes('全维正常'));
});
test('5龄 23℃/72% → B 级', () => {
  const r = assess({ ...base, stage: '5龄', temp: 23, humidity: 72 });
  assert.strictEqual(r.level, 'B');
});
test('3龄 27.5℃/80%（"左右"容差内）→ B 级', () => {
  const r = assess({ ...base, stage: '3龄', temp: 27.5, humidity: 80 });
  assert.strictEqual(r.level, 'B');
});
test('2龄 27℃/88%（小蚕高湿标准内）→ B 级', () => {
  const r = assess({ ...base, stage: '2龄', temp: 27, humidity: 88 });
  assert.strictEqual(r.level, 'B');
});

/* ---------- 温度异常 ---------- */
test('4龄 26.8℃ 超上限 → C 级，理由含"食欲减退、生长缓慢"', () => {
  const r = assess({ ...base, temp: 26.8 });
  assert.strictEqual(r.level, 'C');
  const f = r.factors.find((x) => x.key === 'tempHigh');
  assert.ok(f && f.reason.includes('食欲减退、生长缓慢'));
});
test('4龄 23.5℃ 低于下限 → C 级，理由含"延长蚕龄、影响上蔟率"', () => {
  const r = assess({ ...base, temp: 23.5 });
  assert.strictEqual(r.level, 'C');
  const f = r.factors.find((x) => x.key === 'tempLow');
  assert.ok(f && f.reason.includes('延长蚕龄、影响上蔟率'));
});
test('5龄 21℃ 跌破 22℃ 硬线 → 指出超出 AI 正常工作范围，要求人工介入查验', () => {
  const r = assess({ ...base, stage: '5龄', temp: 21 });
  const c = r.checks.find((x) => x.name === '温度');
  assert.ok(c.note.includes('超出 AI 正常工作范围，要求人工介入查验'));
});
test('5龄 29℃ 越过 28℃ 硬线 → 同样要求人工介入查验', () => {
  const r = assess({ ...base, stage: '5龄', temp: 29 });
  const c = r.checks.find((x) => x.name === '温度');
  assert.ok(c.note.includes('超出 AI 正常工作范围，要求人工介入查验'));
});
test('3龄 26.8℃ 低于容差下限 → tempLow（3龄 28℃ 左右）', () => {
  const r = assess({ ...base, stage: '3龄', temp: 26.8 });
  assert.ok(r.factors.some((x) => x.key === 'tempLow'));
});

/* ---------- 湿度异常 ---------- */
test('4龄 78% 超湿度上限 → 高危 A 级，理由含"滋生细菌真菌"', () => {
  const r = assess({ ...base, humidity: 78 });
  assert.strictEqual(r.level, 'A');
  const f = r.factors.find((x) => x.key === 'humidityHigh');
  assert.ok(f && f.reason.includes('滋生细菌真菌'));
});
test('4龄 68% 低于湿度下限 → C 级，理由含"桑叶失水"与"蜕皮和结茧"', () => {
  const r = assess({ ...base, humidity: 68 });
  assert.strictEqual(r.level, 'C');
  const f = r.factors.find((x) => x.key === 'humidityLow');
  assert.ok(f && f.reason.includes('桑叶失水') && f.reason.includes('蜕皮和结茧'));
});

/* ---------- 复合与病害 ---------- */
test('软化病迹象 → A 级病害预警', () => {
  const r = assess({ ...base, silkwormSigns: ['软化病迹象'] });
  assert.strictEqual(r.level, 'A');
  assert.ok(r.knowledge.label.includes('软化病迹象') && r.knowledge.label.includes('病害'));
});
test('消毒断档（其余正常）→ C 级疑似', () => {
  const r = assess({ ...base, disinfected: false });
  assert.strictEqual(r.level, 'C');
  assert.ok(r.knowledge.label.includes('消毒断档'));
});
test('温度缺失 → C 级，dataMissing 因子', () => {
  const r = assess({ ...base, temp: NaN });
  assert.strictEqual(r.level, 'C');
  assert.ok(r.factors.some((x) => x.key === 'dataMissing'));
});
test('多因子加权 ≥2.5 → A 级', () => {
  // tempHigh(1.0) + 通风不良(0.5) + 消毒缺失(1.0) + 桑叶严重萎蔫(1.0) = 3.5
  const r = assess({ ...base, temp: 26.8, ventilation: '不良', disinfected: false, mulberry: '严重萎蔫' });
  assert.strictEqual(r.level, 'A');
});

/* ---------- 输出结构 ---------- */
test('输出携带该龄期标准 standard 字段', () => {
  const r = assess(base);
  assert.strictEqual(r.standard.temp, '24–26℃');
  assert.strictEqual(r.standard.humidity, '70%–75%');
});
test('高危输出含红色警报与隔离指令；疑似输出黄色预警', () => {
  const a = assess({ ...base, humidity: 78 });
  assert.ok(a.alerts.some((x) => x.color === 'red'));
  assert.ok(a.orders.some((x) => x.includes('隔离分区')));
  assert.ok(a.orders.some((x) => x.includes('查找范围')));
  const c = assess({ ...base, disinfected: false });
  assert.ok(c.alerts.some((x) => x.color === 'yellow'));
});
test('应对措施针对异常类型生成', () => {
  const r = assess({ ...base, temp: 26.8, humidity: 78 });
  assert.ok(r.interventions.some((x) => x.includes('温度调控')));
  assert.ok(r.interventions.some((x) => x.includes('湿度调控')));
});

console.log(`\n${passed} 项通过`);
