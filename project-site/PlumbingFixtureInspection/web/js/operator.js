// 作業員是製程姿勢示意，不作人體碰撞或安全距離認證；手部直接取用既有產品路徑。
import * as THREE from 'three';
import { block } from '@core/geom/shapes.js';
import { OPERATOR, DRAWER } from './layout.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export function createOperator(scene) {
  const root = new THREE.Group(); root.name = 'operator pose proxy'; root.userData.operatorProxy = true; scene.add(root);
  const blue = new THREE.MeshStandardMaterial({ color: 0x193653, roughness: .85 });
  const glove = new THREE.MeshStandardMaterial({ color: 0xb7c4ca, roughness: .85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x202a32, roughness: .9 });
  const body = new THREE.Group(); root.add(body);
  block(body, [310, 430, 195], [0, 1190, 0], blue);
  block(body, [285, 180, 185], [0, 915, 0], blue);
  const head = new THREE.Mesh(new THREE.SphereGeometry(105, 16, 12), glove); head.position.y = 1540; head.scale.y = 1.2; body.add(head);
  for (const x of [-88, 88]) {
    block(body, [112, 740, 135], [x, 450, 0], blue);
    block(body, [130, 90, 240], [x, 45, -45], dark);
  }
  function limb(radius, material) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * .86, 1, 10), material); root.add(mesh); return mesh;
  }
  const arms = [-1, 1].map(side => ({ side, upper: limb(51, blue), lower: limb(40, blue), hand: block(root, [66, 48, 90], [0, 0, 0], glove) }));
  function segment(mesh, a, b) {
    const d = b.clone().sub(a); mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(V(0, 1, 0), d.clone().normalize()); mesh.scale.y = d.length();
  }
  function set(s, step, product) {
    const unloading = step.station === 6 && (s.outL > 0 || /鬆開/.test(step.action));
    const carrying = s.mountL < 1 || unloading;
    const progress = Math.max(0, (s.outL - .3) / .7);
    // 卸料時身體跟隨手部移到料架前，保留既有 outL 的產品座標與時序。
    const bx = THREE.MathUtils.lerp(OPERATOR.x, product.position.x - 170, progress);
    const bz = THREE.MathUtils.lerp(OPERATOR.z + 160, product.position.z + 430, progress);
    body.position.set(bx, 0, bz);
    const target = product.position.clone().add(V(0, 25, 28));
    if (!carrying && step.station === 0) target.set(DRAWER.xs.L, 930, 1010 + s.dL * DRAWER.travel);
    const reach = carrying || step.station === 0;
    arms.forEach(a => {
      const shoulder = V(bx + a.side * 165, 1340, bz);
      const hand = reach ? target.clone().add(V(a.side * 45, 0, 0)) : V(bx + a.side * 210, 900, bz - 40);
      const elbow = shoulder.clone().lerp(hand, .48).add(V(a.side * 80, -100, 65));
      segment(a.upper, shoulder, elbow); segment(a.lower, elbow, hand); a.hand.position.copy(hand);
      a.hand.quaternion.copy(product.quaternion);
    });
  }
  return { root, body, arms, set };
}
