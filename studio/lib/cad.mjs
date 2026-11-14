// CAD 與圖面的預處理（2026-11-14，C 項）：代理讀不了 DXF、STEP，建立專案時（或 vs3d extract）由 app 抽成文字與預覽圖，
//   和 Office 檔一樣放在 docs/<檔名>.extract/（text.md＋圖片）。純 Node，不加套件；預覽圖用軟體光柵化，輸出 PNG（core/tools/png.mjs）。
//   DXF：文字與二進位都支援（R13 以後）；線、聚合線（含弧度）、圓、弧、橢圓、雲形線、3D 面、圖塊插入（巢狀、縮放、旋轉）、
//        尺寸標註（量測值）、文字。字碼依 $ACADVER／$DWGCODEPAGE（2007 以前的檔常是 Big5）。剖面線（HATCH）只計數不畫。
//   STEP：檔頭（不含作者、公司欄位）、長度單位、零件名稱、組立數；外形尺寸用所有座標點估（沒有套組立的位移，標「近似」）。
//        有 occt-import-js（VS3D_OCCT 或本庫 TEMP/occt/node_modules/occt-import-js）時改用實際網格：精確外形、每個零件的尺寸、四個視角的預覽圖。
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { encodePng } from '../../core/tools/png.mjs';
import { REPO } from './util.mjs';

export const CAD = /\.(dxf|step|stp)$/i;

// ---------------------------------------------------------------- 光柵化（白底）
// encodePng 要 { width, height, data: Buffer（RGBA） }
function canvas(w, h) { return { w, h, width: w, height: h, data: Buffer.alloc(w * h * 4, 255) }; }
function plot(c, x, y, [r, g, b]) { if (x < 0 || y < 0 || x >= c.w || y >= c.h) return; const i = (y * c.w + x) * 4; c.data[i] = r; c.data[i + 1] = g; c.data[i + 2] = b; }
// Liang–Barsky 先裁到畫布內，再用 Bresenham 畫
function line(c, x0, y0, x1, y1, rgb) {
  let t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
  for (const [p, q] of [[-dx, x0], [dx, c.w - 1 - x0], [-dy, y0], [dy, c.h - 1 - y0]]) {
    if (p === 0) { if (q < 0) return; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return; if (r > t0) t0 = r; } else { if (r < t0) return; if (r < t1) t1 = r; }
  }
  let ax = Math.round(x0 + t0 * dx), ay = Math.round(y0 + t0 * dy); const bx = Math.round(x0 + t1 * dx), by = Math.round(y0 + t1 * dy);
  const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1, ddx = Math.abs(bx - ax), ddy = -Math.abs(by - ay);
  let err = ddx + ddy;
  for (let n = 0; n < 100000; n++) {
    plot(c, ax, ay, rgb);
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= ddy) { err += ddy; ax += sx; }
    if (e2 <= ddx) { err += ddx; ay += sy; }
  }
}
// 圖層的顏色：名稱雜湊成深色（白底看得清楚）
const layerColor = name => { let h = 2166136261; for (const ch of String(name)) h = Math.imul(h ^ ch.codePointAt(0), 16777619); h >>>= 0; return [(h & 0x7f) + 10, ((h >> 8) & 0x7f) + 10, ((h >> 16) & 0x7f) + 30]; };

// ---------------------------------------------------------------- DXF：讀成 (群組碼, 值) 對
const BIN_SENTINEL = Buffer.from('AutoCAD Binary DXF\r\n\x1a\0', 'latin1');
function codeType(c) {
  if ((c >= 10 && c <= 59) || (c >= 110 && c <= 149) || (c >= 210 && c <= 239) || (c >= 460 && c <= 469) || (c >= 1010 && c <= 1059)) return 'd';
  if ((c >= 60 && c <= 79) || (c >= 170 && c <= 179) || (c >= 270 && c <= 289) || (c >= 370 && c <= 389) || (c >= 400 && c <= 409) || (c >= 1060 && c <= 1070)) return 'h';
  if ((c >= 90 && c <= 99) || (c >= 420 && c <= 429) || (c >= 440 && c <= 449) || c === 1071) return 'i';
  if (c >= 160 && c <= 169) return 'l';
  if (c >= 290 && c <= 299) return 'b';
  if ((c >= 310 && c <= 319) || c === 1004) return 'x';
  return 's';
}
// 字串值給 Buffer（字碼等讀完檔頭再決定），數值給 number
function forEachPair(buf, cb) {
  if (buf.subarray(0, BIN_SENTINEL.length).equals(BIN_SENTINEL)) {
    let p = BIN_SENTINEL.length;
    while (p + 2 <= buf.length) {
      const code = buf.readUInt16LE(p); p += 2;
      let v;
      switch (codeType(code)) {
        case 'd': v = buf.readDoubleLE(p); p += 8; break;
        case 'h': v = buf.readInt16LE(p); p += 2; break;
        case 'i': v = buf.readInt32LE(p); p += 4; break;
        case 'l': v = Number(buf.readBigInt64LE(p)); p += 8; break;
        case 'b': v = buf[p]; p += 1; break;
        case 'x': v = null; p += 1 + buf[p]; break;
        default: { const e = buf.indexOf(0, p); v = buf.subarray(p, e < 0 ? buf.length : e); p = e < 0 ? buf.length : e + 1; }
      }
      if (cb(code, v) === false) return 'binary';
    }
    return 'binary';
  }
  let p = 0;
  const next = () => { if (p >= buf.length) return null; let e = buf.indexOf(10, p); if (e < 0) e = buf.length; let s = p, t = e; if (t > s && buf[t - 1] === 13) t--; p = e + 1; return buf.subarray(s, t); };
  for (;;) {
    const cl = next(); if (cl === null) break;
    const vl = next(); if (vl === null) break;
    const code = parseInt(cl.toString('latin1').trim(), 10);
    if (!Number.isFinite(code)) continue;
    const t = codeType(code), v = t === 's' || t === 'x' ? vl : Number(vl.toString('latin1').trim());
    if (cb(code, v) === false) break;
  }
  return 'text';
}

const CODEPAGES = { ANSI_950: 'big5', ANSI_936: 'gbk', ANSI_932: 'shift_jis', ANSI_949: 'euc-kr', ANSI_1252: 'windows-1252', ANSI_1250: 'windows-1250', ANSI_1251: 'windows-1251' };
const UNITS = { 0: ['無單位', null], 1: ['英吋', 25.4], 2: ['英呎', 304.8], 4: ['mm', 1], 5: ['cm', 10], 6: ['m', 1000], 14: ['dm', 100] };
const cleanMtext = s => s.replace(/\\[Pp]/g, ' ').replace(/\\[A-Za-z][^;\\{}]*;/g, '').replace(/\\[LlOoKk]/g, '').replace(/[{}]/g, '').replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').trim();

// 一個實體的群組碼收集成 { 碼: [值…] }
const add = (e, c, v) => { (e.g[c] ||= []).push(v); };
const g1 = (e, c, d = 0) => e.g[c]?.[0] ?? d;

// 實體 → 圖元（在圖塊或模型空間的座標）：poly（點列）、text、insert、dim
function primitives(e, dec, out) {
  const layer = e.layer, T = e.type;
  const poly = (pts, closed = false) => { if (pts.length >= 4) out.push({ k: 'poly', layer, pts: closed ? [...pts, pts[0], pts[1]] : pts }); };
  const arcPts = (cx, cy, r, a0, a1) => { let sweep = a1 - a0; while (sweep <= 0) sweep += Math.PI * 2; const n = Math.max(4, Math.ceil(sweep / (Math.PI / 18))), pts = []; for (let i = 0; i <= n; i++) { const a = a0 + sweep * i / n; pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); } return pts; };
  if (T === 'LINE') poly([g1(e, 10), g1(e, 20), g1(e, 11), g1(e, 21)]);
  else if (T === 'CIRCLE') poly(arcPts(g1(e, 10), g1(e, 20), g1(e, 40), 0, Math.PI * 2));
  else if (T === 'ARC') poly(arcPts(g1(e, 10), g1(e, 20), g1(e, 40), g1(e, 50) * Math.PI / 180, g1(e, 51) * Math.PI / 180));
  else if (T === 'LWPOLYLINE') {
    const xs = e.g[10] || [], ys = e.g[20] || [], bulge = e.seqBulge || [], closed = (g1(e, 70) & 1) === 1, pts = [];
    const n = xs.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, b = bulge[i] || 0;
      pts.push(xs[i], ys[i]);
      if (b && (j > i || closed)) {      // 弧段：bulge = tan(夾角/4)，正值逆時針
        const x1 = xs[i], y1 = ys[i], x2 = xs[j], y2 = ys[j], dx = x2 - x1, dy = y2 - y1, ch = Math.hypot(dx, dy);
        if (ch > 0) {
          const th = 4 * Math.atan(b), k = (ch / 2) / Math.tan(th / 2), cx = (x1 + x2) / 2 - dy / ch * k, cy = (y1 + y2) / 2 + dx / ch * k, r = Math.hypot(x1 - cx, y1 - cy);
          const a0 = Math.atan2(y1 - cy, x1 - cx), m = Math.max(2, Math.ceil(Math.abs(th) / (Math.PI / 18)));
          for (let s = 1; s < m; s++) { const a = a0 + th * s / m; pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
        }
      }
    }
    poly(pts, closed);
  } else if (T === 'POLYLINE') poly(e.vertices || [], (g1(e, 70) & 1) === 1);
  else if (T === 'ELLIPSE') {
    const cx = g1(e, 10), cy = g1(e, 20), mx = g1(e, 11), my = g1(e, 21), ratio = g1(e, 40, 1), t0 = g1(e, 41, 0), t1 = g1(e, 42, Math.PI * 2);
    let sweep = t1 - t0; while (sweep <= 0) sweep += Math.PI * 2;
    const n = Math.max(8, Math.ceil(sweep / (Math.PI / 18))), pts = [];
    for (let i = 0; i <= n; i++) { const t = t0 + sweep * i / n, c = Math.cos(t), s = Math.sin(t); pts.push(cx + mx * c - my * ratio * s, cy + my * c + mx * ratio * s); }
    poly(pts);
  } else if (T === 'SPLINE') {
    const fx = e.g[11] || [], fy = e.g[21] || [], cx = e.g[10] || [], cy = e.g[20] || [];
    const [xs, ys] = fx.length >= 2 ? [fx, fy] : [cx, cy], pts = [];
    for (let i = 0; i < xs.length; i++) pts.push(xs[i], ys[i]);
    poly(pts);
  } else if (T === '3DFACE' || T === 'SOLID' || T === 'TRACE') {
    const pts = [g1(e, 10), g1(e, 20), g1(e, 11), g1(e, 21), g1(e, 13, g1(e, 12)), g1(e, 23, g1(e, 22)), g1(e, 12), g1(e, 22)];
    poly(pts, true);
  } else if (T === 'TEXT' || T === 'MTEXT' || T === 'ATTRIB') {
    const s = cleanMtext([...(e.g[3] || []), ...(e.g[1] || [])].map(dec).join(''));
    if (s) out.push({ k: 'text', layer, x: g1(e, 10), y: g1(e, 20), s });
  } else if (T === 'INSERT') {
    out.push({ k: 'insert', layer, name: dec(e.g[2]?.[0] || Buffer.alloc(0)), x: g1(e, 10), y: g1(e, 20), sx: g1(e, 41, 1) || 1, sy: g1(e, 42, 1) || 1, rot: g1(e, 50) * Math.PI / 180 });
  } else if (T === 'DIMENSION') {
    const t = e.g[1]?.[0] ? cleanMtext(dec(e.g[1][0])) : '';
    out.push({ k: 'dim', layer, value: g1(e, 42, null), text: t && t !== '<>' ? t : '', x: g1(e, 11, g1(e, 10)), y: g1(e, 21, g1(e, 20)) });
    if (e.g[2]?.[0]) out.push({ k: 'insert', layer, name: dec(e.g[2][0]), x: 0, y: 0, sx: 1, sy: 1, rot: 0, dim: true });
  } else return false;
  return true;
}

export function parseDxf(buf) {
  // 檔頭先用 latin1 讀（只需要版本、字碼、單位、範圍）
  const head = { acadver: '', codepage: '', insunits: null };
  let sect = null, hvar = null;
  forEachPair(buf, (c, v) => {
    if (c === 0) { const s = v.toString('latin1').trim(); if (s === 'ENDSEC' && sect === 'HEADER') return false; sect = s === 'SECTION' ? '?' : sect; return; }
    if (c === 2 && sect === '?') { sect = v.toString('latin1'); return; }
    if (sect !== 'HEADER') return;
    if (c === 9) { hvar = v.toString('latin1'); return; }
    if (hvar === '$ACADVER' && c === 1) head.acadver = v.toString('latin1');
    if (hvar === '$DWGCODEPAGE' && c === 3) head.codepage = v.toString('latin1');
    if (hvar === '$INSUNITS' && c === 70) head.insunits = v;
  });
  const utf8 = head.acadver >= 'AC1021', label = utf8 ? 'utf-8' : CODEPAGES[head.codepage] || 'latin1';
  let td; try { td = new TextDecoder(label); } catch { td = new TextDecoder('latin1'); }
  const dec = b => b ? cleanMtext(td.decode(b)) : '';

  const blocks = new Map(), model = [], counts = { entities: 0, skipped: {} }, layers = new Map();
  let cur = null, curBlock = null, blockOut = null, poly = null;
  sect = null;
  const finish = () => {
    if (!cur) return;
    const e = cur; cur = null;
    if (e.type === 'VERTEX' && poly) { poly.vertices.push(g1(e, 10), g1(e, 20)); return; }
    if (e.type === 'SEQEND' && poly) { const p = poly; poly = null; primitives(p, dec, blockOut || model); return; }
    if (e.type === 'POLYLINE') { e.vertices = []; poly = e; return; }
    if (e.type === 'BLOCK') { curBlock = { name: dec(e.g[2]?.[0]), bx: g1(e, 10), by: g1(e, 20), items: [] }; blockOut = curBlock.items; return; }
    if (e.type === 'ENDBLK') { if (curBlock) blocks.set(curBlock.name, curBlock); curBlock = null; blockOut = null; return; }
    if (sect !== 'ENTITIES' && sect !== 'BLOCKS') return;
    counts.entities++;
    if (sect === 'ENTITIES') layers.set(e.layer, (layers.get(e.layer) || 0) + 1);
    if (!primitives(e, dec, blockOut || model)) counts.skipped[e.type] = (counts.skipped[e.type] || 0) + 1;
  };
  forEachPair(buf, (c, v) => {
    if (c === 0) {
      finish();
      const s = v.toString('latin1').trim();
      if (s === 'SECTION') { sect = '?'; return; }
      if (s === 'ENDSEC') { sect = null; return; }
      if (s === 'EOF') return false;
      if (sect === 'ENTITIES' || sect === 'BLOCKS') cur = { type: s, layer: '0', g: {} };
      return;
    }
    if (sect === '?' && c === 2) { sect = v.toString('latin1'); return; }
    if (!cur) return;
    if (c === 8) { cur.layer = dec(v); return; }
    // LWPOLYLINE 的 bulge（42）跟著頂點走，沒有 bulge 的頂點要補 0 才對得上
    if (cur.type === 'LWPOLYLINE' && c === 10) { (cur.seqBulge ||= []).push(0); }
    if (cur.type === 'LWPOLYLINE' && c === 42) { cur.seqBulge[cur.seqBulge.length - 1] = v; return; }
    if ([1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23, 40, 41, 42, 50, 51, 70].includes(c)) add(cur, c, v);
  });
  finish();
  const u = UNITS[head.insunits] || null;
  return { version: head.acadver, codepage: head.codepage, encoding: label, units: u ? u[0] : head.insunits == null ? '未標示' : `代碼 ${head.insunits}`, mmPerUnit: u ? u[1] : null, blocks, model, counts, layers };
}

// 圖元展開成世界座標，逐一交給 visit（圖塊巢狀最多 6 層、總數上限避免炸掉）
function walkDxf(d, visit, limit = 3e6) {
  let n = 0;
  const go = (items, m, depth, layerOverride) => {
    for (const it of items) {
      if (++n > limit) return;
      const layer = it.layer === '0' && layerOverride ? layerOverride : it.layer;
      if (it.k === 'insert') {
        const b = d.blocks.get(it.name);
        if (!b || depth > 6) continue;
        const c = Math.cos(it.rot), s = Math.sin(it.rot);
        // 子座標 → 插入點：先減圖塊基準點、縮放、旋轉、平移，再套上層矩陣
        const L = [c * it.sx, s * it.sx, -s * it.sy, c * it.sy, it.x - (c * it.sx * b.bx - s * it.sy * b.by), it.y - (s * it.sx * b.bx + c * it.sy * b.by)];
        const M = [m[0] * L[0] + m[2] * L[1], m[1] * L[0] + m[3] * L[1], m[0] * L[2] + m[2] * L[3], m[1] * L[2] + m[3] * L[3], m[0] * L[4] + m[2] * L[5] + m[4], m[1] * L[4] + m[3] * L[5] + m[5]];
        visit({ k: 'insertRef', name: it.name, dim: it.dim });
        go(b.items, M, depth + 1, layer);
        continue;
      }
      const tx = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
      if (it.k === 'poly') { const p = new Array(it.pts.length); for (let i = 0; i < it.pts.length; i += 2) { const [x, y] = tx(it.pts[i], it.pts[i + 1]); p[i] = x; p[i + 1] = y; } visit({ k: 'poly', layer, pts: p }); }
      else { const [x, y] = tx(it.x, it.y); visit({ ...it, layer, x, y }); }
    }
  };
  go(d.model, [1, 0, 0, 1, 0, 0], 0, null);
  return n > limit;
}

function renderDxf(d, box, size) {
  const W = box.x1 - box.x0 || 1, H = box.y1 - box.y0 || 1, s = Math.min(size / W, size / H), w = Math.max(64, Math.round(W * s)), h = Math.max(64, Math.round(H * s));
  const c = canvas(w, h);
  walkDxf(d, it => {
    if (it.k !== 'poly') return;
    const col = layerColor(it.layer), p = it.pts;
    for (let i = 0; i + 3 < p.length; i += 2) line(c, (p[i] - box.x0) * s, h - 1 - (p[i + 1] - box.y0) * s, (p[i + 2] - box.x0) * s, h - 1 - (p[i + 3] - box.y0) * s, col);
  });
  return encodePng(c);
}

export function extractDxf(file, outDir, name) {
  const d = parseDxf(readFileSync(file));
  // 範圍：全部點的外框，另外用各圖元第一點的 0.5%～99.5% 分位數排除零星的遠點（常見於圖框外的殘留物件）
  const xs = [], ys = [], all = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }, texts = [], dims = [], inserts = new Map(), layerPrims = new Map();
  const truncated = walkDxf(d, it => {
    if (it.k === 'insertRef') { if (!it.dim) inserts.set(it.name, (inserts.get(it.name) || 0) + 1); return; }
    const pts = it.k === 'poly' ? it.pts : [it.x, it.y];
    for (let i = 0; i < pts.length; i += 2) { const x = pts[i], y = pts[i + 1]; if (!Number.isFinite(x) || !Number.isFinite(y)) continue; if (x < all.x0) all.x0 = x; if (x > all.x1) all.x1 = x; if (y < all.y0) all.y0 = y; if (y > all.y1) all.y1 = y; }
    if (Number.isFinite(pts[0])) { xs.push(pts[0]); ys.push(pts[1]); }
    layerPrims.set(it.layer, (layerPrims.get(it.layer) || 0) + 1);
    if (it.k === 'text' && texts.length < 5000) texts.push(it);
    if (it.k === 'dim' && dims.length < 2000) dims.push(it);
  });
  if (!xs.length) throw new Error('沒有可以畫的圖元');
  const q = (a, f) => { const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.floor(f * (s.length - 1))))]; };
  const core = { x0: q(xs, .005), x1: q(xs, .995), y0: q(ys, .005), y1: q(ys, .995) };
  const pad = Math.max(core.x1 - core.x0, core.y1 - core.y0) * .03;
  const box = { x0: core.x0 - pad, x1: core.x1 + pad, y0: core.y0 - pad, y1: core.y1 + pad };
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const images = ['preview.png'];
  writeFileSync(join(outDir, 'preview.png'), renderDxf(d, box, 2000));
  // 四個象限的放大圖（大圖面的細節）
  const mx = (box.x0 + box.x1) / 2, my = (box.y0 + box.y1) / 2;
  [['左上', box.x0, mx, my, box.y1], ['右上', mx, box.x1, my, box.y1], ['左下', box.x0, mx, box.y0, my], ['右下', mx, box.x1, box.y0, my]].forEach(([n, x0, x1, y0, y1], i) => {
    const f = `tile-${i + 1}.png`; writeFileSync(join(outDir, f), renderDxf(d, { x0, x1, y0, y1 }, 1600)); images.push(`${f}（${n}）`);
  });
  const u = d.mmPerUnit, size = (a, b) => `${fmt(b - a)}${u ? `（${fmt((b - a) * u / 1000)} m）` : ''}`;
  const uniq = new Map(); for (const t of texts) if (!uniq.has(t.s)) uniq.set(t.s, t);
  const md = [`# ${name}（DXF 圖面）`, '', '由 vs3d 自動抽出：線條畫成預覽圖（顏色依圖層），文字與尺寸列在下面；剖面線、填色、線型、字型不畫。座標是圖面單位。', '',
    `- 版本 ${d.version || '不明'}，字碼 ${d.encoding}；單位：${d.units}${u ? `（1 單位 = ${u} mm）` : '（請向使用者確認單位）'}`,
    `- 範圍（排除零星遠點）：寬 ${size(box.x0 + pad, box.x1 - pad)} × 高 ${size(box.y0 + pad, box.y1 - pad)}；X ${fmt(core.x0)}～${fmt(core.x1)}、Y ${fmt(core.y0)}～${fmt(core.y1)}`,
    `- 全部圖元的外框：X ${fmt(all.x0)}～${fmt(all.x1)}、Y ${fmt(all.y0)}～${fmt(all.y1)}`,
    `- 實體 ${d.counts.entities} 個${Object.keys(d.counts.skipped).length ? `；沒畫的：${Object.entries(d.counts.skipped).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join('、')}` : ''}${truncated ? '；圖元太多，只處理前 300 萬個' : ''}`,
    `- 預覽圖：${images.map(f => '`' + f.replace(/（.*/, '') + '`' + (f.includes('（') ? f.slice(f.indexOf('（')) : '')).join('、')}（用讀檔工具開啟）`, '',
    '## 圖層（圖元數）', '', ...[...layerPrims].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k, v]) => `- ${k || '0'}：${v}`), '',
    inserts.size ? ['## 圖塊插入（次數）', '', ...[...inserts].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `- ${k}：${v}`), ''].join('\n') : null,
    dims.length ? ['## 尺寸標註（量測值，圖面單位）', '', ...dims.slice(0, 300).map(t => `- ${t.text ? `${t.text}（量測 ${fmt(t.value)}）` : fmt(t.value)}　@(${fmt(t.x)}, ${fmt(t.y)})　[${t.layer}]`), ...(dims.length > 300 ? [`- …共 ${dims.length} 個`] : []), ''].join('\n') : null,
    uniq.size ? ['## 文字（不重複，含位置）', '', ...[...uniq.values()].slice(0, 400).map(t => `- ${t.s.slice(0, 120)}　@(${fmt(t.x)}, ${fmt(t.y)})　[${t.layer}]`), ...(uniq.size > 400 ? [`- …共 ${uniq.size} 種`] : []), ''].join('\n') : null,
    uniq.size || dims.length ? null : '圖面裡沒有文字與尺寸實體（可能已經炸開成線條，看預覽圖）。',
  ].filter(x => x !== null).join('\n');
  writeFileSync(join(outDir, 'text.md'), md + '\n');
  return { dir: outDir, images, summary: `DXF 預覽圖 ${images.length} 張、${uniq.size} 種文字、${dims.length} 個尺寸` };
}
const fmt = v => v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : +v.toFixed(2) + '';

// ---------------------------------------------------------------- STEP
// STEP 字串的跳脫：\X2\hhhh…\X0\（UTF-16）、\X\hh（latin1）、''（單引號）；有些匯出程式把反斜線再跳脫成 \\，兩種都認
const stepStr = s => s.replace(/\\{1,2}X2\\{1,2}([0-9A-F]+)\\{1,2}X0\\{1,2}/gi, (m, h) => String.fromCharCode(...h.match(/.{4}/g).map(x => parseInt(x, 16)))).replace(/\\{1,2}X\\{1,2}([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/''/g, "'");
export function parseStep(text) {
  const head = /FILE_NAME\s*\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*\([^)]*\)\s*,\s*\([^)]*\)\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'/.exec(text);
  const schema = /FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/.exec(text)?.[1] || '';
  const si = /SI_UNIT\s*\(\s*(?:\.(\w+)\.|\$)\s*,\s*\.METRE\.\s*\)/.exec(text), conv = /CONVERSION_BASED_UNIT\s*\(\s*'([^']+)'/.exec(text);
  const prefix = si?.[1] || '', unit = conv ? conv[1] : `${{ MILLI: 'mm', CENTI: 'cm', '': 'm' }[prefix] ?? prefix.toLowerCase() + 'm'}`;
  const mm = conv ? (/MILLI/i.test(conv[1]) ? 1 : /CENTI/i.test(conv[1]) ? 10 : /INCH/i.test(conv[1]) ? 25.4 : /FOOT|FEET/i.test(conv[1]) ? 304.8 : /METRE|METER/i.test(conv[1]) ? 1000 : null) : { MILLI: 1, CENTI: 10, '': 1000 }[prefix] ?? null;
  const products = new Set();
  for (const m of text.matchAll(/=\s*PRODUCT\s*\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'/g)) products.add(stepStr(m[2] || m[1]).trim() || stepStr(m[1]).trim());
  const nauo = (text.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g) || []).length, solids = (text.match(/MANIFOLD_SOLID_BREP|BREP_WITH_VOIDS/g) || []).length;
  const box = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
  for (const m of text.matchAll(/CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-\d.Ee+]+)\s*,\s*([-\d.Ee+]+)\s*,\s*([-\d.Ee+]+)\s*\)/g)) {
    const [x, y, z] = [+m[1], +m[2], +m[3]];
    if (x < box.x0) box.x0 = x; if (x > box.x1) box.x1 = x; if (y < box.y0) box.y0 = y; if (y > box.y1) box.y1 = y; if (z < box.z0) box.z0 = z; if (z > box.z1) box.z1 = z;
  }
  return { name: head ? stepStr(head[1]) : '', time: head?.[2] || '', preprocessor: head ? stepStr(head[3]) : '', system: head ? stepStr(head[4]) : '', schema, unit, mm, products: [...products].filter(Boolean), nauo, solids, box: Number.isFinite(box.x0) ? box : null };
}

export function findOcct(env = process.env) {
  const dir = env.VS3D_OCCT || join(REPO, 'TEMP', 'occt', 'node_modules', 'occt-import-js');
  return existsSync(join(dir, 'package.json')) ? dir : null;
}

// 網格的軟體光柵化（z-buffer、平面打光）；view：iso、front（看 -Z…+Z 方向的 XY 平面）、top、right
function renderMeshes(meshes, view, size = 1000) {
  const R = { iso: [Math.PI / 4, Math.atan(1 / Math.SQRT2)], front: [0, 0], right: [Math.PI / 2, 0], top: [0, Math.PI / 2] }[view];
  const [yaw, pitch] = R, cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // 世界座標（STEP 多半 Z 朝上）→ 觀察座標：先繞 Z 轉 yaw，再往下俯 pitch；u 右、v 上、w 朝向觀察者
  const proj = (x, y, z) => { const a = x * cy - y * sy, b = x * sy + y * cy; return [a, z * cp + b * sp, -z * sp + b * cp]; };
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  const P = meshes.map(m => { const p = m.pos, o = new Float64Array(p.length); for (let i = 0; i < p.length; i += 3) { const [u, v, w] = proj(p[i], p[i + 1], p[i + 2]); o[i] = u; o[i + 1] = v; o[i + 2] = -w; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; } return o; });
  const pad = .05, W = u1 - u0 || 1, H = v1 - v0 || 1, s = size * (1 - 2 * pad) / Math.max(W, H), w = Math.round(W * s + size * 2 * pad), h = Math.round(H * s + size * 2 * pad);
  const c = canvas(w, h), zb = new Float64Array(w * h).fill(-Infinity), L = [-.4, .55, .73];
  const X = u => (u - u0) * s + size * pad, Y = v => h - 1 - ((v - v0) * s + size * pad);
  meshes.forEach((m, mi) => {
    const p = P[mi], I = m.idx, col = m.color || [170, 176, 186];
    for (let t = 0; t + 2 < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, d = I[t + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[d] - p[a], vy = p[d + 1] - p[a + 1], vz = p[d + 2] - p[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const shade = .35 + .65 * Math.abs(nx * L[0] + ny * L[1] + nz * L[2]), rgb = col.map(v => Math.min(255, Math.round(v * shade)));
      const x0 = X(p[a]), y0 = Y(p[a + 1]), x1 = X(p[b]), y1 = Y(p[b + 1]), x2 = X(p[d]), y2 = Y(p[d + 1]);
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0); if (!area) continue;
      const minx = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxx = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2))), miny = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxy = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)));
      for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
        const px = x + .5, py = y + .5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area, w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area, w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * p[a + 2] + w1 * p[b + 2] + w2 * p[d + 2], k = y * w + x;
        if (z <= zb[k]) continue;
        zb[k] = z; const i = k * 4; c.data[i] = rgb[0]; c.data[i + 1] = rgb[1]; c.data[i + 2] = rgb[2];
      }
    }
  });
  return encodePng(c);
}

export async function extractStep(file, outDir, name, { occtDir = findOcct() } = {}) {
  const buf = readFileSync(file), st = parseStep(buf.toString('latin1'));
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const L = [`# ${name}（STEP 3D 模型）`, '', '由 vs3d 自動抽出。檔頭的作者與公司欄位不列出。', '',
    `- 格式 ${st.schema || '不明'}；產生程式 ${[st.system, st.preprocessor].filter(Boolean).join('／') || '不明'}${st.time ? `；時間 ${st.time.slice(0, 10)}` : ''}`,
    `- 長度單位：${st.unit}${st.mm ? `（1 單位 = ${st.mm} mm）` : ''}；實體 ${st.solids} 個、組立關係 ${st.nauo} 個`,
    `- 零件名稱（${st.products.length}）：${st.products.slice(0, 40).join('、') || '（沒有）'}${st.products.length > 40 ? '…' : ''}`];
  const images = [];
  let meshes = null, warn = '';
  if (occtDir) {
    try {
      const occt = await createRequire(join(occtDir, 'package.json'))('occt-import-js')();
      const r = occt.ReadStepFile(new Uint8Array(buf), { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: .002, angularDeflection: .5 });
      if (r.success && r.meshes.length) meshes = r.meshes.map(m => ({ name: m.name || '', pos: m.attributes.position.array, idx: m.index.array, color: m.color ? m.color.map(v => Math.round(v * 255)) : null }));
      else warn = 'occt-import-js 讀不了這個檔';
    } catch (e) { warn = `occt-import-js 執行失敗（${e.message}）`; }
  }
  if (meshes) {
    const bb = ms => { const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (const m of ms) for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = m.pos[i + k]; if (v < b[k]) b[k] = v; if (v > b[k + 3]) b[k + 3] = v; } return b; };
    const B = bb(meshes), dims = b => [b[3] - b[0], b[4] - b[1], b[5] - b[2]].map(v => fmt(v)).join(' × ');
    L.push(`- 外形（實際網格，mm）：${dims(B)}（X × Y × Z）；X ${fmt(B[0])}～${fmt(B[3])}、Y ${fmt(B[1])}～${fmt(B[4])}、Z ${fmt(B[2])}～${fmt(B[5])}`,
      `- 網格：${meshes.length} 個零件、${meshes.reduce((a, m) => a + m.idx.length / 3, 0).toLocaleString('en-US')} 個三角形`);
    for (const v of ['iso', 'front', 'right', 'top']) { writeFileSync(join(outDir, `${v}.png`), renderMeshes(meshes, v)); images.push(`${v}.png`); }
    L.push(`- 預覽圖：${images.map(f => '`' + f + '`').join('、')}（iso 等角、front 看 XZ 面、right 看 YZ 面、top 俯視；用讀檔工具開啟）`, '', '## 零件尺寸（mm，依體積由大到小，最多 60 個）', '');
    const parts = meshes.map(m => ({ name: m.name || '（未命名）', b: bb([m]) })).map(p => ({ ...p, vol: (p.b[3] - p.b[0]) * (p.b[4] - p.b[1]) * (p.b[5] - p.b[2]) })).sort((a, b) => b.vol - a.vol);
    L.push(...parts.slice(0, 60).map(p => `- ${p.name}：${dims(p.b)}　中心 (${[0, 1, 2].map(k => fmt((p.b[k] + p.b[k + 3]) / 2)).join(', ')})`));
  } else {
    if (st.box) { const k = st.mm || 1; L.push(`- 外形（近似：所有座標點的外框，沒有套組立的位移，單位 mm）：${[st.box.x1 - st.box.x0, st.box.y1 - st.box.y0, st.box.z1 - st.box.z0].map(v => fmt(v * k)).join(' × ')}（X × Y × Z）`); }
    L.push(`- 沒有預覽圖：${warn || '這台電腦沒有 occt-import-js'}。要精確尺寸與預覽圖，請在本庫執行 \`npm install --prefix TEMP/occt occt-import-js@0.0.23\` 後重新抽取（\`vs3d extract\`）`);
  }
  writeFileSync(join(outDir, 'text.md'), L.join('\n') + '\n');
  return { dir: outDir, images, summary: meshes ? `STEP 外形、${meshes.length} 個零件尺寸、預覽圖 ${images.length} 張` : 'STEP 檔頭與近似外形（沒有預覽圖）', warnings: warn ? [warn] : [] };
}

// 上傳檔整批處理（和 office.mjs 的 extractUploads 同樣的回傳格式）：{ info: { 檔名: 給代理看的附註 }, notes: [給使用者看的訊息] }
export async function extractCadUploads(docs, names, opts = {}) {
  const info = {}, notes = [];
  for (const n of names) {
    if (!CAD.test(n)) continue;
    const out = join(docs, n + '.extract');
    try {
      const r = /\.dxf$/i.test(n) ? extractDxf(join(docs, n), out, n) : await extractStep(join(docs, n), out, n, opts);
      info[n] = `已抽出：\`docs/${n}.extract/text.md\`，${r.summary}`;
      notes.push(`${n}：已抽出 ${r.summary} → docs/${n}.extract/`);
      for (const w of r.warnings || []) notes.push(`${n}：${w}`);
    } catch (e) {
      rmSync(out, { recursive: true, force: true });
      info[n] = '無法抽出內容';
      notes.push(`警告：${n} 無法抽出內容（${e.message}），代理只能看到原檔`);
    }
  }
  return { info, notes };
}
