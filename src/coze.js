'use strict';
/**
 * 智蚕卫士 · 扣子（Coze）知识库对接
 * 通过扣子 OpenAPI（Bearer PAT 鉴权）实现：
 *   - retrieve(query)      检索知识库，命中片段并入 DeepSeek 研判提示（RAG 增强）
 *   - listDocuments()      拉取知识库文档列表（界面同步展示）
 *   - uploadDocument()     把本地知识库文件推送到扣子知识库（Base64 上传）
 * 未配置 PAT / dataset_id 时明确返回未配置状态，绝不伪造扣子数据。
 *
 * 接口（国内站 https://api.coze.cn，国际站 https://api.coze.com）：
 *   POST /open_api/knowledge/retrieve        { dataset_id, query, top_k }
 *   POST /open_api/knowledge/document/list   { dataset_id }
 *   POST /open_api/knowledge/document/create { dataset_id, document_bases[{name, source_info{file_base64, file_type}}] }
 */

const DEFAULT_BASE = 'https://api.coze.cn';
const TIMEOUT_MS = 30_000;

/* ---------- 读取环境变量（云函数 context.env / 本地 process.env 皆可） ---------- */
export function cozeConfig(env = {}) {
  return {
    base: (env.COZE_API_BASE || DEFAULT_BASE).replace(/\/+$/, ''),
    pat: env.COZE_PAT || '',
    datasetId: env.COZE_DATASET_ID || '',
  };
}

/** 是否已完整配置（PAT + 知识库 ID）。 */
export function isConfigured(cfg) {
  return Boolean(cfg.pat && cfg.datasetId);
}

/** 通用 POST。失败抛错，错误信息可读。 */
async function cozePost(cfg, path, body, fetchImpl = fetch) {
  if (!cfg.pat) {
    const e = new Error('未配置 COZE_PAT 环境变量，扣子知识库未接入');
    e.code = 'UNCONFIGURED';
    throw e;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(`${cfg.base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.pat}`,
        'Agw-Js-Conv': 'str',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `扣子接口请求超时（${TIMEOUT_MS / 1000}s）` : `扣子接口网络请求失败：${e.message}`);
  } finally {
    clearTimeout(timer);
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload || payload.code !== 0) {
    const detail = payload ? `${payload.code} ${payload.msg || ''}` : `HTTP ${res.status}`;
    throw new Error(`扣子接口返回错误：${detail}`);
  }
  return payload.data || {};
}

/** 检索知识库：返回 [{ content }] 命中片段。 */
export async function retrieve(cfg, query, topK = 5, fetchImpl = fetch) {
  if (!cfg.datasetId) {
    const e = new Error('未配置 COZE_DATASET_ID 环境变量，扣子知识库未接入');
    e.code = 'UNCONFIGURED';
    throw e;
  }
  const data = await cozePost(cfg, '/open_api/knowledge/retrieve', { dataset_id: cfg.datasetId, query, top_k: topK }, fetchImpl);
  const segments = data.segments || data.segment || [];
  return segments
    .map((s) => String((s && (s.content ?? s.content_ ?? '')) || '').trim())
    .filter(Boolean)
    .slice(0, topK);
}

/** 拉取知识库文档列表（同步展示用）。 */
export async function listDocuments(cfg, fetchImpl = fetch) {
  const data = await cozePost(cfg, '/open_api/knowledge/document/list', { dataset_id: cfg.datasetId }, fetchImpl);
  const infos = data.document_infos || [];
  return infos.map((d) => ({
    docId: String(d.doc_id || ''),
    name: String(d.name || ''),
    type: d.type != null ? Number(d.type) : null,
    updateTime: d.update_time != null ? Number(d.update_time) : null,
    status: d.status != null ? Number(d.status) : null,
  }));
}

/**
 * 上传一个文件到扣子知识库。
 * file: { name, buffer(Buffer), fileType('pdf'|'doc'|'docx'|'txt'|...) }
 * 返回 { docId, name }；一次只传 1 个文件（Base64 方式支持 pdf/txt/doc/docx）。
 */
export async function uploadDocument(cfg, file, fetchImpl = fetch) {
  const data = await cozePost(cfg, '/open_api/knowledge/document/create', {
    dataset_id: cfg.datasetId,
    document_bases: [{
      name: file.name,
      source_info: {
        file_base64: Buffer.from(file.buffer).toString('base64'),
        file_type: file.fileType,
      },
    }],
  }, fetchImpl);
  const doc = data && Array.isArray(data.document_infos) ? data.document_infos[0] : null;
  return {
    docId: doc ? String(doc.doc_id || '') : '',
    name: file.name,
  };
}

/** 由评估研判上下文组检索 query（异常关键词优先，便于命中防控条文）。 */
export function buildQuery(rule) {
  const parts = [`桑蚕 ${rule.stage} 防控`];
  if (Number.isFinite(rule.received.temp)) parts.push(`温度 ${rule.received.temp.toFixed(1)}℃`);
  if (Number.isFinite(rule.received.humidity)) parts.push(`湿度 ${Math.round(rule.received.humidity)}%`);
  for (const f of rule.factors) if (f.level !== 'note') parts.push(f.reason.split('：')[0].split('（')[0]);
  if (rule.received.silkwormSigns.length) parts.push(rule.received.silkwormSigns.join(' '));
  return parts.join(' ').slice(0, 120);
}
