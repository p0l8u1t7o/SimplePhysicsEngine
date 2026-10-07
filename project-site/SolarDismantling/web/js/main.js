// 主程式：舞台（core/ui/stage.js）＋播放列（core/ui/player.js）＋共用版面與相機視窗（core/ui/viewer-workspace.js）＋本站的視角、站別與面板。
// 場景與每個時間點的狀態全部來自 project.js，與 core 統一檢查用的是同一份。
// 網址參數 ?fault：情境「拆框機故障」（project.json 的 variants 也用同一個參數）。
import * as THREE from 'three';
import { createStage, exposeSim } from '@core/ui/stage.js';
import { createPlayer } from '@core/ui/player.js';
import { createViewerWorkspace } from '@core/ui/viewer-workspace.js';
import { createProject, STATIONS } from './project.js';
import { MACHINE, ROBOT, GLASS_Y, CONTROLLER, OPERATOR, FENCE, BAYS, TABLE, LOADER, SCRAP } from './layout.js';

const qp = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const fault = qp.has('fault');

// ---------------------------------------------------------------- 舞台
const canvas = $('c');
const stage = createStage({
  canvas, look: 'cell', extent: { center: [0, 900, 2000], radius: 5600 },
  camera: { near: 10, far: 60000 },
  controls: { minDistance: 400, maxDistance: 28000 },
});
const { renderer, scene, camera, controls } = stage;
const project = createProject({ scene, fault });
const { sequence: seq, robot, cell, stationStart } = project;

// ---------------------------------------------------------------- 相機視窗：拆框機內部的監看相機（虛擬），看拆框與剝線盒
const machineCam = new THREE.PerspectiveCamera(46, 1.5, 50, 12000);
machineCam.position.set(MACHINE.x + 1250, 1820, MACHINE.z + 820); machineCam.lookAt(MACHINE.x - 150, GLASS_Y - 80, MACHINE.z - 100);

const tcpWorld = () => robot.tcp.getWorldPosition(new THREE.Vector3());
const workspace = createViewerWorkspace({
  camera, controls, canvas, resize: stage.resize,
  getFocus: tcpWorld, focusOffset: [-1800, 1500, 2400],
  onFocus: () => { stage.cancelTween(); document.querySelectorAll('.views [data-view]').forEach(b => b.classList.remove('on')); },
});

// ---------------------------------------------------------------- 視角（照桌面寫；窄畫布由 stage 自動拉遠）
const VIEWS = {
  iso: [[5600, 5200, 8600], [0, 600, 1900]],
  transfer: [[-3300, 2700, 3400], [-300, 1000, 1100]],
  machine: [[1900, 2100, 3300], [0, 1000, 0]],
  inlet: [[-4900, 2700, 6200], [BAYS.inA.x, 600, 3300]],
  outlet: [[4900, 2700, 6200], [BAYS.outA.x, 500, 3300]],
  scrap: [[3300, 2400, -3600], [600, 500, -300]],
  top: [[0, 12500, 2100], [0, 0, 2099]],
  gripper: () => {
    const p = tcpWorld(), x = p.x < -1200 ? 1400 : p.x > 1200 ? -1400 : -1000;
    return [p.clone().add(new THREE.Vector3(x, 750, p.z > 2500 ? 800 : 1350)).toArray(), p.toArray()];
  },
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
label('拆框機（現場既有）', new THREE.Vector3(MACHINE.x + 700, 2000, MACHINE.z - 900), 4);
label('FANUC M-710iC/45M', new THREE.Vector3(ROBOT.x, 1150, ROBOT.z + 450), 5);
label('交接台（置中）', new THREE.Vector3(TABLE.x + 700, 1000, TABLE.z + 450), 3);
label('懸臂移載機', new THREE.Vector3(LOADER.railX, 1700, 1650), 3);
label('入料 A', new THREE.Vector3(BAYS.inA.x, 500, BAYS.inA.z - 600), 2);
label('入料 B', new THREE.Vector3(BAYS.inB.x, 900, BAYS.inB.z + 600), 2);
label('出料 A', new THREE.Vector3(BAYS.outA.x, 600, BAYS.outA.z - 600), 2);
label('出料 B', new THREE.Vector3(BAYS.outB.x, 300, BAYS.outB.z + 600), 2);
label('長框料車', new THREE.Vector3((SCRAP.cart.x[0] + SCRAP.cart.x[1]) / 2, 700, 0), 1);
label('接線盒料箱', new THREE.Vector3(-600, 320, (SCRAP.tote.z[0] + SCRAP.tote.z[1]) / 2), 1);
label('液壓站', new THREE.Vector3(MACHINE.x - 950, 2800, MACHINE.z - 500), 0);
label('手臂控制器', new THREE.Vector3(CONTROLLER.x, 1150, CONTROLLER.z), 0);
label('操作站', new THREE.Vector3(OPERATOR.x, 1600, OPERATOR.z), 0);

// ---------------------------------------------------------------- 站別按鈕
const stationBar = $('stations');
STATIONS.forEach((name, i) => {
  const b = document.createElement('button'); b.className = 'st'; b.dataset.st = i;
  b.innerHTML = `<span class="idx">S${i + 1}</span>${name}`; b.onclick = () => player.seekTo(stationStart[i]);
  stationBar.appendChild(b);
});

// ---------------------------------------------------------------- 面板：情境、工位、訊號、選型評估、空間檢核
const scenario = $('scenario'); scenario.value = fault ? 'fault' : '';
scenario.onchange = () => { const u = new URL(location.href); if (scenario.value) u.searchParams.set('fault', ''); else u.searchParams.delete('fault'); location.href = u.toString().replace('fault=', 'fault'); };
$('cycleNote').textContent = `節拍 ${project.cycleTime.toFixed(1)} s／片`;
const events = seq.events;
const ui = { action: $('action'), substep: $('substep'), stationName: $('stationName'), stations: [...stationBar.children], bays: $('bays'), signals: $('signals') };
$('cycleTime').textContent = `節拍 ${project.cycleTime.toFixed(1)} s／片`;
const checks = project.layoutChecks?.() || [];
$('checks').innerHTML = checks.map(r => `<li class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✓' : '✗'} ${r.name}<span>${r.value ?? ''}</span></li>`).join('');
$('checkCount').textContent = `${checks.filter(r => r.ok).length} / ${checks.length}`;
$('selection').innerHTML = project.selection.map(c => {
  const [a, b] = c.results, mark = r => r.ok ? '✓' : '✗';
  return `<li class="${a.ok ? 'ok' : 'ng'}" title="${[a, b].map(r => `${r.req}：${r.ok ? '可' : r.reasons.join('；')}`).join('\n')}">${mark(a)}／${mark(b)} ${c.model}<span>${c.note || (a.ok ? '' : a.reasons[0])}</span></li>`;
}).join('');
const BAY_TEXT = { ok: '使用中', low: '剩餘少', empty: '空：請補料', warn: '將滿：備棧板', full: '滿：請換棧板' };
const BAY_COLOR = { ok: 'green', low: 'yellow', warn: 'yellow', empty: 'red', full: 'red' };
let shown = '';
function updatePanels(T) {
  const { step } = seq.sample(T), done = T >= project.total - 1e-6, pr = project.presentation;
  const bays = Object.entries(pr.bays).map(([k, b]) => [`${k.startsWith('in') ? '入料' : '出料'} ${k.slice(-1)}`, `${b.n} 片・${BAY_TEXT[b.state]}`, BAY_COLOR[b.state]]);
  const key = step.action + '|' + bays.map(b => b[1]).join('|') + '|' + pr.signals.map(s => +s.on).join('') + done;
  if (key === shown) return; shown = key;
  ui.action.textContent = done ? '完成：兩片拆框完成，回等待位' : step.action;
  ui.substep.textContent = step.sub || '';
  ui.stationName.textContent = `S${step.station + 1} ${STATIONS[step.station]}`;
  ui.stations.forEach((b, i) => b.classList.toggle('active', i === step.station));
  ui.bays.innerHTML = bays.map(([k, v, c]) => `<dt>${k}</dt><dd class="${c}">${v}</dd>`).join('');
  ui.signals.innerHTML = pr.signals.map(s => `<li class="${s.on ? 'on' : ''} ${s.kind || ''}">${s.label}</li>`).join('');
}

// ---------------------------------------------------------------- 播放列
const player = createPlayer({
  total: project.total,
  apply: T => project.apply(T),
  events: events.map(e => ({ time: e.time, label: `S${e.station + 1} · ${e.label}` })),
  onChange: T => { updatePanels(T); stage.invalidate(true); },
});

function render() {
  workspace.renderCamera({ renderer, scene, camera: machineCam, title: '拆框機內部（虛擬監看相機）', result: ui.action.textContent, marks: { time: player.T } });
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
    focus: () => { const s = seq.sample(movieTime).step.station; return s === 3 ? new THREE.Vector3(0, 900, 0) : s === 2 || s === 4 ? project.transfer.tcp() : tcpWorld(); },
    far: 30000, offset: [-2200, 1800, 2800],
  });
}
