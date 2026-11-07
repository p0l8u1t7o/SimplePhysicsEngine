// 物理範例依情境種類（剛體、rope 線材、cloth 布料、fluid 流體）烘焙與顯示：範例頁（demo.js）與檢查（check.mjs）共用。
//   bakeScenario(s)、viewScenario(s, baked)、colliderMeshes(colliders, mat)（布料、流體的碰撞形狀，含 tank、drum）
import * as THREE from 'three';
import { bakeRope, createRopeView } from '../../physics/rope.js';
import { bakeCloth, createClothView } from '../../physics/cloth.js';
import { bakeFluid, createFluidView } from '../../physics/fluid.js';
import { colliderParts } from '../../physics/collide.js';

export async function bakeScenario(s) {
  if (s.kind === 'rope') return bakeRope(s.spec);
  if (s.kind === 'cloth') return bakeCloth(s.spec);
  if (s.kind === 'fluid') return bakeFluid(s.spec);
  return (await import('../../physics/physics.js')).bake(s.spec);
}
export async function viewScenario(s, baked) {
  if (s.kind === 'rope') return createRopeView(baked, { color: 0xe89139 });
  if (s.kind === 'cloth') return createClothView(baked, { color: 0x2f7d5b });
  if (s.kind === 'fluid') return createFluidView(baked, { color: 0x3d8fd6, mode: 'spheres' });
  return (await import('../../physics/physics.js')).createPhysicsView(baked);
}
export function colliderMeshes(colliders = [], mat = new THREE.MeshStandardMaterial({ color: 0x8a96a3, roughness: .7, metalness: .2 })) {
  const g = new THREE.Group(); g.name = 'colliders';
  for (const c of colliderParts(colliders)) {
    let m = null;
    if (c.shape === 'box') {
      m = new THREE.Mesh(new THREE.BoxGeometry(...c.size), mat);
      const R = new THREE.Matrix4().set(c.m[0], c.m[1], c.m[2], 0, c.m[3], c.m[4], c.m[5], 0, c.m[6], c.m[7], c.m[8], 0, 0, 0, 0, 1);
      m.quaternion.setFromRotationMatrix(R);
    } else if (c.shape === 'cylinder') m = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, c.h, 32), mat);
    else if (c.shape === 'sphere') m = new THREE.Mesh(new THREE.SphereGeometry(c.r, 24, 16), mat);
    else if (c.shape === 'tube') {                    // 圓桶的桶壁：環形截面沿 y 掃出（LatheGeometry 的輪廓是 x = 半徑、y = 高）
      const pts = [new THREE.Vector2(c.r, 0), new THREE.Vector2(c.r + c.t, 0), new THREE.Vector2(c.r + c.t, c.h), new THREE.Vector2(c.r, c.h), new THREE.Vector2(c.r, 0)];
      m = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), mat);
    } else continue;                                  // plane：範例頁本來就有地面
    m.position.set(...c.pos); m.castShadow = m.receiveShadow = true; g.add(m);
  }
  return g;
}
