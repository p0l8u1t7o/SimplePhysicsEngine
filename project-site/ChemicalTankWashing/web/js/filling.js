// 清洗區出口到填裝區、暫存區的設備（世界座標）：
// 北段輸送、頂面貼標站（旋蓋面 3 張）、貼後讀碼、北側轉角往西的分線輸送（穿過共用牆）、三碼比對站、NG 剔除道、
// 4 條填裝線（區段式輸送、填裝架、每位一支灌裝槍、移動式鎖蓋扭力頭、放行確認鈕、擦拭人員）、集貨輸送、
// 暫存區組板龍門與棧板、料倉與供液配管。
import * as THREE from 'three';
import { CONV, OUTFEED, FILL, STAGING, DRUM, PALLET } from './layout.js';
import { block, cylinder, pipe, plate } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { foot, motor, sensor } from '@core/geom/hardware.js';
import { create as conveyor } from '@core/models/conveyor.js';
import { codeReader } from '@core/models/vision.js';
import { nutrunner } from '@core/models/motion.js';
import { signalTower } from '@core/models/indicators.js';
import { pallet } from '@core/models/transport-handling.js';
import { createDrum, drumJaws, addTopLabels } from './drum.js';

const TOP = CONV.top, HALF = CONV.width / 2;
// 2" 桶塞在世界 +Z（桶方位 270°），3/4" 在 −Z
export const BUNG_DZ = { big: DRUM.bungR, small: -DRUM.bungR };
export const DRUM_YAW = 270;
// 填裝頭：橫樑在填裝位北側（不擋灌裝槍與鎖蓋頭），台車沿 X 換位 shift；灌裝槍下端高度 lanceUp（收回）、lanceDown（插入）；
// 鎖蓋頭套筒下端 capUp（收回）、capDown（套住桶蓋）
const CAP_TOP = TOP + DRUM.H / 2 + DRUM.H / 2 - 12.5 + 8;   // 螺塞座頂面
export const HEAD = { beamY: 2300, beamDz: -420, shift: 450, lanceUp: 1675, lanceDown: 635, capUp: 1700, capDown: CAP_TOP - 10 };

// 作業員（安全帽、工作服）；arms 群組可擺動（擦拭）
export function person(parent, color = 0x2f6fb5) {
  const g = new THREE.Group(); parent.add(g);
  const suit = new THREE.MeshStandardMaterial({ color, roughness: .8 });
  for (const s of [-1, 1]) block(g, [140, 820, 160], [0, 410, s * 110], suit);
  cylinder(g, 190, 640, [0, 1150, 0], suit, 'y', 14);
  cylinder(g, 110, 220, [0, 1580, 0], new THREE.MeshStandardMaterial({ color: 0xe0b48f, roughness: .7 }), 'y', 14);
  cylinder(g, 125, 90, [0, 1700, 0], MAT.yellow, 'y', 16);
  const arms = [];
  for (const s of [-1, 1]) { const a = new THREE.Group(); a.position.set(0, 1400, s * 230); g.add(a); const m = block(a, [110, 560, 110], [0, -280, 0], suit); m.name = 'arm'; a.rotation.z = .15; arms.push(a); }
  return { root: g, arms };
}

// 直線輸送段：axis 'x' 或 'z'，span 為沿輸送方向的範圍，at 為另一軸的中心
function belt(group, axis, span, at, { legsPitch = 1500 } = {}) {
  const c = conveyor({
    axis, span, width: CONV.width, height: TOP, roller: 30,
    rollers: { from: span[0] + 60, to: span[1], pitch: 120 },
    brackets: { size: [26, 68, 70], offset: HALF + 7, y: TOP - 36 }, frame: { offset: HALF + 30, y: TOP - 70 },
    legs: { positions: { from: span[0] + 300, to: span[1], pitch: legsPitch }, size: [60, TOP - 140, 60], foot: false },
  });
  if (axis === 'x') c.root.position.z = at; else c.root.position.x = at;
  group.add(c.root); return c;
}

export function createFilling(scene) {
  const root = new THREE.Group(); root.name = 'filling'; scene.add(root);
  const people = new THREE.Group(); people.name = 'people'; scene.add(people);   // 人員獨立一組：全場檢查會檢查人員對所有設備
  const sub = name => { const g = new THREE.Group(); g.name = name; g.userData.station = name; root.add(g); return g; };

  // ---------------------------------------------------------------- 北段輸送（立放輸送尾端 → 北側轉角）
  const out = sub('outfeed'), dz = FILL.distZ;
  const JOIN = HALF + 70;   // 相交的兩條輸送線：支線從主線側樑外開始
  belt(out, 'z', [dz + JOIN, OUTFEED.z0 - 5], OUTFEED.x);
  for (const s of [-1, 1]) block(out, [30, 120, OUTFEED.z0 - dz - 1200], [OUTFEED.x + s * 340, TOP + 160, (OUTFEED.z0 + dz) / 2 + 300], MAT.yellow);
  motor(out, OUTFEED.x + 520, 220, OUTFEED.z0 - 600, .7, Math.PI / 2);

  // ---- 頂面貼標站（旋蓋面 3 張）：門型架＋印字引擎＋XY 移動的貼標頭 ----
  const tl = sub('topLabel'), lx = OUTFEED.x, lz = OUTFEED.topLabel;
  for (const [x, z] of [[lx - 700, lz - 350], [lx + 700, lz - 350], [lx - 700, lz + 350], [lx + 700, lz + 350]]) { block(tl, [80, 2200, 80], [x, 1100, z], MAT.steelBlue); foot(tl, x, z, 140); }
  for (const z of [lz - 350, lz + 350]) block(tl, [1480, 100, 80], [lx, 2150, z], MAT.steelBlue);
  const tlCar = new THREE.Group(); tlCar.position.z = lz; tl.add(tlCar);          // 沿 X 的橫樑台車
  block(tlCar, [160, 80, 800], [0, 2060, 0], MAT.alu);
  const tlHead = new THREE.Group(); tlCar.add(tlHead);     // 貼標頭（沿 Z 移動、上下壓貼）
  block(tlHead, [120, 600, 120], [0, 300, 0], MAT.alu);
  const pad = block(tlHead, [180, 30, 140], [0, -20, 0], MAT.pu);
  const padLabel = block(tlHead, [150, 4, 100], [0, -37, 0], new THREE.MeshStandardMaterial({ color: 0xfbfbf7, roughness: .7 })); padLabel.visible = false;
  block(tl, [500, 700, 420], [lx - 1150, 1350, lz], MAT.cabinet);   // 印字引擎（熱轉印），在輸送線西側
  block(tl, [60, 1000, 60], [lx - 1150, 500, lz], MAT.steelDark);
  plate(tl, ['頂面貼標（3 張）'], 800, 130, [lx, 2350, lz + 400], 0, { w: 640, h: 110 });
  const topReader = codeReader.create({ axis: '-y', w: 70, h: 60, length: 80, beam: false, fan: { halfWidth: 160, far: 520 } });
  topReader.root.position.set(lx, 2000, OUTFEED.topRead); tl.add(topReader.root);
  block(tl, [60, 2000, 60], [lx + 520, 1000, OUTFEED.topRead], MAT.alu); block(tl, [560, 50, 50], [lx + 260, 2060, OUTFEED.topRead], MAT.alu);
  plate(tl, ['貼後讀碼（頂 2 碼）'], 700, 120, [lx + 520, 2150, OUTFEED.topRead + 40], 0, { w: 640, h: 110 });

  // ---------------------------------------------------------------- 分線輸送（北側轉角 → 往西，穿過共用牆 → 4 線）
  const dist = sub('dist');
  belt(dist, 'x', [FILL.distX0, OUTFEED.x + HALF], dz, { legsPitch: 1400 });
  // 直角移載（轉角、各線分岐、NG 分岐）：滾筒間的皮帶升降移載，畫成黃色區塊
  const transfers = [OUTFEED.x, ...FILL.lines, FILL.ng.x];
  for (const x of transfers) block(dist, [CONV.width - 40, 14, CONV.width - 40], [x, TOP - 22, dz], MAT.yellow);
  // 三碼比對站：頂部 2 支讀碼器（兩張頂標）＋南側 1 支（側標朝南）
  const rd = sub('reader'), rx = FILL.reader;
  for (const [x, z] of [[rx - 450, dz - 600], [rx + 450, dz - 600], [rx - 450, dz + 600], [rx + 450, dz + 600]]) block(rd, [70, 1800, 70], [x, 900, z], MAT.alu);
  for (const z of [dz - 600, dz + 600]) block(rd, [970, 70, 70], [rx, 1765, z], MAT.alu);
  block(rd, [70, 70, 1270], [rx, 1765, dz], MAT.alu);
  const readers = [];
  for (const dzz of [-165, 165]) { const r = codeReader.create({ axis: '-y', beam: false, fan: { halfWidth: 120, far: 300 } }); r.root.position.set(rx, 1700, dz + dzz); rd.add(r.root); readers.push(r); }
  { const r = codeReader.create({ axis: '-z', beam: false, fan: { halfWidth: 120, far: 380 } }); r.root.position.set(rx, TOP + DRUM.H / 2 + 20, dz + 560); rd.add(r.root); readers.push(r); block(rd, [40, TOP + DRUM.H / 2, 40], [rx, (TOP + DRUM.H / 2) / 2, dz + 600], MAT.alu); }
  plate(rd, ['三碼比對＋分線'], 900, 140, [rx, 1950, dz - 640], Math.PI, { w: 640, h: 110 });
  // NG 剔除口：比對站下游往北推入，存 1 桶（人工取出重貼）
  const ng = sub('ng');
  belt(ng, 'z', [FILL.ng.z0, dz - JOIN], FILL.ng.x, { legsPitch: 600 });
  block(ng, [700, 120, 40], [FILL.ng.x, TOP + 160, FILL.ng.z0 + 20], MAT.red);
  plate(ng, ['NG 暫存 · 人工重貼'], 900, 140, [FILL.ng.x, 1500, FILL.ng.z0 - 10], Math.PI, { w: 640, h: 110 });

  // ---------------------------------------------------------------- 4 條填裝線
  const lines = FILL.lines.map((x, i) => {
    const g = sub('line' + (i + 1));
    belt(g, 'z', [dz + JOIN, FILL.collectZ - JOIN], x, { legsPitch: 1450 });
    // 區段式輸送：每個填裝位一段獨立驅動，畫出分段擋塊
    for (const z of FILL.pos) block(g, [120, 60, 40], [x - 300, TOP + 40, z - DRUM.R - 20], MAT.steelOrange);
    // 填裝架：兩側立柱＋縱樑；每個填裝位一支橫樑，掛一組填裝頭（灌裝槍＋2"／3/4" 鎖蓋頭，沿 X 換位）
    const fh = FILL.frameHalf, [f0, f1] = FILL.frame, fy = FILL.frameY;
    for (const z of [f0, (f0 + f1) / 2, f1]) for (const s of [-1, 1]) { block(g, [100, fy, 100], [x + s * fh, fy / 2, z], MAT.steelBlue); foot(g, x + s * fh, z, 160); }
    for (const s of [-1, 1]) block(g, [100, 140, f1 - f0 + 100], [x + s * fh, fy + 70, (f0 + f1) / 2], MAT.steelBlue);
    const heads = FILL.pos.map(z => {
      const bz = z + HEAD.beamDz;
      block(g, [2 * fh + 100, 80, 100], [x, HEAD.beamY, bz], MAT.steelDark);   // 換位橫樑
      for (const s of [-1, 1]) block(g, [100, fy - HEAD.beamY - 40, 100], [x + s * fh, (fy + HEAD.beamY + 40) / 2, bz], MAT.steelDark);   // 吊架
      const head = new THREE.Group(); head.position.set(x, 0, z); g.add(head);
      block(head, [HEAD.shift + 300, 60, 900], [HEAD.shift / 2, HEAD.beamY - 70, -120], MAT.alu);   // 換位台車（在橫樑下方滑行）
      cylinder(head, 45, 380, [0, HEAD.beamY - 290, BUNG_DZ.big], MAT.alu, 'y', 20);                 // 灌裝槍升降氣缸
      const lance = new THREE.Group(); lance.position.set(0, HEAD.lanceUp, BUNG_DZ.big); head.add(lance);
      cylinder(lance, 14, 900, [0, 450, 0], MAT.steel, 'y', 12);                  // 灌裝管（原點在管下端）
      cylinder(lance, 34, 40, [0, 120, 0], MAT.black, 'y', 18);                    // 密封錐
      const capZ = new THREE.Group(); capZ.position.set(HEAD.shift, HEAD.capUp, 0); head.add(capZ);   // 鎖蓋頭 Z 軸（原點在套筒下端）
      block(capZ, [100, 700, 100], [0, 520, 0], MAT.alu);
      const spindles = [];
      for (const [dzz, r] of [[BUNG_DZ.big, DRUM.big.r + 8], [BUNG_DZ.small, DRUM.small.r + 8]]) {
        const n = nutrunner.create({ socketR: r }); n.root.position.set(0, 0, dzz); capZ.add(n.root);
        block(capZ, [60, 40, Math.abs(dzz)], [0, 250, dzz / 2], MAT.steelDark);
        spindles.push(n);
      }
      return { head, lance, capZ, spindles };
    });
    // 放行確認鈕（每位一個，裝在走道側）＋三色燈
    const buttons = FILL.pos.map(z => {
      const bx = x + fh + 120, bz = z + FILL.buttonDz;
      block(g, [60, 1050, 60], [bx, 525, bz], MAT.steelDark);
      block(g, [90, 120, 120], [bx, 1100, bz], MAT.cabinet);
      return cylinder(g, 28, 30, [bx + 55, 1100, bz], MAT.cap, 'x', 20);
    });
    const tower = signalTower.create({ radius: 40, height: 80, segments: 24, base: 10, pitch: 85, on: 1.2, off: .05, lamps: [{ key: 'fault', material: 'red' }, { key: 'wait', material: 'amber' }, { key: 'run', material: 'green' }], pole: { r: 22, h: 600, y: -320, segments: 12, material: MAT.steel } });
    tower.root.position.set(x - fh, fy + 700, f0); g.add(tower.root);
    plate(g, [`L${i + 1} · 液體 ${FILL.liquids[i]}`], 900, 150, [x, fy + 420, f0 - 60], Math.PI, { w: 640, h: 110 });
    for (const z of FILL.pos) sensor(g, x + 340, TOP + 90, z - 380, Math.PI / 2);
    // 擦拭人員（每線 1 人，在東側走道巡迴）
    const w = person(people, 0x2f6fb5); w.root.position.set(FILL.wipers[i], 0, FILL.pos[2]); w.root.rotation.y = Math.PI; w.root.name = `wiper L${i + 1}`;
    return { x, heads, buttons, tower, wiper: w };
  });

  // ---------------------------------------------------------------- 集貨輸送（各線南端 → 往西 → 暫存區龍門取料點）
  const col = sub('collect'), cz = FILL.collectZ, [pickX] = STAGING.pick;
  belt(col, 'x', [pickX - HALF, FILL.lines.at(-1) + HALF], cz, { legsPitch: 1400 });
  for (const x of FILL.lines) block(col, [CONV.width - 40, 14, CONV.width - 40], [x, TOP - 22, cz], MAT.yellow);
  block(col, [700, 40, 40], [pickX, TOP + 40, cz - HALF + 20], MAT.steelOrange);   // 取料位擋塊（西端）
  block(col, [40, 40, 700], [pickX - HALF + 20, TOP + 40, cz], MAT.steelOrange);
  plate(col, ['集貨輸送 → 暫存區'], 900, 140, [4300, 1100, cz + HALF + 30], 0, { w: 640, h: 110 });

  // ---------------------------------------------------------------- 暫存區組板龍門（夾桶上棧板）
  const st = sub('staging'), G = STAGING.gantry;
  const posts = [[G.x0, G.z0], [G.x1, G.z0], [G.x0, G.z1], [G.x1, G.z1]];
  for (const [x, z] of posts) { block(st, [200, G.beamY + 100, 200], [x, (G.beamY + 100) / 2, z], MAT.steelBlue); foot(st, x, z, 280); }
  for (const z of [G.z0, G.z1]) block(st, [G.x1 - G.x0 + 200, 220, 200], [(G.x0 + G.x1) / 2, G.beamY + 210, z], MAT.steelBlue);
  const sBridge = new THREE.Group(); st.add(sBridge);
  for (const s of [-1, 1]) block(sBridge, [100, 200, G.z1 - G.z0 + 200], [s * 200, G.beamY + 460, (G.z0 + G.z1) / 2], MAT.steelOrange);
  const sTrolley = new THREE.Group(); sBridge.add(sTrolley);
  block(sTrolley, [560, 60, 360], [0, G.beamY + 590, 0], MAT.steelDark);
  for (const s of [-1, 1]) block(sTrolley, [30, 210, 300], [s * 130, G.beamY + 455, 0], MAT.steelDark);
  block(sTrolley, [420, 300, 360], [0, G.beamY + 200, 0], MAT.steelDark);
  block(sTrolley, [180, 1500, 180], [0, 2750, 0], MAT.alu);   // Z 軸外管（固定在台車）
  const sZ = new THREE.Group(); sTrolley.add(sZ); sZ.userData.nested = sTrolley;   // Z 軸內管（原點在桶中心高），套在外管內
  block(sZ, [130, 1500, 130], [0, 1250, 0], MAT.steel);
  block(sZ, [420, 60, 300], [0, DRUM.H / 2 + 120, 0], MAT.steelDark);
  for (const s of [-1, 1]) block(sZ, [60, 200, 60], [0, DRUM.H / 2 + 30, s * 120], MAT.steelDark);
  const sJaws = drumJaws(sZ, null, 90);
  plate(st, ['組板龍門 · 同液體同板'], 1100, 150, [(G.x0 + G.x1) / 2, G.beamY + 450, G.z0 - 110], Math.PI, { w: 640, h: 110 });
  // 組板位定位擋條與牌子
  for (const [k, x] of Object.entries(STAGING.pallets)) {
    for (const s of [-1, 1]) block(st, [40, 60, 300], [x + s * 640, 30, STAGING.z - 300], MAT.yellow);
    plate(st, [k === 'E' ? '空棧板' : `組板 ${k}`], 600, 130, [x, 300, STAGING.z - PALLET.W / 2 - 160], 0, { w: 512, h: 110 });
  }

  // ---------------------------------------------------------------- 料倉與供液配管（4 種液體，架空到各線填裝架）
  const tk = sub('fillTank'), [t0x, t0z, t1x, t1z] = FILL.tank;
  const tankColors = [MAT.tankFresh, MAT.tankClean, MAT.tankAlkali, MAT.tankWaste];
  for (let k = 0; k < 4; k++) {
    const cx = t0x + 360 + (k % 2) * 730, cz2 = t0z + 540 + Math.floor(k / 2) * 1100;
    block(tk, [640, 1000, 900], [cx, 600, cz2], MAT.tankW);              // IBC 桶（示意）
    block(tk, [700, 100, 960], [cx, 50, cz2], MAT.steelDark);
    block(tk, [600, 6, 860], [cx, 1104, cz2], tankColors[k]);
    plate(tk, [`液體 ${FILL.liquids[k]}`], 520, 120, [cx, 1300, cz2 + 470], 0, { w: 512, h: 110 });
  }
  plate(tk, ['料倉 · 4 種液體'], 1100, 160, [(t0x + t1x) / 2, 1700, t1z + 10], 0, { w: 640, h: 110 });
  FILL.lines.forEach((x, k) => {
    const sx = t0x + 360 + (k % 2) * 730, sz = t0z + 540 + Math.floor(k / 2) * 1100, y = FILL.pipeY + k * 80, z = FILL.pipeZ - 250 - k * 90;
    pipe(tk, [[sx, 1110, sz], [sx, y, sz], [sx, y, z], [x, y, z], [x, y, FILL.frame[0] + 160], [x, FILL.frameY + 160, FILL.frame[0] + 160]], 26, [0x8fd3ff, 0x58b6f2, 0xb07cff, 0xff7a45][k]);
  });

  // ---------------------------------------------------------------- 靜態桶：其他線生產中（L3、L4）、暫存區已在組板的成品桶（B、C、D）
  const statics = [];
  const staticDrum = (id, x, y, z) => {
    const d = createDrum(id); d.root.position.set(x, y, z); d.root.rotation.y = DRUM_YAW * Math.PI / 180; d.root.name = 'drum ' + id;
    d.setLabel(true, 0); addTopLabels(d).set(true); root.add(d.root); statics.push(d); return d;
  };
  const busy = [[2, 0], [2, 1], [3, 0]];
  for (const [li, pi] of busy) { const d = staticDrum(`CTW-2610-09${li}${pi}`, FILL.lines[li], TOP + DRUM.H / 2, FILL.pos[pi]); d.setCaps(false, false); d.setWater(120); }
  for (const k of ['B', 'C', 'D']) {
    const p = pallet.create({ size: PALLET.W, height: PALLET.H }); p.root.position.set(STAGING.pallets[k], 0, STAGING.z); root.add(p.root); p.root.userData.station = 'staging';
    for (let n = 0; n < STAGING.preload[k]; n++) staticDrum(`CTW-2610-08${k}${n}`, STAGING.pallets[k] + PALLET.slots[n][0], PALLET.H + DRUM.H / 2, STAGING.z + PALLET.slots[n][1]);
  }

  return {
    group: root, lines, readers, topReader, statics,
    setTopLabeler({ hx = 0, hz = 0, hy = 1, flash = false, label = false }) {
      tlCar.position.x = lx + hx; tlHead.position.set(0, hy * 400 + TOP + DRUM.H + 30, hz); padLabel.visible = label; pad.material = flash ? MAT.green : MAT.pu;
    },
    setReaders({ top = false, check = false }) { topReader.set(top); for (const r of readers) r.set(check); },
    // 每線：heads[k] = { e 灌裝槍插入量, sx 換位, cy 鎖蓋頭下降, spin 套筒轉數, btn 放行鈕 }
    setLine(i, heads) {
      const L = lines[i];
      heads.forEach((h, k) => {
        const H = L.heads[k];
        H.head.position.x = L.x - h.sx * HEAD.shift;
        H.lance.position.y = HEAD.lanceUp + (HEAD.lanceDown - HEAD.lanceUp) * h.e;
        H.capZ.position.y = HEAD.capUp + (HEAD.capDown - HEAD.capUp) * h.cy;
        for (const n of H.spindles) n.set({ turns: h.spin });
        L.buttons[k].material = h.btn ? MAT.green : MAT.cap;
      });
      L.tower.set(heads.some(h => h.e > .5) ? 'run' : 'wait');
    },
    setWiper(i, { x, z, face = Math.PI, wipe = 0 }) {
      const w = lines[i].wiper; w.root.position.set(x, 0, z); w.root.rotation.y = face;
      w.arms.forEach((a, k) => { a.rotation.z = wipe > 0 && wipe < 1 ? .9 + .45 * Math.sin(wipe * Math.PI * 2 * 20 + k) : .15; });   // 走動時手臂下垂，擦拭時往前擺動
    },
    setStaging({ x, z, y, jaw, rot = 45 }) { sBridge.position.x = x; sTrolley.position.z = z; sZ.position.y = y; sZ.rotation.y = rot * Math.PI / 180; sJaws.set(jaw); },
  };
}
