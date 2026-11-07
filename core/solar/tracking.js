// 固定式與單軸追日（含回溯 backtracking 與坡地 cross-axis tilt）。公式與 pvlib.tracking 相同：
//   Anderson & Mikofski, "Slope-Aware Backtracking for Single-Axis Trackers", NREL/TP-5K00-76626 (2020)；
//   Lorenzo et al., "Tracking and back-tracking", Prog. Photovolt. 19(6) (2011)。
// 角度一律用度。追日轉角 theta 的正負：沿 axisAzimuth 看向軸的正方向，右手定則；
//   軸朝南（axisAzimuth = 180）時 theta > 0 是板面轉向西、theta < 0 轉向東。
import * as dm from '../math/dmath.js';
import { D2R, R2D, aoiProjection } from './spa.js';

const mod360 = x => { const r = x % 360; return r < 0 ? r + 360 : r; };
const sind = x => dm.sin(x * D2R), cosd = x => dm.cos(x * D2R);

// 理想追日角（太陽在垂直於軸的平面上的投影天頂角，度）；太陽在地平線下回傳 NaN
export function projectedZenith(zenith, azimuth, axisTilt = 0, axisAzimuth = 0) {
  const sz = sind(zenith), sx = sz * sind(azimuth), sy = sz * cosd(azimuth), szz = cosd(zenith);
  const ca = cosd(axisAzimuth), sa = sind(axisAzimuth), st = sind(axisTilt);
  const xp = sx * ca - sy * sa;
  const zp = sx * sa * st + sy * st * ca + szz * cosd(axisTilt);
  return dm.atan2(xp, zp) * R2D;
}

// 轉角 → 板面法向（東、北、上；pvlib 的 _unit_normal）
export function trackerNormalENU(theta, axisTilt = 0, axisAzimuth = 0) {
  const cA = cosd(-axisAzimuth), sA = sind(-axisAzimuth), cT = cosd(-axisTilt), sT = sind(-axisTilt), cTh = cosd(theta), sTh = sind(theta);
  return [sA * sT * cTh + cA * sTh, sA * sTh - cA * sT * cTh, cT * cTh];
}
// 同上，場景座標（X 東、Y 上、Z 南）
export function trackerNormal(theta, axisTilt = 0, axisAzimuth = 0, out = [0, 0, 0]) {
  const n = trackerNormalENU(theta, axisTilt, axisAzimuth);
  out[0] = n[0]; out[1] = n[2]; out[2] = -n[1];
  return out;
}
// 轉角 → { tilt, azimuth } 板面傾角與朝向（pvlib.tracking.calc_surface_orientation）
export function surfaceOrientation(theta, axisTilt = 0, axisAzimuth = 0) {
  const tilt = dm.acos(cosd(theta) * cosd(axisTilt)) * R2D;
  const n = trackerNormalENU(theta, axisTilt, axisAzimuth);
  const az = tilt === 0 ? axisAzimuth - 90 : dm.atan2(n[0], n[1]) * R2D;
  return { tilt, azimuth: mod360(az) };
}

// 坡地：沿 axisAzimuth 的軸，在傾斜 slopeTilt、朝 slopeAzimuth 的坡面上的軸傾角（pvlib.tracking.calc_axis_tilt）
export function calcAxisTilt(slopeAzimuth, slopeTilt, axisAzimuth) {
  return dm.atan(cosd(axisAzimuth - slopeAzimuth) * dm.tan(slopeTilt * D2R)) * R2D;
}
// 坡地：橫跨各排軸線的坡度（cross-axis tilt，右手定則；pvlib.tracking.calc_cross_axis_tilt）
export function calcCrossAxisTilt(slopeAzimuth, slopeTilt, axisAzimuth, axisTilt) {
  const dg = axisAzimuth - slopeAzimuth, ba = axisTilt, bg = slopeTilt;
  const vx = sind(dg) * cosd(ba) * cosd(bg);
  const vy = sind(ba) * sind(bg) + cosd(dg) * cosd(ba) * cosd(bg);
  const vz = -sind(dg) * sind(bg) * cosd(ba);
  const vn = Math.sqrt(vx * vx + vy * vy + vz * vz);
  return dm.asin(((vx * cosd(dg) - vy * sind(dg)) * sind(ba) + vz * cosd(ba)) / vn) * R2D;
}

/**
 * 單軸追日轉角（pvlib.tracking.singleaxis）。
 * @param {number} zenith 太陽視天頂角（度，含折射）
 * @param {number} azimuth 太陽方位角（度）
 * @param {object} t { axisTilt = 0, axisAzimuth = 180, maxAngle = 60（或 [min, max]）, backtrack = true, gcr = 2/7, crossAxisTilt = 0, stow = NaN }
 *   gcr = 板寬（垂直於軸）/ 排距；stow：太陽在地平線下時的轉角（預設 NaN，與 pvlib 相同；動畫可給 0）
 * @returns {{ theta, ideal, tilt, surfaceAzimuth, aoi, backtracking }}
 */
export function singleAxis(zenith, azimuth, t = {}) {
  const { axisTilt = 0, axisAzimuth = 180, maxAngle = 60, backtrack = true, gcr = 2 / 7, crossAxisTilt = 0, stow = NaN } = t;
  if (!(zenith <= 90)) {
    if (Number.isNaN(stow)) return { theta: NaN, ideal: NaN, tilt: NaN, surfaceAzimuth: NaN, aoi: NaN, backtracking: false };
    const o = surfaceOrientation(stow, axisTilt, axisAzimuth);
    return { theta: stow, ideal: NaN, tilt: o.tilt, surfaceAzimuth: o.azimuth, aoi: NaN, backtracking: false };
  }
  const ideal = projectedZenith(zenith, azimuth, axisTilt, axisAzimuth);
  let theta = ideal, bt = false;
  if (backtrack) {
    const axesDistance = 1 / (gcr * cosd(crossAxisTilt));
    const temp = Math.abs(axesDistance * cosd(ideal - crossAxisTilt));
    if (temp < 1) { theta = ideal + -Math.sign(ideal) * dm.acos(temp) * R2D; bt = true; }
  }
  const [lo, hi] = Array.isArray(maxAngle) ? maxAngle : [-maxAngle, maxAngle];
  theta = theta < lo ? lo : theta > hi ? hi : theta;
  const o = surfaceOrientation(theta, axisTilt, axisAzimuth);
  const aoi = dm.acos(aoiProjection(o.tilt, o.azimuth, zenith, azimuth)) * R2D;
  return { theta, ideal, tilt: o.tilt, surfaceAzimuth: o.azimuth, aoi, backtracking: bt };
}

// 固定式：回傳同樣的欄位，方便 energy.js 統一處理
export function fixedMount(zenith, azimuth, { tilt = 20, azimuth: surfaceAzimuth = 180 } = {}) {
  const aoi = dm.acos(aoiProjection(tilt, surfaceAzimuth, zenith, azimuth)) * R2D;
  return { theta: 0, ideal: 0, tilt, surfaceAzimuth, aoi, backtracking: false };
}

// mount 設定 → 姿態函式；mount = { type: 'fixed', tilt, azimuth } 或 { type: 'singleAxis', ...singleAxis 參數 }
export function mountOrientation(mount) {
  if (mount.type === 'singleAxis') return (z, a) => singleAxis(z, a, mount);
  if (mount.type === 'fixed') return (z, a) => fixedMount(z, a, mount);
  throw new Error(`未知的 mount.type：${mount.type}`);
}

// 單排遮陰（2D、無限長排）：前一排（轉角 shadingTheta，預設同 theta）遮到本排（轉角 theta）的板寬比例 0～1。
// 與 pvlib.shading.shaded_fraction1d（Anderson & Jensen 2024）相同；width 板寬、pitch 排距、offset 板面到轉軸距離，同單位。
export function rowShadedFraction1D(zenith, azimuth, { axisTilt = 0, axisAzimuth = 180, theta, shadingTheta = theta, width, pitch, crossAxisTilt = 0, offset = 0 }) {
  const psz = projectedZenith(zenith, azimuth, axisTilt, axisAzimuth);
  const d1 = shadingTheta - psz, d2 = theta - psz, dS = psz - crossAxisTilt;
  const c2 = Math.abs(cosd(d2));
  const t = 0.5 + Math.abs(cosd(d1)) / c2 / 2 + Math.sign(psz) * offset / width / c2 * (sind(d2) - sind(d1)) - pitch / width * cosd(dS) / c2 / cosd(crossAxisTilt);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
