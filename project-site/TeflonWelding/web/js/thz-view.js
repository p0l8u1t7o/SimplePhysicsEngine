// 兆赫波（THz）檢測畫面（2D，相機視窗與錄影共用）：A-scan 回波波形、沿焊道的 B-scan 剖面、各焊道判定。
// 數值模型（示意）：每個介面依菲涅耳反射係數 r = (n1 − n2)／(n1 + n2) 產生一個高斯一階導數脈衝，
// 時間 t = 表面 + Σ 2·d·n／c。PFA 與 PTFE 折射率幾乎相同，熔合良好時交界回波極小；氣孔是一層空氣，多出相位反轉的強回波。
import { THZ, seamLength } from './spec.js';

const { c, n, layers: Ly } = THZ;
const T0 = 8;                                                     // 表面回波時間 ps（探頭焦點在表面）
const tBelt = T0 + 2 * Ly.belt * n.pfa / c, tGlue = tBelt + 2 * Ly.ptfe * n.ptfe / c, tSus = tGlue + 2 * Ly.glue * n.glue / c;
const tVoid = T0 + 2 * (Ly.belt * n.pfa + (THZ.voidDepth - Ly.belt) * n.ptfe) / c;
const fres = (a, b) => (a - b) / (a + b);
const BASE = [
  { t: T0, a: fres(1, n.pfa), name: '表面' },
  { t: tBelt, a: fres(n.pfa, n.ptfe), name: '焊帶／PTFE' },
  { t: tGlue, a: fres(n.ptfe, n.glue), name: 'PTFE／膠' },
  { t: tSus, a: -.55, name: 'SUS（全反射，示意縮小）' },
];
const VOID = [{ t: tVoid, a: fres(n.pfa, 1), name: '氣孔上緣' }, { t: tVoid + 1.1, a: fres(1, n.pfa), name: '氣孔下緣' }];
const TMAX = 62, SIG = .55;
const pulse = (t, e) => { const x = (t - e.t) / SIG; return -e.a * x * Math.exp(-x * x / 2) * 1.65; };
export const THZ_TIMES = { surface: T0, belt: tBelt, glue: tGlue, sus: tSus, void: tVoid, cover: (tGlue - T0) * c / (2 * n.ptfe) };

// 某焊道位置 u 的回波（defect：這點是不是氣孔；repaired：已補焊）
function echoes(isVoid) { return isVoid ? [...BASE, ...VOID] : BASE; }
const VOID_HALF = 25;                                             // 氣孔沿焊道的半寬 mm（示意，放大到 B-scan 看得到）
const voidAt = (z, seamId, u) => seamId === z.defect.seam.id && Math.abs(u - z.defect.u) < VOID_HALF / seamLength(z.defect.seam);

// B-scan 預先畫好（每道焊道一張、缺陷焊道另有補焊後一張），每格只裁切顯示已掃描的部分
const cache = new Map();
function bscan(seam, repaired, z, W, H) {
  const key = `${seam.id}|${seamLength(seam)}|${z.defect.u}|${repaired}|${W}x${H}`;
  if (cache.has(key)) return cache.get(key);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), img = g.createImageData(W, H);
  for (let x = 0; x < W; x++) {
    const u = x / (W - 1), list = echoes(!repaired && voidAt(z, seam.id, u));
    for (let y = 0; y < H; y++) {
      const t = y / (H - 1) * TMAX, v = list.reduce((s, e) => s + pulse(t, e), 0), a = Math.min(1, Math.sqrt(Math.abs(v) * 3));   // 開根號：弱回波也看得到
      const o = (y * W + x) * 4, pos = v > 0;
      img.data[o] = 15 + a * (pos ? 240 : 40); img.data[o + 1] = 24 + a * (pos ? 150 : 170); img.data[o + 2] = 32 + a * (pos ? 60 : 255); img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0); cache.set(key, cv); return cv;
}

// 各焊道狀態文字與顏色
export function seamVerdicts(z, seams) {
  return seams.map(s => {
    const i = z.st['seam-' + s.id].i, def = s.id === z.defect.seam.id;
    if (i <= 0) return { s, text: '未檢測', color: '#7f8c99' };
    if (i < 1 && !(def && z.found)) return { s, text: `掃描中 ${Math.round(i * 100)}%`, color: '#8bd4ed' };
    if (def && z.found) {
      if (z.checked >= 1) return { s, text: '補焊後複檢 OK', color: '#3dd68c' };
      if (z.checked > 0) return { s, text: '複檢中', color: '#ffb020' };
      if (z.repair > 0) return { s, text: z.repair >= 1 ? '已補焊，待複檢' : '補焊中', color: '#ffb020' };
      return { s, text: `NG：約 ${Math.round(z.defect.u * 360)}° 處氣孔`, color: '#ff5a5a' };
    }
    return { s, text: 'OK', color: '#3dd68c' };
  });
}

const FONT = '"Microsoft JhengHei","Noto Sans TC",sans-serif';
// 深度刻度依各層折射率換算，不把膠層誤當成 PTFE。
export function depthTime(depth) {
  const belt = Math.min(depth, Ly.belt), ptfe = Math.min(Math.max(0, depth - Ly.belt), Ly.ptfe), glue = Math.max(0, depth - Ly.belt - Ly.ptfe);
  return T0 + 2 * (belt * n.pfa + ptfe * n.ptfe + glue * n.glue) / c;
}
const frames = new WeakMap();
export function drawThz(ctx, w, h, z, seams) {
  let frame = frames.get(ctx);
  if (!frame) { const canvas = document.createElement('canvas'); frame = { canvas, ctx: canvas.getContext('2d'), key: '' }; frames.set(ctx, frame); }
  const atVoid = voidAt(z, z.seam?.id || z.defect.seam.id, z.seam ? z.u : z.defect.u);
  const key = JSON.stringify([w, h, z.seam?.id, atVoid, Math.floor(z.u * 40), z.scanning, z.recheck, z.found, z.repair > 0, z.checked > 0, Math.floor(z.repair * 40), Math.floor(z.checked * 40), ...seams.map(s => [s.id, seamLength(s), Math.floor(z.st['seam-' + s.id].i * 40)])]);
  if (key !== frame.key) {
    frame.canvas.width = w; frame.canvas.height = h;
    paintThz(frame.ctx, w, h, z, seams); frame.key = key;
  }
  ctx.drawImage(frame.canvas, 0, 0); // 共用視窗會清除目的畫布；只複製快取，不逐幀重算波形。
}
function paintThz(ctx, w, h, z, seams) {
  ctx.fillStyle = '#0d1620'; ctx.fillRect(0, 0, w, h);
  const s = w / 640, pad = 14 * s;
  // 目前要畫哪一道：掃描中的焊道；沒在掃描時畫缺陷焊道（判定、補焊、複檢都看它）
  // 沒在掃描、已判 NG 時停在缺陷處（看 NG 波形）；複檢通過後也停在缺陷處（看補焊後的 OK 波形）
  const seam = z.seam || z.defect.seam, u = z.seam ? z.u : z.found ? z.defect.u : Math.min(1, z.st['seam-' + seam.id].i);
  const isVoid = !(z.recheck || z.checked >= 1) && voidAt(z, seam.id, u);
  ctx.fillStyle = '#e6edf3'; ctx.font = `600 ${26 * s}px ${FONT}`;
  ctx.fillText(z.recheck ? '兆赫波複檢（補焊段）' : z.scanning ? '兆赫波掃描中' : '兆赫波檢測結果', pad, 29 * s);
  ctx.font = `${21 * s}px ${FONT}`; ctx.fillStyle = '#bacbd8';
  ctx.fillText(`${seam.name}・位置 ${seam.kind === 'circ' ? Math.round(u * 360) + '°' : Math.round(u * (seam.y1 - seam.y0)) + ' mm'}　A-scan`, pad, 56 * s);

  // ---- A-scan
  const ax = 54 * s, ay = 86 * s, aw = w - ax - 18 * s, ah = 94 * s, mid = ay + ah / 2;
  ctx.strokeStyle = '#26384a'; ctx.lineWidth = 1; ctx.strokeRect(ax, ay, aw, ah);
  ctx.beginPath(); ctx.moveTo(ax, mid); ctx.lineTo(ax + aw, mid); ctx.stroke();
  const list = echoes(isVoid), X = t => ax + t / TMAX * aw;
  ctx.strokeStyle = isVoid ? '#ff7070' : '#72e3cd'; ctx.lineWidth = 1.6 * s; ctx.beginPath();
  for (let k = 0; k <= 400; k++) { const t = k / 400 * TMAX, v = list.reduce((a, e) => a + pulse(t, e), 0), y = mid - Math.max(-1, Math.min(1, v * 2.2)) * ah * .45; k ? ctx.lineTo(X(t), y) : ctx.moveTo(X(t), y); }
  ctx.stroke();
  ctx.font = `${19 * s}px ${FONT}`;
  for (const [t, text, row] of [[T0, '表面', 0], [tBelt, '焊帶', 1], [tGlue, '膠層', 0], [tSus, 'SUS', 1], ...(isVoid ? [[tVoid, '氣孔', 0]] : [])]) {
    ctx.fillStyle = text === '氣孔' ? '#ff9999' : '#ccdce8'; ctx.fillText(text, X(t) - 18 * s, (row ? 108 : 80) * s);
  }
  ctx.font = `${21 * s}px ${FONT}`; ctx.fillStyle = '#ccdce8';
  for (let t = 0; t <= 60; t += 10) {
    ctx.beginPath(); ctx.moveTo(X(t), ay + ah); ctx.lineTo(X(t), ay + ah + 5 * s); ctx.stroke();
    ctx.fillText(String(t), X(t) - (t ? 11 : 5) * s, 204 * s);
  }
  ctx.fillText('ps', pad, 204 * s);
  // 覆蓋厚度量測
  ctx.fillStyle = '#e0e8ef'; ctx.font = `${21 * s}px ${FONT}`;
  ctx.fillText(`覆蓋 ${THZ_TIMES.cover.toFixed(2)} mm ≥ 3.2　${isVoid ? '反相回波：疑似氣孔' : '無多餘回波'}`, pad, 234 * s);

  // ---- B-scan（已掃描部分）
  const by = 254 * s, bh = 80 * s, bw = aw;
  ctx.strokeStyle = '#26384a'; ctx.strokeRect(ax, by, bw, bh);
  const repaired = seam.id === z.defect.seam.id && z.checked > 0;
  const img = bscan(seam, false, z, 240, 64), img2 = repaired ? bscan(seam, true, z, 240, 64) : null;
  const shown = z.seam ? u : Math.min(1, z.st['seam-' + seam.id].i);
  if (shown > 0) {
    ctx.save(); ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, Math.max(1, shown * 240), 64, ax, by, Math.max(1, shown * bw), bh);
    if (img2) {   // 補焊段複檢過的部分換成補焊後的影像
      const r0 = z.defect.u - z.defect.half, r1 = r0 + 2 * z.defect.half * Math.min(1, z.checked);
      ctx.drawImage(img2, r0 * 240, 0, (r1 - r0) * 240, 64, ax + r0 * bw, by, (r1 - r0) * bw, bh);
    }
    ctx.restore();
  }
  if (z.seam) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5 * s; ctx.beginPath(); ctx.moveTo(ax + u * bw, by); ctx.lineTo(ax + u * bw, by + bh); ctx.stroke(); }
  if (seam.id === z.defect.seam.id && z.found) {
    const dx = ax + z.defect.u * bw;
    ctx.strokeStyle = z.checked >= 1 ? '#3dd68c' : '#ff5a5a'; ctx.lineWidth = 2 * s; ctx.strokeRect(dx - 8 * s, by + 4 * s, 16 * s, bh - 8 * s);
  }
  ctx.fillStyle = '#ccdce8'; ctx.font = `${20 * s}px ${FONT}`;
  ctx.fillText('mm', 8 * s, 249 * s);
  for (const depth of [0, 2, 4]) {
    const y = by + depthTime(depth) / TMAX * bh;
    ctx.fillText(String(depth), 25 * s, y + 6 * s);
    ctx.strokeStyle = '#8fa6b8'; ctx.beginPath(); ctx.moveTo(ax - 6 * s, y); ctx.lineTo(ax, y); ctx.stroke();
  }
  ctx.fillText('B-scan 沿焊道 →', pad, 360 * s);
  ctx.fillStyle = '#ffa94b'; ctx.fillText('橙：正回波', 264 * s, 360 * s);
  ctx.fillStyle = '#61c9ff'; ctx.fillText('藍：負回波', 450 * s, 360 * s);

  // ---- 判定
  const vy = 391 * s;
  ctx.font = `600 ${21 * s}px ${FONT}`;
  seamVerdicts(z, seams).forEach((v, k) => {
    const x = pad + k * ((w - 2 * pad) / seams.length);
    ctx.fillStyle = '#c9d4de'; ctx.fillText(v.s.name, x, vy);
    const text = v.text.startsWith('NG') ? 'NG 氣孔' : v.text === '補焊後複檢 OK' ? '複檢 OK' : v.text === '已補焊，待複檢' ? '待複檢' : v.text;
    ctx.fillStyle = v.color; ctx.fillText(text, x, vy + 28 * s);
  });
}
