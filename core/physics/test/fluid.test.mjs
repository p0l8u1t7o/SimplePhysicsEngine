// node --import ./core/tools/register.mjs --test "core/physics/test/*.test.mjs"
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

test('噴嘴截面：斜噴嘴的粒子分布在半徑內、最外圈貼近半徑（截面基底有正規化）', () => {
  const R = 40, d = [1, 1, 0], dl = Math.SQRT2, pos = [0, 0, 0];
  const b = bakeFluid({ spacing: 10, duration: 1 / 60, dt: 1 / 120, hz: 120, gravity: 0, iterations: 0, emitters: [{ type: 'nozzle', pos, dir: d, speed: 1800, radius: R }] });   // 不解密度約束：只看噴出來的截面
  const f = fluidSampler(b)(b.duration);
  assert.ok(f.count > 10, `第一格就有粒子：${f.count}`);
  let far = 0;
  for (let k = 0; k < f.count; k++) {
    const x = f.positions[3 * k] - pos[0], y = f.positions[3 * k + 1] - pos[1], z = f.positions[3 * k + 2] - pos[2];
    const along = (x * d[0] + y * d[1] + z * d[2]) / dl, r2 = x * x + y * y + z * z - along * along;
    far = Math.max(far, Math.sqrt(Math.max(0, r2)));
  }
  assert.ok(Math.abs(far - R) < 0.5, `離軸最遠 ${far.toFixed(2)} mm，應約 ${R}（截面基底沒正規化時斜噴嘴只有 0.707 倍）`);
});

test('休眠（sleep）：注入停止、靜置後停下，之後的格和停下時相同；液面和不休眠的差 < 1 mm；有會動的碰撞面時不睡', () => {
  const base = { ...fill(), duration: 7 }, ref = bakeFluid(base), b = bakeFluid({ ...base, sleep: {} });
  const at = b.stats.sleptAt;
  assert.ok(at > 3 && at < 7, `停下的時間 ${at}`);
  assert.equal(ref.stats.sleptAt, undefined, '沒開休眠就沒有 sleptAt');
  const s = fluidSampler(b), p = s(Math.ceil(at * b.hz) / b.hz + 0.1).positions.slice(), q = s(b.duration).positions;
  assert.deepEqual(Array.from(q), Array.from(p), '停下之後每格相同');
  const level = x => fluidStats(x, x.duration, { region: TANK_INSIDE }).surface;
  assert.ok(Math.abs(level(b) - level(ref)) < 1, `表面 ${level(b)}／${level(ref)}`);
  assert.equal(bakeFluid({ ...base, sleep: {} }).stats.hash, b.stats.hash, '休眠一樣是決定性的');
  const moving = bakeFluid({ ...base, duration: 4.5, sleep: { speed: 1e6 }, colliders: [...base.colliders, { shape: 'sphere', r: 5, pos: t => [5000, 0, t] }] });
  assert.equal(moving.stats.sleptAt, null, '碰撞面會動就不睡');
});

test('圓形容器的連續碰撞：一個子步就整個穿過薄桶壁或薄底板的快粒子，推回原本那一側', async () => {
  const { prepColliders, pushOut } = await import('../collide.js');
  const cs = prepColliders([{ shape: 'drum', r: 200, h: 300, wall: 2, pos: [0, 0, 0] }]);
  const run = (from, to) => { const p = new Float64Array(to), prev = new Float64Array(from); pushOut(cs, p, prev, 0, 5, 0); return Array.from(p); };
  const out = run([190, 100, 0], [215, 100, 0]);                         // 內側 190 → 外側 215（壁 200～202，加上半徑 5 是 195～207）
  assert.ok(out[0] <= 195 + 1e-9, `往外穿壁要推回內側：x ${out[0]}`);
  const back = run([215, 100, 0], [190, 100, 0]);
  assert.ok(back[0] >= 207 - 1e-9, `從外面穿進來要推回外側：x ${back[0]}`);
  assert.deepEqual(run([190, 330, 0], [215, 300, 0]).map(Math.round), [215, 300, 0], '從壁頂上方越過（交點高於壁頂＋半徑）不算');
  const down = run([50, 10, 0], [50, -12, 0]);                           // 底板 −2～0，加上半徑是 −7～5
  assert.ok(down[1] >= 5 - 1e-9, `往下穿過底板要推回上面：y ${down[1]}`);
  assert.deepEqual(run([260, 10, 0], [260, -12, 0]).map(Math.round), [260, -12, 0], '底板外面不擋');
  // 整段烘焙：高速往桶壁噴，粒子都留在桶內
  const b = bakeFluid({ spacing: 10, duration: 0.6, dt: 1 / 60, emitters: [{ type: 'nozzle', pos: [0, 150, 0], dir: [1, 0, 0], speed: 3000, radius: 12, stop: 0.2 }],
    colliders: [{ shape: 'drum', r: 200, h: 300, wall: 2, pos: [0, 0, 0] }] });
  const { count, positions } = fluidSampler(b)(b.duration);
  for (let q = 0; q < count; q++) { const x = positions[q * 3], z = positions[q * 3 + 2]; assert.ok(Math.sqrt(x * x + z * z) < 200 && positions[q * 3 + 1] > -5, `第 ${q} 顆穿出桶外 (${x}, ${positions[q * 3 + 1]}, ${z})`); }
});
