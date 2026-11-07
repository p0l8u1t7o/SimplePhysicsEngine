// OpenFOAM postProcessing 的文字輸出：forces、probes、yPlus、solverInfo。純 JS。
// 各版本欄位格式不同，這裡都接受：
//   forces  ：OpenFOAM.com v2006 以後 force.dat／moment.dat（# Time total_x total_y total_z pressure_x … viscous_x …）
//             舊版 forces.dat（# Time forces(pressure viscous porous) moment(pressure viscous porous)，資料是巢狀括號）
//             OpenFOAM.org 的 forces.dat（欄名放在括號裡，例如 (Fx Fy Fz) 之類，解析時去掉括號）
//   probes  ：# Probe i (x y z) 標頭＋每列「時間 值…」，向量值寫成 (ux uy uz)
//   yPlus、solverInfo：一般的表格，欄位可以是字（patch 名稱、求解器名稱）

const NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$|^[-+]?(nan|inf)$/i;
const num = t => (NUM.test(t) ? Number(t.replace(/^([-+]?)inf$/i, '$1Infinity')) : t);

export function parseDat(text) {
  const header = [], rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) { header.push(line.replace(/^#\s*/, '')); continue; }
    rows.push(line.replace(/[()]/g, ' ').trim().split(/\s+/).map(num));
  }
  // 欄名：最後一行標頭（去掉括號後）的字數和資料欄數相同就用它
  let columns = null;
  const width = rows[0]?.length ?? 0;
  for (let i = header.length - 1; i >= 0 && !columns; i--) {
    const names = header[i].replace(/[()]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (names.length === width) columns = names;
  }
  if (!columns) {
    const h = header.join(' ');
    if (width === 19 && /forces\s*\(\s*pressure\s+viscous\s+porous\s*\)/.test(h)) {
      columns = ['Time'];
      for (const g of ['force', 'moment']) for (const part of ['pressure', 'viscous', 'porous']) for (const ax of ['x', 'y', 'z']) columns.push(`${g}_${part}_${ax}`);
    } else if (width === 13 && /forces\s*\(\s*pressure\s+viscous\s*\)/.test(h)) {
      columns = ['Time'];
      for (const g of ['force', 'moment']) for (const part of ['pressure', 'viscous']) for (const ax of ['x', 'y', 'z']) columns.push(`${g}_${part}_${ax}`);
    } else {
      columns = Array.from({ length: width }, (_, i) => (i === 0 ? 'Time' : `c${i}`));
    }
  }
  return { header, columns, rows };
}

export const column = (dat, name) => { const i = dat.columns.indexOf(name); return i < 0 ? null : dat.rows.map(r => r[i]); };

// 力的時間序列：回傳 { time, total: [[x,y,z]…], pressure, viscous }（N，foam 座標）。抓不到欄位時丟錯
export function forcesSeries(dat) {
  const c = n => column(dat, n);
  const vec3 = pfx => { const x = c(`${pfx}_x`), y = c(`${pfx}_y`), z = c(`${pfx}_z`); return x && y && z ? x.map((_, i) => [x[i], y[i], z[i]]) : null; };
  const time = c('Time') || c('time');
  let total = vec3('total'), pressure = vec3('pressure'), viscous = vec3('viscous');
  if (!total) {
    const fp = vec3('force_pressure'), fv = vec3('force_viscous'), fo = vec3('force_porous');
    if (fp && fv) { pressure = fp; viscous = fv; total = fp.map((p, i) => [0, 1, 2].map(k => p[k] + fv[i][k] + (fo ? fo[i][k] : 0))); }
  }
  if (!total) {
    const fx = c('Fx'), fy = c('Fy'), fz = c('Fz');
    if (fx && fy && fz) total = fx.map((_, i) => [fx[i], fy[i], fz[i]]);
  }
  if (!time || !total) throw new Error(`認不出力的欄位：${dat.columns.join(' ')}`);
  return { time, total, pressure, viscous };
}

// 多個起始時間資料夾（重新起算）合併：依時間排序，重疊的時間以後面的檔為準
export function mergeSeries(list) {
  const map = new Map();
  for (const s of list) s.time.forEach((t, i) => map.set(t, i === undefined ? null : { s, i }));
  const times = [...map.keys()].sort((a, b) => a - b);
  const pick = key => (times.every(t => map.get(t).s[key]) ? times.map(t => map.get(t).s[key][map.get(t).i]) : null);
  return { time: times, total: pick('total'), pressure: pick('pressure'), viscous: pick('viscous') };
}

// probes：{ locations: [[x,y,z]…], missing: [bool…], time: […], values: [[每個探針的值（純量或向量）]…] }
export function parseProbes(text) {
  const locations = [], missing = [];
  const time = [], values = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = /^#\s*Probe\s+(\d+)\s*\(\s*(\S+)\s+(\S+)\s+(\S+)\s*\)(.*)$/.exec(line);
      if (m) { locations[Number(m[1])] = [Number(m[2]), Number(m[3]), Number(m[4])]; missing[Number(m[1])] = /not\s*found/i.test(m[5]); }
      continue;
    }
    // 向量寫成 (a b c)：先把括號群組抓出來
    const toks = [];
    const re = /\(([^)]*)\)|(\S+)/g;
    let m;
    while ((m = re.exec(line))) toks.push(m[1] !== undefined ? m[1].trim().split(/\s+/).map(Number) : Number(m[2]));
    time.push(toks[0]);
    values.push(toks.slice(1).map(v => (Array.isArray(v) ? v.map(x => (Math.abs(x) > 1e299 ? NaN : x)) : Math.abs(v) > 1e299 ? NaN : v)));
  }
  const n = values[0]?.length ?? locations.length;
  for (let i = 0; i < n; i++) if (missing[i] === undefined) missing[i] = false;
  return { locations, missing, time, values };
}

// solverInfo：取每個場的初始殘差（*_initial）
export function residualSeries(dat) {
  const out = { time: column(dat, 'Time') || [], fields: {} };
  dat.columns.forEach((c, i) => {
    const m = /^(.+)_initial$/.exec(c);
    if (m) out.fields[m[1]] = dat.rows.map(r => (typeof r[i] === 'number' ? r[i] : NaN));
  });
  return out;
}

// yPlus：每個 patch 最後一個時間的 min／max／average
export function yPlusSummary(dat) {
  const iP = dat.columns.findIndex(c => /patch/i.test(c));
  const iMin = dat.columns.findIndex(c => /^min$/i.test(c)), iMax = dat.columns.findIndex(c => /^max$/i.test(c)), iAvg = dat.columns.findIndex(c => /^av(era)?ge?$/i.test(c));
  const out = {};
  if (iP < 0) return out;
  for (const r of dat.rows) out[r[iP]] = { time: r[0], min: r[iMin], max: r[iMax], average: r[iAvg] };
  return out;
}
