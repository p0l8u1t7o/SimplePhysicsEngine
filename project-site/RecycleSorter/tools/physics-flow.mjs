// 後段混合料流的物理版分析（評估平台 Q10 驗收，core/physics）：前段 ABB 放行的工件，照排程的時間與位置放上導料板出口後的主帶，
// 由皮帶摩擦帶到抓取窗口；算皮帶上的密度、相鄰間隙、碰在一起的比例，以及到抓取窗口時「可以吸」的比例（平躺、四周有空隙），
// 和現有拍板的料流節拍（混合料流 1.57 s／瓶、目標間距 ≥ 315 mm）對照。結果寫 review/physics-flow.json。
//   node --import ../../core/tools/register.mjs tools/physics-flow.mjs
import '../../../core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { bake, sampler } from '@core/physics/physics.js';
import { createProject } from '../web/js/project.js';
import { LAYOUT as L } from '../web/js/layout.js';
import { BELT_V, footprintGap } from '../web/js/schedule.js';

const scene = new THREE.Scene(), p = await createProject({ scene });
const b = L.belt, X_IN = -900, half = 150, cz = L.pick.cz;      // 導料板出口之後（280 mm 通道，兩側各留 10 mm）
const flow = p.items.filter(it => !it.abbJob).map(it => ({ it, t: (X_IN - it.off) / BELT_V })).filter(x => x.t >= 0).sort((a, c) => a.t - c.t);
const exitT = Math.max(...flow.map(x => x.t)) + (b.x[1] - X_IN) / BELT_V + 1;
const baked = await bake({
  name: '後段主帶物料流', duration: exitT, seed: 1,
  conveyors: [{ id: '主帶', size: [b.x[1] - b.x[0], 20, b.width], pos: [(b.x[0] + b.x[1]) / 2, b.top - 10, b.z], speed: BELT_V }],
  statics: [-1, 1].map(s => ({ id: `通道 ${s}`, size: [b.x[1] - X_IN + 100, 120, 10], pos: [(X_IN + b.x[1]) / 2, b.top + 60, cz + s * (half + 5)] })),
  sinks: [{ id: '帶尾', min: [b.x[1] + 50, -1e4, -1e4], max: [1e5, 1e4, 1e4] }],
  drops: flow.map(({ it, t }) => ({ id: it.id, t, pos: [X_IN, b.top + it.H / 2 + 2, it.zAt(X_IN)], rot: [0, it.theta * 180 / Math.PI, 0], velocity: [BELT_V, 0, 0],
    item: { name: it.kind, shape: 'box', size: [it.L, it.H, it.W], density: 60, friction: .5, restitution: .05 } })),
});
const at = sampler(baked), byId = new Map(flow.map(x => [String(x.it.id), x.it]));
const yaw = q => { const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...q), 'YXZ'); return e.y; };
const tilt = q => new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(...q)).angleTo(new THREE.Vector3(0, 1, 0)) * 180 / Math.PI;
// 每 0.1 s：皮帶上（導料板出口到帶尾）的件數、相鄰的最小間隙、碰在一起的件
let samples = 0, onBelt = 0, touching = 0, pairs = 0, minGap = Infinity;
for (let t = 0; t <= exitT; t += .1) {
  const live = at(t).filter(o => o.visible && o.pos[0] > X_IN && o.pos[0] < b.x[1]).map(o => ({ ...byId.get(o.id), x: o.pos[0], z: o.pos[2], theta: yaw(o.quat) }));
  samples++; onBelt += live.length;
  live.sort((a, c) => a.x - c.x);
  for (let i = 1; i < live.length; i++) { const g = footprintGap(live[i - 1], live[i]); pairs++; minGap = Math.min(minGap, g); if (g < 2) touching++; }
}
// 到抓取窗口中心（pick.cx）時：目標工件平躺（傾斜 < 15°）而且四周間隙 ≥ 10 mm 才算「可以吸」
const grasp = [];
for (const { it } of flow.filter(x => x.it.cls !== 'other')) {
  let tc = null;
  for (let t = 0; t <= exitT; t += .02) { const o = at(t).find(s => s.id === String(it.id)); if (o?.visible && o.pos[0] >= L.pick.cx) { tc = t; break; } }
  if (tc == null) { grasp.push({ id: it.id, kind: it.kind, ok: false, why: '沒有到抓取窗口' }); continue; }
  const now = at(tc).filter(o => o.visible), me = now.find(o => o.id === String(it.id)), A = { ...it, x: me.pos[0], z: me.pos[2], theta: yaw(me.quat) };
  const gap = Math.min(...now.filter(o => o !== me && byId.has(o.id)).map(o => footprintGap(A, { ...byId.get(o.id), x: o.pos[0], z: o.pos[2], theta: yaw(o.quat) })));
  const tl = tilt(me.quat), ok = tl < 15 && gap >= 10;
  grasp.push({ id: it.id, kind: it.kind, ok, tilt: +tl.toFixed(1), gap: Number.isFinite(gap) ? +gap.toFixed(0) : null, ...(ok ? {} : { why: tl >= 15 ? '翻倒或斜靠' : '和鄰件太近' }) });
}
const mixed = p.throughput.mixed, spacing = p.throughput.pitch;      // 站的拍板數字：混合料流節拍與目標間距（throughput）
const out = {
  source: 'core/physics（Rapier 決定性版）', baked: baked.stats, items: flow.length, targets: grasp.length,
  density: +(onBelt / samples / ((b.x[1] - X_IN) / 1000)).toFixed(2), minGap: +minGap.toFixed(0), touchingRatio: +(touching / Math.max(1, pairs)).toFixed(3),
  graspable: grasp.filter(g => g.ok).length, graspableRatio: +(grasp.filter(g => g.ok).length / Math.max(1, grasp.length)).toFixed(3),
  decided: { mixedCT: mixed, spacing: Math.round(spacing), densityAtSpacing: +(1000 / spacing).toFixed(2) }, grasp,
};
mkdirSync(new URL('../review/', import.meta.url), { recursive: true });
writeFileSync(new URL('../review/physics-flow.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`後段物料流（物理）：${out.items} 件、皮帶上平均 ${out.density} 件／m（拍板間距 ${out.decided.spacing} mm ＝ ${out.decided.densityAtSpacing} 件／m）、最小間隙 ${out.minGap} mm、碰在一起 ${(out.touchingRatio * 100).toFixed(1)}%`);
console.log(`抓取窗口可以吸：${out.graspable}／${out.targets}（${(out.graspableRatio * 100).toFixed(0)}%）${grasp.filter(g => !g.ok).map(g => `；${g.id} ${g.kind} ${g.why}`).join('')}`);
console.log(`烘焙 ${baked.stats.ms} ms、靜止接觸穿透 ${baked.stats.maxPenetration} mm`);
