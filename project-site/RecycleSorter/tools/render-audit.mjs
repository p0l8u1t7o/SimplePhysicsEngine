// 無瀏覽器回歸：比對狀態、原有動件與配置，估算可見幾何及材質群組繪製批次。
import '../../../core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { createProject } from '../web/js/project.js';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyScene } from '../../../core/verify/scene.mjs';

const scene = new THREE.Scene(), project = createProject({ scene });
const hash = createHash('sha256');
let triangles = 0, calls = 0;
const clean = value => JSON.stringify(value, (key, val) => {
  if (['grp', 'ref', 'job'].includes(key)) return undefined;
  return typeof val === 'function' ? undefined : val;
});
for (let i = 0; i <= 960; i++) {
  const state = project.apply(i / 10);
  scene.updateMatrixWorld(true);
  hash.update(clean(state));
  hash.update(clean(project.items.map(it => [it.grp.name, it.grp.visible, it.grp.matrixWorld.elements])));
  project.arm.root.traverse(o => hash.update(clean([o.name, o.matrixWorld.elements])));
  let tri = 0, draw = 0;
  scene.traverseVisible(o => {
    if (!o.isMesh) return;
    const g = o.geometry, instances = o.isInstancedMesh ? o.count : 1;
    tri += (g.index ? g.index.count : g.attributes.position.count) / 3 * instances;
    draw += Array.isArray(o.material) ? g.groups.length : 1;
  });
  triangles = Math.max(triangles, tri); calls = Math.max(calls, draw);
}
const result = { total: project.total, motion: hash.digest('hex'), layout: project.layoutChecks(), triangles, calls };
const baselinePath = new URL('../review/render-baseline.json', import.meta.url);
if (process.argv.includes('--baseline')) writeFileSync(baselinePath, JSON.stringify(result, null, 2));
else {
  const base = JSON.parse(readFileSync(baselinePath));
  result.motionUnchanged = result.motion === base.motion;
  result.layoutUnchanged = clean(result.layout) === clean(base.layout);
  result.triangleRatio = triangles / base.triangles;
  result.callRatio = calls / base.calls;
  // core 的一般檢查略過 InstancedMesh；展開本輪新增批次，以相同幾何與矩陣補驗。
  const batches = []; scene.traverse(o => { if (o.isInstancedMesh && o.userData.detailBatch) batches.push(o); });
  for (const batch of batches) {
    for (let i = 0; i < batch.count; i++) {
      const mesh = new THREE.Mesh(batch.geometry, batch.material), matrix = new THREE.Matrix4();
      batch.getMatrixAt(i, matrix); matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      batch.parent.add(mesh);
    }
    batch.removeFromParent();
  }
  const expanded = verifyScene(project, scene);
  result.expandedScene = { ok: expanded.ok, dynamic: expanded.dynamic, static: expanded.static, zfight: expanded.zfight };
  result.ok = result.motionUnchanged && result.layoutUnchanged && result.total === base.total && result.triangleRatio <= 1.5 && result.callRatio <= 1.3;
  result.ok &&= expanded.ok;
  writeFileSync(new URL('../review/render-audit.json', import.meta.url), JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
console.log(JSON.stringify({
  ok: result.ok ?? true, total: result.total,
  motionUnchanged: result.motionUnchanged, layoutUnchanged: result.layoutUnchanged,
  triangles: result.triangles, calls: result.calls,
  triangleRatio: result.triangleRatio, callRatio: result.callRatio,
  expandedScene: result.expandedScene,
}));
