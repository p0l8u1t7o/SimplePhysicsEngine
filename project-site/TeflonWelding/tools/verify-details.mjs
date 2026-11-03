// 外觀回歸：驗證三方案切面、完整槽體透視與工藝效果，避免將純 Node 結果當成瀏覽器驗收。
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createProject } from '../web/js/project.js';
import { SEAMS, FIELD, PROCESS, TANK } from '../web/js/spec.js';

const results = [];
for (const plan of ['roll', 'turntable', 'cobot']) {
  const scene = new THREE.Scene(), p = createProject({ scene, plan });
  let checks = 0;
  const check = (condition, label) => { assert.ok(condition, `${plan}: ${label}`); checks++; };
  check(Object.keys(p.tools).length === 7, '保留七支工具');
  const shell = scene.getObjectByName('shell'), liner = scene.getObjectByName('liner');
  check(shell.material.clippingPlanes === liner.material.clippingPlanes, '拉絲材質仍共用切面');
  check(p.tank.seams.C1.layers.path.material === p.tank.seams.C2.layers.path.material, '焊道共用材質');
  check(p.tank.seams.C1.layers.path.userData.fx, '規劃線為虛擬效果');

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
