// 發電量：天候檔讀取（EPW、TMY3、一般 CSV）、電池溫度（SAPM、Faiman）、PVWatts 直流與變流器（含截峰）、
// 旁路二極體區段的部分遮陰（非線性）、全年逐時迴圈、PR。公式與 pvlib 0.16 相同（各函式註明對應的 pvlib 函式）。
// 單位：日射 W/m²、溫度 °C、風速 m/s、氣壓 Pa、功率 W、能量 kWh。時間：天候檔的當地標準時間（不含夏令時間）。
import * as dm from '../math/dmath.js';
import { solarPosition, unixFromLocal, deltaT as deltaTOf, civilFromDays, daysFromCivil, sunVector } from './spa.js';
import { mountOrientation } from './tracking.js';
import { createRearModel } from './bifacial.js';
import { extraRadiation, relativeAirmass, poaIrradiance, iamFunction, iamMartinRuizDiffuse, erbs, disc } from './irradiance.js';

// ---------------------------------------------------------------- 天候檔
const COLS = ['year', 'month', 'day', 'hour', 'minute', 'ghi', 'dni', 'dhi', 'tempAir', 'windSpeed', 'pressure', 'albedo'];
function emptyWeather(n) { const w = { n }; for (const c of COLS) w[c] = new Float64Array(n); return w; }
const splitCSV = line => {   // 簡易 CSV（支援雙引號欄位）
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
};
const lines = text => text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');

/**
 * EnergyPlus 天候檔（EPW）。時間標記是「該小時結束」（hour 1 = 00:00～01:00 的平均）。
 * 缺值（GHI/DNI/DHI ≥ 9999、氣溫 ≥ 99.9、風速 ≥ 999、反照率 ≥ 999）轉成 NaN。
 * @returns {{ meta: { name, country, source, wmo, lat, lon, tz, elevation }, n, year, month, day, hour, minute, ghi, dni, dhi, tempAir, windSpeed, pressure, albedo, snowDepth（cm） }}
 */
export function readEPW(text) {
  const L = lines(text), h = splitCSV(L[0]);
  if (h[0].trim().toUpperCase() !== 'LOCATION') throw new Error('不是 EPW 檔（第一列應為 LOCATION）');
  const meta = { name: h[1], state: h[2], country: h[3], source: h[4], wmo: h[5], lat: +h[6], lon: +h[7], tz: +h[8], elevation: +h[9] };
  const data = L.slice(8).map(splitCSV).filter(r => r.length >= 22);
  const w = emptyWeather(data.length); w.meta = meta; w.snowDepth = new Float64Array(data.length);
  const nan = (v, bad) => (v >= bad ? NaN : v);
  data.forEach((r, i) => {
    w.year[i] = +r[0]; w.month[i] = +r[1]; w.day[i] = +r[2]; w.hour[i] = +r[3]; w.minute[i] = +r[4] === 60 ? 0 : +r[4];
    w.tempAir[i] = nan(+r[6], 99.9); w.pressure[i] = nan(+r[9], 999999);
    w.ghi[i] = nan(+r[13], 9999); w.dni[i] = nan(+r[14], 9999); w.dhi[i] = nan(+r[15], 9999);
    w.windSpeed[i] = nan(+r[21], 999); w.albedo[i] = r.length > 32 ? nan(+r[32], 999) : NaN;
    w.snowDepth[i] = r.length > 30 ? nan(+r[30], 999) : NaN;   // 第 30 欄：雪深 cm（weather/snow.js 的 snowLossSeries 用）
  });
  w.intervalHours = 1; w.label = 'end';
  return w;
}
/** NREL TMY3 CSV（pvlib.iotools.read_tmy3 的同一格式）；時間標記為該小時結束。 */
export function readTMY3(text) {
  const L = lines(text), h = splitCSV(L[0]), head = splitCSV(L[1]).map(s => s.trim());
  const meta = { wmo: h[0], name: h[1], state: h[2], tz: +h[3], lat: +h[4], lon: +h[5], elevation: +h[6] };
  const col = name => { const i = head.findIndex(s => s.startsWith(name)); if (i < 0) throw new Error(`TMY3 缺欄位 ${name}`); return i; };
  const c = { date: col('Date'), time: col('Time'), ghi: col('GHI ('), dni: col('DNI ('), dhi: col('DHI ('), t: col('Dry-bulb'), p: col('Pressure'), ws: col('Wspd'), alb: col('Alb') };
  const rows = L.slice(2).map(splitCSV);
  const w = emptyWeather(rows.length); w.meta = meta;
  rows.forEach((r, i) => {
    const [mm, dd, yy] = r[c.date].split('/').map(Number), [hh, mi] = r[c.time].split(':').map(Number);
    w.year[i] = yy; w.month[i] = mm; w.day[i] = dd; w.hour[i] = hh; w.minute[i] = mi;
    w.ghi[i] = +r[c.ghi]; w.dni[i] = +r[c.dni]; w.dhi[i] = +r[c.dhi]; w.tempAir[i] = +r[c.t];
    w.pressure[i] = +r[c.p] * 100; w.windSpeed[i] = +r[c.ws]; w.albedo[i] = +r[c.alb];
  });
  w.intervalHours = 1; w.label = 'end';
  return w;
}
/**
 * 一般 CSV：第一列欄名。預設欄名 year, month, day, hour, minute, ghi, dni, dhi, temp_air, wind_speed, pressure(Pa), albedo；
 * 可用 columns 對照（例如 { ghi: 'GHI', tempAir: 'T2m' }）；或給 time 欄（'YYYY-MM-DD HH:MM'，當地標準時間）。
 * label：'end'（時間是區間結束，預設，與 EPW/TMY 相同）、'start'、'center'；intervalHours 預設 1。
 * 缺少 dni 或 dhi 時，simulate 會用 Erbs 由 ghi 分解（decompose: 'erbs'）。
 */
export function readCSV(text, { columns = {}, label = 'end', intervalHours = 1, meta = {} } = {}) {
  const L = lines(text), head = splitCSV(L[0]).map(s => s.trim());
  const name = { year: 'year', month: 'month', day: 'day', hour: 'hour', minute: 'minute', time: 'time', ghi: 'ghi', dni: 'dni', dhi: 'dhi', tempAir: 'temp_air', windSpeed: 'wind_speed', pressure: 'pressure', albedo: 'albedo', ...columns };
  const idx = k => head.indexOf(name[k]);
  const rows = L.slice(1).map(splitCSV), w = emptyWeather(rows.length); w.meta = meta;
  const ti = idx('time');
  rows.forEach((r, i) => {
    if (ti >= 0) {
      const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(r[ti].trim());
      if (!m) throw new Error(`無法解析時間：${r[ti]}`);
      w.year[i] = +m[1]; w.month[i] = +m[2]; w.day[i] = +m[3]; w.hour[i] = +m[4]; w.minute[i] = +m[5];
    } else for (const k of ['year', 'month', 'day', 'hour', 'minute']) w[k][i] = idx(k) >= 0 ? +r[idx(k)] : 0;
    for (const k of ['ghi', 'dni', 'dhi', 'tempAir', 'windSpeed', 'pressure', 'albedo']) w[k][i] = idx(k) >= 0 && r[idx(k)] !== '' ? +r[idx(k)] : NaN;
  });
  w.intervalHours = intervalHours; w.label = label;
  return w;
}

// ---------------------------------------------------------------- 電池溫度
// pvlib.temperature.TEMPERATURE_MODEL_PARAMETERS['sapm']
export const SAPM_TEMP = {
  open_rack_glass_glass: { a: -3.47, b: -0.0594, deltaT: 3 },
  close_mount_glass_glass: { a: -2.98, b: -0.0471, deltaT: 1 },
  open_rack_glass_polymer: { a: -3.56, b: -0.075, deltaT: 3 },
  insulated_back_glass_polymer: { a: -2.81, b: -0.0455, deltaT: 0 },
};
// pvlib.temperature.sapm_cell
export const sapmCell = (poa, tAir, ws, { a, b, deltaT }, irradRef = 1000) => poa * dm.exp(a + b * ws) + tAir + poa / irradRef * deltaT;
// pvlib.temperature.faiman
export const faimanCell = (poa, tAir, ws = 1, { u0 = 25, u1 = 6.84 } = {}) => tAir + poa / (u0 + u1 * ws);
export function cellTemperature(cfg = { model: 'sapm', ...SAPM_TEMP.open_rack_glass_glass }, poa, tAir, ws) {
  if (cfg.model === 'faiman') return faimanCell(poa, tAir, ws, cfg);
  if (cfg.model === 'sapm') return sapmCell(poa, tAir, ws, cfg.a != null ? cfg : SAPM_TEMP[cfg.mount || 'open_rack_glass_glass']);
  throw new Error(`未知的溫度模型：${cfg.model}`);
}

// ---------------------------------------------------------------- PVWatts
// pvlib.pvsystem.pvwatts_dc（不含低照度修正 k）
export const pvwattsDC = (effIrr, tCell, pdc0, gamma, tRef = 25) => effIrr * 0.001 * pdc0 * (1 + gamma * (tCell - tRef));
// pvlib.inverter.pvwatts：pdc0 是變流器直流輸入額定（交流上限 = etaNom × pdc0）
export function pvwattsInverter(pdc, pdc0, etaNom = 0.96, etaRef = 0.9637) {
  const zeta = pdc / pdc0;
  const eta = pdc !== 0 ? etaNom / etaRef * (-0.0162 * zeta - 0.0059 / zeta + 0.9858) : etaNom / etaRef * (-0.0162 * zeta + 0.9858);
  const ac = Math.min(etaNom * pdc0, eta * pdc);
  return ac > 0 ? ac : 0;
}
// pvlib.pvsystem.pvwatts_losses（%）
export function pvwattsLosses({ soiling = 2, shading = 3, snow = 0, mismatch = 2, wiring = 2, connections = 0.5, lid = 1.5, nameplate = 1, age = 0, availability = 3 } = {}) {
  let perf = 1;
  for (const p of [soiling, shading, snow, mismatch, wiring, connections, lid, nameplate, age, availability]) perf *= 1 - p / 100;
  return (1 - perf) * 100;
}

// ---------------------------------------------------------------- 部分遮陰（旁路二極體）
/**
 * 一串（或一片）板的等效日射：各二極體區段的日射 E_k（W/m²）串聯，電流 ∝ 日射、每段電壓視為相同，
 * 電流低於串電流的區段被旁路（電壓 0，忽略二極體壓降約 0.5 V）。MPPT 取 P(I) = I × (E_k ≥ I 的段數) 的最大值，
 * 回傳等效平均日射 = max_j E_(j) · j / N（E 由大到小排序）。全部相同時等於平均值；永遠 ≤ 平均值。
 * @param {ArrayLike<number>} E 各區段日射
 */
export function bypassMismatch(E, scratch = null) {
  const n = E.length; if (!n) return 0;
  const s = scratch && scratch.length >= n ? scratch.subarray(0, n) : new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = E[i];
  s.sort();   // Float64Array 的 sort 是數值遞增，決定性
  let best = 0;
  for (let j = 1; j <= n; j++) { const p = s[n - j] * j; if (p > best) best = p; }
  return best / n;
}
/**
 * 由區段直達光可用比例（shading.js 的 blocks，0～1）算一串的等效日射。
 * direct：板面直達（已乘 IAM）；diffuse：散射（天空＋地面）；sky：天空散射的可見比例（天空視角因子，預設 1）。
 * model：'bypass'（非線性，預設）或 'linear'（面積比例；area 為被遮面積比例）。
 */
export function stringIrradiance(blocks, direct, diffuse, { model = 'bypass', area = null, scratch = null } = {}) {
  if (model === 'linear') {
    let a = 0; if (area) { for (let i = 0; i < area.length; i++) a += area[i]; a /= area.length; }
    else { for (let i = 0; i < blocks.length; i++) a += 1 - blocks[i]; a /= blocks.length; }
    return direct * (1 - a) + diffuse;
  }
  const n = blocks.length, E = scratch && scratch.length >= 2 * n ? scratch.subarray(n, 2 * n) : new Float64Array(n);
  for (let i = 0; i < n; i++) E[i] = direct * blocks[i] + diffuse;
  return bypassMismatch(E, scratch);
}

// ---------------------------------------------------------------- 太陽位置預算
/**
 * 天候檔每一筆的時間與太陽位置（可給多個系統共用）。
 * site { lat, lon, elevation = 0, tz（預設用 weather.meta.tz）, deltaT（秒，預設依年份估算）, pressure（預設用天候檔，缺值用 101325） }
 * opts.year：把天候檔年份統一改成這一年（TMY 各月來自不同年份時建議給，例如 2023）。
 * opts.shiftHours：太陽位置的時間位移，預設依 label：'end' → −interval/2（區間中點）、'start' → +interval/2、'center' → 0。
 */
export function prepareSolar(weather, site, { year = null, shiftHours = null, temperature = null } = {}) {
  const n = weather.n, tz = site.tz ?? weather.meta?.tz ?? 0, dtH = weather.intervalHours || 1;
  const shift = shiftHours ?? (weather.label === 'start' ? dtH / 2 : weather.label === 'center' ? 0 : -dtH / 2);
  const zen = new Float64Array(n), azi = new Float64Array(n), doy = new Float64Array(n), unix = new Float64Array(n), R = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const y = year ?? weather.year[i];
    const u = unixFromLocal(y, weather.month[i], weather.day[i], weather.hour[i] + shift, weather.minute[i], 0, tz);
    const p = Number.isFinite(weather.pressure[i]) && weather.pressure[i] > 0 ? weather.pressure[i] : (site.pressure ?? 101325);
    const t = temperature ?? (Number.isFinite(weather.tempAir[i]) ? weather.tempAir[i] : 12);
    const sp = solarPosition(u, { lat: site.lat, lon: site.lon, elevation: site.elevation ?? 0, pressure: site.solarPressure ?? p, temperature: site.solarTemperature ?? t, deltaT: site.deltaT ?? deltaTOf(y, weather.month[i]) });
    zen[i] = sp.apparentZenith; azi[i] = sp.azimuth; unix[i] = u; R[i] = sp.earthSunDistance;
    const days = Math.floor((u + tz * 3600) / 86400), c = civilFromDays(days);   // 當地日期的日序（與 pvlib 以當地時間索引相同）
    doy[i] = days - daysFromCivil(c.year, 1, 1) + 1;
  }
  return { n, zenith: zen, azimuth: azi, doy, unix, R, intervalHours: dtH, shift };
}

// ---------------------------------------------------------------- 全年模擬
/**
 * 逐筆（一般為逐時）模擬一個系統（同一種安裝方式的一群板）。
 * @param {object} a
 *   weather：readEPW / readTMY3 / readCSV 的結果；site：{ lat, lon, elevation, tz, deltaT }；solar：prepareSolar 的結果（可省略）
 *   system：{
 *     mount: { type: 'fixed', tilt, azimuth } | { type: 'singleAxis', axisTilt, axisAzimuth, maxAngle, backtrack, gcr, crossAxisTilt },
 *     pdc0（W，直流額定）, gamma（1/°C，預設 −0.0037）,
 *     inverter: { pdc0（W，變流器直流輸入額定，預設 = pdc0 / 1.2）, etaNom = 0.96, etaRef = 0.9637 },
 *     losses（%，直流側；數字或 pvwattsLosses 參數物件；預設 0）, albedo（天候檔沒有時用，預設 0.2）,
 *     transposition: 'perez' | 'haydavies' | 'isotropic', iam: { model: 'physical' | 'ashrae' | 'martin_ruiz' | 'none' },
 *     diffuseIam: false（true 時散射乘 Martin–Ruiz 散射 IAM）, temperature: { model: 'sapm', ... } | { model: 'faiman', u0, u1 },
 *     decompose: 'erbs' | 'disc'（天候檔缺 DNI/DHI 時）,
 *     bifacial（可省略）: { bifaciality = 0.7, height（排中心離地，與 width 同單位）, width（垂直於軸的板寬）, gcr（預設用 mount.gcr）, structureShade = 0（背面支架遮擋比例） }
 *   }
 *   shading（可省略）：{ strings, blocksPerString, model: 'bypass' | 'linear',
 *     evaluate(ctx) → { blocks: Float64Array(strings × blocksPerString)（直達可用比例）, sky?: number（天空視角因子） } }
 *     ctx = { i, zenith, azimuth, sun（場景向量）, orientation（tilt、surfaceAzimuth、theta…） }；可配合 shading.js 的 createSunBinCache。
 *   hourlyLoss（可省略）：逐筆的額外直流損失比例（0～1；Float64Array 或 (i, { poa, tCell }) => 比例），例如 weather/snow.js 的 snowLossSeries；
 *     有給時 annual 多一個 hourlyLossKWh。沒給時結果和之前逐位元相同。
 *   keepHourly：true 時回傳逐時陣列
 * @returns {{ annual, monthly, hourly? }}
 */
export function simulate({ weather, site, system, solar = null, shading = null, hourlyLoss = null, keepHourly = false }) {
  const S = solar || prepareSolar(weather, site);
  const n = S.n, dt = S.intervalHours;
  const sys = { gamma: -0.0037, albedo: 0.2, transposition: 'perez', iam: { model: 'physical' }, temperature: { model: 'sapm', ...SAPM_TEMP.open_rack_glass_glass }, losses: 0, decompose: 'erbs', ...system };
  const inv = { pdc0: sys.pdc0 / 1.2, etaNom: 0.96, etaRef: 0.9637, ...(sys.inverter || {}) };
  const lossPct = typeof sys.losses === 'object' ? pvwattsLosses(sys.losses) : sys.losses;
  const orient = mountOrientation(sys.mount), iam = iamFunction(sys.iam);
  const bf = sys.bifacial ? { bifaciality: 0.7, structureShade: 0, ...sys.bifacial } : null;
  const rearModel = bf ? createRearModel({ gcr: bf.gcr ?? sys.mount.gcr, height: bf.height, width: bf.width ?? 1 }) : null;
  const H = keepHourly ? { poa: new Float64Array(n), effective: new Float64Array(n), tCell: new Float64Array(n), dc: new Float64Array(n), ac: new Float64Array(n), theta: new Float64Array(n), aoi: new Float64Array(n), shadeLoss: new Float64Array(n) } : null;
  const A = { rearKWhm2: 0, poaKWhm2: 0, effectiveKWhm2: 0, ghiKWhm2: 0, dcKWh: 0, dcUnshadedKWh: 0, acKWh: 0, clipKWh: 0, shadeKWh: 0, hoursProducing: 0 };
  const M = Array.from({ length: 12 }, () => ({ poaKWhm2: 0, dcKWh: 0, acKWh: 0 }));
  const hl = typeof hourlyLoss === 'function' ? hourlyLoss : hourlyLoss ? (i => hourlyLoss[i] || 0) : null;
  if (hl) A.hourlyLossKWh = 0;
  const sun = [0, 0, 0], scratch = shading ? new Float64Array(2 * shading.blocksPerString) : null;
  for (let i = 0; i < n; i++) {
    const z = S.zenith[i], az = S.azimuth[i];
    let ghi = weather.ghi[i], dni = weather.dni[i], dhi = weather.dhi[i];
    if (!Number.isFinite(ghi)) ghi = 0;
    if (!Number.isFinite(dni) || !Number.isFinite(dhi)) {   // 天候檔只有 GHI：分解
      const r = sys.decompose === 'disc' ? disc(ghi, z, S.doy[i]) : erbs(ghi, z, S.doy[i]); dni = r.dni; dhi = r.dhi;
    }
    let poaG = 0, eff = 0, effUnshaded = 0, tCell = Number.isFinite(weather.tempAir[i]) ? weather.tempAir[i] : 20, dc = 0, ac = 0, o = null;
    if (z < 90) {
      o = orient(z, az);
      if (Number.isFinite(o.theta) && Number.isFinite(o.tilt)) {
        const albedo = Number.isFinite(weather.albedo[i]) && weather.albedo[i] > 0 && weather.albedo[i] < 1 ? weather.albedo[i] : sys.albedo;
        const P = poaIrradiance({ tilt: o.tilt, azimuth: o.surfaceAzimuth, zenith: z, sunAzimuth: az, dni, ghi, dhi, dniExtra: extraRadiation(S.doy[i]), airmass: relativeAirmass(z), albedo, model: sys.transposition });
        poaG = P.global;
        const direct = P.direct * iam(o.aoi);
        let sky = P.sky, gnd = P.ground;
        if (sys.diffuseIam) { const d = iamMartinRuizDiffuse(o.tilt); sky *= d.sky; gnd *= d.ground; }
        effUnshaded = direct + (sky + gnd);   // 與 stringIrradiance 的加法順序相同（無遮陰時逐位元一致）
        eff = effUnshaded;
        if (shading && direct + sky > 0) {
          sunVector(z, az, sun);
          const r = shading.evaluate({ i, zenith: z, azimuth: az, sun, orientation: o });
          const skyF = r.sky ?? 1, nb = shading.blocksPerString, ns = shading.strings;
          let sum = 0;
          for (let s = 0; s < ns; s++) sum += stringIrradiance(r.blocks.subarray(s * nb, s * nb + nb), direct, sky * skyF + gnd, { model: shading.model || 'bypass', scratch });
          eff = sum / ns;
        }
        if (rearModel) {   // 雙面：背面日射 × 雙面率 × (1 − 支架遮擋)，所有串相同
          const rr = rearModel.rear({ tilt: o.tilt, surfaceAzimuth: o.surfaceAzimuth, zenith: z, azimuth: az, dni, dhi, albedo }).rear;
          const add = bf.bifaciality * rr * (1 - bf.structureShade);
          eff += add; effUnshaded += add; A.rearKWhm2 += rr * dt / 1000;
        }
        const ws = Number.isFinite(weather.windSpeed[i]) ? weather.windSpeed[i] : 1;
        tCell = cellTemperature(sys.temperature, poaG, Number.isFinite(weather.tempAir[i]) ? weather.tempAir[i] : 20, ws);
        const k = 1 - lossPct / 100;
        dc = pvwattsDC(eff, tCell, sys.pdc0, sys.gamma) * k;
        const dcU = pvwattsDC(effUnshaded, tCell, sys.pdc0, sys.gamma) * k;
        A.dcUnshadedKWh += dcU * dt / 1000;
        A.shadeKWh += (dcU - dc) * dt / 1000;
        // 額外損失（積雪等）在遮陰之後、變流器之前扣，不算進 shadeKWh
        if (hl) { const f = Math.min(1, Math.max(0, hl(i, { poa: poaG, tCell }) || 0)); if (f > 0) { A.hourlyLossKWh += dc * f * dt / 1000; dc *= 1 - f; } }
        ac = pvwattsInverter(dc, inv.pdc0, inv.etaNom, inv.etaRef);
        const acNoClip = pvwattsInverterNoClip(dc, inv.pdc0, inv.etaNom, inv.etaRef);
        A.clipKWh += (acNoClip - ac) * dt / 1000;
        if (ac > 0) A.hoursProducing += dt;
      }
    }
    A.poaKWhm2 += poaG * dt / 1000; A.effectiveKWhm2 += eff * dt / 1000; A.ghiKWhm2 += ghi * dt / 1000;
    A.dcKWh += dc * dt / 1000; A.acKWh += ac * dt / 1000;
    const m = M[weather.month[i] - 1]; m.poaKWhm2 += poaG * dt / 1000; m.dcKWh += dc * dt / 1000; m.acKWh += ac * dt / 1000;
    if (H) { H.poa[i] = poaG; H.effective[i] = eff; H.tCell[i] = tCell; H.dc[i] = dc; H.ac[i] = ac; H.theta[i] = o ? o.theta : NaN; H.aoi[i] = o ? o.aoi : NaN; H.shadeLoss[i] = effUnshaded - eff; }
  }
  const kWp = sys.pdc0 / 1000;
  A.specificYield = A.acKWh / kWp;                       // kWh/kWp
  A.pr = A.poaKWhm2 > 0 ? A.acKWh / kWp / A.poaKWhm2 : 0;   // 性能比 PR（以未遮陰 POA 為參考）
  A.shadeLossPct = A.dcUnshadedKWh > 0 ? 100 * A.shadeKWh / A.dcUnshadedKWh : 0;
  A.clipLossPct = A.dcKWh > 0 ? 100 * A.clipKWh / A.dcKWh : 0;
  return { annual: A, monthly: M, hourly: H, losses: lossPct };
}
function pvwattsInverterNoClip(pdc, pdc0, etaNom, etaRef) {
  if (pdc === 0) return 0;
  const zeta = pdc / pdc0, ac = etaNom / etaRef * (-0.0162 * zeta - 0.0059 / zeta + 0.9858) * pdc;
  return ac > 0 ? ac : 0;
}
