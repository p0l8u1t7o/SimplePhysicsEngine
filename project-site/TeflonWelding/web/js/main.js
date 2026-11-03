// 主程式：舞台＋播放列＋共用版面與相機視窗＋本專案的方案切換、剖切、視角、站別與面板。
// 場景與每個時間點的狀態全部來自 project.js（與 core 統一檢查同一份）。網址參數：?plan=roll|turntable|cobot、?look=xray|cut|solid（預設透視）
// 生產時是完整的桶，手臂只從人孔進出；透視（桶身半透明）與剖切（同切半展示品）只是觀看方式。
import * as THREE from 'three';
import { createStage, exposeSim } from '@core/ui/stage.js';
import { createPlayer } from '@core/ui/player.js';
import { createViewerWorkspace } from '@core/ui/viewer-workspace.js';
import { createProject, STATIONS, PLANS } from './project.js';
import { PROCESS, SEAMS, HOT_AIR, TANK, NECK_CLEAR, FIELD, TOOLS, cycleEstimate, seamLength } from './spec.js';

const qp = new URLSearchParams(location.search), movie = qp.has('movie');
const $ = id => document.getElementById(id);
const planKey = PLANS[qp.get('plan')] ? qp.get('plan') : 'roll';

// ---------------------------------------------------------------- 舞台
const canvas = $('c');
const stage = createStage({
  canvas, look: 'cell', extent: { center: [-1000, 1200, 0], radius: 5200 }, declutter: true,
  camera: { near: 10, far: 60000 }, controls: { minDistance: 300, maxDistance: 22000 },
});
const { renderer, scene, camera, controls } = stage;
renderer.localClippingEnabled = true;
const project = createProject({ scene, plan: planKey });
const { timeline, stationStart, meta, plan } = project;
const LOOKS = { xray: '透視（完整桶）', cut: '剖切（示意）', solid: '不透明' };
let look = LOOKS[qp.get('look')] ? qp.get('look') : 'xray';
project.setLook(look);

// ---------------------------------------------------------------- 共用版面
const workspace = createViewerWorkspace({
  camera, controls, canvas, resize: stage.resize,
  getFocus: () => project.focus(), focusOffset: [700, 900, 1300],
  onFocus: () => { stage.cancelTween(); document.querySelectorAll('.views [data-view]').forEach(b => b.classList.remove('on')); },
});

// ---------------------------------------------------------------- 視角
const VIEWS = plan.views;
function setView(name, instant = false) {
  const v = typeof VIEWS[name] === 'function' ? VIEWS[name]() : VIEWS[name]; if (!v) return;
  workspace.stopFollowing();
  stage.goTo(v[0], v[1], instant);
  document.querySelectorAll('.views [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('.views [data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));

// ---------------------------------------------------------------- 3D 標籤
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const label = (html, pos, priority = 0) => stage.addLabel(html, pos, '', { anchor: 'above', priority });
const frameAt = (x, y, z) => () => project.tank.frame.localToWorld(V(x, y, z));
label('1000L 襯 PTFE 桶', frameAt(0, TANK.manway.top + 80, 0), 3);
label(`人孔（襯後內徑 ${Math.round(NECK_CLEAR * 2)}）`, frameAt(TANK.manway.flangeR, TANK.manway.top, 0), 1);
label(meta.arm === 'vs068' ? 'DENSO VS-068' : 'DENSO COBOTTA PRO 900', () => project.arm.root.getWorldPosition(V(0, 0, 0)).add(V(0, 260, 0)), 4);
label(`工具架（${TOOLS.length} 支工具）`, () => project.plan.rackRoot.children.find(c => c.name === 'rack-shelf')?.getWorldPosition(V(0, 0, 0)).add(V(0, 420, 0)) ?? V(0, 0, 0), 2);
label('電控櫃・熱風控制・兆赫波主機', () => plan.periphery.group.localToWorld(V(700, 2050, 0)), 1);
if (meta.key === 'roll') { label('開合式雙環迴轉架', V(150, 2000, 0), 3); label('懸吊 X 軸＋伸臂', V(-3300, 3050, 0), 2); }
if (meta.key === 'turntable') { label('立式轉台', V(0, 420, 900), 3); label('立柱懸臂（上下＋伸縮）', V(-3500, 5550, -650), 2); }
if (meta.key === 'cobot') { label('移動式門架（X 橫移＋Z 伸縮柱）', V(-700, 5900, 0), 3); }
label('焊點', () => project.focus(), 2);

// ---------------------------------------------------------------- 站別按鈕
const stationBar = $('stations');
STATIONS.forEach((name, i) => {
  const b = document.createElement('button'); b.className = 'st'; b.dataset.st = i;
  b.innerHTML = `<span class="idx">S${i + 1}</span>${name}`; b.onclick = () => player.seekTo(stationStart[i]);
  stationBar.appendChild(b);
});

// ---------------------------------------------------------------- 方案切換（重新載入）與剖切
const reload = (k, v) => { const q = new URLSearchParams(location.search); q.set(k, v); ['t', 'time', 'step', 'st'].forEach(x => q.delete(x)); location.search = q.toString(); };
$('plans').innerHTML = Object.values(PLANS).map(p => `<button data-plan="${p.key}" class="${p.key === planKey ? 'on' : ''}">${p.name}</button>`).join('');
$('plans').querySelectorAll('button').forEach(b => b.onclick = () => b.dataset.plan !== planKey && reload('plan', b.dataset.plan));
$('planDesc').textContent = meta.method;
$('planPros').innerHTML = meta.pros.map(s => `<li class="pro">＋ ${s}</li>`).join('') + meta.cons.map(s => `<li class="con">－ ${s}</li>`).join('');
$('specLine').textContent = `焊接位置：${meta.pose}・熱風 ${HOT_AIR.temp} °C（${HOT_AIR.gun}）・拖嘴約 ${HOT_AIR.drag} mm`;
const lookBox = $('looks');
lookBox.innerHTML = Object.entries(LOOKS).map(([k, n]) => `<button data-look="${k}">${n}</button>`).join('');
const setLook = k => { look = k; project.setLook(k); project.apply(player.T); stage.invalidate(true); syncLook(); };
const syncLook = () => lookBox.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.look === look));
lookBox.querySelectorAll('button').forEach(b => b.onclick = () => setLook(b.dataset.look));
syncLook();

// 工時估算
const est = cycleEstimate();
$('estimate').innerHTML = `<table><tr><th>製程</th><th>工時</th></tr>${est.rows.map(r => `<tr><td>${r.name}</td><td>${r.min.toFixed(0)} 分</td></tr>`).join('')}<tr class="sum"><td>合計（含上下料 20 分）</td><td>${(est.sum / 60).toFixed(1)} 小時</td></tr></table>
<div class="note">焊道總長 ${est.metres.toFixed(2)} m（環縫 2 × ${(seamLength(SEAMS[1]) / 1000).toFixed(2)} m＋縱縫 ${(seamLength(SEAMS[0]) / 1000).toFixed(2)} m）；速度為假設值，以試焊決定</div>`;

// ---------------------------------------------------------------- 面板
const events = timeline.events;
const ui = { action: $('action'), substep: $('substep'), stationName: $('stationName'), stations: [...stationBar.children] };
$('cycleTime').textContent = `動畫 ${Math.round(project.total)} s（實際約 ${(est.sum / 60).toFixed(1)} h／桶）`;
const checks = project.layoutChecks?.() || [];
project.apply(0);
$('checks').innerHTML = checks.map(r => `<li class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✓' : '✗'} ${r.name}<span>${r.value ?? ''}</span></li>`).join('');
$('checkCount').textContent = `${checks.filter(r => r.ok).length} / ${checks.length}`;
// 焊道狀態：每道焊道 × 每道製程的進度
const seamBox = $('seams');
seamBox.innerHTML = `<table><tr><th></th>${PROCESS.map(p => `<th>${p.name.replace(' ', '').slice(0, 2)}</th>`).join('')}</tr>${SEAMS.map(s => `<tr data-seam="${s.id}"><td>${s.name}</td>${PROCESS.map(p => `<td><i data-p="${p.key}"></i></td>`).join('')}</tr>`).join('')}</table>`;
let shown = '';
function updatePanels(T) {
  const act = timeline.activity(T).filter(s => s.action), last = events.filter(e => e.start <= T + 1e-6).at(-1), station = last?.station ?? 0;
  const key = act.map(s => s.action).join('、') + '|' + (last?.sub ?? '') + '|' + station + '|' + (T >= project.total - 1e-6);
  if (key !== shown) {
    shown = key;
    ui.action.textContent = act.length ? act.map(s => s.action).join('、') : T >= project.total - 1e-6 ? '完成' : last?.action ?? '待命';
    ui.substep.textContent = act.map(s => s.sub).filter(Boolean).join('、') || last?.sub || '';
    ui.stationName.textContent = `S${station + 1} ${STATIONS[station]}`;
    ui.stations.forEach((b, i) => { b.classList.toggle('active', i === station); b.classList.toggle('done', i < station || T >= project.total - 1e-6); });
  }
  const st = timeline.sample(T);
  for (const s of SEAMS) for (const p of PROCESS) {
    const v = st['seam-' + s.id][FIELD[p.key]], el = seamBox.querySelector(`tr[data-seam="${s.id}"] i[data-p="${p.key}"]`);
    el.style.setProperty('--v', v); el.className = v >= 1 ? 'done' : v > 0 ? 'run' : '';
  }
  $('defect').hidden = !(st['seam-C2'].i >= .62);
}

// ---------------------------------------------------------------- 播放列
const player = createPlayer({
  total: project.total,
  apply: T => project.apply(T),
  events: events.map(e => ({ time: e.start, label: `S${e.station + 1} · ${e.action}` })),
  onChange: T => { updatePanels(T); stage.invalidate(true); },
  qp: movie ? new URLSearchParams(qp + '&pause') : qp, speeds: [.25, 4, .25], speed: 1,
});

// 相機視窗：焊點特寫（跟著 TCP，從桶軸方向看焊點）
const weldCam = new THREE.PerspectiveCamera(38, 1.5, 10, 6000);
function aimWeldCam() {
  const tcp = project.focus(), f = project.tank.frame, axis = f.localToWorld(V(0, 0, 0)).sub(f.localToWorld(V(0, 1, 0))).normalize();
  const p = project.tank.frame.worldToLocal(tcp.clone()), radial = f.localToWorld(V(p.x, p.y, p.z)).sub(f.localToWorld(V(0, p.y, 0))).normalize();
  weldCam.position.copy(tcp).addScaledVector(radial, -330).addScaledVector(axis, -260);
  weldCam.up.copy(axis.clone().negate()); weldCam.lookAt(tcp);
}
function render() {
  aimWeldCam();
  workspace.renderCamera({ renderer, scene, camera: weldCam, title: '焊點特寫（桶內）', result: ui.action.textContent, marks: { time: player.T } });
  workspace.renderOverview(renderer, scene);
}

setView(qp.get('view') in VIEWS ? qp.get('view') : 'iso', true);
if (qp.has('cam')) { const a = qp.get('cam').split(',').map(Number); if (a.length === 6 && a.every(Number.isFinite)) stage.goTo(a.slice(0, 3), a.slice(3), true); }
$('loading').classList.add('hide');
stage.loop(dt => { const changed = player.update(dt); workspace.follow(); stage.updateLabels(); return changed; }, { render });

exposeSim({ seekTo: player.seekTo, setView, views: VIEWS, total: project.total, play: player.play, pause: player.pause, get T() { return player.T; }, stationStart, project, setLook });

// ---------------------------------------------------------------- 錄影（?movie：core/movie 依時間軸步驟運鏡）
if (movie) {
  const { installMovie } = await import('@core/movie/movie.js');
  installMovie({
    project: decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)),
    title: `${document.querySelector('.brand .title')?.textContent || document.title} · ${meta.name}`,
    scene, renderer, camera, controls, render, setView, total: project.total, steps: events.map(e => ({ ...e, text: e.action })),
    sample: t => { project.apply(t); updatePanels(t); },
    focus: () => project.focus(),
    offset: [900, 1100, 1500],
  });
}
