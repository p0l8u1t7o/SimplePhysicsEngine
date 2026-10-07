// 主程式：舞台（core/ui/stage.js）＋播放列（core/ui/player.js）＋共用版面與相機視窗（core/ui/viewer-workspace.js）＋本站的視角、站別與面板。
// 場景與每個時間點的狀態全部來自 project.js，與 core 統一檢查用的是同一份。
import * as THREE from 'three';
import { createStage, exposeSim } from '@core/ui/stage.js';
import { createPlayer } from '@core/ui/player.js';
import { createViewerWorkspace } from '@core/ui/viewer-workspace.js';
import { createProject, STATIONS } from './project.js';
import { IN, OUT, MACHINE, ROBOT, GLASS_Y, CONTROLLER, OPERATOR, FENCE } from './layout.js';
import { CYCLES } from './sequence.js';

const qp = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- 舞台
const canvas = $('c');
const stage = createStage({
  canvas, look: 'cell', extent: { center: [0, 900, 2200], radius: 5200 },
  camera: { near: 10, far: 60000 },
  controls: { minDistance: 400, maxDistance: 26000 },
});
const { renderer, scene, camera, controls } = stage;
const project = createProject({ scene });
const { sequence: seq, robot, machine, cell, stationStart } = project;

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
  iso: [[5200, 4600, 8200], [0, 700, 1700]],
  machine: [[1900, 2100, 3300], [0, 1000, 0]],
  inlet: [[-4600, 2600, 5600], [IN.x, 700, IN.z - 300]],
  outlet: [[4600, 2600, 5600], [OUT.x, 600, OUT.z - 300]],
  back: [[-2600, 2600, -4200], [0, 800, 0]],
  top: [[0, 11000, 2200], [0, 0, 2199]],
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
label('FANUC R-2000iC/165F', new THREE.Vector3(ROBOT.x, 1300, ROBOT.z + 500), 5);
label('入料棧板：整板 20 片', new THREE.Vector3(IN.x, 1000, IN.z + 900), 3);
label('出料棧板：無框層壓板', new THREE.Vector3(OUT.x, 450, OUT.z + 900), 3);
label('鋁框收集槽', new THREE.Vector3(MACHINE.x + 600, 520, MACHINE.z - 980), 1);
label('接線盒料箱', new THREE.Vector3(MACHINE.x - 600, 580, MACHINE.z - 500), 1);
label('液壓站', new THREE.Vector3(MACHINE.x - 950, 2800, MACHINE.z - 500), 0);
label('手臂控制器', new THREE.Vector3(CONTROLLER.x, 1150, CONTROLLER.z), 0);
label('操作站', new THREE.Vector3(OPERATOR.x, 1600, OPERATOR.z), 0);
label('叉車口光柵', new THREE.Vector3(-FENCE.x, 1700, (FENCE.gate[0] + FENCE.gate[1]) / 2), 0);

// ---------------------------------------------------------------- 站別按鈕
const stationBar = $('stations');
STATIONS.forEach((name, i) => {
  const b = document.createElement('button'); b.className = 'st'; b.dataset.st = i;
  b.innerHTML = `<span class="idx">S${i + 1}</span>${name}`; b.onclick = () => player.seekTo(stationStart[i]);
  stationBar.appendChild(b);
});

// ---------------------------------------------------------------- 面板
const events = seq.events;
const ui = { action: $('action'), substep: $('substep'), stationName: $('stationName'), stations: [...stationBar.children], stats: $('stats') };
$('cycleTime').textContent = `節拍 ${project.cycleTime.toFixed(1)} s／片`;
const checks = project.layoutChecks?.() || [];
$('checks').innerHTML = checks.map(r => `<li class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✓' : '✗'} ${r.name}<span>${r.value ?? ''}</span></li>`).join('');
$('checkCount').textContent = `${checks.filter(r => r.ok).length} / ${checks.length}`;
const pct = v => `${Math.round(v * 100)}%`;
let shown = '';
function updatePanels(T) {
  const { state: st, step } = seq.sample(T), done = T >= project.total - 1e-6;
  const lams = Array.from({ length: CYCLES }, (_, k) => st['lam' + k]);
  const picked = lams.filter(v => v !== 'in').length, out = lams.filter(v => v === 'out').length;
  const frames = Array.from({ length: CYCLES }, (_, k) => st['frm' + k] >= 2).filter(Boolean).length;
  const boxes = Array.from({ length: CYCLES }, (_, k) => st['box' + k] >= 2).filter(Boolean).length;
  const mState = st.press > .01 || st.pull > .01 || st.scrape > .01 ? '拆框中' : lams.includes('machine') ? '等待取板' : '待料';
  const rows = [
    ['入料棧板', `${IN.n - picked} 片整板`], ['出料棧板', `${OUT.n + out} 片無框板`],
    ['鋁框收集', `${frames * 4} 支（${frames} 片份）`], ['接線盒', `${boxes} 個`],
    ['吸盤真空', st.vac ? '吸附中' : '關'], ['拆框機', `${mState}（壓板 ${pct(st.press)}、外拉 ${pct(st.pull)}）`],
  ];
  const key = step.action + '|' + rows.map(r => r[1]).join('|') + '|' + done;
  if (key === shown) return; shown = key;
  ui.action.textContent = done ? '完成：兩片拆框完成，回等待位' : step.action;
  ui.substep.textContent = step.sub || '';
  ui.stationName.textContent = `S${step.station + 1} ${STATIONS[step.station]}`;
  ui.stations.forEach((b, i) => { b.classList.toggle('active', i === step.station); });
  ui.stats.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  cell.hmi.drawText?.(['拆框上下料', mState, `出料 ${OUT.n + out} 片`]);
  cell.tower.set(mState === '拆框中' ? 'yellow' : 'green');
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
  installMovie({
    project: decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)),
    title: document.querySelector('.brand .title')?.textContent || document.title,
    scene, renderer, camera, controls, render, setView, total: project.total,
    steps: seq.steps,
    sample: t => { project.apply(t); updatePanels(t); },
    focus: tcpWorld, far: 30000,
    offset: [-2200, 1800, 2800],
  });
}
