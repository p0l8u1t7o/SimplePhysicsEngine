// 主程式：舞台（core/ui/stage.js）＋播放列（core/ui/player.js）＋共用版面與相機視窗（core/ui/viewer-workspace.js）＋本站的視角、站別與面板。
// 場景與每個時間點的狀態全部來自 project.js，與 core 統一檢查用的是同一份。
// 相機視窗：手臂上雙眼相機的左相機（虛擬），看得到輪框從斜視到正對、最後進入盲區的過程。
import * as THREE from 'three';
import { createStage, exposeSim } from '@core/ui/stage.js';
import { createPlayer } from '@core/ui/player.js';
import { createViewerWorkspace } from '@core/ui/viewer-workspace.js';
import { createProject, STATIONS } from './project.js';
import { LINE, PICK, BAYS, SHEETS, CONTROLLER, CABINET, OPERATOR } from './layout.js';

const qp = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- 舞台
const canvas = $('c');
const stage = createStage({
  canvas, look: 'cell', extent: { center: [500, 1200, 0], radius: 6000 },
  camera: { near: 10, far: 60000 },
  controls: { minDistance: 400, maxDistance: 30000 },
});
const { renderer, scene, camera, controls } = stage;
const project = createProject({ scene });
const { sequence: seq, robot, stationStart } = project;
const leftCam = robot.cameras[0].camera;

const tcpWorld = () => robot.tcp.getWorldPosition(new THREE.Vector3());
const workspace = createViewerWorkspace({
  camera, controls, canvas, resize: stage.resize,
  getFocus: tcpWorld, focusOffset: [1800, 1300, 2600],
  onFocus: () => { stage.cancelTween(); document.querySelectorAll('.views [data-view]').forEach(b => b.classList.remove('on')); },
});

// ---------------------------------------------------------------- 視角（照桌面寫；窄畫布由 stage 自動拉遠）
const VIEWS = {
  iso: [[6200, 4800, 7600], [600, 1100, 0]],
  pick: [[3300, 2300, 1900], [1000, 1500, -1200]],
  optics: [[3900, 2500, -350], [1300, 1950, -1400]],
  pallet: [[3800, 3200, 4200], [1100, 600, 1000]],
  top: [[500, 13500, 400], [500, 0, 399]],
  side: [[7200, 1900, -300], [800, 1450, -700]],
  gripper: () => {
    const p = tcpWorld();
    return [p.clone().add(new THREE.Vector3(1300, 700, 1500)).toArray(), p.toArray()];
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
label('FANUC R-2000iC/165F', new THREE.Vector3(0, 1300, 450), 5);
label('清洗線吊掛線 4 cm/s →', new THREE.Vector3(-2600, 3300, LINE.z), 4);
label('追蹤窗', new THREE.Vector3((PICK.window[0] + PICK.window[1]) / 2, 2500, PICK.backdrop.z), 3);
label('消光黑背板', new THREE.Vector3(PICK.backdrop.x[0] + 400, PICK.backdrop.y[1] + 80, PICK.backdrop.z), 1);
label('防擺導軌', new THREE.Vector3(PICK.guide.x[0] + 200, PICK.guide.y + 120, LINE.rodZ), 1);
label('面光源 525 nm＋偏光', new THREE.Vector3(PICK.lights[0].x, PICK.lights[0].y + 150, PICK.lights[0].z), 2);
label('到位光電', new THREE.Vector3(PICK.sensorX, 1700, -640), 1);
label('棧板 A（A 款）', new THREE.Vector3(BAYS.A.x, 1400, BAYS.A.z), 3);
label('棧板 B（換款）', new THREE.Vector3(BAYS.B.x, 700, BAYS.B.z), 3);
label('隔板架', new THREE.Vector3(SHEETS.x, 900, SHEETS.z), 2);
label('手臂控制器', new THREE.Vector3(CONTROLLER.x, 1200, CONTROLLER.z), 0);
label('視覺 IPC＋PLC 櫃', new THREE.Vector3(CABINET.x, 2050, CABINET.z), 1);
label('操作站', new THREE.Vector3(OPERATOR.x, 1700, OPERATOR.z), 0);

// ---------------------------------------------------------------- 站別按鈕
const stationBar = $('stations');
STATIONS.forEach((name, i) => {
  const b = document.createElement('button'); b.className = 'st'; b.dataset.st = i;
  b.innerHTML = `<span class="idx">S${i + 1}</span>${name}`; b.onclick = () => player.seekTo(stationStart[i]);
  stationBar.appendChild(b);
});

// ---------------------------------------------------------------- 面板
const events = seq.events;
const ui = { action: $('action'), substep: $('substep'), stationName: $('stationName'), stations: [...stationBar.children], vision: $('vision'), signals: $('signals'), bays: $('bays') };
$('cycleTime').textContent = `節拍 ${project.cycleTime.toFixed(1)} s／個（吊鉤間隔 ${LINE.pitch / LINE.v} s）`;
const checks = project.layoutChecks?.() || [];
$('checks').innerHTML = checks.map(r => `<li class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✓' : '✗'} ${r.name}<span>${r.value ?? ''}</span></li>`).join('');
$('checkCount').textContent = `${checks.filter(r => r.ok).length} / ${checks.length}`;
let shown = '';
function updatePanels(T) {
  const { step } = seq.sample(T), done = T >= project.total - 1e-6, pr = project.presentation, v = pr.vision;
  const key = step.action + '|' + JSON.stringify(v) + '|' + pr.signals.map(s => +s.on).join('') + JSON.stringify(pr.bays) + done;
  if (key === shown) return; shown = key;
  ui.action.textContent = done ? '完成：三個輪框下掛完成，回取像待命位' : step.action;
  ui.substep.textContent = step.sub || '';
  ui.stationName.textContent = `S${step.station + 1} ${STATIONS[step.station]}`;
  ui.stations.forEach((b, i) => b.classList.toggle('active', i === step.station));
  ui.vision.innerHTML = v ? [['階段', v.fine ? '精取像（正對）' : '粗取像（斜 25°）'], ['輪型', v.model], ['外徑', `${v.od} mm`], ['中心 X／Y／Z', v.center.join('／')], ['軸線偏角', `${v.tilt}°`], ['可信度', v.score]]
    .map(([k, x]) => `<dt>${k}</dt><dd>${x}</dd>`).join('') : '<dt>—</dt><dd class="vision idle">取像時顯示</dd>';
  ui.signals.innerHTML = pr.signals.map(s => `<li class="${s.on ? 'on' : ''}">${s.label}</li>`).join('');
  ui.bays.innerHTML = Object.entries(pr.bays).map(([k, n]) => `<dt>棧板 ${k}</dt><dd>${n}／20 個</dd>`).join('');
}

// ---------------------------------------------------------------- 播放列
const player = createPlayer({
  total: project.total,
  apply: T => project.apply(T),
  events: events.map(e => ({ time: e.time, label: `S${e.station + 1} · ${e.label}` })),
  onChange: T => { updatePanels(T); stage.invalidate(true); },
});

function render() {
  workspace.renderCamera({ renderer, scene, camera: leftCam, title: '手臂左相機（虛擬，525 nm＋偏光）', result: ui.action.textContent, marks: { time: player.T } });
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
    focus: () => tcpWorld(),
    far: 30000, offset: [1800, 1500, 2600],
  });
}
