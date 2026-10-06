// 專案介面：網頁（main.js）與 core 統一檢查共用同一份場景與時間狀態。規格見 core/README.md「專案介面」。
// 回收物自動分揀展示機：主平皮帶 → 立體取像站（雙相機）→ AI 分類／3D 定位 → 編碼器追蹤 → SCARA 吸盤分揀 → A／B 分流帶。
// 這台是「後段補抓站」，上游是現場既有的 ABB 分選站（frontline.js）：前段立體取像 → ABB 並聯手臂第一道抓取 →
// ABB 來不及抓而放行的 HDPE 流到後段，由這台再取像、補抓。兩站共用同一個製程時間與同一份帶上工件清單。
//
// 狀態完全由時間 t 決定：t → 製程時間 τ（schedule.js 的 rate 積分）→ 帶面行程 s = 200 τ → 工件位置與手臂關節。
// 手臂路徑在建立時先解好（ik 的肘部參考固定，是純函式），播放時只做內插或同樣條件再解一次，
// 所以倒序、跳播與連續播放結果相同。
//
// 手臂路徑的兩個原則：
//   1. 全程用同一個肘部方向（第二臂一律負向）。換肘必須讓肘部打直，TCP 會掃到半徑 650 的奇異點。
//   2. 取放之間走「極座標弧線」：角度線性轉、半徑中途先收再伸，掃掠外圍才壓得進機台框架。
import * as THREE from 'three';
import { block, blockBetween, cylinder, rod, plate, decal, D2R } from '@core/geom/shapes.js';
import { MAT, std, finished } from '@core/geom/materials.js';
import { foot, bolts, motor, sensor, housing } from '@core/geom/hardware.js';
import { floor } from '@core/geom/environment.js';
import { createHSR065, HSR065, fk } from '@core/models/robots/denso-hsr065.js';
import { signalTower, hmi as hmiModel } from '@core/models/indicators.js';
import { barLight } from '@core/models/lights.js';
import { beltConveyor } from '@core/models/transport.js';
import { vacuumEjector, solenoidValve, floatRod, suctionCup, rotaryEncoder } from '@core/models/motion.js';
import { LAYOUT, STATIONS } from './layout.js';
import { buildItem } from './items.js';
import { createTiming, ITEMS, CHAPTERS, chapterAt, PHASES, GRAB_PHASES, AXIS, CT, BELT_V, TOTAL, VISION_TO_PICK, MIX, mixedCT, perHour, ABB_PHASES, ABB_CT, footprintGap, zOf, leadOf, laneAt, LANE_X } from './schedule.js';
import { createCameras, createElectrical } from './electrical.js';
import { SURFACE, beltTexture, detailBatch, addDetails, createLightPatch } from './appearance.js';
import { createFrontLine, RUST, SITE_FRAME } from './frontline.js';
import { deltaIK } from './delta.js';
import { bake, sampler } from '@core/physics/physics.js';

const L = LAYOUT, G = 9810;                          // 重力 mm/s²
const BELT_MAT = std(0x304b3b, .93, .01);
const GUARD = std(0xa8c4dc, .1, 0, { transparent: true, opacity: .13, depthWrite: false, side: THREE.DoubleSide });
const LED_ON = std(0xffffff, .3, 0, { emissive: 0xffffff, emissiveIntensity: 1.1 });
const MARK = {
  fov: std(0x4aa8ff, .4, 0, { emissive: 0x4aa8ff, emissiveIntensity: .9 }),
  win: std(0x3dd68c, .4, 0, { emissive: 0x3dd68c, emissiveIntensity: .8 }),
  dim: std(0xffb020, .4, 0, { emissive: 0xffb020, emissiveIntensity: .7 }),
};
// 梯形速度曲線（1/4 加速、1/2 等速、1/4 減速）：峰值只有平均的 1.33 倍。
// 用五次 S 曲線（1.875 倍）時 1.4 s 節拍下的 J1 峰值角速度會破表。
const EASE = (() => {
  const k = 4 / 3, a = .25;
  return u => u <= 0 ? 0 : u >= 1 ? 1 : u <= a ? k * u * u / (2 * a) : u >= 1 - a ? 1 - k * (1 - u) * (1 - u) / (2 * a) : k * (u - a / 2);
})();
const sumDur = (ds, k) => ds.slice(0, k).reduce((s, d) => s + d, 0);

export async function createProject({ scene }) {
  const timing = createTiming();

  floor(scene, { size: [9000, 5600], center: [-2300, -300], cell: 200 });        // 含上游的既有分選線

  // ================================================================ 主輸送帶（平皮帶）
  // 平皮帶（滾筒輸送線上薄膜與小件會掉落）：皮帶機本體用 core 的 beltConveyor，現場既有的機架與配件在這裡畫。
  // 已拍板（2026-10-05）：這就是現場既有的那條皮帶——由上游端（L.site.x0）一路到後段機台下游，後段直接架在上面；
  // 外觀照現場（綠色皮帶、鏽色鋼板側牆、藍綠色機架），驅動馬達也是既有的，後段電盤不驅動它，只外掛編碼器。
  const belt = new THREE.Group(); belt.name = 'mainBelt'; scene.add(belt);
  const b = L.belt, bz = b.z, bw = b.width, g0 = L.guide, [gx0, gx1] = g0.x, gLen = gx1 - gx0;
  const bx0 = L.site.x0, bx1 = b.x[1], bLen = bx1 - bx0 - 2 * b.roller, bcx = (bx0 + bx1) / 2;
  const beltTex = beltTexture(0x426950); beltTex.repeat.set(bLen / 120, 1);
  // 皮帶機本體（承載面、回程面、支撐板、頭尾滾筒）用 core 的平皮帶模型；span 給絕對座標，root 只移到中心線（Z）。
  // 既有機架、鏽色側牆、支腳與橫撐、馬達、編碼器、導料板是現場的東西，留在下面自己畫（sides／legs 關掉）。
  const mainBelt = beltConveyor.create({
    span: [bx0 + b.roller, bx1 - b.roller], width: bw, top: b.top, texturePitch: 120,
    carry: { t: 16, material: std(0xffffff, .93, .01, { map: beltTex }) }, back: { t: 12, y: 658, material: BELT_MAT },
    bed: { size: [bLen - 40, 18, bw - 40], y: 723, material: SURFACE.support },
    rollers: { r: b.roller, length: bw + 20, y: 700, x: [bx0, bx1], segments: 24, material: finished(MAT.roller, 'metal') }, sides: false, legs: false,
  });
  mainBelt.root.position.z = bz; belt.add(mainBelt.root);
  const rollers = mainBelt.rollers;                                                // apply() 照舊直接轉這兩支
  for (const s of [-1, 1]) {
    block(belt, [bx1 - bx0, 130, 24], [bcx, 660, bz + s * 320], SITE_FRAME);       // 側樑
    block(belt, [bx1 - bx0, L.site.wall + 10, 10], [bcx, b.top + L.site.wall / 2 - 5, bz + s * 311], RUST);   // 側牆（高於帶面 110）
  }
  for (const x of [...L.site.legX, ...b.legX]) {
    for (const z of b.legZ) { block(belt, [70, 595, 70], [x, 298, z], SITE_FRAME); foot(belt, x, z, 150); }
    block(belt, [60, 50, 570], [x, 170, bz], SITE_FRAME);
  }
  motor(belt, 1250, 450, bz - 410, .6);                                            // 既有的驅動馬達（示意）
  sensor(belt, L.encoder.x + 90, b.top + 40, L.encoder.z + 20, Math.PI / 2);       // 入料光電
  const encoder = rotaryEncoder.create();                                          // 外掛旋轉編碼器（core 模型，機身 Ø60 × 70、出軸朝 +Z）
  encoder.root.position.set(L.encoder.x, 700, L.encoder.z); belt.add(encoder.root);
  decal(belt, 170, 42, [L.encoder.x, 600, L.encoder.z - 38], [0, Math.PI, 0], '1000 ppr', { color: '#9fb3c0', center: true });
  // 後段導料板：接在前段導料板（600 → 400）之後，開口 400 → 280，把料流收攏到手臂實際能覆蓋的帶寬內。
  // 板面位置照 schedule.js 的 laneAt()（開口與中心線），和工件走的通道是同一份定義；中心線由皮帶中心移到抓取區中心。
  const guideZ = (side, x) => { const { gap, center } = laneAt(x); return center + side * (gap / 2 + 6); };
  const guideDetails = detailBatch(belt);
  for (const side of [-1, 1]) {
    const z0 = guideZ(side, gx0), z1 = guideZ(side, gx1);
    const pl = block(belt, [Math.hypot(gLen, z1 - z0), g0.h, 12], [(gx0 + gx1) / 2, b.top + 6 + g0.h / 2, (z0 + z1) / 2], MAT.alu);
    pl.rotation.y = -Math.atan2(z1 - z0, gLen); pl.name = 'guide plate';
    // 上緣折邊與入口圓角包邊在料流外側，不變更既有導料開口。
    block(pl, [Math.hypot(gLen, z1 - z0) - 8, 5, 22], [0, g0.h / 2 + 3.5, side * 5], SURFACE.support).name = 'guide plate';
    cylinder(belt, 6, g0.h - 10, [gx0, b.top + 6 + g0.h / 2, z0 + side * 6], SURFACE.support, 'y', 12).name = 'guide plate';
    for (const mx of g0.mountX) {
      const mz = bz + side * (bw / 2 - 23), shape = new THREE.Shape();
      shape.moveTo(-34, -15); shape.lineTo(34, -15); shape.lineTo(34, 15); shape.lineTo(-34, 15); shape.closePath();
      const slot = new THREE.Path(); slot.absellipse(0, 0, 22, 5, 0, Math.PI * 2, true); shape.holes.push(slot);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 4, bevelEnabled: false, curveSegments: 6 });
      const mount = new THREE.Mesh(geo, SURFACE.support); mount.rotation.x = -Math.PI / 2; mount.position.set(mx, 820, mz); belt.add(mount);
      guideDetails.bolt([mx, 829, mz], 6);
      guideDetails.box([24, 4, 7], [mx, 835, mz], SURFACE.sheet);
    }
    for (const mx of g0.mountX)                                                    // 側樑到導料板的托架（在板的外側，頂面低於擋板 6 mm 以免重合面）
      blockBetween(belt, [mx - 20, b.top + 26, guideZ(side, mx)], [mx + 20, b.top + 64, bz + side * (bw / 2 + 8)], MAT.frame);
  }
  guideDetails.flush();
  decal(belt, 280, 25, [-1100, 805, bz + 317], [0, 0, 0], '導料開口 400 → 280（示意）', { center: true, color: '#26383e', bg: '#d7e1de' });

  // ================================================================ 立體取像站
  // 架台整座在 X −700：手臂底座 (150, 140) 的動作半徑 650 只到 X −500，所以相機與架台都不會被第二臂掃到。
  // 架台沒有自己的立柱：橫樑用托架固定在 Z −730 的 −Z 骨架立柱 +X 面上（留 6 mm 安裝間隙），
  // 往 +Z 懸臂出去，所以整座架台不落地、也不超出框架平面（見 layout.js frame／vision 註解）。
  const vision = new THREE.Group(); vision.name = 'vision'; scene.add(vision);
  const v = L.vision;
  const postFaceX = -L.frame.postX + L.frame.post / 2;
  for (const x of [v.x - 80, v.x + 80])
    block(vision, [45, 120, v.beamZ[1] - v.beamZ[0]], [x, v.beamY, (v.beamZ[0] + v.beamZ[1]) / 2], MAT.frame);
  // 托架沿 Z 保留第一段的 56 mm 深度，沿 X 延伸以承接雙軌。
  blockBetween(vision, [postFaceX + 6, v.beamY - 58, v.bracketZ - 28], [v.x + 100, v.beamY + 58, v.bracketZ + 28], MAT.frame);
  const cameras = createCameras(vision, v);
  const [wx, wz] = v.windowSize;                                                   // 光學防汙視窗（壓克力）
  const opticalWindow = MAT.glass.clone(); opticalWindow.opacity = .24; opticalWindow.roughness = .12;
  // 清漆反射搭配透明度，免用折射背景重繪，維持行動裝置繪製負擔。
  opticalWindow.transmission = 0; opticalWindow.clearcoat = .45; opticalWindow.metalness = .08;
  block(vision, [wx, 8, wz], [v.x, v.windowY, bz], opticalWindow);
  // 外框四根：橫向兩根在視窗 Z 兩側、縱向兩根在 X 兩側，彼此與視窗都留 10 mm 以上，避免重合面
  const windowFrame = [];
  for (const dz of [-wz / 2 - 20, wz / 2 + 20]) windowFrame.push(housing(vision, wx + 80, 26, 20, SURFACE.extrusion, v.x, v.windowY, bz + dz, 2));
  for (const dx of [-wx / 2 - 20, wx / 2 + 20]) windowFrame.push(housing(vision, 20, 26, wz - 84, SURFACE.extrusion, v.x + dx, v.windowY, bz, 2));
  for (const dx of [-wx / 2 + 20, wx / 2 - 20]) for (const dz of [-wz / 2 + 20, wz / 2 - 20])
    rod(vision, [v.x + dx, v.windowY + 10, bz + dz], [v.x + dx, v.beamY - 60, bz + dz], 9, MAT.frame);
  // 雙軌下方沿用兩根橫托架承接視窗吊桿與條燈支柱。
  for (const dz of [-wz / 2 + 20, wz / 2 - 20]) block(vision, [300, 40, 40], [v.x, v.beamY - 55, bz + dz], MAT.frame);
  const leds = [];                                                                 // 低角度條燈 ×2（45° 朝下）
  for (const lx of v.ledX) {
    // core 的條形光模型：外殼 60 × 50、發光面 52 × 8；整支繞 Z 轉 45°，發光面在朝帶面那一側（轉之前沿本地 X 偏 20√2）
    const side = lx < v.x ? -1 : 1;
    const bar = barLight.create({ length: v.ledLen, lensOffset: [-side * 20 * Math.SQRT2, 0], lensMaterial: LED_ON });
    bar.root.position.set(lx, v.ledY, bz); bar.root.rotation.z = side * Math.PI / 4; vision.add(bar.root);
    leds.push(bar.lens);
    for (const dz of [-v.ledLen / 2 + 30, v.ledLen / 2 - 30]) block(vision, [34, 300, 34], [lx, v.ledY + 170, bz + dz], MAT.frame);
  }
  plate(vision, ['立體取像站（示意）', '基線 300／WD 800'], 290, 90, [v.x + 30, 1685, -754], Math.PI,
    { font: 'bold 38px "Microsoft JhengHei",sans-serif' });
  const lightPatch = createLightPatch(scene, v, b);

  // ================================================================ SCARA 手臂（DENSO HSR065）＋側邊立座＋吸盤工具
  const robot = new THREE.Group(); robot.name = 'robot'; scene.add(robot);
  const a = L.arm, [pw, pd] = a.pedestal;
  block(robot, [pw, a.baseY - 20, pd], [a.x, (a.baseY - 20) / 2, a.z], MAT.frame);
  block(robot, [pw + 40, 20, pd + 40], [a.x, a.baseY - 10, a.z], MAT.steelDark);
  block(robot, [pw + 70, 20, pd + 70], [a.x, 10, a.z], MAT.steelDark);
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) foot(robot, a.x + dx * (pw / 2 - 20), a.z + dz * (pd / 2 - 20), 150);
  bolts(robot, [-1, 1].flatMap(i => [-1, 1].map(j => [a.x + i * 130, a.baseY + 2, a.z + j * 95])), 10);
  decal(robot, 240, 60, [a.x, 760, a.z - pd / 2 - 1], [0, Math.PI, 0], 'HSR065', { color: '#8da2b0', center: true });

  const arm = createHSR065();
  arm.root.position.set(a.x, a.baseY, a.z); robot.add(arm.root);
  const armBase = arm.root.position;

  // 吸盤工具（真空發生器 + Ø40 波紋吸盤 ×2 + 80 mm 氣壓浮動桿）：裝在法蘭本地 −y，吸盤面在 −(260＋浮動量)
  const T = L.tool, tool = new THREE.Group(); tool.name = 'suction tool'; arm.flange.add(tool);
  cylinder(tool, 46, 14, [0, -17, 0], MAT.steel, 'y', 28);
  block(tool, [120, 130, 14], [0, -90, 46], MAT.alu);
  // 真空發生器、電磁閥、浮動桿、吸盤是 core 的市購品模型；法蘭轉接盤、安裝板與吸盤橫桿是加工件，留在站內
  const ejector = vacuumEjector.create(); ejector.root.position.set(0, -60, 86); tool.add(ejector.root);          // 真空發生器
  const valve = solenoidValve.create(); valve.root.position.set(0, -115, 80); tool.add(valve.root);              // 電磁閥
  const floatUnit = floatRod.create({ sleeveMaterial: finished(MAT.alu, 'metal') }); tool.add(floatUnit.root);    // 浮動桿（外套留在模型 root）
  // 浮動段（隨 fl 下移）：站自己的群組留著，模型的伸縮桿群組掛進來——關節物件與 apply() 的 plunger.position.y 都不用改
  const plunger = new THREE.Group(); tool.add(plunger);
  plunger.add(floatUnit.plunger); floatUnit.rod.userData.nested = tool;
  block(plunger, [26, 20, T.cupSpan + 30], [0, -240, 0], MAT.steelDark);          // 橫桿兩端各收 5 mm：擺動時讓開手臂基座後方的出線管
  plunger.add(suctionCup.create({ r: T.cupR, at: [-T.cupSpan / 2, T.cupSpan / 2].map(dz => [0, -256, dz]) }).root);   // Ø40 吸盤 ×2（網格名稱 suction cup，allow 規則用）

  // ================================================================ 分流帶 A／B（同側反向，與手臂架台排成同一列）
  const divOf = k => k === 'A' ? L.divA : L.divB;
  for (const key of ['A', 'B']) {
    const d = divOf(key), gp = new THREE.Group(); gp.name = 'div' + key; scene.add(gp);
    const len = d.x[1] - d.x[0], tex = beltTexture(0x53606a);
    tex.repeat.set(len / 100, 1);
    // core 的平皮帶模型（含標準機身：側樑、擋邊、支腳）；馬達與吊架在 electrical.js 加到 gp。
    const div = beltConveyor.create({
      span: d.x, width: d.width, top: d.top, carry: { material: std(0xffffff, .92, .02, { map: tex }) },
      bed: { material: SURFACE.support }, rollers: { material: finished(MAT.roller, 'metal') }, legs: { x: d.legX },
    });
    div.root.position.z = d.z; gp.add(div.root);
  }

  // ================================================================ 收料箱（機台外，示意）
  const bins = new THREE.Group(); bins.name = 'bins'; scene.add(bins);
  const binSlots = { A: [], B: [] };
  for (const key of ['A', 'B']) {
    const bn = key === 'A' ? L.binA : L.binB, [bx, by, bd] = L.bin;
    block(bins, [bx, 20, bd], [bn.x, 30, bn.z], MAT.pallet);                       // 箱底（頂面 Y 40）
    for (const s of [-1, 1]) block(bins, [bx, by, 20], [bn.x, by / 2 + 42, bn.z + s * (bd / 2 - 10)], MAT.palletEmpty);
    for (const s of [-1, 1]) block(bins, [20, by, bd - 64], [bn.x + s * (bx / 2 - 10), by / 2 + 42, bn.z], MAT.palletEmpty);
    plate(bins, [key === 'A' ? '食品 HDPE' : '非食品 HDPE'], 320, 92, [bn.x, 300, bn.z + bd / 2 + 14], 0);   // 標牌朝分流帶外側（+Z）
    // 箱內定位格：長軸沿 Z 放（X 向只佔橫寬），3 排 × 3 層
    for (let layer = 0; layer < 3; layer++) for (const dx of [-230, 0, 230])
      binSlots[key].push({ x: bn.x + dx, y: 44 + layer * 110, z: bn.z, theta: Math.PI / 2 + (dx / 230) * .17 });
  }

  // ================================================================ 機台框架、警示燈、HMI、電控箱
  const frame = new THREE.Group(); frame.name = 'frame'; scene.add(frame);
  const f = L.frame, PZ = f.postZ;
  for (const px of [-f.postX, f.postX]) for (const pz of PZ) {
    block(frame, [f.post, f.top, f.post], [px, f.top / 2, pz], MAT.frame);
    block(frame, [f.post + 20, 16, f.post - 8], [px, 8, pz], MAT.steelDark);   // 底板只往 ±X 外伸；Z 向比柱面內縮 4 mm（整機寬度才是 1460，且不與柱側重合）
  }
  for (const pz of PZ) block(frame, [2 * f.postX + f.post, 40, 40], [0, f.top - 45, pz], MAT.frame);
  for (const px of [-f.postX, f.postX]) block(frame, [40, 40, PZ[1] - PZ[0] + f.post], [px, f.top - 45, (PZ[0] + PZ[1]) / 2], MAT.frame);
  // 透明護板只做非操作面（−Z），X −900…−640 留開口給取像站橫樑的托架穿過去。
  // 操作面（+Z）保留開口，第二段光幕僅呈現安全功能示意。
  // 雙軌通過後護板處留局部安裝缺口，其餘護板延續原位置。
  block(frame, [1440, 845, 10], [130, 1327, -710], GUARD);
  block(frame, [50, 635, 10], [-615, 1222, -710], GUARD);
  block(frame, [50, 44, 10], [-615, 1727, -710], GUARD);
  // 三色警示燈：按慣例裝在框架頂面之上，所以單獨一個子群組，固定設備的框架平面檢核不列入
  // core 的三色燈模型（root 名稱仍是 tower）；燈節由上而下是綠、黃、紅，材質沿用共用的 MAT，亮暗由 apply 與 electrical.js 換材質
  const towerUnit = signalTower.create({
    name: 'tower', radius: 34, height: 46, segments: 18, lamps: ['green', 'amber', 'red'], base: 30, pitch: 48,
    materials: { red: MAT.red, amber: MAT.amber, green: MAT.green }, pole: { r: 26, h: 150, y: 75, segments: 18, material: MAT.black },
  });
  const tower = towerUnit.root; tower.position.set(-f.postX, f.top, PZ[0]); frame.add(tower);
  const towerLights = [towerUnit.lamps.red, towerUnit.lamps.amber, towerUnit.lamps.green];

  // HMI：安裝板貼在 +Z 側骨架立柱（X −850／Z +670）的 +X 面，短懸臂往 +X 伸出撐住外殼。
  // 外殼、螢幕面板與畫面（canvas）是 core 的 hmi 模型；畫面內容由電控模組（electrical.js）依狀態更新。
  const hmi = new THREE.Group(); hmi.name = 'hmi'; scene.add(hmi);
  const hm = L.hmi, [hw, hh, hd] = hm.size;
  block(hmi, [16, 260, 70], [postFaceX + 14, hm.y, hm.armZ], MAT.steelDark);       // 立柱上的安裝板（離柱面 6 mm，不重合）
  block(hmi, [100, 70, 80], [postFaceX + 66, hm.y, hm.armZ + 10], MAT.frame);      // 短懸臂（各面都錯開安裝板 5 mm 以上，不重合）
  const hmiPanel = hmiModel.create({ w: hw, h: hh, d: hd, bevel: 12, panel: { w: hm.screen[0], h: hm.screen[1] }, display: { w: 468, h: 258, mipmaps: false } });
  hmiPanel.root.position.set(hm.x, hm.y, hm.z); hmi.add(hmiPanel.root);

  const cab = new THREE.Group(); cab.name = 'cabinet'; scene.add(cab);

  addDetails({ belt, vision, robot, frame, bins, L });
  // 只替換固定設備材質，不改共用 MAT，也不觸碰手臂與工件的階層。
  for (const module of [belt, vision, frame, hmi, cab]) module.traverse(m => {
    if (!m.isMesh) return;
    if (m.material === MAT.frame) m.material = SURFACE.extrusion;
    else if (m.material === MAT.alu) m.material = SURFACE.support;
    else if (m.material === MAT.cabinet) m.material = SURFACE.cabinet;
  });

  // ================================================================ 標註（示意線框，userData.fx → 不列入干涉檢查）
  const marks = new THREE.Group(); marks.name = 'marks'; marks.userData.fx = true; scene.add(marks);
  const mk = name => { const g = new THREE.Group(); g.name = name; marks.add(g); return g; };
  const fovMark = mk('fov'), winMark = mk('pickWindow'), dimMark = mk('dims');
  const [fovW, fovL] = v.fov;
  for (const cz of v.camZ) for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
    rod(fovMark, [v.x, v.camY, cz], [v.x + sx * fovL / 2, b.top + 4, bz + sz * fovW / 2], 4, MARK.fov, 6);
  for (const [sx, sz, w, d] of [[0, -1, fovL, 10], [0, 1, fovL, 10], [-1, 0, 10, fovW], [1, 0, 10, fovW]])
    block(fovMark, [w, 6, d], [v.x + sx * fovL / 2, b.top + 6, bz + sz * fovW / 2], MARK.fov);
  rod(fovMark, [v.x, v.camY - 100, v.camZ[0]], [v.x, v.camY - 100, v.camZ[1]], 6, MARK.dim, 6);
  // ================================================================ 前段：既有輸送帶、前段立體取像站、ABB 網籠與並聯手臂
  const front = createFrontLine(scene, L, belt);
  leds.push(...front.leds);                                                         // 前段條燈與後段同一個觸發訊號
  const F = L.front, frontFov = mk('frontFov'), abbWin = mk('abbWindow');
  for (const cz of F.camZ) for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
    rod(frontFov, [F.x, F.camY, cz], [F.x + sx * F.fov[1] / 2, b.top + 4, bz + sz * F.fov[0] / 2], 4, MARK.fov, 6);
  for (const [sx, sz, w, d] of [[0, -1, F.fov[1], 10], [0, 1, F.fov[1], 10], [-1, 0, 10, F.fov[0]], [1, 0, 10, F.fov[0]]])
    block(frontFov, [w, 6, d], [F.x + sx * F.fov[1] / 2, b.top + 6, bz + sz * F.fov[0] / 2], MARK.fov);
  for (const [sx, sz, w, d] of [[0, -1, 2 * L.abb.window, 10], [0, 1, 2 * L.abb.window, 10], [-1, 0, 10, bw], [1, 0, 10, bw]])
    block(abbWin, [w, 6, d], [L.abb.x + sx * L.abb.window, b.top + 6, bz + sz * bw / 2], MARK.win);
  for (let i = 0; i < 72; i++) {                                                   // ABB 工作直徑 1600 的地面圓
    const t0 = i / 72 * Math.PI * 2, t1 = (i + .55) / 72 * Math.PI * 2, R = L.abb.reach;
    rod(dimMark, [L.abb.x + R * Math.cos(t0), 10, bz + R * Math.sin(t0)], [L.abb.x + R * Math.cos(t1), 10, bz + R * Math.sin(t1)], 6, MARK.dim, 4);
  }
  const elec = createElectrical(scene, { cab, frame, robot, belt, vision, hmi, hmiPanel, marks, cameras, tool, leds, towerLights, L, airOut: front.airOut });
  const pk = L.pick;
  for (const [x, z, w, d] of [[pk.cx, pk.z[0], pk.x[1] - pk.x[0], 10], [pk.cx, pk.z[1], pk.x[1] - pk.x[0], 10],
  [pk.x[0], pk.cz, 10, pk.z[1] - pk.z[0]], [pk.x[1], pk.cz, 10, pk.z[1] - pk.z[0]]])
    block(winMark, [w, 6, d], [x, b.top + 6, z], MARK.win);
  block(dimMark, [10, 6, bw], [-1120, b.top + 8, bz], MARK.dim);
  for (let i = 0; i < 72; i++) {                                                   // 動作半徑 650 的地面圓
    const t0 = i / 72 * Math.PI * 2, t1 = (i + .55) / 72 * Math.PI * 2;
    rod(dimMark, [a.x + a.reach * Math.cos(t0), 10, a.z + a.reach * Math.sin(t0)],
      [a.x + a.reach * Math.cos(t1), 10, a.z + a.reach * Math.sin(t1)], 6, MARK.dim, 4);
  }

  // ================================================================ 工件
  const itemsG = new THREE.Group(); itemsG.name = 'items'; scene.add(itemsG);
  const items = ITEMS.map(it => {
    const grp = buildItem(it.kind); itemsG.add(grp);
    const extent = it.L * Math.abs(Math.sin(it.theta)) + it.W * Math.abs(Math.cos(it.theta));
    const rec = { ...it, grp, extent };
    rec.zAt = x => zOf(it, x);                                                     // 兩段導料板的通道（schedule.js）
    rec.z = rec.zAt(pk.cx);
    return rec;
  });
  const itemById = new Map(items.map(it => [it.id, it]));
  const maxBeltH = Math.max(...items.map(it => it.H));

  // ================================================================ 前段 ABB：排程與路徑
  // 規則只有一條（先到先抓、沒空就放行）：目標進到抓取線前後 ±window 的窗口時，手臂若能在它離開窗口前就位就抓；
  // 上一件還沒放完、趕不到，就放行給後段。哪幾件被放行不是指定的，是這條規則跑出來的結果——
  // 後段的取放工單（下面的 jobs）只排「沒被 ABB 抓走」的目標。
  // 抓到的工件橫移到旁邊的既有分類帶：食品類放下游那段（往下游走）、非食品類放上游那段（往上游走），由帶尾落進收料箱。
  const AB = L.abb, SO = AB.sort, abbDur = ABB_PHASES.map(p => p.dur), ABB_PRE = sumDur(abbDur, 3);
  const abbHome = { x: AB.x, y: AB.carryY, z: bz };
  const abbJobs = [], passed = [], abbSegs = [];
  const frontTargets = items.filter(it => it.cls !== 'other').sort((p, q) => q.off - p.off);   // 依到達順序
  {
    let ready = -Infinity, pos = abbHome, tau = 0;                                  // ready：上一趟放完料、可以再出發的時間
    const push = s => abbSegs.push(s);
    for (const it of frontTargets) {
      const enter = (AB.x - AB.window - it.off) / BELT_V, leave = (AB.x + AB.window - it.off) / BELT_V;
      const grab = Math.max(enter, ready + ABB_PRE);
      if (grab > leave + 1e-9) { it.pass = { enter, leave, busyUntil: ready }; passed.push(it); continue; }
      const t0 = grab - ABB_PRE, at = k => t0 + sumDur(abbDur, k), z = it.zAt(AB.x), grabY = b.top + 2 + it.H + 1.5;
      const zone = front.zones[it.cls === 'food' ? 'food' : 'nonfood'], slot = zone.slots[zone.used++ % zone.slots.length];
      const rel = { x: zone.drop, y: SO.release, z: front.sortZ };
      const job = { item: it, tau0: t0, grabTau: grab, endTau: t0 + ABB_CT, releaseTau: at(5) + .03, zone, slot, rel };
      job.landTau = job.releaseTau + Math.sqrt(2 * Math.max(1, SO.release - 1.5 - it.H - SO.top - 2) / G);
      job.exitTau = job.landTau + Math.abs(zone.exit - rel.x) / SO.v;
      job.binTau = job.exitTau + .6;
      it.abbJob = job; abbJobs.push(job);
      if (pos === abbHome && t0 > tau) push({ kind: 'hold', tau0: tau, dur: t0 - tau, p0: abbHome, action: 'ABB：待機', sub: '窗口內沒有目標' });
      else if (t0 - tau > .9) {                                                     // 有空檔：先回抓取線上方待機
        push({ kind: 'move', tau0: tau, dur: .45, p0: pos, p1: abbHome, action: 'ABB：回待機位', sub: '等待下一個目標進入窗口' });
        push({ kind: 'hold', tau0: tau + .45, dur: t0 - tau - .45, p0: abbHome, action: 'ABB：待機', sub: '窗口內沒有目標' }); pos = abbHome;
      } else if (t0 > tau) push({ kind: 'hold', tau0: tau, dur: t0 - tau, p0: pos, action: 'ABB：待機', sub: '等待下一個目標進入窗口' });
      const pg = { x: it.off + BELT_V * grab, y: grabY, z }, pu = { ...pg, y: AB.carryY }, meta = { job, item: it };
      push({ ...meta, ...ABB_PHASES[0], kind: 'move', tau0: at(0), dur: abbDur[0], p0: pos, p1: { x: it.off + BELT_V * at(1), y: AB.carryY, z } });
      push({ ...meta, ...ABB_PHASES[1], kind: 'track', tau0: at(1), dur: abbDur[1], y: [AB.carryY, grabY], z });
      push({ ...meta, ...ABB_PHASES[2], kind: 'track', tau0: at(2), dur: abbDur[2], y: [grabY, grabY], z });
      push({ ...meta, ...ABB_PHASES[3], kind: 'move', tau0: at(3), dur: abbDur[3], p0: pg, p1: pu });
      push({ ...meta, ...ABB_PHASES[4], kind: 'move', tau0: at(4), dur: abbDur[4], p0: pu, p1: rel, sub: `${it.cls === 'food' ? '食品' : '非食品'} HDPE → 分類帶${zone.dir > 0 ? '下游' : '上游'}段` });
      push({ ...meta, ...ABB_PHASES[5], kind: 'hold', tau0: at(5), dur: abbDur[5], p0: rel });
      ready = job.endTau; pos = rel; tau = job.endTau;
    }
    push({ kind: 'move', tau0: tau, dur: .45, p0: pos, p1: abbHome, action: 'ABB：回待機位', sub: '前段分選結束' });
    push({ kind: 'hold', tau0: tau + .45, dur: Math.max(1, timing.tauTotal - tau - .45), p0: abbHome, action: 'ABB：待機', sub: '' });
  }
  /** ABB 吸嘴口在製程時間 τ 的位置（世界座標）與所在的子動作 */
  function abbAt(τ) {
    let lo = 0, hi = abbSegs.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (τ < abbSegs[m].tau0 + abbSegs[m].dur) hi = m; else lo = m + 1; }
    const s = abbSegs[lo], u = s.dur > 0 ? Math.min(1, Math.max(0, (τ - s.tau0) / s.dur)) : 1, e = EASE(u);
    if (s.kind === 'hold') return { p: s.p0, seg: s };
    if (s.kind === 'move') return { p: { x: s.p0.x + (s.p1.x - s.p0.x) * e, y: s.p0.y + (s.p1.y - s.p0.y) * e, z: s.p0.z + (s.p1.z - s.p0.z) * e }, seg: s };
    return { p: { x: s.item.off + BELT_V * (s.tau0 + u * s.dur), y: s.y[0] + (s.y[1] - s.y[0]) * e, z: s.z }, seg: s };
  }

  // ================================================================ 運動學輔助
  const ELBOW = -1;                                                                // 全程同一肘部方向
  const flFor = y => Math.min(T.floatMax, Math.max(0, a.carryY - y - 200));
  // 指定肘部方向的二連桿逆解。不用 core 的 ik()：它在兩組肘部解之間用加權距離挑選，
  // 弧線路徑上某幾個取樣點會跳到另一組（J2 一次變 180°），路徑就不連續了。
  const { L1: ARM1, L2: ARM2, flange0: FLANGE0, limits: LIM } = HSR065;
  const wrapPi = r => Math.atan2(Math.sin(r), Math.cos(r));
  function solve(x, y, z, yaw, turn) {
    const fl = flFor(y), fx = x - a.x, fz = z - a.z;                               // 工具只往 −y 偏移，水平位置不隨 J4 改變
    const c2 = (fx * fx + fz * fz - ARM1 * ARM1 - ARM2 * ARM2) / (2 * ARM1 * ARM2);
    if (Math.abs(c2) > 1) return null;
    const j2 = ELBOW * Math.acos(c2);
    const j1 = wrapPi(Math.atan2(fx, fz) - Math.atan2(ARM2 * Math.sin(j2), ARM1 + ARM2 * Math.cos(j2)));
    const d3 = armBase.y + FLANGE0 - y - (T.len + fl), j4 = yaw - j1 - j2 + turn;
    if (Math.abs(j1) > LIM.j1[1] * D2R || Math.abs(j2) > LIM.j2[1] * D2R) return null;
    if (d3 < -1e-6 || d3 > LIM.d3[1] + 1e-6 || Math.abs(j4) > LIM.j4[1] * D2R) return null;
    return { j1, j2, d3, j4, fl };
  }
  // 極座標角度：取使 J1 落在 ±170° 內的那個等價角（取料點在 −180° 側，投放點在 ±90° 內）
  const phiOf = (x, z) => { const p = Math.atan2(x - a.x, z - a.z); return p > 130 * D2R ? p - 2 * Math.PI : p; };
  /**
   * 極座標弧線：角度線性轉、半徑中途先收（dip）再伸；回傳 u → 關節值。
   * j4From 有給時 J4 由該值線性轉到終點姿態的 J4——工件沒被吸著時手腕角度可以自由轉，
   * 不這樣做的話每趟的法蘭轉角選擇不同，段落交界會出現 J4 瞬跳。
   */
  function arcPath(p0, p1, yaw, turn, j4From = null) {
    const r0 = Math.hypot(p0.x - a.x, p0.z - a.z), r1 = Math.hypot(p1.x - a.x, p1.z - a.z);
    const f0 = phiOf(p0.x, p0.z), f1 = phiOf(p1.x, p1.z);
    const dip = Math.max(0, Math.min(a.dip, .6 * (Math.abs(f1 - f0) / D2R - 60), (r0 + r1) / 2 - a.swingR));
    const j4To = j4From == null ? null : solve(p1.x, p1.y, p1.z, yaw, turn)?.j4 ?? j4From;
    return u => {
      const e = EASE(u), fi = f0 + (f1 - f0) * e, r = r0 + (r1 - r0) * e - dip * Math.sin(Math.PI * u);
      const q = solve(a.x + r * Math.sin(fi), p0.y + (p1.y - p0.y) * e, a.z + r * Math.cos(fi), yaw, turn);
      if (q && j4To != null) q.j4 = j4From + (j4To - j4From) * e;
      return q;
    };
  }
  /** 這條路徑在軸速上限下最少要幾秒（路徑形狀已含梯形曲線，所以直接用取樣的最大斜率） */
  function durFor(path, base, N = 48) {
    let need = 0, prev = path(0);
    for (let i = 1; i <= N; i++) {
      const q = path(i / N);
      if (q && prev) need = Math.max(need,
        Math.abs(q.j1 - prev.j1) / D2R * N / AXIS.j1, Math.abs(q.j2 - prev.j2) / D2R * N / AXIS.j2,
        Math.abs(q.j4 - prev.j4) / D2R * N / AXIS.j4, Math.abs(q.d3 + q.fl - prev.d3 - prev.fl) * N / AXIS.z);
      prev = q;
    }
    return Math.max(base, Math.ceil(need * 1000) / 1000);
  }
  // 法蘭轉角：吸盤桿是對稱的，θ+90° 與 θ−90° 等效；取讓 J4 不超限又最接近上一姿態的組合
  function chooseYaw(it, poses, prevJ4) {
    let best = null;
    for (const yaw of [it.theta + Math.PI / 2, it.theta - Math.PI / 2]) for (const turn of [0, 2 * Math.PI, -2 * Math.PI]) {
      const qs = poses.map(p => solve(p.x, p.y, p.z, yaw, turn));
      if (qs.some(q => !q)) continue;
      const peak = Math.max(...qs.map(q => Math.abs(q.j4))) / D2R;
      const score = Math.abs(qs[0].j4 - prevJ4) / D2R + Math.max(0, peak - 300) * 20;
      if (!best || score < best.score) best = { yaw, turn, score, qs };
    }
    return best;
  }
  const tcpOf = q => fk(q, { x: 0, y: -(T.len + q.fl), z: 0 }, armBase);

  // ================================================================ 取放工單與手臂路徑
  // 依帶上順序掃過每個目標物：手臂閒下來才排得進去，排不進去的就是漏抓（流到末端觸發警報）。
  // 每個子動作的時間＝基準時間與「關節行程 ÷ 軸速上限」取大者，所以跨到另一條分流帶時節拍會自動加長。
  const HOME_P = { x: a.home[0], y: a.carryY, z: a.home[1] };
  const HOME = solve(HOME_P.x, HOME_P.y, HOME_P.z, 0, 0);
  const jobs = [], missed = [], segs = [], bad = [];
  const put = s => (segs.push(s), s);
  const binUse = { A: 0, B: 0 };
  let q = HOME, qP0 = HOME_P, tau = 0, free = 0;

  for (const it of items) {
    if (it.cls === 'other' || it.abbJob) continue;
    const dest = it.cls === 'food' ? 'A' : 'B', d = divOf(dest);
    const grabTau = (pk.cx - it.off) / BELT_V, grabY = b.top + 2 + it.H + 1.5;
    const dBase = PHASES.map(p => p.dur);
    // 抓取前兩段的時間與接近段無關，所以接近段結束的位置可以先算出來
    const xA = it.off + BELT_V * (grabTau - dBase[1] - dBase[2]);
    const poses = [{ x: xA, y: a.carryY, z: it.z }, { x: pk.cx, y: grabY, z: it.z },
    { x: d.place, y: a.carryY, z: d.z }, { x: d.place, y: L.release, z: d.z }];
    const pickYaw = chooseYaw(it, poses, q.j4);
    if (!pickYaw) { bad.push(`工件 ${it.id}（${it.kind}）逆解失敗`); continue; }
    const { yaw, turn, qs: [qA, qV, qP, qR] } = pickYaw;
    const qL = { ...qV, d3: 0, fl: 0 };
    const pV = { x: pk.cx, y: a.carryY, z: it.z };
    const swing = arcPath(pV, poses[2], yaw, turn);
    const dur = [...dBase];
    // Z 軸段：梯形曲線峰值是平均的 4/3 倍。基準時間已足夠（最矮的瓶子行程 255 mm → 0.16 s），
    // 所以同側連續取放的 CT 不會隨瓶高變動。
    dur[3] = Math.max(dBase[3], (qV.d3 + qV.fl) * (4 / 3) / AXIS.z);
    dur[4] = durFor(swing, dBase[4]);
    dur[5] = Math.max(dBase[5], (qR.d3 + qR.fl - qP.d3 - qP.fl) * (4 / 3) / AXIS.z);
    // 接近段：離上一趟有明顯空檔時手臂會先回待機位，接近段要改從待機位起算（會影響 tau0，所以先決定）
    const startAt = (p0, j4a) => grabTau - durFor(arcPath(p0, poses[0], yaw, turn, j4a), dBase[0]) - dur[1] - dur[2];
    let fromHome = startAt(qP0, q.j4) - tau > 1.4;
    let tau0 = fromHome ? startAt(HOME_P, HOME.j4) : startAt(qP0, q.j4);
    if (fromHome && tau0 - tau <= 1.4) { fromHome = false; tau0 = startAt(qP0, q.j4); }
    if (tau0 < free - 1e-9) { missed.push({ item: it, dest, grabTau, tau0, free }); continue; }
    if (fromHome) {                                                                // 回待機位 + 等料
      const ret = q === HOME ? 0 : Math.min(1.2, tau0 - tau);
      if (ret > .08) put({ tau0: tau, dur: ret, kind: 'path', path: arcPath(qP0, HOME_P, 0, 0, q.j4), action: '回待機位', sub: '等待下一個目標進入追蹤窗口' });
      put({ tau0: tau + ret, dur: tau0 - tau - ret, kind: 'hold', q0: HOME, action: '待機', sub: '追蹤窗口內無目標' });
      q = HOME; qP0 = HOME_P;
    }
    dur[0] = durFor(arcPath(qP0, poses[0], yaw, turn, q.j4), dBase[0]);
    const total = sumDur(dur, dur.length);
    const job = {
      item: it, ref: it, dest, dur, tau0, grabTau, total, endTau: tau0 + total,
      releaseTau: tau0 + sumDur(dur, 6), t0: timing.timeAt(tau0), grabT: timing.timeAt(grabTau),
    };
    job.landTau = job.releaseTau + Math.sqrt(2 * Math.max(1, L.release - 1.5 - it.H - d.top - 2) / G);
    job.exitX = d.x[dest === 'A' ? 0 : 1];
    job.exitTau = job.landTau + Math.abs(job.exitX - d.place) / L.divV;
    job.slot = binSlots[dest][binUse[dest]++ % binSlots[dest].length];
    job.binTau = job.exitTau + .7;
    it.job = job; jobs.push(job);
    const at = k => tau0 + sumDur(dur, k), meta = { job, item: it };
    put({ ...meta, ...PHASES[0], tau0: at(0), dur: dur[0], kind: 'path', path: arcPath(qP0, poses[0], yaw, turn, q.j4) });
    put({ ...meta, ...PHASES[1], tau0: at(1), dur: dur[1], kind: 'track', y: [a.carryY, grabY], yaw, turn });
    put({ ...meta, ...PHASES[2], tau0: at(2), dur: dur[2], kind: 'track', y: [grabY, grabY], yaw, turn });
    put({ ...meta, ...PHASES[3], tau0: at(3), dur: dur[3], kind: 'joint', q0: qV, q1: qL });
    put({ ...meta, ...PHASES[4], tau0: at(4), dur: dur[4], kind: 'path', path: swing, action: `${PHASES[4].action}（${dest} 帶）`, sub: `${it.cls === 'food' ? '食品' : '非食品'} HDPE → ${dest} 帶` });
    put({ ...meta, ...PHASES[5], tau0: at(5), dur: dur[5], kind: 'joint', q0: qP, q1: qR });
    put({ ...meta, ...PHASES[6], tau0: at(6), dur: dur[6], kind: 'hold', q0: qR });
    q = qR; qP0 = poses[3]; tau = job.endTau; free = job.endTau;
  }
  put({ tau0: tau, dur: 1.2, kind: 'path', path: arcPath(qP0, HOME_P, 0, 0, q.j4), action: '回待機位', sub: '分揀結束' });
  put({ tau0: tau + 1.2, dur: Math.max(1, timing.tauTotal - tau - 1.2), kind: 'hold', q0: HOME, action: '待機', sub: '' });

  const segAt = τ => { let lo = 0, hi = segs.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (τ < segs[m].tau0 + segs[m].dur) hi = m; else lo = m + 1; } return segs[lo]; };
  const mixQ = (q0, q1, e) => ({ j1: q0.j1 + (q1.j1 - q0.j1) * e, j2: q0.j2 + (q1.j2 - q0.j2) * e, d3: q0.d3 + (q1.d3 - q0.d3) * e, j4: q0.j4 + (q1.j4 - q0.j4) * e, fl: q0.fl + (q1.fl - q0.fl) * e });
  function armAt(τ) {
    const s = segAt(Math.max(0, Math.min(τ, timing.tauTotal))), u = s.dur > 0 ? Math.min(1, Math.max(0, (τ - s.tau0) / s.dur)) : 1;
    if (s.kind === 'hold') return { q: s.q0, seg: s };
    if (s.kind === 'joint') return { q: mixQ(s.q0, s.q1, EASE(u)), seg: s };
    if (s.kind === 'path') return { q: s.path(u) || HOME, seg: s };
    const e = EASE(u), y = s.y[0] + (s.y[1] - s.y[0]) * e, tt = s.tau0 + u * s.dur;
    return { q: solve(s.item.off + BELT_V * tt, y, s.item.z, s.yaw, s.turn) || HOME, seg: s };
  }

  // ================================================================ 分流帶尾端 → 收料箱（core/physics，2026-10-06 評估平台 Q8）
  // 工件到帶尾前 PHYS_LEAD 秒交給物理：分流帶（皮帶速度）把工件帶到尾端翻落、掉進收料箱堆積。原本是拋物線＋固定格位。
  // 工件用外框方塊近似（L × H × W），空瓶約 60 kg/m³；烘焙在載入時做一次（幾百 ms），apply(τ) 只取樣。
  const PHYS_LEAD = .5, physJobs = jobs.filter(j => j.exitTau - PHYS_LEAD > j.landTau);
  const binStatics = ['A', 'B'].flatMap(key => {
    const bn = key === 'A' ? L.binA : L.binB, [bx, by, bd] = L.bin;
    return [{ id: `bin${key} 底`, size: [bx, 20, bd], pos: [bn.x, 30, bn.z] },
      ...[-1, 1].map(s => ({ id: `bin${key} 長邊 ${s}`, size: [bx, by, 20], pos: [bn.x, by / 2 + 42, bn.z + s * (bd / 2 - 10)] })),
      ...[-1, 1].map(s => ({ id: `bin${key} 短邊 ${s}`, size: [20, by, bd - 64], pos: [bn.x + s * (bx / 2 - 10), by / 2 + 42, bn.z] }))];
  });
  const physics = await bake({
    name: '分流帶尾端與收料箱', duration: timing.tauTotal + .5, seed: 1, statics: [{ id: '地面', size: [6000, 20, 4000], pos: [0, -10, 0] }, ...binStatics],
    conveyors: ['A', 'B'].map(k => { const d = divOf(k); return { id: `div${k}`, size: [d.x[1] - d.x[0], 20, d.width], pos: [(d.x[0] + d.x[1]) / 2, d.top - 10, d.z], speed: L.divV, dir: [d.dir, 0, 0] }; }),
    drops: physJobs.map(j => {
      const d = divOf(j.dest), it = j.item, x = j.exitX - d.dir * L.divV * PHYS_LEAD;
      j.physTau = j.exitTau - PHYS_LEAD;
      return { id: it.id, t: j.physTau, pos: [x, d.top + it.H / 2 + 1, d.z], rot: [0, it.theta * 180 / Math.PI, 0], velocity: [d.dir * L.divV, 0, 0],
        item: { name: it.kind, shape: 'box', size: [it.L, it.H, it.W], density: 60, friction: .5, restitution: .05 } };
    }),
  });
  const physAt = sampler(physics), halfUp = new THREE.Vector3(), physQ = new THREE.Quaternion();

  // ================================================================ 套用時間 t
  let last = null;
  function apply(t) {
    const ch = chapterAt(t), τ = timing.tau(t), s = BELT_V * τ;
    beltTex.offset.x = -s / 120;
    for (const r of rollers) r.rotation.y = s / b.roller;                           // 滾筒繞自己的軸轉（網格已先繞 X 轉 90°，自轉軸是本地 Y）
    for (const zn of Object.values(front.zones)) {                                // 既有分類帶：兩段反向，帶速同後段分流帶
      zn.tex.offset.x = -zn.dir * s * (SO.v / BELT_V) / 100;
      for (const r of zn.rollers) r.rotation.y = zn.dir * s * (SO.v / BELT_V) / 42;
    }
    const abb = abbAt(τ);
    front.delta.set(front.toPlatform(abb.p.x, abb.p.y, abb.p.z));

    const { q: qq, seg } = armAt(τ);
    arm.setJoints({ j1: qq.j1, j2: qq.j2, d3: qq.d3, j4: qq.j4 });
    plunger.position.y = -qq.fl;
    const tcp = tcpOf(qq);

    const counts = { A: 0, B: 0, other: 0, missed: 0, abb: 0, handoff: 0 }, physNow = new Map(physAt(τ).map(o => [o.id, o]));
    for (const it of items) {
      const job = it.job, grp = it.grp;
      let x = it.off + s, y = b.top + 2, z = it.zAt(x), rot = it.theta, show = true;
      const aj = it.abbJob;
      if (it.pass && τ >= it.pass.leave) counts.handoff++;
      if (aj && τ >= aj.grabTau) {
        if (τ < aj.releaseTau) {                                                   // 吸附中：跟著 ABB 吸嘴口
          x = abb.p.x; z = abb.p.z; y = abb.p.y - 1.5 - it.H;
        } else if (τ < aj.landTau) {                                               // 放料後自由落下到分類帶
          const dt = τ - aj.releaseTau;
          x = aj.rel.x; z = aj.rel.z; y = SO.release - 1.5 - it.H - G * dt * dt / 2;
        } else if (τ < aj.exitTau) {                                               // 在分類帶上
          x = aj.rel.x + aj.zone.dir * SO.v * (τ - aj.landTau); z = aj.rel.z; y = SO.top + 2;
        } else if (τ < aj.binTau) {                                                // 由帶尾落進收料箱
          const u = (τ - aj.exitTau) / (aj.binTau - aj.exitTau);
          x = aj.zone.exit + (aj.slot.x - aj.zone.exit) * u; z = aj.rel.z + (aj.slot.z - aj.rel.z) * u;
          y = SO.top + 2 + (aj.slot.y - SO.top - 2) * u * u; rot = it.theta + (aj.slot.theta - it.theta) * u;
        } else {                                                                   // 箱內定位
          x = aj.slot.x; z = aj.slot.z; y = aj.slot.y; rot = aj.slot.theta;
        }
        if (τ >= aj.landTau) counts.abb++;
      } else if (job && τ >= job.grabTau) {
        const d = divOf(job.dest);
        if (τ < job.releaseTau) {                                                  // 吸附中：跟著吸盤面
          x = tcp.p.x; z = tcp.p.z; y = tcp.p.y - 1.5 - it.H; rot = tcp.yaw - Math.PI / 2;
        } else if (τ < job.landTau) {                                              // 破真空後自由落下
          const dt = τ - job.releaseTau;
          x = d.place; z = d.z; y = L.release - 1.5 - it.H - G * dt * dt / 2;
        } else if (τ < (job.physTau ?? job.exitTau)) {                             // 在分流帶上
          x = d.place + d.dir * L.divV * (τ - job.landTau); z = d.z; y = d.top + 2;
        } else if (job.physTau != null) {                                          // 交給物理：帶尾翻落、掉進收料箱堆積
          const o = physNow.get(String(it.id));
          physQ.set(...o.quat); halfUp.set(0, it.H / 2, 0).applyQuaternion(physQ);
          grp.visible = true; grp.position.set(o.pos[0] - halfUp.x, o.pos[1] - halfUp.y, o.pos[2] - halfUp.z); grp.quaternion.copy(physQ);
          if (τ >= job.landTau) counts[job.dest]++;
          continue;
        } else if (τ < job.binTau) {                                               // 落進收料箱
          const u = (τ - job.exitTau) / (job.binTau - job.exitTau);
          x = job.exitX + (job.slot.x - job.exitX) * u; z = d.z + (job.slot.z - d.z) * u;
          y = d.top + 2 + (job.slot.y - d.top - 2) * u * u; rot = it.theta + (job.slot.theta - it.theta) * u;
        } else {                                                                   // 箱內定位
          x = job.slot.x; z = job.slot.z; y = job.slot.y; rot = job.slot.theta;
        }
        if (τ >= job.landTau) counts[job.dest]++;
      } else if (x > b.x[1]) {
        show = false;
        if (it.cls === 'other') counts.other++; else counts.missed++;
      } else if (x - leadOf(it) < L.site.x0 + L.site.roller) show = false;         // 還沒整件上到帶面（在上游入料罩裡）
      grp.visible = show;
      if (show) { grp.position.set(x, y, z); grp.rotation.set(0, rot, 0); }      // 整組姿態都設（物理段會設 x、z 的轉角，倒著拖回來要清掉）
    }

    fovMark.visible = ch.id === 'vision' || ch.id === 'ai';
    winMark.visible = ['track', 'pickA', 'pickB', 'pass', 'burst'].includes(ch.id);
    dimMark.visible = ch.id === 'overview' || ch.id === 'infeed';
    frontFov.visible = ch.id === 'frontVision' || ch.id === 'frontAI';
    abbWin.visible = ['abbTrack', 'abbPick', 'handoff'].includes(ch.id);
    const running = timing.rate(t) > .01 || ch.id === 'ai', alarm = counts.missed > 0;
    for (const lens of leds) lens.material = running ? LED_ON : MAT.alu;
    lightPatch.visible = front.lightPatch.visible = running;
    towerLights[0].material = alarm ? MAT.red : MAT.steelDark;
    towerLights[1].material = !alarm && !running ? MAT.amber : MAT.steelDark;
    towerLights[2].material = running && !alarm ? MAT.green : MAT.steelDark;

    last = {
      t, tau: τ, s, chapter: ch, station: ch.station, counts, alarm, q: qq, tcp, rate: timing.rate(t),
      action: seg.action || ch.name, sub: seg.sub || ch.note, job: seg.job || null,
      picks: jobs.filter(j => j.releaseTau <= τ).length,
      // 前段 ABB 當下的動作（側欄在前段的段落改顯示這一組）
      abb: { action: abb.seg.action, sub: abb.seg.sub || '', job: abb.seg.job || null, p: abb.p, picks: abbJobs.filter(j => j.releaseTau <= τ).length },
    };
    last.electrical = elec.set(last);
    front.setScreen([['ABB 分選站　SIM／示意', '#2a6f9c', 44], [`吸取次數　${last.abb.picks}`], [`放行給後段　${counts.handoff}`],
      [`輸送帶速度　${(BELT_V / 10 * last.rate).toFixed(1)} cm/s`], [alarm ? '後段：目標間距不足' : last.abb.action, alarm ? '#b3402f' : '#2c7a56', 34]]);
    return last;
  }

  // ================================================================ 空間檢核
  const metrics = (() => {
    const n = 4000, out = { maxR: 0, minR: Infinity, maxJ2: 0, maxJ4: 0, vj1: 0, vj2: 0, vj4: 0, vd3: 0, maxZ: -Infinity, minX: Infinity, maxX: -Infinity };
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const τ = timing.tauTotal * i / n, { q: qq } = armAt(τ), p = tcpOf(qq).p;
      out.maxR = Math.max(out.maxR, Math.hypot(p.x - a.x, p.z - a.z)); out.minR = Math.min(out.minR, Math.hypot(p.x - a.x, p.z - a.z));
      out.maxZ = Math.max(out.maxZ, p.z); out.minX = Math.min(out.minX, p.x); out.maxX = Math.max(out.maxX, p.x);
      out.maxJ2 = Math.max(out.maxJ2, Math.abs(qq.j2)); out.maxJ4 = Math.max(out.maxJ4, Math.abs(qq.j4));
      if (prev) {
        const h = timing.tauTotal / n;
        out.vj1 = Math.max(out.vj1, Math.abs(qq.j1 - prev.j1) / h); out.vj2 = Math.max(out.vj2, Math.abs(qq.j2 - prev.j2) / h);
        out.vj4 = Math.max(out.vj4, Math.abs(qq.j4 - prev.j4) / h); out.vd3 = Math.max(out.vd3, Math.abs(qq.d3 + qq.fl - prev.d3 - prev.fl) / h);
      }
      prev = qq;
    }
    for (const k of ['maxJ2', 'maxJ4', 'vj1', 'vj2', 'vj4']) out[k] /= D2R;
    out.clear = a.carryY - 1.5 - Math.max(...jobs.map(j => j.ref.H)) - (b.top + 2 + maxBeltH);
    out.ctA = jobs.filter(j => j.dest === 'A').map(j => j.total);
    out.ctB = jobs.filter(j => j.dest === 'B').map(j => j.total);
    return out;
  })();
  // ---- 混合料流的加權平均節拍（已拍板「以混合料流加權平均承諾」）
  // 四種轉移各算一次代表性單趟節拍：接近段從上一趟的投放點回抓取點、搬移段到這一趟的投放點。
  // 用抓取窗口中心與中位瓶高做代表，所以不受動畫裡剛好出現哪些轉移影響。
  const throughput = (() => {
    const repH = 76, yaw = Math.PI / 2;                                            // 七款目標物高度 62…95 的中位數
    const above = { x: pk.cx, y: a.carryY, z: pk.cz }, grabY = b.top + 2 + repH + 1.5;
    const qGrab = solve(pk.cx, grabY, pk.cz, yaw, 0), ct = {};
    for (const prev of ['A', 'B']) for (const dest of ['A', 'B']) {
      const dp = divOf(prev), dd = divOf(dest);
      const rel = { x: dp.place, y: L.release, z: dp.z }, qRel = solve(rel.x, rel.y, rel.z, yaw, 0);
      const d0 = durFor(arcPath(rel, above, yaw, 0, qRel.j4), PHASES[0].dur);
      const d4 = durFor(arcPath(above, { x: dd.place, y: a.carryY, z: dd.z }, yaw, 0), PHASES[4].dur);
      const d3 = Math.max(PHASES[3].dur, (qGrab.d3 + qGrab.fl) * (4 / 3) / AXIS.z);
      ct[prev + dest] = +(d0 + PHASES[1].dur + PHASES[2].dur + d3 + d4 + PHASES[5].dur + PHASES[6].dur).toFixed(3);
    }
    const mixed = +mixedCT(ct).toFixed(3);
    return { ct, mixed, hour: perHour(mixed), hourPeak: perHour(CT), pitch: Math.ceil(mixed * BELT_V) };
  })();
  const ctGaps = jobs.slice(1).map((j, i) => +(j.tau0 - jobs[i].tau0).toFixed(4));
  const burst = ctGaps.filter(g => Math.abs(g - CT) < .02).length;
  // 分流帶在架台的上、下游兩側：量兩端滾筒（半徑 42）到架台柱面的 X 向間隙
  const divGap = Math.min(a.x - pw / 2 - (L.divA.x[1] + 42), L.divB.x[0] - 42 - (a.x + pw / 2));
  const toolR = T.cupSpan / 2 + 20;                                                // 工具在水平面上的外伸半徑

  // ---- 固定設備在機台框架平面（1800 × 1460 × 1800）內
  // 裝在機台本體上的固定設備整座都要收在框架平面裡，否則整機尺寸就不是拍板的 1800 × 1460（frame-width）。
  // 取像門型架原本就是因為沒有這條檢核，立柱與腳座才會站到骨架外面、把整機寬度撐到 1635。
  // 不列入的是刻意在機台之外的東西：主輸送帶、入料導料板與編碼器（由 ±X 兩端穿出）、收料箱、電控箱，
  // 以及裝在框架頂面之上的三色警示燈（frame 的 tower 子群組）。
  const BOUND = { X: f.x, Y: [0, f.top], Z: f.z };
  const frameBody = new THREE.Box3();                                              // 骨架與護板，不含警示燈
  // 外露配線延伸至外置電盤；本項只量機台本體，配線另由動態取樣完整檢查。
  // 光幕展示標牌依提案置於骨架外側，不計入設備佔地；仍保留場景干涉檢查。
  for (const c of frame.children) if (c !== tower && c !== elec.curtainPlate && !c.userData.routingHardware) frameBody.expandByObject(c);
  const visionBox = new THREE.Box3().setFromObject(vision);
  const FIXED = [['取像架台', visionBox], ['HMI', new THREE.Box3().setFromObject(hmi)], ['骨架與護板', frameBody]];
  const fixedOut = FIXED.flatMap(([name, bb]) => bb.isEmpty() ? [`${name} 沒有零件`] : Object.entries(BOUND).flatMap(([k, [lo, hi]]) => {
    const key = k.toLowerCase(), min = bb.min[key], max = bb.max[key];
    return [min < lo - .5 ? `${name} ${k} ${min.toFixed(0)} < ${lo}` : '', max > hi + .5 ? `${name} ${k} ${max.toFixed(0)} > ${hi}` : ''];
  }).filter(Boolean));

  // ---- 前段的檢核量：ABB 逆解、工作範圍、吸嘴速度、抓取間隔，以及帶上工件的間隙
  const abbMetrics = (() => {
    const n = 6000, h = timing.tauTotal / n, out = { bad: 0, maxR: 0, maxTheta: 0, minTheta: 0, v: 0 };
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const { p } = abbAt(h * i), q = front.toPlatform(p.x, p.y, p.z), th = deltaIK(q, AB.delta);
      if (!th) { out.bad++; continue; }
      out.maxR = Math.max(out.maxR, Math.hypot(q[0], q[2]));
      out.maxTheta = Math.max(out.maxTheta, ...th.map(t => t / D2R)); out.minTheta = Math.min(out.minTheta, ...th.map(t => t / D2R));
      if (prev) out.v = Math.max(out.v, Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z) / h);
      prev = p;
    }
    out.gaps = abbJobs.slice(1).map((j, i) => +(j.grabTau - abbJobs[i].grabTau).toFixed(4));
    // 搬運中的工件越過主帶側牆時的淨空：橫移段每 1/40 取樣，工件底面對牆頂
    out.clear = Infinity;
    for (const seg of abbSegs) if (seg.key === 'traverse') for (let k = 0; k <= 40; k++) {
      const { p } = abbAt(seg.tau0 + seg.dur * k / 40), d = Math.abs(p.z - bz), r = seg.item.L / 2;      // 工件還有任何一部分在側牆（離中心 300…320）上方
      if (d + r > bw / 2 && d - r < bw / 2 + 20) out.clear = Math.min(out.clear, p.y - 1.5 - seg.item.H - (b.top + L.site.wall));
    }
    // 帶上工件的間隙：通道的三種寬度（600、400、280）各取一處；ABB 的目標不會流到 280 那一段
    out.itemGap = Math.min(...LANE_X.flatMap((x, k) => {
      const list = items.filter(it => k < 2 || !it.front).map(it => ({ ...it, x: it.off, z: zOf(it, x) }));
      return list.flatMap((p, i) => list.slice(i + 1).map(q => footprintGap(p, q)));
    }));
    return out;
  })();
  const passedOk = passed.every(it => it.job || missed.some(m => m.item === it));

  const layoutChecks = () => [
    { group: '前段', name: `前段雙眼重疊視野涵蓋導料後的料流 ${L.frontGuide.close} mm`, ok: front.cameras[0].fieldOfView(F.wd)[0] - F.baseline >= L.frontGuide.close, value: `${Math.round(front.cameras[0].fieldOfView(F.wd)[0] - F.baseline)} / ${L.frontGuide.close} mm`, note: `與後段同規格：WD ${F.wd}、單眼視野 ${front.cameras[0].fieldOfView(F.wd).map(Math.round).join(' × ')} mm` },
    { group: '前段', name: '刮料簾限高：單層過、疊料擋', ok: L.curtain.clear - maxBeltH >= 10 && L.curtain.clear < 2 * Math.min(...items.filter(it => it.cls !== 'other').map(it => it.H)), value: `${L.curtain.clear} mm（${maxBeltH}…${2 * Math.min(...items.filter(it => it.cls !== 'other').map(it => it.H))}）`, note: '簾底高度要高於最高的單層工件、低於最矮的兩件 HDPE 疊起來的高度' },
    { group: '前段', name: '前段取像到 ABB 抓取的飛行時間 > 視覺鏈路 0.29 s', ok: (AB.x - AB.window - F.x) / BELT_V > .29, value: `${((AB.x - F.x) / BELT_V).toFixed(2)} s` },
    { group: '前段', name: 'ABB 逆解全程有效、主動臂 −45°…+85° 內', ok: !abbMetrics.bad && abbMetrics.maxTheta <= 85 && abbMetrics.minTheta >= -45, value: `${abbMetrics.minTheta.toFixed(0)}°…${abbMetrics.maxTheta.toFixed(0)}°` },
    { group: '前段', name: `ABB 動平台在工作直徑 ${2 * AB.reach} 內`, ok: abbMetrics.maxR <= AB.reach, value: `最遠 ${abbMetrics.maxR.toFixed(0)} / ${AB.reach} mm` },
    { group: '前段', name: 'ABB 吸嘴峰值速度 ≤ 6 m/s（示意）', ok: abbMetrics.v <= 6000, value: `${(abbMetrics.v / 1000).toFixed(1)} m/s` },
    { group: '前段', name: `ABB 抓取間隔不小於單趟 ${ABB_CT.toFixed(2)} s`, ok: Math.min(...abbMetrics.gaps) >= ABB_CT - 1e-6, value: `最短 ${Math.min(...abbMetrics.gaps).toFixed(2)} s · ${abbJobs.length} 趟` },
    { group: '前段', name: 'ABB 搬運工件越過側牆淨空 ≥30 mm', ok: abbMetrics.clear >= 30, value: `${abbMetrics.clear.toFixed(0)} mm` },
    { group: '前段', name: '帶上工件互不重疊（三種通道寬度，間隙 ≥10 mm）', ok: abbMetrics.itemGap >= 10, value: `最小 ${abbMetrics.itemGap.toFixed(0)} mm` },
    { group: '前段', name: 'ABB 放行的目標都由後段接手', ok: passedOk && passed.length === jobs.length + missed.length, value: `放行 ${passed.length} 件 → 補抓 ${jobs.length}、漏抓 ${missed.length}` },
    { group: '可達性', name: '抓放全程在動作半徑內', ok: metrics.maxR <= a.reach - 20, value: `最遠 ${metrics.maxR.toFixed(0)} / ${a.reach - 20} mm` },
    { group: '可達性', name: '不進入最小迴轉半徑', ok: metrics.minR >= 60, value: `最近 ${metrics.minR.toFixed(0)} mm` },
    { group: '可達性', name: `J2 避開基座干涉區（≤${a.j2max}°）`, ok: metrics.maxJ2 <= a.j2max, value: `${metrics.maxJ2.toFixed(0)}°` },
    { group: '可達性', name: 'J4 在 ±360° 內', ok: metrics.maxJ4 <= 355, value: `${metrics.maxJ4.toFixed(0)}°` },
    { group: '可達性', name: '逆解全程有效', ok: !bad.length, value: bad.length ? bad[0] : `${jobs.length} 趟` },
    { group: '淨空', name: '搬運工件對帶上最高物件 ≥100 mm', ok: metrics.clear >= 100, value: `${metrics.clear.toFixed(0)} mm` },
    { group: '淨空', name: '手臂最高點在框架橫樑下', ok: a.baseY + 671 <= f.top - 65, value: `${a.baseY + 671} / ${f.top - 65} mm` },
    { group: '淨空', name: '分流帶對手臂架台間隙 ≥50 mm', ok: divGap >= 50, value: `${divGap.toFixed(0)} mm` },
    { group: '淨空', name: '工具掃掠在機台框架平面內', ok: metrics.maxZ + toolR <= f.z[1] && metrics.minX - toolR >= f.x[0] && metrics.maxX + toolR <= f.x[1], value: `Z ≤${(metrics.maxZ + toolR).toFixed(0)} / ${f.z[1]}、X ${(metrics.minX - toolR).toFixed(0)}…${(metrics.maxX + toolR).toFixed(0)}` },
    { group: '淨空', name: `固定設備在框架平面 ${f.x[1] - f.x[0]} × ${f.z[1] - f.z[0]} × ${f.top} 內`, ok: !fixedOut.length, value: fixedOut.length ? fixedOut.join('、') : `取像架台 X ${visionBox.min.x.toFixed(0)}…${visionBox.max.x.toFixed(0)}、Z ${visionBox.min.z.toFixed(0)}…${visionBox.max.z.toFixed(0)}` },
    { group: '取像', name: '相機視野涵蓋帶寬 600 mm', ok: v.requiredFov[0] >= bw && cameras.every(cam => cam.fieldOfView(v.wd).every((size, i) => size >= v.requiredFov[i])), value: `${v.requiredFov[0]} / ${bw} mm`, note: `第一段檢測範圍 ${v.requiredFov.join(' × ')} mm；第二段完整視野 ${cameras[0].fieldOfView(v.wd).map(Math.round).join(' × ')} mm（示意）` },
    { group: '取像', name: '取像架台在手臂動作半徑外', ok: visionBox.max.x < a.x - a.reach, value: `X ${visionBox.max.x.toFixed(0)} < ${a.x - a.reach}` },
    { group: '取像', name: '取像到抓取的飛行時間 > 視覺鏈路 0.29 s', ok: VISION_TO_PICK / BELT_V > .29, value: `${(VISION_TO_PICK / BELT_V).toFixed(2)} s` },
    { group: '節拍', name: '連續運轉段節拍 1.40 s（≥6 連抓）', ok: burst >= 5, value: `${burst + 1} 連抓 × ${CT.toFixed(2)} s` },
    { group: '節拍', name: '最短取放間隔不小於 CT', ok: Math.min(...ctGaps) >= CT - 1e-3, value: `${Math.min(...ctGaps).toFixed(2)} s` },
    { group: '節拍', name: '跨帶（B）單趟節拍 ≤2.0 s', ok: Math.max(...metrics.ctB) <= 2, value: `${Math.max(...metrics.ctB).toFixed(2)} s` },
    { group: '節拍', name: '同類連抓節拍＝規格 1.40 s', ok: Math.abs(throughput.ct.AA - CT) <= .01, value: `AA ${throughput.ct.AA.toFixed(2)} s` },
    { group: '節拍', name: '混合料流加權節拍 ≤1.8 s（示意）', ok: throughput.mixed <= 1.8, value: `${throughput.mixed.toFixed(2)} s · 約 ${throughput.hour} 瓶/小時` },
    // 軸速上限為 DENSO HSR 型錄等級的假設值（示意）：模型 meta 的 speed 註明是型錄 50%，這裡以型錄級核算
    { group: '軸速（示意）', name: `J1 峰值 ≤${AXIS.j1}°/s`, ok: metrics.vj1 <= AXIS.j1 * 1.02, value: `${metrics.vj1.toFixed(0)}°/s` },
    { group: '軸速（示意）', name: `J2 峰值 ≤${AXIS.j2}°/s`, ok: metrics.vj2 <= AXIS.j2 * 1.02, value: `${metrics.vj2.toFixed(0)}°/s` },
    { group: '軸速（示意）', name: `J4 峰值 ≤${AXIS.j4}°/s`, ok: metrics.vj4 <= AXIS.j4 * 1.02, value: `${metrics.vj4.toFixed(0)}°/s` },
    { group: '軸速（示意）', name: `Z 軸峰值 ≤${AXIS.z} mm/s`, ok: metrics.vd3 <= AXIS.z * 1.02, value: `${metrics.vd3.toFixed(0)} mm/s` },
  ];

  return {
    electrical: elec, visionCamera: cameras[0], visionCameras: cameras, marks, lightPatch,
    total: TOTAL, apply, layoutChecks, timing, jobs, missed, items, itemById, arm, segs, metrics, ctGaps, bad, throughput, physics,
    front, frontCameras: front.cameras, abbJobs, passed, abbSegs, abbAt, abbMetrics,
    stationStart: STATIONS.map((_, k) => (CHAPTERS.find(c => c.station === k) ?? CHAPTERS[0]).t[0]),
    get state() { return last; },
    /** 焦點追隨的目標：正在處理的工件，否則是下一個目標 */
    focusItem() {
      const τ = last?.tau ?? 0;
      if (last?.chapter.front) {                                                   // 前段的段落：看 ABB 正在處理或下一個到抓取線的目標
        if (last.chapter.id === 'handoff') { const it = [...passed].reverse().find(i => i.pass.enter <= τ); if (it) return it; }
        if (last.abb.job) return last.abb.job.item;
        return frontTargets.find(it => (it.abbJob ? it.abbJob.grabTau : it.pass.leave) > τ) || null;
      }
      if (last?.job) return itemById.get(last.job.item.id);
      const next = jobs.find(j => j.endTau > τ);
      return next ? itemById.get(next.item.id) : items.find(it => it.grp.visible) || null;
    },
    verify: {
      dt: .6,
      cables: { interval: .3, obstacles: () => {
        const meshes = [...arm.armParts, ...windowFrame];
        for (const it of items) it.grp.traverse(m => { if (m.isMesh) meshes.push(m); });   // 搬運中的工件也不能掃到線材
        tool.traverse(m => { if (m.isMesh && !m.userData.routingHardware) meshes.push(m); });
        return meshes;
      } },
      skip: o => o === marks || o.parent === marks,
      allow: [
        { why: '工件被吸盤吸附時與吸盤面接觸', test: (x, y, ctx) => [x, y].some(m => m.name === 'suction cup') && [x, y].some(m => ctx.moduleOf(m) === 'items') },
        // 只放行承載面與箱體；同在皮帶群組裡的導料板、刮料簾與入料罩不是承載面，工件撞到要抓出來
        { why: '工件由輸送帶、分流帶、既有分類帶或收料箱承載', test: (x, y, ctx) => [x, y].some(m => ctx.moduleOf(m) === 'items') && [x, y].some(m => ['mainBelt', 'divA', 'divB', 'bins', 'abbSort'].includes(ctx.moduleOf(m)) && !/guide plate|curtain strip|hood|drive motor/.test(m.name)) },
        { why: '手臂上的氣管兩端接在真空產生器的接頭與網籠頂的固定管上', test: (x, y) => [x, y].some(m => m.name === 'air tube') && [x, y].some(m => m.name === 'hose port' || m.name === 'hose anchor') },
      ],
      envelope: ['robot', 'abbRobot'],
    },
  };
}
