// 本站製程檢查（三種情境各跑一次）：組裝順序、入位與孔位對齊、清潔流程、鎖附順序與完成、手臂與鎖附模組不同時進入相鄰槽位。
// 通用的干涉、閃爍、倒序一致由 core 統一檢查負責。
//   node --import ../../core/tools/register.mjs tools/verify.mjs
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createProject, SCENARIOS, TORQUE } from '../web/js/project.js';
import { SLOTS, MOD, SCREW } from '../web/js/parts.js';
import { LAY, SOC_TOP } from '../web/js/machine.js';

const results = {};
let ok = true;
for (const scenario of Object.keys(SCENARIOS)) {
  const scene = new THREE.Scene(), p = createProject({ scene, scenario });
  const tl = p.timeline, failures = [], notes = [];
  const sample = (name, t) => tl.tracks[name].sample(t);
  const firstAt = (name, f) => { const s = tl.tracks[name].steps.find(x => f(x.end)); return s ? s.start : Infinity; };
  // 1. 每個槽位：interposer 先放、SOCAMM 後放、壓持後才鎖、12 顆螺絲全部終鎖
  const placedI = SLOTS.map((_, k) => Math.min(...p.ints.map((_, n) => firstAt('i' + n, e => e.loc === 'slot' && e.slot === k))));
  const placedS = SLOTS.map((_, k) => Math.min(...p.socs.map((_, n) => firstAt('s' + n, e => e.loc === 'slot' && e.slot === k))));
  SLOTS.forEach((_, k) => {
    if (!(placedI[k] < placedS[k])) failures.push(`槽位 ${k + 1}：SOCAMM 早於 interposer`);
    const pressAt = tl.tracks.lock.steps.find(s => s.action === `槽位 ${k + 1} 壓持`)?.start ?? Infinity;
    const firstScrew = Math.min(...p.screwLog.filter(s => s.slot === k).map(s => s.pre[0]));
    if (!(placedS[k] < pressAt && pressAt < firstScrew)) failures.push(`槽位 ${k + 1}：壓持或鎖附順序錯誤`);
    const order = p.screwLog.filter(s => s.slot === k).sort((a, b) => a.pre[0] - b.pre[0]).map(s => s.hole);
    if (order[0] !== 1) failures.push(`槽位 ${k + 1}：預鎖沒有從中間孔開始（${order.join(',')}）`);
  });
  if (p.screwLog.length !== 12 || p.screwLog.some(s => !s.fin)) failures.push(`螺絲終鎖 ${p.screwLog.filter(s => s.fin).length}／12`);
  // 2. 結束時：每顆螺絲在孔位、鎖到底；零件孔對齊 PCB 孔
  const T = p.total - 4;                      // 出站前（載台仍在組裝位）
  const tEnd = Math.min(T, tl.tracks.conv.steps.find(s => s.action === '頂升下降')?.start ?? T);
  p.apply(tEnd - .01); scene.updateMatrixWorld(true);
  p.screws.forEach((w, n) => {
    const s = sample('w' + n, tEnd - .01), k = s.slot, i = s.hole;
    const want = new THREE.Vector3(LAY.work + SLOTS[k], SOC_TOP(1), -MOD.holes[i]);
    const d = w.position.distanceTo(want);
    if (s.loc !== 'hole' || d > .02) failures.push(`螺絲 ${k + 1}-${i + 1} 沒有鎖到孔位（${s.loc}，偏差 ${d.toFixed(3)} mm）`);
  });
  const holeErr = [];
  for (const parts of [p.ints, p.socs.map(s => s.root)]) for (const o of parts) {
    const pos = o.position; if (!o.visible) continue;
    const st = (parts === p.ints ? sample('i' + p.ints.indexOf(o), tEnd - .01) : sample('s' + p.socs.findIndex(s => s.root === o), tEnd - .01));
    if (st.loc !== 'slot') continue;
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Vector3(MOD.holes[i], 0, 0).applyEuler(o.rotation).add(pos);
      holeErr.push(Math.hypot(w.x - (LAY.work + SLOTS[st.slot]), w.z + MOD.holes[i]));
    }
  }
  const maxHole = Math.max(...holeErr);
  if (holeErr.length !== 24 || maxHole > .005) failures.push(`零件孔對 PCB 孔偏差 ${maxHole.toFixed(4)} mm（${holeErr.length / 3} 片）`);
  // 3. 清潔：髒污件吹乾 ≥ 10 s、清潔後仍髒的件不得放上槽位；放上槽位的 SOCAMM 都是乾淨的
  p.socs.forEach((o, n) => {
    const tr = tl.tracks['s' + n], end = tr.sample(tEnd - .01);
    if (end.loc === 'slot' && end.dirty === 'y') failures.push(`SOCAMM #${n + 1} 髒污仍被組裝`);
    const tSlot = firstAt('s' + n, e => e.loc === 'slot');
    if (tSlot < Infinity && tr.sample(tSlot).dirty === 'y') failures.push(`SOCAMM #${n + 1} 放上槽位時仍髒污`);
  });
  const dryes = tl.tracks.robot.steps.filter(s => /吹乾 10 s/.test(s.action));
  if (p.scenario.dirty.length && dryes.length !== p.scenario.dirty.length) failures.push(`吹乾次數 ${dryes.length}，髒污件 ${p.scenario.dirty.length}`);
  if (dryes.some(s => s.dur < 10)) failures.push('吹乾不足 10 s');
  // 4. 手臂與鎖附模組：鎖附模組作業中（不在待機位），手臂工具與起子在 X 方向至少相距 90 mm（相鄰槽位 70 mm）
  let minGap = Infinity, at = 0;
  for (let t = 0; t <= p.total; t += .05) {
    p.apply(t);
    const L = sample('lock', t); if (Math.abs(L.x - LAY.locker.park) < 1) continue;
    const tool = p.robot.tool.getWorldPosition(new THREE.Vector3());
    if (tool.z > 200) continue;                                   // 手臂不在輸送線上方
    const g = Math.abs(tool.x - L.x); if (g < minGap) { minGap = g; at = t; }
  }
  if (minGap < 90) failures.push(`手臂法蘭與鎖附模組 X 距離 ${minGap.toFixed(0)} mm（t=${at.toFixed(1)} s）< 90 mm`);
  notes.push(`手臂與鎖附模組最小 X 距離 ${minGap === Infinity ? '—' : minGap.toFixed(0) + ' mm'}`);
  // 5. 影像追溯：每片組裝的零件都有底面檢查紀錄
  const placedNames = [...p.ints.map((_, n) => sample('i' + n, tEnd - .01).loc === 'slot' ? `INT-${n + 1}` : null), ...p.socs.map((_, n) => sample('s' + n, tEnd - .01).loc === 'slot' ? `SOC-${n + 1}` : null)].filter(Boolean);
  for (const nm of placedNames) if (!p.insp.some(e => e.part === nm && e.cam === 'UP-2D' && e.result === 'OK')) failures.push(`${nm} 沒有上視檢查 OK 紀錄`);
  if (TORQUE.finNm <= TORQUE.preNm) failures.push('終鎖扭力必須大於預鎖');
  void SCREW;
  results[scenario] = { ok: !failures.length, total: +p.total.toFixed(2), steady: p.cycle.steady, inspections: p.insp.length, failures, notes };
  if (failures.length) ok = false;
}
const result = { ok, results };
mkdirSync(new URL('../review/', import.meta.url), { recursive: true });
writeFileSync(new URL('../review/verification.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 1));
process.exit(ok ? 0 : 1);
