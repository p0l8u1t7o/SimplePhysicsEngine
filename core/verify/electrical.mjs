// 電控配置的靜態檢查（通用）：
//   checkElectricalPlan(scene) → { devices, connections, components, feedthroughs, failures }
// 元件（userData.electrical，electricalDevice 建的）要整個在電盤櫃內（userData.electricalEnclosure，cabinetShell 建的）、
// 編號不重複、機身不重疊；櫃內連線（userData.electricalWire）不穿過其他元件機身；穿板孔與接頭要真的開孔、有線穿過。
// 放在櫃外的設備（例如落地的手臂控制器）在元件規格寫 free: true；場景沒有電盤櫃（開放式面板）時不檢查「在櫃內」。只看幾何，不是電氣設計或認證。
// 根目錄 tools/verify-electrical-plan.mjs（現有各站）與 run.mjs 的 electrical 檢查共用這一份。
import * as THREE from 'three';
import { checkFeedthroughs } from './feedthroughs.mjs';
import { checkCableScenarios } from './cables.mjs';
import { sampleTimes } from './clearance.mjs';

function segmentHits(a, b, box) {
  let lo = 0, hi = 1;
  for (const k of ['x', 'y', 'z']) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-8) { if (a[k] < box.min[k] || a[k] > box.max[k]) return false; }
    else { let x = (box.min[k] - a[k]) / d, y = (box.max[k] - a[k]) / d; if (x > y) [x, y] = [y, x]; lo = Math.max(lo, x); hi = Math.min(hi, y); if (lo > hi) return false; }
  }
  return true;
}

export function checkElectricalPlan(scene) {
  scene.updateMatrixWorld(true);
  const devices = [], wires = [], enclosures = [];
  scene.traverse(o => {
    if (o.userData.electrical) devices.push(o);
    if (o.userData.electricalWire) wires.push(o);
    if (o.userData.electricalEnclosure) { const e = o.userData.electricalEnclosure; enclosures.push(new THREE.Box3(new THREE.Vector3(...e.min), new THREE.Vector3(...e.max)).applyMatrix4(o.matrixWorld)); }
  });
  const failures = [], ids = new Set();
  const bodies = devices.map(d => { const m = d.children.find(c => c.userData.electricalBody); return { d, b: new THREE.Box3().setFromObject(m || d) }; });
  for (const { d, b } of bodies) {
    if (ids.has(d.userData.electrical.id)) failures.push('Duplicate ID ' + d.name);
    ids.add(d.userData.electrical.id);
    if (enclosures.length && !d.userData.electrical.free && !enclosures.some(e => e.containsBox(b))) failures.push('Body outside cabinet ' + d.name);   // 沒有電盤櫃（開放式面板）時不檢查
  }
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const overlap = bodies[i].b.clone().intersect(bodies[j].b).getSize(new THREE.Vector3());
    if ([overlap.x, overlap.y, overlap.z].every(x => x > .01)) failures.push('Body overlap ' + bodies[i].d.name + ' / ' + bodies[j].d.name);
  }
  for (const wire of wires) {
    const points = wire.userData.electricalWire.points.map(p => new THREE.Vector3(...p).applyMatrix4(wire.matrixWorld));
    for (const { d, b } of bodies) if (points.slice(1).some((p, i) => segmentHits(points[i], p, b.clone().expandByScalar(.75)))) failures.push('Wire crosses body ' + wire.name + ' / ' + d.name);
  }
  const ports = checkFeedthroughs(scene);
  failures.push(...ports.failures.map(f => f.name + ' / ' + f.detail));
  return { devices: devices.length, connections: wires.length, enclosures: enclosures.length, components: devices.map(o => o.userData.electrical), feedthroughs: ports, failures };
}

// run.mjs 的 electrical 檢查：專案場景的電控配置＋（有宣告時）配線動態取樣。
// project.verify.cables = { obstacles: scene => [Mesh…]（會動的機構與要讓開的固定件，不含線材本身）, interval?: 0.1, times?: [秒…], minRoutes?: 1 }
// 場景沒有電控元件、電盤，也沒有宣告 cables 時回傳 applicable: false（不寫 review）。
export function verifyElectrical(project, scene, { interval } = {}) {
  project.apply?.(0); scene.updateMatrixWorld(true);
  const plan = checkElectricalPlan(scene), spec = project.verify?.cables;
  if (!plan.devices && !plan.enclosures && !spec) return { ok: true, applicable: false, failures: [] };
  let cables = null;
  if (spec) {
    const times = spec.times || sampleTimes(0, project.total, spec.interval ?? interval ?? .1);
    const obstacles = typeof spec.obstacles === 'function' ? spec.obstacles(scene) : spec.obstacles || [];
    cables = checkCableScenarios([{ name: 'cables', scene, apply: t => project.apply(t), times, obstacles }], { minRoutes: spec.minRoutes ?? 1 });
    project.apply(0);
  }
  const failures = [...plan.failures, ...(cables?.failures || []).map(f => `Cable ${f.key}${f.time != null ? ` @${f.time}s` : ''}（${f.method}${f.detail ? '：' + f.detail : ''}）`)];
  const { components, ...rest } = plan;
  return { ok: !failures.length, applicable: true, ...rest, components, cables: cables && { report: cables.report, failures: cables.failures }, failures };
}
