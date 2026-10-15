// 本專案自有檢查：製程規則（四個量測方案 × 兩種工件）。通用的干涉、閃爍、倒序一致由 core 統一檢查負責。
//   node --import ../../core/tools/register.mjs tools/verify.mjs
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createProject } from '../web/js/project.js';
import { RATE, BOX, LAYOUT, slot, capacity } from '../web/js/spec.js';
import { QB } from '../web/js/qc-box.js';

const failures = [], rows = [];
const W = o => o.getWorldPosition(new THREE.Vector3());
for (const plan of ['box-laser', 'box-vision', 'piece-laser', 'piece-vision']) for (const partKey of ['stator', 'rotor']) {
  const scene = new THREE.Scene(), p = createProject({ scene, plan, part: partKey }), part = p.part, tag = `${plan}/${partKey}`;
  const fail = m => failures.push(`${tag}：${m}`);
  // 1. 下料：每顆取放 ≤ 沖壓節拍；放下那一刻吸住的工件中心＝鐵盒格位上方 1 mm（±0.1 mm）
  const un = p.unloader, U = LAYOUT.unloader;
  let maxErr = 0;
  for (let n = 1; n < 12; n++) {
    // 放下前一刻（release 標記前 0.02 s）
    const t = .5 + n * RATE.cycle + 1.30 + .04;
    p.apply(t); scene.updateMatrixWorld(true);
    if (!un.tool.carried.visible) { fail(`第 ${n} 顆放下時吸盤沒有吸住工件`); continue; }
    // 放下那一刻：水平位置＝格位，離盒底 1 mm（吸盤浮動、離底釋放）
    const s = slot(part, capacity(part) - 12 + n), want = new THREE.Vector3(U.slots[U.fill] + s.x, U.conveyor.top + BOX.bottom + 1, U.conveyor.z + s.z);
    maxErr = Math.max(maxErr, W(un.tool.carried).distanceTo(want));
  }
  if (maxErr > .1) fail(`下料放置誤差 ${maxErr.toFixed(2)} mm`);
  // 1b. 整列單元：手臂取料點＝定位座中心
  const pk = p.press.pickPoint(0);
  if (Math.abs(pk.z - p.press.aligner.pickZ) > .01) fail('取料點不在定位座中心');
  // 2. 量測產能 ≥ 沖壓產出
  const rate = 60 / (p.cycleQc / p.cap);
  if (rate < RATE.perMin) fail(`量測產能 ${rate.toFixed(1)} 顆／分 < ${RATE.perMin}`);
  // 3. 整盒：基準板壓下時接觸面＝工件頂面；翻轉後基準板座框架落在定位墊上（905 mm）
  if (p.plan.mode === 'box') {
    const tl = p.timeline, fl = tl.tracks.flip.steps, st = p.station;
    const down = fl.find(s => /下降/.test(s.action) && s.end.pl === 0);
    p.apply(down.start + down.dur + .01); scene.updateMatrixWorld(true);
    const face = W(st.holder).y, top = QB.nest.top + BOX.bottom + part.h;
    if (Math.abs(face - top) > .5) fail(`基準板接觸面 ${face.toFixed(2)} ≠ 工件頂面 ${top.toFixed(2)}`);
    const land = fl.find(s => /解鎖/.test(s.action));
    p.apply(land.start + land.dur + .01); scene.updateMatrixWorld(true);
    const frameBottom = W(st.holder).y - 108;
    if (Math.abs(frameBottom - 905) > .5) fail(`基準板座框架底 ${frameBottom.toFixed(2)} mm，應落在 905 mm 定位墊上`);
  }
  // 4. 結束時：NG 全部在不良品盒，放行的盒子只剩良品
  p.apply(p.total); scene.updateMatrixWorld(true);
  const bin = p.station.binParts.filter(m => m.visible).length;
  if (bin !== p.ngs.length) fail(`不良品盒 ${bin} 顆，應為 ${p.ngs.length}`);
  rows.push({ plan, part: partKey, total: +p.total.toFixed(1), qcPerBox: +(p.cycleQc / 60).toFixed(2), rate: +rate.toFixed(1), ng: p.ngs.length, placeErr: +maxErr.toFixed(3) });
}

const result = { ok: !failures.length, rows, failures };
mkdirSync(new URL('../review/', import.meta.url), { recursive: true });
writeFileSync(new URL('../review/verification.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
