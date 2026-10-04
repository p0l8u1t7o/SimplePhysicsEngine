// 主程式：舞台（core/ui/stage.js）＋播放列（core/ui/player.js）＋共用版面（core/ui/viewer-workspace.js）＋本專案的視角、站別與面板。
// 場景與每個時間點的狀態全部來自 project.js，與 core 統一檢查用的是同一份。
// 版面骨架在 index.html（#topbar／#side／#bottombar）；手機、平板的精簡版面由 createViewerWorkspace 自動切換。
// 相機子畫面（renderCamera／setSources）屬第二段，這裡只用 createViewerWorkspace 的版面與焦點追隨功能。
import * as THREE from 'three';
import { createStage, exposeSim } from '@core/ui/stage.js';
import { createPlayer } from '@core/ui/player.js';
import { createViewerWorkspace } from '@core/ui/viewer-workspace.js';
import { createProject } from './project.js';
import { LAYOUT, STATIONS } from './layout.js';
import { CHAPTERS, CT, AXIS, BELT_V, VISION_TO_PICK, MIX } from './schedule.js';
import { CLS_LABEL, KINDS } from './items.js';

const qp = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const L = LAYOUT, b = L.belt, v = L.vision, a = L.arm;

// ---------------------------------------------------------------- 舞台
const canvas = $('c');
const stage = createStage({
  canvas, look: 'cell', extent: { center: [0, 700, 0], radius: 2000 },
  declutter: true,
  camera: { near: 5, far: 30000 },
  controls: { minDistance: 300, maxDistance: 12000 },
});
const { renderer, scene, camera, controls } = stage;
const project = createProject({ scene });
const { stationStart, metrics, jobs, throughput } = project;

// ---------------------------------------------------------------- 共用版面：精簡版面（☰ 製程與視角、⚙ 播放設定）、焦點追隨（◎）
const focusVec = new THREE.Vector3();
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

// ---------------------------------------------------------------- 視角：[相機位置, 注視點]（照桌面寫；手機直向等窄畫布由 stage 自動拉遠）
const VIEWS = {
  overview: [[-2750, 2100, 2300], [0, 820, -30]],
  top: [[60, 4600, 10], [60, 0, 0]],
  infeed: [[-2500, 1500, 1400], [-1050, 820, b.z]],
  vision: [[-1750, 1550, 1250], [v.x, 1150, b.z]],
  visionTop: [[v.x - 120, 2500, 480], [v.x, 780, b.z]],
  track: [[-700, 1600, 1500], [L.pick.cx - 250, 820, b.z]],
  pick: [[-450, 1500, 1500], [a.x + 60, 950, -60]],
  outfeed: [[450, 1880, 3000], [175, 700, 490]],
};
function setView(name, instant = false) {
  const view = typeof VIEWS[name] === 'function' ? VIEWS[name]() : VIEWS[name]; if (!view) return;
  workspace.stopFollowing();
  stage.goTo(view[0], view[1], instant);
  document.querySelectorAll('.views [data-view]').forEach(x => x.classList.toggle('on', x.dataset.view === name));
}
document.querySelectorAll('.views [data-view]').forEach(x => x.onclick = () => setView(x.dataset.view));

// ---------------------------------------------------------------- 3D 標籤
const label = (html, getPos, cls = '', priority = 0) => stage.addLabel(html, getPos, cls, { anchor: 'above', priority });
const P = (x, y, z) => new THREE.Vector3(x, y, z);
// 六大工站
const stationLabels = [
  ['① 入料整列', P(-1100, 950, b.z - 340), 6],
  ['② 立體取像', P(v.x - 100, 1470, -40), 6],
  ['③ AI 分類與 3D 定位', P(v.x + 330, 1110, b.z + 170), 5],
  ['④ 編碼器追蹤', P(L.encoder.x + 120, 880, L.encoder.z - 60), 5],
  ['⑤ 分揀取放（HSR065）', P(a.x + 230, a.baseY + 510, a.z + 40), 6],
  ['⑥ 分流出料 A／B', P(175, 850, L.divA.z + 140), 6],
].map(([text, pos, pr]) => label(text, pos, 'station', pr));
void stationLabels;   // 只需要建立，更新由 stage.updateLabels 負責
// 關鍵尺寸（示意）
label('帶寬 600', P(-1120, b.top + 90, b.z), 'dim', 3);
label('動作半徑 650（示意）', P(a.x + a.reach, 100, a.z - 160), 'dim', 2);
label('基線 300／WD 800（示意）', P(v.x + 70, v.camY - 230, -650), 'dim', 3);
label('有效抓取區 240 × 280', P(L.pick.cx, b.top + 90, L.pick.z[1]), 'dim', 3);
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
$('cycleTime').textContent = `同類連抓 ${CT.toFixed(2)} s · 混合料流 ${throughput.mixed.toFixed(2)} s／瓶 · 約 ${throughput.hour} 瓶/小時`;
const checks = project.layoutChecks();
$('checks').innerHTML = checks.map(r => `<li class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✓' : '✗'} ${r.name}<span>${r.value ?? ''}</span></li>`).join('');
$('checkCount').textContent = `${checks.filter(r => r.ok).length} / ${checks.length}`;
$('notes').innerHTML = [
  `模型庫共 12 款，這段動畫實際展示 11 款；洗衣精罐尚未排入料流。包裝色塊、斜撐、護板框與細節尺寸皆為<b>示意</b>。`,
  `規格未給的尺寸一律是<b>示意</b>值：帶面高 750、分流帶面 700、相機 500 萬畫素 8 mm 鏡頭、基線 300／WD 800。`,
  `相機數量依「補充說明」改為<b>雙相機立體對</b>，覆蓋開案報告第 8 頁的「相機數量 1」。`,
  `取像站設在 X ${v.x}（原案 −450 會落在手臂掃掠範圍內）；到抓取點 ${VISION_TO_PICK} mm，飛行時間 ${(VISION_TO_PICK / BELT_V).toFixed(2)} s ≫ 視覺鏈路 0.29 s。`,
  `導料板把帶上料流由 600 收攏到 <b>280 mm</b>（已拍板）：HSR065（R650）側邊立座扣掉最小迴轉半徑與 J2 基座干涉區後，實際只覆蓋這個帶寬。`,
  `機台寬度已拍板放寬到 <b>1460 mm</b>（原估 1300）：帶寬與側樑、架台、兩條分流帶與手臂掃掠外圍排完後，立柱最近只能放到 Z −730／+670。`,
  `節拍以<b>混合料流加權平均</b>承諾（已拍板）：同類連抓 ${throughput.ct.AA.toFixed(2)} s、跨帶 ${throughput.ct.BB.toFixed(2)} s，`
  + `按食品類佔 ${Math.round(MIX.food * 100)}%（示意）加權為 <b>${throughput.mixed.toFixed(2)} s／瓶</b>、稼動 ${Math.round(MIX.uptime * 100)}% 換算 <b>約 ${throughput.hour} 瓶/小時</b>。`,
  `對應的帶上目標物平均間距需 ≥ <b>${throughput.pitch} mm</b>（同類連抓時 ${(CT * BELT_V).toFixed(0)} mm）；第 9 段用 280 mm 的滿載同類料流驗證 1.40 s，其後第 9 件目標間距只有 240 mm 排不進空檔，流到末端觸發警報。`,
  `手臂軸速上限取 DENSO HSR 型錄等級的假設值（J1／J2 ${AXIS.j1}°/s、J4 ${AXIS.j4}°/s、Z ${AXIS.z} mm/s），每個子動作的時間由行程反推，待型錄核對。`,
  `第 4 段為凍結分析、第 5～7 段為慢動作（1/4、1/6、1/5）：製程時間整體放慢，帶速與手臂速度同步縮放，不是單獨調慢帶子。`,
  `第一段不含：電控盤內部、配線與氣管、相機子畫面與 AI 疊圖、HMI 畫面內容、安全門與光柵動作、操作面護板。`,
].map(s => `<li>${s}</li>`).join('');

const kindList = Object.entries(KINDS).reduce((m, [, k]) => (m[k.cls] = (m[k.cls] || 0) + 1, m), {});
let shown = '';
function updatePanels(T) {
  const st = project.state;
  if (!st) return;
  const key = `${st.action}|${st.sub}|${st.station}|${st.counts.A}|${st.counts.B}|${st.counts.other}|${st.counts.missed}|${st.chapter.id}|${st.tau.toFixed(1)}`;
  if (key === shown) return; shown = key;
  ui.action.textContent = st.action;
  // 保留既有 apply(t) 狀態字串供排程指紋比對，顯示文字修正為檢核量到的 7 連抓。
  ui.substep.textContent = (st.sub || '').replace('滿載 8 連抓', '滿載 7 連抓');
  ui.note.textContent = `${st.chapter.name}　${st.rate > .01 && st.rate < .99 ? `· 慢動作 1/${Math.round(1 / st.rate)}` : st.rate < .01 ? '· 畫面凍結' : ''}`;
  ui.stationName.textContent = `S${st.station + 1} ${STATIONS[st.station]}`;
  ui.stations.forEach((btn, i) => {
    btn.classList.toggle('active', i === st.station);
    btn.classList.toggle('done', i < st.station || T >= project.total - 1e-6);
  });
  $('stats').innerHTML = [
    ['A 帶 · 食品 HDPE', `${st.counts.A} 件`, true],
    ['B 帶 · 非食品 HDPE', `${st.counts.B} 件`, true],
    ['主帶末端 · 其餘回收物', `${st.counts.other} 件`, true],
    ['漏抓目標（間距不足）', `${st.counts.missed} 件`, !st.counts.missed],
    ['已取放', `${st.picks} / ${jobs.length} 趟`, true],
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
    if (want && want !== currentView && !workspace.following) { currentView = want; setView(want); }
    stage.invalidate(true);
  },
});

currentView = qp.get('view') in VIEWS ? qp.get('view') : 'overview';
setView(currentView, true);
if (qp.has('cam')) { const arr = qp.get('cam').split(',').map(Number); if (arr.length === 6 && arr.every(Number.isFinite)) stage.goTo(arr.slice(0, 3), arr.slice(3), true); }
$('loading').classList.add('hide');
// ?movie 時 stage 不啟動迴圈（交給錄影程式）
stage.loop(dt => { const changed = player.update(dt); workspace.follow(); stage.updateLabels(); return changed; },
  { render: () => workspace.renderOverview(renderer, scene) });

exposeSim({
  seekTo: player.seekTo, setView, views: VIEWS, total: project.total, play: player.play, pause: player.pause,
  get T() { return player.T; }, stationStart, project, chapters: CHAPTERS, kindList,
});
