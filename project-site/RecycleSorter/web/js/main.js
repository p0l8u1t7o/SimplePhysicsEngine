// 主程式：舞台（core/ui/stage.js）＋播放列（core/ui/player.js）＋共用版面（core/ui/viewer-workspace.js）＋本專案的視角、站別與面板。
// 場景與每個時間點的狀態全部來自 project.js，與 core 統一檢查用的是同一份。
// 版面骨架在 index.html（#topbar／#side／#bottombar）；手機、平板的精簡版面由 createViewerWorkspace 自動切換。
// 第二段共用同一時間軸呈現電控活動與雙相機取像。
// 前段（既有 ABB 分選站）的段落（CHAPTERS 的 front）：側欄、焦點追隨與相機子畫面改看前段。
import * as THREE from 'three';
import { createStage, exposeSim } from '@core/ui/stage.js';
import { createPlayer } from '@core/ui/player.js';
import { createViewerWorkspace } from '@core/ui/viewer-workspace.js';
import { createElectricalInspector } from '@core/electrical/electrical-inspector.js';
import { setElectricalCutaway } from '@core/electrical/electrical-cabinet.js';
import { routingLegend } from '@core/electrical/cable-routing.js';
import { createVisionOverlay } from '@core/ui/vision-overlay.js';
import { renderVisionFrame } from './vision.js';
import { createProject } from './project.js';
import { LAYOUT, STATIONS } from './layout.js';
import { CHAPTERS, CT, AXIS, BELT_V, VISION_TO_PICK, MIX, FLOW, ABB_CT } from './schedule.js';
import { CLS_LABEL, KINDS } from './items.js';

const qp = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const L = LAYOUT, b = L.belt, v = L.vision, a = L.arm, F = L.front, AB = L.abb;

// ---------------------------------------------------------------- 舞台
const canvas = $('c');
const stage = createStage({
  canvas, look: 'cell', extent: { center: [-1900, 700, -500], radius: 3900 },   // 含上游的既有分選線
  declutter: true,
  camera: { near: 5, far: 40000 },
  controls: { minDistance: 300, maxDistance: 18000 },
});
const { renderer, scene, camera, controls } = stage;
const project = createProject({ scene });
const { stationStart, metrics, jobs, throughput, abbJobs, passed } = project;

// ---------------------------------------------------------------- 共用版面：精簡版面（☰ 製程與視角、⚙ 播放設定）、焦點追隨（◎）
const focusVec = new THREE.Vector3();
routingLegend();
const workspace = createViewerWorkspace({
  camera, controls, canvas, resize: stage.resize,
  getFocus: () => {
    const it = project.focusItem();
    if (!it?.grp.visible) return null;
    return it.grp.getWorldPosition(focusVec).clone().add(new THREE.Vector3(0, it.H / 2, 0));
  },
  focusOffset: [-700, 620, 900],
  onFocus: () => { stage.cancelTween(); document.querySelectorAll('.views [data-view]').forEach(x => x.classList.remove('on')); },
});

// 桌面預設停靠畫布右下，讓開入料端；使用者拖曳後交回共用視窗控制。
const pip = $('pipFrame'); pip.classList.add('default-dock');
const placePip = () => {
  const bottom = $('bottombar').getBoundingClientRect();
  pip.style.setProperty('--pip-bottom', `${Math.max(14, innerHeight-bottom.top+12)}px`);
};
const pipObserver = new ResizeObserver(placePip); pipObserver.observe($('bottombar'));
window.addEventListener('resize', placePip); placePip();
const releasePip = event => {
  if (event.type==='keydown' && !event.key.startsWith('Arrow')) return;
  if (!pip.classList.contains('default-dock')) return;
  const rect=pip.getBoundingClientRect(); pip.classList.remove('default-dock');
  pip.style.left=`${rect.left}px`; pip.style.top=`${rect.top}px`;
};
$('pipTitle').addEventListener('pointerdown',releasePip,true);
$('pipTitle').addEventListener('keydown',releasePip,true);

// ---------------------------------------------------------------- 視角：[相機位置, 注視點]（照桌面寫；手機直向等窄畫布由 stage 自動拉遠）
const VIEWS = {
  electrical: [[600, 1900, -950], [300, 650, -1720]],   // 從機台後緣上方往下看走道裡的電盤（走道只有 850 mm，正面拉不遠）
  // 全線：上游 ABB 分選站到下游補抓站。直向畫面（手機）放不下 7 m 長的線，改從上游端順著輸送帶往下游看
  line: () => canvas.clientWidth < canvas.clientHeight ? [[-8600, 4700, 3400], [-2300, 300, -350], { fit: false }] : [[-4100, 3500, 5600], [-1950, 650, -350]],
  overview: [[-2750, 2100, 2300], [0, 820, -30]],       // 後段補抓站
  top: [[-1950, 8600, -290], [-1950, 0, -300]],
  frontVision: [[-5900, 2300, 2100], [F.x + 50, 1150, b.z]],
  frontTop: [[F.x + 100, 1750, 1500], [F.x + 60, 800, b.z]],          // 從操作面兩根柱子之間、雙軌下方斜看帶面
  abb: [[-5200, 2900, 3300], [AB.x, 1350, b.z]],
  abbPick: [[AB.x - 1450, 1200, b.z + 130], [AB.x + 100, 880, b.z]],   // 沿輸送帶從網籠的穿越口往裡看，不隔護網
  handoff: [[-3300, 2300, 3000], [-1900, 780, b.z]],
  infeed: [[-2500, 1500, 1400], [-1050, 820, b.z]],
  vision: [[-1750, 1550, 1250], [v.x, 1150, b.z]],
  visionTop: [[v.x - 120, 2500, 480], [v.x, 780, b.z]],
  track: [[-700, 1600, 1500], [L.pick.cx - 250, 820, b.z]],
  pick: [[-450, 1500, 1500], [a.x + 60, 950, -60]],
  outfeed: [[450, 1880, 3000], [175, 700, 490]],
};
let userView = false;
function setView(name, instant = false, automatic = false) {
  const view = typeof VIEWS[name] === 'function' ? VIEWS[name]() : VIEWS[name]; if (!view) return;
  if (!automatic) userView = true;
  setElectricalCutaway(scene, name === 'electrical');
  // 電盤視角收起相機子畫面，免得蓋住櫃子（需要時按 ▣ 再開）
  const pip = document.getElementById('showPip');
  if (name === 'electrical' && pip?.checked) { pip.checked = false; pip.dispatchEvent(new Event('change')); }
  workspace.stopFollowing();
  stage.goTo(view[0], view[1], instant, .9, view[2] || {});
  document.querySelectorAll('.views [data-view]').forEach(x => x.classList.toggle('on', x.dataset.view === name));
}
document.querySelectorAll('.views [data-view]').forEach(x => x.onclick = () => setView(x.dataset.view));
const electrical = createElectricalInspector({ scene, camera, controls, canvas,
  title: '回收物自動分揀展示機', onEnter: () => setView('electrical', true), onExit: () => setView('overview', true) });
const visionOverlay = createVisionOverlay();
const cameraToggle = document.querySelector('.viewer-tools [aria-label="顯示／隱藏相機視窗"]');
workspace.setSources([{ id: 'CAM1', label: '後段 CAM-L 立體左眼' }, { id: 'CAM2', label: '後段 CAM-R 立體右眼' },
  { id: 'CAM3', label: '前段 CAM-L（ABB 站）' }, { id: 'CAM4', label: '前段 CAM-R（ABB 站）' }], { onChange: () => stage.invalidate(true) });

// ---------------------------------------------------------------- 3D 標籤
const label = (html, getPos, cls = '', priority = 0) => stage.addLabel(html, getPos, cls, { anchor: 'above', priority });
const P = (x, y, z) => new THREE.Vector3(x, y, z);
// 八個工站：前段（現場既有的 ABB 分選站）兩站＋後段補抓站六站
const stationLabels = [
  ['① 前段立體取像（新視覺）', P(F.x, F.beamY + 190, b.z), 7],
  ['② ABB 並聯手臂第一道分選（既有）', P(AB.x, AB.cell.top - 260, AB.cell.z[1] + 40), 7],
  ['③ 入料整列', P(-1100, 950, b.z - 340), 6],
  ['④ 後段立體取像', P(v.x - 100, 1470, -40), 6],
  ['⑤ AI 分類與 3D 定位', P(v.x + 330, 1110, b.z + 170), 5],
  ['⑥ 編碼器追蹤', P(L.encoder.x + 120, 880, L.encoder.z - 60), 5],
  ['⑦ 補抓取放（HSR065）', P(a.x + 230, a.baseY + 510, a.z + 40), 6],
  ['⑧ 分流出料 A／B', P(175, 850, L.divA.z + 140), 6],
].map(([text, pos, pr]) => label(text, pos, 'station', pr));
void stationLabels;   // 只需要建立，更新由 stage.updateLabels 負責
// 關鍵尺寸（示意）
label('帶寬 600', P(-1120, b.top + 90, b.z), 'dim', 3);
label('動作半徑 650（示意）', P(a.x + a.reach, 100, a.z - 160), 'dim', 2);
label('基線 300／WD 800（示意）', P(v.x + 70, v.camY - 230, -650), 'dim', 3);
label('有效抓取區 240 × 280', P(L.pick.cx, b.top + 90, L.pick.z[1]), 'dim', 3);
label('ABB 工作直徑 1600（示意）', P(AB.x + AB.reach, 100, b.z + 250), 'dim', 2);
label('抓取窗口 ±50', P(AB.x, b.top + 90, b.z + 300), 'dim', 3);
label('過渡板', P(-1355, b.top + 70, b.z + 330), 'dim', 2);
label('ABB 收料籃：食品 HDPE', P(AB.x, 560, b.z - AB.basket.z), '', 2);
label('ABB 收料籃：非食品 HDPE', P(AB.x, 560, b.z + AB.basket.z), '', 2);
label('既有電控櫃', P(AB.cabinet.x, AB.cabinet.size[1] + 90, AB.cabinet.z), '', 2);
label('收料箱 A：食品 HDPE', P(L.binA.x, 560, L.binA.z), '', 2);
label('收料箱 B：非食品 HDPE', P(L.binB.x, 560, L.binB.z), '', 2);
label('主帶末端：續流至現場既有輸送帶（示意）', P(b.x[1] - 150, b.top + 150, b.z), '', 1);
// 動態標籤：節拍計時、分類結果、追蹤中的工件、警報
const ctLabel = label('', () => P(a.x, a.baseY + 520, a.z + 320), 'ct', 8);
const clsLabel = label('', () => {
  const it = project.state?.job && project.itemById.get(project.state.job.item.id);
  return it?.grp.visible ? it.grp.getWorldPosition(focusVec).clone().setY(b.top + 150) : null;
}, 'cls', 9);
const alarmLabel = label('', () => project.state?.alarm ? P(b.x[1] - 250, b.top + 320, b.z) : null, 'alarm', 10);
// 前段：ABB 正在抓的目標，以及最近一件被放行、正流向後段的目標
const abbLabel = label('', () => {
  const it = project.state?.abb.job?.item;
  return it?.grp.visible && project.state.tau < it.abbJob.landTau ? it.grp.getWorldPosition(focusVec).clone().setY(focusVec.y + it.H + 110) : null;
}, 'cls', 9);
const handoffItem = () => {
  const st = project.state; if (!st) return null;
  return [...passed].reverse().find(it => it.pass.enter - .6 <= st.tau && (!it.job || st.tau < it.job.grabTau) && it.grp.visible && it.grp.position.x < v.x - 300) || null;
};
const passLabel = label('', () => { const it = handoffItem(); return it ? it.grp.getWorldPosition(focusVec).clone().setY(b.top + 170) : null; }, 'pass', 9);
// 前段取像與分配的兩個段落：視野內「派給 ABB」與「放行」各標一件
const inFrontFov = pick => {
  const st = project.state; if (!st || !['frontVision', 'frontAI'].includes(st.chapter.id)) return null;
  return project.items.find(it => pick(it) && it.grp.visible && Math.abs(it.grp.position.x - F.x) < F.fov[1] / 2 && Math.abs(it.grp.position.y - b.top - 2) < 1) || null;
};
const assignLabel = (pick, cls, text) => {
  const l = label('', () => { const it = inFrontFov(pick); return it ? it.grp.getWorldPosition(focusVec).clone().setY(b.top + 150) : null; }, cls, 9);
  return () => { const it = inFrontFov(pick); l.el.innerHTML = it ? `${KINDS[it.kind].label}　h ${b.top + 2 + it.H} mm<br>${text}` : ''; };
};
const assignUpdates = [assignLabel(it => !!it.abbJob, 'cls', '→ 派給 ABB'), assignLabel(it => !!it.pass, 'pass', '→ ABB 來不及，交後段')];

// ---------------------------------------------------------------- 站別按鈕（跳到該站第一個段落）
const stationBar = $('stations');
STATIONS.forEach((name, i) => {
  const btn = document.createElement('button'); btn.className = 'st'; btn.dataset.st = i;
  btn.innerHTML = `<span class="idx">S${i + 1}</span>${name}`;
  btn.onclick = () => player.seekTo(stationStart[i]);
  stationBar.appendChild(btn);
});

// ---------------------------------------------------------------- 側欄面板
const ui = { action: $('action'), substep: $('substep'), note: $('chapterNote'), stationName: $('stationName'), stations: [...stationBar.children] };
$('cycleTime').textContent = `前段 ABB ${ABB_CT.toFixed(2)} s／件 · 後段同類連抓 ${CT.toFixed(2)} s · 混合料流 ${throughput.mixed.toFixed(2)} s／瓶`;
$('flow').innerHTML = FLOW.map(s => `<li>${s}</li>`).join('');
const flowItems = [...$('flow').children];
const checks = project.layoutChecks();
$('checks').innerHTML = checks.map(r => `<li class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✓' : '✗'} ${r.name}<span>${r.value ?? ''}</span></li>`).join('');
$('checkCount').textContent = `${checks.filter(r => r.ok).length} / ${checks.length}`;
$('notes').innerHTML = [
  `本機是<b>後段補抓站</b>，架在現場既有 ABB 分選站的下游。前段（既有輸送帶、ABB IRB 360 並聯手臂與網籠、滑槽、收料籃、電控櫃）依 2026-10-02 現場照片與影片目測建模，尺寸與位置皆為<b>示意</b>，現場未量測。`,
  `<b>兩站都用新的雙相機立體視覺</b>（同相機、同鏡頭、基線 300），取代現場辨識不佳的既有相機。前段沒有導料板，工作距離加高到 ${F.wd}（單眼視野 ${F.fov.join(' × ')}、雙眼重疊 ${F.fov[0] - F.baseline} mm）才蓋得住 600 帶寬；前段取像站到 ABB 抓取線 ${AB.x - F.x} mm，飛行時間 ${((AB.x - F.x) / BELT_V).toFixed(1)} s。`,
  `ABB 單趟 <b>${ABB_CT.toFixed(2)} s</b>（示意，待現場實測）：吸嘴接大口徑軟管、放料要橫移到帶外滑槽。規則是先到先抓——目標進到抓取線 ±${AB.window} mm 窗口時手臂還沒空就<b>放行</b>；這段料流 ABB 抓 ${abbJobs.length} 件、放行 ${passed.length} 件，全部由後段接手。`,
  `放行清單（類別、頂面高度、編碼器位置）經兩站之間的整合通訊交給後段；工件經過渡板與導料板後位置會偏移，所以後段再取像一次才抓。兩條皮帶是否為同一條、過渡方式待現場確認。`,
  `模型庫共 12 款，全部排入料流（洗衣精罐由前段 ABB 抓取）。包裝色塊、斜撐、護板框與細節尺寸皆為<b>示意</b>。`,
  `規格未給的尺寸一律是<b>示意</b>值：帶面高 750、分流帶面 700、相機 500 萬畫素 10 mm 鏡頭、基線 300／WD 800，單眼視野 704 × 528 mm。`,
  `相機數量依「補充說明」改為<b>雙相機立體對</b>，覆蓋開案報告第 8 頁的「相機數量 1」。`,
  `取像站設在 X ${v.x}（原案 −450 會落在手臂掃掠範圍內）；到抓取點 ${VISION_TO_PICK} mm，飛行時間 ${(VISION_TO_PICK / BELT_V).toFixed(2)} s ≫ 視覺鏈路 0.29 s。`,
  `導料板把帶上料流由 600 收攏到 <b>280 mm</b>（已拍板）：HSR065（R650）側邊立座扣掉最小迴轉半徑與 J2 基座干涉區後，實際只覆蓋這個帶寬。`,
  `機台寬度已拍板放寬到 <b>1460 mm</b>（原估 1300）：帶寬與側樑、架台、兩條分流帶與手臂掃掠外圍排完後，立柱最近只能放到 Z −730／+670。`,
  `節拍以<b>混合料流加權平均</b>承諾（已拍板）：同類連抓 ${throughput.ct.AA.toFixed(2)} s、跨帶 ${throughput.ct.BB.toFixed(2)} s，`
  + `按食品類佔 ${Math.round(MIX.food * 100)}%（示意）加權為 <b>${throughput.mixed.toFixed(2)} s／瓶</b>、稼動 ${Math.round(MIX.uptime * 100)}% 換算 <b>約 ${throughput.hour} 瓶/小時</b>。`,
  `對應的帶上目標物平均間距需 ≥ <b>${throughput.pitch} mm</b>（同類連抓時 ${(CT * BELT_V).toFixed(0)} mm）；「後段連續運轉節拍」段用 280 mm 的滿載同類料流驗證 1.40 s，其後一件目標間距只有 240 mm 排不進空檔，流到末端觸發警報。`,
  `手臂軸速上限取 DENSO HSR 型錄等級的假設值（J1／J2 ${AXIS.j1}°/s、J4 ${AXIS.j4}°/s、Z ${AXIS.z} mm/s），每個子動作的時間由行程反推，待型錄核對。`,
  `兩段 AI 分析為凍結畫面，ABB 抓取與放行、編碼器追蹤、兩段補抓為慢動作（1/5、1/4、1/6、1/5）：製程時間整體放慢，兩站的帶速與手臂速度同步縮放，不是單獨調慢帶子。`,
  `第二段電盤：600 × 1200 × 300，後方維修走道 <b>850 mm</b>；20 個元件、六組穿板接頭，⚡ 開啟電控檢視器可選取元件、查看用途與連線。`,
  `電源 AC 220 V／20 A、24 VDC 240 W（概算負載 160 W），三帶變頻器、PLC／高速計數、視覺 IPC／PoE 與 RC8A 控制器均為<b>配置示意</b>，型號與施工線徑待選定。`,
  `雙相機由編碼器每 200 mm 同步觸發、曝光 2 ms；子畫面保留最近一次取像，分類、頂面高度、角度與信心分數皆為 <b>SIM／示意</b>。來源選單可切換左右眼。`,
  `外露線沿線槽、立柱與托架固定；Z 軸使用 HSR065 內建拖鏈，工具浮動段採內部通道（示意）。`,
  `安全鏈：光柵／急停 → GC1 → K1／K2 雙通道切斷動力，IO2 監看回授；須手動復歸。<b>光幕位置僅示意</b>：提案估算安全距離 ≥668 mm，實機位置與停機時間待風險評估。此動畫未新增遮斷或急停事件。`,
].map(s => `<li>${s}</li>`).join('');

const kindList = Object.entries(KINDS).reduce((m, [, k]) => (m[k.cls] = (m[k.cls] || 0) + 1, m), {});
let shown = '';
function updatePanels(T) {
  const st = project.state;
  if (!st) return;
  const front = !!st.chapter.front, act = front ? st.abb.action : st.action, sub = front ? st.abb.sub || st.chapter.note : st.sub;
  const key = `${act}|${sub}|${st.station}|${st.counts.A}|${st.counts.B}|${st.counts.other}|${st.counts.missed}|${st.counts.abb}|${st.counts.handoff}|${st.chapter.id}|${st.tau.toFixed(1)}`;
  if (key === shown) return; shown = key;
  ui.action.textContent = act;
  ui.substep.textContent = sub || '';
  flowItems.forEach((li, i) => { li.classList.toggle('on', i === st.chapter.flow); li.classList.toggle('done', i < st.chapter.flow); });
  ui.note.textContent = `${st.chapter.name}　${st.rate > .01 && st.rate < .99 ? `· 慢動作 1/${Math.round(1 / st.rate)}` : st.rate < .01 ? '· 畫面凍結' : ''}`;
  ui.stationName.textContent = `S${st.station + 1} ${STATIONS[st.station]}`;
  ui.stations.forEach((btn, i) => {
    btn.classList.toggle('active', i === st.station);
    btn.classList.toggle('done', i < st.station || T >= project.total - 1e-6);
  });
  $('stats').innerHTML = [
    ['前段 ABB · 已抓進收料籃', `${st.counts.abb} 件`, true],
    ['前段放行 · 交後段補抓', `${st.counts.handoff} 件`, true],
    ['A 帶 · 食品 HDPE', `${st.counts.A} 件`, true],
    ['B 帶 · 非食品 HDPE', `${st.counts.B} 件`, true],
    ['主帶末端 · 其餘回收物', `${st.counts.other} 件`, true],
    ['漏抓目標（間距不足）', `${st.counts.missed} 件`, !st.counts.missed],
    ['後段已取放', `${st.picks} / ${jobs.length} 趟`, true],
    ['製程時間', `${st.tau.toFixed(2)} s · 帶面行程 ${(st.s / 1000).toFixed(2)} m`, true],
    ['承諾產能（混合料流）', `${throughput.mixed.toFixed(2)} s／瓶 · ${throughput.hour} 瓶/小時`, true],
  ].map(([n, val, ok]) => `<li class="${ok ? 'ok' : 'ng'}">${n}<span>${val}</span></li>`).join('');
  $('alarm').textContent = st.alarm ? '⚠ 漏抓警報' : '';
  ctLabel.el.innerHTML = st.chapter.id === 'result'
    ? `承諾產能　混合料流 ${throughput.mixed.toFixed(2)} s／瓶　約 ${throughput.hour} 瓶/小時<br>A ${st.counts.A} ／ B ${st.counts.B} 件　同類連抓能力 ${CT.toFixed(2)} s`
    : `CT ${CT.toFixed(2)} s／瓶（同類連抓）　已取放 ${st.picks}　A ${st.counts.A} ／ B ${st.counts.B}`;
  const job = st.job;
  clsLabel.el.innerHTML = job
    ? `${KINDS[job.item.kind].label}　${CLS_LABEL[job.item.cls]}　→ ${job.dest} 帶<br>θ ${(job.item.theta * 180 / Math.PI).toFixed(0)}°　頂面 Z ${(b.top + 2 + job.item.H)} mm`
    : '';
  alarmLabel.el.innerHTML = `⚠ 目標未被抓取（間距 &lt; ${(CT * BELT_V).toFixed(0)} mm）→ 末端警報`;
  const aj = st.abb.job;
  abbLabel.el.innerHTML = aj ? `${KINDS[aj.item.kind].label}　${CLS_LABEL[aj.item.cls]}　→ ABB 抓取<br>頂面 Z ${b.top + 2 + aj.item.H} mm　${aj.side < 0 ? '−Z' : '+Z'} 側滑槽` : '';
  for (const update of assignUpdates) update();
  const hp = handoffItem();
  passLabel.el.innerHTML = hp ? `${KINDS[hp.kind].label}　ABB 沒空 → 放行<br>交後段補抓（${hp.job ? hp.job.dest + ' 帶' : '間距不足'}）` : '';
}

// ---------------------------------------------------------------- 播放列
// 段落切換時相機跟著走預設視角；使用者自己按過視角或開了焦點追隨就不搶鏡頭
let currentView = null;
const events = CHAPTERS.map((c, i) => ({ time: c.t[0], label: `S${c.station + 1} · ${i + 1}. ${c.name}` }));
const player = createPlayer({
  total: project.total, events, speed: 1,
  apply: T => project.apply(T),
  onChange: T => {
    updatePanels(T);
    const want = project.state?.chapter.view;
    if (want && want !== currentView && !workspace.following && !userView) { currentView = want; setView(want, false, true); }
    stage.invalidate(true);
  },
});

currentView = qp.get('view') in VIEWS ? qp.get('view') : 'line';
setView(currentView, true, !qp.has('view'));
if (qp.has('cam')) { const arr = qp.get('cam').split(',').map(Number); if (arr.length === 6 && arr.every(Number.isFinite)) stage.goTo(arr.slice(0, 3), arr.slice(3), true); }
$('loading').classList.add('hide');
// ?movie 時 stage 不啟動迴圈（交給錄影程式）
function render() {
  const st = project.state;
  electrical.update({ time: player.T, playing: player.playing, action: st.action, motion: st.rate > .01, vision: st.electrical.capture || st.electrical.analysis });
  const requested=cameraToggle.getAttribute('aria-pressed')==='true';
  if (!renderVisionFrame(project, scene, workspace.source,
    data => workspace.renderCamera({ renderer, scene, vision: visionOverlay, ...data }), requested)) visionOverlay.hide();
  workspace.renderOverview(renderer, scene);
}
stage.loop(dt => { const changed = player.update(dt); workspace.follow(); stage.updateLabels(); return changed; }, { render });

exposeSim({
  goCam: arr => stage.goTo(arr.slice(0, 3), arr.slice(3), true),   // 除錯用：直接指定 [位置, 注視點]
  seekTo: player.seekTo, setView, views: VIEWS, total: project.total, play: player.play, pause: player.pause,
  get T() { return player.T; }, stationStart, project, chapters: CHAPTERS, kindList,
});

// ---------------------------------------------------------------- 錄影（?movie：core/movie 依敘事段落運鏡；core/tools/export-mp4.mjs 用 ?movie&auto 全自動輸出 MP4）
// 時間軸用網頁的主時間（0～96 s），不用製程時間 τ：project.apply 吃的就是主時間，慢動作段的帶速、手臂與節拍
// 一起放慢、AI 分析段整體凍結，錄影和網頁播放看到同一套敘事。每個敘事段落（CHAPTERS）是一個步驟，
// station 填段落序號，讓每段各有一張標題卡（movie.js 以 station 判斷換段）。兩處只剪掉完全靜止的畫面：
//   開頭待機 0～8 s（帶子與手臂都不動）由片頭全景取代，第一步從 8 s 起、含 9.5～10.3 s 的啟動；
//   AI 分析段 30.8～41 s 整段凍結（狀態與畫面逐格相同），只留前 4 s。
// 只擷取 3D 畫布：相機子畫面與疊圖是 DOM／離屏繪製，進不了影片，所以 render 不畫相機子畫面。
if (qp.has('movie')) {
  player.pause();
  const { installMovie } = await import('@core/movie/movie.js');
  const MOVIE_START = 8, AI_HOLD = 4;   // 兩段 AI 分析（前段、後段）各只留前 4 s
  const steps = CHAPTERS.flatMap((c, i) => {
    if (c.id === 'overview') return [];
    const t0 = c.id === 'frontVision' ? MOVIE_START : c.t[0], t1 = c.id === 'ai' || c.id === 'frontAI' ? c.t[0] + AI_HOLD : c.t[1];
    // 前段從操作面（+Z）斜上方看：網籠的護板是半透明的，ABB 與兩側滑槽都看得到
    return [{ start: t0, dur: t1 - t0, action: c.name, station: i, ...(c.front ? { offset: [-900, 1100, 2300] } : {}) }];
  });
  // 追焦：手臂正在取放的瓶罐（吸附中就是吸盤組的位置）；還在上游時夾在取像站 X −700（入料端仍在畫面左側），
  // 全部取放完之後改看分流出料區。movie.js 會再做數秒的平滑，連抓時在抓取點與投放點之間不會來回甩。
  // 夾住 X 下限讓視線不必穿過背面左立柱；Z 上限夾在手臂底座一線、高度上限 900，投放到分流帶與吸附搬運時
  // 鏡頭仍在背面頂樑（Y 1740）以下，頂樑不會橫過畫面（見下方 offset）。
  const focusPoint = new THREE.Vector3(), OUTFEED = new THREE.Vector3(175, 760, 150);
  const FOCUS_X = [L.vision.x, b.x[1] - 300], FOCUS_Z = [b.z, a.z + 10], FOCUS_Y_MAX = 900;
  const FRONT_X = [F.x, -1500], FRONT_FOCUS = new THREE.Vector3(AB.x, 900, b.z);
  const movieFocus = () => {
    const st = project.state;
    if (st.chapter.front) {                                                         // 前段：ABB 正在處理或下一個到抓取線的目標
      const it = project.focusItem();
      if (!it?.grp.visible) return FRONT_FOCUS.clone();
      it.grp.getWorldPosition(focusPoint); focusPoint.x = THREE.MathUtils.clamp(focusPoint.x, ...FRONT_X);
      return focusPoint.clone().setY(900).setZ(b.z);
    }
    const job = st.job ?? jobs.find(j => j.endTau > st.tau);
    if (!job) return OUTFEED.clone();
    const it = project.itemById.get(job.item.id);
    if (it.grp.visible) it.grp.getWorldPosition(focusPoint);
    else focusPoint.set(it.off + st.s, b.top + 2, b.z);
    focusPoint.x = THREE.MathUtils.clamp(focusPoint.x, ...FOCUS_X);
    focusPoint.z = THREE.MathUtils.clamp(focusPoint.z, ...FOCUS_Z);
    return focusPoint.clone().setY(Math.min(FOCUS_Y_MAX, focusPoint.y + it.H / 2));
  };
  // movie.js 要的視角：iso（全景）對到本站的 line（全線）；wiring（整線）本站沒有對應按鈕，在這裡給一個
  // 從 +X 側看後方走道：電盤、地面線槽到機台背面的視角；其餘（electrical）照網頁的 setView。
  const WIRING = [[2300, 1500, -900], [250, 380, -1350]];
  const movieView = (name, instant) => {
    if (name === 'iso') { setView('line', instant, true); return; }
    if (name === 'wiring') { setElectricalCutaway(scene, false); workspace.stopFollowing(); stage.goTo(WIRING[0], WIRING[1], true); return; }
    setView(name, instant, true);
  };
  let movieT = 0;
  installMovie({
    project: decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)),   // 網址的專案資料夾名稱
    title: document.querySelector('.brand .title')?.textContent || document.title,
    glandShots: false,   // 穿板接頭在電盤頂板、上方有防塵簷，「桌板穿線孔」特寫只拍得到簷板
    scene, renderer, camera, controls, setView: movieView, total: project.total, steps,
    sample: t => { movieT = t; project.apply(t); updatePanels(t); },
    // 每格繪製：電盤指示燈依當下狀態更新 → 主畫面
    render: () => {
      const st = project.state;
      electrical.update({ time: movieT, playing: true, action: st.action, motion: st.rate > .01, vision: st.electrical.capture || st.electrical.analysis });
      workspace.renderOverview(renderer, scene);
    },
    focus: movieFocus,
    // 從機台背側（電盤走道上方）斜下約 30° 看：抓取區在手臂底座的背側（−Z），從操作面看會被底座擋住，操作面又有
    // HMI、光幕立柱與標牌；從背側看，主帶面與抓取區在近處、手臂朝鏡頭伸過來、分流帶在後方。追焦 X 在 −700…+600 之間時，
    // 視線穿過背面（Z −730）的位置落在兩根背面立柱（X ±850）之間、頂樑以下，電盤在鏡頭下後方。
    offset: [500, 800, -1300],
  });
}
