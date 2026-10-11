// 機台本體：下層機櫃、艙內台板、遮光艙外殼（畫成半透明，看得到艙內）、雙工位上料抽屜、光學艙（U 形條紋屏、LED 陣列、主相機與彩色相機）、
// 3D 結構光掃描器、轉接頭 ID 讀碼器、操作螢幕與三色燈。尺寸與位置在 layout.js。
import * as THREE from 'three';
import { block, blockBetween, cylinder, plate, HAS_DOM } from '@core/geom/shapes.js';
import { MAT, std } from '@core/geom/materials.js';
import { drawerSlide } from '@core/models/motion.js';
import { visionCamera, codeReader } from '@core/models/vision.js';
import { signalTower, hmi } from '@core/models/indicators.js';
import { MACHINE, TABLE_Y, OPTICS, SCAN, DRAWER, HMI_POS, MEASURE, screenRects } from './layout.js';
import { createBaseCabinet } from './electrical.js';
import { entryPlate } from '@core/electrical/electrical-cabinet.js';

const SHELL = std(0xe4e7ea, .55, .15, { transparent: true, opacity: .13, depthWrite: false, side: THREE.DoubleSide });
const SHELL_EDGE = std(0xd5dadf, .5, .3);
const TINT = std(0x182028, .15, .1, { transparent: true, opacity: .45, depthWrite: false });   // 觀察窗（深色玻璃）
const BEZEL = std(0x15181c, .5, .2);
const PROFILE = MAT.frame;

// ---------------------------------------------------------------- 條紋貼圖（只有瀏覽器有 canvas；Node 端用純色材質）
// 垂直條紋與水平條紋各一張（正弦，一張 12 個週期）；相移用 texture.offset，一步 = 1/4 週期
const PERIODS = 12;
function fringeTexture(vertical) {
  if (!HAS_DOM) return null;
  const c = document.createElement('canvas'); c.width = vertical ? 1024 : 4; c.height = vertical ? 4 : 1024;
  const g = c.getContext('2d'), n = vertical ? c.width : c.height;
  for (let i = 0; i < n; i++) {
    const v = Math.round(127.5 + 127.5 * Math.sin(i / n * PERIODS * 2 * Math.PI));
    g.fillStyle = `rgb(${v},${v},${v})`;
    if (vertical) g.fillRect(i, 0, 1, c.height); else g.fillRect(0, i, c.width, 1);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createCell(scene) {
  const [x0, x1] = MACHINE.x, [z0, z1] = MACHINE.z, H = MACHINE.h, T = TABLE_Y;
  // ---------------------------------------------------------------- 下層機櫃＋台板
  const base = new THREE.Group(); base.name = 'machine base'; scene.add(base);
  createBaseCabinet(base);
  for (const x of [x0 + 120, x1 - 120]) for (const z of [z0 + 120, z1 - 120]) {
    cylinder(base, 40, 12, [x, 6, z], MAT.black, 'y', 20).name = 'leveling foot pad';
    cylinder(base, 10, 48, [x, 36, z], MAT.steel, 'y', 12).name = 'leveling foot stem';
  }
  // 櫃門分隔線（正面三扇、背面兩扇）
  for (const x of [-400, 400]) blockBetween(base, [x - 2, 90, z1], [x + 2, MACHINE.baseH - 30, z1 + 2], MAT.steelDark).name = 'cabinet door seam';
  for (const x of [-1000, -200, 600]) block(base, [16, 120, 14], [x + 160, 450, z1 + 9], MAT.black).name = 'cabinet door handle';

  // ---------------------------------------------------------------- 遮光艙：鋁擠型框＋半透明鈑金（正面開上料窗與觀察窗）
  const shell = new THREE.Group(); shell.name = 'enclosure'; scene.add(shell);
  const P = 45;
  for (const x of [x0 + P / 2, x1 - P / 2]) for (const z of [z0 + P / 2, z1 - P / 2]) block(shell, [P, H - T, P], [x, (H + T) / 2, z], PROFILE).name = 'enclosure post';
  for (const z of [z0 + P / 2, z1 - P / 2]) block(shell, [x1 - x0 - 2 * P, P, P], [0, H - P / 2, z], PROFILE).name = 'enclosure top rail';
  for (const x of [x0 + P / 2, x1 - P / 2]) block(shell, [P, P, z1 - z0 - 2 * P], [x, H - P / 2, 0], PROFILE).name = 'enclosure top rail';
  const panel = (name, a, b, mat = SHELL) => { const m = blockBetween(shell, a, b, mat); m.name = name; m.castShadow = false; return m; };
  panel('roof panel', [x0 + P, H - 12, z0 + P], [x1 - P, H - 2, z1 - P]);
  panel('back panel', [x0 + P, T, z0 + 2], [x1 - P, H - P, z0 + 12]);
  panel('west panel', [x0 + 2, T, z0 + P], [x0 + 12, H - P, z1 - P]);
  panel('east panel', [x1 - 12, T, z0 + P], [x1 - 2, H - P, z1 - P]);
  // 正面：上料窗（東側）、觀察窗（西側），其餘鈑金
  const W = DRAWER.window, fz = [z1 - 12, z1 - 2];
  panel('front panel', [x0 + P, T, fz[0]], [W.x[0], H - P, fz[1]]);
  panel('front panel', [W.x[1], T, fz[0]], [x1 - P, H - P, fz[1]]);
  if (W.y[0] > T) panel('front panel', [W.x[0], T, fz[0]], [W.x[1], W.y[0], fz[1]]);
  panel('front panel', [W.x[0], W.y[1], fz[0]], [W.x[1], H - P, fz[1]]);
  panel('observation window', [-1000, 1150, z1 - 14], [-150, 1950, z1 - 12], TINT);
  // 上料窗外框
  for (const [a, b] of [[[W.x[0] - 20, W.y[1]], [W.x[1] + 20, W.y[1] + 20]],
    [[W.x[0] - 20, W.y[0]], [W.x[0], W.y[1]]], [[W.x[1], W.y[0]], [W.x[1] + 20, W.y[1]]]])
    blockBetween(shell, [a[0], a[1], z1 - 2], [b[0], b[1], z1 + 18], SHELL_EDGE).name = 'load window frame';
  blockBetween(shell, [(DRAWER.xs.L + DRAWER.xs.R) / 2 - 10, W.y[0], z1 - 2], [(DRAWER.xs.L + DRAWER.xs.R) / 2 + 10, W.y[1], z1 + 18], SHELL_EDGE).name = 'load window mullion';

  // ---------------------------------------------------------------- 雙工位抽屜（滑軌＋台板＋前板把手＋工位燈＋V 形定位座）
  const drawers = {};
  for (const side of ['L', 'R']) {
    const g = new THREE.Group(); g.name = 'drawer ' + side; scene.add(g);
    const x = DRAWER.xs[side], zc = DRAWER.nestIn - DRAWER.nestOffset;            // 推入時抽屜台板中心
    const slides = drawerSlide.create({ length: DRAWER.len, span: DRAWER.w - 40, w: 14, h: 30, inner: { travel: DRAWER.travel } });
    slides.root.position.set(x, T + 16, zc - 40); g.add(slides.root);   // 滑軌底面離台面 1 mm
    const tray = new THREE.Group(); tray.name = 'drawer tray'; slides.inner.add(tray);                // 跟著內軌移動
    tray.position.set(0, 0, 40);
    block(tray, [DRAWER.w - 70, 12, DRAWER.len], [0, 22, 0], MAT.alu).name = 'drawer plate';   // 台板底面離滑軌頂 1 mm
    // 工位燈背面保留真正的穿線孔，線材由前板內側接入。
    const front = entryPlate(tray, 'drawer front', [DRAWER.w - 24, 18, W.y[1] - W.y[0] - 24], [0, (W.y[0] + W.y[1]) / 2 - T - 16, DRAWER.len / 2 + 9 + (MACHINE.z[1] - (zc + DRAWER.len / 2))], [[0, -75, 7]], SHELL_EDGE);
    front.rotation.x = Math.PI / 2;
    front.name = 'drawer front';
    const fy = front.position.y, fzz = front.position.z;
    block(tray, [160, 22, 30], [0, fy - 40, fzz + 24], MAT.black).name = 'drawer handle';
    const lamp = cylinder(tray, 14, 8, [0, fy + 75, fzz + 13], std(0x444444, .4, 0, { emissive: 0x000000, emissiveIntensity: 1 }), 'z', 20); lamp.name = 'drawer lamp';
    // V 形定位座（兩組）：兩片 PU 墊與轉接頭本體（Ø64）相切，本體軸心在 DRAWER.axisY
    const yc = DRAWER.axisY - (T + 16), rb = 32, pad = [12, 44, 16];
    for (const dz of [-18, 18]) {               // 避開快換盤（本體 60～70 mm 長）
      const v = new THREE.Group(); v.position.set(0, 0, DRAWER.nestOffset + dz); tray.add(v);
      block(v, [110, yc - 40 - 28, 18], [0, (yc - 40 + 28) / 2, 0], MAT.steelDark).name = 'nest base';
      for (const s of [-1, 1]) {
        const d = (rb + pad[0] / 2 + .3) / Math.SQRT2, b = block(v, pad, [s * d, yc - d, 0], MAT.pu);
        b.rotation.z = -s * Math.PI / 4; b.name = 'nest v block';
      }
    }
    // 到位感測器（定位座旁）
    block(tray, [18, 30, 14], [DRAWER.w / 2 - 70, 42, DRAWER.nestOffset + 70], MAT.steelBlue).name = 'nest presence sensor';
    drawers[side] = { group: g, slides, tray, lamp, front, set(ext) { slides.set({ ext }); } };
  }

  // ---------------------------------------------------------------- 光學艙
  const optics = new THREE.Group(); optics.name = 'optics'; scene.add(optics);
  const [sx, sy, sz] = OPTICS.S, rects = screenRects(), scr = OPTICS.screen;
  const fringe = { v: fringeTexture(true), h: fringeTexture(false) };
  const screens = rects.map(r => {
    const g = new THREE.Group(); g.name = 'fringe screen ' + r.name; optics.add(g);
    const n = new THREE.Vector3(...r.n), c = new THREE.Vector3(...r.c);
    g.position.copy(c); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    block(g, [scr.w + 2 * scr.bezel, scr.h + 2 * scr.bezel, scr.depth], [0, 0, -scr.depth / 2 - 1], BEZEL).name = 'screen bezel';
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a1d22, toneMapped: false });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(scr.w, scr.h), mat); face.name = 'screen face'; face.userData.fx = true; g.add(face);
    // 立架：螢幕下緣到台面
    const foot = c.y - scr.h / 2 - scr.bezel - T;
    for (const s of [-1, 1]) block(g, [40, foot, 40], [s * (scr.w / 2 - 60), -scr.h / 2 - scr.bezel - foot / 2, -scr.depth - 22], PROFILE).name = 'screen stand';
    return { group: g, face, mat };
  });
  // LED 陣列：8 扇區環形燈板（吊在艙頂框上）
  const ledY = sy + OPTICS.ledY, leds = [];
  for (let k = 0; k < 8; k++) {
    const a0 = k * Math.PI / 4 + .02, geo = new THREE.RingGeometry(OPTICS.ledR[0], OPTICS.ledR[1], 6, 1, a0, Math.PI / 4 - .04);
    const mat = std(0xf4f6f8, .4, 0, { emissive: 0xffffff, emissiveIntensity: 0, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat); m.rotation.x = Math.PI / 2; m.position.set(sx, ledY, sz); m.name = 'led sector'; optics.add(m); leds.push(m);
  }
  const ledFrame = new THREE.Mesh(new THREE.RingGeometry(OPTICS.ledR[0] - 12, OPTICS.ledR[1] + 12, 48), std(0x2a2f35, .6, .3, { side: THREE.DoubleSide }));
  ledFrame.rotation.x = Math.PI / 2; ledFrame.position.set(sx, ledY + 6, sz); ledFrame.name = 'led frame'; optics.add(ledFrame);
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; blockBetween(optics, [sx + Math.cos(a) * 300 - 12, ledY + 7, sz + Math.sin(a) * 300 - 12], [sx + Math.cos(a) * 300 + 12, H - 12, sz + Math.sin(a) * 300 + 12], PROFILE).name = 'led hanger'; }
  // 主相機（12 MP＋25 mm）：吊臂從艙頂下來，鏡頭朝下、對焦在甜蜜點
  const camY = sy + OPTICS.wd, vfov = 2 * Math.atan(MEASURE.fov[1] / 2 / OPTICS.wd) * 180 / Math.PI;   // 子畫面垂直視角＝焦平面上視野短邊
  const cam = visionCamera.create({ bodyW: 60, bodyD: 60, bodyL: 75, lensR: 24, lensL: 70, ringR: 0, fov: vfov, name: 'main camera',
    view: { fov: vfov, aspect: 1.37, near: 50, far: 3000, up: [-1, 0, 0] } });
  cam.root.position.set(sx, camY, sz); optics.add(cam.root);
  // 彩色相機（色卡校正）：主相機東側，略往甜蜜點傾斜
  const color = visionCamera.create({ bodyW: 44, bodyD: 44, bodyL: 55, lensR: 16, lensL: 50, ringR: 0, name: 'color camera', view: false, spot: false });
  color.root.position.set(sx + 110, camY + 10, sz); color.root.rotation.z = .2; optics.add(color.root);
  blockBetween(optics, [sx - 40, camY + 145, sz - 40], [sx + 150, camY + 175, sz + 40], PROFILE).name = 'camera bracket';
  blockBetween(optics, [sx - 20, camY + 175, sz - 20], [sx + 20, H - 12, sz + 20], PROFILE).name = 'camera hanger';
  // 色卡（校正用，光學艙西北角台面上）
  block(optics, [90, 6, 60], [sx - 200, T + 3, sz - 200], std(0x9a7b4f, .7)).name = 'color target';

  // ---------------------------------------------------------------- 3D 結構光掃描器（投影機＋兩支相機），吊在艙頂，斜看掃描位
  const scanner = new THREE.Group(); scanner.name = 'scanner'; scene.add(scanner);
  const head = new THREE.Group(); head.position.set(...SCAN.head); scanner.add(head);
  head.lookAt(new THREE.Vector3(...SCAN.spot)); head.rotateY(Math.PI);                        // 本地 −Z 朝掃描位 → 轉成 +Z 朝掃描位
  block(head, [360, 70, 90], [0, 0, 0], MAT.steelDark).name = 'scanner body';
  cylinder(head, 22, 24, [0, 0, 55], MAT.black, 'z', 24).name = 'scanner projector lens';
  for (const s of [-1, 1]) cylinder(head, 15, 22, [s * 140, 0, 54], MAT.black, 'z', 20).name = 'scanner camera lens';
  const hw = head.localToWorld(new THREE.Vector3(0, 35, 0));
  blockBetween(scanner, [hw.x - 18, hw.y + 20, hw.z - 18], [hw.x + 18, H - 12, hw.z + 18], PROFILE).name = 'scanner hanger';
  // 掃描光（示意）：投影機到掃描位的半透明光錐，條紋由 main.js 動畫
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x3aa0ff, transparent: true, opacity: .16, depthWrite: false, side: THREE.DoubleSide });
  const dist = new THREE.Vector3(...SCAN.head).distanceTo(new THREE.Vector3(...SCAN.spot));
  const beam = new THREE.Mesh(new THREE.ConeGeometry(110, dist - 60, 4, 1, true), beamMat);
  beam.rotation.x = -Math.PI / 2; beam.position.z = 60 + (dist - 60) / 2; beam.name = 'scan light'; beam.userData.fx = true; beam.visible = false; head.add(beam);

  // ---------------------------------------------------------------- 轉接頭 ID 讀碼器（兩工位之間上方，朝下）
  const reader = codeReader.create({ axis: '-y', w: 50, h: 40, length: 60, beamW: 80, beamL: 150, name: 'id reader' });
  reader.root.position.set((DRAWER.xs.L + DRAWER.xs.R) / 2, DRAWER.axisY + 330, DRAWER.nestIn - 60); scene.add(reader.root);
  blockBetween(scene, [reader.root.position.x - 15, reader.root.position.y + 30, reader.root.position.z - 15], [reader.root.position.x + 15, H - 12, reader.root.position.z + 15], PROFILE).name = 'reader hanger';

  // ---------------------------------------------------------------- 操作螢幕、三色燈、銘板
  const panelHmi = hmi.create({ display: true }); panelHmi.root.position.set(HMI_POS.x, HMI_POS.y, z1 + 26); scene.add(panelHmi.root);   // 機身 50 mm 深，背面貼鈑金
  const tower = signalTower.create({ poleH: 260 }); tower.root.position.set(x1 - 150, H, z1 - 150); scene.add(tower.root);
  plate(scene, ['水五金外觀 AOI'], 520, 90, [-575, 2060, z1 + 2], 0, { bg: '#1f3b57' });

  // ---------------------------------------------------------------- 狀態設定
  const SCREEN_STATE = { off: 0x1a1d22, white: 0xf2f4f6, dark: 0x0b0d10 };
  function setScreens(mode, step = 0) {
    for (const s of screens) {
      if (mode === 'fringeV' || mode === 'fringeH') {
        const tex = mode === 'fringeV' ? fringe.v : fringe.h;
        if (tex) { s.mat.map = tex; s.mat.color.setHex(0xffffff); tex.offset.set(mode === 'fringeV' ? step / 4 / PERIODS : 0, mode === 'fringeH' ? step / 4 / PERIODS : 0); }
        else s.mat.color.setHex(0x8a8f96);
      } else { s.mat.map = null; s.mat.color.setHex(SCREEN_STATE[mode] ?? SCREEN_STATE.off); }
      s.mat.needsUpdate = true;
    }
  }
  function setLeds(level, sector = -1) { leds.forEach((m, k) => { m.material.emissiveIntensity = sector >= 0 ? (k === sector ? 1.6 : 0) : level * 1.6; }); }
  function setLamp(side, state) {
    const m = drawers[side].lamp.material, c = { green: 0x3dd68c, yellow: 0xffb020, red: 0xff4d4d }[state];
    m.color.setHex(c ?? 0x444444); m.emissive.setHex(c ?? 0); m.emissiveIntensity = c ? 1 : 0;
  }
  return { base, shell, drawers, optics, screens, leds, cam, colorCam: color, scanner, scanBeam: beam, reader, hmi: panelHmi, tower, setScreens, setLeds, setLamp };
}
