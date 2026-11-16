// 外觀回歸：驗證三方案切面、完整槽體透視與工藝效果，避免將純 Node 結果當成瀏覽器驗收。
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createProject } from '../web/js/project.js';
import { FIELD, PROCESS, TANK, TOOLS, THZ } from '../web/js/spec.js';
import { depthTime, THZ_TIMES, seamVerdicts, drawThz } from '../web/js/thz-view.js';

// 只驗證畫布輸出的資料與快取契約；此記錄器不是瀏覽器，也不驗證字形或排版。
function checkThzCanvas(p, check) {
  const create = document.createElement, texts = [];
  let paints = 0;
  const canvas = () => {
    const context = new Proxy({
      fillText(text, x, y) { texts.push({ text: String(text), x, y, font: this.font }); },
      fillRect() { paints++; },
      createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    }, { get: (target, key) => target[key] ?? (() => {}) });
    return { getContext: () => context, width: 0, height: 0 };
  };
  document.createElement = tag => tag === 'canvas' ? canvas() : create.call(document, tag);
  try {
    const ctx = canvas().getContext('2d'), z = p.thzAt(p.total);
    drawThz(ctx, 320, 221, z, p.seams);
    const count = paints;
    check(texts.some(t => t.text === 'ps') && texts.some(t => t.text === 'mm'), 'THz 時間與深度刻度都有單位');
    check(texts.some(t => t.text === '橙：正回波') && texts.some(t => t.text === '藍：負回波'), 'THz 正負回波圖例');
    check(texts.every(t => t.y <= 221 && t.x >= 0 && t.x < 320), '320 px 畫布文字基準點在範圍內');
    check(texts.every(t => Number(t.font.match(/([\d.]+)px/)[1]) >= 9.5), '320 px 畫布最小字級 9.5 px');
    drawThz(ctx, 320, 221, z, p.seams);
    check(paints === count, 'THz 相同狀態只複製快取畫布，不重畫波形');
    const step = p.timeline.tracks.repair.steps.find(s => s.dur > 0 && s.end.r === 1);
    drawThz(ctx, 320, 221, p.thzAt(step.start - .01), p.seams);
    check(paints > count && texts.some(t => t.text === 'NG 氣孔'), '倒序回到補修前會更新 NG 波形');
  } finally { document.createElement = create; }
}

const results = [];
for (const plan of ['roll', 'dual', 'turntable', 'cobot']) {
  const scene = new THREE.Scene(), p = createProject({ scene, plan }), SEAMS = p.seams;
  let checks = 0;
  const check = (condition, label) => { assert.ok(condition, `${plan}: ${label}`); checks++; };
  check(Object.keys(p.tools).length === TOOLS.length, '工具數與 TOOLS 一致');
  const shell = scene.getObjectByName('shell'), liner = scene.getObjectByName('liner');
  check(shell.material.clippingPlanes === liner.material.clippingPlanes, '拉絲材質仍共用切面');
  check(p.tank.seams.C1.layers.path.material === p.tank.seams.C2.layers.path.material, '焊道共用材質');
  check(p.tank.seams.C1.layers.path.userData.fx, '規劃線為虛擬效果');
  check(!!scene.getObjectByName('chip-collector'), '每個方案都有獨立集屑機');
  // 2026-11-11 客戶反饋：CNC 刀頭（全罩毛刷吸屑）、工序 4 的 5 kgf 下壓、UV 線雷射、焊條切刀、NG 通知人員接手
  const groove = p.tools.groove.root, rod = p.tools.rod.root;
  check(!!groove.getObjectByName('cnc-spindle') && !!groove.getObjectByName('v-cutter'), 'CNC 主軸＋V 形銑刀');
  check(!!groove.getObjectByName('chip-suction-shroud'), 'CNC 刀頭全罩吸屑');
  check(!!rod.getObjectByName('press-5kgf') && !!rod.getObjectByName('uv-line-laser') && !!rod.getObjectByName('rod-cutter'), '焊條焊槍有下壓氣缸、UV 線雷射、焊條切刀');
  {
    const tr = p.timeline.tracks, cut = tr.tool.steps.find(s => s.end.cut === 1 && s.initial.cut === 0), ng = tr.tool.steps.find(s => s.end.ng === 1 && s.initial.ng === 0);
    check(!!ng && !!cut && cut.start >= ng.start, '工序 4：UV 判 NG 後切斷焊條');
    p.apply(cut.start + cut.dur); scene.updateMatrixWorld(true);
    check(!rod.getObjectByName('pfa-rod').visible, '切斷後焊條不顯示');
    const man = tr['seam-C1'].steps.find(s => s.dur > 0 && s.end.r < s.initial.r);
    check(!!man, '人員刨除不良段（焊條進度倒退）');
    p.apply(man.start + man.dur / 2); scene.updateMatrixWorld(true);
    check(p.cells[0].worker.visible, '人員處理時顯示人員');
    check(tr.alarm.sample(man.start + man.dur / 2).a === 1, '人員處理時維持 NG 停機（紅燈）');
    p.apply(p.total);
    check(!p.cells[0].worker.visible, '結束時人員離開');
    check(tr['seam-L1'].steps.filter(s => s.dur > 0 && s.end.v === 1 && s.initial.v < 1).length === 1, '開 V 槽後回程吸屑一趟');
  }
  if (p.dual) {
    check(p.cells.length === 2 && !!scene.getObjectByName('shuttle-rail'), '雙工位：兩線＋穿梭軌道');
    check(p.timeline.tracks.shuttle.steps.some(s => s.dur > 0), '雙工位：工具架有穿梭');
    check(p.timeline.events.some(e => e.action.includes('等待')), '雙工位：互鎖等待標在事件列');
    const L2 = p.timeline.tracks['L2:seam-C1'];
    if (p.handoff === 'rod') check(L2.steps[0].dur === 0 && L2.steps[0].end.g === 1 && !L2.steps.some(s => s.dur > 0 && s.end.g === 1 && s.initial.g < 1), '第 2 線：開 V 槽由人員完成，自動線不再開槽');
  }
  for (const key of ['groove', 'flat']) {
    const shroud = p.tools[key].root.getObjectByName('chip-suction-shroud');
    check(!!shroud && !shroud.userData.fx, `${key} 吸屑罩為實體，接受間隙檢查`);
    check(!!shroud.getObjectByName('chip-suction-tool'), `${key} 吸屑管隨工具移動`);
  }
  for (const key of ['rod', 'belt']) {
    const slot = scene.getObjectByName('rack-slot-' + key);
    check(!!slot.getObjectByName('parked-gun-heat-shield'), `${key} 停放格隔熱槽`);
    check(!!slot.getObjectByName('standby-air'), `${key} 待機送風管`);
  }
  const patch = scene.getObjectByName('repair-patch');
  check(patch.userData.fx && patch.material.isMeshPhysicalMaterial && patch.material.roughness < .4, '補修焊帶保持光澤，效果不當成實體厚度');
  const repairStep = p.timeline.tracks.repair.steps.find(s => s.dur > 0 && s.end.r === 1);
  const repairTime = repairStep.start + repairStep.dur / 2;
  p.apply(repairTime);
  const patchColor = patch.material.color.getHex(), range = patch.geometry.drawRange.count;
  check(scene.getObjectByName('thz-defect').material.color.getHex() === 0xffb020, '人員補修中保留橘圈');
  check(p.cells[0].worker.visible, '人員補修時顯示人員');
  p.apply(p.total);
  check(scene.getObjectByName('thz-defect').material.color.getHex() === 0x3dd68c, '複檢後保留綠圈');
  check(patch.material.color.getHex() !== patchColor, '焊帶由暖色冷卻為乳白');
  check(seamVerdicts(p.thzAt(p.total), SEAMS).every(v => v.text.includes('OK')), '複檢後所有焊道 OK');
  p.apply(repairTime);
  check(patch.material.color.getHex() === patchColor && patch.geometry.drawRange.count === range, '補焊顏色與範圍倒序可重現');
  check(Math.abs(depthTime(0) - THZ_TIMES.surface) < 1e-10, 'B-scan 零深度對齊表面回波');
  check(Math.abs(depthTime(THZ.layers.belt + THZ.layers.ptfe) - THZ_TIMES.glue) < 1e-10, 'B-scan 覆蓋深度對齊膠層回波');
  check(Math.abs(depthTime(THZ.layers.belt + THZ.layers.ptfe + THZ.layers.glue) - THZ_TIMES.sus) < 1e-10, 'B-scan 膠層依其折射率對齊 SUS 回波');
  checkThzCanvas(p, check);
  const clampStep = p.timeline.tracks.load.steps.find(s => s.dur > 0 && s.end.clamp === 1);
  p.apply(clampStep.start + clampStep.dur); scene.updateMatrixWorld(true);
  if (plan === 'roll' || plan === 'dual') {
    scene.traverse(m => {
      if (m.name !== 'clamp-screw-extension') return;
      const pad = m.parent.children.find(o => o.name === 'clamp-pad');
      const tip = new THREE.Vector3(0, -.5, 0).applyMatrix4(m.matrixWorld);
      const contact = new THREE.Vector3(0, 6, 0).applyMatrix4(pad.matrixWorld);
      check(tip.distanceTo(contact) < .001, 'A 案螺桿延伸段接到壓墊，沒有懸空');
    });
  } else if (plan === 'turntable') {
    scene.traverse(m => {
      if (m.name !== 'locator-clamp-pad') return;
      m.geometry.computeBoundingBox();
      check(Math.abs(Math.abs(m.position.x) - m.geometry.boundingBox.max.x - TANK.legs.plate / 2) < .001, 'B 案夾持墊接觸桶腳板側面');
    });
  } else {
    const shoes = []; scene.traverse(m => { if (m.name === 'leveling-foot-shoe') shoes.push(m); });
    for (const shoe of shoes) check(Math.abs(new THREE.Box3().setFromObject(shoe).min.y) < .001, 'C 案定位腳鞋板夾緊後貼地');
    p.apply(p.total); scene.updateMatrixWorld(true);
    for (const shoe of shoes) check(new THREE.Box3().setFromObject(shoe).min.y > 50, 'C 案退場前鞋板收起');
  }

  for (const time of [0, p.total * .2, p.total * .6, p.total]) {
    p.setLook('cut'); p.apply(time); scene.updateMatrixWorld(true);
    const faces = scene.getObjectByName('cut-faces');
    check(faces.visible && faces.children.length === 6, '三層兩側剖切封面');
    const plane = p.plan.cut.clone().applyMatrix4(p.tank.frame.matrixWorld), v = new THREE.Vector3();
    for (const mesh of faces.children) {
      const position = mesh.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        check(Math.abs(plane.distanceToPoint(v)) < .001, '封面隨上料及切面，不隨槽體自轉');
      }
    }
    check(shell.material.clippingPlanes[0].equals(liner.material.clippingPlanes[0]), '內外殼使用相同世界切面');
    p.setLook('xray'); p.apply(time);
    check(!faces.visible && shell.material.transparent && !shell.material.depthWrite, '透視為完整槽體');
    check(shell.material.clippingPlanes[0].constant === 1e6, '透視關閉剖切');
    p.setLook('solid'); p.apply(time);
    check(!shell.material.transparent && shell.material.opacity === 1 && shell.material.depthWrite, '實體模式還原材質');
  }

  for (const process of PROCESS) for (const seam of SEAMS) {
    const step = p.timeline.tracks['seam-' + seam.id].steps.find(s => s.dur > 0 && s.end[FIELD[process.key]] === 1);
    const time = step.start + step.dur * .5;
    const state = p.apply(time); scene.updateMatrixWorld(true);
    const hot = p.tank.seams[seam.id].hot;
    check(hot.visible === !!process.hot, `${process.key} 熱區只在熱風工序開啟`);
    if (hot.visible) check(hot.userData.fx && hot.geometry.drawRange.count > 0, '熱區有範圍且不當成實體');
    check(state.tool.held === process.tool, '維持既有工具選擇');
    const mesh = p.tools[process.tool].root.getObjectByName(process.tool === 'rod' ? 'rod-spool' : process.tool === 'belt' ? 'tape-reel' : 'tool-coupling');
    const rotation = mesh.quaternion.toArray();
    p.apply(p.total); p.apply(time);
    check(mesh.quaternion.toArray().every((x, i) => x === rotation[i]), '跳播恢復工具旋轉');
  }
  p.apply(p.total);
  check(scene.getObjectByName('thz-defect').visible, '保留上環縫模擬缺陷紅圈');
  for (const seam of SEAMS) check(p.tank.seams[seam.id].layers.ok.geometry.attributes.color != null, 'THz 色帶');
  const bolts = scene.getObjectByName('manway-bolts'), matrix = new THREE.Matrix4(), pos = new THREE.Vector3();
  check(bolts.isInstancedMesh && bolts.count === 16, '法蘭螺栓單次實例繪製');
  for (let i = 0; i < bolts.count; i++) {
    bolts.getMatrixAt(i, matrix); pos.setFromMatrixPosition(matrix);
    check(Math.abs(Math.hypot(pos.x, pos.z) - (TANK.manway.flangeR - 26)) < .001, '螺栓實例維持節圓');
  }
  results.push({ plan, checks, ok: true });
}
const result = { ok: true, scope: 'Node geometry and state checks; browser rendering and hardware not validated', results };
writeFileSync(new URL('../review/details-verification.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
