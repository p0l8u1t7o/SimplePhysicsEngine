// 製程排程：敘事段落、播放速率（含慢動作與凍結分析）、帶上工件清單。
// 網頁（main.js、project.js）與 tools/verify.mjs 共用同一份，所以檢查的就是畫面上的節拍。
//
// 關鍵設計：整個動畫只有一個時間尺度參數 rate(t)——「製程時間相對於播放時間的速率」。
//   製程時間 τ(t) = ∫rate dt；帶面行程 s = 主帶帶速 × τ；分流帶行程 = 1.5 × s。
//   rate = 1 為實時、1/6 為慢動作展示、0 為凍結（AI 分析段）。手臂的每個子動作時間也以製程時間計，
//   所以慢動作段的帶速、手臂速度、節拍彼此一致，不是把帶子單獨調慢的假畫面。
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

// ---------------------------------------------------------------- 播放速率（播放時間 → 製程時間）
// [t0, t1, rate0, rate1]；rate 在段內線性變化，所以 τ 在段內是二次式，倒序取樣也一致。
export const RATE = [
  [0, 9.5, 0, 0],            // 概觀：機台待機
  [9.5, 10.3, 0, 1],         // 啟動
  [10.3, 30.0, 1, 1],        // 入料、立體取像（實時）
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
// 滿載段實測連續 1.40 s 的鏈為 7 連抓；原 note 屬 apply(t) 的既有狀態，顯示端更正其文字。
export const CHAPTERS = [
  { id: 'overview', name: '系統概觀', t: [0, 10], station: 0, view: 'overview', note: '整機外觀與六大工站、動作半徑 650 與帶寬 600' },
  { id: 'infeed', name: '入料上帶', t: [10, 20], station: 1, view: 'infeed', note: '導料板把混合回收物由 600 收攏到帶中央 280 mm' },
  { id: 'vision', name: '立體取像', t: [20, 30.8], station: 2, view: 'vision', note: '雙相機同步觸發 60 fps、基線 300、工作距離 800' },
  { id: 'ai', name: 'AI 分類與 3D 定位', t: [30.8, 41], station: 3, view: 'visionTop', note: '實例分割 → 材質與食品屬性；左右視差 → 頂面高度與長軸角度' },
  { id: 'track', name: '編碼器追蹤', t: [41, 48.8], station: 4, view: 'track', note: '座標隨帶位置推進，進入 240 mm 追蹤窗口排隊（1/4 慢動作）' },
  { id: 'pickA', name: '取料：食品 HDPE', t: [48.8, 59.4], station: 5, view: 'pick', note: '七個子動作拆解，投放到 A 帶（1/6 慢動作）' },
  { id: 'pickB', name: '取料：非食品 HDPE', t: [59.4, 68.6], station: 5, view: 'pick', note: '同一手臂改投放到 B 帶；擺幅較大，單趟節拍比 1.40 s 長（1/5 慢動作）' },
  { id: 'pass', name: '混合料流與非目標續流', t: [68.6, 74.6], station: 5, view: 'outfeed', note: 'PET／鐵罐／薄膜不抓，由主帶末端續流；非食品 HDPE 轉到 B 帶（跨帶擺幅大，單趟節拍較長）' },
  { id: 'burst', name: '連續運轉節拍 CT 1.4 s', t: [74.6, 88], station: 5, view: 'overview', note: '食品 HDPE 滿載 8 連抓驗證同類節拍 1.40 s；第 9 件目標間距不足被漏抓' },
  { id: 'result', name: '分流結果與承諾產能', t: [88, 96], station: 6, view: 'outfeed', note: 'A／B 兩路成果統計、漏抓警報，以及混合料流加權平均節拍換算的承諾產能' },
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

// 固定的橫向位置與長軸角度（確定性的擬隨機，不用 Math.random，倒序與跳播結果才一致）。
// lat 是正規化的橫向位置（−1…1）：實際 Z 由 project.js 依導料板在該 X 的開口寬度換算，所以物件一定在板內。
const lat = i => +Math.sin(i * 2.3 + .7).toFixed(4);
const theta = i => +(.9 * Math.sin(i * 1.7 + 1.1)).toFixed(4);            // ±52°

/** 工件清單：{ id, kind, cls, off, lat, theta, H, L, W } */
export const ITEMS = ITEM_TABLE.map(([kind, off], i) => ({
  id: i, kind, cls: KINDS[kind].cls, off, lat: lat(i), theta: theta(i),
  H: KINDS[kind].H, L: KINDS[kind].L, W: KINDS[kind].W,
}));
