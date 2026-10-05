// 專用設備與周邊的市購品（二）實驗室儀器：分析天平、自動進樣器（轉盤＋滴定頭）、電位滴定儀（含 Dosino 與試劑瓶）、
// 機器人用移液模組與吸頭、廢液桶。原用於 AutomaticAcid-BaseTitration。
// 幾何、分段數、位置與材質都能用參數重現該站原樣（換用對照見 core/migrations/1.10.0-equipment.md）；外觀是示意，不是原廠 CAD。
// meta.params 是目錄頁可調的數值參數；meta.options 是只能由程式傳入的選項（材質、標示文字、子物件設定）。外部傳入的材質原樣使用。
import * as THREE from 'three';
import { block, cylinder, decal } from '../geom/shapes.js';
import { MAT } from '../geom/materials.js';
import { defaults } from './util.js';
import { liveScreen } from './equipment.js';

const group = (name, id) => { const g = new THREE.Group(); g.name = name; g.userData.coreModel = id; return g; };
const pbr = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

// 預設材質（各站可用 materials 選項換成自己的；例如帶塑膠細紋的複本）
const WHITE = pbr(0xeef0ee, .45), GREY = pbr(0x8c949c, .5, .2), BLUE = pbr(0x2f6fb5, .5);
const CASE = pbr(0xd8dde2, .4, .1), CASE_DARK = pbr(0x33414f, .45, .2), POM = pbr(0xf4f1e8, .6);
const SHIELD = new THREE.MeshPhysicalMaterial({ color: 0xcfe6ff, roughness: .05, transparent: true, opacity: .18, depthWrite: false });
const GLASS_RIM = new THREE.MeshPhysicalMaterial({ color: 0xd5e9e8, roughness: .12, clearcoat: 1, transparent: true, opacity: .55, depthWrite: false });
const SOCKET = pbr(0x33383b, .7);
// 印刷標示（shapes.js 的 decal：貼圖平面以 polygonOffset 繪製）不是實體；模型檢查略過，和原站的全場檢查設定相同
const isLabel = o => o.isMesh && !!o.material?.map && !!o.material.polygonOffset;

// 內孔環（杯座）：userData.bore 是內孔半徑，全場檢查用它判斷零件是否在孔內
function ring(parent, rIn, rOut, h, pos, material) {
  const shape = new THREE.Shape(); shape.absarc(0, 0, rOut, 0, Math.PI * 2);
  const hole = new THREE.Path(); hole.absarc(0, 0, rIn, 0, Math.PI * 2, true); shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 36 }); geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, material); m.position.set(...pos); m.castShadow = m.receiveShadow = true; m.userData.bore = rIn; parent.add(m); return m;
}
// 內六角螺絲頭（小型儀器外殼用；不投影）
function screw(parent, x, y, z, material) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 1.2, 16), material); m.position.set(x, y, z); parent.add(m);
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, .12, 6), SOCKET); socket.position.set(x, y + .65, z); parent.add(socket);
}
// 空心圓筒（塑膠瓶）
function vessel(parent, r, h, material, bottom = 2) {
  const g = new THREE.Group(); parent.add(g);
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 36, 1, true), material); wall.position.y = h / 2; g.add(wall);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(r, r, bottom, 36), material); floor.position.y = bottom / 2; g.add(floor);
  return g;
}

// ---------------------------------------------------------------- 分析天平（防風罩＋上方滑門）
// 原點：秤盤軸線與桌面的交點（＝秤室中心）；操作面板在 +X 側，上方滑門往 −X 滑開。
// 秤室內寬 w（X）× 內深 d（Z），底座高 baseH，防風罩頂 top；秤盤 Ø90 固定。
export const analyticalBalance = {
  meta: {
    id: 'analytical-balance', name: '分析天平（防風罩、上方滑門）', category: '實驗室儀器', source: 'AutomaticAcid-BaseTitration',
    params: {
      w: { value: 250, min: 180, max: 400, step: 5, unit: 'mm', label: '秤室寬（X）' },
      d: { value: 230, min: 180, max: 400, step: 5, unit: 'mm', label: '秤室深（Z）' },
      baseH: { value: 75, min: 40, max: 150, step: 1, unit: 'mm', label: '底座高' },
      top: { value: 345, min: 200, max: 500, step: 5, unit: 'mm', label: '防風罩頂高' },
      pan: { value: 90, min: 50, max: 200, step: 1, unit: 'mm', label: '秤盤面高' },
      doorTravel: { value: 250, min: 50, max: 400, step: 5, unit: 'mm', label: '滑門行程' },
    },
    states: { door: { value: 0, min: 0, max: 1, label: '滑門開度' } },
    options: {
      tabX: '滑門推把的 X（預設 w/2−5，靠操作面板側）',
      materials: '{ body（底座與面板，預設白）, frame（罩框、滑門框、導軌，預設灰）, steel（秤盤，預設 MAT.steel）, shield（玻璃，預設淡藍半透明） }',
      label: "false 不貼；{ lines='0.1 mg 分析天平', options }：底座 +X 面的銘牌",
      canvas: '讀值畫面解析度 [寬, 高]（預設 [320, 150]）', screenFallback: '沒有 canvas 時（Node）讀值網格的材質',
      name: 'root 的名稱（預設 analytical-balance）',
    },
    usage: "import { analyticalBalance } from '@core/models/equipment-lab.js';\nconst bal = analyticalBalance.create(); bal.root.position.set(x, 桌面, z); parent.add(bal.root);\nbal.set({ door: 1 });                         // 滑門全開（也可以直接改 bal.door.position.x）\nbal.display.draw(text, (ctx, w, h) => { /* 讀值 */ });\n// 避讓／干涉清單：bal.base、bal.console、bal.walls（四片玻璃）、bal.doorPanel、bal.handle",
  },
  create(p = {}) {
    const P = { ...defaults(analyticalBalance.meta), ...p };
    const root = group(P.name ?? 'analytical-balance', 'analytical-balance'), mt = P.materials ?? {};
    const body = mt.body ?? WHITE, frame = mt.frame ?? GREY, steel = mt.steel ?? MAT.steel, shield = mt.shield ?? SHIELD;
    const cw = P.w, cd = P.d, y0 = P.baseH, y1 = P.top, x0 = -cw / 2, x1 = cw / 2, z0 = -cd / 2, z1 = cd / 2;
    const base = block(root, [cw + 30, y0, cd + 50], [0, y0 / 2, 0], body);
    const console_ = block(root, [80, 40, 180], [x1 + 50, 20, 0], body);                          // 前方操作面板
    const [pw, ph] = P.canvas ?? [320, 150];
    const display = liveScreen(64, 30, pw, ph, P.screenFallback ? { fallback: P.screenFallback } : {});
    display.mesh.position.set(x1 + 70, 41, 0); display.mesh.rotation.set(-Math.PI / 2 + .35, Math.PI / 2, 0, 'YXZ'); root.add(display.mesh);
    const pan = cylinder(root, 45, 3, [0, P.pan - 1.5, 0], steel, 'y', 36);                       // 秤盤 Ø90
    cylinder(root, 8, P.pan - y0, [0, (P.pan + y0) / 2, 0], steel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(43.5, .5, 8, 64), steel); rim.rotation.x = Math.PI / 2; rim.position.set(0, P.pan, 0); rim.renderOrder = 4; root.add(rim);
    for (const x of [x0 + 15, x1 - 15]) for (const z of [z0 + 15, z1 - 15]) screw(root, x, y0 + .6, z, steel);
    const hWall = y1 - y0, wy = (y0 + y1) / 2;
    // 防風罩：前後左右玻璃＋框（手臂從上方進出）
    const walls = [
      block(root, [6, hWall, cd], [x0, wy, 0], shield), block(root, [6, hWall, cd], [x1, wy, 0], shield),
      block(root, [cw, hWall, 6], [0, wy, z0], shield), block(root, [cw, hWall, 6], [0, wy, z1], shield),
    ];
    for (const x of [x0, x1]) for (const z of [z0, z1]) block(root, [10, hWall, 10], [x, wy, z], frame);
    for (const z of [z0, z1]) block(root, [cw + 260, 8, 12], [-130, y1 + 4, z], frame);            // 滑門導軌（往 −X 延伸）
    const door = new THREE.Group(); door.name = 'balance door'; root.add(door);                    // 上方滑門
    const doorPanel = block(door, [cw - 6, 5, cd - 4], [0, y1 + 10, 0], shield);
    const handle = block(door, [8, 22, 40], [P.tabX ?? x1 - 5, y1 + 23, 0], frame);               // 推把
    for (const z of [z0 + 5, z1 - 5]) block(door, [cw - 6, 7, 8], [0, y1 + 11, z], frame);         // 門框
    for (const x of [x0 + 6, x1 - 6]) block(door, [8, 7, cd - 4], [x, y1 + 11, 0], frame);
    const lb = P.label === undefined || P.label === true ? {} : P.label;
    const label = lb ? decal(root, 120, 26, [x1 + 3.5, y0 - 25, 0], [0, Math.PI / 2, 0], lb.lines ?? '0.1 mg 分析天平', lb.options ?? { color: '#39414a', center: true, bold: true }) : null;
    function set(v) { if (v !== null && typeof v === 'object') v = v.door; door.position.x = -P.doorTravel * (+v || 0); }
    return { root, params: P, base, console: console_, display, pan, rim, walls, door, doorPanel, handle, label, set };
  },
};

// ---------------------------------------------------------------- 自動進樣器（樣品轉盤＋滴定頭升降塔）
// 原點：轉盤軸線與桌面的交點；滴定頭在轉盤 +X 最遠端（半徑 r 處），升降塔在更外側的 towerX。
// 滴定頭群組 head 帶電極、滴定管尖、加水管、噴洗嘴（名稱 probe-*）、套環（probe-collar-*）與攪拌槳（stirrer-shaft、prop）。
// at：把整台建在 root 內的這個偏移上（root 留在原點）。站內程式以桌面座標讀寫 head.position、探針位置時用這個；否則移動 root 即可。
const PROBES = [['電極', 6, 0, -14, 0x9fb6c8], ['滴定管尖', 2, 14, 8, 0xe8e8e8], ['加水管', 2, -12, 10, 0xe8e8e8], ['噴洗嘴', 3, -16, -14, 0xbfc6cc]];
export const autosampler = {
  meta: {
    id: 'autosampler', name: '自動進樣器（轉盤＋滴定頭）', category: '實驗室儀器', source: 'AutomaticAcid-BaseTitration',
    params: {
      r: { value: 150, min: 80, max: 300, step: 5, unit: 'mm', label: '杯位所在圓半徑' },
      slots: { value: 12, min: 4, max: 24, step: 1, label: '杯位數' },
      plate: { value: 110, min: 90, max: 200, step: 5, unit: 'mm', label: '轉盤面高（杯底高度）' },
      cupD: { value: 65, min: 30, max: 90, step: 1, unit: 'mm', label: '杯外徑' },
      towerX: { value: 290, min: 200, max: 500, step: 5, unit: 'mm', label: '升降塔的 X' },
      travel: { value: 190, min: 50, max: 300, step: 5, unit: 'mm', label: '滴定頭升降行程' },
    },
    states: {
      angle: { value: 0, min: 0, max: 6.2832, unit: 'rad', label: '轉盤角度' },
      lift: { value: 190, min: 0, max: 190, unit: 'mm', label: '滴定頭上升量（0：伸入杯中）' },
      stir: { value: 0, min: 0, max: 6.2832, unit: 'rad', label: '攪拌槳角度' },
    },
    options: {
      at: '內部偏移 [x, y, z]（預設 [0,0,0]）：整台建在 root 內的這個位置，root 不動',
      housing: '{ x:[−220,220], z:[−220,220], h:80 }：機座範圍（相對原點）與高度',
      towerTop: '升降塔頂高（預設 700）', discR: '轉盤半徑（預設 205）',
      probes: '[[名稱, 半徑, dx, dz, 顏色], …]：滴定頭上的元件（預設電極、滴定管尖、加水管、噴洗嘴），dx／dz 相對滴定頭中心',
      materials: '{ body（機座、塔、橫臂）, dark（轉盤、滴定頭）, seat（杯座環）, steel, black（套環）, bulb（電極球） }',
      brand: "機座正面的字樣（預設 'Metrohm'；false 不貼）",
      name: 'root 的名稱（預設 autosampler）',
    },
    // 目錄與模型檢查的狀態各自獨立掃動；實機「滴定頭升到頂才轉盤」的互鎖由各站排程保證，站內全場檢查照常檢查
    verify: { skip: isLabel, allow: [{ why: '目錄的轉盤角度與滴定頭高度各自獨立；互鎖（滴定頭升起才轉盤）由各站排程保證', test: (a, b) => [a, b].some(m => m.userData.bore) && [a, b].some(m => /^(probe-|stirrer-shaft|stirrer-prop|electrode-bulb)/.test(m.name)) }] },
    usage: "import { autosampler } from '@core/models/equipment-lab.js';\nconst smp = autosampler.create(); smp.root.position.set(x, 桌面, z); parent.add(smp.root);\nsmp.set({ angle, lift: 190, stir: 0 });       // 也可以直接改 smp.rack.rotation.y、smp.head.position.y、smp.prop.rotation.y\nconst [lx, lz] = smp.slotPos(3);              // 第 4 個杯位相對轉盤中心（轉盤本地座標是 [lx, plate, −lz]）\n// smp.housing、smp.disc、smp.tower、smp.arm、smp.hub、smp.probes、smp.collars、smp.shaft、smp.prop 是網格",
  },
  create(p = {}) {
    const P = { ...defaults(autosampler.meta), ...p };
    const root = group(P.name ?? 'autosampler', 'autosampler'), mt = P.materials ?? {};
    const body = mt.body ?? CASE, dark = mt.dark ?? CASE_DARK, seat = mt.seat ?? POM, steel = mt.steel ?? MAT.steel, black = mt.black ?? MAT.black;
    const [ox, oy, oz] = P.at ?? [0, 0, 0], hs = P.housing ?? { x: [-220, 220], z: [-220, 220], h: 80 };
    const H = { x: [ox + hs.x[0], ox + hs.x[1]], z: [oz + hs.z[0], oz + hs.z[1]], h: hs.h }, top = P.towerTop ?? 700;
    const housing = block(root, [H.x[1] - H.x[0], H.h, H.z[1] - H.z[0]], [(H.x[0] + H.x[1]) / 2, oy + H.h / 2, (H.z[0] + H.z[1]) / 2], body);
    if (P.brand !== false) decal(root, 150, 26, [(H.x[0] + H.x[1]) / 2, oy + 40, H.z[1] + .6], [0, 0, 0], P.brand ?? 'Metrohm', { color: '#1b4f8a', center: true, bold: true });
    const rack = new THREE.Group(); rack.name = 'sampler rack'; rack.position.set(ox, oy, oz); root.add(rack);
    for (const x of [H.x[0] + 16, H.x[1] - 16]) for (const z of [H.z[0] + 16, H.z[1] - 16]) screw(root, x, oy + H.h + .7, z, steel);
    const disc = cylinder(rack, P.discR ?? 205, P.plate - H.h, [0, H.h + (P.plate - H.h) / 2, 0], dark, 'y', 64);
    cylinder(rack, 24, 8, [0, P.plate + 4, 0], steel, 'y', 48);
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; screw(rack, Math.cos(a) * 17, P.plate + 8.6, Math.sin(a) * 17, steel); }
    const slotPos = s => { const a = s * 2 * Math.PI / P.slots; return [Math.cos(a) * P.r, Math.sin(a) * P.r]; };
    const seats = [];
    for (let s = 0; s < P.slots; s++) {
      const [lx, lz] = slotPos(s); seats.push(ring(rack, P.cupD / 2 + 2, P.cupD / 2 + 8, 26, [lx, P.plate, -lz], seat));
      decal(rack, 22, 16, [lx * 1.36, P.plate + .6, -lz * 1.36], [-Math.PI / 2, 0, 0], String(s + 1), { color: '#e6edf3', center: true, bold: true });
    }
    const towerX = ox + P.towerX;
    const tower = cylinder(root, 36, top - H.h, [towerX, oy + H.h + (top - H.h) / 2, oz], body, 'y', 32);
    const head = new THREE.Group(); head.name = 'sampler head'; head.position.y = oy; root.add(head);   // 滴定頭（升降；本地 y 相對桌面）
    const headX = ox + P.r, headDown = P.plate + 12;                                                    // 下降時元件底端在杯底上 12 mm
    const arm = block(head, [towerX - headX + 40, 36, 60], [(towerX + headX) / 2, headDown + 210, oz], body);
    const hub = cylinder(head, 36, 60, [headX, headDown + 180, oz], dark, 'y', 28);
    const list = P.probes ?? PROBES, probes = [], collars = [];
    for (const [name, r, dx, dz, c] of list) { const m = cylinder(head, r, 170, [headX + dx, headDown + 85 + (r === 6 ? 0 : 20), oz + dz], new THREE.MeshStandardMaterial({ color: c, roughness: .3 })); m.name = 'probe-' + name; probes.push(m); }
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(5.5, 24, 16), mt.bulb ?? GLASS_RIM); bulb.name = 'electrode-bulb'; bulb.position.set(headX, headDown + 4, oz - 14); head.add(bulb);
    for (const [name, r, dx, dz] of list) { const m = cylinder(head, r + 1.4, 8, [headX + dx, headDown + 160, oz + dz], black, 'y', 24); m.name = 'probe-collar-' + name; collars.push(m); }
    const shaft = cylinder(head, 2.5, 172, [headX + 12, headDown + 84, oz + 14], steel); shaft.name = 'stirrer-shaft';   // 延伸到浸入液體的槳葉
    const prop = block(head, [22, 3, 6], [headX + 12, headDown - 2, oz + 14], steel); prop.name = 'stirrer-prop';
    function set({ angle, lift, stir } = {}) {
      if (angle !== undefined) rack.rotation.y = angle;
      if (lift !== undefined) head.position.y = oy + lift;
      if (stir !== undefined) prop.rotation.y = stir;
    }
    return { root, params: P, housing, rack, disc, seats, tower, head, arm, hub, probes, collars, bulb, shaft, prop, slotPos, headX, headDown, towerX, set };
  },
};

// ---------------------------------------------------------------- 電位滴定儀（Titrando 級）＋ Dosino 加液單元與試劑瓶
// 原點：機身底面中心（桌面）；畫面在機身頂面朝上，銘牌在 +Z 面；試劑瓶立在機身頂面 −X 側，瓶口上是 Dosino。固定尺寸。
// bottles 的每一瓶：{ z, label, material } 用內建的空心圓筒；要用站內自己的玻璃器皿畫法時給 create(parent, 半徑, 高) → Object3D。
const AMBER = new THREE.MeshPhysicalMaterial({ color: 0xa06a3a, transparent: true, opacity: .5, roughness: .1 });
const CLEAR = new THREE.MeshPhysicalMaterial({ color: 0xe0f0ef, transparent: true, opacity: .3, roughness: .08, depthWrite: false });
export const titrator = {
  meta: {
    id: 'titrator', name: '電位滴定儀（含 Dosino 與試劑瓶）', category: '實驗室儀器', source: 'AutomaticAcid-BaseTitration',
    params: {},
    options: {
      bottles: "[{ z, label, material?, create? }, …]（預設 NaOH 棕瓶 z −80、純水瓶 z 30）",
      materials: '{ body（機身與 Dosino，預設淺灰） }',
      brand: "銘牌字樣（預設 'Titrando'；false 不貼）",
      canvas: '畫面解析度 [寬, 高]（預設 [360, 210]）', screenFallback: '沒有 canvas 時（Node）畫面網格的材質',
      name: 'root 的名稱（預設 titrator）',
    },
    verify: { skip: isLabel },
    usage: "import { titrator } from '@core/models/equipment-lab.js';\nconst t = titrator.create(); t.root.position.set(x, 桌面, z); parent.add(t.root);\nt.screen.draw(key, (ctx, w, h) => { /* 滴定曲線 */ });\n// t.body、t.dosinos 是網格（避讓清單），t.bottles 是各瓶的群組；Dosino 出口在 [−40, 420, 瓶的 z]",
  },
  create(p = {}) {
    const P = { ...defaults(titrator.meta), ...p };
    const root = group(P.name ?? 'titrator', 'titrator'), body_ = P.materials?.body ?? CASE;
    const body = block(root, [170, 120, 290], [0, 60, 0], body_);
    const [pw, ph] = P.canvas ?? [360, 210];
    const screen = liveScreen(120, 70, pw, ph, P.screenFallback ? { fallback: P.screenFallback } : {}); screen.mesh.position.set(0, 121, 70); screen.mesh.rotation.x = -Math.PI / 2; root.add(screen.mesh);
    if (P.brand !== false) decal(root, 110, 22, [0, 60, 145.6], [0, 0, 0], P.brand ?? 'Titrando', { color: '#1b4f8a', center: true, bold: true });
    const bottles = [], dosinos = [];
    for (const b of P.bottles ?? [{ z: -80, label: 'NaOH 0.1 mol/L', material: AMBER }, { z: 30, label: 'H₂O', material: CLEAR }]) {
      const bottle = b.create ? b.create(root, 48, 190) : vessel(root, 48, 190, b.material ?? CLEAR);
      bottle.position.set(-40, 120, b.z); bottles.push(bottle);
      dosinos.push(cylinder(root, 34, 110, [-40, 120 + 190 + 55, b.z], body_, 'y', 24));
      if (b.label) decal(root, 90, 20, [-40, 200, b.z + 49], [0, 0, 0], b.label, { color: '#e6edf3', center: true, bold: true });
    }
    return { root, params: P, body, screen, bottles, dosinos };
  },
};

// ---------------------------------------------------------------- 機器人用移液模組（電動、夾持環在上方）
// 原點：吸頭座（鼻端）底面中心，+Y 向上；夾爪夾在 collar 高度的夾持環，線纜接頭在頂端。
export const pipetteModule = {
  meta: {
    id: 'pipette-module', name: '機器人用移液模組（5 mL 級）', category: '實驗室儀器', source: 'AutomaticAcid-BaseTitration',
    params: {
      collar: { value: 245, min: 150, max: 400, step: 5, unit: 'mm', label: '夾持環高度' },
      top: { value: 290, min: 180, max: 460, step: 5, unit: 'mm', label: '頂端高度' },
      r: { value: 18, min: 10, max: 30, step: 1, unit: 'mm', label: '本體半徑' },
      nose: { value: 35, min: 15, max: 60, step: 1, unit: 'mm', label: '鼻端長度' },
    },
    options: {
      materials: '{ white（鼻端、頂蓋）, grey（本體、退吸頭套）, ring（識別環，預設藍）, dark（夾持環、接頭，預設 MAT.black）, led（預設 MAT.green） }',
      label: "false 不貼；{ lines=['rLINE','5 mL'], options }：本體 +Z 面的字樣",
      name: 'root 的名稱（預設 pipette-module）',
    },
    usage: "import { pipetteModule } from '@core/models/equipment-lab.js';\nconst pip = pipetteModule.create(); parent.add(pip.root);   // 吸頭裝在原點往 −Y\n// pip.grip 是夾持環（夾爪夾這裡），pip.body、pip.nose、pip.head 是網格",
  },
  create(p = {}) {
    const P = { ...defaults(pipetteModule.meta), ...p };
    const g = group(P.name ?? 'pipette-module', 'pipette-module'), mt = P.materials ?? {};
    g.userData.cableHost = false;   // 整支跟著手臂走（站每格移動 root）：走線不拿它當線夾固定面
    const white = mt.white ?? WHITE, grey = mt.grey ?? GREY, dark = mt.dark ?? MAT.black;
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(9, 5.5, P.nose, 20), white); nose.position.y = P.nose / 2; g.add(nose);
    cylinder(g, 12, 20, [0, P.nose + 10, 0], grey, 'y', 20);                                           // 退吸頭套
    const body = new THREE.Mesh(new THREE.CylinderGeometry(P.r, 14, P.collar - P.nose - 40, 28), grey); body.position.y = (P.collar + P.nose - 20) / 2; g.add(body);
    cylinder(g, P.r + .6, 10, [0, P.collar - 70, 0], mt.ring ?? BLUE, 'y', 28);                        // 模組識別環
    const grip = block(g, [40, 30, 40], [0, P.collar, 0], dark);                                       // 夾持環（夾爪夾這裡）
    const head = new THREE.Mesh(new THREE.CylinderGeometry(20, P.r, P.top - P.collar - 15, 28), white); head.position.y = (P.top + P.collar + 15) / 2; g.add(head);
    const led = block(g, [6, 6, 3], [0, P.collar - 45, P.r - 1], mt.led ?? MAT.green);
    cylinder(g, 5, 30, [0, P.top + 12, 0], dark, 'y', 12);                                             // RS-485／電源線接頭（線沿手臂走）
    const lb = P.label === undefined || P.label === true ? {} : P.label;
    const label = lb ? decal(g, 26, 60, [0, P.collar - 120, P.r + .5], [0, 0, 0], lb.lines ?? ['rLINE', '5 mL'], lb.options ?? { color: '#e6edf3', center: true, bold: true }) : null;
    return { root: g, params: P, nose, body, grip, head, led, label };
  },
};

// ---------------------------------------------------------------- 移液吸頭（拋棄式，含液柱）
// 原點：吸頭座（裝上移液模組時與模組原點重合），吸頭往 −Y；液柱 liquid 是效果（userData.fx），用 setFill(高度) 變形。
const TIP = new THREE.MeshPhysicalMaterial({ color: 0xe5eeee, roughness: .21, clearcoat: .6, transparent: true, opacity: .28, depthWrite: false, side: THREE.DoubleSide });
const LIQUID = new THREE.MeshPhysicalMaterial({ color: 0xc7dfda, roughness: .13, clearcoat: 1, clearcoatRoughness: .06, transparent: true, opacity: .55, depthWrite: false, side: THREE.DoubleSide });
export const pipetteTip = {
  meta: {
    id: 'pipette-tip', name: '移液吸頭（5 mL 級）', category: '實驗室儀器', source: 'AutomaticAcid-BaseTitration',
    params: {
      length: { value: 160, min: 60, max: 250, step: 5, unit: 'mm', label: '吸頭長度' },
      radius: { value: 10, min: 4, max: 15, step: .5, unit: 'mm', label: '吸頭口半徑' },
    },
    states: { fill: { value: 0, min: 0, max: 140, unit: 'mm', label: '液柱高度' } },
    options: {
      material: '吸頭材質（預設半透明 PP）', liquidMaterial: '液柱材質（預設淡綠半透明）',
      fillShape: '{ r0=.7, slope=7.5, length=140 }：液柱在高度 y 的半徑＝r0＋slope·y/length（吸頭內錐）',
      name: 'root 的名稱（預設 pipette-tip）',
    },
    usage: "import { pipetteTip } from '@core/models/equipment-lab.js';\nconst tip = pipetteTip.create(); parent.add(tip.root);\ntip.setFill(液柱高度 mm, 是否顯示);            // 或 tip.set({ fill })；tip.cone、tip.collar、tip.liquid 是網格",
  },
  create(p = {}) {
    const P = { ...defaults(pipetteTip.meta), ...p };
    const g = group(P.name ?? 'pipette-tip', 'pipette-tip'), mat = P.material ?? TIP, fs = P.fillShape ?? {};
    g.userData.cableHost = false;   // 整支跟著手臂走（站每格移動 root）：走線不拿它當線夾固定面
    const r0 = fs.r0 ?? .7, slope = fs.slope ?? 7.5, len = fs.length ?? 140;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(P.radius - 1, 1.2, P.length - 20, 20, 1, true), mat); cone.position.y = -20 - (P.length - 20) / 2; g.add(cone);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(P.radius, P.radius - 1, 20, 20, 1, true), mat); collar.position.y = -10; g.add(collar);
    const liquid = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 14), P.liquidMaterial ?? LIQUID); liquid.visible = false; liquid.userData.fx = true; g.add(liquid);
    cone.renderOrder = collar.renderOrder = 3; liquid.renderOrder = 2;
    const unit = liquid.geometry.attributes.position.array.slice();
    let last = null;
    /** 液柱高度 h（mm，由吸頭尖端往上）；visible 預設 h > 0 */
    function setFill(h, visible = h > 0) {
      liquid.visible = !!visible;
      if (h !== last) {
        last = h; const pos = liquid.geometry.attributes.position;
        for (let n = 0; n < pos.count; n++) { const y = unit[n * 3 + 1] + .5, r = r0 + slope * y * h / len; pos.setXYZ(n, unit[n * 3] * r, y * h, unit[n * 3 + 2] * r); }
        pos.needsUpdate = true; liquid.geometry.computeVertexNormals(); liquid.geometry.computeBoundingSphere();
      }
      liquid.position.y = -P.length + 2;
    }
    return { root: g, params: P, cone, collar, liquid, unitVertices: unit, setFill, set({ fill = 0 } = {}) { setFill(fill); } };
  },
};

// ---------------------------------------------------------------- 廢液桶（方形塑膠桶，含液位開關標示）
// 原點：桶底面中心；標示貼在 +Z 面。
const CANISTER = pbr(0xe3e6d9, .6);
export const wasteCanister = {
  meta: {
    id: 'waste-canister', name: '廢液桶（方桶，含液位開關標示）', category: '實驗室儀器', source: 'AutomaticAcid-BaseTitration',
    params: {
      w: { value: 260, min: 120, max: 500, step: 10, unit: 'mm', label: '寬（X）' },
      h: { value: 330, min: 150, max: 700, step: 10, unit: 'mm', label: '高' },
      d: { value: 200, min: 100, max: 500, step: 10, unit: 'mm', label: '深（Z）' },
    },
    options: {
      material: '桶身材質（預設米白 0xe3e6d9）',
      label: "false 不貼；{ lines=['廢液桶','液位開關'], w=150, h=60, pos=[0, 230, d/2+1], options }：+Z 面的標示",
      name: 'root 的名稱（預設 waste-canister）',
    },
    usage: "import { wasteCanister } from '@core/models/equipment-lab.js';\nconst can = wasteCanister.create(); can.root.position.set(x, 層板面, z); parent.add(can.root);   // can.body 是桶身",
  },
  create(p = {}) {
    const P = { ...defaults(wasteCanister.meta), ...p };
    const root = group(P.name ?? 'waste-canister', 'waste-canister');
    const body = block(root, [P.w, P.h, P.d], [0, P.h / 2, 0], P.material ?? CANISTER);
    const lb = P.label === undefined || P.label === true ? {} : P.label;
    const label = lb ? decal(root, lb.w ?? 150, lb.h ?? 60, lb.pos ?? [0, 230, P.d / 2 + 1], [0, 0, 0], lb.lines ?? ['廢液桶', '液位開關'], lb.options ?? { color: '#b33', center: true, bold: true }) : null;
    return { root, params: P, body, label };
  },
};
