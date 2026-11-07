// 與 pvlib 參考值（validate.py 產生的 ref/*.json）比對，印出各項最大誤差並寫 ref/compare-report.json。
// 執行：node --import ./core/tools/register.mjs tools/solar-pvlib/compare.mjs（先跑 validate.py）
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../../core/solar/index.js';

const HERE = dirname(fileURLToPath(import.meta.url)), REF = join(HERE, '..', '..', 'TEMP', 'solar-pvlib-ref');
const load = f => JSON.parse(readFileSync(join(REF, f), 'utf8'));
const report = {}, fails = [];
const angDiff = (a, b) => { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
function stat(name, pairs, tol, diff = (a, b) => Math.abs(a - b)) {
  let max = 0, at = -1, n = 0, sum = 0;
  pairs.forEach(([a, b], i) => {
    if (a == null && b == null) return;
    if ((a == null) !== (b == null) || Number.isNaN(a) !== Number.isNaN(b)) { max = Infinity; at = i; return; }
    const d = diff(a, b); n++; sum += d; if (d > max) { max = d; at = i; }
  });
  report[name] = { n, max, mean: n ? sum / n : 0, tol, at };
  const ok = max <= tol; if (!ok) fails.push(name);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(42)} n=${String(n).padStart(6)}  max=${max.toExponential(3)}  mean=${(n ? sum / n : 0).toExponential(2)}  (門檻 ${tol})`);
  return max;
}
const nz = v => (v == null || Number.isNaN(v) ? null : v);

// ---------------------------------------------------------------- SPA
{
  const spa = load('spa.json'), az = [], zen = [], azp = [], eot = [], zg = [];
  for (const c of spa) {
    c.unix.forEach((u, i) => {
      const r = S.solarPosition(u, { lat: c.lat, lon: c.lon, elevation: c.alt, pressure: c.pressure, temperature: c.temperature, deltaT: c.deltaTAuto ? undefined : c.deltaT[i] });
      zen.push([r.apparentZenith, c.apparent_zenith[i]]); zg.push([r.zenith, c.zenith[i]]);
      // 方位角在天頂附近沒有意義：只比天頂角 > 0.1° 的
      if (c.zenith[i] > 0.1) az.push([r.azimuth, c.azimuth[i]]);
      eot.push([r.equationOfTime, c.eot[i]]);
    });
  }
  stat('spa.apparentZenith (deg)', zen, 1e-3);
  stat('spa.zenith (deg)', zg, 1e-3);
  stat('spa.azimuth (deg)', az, 1e-3, angDiff);
  stat('spa.equationOfTime (min)', eot, 1e-3);
  // NREL 論文的範例（Reda & Andreas 表 A4.1）：2003-10-17 12:30:30 −7 時區
  const u = S.unixFromLocal(2003, 10, 17, 12, 30, 30, -7);
  const r = S.solarPosition(u, { lat: 39.742476, lon: -105.1786, elevation: 1830.14, pressure: 82000, temperature: 11, deltaT: 67 });
  const inc = S.incidenceAngle(30, 180 - 10, r.apparentZenith, r.azimuth);   // 論文：坡度 30°、azm_rotation −10°（由南起算）
  stat('spa.NREL paper example zenith/azimuth/incidence', [[r.apparentZenith, 50.11162], [r.azimuth, 194.34024], [inc, 25.18700]], 5e-5);
}

// ---------------------------------------------------------------- 追日
{
  const T = load('tracking.json'), th = [], st = [], sa = [], ao = [], cat = [];
  for (const c of T.cases) {
    if (c.slope_tilt) {
      const at = S.calcAxisTilt(c.slope_azimuth, c.slope_tilt, c.axis_azimuth);
      cat.push([at, c.axis_tilt], [S.calcCrossAxisTilt(c.slope_azimuth, c.slope_tilt, c.axis_azimuth, at), c.cross_axis_tilt]);
    }
    T.zenith.forEach((z, i) => {
      const r = S.singleAxis(z, T.azimuth[i], { axisTilt: c.axis_tilt, axisAzimuth: c.axis_azimuth, maxAngle: c.max_angle, backtrack: c.backtrack, gcr: c.gcr, crossAxisTilt: c.cross_axis_tilt });
      th.push([nz(r.theta), c.theta[i]]); st.push([nz(r.tilt), c.surface_tilt[i]]); sa.push([nz(r.surfaceAzimuth), c.surface_azimuth[i]]); ao.push([nz(r.aoi), c.aoi[i]]);
    });
  }
  stat('tracking.theta (deg)', th, 1e-9);
  stat('tracking.surfaceTilt (deg)', st, 1e-9);
  stat('tracking.surfaceAzimuth (deg)', sa, 1e-9, angDiff);
  stat('tracking.aoi (deg)', ao, 1e-9);
  stat('tracking.axisTilt / crossAxisTilt (deg)', cat, 1e-12);
  const sf = [];
  for (const c of T.shaded1d) T.zenith.forEach((z, i) => {
    if (c.theta[i] == null) return;
    sf.push([S.rowShadedFraction1D(z, T.azimuth[i], { axisAzimuth: c.axis_azimuth, theta: c.theta[i], width: 2, pitch: 2 / c.gcr }), c.fraction[i]]);
  });
  stat('tracking.rowShadedFraction1D', sf, 1e-12);
}

// ---------------------------------------------------------------- 日射
{
  const R = load('irradiance.json'), N = R.zenith.length;
  const P = { perez: [[], [], [], []], haydavies: [[], [], [], []], isotropic: [[], [], [], []] }, comp = [[], [], []], er = [], dsc = [], ext = [], am = [];
  for (let i = 0; i < N; i++) {
    const e = S.erbs(R.ghi[i], R.zenith[i], R.doy[i]); er.push([e.dni, R.dni[i]], [e.dhi, R.dhi[i]], [e.kt, R.kt[i]]);
    dsc.push([S.disc(R.ghi[i], R.zenith[i], R.doy[i]).dni, R.disc_dni[i]]);
    ext.push([S.extraRadiation(R.doy[i]), R.dni_extra[i]]); am.push([S.relativeAirmass(R.zenith[i]), R.airmass[i]]);
    for (const m of Object.keys(P)) {
      const r = S.poaIrradiance({ tilt: R.tilt[i], azimuth: R.surface_azimuth[i], zenith: R.zenith[i], sunAzimuth: R.sun_azimuth[i], dni: R.dni[i], ghi: R.ghi[i], dhi: R.dhi[i], dniExtra: R.dni_extra[i], airmass: R.airmass[i], albedo: R.albedo[i], model: m });
      const ref = R.poa[m];
      P[m][0].push([r.global, ref.globl[i]]); P[m][1].push([r.direct, ref.direct[i]]); P[m][2].push([r.sky, ref.sky[i]]); P[m][3].push([r.ground, ref.ground[i]]);
      if (m === 'perez') { comp[0].push([r.isotropic, R.perez_components.isotropic[i]]); comp[1].push([r.circumsolar, R.perez_components.circumsolar[i]]); comp[2].push([r.horizon, R.perez_components.horizon[i]]); }
    }
  }
  stat('irr.extraRadiation spencer (W/m2)', ext, 1e-9);
  stat('irr.airmass kastenyoung1989', am, 1e-9);
  stat('irr.erbs dni/dhi/kt', er, 1e-8);
  stat('irr.disc dni (W/m2)', dsc, 1e-8);
  for (const m of Object.keys(P)) stat(`irr.poa ${m} global (W/m2)`, P[m][0], 1e-8), stat(`irr.poa ${m} sky (W/m2)`, P[m][2], 1e-8);
  stat('irr.poa direct (W/m2)', P.perez[1], 1e-8);
  stat('irr.poa ground (W/m2)', P.perez[3], 1e-8);
  stat('irr.perez components (W/m2)', comp.flat(), 1e-8);
  stat('iam.physical', R.aoi.map((a, i) => [S.iamPhysical(a), R.iam_physical[i]]), 1e-12);
  stat('iam.ashrae', R.aoi.map((a, i) => [S.iamAshrae(a), R.iam_ashrae[i]]), 1e-12);
  stat('iam.martin_ruiz', R.aoi.map((a, i) => [S.iamMartinRuiz(a), R.iam_martin_ruiz[i]]), 1e-12);
  stat('iam.martin_ruiz_diffuse sky/ground', R.mr_diffuse_tilt.flatMap((t, i) => { const d = S.iamMartinRuizDiffuse(t); return [[d.sky, R.mr_diffuse.sky[i]], [d.ground, R.mr_diffuse.ground[i]]]; }), 1e-9);
  const lt = [];
  for (const s of Object.values(R.linke.sites)) R.linke.unix.forEach((u, i) => lt.push([S.linkeTurbidityTW(s.lat, s.lon, u), s.tl[i]]));
  stat('clearsky.linkeTurbidityTW', lt, 1e-12);
  const ine = [];
  for (const c of R.ineichen.cases) R.ineichen.zenith.forEach((z, i) => { const r = S.ineichen(z, c.amAbs[i], c.tl, c.alt); ine.push([r.ghi, c.ghi[i]], [r.dni, c.dni[i]], [r.dhi, c.dhi[i]]); });
  stat('clearsky.ineichen ghi/dni/dhi (W/m2)', ine, 1e-8);
  const T = R.temp, sp = [], fm = [];
  T.poa.forEach((g, i) => { sp.push([S.sapmCell(g, T.t_air[i], T.ws[i], S.SAPM_TEMP.open_rack_glass_glass), T.sapm[i]]); fm.push([S.faimanCell(g, T.t_air[i], T.ws[i]), T.faiman[i]]); });
  stat('temp.sapm_cell (C)', sp, 1e-10); stat('temp.faiman (C)', fm, 1e-10);
  stat('pvwatts.inverter (W)', R.pvwatts.pdc.map((p, i) => [S.pvwattsInverter(p, 1000), R.pvwatts.ac[i]]), 1e-9);
  stat('pvwatts.dc (W)', T.poa.map((g, i) => [S.pvwattsDC(g, T.t_air[i], 1000, -0.0035), R.pvwatts.dc[i]]), 1e-9);
  stat('pvwatts.losses (%)', [[S.pvwattsLosses(), R.pvwatts.losses]], 1e-12);
}

// ---------------------------------------------------------------- 全年發電
{
  const E = load('energy.json');
  const sysOf = s => ({
    mount: s.mount === 'fixed' ? { type: 'fixed', tilt: s.tilt, azimuth: s.azimuth } : { type: 'singleAxis', axisAzimuth: s.axis_azimuth, maxAngle: s.max_angle, gcr: s.gcr, backtrack: true },
    pdc0: s.pdc0, gamma: s.gamma, inverter: { pdc0: s.inv_pdc0 }, losses: S.pvwattsLosses(), albedo: s.albedo, iam: { model: 'physical' },
  });
  const weathers = {
    'synthetic-tainan': { w: S.readEPW(readFileSync(join(REF, 'synthetic-tainan.epw'), 'utf8')), opts: {} },
    'tmy3-723170': { w: S.readTMY3(readFileSync(join(HERE, '..', '..', '.venv', 'Lib', 'site-packages', 'pvlib', 'data', '723170TYA.CSV'), 'utf8')), opts: { year: E.tmy3_year } },
  };
  const rel = [], hourly = [];
  for (const [name, { w, opts }] of Object.entries(weathers)) {
    const site = { lat: w.meta.lat, lon: w.meta.lon, elevation: w.meta.elevation, tz: w.meta.tz, deltaT: 69.2 };
    const solar = S.prepareSolar(w, site, opts);
    for (const s of E.systems) {
      const ref = E.results[name][s.name];
      const r = S.simulate({ weather: w, site, system: sysOf(s), solar, keepHourly: true });
      const eAC = (r.annual.acKWh - ref.ac_kwh) / ref.ac_kwh, eDC = (r.annual.dcKWh - ref.dc_kwh) / ref.dc_kwh, ePOA = (r.annual.poaKWhm2 - ref.poa_kwhm2) / ref.poa_kwhm2;
      console.log(`     ${name} ${s.name}: AC ${(r.annual.acKWh / 1000).toFixed(3)} MWh（pvlib ${(ref.ac_kwh / 1000).toFixed(3)}，差 ${(eAC * 100).toExponential(2)}%），PR ${r.annual.pr.toFixed(4)}，POA ${r.annual.poaKWhm2.toFixed(2)}，截峰 ${r.annual.clipLossPct.toFixed(2)}%`);
      rel.push([eAC, 0], [eDC, 0], [ePOA, 0]);
      r.hourly.ac.forEach((v, i) => hourly.push([v, ref.hourly_ac[i]]));
      report[`energy.${name}.${s.name}`] = { acKWh: r.annual.acKWh, pvlibAcKWh: ref.ac_kwh, relErr: eAC, pr: r.annual.pr, specificYield: r.annual.specificYield };
    }
  }
  stat('energy annual AC/DC/POA relative error', rel, 0.02);
  stat('energy hourly AC (W, 1 MWp system)', hourly, 1e-3);
}

// ---------------------------------------------------------------- 雙面背面日射（模型不同，只看相對誤差的分布）
{
  const B = load('bifacial.json');
  for (const ground of ['uniform', 'resolved']) {
    const rel = [], abs = []; let sr = 0, sp = 0;
    for (const c of B) {
      const r = S.rearIrradiance({ tilt: c.tilt, surfaceAzimuth: c.saz, zenith: c.zen, azimuth: c.az, ghi: c.ghi, dni: c.dni, dhi: c.dhi, albedo: c.albedo, gcr: c.gcr, height: c.height, width: 2, ground, nGround: 200 });
      abs.push([r.rear, c.back]); sr += r.rear; sp += c.back;
      rel.push([(r.rear - c.back) / Math.max(c.front, 1), 0]);   // 以正面日射為分母（＝背面增益的誤差）
    }
    // uniform 與 pvlib 同假設，要貼近；resolved（排下陰影逐點）是不同模型，只記錄差異
    stat(`bifacial ${ground} rear vs infinite_sheds (W/m2)`, abs, ground === 'uniform' ? 3 : Infinity);
    stat(`bifacial ${ground} rear error / front POA`, rel, ground === 'uniform' ? 0.005 : Infinity);
    report[`bifacial.${ground}.sumRatio`] = sr / sp;
    console.log(`     背面總和比（本模組 / pvlib）：${(sr / sp).toFixed(4)}`);
  }
}

writeFileSync(join(REF, 'compare-report.json'), JSON.stringify({ fails, report }, null, 1));
console.log(fails.length ? `\n未通過：${fails.join(', ')}` : '\n全部通過');
process.exitCode = fails.length ? 1 : 0;
