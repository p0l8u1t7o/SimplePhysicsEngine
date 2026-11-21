// 手臂持件方案（R5）的站位、拍攝段、手臂姿態目標、飛拍時序、逐張控光配方、CT。純計算（three.js 只用矩陣），網頁與 tools/ 共用。
// 世界座標（mm）：Y 向上；手臂基座在原點後方，相機井在前方半圈。工件姿態用 4×4 矩陣（工件座標 → 世界），工件座標見 optics-plan.js。
// 時間全部是示意值（DENSO VS-068 搬 2 kg 級的常見節拍），打樣後以實測修正。
import * as THREE from 'three';
import { derive, realCamera, BAND_CENTER } from './optics-plan.js';
import { RIG, ARM_CAMERAS } from './arm-optics.js';

const D2R = Math.PI / 180;
export const camOf = id => ARM_CAMERAS.find(c => c.id === id);

// ---------------------------------------------------------------- 機台配置
export const CELL = {
  armBase: [0, 905, -40],        // VS-068 基座底面中心（台座頂）；J2 高 1250
  armYaw: 165,                   // 基座繞 Y 轉向（°）：J1 = 0 朝取件位，工作點都在 J1 ±160° 內
  present: 1150,                 // 開口朝下各拍攝段的夾持帶中心高度
  well: 520,                     // 相機井底板高度（相機立柱從這裡往上）
  table: 900,                    // 輸送帶面高（入料：開口朝下站在凸緣頂；出料：法蘭朝下站在止口端）
  pick: [-560, 0, -150],         // 入料取件位（X、Z；高度由輸送帶面算）
  stand: [-330, 1060, -470],     // 換夾台夾持帶中心
  okOut: [560, 0, -120], ngOut: [560, 0, -360],   // OK／NG 輸送帶放件位
  fence: { x: [-1250, 1250], z: [-900, 1050], h: 2000 },
};
export const GRIP_LEN = 128;     // 手臂法蘭面 → 夾持帶中心（TCP）：夾爪本體 48＋爪柱 80

// ---------------------------------------------------------------- 工件姿態
// 開口朝下（O）：工件 +Z → 世界 −Y；yaw 決定工件 +X 的水平方向（0＝世界 +Z）
export function poseO(at, yawDeg) {
  const y = yawDeg * D2R, X = new THREE.Vector3(Math.sin(y), 0, Math.cos(y)), Z = new THREE.Vector3(0, -1, 0), Y = Z.clone().cross(X);
  return fromAxes(X, Y, Z, at);
}
// 法蘭朝下（F）：工件 −Z → 世界 −Y
export function poseF(at, yawDeg) {
  const y = yawDeg * D2R, X = new THREE.Vector3(Math.sin(y), 0, Math.cos(y)), Z = new THREE.Vector3(0, 1, 0), Y = Z.clone().cross(X);
  return fromAxes(X, Y, Z, at);
}
// 軸 X、Y、Z（工件座標軸在世界的方向）、夾持帶中心 at → 工件座標到世界的矩陣
function fromAxes(X, Y, Z, at) {
  const R = new THREE.Matrix4().makeBasis(X, Y, Z), c = new THREE.Vector3(...at);
  const off = new THREE.Vector3(0, 0, -BAND_CENTER).applyMatrix4(R);      // 工件原點 = 帶中心 − R·(0,0,BAND)
  return R.setPosition(c.add(off));
}
// 第 k 張（工件繞自身軸轉 k×30°，與 coverage.js 的 rotZ(−φ) 一致）
export const poseAt = (T, deg) => T.clone().multiply(new THREE.Matrix4().makeRotationZ(deg * D2R));
export const bandCenter = T => new THREE.Vector3(0, 0, BAND_CENTER).applyMatrix4(T);
export const partPoint = (T, p) => new THREE.Vector3(...p).applyMatrix4(T);
export const partDir = (T, v) => new THREE.Vector3(...v).transformDirection(T);

// 相機座標（x 右、y 上、z 往後＝−視線）→ 工件座標
function camFrame(cam, real = false) {
  const dv = derive(cam), rc = real ? realCamera(cam, dv) : dv, fwd = new THREE.Vector3(...rc.fwd).normalize();
  const up0 = new THREE.Vector3(...rc.up), right = fwd.clone().cross(up0).normalize(), up = right.clone().cross(fwd).normalize();
  return new THREE.Matrix4().makeBasis(right, up, fwd.clone().negate()).setPosition(...rc.pos);
}

// ---------------------------------------------------------------- 拍攝段
// place：自由擺放的拍攝段（工件姿態直接給）；from：由已固定的實體相機反推工件姿態（相機繞光軸的轉角 β 取「工件軸最接近鉛直」）
// speed：第 6 軸飛拍時的等速（°/s）；perPos：每個位置連拍張數（光度立體 3 方向）；statics：轉之前的靜態張數
export const SEGMENTS = [
  { id: 'O1', name: '開口側①反射鏡探頭（杯內壁 8、9）', side: 'O', cams: ['R3-8'], place: { at: [-430, CELL.present, 260], yaw: -60 }, speed: 450, insert: 90 },
  { id: 'O2', name: '開口側②同軸杯底＋Ø28 孔壁（7、10、12、11）', side: 'O', cams: ['R2-7', 'R5-11'], place: { at: [0, CELL.present, 520], yaw: 0 }, speed: 450 },
  { id: 'O3', name: '開口側③凸緣外側＋開口端面（5、6）', side: 'O', cams: ['R4-5'], place: { at: [430, CELL.present, 260], yaw: 60 }, speed: 300, perPos: 3 },
  { id: 'F1', name: '法蘭側①頂視＋止口（1、4、3）', side: 'F', cams: ['R1-1', 'R4-3'], from: 'R4', speed: 300, statics: 5 },
  { id: 'F2', name: '法蘭側② Ø22 軸孔（2）', side: 'F', cams: ['R5-2'], from: 'R5', speed: 450 },
];

// 姿態與相機位置（世界）：依 SEGMENTS 順序決定；回傳 { seg: { T }, rig: { W（相機座標 → 世界）}, real: { R3 實際相機 } }
let layoutCache;
export function layout() {
  if (layoutCache) return layoutCache;
  const segT = {}, rigW = {};
  for (const s of SEGMENTS) {
    let T;
    if (s.place) T = (s.side === 'O' ? poseO : poseF)(s.place.at, s.place.yaw);
    else {
      const cam = ARM_CAMERAS.find(c => c.seg === s.id && c.rig === s.from), W = rigW[s.from], Cinv = camFrame(cam).invert();
      let best = null;
      for (let b = 0; b < 360; b += .5) {
        const Tb = W.clone().multiply(new THREE.Matrix4().makeRotationZ(b * D2R)).multiply(Cinv);
        const axis = partDir(Tb, [0, 0, s.side === 'F' ? -1 : 1]), score = -axis.y;
        if (!best || score > best.score + 1e-9) best = { score, T: Tb, b };
      }
      T = best.T; s.roll = best.b; s.tilt = Math.acos(Math.min(1, best.score)) / D2R;
    }
    segT[s.id] = T;
    for (const id of s.cams) { const c = camOf(id); if (!rigW[c.rig]) rigW[c.rig] = T.clone().multiply(camFrame(c)); }
  }
  const r3 = camOf('R3-8'), real = { R3: segT.O1.clone().multiply(camFrame(r3, true)) };
  layoutCache = { segT, rigW, real };
  return layoutCache;
}
// 實體相機在世界的位置與視線
export function rigPose(rig) {
  const { rigW, real } = layout(), W = real[rig] || rigW[rig];
  const pos = new THREE.Vector3().setFromMatrixPosition(W), fwd = new THREE.Vector3(0, 0, -1).transformDirection(W), up = new THREE.Vector3(0, 1, 0).transformDirection(W);
  return { W, pos, fwd, up };
}

// ---------------------------------------------------------------- 飛拍：第 6 軸等速旋轉中依時間觸發
// 一段：加速 30°（2×30/ω 秒）→ 等速 330°（12 個位置，每 30° 一組）→ 減速 30°；每個位置 perPos 張（間隔 1/fps）
export const RAMP_DEG = 30;
export function segmentTiming(s) {
  const w = s.speed, statics = s.statics || 0, perPos = s.perPos || 1;
  const fps = Math.min(...s.cams.map(id => RIG[camOf(id).rig].fps));
  const tStatic = statics * (1 / fps + .01);
  const accel = 2 * RAMP_DEG / w, run = 330 / w;
  return { statics, perPos, fps, tStatic, accel, run, rotate: accel * 2 + run, total: tStatic + accel * 2 + run + (perPos - 1) / fps };
}

// 拍攝位置 × 光源配方（每張可各自設亮度；示意值，打樣時以標準樣品校正後鎖進配方）
// ch：光源通道；bright：亮度（% 額定，過驅動頻閃可到 500%）；pulse：發光脈寬（µs）；exp：相機曝光（µs）；gain：增益（dB）
export const RECIPE = [
  { seg: 'O1', cam: 'R3-8', faces: [8, 9], ch: '探頭條形光', bright: 320, pulse: 50, exp: 60, gain: 6, per: 1 },
  { seg: 'O2', cam: 'R2-7', faces: [10, 12], ch: '同軸光（亮場）', bright: 40, pulse: 40, exp: 50, gain: 0, per: 1, statics: true },
  { seg: 'O2', cam: 'R2-7', faces: [7], ch: '同軸光（暗場、提亮）', bright: 260, pulse: 40, exp: 50, gain: 6, per: 1, statics: true },
  { seg: 'O2', cam: 'R5-11', faces: [11], ch: '鏡頭環形光', bright: 180, pulse: 40, exp: 50, gain: 3, per: 1 },
  { seg: 'O3', cam: 'R4-5', faces: [5, 6], ch: '左條形光', bright: 300, pulse: 30, exp: 40, gain: 6, per: 1 },
  { seg: 'O3', cam: 'R4-5', faces: [5, 6], ch: '右條形光', bright: 300, pulse: 30, exp: 40, gain: 6, per: 1 },
  { seg: 'O3', cam: 'R4-5', faces: [5, 6], ch: '鏡頭環形光', bright: 150, pulse: 30, exp: 40, gain: 3, per: 1 },
  { seg: 'F1', cam: 'R1-1', faces: [1, 4], ch: '分區環形光 4 區＋亮場（橫越刀紋）', bright: 220, pulse: 60, exp: 80, gain: 3, per: 5, statics: true },
  { seg: 'F1', cam: 'R1-1', faces: [1, 4], ch: '扇區切向條形光（沿刀紋）', bright: 350, pulse: 60, exp: 80, gain: 6, per: 1 },
  { seg: 'F1', cam: 'R4-3', faces: [3], ch: '頂條形光', bright: 280, pulse: 30, exp: 40, gain: 6, per: 1 },
  { seg: 'F2', cam: 'R5-2', faces: [2], ch: '鏡頭環形光', bright: 120, pulse: 40, exp: 50, gain: 3, per: 1 },
];
// 曝光上限：飛拍拖影 ≤ 0.5 px（線速 = ω × 面上最大半徑）
const R_MAX = { 'R3-8': 46.8, 'R2-7': 49, 'R5-11': 14, 'R4-5': 60.5, 'R1-1': 60.5, 'R4-3': 40, 'R5-2': 11 };
export function exposureLimit(camId) {
  const cam = camOf(camId), s = SEGMENTS.find(x => x.id === cam.seg), mmpx = derive(cam).mmpx;
  const v = s.speed * D2R * R_MAX[camId];                       // mm/s
  return { v: Math.round(v), us: Math.round(.5 * mmpx / v * 1e6) };
}

// ---------------------------------------------------------------- 手臂動作（一顆一拍，全部串在手臂上）
// 每一步：key、名稱、秒數；kind：move 手臂移動、grip 夾爪／換夾台、shot 拍攝段、wait 等判定
export const STEPS = [
  { key: 'pickDown', name: '下降取件', dur: .2, kind: 'move' },
  { key: 'pickGrip', name: '夾爪閉合（夾 Ø100 帶開口側半段，從法蘭側）', dur: .15, kind: 'grip' },
  { key: 'pickUp', name: '上升', dur: .2, kind: 'move' },
  { key: 'toO1', name: '移到探頭上方', dur: .45, kind: 'move' },
  { key: 'O1in', name: '杯口罩住探頭（沿工件軸下降）', dur: .25, kind: 'move' },
  { key: 'O1', seg: 'O1', kind: 'shot' },
  { key: 'O1out', name: '沿工件軸上升離開探頭', dur: .25, kind: 'move' },
  { key: 'toO2', name: '移到同軸＋孔壁拍攝位', dur: .4, kind: 'move' },
  { key: 'O2', seg: 'O2', kind: 'shot' },
  { key: 'toO3', name: '移到外側拍攝位', dur: .4, kind: 'move' },
  { key: 'O3', seg: 'O3', kind: 'shot' },
  { key: 'toStand', name: '移到換夾台上方', dur: .5, kind: 'move' },
  { key: 'standDown', name: '下降放入換夾台', dur: .2, kind: 'move' },
  { key: 'standClamp', name: '換夾台夾指閉合（夾帶法蘭側半段）', dur: .15, kind: 'grip' },
  { key: 'release', name: '夾爪張開', dur: .15, kind: 'grip' },
  { key: 'standUp', name: '上升讓出翻轉空間', dur: .2, kind: 'move' },
  { key: 'flip', name: '換夾台翻轉 180°（氣動旋轉缸）', dur: .5, kind: 'grip' },
  { key: 'regripDown', name: '下降（從開口側）', dur: .2, kind: 'move' },
  { key: 'regrip', name: '夾爪閉合', dur: .15, kind: 'grip' },
  { key: 'standOpen', name: '換夾台夾指張開', dur: .15, kind: 'grip' },
  { key: 'regripUp', name: '上升', dur: .2, kind: 'move' },
  { key: 'toF1', name: '移到法蘭側拍攝位①', dur: .5, kind: 'move' },
  { key: 'F1', seg: 'F1', kind: 'shot' },
  { key: 'toF2', name: '移到法蘭側拍攝位②', dur: .4, kind: 'move' },
  { key: 'F2', seg: 'F2', kind: 'shot' },
  { key: 'toOut', name: '移到出料（途中取判定結果，決定 OK／NG 帶）', dur: .5, kind: 'move' },
  { key: 'outDown', name: '下降放件', dur: .2, kind: 'move' },
  { key: 'outOpen', name: '夾爪張開', dur: .15, kind: 'grip' },
  { key: 'outUp', name: '上升', dur: .2, kind: 'move' },
  { key: 'toPick', name: '回到取件位上方', dur: .55, kind: 'move' },
];
for (const st of STEPS) if (st.seg) { const s = SEGMENTS.find(x => x.id === st.seg); st.dur = segmentTiming(s).total; st.name = `飛拍 ${s.name}`; }
export const ARM_CT = STEPS.reduce((a, s) => a + s.dur, 0);
// 一拍內各步的開始時間
export const STEP_AT = (() => { let t = 0; const o = {}; for (const s of STEPS) { o[s.key] = t; t += s.dur; } return o; })();
// 判定點：往出料移動到一半時要知道 OK／NG（OK、NG 帶並排，路徑在後半段才分開）
export const DECIDE_AT = STEP_AT.toOut + STEPS.find(s => s.key === 'toOut').dur * .5;
export const ARM_AXES = ['手臂 J1～J6（DENSO VS-068）'];   // 伺服 6 軸都在手臂上；換夾台、夾爪為氣動

// ---------------------------------------------------------------- 每一張的拍攝時間（一拍內，相對拍攝段開始）
// 回傳 [{ seg, cam, k（第幾張＝工件角度 k×30°，靜態張為 -1）, t, ch, bright, pulse, exp }]
export function segmentShots(s, k0 = 0) {
  const tm = segmentTiming(s), out = [];
  for (const r of RECIPE.filter(x => x.seg === s.id && x.statics)) {
    const n = r.per; for (let i = 0; i < n; i++) out.push({ seg: s.id, cam: r.cam, k: -1, t: out.length / tm.fps, ch: r.ch, bright: r.bright, pulse: r.pulse, exp: r.exp, faces: r.faces });
  }
  const t0 = tm.tStatic + tm.accel, rot = RECIPE.filter(x => x.seg === s.id && !x.statics);
  for (let i = 0; i < 12; i++) {
    const k = (k0 + i) % 12, tPos = t0 + i * 30 / s.speed;
    // 同一位置：不同相機同一閃（同時曝光）；同一台相機的多組光源依序連拍（1/fps）
    const byCam = {};
    for (const r of rot) { const j = (byCam[r.cam] = (byCam[r.cam] ?? -1) + 1); out.push({ seg: s.id, cam: r.cam, k, t: tPos + j / tm.fps, ch: r.ch, bright: r.bright, pulse: r.pulse, exp: r.exp, faces: r.faces }); }
  }
  return out.sort((a, b) => a.t - b.t);
}
