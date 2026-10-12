// 本站自有檢查：製程上的規則寫在這裡；通用的干涉、閃爍、倒序一致由 core 統一檢查負責。
//   node --import ../../core/tools/register.mjs tools/verify.mjs
// 追蹤精度、換手連續、拉出吊桿淨空、放置定位、取像視野、頻閃時機、細節倒序一致、節拍。
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createProject } from '../web/js/project.js';
import { trackPose, linPose, PLAN } from '../web/js/sequence.js';
import { hookX } from '../web/js/line.js';
import { LINE, PICK, BAYS, slotOf } from '../web/js/layout.js';
import { capturePresentation, projectedFeatures, isCapture } from '../web/js/capture-overlay.js';

const scene = new THREE.Scene(), project = createProject({ scene });
const { sequence: seq, robot, wheels } = project;
const failures = [], notes = {};
const tcp = () => robot.tcp.getWorldPosition(new THREE.Vector3());
const center = k => { scene.updateMatrixWorld(true); return wheels[k].getWorldPosition(new THREE.Vector3()); };

// 1. 追蹤與直線段：每段取 9 點，TCP 與理想位姿偏差 ≤ 1 mm（追蹤）／2 mm（直線）
let trackWorst = 0, linWorst = 0;
for (const s of seq.steps.filter(s => s.robot === 'track' || s.robot === 'lin')) for (let i = 1; i < 10; i++) {
  const T = s.start + s.dur * i / 10, smp = seq.sample(T); project.apply(T);
  const ideal = s.robot === 'track' ? trackPose(s, T, smp.e) : linPose(s, smp.e), d = tcp().distanceTo(ideal.target);
  if (s.robot === 'track') trackWorst = Math.max(trackWorst, d); else linWorst = Math.max(linWorst, d);
}
Object.assign(notes, { trackWorst: +trackWorst.toFixed(3), linWorst: +linWorst.toFixed(3) });
if (trackWorst > 1) failures.push(`追蹤偏差 ${trackWorst.toFixed(2)} mm`);
if (linWorst > 2) failures.push(`直線段偏差 ${linWorst.toFixed(2)} mm`);

// 2. 換手連續：輪框在夾緊（吊鉤 → 手臂）與鬆開（手臂 → 棧板）前後 1 ms 的位置差 ≤ 1 mm
const handoffs = [];
seq.steps.forEach((s, i) => {
  const prev = seq.steps[i - 1];
  PLAN.forEach((_, k) => { const key = 'lam' + k; if (prev && prev.end[key] !== s.end[key]) handoffs.push([k, prev.start + prev.dur, `${prev.end[key]}→${s.end[key]}`]); });
});
let jump = 0;
for (const [k, T, what] of handoffs) {
  project.apply(T - 1e-3); const a = center(k); project.apply(T + 1e-3); const b = center(k), d = a.distanceTo(b);
  jump = Math.max(jump, d); if (d > 1) failures.push(`第 ${k + 1} 個輪框換手跳動 ${d.toFixed(2)} mm（${what}，${T.toFixed(2)} s）`);
}
notes.handoffs = handoffs.length; notes.handoffJump = +jump.toFixed(3);

// 3. 吊掛與拉出：夾緊時輪框在追蹤窗內；拉出結束時輪轂背面已越過吊桿末端（含上翹）30 mm 以上
PLAN.forEach((p, k) => {
  const gx = hookX(p.j, p.gripT);
  if (gx < PICK.window[0] || p.releaseX > PICK.window[1]) failures.push(`第 ${k + 1} 個輪框夾取／拉出超出追蹤窗（${Math.round(gx)}～${Math.round(p.releaseX)}）`);
  const pullEnd = seq.steps.find(s => s.action.startsWith('沿吊桿往南拉出') && s.track?.p === p);
  project.apply(pullEnd.start + pullEnd.dur);
  const hubBack = center(k).z + p.spec.hub - 22, tipZ = LINE.z + LINE.barEnd + 14 + 10;
  notes[`pullClear${k}`] = Math.round(hubBack - tipZ);
  if (hubBack - tipZ < 30) failures.push(`第 ${k + 1} 個輪框拉出後輪轂離吊桿末端只有 ${Math.round(hubBack - tipZ)} mm`);
});

// 4. 放置定位：最後狀態輪框中心在棧板格位 ±1 mm
project.apply(project.total);
PLAN.forEach((p, k) => {
  const s = slotOf(BAYS[p.bay], p.idx, p.spec), d = center(k).distanceTo(new THREE.Vector3(s.x, s.y, s.z));
  if (d > 1) failures.push(`第 ${k + 1} 個輪框放置偏差 ${d.toFixed(2)} mm`);
});
if (project.presentation.bays.A !== BAYS.A.n + 2 || project.presentation.bays.B !== 1) failures.push(`棧板計數錯誤 ${JSON.stringify(project.presentation.bays)}`);

// 5. 取像視野：粗取像時整個輪框外緣（含 ±50 mm 餘裕）在左右相機畫面內；精取像時中心孔在畫面內
const inView = (cam, pts) => { cam.updateMatrixWorld(true); return pts.every(q => { const v = q.clone().project(cam); return Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1; }); };
let views = 0;
for (const s of seq.steps.filter(s => s.action.includes('取像') && s.track)) {
  const T = s.start + s.dur / 2; project.apply(T); scene.updateMatrixWorld(true);
  const k = PLAN.indexOf(s.track.p), c = center(k), R = s.track.p.spec.od / 2 + 50, fine = s.station === 1;
  const pts = fine ? [c.clone().add(new THREE.Vector3(0, 0, s.track.p.spec.hub))] : Array.from({ length: 12 }, (_, i) => c.clone().add(new THREE.Vector3(Math.cos(i * Math.PI / 6) * R, Math.sin(i * Math.PI / 6) * R, s.track.p.spec.w / 2)));
  for (const cam of robot.cameras) if (!inView(cam.camera, pts)) failures.push(`${s.action}（第 ${k + 1} 個）${cam.root.name} 視野沒有涵蓋${fine ? '中心孔' : '整個輪框'}`);
  views++;
}
notes.captureViews = views;

// 6. 頻閃與視野錐只在取像步驟；細節倒序一致
const times = [...new Set(seq.steps.flatMap(s => [0, .2, .5, .8, 1].map(u => +(s.start + s.dur * u).toFixed(4))))];
for (const t of times) {
  project.apply(t); const step = seq.sample(t).step, capture = /取像（粗）|^精取像/.test(step.action) && t > step.start && t < step.start + step.dur;
  if (capture && !robot.fx.visible) { failures.push(`取像時沒有頻閃：${t} s`); break; }
}
const detail = [...wheels, project.sheet, ...robot.grip.fingers, robot.fx, ...project.line.hooks.map(h => h.root)];
const snap = t => { project.apply(t); scene.updateMatrixWorld(true); return JSON.stringify([project.presentation.lines, project.presentation.signals.map(s => s.on), detail.map(o => [o.visible, o.matrixWorld.elements.map(v => +v.toFixed(4))])]); };
const fwd = times.map(snap);
for (let i = times.length - 1; i >= 0; i--) if (snap(times[i]) !== fwd[i]) { failures.push(`細節倒序不一致：${times[i]} s`); break; }
notes.detailSamples = times.length;

// 8. 疊圖時機、左右眼投影、量測回查與編碼器推算；不是固定畫面上的裝飾橢圓。
let overlays = 0, blindSamples = 0;
for (const s of seq.steps) for (const u of [.01, .5, .99]) {
  const t = s.start + s.dur * u; project.apply(t); scene.updateMatrixWorld(true);
  const info = capturePresentation(seq, t);
  const expected = s.action === '盲區直線接近' ? 'blind' :
    s.track && (isCapture(s) || /辨識輪型|更新夾取點/.test(s.action)) ? (s.station === 1 ? 'fine' : 'coarse') : 'idle';
  if (info.mode !== expected) failures.push(`疊圖時機錯誤 ${s.action}`);
  if (['coarse', 'fine'].includes(info.mode)) {
    const k = PLAN.indexOf(info.p), spec = info.p.spec;
    const f = robot.cameras.map(c => projectedFeatures(wheels[k], spec, c.camera, 671, 561));
    if (f.some(x => x.rings.length !== 2 + spec.lugs || x.rings.some(r => r.some(p => p.some(v => !Number.isFinite(v)))) || x.depth <= 0 || x.disparity <= 0)) failures.push('橢圓投影或深度無效');
    if (Math.abs(f[0].center[0] - f[1].center[0]) < 1) failures.push('左右眼沒有視差');
    overlays++;
  }
  if (info.mode === 'blind') {
    const last = info.lastMeasurement;
    const correctedX = last.center[0] + info.encoderDelta;
    if (Math.abs(correctedX - hookX(info.p.j, t)) > 1e-6 || last.time >= s.start) failures.push('盲區量測或編碼器推算不正確');
    blindSamples++;
  }
}
notes.overlaySamples = overlays; notes.blindSamples = blindSamples;

// 頻閃亮度、投影點及訊號使用相同門檻，含段落邊界與倒序取樣。
let litSamples = 0, projectedSamples = 0;
const expanded = times.concat(seq.steps.filter(isCapture).flatMap(s => [s.start - .001, s.start + .001, s.start + s.dur - .001, s.start + s.dur + .001]));
const newSnapshot = t => {
  const st = project.apply(t), smp = seq.sample(t), k = PLAN.indexOf(smp.step.track?.p);
  const on = isCapture(smp.step) && st.strobe > .5;
  for (const light of project.line.lights) {
    const expected = on ? light.params.on : light.params.off + (light.params.on - light.params.off) * .12;
    if (Math.abs(light.lens.material.emissiveIntensity - expected) > 1e-8) failures.push(`頻閃不同步 ${t}`);
  }
  if (project.presentation.signals.find(s => s.label.startsWith('取像觸發')).on !== on) failures.push(`觸發不同步 ${t}`);
  project.effects.patterns.forEach((g, i) => {
    if (g.visible !== (i === k && st.pattern > .5 && on)) failures.push(`投影時機不正確 ${t}`);
    if (!g.children[0].geometry.attributes.position.count) failures.push('輪面投影點缺失');
  });
  const info = capturePresentation(seq, t), flex = project.electrical.flex;
  return JSON.stringify({ info, lights: project.line.lights.map(l => l.lens.material.emissiveIntensity), patterns: project.effects.patterns.map(g => g.visible),
    flex: flex.userData.cable.points, geometry: Array.from(flex.children[0].geometry.attributes.position.array),
    status: [robot.status.material.color.getHex(), robot.status.material.emissiveIntensity],
    leds: [...project.electrical.panel.devices.values()].map(d => d.userData.electricalLed?.material.emissiveIntensity ?? null),
    encoder: project.line.measuring.rotation.z, chain: project.line.chain.map(m => m.position.x),
    tags: project.line.hooks.map(h => h.tag?.userData.hookNumber), hmi: project.presentation.lines });
};
const snapshots = expanded.map(t => { const s = newSnapshot(t), smp = seq.sample(t); if (isCapture(smp.step) && smp.state.strobe > .5) litSamples++; if (project.effects.patterns.some(g => g.visible)) projectedSamples++; return s; });
for (let i = expanded.length - 1; i >= 0; i--) if (newSnapshot(expanded[i]) !== snapshots[i]) { failures.push(`新增效果／配線／量測倒序不一致 ${expanded[i]}`); break; }
if (!litSamples || !projectedSamples) failures.push('頻閃或投影檢查沒有有效取樣');
notes.fxSamples = expanded.length; notes.litSamples = litSamples; notes.projectedSamples = projectedSamples;
notes.cableRoutes = project.electrical.routes.length;
// 配線動態干涉由完整 electrical 檢查執行；此處確保宣告、障礙物及活動線束資料沒有空轉。
if (project.verify.cables.interval > .2 || project.verify.cables.minRoutes < 18 || !project.electrical.obstacles.includes(wheels[0].children[0])) failures.push('配線檢查範圍不足');
for (const ray of project.effects.rays) if (ray.reflected.y >= 0 || ray.reflected.z <= 0) failures.push('正反射不是向下離開輪面');

// 7. 節拍：平均每個輪框 ≤ 吊鉤間隔（含每 4 個一次的隔板）
const limit = LINE.pitch / LINE.v;
if (project.cycleTime > limit) failures.push(`節拍 ${project.cycleTime.toFixed(1)} s 超過吊鉤間隔 ${limit} s`);

const result = { ok: !failures.length, total: +project.total.toFixed(2), cycle: +project.cycleTime.toFixed(2), notes, failures };
mkdirSync(new URL('../review/', import.meta.url), { recursive: true });
writeFileSync(new URL('../review/verification.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
