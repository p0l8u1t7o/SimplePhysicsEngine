// 第二段外觀回歸：保留製程指紋、配置、相機，並展開實例幾何檢查干涉。
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fingerprint } from '@core/verify/fingerprint.mjs';
import { compareFingerprints } from '@core/verify/fingerprint-compare.mjs';
import { verifyScene } from '@core/verify/scene.mjs';
import { createProject } from '../web/js/project.js';
import { ELECTRICAL_SPEC } from '../web/js/electrical-spec.js';
const scene = new THREE.Scene(), p = createProject({ scene });
const data = { fingerprint: fingerprint(p, scene), layout: p.layoutChecks(), spec: ELECTRICAL_SPEC,
  cameras: p.visionCameras.map(c => ({ position: c.root.position.toArray(), rotation: c.root.rotation.toArray(), params: c.params })), triangles: 0, calls: 0 };
for (let i = 0; i <= 96; i++) {
  p.apply(i); let triangles = 0, calls = 0;
  scene.traverseVisible(o => { if (!o.isMesh) return;
    triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
    calls += Array.isArray(o.material) ? o.geometry.groups.length : 1;
  });
  data.triangles = Math.max(data.triangles, triangles); data.calls = Math.max(data.calls, calls);
}
const basePath = new URL('../review/render-b-baseline.json', import.meta.url);
const materials=new Set(),textures=new Set();
scene.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material]) {
  materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value);
}});
if (process.argv.includes('--baseline')) { writeFileSync(basePath, JSON.stringify(data)); console.log(JSON.stringify({ triangles: data.triangles, calls: data.calls })); }
else {
  const base = JSON.parse(readFileSync(basePath));
  const result = compareFingerprints(base.fingerprint, data.fingerprint);
  assert.deepEqual(data.layout, base.layout); assert.deepEqual(data.spec, base.spec); assert.deepEqual(data.cameras, base.cameras);
  const batches = []; scene.traverse(o => { if (o.isInstancedMesh && o.userData.detailBatch) batches.push(o); });
  for (const batch of batches) {
    for (let i = 0; i < batch.count; i++) {
      const mesh = new THREE.Mesh(batch.geometry, batch.material), matrix = new THREE.Matrix4();
      batch.getMatrixAt(i, matrix); matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.name = batch.name; mesh.userData = { ...batch.userData }; batch.parent.add(mesh);
    }
    batch.removeFromParent();
  }
  const expanded = verifyScene(p, scene);
  Object.assign(result, { layoutUnchanged: true, camerasUnchanged: true, specUnchanged: true,
    sceneTextures:textures.size,sceneMaterials:materials.size,
    triangles: data.triangles, calls: data.calls, triangleRatio: data.triangles / base.triangles, callRatio: data.calls / base.calls,
    expandedScene: { ok: expanded.ok, dynamic: expanded.dynamic, static: expanded.static, zfight: expanded.zfight } });
  result.ok &&= result.triangleRatio <= 1.5 && result.callRatio <= 1.3 && expanded.ok;
  writeFileSync(new URL('../review/render-b-audit.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 1;
}
