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

// ---------------------------------------------------------------- 錄影（?movie；core/tools/export-mp4.mjs --query "plan=…&scope=qc" 全自動輸出）
// scope=qc：只錄品檢站（作業員從推車抱盒進站 → 翻盒／上砧 → 量測 → 剔除 NG → 放行）。每段指定注視點與鏡頭方向，
// 鏡頭從外框開口的南側看、避開作業員站位與外框立柱；畫面疊字幕（目前動作）與右下角模擬量測畫面。
if (movie) {
  const { installMovie } = await import('@core/movie/movie.js');
  const qcOnly = qp.get('scope') === 'qc', box = plan.mode === 'box', W = (x, y, z) => V(S.x + x, y, S.z + z);
  let movieT = 0, steps;
  const at = t => steps.findLast(s => s.start <= t + 1e-6) ?? steps[0];
  const boxAt = k => () => project.boxes[k].root.position.clone().add(V(0, 120, 0));
  // 鏡頭偏移（相機＝注視點＋偏移）：作業員站在入料座南側，所以翻盒從西側看（翻轉在 YZ 平面，側面看得到整個 180° 弧線）、
  // 量測區從東南看（相機低於外框頂樑 2100、仍高過入料座上的空盒，作業員頭頂在畫面外）；跟隨鐵盒的鏡頭留在品檢區牆內
  const SIDE = [-2100, 900, 700], SE = [600, 1050, 1500], FOLLOW = [-1100, 1300, 1000];
  const AIM = box ? {
    carry: [boxAt('A'), FOLLOW], nest: [() => W(0, 1050, QB.nest.z), [-1700, 1000, 900]],
    flip: [() => W(0, 1050, 0), SIDE], meas: [() => W(0, 960, QB.meas), SE], reject: [() => W(300, 960, QB.meas - 10), SE],
  } : {
    carry: [boxAt('A'), FOLLOW], out: [boxAt('E'), [1100, 1300, 1000]],
    cell: [() => W(0, 980, -150), [800, 1400, 1600]], anvil: [() => W(QP.anvil.x, 990, QP.anvil.z), [500, 550, 900]],
  };
  if (qcOnly) {
    const evs = events.filter(e => e.action && e.station >= 2).sort((a, b) => a.start - b.start);
    const q0 = evs.find(e => /抱起/.test(e.action))?.start ?? project.t0 - 4;
    const raw = [];
    for (const e of evs.filter(e => e.start >= q0 - 1e-6)) {
      const a = e.action, st = e.station;
      let aim = st === 2 ? 'carry' : st === 6 ? (box ? 'carry' : 'out') : 'cell', speed = 1;
      if (box) aim = st === 2 ? 'carry' : st === 6 ? 'carry' : st === 4 ? 'meas' : /量盒壁/.test(a) ? 'nest' : /剔除/.test(a) ? 'reject' : st === 5 && /回停放位/.test(a) ? 'reject' : st >= 3 && st <= 5 ? 'flip' : aim;
      else if (st === 3 && /放上量測砧/.test(a) || st === 4 && !/快轉/.test(a)) { aim = 'anvil'; speed = .4; }
      else if (st === 5) speed = .4;
      else if (/快轉/.test(a)) speed = 2;
      raw.push({ start: e.start, station: st, text: a, sub: e.sub || '', aim, speed });
    }
    // 逐顆：第 1 顆慢動作做完後，第 2～5 顆以實際速度展示
    if (!box) {
      const k = raw.findIndex(s => s.station === 5), t1 = raw.find(s => /放上量測砧/.test(s.text)).start + project.cycleQc / cap;
      raw.splice(k + 1, 0, { start: t1, station: 4, text: `連續取放量測：每顆 ${(project.cycleQc / cap).toFixed(2)} s（實際速度）`, sub: 'OK 放回出料盒同一格、NG 丟進滑槽', aim: 'cell', speed: 1.4 });
    }
    // 第一段從抱盒開始；最後一段到作業員把良品盒放回推車
    steps = raw.map((s, i) => ({ ...s, label: `S${s.station + 1} ${STATIONS[s.station]}`, offset: AIM[s.aim][1], dur: (raw[i + 1]?.start ?? project.total) - s.start }));
  } else steps = events.map((e, i) => ({ ...e, text: e.action, aim: e.station >= 2 ? (box ? 'flip' : 'cell') : null, dur: (events[i + 1]?.start ?? project.total) - e.start }));
  const q0 = steps[0].start;

  // 疊圖：底部字幕＋右下角模擬量測畫面（以 4K 畫好再隨畫面縮成 1080p）
  const hud = document.createElement('canvas'); hud.width = 3840; hud.height = 2160;
  const hctx = hud.getContext('2d'), tex = new THREE.CanvasTexture(hud); tex.colorSpace = THREE.SRGBColorSpace;
  const hudScene = new THREE.Scene(), hudCam = new THREE.OrthographicCamera(0, 1920, 1080, 0, -1, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1920, 1080), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  quad.position.set(960, 540, 0); hudScene.add(quad);
  const mStart = stationStart[4] - .3, mEnd = events.find(e => /回停放位/.test(e.action))?.start ?? project.tOut, font = '"Microsoft JhengHei","Noto Sans TC",sans-serif';
  function drawHud(t) {
    const c = hctx; c.setTransform(2, 0, 0, 2, 0, 0); c.clearRect(0, 0, 1920, 1080);
    const s = at(t);
    if (qcOnly && s && t >= q0) {
      const inset = t >= mStart && t <= (box ? mEnd : project.tOut + .3), w = inset ? 1184 : 1856;
      c.fillStyle = '#081722e0'; c.fillRect(32, 942, w, 106); c.fillStyle = '#72e3cd'; c.fillRect(32, 942, 5, 106);
      c.fillStyle = '#f2f6f8'; c.font = `600 28px ${font}`; c.fillText(s.text, 56, 984, w - 48);
      // 整盒掃描：每列的事件沒有文字，字幕改顯示目前列與已量顆數
      const m = box && s.station === 4 ? project.measured(t) : null;
      const sub = m ? `第 ${Math.min(part.grid.rows, Math.floor(m.count / part.grid.cols) + 1)} / ${part.grid.rows} 列・已量 ${m.count} / ${cap} 顆` : s.sub || STATIONS[s.station];
      c.fillStyle = '#adbdc9'; c.font = `20px ${font}`; c.fillText(sub, 56, 1024, w - 48);
      if (inset) {
        // 兩次取像之間保留上一筆量測畫面（往回找 3 s 內最近的有效量測），避免逐顆方案每顆閃回「等待」
        let tm = t;
        if (project.measured(t).current < 0) for (let k = 1; k <= 60 && t - k * .05 >= mStart; k++) if (project.measured(t - k * .05).current >= 0) { tm = t - k * .05; break; }
        c.save(); c.translate(1248, 648); c.fillStyle = '#081722'; c.fillRect(-4, -4, 648, 408);
        drawMeasurement(c, 640, 400, tm, project, drawGrid); c.restore();
        c.strokeStyle = '#72e3cd'; c.lineWidth = 2; c.strokeRect(1246, 646, 644, 404);
      }
    }
    tex.needsUpdate = true;
  }

  installMovie({
    project: decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)),
    title: qcOnly ? `品檢站 · ${plan.name}` : document.querySelector('.brand .title')?.textContent || document.title,
    scene, renderer, camera, controls, setView, total: project.total, steps, far: 60000,
    // 片頭（t＝0）取第一段的狀態，進站時不會突然出現作業員與鐵盒
    sample: t => { movieT = qcOnly ? Math.max(t, q0) : t; project.apply(movieT); updatePanels(movieT); },
    render: () => {
      renderer.shadowMap.needsUpdate = true; renderer.setScissorTest(false);
      renderer.render(scene, camera);
      drawHud(movieT); const ac = renderer.autoClear; renderer.autoClear = false; renderer.render(hudScene, hudCam); renderer.autoClear = ac;
    },
    focus: () => { const s = at(movieT); return s?.aim ? AIM[s.aim][0]() : project.focus(movieT); },
    offset: [-1600, 1300, 2000],
    ...(qcOnly ? { overview: { p: [S.x - 2100, 2600, S.z + 1700], t: [S.x, 950, S.z - 100] } } : {}),
  });
}
