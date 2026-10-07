// 動畫排程：單一手臂＋拆框機依序作業（createStepSequence），任一時刻的狀態只由時間決定。
// 一個循環（每片板）：S1 入料取板 → S2 送入拆框機 → S3 拆框剝線盒（手臂在機外等待）→ S4 取出無框板 → S5 疊放出料。
// 狀態鍵：
//   q              手臂關節角（rad，逐項插值）；直線段另外在 step.lin 記起訖位姿，apply 時沿直線追蹤
//   vac            吸盤真空（0／1）
//   press clamp pull open scrape   拆框機動作（0～1）
//   lam0 lam1      第 k 片的層壓板在哪裡：'in' 入料棧板、'held' 吸在吸盤上、'machine' 拆框機上、'out' 出料棧板（步驟結束才切換）
//   frm0 frm1      第 k 片的鋁框：0 在板上、0～1 隨夾爪外拉、1～2 落入收集槽
//   box0 box1      第 k 片的接線盒：0 在板上、0～1 被刮刀推、1～2 落入料箱
import * as THREE from 'three';
import { createStepSequence } from '@core/anim/sequence.js';
import { D2R } from '@core/geom/shapes.js';
import { JOINTS, SPEED } from './robot.js';
import { IN, OUT, GLASS_Y, SLIDE_Y, SLIDE_Z, TRANSFER_Y, inGlassY, outGlassY } from './layout.js';

export const STATIONS = ['入料取板', '送入拆框機', '拆框剝線盒', '取出無框板', '疊放出料'];
export const CYCLES = 2;                     // 動畫示範兩片（入料最上面兩片）
const NORTH = [0, 0, -1];
const ease = { in: t => t * t };             // 自由落下

export function createSequence(robot) {
  const P = (c, d) => robot.posePanel(c, d);
  const WAIT = P([0, TRANSFER_Y, SLIDE_Z], NORTH);
  const FRONT = P([0, SLIDE_Y, SLIDE_Z], NORTH), INSIDE = P([0, SLIDE_Y, 0], NORTH), SEAT = P([0, GLASS_Y, 0], NORTH);
  const q0 = robot.solve(WAIT);
  const base = { q: q0, vac: 0, press: 0, clamp: 0, pull: 0, open: 0, scrape: 0 };
  for (let k = 0; k < CYCLES; k++) Object.assign(base, { ['lam' + k]: 'in', ['frm' + k]: 0, ['box' + k]: 0 });
  const seq = createStepSequence({ base, nested: true, latch: ['lam0', 'lam1'], stations: STATIONS });

  let pose = WAIT, q = q0;
  const poses = [];                                                  // 所有用到的位姿（可達檢查）
  const jointDist = (a, b) => Math.max(...JOINTS.map(n => Math.abs(a[n] - b[n]) / (SPEED[n] * D2R)));
  // 點到點：五次 S 曲線，關節速度取 55%（搬 50 kg 級負載）
  function ptp(st, to, action, sub = '', values = {}, vf = .55) {
    const j = robot.solve(to, q);
    const dur = Math.max(1, jointDist(q, j) / vf * 1.875);
    poses.push([action, to, j]);
    const s = seq.add(st, +dur.toFixed(2), action, sub, { q: j, ...values }, { robot: 'ptp' });
    pose = to; q = j; return s;
  }
  // 直線：速度 mm/s，起訖加減速（smooth）
  function lin(st, to, speed, action, sub = '', values = {}) {
    const j = robot.solve(to, q);
    const d = pose.target.distanceTo(to.target), dur = Math.max(.5, d / speed * 1.875);
    poses.push([action, to, j]);
    const s = seq.add(st, +dur.toFixed(2), action, sub, { q: j, ...values }, { robot: 'lin', lin: { from: pose, to } });
    pose = to; q = j; return s;
  }
  const hold = (st, dur, action, sub = '', values = {}, extra = {}) => seq.add(st, dur, action, sub, values, extra);
  const above = (p, dy) => ({ target: p.target.clone().add(new THREE.Vector3(0, dy, 0)), rot: p.rot });

  hold(0, 1, '待命：手臂停在拆框機前', '拆框機空機、入料棧板就位，光柵正常');
  for (let k = 0; k < CYCLES; k++) {
    const lam = 'lam' + k, frm = 'frm' + k, box = 'box' + k, n = k + 1;
    // ---------------------------------------------------------------- S1 入料取板
    const iTop = IN.n - 1 - k, PICK = P([IN.x, inGlassY(iTop), IN.z], IN.dir);
    if (k > 0) ptp(0, WAIT, `第 ${n} 片：經等待位轉向入料`, '從出料側經北側轉回，吸盤架收在拆框機入料口外');
    ptp(0, above(PICK, 250), k > 0 ? '移到入料棧板上方' : `第 ${n} 片：移到入料棧板上方`, '吸盤架轉向西側，主樑沿東西向');
    hold(0, .6, '雷射測高', `量最上層板面高度（第 ${IN.n - k} 層），修正下降量`);
    lin(0, PICK, 250, '下降貼合玻璃面', '8 顆 Ø80 風琴吸盤，緩衝行程吸收高度誤差');
    hold(0, .8, '真空吸附', '真空開關確認 8 路都達 −60 kPa', { vac: 1, [lam]: 'held' });
    lin(0, above(PICK, 30), 40, '慢速剝離', '先抬 30 mm，避免下一片因框邊卡住被帶起');
    lin(0, above(PICK, 250), 400, '上升離開板堆');
    // ---------------------------------------------------------------- S2 送入拆框機
    ptp(1, FRONT, '轉向拆框機入料口', 'J1 由西轉北；板中心停在入料口外 1.55 m');
    lin(1, INSIDE, 800, '水平送入拆框機', `板底比放置高度高 ${Math.round(SLIDE_Y - GLASS_Y)} mm，越過翻開的壓指`);
    lin(1, SEAT, 150, '下降放板', '鋁框落在四邊承板上，層壓板落在兩支支撐軌上');
    hold(1, .6, '破真空放板', '吸盤吹氣破真空', { vac: 0, [lam]: 'machine' });
    lin(1, above(SEAT, SLIDE_Y - GLASS_Y), 300, '吸盤架上升');
    lin(1, FRONT, 1000, '水平退出拆框機');
    ptp(1, WAIT, '退到等待位', '手臂離開機台區，發出「放板完成」給拆框機');
    // ---------------------------------------------------------------- S3 拆框剝線盒（拆框機動作，手臂等待）
    hold(2, 1.4, '中央壓板下壓', '油壓缸把層壓板壓在支撐軌上', { press: 1 });
    hold(2, .8, '四邊壓指扣住鋁框', '擺動壓指翻入，夾住鋁框上緣', { clamp: 1 });
    hold(2, 1.4, '刮刀剝除接線盒', '刮刀由南往北推過背板，接線盒落入料箱', { scrape: 1, [box]: 1 });
    hold(2, .7, '接線盒落入料箱', '', { [box]: 2 }, { easeKeys: { [box]: ease.in } });
    hold(2, 2.2, '四邊同時外拉鋁框', `夾爪外拉 120 mm，鋁框脫離層壓板；刮刀退回`, { pull: 1, [frm]: 1, scrape: 0 });
    hold(2, .9, '壓指翻開、承板退開', '鋁框失去支撐', { clamp: 0, open: 1 });
    hold(2, .8, '鋁框落入收集槽', '四支鋁框各自落入正下方的收集槽', { [frm]: 2 }, { easeKeys: { [frm]: ease.in } });
    hold(2, 1.6, '壓板上升、夾爪復位', '拆框完成，通知手臂取板', { press: 0, pull: 0, open: 0 });
    // ---------------------------------------------------------------- S4 取出無框板
    ptp(3, FRONT, '移到入料口', '');
    lin(3, INSIDE, 1000, '水平伸入拆框機', '吸盤架從層壓板上方伸入');
    lin(3, SEAT, 150, '下降貼合玻璃面', '無框層壓板 14.5 kg，邊緣不再有鋁框保護');
    hold(3, .8, '真空吸附', '', { vac: 1, [lam]: 'held' });
    lin(3, above(SEAT, SLIDE_Y - GLASS_Y), 120, '慢速上升', '層壓板與支撐軌分離');
    lin(3, FRONT, 700, '水平取出');
    // ---------------------------------------------------------------- S5 疊放出料
    const iOut = OUT.n + k, PLACE = P([OUT.x, outGlassY(iOut), OUT.z], OUT.dir);
    ptp(4, above(PLACE, 250), '轉向出料棧板', 'J1 由北轉東');
    lin(4, PLACE, 250, '下降疊放', `第 ${iOut + 1} 片（玻璃面朝上直接疊放）`);
    hold(4, .6, '破真空放板', '', { vac: 0, [lam]: 'out' });
    lin(4, above(PLACE, 250), 400, '上升離開');
  }
  ptp(4, WAIT, '回等待位', '一個循環完成，下一片接著從入料棧板取');

  // 錄影只改取景距離，步驟時長、位姿、互鎖與關節路徑維持原排程。
  for (const step of seq.steps) {
    if (step.station === 2) step.offset = [1550, 1050, 1850];
    else if (['雷射測高', '真空吸附', '破真空放板', '慢速剝離'].includes(step.action)) step.offset = [-1150, 850, 1450];
    else if (step.robot === 'lin' && [1, 3].includes(step.station)) step.offset = [1700, 1200, 2200];
  }

  // 各站的節拍（每片）：從第 2 片的事件推算
  const cycle = (() => {
    const ev = seq.events, s = ev.filter(e => e.label.startsWith('第 2 片'))[0], f = ev.filter(e => e.label.startsWith('第 1 片'))[0];
    return s && f ? s.time - f.time : seq.total;
  })();
  return { seq, poses, cycle, WAIT, FRONT, INSIDE, SEAT };
}

// 直線段：依緩動內插位姿（位置線性、姿態球面內插）
export function linPose(step, e) {
  const { from, to } = step.lin;
  return { target: from.target.clone().lerp(to.target, e), rot: from.rot.clone().slerp(to.rot, e) };
}
