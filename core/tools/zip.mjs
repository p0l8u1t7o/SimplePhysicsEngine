// zip 寫入（沒有 npm 套件）：網站壓縮檔、專案交接包共用。只用 stored／deflate，檔名以 UTF-8 標記，不支援 ZIP64（單檔與總量 < 4 GB）。
//   writeZip(outFile, [{ name, data }])      name 用 / 分隔；data 是 Buffer 或字串
//   zipDir(dir, outFile, { prefix, filter })  把資料夾整個壓進去（prefix：壓縮檔內的上層資料夾名稱）
//   readZip(file) → [{ name, data }]          讀回（測試與匯入用）
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { deflateRawSync, inflateRawSync, crc32 } from 'node:zlib';

// 已壓縮過的格式不再壓
const STORE = /\.(png|jpe?g|webp|gif|mp4|mov|zip|gz|7z|woff2?|glb|pdf|xlsx|pptx|docx)$/i;

export function writeZip(outFile, entries) {
  const local = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const deflated = STORE.test(e.name) || raw.length < 64 ? null : deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated && deflated.length < raw.length, body = useDeflate ? deflated : raw;
    const crc = crc32(raw) >>> 0, method = useDeflate ? 8 : 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(method, 8);
    head.writeUInt32LE(0, 10); head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
    local.push(head, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += head.length + name.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  if (offset > 0xffffffff) throw new Error('zip 超過 4 GB（不支援 ZIP64）');
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, Buffer.concat([...local, cd, end]));
  return { file: outFile, entries: entries.length, bytes: offset + cd.length + 22 };
}

export function dirEntries(dir, { prefix = '', filter = () => true } = {}) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = d => { for (const n of readdirSync(d).sort()) { const f = join(d, n), rel = relative(dir, f).split(sep).join('/');
    if (!filter(rel, f)) continue;
    if (statSync(f).isDirectory()) walk(f); else out.push({ name: (prefix ? prefix + '/' : '') + rel, data: readFileSync(f) }); } };
  walk(dir);
  return out;
}
export const zipDir = (dir, outFile, opts = {}) => writeZip(outFile, [...dirEntries(dir, opts), ...(opts.extra || [])]);

export function readZip(file) {
  const buf = readFileSync(file);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('不是 zip 檔：' + file);
  const n = buf.readUInt16LE(eocd + 10), out = [];
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), at = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28), body = buf.subarray(start, start + size);
    if (!name.endsWith('/')) out.push({ name, data: method === 8 ? inflateRawSync(body) : method === 0 ? Buffer.from(body) : (() => { throw new Error(`不支援的壓縮方式 ${method}：${name}`); })() });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
