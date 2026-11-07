// 從 3D 模型估負載（core/robot/payload.js）：體積、密度、質心、覆寫、略過的件
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { estimatePayload } from '../payload.js';

const metal = new THREE.MeshStandardMaterial({ metalness: 0.6 }), plastic = new THREE.MeshStandardMaterial({ metalness: 0 });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('方塊與圓柱：體積 × 密度，質心在法蘭座標', () => {
  const tool = new THREE.Group(), box = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), metal);
  box.position.set(0, 0, 50); tool.add(box);                                             // 100 mm 鋁方塊，中心在工具軸 50 mm
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 100, 64), plastic);
  cyl.rotation.x = Math.PI / 2; cyl.position.set(0, 80, 150); tool.add(cyl);             // 塑膠圓柱，偏到 +Y
  const p = estimatePayload(tool);
  const mBox = 2700 * 1e-3, mCyl = 1200 * Math.PI * 100 * 100 * 1e-9 * (64 / (2 * Math.PI) * Math.sin(2 * Math.PI / 64));
  near(p.mass, +(mBox + mCyl).toFixed(3), 2e-3, '總質量');
  near(p.com[2], (mBox * 50 + mCyl * 150) / (mBox + mCyl), 0.1, '質心 z');
  near(p.com[1], mCyl * 80 / (mBox + mCyl), 0.1, '質心 y');
  assert.equal(p.skipped.length, 0);
});

test('覆寫與略過：userData.mass、density、隱藏、透明、開口網格、管子', () => {
  const tool = new THREE.Group();
  const cam = new THREE.Group(); cam.userData.mass = 0.4; cam.position.set(0, 0, 100);
  cam.add(new THREE.Mesh(new THREE.BoxGeometry(40, 40, 60), metal)); tool.add(cam);           // 相機標了實際重量 0.4 kg：子件不另外算
  const steel = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 100), metal); steel.userData.density = 7850; steel.position.z = 50; tool.add(steel);
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), metal); hidden.visible = false; tool.add(hidden);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.3 })); tool.add(glass);
  const open = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 50, 16, 1, true), metal); open.name = 'open-sleeve'; tool.add(open);
  const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 200)), 4, 5, 8, false), plastic); tool.add(hose);
  const p = estimatePayload(tool);
  const mSteel = 7850 * 10 * 10 * 100 * 1e-9, mHose = 1200 * Math.PI * 25 * 200 * 1e-9;
  near(p.mass, +(0.4 + mSteel + mHose).toFixed(3), 2e-3);
  assert.deepEqual(p.skipped.map(s => s.name), ['open-sleeve']);
  assert.ok(p.parts.some(x => x.method === 'userData.mass' && x.mass === 0.4));
  assert.ok(p.parts.some(x => x.method === 'tube'));
  near(estimatePayload(tool, { fill: 0.5 }).mass, +(0.4 + (mSteel + mHose) * 0.5).toFixed(3), 2e-3, 'fill 只影響用體積算的件');
});
