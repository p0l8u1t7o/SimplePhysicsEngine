// core/solar 單元測試：node --import ./core/tools/register.mjs --test core/solar/test/（core 檢查 engineering 會跑）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../index.js';
import { trackerArray, fixedArray, modulesToTriangles, modulesToPositions, winterSolsticePitch } from '../layout.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// 合成的台南 EPW（晴空 × 決定性雲量，只供驗證；gzip 後 83 KB 放在 fixtures）
const EPW = () => gunzipSync(readFileSync(join(HERE, 'fixtures', 'synthetic-tainan.epw.gz'))).toString('utf8');
const TAINAN = { lat: 23.0, lon: 120.2, elevation: 15, tz: 8, deltaT: 69.2 };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}（容差 ${tol}）`);

// 一天的太陽位置（當地時間，每 step 分鐘）
function daySun(y, m, d, site = TAINAN, step = 15) {
  const out = [];
  for (let min = 0; min < 1440; min += step) {
    const p = S.solarPosition(S.unixFromLocal(y, m, d, 0, min, 0, site.tz), site);
    if (p.apparentZenith < 88) out.push(p);
  }
  return out;
}

test('SPA：NREL 論文範例與台灣夏至', () => {
  const u = S.unixFromLocal(2003, 10, 17, 12, 30, 30, -7);
  const r = S.solarPosition(u, { lat: 39.742476, lon: -105.1786, elevation: 1830.14, pressure: 82000, temperature: 11, deltaT: 67 });
  near(r.apparentZenith, 50.11162, 5e-5, '天頂角'); near(r.azimuth, 194.34024, 5e-5, '方位角');
  near(S.incidenceAngle(30, 170, r.apparentZenith, r.azimuth), 25.18700, 5e-5, '入射角');
  // 北迴歸線（嘉義 23.45°N）夏至過中天：天頂角 < 0.1°
  const noon = daySun(2026, 6, 21, { lat: 23.45, lon: 120.45, tz: 8, deltaT: 69 }, 1).reduce((a, b) => (a.apparentZenith < b.apparentZenith ? a : b));
  assert.ok(noon.apparentZenith < 0.1, `夏至最小天頂角 ${noon.apparentZenith}`);
});

test('時間：公曆換算往返、ΔT 合理', () => {
  for (let d = -800000; d <= 800000; d += 997) {
    const c = S.civilFromDays(d);
    assert.equal(S.daysFromCivil(c.year, c.month, c.day), d);
  }
  assert.equal(S.unixFromLocal(1970, 1, 1, 8, 0, 0, 8), 0);
  const dt = S.deltaT(2026, 6); assert.ok(dt > 65 && dt < 80, `ΔT(2026) = ${dt}`);
});

test('單軸追日：回溯時 1D 排間遮陰為 0，真追日清晨有遮陰', () => {
  const gcr = 0.4, width = 2.384;
  let maxBT = 0, maxTT = 0;
  for (const p of [...daySun(2026, 12, 21), ...daySun(2026, 6, 21)]) {
    const bt = S.singleAxis(p.apparentZenith, p.azimuth, { gcr, maxAngle: 90, backtrack: true });
    const tt = S.singleAxis(p.apparentZenith, p.azimuth, { gcr, maxAngle: 90, backtrack: false });
    maxBT = Math.max(maxBT, S.rowShadedFraction1D(p.apparentZenith, p.azimuth, { theta: bt.theta, width, pitch: width / gcr }));
    maxTT = Math.max(maxTT, S.rowShadedFraction1D(p.apparentZenith, p.azimuth, { theta: tt.theta, width, pitch: width / gcr }));
  }
  assert.ok(maxBT < 1e-9, `回溯仍有遮陰 ${maxBT}`);
  assert.ok(maxTT > 0.3, `真追日清晨應有遮陰 ${maxTT}`);
});

// 3D 追日陣列：中間那排中段的板片
function trackerScene({ gcr = 0.4, rows = 5, modulesPerRow = 24, ground = null, axisTilt = 0, gap = 0, samples = [24, 3] } = {}) {
  const module = { length: 2384, width: 1134 };
  const arr = trackerArray({ rows, modulesPerRow, module, gap, pitch: module.length / gcr, axisTilt, height: 2000, ground });
  const mods = arr.pose(0), list = S.createTriangleList(); modulesToTriangles(mods, list);
  const bvh = S.buildBVH(list.positions, list.owners);
  const mid = Math.floor(rows / 2), probe = mods.filter(m => m.row === mid).slice(modulesPerRow / 2 - 2, modulesPerRow / 2 + 2).map(m => m.index);
  return {
    arr, bvh, module,
    shade(theta, sun) {
      const ms = arr.pose(theta); bvh.refit(modulesToPositions(ms));
      let a = 0; for (const i of probe) a += S.shadeModule(bvh, S.moduleLayout({ ...ms[i], samples }), sun).area;
      return a / probe.length;
    },
  };
}

test('BVH 遮陰 vs pvlib 1D 模型（真追日，平地）', () => {
  const sc = trackerScene();
  let maxErr = 0, n = 0;
  for (const p of daySun(2026, 12, 21, TAINAN, 20)) {
    const t = S.singleAxis(p.apparentZenith, p.azimuth, { gcr: 0.4, maxAngle: 60, backtrack: false });
    const f1 = S.rowShadedFraction1D(p.apparentZenith, p.azimuth, { theta: t.theta, width: sc.module.length, pitch: sc.module.length / 0.4 });
    const f3 = sc.shade(t.theta, S.sunVector(p.apparentZenith, p.azimuth));
    maxErr = Math.max(maxErr, Math.abs(f1 - f3)); n++;
  }
  assert.ok(n > 20);
  assert.ok(maxErr <= 1 / 24 + 1e-9, `3D 與 1D 遮陰比例最大差 ${maxErr}（取樣 24 格，容許 1 格）`);
});

test('BVH：平地回溯與坡地（cross-axis）回溯都不遮；坡地用平地回溯會遮', () => {
  const flat = trackerScene({ samples: [24, 2] });
  for (const p of daySun(2026, 12, 21, TAINAN, 20)) {
    const t = S.singleAxis(p.apparentZenith, p.azimuth, { gcr: 0.4, maxAngle: 90, backtrack: true });
    assert.equal(flat.shade(t.theta, S.sunVector(p.apparentZenith, p.azimuth)), 0, `平地回溯 ${p.apparentZenith}`);
  }
  // 往西下降 8° 的坡（軸朝南北）
  const slope = 8, ground = (x) => Math.tan(slope * Math.PI / 180) * x;   // 東高西低
  const cat = S.calcCrossAxisTilt(270, slope, 180, 0);
  near(cat, slope, 1e-9, 'cross-axis tilt');
  const sl = trackerScene({ ground, samples: [24, 2] });
  let naive = 0;
  for (const p of daySun(2026, 12, 21, TAINAN, 20)) {
    const sun = S.sunVector(p.apparentZenith, p.azimuth);
    const aware = S.singleAxis(p.apparentZenith, p.azimuth, { gcr: 0.4, maxAngle: 90, backtrack: true, crossAxisTilt: cat });
    assert.ok(sl.shade(aware.theta, sun) <= 1 / 24, `坡地感知回溯仍遮陰 ${p.apparentZenith}`);
    const flatBT = S.singleAxis(p.apparentZenith, p.azimuth, { gcr: 0.4, maxAngle: 90, backtrack: true });
    naive = Math.max(naive, sl.shade(flatBT.theta, sun));
  }
  assert.ok(naive > 0.05, `坡地用平地回溯應有遮陰 ${naive}`);
});

test('固定傾角：冬至 9～15 時排距檢核（SPA ＋ BVH）', () => {
  const site = { lat: 23.0, lon: 120.2, tz: 8, deltaT: 69.2 }, module = { length: 2384, width: 1134 };
  const base = { rows: 3, modulesPerRow: 12, nUp: 2, module, tilt: 20, gap: 20 };
  const slopeLength = 2 * module.length + 20;
  const need = winterSolsticePitch({ lat: site.lat, slopeLength, tilt: 20 });
  const shadeAt = pitch => {
    const arr = fixedArray({ ...base, pitch }), list = S.createTriangleList(); modulesToTriangles(arr.modules, list);
    const bvh = S.buildBVH(list.positions, list.owners);
    const back = arr.modules.filter(m => m.row === 0).slice(4, 8);   // 最北一排（被前排遮）的下排板
    let worst = 0;
    // 真太陽時 9～15 時：用 SPA 的均時差換算
    for (let h = 9; h <= 15.001; h += 0.25) {
      const lst = h - (site.lon - 120) / 15;   // 先粗估，再用均時差修正
      const p0 = S.solarPosition(S.unixFromLocal(2026, 12, 21, lst, 0, 0, 8), site);
      const p = S.solarPosition(S.unixFromLocal(2026, 12, 21, lst - p0.equationOfTime / 60, 0, 0, 8), site);
      const sun = S.sunVector(p.apparentZenith, p.azimuth);
      for (const m of back) worst = Math.max(worst, S.shadeModule(bvh, S.moduleLayout({ ...m, samples: [12, 6] }), sun).area);
    }
    return worst;
  };
  assert.equal(shadeAt(need.pitch * 1.01), 0, `排距 ${need.pitch.toFixed(0)} mm 時冬至 9～15 時不應遮陰`);
  assert.ok(shadeAt(need.pitch * 0.85) > 0, '排距縮小 15% 應有遮陰');
});

test('旁路二極體：非線性部分遮陰', () => {
  assert.equal(S.bypassMismatch([800, 800, 800]), 800);
  near(S.bypassMismatch([1000, 1000, 100]), 2000 / 3, 1e-12, '一段被遮 → 旁路');
  near(S.bypassMismatch([1000, 900, 950]), 900, 1e-12, '輕微不均 → 全串跟最低');
  // 直式 1P 下緣一條陰影：三段都暗 → 只剩散射；半片板 → 一半
  const m = S.moduleLayout({ o: [0, 0, 0], a: [2384, 0, 0], b: [0, 0, -1134], samples: [24, 6], diodes: 3 });
  assert.deepEqual(m.normal.map(v => Math.round(v) + 0), [0, 1, 0]);
  const blocks = new Float64Array([0, 0, 0]);
  near(S.stringIrradiance(blocks, 800, 100), 100, 1e-12);
  near(S.stringIrradiance(new Float64Array([0.5, 0.5, 0.5]), 800, 100), 500, 1e-12, '半片板');
  near(S.stringIrradiance(new Float64Array([0, 0, 0]), 800, 100, { model: 'linear', area: [0.05] }), 860, 1e-12, '線性模型只扣 5%');
});

test('地平線：表格內插與由地形算地平線', () => {
  const h = S.createHorizon([[90, 10], [180, 5], [270, 20], [0, 0]]);
  near(h.elevation(135), 7.5, 1e-12); near(h.elevation(315), 10, 1e-12); near(h.elevation(359), 20 / 90 * 1, 1e-9);
  assert.equal(h.blocks(85, 270), true); assert.equal(h.blocks(60, 270), false);
  // 東邊 100 m 處一道高 30 m 的牆（寬 400 m）：東方地平線 = atan(30/100) = 16.7°
  const L = S.createTriangleList();
  L.addQuad([100000, 0, -200000], [100000, 30000, -200000], [100000, 30000, 200000], [100000, 0, 200000]);
  const prof = S.horizonFromBVH(S.buildBVH(L.positions), [0, 0, 0], { azStep: 10, lift: 0 });
  const east = prof.find(p => p[0] === 90)[1];
  near(east, Math.atan(30 / 100) / (Math.PI / 180), 0.02, '東方地平線');
  assert.equal(prof.find(p => p[0] === 270)[1], 0);
});

test('天空視角因子', () => {
  const empty = S.buildBVH(new Float64Array(0));
  near(S.skyViewFactor(empty, [0, 0, 0], [0, 1, 0]), 1, 0);
  const L = S.createTriangleList();
  L.addQuad([-1e6, 1000, -1e6], [1e6, 1000, -1e6], [1e6, 1000, 1e6], [-1e6, 1000, 1e6]);
  near(S.skyViewFactor(S.buildBVH(L.positions), [0, 0, 0], [0, 1, 0]), 0, 0, '屋頂下');
  // 東半邊被高牆擋住（緊貼）→ 約一半
  const W = S.createTriangleList();
  W.addQuad([1, -1e6, -1e6], [1, 1e7, -1e6], [1, 1e7, 1e6], [1, -1e6, 1e6]);
  near(S.skyViewFactor(S.buildBVH(W.positions), [0, 0, 0], [0, 1, 0], { n: 1024 }), 0.5, 0.01, '半邊牆');
});

test('天候檔讀取：EPW、TMY3、CSV', () => {
  {
    const w = S.readEPW(EPW());
    assert.equal(w.n, 8760); assert.equal(w.meta.lat, 23); assert.equal(w.meta.tz, 8); assert.equal(w.hour[0], 1);
  }
  const csv = 'time,ghi,dni,dhi,temp_air,wind_speed\n2026-06-21 12:00,900,700,200,31,2\n2026-06-21 13:00,850,650,210,32,2.5\n';
  const c = S.readCSV(csv, { meta: { lat: 23, lon: 120.2, tz: 8 } });
  assert.equal(c.n, 2); assert.equal(c.hour[1], 13); assert.equal(c.ghi[0], 900); assert.ok(Number.isNaN(c.pressure[0]));
  const only = S.readCSV('time,ghi,temp_air\n2026-06-21 12:00,900,31\n');
  assert.ok(Number.isNaN(only.dni[0]));
  const r = S.simulate({ weather: only, site: TAINAN, system: { mount: { type: 'fixed', tilt: 20, azimuth: 180 }, pdc0: 1000 } });
  assert.ok(r.annual.acKWh > 0.5 && r.annual.acKWh < 1, `只有 GHI 時以 Erbs 分解 ${r.annual.acKWh}`);
});

test('發電：遮陰接進全年迴圈（太陽分箱快取），回溯 ≈ 0、真追日有損失', () => {
  const w = S.readEPW(EPW()), solar = S.prepareSolar(w, TAINAN);
  const module = { length: 2384, width: 1134 }, gcr = 0.4, rows = 3, per = 6;
  const arr = trackerArray({ rows, modulesPerRow: per, module, gap: 0, pitch: module.length / gcr });
  const list = S.createTriangleList(); modulesToTriangles(arr.pose(0), list);
  const bvh = S.buildBVH(list.positions, list.owners);
  const run = backtrack => {
    const mount = { type: 'singleAxis', axisAzimuth: 180, maxAngle: 60, gcr, backtrack };
    const strings = per - 2, d = 3;
    const cache = S.createSunBinCache((z, az) => {   // 中間那排（排除排頭排尾）各片當一串
      const t = S.singleAxis(z, az, mount), ms = arr.pose(t.theta);
      bvh.refit(modulesToPositions(ms));
      const blocks = new Float64Array(strings * d), sun = S.sunVector(z, az);
      ms.filter(m => m.row === 1).slice(1, -1).forEach((m, k) => S.shadeModule(bvh, S.moduleLayout({ ...m, samples: [12, 3] }), sun, { out: blocks.subarray(k * d, k * d + d) }));
      return { blocks };
    }, { zenStep: 1, azStep: 2 });
    return S.simulate({ weather: w, site: TAINAN, solar, system: { mount, pdc0: 1e6, inverter: { pdc0: 1e6 } },
      shading: { strings, blocksPerString: d, evaluate: ctx => cache.get(ctx.zenith, ctx.azimuth) } });
  };
  const bt = run(true), tt = run(false);
  assert.ok(bt.annual.shadeLossPct < 0.5, `回溯遮陰損失 ${bt.annual.shadeLossPct}%（分箱中心與實際太陽位置的差造成少量誤判）`);
  console.log(`    回溯 ${bt.annual.shadeLossPct.toFixed(3)}%、真追日 ${tt.annual.shadeLossPct.toFixed(3)}%`);
  assert.ok(tt.annual.shadeLossPct > 0.3 && tt.annual.shadeLossPct > 10 * bt.annual.shadeLossPct, `真追日遮陰損失 ${tt.annual.shadeLossPct}%`);
});

test('雙面：背面日射合理範圍', () => {
  const r = S.rearIrradiance({ tilt: 20, surfaceAzimuth: 180, zenith: 40, azimuth: 160, ghi: 800, dni: 700, dhi: 150, albedo: 0.25, gcr: 0.4, height: 1.5, width: 2.384 });
  const front = S.poaIrradiance({ tilt: 20, azimuth: 180, zenith: 40, sunAzimuth: 160, ghi: 800, dni: 700, dhi: 150, albedo: 0.25 }).global;
  const ratio = r.rear / front;
  assert.ok(ratio > 0.04 && ratio < 0.2, `背面／正面 ${ratio}`);
  assert.ok(r.groundShaded > 0 && r.groundShaded < 1);
});

test('決定性：同輸入兩次逐位元相同；分箱快取與查詢順序無關', () => {
  const run = () => {
    const vals = [];
    for (const p of daySun(2026, 3, 20)) {
      const t = S.singleAxis(p.apparentZenith, p.azimuth, { gcr: 0.35 });
      vals.push(p.apparentZenith, p.azimuth, t.theta, S.perez(t.tilt, t.surfaceAzimuth, 120, 600, 1361, p.apparentZenith, p.azimuth, S.relativeAirmass(p.apparentZenith)).total);
    }
    const sc = trackerScene({ rows: 3, modulesPerRow: 6, samples: [6, 3] });
    vals.push(sc.shade(30, S.sunVector(70, 100)), sc.bvh.nodeCount);
    return S.hashFloat64(vals);
  };
  assert.equal(run(), run());
  const ev = (z, a) => z * 1000 + a;
  const c1 = S.createSunBinCache(ev), c2 = S.createSunBinCache(ev);
  const qs = Array.from({ length: 200 }, (_, i) => [(i * 37) % 89, (i * 53) % 360]);
  const r1 = qs.map(([z, a]) => c1.get(z, a)), r2 = [...qs].reverse().map(([z, a]) => c2.get(z, a)).reverse();
  assert.deepEqual(r1, r2);
});
