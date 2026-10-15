// 光學提示只表示目前量測位置；高度判定仍取自既有 results，不宣稱光線追跡精度。
import * as THREE from 'three';
import { slot } from './spec.js';
import { QB } from './qc-box.js';
import { QP } from './qc-piece.js';

export function createMeasurementEffects(st, part, plan) {
  const material = new THREE.LineBasicMaterial({ color: 0x39b8ff, transparent: true, opacity: .95, depthWrite: false });
  const n = 64, vertices = new Float32Array(n * 6), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3).setUsage(THREE.DynamicDrawUsage));
  const line = new THREE.LineSegments(geometry, material); line.name = 'surface laser trace'; line.userData.fx = true;
  line.frustumCulled = false; line.visible = false; st.root.add(line);
  const spots = [];
  if (plan.mode === 'piece' && plan.sensor === 'laser') {
    const mat = new THREE.MeshBasicMaterial({ color: 0x58bdff, depthWrite: false, transparent: true, opacity: .9 });
    for (let k = 0; k < 2; k++) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(1.5, 12), mat); dot.rotation.x = -Math.PI / 2;
      dot.name = `confocal surface point ${k + 1}`; dot.userData.fx = true; dot.visible = false; st.root.add(dot); spots.push(dot);
    }
  }
  const inside = (x, z, rot) => {
    if (part.key === 'rotor') {
      const r = Math.hypot(x, z);
      if (r > part.d / 2 || r < part.bore / 2) return false;
      for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; if (Math.hypot(x - Math.cos(a) * 12.5, z - Math.sin(a) * 12.5) < 2.6) return false; }
      return true;
    }
    if (rot) { x = -x; z = -z; }
    if (Math.abs(z) > part.len / 2) return false;
    const width = z >= part.len / 2 - part.yoke[1] ? part.yoke[0] : z <= -part.len / 2 + part.tip[1] ? part.tip[0] : part.stem[0];
    return Math.abs(x) <= width / 2;
  };
  const rows = Array.from({ length: part.grid.rows }, (_, r) => Array.from({ length: part.grid.cols }, (_, c) => slot(part, r * part.grid.cols + c)));
  return {
    update(smp) {
      line.visible = plan.mode === 'box' && plan.sensor === 'laser' && smp.gantry.laser > .5;
      if (line.visible) {
        const G = smp.gantry, row = Math.min(part.grid.rows - 1, smp.rows.done + 1), zc = G.y - st.root.position.z;
        const baseY = st.holder.position.y;
        for (let j = 0; j < n; j++) {
          const za = zc - 17 + j * 34 / n, zb = za + 34 / n;
          // 翻轉後定子 z 方向反向；頂面貼基準板，現在看到的是原底面。
          const hit = rows[row].some(s => inside(G.x - s.x, -((za + zb) / 2 - QB.meas) - s.z, s.rot));
          const y = baseY + (hit ? part.h : 0) + .25;
          vertices.set([G.x, y, za, G.x, y, zb], j * 6);
        }
        geometry.attributes.position.needsUpdate = true;
      }
      spots.forEach((dot, i) => {
        const b = st.beams[i]; dot.visible = b.m.visible;
        dot.position.set(st.heads.position.x + b.dx, QP.anvil.top + (b.top ? part.h : 0) + .12, st.heads.position.z - QP.heads.arm);
      });
      if (st.back) st.back.children[1].material.emissiveIntensity = smp.gantry.flash > .5 ? 1.6 : .2;
      if (st.lights) for (const light of st.lights) light.children[1].material.emissiveIntensity = st.cams[0]?.root && st.onAnvil.visible ? 1.4 : .15;
    },
  };
}
