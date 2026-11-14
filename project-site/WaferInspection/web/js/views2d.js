// 網頁的 2D 畫面（只在瀏覽器用）：wafer map、目前位置的取像時序、SIM 檢測影像、本機參考照片。
// 只讀 project 的資料與時間 T；尚未發生的結果（還沒取像、還沒處理完）一律不畫。
import { CELL_COLORS } from './wafer.js';
import { renderTile, DISPLAY_RES } from './inspection-sim.js';
import { PHOTO_NOTES } from './spec.js';

const hex = c => '#' + c.toString(16).padStart(6, '0');

// ---------------------------------------------------------------- wafer map
export function drawWaferMap(ctx, W, H, pr, T, view = {}, selected = null) {
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#0b1219'; ctx.fillRect(0, 0, W, H);
  const p = pr.p, R = p.waferD / 2, s = (Math.min(W, H) / 2 - 14) / R, cx = W / 2, cy = H / 2;
  const X = x => cx + x * s, Yp = y => cy - y * s;
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R * s, 0, Math.PI * 2); ctx.fillStyle = '#3a2a28'; ctx.fill(); ctx.clip();
  // die 格線
  ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
  for (let x = -Math.ceil(R / p.dieW) * p.dieW; x <= R; x += p.dieW) { ctx.beginPath(); ctx.moveTo(X(x), 0); ctx.lineTo(X(x), H); ctx.stroke(); }
  for (let y = -Math.ceil(R / p.dieH) * p.dieH; y <= R; y += p.dieH) { ctx.beginPath(); ctx.moveTo(0, Yp(y)); ctx.lineTo(W, Yp(y)); ctx.stroke(); }
  const st = pr.wafer.state;
  if (pr.valid) {
    const [sx, sy] = pr.plan.step;
    for (const q of pr.plan.positions) {
      ctx.fillStyle = hex(CELL_COLORS[st[q.k]] ?? 0x888888); ctx.globalAlpha = st[q.k] === 'pending' ? .22 : st[q.k] === 'skipped' ? .55 : .75;
      ctx.fillRect(X(q.x - sx / 2) + .5, Yp(q.y + sy / 2) + .5, sx * s - 1, sy * s - 1);
    }
    ctx.globalAlpha = 1;
    // 展示略過的斜線
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    for (const q of pr.plan.positions) if (st[q.k] === 'skipped') { ctx.beginPath(); ctx.moveTo(X(q.x - sx / 2), Yp(q.y - sy / 2)); ctx.lineTo(X(q.x + sx / 2), Yp(q.y + sy / 2)); ctx.stroke(); }
  }
  ctx.restore();
  // 邊緣排除區、外緣、缺口
  ctx.strokeStyle = '#ff6b6b'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(cx, cy, (pr.plan.Rv ?? R) * s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = '#9aa4ad'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, R * s, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
  ctx.fillStyle = '#9aa4ad'; ctx.beginPath(); ctx.moveTo(cx - 5, cy + R * s); ctx.lineTo(cx + 5, cy + R * s); ctx.lineTo(cx, cy + R * s - 7); ctx.fill();
  if (!pr.valid) { ctx.fillStyle = '#ffb020'; ctx.font = '15px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('參數檢核失敗：未排掃描', cx, cy); return { X, Yp, s }; }
  // 路徑（已完成段）
  if (view.path !== false) {
    const doneN = pr.list.filter(k => pr.schedule.posTime.get(k).done <= T).length;
    ctx.strokeStyle = 'rgba(46,229,157,.8)'; ctx.beginPath();
    pr.list.slice(0, doneN + 1).forEach((k, i) => { const q = pr.plan.positions[k]; i ? ctx.lineTo(X(q.x), Yp(q.y)) : ctx.moveTo(X(q.x), Yp(q.y)); }); ctx.stroke();
    const r = pr.resultsAt(T);
    if (pr.review.length && T >= (pr.sequence.stationStart[4] ?? Infinity)) {
      ctx.strokeStyle = '#ff9a3c'; ctx.setLineDash([5, 4]); ctx.beginPath();
      const last = pr.plan.positions[pr.list.at(-1)]; ctx.moveTo(X(last.x), Yp(last.y)); pr.review.forEach(it => ctx.lineTo(X(it.at[0]), Yp(it.at[1]))); ctx.stroke(); ctx.setLineDash([]);
    }
    void r;
  }
  // 目前視野
  const cur = pr.sequence.sample(T).state;
  ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2; const [fw, fh] = pr.plan.fov;
  ctx.strokeRect(X(cur.sx - fw / 2), Yp(cur.sy + fh / 2), fw * s, fh * s); ctx.lineWidth = 1;
  // A 真值（選擇顯示時）
  if (view.A) {
    ctx.strokeStyle = '#ff4dff'; ctx.setLineDash([3, 2]);
    for (const d of pr.scenario.defects) {
      ctx.beginPath();
      if (d.kind === 'line') { ctx.moveTo(X(d.a[0]), Yp(d.a[1])); ctx.lineTo(X(d.b[0]), Yp(d.b[1])); }
      else ctx.arc(X(d.at[0]), Yp(d.at[1]), Math.max(4, (d.kind === 'particle' ? 2 : d.r || 3) * s), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // B 候選（處理完成後才出現）、C 待人工確認
  const res = pr.resultsAt(T);
  if (view.B !== false) for (const c of res.cands) { ctx.strokeStyle = '#ff4a3a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(c.at[0]), Yp(c.at[1]), 6, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
  if (view.C !== false) for (const it of res.reviewed) { const x = X(it.at[0]), y = Yp(it.at[1]); ctx.fillStyle = '#ffe14d'; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 6, y); ctx.closePath(); ctx.fill(); }
  if (selected) { ctx.strokeStyle = '#40e0ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(selected[0]), Yp(selected[1]), 10, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
  return { X, Yp, s, toWafer: (px, py) => [(px - cx) / s, (cy - py) / s] };
}

// ---------------------------------------------------------------- 目前位置的取像時序（移動 → 停穩 → 明場 → 切換 → 暗場；曝光一定在停穩之後）
export function drawTiming(ctx, W, H, pr, T) {
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#0b1219'; ctx.fillRect(0, 0, W, H);
  ctx.font = '20px sans-serif'; ctx.fillStyle = '#8b98a8';
  const cur = pr.sequence.sample(T), k = cur.state.pos, t = pr.schedule.posTime?.get(k);
  if (!pr.valid || !t || cur.state.phase !== '掃描取像') { ctx.fillText('掃描時顯示目前位置的取像時序', 12, H / 2 + 6); return; }
  const steps = pr.sequence.seq.steps.filter(s => s.end.pos === k && s.station === 3);
  const t0 = steps[0].start, t1 = Math.max(t.result, steps.at(-1).start + steps.at(-1).dur), span = t1 - t0, X = v => 10 + (v - t0) / span * (W - 20);
  const COL = { move: '#6f7f90', settle: '#ffa42b', wait: '#b07a2a', expBF: '#fff3b0', switch: '#555', expDF: '#8fd0ff' };
  for (const s of steps) { ctx.fillStyle = COL[s.end.mode] || '#444'; ctx.fillRect(X(s.start), 8, Math.max(2, X(s.start + s.dur) - X(s.start)), 26); }
  ctx.fillStyle = '#3c6e8f'; ctx.fillRect(X(t.exp[1]), 44, Math.max(2, X(t.xfer) - X(t.exp[1])), 14);
  ctx.fillStyle = '#5b4b8a'; ctx.fillRect(X(t.xfer), 62, Math.max(2, X(t.result) - X(t.xfer)), 14);
  ctx.fillStyle = '#c7d3df'; ctx.font = '17px sans-serif';
  ctx.fillText(`P${k + 1}  移動｜停穩｜明場｜暗場`, 12, 30); ctx.fillText('傳輸', X(t.exp[1]) + 4, 56); ctx.fillText('演算', X(t.xfer) + 4, 74);
  ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(T), 2); ctx.lineTo(X(T), H - 2); ctx.stroke();
  ctx.fillStyle = '#8b98a8'; ctx.font = '15px sans-serif'; ctx.fillText(`${(span * 1000).toFixed(0)} ms`, W - 80, H - 6);
}

// ---------------------------------------------------------------- SIM 檢測影像（顯示用重新產生，0.02 mm／px；同一份相機模擬函式）
const projectCaches = new WeakMap();
function tileImage(pr, k) {
  if (!projectCaches.has(pr)) projectCaches.set(pr, new Map());
  const tileCache = projectCaches.get(pr);
  const key = `${pr.scenarioId}|${k}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const q = pr.plan.positions[k], per = pr.per[k];
  const drops = pr.scenario.defects.filter(d => d.kind === 'drop' && Math.abs(d.at[0] - q.x) <= pr.plan.fov[0] / 2 && Math.abs(d.at[1] - q.y) <= pr.plan.fov[1] / 2).flatMap(d => d.ch);
  const img = renderTile(q.x, q.y, pr.plan.fov, pr.p, { defects: pr.scenario.defects, seed: 1 + k * 3, res: DISPLAY_RES, focusErr: per.focusErr, dof: pr.optics.dof, drop: drops });
  const out = {};
  for (const ch of ['BF', 'DF']) {
    const a = img[ch.toLowerCase()]; if (!a) { out[ch] = null; continue; }
    const c = document.createElement('canvas'); c.width = img.w; c.height = img.h;
    const g = c.getContext('2d'), d = g.createImageData(img.w, img.h);
    for (let i = 0; i < a.length; i++) {
      const v = a[i] * 255;
      d.data[i * 4] = ch === 'BF' ? img.rgb[0][i] * 255 : v * .88;
      d.data[i * 4 + 1] = ch === 'BF' ? img.rgb[1][i] * 255 : v * .94;
      d.data[i * 4 + 2] = ch === 'BF' ? img.rgb[2][i] * 255 : v;
      d.data[i * 4 + 3] = 255;
    }
    g.putImageData(d, 0, 0); out[ch] = c;
  }
  // 不保留像素的 Float32 副本；12 組畫布限制手機記憶體。
  out.geo = { x0: img.x0, y0: img.y0 }; if (tileCache.size >= 12) tileCache.delete(tileCache.keys().next().value);
  tileCache.set(key, out); return out;
}
export function drawSimImage(ctx, W, H, pr, T, k, { channel = 'BF', overlay = 'mark', A = false } = {}) {
  ctx.fillStyle = '#05080b'; ctx.fillRect(0, 0, W, H);
  const msg = (lines, color = '#8b98a8') => { ctx.fillStyle = color; ctx.font = `${Math.round(W / 34)}px sans-serif`; ctx.textAlign = 'center'; lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * W / 26)); ctx.textAlign = 'left'; };
  if (!pr.valid) return msg(['參數檢核失敗：沒有影像']);
  if (k == null || k < 0) return msg(['尚未開始掃描']);
  if (!pr.list.includes(k)) return msg([`P${k + 1}：展示略過，未取像`, '（精簡模式不得當成已檢測）'], '#ffb020');
  const t = pr.schedule.posTime.get(k);
  if (T < t.exp[1]) return msg([`P${k + 1}：尚未取像`]);
  const tile = tileImage(pr, k), cv = tile[channel], g = tile.geo;
  if (!cv || (channel === 'DF' && T < t.exp[3])) return msg(!cv ? [`P${k + 1}：${channel === 'BF' ? '明場' : '暗場'}缺圖（影格未收到）`, '→ 待複檢'] : [`P${k + 1}：暗場尚未曝光`], !cv ? '#ff7ad9' : '#8b98a8');
  ctx.imageSmoothingEnabled = true; ctx.drawImage(cv, 0, 0, W, H);
  const sx = W / pr.plan.fov[0], sy = H / pr.plan.fov[1], X = x => (x - g.x0) * sx, Yp = y => (g.y0 - y) * sy;
  const per = pr.per[k], judged = T >= t.result;
  if (overlay === 'mark') {
    if (judged && per.status === 'recheck' || judged && per.status === 'missing') { ctx.fillStyle = 'rgba(255,164,43,.85)'; ctx.fillRect(0, H - 26, W, 26); ctx.fillStyle = '#111'; ctx.font = '14px sans-serif'; ctx.fillText('待複檢：' + per.reasons.join('；'), 8, H - 8); }
    if (judged) for (const b of per.blobs.filter(b => b.ch === channel)) {
      const pad = 4; ctx.strokeStyle = '#ff4a3a'; ctx.lineWidth = 2; ctx.strokeRect(X(b.box[0]) - pad, Yp(b.box[3]) - pad, (b.box[2] - b.box[0]) * sx + 2 * pad, (b.box[3] - b.box[1]) * sy + 2 * pad);
      ctx.fillStyle = '#ff4a3a'; ctx.font = '13px sans-serif'; ctx.fillText(`B 候選 ${b.area} px`, X(b.box[0]), Yp(b.box[3]) - pad - 3);
    }
    if (!judged) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, 150, 22); ctx.fillStyle = '#c7d3df'; ctx.font = '13px sans-serif'; ctx.fillText('傳輸／演算中…', 8, 16); }
    if (A) { ctx.strokeStyle = '#ff4dff'; ctx.setLineDash([4, 3]); for (const d of pr.scenario.defects) { ctx.beginPath(); if (d.kind === 'line') { ctx.moveTo(X(d.a[0]), Yp(d.a[1])); ctx.lineTo(X(d.b[0]), Yp(d.b[1])); } else if (d.at) ctx.arc(X(d.at[0]), Yp(d.at[1]), Math.max(8, (d.r || .2) * sx), 0, Math.PI * 2); ctx.stroke(); } ctx.setLineDash([]); }
  }
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(W - 230, 0, 230, 22); ctx.fillStyle = '#ffd34d'; ctx.font = '12px sans-serif';
  ctx.fillText(`SIM 示意影像（缺陷寬度示意放大）`, W - 224, 15);
}

// ---------------------------------------------------------------- 本機參考照片（客戶提供；未經演算法處理）
export function drawPhoto(ctx, W, H, photo, { overlay = 'mark', manual = [] } = {}) {
  ctx.fillStyle = '#05080b'; ctx.fillRect(0, 0, W, H);
  if (!photo) { ctx.fillStyle = '#8b98a8'; ctx.font = `${Math.round(W / 34)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('用右側「本機參考照片」載入圖片（只在本機瀏覽器顯示，不上傳）', W / 2, H / 2); ctx.textAlign = 'left'; return null; }
  const k = Math.min(W / photo.img.width, H / photo.img.height), w = photo.img.width * k, h = photo.img.height * k, ox = (W - w) / 2, oy = (H - h) / 2;
  ctx.drawImage(photo.img, ox, oy, w, h);
  const note = PHOTO_NOTES.find(n => n.file === photo.name && n.size[0] === photo.img.width);
  if (overlay === 'mark') {
    const marks = [...(note?.marks || []).map(m => ({ ...m, kind: '客戶' })), ...manual.map(m => ({ ...m, kind: '本機' }))];
    ctx.font = '13px sans-serif';
    for (const m of marks) {
      const x = ox + m.at[0] * k, y = oy + m.at[1] * k;
      ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2; ctx.strokeRect(x - 18, y - 18, 36, 36);
      ctx.fillStyle = 'rgba(0,0,0,.6)'; const txt = `${m.kind === '客戶' ? 'C 人工標記（客戶紅色箭頭）' : 'C 人工註記'}：${m.text || '待確認'}`; ctx.fillRect(x + 20, y - 18, ctx.measureText(txt).width + 10, 18);
      ctx.fillStyle = '#ffe14d'; ctx.fillText(txt, x + 25, y - 5);
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, W, 22); ctx.fillStyle = '#c7d3df'; ctx.font = '12px sans-serif';
  ctx.fillText(`客戶參考照片 ${photo.name}（${photo.img.width}×${photo.img.height}）：未經演算法處理；黃框是人工／示意標記；點畫面可加註記`, 8, 15);
  return { ox, oy, k };
}
