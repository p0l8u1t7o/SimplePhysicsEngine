// 前段：現場既有的分選線（2026-10-02 現場照片與影片），接在後段補抓站的上游。
// 既有輸送帶 → 前段立體取像站（新視覺，規格與後段相同）→ ABB IRB 360 並聯手臂（藍色鋼構網籠、吸塵器式真空吸嘴、
// 四個滑槽與收料籃）→ 過渡板 → 後段主帶。另有既有電控櫃與三條示意配線（前段相機、手臂、兩站之間的整合通訊）。
// 尺寸全部是照片目測的示意值；這裡只建固定設備與手臂模型，排程與每個時間點的姿態在 project.js。
import * as THREE from 'three';
import { block, cylinder, plate, pipe, decal } from '@core/geom/shapes.js';
import { MAT, std, finished } from '@core/geom/materials.js';
import { foot, motor } from '@core/geom/hardware.js';
import { create as visionCamera } from '@core/models/camera.js';
import { cable, cableTray, CABLE } from '@core/electrical/cable-routing.js';
import { beltTexture, createLightPatch, SURFACE } from './appearance.js';
import { createDelta } from './delta.js';

const RUST = std(0x6f4c36, .88, .15), SITE_FRAME = std(0x3f6c80, .7, .3);            // 鏽色側牆、既有輸送帶的藍綠色機架
const CELL = std(0x4d83b8, .6, .25), CAB = std(0xb7bcc0, .62, .2), STRIPE = std(0x5b8fc7, .6, .1);
const BASKET = std(0x2f4a3d, .8, .05), CHUTE = finished(MAT.steel, 'metal', .06);
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

export function createFrontLine(scene, L) {
  const b = L.belt, bz = b.z, bw = b.width, S = L.site, F = L.front, A = L.abb, C = A.cell;
  const [sx0, sx1] = S.x;

  // ================================================================ 既有輸送帶（綠色平皮帶＋鏽色側牆）
  const belt = new THREE.Group(); belt.name = 'siteBelt'; scene.add(belt);
  const len = sx1 - sx0 - 2 * S.roller, cx = (sx0 + sx1) / 2, xe = b.x[0] - b.roller - 12, wl = xe - sx0, wx = (xe + sx0) / 2;
  const tex = beltTexture(0x426950); tex.repeat.set(len / 120, 1);
  block(belt, [len, 16, bw], [cx, b.top - 8, bz], std(0xffffff, .93, .01, { map: tex }));    // 承載面
  block(belt, [len, 12, bw], [cx, 658, bz], std(0x304b3b, .93, .01));                        // 回程面
  block(belt, [len - 40, 18, bw - 40], [cx, 723, bz], SURFACE.support);
  const rollers = S.x.map(x => cylinder(belt, S.roller, bw + 20, [x, 700, bz], finished(MAT.roller, 'metal'), 'z', 24));
  for (const s of [-1, 1]) {
    block(belt, [wl, 130, 24], [wx, 660, bz + s * 320], SITE_FRAME);                         // 側樑
    block(belt, [wl, S.wall + 10, 10], [wx, b.top + S.wall / 2 - 5, bz + s * 311], RUST);    // 側牆（高於帶面 110）
  }
  for (const x of S.legX) {
    for (const z of b.legZ) { block(belt, [70, 595, 70], [x, 298, z], SITE_FRAME); foot(belt, x, z, 150); }
    block(belt, [60, 50, 570], [x, 170, bz], SITE_FRAME);
  }
  motor(belt, sx1 - 40, 450, bz - 410, .6);                                                 // 驅動馬達（示意）
  // 過渡板：兩條帶的滾筒之間（離兩邊滾筒中心各 26 mm，板底在滾筒圓弧之上）
  const [px0, px1] = S.plate;
  block(belt, [px1 - px0, 4, bw + 16], [(px0 + px1) / 2, b.top - 2, bz], finished(MAT.steel, 'metal'));   // 兩端搭在側樑內側
  // 上游入料罩（料斗出口，示意）：工件從罩子底下流出來
  const hx = sx0 + 110;
  block(belt, [320, 8, bw + 60], [hx, b.top + 256, bz], RUST);
  for (const s of [-1, 1]) block(belt, [320, 150, 8], [hx, b.top + 180, bz + s * (bw / 2 + 22)], RUST);
  block(belt, [8, 250, bw + 60], [hx - 164, b.top + 135, bz], RUST);
  decal(belt, 330, 46, [sx0 + 420, 630, bz + 333], [0, 0, 0], '既有輸送帶（示意）', { center: true, color: '#d6e2e6' });

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
  // 護板：±Z 兩面各留兩個滑槽開口，±X 兩面留輸送帶穿越口
  const gy = [160, C.rail - 30, C.rail + 30, C.top - 80], chuteX = [-1, 1].map(k => A.x + k * A.chuteX), ow = A.chute.width / 2 + 30, oy = [420, 930];
  for (const z of [cz0 + P / 2, cz1 - P / 2]) {
    guard(cell, [ix0, gy[2], z], [ix1, gy[3], z]);
    guard(cell, [ix0, gy[0], z], [ix1, oy[0], z]); guard(cell, [ix0, oy[1], z], [ix1, gy[1], z]);
    const xs = [ix0, chuteX[0] - ow, chuteX[0] + ow, chuteX[1] - ow, chuteX[1] + ow, ix1];
    for (let i = 0; i < 6; i += 2) guard(cell, [xs[i], oy[0], z], [xs[i + 1], oy[1], z]);
  }
  for (const x of [cx0 + P / 2, cx1 - P / 2]) {
    guard(cell, [x, gy[2], iz0], [x, gy[3], iz1]);
    guard(cell, [x, gy[0], iz0], [x, gy[1], bz - 370]); guard(cell, [x, gy[0], bz + 370], [x, gy[1], iz1]);
  }
  plate(cell, ['既有 ABB 分選站', 'IRB 360 並聯手臂（示意）'], 560, 120, [A.x, C.top - 40, cz1 + 3], 0,
    { font: 'bold 40px "Microsoft JhengHei",sans-serif' });
  // 真空管路（示意）：吸嘴軟管接到這根固定管，翻過頂樑沿網籠外側下到地面，接到電控櫃下層的吸塵器
  const hoseEnd = [A.x, A.shoulderY + 200, bz - 780], vx = cx0 + 140, vz = cz0 - 60, cabX = A.cabinet.x + A.cabinet.size[0] / 2;
  const vac = pipe(cell, [hoseEnd, [A.x, C.top + 70, hoseEnd[2]], [A.x, C.top + 70, vz], [vx, C.top + 70, vz], [vx, 140, vz],
    [vx, 140, A.cabinet.z], [cabX + 10, 140, A.cabinet.z]], 30, 0x7c8c6a, 0x8f8a72);
  vac.mesh.name = 'hose anchor';
  for (const y of [120, C.rail, C.top - 40]) block(cell, [60, 40, 30], [vx, y, cz0 - 15], MAT.steelDark);   // 管夾座

  // ================================================================ ABB 並聯手臂
  const robot = new THREE.Group(); robot.name = 'abbRobot'; scene.add(robot);
  const delta = createDelta({ geometry: A.delta, toolLen: A.toolLen, hose: [0, 200, -780] });
  delta.root.position.set(A.x, A.shoulderY, bz); robot.add(delta.root);

  // ================================================================ 滑槽 ×4 與收料籃 ×4
  const bins = new THREE.Group(); bins.name = 'abbBins'; scene.add(bins);
  const ch = A.chute, slope = Math.atan2(ch.yIn - ch.yOut, ch.zOut - ch.zIn), run = Math.hypot(ch.yIn - ch.yOut, ch.zOut - ch.zIn);
  const chuteY = zRel => ch.yIn - (Math.abs(zRel) - ch.zIn) * Math.tan(slope);               // 滑槽面高度
  const [kx, ky, kz] = A.basket.size, zones = [];
  for (const side of [-1, 1]) for (const k of [-1, 1]) {
    const x = A.x + k * A.chuteX, g = new THREE.Group();
    g.position.set(x, (ch.yIn + ch.yOut) / 2, bz + side * (ch.zIn + ch.zOut) / 2); g.rotation.x = side * slope; bins.add(g);
    block(g, [ch.width, 6, run], [0, -3, 0], CHUTE);
    for (const s of [-1, 1]) block(g, [6, 70, run], [s * (ch.width / 2 + 3), 29, 0], CHUTE);
    for (const [zr, drop] of [[ch.zIn + 60, 22], [760, 22]]) for (const s of [-1, 1]) {
      const h = chuteY(zr) - drop; block(bins, [40, h, 40], [x + s * 180, h / 2, bz + side * zr], MAT.steelDark);
    }
    const zc = bz + side * A.basket.z;
    block(bins, [kx, 20, kz], [x, 30, zc], BASKET);
    for (const s of [-1, 1]) block(bins, [kx, ky, 20], [x, ky / 2 + 42, zc + s * (kz / 2 - 10)], BASKET);
    for (const s of [-1, 1]) block(bins, [20, ky, kz - 44], [x + s * (kx / 2 - 10), ky / 2 + 42, zc], BASKET);
    plate(bins, [side < 0 ? '食品 HDPE' : '非食品 HDPE'], 300, 80, [x, 250, zc + side * (kz / 2 + 3)], side < 0 ? Math.PI : 0);
    const slots = [];
    for (let layer = 0; layer < 3; layer++) for (const dx of [-135, 135]) slots.push({ x: x + dx, y: 44 + layer * 110, z: zc, theta: dx / 135 * .1 });
    zones.push({ side, k, x, slots, used: 0 });
  }

  // ================================================================ 既有電控櫃（門朝 +Z）：控制器、追蹤模組、視覺主機、吸塵器
  const cab = new THREE.Group(); cab.name = 'abbCabinet'; scene.add(cab);
  const K = A.cabinet, [kw, kh, kd] = K.size, zf = K.z + kd / 2;
  block(cab, [kw, kh - 60, kd], [K.x, kh / 2 + 30, K.z], CAB);
  block(cab, [kw - 40, 60, kd - 40], [K.x, 30, K.z], MAT.steelDark);
  block(cab, [kw + 4, 50, 5], [K.x, 800, zf + 2.5], STRIPE);                                 // 藍色腰線
  for (const [y0, y1] of [[70, 775], [825, kh - 10]]) block(cab, [8, y1 - y0, 4], [K.x, (y0 + y1) / 2, zf + 2], MAT.steelDark);   // 雙門中縫（讓開腰線）
  for (const s of [-1, 1]) {
    block(cab, [26, 110, 14], [K.x + s * 60, 1150, zf + 7], MAT.steelDark);                  // 門把
    block(cab, [150, 150, 8], [K.x + s * 350, 420, zf + 4], std(0xd9d2bd, .8, 0));           // 百葉
  }
  block(cab, [430, 270, 10], [K.x + 350, 1180, zf + 5], MAT.black);                          // 15.6 吋螢幕外框
  [MAT.green, MAT.steelDark, MAT.green, MAT.red, MAT.steelBlue].forEach((m, i) => cylinder(cab, 16, 14, [K.x + 190 + i * 62, 960, zf + 7], m, 'z', 18));
  cylinder(cab, 30, 12, [K.x + 580, 960, zf + 6], MAT.yellow, 'z', 22); cylinder(cab, 20, 14, [K.x + 580, 960, zf + 19], MAT.red, 'z', 20);   // 急停
  plate(cab, ['既有電控櫃（示意）', '手臂控制器／輸送帶追蹤／視覺主機'], 560, 110, [K.x - 350, 1560, zf + 1.5], 0, { font: 'bold 36px "Microsoft JhengHei",sans-serif' });
  // 螢幕內容由 project.js 依計數更新（canvas；Node 檢查時是空白貼圖）
  const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 480;
  const screenTex = new THREE.CanvasTexture(canvas); screenTex.colorSpace = THREE.SRGBColorSpace; screenTex.generateMipmaps = false; screenTex.minFilter = THREE.LinearFilter;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(404, 244), new THREE.MeshBasicMaterial({ map: screenTex }));
  screen.position.set(K.x + 350, 1180, zf + 11); cab.add(screen);
  let shown = '';
  function setScreen(text) {
    const key = text.join('|'), ctx = canvas.getContext('2d');
    if (key === shown || !ctx?.fillText) return; shown = key;
    ctx.fillStyle = '#eef1f2'; ctx.fillRect(0, 0, 800, 480);
    text.forEach(([s, color = '#1c2a33', size = 40], i) => { ctx.fillStyle = color; ctx.font = `bold ${size}px "Microsoft JhengHei",sans-serif`; ctx.fillText(s, 36, 76 + i * 78); });
    screenTex.needsUpdate = true;
  }

  // ================================================================ 配線（示意）：前段相機幹線、手臂纜線、兩站之間的整合通訊
  const wiring = new THREE.Group(); wiring.name = 'frontWiring'; scene.add(wiring);
  const tx = F.x + F.legX + 38, railX = F.x + 80 + 22.5 + 8;                                // 門型架 +X 柱外側、+X 軌外側
  const feet = pts => { for (const [x, z] of pts) block(wiring, [30, 50, 30], [x, 25, z], MAT.steelDark); };
  cableTray(wiring, '前段相機線槽', [tx, 60, fz0 - 90], [tx, 60, zf + 20]); feet([[tx, fz0 - 90], [tx, (fz0 + zf) / 2], [tx, zf + 20]]);
  cameras.forEach((cam, i) => {
    const z = cam.root.position.z, y = F.beamY - 20 - i * 22, top = F.camY + 118;
    cable(vision, `CAM${i + 3} / GigE PoE 與同步觸發`, [[F.x, top, z], [F.x, F.beamY + 85, z], [railX, F.beamY + 85, z], [railX, y, z - 40], [railX, y, fz0 + 6 + i * 14],
      [railX, F.beamY - 48, fz0 + 6 + i * 14], [tx, F.beamY - 48, fz0 + 6 + i * 14], [tx, 60, fz0 + 6 + i * 14], [tx + 6 + i * 10, 60, fz0 - 40], [tx + 6 + i * 10, 60, zf - 2]], { color: CABLE.signal, radius: 4, clips: 6 });
  });
  const rx = tx - 12, pz = cz0 - 12, px = cx0 + P / 2, topY = C.top + 12;
  cableTray(wiring, 'ABB 手臂線槽', [tx + 40, 60, pz - 68], [cx0 - 10, 60, pz - 68]); feet([[tx + 40, pz - 68], [cx0 - 10, pz - 68]]);
  cable(cell, 'ABB / 手臂動力與編碼器（既有）', [[rx, 60, zf - 2], [rx, 60, pz - 68], [px, 60, pz - 68], [px, 60, pz], [px, topY, pz], [px, topY + 20, cz0 + P / 2],
    [px, topY + 20, bz - 300], [A.x - 200, topY + 20, bz - 300], [A.x - 200, topY + 20, bz - 210], [A.x - 200, C.top - 68, bz - 210]], { color: CABLE.power, radius: 6, clips: 8 });
  const lz = -1950, jx = -120;
  cableTray(wiring, '整合通訊線槽', [cabX + 100, 60, lz], [jx - 80, 60, lz]);
  feet(Array.from({ length: 6 }, (_, i) => [cabX + 100 + i * (jx - 180 - cabX) / 5, lz]));
  block(wiring, [60, 86, 50], [jx, 43, lz], MAT.steelDark).name = '整合通訊接線盒';
  cable(wiring, '整合通訊 / 兩站視覺主機與手臂控制器（Ethernet，示意）', [[cabX - 2, 300, lz], [cabX + 60, 300, lz], [cabX + 60, 60, lz], [jx - 28, 60, lz]], { color: CABLE.signal, radius: 4, clips: 3 });

  return {
    belt, tex, rollers, vision, cameras, leds, lightPatch, cell, robot, delta, bins, zones, chuteY, slope, cab, setScreen, wiring,
    /** 吸嘴口（世界座標）→ 動平台中心（手臂 root 座標） */
    toPlatform: (x, y, z) => [x - A.x, y + A.toolLen - A.shoulderY, z - bz],
  };
}
