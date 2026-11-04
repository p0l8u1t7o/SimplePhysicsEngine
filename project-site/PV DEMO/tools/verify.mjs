// 本站檢查：發電模型的合理性（夜間為零、峰值不超過變流器容量、日發電量／kWp、雲遮驟降、遮蔭模型有作用、累積量不倒退）。
// 通用的干涉、閃爍、倒序一致由 core 統一檢查負責。
//   node --import ../../core/tools/register.mjs tools/verify.mjs
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createProject, powerAt, LAYOUT } from '../web/js/project.js';

const scene = new THREE.Scene(), project = createProject({ scene });
const failures = [], T = project.total, ev = project.timeline.events;
const at = t => project.apply(t);
const stepOf = text => ev.find(e => e.action.includes(text));

// 夜間與日落後輸出為零
for (const t of [0, T]) if (at(t).ac > 1e-6) failures.push(`t=${t.toFixed(1)} s 應無輸出，實際 ${at(t).ac.toFixed(2)} kW`);
// 峰值與各台不超過額定
let peak = 0, peakT = 0, lastE = 0;
for (let t = 0; t <= T + 1e-9; t += .1) {
  const s = at(t);
  if (s.ac > peak) { peak = s.ac; peakT = t; }
  s.inv.forEach((v, i) => { if (v.ac > LAYOUT.inverters[i].kw + 1e-6) failures.push(`${LAYOUT.inverters[i].id} 超過額定：${v.ac.toFixed(1)} kW`); });
  if (s.energy < lastE - 1e-6) failures.push(`累積發電量倒退：t=${t.toFixed(1)}`); lastE = s.energy;
}
if (peak > project.invKw + 1e-6) failures.push(`峰值 ${peak.toFixed(1)} kW 超過變流器總容量 ${project.invKw} kW`);
// 日發電量（等效日照時數）：春分晴天、含一段雲遮，合理範圍 3.5～6.5 kWh/kWp
const E = at(T).energy, yieldH = E / project.kwp;
if (yieldH < 3.5 || yieldH > 6.5) failures.push(`等效日照時數 ${yieldH.toFixed(2)} h 超出 3.5～6.5`);
// 雲遮：雲影通過時的最低輸出 < 同時刻晴空的 70%
const cloudStep = stepOf('雲層');
let dip = 1;
for (let t = cloudStep.start; t <= cloudStep.start + cloudStep.dur; t += .1) {
  const s = at(t), clear = powerAt(s.hour).ac; if (clear > 1) dip = Math.min(dip, s.ac / clear);
}
if (dip > .7) failures.push(`雲遮最低只降到晴空的 ${(dip * 100).toFixed(0)}%`);
// 遮蔭模型有作用：早晨 8 點塔樓陰影落在鋼架陣列
const morning = powerAt(8);
if (!(morning.inv[2].shaded > 0)) failures.push('早上 8 點鋼架陣列應有塔樓陰影');
// 正午鋸齒屋面不受前排遮蔭
const noon = powerAt(12);
if (noon.inv[0].shaded + noon.inv[1].shaded > 0) failures.push(`正午鋸齒屋面有 ${noon.inv[0].shaded + noon.inv[1].shaded} 片被遮`);
// 空間檢核全部通過
for (const c of project.layoutChecks()) if (!c.ok) failures.push(`空間檢核：${c.name}（${c.value}）`);

const result = {
  ok: !failures.length, total: +T.toFixed(2), panels: project.panels.length, kwp: +project.kwp.toFixed(1),
  peakKw: +peak.toFixed(1), peakAt: +peakT.toFixed(1), energyKwh: +E.toFixed(1), yieldHours: +yieldH.toFixed(2), cloudDip: +dip.toFixed(2),
  morningTowerShaded: morning.inv[2].shaded, failures,
};
mkdirSync(new URL('../review/', import.meta.url), { recursive: true });
writeFileSync(new URL('../review/verification.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
