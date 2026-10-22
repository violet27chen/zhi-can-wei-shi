'use strict';
/**
 * 智蚕卫士 · 知识库文件内容提取（边缘/云函数版，只读内存，不落盘）
 *   - .txt/.md/.csv/.json  直接按 UTF-8 提取
 *   - .docx                解析 zip 内 word/document.xml 的 <w:t>
 *   - .xlsx                解析 zip 内 xl/sharedStrings.xml 的 <t>
 *   - .pdf/.doc/.xls 等二进制格式  仅存档（不做内容提取）
 * 文件字节本体由调用方写入对象存储（Blob），本模块只负责文本预览提取。
 */

import zlib from 'node:zlib';

const PREVIEW_MAX = 4000;

/* ---------------- 最小 zip 读取器（仅支持 store / deflate） ---------------- */

/** 在 zip buffer 中按条目名取解压后的内容；找不到返回 null。 */
export function zipEntry(buf, entryName) {
  // 定位 EOCD（0x06054b50）：注释最长 65535，从尾部向前扫
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) return null;
  const entryCount = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16); // central directory 起始偏移

  for (let n = 0; n < entryCount; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    if (name === entryName) {
      // local file header：真实数据起点 = localOffset + 30 + 文件名长 + 额外字段长
      if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) return null;
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const raw = buf.slice(dataStart, dataStart + compressedSize);
      if (method === 0) return raw;
      if (method === 8) return zlib.inflateRawSync(raw);
      return null; // 不支持的压缩方式
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** 从 OOXML 文本中按标签提取纯文本。 */
function xmlTagText(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml)) && out.join('').length < PREVIEW_MAX) out.push(m[1]);
  return out.join('');
}

/** 按扩展名提取文本预览；不可解析格式返回 null。 */
export function extractText(ext, buffer) {
  try {
    if (ext === '.txt' || ext === '.md' || ext === '.json' || ext === '.csv') {
      return buffer.toString('utf8').slice(0, PREVIEW_MAX);
    }
    if (ext === '.docx') {
      const xml = zipEntry(buffer, 'word/document.xml');
      return xml ? xmlTagText(xml.toString('utf8'), 'w:t').slice(0, PREVIEW_MAX) : null;
    }
    if (ext === '.xlsx') {
      const xml = zipEntry(buffer, 'xl/sharedStrings.xml');
      return xml ? xmlTagText(xml.toString('utf8'), 't').slice(0, PREVIEW_MAX) : null;
    }
  } catch {
    return null; // 提取失败按存档处理，不影响上传
  }
  return null;
}

export const ALLOWED_EXTS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.md', '.json']);
