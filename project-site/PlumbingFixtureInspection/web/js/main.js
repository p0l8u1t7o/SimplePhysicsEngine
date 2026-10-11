// 主程式：舞台（core/ui/stage.js）＋播放列（core/ui/player.js）＋共用版面與相機視窗（core/ui/viewer-workspace.js）＋本站的視角、站別與面板。
// 場景與每個時間點的狀態全部來自 project.js，與 core 統一檢查用的是同一份。
// 網址參數 ?product=gooseneck：換成鵝頸出水管（project.json 的 variants 也用同一個參數）。
// 鏡面鉻的反射：在甜蜜點放 CubeCamera，條紋屏的相移狀態改變時重拍，產品表面就會映出被曲面扭曲的條紋（只在網頁做，檢查不需要）。
import * as THREE from 'three';
import { createStage, exposeSim } from '@core/ui/stage.js';
import { createPlayer } from '@core/ui/player.js';
import { createViewerWorkspace } from '@core/ui/viewer-workspace.js';
import { createProject, STATIONS, CHROME } from './project.js';
import { PRODUCTS, FINISH, MODE } from './inspection.js';
import { OPTICS, SCAN, DRAWER, ROBOT, TWIN, NG_RACK, OK_BIN, HMI_POS, CAMERA_EVAL } from './layout.js';

const qp = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const pid = PRODUCTS[qp.get('product')] ? qp.get('product') : 'sleeve';

// ---------------------------------------------------------------- 舞台
const canvas = $('c');
const stage = createStage({
  canvas, look: 'cell', extent: { center: [-400, 1100, 400], radius: 4300 },
  camera: { near: 5, far: 40000 },
  controls: { minDistance: 150, maxDistance: 16000 },
});
const { renderer, scene, camera, controls } = stage;
const project = createProject({ scene, product: pid });
const { sequence: seq, robot, cell, stationStart, prod, products } = project;

// ---------------------------------------------------------------- 條紋反射（環境貼圖）
const S = new THREE.Vector3(...OPTICS.S);
const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
const cubeCam = new THREE.CubeCamera(20, 6000, cubeRT); cubeCam.position.copy(S); scene.add(cubeCam);
CHROME.envMap = cubeRT.texture; CHROME.needsUpdate = true;
let envKey = '';
function updateEnv() {
  const o = project.presentation.optics || {}, key = `${o.mode}|${o.phase}`;
  if (key === envKey) return; envKey = key;
  const vis = Object.values(products).map(g => g.visible); Object.values(products).forEach(g => { g.visible = false; });
  cubeCam.update(renderer, scene);
  Object.values(products).forEach((g, i) => { g.visible = vis[i]; });
}

// ---------------------------------------------------------------- 相機視窗：主相機（虛擬，對焦在甜蜜點）
const tcpWorld = () => products.L.getWorldPosition(new THREE.Vector3());
const workspace = createViewerWorkspace({
  camera, controls, canvas, resize: stage.resize,
  getFocus: tcpWorld, focusOffset: [900, 450, 900],
  onFocus: () => { stage.cancelTween(); document.querySelectorAll('.views [data-view]').forEach(b => b.classList.remove('on')); },
});

// ---------------------------------------------------------------- 視角（照桌面寫；窄畫布由 stage 自動拉遠）
const T = TWIN.center;
const VIEWS = {
  iso: [[3600, 3300, 4600], [-200, 1150, 0]],
  front: [[700, 1600, 3600], [300, 1150, 600]],
  load: [[1500, 1500, 2300], [DRAWER.xs.L + 150, 1000, 700]],
  optics: [[350, 1900, 900], [S.x, S.y, S.z]],
  scanner: [[600, 1900, 1400], [SCAN.spot[0], SCAN.spot[1], SCAN.spot[2]]],
  twin: [[T[0] + 2300, T[1] + 700, T[2] + 2300], [T[0], T[1], T[2]]],
  top: [[-200, 9000, 400], [-200, 0, 399]],
  closeup: () => { const p = tcpWorld(); return [p.clone().add(new THREE.Vector3(700, 380, 650)).toArray(), p.toArray()]; },
};
function setView(name, instant = false) {
  const v = typeof VIEWS[name] === 'function' ? VIEWS[name]() : VIEWS[name]; if (!v) return;
  workspace.stopFollowing();
  stage.goTo(v[0], v[1], instant);
  document.querySelectorAll('.views [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('.views [data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));

// ---------------------------------------------------------------- 3D 標籤
const label = (html, pos, priority = 0) => stage.addLabel(html, pos, '', { anchor: 'above', priority });
label('DENSO VM-60B1', new THREE.Vector3(ROBOT.x, 1500, ROBOT.z), 5);
label('U 形條紋屏（3 × 43 吋）', new THREE.Vector3(S.x - 300, S.y + 520, S.z), 4);
label('主相機 12 MP＋彩色相機', new THREE.Vector3(S.x, S.y + OPTICS.wd + 260, S.z), 3);
label('LED 陣列 8 扇區', new THREE.Vector3(S.x + 330, S.y + OPTICS.ledY, S.z + 200), 1);
label('3D 結構光掃描器', new THREE.Vector3(...SCAN.head).add(new THREE.Vector3(0, 120, 0)), 3);
label('上料窗 左', new THREE.Vector3(DRAWER.xs.L, 1180, 1050), 2);
label('上料窗 右', new THREE.Vector3(DRAWER.xs.R, 1180, 1050), 2);
label('操作螢幕', new THREE.Vector3(HMI_POS.x, HMI_POS.y + 200, 1020), 1);
label('NG 料架', new THREE.Vector3(NG_RACK.x, 1150, NG_RACK.z), 1);
label('OK 料箱', new THREE.Vector3(OK_BIN.x, 850, OK_BIN.z), 1);
label('數位空間：產品檔與判定', new THREE.Vector3(T[0], T[1] + TWIN.height / 2 + 420, T[2]), 4);

// ---------------------------------------------------------------- 站別按鈕
const stationBar = $('stations');
STATIONS.forEach((name, i) => {
  const b = document.createElement('button'); b.className = 'st'; b.dataset.st = i;
  b.innerHTML = `<span class="idx">S${i + 1}</span>${name}`; b.onclick = () => player.seekTo(stationStart[i]);
  stationBar.appendChild(b);
});

// ---------------------------------------------------------------- 面板
const productSel = $('product');
productSel.innerHTML = Object.entries(PRODUCTS).map(([k, p]) => `<option value="${k}">${p.name}（${p.partNo}）</option>`).join('');
productSel.value = pid;
productSel.onchange = () => { const u = new URL(location.href); if (productSel.value === 'sleeve') u.searchParams.delete('product'); else u.searchParams.set('product', productSel.value); location.href = u.toString(); };
const fs = prod.file.stats;
$('productFile').innerHTML = [
  ['來源', `${prod.source.format}${prod.source.faces ? `（${prod.source.faces} 個面）` : ''}`], ['外形', prod.size.map(v => Math.round(v)).join(' × ') + ' mm'],
  ['表面／取像', `${FINISH[prod.finish]}／${MODE[prod.finish]}`], ['轉接頭', prod.adapter === 'mandrel' ? '內撐式（底環＋鍵槽定向）' : '筒夾式（接管端）'],
  ['A／B／不檢', `${fs.area.A}／${fs.area.B}／${fs.area.none} mm²`], ['遮罩', Object.entries(fs.mask).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join('、') || '—'],
  ['姿態', `${fs.views} 個（候選 ${fs.candidates}，錨點 ${fs.anchors}）`], ['覆蓋率', `A ${(fs.coverage.A * 100).toFixed(1)}%、B ${(fs.coverage.B * 100).toFixed(1)}%`],
  ['預估', `移動 ${fs.moveTime} s＋取像 ${fs.captureTime} s`], ['單件 CT', `${project.cycleTime.toFixed(1)} s（預算 120 s）`],
].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
$('optics').innerHTML = CAMERA_EVAL.results.filter(r => ['fov', 'resolution', 'defect', 'dof', 'bandwidth'].includes(r.key))
  .map(r => `<li class="${r.status === 'ok' ? 'ok' : r.status === 'info' ? '' : 'ng'}">${r.label}<span>${r.value} ${r.unit}</span></li>`).join('');
$('cycleNote').textContent = `單件 ${project.cycleTime.toFixed(1)} s`;
$('cycleTime').textContent = `單件 CT ${project.cycleTime.toFixed(1)} s`;
const checks = project.layoutChecks?.() || [];
$('checks').innerHTML = checks.map(r => `<li class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✓' : '✗'} ${r.name}<span>${r.value ?? ''}</span></li>`).join('');
$('checkCount').textContent = `${checks.filter(r => r.ok).length} / ${checks.length}`;
const ui = { action: $('action'), substep: $('substep'), stationName: $('stationName'), stations: [...stationBar.children], signals: $('signals'), verdict: $('verdict') };
const VERDICT_TEXT = { NG: '<b class="bad">NG</b>', OK: '<b class="good">OK</b>' };
let shown = '';
function updatePanels(T) {
  const { step } = seq.sample(T), pr = project.presentation, done = T >= project.total - 1e-6;
  const key = step.action + '|' + pr.signals.map(s => +s.on).join('') + pr.verdict + done;
  if (key === shown) return; shown = key;
  ui.action.textContent = done ? '完成：下一件已在右工位就緒' : step.action;
  ui.substep.textContent = step.sub || '';
  ui.stationName.textContent = `S${step.station + 1} ${STATIONS[step.station]}`;
  ui.stations.forEach((b, i) => { b.classList.toggle('active', i === step.station); b.classList.toggle('done', i < step.station || done); });
  ui.signals.innerHTML = pr.signals.map(s => `<li class="${s.on ? 'on' : ''} ${s.kind || ''}">${s.label}</li>`).join('');
  ui.verdict.innerHTML = pr.verdict ? `${VERDICT_TEXT[pr.verdict]}　` + project.cands.filter(c => c.verdict !== 'ignore').map(c => `${c.type}（${c.face} 面 ${c.value} ${c.unit}／限 ${c.limit}）${c.verdict === 'NG' ? '超限' : '允收'}`).join('；')
    : `候選 ${project.cands.length} 點：真瑕疵 ${project.cands.filter(c => c.kind === 'defect').length}、設計特徵與正常紋理 ${project.cands.filter(c => c.kind !== 'defect').length}`;
}

// ---------------------------------------------------------------- 播放列
const player = createPlayer({
  total: project.total,
  apply: T => project.apply(T),
  events: seq.events.map(e => ({ time: e.time, label: `S${e.station + 1} · ${e.label}` })),
  onChange: T => { updatePanels(T); stage.invalidate(true); },
});

function render() {
  updateEnv();
  workspace.renderCamera({ renderer, scene, camera: cell.cam.camera, title: '主相機（12 MP，對焦在甜蜜點）', result: ui.action.textContent, marks: { time: player.T } });
  workspace.renderOverview(renderer, scene);
}

setView(qp.get('view') in VIEWS ? qp.get('view') : 'iso', true);
if (qp.has('cam')) { const a = qp.get('cam').split(',').map(Number); if (a.length === 6 && a.every(Number.isFinite)) stage.goTo(a.slice(0, 3), a.slice(3), true); }
$('loading').classList.add('hide');
stage.loop(dt => { const changed = player.update(dt); workspace.follow(); stage.updateLabels(); return changed; }, { render });

exposeSim({ seekTo: player.seekTo, setView, views: VIEWS, total: project.total, play: player.play, pause: player.pause, get T() { return player.T; }, stationStart, project });

// ---------------------------------------------------------------- 錄影（?movie）
if (qp.has('movie')) {
  const { installMovie } = await import('@core/movie/movie.js');
  let movieTime = 0;
  installMovie({
    project: decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)),
    title: document.querySelector('.brand .title')?.textContent || document.title,
    scene, renderer, camera, controls, render, setView, total: project.total,
    steps: seq.steps,
    sample: t => { movieTime = t; project.apply(t); updatePanels(t); },
    focus: () => { const s = seq.sample(movieTime).step.station; return s === 3 || s === 7 ? new THREE.Vector3(...TWIN.center) : tcpWorld(); },
    offset: [1100, 650, 1300],
  });
}
