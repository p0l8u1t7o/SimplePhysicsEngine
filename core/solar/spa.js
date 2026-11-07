// NREL 太陽位置演算法（Solar Position Algorithm, SPA；Reda & Andreas 2004, NREL/TP-560-34302）。
// 運算順序與 pvlib.spa（spa_python, how='numpy'）一致，與 pvlib 的差異在 1e-9° 等級。
// 純函式、決定性：不讀時鐘、不用 Date、不用亂數；時間一律用 UTC 的 Unix 秒數（可帶小數）。
//
// 角度慣例（與 pvlib 相同）：
//   zenith 天頂角、elevation 高度角（度）；azimuth 方位角由正北順時針（東 90、南 180、西 270，度）。
//   apparent* 是含大氣折射的視位置；遮陰、日射用 apparentZenith，天文用途用 zenith。
// 場景向量慣例（core/solar 全部共用）：X 往東、Y 往上、Z 往南（右手系），長度 mm。
import * as dm from '../math/dmath.js';
import { L0, L1, L2, L3, L4, L5, B0, B1, R0, R1, R2, R3, R4, NUT_Y, NUT_ABCD } from './spa-tables.js';

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
const mod360 = x => { const r = x % 360; return r < 0 ? r + 360 : r; };   // 與 Python 的 % 相同（結果非負）

// ---------------------------------------------------------------- 時間
// 公曆日期 → 自 1970-01-01 起的日數（Howard Hinnant 的 days_from_civil，整數運算，不經過 Date）
export function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400), yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
// 日數 → { year, month, day }（civil_from_days）
export function civilFromDays(z) {
  z += 719468;
  const era = Math.floor(z / 146097), doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)), mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1, month = mp + (mp < 10 ? 3 : -9);
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}
// 當地標準時間（tz 小時，台灣 +8；不處理夏令時間）→ UTC Unix 秒。hour 可帶小數（例如 11.5 = 11:30）
export function unixFromLocal(year, month, day, hour = 0, minute = 0, second = 0, tz = 0) {
  return daysFromCivil(year, month, day) * 86400 + (hour - tz) * 3600 + minute * 60 + second;
}
// 一年中的第幾天（1 起算），以當地標準時間判定
export function dayOfYear(year, month, day) { return daysFromCivil(year, month, day) - daysFromCivil(year, 1, 1) + 1; }
export const julianDay = unix => unix / 86400 + 2440587.5;

// ΔT = TT − UT（秒）：Espenak & Meeus 多項式（與 pvlib.spa.calculate_deltat 相同）。
// 2005～2050 年段的外推偏高（2026 年估 75.4 s，實測約 69.2 s）。ΔT 只影響星曆時間：誤差 1 s ≈ 太陽黃經 1.1e-5°，
// 6 s 的差在台灣造成太陽方向夾角 < 0.0001°（天頂角差也 < 0.0001°）；方位角在太陽接近天頂時會放大（天頂角 0.3° 時差 0.012°），
// 但那只是方位角在天頂附近沒有意義，不是位置誤差（test/precision.test.mjs）。需要和實測對時請傳實測值（IERS／USNO）。
export function deltaT(year, month = 6) {
  const y = year + (month - 0.5) / 12;
  if (year < -500) return -20 + 32 * dm.pow(((y - 1820) / 100), 2);
  if (year < 500) { const u = y / 100; return 10583.6 - 1014.41 * u + 33.78311 * dm.pow(u, 2) - 5.952053 * dm.pow(u, 3) - 0.1798452 * dm.pow(u, 4) + 0.022174192 * dm.pow(u, 5) + 0.0090316521 * dm.pow(u, 6); }
  if (year < 1600) { const u = (y - 1000) / 100; return 1574.2 - 556.01 * u + 71.23472 * dm.pow(u, 2) + 0.319781 * dm.pow(u, 3) - 0.8503463 * dm.pow(u, 4) - 0.005050998 * dm.pow(u, 5) + 0.0083572073 * dm.pow(u, 6); }
  if (year < 1700) { const t = y - 1600; return 120 - 0.9808 * t - 0.01532 * dm.pow(t, 2) + dm.pow(t, 3) / 7129; }
  if (year < 1800) { const t = y - 1700; return 8.83 + 0.1603 * t - 0.0059285 * dm.pow(t, 2) + 0.00013336 * dm.pow(t, 3) - dm.pow(t, 4) / 1174000; }
  if (year < 1860) { const t = y - 1800; return 13.72 - 0.332447 * t + 0.0068612 * dm.pow(t, 2) + 0.0041116 * dm.pow(t, 3) - 0.00037436 * dm.pow(t, 4) + 0.0000121272 * dm.pow(t, 5) - 0.0000001699 * dm.pow(t, 6) + 0.000000000875 * dm.pow(t, 7); }
  if (year < 1900) { const t = y - 1860; return 7.62 + 0.5737 * t - 0.251754 * dm.pow(t, 2) + 0.01680668 * dm.pow(t, 3) - 0.0004473624 * dm.pow(t, 4) + dm.pow(t, 5) / 233174; }
  if (year < 1920) { const t = y - 1900; return -2.79 + 1.494119 * t - 0.0598939 * dm.pow(t, 2) + 0.0061966 * dm.pow(t, 3) - 0.000197 * dm.pow(t, 4); }
  if (year < 1941) { const t = y - 1920; return 21.20 + 0.84493 * t - 0.076100 * dm.pow(t, 2) + 0.0020936 * dm.pow(t, 3); }
  if (year < 1961) { const t = y - 1950; return 29.07 + 0.407 * t - dm.pow(t, 2) / 233 + dm.pow(t, 3) / 2547; }
  if (year < 1986) { const t = y - 1975; return 45.45 + 1.067 * t - dm.pow(t, 2) / 260 - dm.pow(t, 3) / 718; }
  if (year < 2005) { const t = y - 2000; return 63.86 + 0.3345 * t - 0.060374 * dm.pow(t, 2) + 0.0017275 * dm.pow(t, 3) + 0.000651814 * dm.pow(t, 4) + 0.00002373599 * dm.pow(t, 5); }
  if (year < 2050) { const t = y - 2000; return 62.92 + 0.32217 * t + 0.005589 * dm.pow(t, 2); }
  if (year < 2150) return -20 + 32 * dm.pow(((y - 1820) / 100), 2) - 0.5628 * (2150 - y);
  return -20 + 32 * dm.pow(((y - 1820) / 100), 2);
}
// Unix 秒 → 該時刻 UTC 年月的 ΔT
export function deltaTAt(unix) { const c = civilFromDays(Math.floor(unix / 86400)); return deltaT(c.year, c.month); }

// ---------------------------------------------------------------- SPA 主體
function sumTerms(arr, x) {   // Σ A·cos(B + C·x)，順序與 pvlib 相同
  let s = 0;
  for (let i = 0; i < arr.length; i += 3) s += arr[i] * dm.cos(arr[i + 1] + arr[i + 2] * x);
  return s;
}
// 地球日心座標與章動等「只跟時間有關」的量（同一時刻多個地點可共用）
export function spaTime(unix, dT = deltaTAt(unix)) {
  const jd = unix / 86400 + 2440587.5;
  const jde = jd + dT / 86400;
  const jc = (jd - 2451545) / 36525;
  const jce = (jde - 2451545) / 36525;
  const jme = jce / 10;
  const R = (sumTerms(R0, jme) + sumTerms(R1, jme) * jme + sumTerms(R2, jme) * dm.pow(jme, 2) + sumTerms(R3, jme) * dm.pow(jme, 3) + sumTerms(R4, jme) * dm.pow(jme, 4)) / 1e8;
  const Lrad = (sumTerms(L0, jme) + sumTerms(L1, jme) * jme + sumTerms(L2, jme) * dm.pow(jme, 2) + sumTerms(L3, jme) * dm.pow(jme, 3) + sumTerms(L4, jme) * dm.pow(jme, 4) + sumTerms(L5, jme) * dm.pow(jme, 5)) / 1e8;
  const L = mod360(Lrad * R2D);
  const B = (sumTerms(B0, jme) + sumTerms(B1, jme) * jme) / 1e8 * R2D;
  const Theta = mod360(L + 180), beta = -B;
  const x0 = 297.85036 + 445267.111480 * jce - 0.0019142 * dm.pow(jce, 2) + dm.pow(jce, 3) / 189474;
  const x1 = 357.52772 + 35999.050340 * jce - 0.0001603 * dm.pow(jce, 2) - dm.pow(jce, 3) / 300000;
  const x2 = 134.96298 + 477198.867398 * jce + 0.0086972 * dm.pow(jce, 2) + dm.pow(jce, 3) / 56250;
  const x3 = 93.27191 + 483202.017538 * jce - 0.0036825 * dm.pow(jce, 2) + dm.pow(jce, 3) / 327270;
  const x4 = 125.04452 - 1934.136261 * jce + 0.0020708 * dm.pow(jce, 2) + dm.pow(jce, 3) / 450000;
  let dPsi = 0, dEps = 0;
  for (let r = 0; r < 63; r++) {
    const y = r * 5, a = r * 4;
    const arg = (NUT_Y[y] * x0 + NUT_Y[y + 1] * x1 + NUT_Y[y + 2] * x2 + NUT_Y[y + 3] * x3 + NUT_Y[y + 4] * x4) * D2R;
    dPsi += (NUT_ABCD[a] + NUT_ABCD[a + 1] * jce) * dm.sin(arg);
    dEps += (NUT_ABCD[a + 2] + NUT_ABCD[a + 3] * jce) * dm.cos(arg);
  }
  dPsi /= 36000000; dEps /= 36000000;
  const U = jme / 10;
  const eps0 = 84381.448 - 4680.93 * U - 1.55 * dm.pow(U, 2) + 1999.25 * dm.pow(U, 3) - 51.38 * dm.pow(U, 4) - 249.67 * dm.pow(U, 5) - 39.05 * dm.pow(U, 6) + 7.12 * dm.pow(U, 7) + 27.87 * dm.pow(U, 8) + 5.79 * dm.pow(U, 9) + 2.45 * dm.pow(U, 10);
  const eps = eps0 / 3600 + dEps;
  const dTau = -20.4898 / (3600 * R);
  const lamd = Theta + dPsi + dTau;
  const v0 = mod360(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * dm.pow(jc, 2) - dm.pow(jc, 3) / 38710000);
  const v = v0 + dPsi * dm.cos(eps * D2R);
  const epsR = eps * D2R, lamR = lamd * D2R, betaR = beta * D2R;
  const alpha = mod360(dm.atan2(dm.sin(lamR) * dm.cos(epsR) - dm.tan(betaR) * dm.sin(epsR), dm.cos(lamR)) * R2D);
  const delta = dm.asin(dm.sin(betaR) * dm.cos(epsR) + dm.cos(betaR) * dm.sin(epsR) * dm.sin(lamR)) * R2D;
  const M = 280.4664567 + 360007.6982779 * jme + 0.03032028 * dm.pow(jme, 2) + dm.pow(jme, 3) / 49931 - dm.pow(jme, 4) / 15300 - dm.pow(jme, 5) / 2000000;
  let E = mod360(M - 0.0057183 - alpha + dPsi * dm.cos(eps * D2R)) * 4;
  if (E > 20) E -= 1440; else if (E < -20) E += 1440;
  return { jd, jde, R, v, alpha, delta, eot: E, dT };
}

/**
 * 太陽位置。
 * @param {number} unix UTC Unix 秒（當地時間用 unixFromLocal 換算）
 * @param {object} site { lat, lon（東經為正）, elevation 公尺 = 0, pressure Pa = 101325, temperature °C = 12,
 *                        deltaT 秒（預設依年月估算）, atmosRefract 度 = 0.5667 }
 * @returns {{ zenith, apparentZenith, elevation, apparentElevation, azimuth, declination, hourAngle, equationOfTime, earthSunDistance, deltaT }}
 *   角度單位為度；equationOfTime 分鐘；earthSunDistance AU。
 */
export function solarPosition(unix, site, time = null) {
  const { lat, lon, elevation: elev = 0, pressure = 101325, temperature = 12, atmosRefract = 0.5667 } = site;
  const T = time || spaTime(unix, site.deltaT ?? deltaTAt(unix));
  const H = mod360(T.v + lon - T.alpha);
  const xi = 8.794 / (3600 * T.R);
  const u = dm.atan(0.99664719 * dm.tan(lat * D2R));
  const x = dm.cos(u) + elev / 6378140 * dm.cos(lat * D2R);
  const y = 0.99664719 * dm.sin(u) + elev / 6378140 * dm.sin(lat * D2R);
  const xiR = xi * D2R, HR = H * D2R, dR = T.delta * D2R;
  const dAlpha = dm.atan2(-x * dm.sin(xiR) * dm.sin(HR), dm.cos(dR) - x * dm.sin(xiR) * dm.cos(HR)) * R2D;
  const deltaP = dm.atan2((dm.sin(dR) - y * dm.sin(xiR)) * dm.cos(dAlpha * D2R), dm.cos(dR) - x * dm.sin(xiR) * dm.cos(HR)) * R2D;
  const Hp = H - dAlpha;
  const latR = lat * D2R, dpR = deltaP * D2R, HpR = Hp * D2R;
  const e0 = dm.asin(dm.sin(latR) * dm.sin(dpR) + dm.cos(latR) * dm.cos(dpR) * dm.cos(HpR)) * R2D;
  const p = pressure / 100;   // mbar
  const de = e0 >= -1 * (0.26667 + atmosRefract) ? (p / 1010) * (283 / (273 + temperature)) * 1.02 / (60 * dm.tan((e0 + 10.3 / (e0 + 5.11)) * D2R)) : 0;
  const e = e0 + de;
  const gamma = mod360(dm.atan2(dm.sin(HpR), dm.cos(HpR) * dm.sin(latR) - dm.tan(dpR) * dm.cos(latR)) * R2D);
  return {
    zenith: 90 - e0, apparentZenith: 90 - e, elevation: e0, apparentElevation: e,
    azimuth: mod360(gamma + 180), declination: deltaP, hourAngle: Hp, equationOfTime: T.eot,
    earthSunDistance: T.R, deltaT: T.dT,
  };
}

// 斜面入射角（度）：tilt 傾角、surfaceAzimuth 板面朝向（由北順時針）；與 pvlib.irradiance.aoi 相同
export function aoiProjection(tilt, surfaceAzimuth, zenith, azimuth) {
  const p = dm.cos(tilt * D2R) * dm.cos(zenith * D2R) + dm.sin(tilt * D2R) * dm.sin(zenith * D2R) * dm.cos((azimuth - surfaceAzimuth) * D2R);
  return p > 1 ? 1 : p < -1 ? -1 : p;
}
export const incidenceAngle = (tilt, surfaceAzimuth, zenith, azimuth) => dm.acos(aoiProjection(tilt, surfaceAzimuth, zenith, azimuth)) * R2D;

// 指向太陽的單位向量（場景座標：X 東、Y 上、Z 南）
export function sunVector(zenith, azimuth, out = [0, 0, 0]) {
  const z = zenith * D2R, a = azimuth * D2R, s = dm.sin(z);
  out[0] = s * dm.sin(a); out[1] = dm.cos(z); out[2] = -s * dm.cos(a);
  return out;
}
// 板面法向量（場景座標）：傾角 tilt、朝向 surfaceAzimuth
export const surfaceNormal = (tilt, surfaceAzimuth, out) => sunVector(tilt, surfaceAzimuth, out);
// 場景向量 → { zenith, azimuth }（度）
export function vectorToAngles(v) {
  const h = dm.hypot3(v[0], v[2]);
  return { zenith: dm.atan2(h, v[1]) * R2D, azimuth: mod360(dm.atan2(v[0], -v[2]) * R2D) };
}
