// 日射：大氣層外日射、空氣質量、晴空模型（Ineichen–Perez）、GHI 分解（Erbs、DISC）、
// 斜面轉換（等向、Hay–Davies、Perez 1990）、地面反射、入射角損失（IAM）。
// 公式與 pvlib 0.16 相同（各函式註明對應的 pvlib 函式）；角度用度、日射 W/m²、氣壓 Pa。
import * as dm from '../math/dmath.js';
import { D2R, aoiProjection, civilFromDays, daysFromCivil } from './spa.js';
import { LINKE_TW } from './linke-tw.js';

const cosd = x => dm.cos(x * D2R), sind = x => dm.sin(x * D2R);

// ---------------------------------------------------------------- 大氣層外與空氣質量
// 大氣層外法向日射（pvlib.irradiance.get_extra_radiation）。doy 是整數日序（1 起算）。
// method：'spencer'（預設）、'asce'；或給 R（SPA 的日地距離，AU）用 'nrel'：E0 = S / R²
export function extraRadiation(doy, { method = 'spencer', solarConstant = 1366.1, R } = {}) {
  if (method === 'nrel') return solarConstant / (R * R);
  if (method === 'asce') return solarConstant * (1 + 0.033 * dm.cos(2 * Math.PI / 365 * doy));
  const B = 2 * Math.PI / 365 * (doy - 1);
  return solarConstant * (1.00011 + 0.034221 * dm.cos(B) + 0.00128 * dm.sin(B) + 0.000719 * dm.cos(2 * B) + 0.000077 * dm.sin(2 * B));
}
// 相對空氣質量（pvlib.atmosphere.get_relative_airmass）；天頂角 > 90° 回傳 NaN
export function relativeAirmass(zenith, model = 'kastenyoung1989') {
  if (!(zenith <= 90)) return NaN;
  const zr = zenith * D2R;
  if (model === 'kastenyoung1989') return 1 / (dm.cos(zr) + 0.50572 * dm.pow((6.07995 + (90 - zenith)), -1.6364));
  if (model === 'kasten1966') return 1 / (dm.cos(zr) + 0.15 * dm.pow((93.885 - zenith), -1.253));
  if (model === 'simple') return 1 / dm.cos(zr);
  throw new Error(`未知的空氣質量模型：${model}`);
}
export const absoluteAirmass = (am, pressure = 101325) => am * pressure / 101325;
// 由海拔估氣壓（pvlib.atmosphere.alt2pres）
export const altitudeToPressure = alt => 100 * dm.pow(((44331.514 - alt) / 11880.516), (1 / 0.1902632));

// ---------------------------------------------------------------- 晴空
// 台灣範圍的 Linke 濁度（pvlib.clearsky.lookup_linke_turbidity，interp_turbidity=True 的同一套內插）。
// unix：UTC 秒；回傳 TL（無因次）。範圍外丟錯。
let LT = null;
function linkeBytes() {
  if (LT) return LT;
  const s = LINKE_TW.data, map = new Int16Array(128).fill(-1), A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < 64; i++) map[A.charCodeAt(i)] = i;
  let n = s.length; while (s[n - 1] === '=') n--;
  const out = new Uint8Array(Math.floor(n * 3 / 4));
  for (let i = 0, o = 0; i < n; i += 4) {
    const a = map[s.charCodeAt(i)], b = map[s.charCodeAt(i + 1)], c = i + 2 < n ? map[s.charCodeAt(i + 2)] : 0, d = i + 3 < n ? map[s.charCodeAt(i + 3)] : 0;
    const v = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = v >> 16 & 255; if (o < out.length) out[o++] = v >> 8 & 255; if (o < out.length) out[o++] = v & 255;
  }
  return (LT = out);
}
const degToIndex = (deg, lat) => {   // pvlib.clearsky._degrees_to_index（四捨五入到偶數與 numpy.around 相同）
  const [inMin, inMax, outMax] = lat ? [90, -90, 2160] : [-180, 180, 4320];
  const scale = outMax / (inMax - inMin), center = inMin + 1 / scale / 2, idx = (deg - center) * scale;
  const f = Math.floor(idx), r = idx - f;
  return r > 0.5 ? f + 1 : r < 0.5 ? f : (f % 2 === 0 ? f : f + 1);
};
export function linkeTurbidityTW(lat, lon, unix, { interpolate = true } = {}) {
  const i = degToIndex(lat, true) - LINKE_TW.i0, j = degToIndex(lon, false) - LINKE_TW.j0;
  if (i < 0 || j < 0 || i >= LINKE_TW.ni || j >= LINKE_TW.nj) throw new Error(`Linke 濁度表只涵蓋台灣範圍：${lat}, ${lon}`);
  const B = linkeBytes(), base = (i * LINKE_TW.nj + j) * 12, lts = Array.from({ length: 12 }, (_, m) => B[base + m]);
  const days = Math.floor(unix / 86400), { year } = civilFromDays(days);   // pvlib 以 UTC 日序內插
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0, doy = days - daysFromCivil(year, 1, 1) + 1;
  const mdays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!interpolate) { let m = 0, s = 0; while (s + mdays[m] < doy) s += mdays[m++]; return lts[m] / 20; }
  // 每月中點（前後各補一個月，與 pvlib._calendar_month_middles 相同），線性內插
  const mid = [-31 / 2]; let c = 0;
  for (const d of mdays) { c += d; mid.push(c - d / 2); }
  mid.push((leap ? 366 : 365) + 31 / 2);   // 下一年一月中
  const v = [lts[11], ...lts, lts[0]];
  let k = 0; while (k < mid.length - 2 && doy > mid[k + 1]) k++;
  return (v[k] + (v[k + 1] - v[k]) * (doy - mid[k]) / (mid[k + 1] - mid[k])) / 20;
}

/**
 * Ineichen–Perez 晴空模型（pvlib.clearsky.ineichen）。
 * @param apparentZenith 度；amAbs 絕對空氣質量；tl Linke 濁度；altitude 公尺；dniExtra 預設 1364（與 pvlib 相同）
 * @returns {{ ghi, dni, dhi }}
 */
export function ineichen(apparentZenith, amAbs, tl, altitude = 0, dniExtra = 1364, perezEnhancement = false) {
  const cz = Math.max(cosd(apparentZenith), 0);
  if (!(amAbs >= 0) || cz <= 0) return { ghi: 0, dni: 0, dhi: 0 };
  const fh1 = dm.exp(-altitude / 8000), fh2 = dm.exp(-altitude / 1250);
  const cg1 = 5.09e-5 * altitude + 0.868, cg2 = 3.92e-5 * altitude + 0.0387;
  let g = dm.exp(-cg2 * amAbs * (fh1 + fh2 * (tl - 1)));
  if (perezEnhancement) g *= dm.exp(0.01 * dm.pow(amAbs, 1.8));
  const ghi = cg1 * dniExtra * cz * tl / tl * Math.max(g, 0);
  const b = 0.664 + 0.163 / fh1;
  const bnci = dniExtra * Math.max(b * dm.exp(-0.09 * amAbs * (tl - 1)), 0);
  const bnci2 = ghi * Math.min(Math.max((1 - (0.1 - 0.2 * dm.exp(-tl)) / (0.1 + 0.882 / fh1)) / cz, 0), 1e20);
  const dni = Math.min(bnci, bnci2);
  return { ghi, dni, dhi: ghi - dni * cz };
}
// 便捷版：直接由太陽位置算晴空（氣壓由海拔估）
export function clearSky(apparentZenith, { altitude = 0, tl = 3, pressure = altitudeToPressure(altitude), dniExtra = 1364 } = {}) {
  const am = relativeAirmass(apparentZenith);
  return ineichen(apparentZenith, absoluteAirmass(am, pressure), tl, altitude, dniExtra);
}

// ---------------------------------------------------------------- GHI 分解
export function clearnessIndex(ghi, zenith, extra, minCosZenith = 0.065, maxKt = 2) {
  const kt = ghi / (extra * Math.max(cosd(zenith), minCosZenith));
  return Math.min(Math.max(kt, 0), maxKt);
}
// Erbs（pvlib.irradiance.erbs）：GHI → DNI、DHI
export function erbs(ghi, zenith, doy, { minCosZenith = 0.065, maxZenith = 87 } = {}) {
  const kt = clearnessIndex(ghi, zenith, extraRadiation(doy), minCosZenith, 1);
  let df = 1 - 0.09 * kt;
  if (kt > 0.22 && kt <= 0.8) df = 0.9511 - 0.1604 * kt + 4.388 * dm.pow(kt, 2) - 16.638 * dm.pow(kt, 3) + 12.336 * dm.pow(kt, 4);
  if (kt > 0.8) df = 0.165;
  let dhi = df * ghi, dni = (ghi - dhi) / cosd(zenith);
  if (zenith > maxZenith || ghi < 0 || dni < 0) { dni = 0; dhi = ghi; }
  return { dni, dhi, kt };
}
// DISC（pvlib.irradiance.disc）：GHI → DNI（DHI 用 ghi − dni·cosZ 補齊）
export function disc(ghi, zenith, doy, { pressure = 101325, minCosZenith = 0.065, maxZenith = 87, maxAirmass = 12 } = {}) {
  const I0 = extraRadiation(doy, { solarConstant: 1370 });
  const kt = clearnessIndex(ghi, zenith, I0, minCosZenith, 1);
  let am = relativeAirmass(zenith, 'kasten1966');
  if (pressure != null) am = absoluteAirmass(am, pressure);
  am = Math.min(am, maxAirmass);
  const cloudy = kt <= 0.6;
  const a = cloudy ? 0.512 + kt * (-1.56 + kt * (2.286 - 2.222 * kt)) : -5.743 + kt * (21.77 + kt * (-27.49 + 11.56 * kt));
  const b = cloudy ? 0.37 + 0.962 * kt : 41.4 + kt * (-118.5 + kt * (66.05 + 31.9 * kt));
  const c = cloudy ? -0.28 + kt * (0.932 - 2.048 * kt) : -47.01 + kt * (184.2 + kt * (-222.0 + 73.81 * kt));
  const Knc = 0.866 + am * (-0.122 + am * (0.0121 + am * (-0.000653 + 1.4e-05 * am)));
  let dni = (Knc - (a + b * dm.exp(c * am))) * I0;
  if (zenith > maxZenith || ghi < 0 || dni < 0 || Number.isNaN(dni)) dni = 0;
  return { dni, dhi: ghi - dni * cosd(zenith), kt, airmass: am };
}
// 三個分量缺一個時補齊（pvlib.irradiance.complete_irradiance 的簡化：DNI 不做晴空容差）
export function completeIrradiance(zenith, { ghi, dhi, dni }) {
  const cz = cosd(zenith);
  if (dni == null) return { ghi, dhi, dni: cz > 0.0175 ? Math.max((ghi - dhi) / cz, 0) : 0 };
  if (ghi == null) return { ghi: dhi + dni * cz, dhi, dni };
  return { ghi, dhi: ghi - dni * cz, dni };
}

// ---------------------------------------------------------------- 斜面轉換
export const isotropicSky = (tilt, dhi) => dhi * (1 + cosd(tilt)) * 0.5;
export const groundDiffuse = (tilt, ghi, albedo = 0.25) => ghi * albedo * (1 - dm.cos(tilt * D2R)) * 0.5;
export const beamComponent = (tilt, az, zenith, sunAz, dni) => Math.max(dni * aoiProjection(tilt, az, zenith, sunAz), 0);

// Hay–Davies（pvlib.irradiance.haydavies）
export function haydavies(tilt, az, dhi, dni, dniExtra, zenith, sunAz) {
  const cosTT = Math.max(aoiProjection(tilt, az, zenith, sunAz), 0);
  const Rb = cosTT / Math.max(cosd(zenith), 0.01745);
  const AI = dni / dniExtra;
  const isotropic = Math.max(dhi * (1 - AI) * 0.5 * (1 + cosd(tilt)), 0), circumsolar = Math.max(dhi * AI * Rb, 0);
  return { total: isotropic + circumsolar, isotropic, circumsolar, horizon: 0 };
}

// Perez 1990 係數表（pvlib _get_perez_coefficients；每列 [F11, F12, F13, F21, F22, F23]）
export const PEREZ = {
  allsitescomposite1990: [[-0.008, 0.588, -0.062, -0.06, 0.072, -0.022], [0.13, 0.683, -0.151, -0.019, 0.066, -0.029], [0.33, 0.487, -0.221, 0.055, -0.064, -0.026], [0.568, 0.187, -0.295, 0.109, -0.152, -0.014], [0.873, -0.392, -0.362, 0.226, -0.462, 0.001], [1.132, -1.237, -0.412, 0.288, -0.823, 0.056], [1.06, -1.6, -0.359, 0.264, -1.127, 0.131], [0.678, -0.327, -0.25, 0.156, -1.377, 0.251]],
  allsitescomposite1988: [[-0.018, 0.705, -0.071, -0.058, 0.102, -0.026], [0.191, 0.645, -0.171, 0.012, 0.009, -0.027], [0.44, 0.378, -0.256, 0.087, -0.104, -0.025], [0.756, -0.121, -0.346, 0.179, -0.321, -0.008], [0.996, -0.645, -0.405, 0.26, -0.59, 0.017], [1.098, -1.29, -0.393, 0.269, -0.832, 0.075], [0.973, -1.135, -0.378, 0.124, -0.258, 0.149], [0.689, -0.412, -0.273, 0.199, -1.675, 0.237]],
};
const PEREZ_BINS = [0, 1.065, 1.23, 1.5, 1.95, 2.8, 4.5, 6.2];
/**
 * Perez 斜面天空散射（pvlib.irradiance.perez，return_components=True）。
 * airmass：相對空氣質量（pvlib 慣例）；zenith 一般用視天頂角。
 * @returns {{ total, isotropic, circumsolar, horizon }}
 */
export function perez(tilt, az, dhi, dni, dniExtra, zenith, sunAz, airmass, model = 'allsitescomposite1990') {
  if (Number.isNaN(airmass) || !(dhi > 0)) return { total: 0, isotropic: 0, circumsolar: 0, horizon: 0 };
  const kappa = 1.041, z = zenith * D2R;
  const delta = dhi * airmass / dniExtra;
  const eps = ((dhi + dni) / dhi + kappa * dm.pow(z, 3)) / (1 + kappa * dm.pow(z, 3));
  let bin = -1; for (let i = 0; i < 8; i++) if (eps >= PEREZ_BINS[i]) bin = i;
  if (bin < 0 || Number.isNaN(eps)) return { total: NaN, isotropic: NaN, circumsolar: NaN, horizon: NaN };
  const c = PEREZ[model][bin];
  const F1 = Math.max(c[0] + c[1] * delta + c[2] * z, 0), F2 = c[3] + c[4] * delta + c[5] * z;
  const A = Math.max(aoiProjection(tilt, az, zenith, sunAz), 0), B = Math.max(cosd(zenith), cosd(85));
  const t1 = 0.5 * (1 - F1) * (1 + cosd(tilt)), t2 = F1 * A / B, t3 = F2 * sind(tilt);
  const total = Math.max(dhi * (t1 + t2 + t3), 0);
  if (total === 0) return { total: 0, isotropic: 0, circumsolar: 0, horizon: 0 };
  return { total, isotropic: dhi * t1, circumsolar: dhi * t2, horizon: dhi * t3 };
}

/**
 * 斜面總日射（pvlib.irradiance.get_total_irradiance）。
 * @param p { tilt, azimuth（板面）, zenith, sunAzimuth, dni, ghi, dhi, dniExtra, airmass（相對）, albedo = 0.25, model = 'perez' | 'haydavies' | 'isotropic' }
 * @returns {{ global, direct, diffuse, sky, ground, isotropic, circumsolar, horizon, aoi }}
 */
export function poaIrradiance(p) {
  const { tilt, azimuth, zenith, sunAzimuth, dni, ghi, dhi, dniExtra = 1366.1, airmass = relativeAirmass(p.zenith), albedo = 0.25, model = 'perez' } = p;
  const proj = aoiProjection(tilt, azimuth, zenith, sunAzimuth);
  const direct = Math.max(dni * proj, 0);
  const s = model === 'perez' ? perez(tilt, azimuth, dhi, dni, dniExtra, zenith, sunAzimuth, airmass)
    : model === 'haydavies' ? haydavies(tilt, azimuth, dhi, dni, dniExtra, zenith, sunAzimuth)
      : { total: isotropicSky(tilt, dhi), isotropic: isotropicSky(tilt, dhi), circumsolar: 0, horizon: 0 };
  const ground = groundDiffuse(tilt, ghi, albedo);
  return { global: direct + s.total + ground, direct, diffuse: s.total + ground, sky: s.total, ground, isotropic: s.isotropic, circumsolar: s.circumsolar, horizon: s.horizon, aoi: dm.acos(proj) / D2R };
}

// ---------------------------------------------------------------- 入射角損失（IAM）
// 物理模型（De Soto 2006 / pvlib.iam.physical，玻璃 n=1.526、K=4 /m、L=2 mm，無抗反射膜）
export function iamPhysical(aoi, n = 1.526, K = 4, L = 0.002) {
  let ct = Math.max(0, cosd(aoi));
  if (aoi >= 90 && n === 1) return 0;
  const n1 = 1, n2 = n;
  let st = Math.sqrt(1 - ct * ct);
  const n1c1 = n1 * ct, n2c1 = n2 * ct;
  st = n1 / n2 * st; ct = Math.sqrt(1 - st * st);
  const n1c2 = n1 * ct, n2c2 = n2 * ct;
  const rs = dm.pow(((n1c1 - n2c2) / (n1c1 + n2c2)), 2), rp = dm.pow(((n1c2 - n2c1) / (n1c2 + n2c1)), 2), r0 = dm.pow(((n1 - n2) / (n1 + n2)), 2);
  let ts = 1 - rs, tp = 1 - rp, t0 = 1 - r0;
  ts *= dm.exp(-K * L / ct); tp *= dm.exp(-K * L / ct); t0 *= dm.exp(-K * L);
  const v = (ts + tp) / 2 / t0;
  return Number.isNaN(v) ? 0 : v;
}
export function iamAshrae(aoi, b = 0.05) {
  if (Math.abs(aoi) >= 90) return 0;
  return Math.max(0, 1 - b * (1 / dm.cos(aoi * D2R) - 1));
}
export function iamMartinRuiz(aoi, ar = 0.16) {
  if (Math.abs(aoi) >= 90) return 0;
  return (1 - dm.exp(-cosd(aoi) / ar)) / (1 - dm.exp(-1 / ar));
}
// Martin–Ruiz 散射 IAM（天空、地面；pvlib.iam.martin_ruiz_diffuse）
export function iamMartinRuizDiffuse(tilt, ar = 0.16, c1 = 0.4244, c2 = 0.5 * ar - 0.154) {
  if (tilt === 0) tilt = 1e-6; if (tilt === 180) tilt = 180 - 1e-6;
  const b = tilt * D2R, sb = tilt < 90 ? dm.sin(b) : dm.sin(Math.PI - b);
  const tSky = sb + (Math.PI - b - sb) / (1 + dm.cos(b)), tGnd = sb + (b - sb) / (1 - dm.cos(b));
  return { sky: 1 - dm.exp(-(c1 + c2 * tSky) * tSky / ar), ground: 1 - dm.exp(-(c1 + c2 * tGnd) * tGnd / ar) };
}
// 依名稱取 IAM 函式：{ model: 'physical' | 'ashrae' | 'martin_ruiz' | 'none', ...參數 }
export function iamFunction(cfg = { model: 'physical' }) {
  const m = cfg.model || 'physical';
  if (m === 'physical') return a => iamPhysical(a, cfg.n ?? 1.526, cfg.K ?? 4, cfg.L ?? 0.002);
  if (m === 'ashrae') return a => iamAshrae(a, cfg.b ?? 0.05);
  if (m === 'martin_ruiz') return a => iamMartinRuiz(a, cfg.ar ?? 0.16);
  if (m === 'none') return () => 1;
  throw new Error(`未知的 IAM 模型：${m}`);
}
