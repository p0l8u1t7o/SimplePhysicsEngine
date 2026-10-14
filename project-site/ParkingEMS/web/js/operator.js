// 人體僅表示走路與操作姿勢；不作人體碰撞或安全距離驗證。
import * as THREE from 'three';
import { block } from '@core/geom/shapes.js';

export function createOperator(parent, name, worker = false) {
  const root = new THREE.Group(); root.name = name; root.userData.operatorProxy = true; parent.add(root);
  const cloth = new THREE.MeshStandardMaterial({ color: worker ? 0xef8b29 : 0x3c84a4, roughness: .85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd7bd9e, roughness: .8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x263442, roughness: .9 });
  block(root, [380, 500, 240], [0, 1180, 0], cloth);
  const head = new THREE.Mesh(new THREE.SphereGeometry(115, 12, 10), skin); head.position.y = 1580; root.add(head);
  if (worker) { const hat = new THREE.Mesh(new THREE.SphereGeometry(135, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cloth); hat.position.y = 1610; root.add(hat); block(root, [340, 55, 248], [0, 1190, 0], skin); }
  const limbs = (y, x, len, mat) => [-1, 1].map(s => {
    const p = new THREE.Group(); p.position.set(s * x, y, 0); root.add(p);
    block(p, [100, len, 120], [0, -len / 2, 0], mat); return p;
  });
  const arms = limbs(1380, 240, 570, cloth), legs = limbs(930, 115, 820, dark);
  const hand = new THREE.Object3D(); hand.position.set(0, -590, 0); arms[1].add(hand);
  const down=new THREE.Vector3(0,-1,0), target=new THREE.Vector3();
  return { root, hand, pose(t, walk = 0, reach = 0) {
    for (let i = 0; i < 2; i++) { const a = Math.sin(t * 14 + i * Math.PI) * .45 * walk; legs[i].rotation.set(a,0,0); arms[i].rotation.set(-a - reach * (i ? 1.1 : .65),0,0); arms[i].scale.set(1,1,1); }
  }, reachTo(world) {
    root.updateWorldMatrix(true,false); target.copy(world);root.worldToLocal(target);target.sub(arms[1].position);
    arms[1].quaternion.setFromUnitVectors(down,target.clone().normalize());arms[1].scale.y=target.length()/590;
  } };
}
