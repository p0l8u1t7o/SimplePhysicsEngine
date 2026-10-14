// 本站自有檢查：能源調度的物理守恆與規則、施工與營運的時序、客戶車輛與閘門（三種場型都跑）。
// 通用的干涉、閃爍、倒序一致由 core 統一檢查負責。
//   node --import ../../core/tools/register.mjs tools/verify.mjs
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createProject } from '../web/js/project.js';
import { SITE_IDS, SITES, CAR } from '../web/js/sites.js';
import { simulate, STEPS, DT, ETA, SOC_MAX } from '../web/js/energy.js';
import { gateGeom } from '../web/js/lot.js';
import './verify-details.mjs';
import './verify-realism.mjs';

const failures = [], results = {};
const fail = (site, msg) => failures.push(`${SITES[site].name}：${msg}`);
for (const id of SITE_IDS) {
  const site = SITES[id];
  for (const expanded of id === 'urban' ? [false, true] : [false]) {
    const S = simulate(id, { expanded }), tag = expanded ? '（擴充後）' : '';
    // 1. 每一步功率平衡：市電＋光電＋儲能放電＝充電＋基載＋儲能充電＋輸出
    let worst = 0;
    for (const r of S.day) worst = Math.max(worst, Math.abs(r.grid + r.pv + r.dis - (r.ev + r.base + r.chg)));
    if (worst > .01) fail(id, `${tag}功率不平衡 ${worst.toFixed(3)} kW`);
    // 2. SOC 連續：soc[k+1] = soc[k] + (chg·η − dis/η)·Δt／E
    let jump = 0;
    for (let k = 0; k + 1 < S.day.length; k++) { const a = S.day[k], b = S.day[k + 1]; jump = Math.max(jump, Math.abs(b.soc - Math.min(SOC_MAX, a.soc + (a.chg * ETA - a.dis / ETA) * DT / S.E))); }
    if (jump > 1e-6) fail(id, `${tag}SOC 不連續 ${jump}`);
    // 3. 規則：取電不超過契約；儲能功率不超過額定；尖峰不從市電充儲能；無光電場型不產生光電
    for (const r of S.day.slice(0, STEPS)) {
      if (r.grid > S.contract + .01) { fail(id, `${tag}${r.h} h 取電 ${r.grid.toFixed(1)} 超過契約 ${S.contract}`); break; }
      if (r.chg > S.P + .01 || r.dis > S.P + .01) { fail(id, `${tag}${r.h} h 儲能功率超過額定`); break; }
      if (r.period === 'peak' && r.chgGrid > .01) { fail(id, `${tag}${r.h} h 尖峰從市電充儲能`); break; }
      if (!site.pv && r.pv > 0) { fail(id, '不建光電的場型出現光電出力'); break; }
    }
    // 4. 每個場次不超過充電樁功率、電量不超過需求
    for (const s of S.sessions) if (s.got > s.kwh + 1e-6) fail(id, `${tag}${s.ch} 充電量超過需求`);
    results[id + (expanded ? '-x' : '')] = { peakGrid: +S.kpi.peakGrid.toFixed(1), peakNoBess: +S.kpi.peakNoBess.toFixed(1), evKwh: +S.kpi.ev.toFixed(0), cycles: +S.kpi.cycles.toFixed(2), limitHours: S.kpi.limitHours };
  }
  // 5. 場景時序：上線前沒有充電車；客戶車輛只在閘門開啟時通過閘桿；停妥時在車位內；插槍時已停妥
  const scene = new THREE.Scene(), p = createProject({ scene, site: id }), H = p.seq.hero, G = gateGeom(site);
  for (let t = 0; t < p.seq.opStart; t += .5) { p.apply(t); if (p.evCars.some(k => k.car.root.visible)) { fail(id, `${t} s 上線前出現充電車`); break; } }
  const half = CAR.len / 2;
  for (let t = H.t0; t <= H.t1; t += .02) {
    const pr = p.apply(t), z = p.hero.root.position.z, x = p.hero.root.position.x;
    const inLane = Math.abs(x - G.xIn) < 1500, outLane = Math.abs(x - G.xOut) < 1500;
    if (inLane && Math.abs(z - G.armIn) < half + 200 && pr.gate.entry < .9) { fail(id, `${t.toFixed(2)} s 客戶車輛在進場閘桿下但閘門未開（${pr.gate.entry.toFixed(2)}）`); break; }
    if (outLane && Math.abs(z - G.armOut) < half + 200 && pr.gate.exit < .9) { fail(id, `${t.toFixed(2)} s 客戶車輛在出場閘桿下但閘門未開（${pr.gate.exit.toFixed(2)}）`); break; }
  }
  p.apply(H.plugT + .01);
  const st = H.ch.stall, hp = p.hero.root.position;
  if (Math.hypot(hp.x - st.x, hp.z - st.z) > 50) fail(id, `插槍時客戶車輛不在車位中心（差 ${Math.hypot(hp.x - st.x, hp.z - st.z).toFixed(0)} mm）`);
  if (!(H.tPark <= H.plugT && H.plugT < H.unplugT && H.unplugT < H.revT0)) fail(id, '客戶情境時序錯誤（停妥→插槍→拔槍→倒車）');
  // 6. 充電中的車輛都已停妥（充電線只在停妥時出現）
  for (let t = p.seq.opStart; t < p.total; t += .25) {
    p.apply(t);
    for (const k of p.evCars) if (k.car.root.visible && scene.getObjectByName(`ev cable ${k.c.id}`)?.visible && (Math.abs(k.car.root.position.x - k.c.stall.x) > 5 || Math.abs(k.car.root.position.z - k.c.stall.z) > 5)) { fail(id, `${t} s ${k.c.id} 未停妥就接上充電線`); t = p.total; break; }
  }
  results[id].total = +p.total.toFixed(1);
}
const result = { ok: !failures.length, sites: results, failures };
mkdirSync(new URL('../review/', import.meta.url), { recursive: true });
writeFileSync(new URL('../review/verification.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
