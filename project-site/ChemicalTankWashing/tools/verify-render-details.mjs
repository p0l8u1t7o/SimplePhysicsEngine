// 補強實例的完整場景回歸：core 的一般 scene 檢查不列入 InstancedMesh，
// 因此只把本次標記 renderDetail 的實例展開成普通 Mesh，再沿完整動畫檢查。
// 完整檢查（check.mjs）會跑；單獨執行時在庫根目錄、經 cpu-cap：
// node --import ./core/tools/register.mjs project-site/ChemicalTankWashing/tools/verify-render-details.mjs
import '../../../core/verify/dom-stub.mjs';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createProject } from '../web/js/project.js';
import { verifyScene } from '../../../core/verify/scene.mjs';

const scene = new THREE.Scene(), project = createProject({ scene });
const instances = [], counts = { meshObjects: 0, instancedObjects: 0, drawnInstances: 0, expandedDetailParts: 0 };
scene.traverse(o => {
  if (!o.isMesh) return;
  counts.meshObjects++;
  if (o.isInstancedMesh) {
    counts.instancedObjects++; counts.drawnInstances += o.count;
    if (o.userData.renderDetail) instances.push(o);
  }
});
assert(instances.length > 0, '未找到補強實例，不能把空檢查當成通過');
for (const inst of instances) {
  const group = new THREE.Group(); group.name = inst.name;
  group.position.copy(inst.position); group.quaternion.copy(inst.quaternion); group.scale.copy(inst.scale);
  Object.assign(group.userData, inst.userData);
  for (let i = 0; i < inst.count; i++) {
    const mesh = new THREE.Mesh(inst.geometry, inst.material); inst.getMatrixAt(i, mesh.matrix);
    assert(mesh.matrix.elements.every(Number.isFinite), `${inst.name}[${i}] 矩陣不是有限數值`);
    mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.name = `${inst.name} [${i}]`; group.add(mesh); counts.expandedDetailParts++;
  }
  inst.parent.add(group); inst.removeFromParent();
}
const result = verifyScene(project, scene);
const report = { ...counts, ...result, note: '僅展開本站新增實例；既有倉儲桶與其他 core 實例仍沿用原站驗證範圍。不修改 allow、skip 或門檻。' };
const out = new URL('../review/render-details-verification.json', import.meta.url);
mkdirSync(new URL('.', out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: result.ok, ...counts, verifiedMeshes: result.meshes, dynamic: result.dynamic.length, static: result.static.length, zfight: result.zfight.length }));
if (!result.ok) console.log(JSON.stringify({ dynamic: result.dynamic, static: result.static, zfight: result.zfight }, null, 2));
process.exitCode = result.ok ? 0 : 1;
