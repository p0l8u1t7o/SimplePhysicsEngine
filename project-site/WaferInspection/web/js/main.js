// 主程式：舞台（core/ui/stage.js）＋播放列（core/ui/player.js）＋共用版面與影像視窗（core/ui/viewer-workspace.js）＋本站的面板。
// 場景與每個時間點的狀態全部來自 project.js（與 core 統一檢查同一份）。參數、情境、模式改了就帶網址參數重新載入，不保留舊結果。
// 網址參數：?mode=full、?sc=particle、?hood=solid|glass|off、?truth=1、?view=top、?src=photo，以及 spec.js PARAMS 的任一鍵（例如 &mag=2&camIf=10GigE）。
import * as THREE from 'three';
import { createStage, exposeSim } from '@core/ui/stage.js';
import { createPlayer, fmtTime } from '@core/ui/player.js';
import { createViewerWorkspace } from '@core/ui/viewer-workspace.js';
import { createProject, STATIONS, SCENARIOS, PARAMS, MODES } from './project.js';
import { srcLabel } from './spec.js';
import { CELL_COLORS, CELL_LABEL } from './wafer.js';
import { drawWaferMap, drawTiming, drawSimImage, drawPhoto } from './views2d.js';

const qp = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f = (v, n = 1, unit = '') => v == null || !Number.isFinite(v) ? '<span class="tbd">待確認</span>' : `${v.toFixed(n)}${unit}`;

// ---------------------------------------------------------------- 參數（網址）
const params = {};
for (const [k, d] of Object.entries(PARAMS)) if (qp.has(k)) params[k] = d.options ? qp.get(k) : qp.get(k) === '' ? null : Number(qp.get(k));

// ---------------------------------------------------------------- 舞台與專案
const canvas = $('c');
const stage = createStage({ canvas, look: 'cell', extent: { center: [0, 1150, 0], radius: 1600 }, camera: { near: 2, far: 30000 }, controls: { minDistance: 60, maxDistance: 9000 } });
const { renderer, scene, camera, controls } = stage;
const textureSize = Math.min(renderer.capabilities.maxTextureSize, matchMedia('(max-width: 800px)').matches ? 2048 : 4096);
const project = createProject({ scene, mode: qp.get('mode') || 'compact', scenario: qp.get('sc') || 'line', params, textureSize });
const { machine, wafer } = project;
const view = { A: qp.get('truth') === '1', B: true, C: true, path: true, fov: true };
let hoodMode = ['glass', 'solid', 'off'].includes(qp.get('hood')) ? qp.get('hood') : 'glass';
let selected = null;           // { at, k, label }
let photo = null, manualMarks = [];

// ---------------------------------------------------------------- 共用版面與影像視窗（2D 影像：SIM 檢測影像或本機參考照片）
const waferCenter = () => new THREE.Vector3().setFromMatrixPosition(wafer.group.matrixWorld);
let topMode = false;           // 晶圓俯視：隱藏光學頭與龍門（只在畫面上，不影響模擬），鏡頭跟著晶圓
const workspace = createViewerWorkspace({
  camera, controls, canvas, resize: stage.resize, getFocus: () => waferCenter().add(new THREE.Vector3(0, 2, 0)), focusOffset: () => topMode ? [0, 620, 1] : [0, 520, 380],
  onFocus: () => { stage.cancelTween(); document.querySelectorAll('.views [data-view]').forEach(b => b.classList.remove('on')); },
});
workspace.setSources([{ id: 'current', label: '目前取像位置（SIM）' }, { id: 'selected', label: '選取的位置或候選（SIM）' }, { id: 'photo', label: '本機參考照片（客戶提供）' }], { auto: false, onChange: () => stage.invalidate(true) });
if (qp.get('src') === 'photo') workspace.source = 'photo';

// ---------------------------------------------------------------- 視角（桌面座標；窄畫布由 stage 自動拉遠）
const S = machine.surf;
const VIEWS = {
  iso: [[1450, 1750, 1850], [0, 1180, 40]],
  top: () => { const c = waferCenter(); return [[c.x, S + 620, c.z + 1], [c.x, S, c.z]]; },
  optics: [[230, S + 120, 300], [0, S + 35, 0]],
  front: [[0, 1450, 2500], [0, 1120, 0]],
};
function setView(name, instant = false) {
  const v = typeof VIEWS[name] === 'function' ? VIEWS[name]() : VIEWS[name]; if (!v) return;
  topMode = name === 'top'; machine.optics.visible = machine.bridge.visible = !topMode; stage.invalidate(true);
  workspace.stopFollowing(); stage.goTo(v[0], v[1], instant);
  if (topMode) workspace.startFollowing();
  document.querySelectorAll('.views [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('.views [data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));

// ---------------------------------------------------------------- 3D 標籤
const label = (html, getPos, priority = 0) => stage.addLabel(html, getPos, '', { anchor: 'above', priority });
label('真空吸盤＋晶圓（示意）', () => waferCenter().add(new THREE.Vector3(-110, 6, 150)), 3);
const opt = v => () => topMode ? null : v;                // 俯視時光學頭隱藏，標籤也不顯示
label('同軸明場（示意）', opt(new THREE.Vector3(110, machine.lensFront + 150, 0)), 2);
label('低角度暗場環形光（示意）', opt(new THREE.Vector3(machine.rOut + 20, machine.ringY + 12, 30)), 2);
label('Z 調焦＋相機', opt(new THREE.Vector3(0, machine.lensFront + 300, -60)), 1);
label('XY 平台', new THREE.Vector3(-300, 1080, 260), 1);
label('遮光外罩', () => hoodMode === 'off' || topMode ? null : new THREE.Vector3(560, 1800, 520), 0);

// ---------------------------------------------------------------- 頂部階段按鈕
const stationBar = $('stations');
STATIONS.forEach((name, i) => {
  const b = document.createElement('button'); b.className = 'st'; b.dataset.st = i;
  b.innerHTML = `<span class="idx">S${i + 1}</span>${name}`; b.onclick = () => player.seekTo(project.stationStart[i] ?? 0);
  stationBar.appendChild(b);
});

// ---------------------------------------------------------------- 情境、模式、顯示
const reload = changes => { const u = new URLSearchParams(location.search); for (const [k, v] of Object.entries(changes)) v == null ? u.delete(k) : u.set(k, v); u.delete('t'); location.search = u.toString(); };
$('scenario').innerHTML = Object.entries(SCENARIOS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('');
$('scenario').value = project.scenarioId; $('scenario').onchange = e => reload({ sc: e.target.value });
$('mode').innerHTML = Object.entries(MODES).map(([k, s]) => `<option value="${k}">${s}</option>`).join('');
$('mode').value = project.mode; $('mode').onchange = e => reload({ mode: e.target.value });
$('hood').value = hoodMode; $('hood').onchange = e => { hoodMode = e.target.value; refresh(); };
if (['BF', 'DF'].includes(qp.get('channel'))) $('channel').value = qp.get('channel');
$('channel').onchange = $('overlay').onchange = () => stage.invalidate(true);
for (const [id, key] of [['showA', 'A'], ['showB', 'B'], ['showC', 'C'], ['showPath', 'path']]) { $(id).checked = view[key]; $(id).onchange = e => { view[key] = e.target.checked; refresh(); }; }
$('scenarioNote').innerHTML = `${esc(project.scenario.note)}。所有結果都是 <b>SIM／模擬</b>，外觀參考客戶照片的示意。曝光後光暈為短暫示意餘暉，平台移動時關閉。`;
// 本機參考照片：只在這個瀏覽器顯示，不上傳、不寫進專案
const loadPhoto = (src, name) => new Promise((ok, bad) => { const img = new Image(); img.onload = () => { photo = { img, name }; manualMarks = []; workspace.source = 'photo'; stage.invalidate(true); ok({ w: img.width, h: img.height }); }; img.onerror = bad; img.src = src; });
$('photo').onchange = e => { const file = e.target.files?.[0]; if (file) loadPhoto(URL.createObjectURL(file), file.name); };

// ---------------------------------------------------------------- wafer map 圖例與精簡模式提示
$('mapLegend').innerHTML = Object.entries(CELL_LABEL).map(([k, l]) => `<span><i style="background:#${CELL_COLORS[k].toString(16).padStart(6, '0')}"></i>${l}</span>`).join('') +
  '<span><i class="ring"></i>B 候選</span><span><i class="dia"></i>C 待人工確認</span><span><i class="dash"></i>邊緣排除區</span>';
if (project.mode === 'compact' && project.valid) {
  $('compactNote').hidden = false;
  $('compactNote').textContent = `精簡展示：只掃中央 ${project.p.compactRows} 列（${project.list.length}／${project.all.length} 個位置），其餘標「展示略過」、沒有取像，不能據此宣稱整片已完成檢測。整片請切「完整掃描」。`;
}

// ---------------------------------------------------------------- 估算、參數、演算方式、線掃描、檢核（靜態，參數改了會重新載入）
function renderEstimate() {
  const e = project.est, o = project.optics;
  if (!e.valid) { $('estimate').innerHTML = `<div class="banner bad">${esc(e.reason)}</div><div class="note">所有估算顯示待確認（不把缺值當 0）。</div>`; return; }
  const row = (k, v, note = '') => `<tr><th>${k}</th><td>${v}</td><td class="n">${note}</td></tr>`;
  const lines = [
    row('視野（FOV）', `${f(e.fov[0], 2)} × ${f(e.fov[1], 2)} mm`, 'core/optics'),
    row('物方解析度', f(e.umPerPx, 2, ' µm/px'), '像素尺寸 ÷ 倍率'),
    row('目標缺陷佔像素', f(e.defectPx, 2, ' px'), `需 ${project.p.pxPerDefect} px；只代表幾何取樣，不等於保證可檢出`),
    row('景深（近似）', f(e.dof * 1000, 0, ' µm'), `平面度假設 ${project.p.flatness * 1000} µm`),
    row('取像位置', `${e.positions}（${e.rows} 列，邊緣 ${e.edgePositions}）`, `步距 ${f(project.plan.step[0], 2)} × ${f(project.plan.step[1], 2)} mm`),
    row('有效區覆蓋', f(e.coverage * 100, 2, '%'), `逐點檢查有效圓 Ø${(2 * project.plan.Rv).toFixed(0)}`),
    row('排除區面積', f(e.exclusionArea, 0, ' mm²'), `邊緣 ${project.p.edgeExcl} mm；視野落在有效區外 ${f(e.wastedArea, 0, ' mm²')}`),
    row('完整 die（示意）', `${e.dies.full}（另有部分 ${e.dies.partial}）`, `die ${project.p.dieW}×${project.p.dieH} mm 為展示假設`),
    row('取像張數', `${e.images}（明暗場各 ${e.positions}）`, `對位、複檢另計，共 ${e.frames} 張`),
    row('資料量', f(e.dataGB, 1, ' GB'), `每張 ${f(o.frameMB, 1)} MB`),
    row('整片週期（估算）', `<b>${f(e.cycle, 1, ' s')}</b>`, `瓶頸：${e.bottleneck}；含複檢 ${e.reviewCount} 處；不含人工放取片`),
    row('目標週期', e.takt == null ? '<span class="tbd">待確認</span>' : `${e.takt} s（${e.taktOk ? '符合' : '超過'}）`, '客戶未提供'),
  ];
  const bd = e.breakdown.filter(b => b.s > 0.001).map(b => `<tr><td>${b.label}</td><td class="r">${b.s.toFixed(1)} s</td><td class="bar"><i style="width:${(b.s / e.cycle * 100).toFixed(1)}%"></i></td></tr>`).join('');
  const par = e.parallel.map(b => `<tr><td>${b.label}</td><td class="r">${b.s.toFixed(1)} s</td><td class="n">${esc(b.note)}</td></tr>`).join('');
  $('estimate').innerHTML = `<table class="tbl kv">${lines.join('')}</table>
    <div class="sub">週期分項（關鍵路徑，加總＝整片週期）</div><table class="tbl">${bd}</table>
    <div class="sub">並行時間（不加總）</div><table class="tbl">${par}</table>
    <div class="sub">打光幾何（core/optics L2，借用「鏡面金屬」代表拋光平整區）</div>
    <table class="tbl">${o.lightRows.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(r.value ?? '')}${esc(r.unit || '')}</td></tr>`).join('')}</table>
    <div class="banner warn">近似光學模型不能預測晶圓薄膜干涉、細密圖案繞射與真實缺陷散射；缺陷對比、檢出率與誤判率要打光 POC，示意影像不能代替。</div>`;
}
function renderParams() {
  const groups = {};
  for (const [k, d] of Object.entries(PARAMS)) (groups[d.group] ||= []).push([k, d]);
  $('params').innerHTML = Object.entries(groups).map(([g, list]) => `<div class="pgroup"><div class="sub">${g}</div>${list.map(([k, d]) => {
    const v = project.p[k], src = project.src[k];
    const input = d.options ? `<select data-k="${k}">${d.options.map(o => `<option${o === v ? ' selected' : ''}>${o}</option>`).join('')}</select>`
      : `<input data-k="${k}" type="number" step="any" value="${v ?? ''}" placeholder="待確認">`;
    return `<label class="prow" title="${esc(d.note)}"><span>${d.label}${d.unit ? `（${d.unit}）` : ''}</span>${input}<em class="src src-${src}">${srcLabel(src)}</em></label>`;
  }).join('')}</div>`).join('');
  if (project.errors.length || project.missing.length) { $('paramErrors').hidden = false; $('paramErrors').innerHTML = [...project.errors, ...(project.missing.length ? [`缺少：${project.missing.join('、')}（待確認）`] : [])].map(esc).join('<br>'); }
}
$('applyParams').onclick = () => {
  const changes = {};
  document.querySelectorAll('#params [data-k]').forEach(el => {
    const k = el.dataset.k, d = PARAMS[k], raw = el.value.trim();
    const v = d.options ? raw : raw === '' ? null : Number(raw);
    changes[k] = (d.options ? v === d.value : v === d.value) ? null : (v == null ? '' : String(v));
  });
  reload(changes);
};
$('resetParams').onclick = () => reload(Object.fromEntries(Object.keys(PARAMS).map(k => [k, null])));
$('method').innerHTML = `
  <ol>
    <li><b>取像</b>：每個位置停穩後拍同軸明場與低角度暗場各一張（停拍互鎖：平台未停穩不曝光）。</li>
    <li><b>缺圖檢查</b>：任一通道沒收到影像 → <span class="tag recheck">待複檢</span>，不判良品。</li>
    <li><b>影像品質</b>：和黃金樣本比較整張與 8×6 分區的清晰度（梯度能量）與亮度；失焦或照明不足 → <span class="tag recheck">待複檢</span>，此位置不找缺陷、也不判良品。</li>
    <li><b>明暗補正</b>：每區乘上和參考影像的亮度比（shading correction）。</li>
    <li><b>差異比對</b>：|影像 − 參考|，以中位數絕對偏差估雜訊，門檻 max(6σ, 0.1)；明場、暗場各做一次。</li>
    <li><b>候選區</b>：連通區域（≥ 3 像素）→ 晶圓座標外框；外擴 1.2 mm 內相交的（含相鄰位置、斷續暗點）併成同一個 <span class="tag cand">B 候選</span>。</li>
    <li><b>複檢</b>：候選與待複檢位置依最近鄰順序回去各拍 ${project.p.reviewImgs} 張，之後交人工確認（<span class="tag c">C</span>）。</li>
  </ol>
  <p class="note"><b>實機檢測平台：VisionSequence（自家視覺平台）</b>。上述步驟對應平台工具：多光源取像、區域指標量測（清晰度）、灰階統計、陰影校正、良品影像差異比對／統計良品比對、粒子分析、框操作、結果回報；驗證用批次測試與 Golden Set 回歸。晶圓流程尚未在平台實作。</p>
  <p class="note">SIM：影像是 0.12 mm／像素的示意取樣（顯示時 0.02 mm），明場以 RGB 顯示、亮度比對；缺陷寬度依示意放大到看得見。參考影像用同一圖樣函式、不含注入缺陷，演算法不讀 A 真值。
  實機要改成 die-to-die 或設計圖比對、建立缺陷標註資料並定允收規格；光學影像不能判定晶體管、奈米線路或內部電性缺陷，疑似暗線也不直接判定為裂紋。</p>`;
function renderLineScan() {
  const L = project.lineScan;
  if (!L) { $('lineScan').innerHTML = '<div class="note">參數無效：待確認</div>'; return; }
  $('lineScan').innerHTML = `<table class="tbl"><tr><th></th>${L.map(c => `<th>${c.name}</th>`).join('')}<th>本版面掃</th></tr>
    <tr><td>掃描帶寬</td>${L.map(c => `<td>${c.swath} mm</td>`).join('')}<td>${f(project.plan.fov?.[0], 1)} mm</td></tr>
    <tr><td>道數</td>${L.map(c => `<td>${c.swaths}</td>`).join('')}<td>${project.est.rows ?? '—'} 列</td></tr>
    <tr><td>掃描速度</td>${L.map(c => `<td>${c.speed} mm/s</td>`).join('')}<td>停拍</td></tr>
    <tr><td>需要行頻</td>${L.map(c => `<td>${c.lineKHz} kHz（上限 ${c.maxLineKHz}）</td>`).join('')}<td>—</td></tr>
    <tr><td>掃描時間</td>${L.map(c => `<td>約 ${c.scanS} s（${c.passes} 趟）</td>`).join('')}<td>約 ${f(project.est.cycle, 0)} s（整片）</td></tr>
    <tr><td>資料量</td>${L.map(c => `<td>${c.dataGB} GB</td>`).join('')}<td>${f(project.est.dataGB, 1)} GB</td></tr></table>
    <div class="note">同樣 ${f(project.optics.umPerPx, 2)} µm/px；線掃描相機規格為示意（型錄待確認）。整合風險：${esc(L[0].risks)}。</div>`;
}
const checks = project.layoutChecks();
$('checks').innerHTML = checks.map(r => `<li class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✓' : '✗'} ${esc(r.name)}<span>${esc(r.value ?? '')}</span></li>`).join('');
$('checkCount').textContent = `${checks.filter(r => r.ok).length} / ${checks.length}`;
$('cycleTime').textContent = project.valid ? `${MODES[project.mode]} ${fmtTime(project.total)}｜整片估算 ${project.est.cycle.toFixed(0)} s` : '參數檢核失敗';
renderEstimate(); renderParams(); renderLineScan();

// ---------------------------------------------------------------- 複檢列表與真值對照（依時間更新）
function select(sel) { selected = sel; wafer.setSelected(sel?.at || null); if (sel) { workspace.source = 'selected'; setView('top'); } refresh(); }
$('reviewList').onclick = e => { const li = e.target.closest('[data-i]'); if (!li) return; const it = project.review[+li.dataset.i]; select({ at: it.at, k: it.k, label: it.ref }); };
let listKey = '';
function updateLists(T) {
  const r = project.resultsAt(T), key = `${r.cands.length}|${r.quality.length}|${r.reviewed.length}|${selected?.label}`;
  if (key === listKey) return; listKey = key;
  const seen = new Set([...r.cands.map(c => c.id), ...r.quality.map(k => 'P' + (k + 1))]);
  const items = project.review.map((it, i) => ({ it, i })).filter(({ it }) => seen.has(it.ref));
  $('reviewList').innerHTML = items.length ? items.map(({ it, i }) => {
    const done = r.reviewed.includes(it);
    return `<li data-i="${i}" class="${selected?.label === it.ref ? 'sel' : ''}"><span class="tag ${it.type === 'candidate' ? 'cand' : 'recheck'}">${it.ref}</span>
      <span class="what">${esc(it.note)}<br><small>(${it.at[0].toFixed(1)}, ${it.at[1].toFixed(1)}) mm · P${it.k + 1}</small></span>
      <span class="state">${done ? '<span class="tag c">C 待人工確認</span>' : '待複檢取像'}</span></li>`;
  }).join('') : `<li class="empty">${T < (project.schedule.scanEnd ?? 0) ? '尚無（處理完成後才出現）' : '沒有候選或待複檢位置（SIM）'}</li>`;
  $('reviewHint').textContent = `${items.length}／${project.review.length}`;
  const sc = project.score.rows;
  $('scoreTable').innerHTML = sc.length ? `<tr><th>A 真值</th><th>種類</th><th>結果</th><th>對應</th></tr>` + sc.map(x => {
    const shown = x.found.filter(id => id.startsWith('B') ? r.cands.some(c => c.id === id) : r.quality.includes(+id.slice(1) - 1));
    const pending = !x.imaged ? x.result : shown.length || T >= (project.schedule.scanEnd ?? 0) + 1 ? x.result : '掃描中';
    return `<tr><td>${x.id}</td><td>${x.kind}</td><td>${pending}</td><td>${shown.join(' ') || '—'}</td></tr>`;
  }).join('') + (project.score.extra.length ? `<tr><td colspan="4">A 以外的 B 候選：${project.score.extra.join(' ')}</td></tr>` : '')
    : '<tr><td>本情境沒有注入缺陷：B 候選應為 0（目前 ' + r.cands.length + '）</td></tr>';
}

// ---------------------------------------------------------------- wafer map 點選定位
const mapCanvas = $('waferMap'); let mapGeo = null;
mapCanvas.onclick = e => {
  if (!mapGeo?.toWafer || !project.valid) return;
  const b = mapCanvas.getBoundingClientRect(), [x, y] = mapGeo.toWafer((e.clientX - b.left) * mapCanvas.width / b.width, (e.clientY - b.top) * mapCanvas.height / b.height);
  const near = project.review.find(it => Math.hypot(it.at[0] - x, it.at[1] - y) < 6 / mapGeo.s + 2);
  if (near) return select({ at: near.at, k: near.k, label: near.ref });
  const q = project.plan.covers(x, y); if (q) select({ at: [q.x, q.y], k: q.k, label: 'P' + (q.k + 1) });
};
let photoGeo = null;
document.getElementById('pipImage')?.addEventListener('click', e => {
  if (workspace.source !== 'photo' || !photo || !photoGeo) return;
  const c = e.currentTarget.querySelector('canvas'), b = c.getBoundingClientRect(), px = (e.clientX - b.left) * c.width / b.width, py = (e.clientY - b.top) * c.height / b.height;
  manualMarks.push({ at: [(px - photoGeo.ox) / photoGeo.k, (py - photoGeo.oy) / photoGeo.k], text: `待確認 #${manualMarks.length + 1}` }); stage.invalidate(true);
});

// ---------------------------------------------------------------- 面板（每格）
const ui = { action: $('action'), substep: $('substep'), stationName: $('stationName'), chips: $('chips'), stations: [...stationBar.children] };
const MODE_TXT = { move: ['平台移動中', 'move'], settle: ['停穩中（不曝光）', 'warn'], wait: ['停穩・等待影像傳輸', 'warn'], expBF: ['明場曝光', 'bf'], expDF: ['暗場曝光', 'df'], switch: ['切換光源', 'warn'], af: ['Z 掃描對焦', 'move'], align: ['對位取像', 'bf'], review: ['複檢取像', 'bf'], vacuum: ['真空', 'move'], theta: ['θ 修正', 'move'], calc: ['計算中', 'move'], tail: ['傳輸／演算收尾', 'move'], report: ['彙整結果', 'move'], invalid: ['參數檢核失敗', 'bad'] };
let panelKey = '';
function updatePanels(T) {
  const cur = project.sequence.sample(T), s = cur.state, st = cur.step, end = T >= project.total - 1e-6;
  const key = `${cur.index}|${end}`;
  if (key !== panelKey) {
    panelKey = key;
    ui.action.textContent = end ? (project.valid ? '完成：結果待人工確認' : st.action) : st.action;
    ui.substep.textContent = st.sub || '';
    ui.stationName.textContent = `S${st.station + 1} ${STATIONS[st.station]}`;
    ui.stations.forEach((b, i) => { b.classList.toggle('active', i === st.station); b.classList.toggle('done', i < st.station || end); });
    const [mt, cls] = end && project.valid ? ['停在取放片位・待人工取片', 'ok'] : MODE_TXT[s.mode] || ['待命', 'move'], r = project.resultsAt(T);
    ui.chips.innerHTML = [`<span class="chip ${cls}">${mt}</span>`, `<span class="chip ${s.light === 'off' ? '' : s.light === 'BF' ? 'bf' : 'df'}">光源：${s.light === 'BF' ? '同軸明場' : s.light === 'DF' ? '低角度暗場' : '關'}</span>`,
      `<span class="chip ${s.vac === 2 ? 'ok' : s.vac ? 'warn' : ''}">真空：${s.vac === 2 ? '已確認' : s.vac ? '建立中' : '關'}</span>`,
      `<span class="chip">Z ${(s.z * 1000).toFixed(0)} µm</span>`, `<span class="chip">θ ${s.th.toFixed(2)}°</span>`,
      project.valid ? `<span class="chip">已取像 ${r.done.length}／${project.list.length}${project.mode === 'compact' ? `（整片 ${project.all.length}）` : ''}</span>` : ''].join('');
    $('mapHint').textContent = project.valid ? `${MODES[project.mode]}・${r.complete ? '整片已取像' : project.mode === 'compact' ? '非整片檢測' : '掃描中'}` : '';
  }
  updateLists(T);
}

// ---------------------------------------------------------------- 播放列
const player = createPlayer({
  total: project.total, speed: project.mode === 'full' ? 10 : 1,
  apply: T => project.apply(T, { hood: hoodMode, view }),
  events: project.events.map(e => ({ time: e.time, label: `S${e.station + 1} · ${e.label}` })),
  onChange: T => { updatePanels(T); stage.invalidate(true); },
});
if (project.mode === 'full' && !qp.has('speed')) { $('speed').value = '10'; $('speed').dispatchEvent(new Event('change')); }
function refresh() { project.apply(player.T, { hood: hoodMode, view }); listKey = ''; updatePanels(player.T); stage.invalidate(true); }

// ---------------------------------------------------------------- 每格繪製：wafer map、時序、影像視窗、主畫面
const mapCtx = mapCanvas.getContext('2d'), timingCtx = $('timing').getContext('2d');
let drawnKey = '';
function render() {
  const T = player.T, cur = project.sequence.sample(T).state;
  // 影像視窗：選取的位置；複檢中看複檢的位置；掃描中看最後一個已曝光的位置（移動到下一位置時還沒有新影像）
  const lastShot = () => { let k = -1; for (const x of project.list) { if (project.schedule.posTime.get(x).exp[1] <= T) k = x; else break; } return k; };
  const k = workspace.source === 'selected' ? selected?.k : cur.phase === '複檢' && project.review[cur.rev] ? project.review[cur.rev].k : lastShot();
  const key = `${T.toFixed(3)}|${JSON.stringify(view)}|${selected?.label}|${workspace.source}|${$('channel').value}|${$('overlay').value}|${photo?.name}|${manualMarks.length}`;
  if (key !== drawnKey) {
    drawnKey = key;
    mapGeo = drawWaferMap(mapCtx, mapCanvas.width, mapCanvas.height, project, T, view, selected?.at);
    drawTiming(timingCtx, $('timing').width, $('timing').height, project, T);
  }
  if (workspace.source === 'photo') workspace.renderImage({ draw: (c, w, h) => { photoGeo = drawPhoto(c, w, h, photo, { overlay: $('overlay').value, manual: manualMarks }); }, title: '本機參考照片（客戶提供）', result: photo ? `人工標記 ${manualMarks.length} 筆（C，只在本機）` : '尚未載入', aspect: photo ? photo.img.width / photo.img.height : 1.6, time: T });
  else workspace.renderImage({ draw: (c, w, h) => drawSimImage(c, w, h, project, T, k, { channel: $('channel').value, overlay: $('overlay').value, A: view.A }),
    title: `檢測影像 SIM・${$('channel').value === 'BF' ? '明場' : '暗場'}${k >= 0 && k != null ? `・P${k + 1}` : ''}`, result: k >= 0 && k != null && project.per[k] ? `演算結果：${{ ok: '無候選', candidate: '有候選', recheck: '待複檢', missing: '缺圖' }[project.per[k].status]}${T < (project.schedule.posTime.get(k)?.result ?? Infinity) ? '（處理中）' : ''}` : '—',
    aspect: project.valid ? project.plan.fov[0] / project.plan.fov[1] : 1.5, time: T });
  workspace.renderOverview(renderer, scene);
}

setView(qp.get('view') in VIEWS ? qp.get('view') : 'iso', true);
if (qp.has('cam')) { const a = qp.get('cam').split(',').map(Number); if (a.length === 6 && a.every(Number.isFinite)) stage.goTo(a.slice(0, 3), a.slice(3), true); }
refresh();
$('loading').classList.add('hide');
stage.loop(dt => { const changed = player.update(dt); workspace.follow(); stage.updateLabels(); return changed; }, { render });

exposeSim({ seekTo: player.seekTo, setView, views: VIEWS, total: project.total, play: player.play, pause: player.pause, get T() { return player.T; }, stationStart: project.stationStart, project, select, loadPhoto });

// ---------------------------------------------------------------- 錄影（?movie）
if (qp.has('movie')) {
  const { installMovie } = await import('@core/movie/movie.js');
  installMovie({
    project: decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)),
    title: document.querySelector('.brand .title')?.firstChild?.textContent?.trim() || document.title,
    scene, renderer, camera, controls, render, setView, total: project.total, steps: project.events.map(e => ({ start: e.time, dur: e.dur, action: e.label, sub: e.sub, station: e.station })),
    sample: t => { player.seekTo(t); },
    focus: () => waferCenter(), offset: [-500, 450, 650],
  });
}
