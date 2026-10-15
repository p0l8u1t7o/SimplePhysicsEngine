// 不鏽鋼鐵盒（沿用現場的盒子；開口朝上、四邊捲邊）、搬盒推車、作業員姿勢示意。
import * as THREE from 'three';
import { block, cylinder, rod, decal } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { BOX, LAYOUT } from './spec.js';
import { createLoad } from './parts.js';

const boxMat = new THREE.MeshStandardMaterial({ color: 0xc9d0d6, roughness: .28, metalness: .9 });

// 鐵盒：原點＝盒子外底面中心；load 掛在內底面（y＝bottom）。label：盒側貼的流水號
export function createBox(part, name, label) {
  const [w, h, d] = BOX.size, t = BOX.wall, b = BOX.bottom;
  const root = new THREE.Group(); root.name = name;
  block(root, [w, b, d], [0, b / 2, 0], boxMat);
  for (const s of [-1, 1]) {
    block(root, [w, h - b, t], [0, b + (h - b) / 2, s * (d / 2 - t / 2)], boxMat);
    block(root, [t, h - b, d - 2 * t], [s * (w / 2 - t / 2), b + (h - b) / 2, 0], boxMat);
  }
  // 捲邊：外側一圈細管
  for (const s of [-1, 1]) {
    rod(root, [-w / 2, h - 3, s * (d / 2 + 2.5)], [w / 2, h - 3, s * (d / 2 + 2.5)], 3, boxMat, 8);
    rod(root, [s * (w / 2 + 2.5), h - 3, -d / 2 - 5.5], [s * (w / 2 + 2.5), h - 3, d / 2 + 5.5], 3, boxMat, 8);
  }
  if (label) decal(root, 120, 40, [w / 2 + 6, h * .55, 0], [0, Math.PI / 2, 0], [label], { color: '#1d2a36', bg: '#e9eef2', center: true, bold: true });
  const load = createLoad(part, { name: `${name} load` }); load.group.position.y = b; root.add(load.group);
  return { root, load };
}

// 搬盒推車：兩層台面＋推把＋四個腳輪；原點＝車身中心地面，推把在 −x 側
export function createCart(name = 'cart') {
  const C = LAYOUT.cart, [w, d] = C.size;
  const root = new THREE.Group(); root.name = name; root.userData.noBom = '現場既有推車（或另購）';
  const frame = MAT.steel, top = new THREE.MeshStandardMaterial({ color: 0x2f6aa8, roughness: .6, metalness: .2 });
  block(root, [w, 24, d], [0, C.deck - 12, 0], top);
  block(root, [w, 24, d], [0, 260, 0], top);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    block(root, [28, C.deck - 140, 28], [sx * (w / 2 - 20), 140 + (C.deck - 140) / 2 - 12, sz * (d / 2 - 20)], frame);
    cylinder(root, 50, 32, [sx * (w / 2 - 60), 50, sz * (d / 2 - 60)], MAT.black, 'z', 18);
    block(root, [40, 50, 50], [sx * (w / 2 - 60), 112, sz * (d / 2 - 60)], MAT.steelDark);
  }
  for (const sz of [-1, 1]) block(root, [28, 300, 28], [-w / 2 - 6, C.deck + 150, sz * (d / 2 - 40)], frame);
  rod(root, [-w / 2 - 6, C.deck + 300, -d / 2 + 40], [-w / 2 - 6, C.deck + 300, d / 2 - 40], 15, frame);
  // 台面四角擋邊（盒子不滑落）
  for (const sz of [-1, 1]) block(root, [w, 30, 12], [0, C.deck + 15, sz * (d / 2 - 6)], frame);
  return { root };
}

// 作業員：製程姿勢示意，不作人體碰撞認證（userData.operatorProxy）。set({ x, z, yaw, hands: [Vector3, Vector3] | null, walk })
export function createOperator(scene) {
  const root = new THREE.Group(); root.name = 'operator'; root.userData.operatorProxy = true; root.userData.noBom = '作業員'; scene.add(root);
  const suit = new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: .85 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x1f2a36, roughness: .9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a37f, roughness: .8 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: .9 });
  const helmet = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: .4 });
  const body = new THREE.Group(); body.name = 'operator body'; root.add(body);
  block(body, [340, 460, 210], [0, 1200, 0], suit);
  block(body, [300, 160, 200], [0, 900, 0], pants);
  const head = new THREE.Mesh(new THREE.SphereGeometry(100, 18, 12), skin); head.position.y = 1550; head.scale.y = 1.15; body.add(head);
  const hat = new THREE.Mesh(new THREE.SphereGeometry(112, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), helmet); hat.position.y = 1590; body.add(hat);
  const legs = [-1, 1].map(s => { const g = new THREE.Group(); g.position.set(s * 85, 820, 0); body.add(g); block(g, [115, 760, 135], [0, -380, 0], pants); block(g, [125, 80, 250], [0, -780, 40], MAT.black); return g; });
  const limb = (r, m) => { const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r * .88, 1, 10), m); root.add(mesh); return mesh; };
  const arms = [-1, 1].map(side => ({ side, upper: limb(50, suit), lower: limb(40, suit), hand: block(root, [70, 50, 95], [0, 0, 0], glove) }));
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  function seg(mesh, a, b) {
    const d = b.clone().sub(a); mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(V(0, 1, 0), d.clone().normalize()); mesh.scale.y = Math.max(1, d.length());
  }
  function set({ x, z, yaw = 0, hands = null, walk = 0 }) {
    body.position.set(x, 0, z); body.rotation.y = yaw;
    legs.forEach((g, i) => { g.rotation.x = Math.sin(walk * Math.PI * 2 + i * Math.PI) * .32 * Math.min(1, Math.abs(walk) > 1e-6 ? 1 : 0); });
    const c = Math.cos(yaw), s = Math.sin(yaw), toWorld = (lx, y, lz) => V(x + lx * c + lz * s, y, z - lx * s + lz * c);
    arms.forEach((a, i) => {
      const sh = toWorld(a.side * 175, 1380, 0);
      const hand = hands ? hands[i] : toWorld(a.side * 215, 880, 30);
      const mid = sh.clone().lerp(hand, .5), out = toWorld(a.side * 70, -90, 60).sub(V(x, 0, z));
      const elbow = mid.add(out);
      seg(a.upper, sh, elbow); seg(a.lower, elbow, hand); a.hand.position.copy(hand); a.hand.rotation.set(0, yaw, 0);
    });
  }
  set({ x: 0, z: 0 });
  return { root, set };
}
