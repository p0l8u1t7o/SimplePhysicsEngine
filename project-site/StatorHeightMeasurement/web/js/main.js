// 主程式：舞台＋播放列＋共用版面與相機視窗＋本專案的方案切換、視角、站別與量測面板。
// 場景與每個時間點的狀態全部來自 project.js（與 core 統一檢查同一份）。網址參數：?plan=box-laser|box-vision|piece-laser|piece-vision&part=stator|rotor
import * as THREE from 'three';
import { createStage, exposeSim } from '@core/ui/stage.js';
import { createPlayer } from '@core/ui/player.js';
import { createViewerWorkspace } from '@core/ui/viewer-workspace.js';
import { createProject, LAYOUT, PLANS, PARTS } from './project.js';
import { QB } from './qc-box.js';
import { QP } from './qc-piece.js';
import { RATE, slot } from './spec.js';
import { drawMeasurement } from './measurement-view.js';

const qp = new URLSearchParams(location.search), movie = qp.has('movie');
const $ = id => document.getElementById(id);
const planKey = PLANS[qp.get('plan')] ? qp.get('plan') : 'box-laser', partKey = PARTS[qp.get('part')] ? qp.get('part') : 'stator';

// ---------------------------------------------------------------- 舞台
const canvas = $('c');
const stage = createStage({
  canvas, look: 'plant', extent: { center: [0, 800, 0], radius: 9800 }, declutter: true,
  camera: { near: 10, far: 60000 }, controls: { minDistance: 300, maxDistance: 26000 },
});
const { renderer, scene, camera, controls } = stage;
const project = createProject({ scene, plan: planKey, part: partKey });
const { timeline, stationStart, STATIONS, plan, part, cap } = project;
const S = LAYOUT.qc.station, U = LAYOUT.unloader;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- 共用版面
const workspace = createViewerWorkspace({
  camera, controls, canvas, resize: stage.resize,
  getFocus: () => project.focus(player.T), focusOffset: [-1400, 1100, 1700],
  onFocus: () => { stage.cancelTween(); document.querySelectorAll('.views [data-view]').forEach(b => b.classList.remove('on')); },
});

// ---------------------------------------------------------------- 視角
const VIEWS = {
  iso: [[300, 7600, 12800], [300, 300, 0]],
  unloader: [[-7400, 2500, 3100], [-5100, 950, 900]],
  pit: [[-4600, 2900, 3300], [-6300, 0, 600]],
  qc: [[S.x + 2700, 2900, S.z - 2700], [S.x, 1000, S.z]],
  measure: plan.mode === 'box' ? [[S.x + 1600, 1800, S.z + 500], [S.x, 1030, S.z - 250]] : [[S.x + 1250, 1850, S.z - 700], [S.x - 80, 960, S.z + 120]],
  scara: [[-6300, 1800, 2100], [-5200, 950, 900]],
  aligner: [[-5950, 1300, 650], [-5180, 955, 420]],
  top: [[0, 17000, 300], [0, 0, 0]],
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
label('沖壓機（既有）', V(LAYOUT.press.x, LAYOUT.press.h + 100, LAYOUT.press.z + 600), 1);
label('6 列出料滑道（散料）', V(LAYOUT.press.x - 300, LAYOUT.lane.y + 60, 0), 2);
label('整列單元：導正＋擋銷分料＋定位座', V(LAYOUT.press.x + 260, LAYOUT.lane.y + 80, LAYOUT.lane.z1 - 40), 3);
label('定位座相機（雙重保險）', V(LAYOUT.press.x, 1900, 520), 2);
label('SCARA 下料擺盒', V(U.scara.x, 1700, U.scara.z), 4);
label('空盒 → 擺盒 → 滿盒', V(U.slots[1], 1000, U.conveyor.z + 200), 2);
label('廢料坑蓋板（可掀）', V(-6600, 80, 1800), 1);
label('落料網格', V(-6600, 60, 75), 1);
label('品檢區（離沖壓機 10 m）', V(LAYOUT.qc.x0 + 900, 2600, LAYOUT.qc.z1 - 300), 2);
if (plan.mode === 'box') {
  label('翻轉臂', V(S.x + QB.arm, QB.hinge + 260, S.z + 200), 3);
  label('基準板座', () => project.station.holder.getWorldPosition(new THREE.Vector3()).add(V(0, 160, 0)), 3);
  label(plan.sensor === 'vision' ? '遠心相機（懸臂龍門）' : '線雷射（懸臂龍門）', () => project.station.tool.getWorldPosition(new THREE.Vector3()).add(V(0, 260, 0)), 3);
  label('花崗岩＋隔振腳', V(S.x - 300, 860, S.z - 500), 1);
  label('NG 盒', V(S.x + QB.bin.x, QB.bin.top + 40, S.z + QB.bin.z), 1);
} else {
  label('SCARA 逐顆取放', V(S.x + QP.scara.x, 1700, S.z + QP.scara.z), 3);
  label('量測砧', V(S.x + QP.anvil.x, QP.anvil.top + 140, S.z + QP.anvil.z), 3);
  label('入料盒', V(S.x + QP.inBox.x, 1100, S.z + QP.inBox.z), 2);
  label('出料盒（OK）', V(S.x + QP.outBox.x, 1100, S.z + QP.outBox.z), 2);
  label('NG 滑槽', V(S.x + QP.ng.x, 900, S.z + 560), 1);
}

// ---------------------------------------------------------------- 站別按鈕
const stationBar = $('stations');
STATIONS.forEach((name, i) => {
  const b = document.createElement('button'); b.className = 'st'; b.dataset.st = i;
  b.innerHTML = `<span class="idx">S${i + 1}</span>${name}`; b.onclick = () => player.seekTo(stationStart[i]);
  stationBar.appendChild(b);
});

// ---------------------------------------------------------------- 方案與工件切換（重新載入）
const reload = (k, v) => { const q = new URLSearchParams(location.search); q.set(k, v); ['t', 'time', 'step', 'st'].forEach(x => q.delete(x)); location.search = q.toString(); };
$('plans').innerHTML = Object.values(PLANS).map(p => `<button data-plan="${p.key}" class="${p.key === planKey ? 'on' : ''}">${p.name}</button>`).join('');
$('plans').querySelectorAll('button').forEach(b => b.onclick = () => b.dataset.plan !== planKey && reload('plan', b.dataset.plan));
$('parts').innerHTML = Object.values(PARTS).map(p => `<button data-part="${p.key}" class="${p.key === partKey ? 'on' : ''}">${p.name}</button>`).join('');
$('parts').querySelectorAll('button').forEach(b => b.onclick = () => b.dataset.part !== partKey && reload('part', b.dataset.part));
$('planDesc').textContent = plan.method;
$('specLine').textContent = `高度 ${part.h} +${part.tolP}/−${part.tolN} mm・每盒 ${cap} 顆（${part.grid.rows} 列 × ${part.grid.cols}）・沖壓 ${RATE.perMin} 顆／分`;

// ---------------------------------------------------------------- 面板
const events = timeline.events;
const ui = { action: $('action'), substep: $('substep'), stationName: $('stationName'), stations: [...stationBar.children] };
$('cycleTime').textContent = `量測 ${plan.mode === 'box' ? `每盒 ${(project.cycleQc / 60).toFixed(1)} 分` : `每顆 ${(project.cycleQc / cap).toFixed(2)} s`}`;
const checks = project.layoutChecks?.() || [];
$('checks').innerHTML = checks.map(r => `<li class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✓' : '✗'} ${r.name}<span>${r.value ?? ''}</span></li>`).join('');
$('checkCount').textContent = `${checks.filter(r => r.ok).length} / ${checks.length}`;
let shown = '';
function updatePanels(T) {
  const act = timeline.activity(T).filter(s => s.action), last = events.filter(e => e.start <= T + 1e-6).at(-1), station = last?.station ?? 0;
  const key = act.map(s => s.action).join('、') + '|' + (last?.sub ?? '') + '|' + station + '|' + (T >= project.total - 1e-6);
  if (key !== shown) {
    shown = key;
    ui.action.textContent = act.length ? act.map(s => s.action).join('、') : last?.action ?? '待命';
    ui.substep.textContent = act.map(s => s.sub).filter(Boolean).join('、') || last?.sub || '';
    ui.stationName.textContent = `S${station + 1} ${STATIONS[station]}`;
    ui.stations.forEach((b, i) => { b.classList.toggle('active', i === station); b.classList.toggle('done', i < station || T >= project.total - 1e-6); });
  }
  drawResults(T);
}

// 量測結果格位圖（側欄與相機視窗共用）：灰＝未量、綠＝OK、紅＝NG、亮框＝正在量
const grid = $('grid'), gctx = grid.getContext('2d');
function drawGrid(ctx, w, h, T, big = false) {
  const m = project.measured(T), g = part.grid, pad = big ? 30 : 8, top = big ? 62 : 8;
  const cw = (w - pad * 2) / g.cols, ch = (h - top - pad) / g.rows;
  ctx.fillStyle = '#0f1820'; ctx.fillRect(0, 0, w, h);
  let ok = 0, ng = 0;
  for (let i = 0; i < cap; i++) {
    const r = Math.floor(i / g.cols), c = i % g.cols, x = pad + c * cw, y = top + r * ch, R = project.results[i];
    const has = m.has(i);
    if (has) R.ng ? ng++ : ok++;
    ctx.fillStyle = !has ? '#2a3742' : R.ng ? '#ff4d4d' : '#3dd68c';
    ctx.fillRect(x + 1, y + 1, cw - 2, ch - 2);
    if (i === m.current) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = big ? 3 : 2; ctx.strokeRect(x + 1, y + 1, cw - 2, ch - 2); }
  }
  if (big) {
    ctx.fillStyle = '#e6edf3'; ctx.font = 'bold 22px "Noto Sans TC","Microsoft JhengHei",sans-serif';
    const cur = m.current >= 0 ? project.results[m.current] : null;
    ctx.fillText(cur ? `第 ${slot(part, cur.i).r + 1} 列第 ${slot(part, cur.i).c + 1} 顆：${cur.h.toFixed(3)} mm ${cur.ng ? 'NG' : 'OK'}` : `已量 ${m.count} / ${cap}`, pad, 30);
    ctx.font = '16px "Noto Sans TC","Microsoft JhengHei",sans-serif'; ctx.fillStyle = '#8b98a8';
    ctx.fillText(`OK ${ok}　NG ${ng}　規格 ${(part.h - part.tolN).toFixed(2)}～${(part.h + part.tolP).toFixed(2)} mm`, pad, 52);
  }
  return { ok, ng, m };
}
let lastKey = '';
function drawResults(T) {
  const m = project.measured(T), key = `${m.count}|${m.current}`;
  if (key === lastKey) return; lastKey = key;
  const { ok, ng } = drawGrid(gctx, grid.width, grid.height, T);
  const cur = m.current >= 0 ? project.results[m.current] : null;
  $('resultLine').innerHTML = `已量 <b>${m.count}</b> / ${cap}　<span class="okc">OK ${ok}</span>　<span class="ngc">NG ${ng}</span>` + (cur ? `<br>目前 ${cur.h.toFixed(3)} mm ${cur.ng ? '<span class="ngc">NG</span>' : '<span class="okc">OK</span>'}` : '');
  // 品檢站人機：同一張格位圖
  project.station.enc.panel.draw((ctx, c) => { drawGrid(ctx, c.width, c.height, T, true); });
  project.unloader.panel.draw((ctx, c) => {
    ctx.fillStyle = '#0f1820'; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = '#e6edf3';
    ctx.font = 'bold 54px "Noto Sans TC","Microsoft JhengHei",sans-serif'; ctx.fillText('自動下料 運轉中', 40, 110);
    ctx.font = '40px "Noto Sans TC","Microsoft JhengHei",sans-serif'; ctx.fillStyle = '#8bd4ed';
    ctx.fillText(`${part.name}・${RATE.perMin} 顆／分`, 40, 200); ctx.fillText(`配方：吸盤 ${partKey === 'rotor' ? 'Ø14' : 'Ø9'}・格位 ${part.grid.rows}×${part.grid.cols}`, 40, 270);
  });
}

// ---------------------------------------------------------------- 播放列
const player = createPlayer({
  total: project.total,
  apply: T => project.apply(T),
  events: events.map(e => ({ time: e.start, label: `S${e.station + 1} · ${e.action}` })),
  onChange: T => { updatePanels(T); stage.invalidate(true); },
  qp: movie ? new URLSearchParams(qp + '&pause') : qp, speeds: [.25, 4, .25], speed: 1,
});

// 相機視窗：量測畫面（格位圖＋目前量值）
// 相機視窗：定位座相機（下料：確認工件位置與方向）／量測結果格位圖；「自動」時品檢開始前看定位座相機
let source = 'auto';
workspace.setSources([{ id: 'nest', label: '定位座相機（下料）' }, { id: 'grid', label: '量測結果' }], { onChange: v => { source = v; } });
const nestCam = project.press.aligner.cam.camera;
function render() {
  const show = source === 'auto' ? (player.T < project.t0 ? 'nest' : 'grid') : source;
  if (show === 'nest') workspace.renderCamera({ renderer, scene, camera: nestCam, title: '定位座相機：確認 6 個定位座的位置與方向', result: '偏差回饋給手臂；光纖到位＋方向感測為主、相機為輔', aspect: 2.4, marks: { time: player.T } });
  else workspace.renderImage({ draw: (ctx, w, h) => drawMeasurement(ctx, w, h, player.T, project, drawGrid), title: `${plan.name}・模擬量測`, result: ui.action.textContent, aspect: 1.6, time: player.T });
  workspace.renderOverview(renderer, scene);
}

setView(qp.get('view') in VIEWS ? qp.get('view') : 'iso', true);
if (qp.has('cam')) { const a = qp.get('cam').split(',').map(Number); if (a.length === 6 && a.every(Number.isFinite)) stage.goTo(a.slice(0, 3), a.slice(3), true); }
$('loading').classList.add('hide');
stage.loop(dt => { const changed = player.update(dt); workspace.follow(); stage.updateLabels(); return changed; }, { render });

exposeSim({ seekTo: player.seekTo, setView, views: VIEWS, total: project.total, play: player.play, pause: player.pause, get T() { return player.T; }, stationStart, project });

if (movie) {
  const { installMovie } = await import('@core/movie/movie.js');
  installMovie({
    project: decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)),
    title: document.querySelector('.brand .title')?.textContent || document.title,
    scene, renderer, camera, controls, render, setView, total: project.total, steps: timeline.events, far: true,
    sample: t => { project.apply(t); updatePanels(t); },
    focus: () => project.focus(player.T), offset: [-1600, 1300, 2000],
  });
}
