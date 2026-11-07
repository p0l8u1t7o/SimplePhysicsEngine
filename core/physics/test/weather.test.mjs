// node --import ./core/tools/register.mjs --test "TEMP/physx-dev/test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { precipitation, precipPoints, precipSegments, createPrecipView } from '../../weather/precip.js';
import { snowOnPanels, slideCheck, snowSampler, createSnowCover } from '../../weather/snow.js';
import { snowLoad, velocityPressure, panelWindLoad } from '../../weather/loads.js';
import { runoff, slopeDir, panelRunoff } from '../../weather/runoff.js';
import { contact, prepColliders } from '../collide.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('雨雪是 t 的函數：跳著取樣和依序取樣結果相同，位置在範圍內', () => {
  const spec = { kind: 'snow', area: { min: [-2000, -2000], max: [2000, 2000] }, top: 4000, wind: [300, 0], gust: { amp: [200, 100], period: 5 }, seed: 9 };
  const P = precipitation(spec), a = precipPoints(P, 7.3).slice();
  precipPoints(P, 1.1); precipPoints(P, 100);
  assert.deepEqual(precipPoints(P, 7.3), a);
  assert.equal(P.count, 400, '25 顆/m² × 16 m²');
  for (let i = 0; i < P.count; i++) {
    const y = a[i * 3 + 1]; assert.ok(y >= 0 && y <= 4000, `y ${y}`);
    assert.ok(Math.abs(a[i * 3 + 2]) <= 2000 + 400, `z ${a[i * 3 + 2]}`);
  }
  // 平均 x 大約在範圍中心（往上風挪半個漂移量）
  let mx = 0; for (let i = 0; i < P.count; i++) mx += a[i * 3]; mx /= P.count;
  assert.ok(Math.abs(mx) < 600, `平均 x ${mx}`);
});

test('雨絲：尾端在頭的上方、順著風斜；floor 下面的藏起來', () => {
  const P = precipitation({ kind: 'rain', area: { min: [-1000, -1000], max: [1000, 1000] }, wind: [2000, 0], floor: (x, z) => (x > 0 ? 1500 : 0), top: 3000 });
  const s = precipSegments(P, 2.5);
  let hidden = 0;
  for (let i = 0; i < P.count; i++) {
    const k = i * 6;
    if (s[k + 1] < -1e6) { hidden++; continue; }
    assert.ok(s[k + 4] > s[k + 1], '尾端比較高'); assert.ok(s[k + 3] < s[k], '風往 +x，尾端在上風處');
    if (s[k] > 0) assert.ok(s[k + 1] >= 1500, '屋頂上方');
  }
  assert.ok(hidden > 0);
  const v = createPrecipView({ kind: 'snow', count: 100 }); v.apply(3); assert.equal(v.mesh.geometry.attributes.position.count, 100); v.dispose();
});

test('積雪：40° 玻璃會滑落、10° 不會；滑落的面板比較早清空、發電損失比較小', () => {
  // 前 6 小時下雪（2 cm/h、−3 °C），之後白天 1 °C、日射 450 W/m²，夜間 −4 °C
  const day = t => t % 24 > 8 && t % 24 < 16;
  const weather = t => t < 6 ? { snowfall: 2, temp: -3, poa: 0 } : { snowfall: 0, temp: day(t) ? 1 : -4, poa: day(t) ? 450 : 0 };
  const r = snowOnPanels({ hours: 72, weather, panels: [{ id: 'p10', tilt: 10 }, { id: 'p40', tilt: 40 }] });
  const [p10, p40] = r.panels;
  assert.equal(p10.timeline.sliding.reduce((a, b) => a + b, 0), 0, '10° 玻璃從頭到尾沒有滑');
  assert.ok(p40.timeline.sliding.reduce((a, b) => a + b, 0) > 0, '40° 玻璃有滑落');
  assert.ok(p40.clearedAt < p10.clearedAt, `清空時間 40°：${p40.clearedAt} h／10°：${p10.clearedAt} h`);
  assert.ok(p40.energyLoss < p10.energyLoss);
  assert.ok(p10.maxDepth > p40.maxDepth, '斜面接到的雪 ∝ cosβ');
  // 取樣：t = 3 h 時兩片都蓋滿
  assert.equal(snowSampler(r, 'p10')(3).coverage, 1);
  const c = createSnowCover({ width: 1100, length: 2200 }); c.apply(snowSampler(r, 'p40')(3)); assert.ok(c.mesh.visible); c.dispose();
});

test('滑落的力平衡：濕玻璃臨界角約 11°、乾雪要夠厚才會滑', () => {
  near(slideCheck({ tilt: 30, swe: 20, wet: true }).criticalTilt, Math.atan(0.2) * 180 / Math.PI, 0.1, '濕：atan(μ)');
  assert.equal(slideCheck({ tilt: 40, swe: 5, wet: false }).slides, false, '乾的薄雪黏住');
  assert.equal(slideCheck({ tilt: 40, swe: 30, wet: false }).slides, true, '乾的厚雪滑下');
  assert.equal(slideCheck({ tilt: 30, swe: 20, wet: true, surface: 'shingle' }).slides, false, '瀝青瓦摩擦大');
});

test('雪載重估算：三種規範形式的手算值', () => {
  const a = snowLoad({ method: 'asce7', ground: 1.0, tilt: 30 });         // 0.7 × 1.2 × 1.0 = 0.84；Cs = (70 − 30)／55
  near(a.flat, 0.84, 1e-3); near(a.slopeFactor, 40 / 55, 1e-3); near(a.sloped, 0.84 * 40 / 55, 1e-3);
  assert.equal(snowLoad({ method: 'asce7', ground: 1, tilt: 10 }).slopeFactor, 1, '光滑、Ct 1.2：15° 以下不折減');
  assert.equal(snowLoad({ method: 'asce7', ground: 1, tilt: 30, slippery: false }).slopeFactor, 1, '不光滑：45° 以下不折減');
  near(snowLoad({ method: 'en1991', ground: 1.0, tilt: 45 }).sloped, 0.4, 1e-3, 'μ1 = 0.8 × 15／30');
  near(snowLoad({ method: 'jis', depth: 100, tilt: 30 }).sloped, 2 * Math.sqrt(Math.cos(45 * Math.PI / 180)), 1e-3);
  assert.equal(snowLoad({ method: 'jis', depth: 100, tilt: 61 }).sloped, 0);
  const s = snowLoad({ method: 'en1991', ground: 2, tilt: 20 }), c = Math.cos(20 * Math.PI / 180);
  near(s.normal, s.sloped * c * c, 1e-3); near(s.tangential, s.sloped * c * Math.sin(20 * Math.PI / 180), 1e-3);
});

test('風載重估算：速度壓與陣列係數的手算值', () => {
  const tw = velocityPressure({ code: 'tw', V: 40, z: 10, exposure: 'C' });   // K(10) = 2.774 × (10／300)^0.3 ≈ 1.00
  const K10 = 2.774 * (10 / 300) ** 0.3; near(tw.Kz, K10, 1e-3); near(tw.q, 0.06 * 9.80665 * K10 * 1600, 0.06);
  const us = velocityPressure({ code: 'asce7', V: 50, z: 2, exposure: 'C' });  // z < 4.57 m 用 4.57
  const Kz = 2.01 * (4.57 / 274.32) ** (2 / 9.5); near(us.Kz, Kz, 1e-3); near(us.q, 0.613 * Kz * 0.85 * 2500, 0.06);
  const w = panelWindLoad({ q: 1000, tilt: 30, area: 2 });
  near(w.Cdown, 0.65 + 0.27, 1e-6); near(w.Cup, 0.71 + 0.48, 1e-6); assert.equal(w.forceUp, Math.round(1000 * 1.19 * 2));
  assert.equal(panelWindLoad({ q: 1000, tilt: 5 }).Cdown, panelWindLoad({ q: 1000, tilt: 15 }).Cdown, '15° 以下夾到 15°');
});

test('逕流：流向沿最陡下坡、和法向垂直；雨越大集流越快；低傾角提醒', () => {
  const { dir } = slopeDir({ tilt: 25, azimuth: 90 }), b = 25 * Math.PI / 180, n = [Math.sin(b), Math.cos(b), 0];
  near(dir[0] * n[0] + dir[1] * n[1] + dir[2] * n[2], 0, 1e-12, '垂直法向'); assert.ok(dir[1] < 0 && dir[0] > 0, '往下、往面板朝向');
  const r1 = runoff({ tilt: 20, length: 2000, width: 1000, intensity: 20 }), r2 = runoff({ tilt: 20, length: 2000, width: 1000, intensity: 80 });
  assert.ok(r2.tc < r1.tc && r2.Q > r1.Q);
  near(r1.Q, 0.95 * 20 * 2 * Math.cos(b * 20 / 25) / 3600, 1e-4, '合理化公式（水平投影面積）');
  assert.ok(runoff({ tilt: 3 }).warnings.length > 0);
  assert.equal(panelRunoff([{ id: 'a', tilt: 20 }, { id: 'b', tilt: 2 }], 30).warnings.length, 1);
});

test('碰撞：薄板 CCD、從上一步所在的一側推出、tank 與 drum 展開', () => {
  const [box] = prepColliders([{ shape: 'box', size: [100, 10, 100], pos: [0, 0, 0] }]), n = [0, 0, 0];
  // 一步從 y = 20 穿到 y = −20（整個穿過 10 mm 厚的板）：推回上面
  const d = contact(box, 0, -20, 0, 2, n, [0, 20, 0]);
  assert.ok(d > 0 && n[1] === 1); near(-20 + d, 7, 1e-9);
  // 停在板裡、比較靠下面，但上一步在上方：還是推回上面
  const e = contact(box, 0, -3, 0, 2, n, [0, 10, 0]); assert.equal(n[1], 1); near(-3 + e, 7, 1e-9);
  assert.equal(prepColliders([{ shape: 'tank', size: [100, 100, 100] }]).length, 5);
  const [bottom, wall] = prepColliders([{ shape: 'drum', r: 100, h: 200, wall: 5 }]);
  assert.equal(bottom.shape, 'cylinder'); assert.equal(wall.shape, 'annulus');
  const w = contact(wall, 98, 100, 0, 4, n); assert.ok(w > 0); near(n[0], -1, 1e-12, '桶壁內側往內推');
});

test('決定性三角函數 dsin／dcos／dexp 和 Math 版相差 < 1e-14', async () => {
  const { dsin, dcos, dexp } = await import('../collide.js');
  let es = 0, ec = 0, ee = 0;
  for (let i = -20000; i <= 20000; i++) {
    const x = i * 0.0137; es = Math.max(es, Math.abs(dsin(x) - Math.sin(x))); ec = Math.max(ec, Math.abs(dcos(x) - Math.cos(x)));
    const y = i * 0.001; ee = Math.max(ee, Math.abs(dexp(y) - Math.exp(y)) / Math.exp(y));
  }
  assert.ok(es < 1e-14 && ec < 1e-14 && ee < 1e-14, `sin ${es}、cos ${ec}、exp ${ee}`);
});
