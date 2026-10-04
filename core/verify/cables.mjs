// 配線檢查（通用）：在取樣時間點逐一套用排程，檢查外露線路、拖鏈、支架與選定的剛體障礙物。
//   checkCableScenarios([{ name, scene, apply(t), times, obstacles }], { minRoutes })
// 線路是場景中帶 userData.cable／carrier／support 的物件（core/electrical/cable-routing.js 建出來的）。
// 判定：拖鏈長度與彎曲半徑固定；線段對障礙物的「放大包圍盒」不可相交，線端 10 mm 可以插進接頭／固定座；
// 穿板孔（userData.serviceBores）內的線段不算。這是取樣回歸檢查，不是柔性線材或安全認證。
// 根目錄 tools/verify-cables.mjs（現有各站）與 run.mjs 的 electrical 檢查（project.js 的 verify.cables）共用這一份。
import * as THREE from 'three';
import { meshBounds, separatingGap } from './clearance.mjs';
import { checkFeedthroughs } from './feedthroughs.mjs';

// 線段對放大後的網格本地包圍盒：保守的膠囊體初篩
function segmentBox(a, b, box) {
  let lo = 0, hi = 1;
  for (const k of ['x', 'y', 'z']) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-10) { if (a[k] < box.min[k] || a[k] > box.max[k]) return false; }
    else { let x = (box.min[k] - a[k]) / d, y = (box.max[k] - a[k]) / d; if (x > y) [x, y] = [y, x]; lo = Math.max(lo, x); hi = Math.min(hi, y); if (lo > hi) return false; }
  }
  return true;
}

export function checkCableScenarios(scenarios, { minRoutes = 1 } = {}) {
  const failures = new Map(), report = [];
  const fail = (key, detail) => { if (!failures.has(key)) failures.set(key, { key, ...detail }); };
  for (const sc of scenarios) {
    sc.apply(sc.times[0]); const entries = checkFeedthroughs(sc.scene);
    for (const f of entries.failures) fail(sc.name + '/' + f.name, { method: 'physical feedthrough audit', detail: f.detail });
    const extra = []; sc.scene.traverse(m => { if (m.isMesh && m.userData.entryPlate) extra.push(m); });
    const routes = []; sc.scene.traverse(g => { if (g.userData.cable || g.userData.carrier || g.userData.support) routes.push(g); });
    const obstacles = [...new Set([...sc.obstacles, ...extra])].filter(m => m?.isMesh && !m.userData.routingHardware), lengths = new Map(); let samples = 0;
    for (const t of sc.times) {
      sc.apply(t); sc.scene.updateMatrixWorld(true); samples++;
      const obs = obstacles.map(m => { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); return { m, b: m.geometry.boundingBox.clone(), world: new THREE.Box3().setFromObject(m), inv: m.matrixWorld.clone().invert() }; });
      for (const g of routes) {
        const isSupport = !!g.userData.support;
        const d = g.userData.carrier || g.userData.cable || (isSupport ? { ...g.userData.support, points: [g.userData.support.a, g.userData.support.b] } : null), isCarrier = !!g.userData.carrier;
        if (g.userData.guide) { const bounds = meshBounds(g); for (const ob of obs) if (separatingGap(bounds, meshBounds(ob.m)) < -.01) fail(sc.name + '/' + g.name + '/' + (ob.m.name || ob.m.geometry.type), { time: +t.toFixed(3), method: 'oriented solid guide bounds' }); continue; }
        if (isCarrier) {
          if (!(d.firstStraight >= 0 && d.lastStraight >= 0)) fail(sc.name + '/' + g.name + '/taut', { time: +t.toFixed(3), method: 'carrier must stay taut' });
          if (Math.abs(d.firstStraight + d.lastStraight + Math.PI * d.radius - d.length) > 1e-8 || (lengths.has(g) && Math.abs(lengths.get(g) - d.length) > 1e-8)) fail(sc.name + '/' + g.name + '/length', { time: +t.toFixed(3), method: 'carrier length changes' });
          lengths.set(g, d.length);
        }
        const points = d.points.map(p => new THREE.Vector3(...p).applyMatrix4(g.matrixWorld)), radius = isCarrier ? Math.hypot(d.width / 2 + 3, 8) : d.radius;
        const world = new THREE.Box3().setFromPoints(points).expandByScalar(radius);
        for (const ob of obs) {
          if (!world.intersectsBox(ob.world)) continue;
          const local = points.map(p => p.clone().applyMatrix4(ob.inv)), b = ob.b.clone().expandByScalar(radius);
          // 只有線頭／線尾 10 mm 可以插進接頭或固定座；整個機構不豁免，其餘線段仍要對它檢查
          let distance = 0; const total = points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(points[i]), 0);
          const seat = isSupport ? Math.max(10, radius * 2) : 10;
          const startSeat = !isSupport || b.containsPoint(local[0]) ? seat : 0, endSeat = !isSupport || b.containsPoint(local.at(-1)) ? seat : 0;
          for (let i = 1; i < local.length; i++) {
            const seg = points[i].distanceTo(points[i - 1]), start = distance; distance += seg;
            if (distance <= startSeat || start >= total - endSeat || seg < 1e-9) continue;
            const a = local[i - 1].clone().lerp(local[i], Math.max(0, (startSeat - start) / seg)), end = local[i - 1].clone().lerp(local[i], Math.min(1, (total - endSeat - start) / seg));
            if (startSeat + endSeat >= total) continue;
            const bores = ob.m.userData.serviceBores || [];
            if (bores.some(([x, z, r]) => [a, end].every(p => Math.hypot(p.x - x, p.z - z) + radius + .25 < r))) continue;
            // 圓柱不佔包圍盒的四個角
            const shape = ob.m.geometry.parameters;
            if (ob.m.geometry.type === 'CylinderGeometry') {
              const r = Math.max(shape.radiusTop, shape.radiusBottom), sz = ob.b.getSize(new THREE.Vector3());
              if (Math.abs(sz.x - 2 * r) < .01 && Math.abs(sz.z - 2 * r) < .01) { const dx = end.x - a.x, dz = end.z - a.z, u = THREE.MathUtils.clamp(-(a.x * dx + a.z * dz) / (dx * dx + dz * dz || 1), 0, 1); if (Math.hypot(a.x + u * dx, a.z + u * dz) > r + radius + .01) continue; }
            }
            if (segmentBox(a, end, b)) { fail(sc.name + '/' + g.name + '/' + (ob.m.name || ob.m.geometry.type), { time: +t.toFixed(3), point: points[i].toArray().map(x => +x.toFixed(2)), obstacleLocal: [a.toArray(), end.toArray()], obstacleBounds: [ob.b.min.toArray(), ob.b.max.toArray()], method: 'expanded mesh bounds; potential interference' }); break; }
          }
        }
      }
    }
    if (routes.length < minRoutes) fail(sc.name + '/routes', { method: `routing missing: ${routes.length} < ${minRoutes}` });
    report.push({ scenario: sc.name, samples, routes: routes.filter(g => !g.userData.support).length, supports: routes.filter(g => g.userData.support).length, carriers: routes.filter(g => g.userData.carrier).length, feedthroughs: entries });
  }
  return { report, failures: [...failures.values()] };
}

export const CABLE_METHOD = 'constant carrier length/radius; cable and support segments vs expanded selected rigid mesh bounds; cable end seating 10 mm; support seating only at contacting endpoints, max(10 mm, diameter); tabletop service bores';
