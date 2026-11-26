// 主程式：舞台（core/ui/stage.js）＋播放列（core/ui/player.js）＋共用版面與相機視窗（core/ui/viewer-workspace.js）＋本站的視角、站別與面板。
// 場景與每個時間點的狀態全部來自 project.js（core 統一檢查用同一份）。
import * as THREE from 'three';
import { createStage, exposeSim } from '@core/ui/stage.js';
import { createPlayer } from '@core/ui/player.js';
import { createViewerWorkspace } from '@core/ui/viewer-workspace.js';
import { createProject, LAY, STATIONS, SCENARIOS, TORQUE } from './project.js';
import { SLOTS } from './parts.js';

const qp = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const scenario = qp.get('scenario') in SCENARIOS ? qp.get('scenario') : 'clean';

// ---------------------------------------------------------------- 舞台
const canvas = $('c');
const stage = createStage({
  canvas, look: 'cell', extent: { center: [0, 1000, 150], radius: 1500 },
  camera: { near: 2, far: 30000 },
  controls: { minDistance: 30, maxDistance: 9000 },
});
const { renderer, scene, camera, controls } = stage;
const project = createProject({ scene, scenario });
const { timeline, stationStart, robot, locker, lanes, st } = project;

// ---------------------------------------------------------------- 相機視窗：上視相機 I／S、Tray 上面檢查、SCARA 下視、鎖附近照（觀察用虛擬相機）
const lockCam = new THREE.PerspectiveCamera(34, 1.5, 5, 3000);
lockCam.position.set(110, 960 - LAY.locker.beamY, 120 - LAY.locker.z);
locker.head.add(lockCam);
project.apply(0); scene.updateMatrixWorld(true);
lockCam.lookAt(LAY.locker.park, 935, -15);
const sources = {
  upI: { cam: st.camUp.I.camera, title: '上視相機 I：interposer 底面＋覆拍修正' },
  upS: { cam: st.camUp.S.camera, title: '上視相機 S：SOCAMM 底面焊墊＋覆拍修正' },
  trayI: { cam: lanes.I.cam.camera, title: 'Tray 上面檢查：interposer 鍍金接點（2D）' },
  trayS: { cam: lanes.S.cam.camera, title: 'Tray 上面檢查：SOCAMM 正面' },
  down: { cam: robot.cam.camera, title: 'SCARA 下視相機：PCB 基準點' },
  lock: { cam: lockCam, title: '鎖附近照（觀察視角，非量測相機）' },
};
let source = 'auto';

// ---------------------------------------------------------------- 共用版面
const workspace = createViewerWorkspace({
  camera, controls, canvas, resize: stage.resize,
  getFocus: () => robot.tool.getWorldPosition(new THREE.Vector3()).add(V(0, -80, 0)),
  focusOffset: [-260, 260, 380],
  onFocus: () => { stage.cancelTween(); document.querySelectorAll('.views [data-view]').forEach(b => b.classList.remove('on')); },
});
workspace.setSources([
  { id: 'upI', label: '上視相機 I（interposer）' }, { id: 'upS', label: '上視相機 S（SOCAMM）' },
  { id: 'trayI', label: 'Tray 上面 2D（interposer）' }, { id: 'trayS', label: 'Tray 上面 2D（SOCAMM）' },
  { id: 'down', label: 'SCARA 下視相機' }, { id: 'lock', label: '鎖附近照' },
], { onChange: v => { source = v; stage.invalidate(true); } });

// ---------------------------------------------------------------- 視角
const VIEWS = {
  iso: [[-1750, 2150, 2450], [0, 880, 150]],
  scara: [[-620, 1680, 1250], [0, 960, 230]],
  tray: [[-1000, 1560, 1150], [LAY.lane.I, 940, 560]],
  inspect: [[-760, 1420, 760], [-330, 915, 270]],
  clean: [[720, 1420, 1250], [250, 905, 640]],
  board: [[-470, 1150, 300], [0, 922, 0]],
  lock: () => { const x = locker.head.getWorldPosition(V()).x; return [[x + 260, 1330, -500], [x, 945, -30]]; },
  top: [[0, 3400, 160], [0, 900, 150]],
};
function setView(name, instant = false) {
  const v = typeof VIEWS[name] === 'function' ? VIEWS[name]() : VIEWS[name]; if (!v) return;
  workspace.stopFollowing();
  stage.goTo(v[0], v[1], instant);
  document.querySelectorAll('.views [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('.views [data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));

// ---------------------------------------------------------------- 3D 標籤
const label = (html, getPos, priority = 0) => stage.addLabel(html, getPos, '', { anchor: 'above', priority });
label('SCARA HSR065（雙三孔頭）', () => robot.tool.getWorldPosition(V()).add(V(0, 80, 0)), 3);
label('interposer Tray', V(LAY.lane.I, 960, LAY.tray.pick), 1);
label('SOCAMM Tray', V(LAY.lane.S, 960, LAY.tray.pick), 1);
label('上面檢查橋（3D＋2D）', V(LAY.lane.I, 1100, LAY.tray.scan), 1);
label('底面 3D 線雷射', V(LAY.st.prof[0], 915, LAY.st.prof[1]), 2);
label('上視相機 I', V(LAY.st.camI[0], 880, LAY.st.camI[1]), 2);
label('上視相機 S', V(LAY.st.camS[0], 880, LAY.st.camS[1]), 2);
label('離子風刀', V(LAY.st.blow[0], 900, LAY.st.blow[1]), 1);
label('IPA 擦拭', V(LAY.st.wipe[0], 905, LAY.st.wipe[1]), 1);
label('吹乾槽 10 s', V(LAY.st.dry[0], 910, LAY.st.dry[1]), 1);
label('NG 盒', V(LAY.st.ngI[0], 905, LAY.st.ngI[1]), 0);
label('鎖附模組', () => locker.head.getWorldPosition(V()).add(V(0, 120, 0)), 2);
label('載台＋主機板（4 槽）', () => project.board.getWorldPosition(V()).add(V(0, 40, -100)), 2);
label('FFU（一萬級）', V(0, LAY.top + 40, 170), 0);

// ---------------------------------------------------------------- 站別按鈕
const stationBar = $('stations');
STATIONS.forEach((name, i) => {
  const b = document.createElement('button'); b.className = 'st'; b.dataset.st = i;
  b.innerHTML = `<span class="idx">S${i + 1}</span>${name}`; b.onclick = () => player.seekTo(stationStart[i]);
  stationBar.appendChild(b);
});

// ---------------------------------------------------------------- 面板
const events = timeline.events;
const ui = { action: $('action'), substep: $('substep'), stationName: $('stationName'), stations: [...stationBar.children] };
const C = project.cycle;
$('cycleTime').textContent = `動畫 ${project.total.toFixed(1)} s · 穩態約 ${C.steady} s／片`;
const sel = $('scenario');
sel.innerHTML = Object.entries(SCENARIOS).map(([k, v]) => `<option value="${k}"${k === scenario ? ' selected' : ''}>${v.name}</option>`).join('');
sel.onchange = () => { const u = new URL(location.href); u.searchParams.set('scenario', sel.value); location.href = u.toString(); };
$('cycleBox').innerHTML = `<div><span>動畫總長（含示範）</span><b>${project.total.toFixed(1)} s</b></div>
  <div><span>穩態節拍（4 組／片，示意）</span><b>${C.steady} s</b></div><div><span>每組</span><b>${C.perModule} s</b></div>`;
const checks = project.layoutChecks?.() || [];
$('checks').innerHTML = checks.map(r => `<li class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✓' : '✗'} ${r.name}<span>${r.value ?? ''}</span></li>`).join('');
$('checkCount').textContent = `${checks.filter(r => r.ok).length} / ${checks.length}`;

// 螺絲狀態格（4 槽 × 3 孔）
const grid = $('screwGrid');
grid.innerHTML = SLOTS.map((_, k) => `<div class="row"><span>槽 ${k + 1}</span>${[0, 1, 2].map(i => `<i data-n="${k * 3 + i}">${i + 1}</i>`).join('')}</div>`).join('');
const cells = [...grid.querySelectorAll('i')];
// 扭力-角度曲線（示意）：預鎖空轉段低扭力、貼合時上升；終鎖低速到目標扭力
const preDeg = TORQUE.preTurns * 360, finDeg = TORQUE.finTurn * 360;
const preTq = a => a < preDeg - 40 ? .012 + .004 * Math.sin(a / 57) + .003 * (a / preDeg) : .016 + (TORQUE.preNm - .016) * Math.pow((a - (preDeg - 40)) / 40, 1.6);
const finTq = a => TORQUE.preNm + (TORQUE.finNm - TORQUE.preNm) * Math.pow(a / finDeg, 1.05);
const tctx = $('torque').getContext('2d');
function drawTorque(T) {
  const log = project.screwLog, cur = [...log].filter(s => s.pre[0] <= T).sort((a, b) => b.pre[0] - a.pre[0] || (b.fin[0] - a.fin[0]))
    .reduce((best, s) => { const t0 = s.fin[0] <= T ? s.fin[0] : s.pre[0]; return !best || t0 > best.t0 ? { s, t0 } : best; }, null)?.s;
  const W = 560, H = 200, ctx = tctx; ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0f1a24'; ctx.fillRect(0, 0, W, H);
  const pane = [[40, 300, '預鎖（600 rpm）', preDeg, preTq], [330, 540, '終鎖（60 rpm）', finDeg, finTq]];
  const ymax = .25, py = v => H - 26 - v / ymax * (H - 50);
  ctx.font = '12px "Noto Sans TC","Microsoft JhengHei",sans-serif';
  for (const [x0, x1, name, amax, f] of pane) {
    ctx.strokeStyle = '#2a3948'; ctx.strokeRect(x0, 20, x1 - x0, H - 46);
    ctx.fillStyle = '#8b98a8'; ctx.fillText(name, x0 + 4, 14); ctx.fillText(`${Math.round(amax)}°`, x1 - 34, H - 8); ctx.fillText('0', x0, H - 8);
    ctx.strokeStyle = '#ffb020'; ctx.setLineDash([4, 4]); ctx.beginPath(); const yl = py(name.startsWith('預') ? TORQUE.preNm : TORQUE.finNm); ctx.moveTo(x0, yl); ctx.lineTo(x1, yl); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#33465a'; ctx.beginPath(); for (let i = 0; i <= 80; i++) { const a = amax * i / 80, x = x0 + (x1 - x0) * i / 80; i ? ctx.lineTo(x, py(f(a))) : ctx.moveTo(x, py(f(a))); } ctx.stroke();
    if (!cur) continue;
    const [t0, t1] = name.startsWith('預') ? cur.pre : cur.fin;
    const u = Math.max(0, Math.min(1, (T - t0) / (t1 - t0))), ue = name.startsWith('預') ? u : Math.min(1, u * 1.25);
    if (T < t0) continue;
    ctx.strokeStyle = '#4aa8ff'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= 80 * ue; i++) { const a = amax * i / 80, x = x0 + (x1 - x0) * i / 80; i ? ctx.lineTo(x, py(f(a))) : ctx.moveTo(x, py(f(a))); }
    ctx.stroke(); ctx.lineWidth = 1;
  }
  ctx.fillStyle = '#8b98a8'; ctx.fillText('N·m', 4, 30); ctx.fillText(ymax.toFixed(2), 4, 44);
  $('screwName').textContent = cur ? `槽 ${cur.slot + 1} 孔 ${cur.hole + 1}（中間孔先鎖）` : '尚未開始';
  for (const c of cells) {
    const s = project.screwLog.find(x => x.n === +c.dataset.n);
    c.className = !s || T < s.pre[0] ? '' : T < s.pre[1] ? 'run' : !s.fin || T < s.fin[0] ? 'pre' : T < s.fin[1] ? 'run' : 'ok';
  }
}
const named = {}; for (const e of events) (named[e.track] ||= []).push(e);
const lastNamed = (track, T) => named[track]?.findLast(e => e.start <= T + 1e-6) ?? null;
let shown = '';
function updatePanels(T) {
  const act = timeline.activity(T), last = events.filter(e => e.start <= T + 1e-6).at(-1), station = last?.station ?? 0;
  const done = T >= project.total - 1e-6;
  const key = act.map(s => s.action + s.sub).join('、') + '|' + station + '|' + done + '|' + Math.floor(T * 4);
  if (key !== shown) {
    shown = key;
    const main = act.map(s => s.action ? s : lastNamed(s.track, T)).filter(s => s && s.action);
    ui.action.textContent = main.length ? main.map(s => s.action).join('、') : done ? '完成：載台出站' : '待命';
    ui.substep.textContent = main.map(s => s.sub).filter(Boolean).join('、');
    ui.stationName.textContent = `S${station + 1} ${STATIONS[station]}`;
    ui.stations.forEach((b, i) => { b.classList.toggle('active', i === station); b.classList.toggle('done', i < station || done); });
    const seen = project.insp.filter(e => e.t <= T);
    $('inspCount').textContent = `${seen.length} 筆`;
    $('insp').innerHTML = seen.slice(-7).reverse().map(e => `<li class="${e.result === 'OK' ? 'ok' : 'ng'}"><b>${e.result}</b><span class="cam">${e.cam}</span>${e.part} · ${e.item}<em>${e.value ?? ''}</em><code>IMG-${String(Math.round(e.t * 100)).padStart(6, '0')}</code></li>`).join('');
    const hs = project.heights.filter(h => h.t <= T);
    $('heights').innerHTML = '<tr><th>槽</th><th>項目</th><th>三點（mm）</th></tr>' + hs.slice(-8).reverse().map(h => `<tr><td>${h.slot + 1}</td><td>${h.kind}<small>${h.limit}</small></td><td>${h.values.map(v => v.toFixed(3)).join(' / ')}</td></tr>`).join('');
  }
  drawTorque(T);
}

// ---------------------------------------------------------------- 播放列
const player = createPlayer({
  total: project.total,
  apply: T => { project.apply(T); },
  events: events.map(e => ({ time: e.start, label: `S${(e.station ?? 0) + 1} · ${e.action}` })),
  onChange: T => { updatePanels(T); stage.invalidate(true); },
});

// 每格繪製：相機視窗 → 主畫面
// 自動切換：停在最近一次取像事件的相機（取像之間不會跳回黑畫面）
const camEvents = events.map(e => {
  if (e.track === 'robot' && /基準點/.test(e.action)) return { t: e.start, src: 'down' };
  if (e.track === 'robot' && /^(覆拍|複檢)/.test(e.action)) return { t: e.start, src: /SOCAMM/.test(e.action) ? 'upS' : 'upI' };
  if (e.track === 'trayI' && /掃描/.test(e.action)) return { t: e.start, src: 'trayI' };
  if (e.track === 'trayS' && /檢查/.test(e.action)) return { t: e.start + .8, src: 'trayS' };
  if (e.track === 'lock' && /壓持|預鎖|終鎖/.test(e.action)) return { t: e.start, src: 'lock' };
  return null;
}).filter(Boolean).sort((a, b) => a.t - b.t);
function autoSource(T) { return camEvents.findLast(e => e.t <= T + 1e-6)?.src ?? 'trayI'; }
function render() {
  const T = player.T, id = source === 'auto' ? autoSource(T) : source, src = sources[id];
  workspace.renderCamera({ renderer, scene, camera: src.cam, title: src.title, result: ui.action.textContent, marks: { time: T } });
  workspace.renderOverview(renderer, scene);
}

setView(qp.get('view') in VIEWS ? qp.get('view') : 'iso', true);
if (qp.has('cam')) { const a = qp.get('cam').split(',').map(Number); if (a.length === 6 && a.every(Number.isFinite)) stage.goTo(a.slice(0, 3), a.slice(3), true); }
$('loading').classList.add('hide');
// 鏡頭高過 FFU（俯視、遠景）時隱藏 FFU 箱體，才看得到機台內部（只影響畫面，不影響檢查）
const ffu = scene.getObjectByName('ffu');
stage.loop(dt => { const changed = player.update(dt); workspace.follow(); stage.updateLabels(); if (ffu) ffu.visible = camera.position.y < LAY.top + 600; return changed; }, { render });

exposeSim({ seekTo: player.seekTo, setView, views: VIEWS, total: project.total, play: player.play, pause: player.pause, get T() { return player.T; }, stationStart, project });

// ---------------------------------------------------------------- 錄影（?movie）
if (qp.has('movie')) {
  const { installMovie } = await import('@core/movie/movie.js');
  installMovie({
    project: decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)),
    title: document.querySelector('.brand .title')?.textContent || document.title,
    scene, renderer, camera, controls, render, setView, total: project.total,
    steps: events.filter(e => e.track === 'robot' || e.track === 'lock' || e.track === 'conv' || e.track === 'trayI').filter((e, i, a) => !a[i - 1] || e.start - a[i - 1].start > .8),
    sample: t => { project.apply(t); updatePanels(t); },
    focus: () => (timeline.activity(player.T).some(s => s.track === 'lock') ? locker.head.getWorldPosition(V()).add(V(0, -100, 300)) : robot.tool.getWorldPosition(V()).add(V(0, -80, 0))),
    offset: [-380, 300, 520], glandShots: false, targetSeconds: 150,
  });
}
