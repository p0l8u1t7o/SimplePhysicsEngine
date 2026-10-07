// 本站自有檢查：製程上的規則寫在這裡；通用的干涉、閃爍、倒序一致由 core 統一檢查負責。
//   node --import ../../core/tools/register.mjs tools/verify.mjs
// 兩個情境（正常、拆框機故障）各跑一次：直線段、放板定位、互鎖、故障時停止搬料、餘料落點、A/B 工位換料、效果時機、倒序一致。
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createProject } from '../web/js/project.js';
import { linPose, CYCLES, PLAN } from '../web/js/sequence.js';
import { MACHINE, GLASS_Y, TABLE, LOADER, SCRAP, BAYS, OUT_MAX, PANEL } from '../web/js/layout.js';
import { evaluate } from '../web/js/selection.js';

const report = { scenarios: {}, selection: evaluate().map(c => ({ model: c.model, results: c.results.map(r => ({ req: r.req, ok: r.ok, reasons: r.reasons })) })) };
let allOk = true;
for (const fault of [false, true]) {
  const scene = new THREE.Scene(), project = createProject({ scene, fault });
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
  if (linWorst > 2) failures.push(`直線段偏差 ${linWorst.toFixed(2)} mm`);

  // 2. 交接台放板定位：手臂「下降放板」結束時，TCP 在交接台放板位 ±1 mm
  for (const s of seq.steps.filter((s, i, all) => s.action === '下降放板' && s.robot && all[i + 1]?.action !== s.action)) {   // 快慢兩段取最後一段
    project.apply(s.start + s.dur);
    const e = tcp().distanceTo(new THREE.Vector3(TABLE.x, GLASS_Y, TABLE.z));
    if (e > 1) failures.push(`交接台放板偏差 ${e.toFixed(2)} mm（${s.start.toFixed(1)} s）`);
  }

  // 3. 互鎖（0.05 s 取樣）
  //   a. 拆框機有任何動作時，移載機必須在機內高位待命（不在板子上方）
  //   b. 移載機在機外（交接台區）時，手臂吸盤架與移載機吸盤框在平面上分開，或手臂在它上方 250 mm 以上
  //   c. 故障期間手臂與移載機都不動
  let gapA = Infinity, gapB = Infinity, faultMove = 0;
  let prev = null;
  for (let T = 0; T <= project.total + 1e-9; T += .05) {
    const st = project.apply(T), step = seq.sample(T).step, p = tcp();
    if (st.press > 1e-3 || st.pull > 1e-3 || st.scrape > 1e-3 || (st.clamp > 1e-3 && st.clamp < 1 - 1e-3))
      gapA = Math.min(gapA, Math.min(st.lz - (LOADER.zPark - 1), st.ly - (LOADER.yPark - 1)));
    if (st.lz - 290 > MACHINE.z + MACHINE.W / 2) {
      const plan = Math.abs(p.z - st.lz) - 290 - 290, above = p.y - (st.ly + 250);
      gapB = Math.min(gapB, Math.max(plan, above));
    }
    if (step.fault && prev) faultMove = Math.max(faultMove, p.distanceTo(prev.p), Math.abs(st.lz - prev.lz), Math.abs(st.ly - prev.ly));
    prev = { p, lz: st.lz, ly: st.ly };
  }
  notes.loaderParkedWhileStripping = gapA === Infinity ? null : +gapA.toFixed(2);
  notes.robotLoaderGap = Math.round(gapB);
  if (gapA < 0) failures.push(`拆框機動作時移載機不在待命位（差 ${(-gapA).toFixed(1)} mm）`);
  if (gapB < 50) failures.push(`手臂與移載機在交接台區的間距只有 ${Math.round(gapB)} mm`);
  if (fault) { notes.faultMove = +faultMove.toFixed(3); if (!seq.steps.some(s => s.fault)) failures.push('故障情境沒有故障步驟'); if (faultMove > .01) failures.push(`故障期間仍在搬料（移動 ${faultMove.toFixed(2)} mm）`); }

  // 4. 最後狀態：層壓板在出料工位、長邊鋁框在料車、短邊鋁框在抽屜料箱、接線盒在料箱；A 工位用完／滿、改用 B
  project.apply(project.total);
  const inside = (box, [x0, x1], [y0, y1], [z0, z1]) => box.min.x >= x0 - .5 && box.max.x <= x1 + .5 && box.min.y >= y0 - .5 && box.max.y <= y1 + .5 && box.min.z >= z0 - .5 && box.max.z <= z1 + .5;
  const st = seq.sample(project.total).state;
  for (let k = 0; k < CYCLES; k++) {
    const m = project.movers[k];
    if (st['lam' + k] !== PLAN[k].to) failures.push(`第 ${k + 1} 片層壓板最後不在 ${PLAN[k].to}`);
    m.frames.forEach((g, i) => {
      const b = new THREE.Box3().setFromObject(g);
      const ok = i < 2 ? inside(b, SCRAP.cart.x, [152, SCRAP.cart.h], SCRAP.cart.z)
        : inside(b, i === 2 ? SCRAP.bin.x : [-SCRAP.bin.x[1], -SCRAP.bin.x[0]], [SCRAP.bin.y[0] + 10, SCRAP.bin.y[1]], SCRAP.bin.z);
      if (!ok) failures.push(`${g.name} 沒有落在${i < 2 ? '長框料車' : '抽屜料箱'}內`);
    });
    if (!inside(new THREE.Box3().setFromObject(m.jbox), SCRAP.tote.x, [12, SCRAP.tote.h], SCRAP.tote.z)) failures.push(`第 ${k + 1} 片接線盒不在料箱內`);
  }
  const bays = project.presentation.bays;
  if (bays.inA.state !== 'empty' || bays.outA.state !== 'full') failures.push(`A 工位最後應為入料空／出料滿（${bays.inA.state}／${bays.outA.state}）`);
  if (bays.inB.n !== BAYS.inB.n - 1 || bays.outB.n !== 1) failures.push('第 2 片沒有改走 B 工位');
  if (bays.outA.n !== OUT_MAX) failures.push(`出料 A 最後 ${bays.outA.n} 片，應為 ${OUT_MAX}`);

  // 5. 效果時機：雷射只在「雷射測高」、吹氣只在破真空的前 0.3 s；細節零件倒序一致
  const times = [...new Set(seq.steps.flatMap(s => [0, .2, .5, .8, 1].map(u => +(s.start + s.dur * u).toFixed(4))))];
  const detail = [robot.laser, ...robot.blow.children, ...robot.dress, ...project.cell.tower.lampList, ...project.movers.flatMap(m => [m.jbox, ...m.frames])];
  const snap = t => { project.apply(t); scene.updateMatrixWorld(true); return JSON.stringify([robot.blow.visible, project.presentation.lines, project.presentation.signals.map(s => s.on), detail.map(o => [o.visible, o.matrixWorld.elements.map(v => +v.toFixed(5)), o.material?.emissiveIntensity])]); };
  const fwd = times.map(snap);
  for (let i = times.length - 1; i >= 0; i--) if (snap(times[i]) !== fwd[i]) { failures.push(`細節倒序不一致：${times[i]} s`); break; }
  for (const t of times) {
    project.apply(t); const step = seq.sample(t).step;
    if (robot.laser.visible !== (step.action === '雷射測高')) { failures.push(`雷射顯示時機錯誤：${t} s`); break; }
    const blowing = !!step.blow && t - step.start > 0 && t - step.start < .3;
    if (robot.blow.visible !== blowing) { failures.push(`吹氣顯示時機錯誤：${t} s`); break; }
  }
  notes.detailSamples = times.length;

  // 6. 節拍
  if (project.cycleTime > 60) failures.push(`節拍 ${project.cycleTime.toFixed(1)} s 超過 60 s`);
  report.scenarios[fault ? '拆框機故障' : '正常'] = { ok: !failures.length, total: +project.total.toFixed(2), cycle: +project.cycleTime.toFixed(2), notes, failures };
  allOk &&= !failures.length;
}
report.ok = allOk;
mkdirSync(new URL('../review/', import.meta.url), { recursive: true });
writeFileSync(new URL('../review/verification.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: allOk, scenarios: report.scenarios }));
process.exit(allOk ? 0 : 1);
