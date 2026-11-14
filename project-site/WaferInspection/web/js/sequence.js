// 時序：真空確認 → 對位 → 對焦 → 停拍掃描（明場＋暗場）→ 複檢 → 結果輸出。
// buildSchedule() 依參數算出每一步的秒數（梯形速度曲線、停穩、曝光、相機緩衝與介面傳輸、並行處理），
// 同一份結果同時給動畫（createSequence → core 的 createStepSequence）與工程週期估算（budget.js）。
// 播放倍率只改變觀看速度，不影響這裡的秒數。
//
// 停拍互鎖：每個位置一定是「移動 → 停穩 → 明場曝光 → 切換 → 暗場曝光」，曝光開始時平台已靜止且停穩時間已過；
// 位置在暗場曝光結束時才算完成取像。影像傳輸與演算處理和下一次移動並行，只有相機緩衝滿時才讓平台等待。
import { createStepSequence } from '@core/anim/sequence.js';

export const STATIONS = ['真空確認', '對位', '對焦', '掃描取像', '複檢', '結果輸出'];
export const PLACEMENT = { th: 0.35, note: '人工放片的角度誤差 0.35°（示意），由 θ 台修正；XY 偏移由對位結果補償座標' };
export const LOAD = [0, 210];      // 取放片位：平台把晶圓座標 (0, 210) 送到光軸下＝晶圓中心在操作側

// 曝光後最多 85 ms 的示意餘暉：只在同一位置等待／切換時保留，移動、停穩、曝光前均關閉。
// 不改曝光時刻、排程或相機結果；由時間直接計算，倒序亦相同。
export function exposureCue(T, state, timing) {
  if (!timing || !['wait', 'switch', 'tail'].includes(state.mode)) return 'off';
  const e = timing.exp;
  if (T >= e[3] && T < e[3] + .085) return 'DF';
  if (T >= e[1] && T < Math.min(e[1] + .085, e[2])) return 'BF';
  return 'off';
}

// 梯形速度曲線：距離 d、最高速 v、加速度 a → { T, ease(u) }
export function trapezoid(d, v, a) {
  d = Math.abs(d);
  if (d < 1e-9) return { T: 0, ease: u => u };
  if (d < v * v / a) {
    const t1 = Math.sqrt(d / a), T = 2 * t1;
    return { T, ease: u => { const t = u * T; return t < t1 ? 0.5 * a * t * t / d : 1 - 0.5 * a * (T - t) ** 2 / d; } };
  }
  const ta = v / a, T = d / v + ta;
  return { T, ease: u => { const t = u * T; return t < ta ? 0.5 * a * t * t / d : t < T - ta ? (0.5 * a * ta * ta + v * (t - ta)) / d : 1 - 0.5 * a * (T - t) ** 2 / d; } };
}

// ctx：{ p, plan, optics, list（取像位置順序）, review（複檢清單）, afPts, plane }
export function buildSchedule({ p, plan, optics, list, review = [], afPts = [], plane = { a: 0, b: 0, c: 0 } }) {
  const steps = [], cat = { vacuum: 0, align: 0, focus: 0, move: 0, settle: 0, expose: 0, wait: 0, tail: 0, review: 0, finish: 0 };
  let now = 0, cur = { sx: LOAD[0], sy: LOAD[1], th: PLACEMENT.th, z: 0 };
  const add = (station, dur, action, sub, values, extra = {}, c = null) => {
    if (!(dur > 1e-9)) return null;
    const s = { station, start: now, dur, action, sub, values, extra }; steps.push(s); now += dur; Object.assign(cur, pick(values)); if (c) cat[c] += dur; return s;
  };
  const pick = v => Object.fromEntries(Object.entries(v || {}).filter(([k]) => k in cur));
  const zAt = (x, y) => plane.a + plane.b * x + plane.c * y;

  // 相機：影格傳輸（介面頻寬）、緩衝、幀率；處理執行緒池
  const tx = optics.transferS, minGap = p.camFps ? 1 / p.camFps : 0, frames = [];
  let lastStart = -Infinity, lastXfer = 0;
  function shoot(earliest, expS) {
    const block = frames.length >= p.camBuffer ? frames[frames.length - p.camBuffer].xferEnd : 0;
    const start = Math.max(earliest, lastStart + minGap, block), end = start + expS;
    const xs = Math.max(end, lastXfer), xferEnd = xs + tx;
    frames.push({ start, end, xferEnd }); lastStart = start; lastXfer = xferEnd;
    return { start, end, xferEnd };
  }
  const threads = Array(Math.max(1, p.procThreads)).fill(0);
  function process(ready, dur) { let i = 0; threads.forEach((t, k) => { if (t < threads[i]) i = k; }); const s = Math.max(ready, threads[i]); threads[i] = s + dur; return s + dur; }
  let procBusy = 0;

  function moveTo(station, x, y, action, sub, extra = {}, c = 'move', z = zAt(x, y), vals = {}) {
    const mx = trapezoid(x - cur.sx, p.vMax, p.aMax), my = trapezoid(y - cur.sy, p.vMax, p.aMax), m = mx.T >= my.T ? mx : my;
    return add(station, m.T, action, sub, { sx: x, sy: y, z, light: 'off', mode: 'move', ...vals }, { ...extra, ease: m.ease }, c);
  }
  const settleAt = (station, sub, c = 'settle') => add(station, p.settle, '停穩', sub, { mode: 'settle', light: 'off' }, {}, c);

  // ------------------------------------------------ S0 真空確認（人工已放妥晶圓）
  add(0, 0.5, '真空吸附建立', '人工放妥晶圓、按下啟動後開始；人工放取片不計入設備週期', { vac: 1, phase: '真空確認', mode: 'vacuum' }, { ev: true }, 'vacuum');
  add(0, 0.2, '真空確認（壓力開關到達設定值）', '未到設定值不放行，平台不移動', { vac: 2, mode: 'vacuum' }, {}, 'vacuum');

  // ------------------------------------------------ S1 對位：兩個對位點取像 → 算角度 → θ 修正
  const Rv = plan.Rv ?? 0, marks = [[-0.75 * Rv, 0], [0.75 * Rv, 0]];
  marks.forEach(([x, y], i) => {
    moveTo(1, x, y, `移到對位點 ${i ? 'B' : 'A'}`, '對位點取 die 角落圖樣（示意）', { ev: i === 0 }, 'align');
    settleAt(1, '平台停穩後才取像', 'align');
    const f = shoot(now, p.expBF / 1000);
    add(1, f.end - now, `對位點 ${i ? 'B' : 'A'} 明場取像`, '', { light: 'BF', mode: 'align', phase: '對位' }, {}, 'align');
    procBusy += 0.1;
  });
  add(1, Math.max(0.1, lastXfer + 0.1 - now), '計算角度與偏移', '兩點連線求晶圓角度；XY 偏移補償到掃描座標', { light: 'off', mode: 'calc' }, {}, 'align');
  add(1, 0.4, `θ 修正 ${PLACEMENT.th}°`, PLACEMENT.note, { th: 0, mode: 'theta' }, {}, 'align');

  // ------------------------------------------------ S2 對焦：在幾個點做 Z 掃描，建立對焦平面
  afPts.forEach(([x, y], i) => {
    moveTo(2, x, y, `移到對焦點 ${i + 1}／${afPts.length}`, '', { ev: i === 0 }, 'focus', cur.z);
    settleAt(2, '', 'focus');
    add(2, p.afTime, `Z 掃描對焦（點 ${i + 1}）`, '找清晰度最高的 Z；結果建立對焦平面，掃描時 Z 依平面補償', { z: zAt(x, y), mode: 'af', light: 'BF', phase: '對焦' }, {}, 'focus');
  });

  // ------------------------------------------------ S3 停拍掃描
  const posTime = new Map(), inList = new Set(list); let lastRow = null;
  for (const k of list) {
    const q = plan.positions[k], first = q.row !== lastRow; lastRow = q.row;
    const rowLen = first ? plan.rows[q.row].list.filter(x => inList.has(x)).length : 0;
    const mv = moveTo(3, q.x, q.y, first ? `掃描第 ${q.row + 1} 列` : '移到下一個取像位置', first ? `${rowLen} 個位置；${q.row % 2 ? '由右往左' : '由左往右'}` : '',
      { ev: first, k, row: q.row }, 'move', zAt(q.x, q.y), { pos: k, row: q.row, phase: '掃描取像' });
    const settleEnd = now + p.settle;
    add(3, p.settle, !mv && first ? `掃描第 ${q.row + 1} 列：停穩` : '停穩', '停穩前不曝光（互鎖）', { mode: 'settle', light: 'off', pos: k, row: q.row, phase: '掃描取像' }, { ev: first && !mv }, 'settle');
    const f0 = shoot(now, p.expBF / 1000);
    add(3, f0.start - now, '等待影像傳輸', '相機緩衝已滿：前面的影像還在經介面傳送', { mode: 'wait', pos: k }, {}, 'wait');
    add(3, f0.end - now, '明場曝光（同軸光）', `P${k + 1}`, { mode: 'expBF', light: 'BF', pos: k }, { k }, 'expose');
    const sw = now + p.lightSwitch / 1000, f1 = shoot(sw, p.expDF / 1000);
    add(3, sw - now, '切換到暗場', '', { mode: 'switch', light: 'off', pos: k }, {}, 'expose');
    add(3, f1.start - now, '等待影像傳輸', '相機緩衝已滿', { mode: 'wait', pos: k }, {}, 'wait');
    add(3, f1.end - now, '暗場曝光（低角度環形光）', `P${k + 1}`, { mode: 'expDF', light: 'DF', pos: k }, { k }, 'expose');
    const result = process(f1.xferEnd, 2 * p.procImg); procBusy += 2 * p.procImg;
    posTime.set(k, { settleEnd, exp: [f0.start, f0.end, f1.start, f1.end], done: f1.end, xfer: f1.xferEnd, result });
  }
  const scanEnd = now, tailTo = Math.max(now, ...[...posTime.values()].map(t => t.result));
  add(3, tailTo - now, '等待影像傳輸與演算完成', '最後幾個位置的影像還在傳送與處理', { mode: 'tail', light: 'off' }, { ev: true }, 'tail');

  // ------------------------------------------------ S4 複檢：依最近鄰順序回到候選與待複檢位置
  const revTime = [];
  review.forEach((it, i) => {
    const mv = moveTo(4, it.at[0], it.at[1], `複檢 ${it.n}／${review.length}：${it.ref}`, it.note, { ev: true }, 'review', zAt(it.at[0], it.at[1]), { rev: i, phase: '複檢' });
    add(4, p.settle, mv ? '停穩' : `複檢 ${it.n}／${review.length}：${it.ref}`, mv ? '' : it.note, { mode: 'settle', light: 'off', rev: i, phase: '複檢' }, { ev: !mv }, 'review');
    const t0 = now; let last = null;
    for (let n = 0; n < p.reviewImgs; n++) last = shoot(n ? last.end + p.lightSwitch / 1000 : now, (n % 2 ? p.expDF : p.expBF) / 1000);
    add(4, last.end - t0, `複檢取像 ${p.reviewImgs} 張`, '明場、暗場與 Z 偏移各一張（示意）', { mode: 'review', light: 'BF', rev: i }, {}, 'review');
    const done = process(last.xferEnd, p.reviewImgs * p.procImg); procBusy += p.reviewImgs * p.procImg;
    revTime.push({ n: it.n, shot: now, done });
  });

  // ------------------------------------------------ S5 結果輸出
  const resTo = Math.max(now, ...revTime.map(r => r.done));
  add(5, resTo - now, '等待複檢影像處理', '', { mode: 'tail', light: 'off' }, {}, 'finish');
  add(5, 0.3, '彙整 wafer map 與複檢清單', '結果寫入資料庫；待人工確認的項目列入複檢清單', { mode: 'report', light: 'off', phase: '結果輸出', rev: -1 }, { ev: true }, 'finish');
  add(5, 0.3, '破真空', '', { vac: 0, mode: 'vacuum' }, {}, 'finish');
  moveTo(5, LOAD[0], LOAD[1], '平台回取放片位', '之後由人工取片（不計入設備週期）', {}, 'finish', 0);

  return { steps, total: now, cat, posTime, revTime, scanEnd, frames: frames.length, transferBusy: frames.length * tx, procBusy, frameMB: optics.frameMB };
}

// 動畫用的序列：把 buildSchedule 的步驟交給 core 的 createStepSequence（狀態只由時間決定）
export function createSequence(schedule) {
  const base = { sx: LOAD[0], sy: LOAD[1], th: PLACEMENT.th, z: 0, light: 'off', vac: 0, phase: '待命', pos: -1, row: -1, mode: 'idle', rev: -1 };
  const seq = createStepSequence({ base, discrete: ['light', 'vac', 'phase', 'pos', 'row', 'mode', 'rev'], stations: STATIONS });
  for (const s of schedule.steps) seq.add(s.station, s.dur, s.action, s.sub, s.values, { ...s.extra, ease: s.extra.ease });
  // 播放列的事件選單只列階段與每一列的開頭（逐位置的步驟太多）
  const events = seq.steps.filter(s => s.ev).map(s => ({ time: s.start, dur: s.dur, label: s.action, sub: s.sub, station: s.station }));
  return { seq, events, total: seq.total, stationStart: seq.stationStart, sample: T => seq.sample(T) };
}
