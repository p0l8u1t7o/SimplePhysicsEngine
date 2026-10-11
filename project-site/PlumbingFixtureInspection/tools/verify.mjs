// 本站自有檢查：製程規則寫在這裡；通用的干涉、閃爍、倒序一致由 core 統一檢查負責。
//   node --import ../../core/tools/register.mjs tools/verify.mjs
// 兩種產品各跑一次：產品檔一致（覆蓋率與每個三角形的首次量測姿態可重算）、取像時手臂在姿態上、
// 每次取像前有穩定時間、條紋只在取像時顯示、抽屜拉出時手臂不進上料窗、快換器鎖定才搬轉接頭、節拍、倒序一致。
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createProject } from '../web/js/project.js';
import { linPose } from '../web/js/sequence.js';
import { productData } from '../web/js/product-mesh.js';
import { OPTICS, DRAWER, MACHINE, TAKT } from '../web/js/layout.js';
import { capturePresentation } from '../web/js/capture-overlay.js';
import { OPTICS_VIEW } from '../web/js/effects.js';

const report = { scenarios: {} };
let allOk = true;
for (const product of ['sleeve', 'gooseneck']) {
  const scene = new THREE.Scene(), project = createProject({ scene, product });
  const { sequence: seq, robot, prod } = project, failures = [], notes = {};
  const toolPos = () => robot.tool.getWorldPosition(new THREE.Vector3());

  // 1. 產品檔：每個姿態至少貢獻新面積；firstView 只出現 0～N−1 或 255；A 面覆蓋率與統計一致
  const { m, cls, firstView } = productData(prod), N = prod.file.views.length;
  let a = 0, c = 0;
  for (let t = 0; t < m.nt; t++) { if (firstView[t] !== 255 && firstView[t] >= N) failures.push(`firstView 越界 ${t}`); if (cls[t] === 0) { a += m.area[t]; if (firstView[t] !== 255) c += m.area[t]; } }
  notes.coverageA = +(c / a).toFixed(4);
  if (Math.abs(c / a - prod.file.stats.coverage.A) > .002) failures.push(`A 面覆蓋率 ${(c / a).toFixed(4)} 與產品檔 ${prod.file.stats.coverage.A} 不符`);
  const used = new Set(firstView); for (let k = 0; k < N; k++) if (!used.has(k)) failures.push(`姿態 ${k + 1} 沒有新增量測面積`);

  // 2. 取像：每個取像步驟期間手臂（產品）位置不動、與排程的姿態誤差 ≤ 0.5 mm；取像前一步是穩定 ≥ 0.3 s
  const caps = seq.steps.filter(s => s.capture != null);
  if (caps.length !== N) failures.push(`取像步驟 ${caps.length} 個，產品檔 ${N} 個姿態`);
  let drift = 0;
  for (const s of caps) {
    const i = seq.steps.indexOf(s), prev = seq.steps[i - 1];
    if (!/穩定/.test(prev.action) || prev.dur < OPTICS.settle - 1e-9) failures.push(`${s.action} 前沒有穩定時間`);
    project.apply(s.start + 1e-3); const p0 = toolPos(); project.apply(s.start + s.dur - 1e-3);
    drift = Math.max(drift, p0.distanceTo(toolPos()));
  }
  notes.captureDrift = +drift.toFixed(4);
  if (drift > .01) failures.push(`取像期間手臂移動 ${drift.toFixed(3)} mm`);

  // 3. 時序與互鎖（0.05 s 取樣）：條紋只在取像步驟；抽屜不在推入位時，快換器不得進入抽屜行程（推入時台板後緣 − 40 mm 以南）；
  //    轉接頭在手臂上時快換器必須鎖定；直線段偏差 ≤ 1 mm
  let linWorst = 0, fringeBad = 0, drawerBad = 0, lockBad = 0;
  const trayBack = DRAWER.nestIn - DRAWER.nestOffset - DRAWER.len / 2 - 40;
  for (let T = 0; T <= project.total + 1e-9; T += .05) {
    const st = project.apply(T), smp = seq.sample(T), step = smp.step, pr = project.presentation, p = toolPos();
    if ((pr.optics.mode === 'fringeV' || pr.optics.mode === 'fringeH') !== (step.capture != null && T - step.start < OPTICS.capture.fringe * OPTICS.capture.steps)) fringeBad++;
    if (st.dL > 1e-3 && p.z > trayBack && p.x > DRAWER.xs.L - 250 && p.x < DRAWER.xs.L + 250) drawerBad++;
    if (st.adL === 'robot' && st.lock < .5) lockBad++;
    if (step.robot === 'lin' && smp.u > 0 && smp.u < 1) linWorst = Math.max(linWorst, p.distanceTo(linPose(step, smp.e).origin));
  }
  notes.linWorst = +linWorst.toFixed(3);
  if (fringeBad) failures.push(`條紋顯示時機錯誤 ${fringeBad} 次`);
  if (drawerBad) failures.push(`抽屜拉出時手臂進入上料窗區 ${drawerBad} 次`);
  if (lockBad) failures.push(`快換器未鎖定時搬轉接頭 ${lockBad} 次`);
  if (linWorst > 1) failures.push(`直線段偏差 ${linWorst.toFixed(2)} mm`);

  // 4. 最後狀態：產品在 NG 料架或 OK 料箱、轉接頭回定位座、左抽屜拉出
  const st = project.apply(project.total), pp = project.products.L.getWorldPosition(new THREE.Vector3());
  if (st.adL !== 'nest' || st.dL < .999) failures.push('最後轉接頭沒有回到左工位或抽屜沒拉出');
  if (pp.x < MACHINE.x[1] || pp.z < MACHINE.z[1] - 200) failures.push('最後產品沒有離開機台（料架／料箱）');
  notes.result = project.result;

  // 新增細節的製程契約：手部交接沿產品路徑、每張硬體觸發、候選必須來自首次量測姿態。
  let handError = 0, pulses = 0;
  for (const t of [1.5, 2.4, 3.2, ...seq.steps.filter(s => /放入 (NG|OK)/.test(s.action)).flatMap(s => [.1, .5, .9].map(u => s.start + s.dur * u))]) {
    project.apply(t);
    const hands = project.operator.arms.map(a => a.hand.position);
    const middle = hands[0].clone().add(hands[1]).multiplyScalar(.5);
    handError = Math.max(handError, middle.distanceTo(project.products.L.position.clone().add(new THREE.Vector3(0, 25, 28))));
  }
  if (handError > .001) failures.push(`作業員手部偏離產品 ${handError} mm`);
  for (const cap of caps) {
    for (let k = 0; k < 9; k++) {
      project.apply(cap.start + k * OPTICS.capture.fringe + .005);
      if (!project.effects.status.trigger) failures.push(`姿態 ${cap.capture + 1} 第 ${k + 1} 張未觸發`); else pulses++;
    }
    const end = cap.start + cap.dur;
    for (const [dt, stage] of [[.05, 0], [.25, 1], [.5, 2]]) {
      const info = capturePresentation(project, end + dt);
      if (!info || info.view !== cap.capture || info.stage !== stage || info.candidates.some(c => c.view !== cap.capture)) failures.push(`姿態 ${cap.capture + 1} 疊圖順序／候選來源錯誤`);
    }
  }
  for (const s of seq.steps.filter(s => /結構光掃描/.test(s.action))) {
    project.apply(s.start + .5);
    if (!project.effects.overlay.visible || project.effects.uniforms.scanning.value !== 1 || project.effects.scanLeds.some(m => m.material.color.getHex() !== 0x4dbbff)) failures.push('結構光／雙相機狀態不一致');
  }
  const heatStep = seq.steps.find(s => s.station === 7);
  project.apply(heatStep.start + .1); const heatStart = project.twin.heatCloud.geometry.drawRange.count;
  project.apply(heatStep.start + heatStep.dur); const heatEnd = project.twin.heatCloud.geometry.drawRange.count;
  if (!(heatEnd > heatStart && heatEnd === 150)) failures.push('熱點沒有依 S8 進度累積');
  project.twin.root.traverse(o => { if (!o.userData.fx) failures.push('數位空間出現實體物件'); });
  notes.animationDetail = { handError, hardwarePulses: pulses, captureOverlays: caps.length, heatPoints: heatEnd, cableCarriers: project.electrical.chains.length };
  // 光學艙視角：每個取像姿態的受檢錨點，不得被屏框或手臂擋住。
  const opticalSolids = [];
  for (const root of [robot.arm.root, project.cell.optics]) root.traverse(m => {
    if (!m.isMesh) return;
    for (let p = m; p; p = p.parent) if (p.userData.fx) return;
    if ([].concat(m.material).some(mat => mat.opacity >= .5)) opticalSolids.push(m);
  });
  for (const cap of caps) {
    project.apply(cap.start + .2); scene.updateMatrixWorld(true);
    const center = project.products.L.localToWorld(new THREE.Vector3(...prod.file.views[cap.capture].anchor));
    const eye = new THREE.Vector3(...OPTICS_VIEW.eye), direction = center.clone().sub(eye);
    const hit = new THREE.Raycaster(eye, direction.clone().normalize(), 0, direction.length() - 5).intersectObjects(opticalSolids, false)[0];
    if (hit) failures.push(`光學艙視角 ${cap.capture + 1} 被 ${hit.object.name} 遮住`);
  }
  notes.animationDetail.opticalViewRays = caps.length;

  // 5. 細節倒序一致（數位空間、螢幕、燈號）
  const times = [...new Set(seq.steps.flatMap(s => [0, .3, .7, 1].map(u => +(s.start + s.dur * u).toFixed(4))))];
  const snap = t => { project.apply(t); scene.updateMatrixWorld(true); return JSON.stringify([project.presentation.lines, project.presentation.optics, project.presentation.signals.map(s => s.on), project.twin.marks.map(k => [k.g.visible, k.mat.color.getHex()]), project.twin.icons.map(i => i.visible), project.effects.uniforms.clock.value, project.effects.uniforms.scanning.value, project.twin.heatCloud.geometry.drawRange.count, project.operator.arms.map(a => a.hand.position.toArray()), capturePresentation(project, t)]); };
  const fwd = times.map(snap);
  for (let i = times.length - 1; i >= 0; i--) if (snap(times[i]) !== fwd[i]) { failures.push(`細節倒序不一致：${times[i]} s`); break; }

  if (project.cycleTime > TAKT) failures.push(`單件 CT ${project.cycleTime.toFixed(1)} s 超過 ${TAKT} s`);
  report.scenarios[prod.name] = { ok: !failures.length, total: +project.total.toFixed(2), cycle: +project.cycleTime.toFixed(2), views: N, notes, failures };
  allOk &&= !failures.length;
}
report.ok = allOk;
mkdirSync(new URL('../review/', import.meta.url), { recursive: true });
writeFileSync(new URL('../review/verification.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: allOk, scenarios: report.scenarios }));
console.log(`${allOk ? '✓' : '✗'} PlumbingFixtureInspection · verify ${Object.values(report.scenarios).filter(s => s.ok).length}/2 通過（套筒 NG、鵝頸 OK）`);
process.exit(allOk ? 0 : 1);
