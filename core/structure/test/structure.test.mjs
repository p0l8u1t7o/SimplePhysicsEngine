// core/structure 的純計算測試（不需要 three）。手算值寫在註解裡。
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, sectionArea } from '../profiles.js';
import { splitStock } from '../members.js';
import { layoutFixedRack } from '../rack.js';
import { layoutTracker, rotatePoint } from '../tracker.js';
import { structureChecks } from '../checks.js';
import { cfMonoslope, windPressure, snowOnPlane, snowMu1, groupLoads } from '../loads.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} ± ${tol}`);
const COS30 = Math.cos(Math.PI / 6);

test('斷面積公式對照型錄（JIS）單位重 ±1%', () => {
  for (const p of Object.values(PROFILES)) if (p.ref) near(p.kgPerM, p.ref, p.ref * .01, p.id);
  // H150×150×7×10、r = 8：2·150·10 + 130·7 + 4(1−π/4)·64 = 3000 + 910 + 54.94 = 3964.9 mm²（JIS 39.65 cm²）
  near(sectionArea(PROFILES['H150x150x7x10']), 3964.9, .1);
  // C100×50×20×2.3：2.3·(100+100+40−9.2) − 4(1−π/4)(4.6²−2.3²) = 530.84 − 13.62 = 517.2 mm²（JIS 5.172 cm²）
  near(sectionArea(PROFILES['C100x50x20x2.3']), 517.2, .1);
  // 圓管 114.3×4.5：π·4.5·109.8 = 1552.3 mm²
  near(sectionArea(PROFILES['CHS114.3x4.5']), 1552.3, .1);
});

test('長料分段：接頭靠到支點，超過庫存長度就退回等分', () => {
  assert.deepEqual(splitStock(5000, 6000), [[0, 5000]]);
  assert.deepEqual(splitStock(10000, 6000, [4800, 7000]), [[0, 4800], [4800, 10000]]);
  assert.deepEqual(splitStock(10000, 6000, [1000]), [[0, 5000], [5000, 10000]]);   // 1000 會讓第二段 9000 > 6000
});

// 手算用的小桌：模組 2000×1000、間隙 0、2P 直放、傾角 30°、每桌 4 片、低邊離地 500
// 斜長 S = 4000；檁條 Z150、斜樑 C150 → 樁頂在模組下緣下方 300 mm（沿法向）
// 前樁 s = 1000：y = 500 + 1000·sin30 − 300·cos30 = 740.19；z = −1000·cos30 − 300·sin30 = −1016.03
// 後樁 s = 3000：y = 1740.19；z = −2748.08
const small = extra => layoutFixedRack({ module: { L: 2000, W: 1000, T: 35, kg: 25, wp: 500 }, gap: 0, up: 2, across: 4, tilt: 30, clearance: 500,
  rows: 1, postAt: [.25, .75], ...extra });

test('固定式：平地的樁頂、外露與樁長（手算）', () => {
  const L = small(), piles = L.members.filter(m => m.kind === 'pile');
  assert.equal(L.summary.slopeLength, 4000);
  assert.equal(L.summary.framesPerTable, 2);               // 桌長 4000，端距 800 → (4000 − 1600)/4000 → 2 個框架
  near(L.summary.frameSpacing, 2400, .05);
  const front = piles.find(m => m.id.endsWith('F1-pileFront')), rear = piles.find(m => m.id.endsWith('F1-pileRear'));
  near(front.top, 500 + 500 - 300 * COS30, .1); near(front.mid[2], -1000 * COS30 - 150, .1);
  near(rear.top, 500 + 1500 - 300 * COS30, .1); near(rear.mid[2], -3000 * COS30 - 150, .1);
  near(front.embed, 1500, 1e-9); near(front.length, front.reveal + 1500, .11);
  near(front.kg, 31.125 * front.length / 1000, .02);       // H150 單位重 31.125 kg/m（公式）
  assert.equal(L.tables[0].clearMin, 500);
  assert.ok(structureChecks(L).every(r => r.ok), JSON.stringify(structureChecks(L).filter(r => !r.ok)));
});

test('固定式：橫向坡地（地面 0.1·z），前後樁外露差 = 1000 + 0.1·(2748.08 − 1016.03)', () => {
  const L = small({ height: (x, z) => .1 * z });
  const p = L.members.filter(m => m.kind === 'pile' && m.frame === 0), f = p.find(m => m.id.endsWith('Front')), r = p.find(m => m.id.endsWith('Rear'));
  near(r.reveal - f.reveal, 1000 + .1 * (2000 * COS30), .2);
  near(f.ground, .1 * (-1000 * COS30 - 150), .1);
  near(L.tables[0].clearMin, 500, .05);                    // 地面往後變低，最緊的是低邊
});

test('固定式：沿列 5% 坡，桌面跟著坡，同一排樁外露相同', () => {
  const L = small({ across: 12, height: (x, z) => .05 * x });
  near(L.tables[0].gx, .05, 1e-9);
  const fronts = L.members.filter(m => m.id.endsWith('pileFront'));
  assert.ok(fronts.length >= 3);
  for (const m of fronts) near(m.reveal, fronts[0].reveal, .15, m.id);
});

test('固定式：坡度超過上限時桌面被限制、樁長吸收，檢查列報出', () => {
  const L = small({ across: 12, height: (x, z) => .2 * x, maxRowSlope: .1 });
  near(L.tables[0].gx, .1, 1e-9);
  const row = structureChecks(L).find(r => r.name.startsWith('地面沿列坡度'));
  assert.equal(row.ok, false);
  near(L.tables[0].clearMin, 500, .05);
});

test('固定式：固定樁長時埋深 = 樁長 − 外露，低於下限要報', () => {
  const L = small({ pile: { length: 3000, embed: null, minEmbed: 1300 } });
  const rear = L.members.find(m => m.id.endsWith('F1-pileRear'));
  near(rear.embed, 3000 - rear.reveal, .11);
  near(rear.length, 3000, .1);
  const row = structureChecks(L).find(r => r.name.startsWith('基樁埋深'));
  assert.equal(row.ok, false);                             // 後樁外露 1740 → 埋深 1260 < 1300
});

test('固定式：BOM 合計等於構件逐支加總、切長清單數量一致', () => {
  const L = layoutFixedRack({ rows: 2, tablesPerRow: 2, height: (x, z) => 300 * Math.sin(x / 5000) + .05 * z });
  const kg = L.members.reduce((t, m) => t + m.kg, 0);
  near(L.bom.total.kg, kg, .1);
  near(L.bom.byProfile.reduce((t, b) => t + b.kg, 0), kg, .2);
  assert.equal(L.bom.cuts.reduce((t, c) => t + c.count, 0), L.members.length);
  assert.equal(L.modules.length, 2 * 2 * 2 * 20);
  // 決定性：同參數兩次結果完全相同
  assert.deepEqual(JSON.stringify(layoutFixedRack({ rows: 2, height: (x, z) => 300 * Math.sin(x / 5000) })), JSON.stringify(layoutFixedRack({ rows: 2, height: (x, z) => 300 * Math.sin(x / 5000) })));
});

// 追日：模組 2278 直放 1P，扭力管 SHS125（半高 62.5）＋檁條 C75 → 轉軸到模組下緣 e = 137.5
// 轉 60° 時下緣相對轉軸：137.5·cos60 − 1139·sin60 = 68.75 − 986.403 = −917.653
// 平地、淨空 500 → 軸高 1417.653；樁頂 = 軸高 − 120 → 外露 1297.653
test('追日：平地軸高與樁外露（手算）', () => {
  const T = layoutTracker({ rows: 2 });
  near(T.summary.lowEdgeAtMax, -917.7, .05);
  for (const m of T.members.filter(m => m.kind === 'pile')) near(m.reveal, 1297.65, .06, m.id);
  near(T.rows[0].clearMin, 500, .05);
  // 轉 +60° 後 +Z 側模組下緣剛好離地 500
  const mod = T.modules[0], A = mod.pivot.p;
  const edge = [mod.center[0], A[1] + 137.5, A[2] + 1139];
  near(rotatePoint(edge, mod.pivot, 60)[1], 500, .1);
  near(rotatePoint(edge, mod.pivot, 60)[2], A[2] + 137.5 * Math.sin(Math.PI / 3) + 1139 * .5, .1);
});

test('追日：跟地形時每支樁外露相同，回報轉折角', () => {
  const T = layoutTracker({ rows: 1, follow: 'terrain', height: x => 400 * Math.sin(x / 8000) });
  const piles = T.members.filter(m => m.kind === 'pile');
  for (const m of piles) near(m.reveal, piles[0].reveal, .1);
  assert.equal(T.rows[0].kinks.length, piles.length - 2);
  assert.ok(T.rows[0].clearMin >= 500 - .05);
  assert.ok(structureChecks(T).some(r => r.name.startsWith('軸承處轉折')));
});

test('載重估算：EN 1991-1-4 表 7.6 內插、動壓、雪載形狀係數', () => {
  assert.deepEqual(cfMonoslope(20), { down: .8, up: -1.1, clipped: false });
  const c = cfMonoslope(12.5); near(c.down, .6, 1e-12); near(c.up, -.95, 1e-12);
  near(windPressure({ V: 30, tilt: 20 }).q, .5 * 1.225 * 900, 1e-9);            // 551.25 Pa
  near(snowMu1(45), .4, 1e-12); assert.equal(snowMu1(60), 0);
  const s = snowOnPlane({ sk: 1, tilt: 30 });
  near(s.s, .8, 1e-12); near(s.perPlane, .8 * COS30, 1e-12); near(s.normal, .6, 1e-12); near(s.parallel, .8 * .5 * COS30, 1e-12);
  const g = groupLoads(small(), { V: 30, sk: 1 });
  assert.match(g.note, /估算/);
  near(g.groups[0].area, 16, 1e-9);                         // 2 × 4 = 8 片 × 2 m²
  near(g.groups[0].snowKN, .8 * COS30 * 16, .01);
});

test('追日跟地形：兩樁之間地面隆起時，軸整體抬高到淨空足夠', () => {
  const base = layoutTracker({ rows: 1, across: 24, follow: 'terrain' }), k = base.rows[0].piles, mid = (k[0] + k[1]) / 2;
  const T = layoutTracker({ rows: 1, across: 24, follow: 'terrain', height: x => 600 * Math.exp(-(((x - mid) / 900) ** 2)) });
  assert.ok(T.rows[0].clearMin >= 500 - .05, String(T.rows[0].clearMin));
  near(T.rows[0].clearMin, 500, .5);                       // 剛好由隆起處決定
});
