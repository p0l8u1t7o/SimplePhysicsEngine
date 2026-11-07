// core/piping 的純計算測試（不需要 three）。手算值寫在註解裡。
import test from 'node:test';
import assert from 'node:assert/strict';
import { PIPE_SCH40, CONDUIT_EMT, minBendRadius } from '../../piping/sizes.js';
import { routePipe, pathPoints, groundClearance, routeToLink } from '../../piping/route.js';
import { water, colebrook, swameeJain, frictionFactor, pipeLoss, solveNetwork, kBend, fTurbulent, linkK, G, lpm } from '../../piping/hydraulics.js';
import { dcDrop, acDrop, stringDrop, ohmPerM } from '../../piping/cable.js';
import { routeChecks, hydraulicChecks, voltageDropChecks } from '../../piping/checks.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} ± ${tol}`);

test('尺寸表：DN100 LR 彎頭 R = 152、EMT 1" 彎曲半徑 6"', () => {
  assert.equal(minBendRadius('DN100'), 152);
  near(PIPE_SCH40.DN100.ID, 114.3 - 2 * 6.02, 1e-9);
  near(minBendRadius(CONDUIT_EMT['EMT-1']), 6 * 25.4, 1e-9);
  near(minBendRadius('DN50', 'pipe-bend'), 3 * 60.3, 1e-9);
});

test('90° 倒角：L 形 2000＋3000、R = 152 → 展開長度 = 5000 − 2R + πR/2 = 4934.76', () => {
  const r = routePipe([[0, 0, 0], [2000, 0, 0], [2000, 0, 3000]], { size: 'DN100' });
  const b = r.bends[0];
  near(b.angle, 90, 1e-9); near(b.T, 152, 1e-9); near(b.arc, Math.PI * 152 / 2, 1e-9);
  near(r.developed, 5000 - 304 + Math.PI * 76, 1e-9);
  assert.deepEqual(b.start, [1848, 0, 0]); near(b.end[2], 152, 1e-9);
  assert.equal(b.plane, 'horizontal');
  assert.deepEqual(r.fittings, { elbow90: 1 });
  assert.deepEqual(r.cutList, [{ length: 2848, count: 1 }, { length: 1848, count: 1 }]);
  // 圓弧中點到圓心的距離 = R
  const pts = pathPoints(r, { step: 500, arcStep: 5 }), c = b.center;
  for (const p of pts.filter(p => p[0] > 1848 + 1e-6 && p[2] > 1e-6 && p[2] < 152 - 1e-6)) near(Math.hypot(p[0] - c[0], p[2] - c[2]), 152, 1e-6);
});

test('45° 倒角：T = R·tan22.5°、弧長 = πR/4，歸類為 45° 彎頭', () => {
  const r = routePipe([[0, 0, 0], [3000, 0, 0], [6000, 0, 3000]], { size: 'DN50' });
  near(r.bends[0].angle, 45, 1e-9); near(r.bends[0].T, 76 * Math.tan(Math.PI / 8), 1e-9); near(r.bends[0].arc, Math.PI * 76 / 4, 1e-9);
  near(r.developed, 3000 + 3000 * Math.SQRT2 - 2 * 76 * Math.tan(Math.PI / 8) + Math.PI * 19, 1e-9);
  assert.deepEqual(r.fittings, { elbow45: 1 });
});

test('空間不夠：兩彎之間只有 200 mm、R = 152 → 等比例縮成 R = 100，檢查列報出', () => {
  const r = routePipe([[0, 0, 0], [1000, 0, 0], [1000, 0, 200], [0, 0, 200]], { size: 'DN100' });
  assert.equal(r.bends.length, 2);
  for (const b of r.bends) { near(b.R, 100, 1e-9); assert.equal(b.fit, false); }
  const rows = routeChecks(r);
  assert.equal(rows.find(x => x.name.startsWith('彎曲半徑')).ok, false);
  assert.equal(rows.find(x => x.name.startsWith('相鄰彎')).ok, false);
});

test('非標準角度、長料分段與接頭、垂直彎分類', () => {
  const r = routePipe([[0, 0, 0], [8000, 0, 0], [8000 + 1000, 0, 1000 * Math.tan(Math.PI / 6)], [9000, 3000, 577.35]], { size: 'DN50', stock: 6000 });
  assert.equal(r.fittings.elbowCut, 1);                    // 30° 要切角
  assert.ok(r.fittings.coupling >= 1);                    // 第一段 > 6000
  assert.equal(r.bends[1].plane, 'vertical-up');
  assert.equal(routeChecks(r).find(x => x.name.startsWith('彎頭為標準角度')).ok, false);
});

test('坡度：排水 1% 往下，第二段反坡要報；垂直段不算', () => {
  const r = routePipe([[0, 0, 0], [10000, -100, 0], [10000, -1100, 0], [20000, -1000, 0]], { size: 'DN50', bendType: 'pipe-bend', minSlope: .01, flow: 'down' });
  assert.deepEqual(r.slopes.map(s => s.ok), [true, true, false]);
  near(r.slopes[0].slope, -.01, 1e-12);
  assert.equal(r.slopes[1].vertical, true);
  // 連續彎管：整段依庫存長度切，兩個彎在管上
  assert.deepEqual(Object.keys(r.fittings).filter(k => k.startsWith('bend')).length >= 1, true);
});

test('導線管：兩拉線點之間彎曲合計 ≤ 360°', () => {
  const zig = [[0, 0, 0]]; for (let i = 1; i <= 6; i++) zig.push([i * 1000, 0, (i % 2) * 1000]);  // 每個轉角 90°，5 個 = 450°
  const r = routePipe(zig, { size: 'EMT-1' });
  near(r.totalBend, 5 * 90, 1e-6);
  assert.equal(routeChecks(r).find(x => x.name.startsWith('兩拉線點')).ok, false);
});

test('對地淨空：管中心 600、OD 60.3，地面 0 → 淨空 569.85；坡地上報最小值', () => {
  const r = routePipe([[0, 600, 0], [5000, 600, 0]], { size: 'DN50' });
  near(groundClearance(r, () => 0).min, 569.9, .06);
  near(groundClearance(r, x => x * .1).min, 600 - 30.15 - 500, .06);
  const rows = routeChecks(r, { height: () => 0, minClear: 600 });
  assert.equal(rows.at(-1).ok, false);
});

test('水的物性：20 °C ρ = 998.2、μ = 1.002e-3（常用表值）', () => {
  const w = water(20);
  near(w.rho, 998.2, .05); near(w.mu, 1.002e-3, 2e-6);
  near(water(4).rho, 1000, .03);
});

test('摩擦係數：Moody 圖的常用點、Colebrook 殘差、Swamee–Jain 差 < 1.5%', () => {
  // Colebrook 平滑管 Re = 1e5 → 0.0180；ε/D = 0.001、Re = 1e5 → 0.0222；Re = 1e6 → 0.0199（Moody 圖）
  near(colebrook(1e5, 0), .0180, .0001);
  near(colebrook(1e5, .001), .0222, .0001);
  near(colebrook(1e6, .001), .0199, .0001);
  for (const [Re, e] of [[5e3, 1e-4], [1e5, .001], [1e7, 1e-5], [3e5, .01]]) {
    const f = colebrook(Re, e), res = 1 / Math.sqrt(f) + 2 * Math.log10(e / 3.7 + 2.51 / (Re * Math.sqrt(f)));
    near(res, 0, 1e-10, `殘差 Re=${Re}`);
    near(swameeJain(Re, e), f, f * .015, `SJ Re=${Re}`);
  }
  assert.equal(frictionFactor(1000, 0).f, .064);
  assert.equal(frictionFactor(3000, 0).regime, 'transitional');
});

test('層流壓降 = Hagen–Poiseuille 128μLQ/(πD⁴)（解析解）', () => {
  const fl = { rho: 900, mu: .1, nu: .1 / 900 };          // 油
  const r = pipeLoss({ Q: 1e-4, D: .02, L: 10 }, fl);
  assert.equal(r.regime, 'laminar');
  near(r.dp, 128 * .1 * 10 * 1e-4 / (Math.PI * .02 ** 4), 1e-6);
});

// 手算例（Çengel & Cimbala 第 8 章不鏽鋼水管題的條件）：15 °C 水 ρ = 999.1、μ = 1.138e-3，D = 5 cm、L = 60 m、Q = 6 L/s、ε = 0.002 mm
//   V = 0.006 / (π·0.025²) = 3.0558 m/s；Re = 999.1·3.0558·0.05/1.138e-3 = 134 140；ε/D = 4e-5
//   Colebrook → f = 0.01719（以殘差驗證）；hL = f·(L/D)·V²/2g = 0.01719·1200·0.47609 = 9.820 m；ΔP = ρ·g·hL = 96.2 kPa
test('單管壓降（手算）', () => {
  const fl = { rho: 999.1, mu: 1.138e-3, nu: 1.138e-3 / 999.1 };
  const r = pipeLoss({ Q: .006, D: .05, L: 60, eps: 2e-6 }, fl);
  near(r.v, 3.0558, 1e-4); near(r.Re, 134140, 5); near(r.f, .01719, 5e-5);
  near(r.hf, .01719 * 1200 * 3.0558 ** 2 / (2 * G), .03); near(r.dp / 1000, 96.2, .3);
});

test('樹狀管網：泵揚程 = 高程 + 需求壓力頭 + 沿程與局部損失（手算串接）', () => {
  const fl = water(20);
  // 水池（z 0）→ 10 m 高的噴嘴，DN50 SCH40 50 m，兩個 LR 彎頭（K 0.3）＋球閥（0.05）；噴嘴要 2 bar
  const D = PIPE_SCH40.DN50.ID / 1000, Q = lpm(120);
  const res = solveNetwork({
    nodes: [{ id: 'tank', z: 0 }, { id: 'nozzle', z: 10, demand: Q, pMin: 2e5 }],
    links: [{ id: 'p1', from: 'tank', to: 'nozzle', L: 50, D, eps: 4.5e-5, fittings: ['elbow90-flanged', 'elbow90-flanged', 'valve-ball'] }],
    source: { node: 'tank', suction: 0 }, fluid: fl,
  });
  const one = pipeLoss({ Q, D, L: 50, eps: 4.5e-5, K: .65 }, fl);
  near(res.source.requiredHead, 10 + 2e5 / (fl.rho * G) + one.dh, 1e-9);
  near(res.pump.head, res.source.requiredHead, 1e-12);
  near(res.nodes[1].p, 2e5, 1e-6);                         // 水源水頭取剛好滿足的值
  assert.ok(hydraulicChecks(res).every(r => r.ok));
  near(res.pump.hydraulicW, fl.rho * G * Q * res.pump.head, 1e-9);
});

test('迴路（Hardy Cross）：兩支相同的並聯管各分一半；不同長度時兩路水頭損失相同、連續方程成立', () => {
  const nodes = [{ id: 'S', z: 0 }, { id: 'A', z: 0 }, { id: 'B', z: 0, demand: .004 }];
  const same = solveNetwork({ nodes, links: [{ id: 1, from: 'S', to: 'A', L: 10, D: .05 }, { id: 2, from: 'A', to: 'B', L: 80, D: .04 }, { id: 3, from: 'B', to: 'A', L: 80, D: .04 }], source: { node: 'S', pressure: 3e5 } });
  near(same.links[1].Q, .002, 1e-9); near(same.links[2].Q, -.002, 1e-9);
  const diff = solveNetwork({ nodes, links: [{ id: 1, from: 'S', to: 'A', L: 10, D: .05 }, { id: 2, from: 'A', to: 'B', L: 100, D: .04 }, { id: 3, from: 'A', to: 'B', L: 50, D: .04, fittings: ['valve-globe'] }], source: { node: 'S', pressure: 3e5 } });
  near(diff.links[1].dh, diff.links[2].dh, 1e-9);
  near(diff.links[1].Q + diff.links[2].Q, .004, 1e-12);
  assert.ok(diff.loopResidual < 1e-9);
  // 決定性
  assert.equal(JSON.stringify(diff), JSON.stringify(solveNetwork({ nodes, links: [{ id: 1, from: 'S', to: 'A', L: 10, D: .05 }, { id: 2, from: 'A', to: 'B', L: 100, D: .04 }, { id: 3, from: 'A', to: 'B', L: 50, D: .04, fittings: ['valve-globe'] }], source: { node: 'S', pressure: 3e5 } })));
});

test('彎管 K（Crane）與路徑轉 1D 管段', () => {
  const fT = fTurbulent(4.5e-5 / .0525);
  near(kBend(90, 1.5, fT), 14 * fT, 1e-12); near(kBend(45, 3, fT), 6 * fT, 1e-12);
  const r = routePipe([[0, 0, 0], [5000, 0, 0], [5000, 0, 5000]], { size: 'DN50', bendType: 'pipe-bend' });
  const link = routeToLink(r);
  near(link.L, r.developed / 1000, 1e-12); near(link.bends[0].rOverD, 3 * 60.3 / 52.48, 1e-9);
  assert.ok(linkK({ ...link }) > 0);
});

test('電壓降（手算）：4 mm² 銅、單程 50 m、10 A', () => {
  // ρ20 = 1/58：R' = 0.017241/4 = 4.3103 Ω/km；迴路 R = 0.1 km × 4.3103 = 0.43103 Ω；ΔV = 4.3103 V；600 V 時 0.718%
  const a = dcDrop({ I: 10, V: 600, length: 50, area: 4 });
  near(a.dV, 4.3103, 1e-4); near(a.pct, .7184, 1e-4); near(a.lossW, 43.103, 1e-3);
  // IEC 60228 第 5 類鍍錫 4 mm² = 5.09 Ω/km：ΔV = 0.1 × 5.09 × 10 = 5.09 V；70 °C 時 × (1 + 0.00393·50) = 1.1965
  near(dcDrop({ I: 10, V: 600, length: 50, cable: 'PV-4', T: 20 }).dV, 5.09, 1e-9);
  near(ohmPerM({ cable: 'PV-4', T: 70 }) * 1000, 5.09 * 1.1965, 1e-9);
  // 三相：√3 · L · I · (R cosφ + X sinφ)，pf 1 時只剩 R
  near(acDrop({ I: 100, V: 400, length: 100, area: 50, pf: 1, T: 20 }).dV, Math.sqrt(3) * 100 * 100 * (1 / 58 / 50), 1e-9);
  const s = stringDrop({ modules: 20, vmp: 41.6, imp: 13.2, length: 80, slack: 1, cable: 'PV-6', T: 20 });
  near(s.dV, 2 * 80 * 13.2 * 3.39 / 1000, 1e-9);
  assert.equal(voltageDropChecks([{ id: 'S1', ...s }]).every(r => r.ok), true);
});
