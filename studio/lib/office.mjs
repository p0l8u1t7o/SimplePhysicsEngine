// Office 檔（pptx／docx／xlsx）抽出文字與圖片，給讀不了 Office 檔的代理 CLI 用。純 Node，不用 npm 套件。
//   docs/<原檔名>.extract/text.md   整理好的文字（標出投影片／工作表），圖片放同一資料夾
//   zip 只支援 stored 與 deflate（Office 檔都是這兩種）；XML 用簡易的標籤走訪，不建 DOM
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export const OFFICE = /\.(pptx|pptm|ppsx|potx|docx|docm|dotx|xlsx|xlsm|xltx)$/i;
export const OLD_OFFICE = /\.(ppt|pps|doc|xls)$/i;
const KIND = { p: 'pptx', d: 'docx', x: 'xlsx' };
const kindOf = name => KIND[(name.match(OFFICE)?.[1] || '')[0]?.toLowerCase()];
const NEW_EXT = { ppt: '.pptx', pps: '.pptx', doc: '.docx', xls: '.xlsx' };
const VIEWABLE = /\.(png|jpe?g|gif|webp|bmp)$/i;

// ---- zip ----
export function readZip(buf) {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0xd0cf11e0) throw new Error('不是 zip（可能有密碼保護，或其實是舊版格式）');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是 zip 或檔案不完整');
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  if (cdOff === 0xffffffff) throw new Error('不支援 ZIP64');
  const entries = new Map();
  for (let i = 0, p = cdOff; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 中央目錄損壞');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const n = buf.readUInt16LE(p + 28), m = buf.readUInt16LE(p + 30), k = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + n).toString(flags & 0x800 ? 'utf8' : 'latin1');
    entries.set(name, { method, csize, size, off, flags });
    p += 46 + n + m + k;
  }
  const get = name => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.flags & 1) throw new Error(`${name} 有加密`);
    if (buf.readUInt32LE(e.off) !== 0x04034b50) throw new Error(`${name} 的本地標頭損壞`);
    const start = e.off + 30 + buf.readUInt16LE(e.off + 26) + buf.readUInt16LE(e.off + 28), data = buf.subarray(start, start + e.csize);
    if (e.method === 0) return Buffer.from(data);
    if (e.method === 8) return inflateRawSync(data, { maxOutputLength: Math.max(e.size, 1) + 1024 });
    throw new Error(`${name} 的壓縮方式 ${e.method} 不支援`);
  };
  return { names: [...entries.keys()], has: n => entries.has(n), get, text: n => get(n)?.toString('utf8').replace(/^﻿/, '') ?? null };
}

// ---- XML ----
export const decodeXml = s => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1))
    : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]);
// 標籤走訪：{ name（去掉前綴）, end, self, raw（屬性字串）} 或 { text }
function* tokens(xml) {
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][\s\S]*?>|<(\/?)(?:[\w.-]+:)?([\w.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  for (let m; (m = re.exec(xml));) {
    if (m[1] != null) yield { text: m[1] };
    else if (m[6] != null) yield { text: decodeXml(m[6]) };
    else if (m[3]) yield { name: m[3], end: !!m[2], self: !!m[5], raw: m[4] };
  }
}
const attr = (raw, name) => { const m = raw?.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)); return m ? decodeXml(m[1] ?? m[2]) : null; };

// 關聯檔（_rels/*.rels）：Id → { type（最後一段）, target（zip 內完整路徑）}
function rels(zip, part) {
  const dir = posix.dirname(part), f = posix.join(dir, '_rels', posix.basename(part) + '.rels'), xml = zip.text(f), out = {};
  if (!xml) return out;
  for (const m of xml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)>/g)) {
    if (attr(m[1], 'TargetMode') === 'External') continue;
    const t = attr(m[1], 'Target') || '';
    out[attr(m[1], 'Id')] = { type: (attr(m[1], 'Type') || '').split('/').pop(), target: t.startsWith('/') ? t.slice(1) : posix.normalize(posix.join(dir, t)) };
  }
  return out;
}

// Markdown 表格；儲存格內的 | 與換行要跳脫
const cellMd = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
function mdTable(rows, header) {
  rows = rows.filter(r => r.some(c => String(c ?? '').trim()));
  if (!rows.length) return '';
  // 只有一欄的表格多半是框起來的說明文字，改成引用區塊
  if (!header && rows.every(r => r.length <= 1)) return rows.map(r => String(r[0] ?? '').trim().split('\n').map(l => '> ' + l).join('\n')).join('\n>\n');
  const n = Math.max(...rows.map(r => r.length), header?.length || 0), line = r => '| ' + Array.from({ length: n }, (_, i) => cellMd(r[i])).join(' | ') + ' |';
  const head = header || rows.shift();
  return [line(head), '|' + ' --- |'.repeat(n), ...rows.map(line)].join('\n');
}

// 段落與表格的文字流（pptx 的 a:p／a:tbl、docx 的 w:p／w:tbl 結構相同）。o.para(段落, 文字) 決定段落的輸出格式
const SKIP = new Set(['Fallback', 'tabs', 'tabLst', 'instrText', 'delText']);   // Fallback 與 Choice 內容重複；tabs 是定位點設定
const SKIP_PH = new Set(['sldNum', 'dt', 'ftr', 'hdr', 'sldImg']);
function flow(xml, o = {}) {
  const out = [], boxes = [out], tables = [], paras = [], title = [];
  let tDepth = 0, skip = 0, sp = null;
  const cur = () => paras.at(-1);
  for (const k of tokens(xml)) {
    if (k.text != null) { if (tDepth && !skip && cur()) cur().text += k.text; continue; }
    const { name, end, self, raw } = k;
    if (SKIP.has(name)) { if (!self) skip += end ? -1 : 1; continue; }
    if (skip) continue;
    switch (name) {
      case 't': if (!self) tDepth += end ? -1 : 1; break;
      case 'p':
        if (!end && !self) { paras.push({ text: '', lvl: 0 }); break; }
        if (end) {
          const p = paras.pop(), s = p?.text.replace(/\r/g, '').replace(/^[ \t　]+|[ \t　]+$/gm, '');
          if (!s?.trim() || sp?.skip) break;
          if (sp?.title && boxes.length === 1) title.push(s.trim().replace(/\s*\n\s*/g, ' '));
          else boxes.at(-1).push(o.para && boxes.length === 1 ? o.para(p, s) : s);
        }
        break;
      case 'br': case 'cr': if (!end && cur()) cur().text += '\n'; break;
      case 'tab': if (!end && cur()) cur().text += '\t'; break;
      case 'noBreakHyphen': if (!end && cur()) cur().text += '-'; break;
      case 'tbl': if (!end && !self) tables.push({ rows: [] }); else if (end) { const t = tables.pop(), md = t && mdTable(t.rows); if (md) boxes.at(-1).push({ table: md }); } break;
      case 'tr': if (!end) tables.at(-1)?.rows.push([]); break;
      case 'tc':
        if (self) tables.at(-1)?.rows.at(-1)?.push('');
        else if (!end) boxes.push([]);
        else if (boxes.length > 1) tables.at(-1)?.rows.at(-1)?.push(boxes.pop().map(b => b.table ?? b).join('\n'));
        break;
      case 'sp': sp = end ? null : self ? sp : {}; break;
      case 'ph': if (sp && !end) { const ty = attr(raw, 'type'); sp.title = ty === 'title' || ty === 'ctrTitle'; sp.skip = SKIP_PH.has(ty); } break;
      case 'pPr': if (!end && cur() && attr(raw, 'lvl')) cur().lvl = +attr(raw, 'lvl'); break;
      case 'ilvl': if (!end && cur()) cur().lvl = +attr(raw, 'w:val') || 0; break;
      case 'numPr': if (!end && cur()) cur().list = true; break;
      case 'pStyle': if (!end && cur()) cur().style = attr(raw, 'w:val'); break;
      case 'blip': { const id = attr(raw, 'r:embed'); if (!end && id && o.image && cur()) { const n = o.image(id); if (n) cur().text += ` [圖片：${n}]`; } break; }
    }
  }
  return { blocks: out, title: title.join(' ') };
}
// 區塊接成文字：一般段落用 sep 分隔，表格前後空一行
const joinBlocks = (blocks, sep) => blocks.map((b, i) => b.table ? `${i ? '\n' : ''}${b.table}\n` : b).join(sep).replace(/\n{3,}/g, '\n\n').trim();

// 輸出圖片：同名就加流水號
function saver(zip, outDir) {
  const used = new Set(), files = [];
  return {
    files,
    save(part, name) {
      const data = zip.get(part); if (!data) return null;
      let n = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'), i = 2;
      while (used.has(n.toLowerCase())) n = name.replace(/(\.[^.]*)?$/, `-${i++}$1`);
      used.add(n.toLowerCase()); writeFileSync(join(outDir, n), data); files.push(n);
      return n;
    },
  };
}
const pad2 = n => String(n).padStart(2, '0');
const notViewable = list => list.filter(n => !VIEWABLE.test(n));

// ---- pptx ----
function pptx(zip, out) {
  const pres = 'ppt/presentation.xml', pr = rels(zip, pres), presXml = zip.text(pres) || '';
  let slides = [...presXml.matchAll(/<p:sldId\b([^>]*)>/g)].map(m => pr[attr(m[1], 'r:id')]?.target).filter(t => t && zip.has(t));
  if (!slides.length) slides = zip.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => a.match(/\d+/)[0] - b.match(/\d+/)[0]);
  const media = new Map(), img = saver(zip, out), parts = [], warnings = [];
  const bullet = (p, s) => { const ind = '  '.repeat(p.lvl || 0); return ind + '- ' + s.split('\n').join('\n' + ind + '  '); };
  slides.forEach((part, i) => {
    const no = i + 1, xml = zip.text(part), r = rels(zip, part), f = flow(xml, { para: bullet });
    const extra = [];
    for (const x of Object.values(r)) {
      if (x.type === 'diagramData' && zip.has(x.target)) { const d = flow(zip.text(x.target), { para: bullet }).blocks; if (d.length) extra.push('SmartArt：', joinBlocks(d, '\n')); }
    }
    const charts = Object.values(r).filter(x => x.type === 'chart').length;
    // 圖片依在投影片 XML 裡出現的順序（大致是疊放順序），不是關聯檔的順序
    const pics = [], seen = [...new Set([...xml.matchAll(/r:(?:embed|link|id)="([^"]+)"/g)].map(m => m[1]).concat(Object.keys(r)))];
    for (const x of seen.map(id => r[id]).filter(Boolean)) if (/^(image|video|media|audio)$/.test(x.type) && zip.has(x.target)) {
      if (!media.has(x.target)) media.set(x.target, img.save(x.target, `slide${pad2(no)}-${posix.basename(x.target)}`));
      if (!pics.includes(media.get(x.target))) pics.push(media.get(x.target));
    }
    const notesPart = Object.values(r).find(x => x.type === 'notesSlide')?.target;
    const notes = notesPart && zip.has(notesPart) ? joinBlocks(flow(zip.text(notesPart)).blocks, '\n') : '';
    const hidden = /<p:sld\b[^>]*\bshow="0"/.test(xml) ? '（隱藏）' : '';
    parts.push([`## 投影片 ${no}${f.title ? '：' + f.title : ''}${hidden}`, joinBlocks(f.blocks, '\n'), ...extra,
      charts ? `（含 ${charts} 個圖表，數據未抽出）` : '', pics.length ? `圖片：${pics.join('、')}` : '',
      notes ? '備忘稿：\n' + notes.split('\n').map(l => '> ' + l).join('\n') : ''].filter(Boolean).join('\n\n'));
  });
  const rest = [];
  for (const n of zip.names) if (n.startsWith('ppt/media/') && !media.has(n) && !n.endsWith('/')) rest.push(img.save(n, posix.basename(n)));
  if (rest.length) parts.push(`## 其他圖片\n\n沒有直接用在投影片上（母片、版面配置等）：${rest.join('、')}`);
  const nv = notViewable(img.files); if (nv.length) warnings.push(`${nv.length} 個媒體檔不是一般圖片（${nv.slice(0, 5).join('、')}），代理可能看不了`);
  return { head: `PowerPoint，${slides.length} 張投影片`, body: parts, images: img.files, count: { slides: slides.length }, warnings };
}

// ---- docx ----
function docx(zip, out) {
  const part = 'word/document.xml', xml = zip.text(part);
  if (!xml) throw new Error('找不到 word/document.xml');
  const r = rels(zip, part), img = saver(zip, out), media = new Map();
  // 標題樣式：styleId 依語系不同（中文版常是 "1"、"2"），從 styles.xml 的名稱判斷
  const heading = {};
  for (const m of (zip.text('word/styles.xml') || '').matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = attr(m[1], 'w:styleId'), nm = (m[2].match(/<w:name\s+w:val="([^"]*)"/)?.[1] || '').toLowerCase();
    const h = nm.match(/^heading (\d)$/);
    if (h) heading[id] = +h[1]; else if (nm === 'title') heading[id] = 0;
  }
  const image = id => {
    const x = r[id]; if (!x || !zip.has(x.target)) return null;
    if (!media.has(x.target)) media.set(x.target, img.save(x.target, posix.basename(x.target)));
    return media.get(x.target);
  };
  const para = (p, s) => {
    const h = heading[p.style] ?? (/^heading(\d)$/i.test(p.style || '') ? +p.style.slice(7) : null);
    if (h != null) return '#'.repeat(Math.min(6, Math.max(2, h + 1))) + ' ' + s.replace(/\s*\n\s*/g, ' ');
    if (p.list) { const ind = '  '.repeat(p.lvl || 0); return ind + '- ' + s.split('\n').join('\n' + ind + '  '); }
    return s;
  };
  const body = joinBlocks(flow(xml, { para, image }).blocks, '\n\n');
  const rest = [];
  for (const n of zip.names) if (n.startsWith('word/media/') && !media.has(n) && !n.endsWith('/')) rest.push(img.save(n, posix.basename(n)));
  const parts = [body, rest.length ? `## 其他圖片\n\n沒有出現在本文（頁首、頁尾等）：${rest.join('、')}` : ''];
  const warnings = [], nv = notViewable(img.files); if (nv.length) warnings.push(`${nv.length} 個媒體檔不是一般圖片（${nv.slice(0, 5).join('、')}），代理可能看不了`);
  return { head: 'Word', body: parts.filter(Boolean), images: img.files, count: {}, warnings };
}

// ---- xlsx ----
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const MAX_ROWS = 2000;
const unesc = s => s.replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
const plain = xml => unesc(decodeXml((xml || '').replace(/<(\w+:)?rPh\b[\s\S]*?<\/(\w+:)?rPh>/g, '').replace(/<(\w+:)?t\b[^>]*\/>/g, '')
  .match(/<(?:\w+:)?t\b[^>]*>[\s\S]*?<\/(?:\w+:)?t>/g)?.map(t => t.replace(/<[^>]+>/g, '')).join('') || ''));
const colNo = ref => { let n = 0; for (const c of ref.replace(/\d+/g, '').toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };
const colName = i => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
function serialDate(v, d1904) {
  const ms = Math.round((v - (d1904 ? 24107 : 25569)) * 864e5), d = new Date(ms), iso = d.toISOString();
  if (v < 1 && !d1904) return iso.slice(11, 19).replace(/:00$/, '');
  return Number.isInteger(v) ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
}
// 讀出各工作表的儲存格（公式只取快取值；日期與百分比依儲存格格式轉成文字）：[{ name, state, part, rows: [{ no, cells }], maxCol }]；rows 為 null 表示不是一般工作表
export function xlsxSheets(zip) {
  const wbPart = 'xl/workbook.xml', wb = zip.text(wbPart);
  if (!wb) throw new Error('找不到 xl/workbook.xml');
  const r = rels(zip, wbPart), d1904 = /<(?:\w+:)?workbookPr\b[^>]*date1904="(1|true)"/.test(wb);
  const shared = [...(zip.text('xl/sharedStrings.xml') || '').matchAll(/<(?:\w+:)?si\b[^>]*\/>|<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(m => plain(m[1]));
  // 儲存格格式：日期與百分比
  const st = zip.text('xl/styles.xml') || '', fmts = {};
  for (const m of st.matchAll(/<(?:\w+:)?numFmt\b([^>]*)\/?>/g)) fmts[attr(m[1], 'numFmtId')] = attr(m[1], 'formatCode') || '';
  const xfs = [...(st.match(/<(?:\w+:)?cellXfs\b[\s\S]*?<\/(?:\w+:)?cellXfs>/)?.[0] || '').matchAll(/<(?:\w+:)?xf\b([^>]*)>/g)].map(m => {
    const id = +attr(m[1], 'numFmtId') || 0, code = (fmts[id] || '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    if (DATE_IDS.has(id) || (fmts[id] && /[ymdhs]/i.test(code) && !/general/i.test(code))) return 'date';
    return id === 9 ? 0 : id === 10 ? 2 : code.includes('%') ? code.match(/\.(0+)/)?.[1].length || 0 : null;   // 百分比：小數位數
  });
  const num = (v, s) => {
    const x = +v; if (!Number.isFinite(x)) return v;
    if (xfs[s] === 'date') return serialDate(x, d1904);
    if (typeof xfs[s] === 'number') return (x * 100).toFixed(xfs[s]) + '%';
    return String(+x.toPrecision(15));
  };
  return [...wb.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)].map(m => ({ name: attr(m[1], 'name'), state: attr(m[1], 'state'), part: r[attr(m[1], 'r:id')] })).map(sh => {
    if (!sh.part || sh.part.type !== 'worksheet' || !zip.has(sh.part.target)) return { ...sh, rows: null, maxCol: -1 };
    const xml = zip.text(sh.part.target), rows = [];
    let maxCol = -1;
    for (const m of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
      if (!m[2]) continue;
      const rn = +attr(m[1], 'r') || (rows.at(-1)?.no ?? 0) + 1, cells = [];
      let ci = -1;
      for (const c of m[2].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const ref = attr(c[1], 'r'); ci = ref ? colNo(ref) : ci + 1;
        if (!c[2]) continue;
        const t = attr(c[1], 't'), s = +attr(c[1], 's') || 0, v = c[2].match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
        let val = t === 'inlineStr' ? plain(c[2].match(/<(?:\w+:)?is\b[\s\S]*?<\/(?:\w+:)?is>/)?.[0])
          : v == null ? '' : t === 's' ? shared[+v] ?? '' : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : t === 'str' || t === 'e' ? unesc(decodeXml(v)) : num(decodeXml(v), s);
        if (String(val).trim() === '') continue;
        cells[ci] = val; maxCol = Math.max(maxCol, ci);
      }
      if (cells.length) rows.push({ no: rn, cells });
    }
    return { ...sh, rows, maxCol };
  });
}
function xlsx(zip, out) {
  const sheets = xlsxSheets(zip);
  const img = saver(zip, out), media = new Map(), parts = [], warnings = [];
  let count = 0;
  sheets.forEach((sh, si) => {
    const head = `## 工作表 ${si + 1}：${sh.name}${sh.state && sh.state !== 'visible' ? '（隱藏）' : ''}`;
    if (!sh.rows) { parts.push(`${head}\n\n（${sh.part?.type === 'chartsheet' ? '圖表工作表，數據未抽出' : '找不到內容'}）`); return; }
    count++;
    const rows = sh.rows.slice(0, MAX_ROWS), truncated = sh.rows.length - rows.length, maxCol = sh.maxCol;
    // 圖片：工作表 → drawing → 圖片，標出錨點儲存格
    const pics = [];
    for (const x of Object.values(rels(zip, sh.part.target))) if (x.type === 'drawing' && zip.has(x.target)) {
      const dr = rels(zip, x.target);
      for (const a of (zip.text(x.target) || '').matchAll(/<xdr:(?:twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor|absoluteAnchor)>/g)) {
        const id = a[0].match(/r:embed="([^"]+)"/)?.[1], tg = dr[id]?.target;
        if (!tg || !zip.has(tg)) continue;
        const col = a[0].match(/<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
        if (!media.has(tg)) media.set(tg, img.save(tg, `sheet${si + 1}-${posix.basename(tg)}`));
        pics.push(media.get(tg) + (col ? `（${colName(+col[1])}${+col[2] + 1}）` : ''));
      }
    }
    const header = ['', ...Array.from({ length: maxCol + 1 }, (_, i) => colName(i))];
    const table = rows.length ? mdTable(rows.map(x => [String(x.no), ...Array.from({ length: maxCol + 1 }, (_, i) => x.cells[i] ?? '')]), header) : '（空白）';
    parts.push([head, table, truncated ? `（另有 ${truncated} 列未列出，只列前 ${MAX_ROWS} 列）` : '', pics.length ? `圖片：${pics.join('、')}` : ''].filter(Boolean).join('\n\n'));
  });
  const rest = [];
  for (const n of zip.names) if (n.startsWith('xl/media/') && !media.has(n) && !n.endsWith('/')) rest.push(img.save(n, posix.basename(n)));
  if (rest.length) parts.push(`## 其他圖片\n\n沒有對應到工作表的繪圖（儲存格內圖片等）：${rest.join('、')}`);
  return { head: `Excel，${sheets.length} 個工作表`, body: parts, images: img.files, count: { sheets: count }, warnings };
}

// 抽出一個 Office 檔到 outDir；回傳 { kind, dir, images, summary, warnings, ... }。檔案損壞時丟出錯誤
export function extractOffice(file, outDir, name = posix.basename(file.replace(/\\/g, '/'))) {
  const kind = kindOf(name);
  if (!kind) throw new Error('不支援的格式');
  const zip = readZip(readFileSync(file));
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = { pptx, docx, xlsx }[kind](zip, outDir);
  const md = [`# ${name}（${r.head}）`, '由 vs3d 自動抽出：文字依原檔順序，圖片在同一資料夾。版面、圖表數據、文字方塊位置不會保留，需要時請使用者提供截圖或 PDF。', ...r.body].join('\n\n');
  writeFileSync(join(outDir, 'text.md'), md.replace(/\n{3,}/g, '\n\n') + '\n');
  const summary = [r.count.slides != null && `${r.count.slides} 張投影片`, r.count.sheets != null && `${r.count.sheets} 個工作表`, `${r.images.length - notViewable(r.images).length} 張圖`,
    notViewable(r.images).length && `${notViewable(r.images).length} 個其他媒體檔`].filter(Boolean).join('、');
  return { kind, dir: outDir, images: r.images, ...r.count, summary, warnings: r.warnings };
}

// 上傳檔整批處理：Office 檔抽到 docs/<檔名>.extract/，舊格式只提示。失敗不丟錯，記在 notes
//   回傳 { info: { 檔名: 給代理看的附註 }, notes: [給使用者看的訊息] }
export function extractUploads(docs, names) {
  const info = {}, notes = [];
  for (const n of names) {
    if (OLD_OFFICE.test(n)) {
      const ext = n.match(OLD_OFFICE)[1].toLowerCase();
      info[n] = `舊版格式，app 無法抽出內容`;
      notes.push(`${n}：舊版 Office 格式無法自動抽出內容，請另存成 ${NEW_EXT[ext]} 後重新上傳`);
      continue;
    }
    if (!OFFICE.test(n)) continue;
    try {
      const r = extractOffice(join(docs, n), join(docs, n + '.extract'), n);
      info[n] = `已抽出文字與圖片：\`docs/${n}.extract/text.md\`，${r.summary}`;
      notes.push(`${n}：已抽出 ${r.summary} → docs/${n}.extract/`);
      for (const w of r.warnings) notes.push(`${n}：${w}`);
    } catch (e) {
      rmSync(join(docs, n + '.extract'), { recursive: true, force: true });
      info[n] = '無法抽出內容';
      notes.push(`警告：${n} 無法抽出內容（${e.message}），代理只能看到原檔`);
    }
  }
  return { info, notes };
}
