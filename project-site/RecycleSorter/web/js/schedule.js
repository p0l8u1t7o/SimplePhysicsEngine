// 製程排程：敘事段落、播放速率（含慢動作與凍結分析）、帶上工件清單。
// 網頁（main.js、project.js）與 tools/verify.mjs 共用同一份，所以檢查的就是畫面上的節拍。
//
// 關鍵設計：整個動畫只有一個時間尺度參數 rate(t)——「製程時間相對於播放時間的速率」。
//   製程時間 τ(t) = ∫rate dt；帶面行程 s = 主帶帶速 × τ；分流帶行程 = 1.5 × s。
//   rate = 1 為實時、1/6 為慢動作展示、0 為凍結（AI 分析段）。手臂的每個子動作時間也以製程時間計，
//   所以慢動作段的帶速、手臂速度、節拍彼此一致，不是把帶子單獨調慢的假畫面。
//
// 2026-10-05 補上前段（現場既有的 ABB 分選站）：播放時間在最前面多 24 s 的前段敘事（54 s 之後就是原本 30 s 之後的內容），
// 製程時間整體後移 PRE_ROLL = 6 s（帶上工件一起往上游退 1200 mm），所以後段的取放工單、節拍與相對時序都沒有變。
import { LAYOUT } from './layout.js';
import { KINDS } from './items.js';

export const CT = 1.40;                        // 同類連抓的節拍（s/瓶），開案報告第 4、8 頁規格
export const BELT_V = LAYOUT.belt.v;           // 200 mm/s
export const VISION_TO_PICK = LAYOUT.pick.cx - LAYOUT.vision.x;   // 取像站到抓取點 850 mm

// 混合料流的組成假設（示意，待客戶提供實際比例）：目標 HDPE 中食品類佔 60%、稼動率 85%。
// 已拍板「以混合料流加權平均承諾」（ct-mixed）：產能以 mixedCT() 的加權平均節拍換算，
// 1.40 s 只作為「同類連抓」的能力值。
export const MIX = { food: .6, uptime: .85 };

/**
 * 混合料流的加權平均節拍。ct 是四種轉移的單趟節拍 { AA, AB, BA, BB }
 * （前一趟投到 A／B × 這一趟投到 A／B），food 是目標中食品類的比例。
 * 料流視為獨立取樣，所以轉移機率就是兩個比例的乘積。
 */
export function mixedCT(ct, food = MIX.food) {
  const p = food, q = 1 - food;
  return p * p * ct.AA + p * q * ct.AB + q * p * ct.BA + q * q * ct.BB;
}
export const perHour = (ctSec, uptime = MIX.uptime) => Math.round(3600 / ctSec * uptime);

// 手臂軸速上限（示意）：DENSO HSR 型錄等級的假設值。模型 meta 的 speed 註明是型錄 50%，這裡以型錄級核算。
// 每個子動作的實際時間由「關節行程 ÷ 軸速上限 × 梯形曲線峰值係數」決定，不夠就自動加長（見 project.js durFor）。
export const AXIS = { j1: 700, j2: 700, j4: 1400, z: 2200 };      // °/s、°/s、°/s、mm/s

// ---------------------------------------------------------------- 手臂取放的七個子動作
// dur 是「同一側連續取放」的基準時間，合計 = CT 1.40 s。跨到另一條分流帶時擺幅變大，
// 接近段與搬移段會依軸速上限自動加長（所以 B 帶單趟節拍比 1.40 s 長，見側欄註記）。
export const PHASES = [
  { key: 'approach', dur: .30, action: '移到抓取點上方', sub: 'J1／J2 迴轉、J4 依長軸角度擺正、同步帶速追蹤' },
  { key: 'descend', dur: .24, action: 'Z 軸下降、吸盤浮動接觸', sub: '氣壓浮動桿吸收立體量測的高度誤差' },
  { key: 'vacuum', dur: .10, action: '真空建立、吸附確認', sub: '真空開關確認後才允許上升' },
  { key: 'lift', dur: .21, action: 'Z 軸上升到搬運高度', sub: '吸盤面 Y 1070（帶面上 320）' },
  { key: 'swing', dur: .33, action: '搬移到投放點上方', sub: '' },
  { key: 'lower', dur: .17, action: '下降到投放高度', sub: '吸盤面 Y 920（分流帶面上 220）' },
  { key: 'release', dur: .05, action: '破真空吹氣釋放', sub: '空瓶自由落下到分流帶' },
];
export const GRAB_PHASES = 3;                  // 前三段結束＝抓取瞬間

// ---------------------------------------------------------------- 前段 ABB 並聯手臂的六個子動作（示意）
// 合計 1.15 s／件：吸嘴接大口徑軟管、放料要橫移到旁邊的既有分類帶，所以比型錄的空載節拍慢得多。待現場實測。
// 規則（project.js 的 ABB 排程）：目標進到抓取線前後 ±window 的窗口時手臂有空就抓；
// 上一件還沒放完、趕不到，就放行——由後段補抓站接手。
export const ABB_PHASES = [
  { key: 'approach', dur: .28, action: 'ABB：移到目標上方', sub: '依前段立體取像的座標與編碼器位置同步帶速' },
  { key: 'descend', dur: .17, action: 'ABB：下降、吸嘴貼近頂面', sub: '下降量取自立體量測的頂面高度' },
  { key: 'vacuum', dur: .10, action: 'ABB：吸附', sub: '吸塵器式真空源，大流量吸附' },
  { key: 'lift', dur: .16, action: 'ABB：上升到搬運高度', sub: '' },
  { key: 'traverse', dur: .32, action: 'ABB：橫移到分類帶上方', sub: '' },
  { key: 'release', dur: .12, action: 'ABB：放料', sub: '工件落在既有分類帶上，由帶尾進收料箱' },
];
export const ABB_CT = +ABB_PHASES.reduce((s, p) => s + p.dur, 0).toFixed(3);

// ---------------------------------------------------------------- 播放速率（播放時間 → 製程時間）
// [t0, t1, rate0, rate1]；rate 在段內線性變化，所以 τ 在段內是二次式，倒序取樣也一致。
// 前段（0～54 s）用「長度, rate0, rate1」列出，累加成 [t0, t1, rate0, rate1]；54 s 之後是原本 30 s 之後的後段，整體後移 24 s。
// PRE_ROLL：製程時間後移的秒數＝前段預跑 3 s（工件先流進前段取像站，畫面才凍結分析）＋ABB 到後段多出的 600 mm 路程 3 s（中間放既有電控櫃）
export const PRE_ROLL = 6;
const FRONT_RATE = [
  [9.5, 0, 0],               // 概觀：全線待機
  [.8, 0, 1],                // 啟動
  [3.75, 1, 1],              // 上游入料、前段立體取像（實時）
  [.8, 1, 0],                // 取像完成，畫面凍結
  [8.72, 0, 0],              // 前段 AI 分類、高度量測與抓取分配（凍結分析）
  [.8, 0, 1],                // 恢復
  [4.7, 1, 1],               // 編碼器追蹤到 ABB，ABB 正常抓取一件（實時）
  [.6, 1, .2],
  [10, .2, .2],              // ABB 抓取＋緊跟在後的目標放行（1/5 慢動作）
  [.6, .2, 1],
  [13.73, 1, 1],             // 放行的目標沿同一條皮帶流向後段：刮料簾、導料板、後段立體取像（實時）
];
const REAR_SHIFT = 24, REAR_RATE = [
  [30.0, 30.8, 1, 0],        // 取像完成，畫面凍結
  [30.8, 41.0, 0, 0],        // AI 分類與 3D 定位（凍結分析）
  [41.0, 41.6, 0, .24],      // 恢復
  [41.6, 48.0, .24, .24],    // 編碼器追蹤（1/4 慢動作）
  [48.0, 48.8, .24, 1 / 6],
  [48.8, 59.2, 1 / 6, 1 / 6],  // 取料：食品 HDPE（1/6 慢動作）
  [59.2, 59.6, 1 / 6, .2],
  [59.6, 67.8, .2, .2],      // 取料：非食品 HDPE（1/5 慢動作）
  [67.8, 68.6, .2, 1],
  [68.6, 93.6, 1, 1],        // 混合料流、連續運轉節拍、分流結果（實時）
  [93.6, 94.4, 1, 0],        // 停機
  [94.4, 96.0, 0, 0],
];
export const RATE = (() => {
  const rows = []; let t = 0;
  for (const [dur, r0, r1] of FRONT_RATE) { rows.push([+t.toFixed(4), +(t + dur).toFixed(4), r0, r1]); t += dur; }
  for (const [t0, t1, r0, r1] of REAR_RATE) rows.push([+(t0 + REAR_SHIFT).toFixed(4), +(t1 + REAR_SHIFT).toFixed(4), r0, r1]);
  return rows;
})();
export const TOTAL = RATE.at(-1)[1];

/** 播放時間 ↔ 製程時間。回傳 { tau(t), rate(t), timeAt(τ), tauTotal } */
export function createTiming(table = RATE) {
  const segs = [];
  let acc = 0;
  for (const [t0, t1, r0, r1] of table) {
    const dur = t1 - t0, d = (r0 + r1) / 2 * dur;
    segs.push({ t0, t1, dur, r0, r1, tau0: acc, tau1: acc + d }); acc += d;
  }
  const seg = t => { for (const s of segs) if (t < s.t1) return s; return segs.at(-1); };
  return {
    tauTotal: acc,
    rate(t) { const s = seg(t), u = s.dur > 0 ? Math.min(1, Math.max(0, (t - s.t0) / s.dur)) : 1; return s.r0 + (s.r1 - s.r0) * u; },
    tau(t) {
      const s = seg(t); if (t >= s.t1) return s.tau1;
      const u = Math.max(0, (t - s.t0) / s.dur);
      return s.tau0 + (s.r0 * u + (s.r1 - s.r0) * u * u / 2) * s.dur;
    },
    // 製程時間 → 播放時間（凍結段取該段起點）
    timeAt(tau) {
      const s = segs.find(x => tau <= x.tau1 + 1e-9) ?? segs.at(-1);
      if (s.tau1 - s.tau0 < 1e-9) return s.t0;
      const need = (tau - s.tau0) / s.dur, A = (s.r1 - s.r0) / 2, B = s.r0;
      const u = Math.abs(A) < 1e-9 ? need / B : (-B + Math.sqrt(Math.max(0, B * B + 4 * A * need))) / (2 * A);
      return s.t0 + Math.min(1, Math.max(0, u)) * s.dur;
    },
  };
}

// ---------------------------------------------------------------- 敘事段落（播放列的步驟與預設視角）
// front：前段的段落——面板與焦點追隨改看 ABB；flow：側欄「整合流程」目前亮哪一步（見 FLOW）。
export const CHAPTERS = [
  { id: 'overview', name: '全線概觀', t: [0, 10], station: 0, view: 'line', flow: -1, front: true, note: '同一條既有皮帶上：上游是既有的 ABB 分選站，下游是後段補抓站；兩站都用新的雙相機立體視覺，共用一座電控櫃' },
  { id: 'frontVision', name: '前段整列與立體取像', t: [10, 14.85], station: 1, view: 'frontVision', flow: 0, front: true, note: '刮料簾把疊料攤成單層、導料板收到 400 mm；新視覺取代既有相機，規格與後段完全相同（基線 300、工作距離 800）' },
  { id: 'frontAI', name: '前段 AI 分類與抓取分配', t: [14.85, 24.4], station: 1, view: 'frontTop', flow: 1, front: true, note: '分類、頂面高度與角度一次算出；ABB 節拍內抓得到的派給 ABB，緊跟在後的標記為交後段' },
  { id: 'abbTrack', name: 'ABB 追蹤與抓取', t: [24.4, 29.1], station: 2, view: 'abb', flow: 2, front: true, note: '座標隨編碼器推進 1400 mm 到抓取線；落單的目標 ABB 一趟 1.15 s 抓走，放到旁邊的既有分類帶（實時）' },
  { id: 'abbPick', name: 'ABB 抓取與放行', t: [29.1, 40.3], station: 2, view: 'abbPick', flow: 2, front: true, note: '兩件相鄰 100 mm：前一件抓走放上分類帶，後一件進窗口時手臂還沒空，放行（1/5 慢動作）' },
  { id: 'handoff', name: '放行目標交後段', t: [40.3, 48.5], station: 2, view: 'handoff', flow: 3, front: true, note: '放行清單（類別、高度、編碼器位置）在同一座電控櫃內交給後段；工件沿同一條皮帶流向補抓站' },
  { id: 'infeed', name: '後段整列', t: [48.5, 51.5], station: 3, view: 'infeed', flow: 4, note: '第二道刮料簾與導料板把料流由 400 收到帶中央 280 mm，工件位置會偏移，所以後段要再取像' },
  { id: 'vision', name: '後段立體取像', t: [51.5, 54.8], station: 4, view: 'vision', flow: 4, note: '雙相機同步觸發 60 fps、基線 300、工作距離 800，對放行目標重新定位' },
  { id: 'ai', name: 'AI 分類與 3D 定位', t: [54.8, 65], station: 5, view: 'visionTop', flow: 4, note: '實例分割 → 材質與食品屬性；左右視差 → 頂面高度與長軸角度' },
  { id: 'track', name: '編碼器追蹤', t: [65, 72.8], station: 6, view: 'track', flow: 5, note: '座標隨帶位置推進，進入 240 mm 追蹤窗口排隊（1/4 慢動作）' },
  { id: 'pickA', name: '補抓：食品 HDPE', t: [72.8, 83.4], station: 7, view: 'pick', flow: 5, note: '七個子動作拆解，投放到 A 帶（1/6 慢動作）' },
  { id: 'pickB', name: '補抓：非食品 HDPE', t: [83.4, 92.6], station: 7, view: 'pick', flow: 5, note: '同一手臂改投放到 B 帶；擺幅較大，單趟節拍比 1.40 s 長（1/5 慢動作）' },
  { id: 'pass', name: '混合料流與非目標續流', t: [92.6, 98.6], station: 7, view: 'outfeed', flow: 5, note: 'PET／鐵罐／薄膜不抓，由皮帶末端續流；非食品 HDPE 轉到 B 帶（跨帶擺幅大，單趟節拍較長）' },
  { id: 'burst', name: '後段連續運轉節拍 CT 1.4 s', t: [98.6, 112], station: 7, view: 'overview', flow: 5, note: '前段剛才每 1.4 s 抓一件、放行一件，放行的 9 件接連到後段：滿載 7 連抓驗證同類節拍 1.40 s，最後一件間距只有 240 mm 被漏抓' },
  { id: 'result', name: '分流結果與承諾產能', t: [112, 120], station: 8, view: 'outfeed', flow: 6, note: '前段、後段兩路成果統計、漏抓警報，以及後段混合料流加權平均節拍換算的承諾產能' },
];
// 整合流程（側欄）：新視覺系統把兩支手臂串成一條線
export const FLOW = [
  '刮料簾、導料板整列 → 前段立體取像',
  'AI 分類＋頂面高度＋抓取分配',
  'ABB 並聯手臂抓取 → 既有分類帶',
  '放行清單交後段（編碼器追蹤）',
  '後段整列、立體取像再定位',
  'DENSO SCARA 補抓 → A／B 分流',
  '統計、漏抓警報與產能',
];
export const chapterAt = t => CHAPTERS.find(c => t < c.t[1]) ?? CHAPTERS.at(-1);

// ---------------------------------------------------------------- 帶上工件清單
// off＝帶面行程 s = 0 時的 X 座標（負值＝還在上游，尚未進入帶子）。工件 X = off + s。
// 目標物的抓取瞬間剛好在抓取點 cx，所以 off = cx − BELT_V × τ(抓取)；間距必須大於兩件半長之和。
const ITEM_TABLE = [
  // 前段：混合料流（全為非目標物，在第一次取料之前通過抓取點）
  ['crushed', -40], ['pet', -540], ['film', -1040], ['can', -1540], ['carton', -2040],
  ['crushed', -2540], ['pet', -3040], ['film', -3540], ['can', -4040],
  // 慢動作示範的兩件目標物
  ['milkJug', -4460],      // 食品 HDPE → A 帶（第 6 段）
  ['shampoo', -4840],      // 非食品 HDPE → B 帶（第 7 段）
  // 第 8 段：混合料流，夾兩件非食品 HDPE（跨帶擺幅大，間距放寬到 360 mm 以上）
  ['carton', -5170], ['alcohol', -5450], ['crushed', -5810], ['shampoo', -6050], ['pet', -6290],
  // 第 9 段：滿載連抓（全為食品 HDPE → A 帶，間距 280 mm＝CT 1.40 s × 帶速）
  ['yogurt', -6570], ['lactic', -6850], ['milkBottle', -7130], ['milkJug', -7410],
  ['yogurt', -7690], ['lactic', -7970], ['milkBottle', -8250], ['milkJug', -8530],
  ['yogurt', -8770],       // 第 9 件目標：間距只有 240 mm < 280 mm → 漏抓 → 末端警報
  // 尾段
  ['carton', -9150], ['pet', -9550], ['crushed', -9950],
];

// 前段 ABB 會抓走的目標（off 與上表同一基準）。附加在表尾：既有 28 件的編號、橫向位置與角度都不變，後段工單才不會動。
// 排法：每件後段要補抓的目標前方 100 mm 各放一件——ABB 抓前一件的 1.15 s 內，後一件已經通過 ±50 mm 的窗口。
// 最前面兩件與最後六件是落單的目標（ABB 正常抓走）；尾段另補四件非目標物，後段連抓時上游仍有料流。
// 洗衣精罐從這裡排入料流，模型庫 12 款都有展示。
const ABB_TABLE = [
  ['pet', -10500], ['can', -11000], ['film', -11500], ['carton', -12000],      // 尾段的非目標物（續流到皮帶末端）
  ['lactic', -2790], ['alcohol', -3790],
  ['yogurt', -4360], ['lactic', -4740],                       // 牛奶罐、洗髮精罐的前一件
  ['milkBottle', -5350], ['yogurt', -5960],                  // 混合料流段
  ['yogurt', -6470], ['alcohol', -6750], ['lactic', -7030], ['yogurt', -7310],   // 滿載段：每 280 mm 一件
  ['milkBottle', -7590], ['alcohol', -7870], ['lactic', -8150], ['yogurt', -8430],
  ['alcohol', -8670],
  ['alcohol', -9350], ['milkJug', -9750], ['detergent', -10250], ['shampoo', -10750], ['alcohol', -11250], ['alcohol', -11750],   // 尾段：落單的目標
];

// 固定的橫向位置與長軸角度（確定性的擬隨機，不用 Math.random，倒序與跳播結果才一致）。
// lat 是正規化的橫向位置（−1…1）：實際 Z 依導料板在該 X 的開口寬度換算（zOf），所以物件一定在板內。
const lat = i => +Math.sin(i * 2.3 + .7).toFixed(4);
const theta = i => +(.9 * Math.sin(i * 1.7 + 1.1)).toFixed(4);            // ±52°

/** 兩件工件在帶面上的外接矩形（俯視）之間的間隙；負值＝重疊。a、b：{ x, z, theta, L, W } */
export function footprintGap(a, b) {
  const axes = it => [[Math.cos(it.theta), -Math.sin(it.theta)], [Math.sin(it.theta), Math.cos(it.theta)]];
  const half = (it, [ux, uz]) => { const [p, q] = axes(it); return it.L / 2 * Math.abs(p[0] * ux + p[1] * uz) + it.W / 2 * Math.abs(q[0] * ux + q[1] * uz); };
  let gap = -Infinity;
  for (const u of [...axes(a), ...axes(b)]) gap = Math.max(gap, Math.abs((b.x - a.x) * u[0] + (b.z - a.z) * u[1]) - half(a, u) - half(b, u));
  return gap;
}

// ---------------------------------------------------------------- 料流通道：兩段導料板
// 前段導料板把料流由 600 收到 400（立體相機的雙眼重疊視野），後段導料板再由 400 收到 280（SCARA 的有效抓取帶寬），
// 同時把中心由皮帶中心移到抓取區中心。抓取點（X ≥ 後段導料板出口）的寬度與中心和補上前段之前相同。
const FG = LAYOUT.frontGuide, RG = LAYOUT.guide;
const ramp = (x, [a, b]) => Math.min(1, Math.max(0, (x - a) / (b - a)));
/** X 處的料流通道：{ gap 板間開口, center 中心線 Z } */
export function laneAt(x) {
  const f = ramp(x, FG.x), r = ramp(x, RG.x);
  return { gap: FG.open + (FG.close - FG.open) * f + (RG.close - RG.open) * r, center: LAYOUT.belt.z + (LAYOUT.pick.cz - LAYOUT.belt.z) * r };
}
const extentOf = it => it.L * Math.abs(Math.sin(it.theta)) + it.W * Math.abs(Math.cos(it.theta));
/** 工件沿輸送方向的半長（含瓶蓋凸出的 12 mm） */
export const leadOf = it => (it.L * Math.abs(Math.cos(it.theta)) + it.W * Math.abs(Math.sin(it.theta))) / 2 + 12;
/**
 * 工件中心在 X 處的橫向位置：離板面至少 margin/2。通道寬度取工件「前緣」所在的位置——
 * 導料板是斜的，前緣先碰到比較窄的地方；板子以外的直段前緣與中心的寬度相同，結果不變。
 */
export const zOf = (it, x) => { const { gap, center } = laneAt(x + leadOf(it)); return center + it.lat * Math.max(0, (gap - RG.margin - extentOf(it)) / 2); };
/** 取樣通道的三個寬度（600、400、280）各一處，檢查工件間隙用 */
export const LANE_X = [FG.x[0] - 100, (FG.x[1] + RG.x[0]) / 2, RG.x[1] + 100];

/** 工件清單：{ id, kind, cls, off, lat, theta, H, L, W, front? }；front＝排給前段 ABB 的目標（不會流到後段） */
export const ITEMS = (() => {
  const base = ITEM_TABLE.map(([kind, off], i) => ({
    id: i, kind, cls: KINDS[kind].cls, off: off - PRE_ROLL * BELT_V, lat: lat(i), theta: theta(i),
    H: KINDS[kind].H, L: KINDS[kind].L, W: KINDS[kind].W,
  }));
  // ABB 目標的橫向位置與角度：在通道內找一個離鄰近工件最遠的擺法（600 與 400 兩種寬度都要讓得開；純計算，結果固定）
  const at = (it, x) => ({ ...it, x: it.off, z: zOf(it, x) }), n0 = base.length;
  ABB_TABLE.forEach(([kind, off], k) => {
    const i = n0 + k, K = KINDS[kind];
    const it = { id: i, kind, cls: K.cls, off: off - PRE_ROLL * BELT_V, lat: lat(i), theta: theta(i), H: K.H, L: K.L, W: K.W };
    if (K.cls !== 'other') {                                                       // 非目標物會流過後段的導料板，照既有工件的算法；目標另外找位置
      // 大致順著輸送方向擺（±9° 內），並排時才讓得開；橫向位置與角度一起找
      it.front = true;
      const near = base.filter(o => Math.abs(o.off - it.off) < 420);
      let best = null;
      for (const th of [0, -.08, .08, -.16, .16]) for (let j = -20; j <= 20; j++) {
        const cand = { ...it, lat: j / 20, theta: th };
        const gap = Math.min(999, ...near.flatMap(o => LANE_X.slice(0, 2).map(x => footprintGap(at(cand, x), at(o, x)))));
        if (!best || gap > best.gap + 1e-9) best = { lat: cand.lat, theta: th, gap };
      }
      it.lat = best.lat; it.theta = best.theta;
    }
    base.push(it);
  });
  return base;
})();
