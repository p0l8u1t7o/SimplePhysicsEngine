// 示意光線與投影點不是實體；照明方向由面光源、輪面法線算出，沒有額外時鐘。
import * as THREE from 'three';
import { PICK, LINE, WHEELS, hangY } from './layout.js';

export function createOpticalEffects(scene, wheels) {
  const root = new THREE.Group(); root.name = 'optical explanation'; root.userData.fx = true; scene.add(root);
  const rays = [];
  for (const l of PICK.lights) {
    const a = new THREE.Vector3(l.x, l.y - 20, l.z), b = new THREE.Vector3(l.x, hangY(WHEELS.A), LINE.z + WHEELS.A.w / 2);
    const incident = b.clone().sub(a).normalize(), reflected = incident.clone().reflect(new THREE.Vector3(0, 0, 1));
    const end = b.clone().addScaledVector(reflected, (20 - b.y) / reflected.y);
    const arrow = (from, to, color) => {
      const d = to.clone().sub(from), obj = new THREE.ArrowHelper(d.clone().normalize(), from, d.length(), color, 80, 35);
      obj.name = 'optical ray'; root.add(obj); return obj;
    };
    rays.push({ incident, reflected, incoming: arrow(a, b, 0x68ff9d), outgoing: arrow(b, end, 0xffb357) });
  }
  // 解說箭頭只給主畫面，不能污染左相機的模擬影像。
  root.traverse(o => o.layers.set(1));
  const patterns = wheels.map(wheel => {
    const g = new THREE.Group(); g.name = 'projected dots'; g.userData.fx = true; wheel.add(g);
    // 射線與輪面實體相交才落點，避免把投影點畫在中心孔或輪輻空隙。
    const raycaster = new THREE.Raycaster(), spec = wheel.userData.spec, hits = [];
    wheel.updateMatrixWorld(true);
    for (let x = -240; x <= 240; x += 24) for (let y = -240; y <= 240; y += 24) {
      raycaster.set(new THREE.Vector3(x, y, spec.w), new THREE.Vector3(0, 0, -1));
      const hit = raycaster.intersectObjects(wheel.children.filter(c => c !== g), true)[0];
      if (hit && hit.point.z >= spec.hub - 2) hits.push(hit.point.clone().add(new THREE.Vector3(0, 0, 1.5)));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(hits);
    const dots = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x63ff88, size: 5, sizeAttenuation: true, depthWrite: false })); g.add(dots);
    return g;
  });
  let showRays = false;
  return { root, rays, patterns,
    setView(value) { showRays = value; root.visible = showRays; },
    set(st, k) { root.visible = showRays; patterns.forEach((g, i) => { g.visible = i === k && st.pattern > .5 && st.strobe > .5; }); },
  };
}
