// 線夾固定面（cable-routing.js 的 clampable）：有開孔的擠出件不能當固定面，shapes 是單一形狀或陣列都一樣
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cable } from '../cable-routing.js';

// 40 × 40 的板（厚 20），中間開 20 × 20 的孔；route 從板面上方 10 mm 經過
function plate(asArray, hole = true) {
  const s = new THREE.Shape([new THREE.Vector2(-20, -20), new THREE.Vector2(20, -20), new THREE.Vector2(20, 20), new THREE.Vector2(-20, 20)]);
  if (hole) s.holes.push(new THREE.Path([new THREE.Vector2(-10, -10), new THREE.Vector2(-10, 10), new THREE.Vector2(10, 10), new THREE.Vector2(10, -10)]));
  return new THREE.Mesh(new THREE.ExtrudeGeometry(asArray ? [s] : s, { depth: 20, bevelEnabled: false }), new THREE.MeshStandardMaterial());
}
const feet = (asArray, hole) => {
  const parent = new THREE.Group(); parent.add(plate(asArray, hole));
  cable(parent, 'T', [[-15, -15, 32], [0, 0, 32], [15, 15, 32]], { radius: 2, clips: 1, ends: false });
  return parent.children.filter(c => /clamp foot/.test(c.name)).length;
};

test('開孔的擠出件：單一形狀與陣列形狀都不當線夾固定面；沒開孔的照常可以', () => {
  assert.equal(feet(false, true), 0, '單一形狀、有孔');
  assert.equal(feet(true, true), 0, '陣列形狀、有孔（2026-11-07 以前會被當成可夾）');
  assert.equal(feet(true, false), 1, '陣列形狀、沒孔：可以夾');
});
