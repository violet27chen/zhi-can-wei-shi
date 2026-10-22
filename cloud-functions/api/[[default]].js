'use strict';
/**
 * 智蚕卫士 · EdgeOne Makers 云函数（/api/* 统一入口）
 * 静态前端 + 本函数构成全栈；数据持久化使用 EdgeOne Blob（无数据库平台，Blob 即数据库）。
 * 存储键：
 *   data/records.json  评估记录（上限 500，单文档）
 *   data/zones.json    区域注册表
 *   data/files.json    知识库上传文件元数据
 *   uploads/<stored>   上传文件二进制本体
 */

import { getStore } from '@edgeone/pages-blob';
import { assess, STAGES, SILKWORM_SIGNS } from '../../src/risk-engine.js';
import { generateGuidance, aiConfig } from '../../src/gbt-knowledge.js';
import { extractText, ALLOWED_EXTS } from '../../src/filestore.js';
import { cozeConfig, isConfigured, retrieve, listDocuments, buildQuery } from '../../src/coze.js';

const BODY_LIMIT = 5 * 1024 * 1024; // 云函数请求体上限 6MB，本地收紧到 5MB
const MAX_RECORDS = 500;

/* ---------------- Blob 存储 ---------------- */

let _store = null;
function db() {
  if (!_store) _store = getStore({ name: 'zhican-wei-shi', consistency: 'strong' });
  return _store;
}

async function readJson(key, fallback) {
  const v = await db().get(key, { type: 'json' });
  return v == null ? fallback : v;
}

async function getRecords() {
  return readJson('data/records.json', []);
}

async function addRecord(assessment) {
  const records = await getRecords();
  const record = {
    id: `R${Date.now().toString(36)}${String(records.length % 97).padStart(2, '0')}`,
    ...assessment,
  };
  records.unshift(record);
  await db().setJSON('data/records.json', records.slice(0, MAX_RECORDS));
  return record;
}

async function getZones() {
  const saved = await readJson('data/zones.json', null);
  return saved && Array.isArray(saved.zones) && saved.zones.length ? saved.zones : DEFAULT_ZONES;
}

async function saveZones(zones) {
  await db().setJSON('data/zones.json', { zones, savedAt: new Date().toISOString() });
}

/** 各区域当前状态：取每区最新一条记录的级别与关键读数。 */
async function getZoneStates() {
  const [zones, records] = await Promise.all([getZones(), getRecords()]);
  return zones.map((z) => {
    const latest = records.find((r) => r.region === z.name);
    return {
      ...z,
      level: latest ? latest.level : 'B',
      temp: latest ? latest.received.temp : null,
      humidity: latest ? latest.received.humidity : null,
      ventilation: latest ? latest.received.ventilation : null,
      disinfected: latest ? latest.received.disinfected : null,
      label: latest ? latest.knowledge.label : '暂无评估记录，按常态防控',
      recordedAt: latest ? latest.recordedAt : null,
    };
  });
}

async function getFiles() {
  return readJson('data/files.json', []);
}

async function addFile(meta) {
  const files = await getFiles();
  files.unshift(meta);
  await db().setJSON('data/files.json', files.slice(0, 300));
  return meta;
}

async function removeFile(id) {
  const files = await getFiles();
  const idx = files.findIndex((f) => f.id === id);
  if (idx === -1) return null;
  const [meta] = files.splice(idx, 1);
  await db().setJSON('data/files.json', files);
  return meta;
}

async function seedIfEmpty() {
  const records = await getRecords();
  if (records.length > 0) return false;
  for (const a of SEED_ASSESSMENTS) await addRecord(assess(a));
  return true;
}

/* ---------------- 首次启动种子数据（真实感样例） ---------------- */

const DEFAULT_ZONES = [
  { id: 'Z1', name: '1号蚕房', stage: '4龄' },
  { id: 'Z2', name: '2号蚕房', stage: '5龄' },
  { id: 'Z3', name: '3号蚕房', stage: '2龄' },
  { id: 'Z4', name: '4号蚕房', stage: '上簇期' },
];

const SEED_ASSESSMENTS = [
  { region: '1号蚕房', stage: '4龄', temp: 26.8, humidity: 78, ventilation: '一般', mulberry: '正常', silkwormSigns: [], disinfected: true, feedback: '' },
  { region: '2号蚕房', stage: '5龄', temp: 23.2, humidity: 72, ventilation: '良好', mulberry: '正常', silkwormSigns: [], disinfected: true, feedback: '' },
  { region: '3号蚕房', stage: '2龄', temp: 27.0, humidity: 88, ventilation: '一般', mulberry: '正常', silkwormSigns: [], disinfected: false, feedback: '' },
  { region: '4号蚕房', stage: '上簇期', temp: 24.6, humidity: 72, ventilation: '良好', mulberry: '正常', silkwormSigns: ['双宫茧'], disinfected: true, feedback: '' },
];

/* ---------------- 请求工具 ---------------- */

/** 解析 multipart/form-data：返回第一个含 filename 的文件字段。 */
function parseMultipart(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw new Error('缺少 multipart boundary');
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  let pos = buffer.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (buffer.slice(start, start + 2).toString() === '--') break; // 结束分隔符
    const headEnd = buffer.indexOf('\r\n\r\n', start);
    if (headEnd === -1) break;
    const head = buffer.slice(start, headEnd).toString('utf8');
    const next = buffer.indexOf(boundary, headEnd);
    const dataEnd = next === -1 ? buffer.length : next - 2; // 去掉数据末尾 \r\n
    const fm = /filename="([^"]*)"/i.exec(head);
    if (fm) {
      return { filename: decodeURIComponent(fm[1] || '未命名'), data: buffer.slice(headEnd + 4, dataEnd) };
    }
    pos = next;
  }
  throw new Error('未在请求中找到文件字段');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function fail(message, status = 400) {
  return json({ error: message }, status);
}

/* ---------------- 知识库上传 ---------------- */

async function handleUpload(request) {
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > BODY_LIMIT) return fail('文件超过 5MB 上限');
  const file = parseMultipart(raw, request.headers.get('content-type'));
  if (!file.data.length) return fail('上传文件为空');

  const safe = String(file.filename || '未命名').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || '未命名';
  const ext = safe.slice(safe.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    return fail(`不支持的文件格式 ${ext || '(无扩展名)'}：仅支持 PDF、DOC、DOCX、XLS、XLSX、CSV、TXT、MD、JSON`);
  }
  const id = `F${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const storedName = `${id}_${safe}`;
  const text = extractText(ext, file.data);

  await db().set(`uploads/${storedName}`, file.data);
  const meta = await addFile({
    id,
    name: safe,
    ext: ext.slice(1),
    size: file.data.length,
    uploadedAt: new Date().toISOString(),
    extracted: Boolean(text),
    preview: text,
    storedName,
  });
  return json({ file: meta, files: await getFiles() });
}

/* ---------------- AI 研判接入 ---------------- */

/** 规则引擎定级之后，调用真实 DeepSeek 生成 GB/T 47302-2026 处置方案。 */
async function withAi(rule, env, cozeHits = []) {
  const cfg = aiConfig(env);
  try {
    const guidance = await generateGuidance(rule, cfg, { cozeHits });
    return { status: 'ok', ...guidance };
  } catch (e) {
    return {
      status: e.code === 'UNCONFIGURED' ? 'unconfigured' : 'error',
      message: e.message,
    };
  }
}

/** 扣子知识库检索：已配置则命中片段并入 AI 提示；未配置/失败如实标注，不阻断研判。 */
async function cozeLookup(rule, env) {
  const cfg = cozeConfig(env);
  if (!isConfigured(cfg)) {
    return { status: 'unconfigured', message: '未配置 COZE_PAT / COZE_DATASET_ID，扣子知识库未接入' };
  }
  try {
    const hits = await retrieve(cfg, buildQuery(rule), 5);
    return { status: hits.length ? 'ok' : 'empty', hits: hits.length, segments: hits };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/* ---------------- 路由 ---------------- */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const { pathname, method } = { pathname: url.pathname.replace(/\/+$/, '') || '/', method: request.method };

  try {
    if (method === 'GET' && pathname === '/api/health') {
      const cfg = aiConfig(env);
      return json({ ok: true, name: '智蚕卫士', stages: STAGES, signs: SILKWORM_SIGNS, ai: { configured: Boolean(cfg.apiKey), model: cfg.model } });
    }

    if (method === 'GET' && pathname === '/api/zones') {
      await seedIfEmpty();
      return json({ zones: await getZoneStates() });
    }

    if (method === 'GET' && pathname === '/api/records') {
      await seedIfEmpty();
      const records = await getRecords();
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
      return json({ records: records.slice(0, limit), total: records.length });
    }

    if (method === 'GET' && pathname === '/api/knowledge') {
      const records = await getRecords();
      const knowledge = records
        .filter((r) => r.knowledge && r.level !== 'B')
        .map((r) => ({
          id: r.id, recordedAt: r.recordedAt, region: r.region, stage: r.stage, level: r.level,
          label: r.knowledge.label, summary: r.knowledge.summary,
        }));
      return json({ knowledge, files: await getFiles() });
    }

    if (method === 'POST' && pathname === '/api/assess') {
      const payload = await request.json().catch(() => ({}));
      if (!payload.region || !String(payload.region).trim()) return fail('缺少区域名称（region）');
      const rule = assess(payload);
      const coze = await cozeLookup(rule, env); // 扣子知识库检索（未配置时明确标注，不阻断）
      const cozeHits = coze.status === 'ok' ? coze.segments : [];
      const ai = await withAi(rule, env, cozeHits);
      const record = await addRecord({ ...rule, ai, coze });
      return json({ record });
    }

    if (method === 'POST' && pathname === '/api/zones/stage') {
      const payload = await request.json().catch(() => ({}));
      const zones = await getZones();
      const zone = zones.find((z) => z.id === payload.id);
      if (!zone) return fail('区域不存在', 404);
      if (STAGES.includes(payload.stage)) zone.stage = payload.stage;
      await saveZones(zones);
      return json({ zones: await getZoneStates() });
    }

    if (method === 'POST' && pathname === '/api/knowledge/upload') {
      return await handleUpload(request);
    }

    if (method === 'GET' && pathname === '/api/coze/documents') {
      const cfg = cozeConfig(env);
      if (!isConfigured(cfg)) {
        return json({ configured: false, message: '未配置扣子知识库：请设置环境变量 COZE_PAT 与 COZE_DATASET_ID' });
      }
      try {
        return json({ configured: true, documents: await listDocuments(cfg) });
      } catch (e) {
        return json({ configured: true, error: e.message, documents: [] });
      }
    }

    // 扣子智能体网页问答窗配置：前端 Chat SDK 需 bot_id 与令牌
    if (method === 'GET' && pathname === '/api/coze/chat-config') {
      const cfg = cozeConfig(env);
      const botId = String(env.COZE_BOT_ID || '').trim();
      if (!botId || !cfg.pat) {
        return json({ enabled: false, message: '扣子智能体未接入：请配置环境变量 COZE_BOT_ID 与 COZE_PAT（团队空间授权，勾选聊天权限）' });
      }
      return json({ enabled: true, botId, pat: cfg.pat, apiBase: cfg.apiBase || 'https://api.coze.cn' });
    }

    let dl = /^\/api\/files\/([\w-]+)\/download$/.exec(pathname);
    if (method === 'GET' && dl) {
      const meta = (await getFiles()).find((f) => f.id === dl[1]);
      if (!meta) return fail('文件不存在', 404);
      const buf = await db().get(`uploads/${meta.storedName}`, { type: 'arrayBuffer' });
      if (!buf) return fail('文件已丢失', 404);
      return new Response(buf, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
          'Cache-Control': 'no-store',
        },
      });
    }

    let rm = /^\/api\/files\/([\w-]+)$/.exec(pathname);
    if (method === 'DELETE' && rm) {
      const meta = await removeFile(rm[1]);
      if (!meta) return fail('文件不存在', 404);
      await db().delete(`uploads/${meta.storedName}`);
      return json({ files: await getFiles() });
    }

    if (method === 'GET' && pathname === '/api/backup') {
      const body = JSON.stringify({
        app: '智蚕卫士',
        exportedAt: new Date().toISOString(),
        records: await getRecords(),
        zones: await getZones(),
        files: await getFiles(),
      }, null, 2);
      const stamp = new Date().toISOString().slice(0, 10);
      return new Response(body, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`智蚕卫士备份_${stamp}.json`)}`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (method === 'POST' && pathname === '/api/restore') {
      const payload = await request.json().catch(() => null);
      if (!payload) return fail('请求体不是合法 JSON');
      const result = { records: 0, zones: 0, files: 0 };
      if (Array.isArray(payload.records)) {
        await db().setJSON('data/records.json', payload.records.slice(0, MAX_RECORDS));
        result.records = Math.min(payload.records.length, MAX_RECORDS);
      }
      if (Array.isArray(payload.zones) && payload.zones.length) {
        await saveZones(payload.zones);
        result.zones = payload.zones.length;
      }
      if (Array.isArray(payload.files)) {
        await store.setJSON('data/files.json', payload.files.slice(0, 300));
        result.files = Math.min(payload.files.length, 300);
      }
      return json({ restored: result, files: await getFiles() });
    }

    return fail('未知接口', 404);
  } catch (e) {
    return json({ error: e.message || '服务内部错误' }, 500);
  }
}
