// 本站幾何：建物與鋸齒屋面、太陽能板（InstancedMesh）、鋼架、塔樓、變流器區與線槽、併網點、遠景、雲。
// core 目前沒有太陽能板、鋼架與變流器的共用模型，先在本站暫代（已登記 core/REQUESTS.md）。
import * as THREE from 'three';
import { block, blockBetween, cylinder, pipe, plate, HAS_DOM } from '@core/geom/shapes.js';
import { MAT, std } from '@core/geom/materials.js';
import { H, LAYOUT } from './layout.js';

const L = LAYOUT, M = L.module;
const grp = (name, parent) => { const g = new THREE.Group(); g.name = name; parent?.add(g); return g; };
const shadeAll = m => { m.castShadow = m.receiveShadow = true; return m; };

export const PAINT = {
  wall: std(0xc8cdd1, .85, .02), roof: std(0xa3a8ad, .9, .02), parapet: std(0xc3c8cc, .85, .02),
  skin: std(0x2f63a6, .48, .35),            // 鋸齒屋面的藍色烤漆鋼板
  band: std(0x2c4258, .2, .3),              // 外牆帶狀窗
  galv: std(0xc3c9ce, .42, .65),            // 熱浸鍍鋅鋼架
  tray: std(0x9aa2a8, .45, .6),
  inverter: std(0xe3e6e8, .5, .15),
};

// ---------------------------------------------------------------- 太陽能板材質：電池片貼圖（瀏覽器才畫）＋鋁框側面＋白色背板
let panelMats = null;
function panelMaterials() {
  if (panelMats) return panelMats;
  const cells = new THREE.MeshPhysicalMaterial({ color: HAS_DOM ? 0xffffff : 0x1d3f7a, roughness: .3, metalness: .15, clearcoat: .45, clearcoatRoughness: .15 });
  if (HAS_DOM) {
    const nx = 6, nz = 10, px = 40, b = 6, c = document.createElement('canvas'); c.width = nx * px + 2 * b; c.height = nz * px + 2 * b;
    const g = c.getContext('2d'); g.fillStyle = '#aab2ba'; g.fillRect(0, 0, c.width, c.height);   // 鋁框上緣
    g.fillStyle = '#7d8893'; g.fillRect(b, b, nx * px, nz * px);                                     // 背板（片間隙）
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x0 = b + i * px + 1.5, y0 = b + j * px + 1.5, w = px - 3;
      g.fillStyle = '#16346a'; g.fillRect(x0, y0, w, w);
      for (let k = 0; k < 18; k++) { g.fillStyle = `hsl(${210 + rnd() * 16},${45 + rnd() * 25}%,${26 + rnd() * 22}%)`; g.globalAlpha = .4; g.fillRect(x0 + rnd() * w * .8, y0 + rnd() * w * .8, 3 + rnd() * 10, 3 + rnd() * 10); }
      g.globalAlpha = 1; g.fillStyle = '#8e99a4'; for (let s = 1; s <= 2; s++) g.fillRect(x0 + w * s / 3 - .6, y0, 1.2, w);   // 匯流條
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; cells.map = t;
  }
  const frame = std(0xc4ccd3, .35, .6), back = std(0xe9ecee, .7, 0);
  // BoxGeometry 面序：+x、-x、+y（受光面）、-y（背板）、+z、-z
  panelMats = [frame, frame, cells, back, frame, frame];
  return panelMats;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

// 太陽能板：list = [{ pos, tilt(rad) }]，板的局部 X 沿列、Z 沿坡面（直放）
export function createPanels(parent, name, list) {
  const geo = new THREE.BoxGeometry(M.W, M.T, M.L), mesh = shadeAll(new THREE.InstancedMesh(geo, panelMaterials(), list.length));
  list.forEach((p, i) => mesh.setMatrixAt(i, _m.compose(_v.set(...p.pos), _q.setFromEuler(_e.set(p.tilt, 0, 0)), _s.set(1, 1, 1))));
  mesh.name = name; parent.add(mesh); return mesh;
}
// 方塊批次：boxes = [{ pos, size, rx? }]（rx 繞 X 軸傾斜）
export function boxBatch(parent, name, boxes, mat) {
  const mesh = shadeAll(new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, boxes.length));
  boxes.forEach((b, i) => mesh.setMatrixAt(i, _m.compose(_v.set(...b.pos), _q.setFromEuler(_e.set(b.rx || 0, 0, 0)), _s.set(...b.size))));
  mesh.name = name; parent.add(mesh); return mesh;
}
// 圓管批次：bars = [[a, b, r]]
export function barBatch(parent, name, bars, mat, seg = 8) {
  const mesh = shadeAll(new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, seg), mat, bars.length)), A = new THREE.Vector3(), B = new THREE.Vector3();
  bars.forEach(([a, b, r], i) => {
    A.set(...a); B.set(...b); const len = A.distanceTo(B);
    mesh.setMatrixAt(i, _m.compose(_v.copy(A).add(B).multiplyScalar(.5), _q.setFromUnitVectors(_up, B.clone().sub(A).normalize()), _s.set(r, len, r)));
  });
  mesh.name = name; parent.add(mesh); return mesh;
}

// ---------------------------------------------------------------- 建物：本體、屋面、女兒牆、帶狀窗
export function createBuilding(scene) {
  const g = grp('building', scene), b = L.building, p = b.parapet, W = b.x1 - b.x0, D = b.z1 - b.z0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  block(g, [W, H, D], [cx, H / 2, cz], PAINT.wall).name = 'building body';
  // 屋面防水層（薄層，四邊內縮到女兒牆內側，不與外牆共面）
  blockBetween(g, [b.x0 + p.t, H, b.z0 + p.t], [b.x1 - p.t, H + 20, b.z1 - p.t], PAINT.roof).name = 'roof membrane';
  for (const [x0, z0, x1, z1] of [[b.x0, b.z0, b.x1, b.z0 + p.t], [b.x0, b.z1 - p.t, b.x1, b.z1], [b.x0, b.z0 + p.t, b.x0 + p.t, b.z1 - p.t], [b.x1 - p.t, b.z0 + p.t, b.x1, b.z1 - p.t]])
    blockBetween(g, [x0, H, z0], [x1, H + p.h, z1], PAINT.parapet).name = 'parapet';
  // 帶狀窗：凸出外牆 30 mm
  for (const y of [3200, 7400]) {
    blockBetween(g, [b.x0 + 1500, y, b.z1], [b.x1 - 1500, y + 1500, b.z1 + 30], PAINT.band).name = 'window band';
    blockBetween(g, [b.x0 + 1500, y, b.z0 - 30], [b.x1 - 1500, y + 1500, b.z0], PAINT.band).name = 'window band';
    blockBetween(g, [b.x0 - 30, y, b.z0 + 1500], [b.x0, y + 1500, b.z1 - 1500], PAINT.band).name = 'window band';
    blockBetween(g, [b.x1, y, b.z0 + 1500], [b.x1 + 30, y + 1500, b.z1 - 1500], PAINT.band).name = 'window band';
  }
  return g;
}
export const ROOF = H + 20;                 // 屋面防水層上緣（設備與鋼架的落點）

// ---------------------------------------------------------------- 鋸齒屋面：三角稜柱（南向斜面＋北側直立面）
export function createSawtooth(parent) {
  const s = L.saw, len = s.x1 - s.x0;
  for (const [i, zs] of s.zs.entries()) {
    const shape = new THREE.Shape([new THREE.Vector2(-zs, 0), new THREE.Vector2(-zs + s.run, 0), new THREE.Vector2(-zs + s.run, s.rise)]);
    const m = shadeAll(new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false }), PAINT.skin));
    m.rotation.y = Math.PI / 2; m.position.set(s.x0, ROOF, 0); m.name = `sawtooth row ${i + 1}`; parent.add(m);
  }
}

// ---------------------------------------------------------------- 鋼架斜置陣列：每座桌台 4 榀三角桁架＋4 支橫向檁條
export function createRackSteel(parent, tables) {
  const k = L.rack, t = k.tilt * Math.PI / 180, sn = Math.sin(t), cs = Math.cos(t), depth = k.rows * M.L + (k.rows - 1) * M.gap;
  const width = k.cols * M.W + (k.cols - 1) * M.gap, bars = [], purlins = [], plates = [];
  // 板面下方 off mm 的點（s：由前緣沿坡面往上）
  const at = (zf, s, off) => [ROOF + k.edgeY + s * sn - off * cs, zf - s * cs - off * sn];
  for (const tb of tables) {
    for (const s of [380, 1240, 2060, 2920]) { const [y, z] = at(tb.zf, s, M.T / 2 + 30); purlins.push({ pos: [tb.xc, y, z], size: [width + 120, 60, 60], rx: t }); }
    for (const dx of [-3400, -1150, 1150, 3400]) {
      const x = tb.xc + dx, [y0, z0] = at(tb.zf, 120, M.T / 2 + 60 + 50), [y1, z1] = at(tb.zf, depth - 120, M.T / 2 + 60 + 50);
      const [yF, zF] = at(tb.zf, 320, M.T / 2 + 60 + 50), [yR, zR] = at(tb.zf, depth - 320, M.T / 2 + 60 + 50);
      bars.push([[x, y0, z0], [x, y1, z1], 50]);                                       // 斜樑
      bars.push([[x, ROOF, zF], [x, yF, zF], 45], [[x, ROOF, zR], [x, yR, zR], 45]);   // 前柱、後柱
      bars.push([[x, ROOF + 60, zF], [x, (yF + yR) / 2, (zF + zR) / 2], 28]);          // 斜撐（三角桁架）
      bars.push([[x, (yF + yR) / 2, (zF + zR) / 2], [x, ROOF + 60, zR], 28]);
      plates.push({ pos: [x, ROOF + 6, zF], size: [220, 12, 220] }, { pos: [x, ROOF + 6, zR], size: [220, 12, 220] });
    }
  }
  barBatch(parent, 'rack truss', bars, PAINT.galv);
  boxBatch(parent, 'rack purlins', purlins, PAINT.galv);
  boxBatch(parent, 'rack base plates', plates, PAINT.galv);
}
// 鋸齒屋面上的導軌（每排板兩支，順著斜面）
export function createSawRails(parent) {
  const s = L.saw, t = Math.atan2(s.rise, s.run), sn = Math.sin(t), cs = Math.cos(t), len = s.cols * M.W + (s.cols - 1) * M.gap + 200, xc = (s.x0 + s.x1) / 2, rails = [];
  const slope = Math.hypot(s.run, s.rise);
  for (const zs of s.zs) for (let r = 0; r < s.rows; r++) {
    const sc = slope - s.topMargin - M.L / 2 - r * (M.L + M.gap);
    for (const d of [-M.L / 2 + 360, M.L / 2 - 360]) {
      const ss = sc + d, y = ROOF + ss * sn + 22 * cs, z = zs - ss * cs + 22 * sn;
      rails.push({ pos: [xc, y, z], size: [len, 40, 40], rx: t });
    }
  }
  boxBatch(parent, 'saw rails', rails, PAINT.galv);
}

// ---------------------------------------------------------------- 塔樓：樓梯間＋機房、外掛鋼梯、屋頂欄杆、天線與碟形天線
export function createTower(scene) {
  const g = grp('tower', scene), T = L.tower, top = ROOF + T.h;
  blockBetween(g, [T.x0, ROOF, T.z0], [T.x1, top, T.z1], PAINT.wall).name = 'tower body';
  blockBetween(g, [T.x0 + 1200, ROOF + 3600, T.z1], [T.x1 - 1200, ROOF + 5200, T.z1 + 40], PAINT.band).name = 'tower windows';
  blockBetween(g, [T.x1 - 2600, ROOF, T.z1], [T.x1 - 1600, ROOF + 2200, T.z1 + 40], MAT.door).name = 'tower door';
  // 外掛鋼梯（西面，由南往北上）
  const sx0 = T.x0 - 1000, sx1 = T.x0, zBot = T.z1 - 300, rise = T.h, run = rise / Math.tan(36 * Math.PI / 180), zTop = zBot - run, n = Math.round(rise / 180);
  const treads = [], rails = [];
  for (let i = 1; i < n; i++) treads.push({ pos: [(sx0 + sx1) / 2, ROOF + i * rise / n, zBot - i * run / n], size: [900, 30, 260] });
  for (const x of [sx0 + 30, sx1 - 30]) rails.push([[x, ROOF, zBot], [x, top, zTop], 35]);                                 // 側板（以圓管代表）
  rails.push([[sx0 + 30, ROOF + 1000, zBot], [sx0 + 30, top + 1000, zTop], 22]);                                          // 扶手
  for (let i = 0; i <= 6; i++) { const f = i / 6, y = ROOF + f * rise, z = zBot - f * run; rails.push([[sx0 + 30, y, z], [sx0 + 30, y + 1000, z], 18]); }
  // 頂部平台與欄杆
  blockBetween(g, [sx0, top - 60, zTop - 1600], [sx1, top, zTop], PAINT.galv).name = 'stair landing';
  for (const [a, b] of [[[T.x0 + 100, top, T.z0 + 100], [T.x1 - 100, top, T.z0 + 100]], [[T.x1 - 100, top, T.z0 + 100], [T.x1 - 100, top, T.z1 - 100]], [[T.x1 - 100, top, T.z1 - 100], [T.x0 + 100, top, T.z1 - 100]]]) {
    rails.push([[a[0], top + 1100, a[2]], [b[0], top + 1100, b[2]], 22], [[a[0], top + 550, a[2]], [b[0], top + 550, b[2]], 16]);
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]), k = Math.ceil(len / 1500);
    for (let i = 0; i <= k; i++) { const f = i / k, x = a[0] + (b[0] - a[0]) * f, z = a[2] + (b[2] - a[2]) * f; rails.push([[x, top, z], [x, top + 1100, z], 20]); }
  }
  boxBatch(g, 'stair treads', treads, PAINT.galv);
  barBatch(g, 'stair and roof railing', rails, PAINT.galv);
  // 屋頂冷氣外機、天線桿、碟形天線
  blockBetween(g, [T.x1 - 4200, top, T.z0 + 1200], [T.x1 - 2800, top + 900, T.z0 + 2000], PAINT.inverter).name = 'tower ac unit';
  cylinder(g, 70, 7000, [T.x1 - 1500, top + 3500, T.z0 + 1500], PAINT.galv, 'y', 10).name = 'antenna mast';
  const dish = shadeAll(new THREE.Mesh(new THREE.SphereGeometry(900, 20, 10, 0, Math.PI * 2, 0, .55), std(0xe6e9ec, .5, .2, { side: THREE.DoubleSide })));
  dish.position.set(T.x0 + 5000, top + 2400, T.z0 + 3000); dish.rotation.set(-1.0, 0, .35); dish.name = 'satellite dish'; g.add(dish);
  cylinder(g, 60, 1900, [T.x0 + 5000, top + 950, T.z0 + 3000], PAINT.galv, 'y', 10).name = 'dish stand';
  return g;
}

// ---------------------------------------------------------------- 變流器區、線槽、日射計、直流與交流流向管
export function createPower(scene) {
  const g = grp('power', scene), T = L.tray, y0 = ROOF + T.y, yT = y0 + 70;
  // 線槽：底板＋兩側板＋支架；sides 是兩側板的區段（交會處留缺口讓分支線槽接入）
  const trays = [
    { b: [18900, -3300, 19500, 14500] },
    { b: [-25500, -3900, 24500, -3300], sides: [[[-25500, 6500], [7100, 23900]], [[-25500, 18900], [19500, 24500]]] },
    { b: [23900, -10600, 24500, -3900] },
    { b: [6500, -14800, 7100, -3900] },
  ];
  const supports = [];
  for (const { b: [x0, z0, x1, z1], sides } of trays) {
    blockBetween(g, [x0, y0 - 10, z0], [x1, y0, z1], PAINT.tray).name = 'cable tray';
    const alongX = x1 - x0 > z1 - z0, segs = sides || (alongX ? [[[x0, x1]], [[x0, x1]]] : [[[z0, z1]], [[z0, z1]]]);
    segs.forEach((list, k) => {
      for (const [a, c] of list) {
        if (alongX) { const z = k ? z1 - 15 : z0 + 5; blockBetween(g, [a, y0, z], [c, y0 + T.side, z + 10], PAINT.tray).name = 'cable tray side'; }
        else { const x = k ? x1 - 15 : x0 + 5; blockBetween(g, [x, y0, a], [x + 10, y0 + T.side, c], PAINT.tray).name = 'cable tray side'; }
      }
    });
    const len = alongX ? x1 - x0 : z1 - z0, k = Math.max(1, Math.round(len / 3000));
    for (let i = 0; i <= k; i++) {
      const f = (i + .5) / (k + 1), x = alongX ? x0 + (x1 - x0) * f : (x0 + x1) / 2, z = alongX ? (z0 + z1) / 2 : z0 + (z1 - z0) * f;
      supports.push({ pos: [x, ROOF + (y0 - 10 - ROOF) / 2, z], size: alongX ? [80, y0 - 10 - ROOF, T.w - 40] : [T.w - 40, y0 - 10 - ROOF, 80] });
    }
  }
  boxBatch(g, 'cable tray supports', supports, PAINT.tray);

  // 變流器：機箱（正面朝西）＋顯示窗＋狀態燈，掛在背後的鋼柱上
  const inv = L.inverters.map(v => {
    const box = blockBetween(g, [L.invX, ROOF + 600, v.z - 350], [L.invX + 350, ROOF + 1600, v.z + 350], PAINT.inverter); box.name = `${v.id} cabinet`;
    for (const dz of [-250, 250]) blockBetween(g, [L.invX + 350, ROOF, v.z + dz - 50], [L.invX + 450, ROOF + 1800, v.z + dz + 50], PAINT.galv).name = `${v.id} post`;
    const screenMat = std(0x0e1c26, .3, 0, { emissive: 0x000000 }), ledMat = std(0x30363c, .4, 0, { emissive: 0x000000 });
    blockBetween(g, [L.invX - 6, ROOF + 1260, v.z - 120], [L.invX, ROOF + 1400, v.z + 120], screenMat).name = `${v.id} display`;
    blockBetween(g, [L.invX - 8, ROOF + 1460, v.z + 180], [L.invX, ROOF + 1500, v.z + 220], ledMat).name = `${v.id} led`;
    plate(g, [v.id, `${v.kw} kW`], 300, 120, [L.invX - 4, ROOF + 950, v.z], -Math.PI / 2);
    return { ...v, screenMat, ledMat };
  });
  const A = L.acPanel;
  blockBetween(g, [A.x0, ROOF, A.z0], [A.x1, ROOF + A.h, A.z1], MAT.cabinet).name = 'ac distribution panel';
  plate(g, ['交流配電盤'], 600, 140, [A.x0 - 4, ROOF + 1500, (A.z0 + A.z1) / 2], -Math.PI / 2);
  // 遮陽棚
  const C = L.canopy;
  for (const x of [C.x0, C.x1]) for (const z of [C.z0, C.z1]) cylinder(g, 60, C.h, [x, ROOF + C.h / 2, z], PAINT.galv, 'y', 10).name = 'canopy post';
  blockBetween(g, [C.x0 - 200, ROOF + C.h, C.z0 - 200], [C.x1 + 200, ROOF + C.h + 80, C.z1 + 200], std(0xdfe3e6, .6, .3)).name = 'canopy roof';
  // 日射計（量測面與鋸齒屋面同傾角，給 PR 計算）
  const P = L.pyranometer;
  cylinder(g, 40, P.h, [P.x, ROOF + P.h / 2, P.z], PAINT.galv, 'y', 10).name = 'pyranometer pole';
  blockBetween(g, [P.x - 150, ROOF + P.h, P.z - 150], [P.x + 150, ROOF + P.h + 40, P.z + 150], PAINT.galv).name = 'pyranometer plate';
  const dome = shadeAll(new THREE.Mesh(new THREE.SphereGeometry(55, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.glass)); dome.position.set(P.x, ROOF + P.h + 40, P.z); dome.name = 'pyranometer dome'; g.add(dome);

  // 流向管：直流（琥珀色）從陣列沿線槽進變流器；交流（綠）進配電盤；併網（藍）沿外牆下到變壓器
  const DC = 0xffb020, AC = 0x3dd68c, GRID = 0x4aa8ff, yUp = ROOF + 560, xc = L.invX + 175;
  // 線槽外的段落走在側板上方（yUp），進線槽後落到槽底（yT）；最後從機箱底部進線
  const toInv = (lane, z) => [[lane, yT, z], [lane, ROOF + 540, z], [xc, ROOF + 540, z], [xc, ROOF + 600, z]];
  const dc = [
    pipe(g, [[18010, yUp, 12000], [19320, yUp, 12000], [19320, yT, 12000], [19320, yT, -3480], [24320, yT, -3480], ...toInv(24320, -6000)], 45, DC),
    pipe(g, [[18010, yUp, 2500], [19080, yUp, 2500], [19080, yT, 2500], [19080, yT, -3600], [24200, yT, -3600], ...toInv(24200, -8000)], 45, DC),
    pipe(g, [[3900, yT, -15000], [6800, yT, -15000], [6800, yT, -3720], [24080, yT, -3720], ...toInv(24080, -10000)], 45, DC),
  ];
  const ac = inv.map((v, i) => { const lx = L.invX + 75 + i * 100; return pipe(g, [[lx, ROOF + 1600, v.z], [lx, ROOF + 2150, v.z], [lx, ROOF + 2150, -11700], [lx, ROOF + A.h, -11700]], 38, AC); });
  const TR = L.transformer, ty = TR.h * .6, tz = (TR.z0 + TR.z1) / 2;
  const grid = pipe(g, [[25500, ROOF + A.h, -12300], [25500, ROOF + 2600, -12300], [30300, ROOF + 2600, -12300], [30300, ty, -12300], [30300, ty, tz], [TR.x0, ty, tz]], 60, GRID);
  return { group: g, inv, dc, ac, grid };
}

// ---------------------------------------------------------------- 併網點（地面）：變壓器＋電表箱
export function createGridPoint(scene) {
  const g = grp('grid', scene), T = L.transformer, Mt = L.meter;
  blockBetween(g, [T.x0 - 400, 0, T.z0 - 2200], [T.x1 + 400, 150, T.z1 + 400], MAT.floor).name = 'transformer pad';
  blockBetween(g, [T.x0, 150, T.z0], [T.x1, 150 + T.h, T.z1], std(0x7e8b78, .6, .3)).name = 'pad-mount transformer';
  for (let i = 0; i < 7; i++) { const z = T.z0 + 200 + i * 170; blockBetween(g, [T.x1, 300, z], [T.x1 + 160, T.h - 100, z + 20], std(0x6f7b69, .6, .3)).name = 'transformer fin'; }
  blockBetween(g, [Mt.x0, 150, Mt.z0], [Mt.x1, 150 + Mt.h, Mt.z1], MAT.cabinet).name = 'meter cabinet';
  plate(g, ['市電併網點'], 900, 200, [(T.x0 + T.x1) / 2, 150 + T.h + 260, T.z1 + 2], 0);
  return g;
}

// ---------------------------------------------------------------- 遠景（裝飾，不參與檢查）：周邊建物與拱頂倉庫
export function createSurroundings(scene) {
  const g = grp('surroundings', scene); g.userData.decor = true;
  const mat = std(0xa9afb4, .9, 0), dark = std(0x858d94, .9, 0), glass = std(0x51606d, .3, .2);
  for (const [x, z, w, d, h, m] of [[-125000, -95000, 26000, 18000, 30000, mat], [-40000, -130000, 40000, 22000, 16000, dark], [55000, -125000, 30000, 26000, 24000, mat],
    [135000, -30000, 20000, 30000, 18000, dark], [-150000, 30000, 22000, 34000, 12000, mat], [110000, 95000, 34000, 20000, 9000, mat], [-80000, 120000, 30000, 18000, 7000, dark]]) {
    blockBetween(g, [x - w / 2, 0, z - d / 2], [x + w / 2, h, z + d / 2], m).name = 'neighbour building';
    for (let y = 3000; y < h - 1500; y += 3600) blockBetween(g, [x - w / 2 + 1500, y, z + d / 2], [x + w / 2 - 1500, y + 1400, z + d / 2 + 30], glass).name = 'neighbour windows';
  }
  // 拱頂倉庫（白色半圓筒並排，照片左後方）：軸向沿 Z
  for (let i = 0; i < 7; i++) {
    const m = shadeAll(new THREE.Mesh(new THREE.CylinderGeometry(6000, 6000, 30000, 24, 1, true, -Math.PI / 2, Math.PI), std(0xe4e8eb, .7, 0, { side: THREE.DoubleSide })));
    m.rotation.x = -Math.PI / 2; m.position.set(-118000 + i * 12000, 0, -40000); m.name = 'vault hall'; g.add(m);
  }
  return g;
}

// ---------------------------------------------------------------- 雲（裝飾）：幾個壓扁的球；投影靠舞台的太陽陰影
export function createCloud(scene) {
  const g = grp('cloud', scene); g.userData.decor = true; g.scale.set(1.55, 1.3, 1.55);
  const mat = std(0xf4f6f8, 1, 0, { transparent: true, opacity: .9 });
  for (const [x, y, z, r] of [[0, 0, 0, 7000], [6500, -600, 2500, 5500], [-6200, -400, -1800, 5800], [2500, 600, -4800, 5000], [-3000, 300, 5200, 4800], [9800, -900, -2500, 4200]]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 10), mat); m.scale.y = .38; m.position.set(x, y, z); m.castShadow = true; m.name = 'cloud puff'; g.add(m);
  }
  return g;
}
