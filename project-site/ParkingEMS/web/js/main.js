// 主程式：舞台（core/ui/stage.js）＋播放列（core/ui/player.js）＋共用版面與相機視窗（core/ui/viewer-workspace.js）＋本站的視角、站別與面板。
// 場景與每個時間點的狀態全部來自 project.js，與 core 統一檢查用的是同一份。
// 網址參數：?site=flagship｜mixed｜urban（場型）、?pause&t=秒、?view=名稱、?cam=x,y,z,tx,ty,tz、?movie。
// 相機視窗：EMS 全天調度畫面（2D）、充電區監視器或入口車辨（虛擬 3D）。
import * as THREE from 'three';
import { createStage, exposeSim } from '@core/ui/stage.js';
import { createPlayer } from '@core/ui/player.js';
import { createViewerWorkspace } from '@core/ui/viewer-workspace.js';
import { createProject, daylight, fmtHour } from './project.js';
import { SITES, SITE_IDS, COMPARE, STALL } from './sites.js';
import { PERIOD_NAME, PERIOD_BANDS, DT, STEPS } from './energy.js';
import { gateGeom } from './lot.js';
import { createLprOverlay } from './lpr-overlay.js';
import { createOutdoorLighting } from './outdoor-lighting.js';
import { loadCinematicAssets } from './cinematic-assets.js';
import { createCinematicRenderer } from './cinematic-renderer.js';

const qp = new URLSearchParams(location.search);
const renderQuality=qp.get('quality')==='low'?'low':qp.get('quality')==='high'?'high':matchMedia('(pointer: coarse), (max-width: 900px)').matches?'low':'high';
const $ = id => document.getElementById(id);
const siteId = SITE_IDS.includes(qp.get('site')) ? qp.get('site') : 'flagship', SITE = SITES[siteId], L = SITE.lot;

// ---------------------------------------------------------------- 舞台
const canvas = $('c');
const cx = (L.x0 + SITE.yard.x1) / 2, cz = (L.z0 + SITE.street.z0) / 2, R = Math.hypot(SITE.yard.x1 - L.x0, SITE.street.z0 - L.z0) / 2;
const stage = createStage({
  canvas, look: 'plant', declutter:true, extent: { center: [cx, 0, cz], radius: R * 1.15 },
  controls: { minDistance: 3000, maxDistance: R * 7 },
  fog: [R * 3, R * 12],
  camera: { near: 50, far: 1500000, fov: 45 },
});
const { renderer, scene, camera, controls } = stage;
renderer.setPixelRatio(Math.min(devicePixelRatio,renderQuality==='high'?1.5:1));
stage.lights.sun.shadow.mapSize.setScalar(renderQuality==='high'?4096:1024);
const project = createProject({ scene, site: siteId });
const assetStatus=await loadCinematicAssets(scene,renderer,renderQuality);
if(assetStatus.failures.length){const warning=document.createElement('div');warning.className='asset-warning';warning.textContent='部分材質未載入，已使用基本外觀；重新整理可重試。';document.body.append(warning);console.warn('ParkingEMS assets unavailable',assetStatus.failures);}
const outdoor = createOutdoorLighting({scene,renderer,radius:R,center:[cx,cz],environment:assetStatus.environment});
const cinema=createCinematicRenderer({renderer,scene,camera,quality:renderQuality,useLog:stage.useLog});
const cinemaOverview={render:()=>cinema.render()};
const { stationStart, seq } = project;
document.title = `${SITE.name} · 停車場光儲充能源服務 — 3D 展示`;

// ---------------------------------------------------------------- 共用版面：精簡版面、相機視窗、焦點追隨（◎ 追客戶車輛）
const heroPos = () => project.hero.root.visible ? project.hero.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 900, 0)) : null;
const workspace = createViewerWorkspace({
  camera, controls, canvas, resize: stage.resize,
  getFocus: heroPos, focusOffset: [9000, 7000, 11000],
  onFocus: () => { stage.cancelTween(); document.querySelectorAll('.views [data-view]').forEach(b => b.classList.remove('on')); },
});
workspace.setSources([{ id: 'ems', label: 'EMS 調度畫面' }, { id: 'cctv', label: '充電區監視器（虛擬）' }, {id:'lpr',label:'入口車辨（虛擬）'}], { auto: false });

// ---------------------------------------------------------------- 視角（照桌面寫；窄畫布由 stage 自動拉遠）
const G = gateGeom(SITE), heroCh = project.chargers.find(k => k.c.id === seq.hero.chId), hs = heroCh.c.stall;
const yardC = [(SITE.yard.x0 + SITE.yard.x1) / 2, 0, (SITE.yard.z0 + SITE.yard.z1) / 2];
const chargingOffset = [Math.sign(project.details.portStand.x-hs.x)*6500,3400,-hs.dir*8500];
const energyOffset = siteId==='urban'?[4500,8000,6500]:[7500,10000,11000];
const VIEWS = {
  iso: siteId==='urban'?[[cx-R*.7,R*1.05,cz+R*.6],[cx,0,cz-R*.2]]:[[cx + R * .4, R * 1.05, cz + R * .85], [cx, 0, cz - R * .05]],
  gate: [[G.xc + 14000, siteId==='mixed'?11000:8000, SITE.entrance.zGate + (siteId==='mixed'?14000:19000)], [G.xc + 2000, 800, SITE.entrance.zGate - 3000]],
  energy: [[yardC[0]+energyOffset[0],energyOffset[1],yardC[2]+energyOffset[2]], [yardC[0], 900, yardC[2]],siteId==='urban'?{fit:(f,v)=>v.set(v.x,v.y*f,v.z*f)}:{}],
  // 從車道側斜看車頭與充電樁正面，讓螢幕和操作姿勢同時可見。
  charging: [[hs.x+chargingOffset[0],chargingOffset[1],hs.z+chargingOffset[2]], [hs.x, 1100, hs.z + hs.dir * 1500]],
  carport: SITE.carport ? [[-24000, 9000, 12000], [0, 2500, SITE.carport.zLine]] : null,
  top: [[cx, R * 2.3, cz + 10], [cx, 0, cz]],
  car: () => { const p = heroPos() || new THREE.Vector3(hs.x, 900, hs.z); return [p.clone().add(new THREE.Vector3(9000, 7000, 11000)).toArray(), p.toArray()]; },
};
if (!VIEWS.carport) { delete VIEWS.carport; $('carportView').remove(); }
function setView(name, instant = false) {
  const v = typeof VIEWS[name] === 'function' ? VIEWS[name]() : VIEWS[name]; if (!v) return;
  workspace.stopFollowing();
  stage.goTo(v[0], v[1], instant, 1.1,v[2]||{});
  if (name === 'car' && heroPos()) workspace.startFollowing();
  document.querySelectorAll('.views [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('.views [data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));

// ---------------------------------------------------------------- 3D 標籤（物件還沒建好時隱藏）
const label = (html, obj, offset, priority = 0) => stage.addLabel(html, () => {
  if (obj) { for (let p = obj; p; p = p.parent) if (!p.visible) return null; }
  return (obj ? obj.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3()).add(new THREE.Vector3(...offset));
}, '', { anchor: 'above', priority });
if (project.carport) label(`光電車棚 ${SITE.carport.kwp} kWp`, project.carport.bays[3], [0, 4600, SITE.carport.z0 + 400], 6);
project.bess.forEach((b, i) => label(`儲能 ${SITE.bess[i].kw} kW／${SITE.bess[i].kwh} kWh`, b.root, [0, 3000, 0], 7 - i));
label('低壓配電盤＋電表', project.msb.root, [0, 2500, 0], 3);
label('EMS', project.ems.root, [0, 2300, 0], 2);
if (project.transformer) label('受電變壓器', project.transformer.root, [0, 2300, 0], 2);
const dcs = project.chargers.filter(k => k.c.type === 'DC'), acs = project.chargers.filter(k => k.c.type === 'AC');
if (dcs.length) label(`DC 快充 ${dcs[0].c.kw} kW`, dcs[0].m.root, [0, 2600, 0], 5);
if (acs.length) label(`AC 慢充 ${acs[0].c.kw} kW × ${acs.length}`, acs[Math.floor(acs.length / 2)].m.root, [0, 2000, 0], 5);
label('入口車辨＋柵欄', project.lot.gate.entry.root, [0, 2300, 0], 4);
label('繳費機', project.lot.gate.kiosk.root, [0, 2400, 0], 1);
label('台電接點', project.lot.pole.root, [0, 11600, 0], 1);
if (SITE.reserved) label('DC 預留（依需求評估）', scene.getObjectByName('dc reserve'), [0, 900, 0], 3);
if (SITE.id === 'mixed') label('隔音牆', scene.getObjectByName('noise walls'), [SITE.yard.x0 + 3000, 2700, SITE.yard.z0], 1);
if (SITE.fireLane) label('消防通道保持淨空', null, [L.west.xc, 400, 0], 2);
const heroLabel = stage.addLabel('客戶車輛', () => heroPos()?.add(new THREE.Vector3(0, 1300, 0)) || null, 'hero', { anchor: 'above', priority: 9 });

// ---------------------------------------------------------------- 站別按鈕、場型切換、比較表
const stationBar = $('stations');
project.stations.forEach((name, i) => {
  const b = document.createElement('button'); b.className = 'st'; b.dataset.st = i;
  b.innerHTML = `<span class="idx">S${i + 1}</span>${name}`; b.onclick = () => player.seekTo(stationStart[i]);
  stationBar.appendChild(b);
});
$('siteBtns').innerHTML = SITE_IDS.map(id => `<button class="${id === siteId ? 'on' : ''}" data-site="${id}"><b>${SITES[id].name}</b><span>${SITES[id].cls}</span></button>`).join('');
document.querySelectorAll('#siteBtns button').forEach(b => b.onclick = () => { if (b.dataset.site === siteId) return; const q = new URLSearchParams(location.search); q.set('site', b.dataset.site); q.delete('t'); location.search = q.toString(); });
$('siteCls').textContent = `${L.stalls.length} 車位`;
$('siteScene').textContent = SITE.scene;
$('siteSub').textContent = SITE.title + '（概念示意）';
const col = SITE_IDS.indexOf(siteId) + 1;
$('compare').innerHTML = '<tr><th></th>' + SITE_IDS.map((id, i) => `<th class="${i + 1 === col ? 'on' : ''}">${SITES[id].short}</th>`).join('') + '</tr>' +
  COMPARE.map(r => `<tr><td>${r[0]}</td>${r.slice(1).map((v, i) => `<td class="${i + 1 === col ? 'on' : ''}">${v}</td>`).join('')}</tr>`).join('');

// ---------------------------------------------------------------- 面板
const events = project.events;
const ui = { action: $('action'), substep: $('substep'), stationName: $('stationName'), stations: [...stationBar.children] };
const k = project.sim.kpi;
$('cycleTime').textContent = `全天：充電 ${k.ev.toFixed(0)} kWh · 尖峰取電 ${k.peakGrid.toFixed(0)} kW（無儲能 ${k.peakNoBess.toFixed(0)}）`;
const checks = project.layoutChecks?.() || [];
$('checks').innerHTML = checks.map(r => `<li class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✓' : '✗'} ${r.name}<span>${r.value ?? ''}</span></li>`).join('');
$('checkCount').textContent = `${checks.filter(r => r.ok).length} / ${checks.length}`;
const chargerSummary = Object.entries(SITE.chargers.filter(c => !c.expand).reduce((m, c) => { const key = `${c.type} ${c.kw} kW`; m[key] = (m[key] || 0) + 1; return m; }, {})).map(([a, n]) => `${a} × ${n}`).join('、');
const STATE = { charging: '充電中', limit: '限功率', wait: '排程等待', idle: '可使用', off: '未啟用' };
const CUSTOMER_ACTION = {exit:'開門下車',enter:'回座並關門','walk to charger':'步行至充電樁','take connector':'從槍座取槍','carry connector':'持槍走向車輛','insert connector':'對準充電口並插槍',authorize:'確認費率與啟動授權','return to car':'走回車門','walk to port':'步行至充電口','remove connector':'停止充電並解鎖','withdraw connector':'拔槍並退出充電口','return connector':'持槍返回充電樁','holster connector':'將充電槍放回槍座'};
const kw = v => `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(0)} kW`;
let shown = '';
function updatePanels(T) {
  const pr = project.presentation, e = pr.energy, act = project.timeline.activity(T), done = T >= project.total - 1e-6;
  const last = events.filter(x => x.start <= T + 1e-6).at(-1), station = last?.station ?? 0;
  const key = [Math.round(T * 4), act.map(s => s.action).join(), station].join('|');
  if (key === shown) return; shown = key;
  ui.action.textContent = done ? `完成：${SITE.name}全流程` : (pr.hero&&CUSTOMER_ACTION[project.details.state.phase]) || act.map(s => s.action).join('、') || last?.action || '待命';
  ui.substep.textContent = act.map(s => s.sub).filter(Boolean).join('、');
  ui.stationName.textContent = `S${station + 1} ${project.stations[station]}`;
  ui.stations.forEach((b, i) => { b.classList.toggle('active', i === station); b.classList.toggle('done', i < station || done); });
  $('hour').textContent = pr.op ? fmtHour(pr.hour) + (pr.hour >= 24 ? '（隔日）' : '') : '施工期';
  $('period').textContent = pr.op ? PERIOD_NAME[pr.period] : '上線前';
  $('period').className = 'period ' + (pr.op ? pr.period : '');
  const soc = Math.round(e.soc * 100), gridPct = Math.min(100, Math.max(0, e.grid / e.contract * 100));
  $('energy').innerHTML = (pr.op ? [
    ...(e.kwp ? [['光電', `${e.pv.toFixed(0)} kW`, `<i class="bar pv" style="width:${e.pv / e.kwp * 100}%"></i>`]] : []),
    ['充電負載', `${e.ev.toFixed(0)} kW · ${e.active}/${e.total} 支`, ''],
    ['儲能', e.dis > .5 ? `放電 ${e.dis.toFixed(0)} kW` : e.chg > .5 ? `充電 ${e.chg.toFixed(0)} kW${e.chgPv > .5 ? '（光電）' : ''}` : '待機', ''],
    ['SOC', `${soc}%`, `<i class="bar soc" style="width:${soc}%"></i>`],
    ['市電', `${kw(e.grid)}／契約 ${e.contract} kW`, `<i class="bar grid" style="width:${gridPct}%"></i>`],
  ] : [['儲能', `${e.P} kW／${e.E} kWh`, ''], ['契約容量', `${e.contract} kW（假設）`, ''], ...(e.kwp ? [['光電', `${e.kwp} kWp`, '']] : []), ['充電樁', chargerSummary, '']])
    .map(([a, b, c]) => `<dt>${a}</dt><dd>${b}${c ? `<span class="track">${c}</span>` : ''}</dd>`).join('');
  $('alert').textContent = pr.op && e.limited ? '⚠ 儲能功率或 SOC 不足：依公告規則降低充電功率' : pr.op && e.export > .5 ? '光電剩餘：依策略輸出或限發' : '';
  $('alert').className = 'alert' + (pr.op && e.limited ? ' warn' : '');
  const h = pr.hero; $('heroCard').hidden = !h;
  if (h) {
    $('heroHint').textContent = `${h.ch.id} · ${h.ch.type} ${h.ch.kw} kW`;
    const stateText = ['確認費率（示意）','授權','啟動成功'].includes(h.transaction) ? h.transaction : { in: '進場中', park: '停妥', charge: h.limited ? '充電中（限功率）' : h.wait ? '排程等待離峰' : h.p > .05 ? '充電中' : '已充滿、待機', unplug: '拔槍與歸槍', out: '結算離場' }[h.phase];
    $('hero').innerHTML = [['車牌', 'EVA-0588（示意）'], ['狀態', stateText], ['功率', `${h.p.toFixed(1)} kW`], ['已充電量', `${h.kwh.toFixed(1)} ／ ${h.need.toFixed(0)} kWh`], ['帳單', h.phase === 'out' ? '停車＋充電合併結算 ✓' : '離場時合併結算']]
      .map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  }
  $('chargerHint').textContent = pr.op ? `使用中 ${e.active}／${e.total}` : '';
  $('chargerList').innerHTML = pr.chargers.filter(c => c.built).map(c => `<li class="${c.state}"><b>${c.id}</b><span>${c.type} ${c.kw} kW</span><em>${STATE[c.state] || ''}${c.p > .05 ? ' ' + c.p.toFixed(0) + ' kW' : ''}</em></li>`).join('') || '<li class="off">尚未安裝</li>';
}

// ---------------------------------------------------------------- 日照：太陽方位、亮度、背景與霧
function applySky() {
  const h = project.presentation.hour, d = daylight(h), hh = ((h % 24) + 24) % 24;
  const el = Math.max(.12, Math.sin(Math.PI * Math.max(0, Math.min(1, (hh - 6) / 12))) * 1.15), az = Math.PI * Math.max(0, Math.min(1, (hh - 6) / 12));
  const s = stage.lights.sun;
  s.position.set(cx + Math.cos(az) * R * 1.6 * Math.cos(el), R * 1.8 * Math.sin(el) + R * .4, cz + R * 1.6 * Math.sin(az) * Math.cos(el) + R * .3);
  s.target.position.set(cx, 0, cz); s.intensity = .025 + 2.5 * d; s.color.setHSL(.1, .5 * (1 - d) + .05, .75 + .25 * d);
  if (stage.lights.hemi) stage.lights.hemi.intensity = .38 + .18 * d;
  if (stage.lights.fill) stage.lights.fill.intensity = .18 + .06 * d;
  outdoor.apply(d);
  renderer.shadowMap.needsUpdate = true;
}

// ---------------------------------------------------------------- 播放列
const player = createPlayer({
  total: project.total,
  apply: T => { project.apply(T); applySky(); },
  events: events.map(e => ({ time: e.start, label: `S${e.station + 1} · ${e.action}` })),
  onChange: T => { updatePanels(T); stage.invalidate(true); },
});

// ---------------------------------------------------------------- 相機視窗：EMS 調度畫面（2D）或充電區監視器
const cctv = new THREE.PerspectiveCamera(46, 16 / 9, 100, 200000);
cctv.position.set(hs.x - 5200, 5200, hs.aisleZ - hs.dir * 1500); cctv.lookAt(hs.x, 700, hs.z);   // 車道對側燈桿上的監視器
const lpr = new THREE.PerspectiveCamera(64,16/9,40,15000), lprOverlay=createLprOverlay(project);
project.lot.gate.lprIn.root.updateWorldMatrix(true,false);
// 原有相機外形與車輛停等位置保持不變；虛擬取像點往閘桿內側偏移，避開機殼與車側遮擋。
lpr.position.copy(project.lot.gate.lprIn.root.localToWorld(new THREE.Vector3(0,1660,-3100)));
lpr.lookAt(G.xIn,390,G.armIn+800);
function drawEMS(c, w, h) {
  const pr = project.presentation, S = pr.sim, e = pr.energy, f = Math.min(w / 960, h / 560);
  const night = seq.hero.night && pr.hour > 12 && project.presentation.time >= seq.hero.t0;
  const h0 = night ? 12 : 0, h1 = h0 + 24;
  c.fillStyle = '#08131b'; c.fillRect(0, 0, w, h);
  const pad = { l: 64 * f, r: 58 * f, t: 54 * f, b: 46 * f }, X = v => pad.l + (v - h0) / 24 * (w - pad.l - pad.r), top = Math.max(S.contract, S.kwp * .85, 80) * 1.15;
  const Y = v => h - pad.b - (v + top * .35) / (top * 1.35) * (h - pad.t - pad.b), Ys = v => h - pad.b - v * (h - pad.t - pad.b);
  // 時段色帶
  for (let d = 0; d < 2; d++) for (const [a, b, p] of PERIOD_BANDS) {
    const A = Math.max(h0, a + 24 * d), B = Math.min(h1, b + 24 * d); if (B <= A) continue;
    c.fillStyle = { off: '#0c2230', half: '#14222a', peak: '#2a1a1a' }[p]; c.fillRect(X(A), pad.t, X(B) - X(A), h - pad.t - pad.b);
    c.fillStyle = '#6f8796'; c.font = `${12 * f}px sans-serif`; c.textAlign = 'center'; c.fillText(PERIOD_NAME[p], (X(A) + X(B)) / 2, pad.t + 14 * f);
  }
  // 格線與軸
  c.strokeStyle = '#1f3341'; c.lineWidth = 1; c.fillStyle = '#7b93a2'; c.font = `${12 * f}px sans-serif`; c.textAlign = 'right';
  for (let v = 0; v <= top; v += top > 120 ? 50 : 20) { c.beginPath(); c.moveTo(pad.l, Y(v)); c.lineTo(w - pad.r, Y(v)); c.stroke(); c.fillText(`${v}`, pad.l - 6 * f, Y(v) + 4 * f); }
  c.strokeStyle = '#3a5566'; c.beginPath(); c.moveTo(pad.l, Y(0)); c.lineTo(w - pad.r, Y(0)); c.stroke();
  c.textAlign = 'center'; for (let x = h0; x <= h1; x += 3) c.fillText(fmtHour(x).slice(0, 2), X(x), h - pad.b + 18 * f);
  c.textAlign = 'left'; c.fillText('kW', 8 * f, pad.t - 8 * f); c.textAlign = 'right'; c.fillText('SOC', w - 8 * f, pad.t - 8 * f);
  // 契約容量
  c.setLineDash([6 * f, 5 * f]); c.strokeStyle = '#e05a5a'; c.beginPath(); c.moveTo(pad.l, Y(S.contract)); c.lineTo(w - pad.r, Y(S.contract)); c.stroke(); c.setLineDash([]);
  c.fillStyle = '#e07a7a'; c.textAlign = 'left'; c.fillText(`契約 ${S.contract} kW`, pad.l + 6 * f, Y(S.contract) - 6 * f);
  const rows = S.day.filter(r => r.h >= h0 - 1e-6 && r.h <= h1 + 1e-6);
  const line = (fn, color, wd = 2, fill = false) => { c.beginPath(); rows.forEach((r, i) => { const x = X(r.h), y = fn(r); i ? c.lineTo(x, y) : c.moveTo(x, y); }); if (fill) { c.lineTo(X(rows.at(-1).h), Y(0)); c.lineTo(X(rows[0].h), Y(0)); c.closePath(); c.fillStyle = color; c.fill(); } else { c.strokeStyle = color; c.lineWidth = wd * f; c.stroke(); } };
  line(r => Y(r.dis - r.chg), 'rgba(61,214,140,.28)', 0, true);
  if (S.kwp) line(r => Y(r.pv), '#f5c400', 2.2);
  line(r => Y(r.ev), '#34e0d0', 2.2);
  line(r => Y(r.grid), '#4aa8ff', 2.2);
  line(r => Ys(r.soc), '#e8eef3', 1.4);
  // 游標
  if (pr.op) { const x = X(Math.max(h0, Math.min(h1, pr.hour))); c.strokeStyle = '#ffffff'; c.lineWidth = 1.5 * f; c.beginPath(); c.moveTo(x, pad.t); c.lineTo(x, h - pad.b); c.stroke(); }
  // 圖例（直接標在右上）
  const legend = [...(S.kwp ? [['光電', '#f5c400']] : []), ['充電負載', '#34e0d0'], ['市電取電', '#4aa8ff'], ['儲能放電(+)／充電(−)', '#3dd68c'], ['SOC', '#e8eef3']];
  c.font = `${13 * f}px sans-serif`; c.textAlign = 'left'; let lx = pad.l;
  for (const [t, col] of legend) { c.fillStyle = col; c.fillRect(lx, 18 * f, 14 * f, 4 * f); c.fillStyle = '#c9d6de'; c.fillText(t, lx + 18 * f, 24 * f); lx += c.measureText(t).width + 34 * f; }
  if (!pr.op) { c.fillStyle = 'rgba(8,19,27,.72)'; c.fillRect(0, 0, w, h); c.fillStyle = '#cfe0ea'; c.font = `bold ${22 * f}px sans-serif`; c.textAlign = 'center'; c.fillText('系統聯測完成後上線：示意的全天調度曲線', w / 2, h / 2); }
}
function render() {
  const pr = project.presentation;
  if(workspace.source!=='lpr')lprOverlay.hide();
  if(workspace.source==='lpr') workspace.renderCamera({renderer,scene,camera:lpr,vision:lprOverlay,aspect:16/9,title:'入口車辨（虛擬）',result:'EVA-0588 · 幾何投影與補光同步示意',marks:{time:pr.time}});
  else if (workspace.source === 'cctv') workspace.renderCamera({ renderer, scene, camera: cctv, aspect: 16 / 9, title: '充電區監視器（虛擬）', result: ui.action.textContent, marks: { time: pr.time } });
  else workspace.renderImage({ draw: drawEMS, aspect: 960 / 560, title: `EMS 全天調度（${SITE.name}，示意）`, result: pr.op ? `${fmtHour(pr.hour)} · ${PERIOD_NAME[pr.period]} · SOC ${Math.round(pr.energy.soc * 100)}%` : '上線前', time: pr.time });
  workspace.renderOverview(cinemaOverview, scene);
}

setView(qp.get('view') in VIEWS ? qp.get('view') : 'iso', true);
if (qp.has('cam')) { const a = qp.get('cam').split(',').map(Number); if (a.length === 6 && a.every(Number.isFinite)) stage.goTo(a.slice(0, 3), a.slice(3), true); }
$('loading').classList.add('hide');
stage.loop(dt => { const changed = player.update(dt); workspace.follow(); stage.updateLabels(); return changed; }, { render });

exposeSim({ seekTo: player.seekTo, setView, views: VIEWS, total: project.total, play: player.play, pause: player.pause, get T() { return player.T; }, stationStart, project, site: siteId,renderQuality,assets:{loaded:assetStatus.loaded,failures:assetStatus.failures,skyFile:assetStatus.skyFile} });

// ---------------------------------------------------------------- 錄影（?movie：core/movie 依時間軸步驟運鏡；export-mp4.mjs 用 ?movie&auto）
if (qp.has('movie')) {
  const { installMovie } = await import('@core/movie/movie.js');
  // 複製事件僅供攝影使用，原始 seq.tl.events 完全不動。
  const targetAt = t => {
    if(t>=seq.hero.t0&&t<=seq.hero.t1) return heroPos() || new THREE.Vector3(hs.x,900,hs.z);
    const lift=seq.lifts.find(l=>t>=l.t0&&t<=l.t1);
    if(lift)return new THREE.Vector3(...lift.target).add(new THREE.Vector3(0,1500,0));
    if(t>=seq.opStart || (seq.tl.activity(t).some(s=>/儲能|配電|EMS|管線|模組/.test(s.action)))) return new THREE.Vector3(...yardC).add(new THREE.Vector3(0,1500,0));
    return SITE.carport?new THREE.Vector3(0,1500,SITE.carport.zLine):new THREE.Vector3(cx,0,cz);
  };
  const movieSteps=events.map(e=>({...e,offset:e.start>=seq.hero.t0&&e.start<seq.hero.t1?chargingOffset:e.start>=seq.opStart||/儲能|配電|EMS|模組/.test(e.action)?energyOffset:SITE.carport?[23000,18000,30000]:[16000,14000,22000]}));
  installMovie({
    project: decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)),
    title: `${SITE.title}`,
    scene, renderer, camera, controls, render, setView, total: project.total, steps: movieSteps,
    sample: t => { project.apply(t); applySky(); updatePanels(t); },
    focus: () => targetAt(project.presentation.time),
    glandShots:false,
    far: 600000, offset: [R * .45, R * .55, R * .8],
  });
}
