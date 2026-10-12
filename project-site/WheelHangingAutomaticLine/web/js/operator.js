// 圍籬外 HMI 操作姿勢示意；非人體碰撞模型，不作安全距離判定。
import * as THREE from 'three';
import { block, rod } from '@core/geom/shapes.js';
import { OPERATOR } from './layout.js';

export function createOperator(scene) {
  const root = new THREE.Group(); root.name = 'operator pose proxy'; root.userData.operatorProxy = true;
  root.position.set(OPERATOR.x, 0, OPERATOR.z + 650); scene.add(root);
  const blue = new THREE.MeshStandardMaterial({ color: 0x284b6c, roughness: .85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xbfc7cc, roughness: .85 });
  block(root, [310, 470, 195], [0, 1180, 0], blue);
  for (const x of [-90, 90]) { block(root, [115, 820, 140], [x, 500, 0], blue); block(root, [140, 90, 240], [x, 45, -40], blue); }
  const head = new THREE.Mesh(new THREE.SphereGeometry(105, 16, 12), skin); head.position.y = 1560; root.add(head);
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Vector3(s * 175, 1320, 0), elbow = new THREE.Vector3(s * 215, 1140, -180), hand = new THREE.Vector3(s * 110, 1350, -495);
    rod(root, shoulder, elbow, 47, blue); rod(root, elbow, hand, 38, blue);
    block(root, [70, 50, 90], hand.toArray(), skin);
  }
  return { root };
}
