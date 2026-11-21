// 取像配置：每台相機與光源在「工件座標」下的位姿、鏡頭、視野、解析度、景深，以及夾爪（遮擋物）。
// 工件座標：Z 為工件軸（ST2 開口朝上時 +Z 朝上；ST1 法蘭面朝上時 −Z 朝上），方位角 0° 為工件 +X。
// 旋轉取像：工件繞 Z 轉 φ，等同相機與光源在工件座標下繞 Z 轉 −φ。
// 型號一律為示意（sensor 只給像素與像元），選型待打樣與詢價。網頁、tools/plan.mjs、tools/verify.mjs 共用。
import { GRIP_BAND } from './body.js';

export const LAMBDA = 0.52e-3;        // mm，綠光
export const TARGET_MMPX = 0.1;       // 規格目標：≤ 0.1 mm/px（0.8 mm 瑕疵至少 8 px）
export const MAX_VIEW_ANGLE = 70;     // 視線與面法向夾角上限（°）；超過視為擦過角，不算看到
// 景深用解析度換：DOF_max ≈ b² / (1.22 λ)；b 為物方允許模糊（mm）
export const dofOf = b => b * b / (1.22 * LAMBDA);
export const blurFor = dof => Math.sqrt(dof * 1.22 * LAMBDA);

export const SENSORS = {
  '5MP': { px: [2448, 2048], pitch: 3.45e-3, label: '5 MP（2448×2048，3.45 µm，2/3″）' },
  '1.6MP': { px: [1440, 1080], pitch: 3.45e-3, label: '1.6 MP（1440×1080，3.45 µm，1/2.9″）' },
};

const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// 方位角 az、與 +Z 軸夾角 tilt 的單位向量（從目標指向相機）
export const dirAzTilt = (az, tilt) => [Math.sin(rad(tilt)) * Math.cos(rad(az)), Math.sin(rad(tilt)) * Math.sin(rad(az)), Math.cos(rad(tilt))];

// 相機：faces 負責的檢測面；target 對焦中心（工件座標）；toCam 從目標指向相機（單位）；f 焦距；fovH 物方視野短邊（mm）；
// frames 每圈張數（0＝不轉、只拍一張）；b 設計允許模糊（mm）；planes 焦面數；light 光源設定
export const CAMERAS = [
  // ---------------- ST1：法蘭面朝上（看 −Z 側）
  { id: 'C1-1', station: 'ST1', name: '頂視全幅', faces: [1, 4], sensor: '5MP', f: 16, fovH: 110, lens: '16 mm 定焦（大景深）',
    target: [0, 0, -65.3], toCam: [0, 0, -1], up: [0, 1, 0], frames: 12, roiAz: 0, b: .2, planes: 1,
    // 加工刀紋（車削，沿圓周）：主影像用 0° 方位扇區兩側的切向條形光（沿刀紋打，刀紋不亮），工件旋轉 12 停、每停只用 ±20° 扇區；
    // 分區環形光 4 區保留為第二道影像（橫越刀紋，刀紋會亮，用來抓和刀紋平行的刮傷）
    light: { type: '扇區切向條形光 ×2（沿刀紋，主影像）＋分區環形光 4 區（橫越刀紋）', kind: 'sectorBars', bars: [[[12, 62, -165], [64, 62, -165]], [[12, -62, -165], [64, -62, -165]]],
      aux: { kind: 'ring', r: 115, at: -165, center: [0, 0], segments: 4 }, note: '條形光與環形光都在法蘭面上方 101 mm（讓出移載抬升 75 mm 的空間）' } },
  { id: 'C1-2', station: 'ST1', name: '斜視軸孔', faces: [2], sensor: '1.6MP', f: 35, fovH: 18, lens: '35 mm 定焦＋鏡頭環形光',
    target: [0, -11, -64.5], toCam: dirAzTilt(90, 135), up: [0, 0, -1], frames: 12, b: .2, planes: 1,
    light: { type: '鏡頭環形光（同軸方向）', kind: 'lensRing', r: 30, note: '照在對側孔壁，入射角≈視角 45°' } },
  { id: 'C1-3', station: 'ST1', name: '側視止口', faces: [3], sensor: '1.6MP', f: 25, fovH: 30, lens: '25 mm 定焦',
    target: [40, 0, -66], toCam: dirAzTilt(0, 105), up: [0, 0, -1], frames: 12, b: .2, planes: 1,
    light: { type: '條形光（相機上方 90 mm）', kind: 'bar', offset: [0, 0, -90], length: 80, note: '從上方（軸向）打；抬到 90 mm 讓刀紋斜面的散射（±40°）照不到相機' } },
  // 90° 反射鏡正視杯內壁（2026-11-21 採用）：ST1 開口朝下，探頭穿過中空 DD 從下方固定伸入杯內，工件放下時罩住探頭。
  //   這裡的 target／toCam 描述「鏡中的虛像相機」（正對內壁）；mirror 是 45° 表面鍍膜反射鏡，實際相機在杯口下方、沿 −Z 往上看。
  //   45° 鏡讓壁上各點到相機的光程相同，景深只剩弧面矢高。
  { id: 'C1-4', station: 'ST1', name: '反射鏡正視杯內壁', faces: [8, 9], sensor: '1.6MP', f: 25, fovH: 52, lens: '25 mm 定焦＋45° 反射鏡探頭＋鏡頭環形光',
    target: [46.5, 0, -23.5], toCam: [-1, 0, 0], up: [0, 0, 1], frames: 12, b: .2, planes: 1,
    mirror: { point: [10, 0, -23.5], normal: [Math.SQRT1_2, 0, Math.SQRT1_2], halfU: 36, halfV: 23 },
    light: { type: '探頭條形光（杯口外、近側斜照，暗場）', kind: 'probeBar', direct: true, a: [35, -22, 20], b: [35, 22, 20], note: '高反光內壁：光源放在杯口外、偏離鏡面反射方向 ≥ 19°，整面暗場（鏡頭環形光經反射鏡會在內凹壁上形成 9～23% 的亮帶，已改掉）；鏡面朝下、落屑掉在鏡背；相機鏡頭朝上需保護窗＋吹氣' } },
  // ---------------- ST2：開口朝上（看 +Z 側）
  { id: 'C2-1', station: 'ST2', name: '頂視杯底（同軸）', faces: [7, 10, 12], sensor: '5MP', f: 25, fovH: 98, lens: '25 mm 定焦＋同軸光',
    target: [0, 0, -55], toCam: [0, 0, 1], up: [0, 1, 0], frames: 0, b: .1, planes: 1,
    light: { type: '同軸光（出光口 Ø50）', kind: 'coaxial', aperture: 25, note: '面 10、12 均勻亮場（砂孔是暗點）；面 7 在視野外緣、落在暗場（出光口 Ø100 時面 7 剛好卡在亮暗交界，反光散開 4～8° 就會翻轉，已縮小）；2026-11-21 起兼拍面 7（原由 C2-3 斜視）' } },
  { id: 'C2-2', station: 'ST2', name: '斜視外側（凸緣外側＋開口端面）', faces: [5, 6], sensor: '5MP', f: 35, fovH: 40, lens: '35 mm 定焦＋鏡頭環形光',
    target: [-53, 0, -2], toCam: dirAzTilt(180, 45), up: [0, 0, 1], frames: 12, b: .2, planes: 1,
    light: { type: '光度立體 3 方向：左右條形光＋鏡頭環形光', kind: 'psSide', h: 105, d: 70, r: 50, note: '2026-11-21 由原 C2-2（頂視面 6）與 C2-5（側視面 5）合併；45° 斜視同時看凸緣外側與開口端面，ST2 上方只剩同軸 C2-1' } },
  { id: 'C2-4', station: 'ST2', name: '斜視凸台孔壁', faces: [11], sensor: '1.6MP', f: 50, fovH: 18, lens: '50 mm 定焦＋鏡頭環形光',
    target: [0, 14, -57.9], toCam: dirAzTilt(270, 40), up: [0, 0, 1], frames: 12, b: .2, planes: 1,
    light: { type: '鏡頭環形光', kind: 'lensRing', r: 30, note: '視線受杯口凸緣限制 ≤ 43.7°，取 40°' } },
];

// P0 定位相機（不屬於 12 面檢測）：法蘭面朝上俯視整顆＋輸送帶下方背光，從開口側 3 耳（15／125／235°，間隔不對稱）的輪廓判角度，同時讀 QR
export const LOCATOR = { id: 'C0', name: 'P0 定位相機（判角＋讀 QR）', sensor: '5MP', f: 16, fovH: 130, wd: 300, light: '背光（輸送帶滾筒下方）＋環形光（讀 QR）' };

// 選配：3D 雷射輪廓（只評估外側平面 1、4、6；杯內與孔內有遮擋死角）
export const LASERS = [
  { id: 'L1', station: 'ST1', faces: [4], name: '雷射輪廓（選配）', width: 39, note: 'LJ-X8080 級，寬 39 mm、徑向掃法蘭面；一圈 7,500 條 @0.05 mm' },
  { id: 'L2', station: 'ST2', faces: [6], name: '雷射輪廓（選配）', width: 39, note: '同上，掃開口端面' },
];

// 夾持（工件座標，2026-11-21 拍板夾 Ø100 外圓帶 Z −16 ~ −45，避開 150–210° 凹面板）：
//   旋轉夾頭 3 爪 0/120/240°，夾開口側半段（Z −18 ~ −28）；
//   移載夾叉 90/270°（從機台前方側入、沿世界 X 夾），夾法蘭側半段（Z −34 ~ −44）；
//   翻轉夾爪 90/270°（夾點在翻轉軸上），夾開口側半段（Z −17 ~ −27）。同時夾同一顆的兩組夾具一定錯開半段。
//   帶中心 −30.5 對稱：翻面後兩個半段在世界高度上互換，移載各組夾叉依所搬工件的姿態各自設定高度。
export const JAWS = { angles: [0, 120, 240], z: [-28, -18], width: 14, depth: 12, stroke: 14 };   // stroke：每爪開合行程（張開時內面在 r 64，大於下降時經過爪頭的最大外徑 60.5）
export const FINGERS = { angles: [90, 270], z: [-44, -34], width: 16, depth: 10 };
export const FLIP_FINGERS = { angles: [90, 270], z: [-27, -17], width: 16, depth: 10 };
export const BAND_CENTER = -30.5;
// 夾頭爪的立柱往夾頭底座方向延伸：ST2 底座在下（−Z），ST1 底座在下（+Z，開口側朝下）
export function jawBoxes(station) {
  const out = [], r0 = GRIP_BAND.r;
  for (const a of JAWS.angles) {
    const c = Math.cos(rad(a)), s = Math.sin(rad(a)), radial = [c, s, 0], tang = [-s, c, 0];
    const zc = (JAWS.z[0] + JAWS.z[1]) / 2, hz = (JAWS.z[1] - JAWS.z[0]) / 2;
    // 爪頭：r 50 ~ 74
    out.push({ center: [(r0 + 12) * c, (r0 + 12) * s, zc], ax: radial.map(v => v * 12), ay: tang.map(v => v * JAWS.width / 2), az: [0, 0, hz] });
    // 立柱：r 64 ~ 74，往底座延伸 80 mm
    const z1 = station === 'ST2' ? JAWS.z[0] : JAWS.z[1], z2 = station === 'ST2' ? -110 : 50;
    out.push({ center: [69 * c, 69 * s, (z1 + z2) / 2], ax: radial.map(v => v * 5), ay: tang.map(v => v * JAWS.width / 2), az: [0, 0, Math.abs(z2 - z1) / 2] });
  }
  return out;
}

// 衍生量：倍率、工作距離、mm/px、景深、相機位置與座標系（工件座標、第 0 張）
export function derive(cam) {
  const S = SENSORS[cam.sensor], sh = S.px[1] * S.pitch, sw = S.px[0] * S.pitch;
  const m = sh / cam.fovH, fovW = sw / m, wd = cam.f * (1 + m) / m;       // 物距（由主點起算，示意）
  const mmpx = cam.fovH / S.px[1], dof = dofOf(cam.b) * cam.planes;
  const N = cam.b * m / (2.44 * LAMBDA * (1 + m));                       // 使繞射模糊＝b 的工作光圈
  const d = norm(cam.toCam), fwd = d.map(v => -v);                     // fwd：相機看出去的方向
  const right = norm(cross(fwd, cam.up)), up = cross(right, fwd);
  const pos = cam.target.map((v, k) => v + d[k] * wd);
  return { m, wd, fovW, fovH: cam.fovH, mmpx, dof, N, pos, fwd, right, up, sensor: S };
}

// 反射鏡相機：虛像相機（derive 的結果）對鏡面反射，得到實際相機的位置與朝向（工件座標、第 0 張）
const reflectP = (p, m) => { const d = (p[0] - m.point[0]) * m.normal[0] + (p[1] - m.point[1]) * m.normal[1] + (p[2] - m.point[2]) * m.normal[2]; return p.map((v, i) => v - 2 * d * m.normal[i]); };
const reflectV = (v, m) => { const d = v[0] * m.normal[0] + v[1] * m.normal[1] + v[2] * m.normal[2]; return v.map((x, i) => x - 2 * d * m.normal[i]); };
export function realCamera(cam, dv = derive(cam)) {
  if (!cam.mirror) return { pos: dv.pos, fwd: dv.fwd, right: dv.right, up: dv.up };
  const m = cam.mirror;
  return { pos: reflectP(dv.pos, m), fwd: reflectV(dv.fwd, m), right: reflectV(dv.right, m), up: reflectV(dv.up, m) };
}
// 從 p 沿單位向量 d 前進，打到鏡面的距離；不在鏡面範圍內回傳 null（第 φ 張時鏡面隨相機繞 Z 轉 −φ）
export function mirrorHit(m, p, d, phi = 0) {
  const pt = rotZ(m.point, phi), n = rotZ(m.normal, phi);
  const den = d[0] * n[0] + d[1] * n[1] + d[2] * n[2]; if (Math.abs(den) < 1e-9) return null;
  const t = ((pt[0] - p[0]) * n[0] + (pt[1] - p[1]) * n[1] + (pt[2] - p[2]) * n[2]) / den; if (t <= 0) return null;
  const q = p.map((v, i) => v + d[i] * t - pt[i]);
  const v = rotZ([0, 1, 0], phi), u = cross(n, v);                    // 鏡面上的兩個方向（u：沿 45° 斜邊、v：切向）
  const qu = q[0] * u[0] + q[1] * u[1] + q[2] * u[2], qv = q[0] * v[0] + q[1] * v[1] + q[2] * v[2];
  return Math.abs(qu) <= m.halfU && Math.abs(qv) <= m.halfV ? t : null;
}

// 繞 Z 轉 −φ（第 k 張）
export function rotZ(v, phiDeg) {
  const c = Math.cos(rad(-phiDeg)), s = Math.sin(rad(-phiDeg));
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
}
export const frameAngles = cam => cam.frames ? Array.from({ length: cam.frames }, (_, k) => k * 360 / cam.frames) : [0];

// 光源的發光取樣點（工件座標、第 0 張）
export function lightPoints(cam, dv = derive(cam)) {
  const L = cam.light, pts = [];
  if (L.kind === 'coaxial') pts.push(dv.pos);
  else if (L.kind === 'lensRing') for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; pts.push(dv.pos.map((p, i) => p + L.r * (Math.cos(a) * dv.right[i] + Math.sin(a) * dv.up[i]))); }
  else if (L.kind === 'ring') for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8; pts.push([L.center[0] + L.r * Math.cos(a), L.center[1] + L.r * Math.sin(a), L.at]); }
  else if (L.kind === 'bar') for (let k = -2; k <= 2; k++) pts.push(dv.pos.map((p, i) => p + L.offset[i] + k * L.length / 4 * dv.right[i] + .5 * dv.wd * dv.fwd[i]));
  else if (L.kind === 'probeBar') for (let k = 0; k <= 4; k++) pts.push(L.a.map((v, i) => v + (L.b[i] - v) * k / 4));
  else if (L.kind === 'sectorBars') for (const [a, b] of L.bars) for (let k = 0; k <= 4; k++) pts.push(a.map((v, i) => v + (b[i] - v) * k / 4));
  else if (L.kind === 'psSide') {
    // 光度立體 3 方向：目標左右兩支條形光（切線方向，各取 3 點）＋鏡頭環形光（8 點）
    const t = cam.target, rl = Math.hypot(t[0], t[1]), o = [t[0] / rl, t[1] / rl], tg = [-o[1], o[0]];
    for (const sd of [1, -1]) for (let k = -1; k <= 1; k++) pts.push([t[0] + sd * L.d * tg[0] + k * 20 * o[0], t[1] + sd * L.d * tg[1] + k * 20 * o[1], t[2] + L.h]);
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; pts.push(dv.pos.map((p, i) => p + L.r * (Math.cos(a) * dv.right[i] + Math.sin(a) * dv.up[i]))); }
  }
  return pts;
}
export { deg, rad, norm, cross };
