// 拆框機（使用者已購入的現場設備，userData.noBom）：依影片目測重建，尺寸見 layout.js 的 MACHINE（假設值）。
// 動作（set 的狀態，0～1）：
//   press 中央壓板下壓、clamp 四邊擺動壓指扣住鋁框上緣、pull 夾爪連同鋁框往外拉、open 承板再退開讓鋁框落下、
//   scrape 剝線盒刮刀由南往北推。
// 局部座標原點在機台中心地面；板放在機台上時，板原點（玻璃面中心）在 (0, GLASS_Y, 0)，長邊沿 X。
import * as THREE from 'three';
import { block, cylinder, tube, pipe, plate } from '@core/geom/shapes.js';
import { pivotCylinder, linearAxis } from '@core/models/motion.js';
import { lightCurtain } from '@core/models/sensors.js';
import { MAT } from '@core/geom/materials.js';
import { bolts } from '@core/geom/hardware.js';
import { MACHINE as M, PANEL, GLASS_Y } from './layout.js';

const cream = new THREE.MeshStandardMaterial({ color: 0xe6dcc3, roughness: .7, metalness: .1 });     // 鋼構（米白烤漆）
const yellow = new THREE.MeshStandardMaterial({ color: 0xf0b416, roughness: .5, metalness: .15 });   // 夾爪、壓板（黃色）
const blue = new THREE.MeshStandardMaterial({ color: 0x1f5fb8, roughness: .45, metalness: .2 });     // 液壓站、料箱
const rubber = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: .9 });

export const TROUGH = { y: 350, h: 150, w: 160 };        // 鋁框收集槽：底面高、深、寬
export const CRATE = { x: -600, z: -330, size: [400, 300, 300], y: 260 };   // 接線盒料箱（底面高 y）
const BLADE_Y = GLASS_Y - PANEL.lam - 11;                 // 刮刀中心高度（與接線盒同高）
const SHELF_IN = { x: PANEL.L / 2 - 30, z: PANEL.W / 2 - 30 };   // 承板內緣（伸入鋁框下方 30 mm）

export function createDismantler(scene) {
  const root = new THREE.Group(); root.name = 'dismantler'; root.position.set(M.x, 0, M.z);
  root.userData.noBom = '使用者已購入的拆框機（現場既有設備）';
  scene.add(root);
  const hx = M.L / 2 - M.post / 2, hz = M.W / 2 - M.post / 2, p = M.post, top = M.top;

  // ---------------------------------------------------------------- 籠架
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(root, [p, top - p, p], [sx * hx, p + (top - p) / 2, sz * hz], cream);   // 四角立柱
  for (const sz of [-1, 1]) {
    block(root, [M.L, p, p], [0, p / 2, sz * hz], cream);                       // 底座長樑
    block(root, [M.L, p, p], [0, top - p / 2, sz * hz], cream);                 // 頂部長樑（南面＝入料側開口上緣）
    block(root, [M.L - 2 * p, 100, p], [0, 830, sz * hz], cream);               // 檯面側樑（夾爪油壓缸的座）
  }
  for (const sx of [-1, 1]) {
    block(root, [p, p, M.W - 2 * p], [sx * hx, p / 2, 0], cream);               // 底座短樑
    block(root, [p, p, M.W - 2 * p], [sx * hx, top - p / 2, 0], cream);         // 頂部短樑
    block(root, [p, 100, M.W - 2 * p], [sx * hx, 830, 0], cream);               // 檯面端樑
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bolts(root, [[sx * hx, 8, sz * hz]], 14);
  // 中央橫樑（壓板油壓缸）
  block(root, [160, 120, M.W - 2 * p], [0, top - 60, 0], cream);
  cylinder(root, 85, 300, [0, top - 120 - 150, 0], MAT.steelDark, 'y', 28);     // 壓板油壓缸缸體（掛在橫樑下）
  const PRESS_TOP = top - 420;                                                   // 缸體下緣（活塞桿出口）
  // 層壓板支撐軌（兩支，避開接線盒與刮刀行程）
  const railTop = GLASS_Y - PANEL.lam, railX = [-450, 750];
  for (const z of [-250, 250]) {
    block(root, [railX[1] - railX[0], 50, 100], [(railX[0] + railX[1]) / 2, railTop - 25, z], yellow).name = 'support rail';
    for (const x of [-300, 150, 650]) block(root, [60, railTop - 50 - p, 60], [x, p + (railTop - 50 - p) / 2, z], cream);
  }
  for (const x of [-300, 150, 650]) block(root, [60, p, M.W - 2 * p], [x, p / 2, 0], cream);   // 支撐軌腳的地樑

  // ---------------------------------------------------------------- 四邊夾爪：承板＋滑座（隨 pull、open 外移）＋擺動壓指（clamp）
  // n：外法向；along：沿邊方向；len：長度；inner：承板內緣到中心的距離
  const SIDES = [
    { n: [0, 0, 1], len: 1500, inner: SHELF_IN.z }, { n: [0, 0, -1], len: 1500, inner: SHELF_IN.z },
    { n: [1, 0, 0], len: 840, inner: SHELF_IN.x }, { n: [-1, 0, 0], len: 840, inner: SHELF_IN.x },
  ];
  const jaws = SIDES.map((s, i) => {
    const g = new THREE.Group(); g.name = `jaw ${i}`; root.add(g);
    const alongX = s.n[0] === 0, sgn = s.n[0] + s.n[2];
    const at = (a, y, d) => alongX ? [a, y, sgn * d] : [sgn * d, y, a];          // 沿邊、高、離中心距離 → 局部座標
    const size = (a, h, d) => alongX ? [a, h, d] : [d, h, a];
    block(g, size(s.len, 30, 100), at(0, M.tableY - 15, s.inner + 50), yellow).name = 'jaw shelf';
    block(g, size(s.len, 60, 74), at(0, M.tableY - 30, s.inner + 137), yellow).name = 'jaw carriage';
    // 擺動壓指：樞軸在承板外緣上方，clamp＝1 時壓指朝內蓋住鋁框上緣，0 時翻到外側
    const pivot = new THREE.Group(); pivot.position.set(...at(0, GLASS_Y + PANEL.lip + 10, s.inner + 120)); g.add(pivot);
    const finger = block(pivot, size(s.len - 300, 20, 120), [0, 0, 0], yellow); finger.name = 'jaw finger';
    finger.position.set(...(alongX ? [0, 0, -sgn * 60] : [-sgn * 60, 0, 0]));         // 由樞軸往內 120 mm
    for (const a of [-s.len / 2 + 60, s.len / 2 - 60]) block(g, size(40, GLASS_Y + PANEL.lip - M.tableY + 10, 40), at(a, (M.tableY + GLASS_Y + PANEL.lip + 10) / 2, s.inner + 120), yellow).name = 'jaw post';
    // 缸筒固定在承板下方，桿端連到滑座下垂耳板；外拉與退板共用原有 200 mm 行程。
    const drives = [-1, 1].map(sign => {
      const a = sign * (alongX ? 375 : 120);
      const ram = pivotCylinder.create({ barrelR: 24, barrelL: 240, rodR: 12, rodFrom: 240, trunnion: false, segments: 16 });
      ram.root.position.set(...at(a, 750, s.inner - 163)); root.add(ram.root);
      ram.barrel.name = `jaw ${i} drive barrel ${sign}`; ram.piston.name = `jaw ${i} drive rod ${sign}`;
      block(g, size(42, 102, 28), at(a, 789, s.inner + 137), yellow).name = 'jaw drive lug';
      const outer = alongX ? hz : hx, mountIn = s.inner - 183;
      block(root, size(70, 30, outer - mountIn + 40), at(a, 709, (outer + mountIn) / 2), cream).name = 'jaw drive mount';
      block(root, size(70, 70, 50), at(a, 755, outer), cream).name = 'jaw drive bracket';
      // 兩路油管從機架下方繞至缸筒側面，避開上方的導軌與板材。
      for (const [lane, d] of [12, 200].entries()) {
        const end = at(a + 25, 750, s.inner - 163 + d);
        const feedY = lane ? 620 : 650; // 高壓與回油分層，支管不穿過另一條環管。
        pipe(root, [at(a + 65 + lane * 18, feedY, s.inner + 390 + lane * 18), at(a + 65 + lane * 18, feedY, s.inner - 163 + d), at(a + 65 + lane * 18, 750, s.inner - 163 + d), end], 6, 0x567ca0, 0x252c33).mesh.name = 'jaw hydraulic branch';
      }
      return ram;
    });
    const guides = [-1, 1].map(sign => {
      const a = sign * s.len * .36;
      const axis = linearAxis.create({ axis: alongX ? 'z' : 'x', guide: `jaw-guide-${i}-${sign}`,
        base: { size: size(58, 16, 288), at: at(a, 804, s.inner + 237) },
        rails: { size: size(22, 14, 288), at: [at(a, 819, s.inner + 237)] },
        carriage: { size: size(48, 14, 60), at: at(a, 833, s.inner + 137) },
      });
      root.add(axis.root);
      // 滑塊直接裝在原滑座群組，避免引入第二套位移狀態。
      g.add(axis.carriage);
      const outer = alongX ? hz : hx, start = s.inner + 365;
      block(root, size(54, 16, outer - start + 20), at(a, 788, (outer + start) / 2), cream).name = 'jaw guide bracket';
      return axis;
    });
    return { g, pivot, drives, guides, n: new THREE.Vector3(...s.n), alongX, sgn };
  });

  // ---------------------------------------------------------------- 中央壓板
  const press = new THREE.Group(); press.name = 'press'; root.add(press);
  block(press, [500, 40, 400], [0, 20 + 10, 0], yellow).name = 'press pad';
  block(press, [480, 10, 380], [0, 5, 0], rubber).name = 'press rubber';
  const rod = cylinder(press, 40, 1, [0, 0, 0], MAT.chrome, 'y', 20); rod.name = 'press rod';
  // 四支導桿沿壓板升降，固定襯套座由頂部小橫樑支撐。
  for (const z of [-140, 140]) {
    block(root, [460, 40, 65], [0, 1850, z], cream).name = 'press guide bridge';
    for (const x of [-180, 180]) {
      cylinder(press, 14, 920, [x, 510, z], MAT.chrome, 'y', 16).name = 'press guide rod';
      cylinder(root, 25, 60, [x, 1810, z], MAT.steelDark, 'y', 16).name = 'press guide bush';
      bolts(press, [[x - 35, 55, z]], 7);
    }
  }

  // ---------------------------------------------------------------- 剝線盒刮刀：無桿缸（core linearAxis）沿 Z，刮刀臂伸到接線盒那一排
  const scraperX = -760;
  block(root, [80, 40, 900], [scraperX, 820, 0], MAT.steelDark).name = 'scraper axis';
  const scraper = new THREE.Group(); scraper.name = 'scraper'; root.add(scraper);
  block(scraper, [90, 30, 120], [scraperX, 855, 0], yellow).name = 'scraper carriage';
  // 刮刀臂：滑座上的立柱（x −740～−700）→ 刮刀高度的連接塊 → 刮刀（x −700～−520，涵蓋接線盒 −670～−530）
  block(scraper, [40, BLADE_Y - 11 - 870, 40], [scraperX + 40, (870 + BLADE_Y - 11) / 2, 40], yellow).name = 'scraper arm';
  block(scraper, [40, 22, 70], [scraperX + 40, BLADE_Y, 25], yellow).name = 'scraper arm';
  block(scraper, [180, 22, 20], [scraperX + 150, BLADE_Y, 0], MAT.chrome).name = 'scraper blade';

  // ---------------------------------------------------------------- 鋁框收集槽（四條，掉落位置正下方）與接線盒料箱
  const pulledLong = PANEL.W / 2 - PANEL.edge / 2 + M.pull, pulledShort = PANEL.L / 2 - PANEL.edge / 2 + M.pull;
  const troughs = [
    { c: [0, pulledLong], size: [1750, 1000] }, { c: [0, -pulledLong], size: [1750, 1000] },
    { c: [pulledShort, 0], size: [TROUGH.w, 1000] }, { c: [-pulledShort, 0], size: [TROUGH.w, 1000] },
  ];
  troughs.forEach(({ c: [x, z] }, i) => {
    const t = new THREE.Group(); t.name = 'frame trough'; root.add(t);
    const long = i < 2, L = long ? 1750 : 1000, W = TROUGH.w, y0 = TROUGH.y;
    const size = (a, h, d) => long ? [a, h, d] : [d, h, a], at = (a, y, d) => long ? [x + a, y, z + d] : [x + d, y, z + a];
    block(t, size(L, 10, W), at(0, y0 + 5, 0), MAT.steel).name = 'trough floor';
    for (const s of [-1, 1]) block(t, size(L, TROUGH.h, 6), at(0, y0 + TROUGH.h / 2, s * (W / 2 - 3)), MAT.steel).name = 'trough side';
    for (const s of [-1, 1]) block(t, size(6, TROUGH.h - 10, W - 12), at(s * (L / 2 - 3), y0 + 10 + (TROUGH.h - 10) / 2, 0), MAT.steel).name = 'trough end';
    for (const s of [-1, 1]) block(t, size(50, y0, 50), at(s * (L / 2 - 60), y0 / 2, 0), cream).name = 'trough leg';
  });
  // 接線盒料箱（藍色周轉箱）
  const [cw, ch, cd] = CRATE.size;
  block(root, [cw, 10, cd], [CRATE.x, CRATE.y + 5, CRATE.z], blue).name = 'crate floor';
  for (const s of [-1, 1]) {
    block(root, [cw, ch, 8], [CRATE.x, CRATE.y + ch / 2, CRATE.z + s * (cd / 2 - 4)], blue).name = 'crate side';
    block(root, [8, ch - 10, cd - 16], [CRATE.x + s * (cw / 2 - 4), CRATE.y + 10 + (ch - 10) / 2, CRATE.z], blue).name = 'crate side';
  }
  block(root, [cw + 40, CRATE.y, cd + 40], [CRATE.x, CRATE.y / 2, CRATE.z], cream).name = 'crate stand';

  // ---------------------------------------------------------------- 液壓站（頂部西北角）與電控箱
  block(root, [800, 20, 700], [-950, top + 10, -500], cream);                                  // 平台
  block(root, [700, 420, 520], [-950, top + 20 + 210, -500], blue).name = 'hydraulic tank';
  cylinder(root, 130, 360, [-1100, top + 440 + 180, -500], blue, 'y', 28);                      // 馬達
  cylinder(root, 150, 30, [-1100, top + 440 + 375, -500], MAT.steelDark, 'y', 28);
  block(root, [160, 120, 160], [-800, top + 440 + 60, -420], MAT.steelDark);                    // 閥組
  // 高壓／回油雙管：由閥組外側下行，沿北側立柱與檯面下方供應四組夾爪。
  for (const o of [-14, 14]) {
    tube(root, [[-715, 2450, -420 + o], [-500, 2410, -420 + o], [-280, 2160, -420 + o], [-180, 1770, -260 + o], [-90, 1740 + o, 0]], 9, rubber, 36).name = 'press hydraulic hose';
    const lane = o < 0 ? 0 : 18, rx = SHELF_IN.x + 390 + lane, rz = SHELF_IN.z + 390 + lane, feedY = lane ? 620 : 650;
    pipe(root, [[-800 + o, 2450, -505], [-800 + o, 2450, -990], [-1250 + o, 2450, -990], [-1250 + o, feedY, -990], [-rx, feedY, -990], [-rx, feedY, -rz]], 7, 0x567ca0, 0x252c33).mesh.name = 'hydraulic supply header';
    pipe(root, [[-rx, feedY, -rz], [rx, feedY, -rz], [rx, feedY, rz], [-rx, feedY, rz], [-rx, feedY, -rz]], 7, 0x567ca0, 0x252c33).mesh.name = 'jaw hydraulic ring';
  }
  // 後側清運口保留開放空間，以安全光柵示意防護界線；不宣稱已完成安全驗證。
  const guard = lightCurtain.create({ span: 2700, height: 1750, w: 30, d: 30, beam: { opacity: .025 }, name: 'rear safety curtain' });
  guard.root.position.set(0, 150, -975); root.add(guard.root);
  plate(root, ['FRAME DISMANTLER', 'HYDRAULIC / AUTO'], 360, 70, [650, 1895, 951], 0);
  for (const x of [-1250, 1250]) bolts(root, [[x, 1880, 956], [x, 1920, 956]], 9, 'z');
  block(root, [160, 640, 420], [-M.L / 2 - 80, 1020, -640], MAT.cabinet).name = 'control box';      // 掛在西端樑外側
  for (let i = 0; i < 6; i++) cylinder(root, 14, 10, [-M.L / 2 - 165, 1250 - Math.floor(i / 2) * 70, -700 + (i % 2) * 120], [MAT.green, MAT.red, MAT.amber][i % 3], 'x', 16);

  // ---------------------------------------------------------------- 狀態
  const PRESS_UP = M.pressUp, PRESS_DOWN = GLASS_Y;
  function set({ press: pr = 0, clamp = 0, pull = 0, open = 0, scrape = 0 } = {}) {
    const out = pull * M.pull + open * M.open;
    for (const j of jaws) {
      j.g.position.copy(j.n).multiplyScalar(out);
      for (const ram of j.drives) ram.aim(j.n.clone().multiplyScalar(286 + out));
      const ang = (1 - clamp) * Math.PI;                    // 0：扣住；π：翻到外側
      if (j.alongX) j.pivot.rotation.x = j.sgn * ang; else j.pivot.rotation.z = -j.sgn * ang;
    }
    const y = PRESS_UP + (PRESS_DOWN - PRESS_UP) * pr;      // 壓板底面高度
    press.position.y = y;
    const len = PRESS_TOP - (y + 50);
    rod.scale.y = len; rod.position.y = 50 + len / 2;
    scraper.position.z = M.scrapeZ[0] + (M.scrapeZ[1] - M.scrapeZ[0]) * scrape;
  }
  set();
  return { root, set, jaws, press, scraper, bladeZ: s => M.scrapeZ[0] + (M.scrapeZ[1] - M.scrapeZ[0]) * s };
}
