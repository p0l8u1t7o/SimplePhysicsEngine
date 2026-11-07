// Node 與瀏覽器共用的決定性工作量：同一份輸入，各階段結果的雜湊必須逐位元相同。
import * as S from '../index.js';

export function workload(epwText) {
  const site = { lat: 23.0, lon: 120.2, elevation: 15, tz: 8, deltaT: 69.2 }, H = {};
  // 1. SPA：2000 個時刻 × 3 地點
  const spa = [];
  for (const [lat, lon] of [[25.03, 121.56], [23.0, 120.2], [-33.87, 151.2]]) for (let k = 0; k < 2000; k++) {
    const p = S.solarPosition(946684800 + k * 7919.37, { lat, lon, elevation: 50, deltaT: S.deltaT(2000 + Math.floor(k / 100)) });
    spa.push(p.apparentZenith, p.azimuth, p.equationOfTime);
  }
  H.spa = S.hashFloat64(spa);
  // 2. 追日（回溯、坡地）＋ Perez ＋ IAM ＋ 晴空
  const tr = [];
  for (let k = 0; k < 3000; k++) {
    const z = (k * 0.0293) % 89.9, a = (k * 7.77) % 360;
    const t = S.singleAxis(z, a, { gcr: 0.42, maxAngle: [-55, 60], crossAxisTilt: 4.2, axisTilt: 2 });
    const cs = S.clearSky(z, { tl: 3.2, altitude: 100 });
    const p = Number.isFinite(t.tilt) ? S.perez(t.tilt, t.surfaceAzimuth, cs.dhi, cs.dni, 1361, z, a, S.relativeAirmass(z)).total : 0;
    tr.push(t.theta, t.aoi, cs.ghi, p, S.iamPhysical(t.aoi || 0), S.linkeTurbidityTW(23.5, 120.5, 1700000000 + k * 10000));
  }
  H.tracking = S.hashFloat64(tr);
  // 3. BVH 遮陰：3 排 × 20 片追日，36 個太陽位置
  const module = { length: 2384, width: 1134 }, arr = S.trackerArray({ rows: 3, modulesPerRow: 20, module, gap: 20, pitch: module.length / 0.45, height: 2000 });
  const L = S.createTriangleList(); S.modulesToTriangles(arr.pose(0), L);
  L.addQuad([-50000, 0, -50000], [-50000, 0, 50000], [50000, 0, 50000], [50000, 0, -50000]);
  const bvh = S.buildBVH(L.positions, L.owners), P = Float64Array.from(L.positions), sh = [];
  for (let k = 0; k < 36; k++) {
    const z = 20 + (k * 1.9) % 65, a = 60 + (k * 6.7) % 240, th = S.singleAxis(z, a, { gcr: 0.45, backtrack: false }).theta;
    const ms = arr.pose(th); P.set(S.modulesToPositions(ms), 0); bvh.refit(P);
    const r = S.shadeModules(bvh, ms.map(m => S.moduleLayout({ ...m, samples: [8, 3], halfCut: k % 2 === 1 })), S.sunVector(z, a));
    sh.push(...r.area, ...r.blocks);
  }
  sh.push(S.skyViewFactor(bvh, [0, 2100, 0], [0, 1, 0], { n: 300 }), ...S.horizonFromBVH(bvh, [0, 10, 9000], { azStep: 15 }).flat());
  H.shading = S.hashFloat64(sh);
  // 4. 全年發電（含雙面）
  const w = S.readEPW(epwText);
  const r = S.simulate({ weather: w, site, keepHourly: true, system: { mount: { type: 'singleAxis', gcr: 0.4, maxAngle: 60 }, pdc0: 1e6, losses: S.pvwattsLosses(), bifacial: { height: 2, width: 2.384 } } });
  H.energy = S.hashFloat64([r.hourly.ac, r.hourly.tCell, r.annual.acKWh, r.annual.rearKWhm2]);
  H.acKWh = r.annual.acKWh;
  return H;
}
