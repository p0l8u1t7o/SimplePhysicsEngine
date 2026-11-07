// 手臂動力學的自我檢查（check.mjs 的 core · dynamics，core 1.18.0）：
//   1. 靜止姿態的重力扭矩：MuJoCo（mj_inverse）對照獨立的手算（正向運動學＋Σ r × m g，不經 MuJoCo），差 ≤ 1e-9 N·m
//   2. 決定性：同一段軌跡算兩次，扭矩雜湊相同
//   3. 合成軌跡（J2、J3 S 曲線擺動，帶 2 kg 負載）要產生負載與扭矩的檢查列，峰值扭矩大於靜止保持扭矩（有加速度項）
//   node --import ./core/tools/register.mjs core/examples/dynamics/check.mjs
import { createArmModel, inverseDynamics } from '../../robot/dynamics.js';
import { VS068_DYNAMICS as S } from '../../robot/dynamics/denso-vs068.js';

const D = Math.PI / 180, g = 9.81, fails = [];
const PAYLOAD = { mass: 2, com: [0, 0, 50] };       // 2 kg、質心在法蘭面前 50 mm（工具軸上）

// ---- 手算（3×3 旋轉矩陣逐節累乘，質點放在每塊幾何中心）
const rot = (ax, a) => { const c = Math.cos(a), s = Math.sin(a); return ax[0] ? [[1, 0, 0], [0, c, -s], [0, s, c]] : ax[1] ? [[c, 0, s], [0, 1, 0], [-s, 0, c]] : [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
const mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const mv = (A, v) => A.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const add = (a, b) => a.map((v, i) => v + b[i]), sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function handGravity(qdeg, payload = null) {
  let R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], p = [0, 0, 0];
  const frames = [], masses = [];
  S.links.forEach((l, k) => {
    p = add(p, mv(R, l.pos.map(v => v / 1000))); R = mul(R, rot(l.axis, qdeg[k] * D));
    frames.push({ o: p, axis: mv(R, l.axis) });
    for (const geo of l.geoms) masses.push({ p: add(p, mv(R, geo.pos.map(v => v / 1000))), m: geo.mass, link: k });
  });
  if (payload) { const [cx, cy, cz] = payload.com, local = [S.tool.pos[0] + cz, S.tool.pos[1] + cy, S.tool.pos[2] - cx].map(v => v / 1000); masses.push({ p: add(p, mv(R, local)), m: payload.mass, link: 5 }); }
  return frames.map((fr, k) => -masses.filter(x => x.link >= k).reduce((s, x) => s + cross(sub(x.p, fr.o), [0, -x.m * g, 0]).reduce((a, v, i) => a + v * fr.axis[i], 0), 0));
}
const POSES = [[0, 0, 0, 0, 0, 0], [0, -90, 0, 0, 0, 0], [90, 0, 0, 0, 0, 0], [0, -10, 40, 0, -70, 0], [30, 20, 60, 45, -60, 90]];
let worst = 0;
for (const payload of [null, PAYLOAD]) {
  const arm = await createArmModel(S, { payload });
  try { for (const q of POSES) { const mj = Array.from(arm.inverse(q.map(v => v * D))), hand = handGravity(q, payload); worst = Math.max(worst, ...mj.map((v, i) => Math.abs(v - hand[i]))); } }
  finally { arm.dispose(); }
}
if (!(worst <= 1e-9)) fails.push(`靜態重力扭矩和手算差 ${worst.toExponential(2)} N·m（應 ≤ 1e-9）`);

// ---- 合成軌跡：4 s，J2 −20°↔20°、J3 30°↔70°（S 曲線），每 10 ms 一點
const smooth = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
const samples = [];
for (let i = 0; i <= 400; i++) { const t = i / 100, u = smooth((t % 2) / 2), s = Math.floor(t / 2) % 2 ? 1 - u : u; samples.push({ t, q: { j1: 0, j2: (-20 + 40 * s) * D, j3: (30 + 40 * s) * D, j4: 0, j5: -60 * D, j6: 0 } }); }
const a = await inverseDynamics(S, samples, { payload: PAYLOAD }), b = await inverseDynamics(S, samples, { payload: PAYLOAD });
if (a.hash !== b.hash) fails.push(`同一段軌跡算兩次結果不同（${a.hash} / ${b.hash}）`);
if (!a.rows.some(r => /峰值扭矩/.test(r.name)) || !a.rows.some(r => /負載力矩/.test(r.name))) fails.push('檢查列缺峰值扭矩或負載力矩');
if (!(a.peak.j2.tau > a.peak.j2.gravity)) fails.push(`J2 峰值扭矩 ${a.peak.j2.tau.toFixed(2)} 沒有大於靜止保持 ${a.peak.j2.gravity.toFixed(2)} N·m（加速度項沒算進去？）`);
if (a.rows.some(r => !r.ok)) fails.push(`合成軌跡的檢查列有不通過的項目：${a.rows.filter(r => !r.ok).map(r => r.name).join('、')}`);

// ---- 站層宣告（core/verify/dynamics.mjs）：沒宣告略過；正常軌跡沒有警告；超重只警告不擋；型號打錯要擋
const { verifyDynamics } = await import('../../verify/dynamics.mjs');
const traj = t => { const u = smooth((t % 2) / 2), s = Math.floor(t / 2) % 2 ? 1 - u : u; return { j1: 0, j2: (-20 + 40 * s) * D, j3: (30 + 40 * s) * D, j4: 0, j5: -60 * D, j6: 0 }; };
const proj = (arm, extra = {}) => ({ total: 4, verify: { dynamics: { arms: [{ name: '手臂', spec: 'denso-vs068', sample: traj, ...arm }], ...extra } } });
const skip = await verifyDynamics({ total: 4, verify: {} }), normal = await verifyDynamics(proj({ payload: PAYLOAD })), heavy = await verifyDynamics(proj({ payload: { mass: 9, com: [0, 0, 50] } })), typo = await verifyDynamics(proj({ spec: 'denso-vs999' }));
if (skip.applicable !== false) fails.push('站層：沒宣告 verify.dynamics 應該略過');
if (!normal.ok || normal.warnings.length) fails.push(`站層：正常軌跡不應有警告：${normal.warnings.join('；')}`);
const direct = await inverseDynamics(S, Array.from({ length: 401 }, (_, i) => ({ t: i * 0.01, q: traj(i * 0.01) })), { payload: PAYLOAD });   // 站層用 from + i·step 取樣
if (normal.arms[0]?.hash !== direct.hash) fails.push(`站層：同一段軌跡的扭矩雜湊應和直接呼叫相同（${normal.arms[0]?.hash} / ${direct.hash}）`);
if (!heavy.ok || !heavy.warnings.some(w => /負載質量/.test(w))) fails.push('站層：9 kg 超過型錄 7 kg，應該只警告（ok 仍為 true）');
if (typo.ok) fails.push('站層：型號不存在應該擋下');

console.log(`${fails.length ? '✗' : '✓'} dynamics：靜態扭矩與手算差 ${worst.toExponential(1)} N·m；合成軌跡 ${samples.length} 點兩次相同（${a.hash}）；J2 峰值 ${a.peak.j2.tau.toFixed(1)} N·m（靜止保持 ${a.peak.j2.gravity.toFixed(1)}）、負載 2 kg 的 J5 力矩 ${a.wrist.moment.j5.toFixed(2)} N·m；站層 verify.dynamics 略過、警告、擋錯都正確`);
for (const f of fails) console.log('   ' + f);
process.exit(fails.length ? 1 : 0);
