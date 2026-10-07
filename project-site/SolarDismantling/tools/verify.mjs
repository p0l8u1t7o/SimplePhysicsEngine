// 本站自有檢查：製程上的規則寫在這裡；通用的干涉、閃爍、倒序一致由 core 統一檢查負責。
//   node --import ../../core/tools/register.mjs tools/verify.mjs
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createProject } from '../web/js/project.js';
import { linPose, CYCLES } from '../web/js/sequence.js';
import { MACHINE, GLASS_Y, GRIP, PANEL } from '../web/js/layout.js';
import { TROUGH, CRATE } from '../web/js/machine.js';

const scene = new THREE.Scene(), project = createProject({ scene });
const { sequence: seq, robot } = project;
const failures = [], notes = {};
const tcp = () => robot.tcp.getWorldPosition(new THREE.Vector3());

// 1. 直線段：每段取 9 點，TCP 與理想直線的偏差 ≤ 2 mm
let linWorst = 0;
for (const s of seq.steps.filter(s => s.robot === 'lin')) for (let i = 1; i < 10; i++) {
  const T = s.start + s.dur * i / 10, smp = seq.sample(T); project.apply(T);
  linWorst = Math.max(linWorst, tcp().distanceTo(linPose(s, smp.e).target));
}
notes.linWorst = +linWorst.toFixed(2);
if (linWorst > 2) failures.push(`直線段偏差 ${linWorst.toFixed(2)} mm 超過 2 mm`);

// 2. 放板定位：「下降放板」結束時，TCP 在放板位 ±1 mm
for (const s of seq.steps.filter(s => s.action === '下降放板')) {
  project.apply(s.start + s.dur);
  const e = tcp().distanceTo(new THREE.Vector3(MACHINE.x, GLASS_Y, MACHINE.z));
  if (e > 1) failures.push(`放板位偏差 ${e.toFixed(2)} mm（${s.start.toFixed(1)} s）`);
}

// 3. 互鎖：拆框機任何動作期間，吸盤架最北端（TCP 往外 290 mm）必須在機台入料口（z = W/2）外 100 mm
let worstGap = Infinity;
for (let T = 0; T <= project.total; T += .1) {
  const st = project.apply(T);
  if (st.press > 1e-3 || st.pull > 1e-3 || st.scrape > 1e-3 || st.clamp > 1e-3 && st.clamp < 1 - 1e-3) {
    const gap = tcp().z - 290 - (MACHINE.z + MACHINE.W / 2);
    worstGap = Math.min(worstGap, gap);
  }
}
notes.interlockGap = Math.round(worstGap);
if (worstGap < 100) failures.push(`拆框機動作時吸盤架離入料口只有 ${Math.round(worstGap)} mm`);

// 4. 最後狀態：鋁框落在收集槽內、接線盒在料箱內、層壓板在出料棧板
project.apply(project.total);
const inside = (p, [x0, x1], [y0, y1], [z0, z1]) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p.z >= z0 && p.z <= z1;
for (let k = 0; k < CYCLES; k++) {
  const m = project.movers[k];
  for (const g of m.frames) {
    const box = new THREE.Box3().setFromObject(g);
    if (box.min.y < TROUGH.y + 10 - .5 || box.max.y > TROUGH.y + TROUGH.h + 40) failures.push(`${g.name} 沒有落在收集槽內（y ${box.min.y.toFixed(0)}～${box.max.y.toFixed(0)}）`);
  }
  const jb = new THREE.Box3().setFromObject(m.jbox), [cw, , cd] = CRATE.size;
  if (!inside(jb.getCenter(new THREE.Vector3()), [CRATE.x - cw / 2, CRATE.x + cw / 2], [CRATE.y, CRATE.y + CRATE.size[1]], [CRATE.z - cd / 2, CRATE.z + cd / 2])) failures.push(`第 ${k + 1} 片接線盒不在料箱內`);
  if (seq.sample(project.total).state['lam' + k] !== 'out') failures.push(`第 ${k + 1} 片層壓板最後不在出料棧板`);
}

// 5. 節拍與負載
if (project.cycleTime > 60) failures.push(`節拍 ${project.cycleTime.toFixed(1)} s 超過 60 s`);
notes.payloadKg = PANEL.kg + GRIP.kg;

const result = { ok: !failures.length, total: +project.total.toFixed(2), cycle: +project.cycleTime.toFixed(2), notes, failures };
mkdirSync(new URL('../review/', import.meta.url), { recursive: true });
writeFileSync(new URL('../review/verification.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
