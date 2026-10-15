// SCARA 取放動作：吸盤中心點（pad）的目標 → 關節角（core 的 ik），點與點之間在關節空間內插（五次 S 曲線）。
// 取放循環寫成時間的純函式（cycle(φ)），倒播、跳播結果相同。
import * as THREE from 'three';
import { ik } from '@core/models/robots/denso-hsr065.js';
import { smooth } from '@core/anim/track.js';
import { TOOL, padOffset } from './unloader.js';

const O = { x: 0, y: -TOOL, z: 0 };
export const lerpQ = (a, b, e) => ({ j1: a.j1 + (b.j1 - a.j1) * e, j2: a.j2 + (b.j2 - a.j2) * e, d3: a.d3 + (b.d3 - a.d3) * e, j4: a.j4 + (b.j4 - a.j4) * e });

// 吸盤中心：工件中心（底面中心 c）＋ Ry(yaw)·(0, h, pad)
export function padAt(part, c, yaw) {
  const pz = padOffset(part);
  return new THREE.Vector3(c.x + pz * Math.sin(yaw), c.y + part.h, c.z + pz * Math.cos(yaw));
}
// 解出關節角；ref 決定肘部方向與 J4 圈數
export function solve(base, target, yaw, ref) {
  const q = ik(target, yaw, ref, O, base);
  if (!q) throw new Error(`SCARA 到不了 (${target.x.toFixed(0)}, ${target.y.toFixed(0)}, ${target.z.toFixed(0)})`);
  return q;
}
// 同一個水平位置換高度（只動 d3）
export const atHeight = (q, base, y) => ({ ...q, d3: base.y + 270 - (y - O.y) });

// 段落表 → 依 φ 取關節角與吸附狀態。segs：[{ t0, t1, a, b, hold }]（a、b 為關節角；hold 為該段結束後是否吸住）
export function evalSegs(segs, phi, start) {
  let q = start.q, hold = start.hold;
  for (const s of segs) {
    if (phi < s.t0) break;
    const e = s.t1 > s.t0 ? Math.min(1, (phi - s.t0) / (s.t1 - s.t0)) : 1;
    q = lerpQ(s.a, s.b, smooth(e)); if (e >= .5 && s.hold !== undefined) hold = s.hold;
  }
  return { q, hold };
}

// 一次取放（上方 → 下降 → 吸 → 上升 → 移到放置點上方 → 下降 → 放 → 上升）的段落；T：各段時間
export function pickPlace({ from, pick, place, travel, base, T }) {
  const pa = atHeight(pick, base, travel), pl = atHeight(place, base, travel);
  let t = 0; const segs = [], seg = (dur, a, b, hold) => { segs.push({ t0: t, t1: t + dur, a, b, hold }); t += dur; };
  seg(T.move, from, pa); seg(T.down, pa, pick); seg(T.grip, pick, pick, true); seg(T.down, pick, pa);
  seg(T.move, pa, pl); seg(T.down, pl, place); seg(T.grip, place, place, false); seg(T.down, place, pl);
  return { segs, end: t, last: pl, marks: { grip: segs[2].t0 + T.grip / 2, release: segs[6].t0 + T.grip / 2, lifted: segs[3].t1 } };
}
