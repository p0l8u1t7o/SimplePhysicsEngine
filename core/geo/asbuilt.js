// core/geo/asbuilt.js：設計與現況比對（樁頂高程、平面偏移、排直線度、排距、支架傾角）。
// 輸入都是案場座標（mm）；輸出是 layoutChecks 格式的列 { group, name, ok, value, note }，另附數值欄位 dev、tol。
// 決定性：只有排序與算術。
import { SITE_PRECISION } from '../solar/precision.js';

const R2D = 180 / Math.PI;

// ---------------------------------------------------------------- 幾何擬合
/**
 * 最小平方擬合平面 y = a·x + b·z + c（垂直殘差；傾角 < 60° 的支架、地面都適用）。
 * @param {Array<{x,y,z}>|Float64Array} pts 點或 xyz 交錯陣列
 * @param {object} [site] 給的話另外算真方位角（createSiteFrame）
 * @returns {{ a, b, c, tiltDeg, downslope: {x, z}, aspectDeg, rms, n }}
 *   downslope：最陡下坡方向（案場平面單位向量）；aspectDeg：下坡方向的真方位角（朝南的板面約 180°）
 */
export function fitPlane(pts, site) {
  const P = Array.isArray(pts) ? pts : Array.from({ length: pts.length / 3 }, (_, i) => ({ x: pts[3 * i], y: pts[3 * i + 1], z: pts[3 * i + 2] }));
  const n = P.length;
  if (n < 3) return null;
  // 以重心為原點，避免大數值相減
  let mx = 0, my = 0, mz = 0;
  for (const p of P) { mx += p.x; my += p.y; mz += p.z; }
  mx /= n; my /= n; mz /= n;
  let sxx = 0, sxz = 0, szz = 0, sxy = 0, szy = 0;
  for (const p of P) {
    const x = p.x - mx, z = p.z - mz, y = p.y - my;
    sxx += x * x; sxz += x * z; szz += z * z; sxy += x * y; szy += z * y;
  }
  const det = sxx * szz - sxz * sxz;
  if (Math.abs(det) < 1e-12) return null;
  const a = (sxy * szz - szy * sxz) / det, b = (szy * sxx - sxy * sxz) / det;
  const c = my - a * mx - b * mz;
  let ss = 0;
  for (const p of P) ss += (p.y - (a * p.x + b * p.z + c)) ** 2;
  const g = Math.hypot(a, b);
  const downslope = g > 1e-12 ? { x: -a / g, z: -b / g } : { x: 0, z: 0 };
  const aspectDeg = g > 1e-12 ? (site ? site.azimuthOf(downslope.x, downslope.z) : ((Math.atan2(downslope.x, -downslope.z) * R2D) + 360) % 360) : NaN;
  return { a, b, c, tiltDeg: Math.atan(g) * R2D, downslope, aspectDeg, rms: Math.sqrt(ss / n), n, center: { x: mx, y: my, z: mz } };
}

/** 平面上的點擬合直線（主成分），回傳方向、重心與最大垂直殘差 */
export function fitLine(pts) {
  const n = pts.length;
  if (n < 2) return null;
  let mx = 0, mz = 0;
  for (const p of pts) { mx += p.x; mz += p.z; }
  mx /= n; mz /= n;
  let sxx = 0, sxz = 0, szz = 0;
  for (const p of pts) { const x = p.x - mx, z = p.z - mz; sxx += x * x; sxz += x * z; szz += z * z; }
  const th = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const dir = { x: Math.cos(th), z: Math.sin(th) };
  let maxRes = 0;
  for (const p of pts) maxRes = Math.max(maxRes, Math.abs(-(p.x - mx) * dir.z + (p.z - mz) * dir.x));
  return { center: { x: mx, z: mz }, dir, maxResidual: maxRes };
}

// ---------------------------------------------------------------- 量測
// 點的平面格網索引（找半徑內的點）
function gridIndex(positions, cell) {
  const map = new Map();
  const n = positions.length / 3;
  for (let i = 0; i < n; i++) {
    const k = `${Math.floor(positions[3 * i] / cell)},${Math.floor(positions[3 * i + 2] / cell)}`;
    let a = map.get(k);
    if (!a) map.set(k, a = []);
    a.push(i);
  }
  return {
    near(x, z, r) {
      const out = [];
      const i0 = Math.floor((x - r) / cell), i1 = Math.floor((x + r) / cell), j0 = Math.floor((z - r) / cell), j1 = Math.floor((z + r) / cell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const a = map.get(`${i},${j}`);
        if (a) for (const k of a) if ((positions[3 * k] - x) ** 2 + (positions[3 * k + 2] - z) ** 2 <= r * r) out.push(k);
      }
      return out.sort((p, q) => p - q);
    },
  };
}

/**
 * 量測樁頂（或任何「比周圍高的點狀物」）的實際位置與高程。
 * @param {Array<{id, row?, x, z, top}>} design 設計樁位（案場 mm；top 是設計樁頂 y）
 * @param {{ positions: Float64Array }|{ heightAt(x,z): number, resolution: number }} source
 *   點雲（createPointCloud 的 positions）或高程取樣（terrain.heightAt／rasterSampler，resolution = DSM 像素大小 mm）
 * @param {object} [o]
 * @param {number} [o.searchRadius=300] 在設計位置多大半徑內找（mm）
 * @param {number} [o.topBand=30] 樁頂帶：比最高點低多少以內算樁頂（mm）
 * @param {number} [o.minPoints=5] 點雲樁頂帶至少幾點
 * @param {number} [o.minRise=200] 樁頂至少要比搜尋範圍內最低點高多少（mm），否則判定找不到
 * @returns {Array<{ id, row, design, measured: {x, z, top, n}|null }>}
 */
export function measurePiles(design, source, o = {}) {
  const r = o.searchRadius ?? 300, band = o.topBand ?? 30, minPts = o.minPoints ?? 5, minRise = o.minRise ?? 200;
  const idx = source.positions ? gridIndex(source.positions, Math.max(r, 100)) : null;
  return design.map(d => {
    let cand = [];
    if (idx) {
      const P = source.positions;
      cand = idx.near(d.x, d.z, r).map(k => ({ x: P[3 * k], y: P[3 * k + 1], z: P[3 * k + 2] }));
    } else {
      const step = source.resolution || 50;
      const n = Math.ceil(r / step);
      for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
        const x = d.x + i * step, z = d.z + j * step;
        if (i * i + j * j > n * n) continue;
        const y = source.heightAt(x, z);
        if (!Number.isNaN(y)) cand.push({ x, y, z });
      }
    }
    if (!cand.length) return { id: d.id, row: d.row, design: d, measured: null };
    const ys = cand.map(p => p.y).sort((a, b) => a - b);
    const lo = ys[0];
    // 點雲用 98 百分位當樁頂（排除零星雜訊）；DSM 用最大值
    const top = idx ? ys[Math.min(ys.length - 1, Math.floor(ys.length * 0.98))] : ys[ys.length - 1];
    const topPts = cand.filter(p => p.y >= top - band && p.y <= top + band);
    if (top - lo < minRise || (idx && topPts.length < minPts)) return { id: d.id, row: d.row, design: d, measured: null };
    let sx = 0, sz = 0, sy = 0;
    for (const p of topPts) { sx += p.x; sz += p.z; sy += p.y; }
    const n = topPts.length;
    return { id: d.id, row: d.row, design: d, measured: { x: sx / n, z: sz / n, top: idx ? sy / n : top, n } };
  });
}

/** 取出某個平面範圍（中心、長寬、方向）內的點，給 fitPlane 用 */
export function pointsInFootprint(positions, { x, z, length, width, dir = { x: 1, z: 0 }, minY = -Infinity }) {
  const out = [];
  const n = positions.length / 3;
  for (let i = 0; i < n; i++) {
    const dx = positions[3 * i] - x, dz = positions[3 * i + 2] - z;
    const u = dx * dir.x + dz * dir.z, v = -dx * dir.z + dz * dir.x;
    if (Math.abs(u) <= length / 2 && Math.abs(v) <= width / 2 && positions[3 * i + 1] >= minY) out.push({ x: positions[3 * i], y: positions[3 * i + 1], z: positions[3 * i + 2] });
  }
  return out;
}

// ---------------------------------------------------------------- 比對報告
// 數字格式：不顯示「-0」；sgn 加正號
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d).replace(/^-(0(\.0+)?)$/, '$1') : '—');
const sgn = (v, d = 0) => { const s = fmt(v, d); return /^[-—]/.test(s) || /^0(\.0+)?$/.test(s) ? s : `+${s}`; };

/**
 * 產生 layoutChecks 格式的比對列。
 * @param {ReturnType<typeof measurePiles>} piles
 * @param {object} [o]
 * @param {object} [o.tol] 容許值：height（樁頂高程，mm，預設 30）、plan（平面偏移，50）、straightness（排直線度，50）、
 *   spacing（排距，50）、azimuthDeg（排方向，0.5）、tiltDeg（傾角，1）、aspectDeg（板面方位，2）
 * @param {Array<{ id, points: Array<{x,y,z}>, tiltDeg, aspectDeg }>} [o.tables] 支架／板面：實測點與設計傾角、方位
 * @param {object} [o.site] 給 fitPlane 算真方位角
 * @param {string} [o.group='as-built']
 */
export function asBuiltChecks(piles, o = {}) {
  // 高程、平面、直線度、排距的預設照案場高精度門檻（core/solar/precision.js，2026-11-07 拍板）
  const P = SITE_PRECISION, tol = { height: P.heightMm, plan: P.planMm, straightness: P.planMm, spacing: P.planMm, azimuthDeg: 0.5, tiltDeg: 1, aspectDeg: 2, ...(o.tol || {}) };
  const group = o.group || 'as-built';
  const rows = [];
  // 每支樁
  for (const p of piles) {
    if (!p.measured) {
      rows.push({ group, name: `樁 ${p.id} 找到`, ok: false, value: '找不到', note: '搜尋範圍內沒有明顯高起的樁頂（遮蔽、雜草或尚未施工）', kind: 'pile' });
      continue;
    }
    const dh = p.measured.top - p.design.top;
    const dx = p.measured.x - p.design.x, dz = p.measured.z - p.design.z, dp = Math.hypot(dx, dz);
    rows.push({ group, name: `樁 ${p.id} 樁頂高程`, ok: Math.abs(dh) <= tol.height, value: `${sgn(dh)} mm`, note: `容許 ±${tol.height} mm`, dev: dh, tol: tol.height, kind: 'height' });
    rows.push({ group, name: `樁 ${p.id} 平面偏移`, ok: dp <= tol.plan, value: `${fmt(dp)} mm（東 ${fmt(dx)}、南 ${fmt(dz)}）`, note: `容許 ${tol.plan} mm`, dev: dp, tol: tol.plan, kind: 'plan' });
  }
  // 每一排：直線度、方向；相鄰排：排距
  const byRow = new Map();
  for (const p of piles) if (p.row != null) { if (!byRow.has(p.row)) byRow.set(p.row, []); byRow.get(p.row).push(p); }
  const rowKeys = [...byRow.keys()];
  const lines = new Map();
  for (const k of rowKeys) {
    const ps = byRow.get(k);
    const des = fitLine(ps.map(p => p.design));
    const mea = fitLine(ps.filter(p => p.measured).map(p => p.measured));
    lines.set(k, { des, mea });
    if (!des || !mea) continue;
    // 讓兩條線同向
    if (des.dir.x * mea.dir.x + des.dir.z * mea.dir.z < 0) { mea.dir.x *= -1; mea.dir.z *= -1; }
    rows.push({ group, name: `排 ${k} 直線度`, ok: mea.maxResidual <= tol.straightness, value: `${fmt(mea.maxResidual)} mm`, note: `樁位到擬合直線的最大距離，容許 ${tol.straightness} mm`, dev: mea.maxResidual, tol: tol.straightness, kind: 'straightness' });
    const dAz = Math.atan2(des.dir.x * mea.dir.z - des.dir.z * mea.dir.x, des.dir.x * mea.dir.x + des.dir.z * mea.dir.z) * R2D;
    rows.push({ group, name: `排 ${k} 方向`, ok: Math.abs(dAz) <= tol.azimuthDeg, value: `${sgn(dAz, 2)}°`, note: `和設計排線的夾角，容許 ±${tol.azimuthDeg}°`, dev: dAz, tol: tol.azimuthDeg, kind: 'azimuth' });
  }
  for (let i = 0; i + 1 < rowKeys.length; i++) {
    const A = lines.get(rowKeys[i]), B = lines.get(rowKeys[i + 1]);
    if (!A.des || !B.des || !A.mea || !B.mea) continue;
    // 排距：下一排重心到這一排直線的垂直距離（設計與實測各算一次）
    const perp = (L, c) => Math.abs(-(c.x - L.center.x) * L.dir.z + (c.z - L.center.z) * L.dir.x);
    const sd = perp(A.des, B.des.center), sm = perp(A.mea, B.mea.center);
    const dv = sm - sd;
    rows.push({ group, name: `排 ${rowKeys[i]}–${rowKeys[i + 1]} 排距`, ok: Math.abs(dv) <= tol.spacing, value: `${fmt(sm)} mm（設計 ${fmt(sd)}，${sgn(dv)}）`, note: `容許 ±${tol.spacing} mm`, dev: dv, tol: tol.spacing, kind: 'spacing' });
  }
  // 支架／板面傾角
  for (const t of o.tables || []) {
    const f = fitPlane(t.points, o.site);
    if (!f) { rows.push({ group, name: `支架 ${t.id} 傾角`, ok: false, value: '點太少', note: '', kind: 'tilt' }); continue; }
    const dt = f.tiltDeg - t.tiltDeg;
    rows.push({ group, name: `支架 ${t.id} 傾角`, ok: Math.abs(dt) <= tol.tiltDeg, value: `${fmt(f.tiltDeg, 2)}°（設計 ${fmt(t.tiltDeg, 1)}°，${sgn(dt, 2)}°）`, note: `擬合 ${f.n} 點、殘差 RMS ${fmt(f.rms, 1)} mm，容許 ±${tol.tiltDeg}°`, dev: dt, tol: tol.tiltDeg, kind: 'tilt' });
    if (t.aspectDeg != null) {
      const da = ((f.aspectDeg - t.aspectDeg + 540) % 360) - 180;
      rows.push({ group, name: `支架 ${t.id} 方位`, ok: Math.abs(da) <= tol.aspectDeg, value: `${fmt(f.aspectDeg, 1)}°（設計 ${fmt(t.aspectDeg, 1)}°）`, note: `板面朝向（下坡方向的真方位角），容許 ±${tol.aspectDeg}°`, dev: da, tol: tol.aspectDeg, kind: 'aspect' });
    }
  }
  return rows;
}

/** 統計：{ total, ok, fail, byKind: { height: { n, fail, maxAbs } … } } */
export function summarize(rows) {
  const byKind = {};
  for (const r of rows) {
    const k = byKind[r.kind] || (byKind[r.kind] = { n: 0, fail: 0, maxAbs: 0 });
    k.n++; if (!r.ok) k.fail++;
    if (Number.isFinite(r.dev)) k.maxAbs = Math.max(k.maxAbs, Math.abs(r.dev));
  }
  const fail = rows.filter(r => !r.ok).length;
  return { total: rows.length, ok: rows.length - fail, fail, byKind };
}
