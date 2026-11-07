// node --import ./core/tools/register.mjs --test "TEMP/physx-dev/test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { bakeCloth, clothSampler, clothStats, createClothView } from '../cloth.js';
import { tarp, LOAD } from '../../examples/physics/scenarios-extra.js';
import { clothSmall } from './specs.js';

test('布料：同一份設定烘焙兩次逐位元相同', () => {
  const a = bakeCloth(clothSmall()), b = bakeCloth(clothSmall());
  assert.equal(a.stats.hash, b.stats.hash);
  assert.deepEqual(Buffer.from(a.data.buffer), Buffer.from(b.data.buffer));
  assert.ok(a.stats.maxStretch < 0.08, `吊掛＋風的小布伸長 ${a.stats.maxStretch}`);
});

test('篷布蓋貨物：伸長小、不穿透、頂面上的布在貨物上方', () => {
  const b = bakeCloth(tarp());
  assert.ok(b.stats.maxStretch < 0.05, `最大伸長 ${b.stats.maxStretch}`);
  assert.ok(b.stats.maxPenetration < 1, `穿透 ${b.stats.maxPenetration}`);
  const s = clothStats(b, { region: { min: [-500, 690, -400], max: [500, 760, 400] } });
  assert.ok(s.inside > 0.15, `頂面上的節點比例 ${s.inside}`);
  // 貨物外框正上方的節點都不低於頂面（加布厚，留 1 mm）
  const at = clothSampler(b)(b.duration), top = LOAD.pos[1] + LOAD.size[1] / 2;
  for (let k = 0; k < b.nodes; k++) {
    const x = at[k * 3], y = at[k * 3 + 1], z = at[k * 3 + 2];
    if (Math.abs(x) < 480 && Math.abs(z) < 380 && y < top + 300) assert.ok(y >= top + 3, `節點 ${k} 掉進貨物（y ${y.toFixed(1)}）`);
  }
  assert.ok(s.box.min[1] >= 3.9, '布邊不穿過地面');
});

test('釘點照 move 移動，until 之後放開自由落下', () => {
  const spec = { size: [400, 400], segments: [8, 8], origin: [0, 1000, 0], duration: 1, pins: [{ edge: 'v0', move: t => [0, 0, 100 * t], until: 0.5 }] };
  const b = bakeCloth(spec), at = clothSampler(b);
  const p = at(0.25), q = at(1);
  // 第 0 列（v0）的節點在 t = 0.25 時照位移走
  for (let i = 0; i <= 8; i++) assert.ok(Math.abs(p[i * 3 + 2] - (-200 + 25)) < 0.5, `v0 第 ${i} 點 z ${p[i * 3 + 2]}`);
  assert.ok(q[1] < 1000 - 200, `放開後掉下來（y ${q[1]}）`);
});

test('軟墊被移動的方塊壓下：碰撞體 pos 可以是函式', () => {
  // 四邊釘住的軟墊（200 × 200），方塊從上面往下壓 30 mm
  const spec = { size: [200, 200], segments: [12, 12], origin: [0, 100, 0], duration: 1, bend: 0.01, stretch: 0.02, shear: 0.02, gravity: 0,
    pins: ['u0', 'u1', 'v0', 'v1'].map(edge => ({ edge })),
    colliders: [{ shape: 'box', size: [60, 40, 60], pos: t => [0, 100 + 23 - 30 * Math.min(1, t * 2), 0] }] };
  const b = bakeCloth(spec), at = clothSampler(b)(1), mid = (6 * 13 + 6) * 3;
  assert.ok(at[mid + 1] < 100 - 20, `中心被壓下（y ${at[mid + 1].toFixed(1)}）`);
});

test('取樣在格點上等於記錄值；顯示的位置與法線都是有限值', () => {
  const b = bakeCloth(clothSmall()), at = clothSampler(b), f = 30, p = at(f / b.hz);
  for (let k = 0; k < b.nodes * 3; k++) assert.equal(p[k], b.data[f * b.nodes * 3 + k]);
  const view = createClothView(b); view.apply(0.77);
  const pos = view.mesh.geometry.attributes.position.array, nor = view.mesh.geometry.attributes.normal.array;
  assert.ok(pos.every(Number.isFinite) && nor.every(Number.isFinite));
  assert.equal(view.mesh.name, 'physics:小布'); assert.ok(view.root.userData.physics);
  view.dispose();
});
