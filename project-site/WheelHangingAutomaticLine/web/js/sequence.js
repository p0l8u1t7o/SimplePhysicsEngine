// 動畫排程（createStepSequence）：吊掛線以 4 cm/s 不停前進，手臂追蹤輪框取像、夾取、下掛，翻轉疊放到棧板。
// 任一時刻的狀態只由時間決定：追蹤步驟記下「相對輪框正面中心」的起訖位姿，apply 時加上輪框此刻的位置再逆解。
// 一個循環（每個輪框）：
//   S1 粗取像（斜 25° 看全輪、辨識輪型）→ S2 追蹤精定位（正對輪面、量中心孔與螺栓孔）
//   → S3 同步夾取（盲區直線接近、夾緊、上抬、拉出吊桿）→ S4 翻轉疊放（棧板對角線方向放下）→ S5 隔板／換款
// 示範三個輪框：第 1 個補滿棧板 A 第 3 層 → 手臂取隔板鋪上；第 2 個放第 4 層；第 3 個換成 B 款（外徑 510）→ 改放棧板 B、夾爪行程跟著改。
// 狀態鍵：q 手臂關節角；width 夾指內距；vac 隔板吸盤；strobe 頻閃（0／1）；dist 視野錐長度；pattern 圖案投影
//   lam0～2 第 k 個輪框在哪（hook／robot／A／B，步驟結束才切換）；sheet0 示範隔板（rack／robot／A）
import * as THREE from 'three';
import { createStepSequence } from '@core/anim/sequence.js';
import { D2R } from '@core/geom/shapes.js';
import { JOINTS, SPEED, ROT } from './robot.js';
import { hookX, modelOf, DEMO } from './line.js';
import { WHEELS, LINE, PICK, GRIP, OBS, FINE, APPROACH, LIFT, PULL, BAYS, SHEETS, PALLET, hangY, slotOf, sheetTopY } from './layout.js';
import { slotYaw } from './cell.js';

export const STATIONS = ['粗取像辨識', '追蹤精定位', '同步夾取下掛', '翻轉疊放', '隔板／換款'];
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// 第 k 個示範輪框：吊鉤編號、款式、放哪個棧板第幾格
export const PLAN = DEMO.map(j => {
  const model = modelOf(j), bay = model === BAYS.A.model ? 'A' : 'B';
  return { j, model, spec: WHEELS[model], bay };
});
{ const n = { A: BAYS.A.n, B: BAYS.B.n }; for (const p of PLAN) p.idx = n[p.bay]++; }
// 輪框正面（輪緣平面）中心：吊鉤 j、時間 t（尚未上抬）
export const frontOf = (p, t) => V(hookX(p.j, t), hangY(p.spec), LINE.z + p.spec.w / 2);
// 示範隔板：第 1 個輪框補滿第 3 層後鋪在棧板 A 上
export const SHEET = { bay: 'A', layer: Math.floor(PLAN[0].idx / 4) + 1 };
export const SHEET_YAW = { rack: Math.PI, A: -Math.PI / 2 };   // 吸隔板時夾指朝南（避開隔板架導引），放到 A 時朝東
export const sheetRackY = () => SHEETS.h + (SHEETS.n - 1) * PALLET.sheet + PALLET.sheet / 2;

export function createSequence(robot) {
  const pose = (target, rot) => ({ target, rot });
  const R_OBS = ROT.pick, R_PICK = ROT.pick;
  const REL = {
    obs: { off: V(0, 0, OBS.dist), rot: R_OBS },
    fine: { off: V(0, 0, FINE), rot: R_PICK },
    safe: { off: V(0, 0, APPROACH), rot: R_PICK },
    grip: { off: V(0, 0, 0), rot: R_PICK },
    lift: { off: V(0, LIFT, 0), rot: R_PICK },
    pull: { off: V(0, LIFT, PULL), rot: R_PICK },
  };
  const HOME = pose(V(1000, 1700, -560), R_OBS);
  const q0 = robot.solve(HOME);
  const base = { q: q0, width: 2 * GRIP.stroke[1], vac: 0, strobe: 0, dist: 900, pattern: 0, sheet0: 'rack' };
  PLAN.forEach((p, k) => { base['lam' + k] = 'hook'; });
  const seq = createStepSequence({ base, nested: true, latch: [...PLAN.map((_, k) => 'lam' + k), 'sheet0'], stations: STATIONS });

  let cur = HOME, q = q0, T = 0;
  const poses = [], track = [];
  const jointTime = (a, b) => Math.max(...JOINTS.map(n => Math.abs(a[n] - b[n]) / (SPEED[n] * D2R)));
  const add = (st, dur, action, sub, values, extra) => { dur = +dur.toFixed(2); const s = seq.add(st, dur, action, sub, values, extra); T += dur; return s; };
  const relPose = (p, rel, t) => pose(frontOf(p, t).add(rel.off), rel.rot);
  // PTP 到固定位姿
  function ptp(st, to, action, sub = '', values = {}, vf = .85) {
    const j = robot.solve(to, q), dur = Math.max(.8, jointTime(q, j) / vf * 1.875);
    poses.push([action, to, j]); const s = add(st, dur, action, sub, { q: j, ...values }, { robot: 'ptp' });
    cur = to; q = j; return s;
  }
  // PTP 到追蹤中的位姿（目標隨線移動）：結束時刻與關節角互相依賴，迭代三次
  function ptpTrack(st, p, rel, action, sub = '', values = {}, vf = .85) {
    let dur = 1.5, j;
    for (let i = 0; i < 4; i++) { j = robot.solve(relPose(p, rel, T + dur), q); dur = Math.max(.8, jointTime(q, j) / vf * 1.875); }
    const to = relPose(p, rel, T + dur); j = robot.solve(to, q);
    poses.push([action, to, j]); const s = add(st, dur, action, sub, { q: j, ...values }, { robot: 'ptp' });
    cur = to; q = j; return s;
  }
  // 追蹤段：相對位姿 from → to（from＝to 是追蹤中停留），速度是相對輪框的速度
  let rel = null;
  function follow(st, p, to, speed, action, sub = '', values = {}, minDur = .3) {
    const from = rel, dur = Math.max(minDur, from.off.distanceTo(to.off) / speed * 1.875);
    const target = relPose(p, to, T + dur), j = robot.solve(target, q);
    poses.push([action, target, j]); track.push({ k: PLAN.indexOf(p), start: T, dur });
    const s = add(st, dur, action, sub, { q: j, ...values }, { robot: 'track', track: { p, from, to } });
    cur = target; q = j; rel = to; return s;
  }
  const hold = (st, dur, action, sub = '', values = {}, extra = {}) => add(st, dur, action, sub, values, extra);
  function lin(st, to, speed, action, sub = '', values = {}) {
    const j = robot.solve(to, q), dur = Math.max(.4, cur.target.distanceTo(to.target) / speed * 1.875);
    poses.push([action, to, j]); const s = add(st, dur, action, sub, { q: j, ...values }, { robot: 'lin', lin: { from: cur, to } });
    cur = to; q = j; return s;
  }
  const up = (p, dy) => pose(p.target.clone().add(V(0, dy, 0)), p.rot);

  hold(0, .8, '待命：手臂在取像待命位', '吊掛線 4 cm/s 不停線；第 1 個輪框（A 款）剛進追蹤窗');
  PLAN.forEach((p, k) => {
    const n = k + 1, lam = 'lam' + k, spec = p.spec, od = spec.od, bay = BAYS[p.bay];
    const half = od / 2, open = 2 * (half + GRIP.open);
    // 等輪框進追蹤窗（取像距離與手臂可達都以窗內計算）
    const x = hookX(p.j, T), wait = (PICK.window[0] - x) / LINE.v;
    if (wait > .05) hold(0, wait, `等待第 ${n} 個輪框進追蹤窗`, `到位光電已鎖存編碼器計數；輪框中心 x ${Math.round(x)} → ${PICK.window[0]} mm`);
    const tSensor = (PICK.sensorX - (hookX(p.j, 0))) / LINE.v;
    // ---------------------------------------------------------------- S1 粗取像
    rel = REL.obs;
    ptpTrack(0, p, REL.obs, `第 ${n} 個輪框：移到粗取像位`, `編碼器推算輪框位置（到位光電 ${tSensor < 0 ? '於動畫開始前' : `於 ${tSensor.toFixed(1)} s`}觸發）；相機俯 23° 正對輪面，面光源的正反射打不進鏡頭`, { width: open });
    follow(0, p, REL.obs, 1, '雙眼同步取像（粗）', '525 nm 面光源頻閃 300 µs＋交叉偏光；左右相機硬體同步觸發', { strobe: 1, dist: OBS.dist + 60 }, .35);
    follow(0, p, REL.obs, 1, '辨識輪型與位姿', `外緣／中心孔／螺栓孔橢圓擬合 → 三角量測中心與軸線；外徑 ${od} → ${spec.name}`, { strobe: 0 }, .3);
    // ---------------------------------------------------------------- S2 追蹤精定位
    follow(1, p, REL.fine, 400, '追蹤接近到精取像位', `正對輪面、TCP 距輪面 ${FINE} mm；夾指張開到 ${Math.round(open)} mm（${spec.name}）`, { width: open });
    follow(1, p, REL.fine, 1, '精取像', '中心孔＋螺栓孔再量一次：修正擺動與吊鉤偏移（防擺導軌限制 ±5 mm）', { strobe: 1, dist: FINE + 60, pattern: 1 }, .35);
    follow(1, p, REL.fine, 1, '更新夾取點', '曝光時刻的法蘭姿態 × 手眼標定 × 量測值 → 基座座標；加上線速 × 延遲', { strobe: 0, pattern: 0 }, .2);
    // ---------------------------------------------------------------- S3 同步夾取下掛
    follow(2, p, REL.safe, 500, '接近到安全距離', `TCP 距輪面 ${APPROACH} mm：相機進入盲區前最後一次修正`);
    follow(2, p, REL.grip, 90, '盲區直線接近', '只用最後量測＋編碼器推算；夾指在外徑外側滑入');
    follow(2, p, REL.grip, 1, '夾爪夾緊', `PU V 型指墊夾前輪緣與胎座（內距 ${od} mm）；伺服到位＋力矩確認`, { width: od, [lam]: 'robot' }, .6);
    p.gripT = T;
    follow(2, p, REL.lift, 40, `上抬 ${LIFT} mm`, '中心孔離開吊桿護套（同心）');
    follow(2, p, REL.pull, 220, `沿吊桿往南拉出 ${PULL} mm`, '吊桿末端有防脫上翹，拉出後才離開追蹤');
    p.releaseX = hookX(p.j, T);
    // ---------------------------------------------------------------- S4 翻轉疊放
    lin(3, pose(cur.target.clone().add(V(0, 120, 380)), R_PICK), 900, '退離吊掛線', '離開追蹤；吊鉤空鉤繼續前進');
    const s = slotOf(bay, p.idx, spec), yaw = slotYaw(s.sx, s.sz), top = V(s.x, s.y + spec.w / 2, s.z), R_PLACE = ROT.yaw(yaw);
    ptp(3, up(pose(top, R_PLACE), 320), `翻轉放平、移到棧板 ${p.bay} 上方`, `第 ${s.layer + 1} 層第 ${p.idx % 4 + 1} 格；夾指沿棧板對角線，不碰相鄰輪框`);
    lin(3, up(pose(top, R_PLACE), 40), 900, '下降', '');
    lin(3, pose(top, R_PLACE), 120, '慢速放下', '輪框背面輪緣落在隔板上');
    hold(3, .5, '夾爪鬆開', '', { width: open, [lam]: p.bay });
    lin(3, up(pose(top, R_PLACE), 320), 700, '夾爪上升', `棧板 ${p.bay} 計數 ${p.idx + 1}`);
    // ---------------------------------------------------------------- S5 隔板／換款
    if (k === 0) {
      const lip = robot.cupLip.clone().sub(robot.tcp.position);                       // TCP → 吸盤唇面（工具座標）
      const tcpFor = (c, yaw) => { const r = ROT.yaw(yaw, ROT.pick); return pose(c.clone().sub(lip.clone().applyQuaternion(r)), r); };
      const rackTop = V(SHEETS.x, sheetRackY() + PALLET.sheet / 2, SHEETS.z), padTop = V(bay.x, sheetTopY(SHEET.layer, spec), bay.z);
      ptp(4, up(tcpFor(rackTop, SHEET_YAW.rack), 300), '第 3 層滿：取隔板', '夾爪轉成吸盤朝下（夾指朝南，避開隔板架導引）');
      lin(4, tcpFor(rackTop, SHEET_YAW.rack), 500, '吸盤下降', '');
      hold(4, .6, '真空吸附隔板', '4 顆 Ø60 吸盤；真空開關確認', { vac: 1, sheet0: 'robot' });
      lin(4, up(tcpFor(rackTop, SHEET_YAW.rack), 30), 60, '慢速抬起', '先抬 30 mm 讓下一張分離');
      ptp(4, up(tcpFor(padTop, SHEET_YAW.A), 300), '移到棧板 A 上方', '');
      lin(4, tcpFor(padTop, SHEET_YAW.A), 400, '鋪上隔板', `第 ${SHEET.layer + 1} 層的底板`);
      hold(4, .5, '破真空', '', { vac: 0, sheet0: 'A' });
      lin(4, up(tcpFor(padTop, SHEET_YAW.A), 300), 700, '吸盤上升', '');
    }
    if (k === 1) hold(4, .4, '輪型預告：下一個是 B 款', '到位光電遮光時間 × 線速 ≈ 外徑 510 mm，和視覺結果交叉確認後切換配方', {});
  });
  ptp(4, HOME, '回取像待命位', '示範完成；正常生產時接著追蹤下一個輪框');

  const firstGrip = PLAN[0].gripT, secondGrip = PLAN[1].gripT, thirdGrip = PLAN[2].gripT;
  const cycle = (thirdGrip - firstGrip) / 2;
  return { seq, poses, track, cycle, HOME, REL };
}

// 追蹤段的位姿：輪框此刻的正面中心＋相對位姿（位置線性、姿態球面內插）
export function trackPose(step, t, e) {
  const { p, from, to } = step.track;
  return { target: frontOf(p, t).add(from.off.clone().lerp(to.off, e)), rot: from.rot.clone().slerp(to.rot, e) };
}
export function linPose(step, e) {
  const { from, to } = step.lin;
  return { target: from.target.clone().lerp(to.target, e), rot: from.rot.clone().slerp(to.rot, e) };
}
