// 前段：現場既有的分選線（2026-10-02 現場照片與影片、開案報告第 3 頁的現場配置圖），在後段補抓站的上游。
// 同一條既有皮帶上依序是：入料罩 → 刮料簾 → 導料板 → 前段立體取像站（新視覺，規格與後段相同）→
// ABB IRB 360 並聯手臂（藍色鋼構網籠、吸塵器式真空吸嘴，旁邊是兩段反向的既有分類帶）→ 既有電控櫃（DENSO 系統盤也裝在裡面）。
// 尺寸全部是照片目測的示意值；這裡只建固定設備與手臂模型，皮帶本體、排程與每個時間點的姿態在 project.js。
import * as THREE from 'three';
import { block, blockBetween, cylinder, plate, pipe, decal } from '@core/geom/shapes.js';
import { MAT, std, finished } from '@core/geom/materials.js';
import { foot } from '@core/geom/hardware.js';
import { create as visionCamera } from '@core/models/camera.js';
import { cable, cableTray, CABLE } from '@core/electrical/cable-routing.js';
import { beltTexture, createLightPatch, SURFACE } from './appearance.js';
import { laneAt } from './schedule.js';
import { createDelta } from './delta.js';

export const RUST = std(0x6f4c36, .88, .15), SITE_FRAME = std(0x3f6c80, .7, .3);    // 鏽色側牆、既有輸送帶的藍綠色機架
const CELL = std(0x4d83b8, .6, .25), CAB = std(0xb7bcc0, .62, .2), STRIPE = std(0x5b8fc7, .6, .1);
const BIN = std(0x2f4a3d, .8, .05), STRIP = std(0xd9b44c, .55, 0, { transparent: true, opacity: .6 });
const LED_ON = std(0xffffff, .3, 0, { emissive: 0xffffff, emissiveIntensity: 1.1 });

// 擴張網護板：線條不透明、網目透明的貼圖（遠看是一層薄紗）。UV 依實際尺寸換算，所有護板共用一個材質。
const meshGuard = (() => {
  const n = 32, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.min(Math.abs((x + y) % n - n / 2), Math.abs((x - y + n) % n - n / 2));
    data.set([150, 160, 168, d < 1.25 ? 150 : 0], (y * n + x) * 4);
  }
  const map = new THREE.DataTexture(data, n, n); map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true; map.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: .6, metalness: .4 });
})();
/** 護板：a、b 是兩個對角點，其中一軸厚度為 0 的那一面就是護板平面（實際做成 6 mm 厚的板） */
function guard(parent, a, b) {
  const size = [0, 1, 2].map(k => Math.max(6, Math.abs(b[k] - a[k]))), pos = [0, 1, 2].map(k => (a[k] + b[k]) / 2);
  const m = block(parent, size, pos, meshGuard), p = m.geometry.attributes.position, uv = m.geometry.attributes.uv;
  const u = size[0] > 6 ? 0 : 2;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getComponent(i, u) / 60, p.getY(i) / 60);
  m.castShadow = false; m.name = 'mesh guard'; return m;
}

/**
 * 導料板一組（兩片斜板＋托架）：開口與中心線照 schedule.js 的 laneAt()，所以板面和工件走的通道是同一份定義。
 * 後段的導料板（project.js）有較多細節，這裡只給前段用。
 */
export function guidePlates(belt, g, L) {
  const b = L.belt, bz = b.z, [x0, x1] = g.x, len = x1 - x0;
  const zAt = (side, x) => { const { gap, center } = laneAt(x); return center + side * (gap / 2 + 6); };
  for (const side of [-1, 1]) {
    const z0 = zAt(side, x0), z1 = zAt(side, x1);
    const pl = block(belt, [Math.hypot(len, z1 - z0), g.h, 12], [(x0 + x1) / 2, b.top + 6 + g.h / 2, (z0 + z1) / 2], SURFACE.support);
    pl.rotation.y = -Math.atan2(z1 - z0, len); pl.name = 'guide plate';
    for (const mx of g.mountX)                                                     // 側牆到導料板的托架（在板的外側）
      blockBetween(belt, [mx - 20, b.top + 26, zAt(side, mx) + side * 8], [mx + 20, b.top + 64, bz + side * (b.width / 2 + 4)], SITE_FRAME);
  }
}

/** 限高刮料簾：兩根立柱＋橫桿＋一排軟簾片；簾底離帶面 clear。簾片不是承載面，全場檢查會照常檢查工件有沒有撞到 */
export function levelCurtain(belt, x, L) {
  const b = L.belt, bz = b.z, C = L.curtain, top = b.top + C.clear + C.h, zp = b.width / 2 + 32;
  for (const s of [-1, 1]) block(belt, [36, top + 40 - 725, 24], [x, (top + 40 + 725) / 2, bz + s * zp], SITE_FRAME);
  block(belt, [40, 40, 2 * zp + 24], [x, top + 20, bz], SITE_FRAME);
  for (let i = -6; i <= 6; i++) block(belt, [4, C.h, 40], [x, b.top + C.clear + C.h / 2, bz + i * 45], STRIP).name = 'curtain strip';
}

export function createFrontLine(scene, L, belt) {
  const b = L.belt, bz = b.z, bw = b.width, S = L.site, F = L.front, A = L.abb, C = A.cell, K = L.siteCabinet;

  // ================================================================ 既有皮帶上的前段配件：入料罩、兩道刮料簾、前段導料板
  const hx = S.x0 + 140;                                                           // 上游入料罩（料斗出口，示意）：工件整件上了帶面才出現，從罩子底下流出來
  block(belt, [380, 8, bw + 60], [hx, b.top + 256, bz], RUST).name = 'hood';
  for (const s of [-1, 1]) block(belt, [380, 150, 8], [hx, b.top + 180, bz + s * (bw / 2 + 22)], RUST).name = 'hood';
  block(belt, [8, 250, bw + 60], [hx - 194, b.top + 135, bz], RUST).name = 'hood';
  decal(belt, 330, 46, [S.x0 + 520, 630, bz + 333], [0, 0, 0], '既有輸送帶（示意）', { center: true, color: '#d6e2e6' });
  for (const x of L.curtain.x) levelCurtain(belt, x, L);
  guidePlates(belt, L.frontGuide, L);

  // ================================================================ 前段立體取像站（獨立門型架，相機規格與後段相同）
  const vision = new THREE.Group(); vision.name = 'frontVision'; scene.add(vision);
  const [fz0, fz1] = F.legZ, railLen = fz1 - fz0 + 60, railZ = (fz0 + fz1) / 2;
  for (const z of F.legZ) {
    for (const s of [-1, 1]) { block(vision, [F.post, F.beamY - 120, F.post], [F.x + s * F.legX, (F.beamY - 120) / 2, z], MAT.frame); foot(vision, F.x + s * F.legX, z, 140); }
    block(vision, [2 * F.legX + F.post, 60, F.post], [F.x, F.beamY - 90, z], MAT.frame);     // 柱頂橫樑
  }
  for (const s of [-1, 1]) block(vision, [45, 120, railLen], [F.x + s * 80, F.beamY, railZ], MAT.frame);   // 雙軌
  const cameras = F.camZ.map((z, i) => {
    const cam = visionCamera({ sensorW: 8.8, sensorH: 6.6, focal: 10, ring: 0 });
    cam.root.name = `CAM${i + 3}`; cam.root.position.set(F.x, F.camY, z); cam.root.rotation.y = Math.PI / 2; vision.add(cam.root);
    block(vision, [35, 60, 38], [F.x + 39.5, F.camY + 90, z], MAT.steelDark);                // 側掛板（固定在 +X 軌內側）
    return cam;
  });
  const ledZ = F.ledLen / 2 - 30, leds = [];
  for (const s of [-1, 1]) block(vision, [F.ledX[1] - F.ledX[0] + 60, 40, 40], [F.x, F.beamY - 80, bz + s * ledZ], MAT.frame);   // 條燈橫托架
  for (const lx of F.ledX) {
    const side = lx < F.x ? -1 : 1, tilt = side * Math.PI / 4;
    block(vision, [60, 50, F.ledLen], [lx, F.ledY, bz], MAT.alu).rotation.z = tilt;
    const lens = block(vision, [52, 8, F.ledLen - 20], [lx - side * 20, F.ledY - 20, bz], LED_ON); lens.rotation.z = tilt; leds.push(lens);
    for (const s of [-1, 1]) block(vision, [34, F.beamY - 100 - F.ledY - 40, 34], [lx, (F.beamY - 100 + F.ledY + 40) / 2, bz + s * ledZ], MAT.frame);
  }
  plate(vision, ['前段立體取像站（新視覺）', `基線 ${F.baseline}／WD ${F.wd}（示意）`], 330, 90, [F.x, F.beamY, fz1 + 34], 0,
    { font: 'bold 36px "Microsoft JhengHei",sans-serif' });
  vision.traverse(m => { if (m.isMesh && m.material === MAT.frame) m.material = SURFACE.extrusion; else if (m.isMesh && m.material === MAT.alu) m.material = SURFACE.support; });
  const lightPatch = createLightPatch(scene, F, b);

  // ================================================================ ABB 網籠（藍色鋼構＋擴張網護板）
  const cell = new THREE.Group(); cell.name = 'abbCell'; scene.add(cell);
  const [cx0, cx1] = C.x, [cz0, cz1] = C.z, P = C.post, ix0 = cx0 + P, ix1 = cx1 - P, iz0 = cz0 + P, iz1 = cz1 - P;
  for (const x of [cx0 + P / 2, cx1 - P / 2]) for (const z of [cz0 + P / 2, cz1 - P / 2]) {
    block(cell, [P, C.top, P], [x, C.top / 2, z], CELL);
    block(cell, [P + 60, 14, P + 60], [x, 7, z], MAT.steelDark);
  }
  for (const y of [120, C.rail, C.top - 40]) {                                               // 下、中、上三圈橫樑
    const h = y === C.rail ? 60 : 80;
    for (const z of [cz0 + P / 2, cz1 - P / 2]) block(cell, [ix1 - ix0, h, P], [(ix0 + ix1) / 2, y, z], CELL);
    for (const x of [cx0 + P / 2, cx1 - P / 2]) block(cell, [P, h, iz1 - iz0], [x, y, (iz0 + iz1) / 2], CELL);
  }
  for (const s of [-1, 1]) block(cell, [ix1 - ix0, 80, 80], [(ix0 + ix1) / 2, C.top - 40, bz + s * 300], CELL);   // 吊掛手臂的兩根橫樑
  block(cell, [760, 20, 760], [A.x, C.top - 90, bz], MAT.steelDark);                         // 安裝頂板
  // 護板：±Z 兩面整片；±X 兩面留主帶與分類帶的穿越口
  const gy = [160, C.rail - 30, C.rail + 30, C.top - 80], So = A.sort, open = [bz - 370, bz + So.z + So.width / 2 + 40];
  for (const z of [cz0 + P / 2, cz1 - P / 2]) { guard(cell, [ix0, gy[0], z], [ix1, gy[1], z]); guard(cell, [ix0, gy[2], z], [ix1, gy[3], z]); }
  for (const x of [cx0 + P / 2, cx1 - P / 2]) {
    guard(cell, [x, gy[2], iz0], [x, gy[3], iz1]);
    guard(cell, [x, gy[0], iz0], [x, gy[1], open[0]]); guard(cell, [x, gy[0], open[1]], [x, gy[1], iz1]);
  }
  plate(cell, ['既有 ABB 分選站', 'IRB 360 並聯手臂（示意）'], 560, 120, [A.x, C.top - 40, cz1 + 3], 0,
    { font: 'bold 40px "Microsoft JhengHei",sans-serif' });
  // 真空管路（示意）：吸嘴軟管接到這根固定管，從網籠頂部橫跨到既有電控櫃櫃頂，接櫃內下層的吸塵器
  const hoseEnd = [A.x, A.shoulderY + 200, bz - 780], vx = K.x[0] + 70;
  const vac = pipe(cell, [hoseEnd, [A.x, C.top + 100, hoseEnd[2]], [vx, C.top + 100, hoseEnd[2]], [vx, K.h + 2, hoseEnd[2]]], 30, 0x7c8c6a, 0x8f8a72);
  vac.mesh.name = 'hose anchor';
  block(cell, [30, 70, 60], [cx1 - 65, C.top + 35, hoseEnd[2]], MAT.steelDark);              // 管架：立在 +X 頂樑上

  // ================================================================ ABB 並聯手臂
  const robot = new THREE.Group(); robot.name = 'abbRobot'; scene.add(robot);
  const delta = createDelta({ geometry: A.delta, toolLen: A.toolLen, hose: [0, 200, -780] });
  delta.root.position.set(A.x, A.shoulderY, bz); robot.add(delta.root);

  // ================================================================ 既有分類帶（與主帶平行、兩段反向）與帶尾收料箱
  // 食品段在網籠下游側、往下游走；非食品段在上游側、往上游走（開案報告第 3 頁圖）。
  const sort = new THREE.Group(); sort.name = 'abbSort'; scene.add(sort);
  const zc = bz + So.z, [kw, kh, kd] = So.bin, zones = {};
  for (const [key, dir, x0, x1] of [['food', 1, A.x + So.gap, cx1 + 40], ['nonfood', -1, cx0 - 40, A.x - So.gap]]) {
    const len = x1 - x0, cx = (x0 + x1) / 2, tex = beltTexture(0x53606a); tex.repeat.set(len / 100, 1);
    block(sort, [len, 14, So.width], [cx, So.top - 7, zc], std(0xffffff, .92, .02, { map: tex })).name = 'sort belt';
    block(sort, [len, 10, So.width], [cx, So.top - 90, zc], MAT.belt);
    block(sort, [len - 20, 16, So.width - 30], [cx, So.top - 32, zc], SURFACE.support);
    for (const s of [-1, 1]) {
      block(sort, [len, 90, 20], [cx, So.top - 50, zc + s * (So.width / 2 + 10)], SITE_FRAME);
      block(sort, [len, 50, 10], [cx, So.top + 25, zc + s * (So.width / 2 + 5)], RUST);
    }
    const rollers = [x0, x1].map(x => cylinder(sort, 42, So.width + 14, [x, So.top - 50, zc], finished(MAT.roller, 'metal'), 'z', 20));
    for (const x of [x0 + 180, x1 - 180]) { block(sort, [60, So.top - 100, 60], [x, (So.top - 100) / 2, zc], SITE_FRAME); foot(sort, x, zc, 140); }
    const exit = dir > 0 ? x1 : x0, bx = exit + dir * (42 + 12 + kw / 2);                    // 帶尾的收料箱
    block(sort, [kw, 20, kd], [bx, 30, zc], BIN);
    for (const s of [-1, 1]) block(sort, [kw, kh, 20], [bx, kh / 2 + 42, zc + s * (kd / 2 - 10)], BIN);
    for (const s of [-1, 1]) block(sort, [20, kh, kd - 44], [bx + s * (kw / 2 - 10), kh / 2 + 42, zc], BIN);
    plate(sort, [key === 'food' ? '食品 HDPE' : '非食品 HDPE'], 300, 80, [bx, 320, zc + kd / 2 + 3], 0);
    const slots = [];
    for (let layer = 0; layer < 4; layer++) for (const dx of [-135, 0, 135]) slots.push({ x: bx + dx, y: 44 + layer * 110, z: zc, theta: Math.PI / 2 + dx / 135 * .08 });
    zones[key] = { key, dir, x: [x0, x1], drop: A.x + dir * So.dropX, exit, tex, rollers, slots, used: 0 };
  }

  // ================================================================ 既有電控櫃（門朝 −Z 的操作走道；第 3 頁圖的位置）
  // 上游半是既有 ABB 的控制器與人機螢幕；下游半的門打開（剖視）後，上層是 DENSO 系統盤、下層是 RC8A（electrical.js 建）。
  // 櫃體做成真的空殼：背板離地 130 留進出線、隔板後方留線槽空間，DENSO 的立管才下得到地面。
  const cab = new THREE.Group(); cab.name = 'siteCabinet'; scene.add(cab);
  const [kx0, kx1] = K.x, [kz0, kz1] = K.z, W = kx1 - kx0, kxc = (kx0 + kx1) / 2, kzc = (kz0 + kz1) / 2, mid = kxc - 50, T = 20;
  block(cab, [W, K.h - 130, T], [kxc, (K.h + 130) / 2, kz1 - T / 2], CAB);                    // 背板
  for (const x of [kx0 + T / 2, kx1 - T / 2]) block(cab, [T, K.h, kz1 - kz0 - T], [x, K.h / 2, kzc - T / 2], CAB);   // 側板
  block(cab, [W - 2 * T, T, kz1 - kz0 - T], [kxc, K.h - T / 2, kzc - T / 2], CAB);            // 頂板
  block(cab, [W - 2 * T, T, 330], [kxc, K.shelf - T / 2, kz0 + T + 165], CAB);                // 上下層隔板（後方留線槽空間）
  block(cab, [W - 2 * T, 100, T], [kxc, 50, kz0 + T / 2], MAT.steelDark);                     // 前踢腳（在門的正下方）
  // 四扇門：下游半的兩扇是 DENSO 側，標成 electricalCover——電盤剖視時隱藏、透視時半透明
  const door = (x0, x1, y0, y1, cover) => {
    const g = new THREE.Group(); g.name = cover ? 'DENSO 側櫃門' : 'ABB 側櫃門'; if (cover) g.userData.electricalCover = true; cab.add(g);
    block(g, [x1 - x0 - 6, y1 - y0 - 6, T], [(x0 + x1) / 2, (y0 + y1) / 2, kz0 + T / 2], CAB);
    block(g, [26, 110, 14], [x0 < mid ? x1 - 60 : x0 + 60, (y0 + y1) / 2, kz0 - 7], MAT.steelDark);   // 門把（靠中縫）
    return g;
  };
  const doors = [door(kx0, mid, K.shelf, K.h, false), door(mid, kx1, K.shelf, K.h, true), door(kx0, mid, 100, K.shelf, false), door(mid, kx1, 100, K.shelf, true)];
  for (const [g, x0, x1] of [[doors[0], kx0, mid], [doors[1], mid, kx1]]) block(g, [x1 - x0 - 6, 50, 5], [(x0 + x1) / 2, K.shelf + 90, kz0 - 2.5], STRIPE);   // 藍色腰線
  for (const [g, x] of [[doors[2], (kx0 + mid) / 2], [doors[3], (mid + kx1) / 2]]) block(g, [150, 150, 8], [x, 420, kz0 - 4], std(0xd9d2bd, .8, 0));       // 百葉
  // ABB 側上門：15.6 吋人機螢幕、按鈕列、急停、標牌（都朝 −Z）
  const sx = (kx0 + mid) / 2, back = Math.PI;
  block(doors[0], [430, 270, 10], [sx, 1500, kz0 - 5], MAT.black);
  [MAT.green, MAT.steelDark, MAT.green, MAT.red, MAT.steelBlue].forEach((m, i) => cylinder(doors[0], 16, 14, [sx + 160 - i * 62, 1280, kz0 - 7], m, 'z', 18));
  cylinder(doors[0], 30, 12, [sx - 230, 1280, kz0 - 6], MAT.yellow, 'z', 22); cylinder(doors[0], 20, 14, [sx - 230, 1280, kz0 - 19], MAT.red, 'z', 20);   // 急停
  plate(doors[0], ['既有電控櫃（示意）', 'ABB 控制器／輸送帶追蹤／吸塵器'], 560, 110, [sx, 1900, kz0 - 1.5], back, { font: 'bold 36px "Microsoft JhengHei",sans-serif' });
  plate(doors[1], ['DENSO 系統盤（裝在既有電控櫃內）', '上層：系統盤　下層：RC8A 控制器（示意）'], 600, 110, [(mid + kx1) / 2, 1900, kz0 - 1.5], back, { font: 'bold 34px "Microsoft JhengHei",sans-serif' });
  // 螢幕內容由 project.js 依計數更新（canvas；Node 檢查時是空白貼圖）
  const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 480;
  const screenTex = new THREE.CanvasTexture(canvas); screenTex.colorSpace = THREE.SRGBColorSpace; screenTex.generateMipmaps = false; screenTex.minFilter = THREE.LinearFilter;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(404, 244), new THREE.MeshBasicMaterial({ map: screenTex }));
  screen.position.set(sx, 1500, kz0 - 11); screen.rotation.y = back; doors[0].add(screen);
  let shown = '';
  function setScreen(text) {
    const key = text.join('|'), ctx = canvas.getContext('2d');
    if (key === shown || !ctx?.fillText) return; shown = key;
    ctx.fillStyle = '#eef1f2'; ctx.fillRect(0, 0, 800, 480);
    text.forEach(([s, color = '#1c2a33', size = 40], i) => { ctx.fillStyle = color; ctx.font = `bold ${size}px "Microsoft JhengHei",sans-serif`; ctx.fillText(s, 36, 76 + i * 78); });
    screenTex.needsUpdate = true;
  }

  // ================================================================ 配線（示意）：前段相機幹線、ABB 手臂纜線、櫃內的整合通訊
  const wiring = new THREE.Group(); wiring.name = 'frontWiring'; scene.add(wiring);
  const tx = F.x + F.legX + 38, railX = F.x + 80 + 22.5 + 8, tz = kz0 + 100;                  // 門型架 +X 柱外側、+X 軌外側、沿網籠前方的地面線槽
  const feet = pts => { for (const [x, z] of pts) block(wiring, [30, 50, 30], [x, 25, z], MAT.steelDark); };
  cableTray(wiring, '前段相機線槽 A', [tx, 60, fz0 - 90], [tx, 60, tz - 30]);
  cableTray(wiring, '前段相機線槽 B', [tx + 40, 60, tz], [kx0 - 30, 60, tz]);
  feet([[tx, fz0 - 90], [tx, tz - 30], ...Array.from({ length: 4 }, (_, i) => [tx + 40 + i * (kx0 - 70 - tx) / 3, tz])]);
  cameras.forEach((cam, i) => {
    const z = cam.root.position.z, y = F.beamY - 20 - i * 22, top = F.camY + 118, lane = 6 + i * 10, zl = fz0 + 6 + i * 14;
    cable(vision, `CAM${i + 3} / GigE PoE 與同步觸發`, [[F.x, top, z], [F.x, F.beamY + 85, z], [railX, F.beamY + 85, z], [railX, y, z - 40], [railX, y, zl],
      [railX, F.beamY - 48, zl], [tx, F.beamY - 48, zl], [tx, 60, zl], [tx + lane, 60, fz0 - 40], [tx + lane, 60, tz + lane], [kx0 + 2, 60, tz + lane]], { color: CABLE.signal, radius: 4, clips: 6 });
  });
  const px = cx1 - P / 2, pz = cz0 - 12, topY = C.top + 12;                                   // 網籠下游、操作側的角柱
  cable(cell, 'ABB / 手臂動力與編碼器（既有）', [[kx0 + 2, 2000, pz], [px, 2000, pz], [px, topY, pz], [px + 20, topY + 20, cz0 + P / 2],
    [px + 20, topY + 20, bz - 300], [A.x + 200, topY + 20, bz - 300], [A.x + 200, topY + 20, bz - 210], [A.x + 200, C.top - 68, bz - 210]], { color: CABLE.power, radius: 6, clips: 8 });
  // 兩站的視覺主機與手臂控制器在同一座櫃內，整合通訊只是一段櫃內跳線（接到背板上的交換器，示意）
  block(cab, [120, 44, 70], [mid, 1700, kz1 - T - 35], MAT.steelDark).name = '整合通訊交換器';
  cable(cab, '整合通訊 / 兩站視覺主機與手臂控制器（Ethernet，示意）', [[kx0 + 80, 1700, kz1 - T - 12], [mid - 58, 1700, kz1 - T - 12]], { color: CABLE.signal, radius: 4, clips: 3 });

  return {
    vision, cameras, leds, lightPatch, cell, robot, delta, sort, zones, sortZ: zc, cab, setScreen, wiring,
    /** 吸嘴口（世界座標）→ 動平台中心（手臂 root 座標） */
    toPlatform: (x, y, z) => [x - A.x, y + A.toolLen - A.shoulderY, z - bz],
  };
}
