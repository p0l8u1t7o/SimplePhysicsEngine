// 動作時序：每拍（穩態）的步驟與時間、CT、甘特圖資料。網頁、project.js、tools/verify.mjs 共用。
// 架構：步進式移載（X 伺服＋升降伺服＋前方夾叉進出氣缸）一次把 P0→P1→P2→P3→P4 的工件全部往下游搬一格；
//       移載期間各站停止，移載完成後 ST1、ST2、翻轉、入料、分料同時作業，CT ＝ 移載段＋最慢的一站。
// 時間全部是示意值（伺服與氣缸依常見規格估計），打樣後以實測修正。
import { CAMERAS } from './optics-plan.js';

// 移載段（秒）
export const XFER = [
  { key: 'forkIn', name: '夾叉伸入', dur: .4, lane: '夾叉進出', axis: '氣缸' },
  { key: 'forkClose', name: '夾叉閉合', dur: .25, lane: '夾叉進出', axis: '氣缸' },
  { key: 'release', name: '夾頭、翻轉夾爪張開', dur: .2, lane: '夾頭', axis: '氣缸' },
  { key: 'lift', name: '移載上升 75 mm（0.4 s）＋等翻轉夾爪空回（0.6 s）', dur: .6, lane: '移載升降', axis: '伺服' },
  { key: 'move', name: '移載前進 450 mm', dur: .7, lane: '移載 X', axis: '伺服' },
  { key: 'lower', name: '移載下降 75 mm', dur: .4, lane: '移載升降', axis: '伺服' },
  { key: 'clamp', name: '夾頭、翻轉夾爪閉合', dur: .25, lane: '夾頭', axis: '氣缸' },
  { key: 'forkOpen', name: '夾叉張開', dur: .2, lane: '夾叉進出', axis: '氣缸' },
  { key: 'forkOut', name: '夾叉退出', dur: .4, lane: '夾叉進出', axis: '氣缸' },
];
export const XFER_TIME = XFER.reduce((s, x) => s + x.dur, 0);
export const PITCH = 450, LIFT = 75;   // 抬升 75 mm：讓工件越過夾頭爪，並在 ST1 越過反射鏡探頭（淨空 25 mm）

// 旋轉取像：12 停（每 30°）；每停 = 轉位 0.08 s＋整定 0.04 s＋取像
export const STOPS = 12, INDEX = .08, SETTLE = .04;
// ST1：C1-1 光度立體 4 張＋亮場 1 張（5MP 約 30 ms／張），旋轉中 C1-2、C1-3、C1-4 同一閃光一起拍（30 ms）
// ST2：C2-1 同軸 2 張；每停 C2-2 三方向＋亮場 4 張（5 MP，約 15 ms／張）＋C2-4 同一閃光（15 ms）
export const SHOTS = {
  ST1: { static: 5 * .03, perStop: .03, staticCams: ['C1-1'], rotCams: ['C1-2', 'C1-3', 'C1-4'] },
  ST2: { static: 2 * .03, perStop: 4 * .015 + .015, staticCams: ['C2-1'], rotCams: ['C2-2', 'C2-4'] },
};
export const stationTime = st => SHOTS[st].static + STOPS * (INDEX + SETTLE + SHOTS[st].perStop);
// 來料角度不固定（2026-11-21）：P0 定位相機判角後，ST1 夾頭在空著時預轉到該角度（移載前進期間做），
// 拍完再把工件轉回標準角度出站（ALIGN），翻轉與 ST2 都是固定角度
export const PRE_ROTATE = .5, ALIGN = .3;
export const ST1_TIME = stationTime('ST1') + ALIGN;
export const FLIP = { turn: .6, settle: .1 };          // 翻轉 180°（伺服）；空回在下一拍夾叉夾走工件、移載上升時做，回到 0° 後移載才前進
export const LIFT_TIME = .4;
export const INTAKE = { convey: 1.5, read: .2 };        // 入料輸送帶送到 V 形擋停（導引置中）＋定位相機判角與讀 QR
export const SORT = { ok: 1.2, ngPush: .5, ngBack: .4, ng: 1.5 };  // OK 由出料輸送帶帶走；NG 推上並排的 NG 輸送帶（可存 8～10 顆）
export const RETURN = .7;                               // 移載退出後 X 返回（與各站作業重疊）
// 影像處理（管線化，不佔 CT）：ST1、ST2 的判定在該件到達分料位（兩拍後）前完成即可
export const PROCESS = { ST1: 1.2, ST2: 1.8 };

export const STATION_TIMES = {
  ST1: ST1_TIME, ST2: stationTime('ST2'), 翻轉: FLIP.turn + FLIP.settle,
  入料: INTAKE.convey + INTAKE.read, 分料: Math.max(SORT.ok, SORT.ngPush + SORT.ngBack), 移載返回: RETURN,
};
export const WORK_TIME = Math.max(...Object.values(STATION_TIMES));
export const CT = XFER_TIME + WORK_TIME;
export const BOTTLENECK = Object.entries(STATION_TIMES).sort((a, b) => b[1] - a[1])[0][0];
// 伺服軸（主方案上限約 6 軸）
export const SERVO_AXES = ['移載 X', '移載升降', 'ST1 旋轉', 'ST2 旋轉', '翻轉', 'NG 分料'];   // 入料轉正用 ST1 旋轉，不加軸

// 一拍的甘特資料：[{ lane, name, start, dur, kind }]（kind：move 機構、shot 取像、wait 等待、proc 影像處理）
export function cycleGantt() {
  const rows = []; let t = 0;
  for (const x of XFER) { rows.push({ lane: x.lane, name: x.name, start: t, dur: x.dur, kind: 'move' }); t += x.dur; }
  // 上升段實際只有 0.35 s，其餘是等翻轉夾爪空回（翻轉軸在搬運路徑下方，夾爪轉到上方時會擋路）
  const liftRow = rows.find(r => r.name.startsWith('移載上升')); liftRow.dur = LIFT_TIME; liftRow.name = '移載上升 75 mm';
  rows.push({ lane: '翻轉', name: '翻轉夾爪空回 180°（經後側）', start: liftRow.start, dur: FLIP.turn, kind: 'move' });
  const moveRow = rows.find(r => r.name.startsWith('移載前進'));
  rows.push({ lane: 'ST1 旋轉', name: '空夾頭預轉到來料角度', start: moveRow.start, dur: PRE_ROTATE, kind: 'move' });
  const w = XFER_TIME;
  rows.push({ lane: '移載 X', name: '移載返回', start: w, dur: RETURN, kind: 'move' });
  for (const st of ['ST1', 'ST2']) {
    const S = SHOTS[st];
    rows.push({ lane: `${st} 取像`, name: `${S.staticCams.join('、')} 靜態取像`, start: w, dur: S.static, kind: 'shot' });
    rows.push({ lane: `${st} 旋轉`, name: `旋轉 12 停 × 30°（${S.rotCams.join('、')}）`, start: w + S.static, dur: stationTime(st) - S.static, kind: 'move' });
    rows.push({ lane: `${st} 取像`, name: '每停取像', start: w + S.static, dur: stationTime(st) - S.static, kind: 'shot' });
    if (st === 'ST1') rows.push({ lane: 'ST1 旋轉', name: '出站轉正', start: w + stationTime(st), dur: ALIGN, kind: 'move' });
    rows.push({ lane: `${st} 判定`, name: `${st} 判定（管線化）`, start: w + (st === 'ST1' ? ST1_TIME : stationTime(st)), dur: PROCESS[st], kind: 'proc' });
  }
  rows.push({ lane: '翻轉', name: '帶件翻轉 180°', start: w, dur: FLIP.turn + FLIP.settle, kind: 'move' });
  rows.push({ lane: '入料', name: '輸送到擋停', start: w, dur: INTAKE.convey, kind: 'move' });
  rows.push({ lane: '入料', name: '判角＋讀 QR', start: w + INTAKE.convey, dur: INTAKE.read, kind: 'shot' });
  rows.push({ lane: '分料', name: 'OK 帶走／NG 推上 NG 輸送帶', start: w, dur: STATION_TIMES.分料, kind: 'move' });
  return rows;
}
export const LANES = ['移載 X', '移載升降', '夾叉進出', '夾頭', '入料', 'ST1 旋轉', 'ST1 取像', '翻轉', 'ST2 旋轉', 'ST2 取像', '分料', 'ST1 判定', 'ST2 判定'];

// 旋轉取像的節奏：第 k 停先在 k×30° 取像（perStop），再轉位到下一停（INDEX）並整定（SETTLE）；12 停後回到 360°＝原位
export const stopPeriod = st => SHOTS[st].perStop + INDEX + SETTLE;
// 站作業開始後 tRel 秒時，工件繞自身軸轉了幾度（0～360）
export function rotationAt(st, tRel) {
  const S = SHOTS[st], p = stopPeriod(st), u = tRel - S.static;
  if (u <= 0) return 0;
  const k = Math.floor(u / p); if (k >= STOPS) return 360;
  const v = u - k * p - S.perStop;
  if (v <= 0) return k * 30;
  const e = Math.min(1, v / INDEX), s = e * e * (3 - 2 * e);
  return (k + s) * 30;
}
// 站作業開始後 tRel 秒時正在取像的張號（第幾停），不在取像就回傳 -1；靜態相機在靜態取像期間回傳 0
export function shotAt(camId, tRel) {
  const cam = CAMERAS.find(c => c.id === camId), S = SHOTS[cam.station];
  if (!cam.frames) return tRel >= 0 && tRel < S.static ? 0 : -1;
  const u = tRel - S.static, p = stopPeriod(cam.station);
  if (u < 0) return -1;
  const k = Math.floor(u / p);
  return k < STOPS && u - k * p < S.perStop ? k : -1;
}
