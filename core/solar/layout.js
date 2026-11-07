// 陣列配置：產生板片的平行四邊形（o、a、b）與遮擋三角形，給 shading.js 用；也可以拿來擺 3D 模型。
// 座標：X 東、Y 上、Z 南，長度 mm。a = 板長邊向量、b = 板短邊向量，a × b = 板面法向（受光面）。
import * as dm from '../math/dmath.js';
import { D2R } from './spa.js';
import { trackerNormal } from './tracking.js';

const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const add = (p, ...vs) => vs.reduce((s, [v, k]) => [s[0] + v[0] * k, s[1] + v[1] * k, s[2] + v[2] * k], p);
// 水平方位 → 場景單位向量
export const azimuthVector = az => [dm.sin(az * D2R), 0, -dm.cos(az * D2R)];
// 單軸追日的軸方向（沿 axisAzimuth、往該方向向下傾 axisTilt）
export const axisVector = (axisAzimuth, axisTilt = 0) => { const c = dm.cos(axisTilt * D2R); return [c * dm.sin(axisAzimuth * D2R), -dm.sin(axisTilt * D2R), -c * dm.cos(axisAzimuth * D2R)]; };

/**
 * 單軸追日陣列（1P 直式或 2P）。各排軸線平行，排距 pitch（水平、垂直於軸）。
 * @param c { rows = 5, modulesPerRow = 20, module = { length: 2384, width: 1303 }, portrait = 1（跨軸方向幾片）, gap = 20,
 *            pitch, axisAzimuth = 180, axisTilt = 0, height = 1500（軸心離地）, origin = [0,0,0],
 *            ground = null（(x, z) → 地面高，軸心依此墊高；坡地時用）, torqueTube = 0（軸管直徑；>0 時加入遮擋） }
 * @returns {{ rows: [{ center, axis }], count, pose(thetaOf) → modules[], triangles(modules, list) }}
 *   thetaOf：數字（各排同角）或 (rowIndex) → 角度。
 */
export function trackerArray(c) {
  const { rows = 5, modulesPerRow = 20, module = { length: 2384, width: 1303 }, portrait = 1, gap = 20, pitch, axisAzimuth = 180, axisTilt = 0, height = 1500, origin = [0, 0, 0], ground = null } = c;
  const ax = axisVector(axisAzimuth, axisTilt), across = azimuthVector(axisAzimuth + 90);
  const rowLen = modulesPerRow * module.width + (modulesPerRow - 1) * gap;
  const R = [];
  for (let r = 0; r < rows; r++) {
    const off = (r - (rows - 1) / 2) * pitch;
    const p = add(origin, [across, off]);
    const y = ground ? ground(p[0], p[2]) + height : origin[1] + height;
    R.push({ center: [p[0], y, p[2]], axis: ax });
  }
  function pose(thetaOf) {
    const mods = [];
    R.forEach((row, ri) => {
      const th = typeof thetaOf === 'function' ? thetaOf(ri) : thetaOf;
      const n = trackerNormal(th, axisTilt, axisAzimuth), b = ax, a = cross(b, n);   // a 跨軸、b 沿軸
      for (let m = 0; m < modulesPerRow; m++) for (let k = 0; k < portrait; k++) {
        const s = -rowLen / 2 + m * (module.width + gap);
        const t = (k - portrait / 2) * (module.length + gap) + (portrait > 1 ? gap / 2 : 0);
        const o = add(row.center, [b, s], [a, portrait === 1 ? -module.length / 2 : t]);
        mods.push({ o, a: a.map(v => v * module.length), b: b.map(v => v * module.width), row: ri, index: mods.length, owner: mods.length });
      }
    });
    return mods;
  }
  return { rows: R, count: rows * modulesPerRow * portrait, rowLength: rowLen, pose, axis: ax };
}

/**
 * 固定傾角陣列（桌台）。每排 nUp 片沿坡向上（直式 portrait = true 時長邊沿坡）。
 * @param c { rows = 5, modulesPerRow = 20, nUp = 2, module, portrait = true, gap = 20, tilt = 20, azimuth = 180,
 *            pitch（排距，水平、沿朝向）, frontHeight = 500（前緣離地）, origin, ground }
 */
export function fixedArray(c) {
  const { rows = 5, modulesPerRow = 20, nUp = 2, module = { length: 2384, width: 1303 }, portrait = true, gap = 20, tilt = 20, azimuth = 180, pitch, frontHeight = 500, origin = [0, 0, 0], ground = null } = c;
  const f = azimuthVector(azimuth), up = [0, 1, 0], b0 = dm.sin(tilt * D2R), c0 = dm.cos(tilt * D2R);
  const s = [-f[0] * c0, b0, -f[2] * c0];   // 沿坡往上
  const n = [f[0] * b0, c0, f[2] * b0];
  const rowDir = cross(s, n);                // s × n：沿排（a × b = n 時，b = n × a）
  const [la, lb] = portrait ? [module.length, module.width] : [module.width, module.length];
  const rowLen = modulesPerRow * lb + (modulesPerRow - 1) * gap;
  const mods = [];
  for (let r = 0; r < rows; r++) {
    const p = add(origin, [f, (r - (rows - 1) / 2) * pitch]);
    const y = (ground ? ground(p[0], p[2]) : origin[1]) + frontHeight;
    const front = [p[0], y, p[2]];
    for (let k = 0; k < nUp; k++) for (let m = 0; m < modulesPerRow; m++) {
      const a = s.map(v => v * la), bdir = cross(n, s), b = bdir.map(v => v * lb);
      const o = add(front, [s, k * (la + gap)], [bdir, -rowLen / 2 + m * (lb + gap)]);
      mods.push({ o, a, b, row: r, index: mods.length, owner: mods.length });
    }
  }
  return { modules: mods, count: mods.length, slopeLength: nUp * la + (nUp - 1) * gap, rowDir, normal: n };
}

// 板片 → 遮擋三角形（每片兩個，擁有者 = 板片 owner）
export function modulesToTriangles(mods, list) {
  for (const m of mods) {
    const p0 = m.o, p1 = add(m.o, [m.a, 1]), p2 = add(m.o, [m.a, 1], [m.b, 1]), p3 = add(m.o, [m.b, 1]);
    list.addQuad(p0, p1, p2, p3, m.owner);
  }
  return list;
}
// 只更新座標（追日轉動後給 bvh.refit 用；順序與 modulesToTriangles 相同）
export function modulesToPositions(mods, out = new Float64Array(mods.length * 18)) {
  let i = 0;
  const put = p => { out[i++] = p[0]; out[i++] = p[1]; out[i++] = p[2]; };
  for (const m of mods) {
    const p0 = m.o, p1 = add(m.o, [m.a, 1]), p2 = add(m.o, [m.a, 1], [m.b, 1]), p3 = add(m.o, [m.b, 1]);
    put(p0); put(p1); put(p2); put(p0); put(p2); put(p3);
  }
  return out;
}
// 冬至排距：固定傾角桌台在冬至日 [h0, h1] 真太陽時內前排不遮後排所需的最小排距（水平，沿朝向）
// slopeLength 桌台斜長、tilt 傾角；回傳 { pitch, worstElevation, worstAzimuth }
export function winterSolsticePitch({ lat, slopeLength, tilt, azimuth = 180, hours = [9, 15], decl = -23.44 }) {
  const D = D2R, s = slopeLength;
  const rise = s * dm.sin(tilt * D), run = s * dm.cos(tilt * D);
  let worst = { pitch: 0 };
  for (let h = hours[0]; h <= hours[1] + 1e-9; h += 0.05) {
    const H = (h - 12) * 15 * D, d = decl * D, p = lat * D;
    const sinEl = dm.sin(p) * dm.sin(d) + dm.cos(p) * dm.cos(d) * dm.cos(H), el = dm.asin(sinEl);
    if (el <= 0) return { pitch: Infinity };
    const cosAz = (dm.sin(d) - sinEl * dm.sin(p)) / (dm.cos(el) * dm.cos(p));
    let az = dm.acos(Math.max(-1, Math.min(1, cosAz))) / D; if (H > 0) az = 360 - az;
    // 陰影長度（沿朝向的分量）：rise / tan(el) × cos(太陽方位 − 朝向)
    const L = rise / dm.tan(el) * dm.cos((az - azimuth) * D) + run;
    if (L > worst.pitch) worst = { pitch: L, worstElevation: el / D, worstAzimuth: az, hour: h };
  }
  return worst;
}
