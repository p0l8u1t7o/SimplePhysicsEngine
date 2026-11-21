// 主程式：舞台＋播放列＋共用版面與相機視窗＋本站的面板（節拍與甘特圖、12 面取像配置、顯示開關、遮擋試算、檢核）。
// 場景與每個時間點的狀態全部來自 project.js，與 core 統一檢查用的是同一份。
import * as THREE from 'three';
import { createStage, exposeSim } from '@core/ui/stage.js';
import { createPlayer } from '@core/ui/player.js';
import { createViewerWorkspace } from '@core/ui/viewer-workspace.js';
import { createProject, STATIONS, INTRO } from './project.js';
import { LINE, stationCenter } from './machine.js';
import { FACES, GROUPS, subGeometry } from './body.js';
import { CAMERAS, dirAzTilt, derive } from './optics-plan.js';
import { CT, XFER_TIME, STATION_TIMES, SERVO_AXES, BOTTLENECK, LANES, cycleGantt } from './sequence.js';
import { SUMMARY } from './coverage-data.js';
import { CAMERA_COLOR } from './optics-scene.js';

const qp = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- 舞台
const canvas = $('c');
const stage = createStage({
  canvas, look: 'cell', extent: { center: [0, 1000, 0], radius: 1900 },
  camera: { near: 2, far: 30000 },
  controls: { minDistance: 80, maxDistance: 12000 },
});
const { renderer, scene, camera, controls } = stage;
const project = createProject({ scene });
const { timeline, stationStart, optics } = project;

// ---------------------------------------------------------------- 共用版面（焦點追隨：ST2 上的工件）
const workspace = createViewerWorkspace({
  camera, controls, canvas, resize: stage.resize,
  getFocus: () => stationCenter(3).add(new THREE.Vector3(0, 20, 0)),
  focusOffset: [-260, 320, 420],
  onFocus: () => { stage.cancelTween(); document.querySelectorAll('.views [data-view]').forEach(b => b.classList.remove('on')); },
});

// ---------------------------------------------------------------- 視角
const c1 = stationCenter(1), c2 = stationCenter(2), c3 = stationCenter(3);
const VIEWS = {
  iso: [[-1500, 2100, 2300], [0, 1000, 0]],
  st1: [[c1.x - 420, 1420, 560], [c1.x, 1060, 0]],
  flip: [[c2.x + 400, 1330, -600], [c2.x, 1000, 0]],      // 從後方看（翻轉經由後側；前方有移載立柱）
  st2: [[c3.x + 430, 1430, 560], [c3.x, 1080, 0]],
  cup: [[c3.x + 200, 1260, 260], [c3.x, 990, 0]],     // 從前右上看進杯內（正上方有同軸光盒）
  top: [[0, 4300, 10], [0, 1000, 0]],
};
function setView(name, instant = false) {
  const v = VIEWS[name]; if (!v) return;
  workspace.stopFollowing(); stage.goTo(v[0], v[1], instant);
  document.querySelectorAll('.views [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('.views [data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));

// ---------------------------------------------------------------- 3D 標籤
const label = (html, pos, priority = 0) => stage.addLabel(html, pos, '', { anchor: 'above', priority });
STATIONS.forEach((n, i) => label(`P${i} ${n}`, new THREE.Vector3(LINE.x[i], LINE.band + (i === 1 || i === 3 ? 380 : 170), 120), i === 1 || i === 3 ? 3 : 1));
label('步進移載（X＋升降＋夾叉進出）', new THREE.Vector3(-700, LINE.table + 300, 520), 1);
label('NG 輸送帶', new THREE.Vector3(LINE.x[4] + 450, LINE.band - 20, -300), 0);

// ---------------------------------------------------------------- 站別按鈕
const stationBar = $('stations');
STATIONS.forEach((name, i) => {
  const b = document.createElement('button'); b.className = 'st'; b.dataset.st = i;
  b.innerHTML = `<span class="idx">P${i}</span>${name.split(' ')[0]}`; b.onclick = () => player.seekTo(stationStart[i]);
  stationBar.appendChild(b);
});

// ---------------------------------------------------------------- 節拍與甘特圖（一拍、穩態）
const fmt = v => v.toFixed(2);
$('cycleTime').textContent = `CT ${CT.toFixed(1)} s／顆`;
$('ctHint').textContent = `瓶頸 ${BOTTLENECK}`;
$('ctStats').innerHTML = `<div>CT（穩態）<b>${CT.toFixed(1)} s</b></div><div>規格／挑戰<b>15／12 s</b></div><div>伺服軸<b>${SERVO_AXES.length} 軸</b></div>`;
const rows = cycleGantt(), pct = t => (t / CT * 100).toFixed(2) + '%';
$('gantt').innerHTML = LANES.map(l => `<div class="lane"><span class="nm" title="${l}">${l}</span><div class="track">${rows.filter(r => r.lane === l).map(r =>
  `<span class="bar ${r.kind}" style="left:${pct(r.start)};width:${pct(Math.max(r.dur, .03))}" title="${r.name}：${fmt(r.start)}–${fmt(r.start + r.dur)} s"></span>`).join('')}</div></div>`).join('')
  + `<div class="axis"><span></span><div><span>0</span><span>${(XFER_TIME).toFixed(1)}（移載完）</span><span>${CT.toFixed(1)} s</span></div></div>`
  + `<div class="legend"><span><i style="background:#4aa8ff"></i>機構</span><span><i style="background:#f2c230"></i>取像</span><span><i style="background:#9775fa"></i>影像處理（管線化）</span></div>`
  + `<div class="now" id="ganttNow"></div>`;
$('seqTable').innerHTML = '<tr><th>開始</th><th>結束</th><th>軸／站</th><th>動作</th></tr>' + [...rows].sort((a, b) => a.start - b.start || LANES.indexOf(a.lane) - LANES.indexOf(b.lane))
  .map(r => `<tr><td>${fmt(r.start)}</td><td>${fmt(r.start + r.dur)}</td><td>${r.lane}</td><td>${r.name}</td></tr>`).join('')
  + `<tr><td colspan="4">各站作業時間：${Object.entries(STATION_TIMES).map(([k, v]) => `${k} ${v.toFixed(2)} s`).join('、')}</td></tr>`;
const ganttNow = $('ganttNow');
function updateGantt(T) {
  const u = T < INTRO ? 0 : ((T - INTRO) % CT) / CT;
  const track = document.querySelector('.gantt .track'); if (!track) return;
  const left = track.offsetLeft + u * track.offsetWidth;
  ganttNow.style.left = `${left}px`;
}

// ---------------------------------------------------------------- 12 面取像配置表
const groupColor = { A: '#4dabf7', B: '#9775fa', C: '#f06595', D: '#ffa94d', E: '#69db7c' };
$('faceTable').innerHTML = '<tr><th>面</th><th>組</th><th>名稱</th><th>相機</th><th>覆蓋</th><th>mm/px</th><th>光</th></tr>' + FACES.map(f => {
  const s = SUMMARY.faces[f.no], cam = s.cameras[0], pf = SUMMARY.cameras[cam].perFace[f.no];
  return `<tr data-face="${f.no}"><td>${f.no}</td><td><span class="g" style="background:${groupColor[f.group]}">${f.group}</span></td><td>${f.name}</td><td>${cam}</td><td>${s.coverage}%</td><td>${pf.mmpx ? pf.mmpx[1].toFixed(3) : '—'}</td><td title="高反光面的反光分類">${pf.glare === '均勻亮場' ? '亮場' : pf.glare === '暗場' ? '暗場' : '⚠反光'}</td></tr>`;
}).join('');
let selectedFace = 0;
function selectFace(no) {
  selectedFace = no;
  document.querySelectorAll('#faceTable tr[data-face]').forEach(tr => tr.classList.toggle('on', +tr.dataset.face === no));
  const f = FACES.find(x => x.no === no), camId = SUMMARY.faces[no].cameras[0], cam = CAMERAS.find(c => c.id === camId), dv = derive(cam), cs = SUMMARY.cameras[camId], pf = cs.perFace[no];
  $('camDetail').innerHTML = `<b>面 ${no} ${f.name}</b>（${GROUPS[f.group]}，${f.kind}，Z ${f.z.join('~')}、r ${f.r.join('~')}）<br>`
    + `<b>${camId} ${cam.name}</b>：${cam.sensor}、${cam.lens}；WD ${cs.wd} mm、視野 ${cs.fov.join('×')} mm、${cs.mmpx} mm/px（有效 ${pf.mmpx?.join('–')}）<br>`
    + `景深需求 ${cs.span} mm → b ${cs.bDesign} mm、F${cs.N}、景深 ${cs.dof} mm；視角 ${pf.view?.join('–')}°、入射 ${pf.inc?.join('–')}°<br>`
    + `光源：${cam.light.type}。${cam.light.note || ''}<br>反光（高反光加工面，散開 4°／8°）：${pf.glare}／${pf.glare8}<br>旋轉取像：${cam.frames ? `${cam.frames} 張／圈（每 30°），相鄰重疊 ${pf.overlap}%` : '不轉，靜態取像'}`;
  // 面上色只顯示選到的面
  for (const st of ['ST1', 'ST2']) project.faceOverlay[st].children.forEach(m => m.visible = !no || m.name === `face-${no}`);
  if (!$('tgFaces').checked) { $('tgFaces').checked = true; applyToggles(); }
  $('camSel').value = camId;
}
document.querySelectorAll('#faceTable tr[data-face]').forEach(tr => tr.onclick = () => selectFace(+tr.dataset.face));

// ---------------------------------------------------------------- 顯示開關與相機視窗
$('camSel').innerHTML = CAMERAS.map(c => `<option value="${c.id}">${c.id} ${c.name}（面 ${c.faces.join('、')}）</option>`).join('');
$('camSel').value = 'C1-4';
function applyToggles() {
  optics.viz.visible = $('tgViz').checked;
  for (const list of Object.values(project.footMeshes)) for (const m of list) m.material.opacity = $('tgFoot').checked ? .8 : 0;
  for (const st of ['ST1', 'ST2']) project.faceOverlay[st].visible = $('tgFaces').checked;
  optics.options.visible = $('tgLaser').checked;
  stage.invalidate(true);
}
['tgViz', 'tgFoot', 'tgFaces', 'tgLaser'].forEach(id => $(id).onchange = applyToggles);
// 上色方式：面組 A–E，或內／外側（05 選項 B：杯外＝外側 0.8 mm、杯內與孔內＝內側 1.5 mm）
const ZONE_COLOR = { 外側: 0x4dabf7, 杯內: 0xff922b, 孔內: 0xff922b };
function applyFaceMode() {
  const zone = $('faceMode').value === 'zone';
  for (const st of ['ST1', 'ST2']) project.faceOverlay[st].children.forEach(m => {
    const f = FACES.find(x => `face-${x.no}` === m.name);
    m.material.color.setHex(zone ? ZONE_COLOR[f.zone] : parseInt(groupColor[f.group].slice(1), 16));
  });
  if (!$('tgFaces').checked) $('tgFaces').checked = true;
  applyToggles();
}
$('faceMode').onchange = applyFaceMode;
$('camSel').onchange = () => stage.invalidate(true);

// ---------------------------------------------------------------- 視線遮擋試算：改傾角，用 STEP 射線重算覆蓋率，看不到的區域在站上工件標紅
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
$('occCam').onchange = () => { $('occTilt').value = occBase[$('occCam').value].tilt; runOcclusion(); };
$('occTilt').oninput = runOcclusion;
$('occTilt').value = 40;

// ---------------------------------------------------------------- 檢核
const checks = project.layoutChecks();
$('checks').innerHTML = checks.map(r => `<li class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✓' : '✗'} ${r.name}<span>${r.value ?? ''}</span></li>`).join('');
$('checkCount').textContent = `${checks.filter(r => r.ok).length} / ${checks.length}`;

// ---------------------------------------------------------------- 目前動作面板
const events = timeline.events;
const ui = { action: $('action'), substep: $('substep'), stationName: $('stationName'), stations: [...stationBar.children] };
let shown = '';
function updatePanels(T) {
  const act = timeline.activity(T).filter(s => s.action), last = events.filter(e => e.start <= T + 1e-6).at(-1), station = last?.station ?? 0;
  const key = act.map(s => s.action).join('、') + '|' + station;
  updateGantt(T);
  if (key === shown) return; shown = key;
  ui.action.textContent = act.length ? act.map(s => s.action).join('、') : '待命';
  ui.substep.textContent = act.map(s => s.sub).filter(Boolean).join('、');
  ui.stationName.textContent = `P${station} ${STATIONS[station]}`;
  ui.stations.forEach((b, i) => b.classList.toggle('active', act.some(s => s.station === i)));
}

// ---------------------------------------------------------------- 播放列
const player = createPlayer({
  total: project.total,
  apply: T => project.apply(T),
  events: events.map(e => ({ time: e.start, label: `P${e.station} · ${e.action}` })),
  onChange: T => { updatePanels(T); stage.invalidate(true); },
});

// 每格繪製：相機視窗（隱藏視錐，只看取像足跡）→ 主畫面
function render() {
  const id = $('camSel').value, O = optics.cams[id], vizOn = optics.viz.visible;
  optics.viz.visible = false;
  workspace.renderCamera({ renderer, scene, camera: O.viewCam, title: `${id} ${O.cam.name}（面 ${O.cam.faces.join('、')}）`, result: `${SUMMARY.cameras[id].mmpx} mm/px`, marks: { time: player.T }, aspect: O.dv.fovW / O.dv.fovH });
  optics.viz.visible = vizOn;
  workspace.renderOverview(renderer, scene);
}

setView(qp.get('view') in VIEWS ? qp.get('view') : 'iso', true);
if (qp.has('cam')) { const a = qp.get('cam').split(',').map(Number); if (a.length === 6 && a.every(Number.isFinite)) stage.goTo(a.slice(0, 3), a.slice(3), true); }
applyToggles();
runOcclusion();
$('loading').classList.add('hide');
stage.loop(dt => { const changed = player.update(dt); workspace.follow(); stage.updateLabels(); return changed; }, { render });

exposeSim({ seekTo: player.seekTo, setView, views: VIEWS, total: project.total, play: player.play, pause: player.pause, get T() { return player.T; }, stationStart, project, selectFace });

// ---------------------------------------------------------------- 錄影（?movie）
if (qp.has('movie')) {
  const { installMovie } = await import('@core/movie/movie.js');
  installMovie({
    project: decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)),
    title: document.querySelector('.brand .title')?.textContent || document.title,
    scene, renderer, camera, controls, render, setView, total: project.total, steps: timeline.events,
    sample: t => { project.apply(t); updatePanels(t); },
    focus: () => stationCenter(3).add(new THREE.Vector3(0, 20, 0)),
    offset: [-420, 420, 640],
  });
}
