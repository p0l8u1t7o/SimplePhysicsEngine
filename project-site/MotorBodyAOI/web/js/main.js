// 主程式：舞台＋播放列＋共用版面與相機視窗＋本站的面板（目前動作、每一張取像畫面、影像佇列、節拍與甘特圖、控光配方、12 面取像配置、顯示開關、遮擋試算、檢核）。
// 兩個方案：?plan=fixed（預設，固定光學＋步進移載）、?plan=arm（手臂持件方案 R5，2026-11-22 評估）。場景與每個時間點的狀態全部來自 project.js。
import * as THREE from 'three';
import { createStage, exposeSim } from '@core/ui/stage.js';
import { createPlayer } from '@core/ui/player.js';
import { createViewerWorkspace } from '@core/ui/viewer-workspace.js';
import { createProject, STATIONS, INTRO } from './project.js';
import { ARM_STATIONS, INTRO_ARM } from './arm-project.js';
import { LINE, stationCenter } from './machine.js';
import { FACES, GROUPS, subGeometry } from './body.js';
import { CAMERAS, dirAzTilt, derive } from './optics-plan.js';
import { ARM_CAMERAS, RIG } from './arm-optics.js';
import { CT, XFER_TIME, STATION_TIMES, SERVO_AXES, BOTTLENECK, LANES, cycleGantt } from './sequence.js';
import { CELL, STEPS, STEP_AT, ARM_CT, DECIDE_AT, RECIPE, SEGMENTS, exposureLimit } from './arm-plan.js';
import { SUMMARY, ARM_SUMMARY } from './coverage-data.js';
import { createShotView, createQueueView } from './shot-view.js';

const qp = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const ARM = qp.get('plan') === 'arm', PLAN = ARM ? 'arm' : 'fixed';
const CAMS = ARM ? ARM_CAMERAS : CAMERAS, SUM = ARM ? ARM_SUMMARY : SUMMARY, ST_NAMES = ARM ? ARM_STATIONS : STATIONS;
const CT_ = ARM ? ARM_CT : CT, INTRO_ = ARM ? INTRO_ARM : INTRO;
document.body.dataset.plan = PLAN;

// ---------------------------------------------------------------- 舞台
const canvas = $('c');
const stage = createStage({
  canvas, look: 'cell', extent: ARM ? { center: [0, 1000, 150], radius: 1900 } : { center: [0, 1000, 0], radius: 1900 },
  camera: { near: 2, far: 30000 },
  controls: { minDistance: 80, maxDistance: 12000 },
});
const { renderer, scene, camera, controls } = stage;
const project = createProject({ scene, plan: PLAN });
const { timeline, stationStart, optics } = project;

// 被手臂夾著的工件（手臂方案）／ST2 上的工件（固定方案）
const heldPos = () => {
  if (!ARM) return stationCenter(3).add(new THREE.Vector3(0, 20, 0));
  const p = project.parts.find(x => x.holder.visible && x.holder.userData.where === 'held');
  return p ? p.holder.position.clone() : new THREE.Vector3(0, 1150, 400);
};

// ---------------------------------------------------------------- 共用版面（焦點追隨）
const workspace = createViewerWorkspace({
  camera, controls, canvas, resize: stage.resize,
  getFocus: heldPos, focusOffset: ARM ? [-420, 360, 620] : [-260, 320, 420],
  onFocus: () => { stage.cancelTween(); document.querySelectorAll('.views [data-view]').forEach(b => b.classList.remove('on')); },
});

// ---------------------------------------------------------------- 視角
const c1 = stationCenter(1), c2 = stationCenter(2), c3 = stationCenter(3);
const VIEWS = ARM ? {
  iso: [[-1700, 2250, 2400], [0, 1000, 150]],
  st1: [[-60, 1750, 1650], [0, 1050, 380]],                       // 相機井（正面）
  flip: [[-1000, 1650, 250], [CELL.stand[0], CELL.stand[1], CELL.stand[2]]],
  st2: [[-850, 1450, 900], [-430, 1080, 260]],                     // 反射鏡探頭（O1）
  cup: [[1300, 1600, 650], [560, 950, -240]],                      // 出料 OK／NG
  top: [[0, 4300, 10], [0, 1000, 150]],
} : {
  iso: [[-1500, 2100, 2300], [0, 1000, 0]],
  st1: [[c1.x - 420, 1420, 560], [c1.x, 1060, 0]],
  flip: [[c2.x + 400, 1330, -600], [c2.x, 1000, 0]],      // 從後方看（翻轉經由後側；前方有移載立柱）
  st2: [[c3.x + 430, 1430, 560], [c3.x, 1080, 0]],
  cup: [[c3.x + 200, 1260, 260], [c3.x, 990, 0]],     // 從前右上看進杯內（正上方有同軸光盒）
  top: [[0, 4300, 10], [0, 1000, 0]],
};
if (ARM) { const L = { st1: '相機井', flip: '換夾台', st2: '探頭', cup: '出料' }; document.querySelectorAll('.views [data-view]').forEach(b => { if (L[b.dataset.view]) b.textContent = L[b.dataset.view]; }); }
function setView(name, instant = false) {
  const v = VIEWS[name]; if (!v) return;
  workspace.stopFollowing(); stage.goTo(v[0], v[1], instant);
  document.querySelectorAll('.views [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('.views [data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
// 方案切換（重新載入）
document.querySelectorAll('.plans [data-plan]').forEach(b => {
  b.classList.toggle('on', b.dataset.plan === PLAN);
  b.onclick = () => { const q = new URLSearchParams(location.search); if (b.dataset.plan === 'arm') q.set('plan', 'arm'); else q.delete('plan'); ['t', 'time', 'step', 'st'].forEach(x => q.delete(x)); location.search = q.toString(); };
});

// ---------------------------------------------------------------- 3D 標籤
const label = (html, pos, priority = 0) => stage.addLabel(html, pos, '', { anchor: 'above', priority });
if (ARM) {
  label('入料取件（V 形塊置中＋定位相機）', new THREE.Vector3(CELL.pick[0] - 200, 1120, CELL.pick[2]), 2);
  label('DENSO VS-068（RC8A）', new THREE.Vector3(...CELL.armBase).add(new THREE.Vector3(0, 650, 0)), 1);
  label('相機井：R1～R5 固定', new THREE.Vector3(0, 760, 760), 2);
  label('換夾台（氣動翻轉 180°）', new THREE.Vector3(CELL.stand[0], CELL.stand[1] + 180, CELL.stand[2]), 1);
  label('OK 出料', new THREE.Vector3(CELL.okOut[0] + 400, 960, CELL.okOut[2]), 0);
  label('NG 出料（緩衝）', new THREE.Vector3(CELL.ngOut[0] + 400, 960, CELL.ngOut[2]), 0);
} else {
  STATIONS.forEach((n, i) => label(`P${i} ${n}`, new THREE.Vector3(LINE.x[i], LINE.band + (i === 1 || i === 3 ? 380 : 170), 120), i === 1 || i === 3 ? 3 : 1));
  label('步進移載（X＋升降＋夾叉進出）', new THREE.Vector3(-700, LINE.table + 300, 520), 1);
  label('NG 輸送帶', new THREE.Vector3(LINE.x[4] + 450, LINE.band - 20, -300), 0);
}
// 工件判定狀態（跟著工件）：判定中 已判／總張數 → OK／NG
const verdictLabel = stage.addLabel('', () => verdictPos, 'verdict', { anchor: 'above', priority: 5 });
let verdictPos = null;

// ---------------------------------------------------------------- 站別按鈕
const stationBar = $('stations');
ST_NAMES.forEach((name, i) => {
  const b = document.createElement('button'); b.className = 'st'; b.dataset.st = i;
  b.innerHTML = `<span class="idx">P${i}</span>${name.split(' ')[0]}`; b.onclick = () => player.seekTo(stationStart[i]);
  stationBar.appendChild(b);
});

// ---------------------------------------------------------------- 節拍與甘特圖（一拍、穩態）
const fmt = v => v.toFixed(2);
$('cycleTime').textContent = `CT ${CT_.toFixed(1)} s／顆`;
let rows, lanes, axisMarks;
if (ARM) {
  $('ctHint').textContent = '全部串在手臂上';
  $('ctStats').innerHTML = `<div>CT（穩態）<b>${ARM_CT.toFixed(1)} s</b></div><div>規格／挑戰<b>15／12 s</b></div><div>伺服軸<b>6 軸</b></div>`;
  const laneOf = s => s.kind === 'shot' ? '手臂（飛拍）' : s.kind === 'move' ? '手臂' : /stand|flip/i.test(s.key) ? '換夾台' : '夾爪';
  rows = STEPS.map(s => ({ lane: laneOf(s), name: s.name, start: STEP_AT[s.key], dur: s.dur, kind: s.kind === 'shot' ? 'shot' : 'move' }));
  // 各相機的曝光（第 2 顆那一拍，合併 50 ms 內的連拍）與影像判定期間
  const k = 1, T0 = project.queue.needAt(k) - DECIDE_AT;
  for (const rig of Object.keys(RIG)) {
    let cur = null;
    for (const s of project.shots.filter(x => x.part === k && x.rig === rig)) {
      const t = s.t - T0;
      if (cur && t - (cur.start + cur.dur) < .06) cur.dur = t - cur.start + .02; else { cur = { lane: `${rig} 曝光`, name: `${rig} ${RIG[rig].name}`, start: t, dur: .02, kind: 'shot' }; rows.push(cur); }
    }
  }
  const v = project.queue.verdicts.find(x => x.part === k), first = Math.min(...project.queue.images.filter(x => x.part === k).map(x => x.start));
  rows.push({ lane: '影像判定', name: `第 ${k + 1} 顆 ${v.n} 張判定（GPU 佇列）`, start: first - T0, dur: v.done - first, kind: 'proc' });
  rows.push({ lane: '影像判定', name: '分料點：要知道 OK／NG', start: DECIDE_AT - .02, dur: .04, kind: 'decide' });
  lanes = ['手臂', '手臂（飛拍）', '夾爪', '換夾台', ...Object.keys(RIG).map(r => `${r} 曝光`), '影像判定'];
  axisMarks = `<span>0</span><span>${DECIDE_AT.toFixed(1)}（分料點）</span><span>${ARM_CT.toFixed(1)} s</span>`;
} else {
  $('ctHint').textContent = `瓶頸 ${BOTTLENECK}`;
  $('ctStats').innerHTML = `<div>CT（穩態）<b>${CT.toFixed(1)} s</b></div><div>規格／挑戰<b>15／12 s</b></div><div>伺服軸<b>${SERVO_AXES.length} 軸</b></div>`;
  rows = cycleGantt(); lanes = LANES;
  axisMarks = `<span>0</span><span>${(XFER_TIME).toFixed(1)}（移載完）</span><span>${CT.toFixed(1)} s</span>`;
}
const pct = t => (t / CT_ * 100).toFixed(2) + '%';
$('gantt').innerHTML = lanes.map(l => `<div class="lane"><span class="nm" title="${l}">${l}</span><div class="track">${rows.filter(r => r.lane === l).map(r =>
  `<span class="bar ${r.kind}" style="left:${pct(Math.max(0, r.start))};width:${pct(Math.max(r.dur, .03))}" title="${r.name}：${fmt(r.start)}–${fmt(r.start + r.dur)} s"></span>`).join('')}</div></div>`).join('')
  + `<div class="axis"><span></span><div>${axisMarks}</div></div>`
  + `<div class="legend"><span><i style="background:#4aa8ff"></i>機構</span><span><i style="background:#f2c230"></i>取像</span><span><i style="background:#9775fa"></i>影像判定（佇列）</span>${ARM ? '<span><i style="background:#ff6b6b"></i>分料點</span>' : ''}</div>`
  + `<div class="now" id="ganttNow"></div>`;
$('seqTable').innerHTML = '<tr><th>開始</th><th>結束</th><th>軸／站</th><th>動作</th></tr>' + [...rows].filter(r => !/曝光/.test(r.lane)).sort((a, b) => a.start - b.start || lanes.indexOf(a.lane) - lanes.indexOf(b.lane))
  .map(r => `<tr><td>${fmt(r.start)}</td><td>${fmt(r.start + r.dur)}</td><td>${r.lane}</td><td>${r.name}</td></tr>`).join('')
  + (ARM ? '' : `<tr><td colspan="4">各站作業時間：${Object.entries(STATION_TIMES).map(([k, v]) => `${k} ${v.toFixed(2)} s`).join('、')}</td></tr>`);
const ganttNow = $('ganttNow');
function updateGantt(T) {
  const u = T < INTRO_ ? 0 : ((T - INTRO_) % CT_) / CT_;
  const track = document.querySelector('.gantt .track'); if (!track) return;
  ganttNow.style.left = `${track.offsetLeft + u * track.offsetWidth}px`;
}

// ---------------------------------------------------------------- 控光配方（手臂方案：每個拍攝位置各自的亮度與脈寬）
if (ARM) {
  $('recipe').innerHTML = '<tr><th>段</th><th>相機</th><th>面</th><th>光源（通道）</th><th>亮度</th><th>脈寬</th><th>上限</th></tr>' + RECIPE.map((r, i) => {
    const lim = r.statics ? null : exposureLimit(r.cam);
    return `<tr data-r="${i}"><td>${r.seg}</td><td>${r.cam}</td><td>${r.faces.join('、')}</td><td>${r.ch}${r.per > 1 ? ` ×${r.per}` : ''}</td><td>${r.bright}%</td><td>${r.pulse} µs</td><td class="${lim && r.pulse > lim.us ? 'bad' : ''}">${lim ? lim.us + ' µs' : '靜態'}</td></tr>`;
  }).join('');
} else $('recipeCard').hidden = true;
let recipeOn = -1;
function updateRecipe(s) {
  if (!ARM) return;
  const i = s ? RECIPE.findIndex(r => r.cam === s.cam && s.ch.startsWith(r.ch.slice(0, 4))) : -1;
  if (i === recipeOn) return; recipeOn = i;
  document.querySelectorAll('#recipe tr[data-r]').forEach(tr => tr.classList.toggle('on', +tr.dataset.r === i));
}

// ---------------------------------------------------------------- 12 面取像配置表
const groupColor = { A: '#4dabf7', B: '#9775fa', C: '#f06595', D: '#ffa94d', E: '#69db7c' };
$('faceTable').innerHTML = '<tr><th>面</th><th>組</th><th>名稱</th><th>相機</th><th>覆蓋</th><th>mm/px</th><th>光</th></tr>' + FACES.map(f => {
  const s = SUM.faces[f.no], cam = s.cameras[0], pf = SUM.cameras[cam].perFace[f.no];
  return `<tr data-face="${f.no}"><td>${f.no}</td><td><span class="g" style="background:${groupColor[f.group]}">${f.group}</span></td><td>${f.name}</td><td>${cam}</td><td>${s.coverage}%</td><td>${pf.mmpx ? pf.mmpx[1].toFixed(3) : '—'}</td><td title="高反光面的反光分類">${pf.glare === '均勻亮場' ? '亮場' : pf.glare === '暗場' ? '暗場' : '⚠反光'}</td></tr>`;
}).join('');
const overlays = () => ARM ? [project.faceOverlay.arm] : [project.faceOverlay.ST1, project.faceOverlay.ST2];
function selectFace(no) {
  document.querySelectorAll('#faceTable tr[data-face]').forEach(tr => tr.classList.toggle('on', +tr.dataset.face === no));
  const f = FACES.find(x => x.no === no), camId = SUM.faces[no].cameras[0], cam = CAMS.find(c => c.id === camId), cs = SUM.cameras[camId], pf = cs.perFace[no];
  const rigTxt = ARM ? `（實體相機 ${cam.rig} ${RIG[cam.rig].name}，拍攝段 ${cam.seg}）` : '';
  $('camDetail').innerHTML = `<b>面 ${no} ${f.name}</b>（${GROUPS[f.group]}，${f.kind}，Z ${f.z.join('~')}、r ${f.r.join('~')}）<br>`
    + `<b>${camId} ${cam.name}</b>${rigTxt}：${cam.sensor}、${cam.lens}；WD ${cs.wd} mm、視野 ${cs.fov.join('×')} mm、${cs.mmpx} mm/px（有效 ${pf.mmpx?.join('–')}）<br>`
    + `景深需求 ${cs.span} mm → b ${cs.bDesign} mm、F${cs.N}、景深 ${cs.dof} mm；視角 ${pf.view?.join('–')}°、入射 ${pf.inc?.join('–')}°<br>`
    + `光源：${cam.light.type}。${cam.light.note || ''}<br>反光（高反光加工面，散開 4°／8°）：${pf.glare}／${pf.glare8}；刀紋（主影像，斜面 12°／20°）：${pf.groove}／${pf.groove20}<br>`
    + (ARM ? `飛拍：J6 等速旋轉，每 30° 一組，${cam.frames ? `${cam.frames} 張／圈，相鄰重疊 ${pf.overlap}%` : '轉之前靜態取像'}` : `旋轉取像：${cam.frames ? `${cam.frames} 張／圈（每 30°），相鄰重疊 ${pf.overlap}%` : '不轉，靜態取像'}`);
  for (const g of overlays()) g.children.forEach(m => m.visible = !no || m.name === `face-${no}`);
  if (!$('tgFaces').checked) { $('tgFaces').checked = true; applyToggles(); }
  $('camSel').value = camId;
}
document.querySelectorAll('#faceTable tr[data-face]').forEach(tr => tr.onclick = () => selectFace(+tr.dataset.face));

// ---------------------------------------------------------------- 顯示開關與相機視窗
$('camSel').innerHTML = '<option value="auto">自動：最新一張的相機</option>' + CAMS.map(c => `<option value="${c.id}">${c.id} ${c.name}（面 ${c.faces.join('、')}）</option>`).join('');
$('camSel').value = 'auto';
if (ARM) $('tgLaser').closest('label').hidden = true;
function applyToggles() {
  optics.viz.visible = $('tgViz').checked;
  for (const list of Object.values(project.footMeshes)) for (const m of list) m.material.opacity = $('tgFoot').checked ? .8 : 0;
  for (const g of overlays()) g.visible = $('tgFaces').checked;
  if (optics.options) optics.options.visible = $('tgLaser').checked;
  stage.invalidate(true);
}
['tgViz', 'tgFoot', 'tgFaces', 'tgLaser'].forEach(id => $(id).onchange = applyToggles);
// 上色方式：面組 A–E，或內／外側（05 選項 B：杯外＝外側 0.8 mm、杯內與孔內＝內側 1.5 mm）
const ZONE_COLOR = { 外側: 0x4dabf7, 杯內: 0xff922b, 孔內: 0xff922b };
function applyFaceMode() {
  const zone = $('faceMode').value === 'zone';
  for (const g of overlays()) g.children.forEach(m => {
    const f = FACES.find(x => `face-${x.no}` === m.name);
    m.material.color.setHex(zone ? ZONE_COLOR[f.zone] : parseInt(groupColor[f.group].slice(1), 16));
  });
  if (!$('tgFaces').checked) $('tgFaces').checked = true;
  applyToggles();
}
$('faceMode').onchange = applyFaceMode;
$('camSel').onchange = () => stage.invalidate(true);

// ---------------------------------------------------------------- 視線遮擋試算（固定方案）：改傾角，用 STEP 射線重算覆蓋率，看不到的區域在站上工件標紅
const occBase = { 'C2-4': { az: 270, tilt: 40 }, 'C2-2': { az: 180, tilt: 45 } };
let occMesh = null, coverageMod = null;
async function runOcclusion() {
  const id = $('occCam').value, tilt = +$('occTilt').value; $('occVal').textContent = `${tilt}°`;
  coverageMod ??= await import('./coverage.js');
  const cam = { ...CAMERAS.find(c => c.id === id), toCam: dirAzTilt(occBase[id].az, tilt), b: .3 };
  const r = coverageMod.computeCoverage({ cameras: [cam] }).cameras[id];
  const seen = new Set(r.tris), lostTris = [];
  const { faceTriangles } = await import('./body.js'), ft = faceTriangles();
  for (const f of cam.faces) for (const t of ft[f].tris) if (!seen.has(t)) lostTris.push(t);
  if (occMesh) { occMesh.parent.remove(occMesh); occMesh.geometry.dispose(); occMesh = null; }
  if (lostTris.length) {
    occMesh = new THREE.Mesh(subGeometry(lostTris, .12), new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: .85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }));
    occMesh.userData.fx = true; occMesh.renderOrder = 8; occMesh.position.z = project.overlay.ST2.mesh.position.z; project.overlay.ST2.spin.add(occMesh);
  }
  const limit = id === 'C2-4' ? '43.7°（杯口凸緣擋住 Ø28 孔壁下緣）' : '傾角太小看不到凸緣外側、太大看不到開口端面';
  $('occOut').innerHTML = `${id} 傾角 ${tilt}°（設計 ${occBase[id].tilt}°；${limit}）<br>` + Object.entries(r.faces).map(([f, s]) => {
    const lost = Object.entries(s.lost).filter(([, a]) => a > .5).map(([k, a]) => `${k} ${a.toFixed(0)} mm²`).join('、');
    return `面 ${f}：<span class="${s.coverage > .99 ? 'good' : 'bad'}">${(s.coverage * 100).toFixed(1)}%</span>${lost ? `（${lost}）` : ''}`;
  }).join('<br>') + (lostTris.length ? '<br>紅色＝看不到的區域（在 ST2 工件上）' : '');
  stage.invalidate(true);
}
if (ARM) $('occCard').hidden = true;
else {
  $('occCam').onchange = () => { $('occTilt').value = occBase[$('occCam').value].tilt; runOcclusion(); };
  $('occTilt').oninput = runOcclusion;
  $('occTilt').value = 40;
}

// ---------------------------------------------------------------- 檢核（info：參考項，不算不通過）
const checks = project.layoutChecks();
$('checks').innerHTML = checks.map(r => `<li class="${r.ok ? 'ok' : r.info ? 'info' : 'ng'}">${r.ok ? '✓' : r.info ? '△' : '✗'} ${r.name}<span>${r.value ?? ''}</span></li>`).join('');
$('checkCount').textContent = `${checks.filter(r => r.ok).length} / ${checks.length}` + (checks.some(r => !r.ok && r.info) ? '（△ 參考）' : '');

// ---------------------------------------------------------------- 每一張取像畫面、影像佇列
const shotView = createShotView({ renderer, scene, project, root: $('shots'), hideDuring: () => [optics.viz, ...Object.values(project.overlay || {}).map(o => o.holder)] });
const queueView = createQueueView({ project, root: $('queue') });
$('queueHint').textContent = `GPU 1 張、5 MP 30 ms／1.6 MP 12 ms（示意）`;

// ---------------------------------------------------------------- 目前動作面板
const events = timeline.events;
const ui = { action: $('action'), substep: $('substep'), stationName: $('stationName'), stations: [...stationBar.children] };
let shown = '';
function updateVerdict(T) {
  const { images, verdicts, needAt } = project.queue;
  // 正在處理（已拍、還沒到分料點）的那一顆
  const v = verdicts.find(x => x.first <= T && T <= needAt(x.part) + 1.2);
  const part = v && project.parts.find(p => p.k === v.part);
  if (!v || !part?.holder.visible) { verdictPos = null; return; }
  let shot = 0, done = 0; for (const im of images) if (im.part === v.part && im.t <= T) { shot++; if (im.done <= T) done++; }
  const ready = done === v.n;
  verdictPos = part.holder.position.clone().add(new THREE.Vector3(0, 90, 0));
  verdictLabel.el.className = `label3d verdict ${ready ? (v.ng ? 'ng' : 'ok') : ''}`;
  verdictLabel.el.innerHTML = ready ? `第 ${v.part + 1} 顆 <b>${v.ng ? 'NG' : 'OK'}</b>${v.ng ? `（${v.hits[0]?.defects?.[0]?.kind ?? '缺陷'}）` : ''}` : `第 ${v.part + 1} 顆 判定中 ${done}/${v.n}${shot < v.n ? `（已拍 ${shot}）` : ''}`;
}
function updatePanels(T) {
  const act = timeline.activity(T).filter(s => s.action), last = events.filter(e => e.start <= T + 1e-6).at(-1), station = last?.station ?? 0;
  const key = act.map(s => s.action).join('、') + '|' + station;
  updateGantt(T); queueView.update(T); updateVerdict(T);
  if (key === shown) return; shown = key;
  ui.action.textContent = act.length ? act.map(s => s.action).join('、') : '待命';
  ui.substep.textContent = act.map(s => s.sub).filter(Boolean).join('、');
  ui.stationName.textContent = `P${station} ${ST_NAMES[station]}`;
  ui.stations.forEach((b, i) => b.classList.toggle('active', act.some(s => s.station === i)));
}

// ---------------------------------------------------------------- 播放列
const player = createPlayer({
  total: project.total,
  apply: T => project.apply(T),
  events: events.map(e => ({ time: e.start, label: `P${e.station} · ${e.action}` })),
  onChange: T => { updatePanels(T); stage.invalidate(true); },
});

// 每格繪製：新拍到的張數（模擬畫面）→ 相機視窗（隱藏視錐，只看取像足跡）→ 主畫面
function render() {
  if (shotView.update(player.T)) updateRecipe(shotView.latest);
  const sel = $('camSel').value, id = sel === 'auto' ? (shotView.latest?.cam ?? (ARM ? 'R3-8' : 'C1-4')) : sel, cam = CAMS.find(c => c.id === id), vizOn = optics.viz.visible, dv = derive(cam);
  optics.viz.visible = false;
  workspace.renderCamera({ renderer, scene, camera: project.viewCamOf(id), title: `${id} ${cam.name}（面 ${cam.faces.join('、')}）`, result: `${SUM.cameras[id].mmpx} mm/px`, marks: { time: player.T }, aspect: dv.fovW / dv.fovH });
  optics.viz.visible = vizOn;
  workspace.renderOverview(renderer, scene);
}

setView(qp.get('view') in VIEWS ? qp.get('view') : 'iso', true);
if (qp.has('cam')) { const a = qp.get('cam').split(',').map(Number); if (a.length === 6 && a.every(Number.isFinite)) stage.goTo(a.slice(0, 3), a.slice(3), true); }
applyToggles();
if (!ARM) runOcclusion();
$('loading').classList.add('hide');
stage.loop(dt => { const changed = player.update(dt); workspace.follow(); stage.updateLabels(); return changed; }, { render });

exposeSim({ seekTo: player.seekTo, setView, views: VIEWS, total: project.total, play: player.play, pause: player.pause, get T() { return player.T; }, stationStart, project, selectFace, plan: PLAN });

// ---------------------------------------------------------------- 錄影（?movie）
if (qp.has('movie')) {
  const { installMovie } = await import('@core/movie/movie.js');
  installMovie({
    project: decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)),
    title: document.querySelector('.brand .title')?.textContent || document.title,
    scene, renderer, camera, controls, render, setView, total: project.total, steps: timeline.events,
    sample: t => { project.apply(t); updatePanels(t); },
    focus: heldPos,
    offset: [-420, 420, 640],
  });
}
