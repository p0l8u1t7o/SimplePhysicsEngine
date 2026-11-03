// 末端工具（6 支）與快換盤：局部原點在工具側快換盤結合面，+Z 為工具前進方向，TCP 在 (0, 0, TOOL_LEN)（接觸襯裡表面的點）。
// 工具 +X 為行走方向（焊接姿態由 IK 對齊焊道切線）。熱風焊槍外形參考 docs/LHS SYSTEM 21S.stp（本體約 Ø66 × 300、尾端接線盒）。
// 效果（熱風、雷射線、兆赫波束）標 userData.fx，不參與干涉檢查。
import * as THREE from 'three';
import { MAT, std, finished } from '@core/geom/materials.js';
import { cable, CABLE } from '@core/electrical/cable-routing.js';
import { decal } from '@core/geom/shapes.js';
import { sensor } from '@core/models/hardware.js';
import { laserProfiler } from '@core/models/vision.js';
import { TOOL_LEN } from './spec.js';

export const ATC_LEN = 30;                     // 手臂側快換盤（法蘭面 → 結合面）
export const RACK_DEPTH = TOOL_LEN + 70;       // 工具架層板在結合面下方的距離（工具下緣留約 40 mm）

const M = {
  coupling: std(0x9aa4ad, .35, .75), body: std(0x30363d, .5, .35), gun: std(0xb8bec4, .3, .8), gunCap: std(0x262b30, .55, .2),
  nozzle: std(0xd8a86a, .35, .7), shoe: std(0xc9ced3, .25, .85), blade: std(0xe3e7ea, .15, 1), green: std(0x2f6b4f, .5, .25),
  thz: std(0x2c3a52, .45, .35), lens: std(0x96b7d8, .1, .2, { transparent: true, opacity: .75 }), pfa: std(0xf4f5ef, .35, 0), spool: std(0x2d5f9a, .5, .1),
  roller: std(0xc2694a, .6, 0),
};
const fxMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
M.gun = finished(M.gun, 'metal', .04);

function mesh(parent, geom, mat, pos = [0, 0, 0], rot = [0, 0, 0], name = '') {
  const m = new THREE.Mesh(geom, mat); m.position.set(...pos); m.rotation.set(...rot); m.castShadow = m.receiveShadow = true; if (name) m.name = name; parent.add(m); return m;
}
// 沿 Z 的圓柱（z0 → z1）
const cylZ = (parent, r, z0, z1, mat, x = 0, y = 0, rTop = r, seg = 28) => mesh(parent, new THREE.CylinderGeometry(rTop, r, z1 - z0, seg), mat, [x, y, (z0 + z1) / 2], [Math.PI / 2, 0, 0]);
// 兩點間的圓柱
function rodBetween(parent, a, b, r, mat, seg = 20) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), m = mesh(parent, new THREE.CylinderGeometry(r, r, A.distanceTo(B), seg), mat);
  m.position.copy(A).add(B).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); return m;
}
// 熱風焊槍（LHS 21S 外形）：與工具軸平行、側偏 x，槍口在 z = zTip，尾端接線盒延伸到快換盤後方（沿手腕側邊）
function hotAirGun(parent, x, zTip) {
  const g = new THREE.Group(); g.name = 'LHS21S'; parent.add(g);
  cylZ(g, 13, zTip - 40, zTip, M.nozzle, x);                 // 噴嘴頸
  cylZ(g, 33, zTip - 270, zTip - 40, M.gun, x, 0, 33, 32);   // 加熱管本體
  cylZ(g, 36, zTip - 300, zTip - 270, M.gunCap, x, 0, 36, 32);   // 尾蓋
  mesh(g, new THREE.BoxGeometry(64, 70, 56), M.gunCap, [x, 0, zTip - 328]);   // 接線盒
  cylZ(g, 11, zTip - 320, zTip - 300, M.gunCap, x, 38);       // 進氣口
  for (const z of [zTip - 190, zTip - 90]) mesh(g, new THREE.BoxGeometry(80, 26, 22), M.coupling, [x + 30, 0, z]);   // 槍夾（避開快換盤：z ≥ 40）
  mesh(g, new THREE.BoxGeometry(14, 26, 122), M.coupling, [x + 64, 0, zTip - 140]);   // 槍夾連接板
  cylZ(g, 37, zTip - 50, zTip - 36, M.coupling, x);             // 法蘭跨過接合處，端面錯開以免閃爍
  for (const y of [-22, 22]) cylZ(g, 3, zTip - 35, zTip - 31, M.body, x + 24, y, 3, 6);
  cable(g, 'gun-air', [[x, 38, zTip - 310], [x, 58, zTip - 300], [x, 58, 40], [-38, 58, 28]], { radius: 9, color: CABLE.air, clips: 2 });
  cable(g, 'gun-power', [[x + 28, 0, zTip - 328], [x + 42, -42, zTip - 315], [x + 42, -42, 35], [-30, -42, 24]], { radius: 3, color: CABLE.power, clips: 1 });
  decal(g, 46, 20, [x, 35.1, zTip - 165], [-Math.PI / 2, 0, 0], ['LHS 21S', 'HOT AIR'], { center: true, color: '#26343e' });
  return g;
}
// 捲盤的輪緣、料卷與輻條共用原捲盤中心；角度由累積加工進度決定，倒序播放也一致。
function reelDetails(reel, radius, halfWidth) {
  for (const y of [-halfWidth - 2, halfWidth + 2]) {
    mesh(reel, new THREE.CylinderGeometry(radius + 3, radius + 3, 3, 32), M.spool, [0, y, 0]);
    for (let i = 0; i < 3; i++) mesh(reel, new THREE.BoxGeometry(radius * 1.5, 2, 5), M.coupling, [0, y + Math.sign(y) * 2, 0], [0, i * Math.PI / 3, 0]);
  }
  reel.material = M.pfa;
}
function couplingPlate(t) {
  cylZ(t, 44, 0, 14, M.coupling).name = 'tool-coupling';     // 工具側快換盤
  mesh(t, new THREE.BoxGeometry(70, 70, 10), M.coupling, [0, 0, 19], [0, 0, 0], 'tool-coupling');
}

// ---------------------------------------------------------------- 各工具
const BUILD = {
  // 3D 相機（結構光投影＋雙鏡頭＋環形光）：工作距離約 160 mm，焦點（TCP）在襯裡表面；取像時投影藍光條紋
  cam(t) {
    couplingPlate(t);
    mesh(t, new THREE.BoxGeometry(70, 60, 50), M.coupling, [0, 0, 45]);
    mesh(t, new THREE.BoxGeometry(150, 64, 70), M.body, [0, 0, 105]);             // 相機機身（基線方向 X）
    for (const x of [-52, 52]) cylZ(t, 15, 140, 158, M.lens, x, 0, 15, 20);        // 雙鏡頭
    cylZ(t, 19, 140, 160, M.coupling, 0, 0, 19, 24);                               // 投影器
    mesh(t, new THREE.TorusGeometry(26, 4, 8, 32), std(0xdfe8ff, .3, 0, { emissive: 0x3c6cff, emissiveIntensity: .4 }), [0, 0, 162]).name = 'ring-light';
    mesh(t, new THREE.BoxGeometry(36, 24, 40), M.body, [0, 44, 90]);               // 接頭
    const beam = mesh(t, new THREE.ConeGeometry(70, TOOL_LEN - 164, 4, 1, true), fxMat(0x5aa0ff, .18), [0, 0, (164 + TOOL_LEN) / 2], [-Math.PI / 2, Math.PI / 4, 0]);
    beam.userData.fx = true; beam.name = 'scan-light';
    return { set(on) { beam.visible = on; } };
  },
  // 開 V 槽刀：主軸馬達＋V 形刀＋兩條導靴；前方（+X）裝 3D 線雷射循縫
  groove(t) {
    couplingPlate(t);
    cylZ(t, 30, 24, 172, M.body); cylZ(t, 18, 172, 206, M.coupling, 0, 0, 12);
    const cutter = cylZ(t, 8.5, 206, TOOL_LEN - 1, M.blade, 0, 0, .8, 20);                       // V 形刀（尖端在 TCP）
    for (let i = 0; i < 3; i++) mesh(cutter, new THREE.BoxGeometry(2, 65, 2), M.body, [5 * Math.cos(i * 2 * Math.PI / 3), 0, 5 * Math.sin(i * 2 * Math.PI / 3)]);
    for (const y of [-15, 15]) mesh(t, new THREE.BoxGeometry(70, 7, 10), M.shoe, [-6, y, TOOL_LEN - 5]);   // 導靴底面貼襯裡
    mesh(t, new THREE.BoxGeometry(8, 40, 40), M.coupling, [-38, 0, TOOL_LEN - 28]);
    mesh(t, new THREE.BoxGeometry(14, 22, 150), M.coupling, [44, 0, 104]);        // 雷射支架
    const prof = laserProfiler.create(); prof.root.position.set(78, 0, 150); prof.root.rotation.y = -.35; t.add(prof.root);
    prof.root.traverse(o => { if (o.isMesh && (o.material?.transparent || /plane|fan|beam/i.test(o.name))) o.userData.fx = true; });
    const line = mesh(t, new THREE.PlaneGeometry(28, 1.6), fxMat(0xff3024, .9), [38, 0, TOOL_LEN - .8]); line.userData.fx = true;
    const chips = new THREE.Group(); chips.userData.fx = true; t.add(chips);
    for (let i = 0; i < 5; i++) mesh(chips, new THREE.BoxGeometry(3, 1, 6), M.pfa, [-12 - i * 7, 8 + i * 3, TOOL_LEN - 3 - i * 2], [i, i * .4, 0]);
    return { set(on, travel = 0) { prof.set({ laser: on ? 1 : 0 }); cutter.rotation.y = travel * 120; line.visible = chips.visible = on; chips.position.x = on ? -((travel * 40) % 12) : 0; } };
  },
  // 焊條焊槍：LHS 21S 與工具軸平行（側偏 105），彎管把熱風送到拖嘴（約 80 mm）壓在焊道上；焊條從捲盤經送料輪進入拖嘴
  rod(t) {
    couplingPlate(t);
    mesh(t, new THREE.BoxGeometry(60, 70, 60), M.coupling, [-40, 0, 54]);          // 槍座
    hotAirGun(t, -105, TOOL_LEN - 50);
    rodBetween(t, [-105, 0, TOOL_LEN - 50], [-12, 0, TOOL_LEN - 16], 11, M.nozzle);   // 彎管
    mesh(t, new THREE.BoxGeometry(80, 14, 12), M.shoe, [10, 0, TOOL_LEN - 6]);     // 拖嘴壓靴（長 80，前端引導、後端壓平）
    const spool = mesh(t, new THREE.CylinderGeometry(58, 58, 30, 32), M.spool, [40, 66, 120]); spool.name = 'rod-spool'; reelDetails(spool, 58, 15);
    mesh(t, new THREE.BoxGeometry(40, 36, 40), M.body, [52, 30, 190]);             // 送料馬達
    const feed = rodBetween(t, [52, 18, 210], [34, 0, TOOL_LEN - 14], 2.4, M.pfa, 10); feed.name = 'pfa-rod';
    rodBetween(t, [52, 18, 210], [41, 8, 250], 4.5, M.shoe, 12);   // 焊條導管，出口保留可見焊條
    mesh(t, new THREE.BoxGeometry(10, 20, 5), M.nozzle, [34, 0, TOOL_LEN - 17]);
    const glow = mesh(t, new THREE.ConeGeometry(16, 46, 20, 1, true), fxMat(0xff7a2a, .55), [-6, 0, TOOL_LEN - 22], [-Math.PI / 2, 0, -Math.PI / 4]);
    glow.userData.fx = true; glow.name = 'hot-air';
    return { set(on, travel = 0) { glow.visible = on; spool.rotation.y = -travel * 18; } };
  },
  // 削平刀：刀座＋碳化鎢刀片，兩側滑靴控制削平高度
  flat(t) {
    couplingPlate(t);
    mesh(t, new THREE.BoxGeometry(96, 76, 110), M.green, [0, 0, 82]);
    mesh(t, new THREE.BoxGeometry(60, 44, 70), M.body, [0, 0, 172]);
    mesh(t, new THREE.BoxGeometry(18, 34, 32), M.blade, [12, 0, TOOL_LEN - 17]);   // 刀片
    for (const y of [-26, 26]) mesh(t, new THREE.BoxGeometry(84, 8, 12), M.shoe, [-4, y, TOOL_LEN - 6]);
    return { set() { } };
  },
  // 焊帶焊槍：LHS 21S 平行側偏＋寬口噴嘴，壓輪把 PFA 焊帶壓在焊道上；焊帶捲盤在另一側
  belt(t) {
    couplingPlate(t);
    mesh(t, new THREE.BoxGeometry(60, 70, 60), M.coupling, [-40, 0, 54]);
    hotAirGun(t, -105, TOOL_LEN - 60);
    rodBetween(t, [-105, 0, TOOL_LEN - 60], [-30, 0, TOOL_LEN - 26], 11, M.nozzle);
    mesh(t, new THREE.BoxGeometry(14, 36, 26), M.nozzle, [-26, 0, TOOL_LEN - 22]);   // 寬口噴嘴
    const roller = mesh(t, new THREE.CylinderGeometry(20, 20, 36, 28), M.roller, [8, 0, TOOL_LEN - 20]); roller.name = 'press-roller';
    mesh(roller, new THREE.BoxGeometry(24, 1, 3), M.shoe, [0, 18.8, 0]);
    for (const y of [-21, 21]) mesh(t, new THREE.BoxGeometry(40, 4, 60), M.coupling, [14, y, TOOL_LEN - 42]);   // 壓輪叉
    mesh(t, new THREE.BoxGeometry(30, 46, 90), M.coupling, [14, 0, TOOL_LEN - 117]);
    const reel = mesh(t, new THREE.CylinderGeometry(72, 72, 30, 36), M.spool, [60, 0, 120]); reel.name = 'tape-reel'; reelDetails(reel, 72, 15);
    mesh(t, new THREE.BoxGeometry(.8, 30, 150), M.pfa, [40, 0, TOOL_LEN - 90], [0, .45, 0]).name = 'pfa-tape';
    const glow = mesh(t, new THREE.ConeGeometry(18, 40, 20, 1, true), fxMat(0xff7a2a, .5), [-14, 0, TOOL_LEN - 16], [-Math.PI / 2, 0, -Math.PI / 4]);
    glow.userData.fx = true; glow.name = 'hot-air';
    return { set(on, travel = 0) { glow.visible = on; reel.rotation.y = -travel * 15; roller.rotation.y = -travel * 54; } };
  },
  // 兆赫波探頭（光纖耦合反射式）：焦點在襯裡表面，非接觸
  thz(t) {
    couplingPlate(t);
    cylZ(t, 34, 24, 168, M.thz); cylZ(t, 28, 168, 184, M.lens);
    mesh(t, new THREE.BoxGeometry(40, 30, 50), M.body, [0, 44, 60]);               // 光纖接頭
    cable(t, 'thz-fiber', [[0, 61, 60], [35, 70, 60], [38, 70, 26], [28, 42, 24]], { radius: 2.6, color: 0x9a72c4, clips: 1 });
    const beam = mesh(t, new THREE.ConeGeometry(24, TOOL_LEN - 184, 24, 1, true), fxMat(0xb07cff, .3), [0, 0, (184 + TOOL_LEN) / 2], [-Math.PI / 2, 0, 0]);
    beam.userData.fx = true; beam.name = 'thz-beam';
    return { set(on) { beam.visible = on; } };
  },
};

export function createTools() {
  const tools = {};
  for (const key of Object.keys(BUILD)) {
    const root = new THREE.Group(); root.name = `tool-${key}`; root.userData.tool = key;
    const api = BUILD[key](root); api.set(false);
    tools[key] = { key, root, ...api };
  }
  return tools;
}

// 手臂側快換盤＋TCP 標記（掛在 arm.tool 下）；cplg：結合面標記（取放工具時對齊用）
export function createAtc(armTool) {
  const g = new THREE.Group(); g.name = 'atc'; armTool.add(g);
  cylZ(g, 40, 0, ATC_LEN, M.coupling).name = 'atc-body';
  mesh(g, new THREE.BoxGeometry(24, 18, 20), M.body, [0, 46, 14], [0, 0, 0], 'atc-body');   // 鎖定氣缸
  const cplg = new THREE.Object3D(); cplg.position.z = ATC_LEN; armTool.add(cplg);
  const tcp = new THREE.Object3D(); tcp.position.z = ATC_LEN + TOOL_LEN; armTool.add(tcp);
  return { group: g, cplg, tcp };
}

// 工具架一格：U 形托叉（托住快換盤下緣）＋立柱；局部原點在結合面中心，+Z 朝下（與掛著的工具同向）
export function rackSlot(parent, label) {
  const g = new THREE.Group(); g.name = `rack-slot-${label}`; parent.add(g);
  for (const y of [-43, 43]) mesh(g, new THREE.BoxGeometry(110, 12, 12), MAT.steelDark, [-20, y, 20]);
  mesh(g, new THREE.BoxGeometry(14, 98, 12), MAT.steelDark, [-68, 0, 20]);
  // 托叉往側邊接一支吊柱，下端站在工具架層板上（層板在結合面下 RACK_DEPTH）
  mesh(g, new THREE.BoxGeometry(14, 80, 12), MAT.steelDark, [-68, -88, 20]);
  mesh(g, new THREE.BoxGeometry(20, 20, RACK_DEPTH - 14), MAT.steelDark, [-68, -138, (RACK_DEPTH + 14) / 2]);
  mesh(g, new THREE.BoxGeometry(70, 70, 10), MAT.steelDark, [-68, -138, RACK_DEPTH - 5]);
  const present = sensor.create(); present.root.scale.setScalar(.25); present.root.position.set(-59, -45, 12); present.root.rotation.y = Math.PI / 2; g.add(present.root);
  return g;
}
