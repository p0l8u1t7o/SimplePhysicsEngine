// 主程式：舞台＋播放列＋共用版面與相機視窗＋本站的視角、站別、即時發電面板與天色。
// 場景與每個時間點的狀態全部來自 project.js（與 core 統一檢查同一份）；這裡只負責呈現：太陽燈位、天空顏色、太陽圓盤、面板。
// 網址參數：?pause&t=秒、?view=名稱、?cam=x,y,z,tx,ty,tz、?movie。
import * as THREE from 'three';
import { createStage, exposeSim } from '@core/ui/stage.js';
import { createPlayer } from '@core/ui/player.js';
import { createViewerWorkspace } from '@core/ui/viewer-workspace.js';
import { createProject, LAYOUT, STATIONS, H, fmtHour } from './project.js';
import { ROOF } from './models.js';

const qp = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const L = LAYOUT, T = L.tower;

// ---------------------------------------------------------------- 舞台
const canvas = $('c'), R = 42000, CENTER = [0, H, 0];
const stage = createStage({
  canvas, look: 'plant', declutter: true, extent: { center: CENTER, radius: R },
  camera: { near: 100, far: 900000, fov: 42 },
  controls: { minDistance: 2500, maxDistance: R * 6 },
  fog: [R * 4, R * 14],
});
const { renderer, scene, camera, controls } = stage;
const coarse = matchMedia('(pointer: coarse), (max-width: 900px)').matches;
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.25 : 1.75));
stage.lights.sun.shadow.mapSize.setScalar(coarse ? 2048 : 4096);
const project = createProject({ scene });
let state = project.apply(0);

// 太陽圓盤（呈現用，不參與檢查）
const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(9000, 20, 12), new THREE.MeshBasicMaterial({ color: 0xfff2c4, fog: false }));
sunDisc.name = 'sun disc'; scene.add(sunDisc);

// ---------------------------------------------------------------- 相機視窗：塔樓頂監視器俯看陣列（虛擬）
const cctv = new THREE.PerspectiveCamera(58, 1.5, 200, 200000);
cctv.position.set(T.x0 + 600, ROOF + T.h + 3200, T.z1 - 400); cctv.lookAt(-6000, ROOF, 6000);

// ---------------------------------------------------------------- 共用版面：焦點追隨（◎ 追雲影）
const focusPoint = () => state.cloudShadow ? new THREE.Vector3(state.cloudShadow[0], ROOF, state.cloudShadow[1]) : null;
const workspace = createViewerWorkspace({
  camera, controls, canvas, resize: stage.resize,
  getFocus: focusPoint, focusOffset: [-22000, 20000, 28000],
  onFocus: () => { stage.cancelTween(); document.querySelectorAll('.views [data-view]').forEach(b => b.classList.remove('on')); },
});

// ---------------------------------------------------------------- 視角：[相機位置, 注視點]（照桌面寫；窄畫布由 stage 自動拉遠）
const VIEWS = {
  iso: [[-52000, H + 34000, 62000], [-2000, H, 0]],
  saw: [[-30000, H + 9000, 30000], [-4000, H + 1500, 8000]],
  rack: [[-3000, H + 9000, 6000], [-12000, H + 800, -10000]],
  inv: [[33000, H + 6500, 2500], [24800, H + 1000, -8500]],
  top: [[0, H + 105000, 10], [0, H, 0]],
};
function setView(name, instant = false) {
  const v = VIEWS[name]; if (!v) return;
  workspace.stopFollowing(); stage.goTo(v[0], v[1], instant);
  document.querySelectorAll('.views [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('.views [data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));

// ---------------------------------------------------------------- 3D 標籤
const label = (html, pos, priority = 0) => stage.addLabel(html, pos, '', { anchor: 'above', priority });
const V = (x, y, z) => new THREE.Vector3(x, y, z);
label('鋸齒屋面陣列（INV-1／INV-2）', V(-4000, ROOF + L.saw.rise + 400, 9000), 3);
label('鋼架斜置陣列（INV-3）', V(-10000, ROOF + 2400, -9200), 3);
label('塔樓', V((T.x0 + T.x1) / 2, ROOF + T.h + 300, (T.z0 + T.z1) / 2), 1);
label('變流器 ×3', V(L.invX, ROOF + L.canopy.h + 300, -8000), 2);
label('日射計', V(L.pyranometer.x, ROOF + L.pyranometer.h + 200, L.pyranometer.z), 0);
label('市電併網點（地面變壓器）', V(30300, ROOF + 2900, -12300), 2);

// ---------------------------------------------------------------- 站別按鈕
const stationBar = $('stations'), { stationStart } = project;
STATIONS.forEach((name, i) => {
  const b = document.createElement('button'); b.className = 'st'; b.dataset.st = i;
  b.innerHTML = `<span class="idx">S${i + 1}</span>${name}`; b.onclick = () => player.seekTo(stationStart[i]);
  stationBar.appendChild(b);
});

// ---------------------------------------------------------------- 面板
const tl = project.timeline, events = tl.events;
const ui = { action: $('action'), substep: $('substep'), stationName: $('stationName'), stations: [...stationBar.children] };
$('cycleTime').textContent = `一天 ${project.total.toFixed(0)} s・${project.panels.length} 片・${project.kwp.toFixed(0)} kWp`;
const checks = project.layoutChecks();
$('checks').innerHTML = checks.map(r => `<li class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✓' : '✗'} ${r.name}<span>${r.value ?? ''}</span></li>`).join('');
$('checkCount').textContent = `${checks.filter(r => r.ok).length} / ${checks.length}`;
$('invHint').textContent = `${L.inverters.length} 台・${project.invKw} kW`;
const STATE = { grid: '併網', standby: '待機', night: '停機' };

// 發電曲線：橫軸時刻 5～19 時，縱軸 kW；灰線晴空、琥珀色實際（到目前時刻為止）
const curveCanvas = $('curve'), cg = curveCanvas.getContext('2d');
function drawCurve(s) {
  const w = curveCanvas.width, h = curveCanvas.height, pad = { l: 40, r: 10, t: 12, b: 26 }, top = Math.ceil(project.invKw / 20) * 20;
  const X = hr => pad.l + (hr - 5) / 14 * (w - pad.l - pad.r), Y = kw => h - pad.b - kw / top * (h - pad.t - pad.b);
  cg.clearRect(0, 0, w, h); cg.font = '18px "Noto Sans TC","Microsoft JhengHei",sans-serif'; cg.fillStyle = '#7f93a5'; cg.strokeStyle = '#1f3040'; cg.lineWidth = 1;
  for (let kw = 0; kw <= top; kw += top / 4) { cg.beginPath(); cg.moveTo(pad.l, Y(kw)); cg.lineTo(w - pad.r, Y(kw)); cg.stroke(); cg.textAlign = 'right'; cg.fillText(kw, pad.l - 6, Y(kw) + 6); }
  cg.textAlign = 'center'; for (let hr = 6; hr <= 18; hr += 3) cg.fillText(hr + '時', X(hr), h - 4);
  const line = (key, upto, color, width) => { cg.beginPath(); let first = true; for (const p of project.curve) { if (p.t > upto) break; const x = X(p.h), y = Y(p[key]); first ? cg.moveTo(x, y) : cg.lineTo(x, y); first = false; } cg.strokeStyle = color; cg.lineWidth = width; cg.stroke(); };
  line('clear', Infinity, '#6f8396', 2);
  // 實際輸出：面積＋線
  cg.beginPath(); cg.moveTo(X(project.curve[0].h), Y(0));
  for (const p of project.curve) { if (p.t > s.t) break; cg.lineTo(X(p.h), Y(p.ac)); }
  cg.lineTo(X(s.hour), Y(s.ac)); cg.lineTo(X(s.hour), Y(0)); cg.closePath(); cg.fillStyle = 'rgba(255,176,32,.22)'; cg.fill();
  line('ac', s.t, '#ffb020', 3);
  cg.beginPath(); cg.arc(X(s.hour), Y(s.ac), 5, 0, Math.PI * 2); cg.fillStyle = '#ffd27a'; cg.fill();
}

let shown = '';
function updatePanels(T) {
  const s = state, act = tl.activity(T), last = events.filter(e => e.start <= T + 1e-6).at(-1), station = last?.station ?? 0, end = T >= project.total - 1e-6;
  const key = act.map(a => a.action).join('、') + '|' + station + '|' + end;
  if (key !== shown) {
    shown = key;
    ui.action.textContent = act.length ? act.map(a => a.action).join('、') : end ? '完成：今日發電結束' : '待命';
    ui.substep.textContent = act.map(a => a.sub).filter(Boolean).join('、');
    ui.stationName.textContent = `S${station + 1} ${STATIONS[station]}`;
    ui.stations.forEach((b, i) => { b.classList.toggle('active', i === station); b.classList.toggle('done', i < station || end); });
  }
  const el = s.sun.el * 180 / Math.PI;
  $('mHour').textContent = fmtHour(s.hour);
  $('mSun').textContent = el > 0 ? `${el.toFixed(0)}°` : '地平線下';
  $('mPoa').textContent = `${Math.round(s.ref)} W/m²`;
  $('mAc').textContent = `${s.ac.toFixed(1)} kW`;
  $('mE').textContent = `${s.energy.toFixed(0)} kWh`;
  $('mShade').textContent = `${s.shaded} / ${project.panels.length}`;
  $('invList').innerHTML = s.inv.map((v, i) => {
    const d = L.inverters[i];
    return `<li class="${v.state}"><b>${d.id}</b><span>${d.src}・${project.invKwp[i].toFixed(0)} kWp</span><em>${STATE[v.state]}${v.state === 'grid' ? ' ' + v.ac.toFixed(1) + ' kW' : ''}</em><div class="bar"><i style="width:${(v.ac / d.kw * 100).toFixed(1)}%"></i></div></li>`;
  }).join('');
  drawCurve(s);
}

// ---------------------------------------------------------------- 天色：太陽燈位、亮度、天空與霧的顏色
// 環境光（stage 的 RoomEnvironment）在室外場景太強，會洗掉陰影對比；本頁逐材質壓低並隨天色變化（three r160 沒有 scene.environmentIntensity）
const envMats = new Set(); scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if ('envMapIntensity' in m) envMats.add(m); });
const SKY = { night: new THREE.Color(0x0b1422), dusk: new THREE.Color(0xc98a62), day: new THREE.Color(0xa9c2db) }, sky = new THREE.Color(), warm = new THREE.Color();
const c01 = v => Math.max(0, Math.min(1, v));
function applySky() {
  const { el, dir } = state.sun, d = c01(Math.sin(el) * 2.4), s = stage.lights.sun;
  const dy = Math.max(dir[1], .06), k = Math.hypot(dir[0], dir[2]) || 1, f = Math.sqrt(1 - dy * dy) / k;
  const D = [dir[0] * f, dy, dir[2] * f];
  s.position.set(CENTER[0] + D[0] * R * 2.2, CENTER[1] + D[1] * R * 2.2, CENTER[2] + D[2] * R * 2.2); s.target.position.set(...CENTER); s.target.updateMatrixWorld();
  s.intensity = el > 0 ? .2 + 2.9 * d : .02;
  s.color.copy(warm.setHSL(.09, .9, .62)).lerp(new THREE.Color(0xffffff), c01(Math.sin(el) * 3));
  const day = c01((el + .1) / .4);
  if (stage.lights.hemi) stage.lights.hemi.intensity = .16 + .2 * day;
  if (stage.lights.fill) stage.lights.fill.intensity = .04 + .16 * d;
  for (const m of envMats) m.envMapIntensity = .08 + .1 * day;
  sky.copy(SKY.night).lerp(SKY.dusk, c01((el + .1) / .14)).lerp(SKY.day, c01((el - .03) / .22));
  scene.background.copy(sky); if (scene.fog) scene.fog.color.copy(sky);
  sunDisc.visible = el > -.03; sunDisc.position.set(dir[0] * 420000, dir[1] * 420000 + H, dir[2] * 420000);
  sunDisc.material.color.setHSL(.12, 1, .6 + .3 * c01(Math.sin(el) * 3));
}

// ---------------------------------------------------------------- 播放列
const player = createPlayer({
  total: project.total,
  apply: T => { state = project.apply(T); applySky(); },
  events: events.map(e => ({ time: e.start, label: `S${e.station + 1} · ${fmtHour(tl.sample(e.start).day.h)} ${e.action}` })),
  onChange: T => { updatePanels(T); stage.invalidate(true); },
});
applySky();

function render() {
  workspace.renderCamera({ renderer, scene, camera: cctv, title: '塔樓頂監視器（虛擬）', result: `${fmtHour(state.hour)}・${state.ac.toFixed(1)} kW`, marks: { time: player.T } });
  workspace.renderOverview(renderer, scene);
}

setView(qp.get('view') in VIEWS ? qp.get('view') : 'iso', true);
if (qp.has('cam')) { const a = qp.get('cam').split(',').map(Number); if (a.length === 6 && a.every(Number.isFinite)) stage.goTo(a.slice(0, 3), a.slice(3), true); }
$('loading').classList.add('hide');
// 相機在雲層上方（俯視）時把雲調淡，看得到雲影；陰影照常投射
const cloudMats = []; scene.getObjectByName('cloud').traverse(o => { if (o.isMesh) cloudMats.push(o.material); });
function cloudFade() { const k = camera.position.y > L.cloud.y - 3000 ? .18 : .9; for (const m of cloudMats) m.opacity = k; }
stage.loop(dt => { const changed = player.update(dt); workspace.follow(); stage.updateLabels(); cloudFade(); return changed; }, { render });

exposeSim({ seekTo: player.seekTo, setView, views: VIEWS, total: project.total, play: player.play, pause: player.pause, get T() { return player.T; }, get state() { return state; }, stationStart, project, stage });

// ---------------------------------------------------------------- 錄影（?movie）
if (qp.has('movie')) {
  const { installMovie } = await import('@core/movie/movie.js');
  installMovie({
    project: decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)),
    title: document.querySelector('.brand .title')?.textContent || document.title,
    scene, renderer, camera, controls, render, setView, total: project.total, steps: events,
    sample: t => { state = project.apply(t); applySky(); updatePanels(t); },
    focus: () => focusPoint() || new THREE.Vector3(-2000, ROOF, 0),
    offset: [-26000, 22000, 32000],
  });
}
