// 專案介面：網頁（main.js）與 core 統一檢查共用。規格見 core/README.md「專案介面」。
// 太陽能板拆框機的機器人上下料：FANUC R-2000iC/165F＋懸臂側進式真空吸盤架，
// 從入料棧板取整板送入拆框機，拆框剝線盒後取出無框層壓板疊到出料棧板。配置與尺寸在 layout.js。
import * as THREE from 'three';
import { createCell, ROT_IN, ROT_OUT } from './cell.js';
import { createDismantler, TROUGH, CRATE } from './machine.js';
import { createRobot } from './robot.js';
import { createPanelParts, placeParts, FRAME_OUT } from './panel.js';
import { createSequence, linPose, STATIONS, CYCLES } from './sequence.js';
import { PANEL, MACHINE, GRIP, IN, OUT, GLASS_Y, FENCE, ROBOT, inGlassY, outGlassY } from './layout.js';

export { STATIONS };
export * as LAYOUT from './layout.js';

const PANEL_MESH = /^(panel |frame |junction )/;
const isPanel = m => PANEL_MESH.test(m.name);
const named = re => m => re.test(m.name);

export function createProject({ scene }) {
  const cell = createCell(scene);
  const machine = createDismantler(scene);
  const robot = createRobot(scene);
  // 會動的兩片板：各零件是場景第一層的群組（模組名稱 p0 laminate、p0 frame x+…）
  const movers = Array.from({ length: CYCLES }, (_, k) => createPanelParts(scene, 'p' + k));
  const { seq, poses, cycle } = createSequence(robot);

  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), I = new THREE.Quaternion();
  const seatPos = new THREE.Vector3(MACHINE.x, GLASS_Y, MACHINE.z);
  function lamPose(where, k) {
    if (where === 'held') { robot.tcp.getWorldPosition(_p); robot.tcp.getWorldQuaternion(_q); return [_p, _q]; }
    if (where === 'machine') return [seatPos, I];
    if (where === 'out') return [new THREE.Vector3(OUT.x, outGlassY(OUT.n + k), OUT.z), ROT_OUT];
    return [new THREE.Vector3(IN.x, inGlassY(IN.n - 1 - k), IN.z), ROT_IN];
  }

  function apply(t) {
    const smp = seq.sample(t), st = smp.state, step = smp.step;
    let q = st.q;
    if (step.robot === 'lin' && smp.u > 0 && smp.u < 1) q = robot.track(linPose(step, smp.e), st.q);
    robot.setJoints(q);
    machine.set(st);
    for (let k = 0; k < CYCLES; k++) {
      const parts = movers[k], [pos, rot] = lamPose(st['lam' + k], k);
      placeParts(parts, pos, rot);
      // 鋁框：0 在板上；0～1 隨夾爪外拉；1～2 落入正下方的收集槽（第 k 片疊在第 k 層）
      const f = st['frm' + k];
      if (f > 0) parts.frames.forEach((g, i) => {
        const d = FRAME_OUT[i], out = MACHINE.pull * Math.min(f, 1);
        const yEnd = TROUGH.y + 10 + (PANEL.T - PANEL.lip) + k * (PANEL.T + 1);
        g.position.set(MACHINE.x + d[0] * out, f > 1 ? GLASS_Y + (yEnd - GLASS_Y) * (f - 1) : GLASS_Y, MACHINE.z + d[2] * out);
        g.quaternion.identity();
      });
      // 接線盒：0 在背板上；0～1 被刮刀往北推；1～2 落入料箱並翻轉
      const b = st['box' + k];
      if (b > 0) {
        const dz = Math.min(0, machine.bladeZ(Math.min(b, 1)) - 10 - PANEL.jbox.size[2] / 2);
        const bh = PANEL.jbox.size[1], yEnd = CRATE.y + 10 + bh + PANEL.lam + k * (bh + 2);   // 群組原點＝板原點（盒底落在料箱底，第 k 個疊上去）
        parts.jbox.position.set(MACHINE.x, GLASS_Y + (yEnd - GLASS_Y) * Math.max(0, b - 1), MACHINE.z + dz);
        parts.jbox.quaternion.identity();
      }
    }
    return st;
  }
  apply(0);

  // ---------------------------------------------------------------- 空間檢核
  function layoutChecks() {
    const save = { ...robot.q }, rows = [];
    const reach = (name, p) => {
      const c = robot.solve(p, save), ok = c.err.position <= 1 && c.err.angle <= .1;
      rows.push({ group: '手臂可達', name, ok, value: ok ? `誤差 ${c.err.position.toFixed(2)} mm` : `差 ${c.err.position.toFixed(1)} mm` });
    };
    reach('入料最底層（第 1 片）', robot.posePanel([IN.x, inGlassY(0), IN.z], IN.dir));
    reach('入料最上層（第 20 片）', robot.posePanel([IN.x, inGlassY(IN.n - 1), IN.z], IN.dir));
    reach('拆框機放板位', robot.posePanel([MACHINE.x, GLASS_Y, MACHINE.z], [0, 0, -1]));
    reach(`出料滿疊（第 ${OUT.max} 片）`, robot.posePanel([OUT.x, outGlassY(OUT.max - 1), OUT.z], OUT.dir));
    const worst = Math.max(...poses.map(([, , j]) => j.err.position));
    rows.push({ group: '手臂可達', name: `排程內 ${poses.length} 個位姿`, ok: worst <= 1, value: `最大誤差 ${worst.toFixed(2)} mm` });
    robot.setJoints(save);
    const load = PANEL.kg + GRIP.kg;
    rows.push({ group: '負載', name: '整板＋吸盤架 ≤ 165 kg（R-2000iC/165F）', ok: load <= 165, value: `${load.toFixed(1)} kg` });
    const reachR = Math.hypot(OUT.x - ROBOT.x, 0) + PANEL.W / 2, fenceR = FENCE.x - ROBOT.x;
    rows.push({ group: '圍籬', name: '出入料棧板外緣在圍籬內', ok: reachR + 100 <= fenceR, value: `餘裕 ${Math.round(fenceR - reachR)} mm` });
    rows.push({ group: '節拍', name: '每片節拍 ≤ 60 s', ok: cycle <= 60, value: `${cycle.toFixed(1)} s／片（約 ${Math.floor(3600 / cycle)} 片／時）` });
    return rows;
  }

  return {
    total: seq.total, sequence: seq, timeline: seq, apply, layoutChecks, stationStart: seq.stationStart,
    cycleTime: cycle, robot, machine, movers, cell,
    verify: {
      allow: [
        { why: '同一片板的零件互相貼合；板堆框疊框', test: (a, b) => isPanel(a) && isPanel(b) },
        { why: '吸盤吸附玻璃面', test: (a, b) => [a, b].some(named(/^suction cup$/)) && [a, b].some(isPanel) },
        { why: '板放在拆框機承板與支撐軌上，被壓板、壓指壓住，刮刀推接線盒', test: (a, b) => [a, b].some(isPanel) && [a, b].some(named(/^(jaw shelf|jaw finger|support rail|press rubber|scraper blade)$/)) },
        { why: '鋁框落在收集槽底、接線盒落在料箱底', test: (a, b) => [a, b].some(isPanel) && [a, b].some(named(/^(trough floor|crate floor)$/)) },
        { why: '板堆放在棧板上', test: (a, b) => [a, b].some(isPanel) && [a, b].some(named(/^pallet deck$/)) },
      ],
      envelope: ['robot'],
    },
  };
}
