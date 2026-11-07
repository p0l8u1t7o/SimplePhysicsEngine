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

// 自我碰撞：把地上的布對摺（v1 邊抬起、翻到 v0 那側放下），沒開的話上層會穿過下層貼到地面；開了要保持約 2·radius
test('布料自我碰撞：對摺時上層不穿過下層；不開時結果和之前相同', () => {
  const fold = self => ({ name: 'fold', size: [600, 600], segments: [12, 12], origin: [0, 3, 0], duration: 3, settle: 0, bend: 5, friction: 0.6,
    colliders: [{ shape: 'plane', y: 0 }], pins: [{ edge: 'v1', until: 2.1, move: t => { const u = Math.min(1, t / 2); return [0, 260 * Math.sin(Math.PI * u) + 60 * u, -540 * u]; } }],
    ...(self ? { selfCollision: true } : {}) });
  const off = bakeCloth(fold(false)), on = bakeCloth(fold(true)), again = bakeCloth(fold(true));
  assert.equal(on.stats.hash, again.stats.hash, '開了自我碰撞也是決定性的');
  assert.equal(off.stats.selfMin, undefined);
  // 結束時：同一個 (x, z) 附近上下兩層的高度差。找 y 最高的 10% 節點，看它們正下方最近的下層節點
  const gap = b => {
    const P = clothSampler(b)(b.duration), N = b.nodes, ys = [];
    for (let k = 0; k < N; k++) ys.push(P[k * 3 + 1]);
    let worst = Infinity;
    for (let k = 0; k < N; k++) {
      if (P[k * 3 + 1] < 15) continue;                                   // 上層（離地 > 15 mm）
      for (let m = 0; m < N; m++) {
        if (P[m * 3 + 1] > 15) continue;                                 // 下層（貼地）
        const dx = P[k * 3] - P[m * 3], dz = P[k * 3 + 2] - P[m * 3 + 2];
        if (dx * dx + dz * dz < 20 * 20) worst = Math.min(worst, P[k * 3 + 1] - P[m * 3 + 1]);
      }
    }
    return { worst, upper: ys.filter(y => y >= 15).length };
  };
  const g1 = gap(on), g0 = gap(off), R = on.stats.selfRadius;
  assert.ok(g1.upper > 20, `開了自我碰撞要有上層：${g1.upper} 個節點離地 > 15 mm`);
  assert.ok(g1.worst > 1.5 * R, `上下層間距 ${g1.worst.toFixed(1)} mm 應 > 1.5 × radius（${R.toFixed(1)}）`);
  assert.ok(g0.upper < g1.upper, `不開時上層會穿下去貼地（離地節點 ${g0.upper} 個，開了 ${g1.upper} 個）`);
  assert.ok(on.stats.maxStretch < 0.1, `伸長 ${on.stats.maxStretch}`);
});
