// 動畫幾何驗證（不需瀏覽器）：
//   node --import ../../core/tools/register.mjs tools/verify.mjs
// 涵蓋：空間檢核、手臂可達性／關節限位／關節速度、手臂連桿與夾持桶對沖洗站／輸送／圍籬的干涉（cell 邏輯座標）、
// 桶與桶互不重疊（世界座標）、AGV 車身與棧板對牆／門框／龍門柱與光柵／組板龍門柱／暫存棧板／倉庫儲位的干涉、
// 交接瞬間的跳動、倒退跳轉一致性。以 0.05 s 取樣，屬於有限取樣檢查，不是連續碰撞證明。
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { layoutChecks, BOOTH, UPRIGHT, FENCE, GANTRY, GANTRY_GATE, AGV, PALLET, DRUM, pointInPolygon, DECAP, ROBOT, LABEL, STAGING, FILL, CONV, wallRects, warehouseStore, toWorld, agvPolygons, polyRectOverlap } from '../web/js/layout.js';
import { createRobot, LIMITS, SPEED, JOINTS } from '../web/js/robot.js';
import { createSequence, drumWorld, palletWorld, DRUM_KEYS } from '../web/js/sequence.js';
import { createWashing } from '../web/js/washing.js';
import { JAW_ARC } from '../web/js/drum.js';

const D2R = Math.PI / 180, DT = .05;
const robot = createRobot(), seq = createSequence({ robot });
const services = createWashing(new THREE.Scene(), { frames: false });
// 手臂對配管只檢查沖洗站局部配管（cell 邏輯座標）；跨框架配管在圍籬外，由全場檢查負責
const pipeSegments = Object.entries(services.cellPipes).flatMap(([name,p])=>p.points.slice(1).map((b,i)=>({name,a:new THREE.Vector3(...p.points[i]),b:new THREE.Vector3(...b),r:p.radius})));
const segmentDistance = (p,a,b) => { const d=b.clone().sub(a), u=Math.max(0,Math.min(1,p.clone().sub(a).dot(d)/d.lengthSq())); return p.distanceTo(a.clone().addScaledVector(d,u)); };
const fails = [], notes = {};
const fail = (kind, msg) => { if (fails.filter(f => f.kind === kind).length < 8) fails.push({ kind, msg }); notes[kind] = (notes[kind] || 0) + 1; };

// ---------------------------------------------------------------- 1. 空間檢核
for (const c of layoutChecks()) if (!c.ok) fail('layout', `${c.group}｜${c.name}：${c.value}`);

// ---------------------------------------------------------------- 障礙物（AABB：x0,y0,z0,x1,y1,z1）
const b = BOOTH, [ox0, ox1, oy0, oy1] = b.opening, T20 = 20;
const boothBoxes = [
  [b.x0, 0, b.z0, b.x0 + T20, b.h, b.z1], [b.x1 - T20, 0, b.z0, b.x1, b.h, b.z1], [b.x0, 0, b.z1 - T20, b.x1, b.h, b.z1], [b.x0, b.h - T20, b.z0, b.x1, b.h, b.z1],
  [b.x0, 0, b.z0, ox0, b.h, b.z0 + T20], [ox1, 0, b.z0, b.x1, b.h, b.z0 + T20], [ox0, oy1, b.z0, ox1, b.h, b.z0 + T20], [ox0, 0, b.z0, ox1, oy0, b.z0 + T20],
  [b.funnel.x0, 250, b.funnel.z0, b.funnel.x1, b.funnel.y, b.funnel.z1],
  // 開口兩側風刀
  [ox0 + 10, 500, b.z0 - 110, ox0 + 70, 2200, b.z0 - 30], [ox1 - 70, 500, b.z0 - 110, ox1 - 10, 2200, b.z0 - 30],
];
const conveyorBoxes = [
  [UPRIGHT.x - 350, 0, UPRIGHT.z0 + 450, UPRIGHT.x + 350, UPRIGHT.top - 5, UPRIGHT.z1],
  ...[[-650, -400], [650, -400], [-650, 400], [650, 400]].map(([dx, dz]) => [UPRIGHT.x + dx - 50, 0, DECAP.z + dz - 50, UPRIGHT.x + dx + 50, 2600, DECAP.z + dz + 50]),
];
// 龍門：四支立柱＋兩道 X 樑（樑底在 beamY + 100）
// 貼標相機（含支架）也在龍門翻桶擺動範圍旁
const [lcx, lcy, lcz] = LABEL.cam.pos;
const labelCamBoxes = [[lcx - 70, lcy - 80, lcz - 80, lcx + 70, lcy + 80, lcz + 80], [lcx + 55, 0, lcz - 565, lcx + 145, lcy + 170, lcz - 475], [lcx + 60, lcy + 110, lcz - 520, lcx + 140, lcy + 170, lcz]];
const gantryBoxes = [...labelCamBoxes, ...GANTRY.posts.map(([x, z]) => [x - 100, 0, z - 100, x + 100, GANTRY.beamY + 100, z + 100]), ...[GANTRY.posts[0][1], GANTRY.posts[2][1]].map(z => [GANTRY.posts[0][0] - 100, GANTRY.beamY + 100, z - 100, GANTRY.posts[1][0] + 100, GANTRY.beamY + 320, z + 100])];
const robotBase = [ROBOT.x - 500, 0, ROBOT.z - 500, ROBOT.x + 500, 380, ROBOT.z + 500];
const distToBox = (p, a) => Math.hypot(Math.max(a[0] - p.x, 0, p.x - a[3]), Math.max(a[1] - p.y, 0, p.y - a[4]), Math.max(a[2] - p.z, 0, p.z - a[5]));
// 圍籬內：多邊形內且距各邊 ≥ r（南側為牆）
const insideFence = (p, r) => { if (!pointInPolygon([p.x, p.z], FENCE)) return false; for (let i = 1; i < FENCE.length; i++) { const [ax, az] = FENCE[i - 1], [bx, bz] = FENCE[i], L = Math.hypot(bx - ax, bz - az), t = Math.max(0, Math.min(1, ((p.x - ax) * (bx - ax) + (p.z - az) * (bz - az)) / (L * L))); if (Math.hypot(p.x - ax - t * (bx - ax), p.z - az - t * (bz - az)) < r) return false; } return true; };
// 桶表面取樣點（局部）
const drumPts = [];
for (const y of [-DRUM.H / 2, -180, 0, 180, DRUM.H / 2]) for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2; drumPts.push(new THREE.Vector3(DRUM.envelopeR * Math.cos(a), y, DRUM.envelopeR * Math.sin(a))); }
drumPts.push(new THREE.Vector3(0, DRUM.H / 2, 0), new THREE.Vector3(0, -DRUM.H / 2, 0));
const worldPts = w => drumPts.map(p => p.clone().applyQuaternion(w.q).add(w.pos));
const inDrum = (p, w, margin) => { const l = p.clone().sub(w.pos).applyQuaternion(w.q.clone().invert()); return Math.abs(l.y) < DRUM.H / 2 - margin && Math.hypot(l.x, l.z) < DRUM.envelopeR - margin; };

// 夾爪對同板相鄰的桶：龍門與組板龍門的窄爪（爪片與背板外緣取樣點，含張開行程）不得進入棧板上的其他桶
// 爪片中心方向 dir（世界 XZ 單位向量），兩片對向；爪片高 ±200 mm（以夾爪中心為準）
const jawPoints = (c, dir, open) => {
  const pts = [], base = Math.atan2(dir[1], dir[0]);
  for (const side of [0, Math.PI]) for (let a = -JAW_ARC / 2; a <= JAW_ARC / 2 + 1e-9; a += JAW_ARC / 6) for (const r of [DRUM.R + 12, DRUM.R + 32]) for (const y of [-200, 0, 200]) {
    const t = base + side + a; pts.push(new THREE.Vector3(c.x + Math.cos(t) * (r + open), c.y + y, c.z + Math.sin(t) * (r + open)));
  }
  return pts;
};
// 暫存區已在組板的成品桶（靜態，不在 DRUM_KEYS）
const stagedStatic = ['B', 'C', 'D'].flatMap(k => PALLET.slots.slice(0, STAGING.preload[k]).map(([sx, sz]) => ({ pos: new THREE.Vector3(STAGING.pallets[k] + sx, PALLET.H + DRUM.H / 2, STAGING.z + sz), q: new THREE.Quaternion() })));
let minJawGap = Infinity;

// ---------------------------------------------------------------- 2–6. 逐時取樣
const maxErr = { position: 0, angle: 0 }, speedRatio = Object.fromEntries(JOINTS.map(n => [n, 0])), jump = { mm: 0, at: 0, drum: '' };
let prevJ = null, prevT = 0, prevPos = null, prevStep = null, samples = 0, minDrumGap = Infinity, minRobotClear = Infinity, minRobotClearAt = '';
// AGV 的障礙物（世界座標，俯視矩形）：牆與門框、清洗區龍門柱與入口光柵、組板龍門柱、暫存區靜態棧板、集貨輸送、倉庫儲位
const sq = (x, z, h) => [x - h, z - h, x + h, z + h];
const agvRects = [
  ...wallRects(),
  ...GANTRY.posts.map(([x, z]) => ['龍門柱', sq(...toWorld('front', x, z), 100)]),
  ...[-700, 700].map(dx => ['龍門入口光柵', sq(...toWorld('front', GANTRY_GATE[0] + dx, GANTRY_GATE[1]), 40)]),
  ...[[STAGING.gantry.x0, STAGING.gantry.z0], [STAGING.gantry.x1, STAGING.gantry.z0], [STAGING.gantry.x0, STAGING.gantry.z1], [STAGING.gantry.x1, STAGING.gantry.z1]].map(([x, z]) => ['組板龍門柱', sq(x, z, 100)]),
  ...['B', 'C', 'D'].map(k => [`組板 ${k} 棧板`, [STAGING.pallets[k] - PALLET.W / 2, STAGING.z - PALLET.W / 2, STAGING.pallets[k] + PALLET.W / 2, STAGING.z + PALLET.W / 2]]),
  ['集貨輸送', [STAGING.pick[0] - CONV.width / 2, FILL.collectZ - CONV.width / 2, FILL.lines.at(-1) + CONV.width / 2, FILL.collectZ + CONV.width / 2]],
  ...warehouseStore().map(({ x, z }) => ['倉庫儲位', sq(x, z, PALLET.W / 2)]),
];
for (let t = 0; t <= seq.total + 1e-9; t += DT) {
  samples++;
  const sm = seq.sample(t), st = sm.st, rs = sm.robot;
  // 手臂追蹤誤差與關節
  if (rs.err) { maxErr.position = Math.max(maxErr.position, rs.err.position); maxErr.angle = Math.max(maxErr.angle, rs.err.angle); if (rs.err.position > 1 || rs.err.angle > .3) fail('robot-ik', `${t.toFixed(2)} s ${rs.step?.action}：${rs.err.position.toFixed(2)} mm / ${rs.err.angle.toFixed(2)}°`); }
  const q = { ...robot.q };
  for (const n of JOINTS) { const [lo, hi] = LIMITS[n]; if (q[n] < lo * D2R - 1e-6 || q[n] > hi * D2R + 1e-6) fail('robot-limit', `${t.toFixed(2)} s ${n} = ${(q[n] / D2R).toFixed(1)}°`); }
  if (prevJ && rs.step && rs.step === prevStep) for (const n of JOINTS) { const v = Math.abs(q[n] - prevJ[n]) / DT / D2R; speedRatio[n] = Math.max(speedRatio[n], v / SPEED[n]); if (v > SPEED[n] * 1.02) fail('robot-speed', `${t.toFixed(2)} s ${rs.step.action} ${n} ${v.toFixed(0)}°/s > ${SPEED[n]}`); }
  prevJ = q; prevStep = rs.step;
  // 手臂連桿：圍籬內、不碰沖洗站與輸送
  robot.root.updateMatrixWorld(true);
  for (const [a, c, r] of robot.links()) {
    const n = Math.ceil(a.distanceTo(c) / 40);
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(c, i / n);
      if (!insideFence(p, r)) fail('robot-fence', `${t.toFixed(2)} s 連桿點 (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}) 超出圍籬`);
      for (const box of [...boothBoxes, ...conveyorBoxes]) { const d = distToBox(p, box) - r; if (d < minRobotClear) { minRobotClear = d; minRobotClearAt = `${t.toFixed(2)} s`; } if (d < 0) fail('robot-hit', `${t.toFixed(2)} s 連桿碰到 [${box.map(v => v.toFixed(0)).join(',')}]`); }
      for (const pipe of pipeSegments) if (segmentDistance(p,pipe.a,pipe.b)<r+pipe.r) fail('robot-pipe',`${t.toFixed(2)} s 手臂碰到配管 ${pipe.name}`);
    }
  }
  // 桶：位置、互相重疊、夾持中的桶對障礙物
  const ws = DRUM_KEYS.map(k => drumWorld(k, st, robot.tcp.matrixWorld)), N = ws.length;
  const wl = DRUM_KEYS.map(k => drumWorld(k, st, robot.tcp.matrixWorld, { logical: true }));   // 清洗線上的桶：框架內邏輯座標
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    if (ws[i].hidden || ws[j].hidden) continue;
    minDrumGap = Math.min(minDrumGap, ws[i].pos.distanceTo(ws[j].pos));
    if (ws[i].pos.distanceTo(ws[j].pos) < 2 * Math.hypot(DRUM.R, DRUM.H / 2) && worldPts(ws[i]).some(p => inDrum(p, ws[j], 3))) fail('drum-overlap', `${t.toFixed(2)} s ${DRUM_KEYS[i]} 與 ${DRUM_KEYS[j]} 重疊（${st[DRUM_KEYS[i]].mode}/${st[DRUM_KEYS[j]].mode}）`);
  }
  wl.forEach((w, k) => {
    if (w.hidden) return;
    const mode = st[DRUM_KEYS[k]].mode;
    // 手臂連桿與夾爪不得碰到未夾持的桶（例如在取桶位等候的下一桶）
    // 例外：夾爪本體（連桿 5）在取放瞬間本來就貼著要夾的桶
    const gripping = robot.tcp.getWorldPosition(new THREE.Vector3()).distanceTo(w.pos) < 450;
    if (mode !== 'robot' && w.pos.distanceTo(robot.root.position) < 3500) robot.links().forEach(([a, c, r], li) => { if (li === 5 && gripping) return; const n = Math.ceil(a.distanceTo(c) / 50); for (let i = 0; i <= n; i++) if (inDrum(a.clone().lerp(c, i / n), w, -r * .6)) { fail('arm-drum', `${t.toFixed(2)} s 手臂連桿 ${li} 碰到 ${DRUM_KEYS[k]}（${mode}）`); break; } });
    if (mode === 'robot' || mode === 'gantry') {
      const pts = worldPts(w);
      const boxes = mode === 'robot' ? [...boothBoxes, ...conveyorBoxes, robotBase] : gantryBoxes;
      for (const box of boxes) if (pts.some(p => distToBox(p, box) < 5)) fail('drum-hit', `${t.toFixed(2)} s ${DRUM_KEYS[k]}（${mode}）碰到 [${box.map(v => v.toFixed(0)).join(',')}]`);
      if(mode==='robot')for(const pipe of pipeSegments)if(pts.some(p=>segmentDistance(p,pipe.a,pipe.b)<pipe.r+5))fail('drum-pipe',`${t.toFixed(2)} s 桶碰到配管 ${pipe.name}`);
      if (mode === 'robot' && pts.some(p => !insideFence(p, 0))) fail('drum-fence', `${t.toFixed(2)} s ${DRUM_KEYS[k]} 超出清洗區圍籬`);
      if (mode === 'robot') robot.links().forEach(([a, c, r], li) => { if (li < 4) { const n = Math.ceil(a.distanceTo(c) / 50); for (let i = 0; i <= n; i++) if (inDrum(a.clone().lerp(c, i / n), w, -r * .6)) { fail('drum-arm', `${t.toFixed(2)} s ${DRUM_KEYS[k]} 碰到手臂連桿 ${li}`); break; } } });
    }
  });
  // 夾爪對同板相鄰的桶（清洗區龍門在翻桶前、組板龍門全程）
  const onPallets = [...ws.filter((w, k) => !w.hidden && st[DRUM_KEYS[k]].mode === 'pallet'), ...stagedStatic];
  const jawCheck = (who, c, dir, open) => {
    const near = onPallets.filter(w => w.pos.distanceTo(c) > 50 && w.pos.distanceTo(c) < 1200);
    for (const p of jawPoints(c, dir, open)) for (const w of near) {
      const l = p.clone().sub(w.pos); if (Math.abs(l.y) < DRUM.H / 2) minJawGap = Math.min(minJawGap, Math.hypot(l.x, l.z) - DRUM.envelopeR);
      if (inDrum(p, w, 3)) { fail('jaw-drum', `${t.toFixed(2)} s ${who}夾爪碰到同板的桶`); return; }
    }
  };
  if (st.gantry.tilt < .01) {
    const g = st.gantry, [cx, cz] = toWorld('front', g.x, g.z), r = (g.rot || 0) * D2R;
    jawCheck('清洗區龍門', new THREE.Vector3(cx, g.y - GANTRY.hang, cz), [Math.sin(r), Math.cos(r)], (1 - g.jaw) * GANTRY.jawOpen);   // 爪在局部 ±Z
  }
  { const g = st.stg, r = g.rot * D2R; jawCheck('組板龍門', new THREE.Vector3(g.x, g.y, g.z), [Math.cos(r), -Math.sin(r)], (1 - g.jaw) * 90); }   // 爪在局部 ±X
  // 交接瞬間不得跳動
  const pos = ws.map(w => w.pos);
  if (prevPos) pos.forEach((p, k) => { if (ws[k].hidden || prevPos[k].y < -1000) return; const d = p.distanceTo(prevPos[k]) / (t - prevT) * DT; if (d > jump.mm) { jump.mm = d; jump.at = t; jump.drum = DRUM_KEYS[k]; } if (d > 150) fail('drum-jump', `${t.toFixed(2)} s ${DRUM_KEYS[k]} 一步移動 ${d.toFixed(0)} mm（${st[DRUM_KEYS[k]].mode}）`); });
  prevPos = pos.map(p => p.clone()); prevT = t;
  // AGV 車身與載物（世界座標）：叉著棧板時以棧板外框檢查，空叉時以貨叉外框檢查；兩台 AGV 互不碰撞
  const polys = {};
  for (const [key, name] of [['agv', 'AGV-1'], ['agv2', 'AGV-2']]) {
    const a = st[key], loaded = ['palD', 'palA'].some(k => st[k].mode === 'agv' && st[k].by === key);
    polys[key] = agvPolygons(a.x, a.z, a.yaw, loaded);
    for (const poly of polys[key]) for (const [n, r] of agvRects) if (polyRectOverlap(poly, r)) fail('agv-hit', `${t.toFixed(2)} s ${name}（${loaded ? '載棧板' : '空叉'}）碰到${n}`);
  }
  // 兩台互撞：以車身與前端多邊形的外接矩形做保守檢查，再用分離軸確認
  const bb = poly => [Math.min(...poly.map(p => p[0])), Math.min(...poly.map(p => p[1])), Math.max(...poly.map(p => p[0])), Math.max(...poly.map(p => p[1]))];
  for (const p1 of polys.agv) for (const p2 of polys.agv2) if (polyRectOverlap(p1, bb(p2)) && polyRectOverlap(p2, bb(p1))) { fail('agv-agv', `${t.toFixed(2)} s 兩台 AGV 碰撞`); break; }
}

// ---------------------------------------------------------------- 7. 倒退／跳轉一致性
const probe = [3, 61.2, 94, 112, 150, 161, 190, 232, 260, 410, 590, 700, 900, 1100, 1250];
const snap = t => { const st = seq.sample(t).st; robot.root.updateMatrixWorld(true); return DRUM_KEYS.map(k => drumWorld(k, st, robot.tcp.matrixWorld).pos.toArray()).flat().concat(JOINTS.map(n => robot.q[n])); };
const ref = probe.map(snap), again = [...probe].reverse().map(snap).reverse();
const maxDiff = Math.max(...ref.flatMap((r, i) => r.map((v, j) => Math.abs(v - again[i][j]))));
if (maxDiff > .5) fail('determinism', `倒序取樣差異 ${maxDiff.toFixed(3)}`);

const result = {
  ok: fails.length === 0, samples, dt: DT, total: +seq.total.toFixed(1), robotCycle: +((seq.events.filter(e => e.label.endsWith('放回輸送線')).at(-1).time - seq.events.filter(e => e.label.endsWith('放回輸送線')).at(-2).time)).toFixed(1),
  robotTrackingMax: { mm: +maxErr.position.toFixed(3), deg: +maxErr.angle.toFixed(3) },
  jointSpeedRatioMax: Object.fromEntries(Object.entries(speedRatio).map(([k, v]) => [k, +v.toFixed(2)])),
  minRobotClearance: { mm: +minRobotClear.toFixed(0), at: minRobotClearAt }, minJawToNeighbourDrum: { mm: +minJawGap.toFixed(0) }, maxDrumStep: { mm: +jump.mm.toFixed(1), at: +jump.at.toFixed(2), drum: jump.drum }, determinismMaxDiff: +maxDiff.toFixed(4),
  failCounts: notes, failures: fails,
  scope: '0.05 s 取樣；手臂連桿以線段＋半徑近似、桶以含滾箍的 162 個表面點近似，納入沖洗站局部剛性配管；AGV 以 2D 車身與棧板多邊形對牆、門框與設備外框檢查；未含軟管掃掠、所有緊固件與人員的動態干涉（人員與設備由全場 scene 檢查）。',
};
mkdirSync(new URL('../review', import.meta.url), { recursive: true });
writeFileSync(new URL('../review/verification.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
