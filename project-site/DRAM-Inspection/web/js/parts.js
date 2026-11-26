// 產品模型：載台、主機板 PCB、interposer 連接件、SOCAMM 記憶體、M2 螺絲、Tray 盤。全部尺寸為示意（mm），待實物與圖面確認。
// 零件本地座標：長邊沿 +X、Y 向上、原點在本體底面中心。零件位置每格由 project.js 依時間直接設定（不換父群組）。
// 不碰 DOM：細部紋路用合併幾何（PIN、焊墊、被動元件），文字用 shapes.js 的 decal（Node 端自動略過）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { decal } from '@core/geom/shapes.js';
import { MAT, std } from '@core/geom/materials.js';

// ---------------------------------------------------------------- 尺寸（示意）
export const MOD = {
  L: 90, W: 14,                         // SOCAMM／interposer 外形（長 × 寬）
  holes: [-41, 4.5, 41],                // 三個孔（沿長邊）：兩端與偏中間的一孔（照片：中間孔偏右）
  holeR: 1.25,                          // 孔半徑（M2 螺絲穿過；取放頭漲緊銷 Ø2.2 也從這裡插入）
};
export const INT = { t: 1.2, pin: .45, rows: 6, cols: 36, pitchX: 2.3, pitchZ: 2.05, bossR: 2.3, bossH: .95 };
export const SOC = { t: 1.0, pkgH: 1.1, ringR: 3.1 };
export const PCB = { w: 300, d: 240, t: 2.4, holeR: 2.45 };
export const CARRIER = { w: 340, t: 8, standoff: 6 };
// 疊層間隙（不讓兩個面重合；PIN 尖端插入 0.05～0.3 mm 代表接觸與壓縮）
export const STACK = { intGap: .35, socFree: .4, socPressed: .15 };

const gold = std(0xd8b25a, .28, .9);
const copper = std(0xc88a55, .32, .85);
const pcbGreen = std(0x14432c, .55, .05);
const pcbBlack = std(0x15181b, .5, .1);
const intBody = std(0x1b1d20, .55, .05);
const pkgMat = std(0x0c0d0f, .45, .05);
const silver = std(0xb9c0c7, .3, .8);
const passive = std(0x7a6a52, .5, .1);
const trayMat = std(0x1d232b, .7, .02);
const carrierMat = std(0x2a2f36, .45, .5);

// 板狀外形（圓角矩形＋孔），擠出方向轉成 +Y（底面 y=0、頂面 y=t）
function plateGeometry(w, d, t, r, holes = [], holeR = 1) {
  const s = new THREE.Shape(), x0 = -w / 2, z0 = -d / 2;
  s.moveTo(x0 + r, z0); s.lineTo(x0 + w - r, z0); s.quadraticCurveTo(x0 + w, z0, x0 + w, z0 + r);
  s.lineTo(x0 + w, z0 + d - r); s.quadraticCurveTo(x0 + w, z0 + d, x0 + w - r, z0 + d);
  s.lineTo(x0 + r, z0 + d); s.quadraticCurveTo(x0, z0 + d, x0, z0 + d - r); s.lineTo(x0, z0 + r); s.quadraticCurveTo(x0, z0, x0 + r, z0);
  for (const [hx, hz, hr] of holes) { const h = new THREE.Path(); h.absarc(hx, hz, hr ?? holeR, 0, Math.PI * 2, true); s.holes.push(h); }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 10 });
  g.rotateX(Math.PI / 2); g.translate(0, t, 0);     // 繞 X 轉 90°：shape 的 y → 世界 z；擠出 +z → 世界 −y，平移讓底面在 0
  return g;
}
// 多個小方塊合併成一個幾何（只留位置與法線）
function boxes(list) {
  if (!list.length) return null;
  const parts = list.map(([w, h, d, x, y, z]) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); b.deleteAttribute('uv'); return b; });
  return mergeGeometries(parts);
}
function rings(list, rIn, rOut, h, segments = 20) {
  const parts = list.map(([x, y, z]) => {
    const pts = [new THREE.Vector2(rIn, 0), new THREE.Vector2(rOut, 0), new THREE.Vector2(rOut, h), new THREE.Vector2(rIn, h), new THREE.Vector2(rIn, 0)];
    const g = new THREE.LatheGeometry(pts, segments); g.translate(x, y, z); g.deleteAttribute('uv'); return g;
  });
  return mergeGeometries(parts);
}
const mesh = (g, m, name, parent) => { const o = new THREE.Mesh(g, m); o.name = name; o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };

// PIN 陣列的位置（沿長邊 cols、沿寬邊 rows），避開三個孔周圍
function pinGrid() {
  const out = [];
  for (let c = 0; c < INT.cols; c++) for (let r = 0; r < INT.rows; r++) {
    const x = (c - (INT.cols - 1) / 2) * INT.pitchX, z = (r - (INT.rows - 1) / 2) * INT.pitchZ;
    if (MOD.holes.some(h => Math.hypot(x - h, z) < INT.bossR + 1.4)) continue;
    out.push([x, z]);
  }
  return out;
}
export const PIN_XZ = pinGrid();

// ---------------------------------------------------------------- 共用幾何（所有零件共用一份，降低記憶體）
const G = {};
function geometries() {
  if (G.ready) return G;
  const holes = MOD.holes.map(x => [x, 0]);
  G.intBody = plateGeometry(MOD.L, MOD.W, INT.t, 1.2, holes, MOD.holeR);
  // 上下兩面的 PIN（彎曲彈片簡化成斜置小塊；尖端露出 0.45 mm，根部埋入本體 0.1 mm）
  const pw = .55, pd = .7;
  G.pinTop = boxes(PIN_XZ.map(([x, z]) => [pw, INT.pin + .1, pd, x + .25, INT.t + (INT.pin + .1) / 2 - .1, z]));
  G.pinBot = boxes(PIN_XZ.map(([x, z]) => [pw, INT.pin + .1, pd, x - .25, -(INT.pin + .1) / 2 + .1, z]));
  // 三處凸點（定位凸台，插入 PCB 孔）：中空環，螺絲從中間穿過
  G.boss = rings(MOD.holes.map(x => [x, -INT.bossH, 0]), MOD.holeR, INT.bossR, INT.bossH + .1, 24);
  // SOCAMM：黑色 PCB、4 顆 DRAM、PMIC、被動元件、孔周銅環（上）、LGA 金手指焊墊（下）
  G.socPcb = plateGeometry(MOD.L, MOD.W, SOC.t, 1.0, holes, MOD.holeR);
  G.socPkg = boxes([[12.2, SOC.pkgH, 10.6, -28.5, SOC.t + SOC.pkgH / 2 - .02, .4], [12.2, SOC.pkgH, 10.6, -14.2, SOC.t + SOC.pkgH / 2 - .02, .4],
    [11.2, SOC.pkgH, 10.6, 17.2, SOC.t + SOC.pkgH / 2 - .02, .4], [11.2, SOC.pkgH, 10.6, 30.2, SOC.t + SOC.pkgH / 2 - .02, .4]]);
  const pas = [];
  for (let i = 0; i < 10; i++) pas.push([1.0, .5, .5, -37.5 + (i % 2) * 1.6, SOC.t + .23, -5.6 + Math.floor(i / 2) * 1.15]);
  for (let i = 0; i < 8; i++) pas.push([.8, .45, .5, 8 + (i % 4) * 1.3, SOC.t + .2, -5.4 + Math.floor(i / 4) * 10.6]);
  pas.push([3.2, .7, 3.2, 9.5, SOC.t + .33, .2]);   // PMIC
  G.socPas = boxes(pas);
  G.socRingTop = rings(MOD.holes.map(x => [x, SOC.t - .02, 0]), MOD.holeR + .05, SOC.ringR, .06, 28);
  G.socPads = boxes(PIN_XZ.map(([x, z]) => [1.3, .06, 1.1, x, .02, z]));
  // PCB（主機板）：板子、4 個槽位的金焊墊與孔周銅環、CPU、VRM、電容、基準點（Fiducial）
  return Object.assign(G, { ready: true });
}

// ---------------------------------------------------------------- interposer 連接件
export function createInterposer(name) {
  const g = geometries(), root = new THREE.Group(); root.name = name;
  Object.assign(root.userData, { product: 'interposer' });
  mesh(g.intBody, intBody, 'interposer body', root);
  mesh(g.pinTop, gold, 'interposer pins top', root);
  mesh(g.pinBot, gold, 'interposer pins bottom', root);
  mesh(g.boss, intBody, 'interposer bosses', root);
  return root;
}
// ---------------------------------------------------------------- SOCAMM 記憶體
export function createSocamm(name, { dirty = false } = {}) {
  const g = geometries(), root = new THREE.Group(); root.name = name;
  Object.assign(root.userData, { product: 'socamm' });
  mesh(g.socPcb, pcbBlack, 'socamm pcb', root);
  mesh(g.socPkg, pkgMat, 'socamm dram', root);
  mesh(g.socPas, passive, 'socamm passives', root);
  mesh(g.socRingTop, copper, 'socamm rings', root);
  mesh(g.socPads, gold, 'socamm pads', root);
  decal(root, 24, 8, [-21.5, SOC.t + SOC.pkgH + .03, .4], [-Math.PI / 2, 0, 0], ['SOCAMM 示意'], { color: '#c9d2da', bg: null, center: true });
  // 髒污（示意）：底面焊墊上的微粒與指紋，清潔後隱藏
  const spots = new THREE.Group(); spots.name = 'dirt'; root.add(spots); spots.visible = dirty;
  const dirtMat = std(0x8b7d66, .95, 0);
  for (const [x, z, r] of [[-20, 2, .9], [-17.5, -2.5, .6], [12, 3.4, 1.1], [24, -1.5, .7], [-33, -3, .5]]) {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r, .05, 12), dirtMat); d.position.set(x, -.03, z); d.name = 'dirt'; d.userData.fx = true; spots.add(d);
  }
  return { root, dirt: spots };
}

// ---------------------------------------------------------------- 主機板 PCB（4 個 SOCAMM 槽位，槽位長邊沿板子 Z）
export const SLOTS = [-105, -35, 35, 105];          // 槽位中心 X（板子本地）
export const SLOT_Z = 0;
export const FIDUCIALS = [[-140, -60], [140, 60]];   // 基準點（板子本地 x、z；對角兩點）
// 槽位本地 → 板子本地：零件長邊（本地 X）沿板子 −Z，孔 i 在板子的 z = −holes[i]
export const slotHole = (k, i) => [SLOTS[k], SLOT_Z - MOD.holes[i]];
export function createBoard() {
  const root = new THREE.Group(); root.name = 'board';
  const holes = []; SLOTS.forEach((_, k) => MOD.holes.forEach((__, i) => { const [x, z] = slotHole(k, i); holes.push([x, z, PCB.holeR]); }));
  for (const [x, z] of [[-140, -10], [140, 10]]) holes.push([x, z, 1.6]);     // 板邊定位孔
  mesh(plateGeometry(PCB.w, PCB.d, PCB.t, 3, holes), pcbGreen, 'pcb', root);
  const top = PCB.t;
  // 槽位：LGA 金焊墊、孔周銅環、絲印框（細條）
  const pads = [], ringsAt = [], silk = [];
  SLOTS.forEach((sx, k) => {
    for (const [x, z] of PIN_XZ) pads.push([1.1, .05, .9, sx + z, top + .015, SLOT_Z - x]);
    MOD.holes.forEach((_, i) => { const [x, z] = slotHole(k, i); ringsAt.push([x, top - .02, z]); });
    for (const s of [-1, 1]) { silk.push([.4, .03, MOD.L + 4, sx + s * (MOD.W / 2 + 1.5), top + .01, SLOT_Z]); silk.push([MOD.W + 3.4, .03, .4, sx, top + .01, SLOT_Z + s * (MOD.L / 2 + 2)]); }
  });
  mesh(boxes(pads), gold, 'pcb slot pads', root);
  mesh(rings(ringsAt, PCB.holeR + .05, PCB.holeR + 1.3, .06, 28), copper, 'pcb slot rings', root);
  mesh(boxes(silk), std(0xe9eef0, .8, 0), 'pcb silk', root);
  // 基準點（銅圓點＋防焊開窗）
  const fid = FIDUCIALS.map(([x, z]) => { const c = new THREE.CylinderGeometry(.8, .8, .05, 20); c.translate(x, top + .02, z); return c; });
  mesh(mergeGeometries(fid), copper, 'pcb fiducials', root);
  // 其他元件（示意）：VRM 電感、電容排、邊緣連接器、IC（槽位區在板子中段 z −50～+50）
  const comps = [];
  for (let i = 0; i < 8; i++) comps.push([9, 5, 9, -130 + i * 13, top + 2.5 - .02, -100]);                 // VRM 電感
  for (let i = 0; i < 16; i++) comps.push([2, 1.2, 1.2, -128 + i * 6.5, top + .6 - .02, -86]);               // 電容排
  for (let i = 0; i < 8; i++) comps.push([9, 5, 9, 39 + i * 13, top + 2.5 - .02, -100]);
  for (let i = 0; i < 16; i++) comps.push([2, 1.2, 1.2, 40 + i * 6.5, top + .6 - .02, -86]);
  comps.push([120, 6, 8, 0, top + 3 - .02, 104]);                                                         // 邊緣連接器
  comps.push([40, 4, 26, -110, top + 2 - .02, 82], [40, 4, 26, 110, top + 2 - .02, 82]);                   // 其他 IC
  mesh(boxes(comps), std(0x2b2f35, .5, .3), 'pcb components', root);
  mesh(boxes([[48, 2.2, 48, 0, top + 1.1 - .02, 74]]), silver, 'pcb ic lid', root);
  // 背面的 PEM 鎖附螺帽（每孔一顆，PCB 下方，在載台支撐柱之間）
  const nuts = []; SLOTS.forEach((_, k) => MOD.holes.forEach((__, i) => { const [x, z] = slotHole(k, i); nuts.push([x, -3, z]); }));
  mesh(rings(nuts, .9, 2.6, 3, 6), silver, 'pcb pem nuts', root);
  decal(root, 70, 12, [-95, top + .7, 108], [-Math.PI / 2, 0, 0], ['MAIN BOARD 示意'], { color: '#dfe7ea', bg: null });
  return root;
}

// ---------------------------------------------------------------- 載台（鋁合金，黑色陽極）：支撐柱、定位襯套孔、把手、條碼
export function createCarrier(width) {
  const root = new THREE.Group(); root.name = 'carrier';
  const d = width, w = CARRIER.w, t = CARRIER.t;
  const holes = [[-w / 2 + 20, -d / 2 + 20, 4], [w / 2 - 20, d / 2 - 20, 4]];          // 定位銷孔（對角）
  mesh(plateGeometry(w, d, t, 4, holes), carrierMat, 'carrier plate', root);
  const posts = [];
  for (const x of [-140, -70, 0, 70, 140]) for (const z of [-110, -45, 45, 110]) posts.push([x, t - .1, z]);
  mesh(rings(posts, 0, 3.5, CARRIER.standoff + .1, 12), MAT.alu, 'carrier posts', root);
  // 板邊壓爪（固定 PCB 四角，示意）
  mesh(boxes([[10, 4, 10, -150 - 4, t + CARRIER.standoff + 2, -116], [10, 4, 10, 150 + 4, t + CARRIER.standoff + 2, 116],
    [10, 4, 10, -150 - 4, t + CARRIER.standoff + 2, 116], [10, 4, 10, 150 + 4, t + CARRIER.standoff + 2, -116]]), MAT.steelDark, 'carrier clamps', root);
  decal(root, 60, 14, [-130, t + .7, -d / 2 + 12], [-Math.PI / 2, 0, 0], ['CARRIER 07'], { color: '#cfd8df', bg: null });
  return root;
}

// ---------------------------------------------------------------- Tray 盤（防靜電黑色，8 格，零件長邊沿 X）
export const TRAY = { w: 140, d: 236, t: 12, pocketPitch: 26, pockets: 8, floor: 3 };
export const pocketZ = i => (i - (TRAY.pockets - 1) / 2) * TRAY.pocketPitch;
export function createTray(name, label) {
  const root = new THREE.Group(); root.name = name;
  const T = TRAY;
  mesh(boxes([[T.w, T.floor, T.d, 0, T.floor / 2, 0]]), trayMat, 'tray floor', root);
  // 格肋與外框
  const ribs = [[T.w, T.t - T.floor, 4, 0, T.floor + (T.t - T.floor) / 2, -T.d / 2 + 2], [T.w, T.t - T.floor, 4, 0, T.floor + (T.t - T.floor) / 2, T.d / 2 - 2],
    [4, T.t - T.floor, T.d - 8, -T.w / 2 + 2, T.floor + (T.t - T.floor) / 2, 0], [4, T.t - T.floor, T.d - 8, T.w / 2 - 2, T.floor + (T.t - T.floor) / 2, 0]];
  for (let i = 0; i < T.pockets - 1; i++) ribs.push([T.w - 8, T.t - T.floor - 4, 2.4, 0, T.floor + (T.t - T.floor - 4) / 2, (pocketZ(i) + pocketZ(i + 1)) / 2]);
  mesh(boxes(ribs), trayMat, 'tray ribs', root);
  // 格內支撐環（在三個孔的位置：PIN 區不受力；中空讓取放頭的漲緊銷伸入）
  const sup = []; for (let i = 0; i < T.pockets; i++) for (const x of MOD.holes) sup.push([x, T.floor - .05, pocketZ(i)]);
  mesh(rings(sup, 1.6, 3.0, 2.05, 16), trayMat, 'tray supports', root);
  decal(root, 60, 9, [0, T.floor + .05, -T.d / 2 + 6], [-Math.PI / 2, 0, 0], [label], { color: '#9fb1c0', bg: null });
  return root;
}
export const TRAY_SEAT = TRAY.floor + 2;          // 支撐環頂面（相對 Tray 底面）：SOCAMM 底面、interposer 凸點底面落在這裡

// ---------------------------------------------------------------- M2 螺絲（盤頭十字，示意）
export const SCREW = { headR: 1.9, headH: 1.3, shankR: 1.0, len: 6.0, pitch: .4 };
let screwGeo = null;
export function createScrew(name) {
  if (!screwGeo) {
    const head = new THREE.CylinderGeometry(SCREW.headR * .92, SCREW.headR, SCREW.headH, 20); head.translate(0, SCREW.headH / 2, 0);
    const shank = new THREE.CylinderGeometry(SCREW.shankR, SCREW.shankR * .8, SCREW.len, 12); shank.translate(0, -SCREW.len / 2 + .05, 0);
    for (const g of [head, shank]) g.deleteAttribute('uv');
    screwGeo = mergeGeometries([head, shank]);
  }
  const m = new THREE.Mesh(screwGeo, std(0x4b5157, .35, .85)); m.name = name; m.castShadow = true;
  const g = new THREE.Group(); g.name = name; g.add(m);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(2.4, .3, .45), MAT.black); slot.position.y = SCREW.headH + .1; slot.name = 'screw recess'; g.add(slot);
  const slot2 = slot.clone(); slot2.rotation.y = Math.PI / 2; g.add(slot2);
  return g;
}
