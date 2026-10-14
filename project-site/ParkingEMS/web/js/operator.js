// 固定肢段的兩節手臂 IK；人物仍是姿勢代理，不作人體碰撞或安全距離驗證。
import * as THREE from 'three';
import { block, bevelBox } from '@core/geom/shapes.js';

export function createOperator(parent, name, worker = false) {
  const root = new THREE.Group(); root.name = name; root.userData.operatorProxy = true; parent.add(root);
  const cloth = new THREE.MeshStandardMaterial({ color: worker ? 0xef8b29 : 0x3c84a4, roughness: .85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd7bd9e, roughness: .8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x263442, roughness: .9 });
  const torso=bevelBox(360,500,240,cloth,60);torso.position.y=1180;root.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(115, 12, 10), skin); head.position.y = 1580; root.add(head);
  if (worker) { const hat = new THREE.Mesh(new THREE.SphereGeometry(135, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cloth); hat.position.y = 1610; root.add(hat); block(root, [340, 55, 248], [0, 1190, 0], skin); }
  const limbs = (y, x, len, mat) => [-1, 1].map(s => {
    const p = new THREE.Group(); p.position.set(s * x, y, 0); root.add(p);
    const upper=new THREE.Mesh(new THREE.CapsuleGeometry(58,len/2-116,4,10),mat);upper.position.y=-len/4;p.add(upper);
    const joint=new THREE.Group();joint.position.y=-len/2;p.add(joint);
    const lower=new THREE.Mesh(new THREE.CapsuleGeometry(50,len/2-100,4,10),mat);lower.position.y=-len/4;joint.add(lower);
    p.joint=joint;p.userData.length=len/2;return p;
  });
  const arms = limbs(1380, 205, 680, cloth), legs = limbs(930, 105, 820, dark);
  for(const leg of legs){const shoe=bevelBox(130,100,265,dark,35);shoe.position.set(0,-460,65);leg.joint.add(shoe);}
  const hand = new THREE.Object3D(); hand.position.set(0, -340, 0); arms[1].joint.add(hand);
  const palm=new THREE.Mesh(new THREE.SphereGeometry(45,10,8),skin);hand.add(palm);
  const body=new THREE.Group();body.name='operator torso pivot';body.position.y=950;root.add(body);root.updateWorldMatrix(true,true);
  for(const child of [...root.children])if(child!==body&&!legs.includes(child))body.attach(child);
  root.traverse(o=>{if(o.isMesh)o.castShadow=o.receiveShadow=true;});
  const down=new THREE.Vector3(0,-1,0), target=new THREE.Vector3(),direction=new THREE.Vector3(),bend=new THREE.Vector3(),elbow=new THREE.Vector3(),local=new THREE.Vector3();
  return { root, hand, arms, legs, pose(t, walk = 0, reach = 0) {
    body.rotation.set(0,0,0);
    for (let i = 0; i < 2; i++) { const phase=t*7+i*Math.PI,a=Math.sin(phase)*.35*walk;legs[i].rotation.set(a,0,0);legs[i].joint.rotation.set(Math.max(0,-Math.sin(phase))*.55*walk,0,0);arms[i].rotation.set(-a-reach*.5,0,0);arms[i].joint.rotation.set(-.18-reach*.35,0,0);arms[i].scale.set(1,1,1); }
  }, reachTo(world) {
    const joint=arms[1].joint,L=340;
    root.updateWorldMatrix(true,true);target.copy(world);root.worldToLocal(target);
    // 手部接近低處槍把時，由腰部前傾與側傾補足距離；肢段長度不變。
    body.rotation.set(Math.max(-.65,Math.min(.65,target.z*.0012)),0,Math.max(-.65,Math.min(.65,-target.x*.0012)));
    root.updateWorldMatrix(true,true);target.copy(world);body.worldToLocal(target);target.sub(arms[1].position);
    const distance=target.length(),d=Math.min(2*L-.1,Math.max(.1,distance));direction.copy(target).normalize();
    bend.set(0,-1,0).addScaledVector(direction,direction.y);if(bend.lengthSq()<.001)bend.set(1,0,0);bend.normalize();
    elbow.copy(direction).multiplyScalar(d/2).addScaledVector(bend,Math.sqrt(L*L-d*d/4));
    arms[1].quaternion.setFromUnitVectors(down,local.copy(elbow).normalize());
    joint.quaternion.identity();root.updateWorldMatrix(true,true);local.copy(world);joint.worldToLocal(local);
    joint.quaternion.setFromUnitVectors(down,local.normalize());root.userData.reachError=Math.max(0,distance-2*L);
  } };
}
