// 前段：現場既有的分選線（2026-10-02 現場照片與影片、開案報告第 3 頁的現場配置圖），在後段補抓站的上游。
// 同一條既有皮帶上依序是：入料罩 → 刮料簾 → 導料板 → 前段立體取像站（新視覺，規格與後段相同）→
// ABB IRB 360 並聯手臂（藍色鋼構網籠、吸嘴＋真空產生器，旁邊是兩段反向的既有分類帶）→ 既有電控櫃
// （上層：既有 ABB 盤、OmniCore C30 與 RC8A 的鐵架、DENSO 系統盤；下層：空壓機與儲氣筒）。
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
const CELL = std(0x4d83b8, .6, .25), CAB = std(0xb7bcc0, .62, .2);                    // 網籠鋼構、電控櫃門板（灰）
export const CAB_BODY = std(0x86a9cf, .62, .2);                                        // 電控櫃櫃體（照片是淺藍色）
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

  // ================================================================ ABB 並聯手臂
  const robot = new THREE.Group(); robot.name = 'abbRobot'; scene.add(robot);
  const delta = createDelta({ geometry: A.delta, toolLen: A.toolLen, hose: [0, 200, -780] });   // hose：氣管固定端（接網籠頂的氣管，見最下面的配管）
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

  // ================================================================ 既有電控櫃（門朝 −Z 的操作走道；位置照開案報告第 3 頁圖，內部照現場照片）
  // 上層是一整格：背板是既有的 ABB 盤（兩排 DIN 軌，上游端是 DSQC 2000），上游端的鐵架上下兩層放 OmniCore C30 與 RC8A，
  // 下游側板內面裝 DENSO 系統盤（electrical.js 建，穿板接頭開在櫃頂靠下游的缺口）。
  // 下層原本放吸塵器，改放空壓機與儲氣筒，供兩支手臂上的真空產生器。尺寸皆為示意。
  const cab = new THREE.Group(); cab.name = 'siteCabinet'; scene.add(cab);
  const [kx0, kx1] = K.x, [kz0, kz1] = K.z, W = kx1 - kx0, kxc = (kx0 + kx1) / 2, T = 20;
  const xi0 = kx0 + T, xi1 = kx1 - T, zi0 = kz0 + T, zi1 = kz1 - T, zic = (zi0 + zi1) / 2;   // 櫃內淨空
  block(cab, [W, K.h - 130, T], [kxc, (K.h + 130) / 2, kz1 - T / 2], CAB_BODY);                // 背板（離地 130 留進出線）
  for (const x of [kx0 + T / 2, kx1 - T / 2]) block(cab, [T, K.h, zi1 - zi0], [x, K.h / 2, zic], CAB_BODY);   // 側板
  // 頂板：靠下游側板留一塊缺口給 DENSO 的穿板接頭板（130 × 480，electrical.js 補上有開孔的板）
  const gz0 = K.panelZ - 240, gz1 = K.panelZ + 240;
  block(cab, [xi1 - 130 - xi0, T, zi1 - zi0], [(xi0 + xi1 - 130) / 2, K.h - T / 2, zic], CAB_BODY);
  block(cab, [130, T, gz0 - zi0], [xi1 - 65, K.h - T / 2, (zi0 + gz0) / 2], CAB_BODY);
  block(cab, [130, T, zi1 - gz1], [xi1 - 65, K.h - T / 2, (gz1 + zi1) / 2], CAB_BODY);
  const wireway = 70;                                                                          // 上層底板後緣留 70 mm 讓控制器的線下到地面
  block(cab, [xi1 - xi0, T, zi1 - wireway - zi0], [kxc, K.shelf - T / 2, (zi0 + zi1 - wireway) / 2], CAB_BODY);   // 上層底板
  block(cab, [W - 2 * T, 100, T], [kxc, 50, kz0 + T / 2], MAT.steelDark);                      // 前踢腳（在門的正下方）
  block(cab, [40, K.shelf - T - 100, 40], [kxc, (K.shelf - T + 100) / 2, zi0 + 20], CAB_BODY); // 下層中柱
  cab.userData.electricalEnclosure = { min: [xi0, K.shelf, zi0], max: [xi1, K.h - T, zi1] };   // 電控檢查：元件要在上層櫃內
  for (const [x, y] of [[xi0 + 10, 1560], [xi0 + 10, 480], [xi1 - 10, 480]]) {                // 側板上的散熱風扇（照片）
    block(cab, [20, 120, 120], [x, y, zic + 120], MAT.black);
    cylinder(cab, 46, 6, [x + Math.sign(kxc - x) * 12, y, zic + 120], MAT.steelDark, 'x', 20);
  }

  // ---- 四扇門：全部標成 electricalCover——「電盤配線」剖視時隱藏、透視時半透明
  const door = (x0, x1, y0, y1, name) => {
    const g = new THREE.Group(); g.name = name; g.userData.electricalCover = true; cab.add(g);
    block(g, [x1 - x0 - 6, y1 - y0 - 6, T], [(x0 + x1) / 2, (y0 + y1) / 2, kz0 + T / 2], CAB);
    block(g, [26, 110, 14], [x0 < kxc ? x1 - 60 : x0 + 60, (y0 + y1) / 2, kz0 - 7], MAT.steelDark);   // 門把（靠中縫）
    return g;
  };
  const doors = [door(kx0, kxc, K.shelf, K.h, '上層上游門'), door(kxc, kx1, K.shelf, K.h, '上層下游門'), door(kx0, kxc, 100, K.shelf, '下層上游門'), door(kxc, kx1, 100, K.shelf, '下層下游門')];
  for (const [g, x] of [[doors[2], (kx0 + kxc) / 2], [doors[3], (kxc + kx1) / 2]]) block(g, [150, 150, 8], [x, 430, kz0 - 4], std(0xd9d2bd, .8, 0));   // 百葉
  // 上游門（照片的右門）：15.6 吋人機螢幕、按鈕列、急停、標牌（都朝 −Z）
  const sx = (kx0 + kxc) / 2, dx = (kxc + kx1) / 2, back = Math.PI, sy = K.shelf + 620;
  block(doors[0], [430, 270, 10], [sx, sy, kz0 - 5], MAT.black);
  [MAT.green, MAT.steelDark, MAT.green, MAT.red, MAT.steelBlue].forEach((m, i) => cylinder(doors[0], 16, 14, [sx + 160 - i * 62, sy - 220, kz0 - 7], m, 'z', 18));
  cylinder(doors[0], 30, 12, [sx - 230, sy - 220, kz0 - 6], MAT.yellow, 'z', 22); cylinder(doors[0], 20, 14, [sx - 230, sy - 220, kz0 - 19], MAT.red, 'z', 20);   // 急停
  plate(doors[0], ['既有電控櫃（示意）', 'ABB 控制器／輸送帶追蹤／兩站共用'], 600, 110, [sx, K.h - 130, kz0 - 1.5], back, { font: 'bold 36px "Microsoft JhengHei",sans-serif' });
  plate(doors[1], ['上層：ABB 盤、控制器鐵架、DENSO 系統盤', '下層：空壓機與儲氣筒（示意）'], 640, 110, [dx, K.h - 130, kz0 - 1.5], back, { font: 'bold 34px "Microsoft JhengHei",sans-serif' });
  // 螢幕內容由 project.js 依計數更新（canvas；Node 檢查時是空白貼圖）
  const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 480;
  const screenTex = new THREE.CanvasTexture(canvas); screenTex.colorSpace = THREE.SRGBColorSpace; screenTex.generateMipmaps = false; screenTex.minFilter = THREE.LinearFilter;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(404, 244), new THREE.MeshBasicMaterial({ map: screenTex }));
  screen.position.set(sx, sy, kz0 - 11); screen.rotation.y = back; doors[0].add(screen);
  let shown = '';
  function setScreen(text) {
    const key = text.join('|'), ctx = canvas.getContext('2d');
    if (key === shown || !ctx?.fillText) return; shown = key;
    ctx.fillStyle = '#eef1f2'; ctx.fillRect(0, 0, 800, 480);
    text.forEach(([s, color = '#1c2a33', size = 40], i) => { ctx.fillStyle = color; ctx.font = `bold ${size}px "Microsoft JhengHei",sans-serif`; ctx.fillText(s, 36, 76 + i * 78); });
    screenTex.needsUpdate = true;
  }

  // ---- 上層背板：既有的 ABB 盤（照片：上排接觸器、斷路器、兩顆電源、右端 DSQC 2000；下排端子與插座；兩條橫向線槽）
  // 元件面朝 −Z。可在電控檢視器點選的只有兩件：DSQC 2000 與鐵架上的 OmniCore C30（userData.electrical）。
  const AP = K.abbPanel, [ax0, ax1] = AP.x, [ay0, ay1] = AP.y, pz = zi1 - 30, GREY = std(0xc9ced2, .6, .2), DUCT = std(0x9aa3aa, .7, .1);
  block(cab, [ax1 - ax0, ay1 - ay0, 4], [(ax0 + ax1) / 2, (ay0 + ay1) / 2, pz], GREY);
  for (const sgn of [-1, 1]) for (const y of [ay0 + 30, ay1 - 30]) cylinder(cab, 6, 28, [(ax0 + ax1) / 2 + sgn * ((ax1 - ax0) / 2 - 40), y, pz + 16], MAT.steel, 'z', 10);   // 背板支柱
  const railY = [ay1 - 150, ay0 + 150], ductY = [(ay0 + ay1) / 2 - 15, ay0 + 35];
  for (const y of railY) block(cab, [ax1 - ax0 - 80, 35, 8], [(ax0 + ax1) / 2, y, pz - 6], MAT.steel);     // DIN 軌
  for (const y of ductY) block(cab, [ax1 - ax0 - 60, 50, 60], [(ax0 + ax1) / 2, y, pz - 32], DUCT);        // 橫向線槽
  // 一排元件：由下游端（照片左邊）往上游排；[寬, 高, 深, 材質, 間隔]
  const TEAL = std(0x4f9c92, .5, .1), PSU = std(0x6fae8a, .5, .3), WHITE = std(0xe4e6e3, .5, 0), ORANGE = std(0xd9792b, .5, 0);
  const row = (y, list) => { let x = ax1 - 60; for (const [w, h, d, m, gap = 2] of list) { x -= w / 2; block(cab, [w, h, d], [x, y, pz - 10 - d / 2], m); x -= w / 2 + gap; } return x; };
  row(railY[0], [[14, 90, 40, MAT.black, 30], [52, 82, 85, MAT.black, 6], ...Array.from({ length: 8 }, () => [18, 82, 68, TEAL]), [4, 1, 1, GREY, 10],
    [45, 78, 80, MAT.black], [45, 78, 80, MAT.black, 14], [40, 95, 100, PSU], [40, 95, 100, PSU, 16], ...Array.from({ length: 4 }, () => [18, 70, 60, WHITE])]);
  row(railY[1], [...Array.from({ length: 10 }, () => [10, 46, 44, WHITE, 1]), [4, 1, 1, GREY, 60], [18, 70, 60, TEAL], [18, 70, 60, TEAL, 70], [30, 60, 55, MAT.black, 420]]);
  block(cab, [50, 80, 24], [ax0 + 90, railY[1] - 70, pz - 15], WHITE);                                      // 插座（在下排軌道下方）
  /** 可點選的 ABB 元件：群組的本地 +Z 是正面，轉 180° 朝門；size＝[寬, 高, 深] */
  const abbDevice = (id, title, size, at, description, model, kind = 'robot', role = 'motion', category = 'ac') => {
    const g = new THREE.Group(); g.name = `${id} / ${title}`; g.position.set(...at); g.rotation.y = back; cab.add(g);
    g.userData.electrical = { id, kind, title, size, role, category, source: null, model, description };
    return g;
  };
  // DSQC 2000：照片上排最右邊那顆（灰色機身、上下兩排綠色端子）
  const ctm = abbDevice('CTM1', 'ABB DSQC 2000 I/O 擴充', [70, 110, 110], [ax0 + 110, railY[0], pz - 10 - 55],
    '接在 OmniCore C30 上的擴充模組：輸送帶編碼器與相機同步觸發由這裡進控制器，做 conveyor tracking。整合後改接新視覺的觸發與座標。', 'DSQC 2000（現場照片判讀，接線待確認）', 'io', 'io', 'signal');
  block(ctm, [70, 110, 110], [0, 0, 0], std(0xd6d9da, .5, .1)).userData.electricalBody = true;
  for (const y of [-40, 40]) block(ctm, [56, 14, 10], [0, y, 58], std(0x3f9a5a, .5, 0));
  block(ctm, [40, 26, 2], [0, 0, 56], MAT.black);

  // ---- 控制器鐵架（上層上游端）：下層 OmniCore C30、上層 RC8A（RC8A 由 electrical.js 放上去），頂板放教導器
  const R = K.rack, rx0 = R.x - R.w / 2, rx1 = R.x + R.w / 2, rz0 = zi0 + 100, rz1 = rz0 + R.d, RACK = MAT.steelDark;   // 正面留 100 mm 給接頭與線的彎曲
  for (const x of [rx0 + 15, rx1 - 15]) for (const z of [rz0 + 15, rz1 - 15]) block(cab, [30, R.top, 30], [x, K.shelf + R.top / 2, z], RACK);
  for (const t of [...R.tier, R.top]) block(cab, [R.w - 60, 6, R.d], [R.x, K.shelf + t - 3, (rz0 + rz1) / 2], RACK);
  for (const x of [rx0 + 15, rx1 - 15]) block(cab, [6, 30, R.d - 60], [x, K.shelf + R.top - 60, (rz0 + rz1) / 2], RACK);   // 側向拉桿
  block(cab, [R.w - 60, 34, 4], [R.x, K.shelf + R.tier[1] - 23, rz0 + 2], RACK);                             // 上層前緣（貼標示）
  decal(cab, 300, 30, [R.x, K.shelf + R.tier[1] - 23, rz0 - 1], [0, back, 0], '控制器鐵架：上 RC8A（DENSO）／下 OmniCore C30（ABB）', { center: true, color: '#e8eef1', bg: '#22313b' });
  // OmniCore C30（449 × 170 × 443）：正面朝門，接頭都在正面（照片）
  const C30 = [449, 170, 443], cy = K.shelf + R.tier[0] + C30[1] / 2, cfz = rz0 + 10;
  const c30 = abbDevice('ABB1', 'ABB 手臂控制器 OmniCore C30', C30, [R.x, cy, cfz + C30[2] / 2],
    'IRB 360 並聯手臂的控制器（現場既有）。搭配 DSQC 2000 I/O 擴充做輸送帶追蹤；整合後由新視覺主機送目標座標與放行清單。', 'OmniCore C30（現場既有）');
  block(c30, C30, [0, 0, 0], std(0xdfe2e3, .5, .15)).userData.electricalBody = true;
  const fz = C30[2] / 2;                                                                                    // 正面（本地 +Z）
  block(c30, [56, 70, 46], [-180, 14, fz + 23], MAT.steel);                                                 // X1 動力接頭
  for (const [x, y] of [[-120, 40], [-80, 40], [-120, -40]]) cylinder(c30, 17, 34, [x, y, fz + 17], MAT.steel, 'z', 16);   // X4／X2／X0
  block(c30, [34, 74, 10], [-30, 16, fz + 5], std(0x3f9a5a, .5, 0));                                        // I/O 端子
  for (const x of [20, 90]) block(c30, [62, 16, 12], [x, 46, fz + 6], ORANGE);                              // 安全端子（橘）
  block(c30, [120, 16, 6], [150, -52, fz + 3], MAT.black);                                                  // 乙太網路埠
  decal(c30, 84, 30, [178, 46, fz + 1], [0, 0, 0], 'ABB', { center: true, bold: true, color: '#d8232a' });
  decal(c30, 150, 18, [70, 6, fz + 1], [0, 0, 0], 'OmniCore C30', { center: true, color: '#33414a' });
  // 教導器（FlexPendant）與座
  const py = K.shelf + R.top;
  block(cab, [190, 50, 150], [R.x - 60, py + 25, rz0 + 130], GREY);
  const pend = block(cab, [290, 26, 190], [R.x - 60, py + 96, rz0 + 110], WHITE); pend.rotation.x = -.5;
  const scr = block(cab, [180, 4, 120], [R.x - 30, py + 104, rz0 + 96], MAT.black); scr.rotation.x = -.5;
  cylinder(cab, 16, 22, [R.x - 180, py + 130, rz0 + 160], MAT.red, 'y', 16);                                // 教導器急停
  // C30 → 手臂：櫃內由 C30 正面的 X1 繞到上游側板，穿板後接到網籠（櫃外那一段在下面的配線裡）
  const armOut = [xi0 + 1, K.h - 320, cz0 - 12];
  block(cab, [12, 70, 70], [xi0 + 6, armOut[1], armOut[2]], MAT.steelDark);                                 // 側板上的出線接頭座
  const wx = xi0 + 14;                                                                                      // 鐵架與上游側板之間的走線位置
  // 由 X1 往前出線後先下到鐵架層板的高度再橫走，不擋住控制器正面的接頭與標示
  cable(cab, 'ABB / C30 → 手臂（櫃內段）', [[R.x + 180, cy + 14, cfz - 46], [R.x + 180, cy + 14, cfz - 84], [R.x + 180, cy - 96, cfz - 84], [wx, cy - 96, cfz - 84],
    [wx, armOut[1], cfz - 84], [wx, armOut[1], armOut[2]]], { color: CABLE.power, radius: 6, clips: 3 });
  cable(cab, 'ABB / C30 ↔ DSQC 2000', [[R.x + 30, cy + 16, cfz - 10], [R.x + 30, cy + 16, cfz - 60], [rx1 + 24, cy + 16, cfz - 60], [rx1 + 24, railY[0] - 90, cfz - 60],
    [rx1 + 24, railY[0] - 90, pz - 140], [ax0 + 110, railY[0] - 90, pz - 140], [ax0 + 110, railY[0] - 57, pz - 100]], { color: CABLE.signal, radius: 3, clips: 3 });
  // 整合通訊：兩站的控制器與視覺主機在同一座櫃內，C30 的乙太網路沿上層底板接到 DENSO 系統盤的交換器（示意）
  cable(cab, '整合通訊 / C30 ↔ DENSO 系統盤（Ethernet，示意）', [[R.x - 150, cy - 52, cfz - 6], [R.x - 150, cy - 52, cfz - 70], [R.x - 150, K.shelf + 14, cfz - 70],
    [xi1 - 200, K.shelf + 14, cfz - 70], [xi1 - 200, K.shelf + 14, K.panelZ], [xi1 - 70, K.shelf + 14, K.panelZ], [xi1 - 70, K.h - 1056, K.panelZ]], { color: CABLE.signal, radius: 4, clips: 4 });

  // ---- 下層：空壓機＋儲氣筒（取代原本的吸塵器），供 ABB 與 DENSO 兩支手臂上的真空產生器
  const AIR = K.air, fy = 0, COMP = std(0x2c4f86, .5, .3), TANK = std(0xc23b2f, .45, .3);
  const cz = zi0 + 230;                                                                                     // 兩件都靠門放，後緣留給線與管
  block(cab, [480, 50, 340], [AIR.compressor, fy + 25, cz], MAT.steelDark);                                 // 機座
  cylinder(cab, 95, 250, [AIR.compressor - 60, fy + 190, cz], COMP, 'x', 28);                               // 馬達
  cylinder(cab, 105, 30, [AIR.compressor - 200, fy + 190, cz], MAT.black, 'x', 28);                         // 風扇罩
  for (const s of [-1, 1]) { block(cab, [100, 170, 100], [AIR.compressor + 150, fy + 240, cz + s * 75], COMP); block(cab, [112, 16, 112], [AIR.compressor + 150, fy + 333, cz + s * 75], MAT.steel); }   // 雙缸
  block(cab, [120, 110, 130], [AIR.compressor + 150, fy + 105, cz], MAT.steel);                             // 曲軸箱
  plate(cab, ['空壓機（靜音無油式，示意）'], 320, 50, [AIR.compressor, fy + 420, cz - 172], back, { font: 'bold 40px "Microsoft JhengHei",sans-serif' });
  const tx = AIR.tank, tr = 160;
  for (let k = 0; k < 3; k++) { const a = k * 2.094 + .5; block(cab, [40, 90, 40], [tx + Math.cos(a) * 110, fy + 45, cz + Math.sin(a) * 110], MAT.steelDark); }
  cylinder(cab, tr, 420, [tx, fy + 340, cz], TANK, 'y', 32);                                                // 儲氣筒（直立，約 40 L）
  cylinder(cab, 100, 46, [tx, fy + 107, cz], TANK, 'y', 32, tr);                                            // 下封頭
  cylinder(cab, tr, 46, [tx, fy + 573, cz], TANK, 'y', 32, 100);                                            // 上封頭
  cylinder(cab, 34, 16, [tx, fy + 420, cz - tr - 8], MAT.cap, 'z', 20); cylinder(cab, 8, 30, [tx, fy + 420, cz - tr + 6], MAT.steel, 'z', 10);   // 壓力表
  cylinder(cab, 12, 40, [tx + 70, fy + 612, cz], MAT.steel, 'y', 12);                                       // 安全閥
  plate(cab, ['儲氣筒（示意）'], 190, 50, [tx, fy + 250, cz - tr - 4], back, { font: 'bold 44px "Microsoft JhengHei",sans-serif' });
  // 配管：空壓機 → 儲氣筒 → 分配座（兩個出口：ABB、DENSO）
  const AIRC = 0x3f8fd8, mz = zi1 - 40, my = 640, mx = [tx - 240, tx + 240];
  pipe(cab, [[AIR.compressor + 150, fy + 345, cz], [AIR.compressor + 150, fy + 700, cz], [tx - 60, fy + 700, cz], [tx - 60, fy + 598, cz]], 9, AIRC, 0x8a949c);
  pipe(cab, [[tx, fy + 598, cz], [tx, fy + 720, cz], [tx, fy + 720, mz], [tx, my + 22, mz]], 9, AIRC, 0x8a949c);
  block(cab, [560, 40, 50], [tx, my, mz], MAT.steel).name = 'air manifold';                                 // 分配座（含調壓、過濾，示意）
  for (const x of mx) block(cab, [40, 30, 15], [(x + tx) / 2, my, zi1 - 7.5], MAT.steelDark);              // 固定在背板上的座
  cylinder(cab, 26, 12, [tx, my, mz - 31], MAT.cap, 'z', 18);
  decal(cab, 240, 26, [tx, my - 36, mz - 26], [0, back, 0], '0.6 MPa → ABB／DENSO 真空產生器', { center: true, color: '#e8eef1', bg: '#22313b' });
  // 往 ABB：櫃內沿背板到上游側板，穿板後由櫃外那一段接到網籠頂（下面）
  const abbAir = [xi0 + 1, 300, bz - 780];
  pipe(cab, [[mx[0], my - 22, mz], [mx[0], 300, mz], [mx[0], 300, mz - 60], [xi0 + 60, 300, mz - 60], [xi0 + 60, 300, abbAir[2]], abbAir], 8, AIRC, AIRC);

  // ================================================================ 配線與配管（示意）：前段相機幹線、ABB 手臂纜線與氣管
  const wiring = new THREE.Group(); wiring.name = 'frontWiring'; scene.add(wiring);
  const tx0 = F.x + F.legX + 38, railX = F.x + 80 + 22.5 + 8, tz = kz0 + 100;                 // 門型架 +X 柱外側、+X 軌外側、沿網籠前方的地面線槽
  const feet = pts => { for (const [x, z] of pts) block(wiring, [30, 50, 30], [x, 25, z], MAT.steelDark); };
  cableTray(wiring, '前段相機線槽 A', [tx0, 60, fz0 - 90], [tx0, 60, tz - 30]);
  cableTray(wiring, '前段相機線槽 B', [tx0 + 40, 60, tz], [kx0 - 30, 60, tz]);
  feet([[tx0, fz0 - 90], [tx0, tz - 30], ...Array.from({ length: 4 }, (_, i) => [tx0 + 40 + i * (kx0 - 70 - tx0) / 3, tz])]);
  cameras.forEach((cam, i) => {
    const z = cam.root.position.z, y = F.beamY - 20 - i * 22, top = F.camY + 118, lane = 6 + i * 10, zl = fz0 + 6 + i * 14;
    cable(vision, `CAM${i + 3} / GigE PoE 與同步觸發`, [[F.x, top, z], [F.x, F.beamY + 85, z], [railX, F.beamY + 85, z], [railX, y, z - 40], [railX, y, zl],
      [railX, F.beamY - 48, zl], [tx0, F.beamY - 48, zl], [tx0, 60, zl], [tx0 + lane, 60, fz0 - 40], [tx0 + lane, 60, tz + lane], [kx0 + 2, 60, tz + lane]], { color: CABLE.signal, radius: 4, clips: 6 });
  });
  const px = cx1 - P / 2, topY = C.top + 12;                                                  // 網籠下游、操作側的角柱
  cable(cell, 'ABB / 手臂動力與編碼器（既有）', [[kx0 - 2, armOut[1], armOut[2]], [px, armOut[1], armOut[2]], [px, topY, armOut[2]], [px + 20, topY + 20, cz0 + P / 2],
    [px + 20, topY + 20, bz - 300], [A.x + 200, topY + 20, bz - 300], [A.x + 200, topY + 20, bz - 210], [A.x + 200, C.top - 68, bz - 210]], { color: CABLE.power, radius: 6, clips: 8 });
  // 氣管：由櫃側穿出，沿網籠與電控櫃之間的縫上到網籠頂，橫到手臂上方的固定端；手臂上的軟管（delta.js）接在這裡
  const gx = (cx1 + kx0) / 2, ay = C.top + 80;
  const air = pipe(cell, [[kx0 - 1, 300, abbAir[2]], [gx, 300, abbAir[2]], [gx, ay, abbAir[2]], [A.x, ay, abbAir[2]], [A.x, A.shoulderY + 200, abbAir[2]]], 8, AIRC, AIRC);
  air.mesh.name = 'hose anchor';
  block(cell, [30, 72, 60], [cx1 - 65, C.top + 36, abbAir[2]], MAT.steelDark);                 // 管架：立在 +X 頂樑上

  return {
    vision, cameras, leds, lightPatch, cell, robot, delta, sort, zones, sortZ: zc, cab, setScreen, wiring,
    /** 分配座往 DENSO 站的出口（世界座標；electrical.js 的氣管由這裡接出去） */
    airOut: [mx[1], my - 22, mz],
    /** 吸嘴口（世界座標）→ 動平台中心（手臂 root 座標） */
    toPlatform: (x, y, z) => [x - A.x, y + A.toolLen - A.shoulderY, z - bz],
  };
}
