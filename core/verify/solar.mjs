// 站層的日照檢查（check.mjs 的 solar，core 1.20.0）：站在 project.verify.solar 宣告陣列，檢查冬至日的列間遮陰。
//   project.verify.solar = {
//     site: { lat, lon, elevation = 0, tz = 8, deltaT = 69.2 },
//     layout: { type: 'fixed', rows, modulesPerRow, nUp, module, tilt, azimuth, pitch, frontHeight, origin }   固定式（solar/layout.js 的 fixedArray）
//           | { type: 'tracker', rows, modulesPerRow, module, pitch, height, axisAzimuth, maxAngle = 60 }      單軸追日（trackerArray；轉角用 singleAxis＋回溯）
//     date = [12, 21]（月、日；冬至）, hours = [9, 15]（當地時間）, step = 0.25（小時）, samples = [12, 3], tol = 0.005（被遮面積比例上限）, year = 2026,
//     obstacles = [ { name, box: { min: [x, y, z], max } } | { name, quads: [[p0, p1, p2, p3], …] }
//                 | { name, terrain: (x, z) => y, min: [x, z], max: [x, z], step = 2000 } ],   外部遮擋（建物、塔、地形；座標同 core/solar：X 東、Z 南）
//     obstacleTol（可省略：有給時「含外部遮擋」那一列要 ≤ obstacleTol，沒給只當資訊） }
// 檢查列：
//   1. 冬至 hours 內每個時刻，所有板片的直達日照被遮比例 ≤ tol（排距夠不夠；追日時用回溯的轉角）
//   2. 對照組：排距縮成 90% 時一定要遮到（> tol）——抓不到代表檢查本身放水（取樣太粗、時間範圍不對），這一列失敗；
//      追日的對照組回溯仍用設計排距的 GCR（模擬列距比設計短），不然回溯會跟著調整、永遠不遮
//   3. 追日另外列出：真追日（不回溯）時的最大遮陰，說明回溯的必要（只當資訊）
//   4. 有 obstacles 時：含外部遮擋的最大遮陰（obstacleTol 有給才判定）
//   5. 有 energy 時：全年發電（core/solar 的 simulate）和預期值相差 ≤ energy.tol（預設 SITE_PRECISION.energyRel，2%）。
//      energy = { weather: 'data/tmy.epw'（站資料夾的相對路徑，.gz 可）, pdc0（W；沒給就用板片數 × moduleW，預設 550 W）, losses = 14（%）,
//                 system?（覆寫 simulate 的 system）, expect?: { acKWh, source（例如 'pvlib 0.16.1'） }, tol? }
//      沒給 expect 時和上次的 review（solar-checks.json）比，當回歸；第一次跑記成基準。未含列間遮陰（固定式排距夠、追日有回溯時可忽略）
//   鋼構宣告（取代 layout，2026-11-08）：structure = { kind: 'fixed' | 'tracker', params（core/structure 的 layoutFixedRack／layoutTracker 參數，height 用世界座標的地形）,
//     azimuth = 180（固定式朝向）| axisAzimuth = 180（追日軸）, origin, limits（structureChecks 的門檻） }：板片位置照鋼構實際算出來（solarFrame 換座標），
//     排距對照組用同一組參數重算鋼構，另外列出鋼構的檢查列（基樁、離地、坡度…）；站不用再分開宣告兩份陣列
// 第 1～3 列只用陣列自己的板片當遮擋物（列間遮陰）；外部遮擋另列第 4 列。結果是決定性的（core/solar 全部用 dmath）。
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import * as S from '../solar/index.js';
import { layoutFixedRack, layoutTracker, structureChecks, solarFrame, RACK_DEFAULTS, TRACKER_DEFAULTS } from '../structure/index.js';

function arrayOf(layout, pitch) {
  if (layout.build) { const lay = Math.abs(pitch - layout.pitch) < 1e-9 ? layout.base : layout.build(pitch); return { kind: layout.type, count: lay.modules.length, pose: th => layout.frame.modules(lay, th) }; }
  const { type, ...p } = layout;
  if (type === 'tracker') { const a = S.trackerArray({ ...p, pitch }); return { kind: 'tracker', count: a.count, pose: th => a.pose(th) }; }
  const a = S.fixedArray({ ...p, pitch }); return { kind: 'fixed', count: a.count, pose: () => a.modules };
}

// 一個排距下，整段時間的最大遮陰：回傳 { max, at（時間）, mean }
// 外部遮擋加進三角形清單（owner −1：不屬於任何板片）
function addObstacles(list, obstacles) {
  for (const o of obstacles) {
    if (o.box) {
      const [x0, y0, z0] = o.box.min, [x1, y1, z1] = o.box.max, P = (x, y, z) => [x, y, z];
      for (const q of [[P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)], [P(x0, y0, z1), P(x0, y1, z1), P(x1, y1, z1), P(x1, y0, z1)],
        [P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1)], [P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0)],
        [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)]]) list.addQuad(...q);
    }
    for (const q of o.quads || []) list.addQuad(...q);
    if (o.terrain) {
      const st = o.step ?? 2000, [ax, az] = o.min, [bx, bz] = o.max, nx = Math.max(1, Math.ceil((bx - ax) / st)), nz = Math.max(1, Math.ceil((bz - az) / st));
      const p = (i, k) => { const x = ax + (bx - ax) * i / nx, z = az + (bz - az) * k / nz; return [x, o.terrain(x, z), z]; };
      for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) list.addQuad(p(i, k), p(i, k + 1), p(i + 1, k + 1), p(i + 1, k));
    }
  }
}

// 鋼構宣告（structure）→ 和 layout 同樣用法的描述：板片由 core/structure 的 layout 經 solarFrame 換到日照座標，
// 排距的對照組用同一組參數重算鋼構（不是把板片縮排）
function fromStructure(st) {
  const kind = st.kind === 'tracker' ? 'tracker' : 'fixed', P = st.params || {}, D = kind === 'tracker' ? TRACKER_DEFAULTS : RACK_DEFAULTS;
  const frame = solarFrame(kind === 'tracker' ? { kind, axisAzimuth: st.axisAzimuth ?? 180, origin: st.origin } : { kind, azimuth: st.azimuth ?? 180, origin: st.origin });
  const build = pitch => (kind === 'tracker' ? layoutTracker : layoutFixedRack)({ ...P, pitch, ...(P.height ? { height: frame.localGround(P.height) } : {}) });
  const base = build(P.pitch ?? D.pitch), m0 = base.modules[0], up = P.up ?? D.up, gap = P.gap ?? D.gap;
  return { type: kind, pitch: P.pitch ?? D.pitch, module: { length: up * m0.size[1] + (up - 1) * gap }, tilt: P.tilt ?? D.tilt, azimuth: st.azimuth ?? 180,
    axisAzimuth: st.axisAzimuth ?? 180, maxAngle: P.maxAngle ?? D.maxAngle, wp: (P.module?.wp ?? D.module.wp), build, frame, base, limits: st.limits };
}

function worstShade(cfg, pitch, { backtrack = true, gcrPitch = pitch, obstacles = null } = {}) {
  const { site, layout, date = [12, 21], hours = [9, 15], step = 0.25, samples = [12, 3], year = 2026 } = cfg;
  const arr = arrayOf(layout, pitch), list = S.createTriangleList();
  S.modulesToTriangles(arr.pose(0), list);
  const nMod = list.positions.length;
  if (obstacles) addObstacles(list, obstacles);
  const bvh = S.buildBVH(list.positions, list.owners), full = Float64Array.from(list.positions);
  const gcr = layout.type === 'tracker' ? layout.module.length / gcrPitch : null;   // 回溯用的 GCR（對照組用設計排距，模擬列距比設計短）
  let max = 0, at = null, sum = 0, n = 0;
  for (let h = hours[0]; h <= hours[1] + 1e-9; h += step) {
    const hh = Math.floor(h + 1e-9), mm = Math.round((h - hh) * 60);
    const sp = S.solarPosition(S.unixFromLocal(year, date[0], date[1], hh, mm, 0, site.tz ?? 8), { elevation: 0, deltaT: 69.2, ...site });
    if (sp.apparentElevation <= 0) continue;
    let mods = arr.pose(0);
    if (arr.kind === 'tracker') {
      const tr = S.singleAxis(sp.apparentZenith, sp.azimuth, { axisAzimuth: layout.axisAzimuth ?? 180, maxAngle: layout.maxAngle ?? 60, gcr, backtrack });
      mods = arr.pose(Number.isFinite(tr.theta) ? tr.theta : 0); full.set(S.modulesToPositions(mods), 0); bvh.refit(full);
    }
    const r = S.shadeModules(bvh, mods.map(m => S.moduleLayout({ ...m, samples, diodes: 3 })), S.sunVector(sp.apparentZenith, sp.azimuth));
    for (let i = 0; i < r.area.length; i++) { sum += r.area[i]; n++; if (r.area[i] > max) { max = r.area[i]; at = h; } }
  }
  return { max, at, mean: n ? sum / n : 0 };
}

const clock = h => h == null ? '—' : `${String(Math.floor(h + 1e-9)).padStart(2, '0')}:${String(Math.round((h - Math.floor(h + 1e-9)) * 60)).padStart(2, '0')}`;
const pct = v => `${(v * 100).toFixed(1)}%`;

// 全年發電列：讀站的天候檔、照陣列設定組 simulate 的 system
function energyRow(cfg, layout, { dir, previous }) {
  const e = cfg.energy, file = join(dir || '.', e.weather);
  const text = /\.gz$/i.test(file) ? gunzipSync(readFileSync(file)).toString('utf8') : readFileSync(file, 'utf8');
  const weather = /\.csv(\.gz)?$/i.test(file) ? S.readCSV(text, e.csv || {}) : S.readEPW(text);
  const count = arrayOf(cfg.layout, cfg.layout.pitch).count, pdc0 = e.pdc0 ?? count * (e.moduleW ?? cfg.layout.wp ?? 550);   // 鋼構宣告時用模組的 wp
  const mount = layout.type === 'tracker'
    ? { type: 'singleAxis', axisAzimuth: layout.axisAzimuth ?? 180, maxAngle: layout.maxAngle ?? 60, gcr: layout.module.length / layout.pitch, backtrack: true }
    : { type: 'fixed', tilt: layout.tilt, azimuth: layout.azimuth ?? 180 };
  const r = S.simulate({ weather, site: { elevation: 0, deltaT: 69.2, ...cfg.site }, system: { mount, pdc0, losses: e.losses ?? 14, ...(e.system || {}) } });
  const ac = r.annual.acKWh, tol = e.tol ?? S.SITE_PRECISION.energyRel;
  let expect = e.expect?.acKWh ?? null, source = e.expect?.source ?? '宣告的預期值';
  if (expect == null && previous?.energy?.acKWh != null) { expect = previous.energy.acKWh; source = '上次結果（回歸）'; }
  const dev = expect ? ac / expect - 1 : null;
  const row = { group: '日照', name: '全年發電', ok: dev == null || Math.abs(dev) <= tol, value: `${Math.round(ac).toLocaleString('en-US')} kWh（${(r.annual.specificYield).toFixed(0)} kWh/kWp、PR ${r.annual.pr.toFixed(3)}）`,
    note: dev == null ? `第一次，記成基準（${e.weather}，${(pdc0 / 1000).toFixed(1)} kWp）` : `和${source} ${Math.round(expect).toLocaleString('en-US')} kWh 差 ${(dev * 100).toFixed(2)}%，容許 ±${(tol * 100).toFixed(1)}%` };
  return { row, energy: { acKWh: ac, specificYield: r.annual.specificYield, pr: r.annual.pr, pdc0, weather: e.weather } };
}

export function verifySolar(project, { dir, previous } = {}) {
  const raw = project.verify?.solar;
  if (!raw) return { ok: true, applicable: false };
  const cfg = raw.structure ? { ...raw, layout: fromStructure(raw.structure) } : raw;
  const tol = cfg.tol ?? 0.005, pitch = cfg.layout.pitch, date = cfg.date ?? [12, 21], hours = cfg.hours ?? [9, 15], label = `${date[0]}/${date[1]} ${clock(hours[0])}～${clock(hours[1])}`;
  // 對照組：幾何用 90% 的排距，回溯仍照設計排距算轉角（追日控制器不知道列被做短了），一定要遮得到
  const main = worstShade(cfg, pitch), control = worstShade(cfg, pitch * 0.9, { gcrPitch: pitch });
  const rows = [
    { group: '日照', name: `排距 ${pitch} mm：${label} 列間遮陰`, ok: main.max <= tol, value: pct(main.max), note: main.max > tol ? `最大在 ${clock(main.at)}；排距不夠，或追日的回溯沒有生效` : `容許 ${pct(tol)}` },
    { group: '日照', name: `對照組：排距 ${Math.round(pitch * 0.9)} mm（90%）要抓得到遮陰`, ok: control.max > tol, value: pct(control.max), note: control.max > tol ? `最大在 ${clock(control.at)}；檢查有效` : '縮小排距也沒有遮陰：取樣太粗或時間範圍不對，檢查可能放水' },
  ];
  if (cfg.layout.type === 'tracker') {
    const nb = worstShade(cfg, pitch, { backtrack: false });
    rows.push({ group: '日照', name: '真追日（不回溯）時的列間遮陰', ok: true, value: pct(nb.max), note: nb.max > tol ? `最大在 ${clock(nb.at)}：需要回溯` : '不回溯也不會遮' });
  }
  if (cfg.obstacles?.length) {
    const ob = worstShade(cfg, pitch, { obstacles: cfg.obstacles }), names = cfg.obstacles.map(o => o.name || (o.box ? '建物' : o.terrain ? '地形' : '遮擋物')).join('、'), lim = cfg.obstacleTol;
    rows.push({ group: '日照', name: `含外部遮擋（${names}）的最大遮陰`, ok: lim == null || ob.max <= lim, value: pct(ob.max), note: `最大在 ${clock(ob.at)}、平均 ${pct(ob.mean)}${lim == null ? '（只當資訊；obstacleTol 給了才判定）' : `；容許 ${pct(lim)}`}` });
  }
  let energy;
  if (cfg.energy) { const er = energyRow(cfg, cfg.layout, { dir, previous }); rows.push(er.row); energy = er.energy; }
  // 鋼構宣告：鋼構本身的檢查列（基樁埋深、外露、離地、坡度、GCR…）一起列
  if (cfg.layout.build) for (const r of structureChecks(cfg.layout.base, cfg.layout.limits)) rows.push({ ...r, group: `鋼構｜${r.group}` });
  return { ok: rows.every(r => r.ok), applicable: true, rows, ...(energy ? { energy } : {}), failures: rows.filter(r => !r.ok).map(r => `${r.name}：${r.value}（${r.note}）`) };
}
