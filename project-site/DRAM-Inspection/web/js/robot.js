// DENSO HSR065 SCARA＋雙頭三孔取放工具（A：interposer、B：SOCAMM，各一支氣動滑台切換）＋下視相機＋雷射位移計。
// 手臂本體與解析逆解在共用模型（core/models/robots/denso-hsr065.js）；這裡只裝本站的工具、TCP，以及底座轉 180° 的座標換算。
// 法蘭本地：原點在法蘭端面、工具往 −y；零件長邊沿法蘭本地 X，兩個頭沿法蘭本地 Z 排列（A 在 −Z、B 在 +Z）。
import * as THREE from 'three';
import { block, cylinder, decal } from '@core/geom/shapes.js';
import { MAT, std } from '@core/geom/materials.js';
import { createHSR065, HSR065, JOINTS, withinLimits, wrapPi, fk as armFk } from '@core/models/robots/denso-hsr065.js';
import { slideTable } from '@core/models/motion.js';
import { visionCamera } from '@core/models/vision.js';
import { tagPart } from '@core/models/parts.js';
import { MOD } from './parts.js';
import { LAY } from './machine.js';
import { REF } from './refs.js';

const PB = -16;                                     // 轉接板底面
export const TOOL = {
  stroke: 12, headZ: 30,
  tcpY: PB - 40 - 6 - 3.5 - 12 - .02,               // 伸出時三孔頭的肩部底面下 0.02 mm（＝零件頂面；留間隙避免重合面）
  camY: -66, laser: [64, -48, 0],
};
export const OFF = {
  A: new THREE.Vector3(0, TOOL.tcpY, -TOOL.headZ),
  B: new THREE.Vector3(0, TOOL.tcpY, TOOL.headZ),
  cam: new THREE.Vector3(0, TOOL.camY, 0),
  laser: new THREE.Vector3(TOOL.laser[0], PB - 32, 0),
};
const BASE = new THREE.Vector3(0, LAY.robot.y, 0);  // 手臂本地（未轉向）的底座
const R = LAY.robot;

/**
 * 世界座標逆解：底座繞 Y 轉 180°（第一臂 J1=0 朝 −Z，指向輸送線）。
 * elbow 指定肘部方向（+1：J2 > 0，西側作業；−1：J2 < 0，東側作業），整段作業維持同一個肘向，點到點移動才不會大幅甩臂；
 * 不給時兩組都試，取離參考姿態近的。J4 取 ±360° 內離參考最近的等價角。
 */
export function ikWorld(key, p, yaw, ref = { j1: 0, j2: 0, d3: 0, j4: 0 }, elbow = 0) {
  const { L1, L2 } = HSR065, o = OFF[key], yl = yaw - Math.PI;
  const lx = -(p.x - R.x), lz = -(p.z - R.z);
  const fx = lx - (o.x * Math.cos(yl) + o.z * Math.sin(yl)), fz = lz - (-o.x * Math.sin(yl) + o.z * Math.cos(yl));
  const c2 = (fx * fx + fz * fz - L1 * L1 - L2 * L2) / (2 * L1 * L2), d3 = R.y + HSR065.flange0 - (p.y - o.y);
  if (Math.abs(c2) > 1) return null;
  let best = null, bestD = Infinity;
  for (const s of elbow ? [elbow] : [1, -1]) {
    const b2 = s * Math.acos(c2), b1 = Math.atan2(fx, fz) - Math.atan2(L2 * Math.sin(b2), L1 + L2 * Math.cos(b2));
    const c = { j1: wrapPi(b1), j2: b2, d3, j4: 0 }, j4 = wrapPi(yl - c.j1 - c.j2);
    for (const k of [0, 2 * Math.PI, -2 * Math.PI]) {
      const cand = { ...c, j4: j4 + k }; if (!withinLimits(cand)) continue;
      const d = Math.abs(cand.j1 - ref.j1) * 2 + Math.abs(cand.j2 - ref.j2) + Math.abs(cand.j4 - ref.j4) * .2;
      if (d < bestD) { bestD = d; best = cand; }
    }
  }
  return best;
}
export function fkWorld(q, key) {
  const r = armFk(q, OFF[key], BASE);
  return { p: new THREE.Vector3(R.x - r.p.x, r.p.y, R.z - r.p.z), yaw: r.yaw + Math.PI };
}
/** 點到點移動時間（各軸以型錄 50% 速度、五次 S 曲線的峰值係數 1.875） */
export function ptpTime(a, b) {
  return Math.max(.25, 1.875 * Math.max(...JOINTS.map(n => Math.abs(b[n] - a[n]) / HSR065.speed[n])));
}

export function createRobot(scene) {
  const arm = createHSR065(), root = arm.root;
  root.name = 'robot'; root.position.set(R.x, R.y, R.z); root.rotation.y = Math.PI; scene.add(root);
  Object.assign(root.userData, { coreModel: 'denso-hsr065', cableHost: false }); tagPart(arm, REF.scara);
  // 台座（台面 → 底座）
  const ped = new THREE.Group(); ped.name = 'robot-pedestal'; scene.add(ped);
  block(ped, [260, R.y - LAY.table, 300], [R.x, (R.y + LAY.table) / 2, R.z + 30], MAT.steelDark);
  const tool = arm.flange;
  // 轉接板（法蘭 → 工具）：鋁板＋快換定位銷（示意）
  block(tool, [150, 6, 100], [0, PB + 3, 0], MAT.alu);
  // 三孔頭：氣動滑台（行程 12）→ 頭板 → 3 支肩部＋漲緊銷（插入零件孔）＋狀態燈
  const heads = {};
  for (const [key, z, color, label] of [['A', -TOOL.headZ, MAT.steelBlue, 'INT'], ['B', TOOL.headZ, MAT.steelOrange, 'SOC']]) {
    const g = new THREE.Group(); g.name = 'head-' + key; g.position.set(0, PB, z); tool.add(g);
    const st = slideTable.create({ w: 30, h: 40, d: 18, stroke: TOOL.stroke, table: false, bodyMaterial: color }); g.add(st.root); tagPart(st, REF.slide);
    const t = st.table;
    block(t, [104, 6, 16], [0, -40 - 3, 0], MAT.alu);
    for (const hx of MOD.holes) {
      cylinder(t, 2.2, 3.5, [hx, -46 - 1.75, 0], MAT.steelDark, 'y', 16);                    // 肩部（壓在孔周）
      cylinder(t, 1.05, 2.5, [hx, -49.5 - 1.25, 0], MAT.chrome, 'y', 12);                    // 漲緊銷（伸入孔內）
    }
    const led = block(t, [6, 3, 3], [44, -41, 8.6], std(0x203a20, .4, 0, { emissive: 0x3dd68c, emissiveIntensity: .05 }));
    decal(t, 26, 5, [-30, -43, 8.7], [0, 0, 0], [label], { color: '#e8eef3', bg: null, center: true });
    heads[key] = { group: g, slide: st, led };
  }
  // 下視相機（PCB 基準點）＋雷射位移計（三點入位高度）
  const cam = visionCamera.create({ axis: '-y', bodyW: 29, bodyD: 29, bodyL: 30, lensR: 9, lensL: 20, ringR: 13, fov: 30, view: { fov: 30, aspect: 1.5, near: 2, far: 400 } });
  cam.root.position.set(0, TOOL.camY, 0); tool.add(cam.root); tagPart(cam, REF.camTop);
  const laser = new THREE.Group(); laser.name = 'laser-sensor'; tool.add(laser);
  block(laser, [20, 30, 26], [TOOL.laser[0], PB - 15, 0], MAT.black);
  block(laser, [8, 2, 8], [TOOL.laser[0], PB - 31, 0], std(0x401010, .3, 0, { emissive: 0xff2020, emissiveIntensity: .4 }));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, 1, 6), std(0xff3030, .3, 0, { emissive: 0xff2020, emissiveIntensity: 2 }));
  beam.userData.fx = true; beam.visible = false; laser.add(beam);

  // 狀態：關節（rad、mm）、頭伸出 A／B（0～1）、夾持 gA／gB、閃光、雷射（beamLen：光束長度）
  function set(s) {
    arm.setJoints({ j1: s.j1, j2: s.j2, d3: s.d3, j4: s.j4 });
    heads.A.slide.set({ ext: s.A }); heads.B.slide.set({ ext: s.B });
    heads.A.led.material.emissiveIntensity = s.gA > .5 ? 1.6 : .05;
    heads.B.led.material.emissiveIntensity = s.gB > .5 ? 1.6 : .05;
    cam.set(s.flash || 0);
    const L = s.beamLen || 0; beam.visible = L > 1;
    if (beam.visible) { beam.scale.y = L; beam.position.set(TOOL.laser[0], PB - 32 - L / 2, 0); }
  }
  return { root, arm, tool, heads, cam, set };
}
