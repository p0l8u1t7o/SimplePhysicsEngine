// 3D 建模測試（需要 three）：node --import ./core/tools/register.mjs --test "core/structure/test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { pvFixedRack, pvTracker, profileGeometry, buildStructure } from '../build.js';
import { layoutTracker, rotatePoint } from '../tracker.js';
import { routePipe } from '../../piping/route.js';
import { createPipeBatch, routeCurve, routeTube, trayGeometry } from '../../piping/build.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} ± ${tol}`);

test('斷面擠出幾何：外框等於斷面尺寸、長度 1、同斷面共用一份', () => {
  const g = profileGeometry('H150x150x7x10'); g.computeBoundingBox();
  const s = g.boundingBox.getSize(new THREE.Vector3());
  near(s.x, 150, 1e-6); near(s.y, 150, 1e-6); near(s.z, 1, 1e-9);
  assert.equal(profileGeometry('H150x150x7x10'), g);
  const z = profileGeometry('Z150x60x20x2.3'); z.computeBoundingBox();
  near(z.boundingBox.getSize(new THREE.Vector3()).x, 2 * 60 - 2.3, 1e-4);   // Float32 頂點
});

test('固定式：每種構件一個 InstancedMesh，實例數＝構件數；實例端點對上構件端點', () => {
  const rack = pvFixedRack.create({ rows: 2, height: (x, z) => 200 * Math.sin(x / 4000) });
  assert.equal(rack.root.userData.coreModel, 'pv-fixed-rack');
  const inst = rack.root.children.filter(c => c.isInstancedMesh && c.userData.structureKind !== 'module');
  assert.equal(inst.reduce((t, m) => t + m.count, 0), rack.members.length);
  assert.equal(rack.meshes.module.count, rack.layout.modules.length);
  // 第一支樁：局部 (0, 0, ±0.5) 經實例矩陣 → 構件兩端
  const pile = rack.meshes['pile:H150x150x7x10'], M = new THREE.Matrix4(); pile.getMatrixAt(0, M);
  const m0 = rack.members.find(m => m.id === pile.userData.members[0]);
  const a = new THREE.Vector3(0, 0, -.5).applyMatrix4(M), b = new THREE.Vector3(0, 0, .5).applyMatrix4(M);
  near(a.distanceTo(new THREE.Vector3(...m0.a)), 0, .2); near(b.distanceTo(new THREE.Vector3(...m0.b)), 0, .2);
  assert.ok(rack.checks().length >= 8);
});

test('追日：set({ angle }) 後模組實例中心＝rotatePoint 的結果，樁不動', () => {
  const trk = pvTracker.create({ rows: 1, across: 12, follow: 'terrain', height: x => 300 * Math.sin(x / 6000) });
  const pileBefore = new THREE.Matrix4(); trk.meshes['pile:H150x150x7x10'].getMatrixAt(1, pileBefore);
  trk.set({ angle: 40 });
  const M = new THREE.Matrix4(), mod = trk.layout.modules[5];
  trk.meshes.module.getMatrixAt(5, M);
  const c = new THREE.Vector3().setFromMatrixPosition(M), want = rotatePoint(mod.center, mod.pivot, 40);
  near(c.distanceTo(new THREE.Vector3(...want)), 0, .2);
  const pileAfter = new THREE.Matrix4(); trk.meshes['pile:H150x150x7x10'].getMatrixAt(1, pileAfter);
  assert.ok(pileAfter.equals(pileBefore));
  trk.set({ angle: 0 });
  trk.meshes.module.getMatrixAt(5, M);
  near(new THREE.Vector3().setFromMatrixPosition(M).distanceTo(new THREE.Vector3(...mod.center)), 0, .2);
});

test('配管批次：直管與彎頭共用幾何；彎頭實例的終點落在倒角終點', () => {
  const r1 = routePipe([[0, 500, 0], [3000, 500, 0], [3000, 500, 3000], [3000, 2500, 3000]], { size: 'DN100' });
  const r2 = routePipe([[0, 500, 1000], [2000, 500, 1000], [2000, 500, 4000]], { size: 'DN100' });
  const root = createPipeBatch().add(r1).add(r2).build();
  const straights = root.children.filter(m => m.name.includes('straight')), bends = root.children.filter(m => m.name.includes('bend'));
  assert.equal(straights.length, 1); assert.equal(straights[0].count, 5);
  assert.equal(bends.length, 1); assert.equal(bends[0].count, 3);       // 三個 R152 的 90° 彎共用一份 TorusGeometry
  const M = new THREE.Matrix4(); bends[0].getMatrixAt(1, M);            // r1 的第二個彎（垂直往上）
  const b = r1.bends[1], th = b.angle * Math.PI / 180;
  const end = new THREE.Vector3(b.R * Math.cos(th), b.R * Math.sin(th), 0).applyMatrix4(M), start = new THREE.Vector3(b.R, 0, 0).applyMatrix4(M);
  near(end.distanceTo(new THREE.Vector3(...b.end)), 0, 1e-6); near(start.distanceTo(new THREE.Vector3(...b.start)), 0, 1e-6);
});

test('路徑曲線長度＝展開長度；Tube 與電纜槽幾何可以建立', () => {
  const r = routePipe([[0, 0, 0], [2000, 0, 0], [2000, 0, 3000], [2000, 1500, 3000]], { size: 'TRAY-200x75' });
  near(routeCurve(r).getLength(), r.developed, .5);
  const m = routeTube(r, { radius: 30 }); assert.ok(m.geometry.attributes.position.count > 0);
  const g = trayGeometry(r, { width: 200, height: 75 }); g.computeBoundingBox();
  assert.ok(g.attributes.position.count > 0);
  near(g.boundingBox.max.y, 1500, 1);                              // 垂直段頂端
});

test('決定性：同參數建兩次，所有實例矩陣相同', () => {
  const p = { rows: 2, follow: 'terrain', height: x => 250 * Math.sin(x / 7000) };
  const a = buildStructure(layoutTracker(p)), b = buildStructure(layoutTracker(p));
  a.set({ angle: 25 }); b.set({ angle: 25 });
  for (const k of Object.keys(a.meshes)) assert.deepEqual([...a.meshes[k].instanceMatrix.array], [...b.meshes[k].instanceMatrix.array], k);
});
