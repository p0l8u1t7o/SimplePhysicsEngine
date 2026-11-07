// node --import ./core/tools/register.mjs --test "TEMP/physx-dev/test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { bakeFluid, fluidSampler, fluidStats, createFluidView } from '../fluid.js';
import { fill, TANK_INSIDE } from '../../examples/physics/scenarios-extra.js';
import { verifyPhysics } from '../../verify/physics.mjs';
import { fluidSmall, drumSmall } from './specs.js';

test('流體：同一份設定烘焙兩次逐位元相同（含渦度補償、fill、斜噴嘴）', () => {
  const a = bakeFluid(fluidSmall()), b = bakeFluid(fluidSmall());
  assert.equal(a.stats.hash, b.stats.hash);
  assert.deepEqual(Buffer.from(a.data.buffer), Buffer.from(b.data.buffer));
  assert.ok(a.stats.particles > 500);
});

test('注入方槽：液體全部留在槽內、流量照設定、密度誤差小', () => {
  const b = bakeFluid(fill());
  assert.equal(b.stats.emitters[0].flowLmin, 40, '噴嘴流量照設定（層距微調）');
  assert.equal(b.stats.particles, 2000, '40 L/min × 3 s = 2 L = 2000 顆 1 mL');
  const s = fluidStats(b, b.duration, { region: TANK_INSIDE });
  assert.equal(s.count, s.total, `槽外 ${s.outside} 顆`);
  assert.equal(b.stats.killed, 0);
  assert.ok(b.stats.avgDensityError < 0.03, `平均密度誤差 ${b.stats.avgDensityError}`);
  // 液面：表面（95 百分位的粒子中心）＋半顆粒徑，和體積換算的液位差 15% 以內（壓縮、離散）
  assert.ok(Math.abs(s.surface + 5 - s.level) / s.level < 0.15, `表面 ${s.surface}／液位 ${s.level}`);
  assert.ok(b.stats.maxPenetration < 1);
});

test('粒子數守恆：注入 = 存活 + 移除；kill 區會移除', () => {
  const spec = { spacing: 10, duration: 1.5, emitters: [{ type: 'nozzle', pos: [0, 200, 0], dir: [1, 0, 0], speed: 1500, flow: 20 }],
    colliders: [{ shape: 'plane', y: 0 }], kill: [{ min: [400, -100, -1000], max: [2000, 1000, 1000] }] };
  const b = bakeFluid(spec);
  assert.ok(b.stats.killed > 0, '噴到 x > 400 的被移除');
  assert.equal(b.stats.particles, b.stats.alive + b.stats.killed);
  const { count, positions } = fluidSampler(b)(b.duration);
  for (let q = 0; q < count; q++) assert.ok(positions[q * 3] < 400 + 30, `第 ${q} 顆在 kill 區裡（x ${positions[q * 3]}）`);
});

test('fill（初始液塊）靜置後體積不變、不會散掉，圓桶裝填不漏', () => {
  const dam = bakeFluid({ spacing: 10, duration: 1.5, emitters: [{ type: 'fill', min: [-100, 0, -50], max: [0, 100, 50] }],
    colliders: [{ shape: 'tank', size: [300, 200, 100], wall: 10, pos: [0, 0, 0] }] });
  assert.equal(dam.stats.particles, 1000);
  const s = fluidStats(dam, dam.duration, { region: { min: [-150, -1, -50], max: [150, 200, 50] } });
  assert.equal(s.count, 1000, '潰壩後都在槽內');
  assert.ok(s.surface < 60, `液塊攤開（表面 ${s.surface}）`);
  const drum = bakeFluid(drumSmall()), d = fluidStats(drum, drum.duration, { region: drum.spec.contain });
  assert.equal(d.count, d.total, `圓桶外 ${d.outside} 顆`);
});

test('上限 max：到了就停止注入並標記 capped', () => {
  const b = bakeFluid({ spacing: 10, duration: 1, max: 300, emitters: [{ type: 'nozzle', pos: [0, 200, 0], dir: [0, -1, 0], speed: 1500, flow: 60 }], colliders: [{ shape: 'plane', y: 0 }] });
  assert.equal(b.stats.particles, 300); assert.ok(b.stats.capped);
});

test('取樣與顯示：格點上的數量與記錄相同，points 與 spheres 都能建立', () => {
  const b = bakeFluid(fluidSmall()), at = fluidSampler(b), f = 20, r = at(f / b.hz);
  assert.equal(r.count, b.offsets[f + 1] - b.offsets[f]);
  for (const mode of ['points', 'spheres']) {
    const v = createFluidView(b, { mode }); v.apply(1.1);
    assert.ok(v.root.userData.physics); assert.equal(v.mesh.name, 'physics:小流體'); v.dispose();
  }
});

test('檢查提案：cloth 與 fluid 都能重烘比雜湊，漏出容器會擋', async () => {
  const ok = await verifyPhysics({ physics: [bakeFluid(drumSmall())] });
  assert.ok(ok.ok, ok.failures.join('；'));
  // 噴嘴偏到槽外：containTol 擋下
  const bad = { ...fill({ stop: 1 }), duration: 1.5 }; bad.emitters = [{ ...bad.emitters[0], pos: [200, 500, 0] }];
  const r = await verifyPhysics({ physics: [bakeFluid(bad)] });
  assert.ok(!r.ok && r.failures.some(f => f.includes('留在容器內')), r.failures.join('；'));
});
