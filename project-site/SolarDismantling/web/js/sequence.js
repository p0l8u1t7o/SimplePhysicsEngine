// 動畫排程：手臂＋交接台＋懸臂移載機＋拆框機依序作業（createStepSequence），任一時刻的狀態只由時間決定。
// 一個循環（每片板）：
//   S1 入料取板（手臂）→ S2 放上交接台、置中（手臂）→ S3 送入拆框機（移載機）→ S4 拆框剝線盒（拆框機；手臂、移載機在外待命）
//   → S5 取出無框板（移載機）→ S6 疊放出料（手臂）
// 示範兩片：第 1 片取自入料 A 的最後一片（取完 A 空 → 通知補料，下一片改取 B）；放到出料 A 第 60 片（滿 → 通知換棧板，下一片改放 B）。
// fault：情境「拆框機故障」——第 2 片外拉時鋁框卡料逾時，拆框機報故障，手臂與移載機停在待命位，人員排除後復歸重試。
// 狀態鍵：
//   q  手臂關節角（rad，逐項插值）；直線段另外在 step.lin 記起訖位姿，apply 時沿直線追蹤；vac 手臂吸盤真空
//   lz ly lvac   移載機吸盤面中心的 Z、高度與真空；ctr 交接台置中氣缸
//   press clamp pull open scrape belt   拆框機動作；fault 拆框機故障（0／1）
//   lam0 lam1   第 k 片層壓板在哪：inA inB robot table loader machine outA outB（步驟結束才切換）
//   frm0 frm1   第 k 片鋁框：0 在板上、0～1 外拉、1～2 落下（長邊到輸送帶、短邊到抽屜料箱）、2～3 輸送、3～4 落入長框料車
//   box0 box1   第 k 片接線盒：0 在板上、0～1 被刮刀推、1～2 經漏斗落到滑槽、2～3 沿滑槽滑進料箱
import * as THREE from 'three';
import { createStepSequence } from '@core/anim/sequence.js';
import { D2R } from '@core/geom/shapes.js';
import { JOINTS, SPEED } from './robot.js';
import { BAYS, TABLE, LOADER, ROBOT, GLASS_Y, TRANSFER_Y, OUT_MAX, inGlassY, outGlassY } from './layout.js';

export const STATIONS = ['入料取板', '放上交接台', '送入拆框機', '拆框剝線盒', '取出無框板', '疊放出料'];
export const CYCLES = 2;
// 第 k 片從哪個工位取、放到哪個工位（第幾層）
export const PLAN = [
  { from: 'inA', fromIdx: 0, to: 'outA', toIdx: BAYS.outA.n },
  { from: 'inB', fromIdx: BAYS.inB.n - 1, to: 'outB', toIdx: BAYS.outB.n },
];
const fall = t => t * t;                       // 自由落下
const LAM_KEYS = Array.from({ length: CYCLES }, (_, k) => 'lam' + k);

export function createSequence(robot, { fault = false } = {}) {
  const P = c => robot.posePanel(c);
  const R = new THREE.Vector3(ROBOT.x, 0, ROBOT.z);
  // 手臂位姿：等待位（交接台南側上方）、交接台上方與放板位、各工位上方高位（往手臂內收、越過移載機導軌）
  const HOME = P([TABLE.x, TRANSFER_Y, TABLE.z + 750]);
  const TABLE_UP = P([TABLE.x, TRANSFER_Y, TABLE.z]), TABLE_SEAT = P([TABLE.x, GLASS_Y, TABLE.z]);
  const high = b => { const v = new THREE.Vector3(b.x, 0, b.z).sub(R).multiplyScalar(2100 / Math.hypot(b.x - R.x, b.z - R.z)).add(R); return P([v.x, TRANSFER_Y, v.z]); };
  const q0 = robot.solve(HOME);
  const base = { q: q0, vac: 0, lz: LOADER.zPark, ly: LOADER.yPark, lvac: 0, ctr: 0, press: 0, clamp: 0, pull: 0, open: 0, scrape: 0, belt: 0, fault: 0 };
  PLAN.forEach((p, k) => Object.assign(base, { ['lam' + k]: p.from, ['frm' + k]: 0, ['box' + k]: 0 }));
  const seq = createStepSequence({ base, nested: true, latch: LAM_KEYS, stations: STATIONS });

  let pose = HOME, q = q0;
  const poses = [];
  const jointTime = (a, b) => Math.max(...JOINTS.map(n => Math.abs(a[n] - b[n]) / (SPEED[n] * D2R)));
  function ptp(st, to, action, sub = '', values = {}, vf = .85) {
    const j = robot.solve(to, q), dur = Math.max(.8, jointTime(q, j) / vf * 1.875);
    poses.push([action, to, j]);
    const s = seq.add(st, +dur.toFixed(2), action, sub, { q: j, ...values }, { robot: 'ptp' });
    pose = to; q = j; return s;
  }
  function lin(st, to, speed, action, sub = '', values = {}) {
    const j = robot.solve(to, q), dur = Math.max(.4, pose.target.distanceTo(to.target) / speed * 1.875);
    poses.push([action, to, j]);
    const s = seq.add(st, +dur.toFixed(2), action, sub, { q: j, ...values }, { robot: 'lin', lin: { from: pose, to } });
    pose = to; q = j; return s;
  }
  const hold = (st, dur, action, sub = '', values = {}, extra = {}) => seq.add(st, dur, action, sub, values, extra);
  const above = (p, dy) => ({ target: p.target.clone().add(new THREE.Vector3(0, dy, 0)), rot: p.rot });
  // 下降：快速到目標上方 60 mm，最後 60 mm 慢速貼合；上升反過來
  function down(st, to, action, sub = '', fast = 1000) { lin(st, above(to, 60), fast, action, sub); return lin(st, to, 150, action, ''); }
  function up(st, to, dy, action, sub = '', fast = 1200) { lin(st, above(to, 60), 150, action, sub); return lin(st, above(to, dy), fast, action, ''); }
  // 移載機：水平與升降同一步時取較長的時間
  let lz = base.lz, ly = base.ly;
  function load(st, z, y, action, sub = '', values = {}, speed = LOADER.speed) {
    const dur = Math.max(.5, Math.abs(z - lz) / speed * 1.875, Math.abs(y - ly) / LOADER.lift * 1.875);
    lz = z; ly = y; return seq.add(st, +dur.toFixed(2), action, sub, { lz: z, ly: y, ...values }, { loader: true });
  }

  hold(0, 1, '待命：手臂在等待位、移載機在機內高位', '拆框機待料；入料 A 剩 1 片、B 滿疊；出料 A 再 1 片就滿', {});
  let belt = 0;
  PLAN.forEach((p, k) => {
    const n = k + 1, lam = 'lam' + k, frm = 'frm' + k, box = 'box' + k;
    const bin = BAYS[p.from], bout = BAYS[p.to];
    // ---------------------------------------------------------------- S1 入料取板
    const PICK = P([bin.x, inGlassY(p.fromIdx), bin.z]);
    if (k > 0) ptp(0, HOME, `第 ${n} 片：經等待位轉向入料`, '從出料側經南側上方轉回，不掃過交接台與移載機');
    ptp(0, high(bin), k > 0 ? `轉向入料 ${p.from.slice(-1)}` : `第 ${n} 片：轉向入料 ${p.from.slice(-1)}`, `入料 ${p.from.slice(-1)}：有棧板感測 ON、工位燈綠`);
    ptp(0, above(PICK, 250), '移到板堆上方');
    hold(0, .6, '雷射測高', `量最上層板面高度（第 ${p.fromIdx + 1} 層），讀到棧板面＝空`, {}, { laser: p.from });
    down(0, PICK, '下降貼合玻璃面', '6 顆 Ø80 風琴吸盤，緩衝行程吸收高度誤差', 600);
    hold(0, .7, '真空吸附', '真空開關確認 −60 kPa', { vac: 1, [lam]: 'robot' });
    lin(0, above(PICK, 30), 40, '慢速剝離', '先抬 30 mm，避免下一片被框邊帶起');
    lin(0, above(PICK, 250), 400, '上升離開板堆',
      p.fromIdx === 0 ? `入料 ${p.from.slice(-1)} 已取完：工位燈轉紅、HMI 通知叉車補料；下一片改取另一工位` : '');
    ptp(0, high(bin), '收臂抬高', '高過移載機導軌（板底 > 1.6 m）');
    // ---------------------------------------------------------------- S2 放上交接台、置中
    ptp(1, TABLE_UP, '轉向交接台');
    down(1, TABLE_SEAT, '下降放板', '鋁框落在兩支長邊托條上');
    hold(1, .5, '破真空放板', '吸盤吹氣破真空', { vac: 0, [lam]: 'table' }, { blow: true });
    up(1, TABLE_SEAT, TRANSFER_Y - GLASS_Y, '吸盤架上升');
    ptp(1, HOME, '退到等待位', '手臂離開交接台區（移載機可進入）');
    hold(1, .8, '置中', '南側推缸把板推靠北側定位塊、東西推缸置中；有板感測 ON', { ctr: 1 });
    hold(1, .4, '置中缸退回', '', { ctr: 0 });
    // ---------------------------------------------------------------- S3 移載機送入拆框機
    load(2, LOADER.zTable, LOADER.ySlide, '移載機移到交接台上方', '拆框機「待料」ON 才允許送板');
    load(2, LOADER.zTable, LOADER.yPick, '移載機下降');
    hold(2, .5, '移載機吸附', '', { lvac: 1, [lam]: 'loader' });
    load(2, LOADER.zTable, LOADER.ySlide, '移載機上升', `板底比放置高度高 ${LOADER.ySlide - LOADER.yPick} mm，越過翻開的壓指`);
    load(2, LOADER.zMachine, LOADER.ySlide, '水平送入拆框機', '經入料口送到機台中心');
    load(2, LOADER.zMachine, LOADER.yPick, '下降放板', '鋁框落在四邊承板、層壓板落在支撐軌上', {}, LOADER.speed);
    hold(2, .5, '移載機破真空放板', '', { lvac: 0, [lam]: 'machine' });
    load(2, LOADER.zPark, LOADER.yPark, '移載機退到機內高位', '移載機離開拆框區 → 送出「拆框啟動」');
    // ---------------------------------------------------------------- S4 拆框剝線盒
    hold(3, 1.4, '中央壓板下壓', '拆框機回「拆框中」；手臂、移載機待命', { press: 1 }, { startSignal: true });
    hold(3, .8, '四邊壓指扣住鋁框', '擺動壓指翻入，夾住鋁框上緣', { clamp: 1 });
    hold(3, 1.4, '刮刀剝除接線盒', '刮刀由南往北推過背板', { scrape: 1, [box]: 1 });
    hold(3, .9, '接線盒落入漏斗', '經漏斗落到滑槽', { [box]: 2 }, { easeKeys: { [box]: fall } });
    if (fault && k === 1) {
      hold(3, 1.2, '四邊外拉鋁框', '外拉途中卡料', { pull: .45, [frm]: .45, scrape: 0 });
      hold(3, 1.5, '故障：外拉逾時（鋁框卡料）', '拆框機「故障」ON、三色燈紅＋蜂鳴；手臂與移載機停在待命位，不搬料', { fault: 1 }, { fault: true });
      hold(3, 5, '人員排除卡料', '人員從機台後側（光柵屏蔽、液壓停止）排除卡住的鋁框', {}, { fault: true });
      hold(3, 1, '復歸', 'HMI 按「復歸」→ 故障 OFF，拆框機重試外拉', { fault: 0 }, { fault: true });
      hold(3, 1.4, '重試外拉鋁框', '夾爪外拉 120 mm，鋁框脫離層壓板', { pull: 1, [frm]: 1 });
    } else {
      hold(3, 2.2, '四邊同時外拉鋁框', '夾爪外拉 120 mm，鋁框脫離層壓板；刮刀退回', { pull: 1, [frm]: 1, scrape: 0 });
    }
    hold(3, .9, '壓指翻開、承板退開', '鋁框失去支撐', { clamp: 0, open: 1 });
    hold(3, .7, '鋁框落下', '長邊落到輸送帶、短邊落入抽屜料箱；接線盒沿滑槽滑進料箱', { [frm]: 2, [box]: 3 }, { easeKeys: { [frm]: fall } });
    belt += 1900;
    hold(3, 2.2, '壓板上升、夾爪復位；長框輸送', '拆框機「拆框完成」ON；輸送帶把長邊鋁框送往東側料車', { press: 0, pull: 0, open: 0, [frm]: 3, belt });
    hold(3, .8, '長邊鋁框落入料車', '料車滿料由反射式光電偵測，通知人員換車', { [frm]: 4 });
    // ---------------------------------------------------------------- S5 移載機取出無框板
    load(4, LOADER.zMachine, LOADER.ySlide, '移載機移到機台中心上方', '');
    load(4, LOADER.zMachine, LOADER.yPick, '移載機下降');
    hold(4, .5, '移載機吸附', '無框層壓板 14.5 kg', { lvac: 1, [lam]: 'loader' });
    load(4, LOADER.zMachine, LOADER.ySlide, '慢速上升', '層壓板與支撐軌分離', {}, LOADER.speed);
    load(4, LOADER.zTable, LOADER.ySlide, '水平取出', '拆框機回「待料」');
    load(4, LOADER.zTable, LOADER.yPick, '下降放到交接台', '層壓板落在兩支內托條上（沒有鋁框）');
    hold(4, .5, '移載機破真空', '', { lvac: 0, [lam]: 'table' });
    load(4, LOADER.zPark, LOADER.yPark, '移載機退回機內高位');
    // ---------------------------------------------------------------- S6 手臂疊放出料
    ptp(5, TABLE_UP, '手臂移到交接台上方');
    down(5, TABLE_SEAT, '下降貼合玻璃面');
    hold(5, .6, '真空吸附', '', { vac: 1, [lam]: 'robot' });
    up(5, TABLE_SEAT, TRANSFER_Y - GLASS_Y, '上升', '層壓板離開內托條');
    const PLACE = P([bout.x, outGlassY(p.toIdx), bout.z]);
    ptp(5, above(PLACE, 250), `轉向出料 ${p.to.slice(-1)}`, `出料 ${p.to.slice(-1)}：第 ${p.toIdx + 1} 片（玻璃面朝上直接疊放）`);
    down(5, PLACE, '下降疊放', '', 800);
    hold(5, .5, '破真空放板', '', { vac: 0, [lam]: p.to }, { blow: true });
    lin(5, above(PLACE, 250), 400, '上升離開',
      p.toIdx + 1 >= OUT_MAX ? `出料 ${p.to.slice(-1)} 滿 ${OUT_MAX} 片（對照式光電遮光）：工位燈轉紅、通知換棧板；下一片改放另一工位` : '');
  });
  ptp(5, HOME, '回等待位', '兩片示範完成；正常生產時接著取下一片');

  // 每片節拍：兩片的第一個事件相差（故障情境只看第 1 片到第 2 片之間，不含故障停機）
  const ev = seq.events, first = ev.find(e => e.label.startsWith('第 1 片')), second = ev.find(e => e.label.startsWith('第 2 片'));
  const cycle = first && second ? second.time - first.time : seq.total;
  return { seq, poses, cycle, HOME, TABLE_UP, TABLE_SEAT };
}

// 直線段：依緩動內插位姿（位置線性、姿態球面內插）
export function linPose(step, e) {
  const { from, to } = step.lin;
  return { target: from.target.clone().lerp(to.target, e), rot: from.rot.clone().slerp(to.rot, e) };
}
