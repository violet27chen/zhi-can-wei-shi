'use strict';
/* 智蚕卫士 · 前端逻辑 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const STAGES = ['孵化', '1龄', '2龄', '3龄', '4龄', '5龄', '上簇期', '蛹期'];
const VENTILATION = ['良好', '一般', '不良'];
const MULBERRY = ['正常', '轻微萎蔫', '严重萎蔫'];
const SIGNS = ['黄斑茧', '双宫茧', '蛹多', '薄皮茧', '软化病迹象', '僵病迹象'];

const LEVEL_CLASS = { A: 'neg', B: 'pos', C: 'warn' };
const LEVEL_SHORT = { A: 'A 高危', B: 'B 正常', C: 'C 疑似' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hhmm(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function mmdd(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm(iso)}`;
}

function fmtTemp(v) { return Number.isFinite(v) ? `${v.toFixed(1)}℃` : '—'; }
function fmtHum(v) { return Number.isFinite(v) ? `${Math.round(v)}%` : '—'; }

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

/* ---------------- 视图切换 ---------------- */
function switchView(name) {
  $('#view-overview').hidden = name !== 'overview';
  $('#view-records').hidden = name !== 'records';
  $$('.nav-item').forEach((a) => a.setAttribute('aria-current', a.dataset.view === name ? 'page' : 'false'));
  if (name === 'records') loadRecords();
}

/* ---------------- 分区状态板 ---------------- */
function zoneRow(z) {
  return `
    <div class="zone" data-level="${z.level}" data-id="${esc(z.id)}" role="button" tabindex="0"
         aria-label="${esc(z.name)}，${LEVEL_SHORT[z.level]}，填入录入表单">
      <span class="zone-mark" aria-hidden="true"></span>
      <span class="zone-id mono">${esc(z.id)}</span>
      <span class="zone-name">${esc(z.name)}
        <span class="sub">${esc(z.stage)} · ${esc(z.label)}</span>
      </span>
      <span class="zone-read"><b>${fmtTemp(z.temp)}</b> / ${fmtHum(z.humidity)}${z.ventilation === '不良' ? ' · 通风不良' : ''}</span>
      <span class="zone-pill"><span class="pill ${LEVEL_CLASS[z.level]}">${LEVEL_SHORT[z.level]}</span></span>
    </div>`;
}

function renderZones(zones) {
  state.zones = zones;
  $('#zone-board').innerHTML = zones.length
    ? zones.map(zoneRow).join('')
    : '<div class="empty">暂无注册区域。</div>';
  $('#scope-count').textContent = zones.length;

  const count = (lv) => zones.filter((z) => z.level === lv).length;
  $('#kpi-a').innerHTML = `${count('A')}<small> 区</small>`;
  $('#kpi-c').innerHTML = `${count('C')}<small> 区</small>`;
  $('#kpi-b').innerHTML = `${count('B')}<small> 区</small>`;
  const disOk = zones.filter((z) => z.disinfected).length;
  $('#kpi-dis').innerHTML = `${disOk}<small> / ${zones.length} 房</small>`;

  const worst = zones.find((z) => z.level === 'A') || zones.find((z) => z.level === 'C');
  const finding = $('#finding-line');
  if (worst) {
    finding.innerHTML = `<strong>${esc(worst.name)}</strong> ${esc(worst.stage)}：${esc(worst.label)}`;
  } else if (zones.length) {
    finding.textContent = '各区域均处 B 级正常区间，维持常态防控。';
  }
}

/* ---------------- 近期预警 ---------------- */
function renderAlerts(records) {
  const alerts = records.filter((r) => r.level !== 'B').slice(0, 5);
  $('#alerts-list').innerHTML = alerts.length
    ? `<div class="kb-list">${alerts.map((r) => `
        <div class="kb-item">
          <div class="kb-head">
            <span class="pill ${LEVEL_CLASS[r.level]}">${LEVEL_SHORT[r.level]}</span>
            <strong>${esc(r.region)}</strong>
            <span class="meta" style="margin-left:auto;color:var(--faint);font-size:12px">${mmdd(r.recordedAt)}</span>
          </div>
          <p class="kb-sum">${esc(r.knowledge.label)}</p>
        </div>`).join('')}</div>`
    : '<div class="empty">暂无预警。各区域评估均处 B 级。</div>';
}

/* ---------------- 研判结论（四段式） ---------------- */
function checkRow(c) {
  const cls = { ok: 'pos', warn: 'warn', danger: 'neg', 'low-out': 'neg', 'high-out': 'neg', missing: 'warn' }[c.status] || '';
  return `<tr>
    <td>${esc(c.name)}</td>
    <td class="n num"><b>${esc(c.value)}</b></td>
    <td class="std">${esc(c.standard)}</td>
    <td><span class="pill ${cls}">${esc(c.status === 'ok' ? '达标' : c.status === 'missing' ? '缺失' : '异常')}</span></td>
    <td class="std" style="min-width:200px">${esc(c.note)}</td>
  </tr>`;
}

function renderVerdict(r) {
  $('#verdict-meta').textContent = `${r.region} · ${r.stage} · ${mmdd(r.recordedAt)}`;
  const banner = r.alerts.length
    ? r.alerts.map((a) => `<p class="alert-banner ${a.color === 'red' ? 'red' : 'yellow'}">${esc(a.text)}</p>`).join('')
    : '';

  // AI 研判块：status=ok 时以 DeepSeek 生成的 GB/T 47302-2026 处置方案为主；
  // 未配置/失败时如实展示原因，回落到规则引擎确定性指令，绝不伪造 AI 输出。
  const ai = r.ai;
  const coze = r.coze;
  const cozeLine = coze
    ? (coze.status === 'ok' ? `<p class="ai-source" style="margin-top:0">扣子知识库命中 ${coze.hits} 条片段，已并入本次研判</p>`
      : coze.status === 'empty' ? '<p class="ai-source" style="margin-top:0">扣子知识库已接入：本次检索无命中</p>'
      : `<p class="ai-warn">扣子知识库未参与研判：${esc(coze.message || '')}</p>`)
    : '';
  let aiBlock = '';
  let measureBlock = `<ul class="interventions">${r.interventions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  if (ai && ai.status === 'ok') {
    aiBlock = `
      <p class="ai-source">处置方案由 DeepSeek（${esc(ai.model)}）实时生成 · 依据 GB/T 47302-2026《桑蚕病害防控通则》</p>
      ${ai.summary ? `<p class="ai-summary">${esc(ai.summary)}</p>` : ''}
      <ul class="interventions">${ai.measures.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${ai.note ? `<p class="routine-note">${esc(ai.note)}</p>` : ''}`;
    measureBlock = '';
  } else if (ai && ai.message) {
    aiBlock = `<p class="ai-warn">AI 研判未接入：${esc(ai.message)}。以下为规则引擎确定性指令。</p>`;
  }
  const routineHtml = ai && ai.status === 'ok' ? '' : (r.routineNote ? `<p class="routine-note">${esc(r.routineNote)}</p>` : '');

  $('#verdict-body').innerHTML = `
  <div class="verdict">
    <section>
      <h3><span class="idx">一</span>数据接收与状态评估</h3>
      <div class="table-wrap">
        <table class="check-table">
          <thead><tr><th>监测项</th><th class="n">读数</th><th>标准</th><th>比对</th><th>评估</th></tr></thead>
          <tbody>${r.checks.map(checkRow).join('')}</tbody>
        </table>
      </div>
    </section>
    <section>
      <h3><span class="idx">二</span>风险定级与分区</h3>
      <div class="level-line">
        <span class="level-badge" data-level="${r.level}">${esc(r.levelName)}</span>
        <span class="meta">风险加权 ${r.weight} 分</span>
      </div>
      <ul class="reasons">${r.levelReasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    </section>
    <section>
      <h3><span class="idx">三</span>智能预警与指令</h3>
      ${banner}
      ${cozeLine}
      ${aiBlock}
      ${routineHtml}
      ${measureBlock}
      <ul class="orders" style="margin-top:10px">${r.orders.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    </section>
    <section>
      <h3><span class="idx">四</span>知识库沉淀</h3>
      <span class="kb-tag">${esc(r.knowledge.label)}<small>已记录入系统</small></span>
      <p class="kb-note">${esc(r.knowledge.summary)}</p>
    </section>
  </div>`;
}

/* ---------------- 记录与知识库 ---------------- */
function renderRecords(records, total) {
  $('#records-total').textContent = total;
  $('#records-body').innerHTML = records.length
    ? records.slice(0, 50).map((r) => `<tr>
        <td class="num">${mmdd(r.recordedAt)}</td>
        <td><b>${esc(r.region)}</b></td>
        <td>${esc(r.stage)}</td>
        <td><span class="pill ${LEVEL_CLASS[r.level]}">${LEVEL_SHORT[r.level]}</span></td>
        <td class="n num">${fmtTemp(r.received.temp)}</td>
        <td class="n num">${fmtHum(r.received.humidity)}</td>
        <td>${esc(r.received.ventilation)}</td>
        <td class="std" style="color:var(--muted)">${esc(r.knowledge.label)}</td>
      </tr>`).join('')
    : '<tr><td colspan="8"><div class="empty">暂无评估记录。</div></td></tr>';
}

function renderKnowledge(knowledge, files) {
  $('#kb-files').innerHTML = files && files.length
    ? files.map((f) => `
      <div class="kb-file">
        <span class="pill neutral">${esc(f.ext.toUpperCase())}</span>
        <span class="kb-file-name"><b>${esc(f.name)}</b>
          <span class="sub">${f.extracted ? '内容已提取入检索' : '已存档（该格式暂不做内容提取）'} · ${(f.size / 1024).toFixed(1)} KB · ${mmdd(f.uploadedAt)}</span>
        </span>
        <span class="kb-file-actions">
          <a class="btn ghost" href="/api/files/${encodeURIComponent(f.id)}/download" style="height:24px;padding:0 8px">下载</a>
          <button class="btn ghost" type="button" data-del="${esc(f.id)}" style="height:24px;padding:0 8px">删除</button>
        </span>
      </div>`).join('')
    : '<div class="kb-file-empty">暂无手动上传的资料。蚕病防治手册、龄期技术规范等 PDF/Word/Excel/CSV 均可上传沉淀。</div>';

  $('#knowledge-list').innerHTML = knowledge.length
    ? knowledge.slice(0, 50).map((k) => `
      <div class="kb-item">
        <div class="kb-head">
          <span class="pill ${LEVEL_CLASS[k.level]}">${LEVEL_SHORT[k.level]}</span>
          <span class="kb-tag" style="height:26px">${esc(k.label)}</span>
          <span style="margin-left:auto;color:var(--faint);font-size:12px">${esc(k.region)} · ${mmdd(k.recordedAt)}</span>
        </div>
        <p class="kb-sum">${esc(k.summary)}</p>
      </div>`).join('')
    : '<div class="empty">暂无 A/C 级沉淀。知识库只收录需要复盘的异常场景。</div>';
}

async function deleteFile(id) {
  const { files } = await api(`/api/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
  renderKnowledge(state.knowledge, files);
}

/* ---------------- 数据加载 ---------------- */
async function loadZones() {
  const { zones } = await api('/api/zones');
  renderZones(zones);
  const stamp = zones.map((z) => z.recordedAt).filter(Boolean).sort().pop();
  $('#stamp-time').textContent = stamp ? hhmm(stamp) : '—';
  const sel = $('#f-region');
  const current = sel.value;
  sel.innerHTML = zones.map((z) => `<option value="${esc(z.name)}">${esc(z.name)}</option>`).join('');
  if (current && zones.some((z) => z.name === current)) sel.value = current;
  syncStage();
}

async function loadRecords() {
  const [rec, kb] = await Promise.all([api('/api/records?limit=50'), api('/api/knowledge')]);
  state.knowledge = kb.knowledge;
  renderRecords(rec.records, rec.total);
  renderKnowledge(kb.knowledge, kb.files);
  renderAlerts(rec.records);
  loadCoze().catch(() => {});
}

async function refreshAll() {
  await loadZones();
  await loadRecords();
}

/* ---------------- 表单 ---------------- */
function syncStage() {
  const name = $('#f-region').value;
  const z = state.zones.find((x) => x.name === name);
  if (z) $('#f-stage').value = z.stage;
}

function initForm() {
  $('#f-stage').innerHTML = STAGES.map((s) => `<option>${s}</option>`).join('');
  $('#f-vent').innerHTML = VENTILATION.map((s) => `<option>${s}</option>`).join('');
  $('#f-mulberry').innerHTML = MULBERRY.map((s) => `<option>${s}</option>`).join('');
  $('#f-signs').innerHTML = SIGNS.map((s) => `
    <button type="button" class="chip" data-sign="${esc(s)}" aria-pressed="false">${esc(s)}</button>`).join('');
  $$('#f-signs .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    });
  });
  $('#f-region').addEventListener('change', syncStage);

  $('#assess-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#btn-assess');
    btn.disabled = true;
    btn.textContent = '研判中…';
    try {
      const payload = {
        region: $('#f-region').value,
        stage: $('#f-stage').value,
        temp: $('#f-temp').value === '' ? null : Number($('#f-temp').value),
        humidity: $('#f-humidity').value === '' ? null : Number($('#f-humidity').value),
        ventilation: $('#f-vent').value,
        mulberry: $('#f-mulberry').value,
        silkwormSigns: $$('#f-signs .chip[aria-pressed="true"]').map((c) => c.dataset.sign),
        disinfected: $('#f-disinfected').checked,
        feedback: $('#f-feedback').value.trim(),
      };
      const { record } = await api('/api/assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      renderVerdict(record);
      await refreshAll();
    } catch (err) {
      $('#verdict-body').innerHTML = `<div class="empty">研判请求失败：${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = '提交研判';
    }
  });
}

/* ---------------- 启动 ---------------- */
const state = { zones: [] };

$$('.nav-item').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  switchView(a.dataset.view);
  $('#sidebar').classList.remove('open');
}));
$('#btn-goto-records').addEventListener('click', () => switchView('records'));
$('#btn-refresh').addEventListener('click', refreshAll);
$('#btn-refresh-records').addEventListener('click', loadRecords);
$('#menu-open').addEventListener('click', () => $('#sidebar').classList.add('open'));
$('#menu-close').addEventListener('click', () => $('#sidebar').classList.remove('open'));

$('#zone-board').addEventListener('click', (e) => {
  const z = e.target.closest('.zone');
  if (!z) return;
  const item = state.zones.find((x) => x.id === z.dataset.id);
  if (!item) return;
  $('#f-region').value = item.name;
  syncStage();
  $('#assess-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
$('#zone-board').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    const z = e.target.closest('.zone');
    if (z) { e.preventDefault(); z.click(); }
  }
});

$$('#tab-records, #tab-knowledge').forEach((tab) => tab.addEventListener('click', () => {
  const isRecords = tab.id === 'tab-records';
  $('#tab-records').setAttribute('aria-selected', String(isRecords));
  $('#tab-knowledge').setAttribute('aria-selected', String(!isRecords));
  $('#records-panel').hidden = !isRecords;
  $('#knowledge-panel').hidden = isRecords;
}));

/* ---------------- 知识库：上传 / 删除 / 备份导入 ---------------- */
$('#btn-upload').addEventListener('click', async () => {
  const input = $('#kb-file');
  const file = input.files && input.files[0];
  if (!file) return alert('请先选择要上传的文件');
  if (file.size > 5 * 1024 * 1024) return alert('文件超过 5MB 上限（EdgeOne 云函数请求体限制），请压缩后上传');
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/api/knowledge/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '上传失败');
    input.value = '';
    renderKnowledge(state.knowledge, data.files);
  } catch (err) {
    alert(`上传失败：${err.message}`);
  }
});

$('#kb-files').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del && confirm('确认删除该资料？')) deleteFile(del.dataset.del).catch((err) => alert(err.message));
});

/* ---------------- 扣子知识库对接 ---------------- */
async function loadCoze() {
  const box = $('#coze-status');
  try {
    const r = await api('/api/coze/documents');
    if (!r.configured) {
      box.innerHTML = `<span class="coze-off">扣子知识库未接入：${esc(r.message)}</span>`;
      $('#coze-docs').innerHTML = '';
      return;
    }
    box.innerHTML = `<span class="coze-on">已接入扣子知识库（检索增强已生效，研判时自动命中条文）</span>`;
    $('#coze-docs').innerHTML = r.documents.length
      ? r.documents.map((d) => `<div class="kb-file"><span class="pill neutral">云端</span>
          <span class="kb-file-name"><b>${esc(d.name)}</b><span class="sub">doc_id ${esc(d.docId)}</span></span></div>`).join('')
      : '<div class="kb-file-empty">扣子知识库暂无文档。</div>';
  } catch (e) {
    box.innerHTML = `<span class="coze-off">扣子状态查询失败：${esc(e.message)}</span>`;
  }
}

$('#btn-restore').addEventListener('click', async () => {
  const input = $('#restore-file');
  const file = input.files && input.files[0];
  if (!file) return alert('请先选择备份 JSON 文件');
  if (!confirm('导入备份将覆盖现有评估记录、区域与知识库索引，确认继续？')) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text); // 本地先校验合法性
    const res = await api('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    input.value = '';
    const n = res.restored;
    alert(`备份导入完成：评估记录 ${n.records} 条、区域 ${n.zones} 个、知识库索引 ${n.files} 条。\n注：备份不含上传文件的二进制内容，原文件需另行保存。`);
    await refreshAll();
  } catch (err) {
    alert(`导入失败：${err.message}`);
  }
});

initForm();
refreshAll().catch(() => {
  $('#finding-line').textContent = '服务连接失败，请刷新重试';
});

/* ---------------- 扣子智能体 · 网页问答窗 ----------------
 * 后端 /api/coze/chat-config 下发 bot_id 与令牌；未配置时不渲染任何 UI。
 * 令牌经前端下发仅为演示便利，生产建议改为 OAuth 用户级令牌（团队版支持）。 */
async function initCozeChat() {
  let cfg;
  try {
    cfg = await api('/api/coze/chat-config');
  } catch (e) {
    return; // 服务异常时不打扰用户，知识库页签已有状态说明
  }
  if (!cfg || !cfg.enabled) return;
  const s = document.createElement('script');
  s.src = 'https://sf-cdn.coze.cn/obj/unpkg-va/coze-web-sdk/legacy/1.1.6.4/chat-sdk.js';
  s.onload = () => {
    try {
      new CozeWebSDK.WebChatClient({
        config: { bot_id: cfg.botId },
        auth: { type: 'token', token: cfg.pat, onRefreshToken: () => cfg.pat },
        ui: {
          base: { zIndex: 1200, lang: 'zh-CN' },
          chatBot: {
            title: '蚕病防控助手',
            placeholder: '询问蚕病防控、温湿度调控等问题…',
            width: 420,
            height: 640,
            uploadable: true,
          },
        },
      });
    } catch (err) {
      console.error('扣子问答窗初始化失败', err);
    }
  };
  s.onerror = () => console.error('扣子 SDK 加载失败，请检查网络');
  document.head.appendChild(s);
}
initCozeChat();
