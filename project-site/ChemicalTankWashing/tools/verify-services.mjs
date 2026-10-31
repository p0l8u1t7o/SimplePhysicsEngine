// 由 verify-render-details 在展開實例後呼叫；獨立覆蓋廠務線槽與安全設施。
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { ROOM, DOORS, doorSwing, rectsOverlap, agvPolygons, polyRectOverlap } from '../web/js/layout.js';
import { SERVICES } from '../web/js/service-layout.js';

export function verifyServices(project, scene) {
  project.apply(0); scene.updateMatrixWorld(true);
  const checks = { wallPassRays: 0, agvSamples: 0, minAgvPlanGap: Infinity, minTrayReachGap: Infinity, doorChecks: 0 };
  for (const z of [SERVICES.pass.z0 + 20, SERVICES.northZ, SERVICES.pass.z1 - 20]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(ROOM.W - 300, SERVICES.trayY + 25, z), new THREE.Vector3(1, 0, 0), 0, 800);
    assert.equal(ray.intersectObjects(project.plant.building.group.children, true).length, 0, '服務線槽穿牆孔被實體牆遮擋');
    ray.ray.origin.y = 2400;
    assert(ray.intersectObjects(project.plant.building.group.children, true).length > 0, '服務孔與輸送口之間缺少牆帶');
    checks.wallPassRays++;
  }
  for (const { a, b } of project.plant.services.routes) {
    // 每側比槽寬多 27 mm，保守納入吊桿安裝片。
    const r = [Math.min(a[0], b[0]) - 107, Math.min(a[2], b[2]) - 107, Math.max(a[0], b[0]) + 107, Math.max(a[2], b[2]) + 107];
    const dx = Math.max(r[0] - SERVICES.robot.x, 0, SERVICES.robot.x - r[2]);
    const dz = Math.max(r[1] - SERVICES.robot.z, 0, SERVICES.robot.z - r[3]);
    const gap = Math.hypot(dx, dz) - SERVICES.robot.reach;
    assert(gap >= 40, '高架線槽／垂直支線侵入手臂名義作業半徑');
    checks.minTrayReachGap = Math.min(checks.minTrayReachGap, gap);
  }
  const obstacles = [], guideBounds = [];
  project.plant.services.root.traverse(o => {
    if (!o.isMesh || o.geometry.type === 'PlaneGeometry') return;
    assert(!o.isInstancedMesh, '新增實例未展開，不能漏驗');
    const bb = new THREE.Box3().setFromObject(o), r = [bb.min.x, bb.min.z, bb.max.x, bb.max.z];
    if (bb.min.y < 2200 && bb.max.y > 12) obstacles.push(r);
    if (o.name.startsWith('conveyor guides and sensor brackets') && bb.min.y > 600) guideBounds.push(r);
  });
  assert(guideBounds.length >= 18, '新增側導軌必須納入桶身檢查');
  for (const r of obstacles) for (const door of DOORS) {
    assert(!rectsOverlap(r, doorSwing(door)), '新設施侵入 D2／D3 內開範圍'); checks.doorChecks++;
  }
  const planGap = (a, b) => Math.hypot(Math.max(a[0] - b[2], b[0] - a[2], 0), Math.max(a[1] - b[3], b[1] - a[3], 0));
  for (let t = 0; t <= project.total; t = Math.min(t + .5, project.total)) {
    const { st } = project.apply(t);
    for (const key of ['agv', 'agv2']) {
      const a = st[key], loaded = ['palD', 'palA'].some(k => st[k].mode === 'agv' && st[k].by === key);
      for (const poly of agvPolygons(a.x, a.z, a.yaw, loaded)) {
        const bb = [Math.min(...poly.map(p => p[0])), Math.min(...poly.map(p => p[1])), Math.max(...poly.map(p => p[0])), Math.max(...poly.map(p => p[1]))];
        for (const r of obstacles) {
          assert(!polyRectOverlap(poly, r), `${t.toFixed(2)} s ${key} 侵入新設施`);
          checks.minAgvPlanGap = Math.min(checks.minAgvPlanGap, planGap(bb, r));
        }
      }
      checks.agvSamples++;
    }
    // 不修改原本的桶支撐 allow，獨立確認新增導軌與輸送桶身的淨距。
    for (const d of project.plant.drums) if (d.root.visible && d.root.position.y < 1500) for (const r of guideBounds) {
      const p = d.root.position, gap = Math.hypot(Math.max(r[0] - p.x, 0, p.x - r[2]), Math.max(r[1] - p.z, 0, p.z - r[3]));
      assert(gap > 300, '新增導軌侵入桶身外緣');
    }
    if (t === project.total) break;
  }
  return { ...checks, scope: 'AGV 淨距為新設施低於 2200 mm 部分的保守俯視 AABB 下界，另以多邊形驗證；0.5 s 取樣，不是現場安全認證。' };
}
