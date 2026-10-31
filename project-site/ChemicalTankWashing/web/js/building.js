// 建築與場區：填裝區（原洗桶區）、清洗區、道路、倉庫；地坪、牆、門窗、柱、捲門、分區標線、樓高與尺寸標註。
import * as THREE from 'three';
import {
  ROOM, OUTLINE, DOORS, COLUMN, CLEAN, CLEAN_OUTLINE, ROAD3, ROAD5, WAREHOUSE, WH_ZONES, OPENINGS, AGV, AGV_TURNS, agvSweep, doorSwing,
  ROBOT, FENCE, GANTRY_FENCE, WASTE, FILL, STAGING, OUTFEED, PALLET, DRUM, pointInPolygon, toWorld, rectToWorld, warehouseStore,
} from './layout.js';
import { block, floorText, rod, plate } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { agvCharger, pallet } from '@core/models/transport-handling.js';
import { createDrumInstances } from './drum.js';
import { detailBoxes, asphaltMaterial, shutterMaterial, floorSlotLabels } from './render-details.js';
import { SERVICES } from './service-layout.js';

const line = (pts, color, opacity = 1) => {
  const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p)));
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
};
// 地面分區：每塊固定 renderOrder 與 polygonOffset，重疊的半透明面不會隨視角翻轉排序而閃爍
let zoneOrder = 1;
function zone(parent, [x0, z0, x1, z1], color, opacity = .14, y = 3) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -zoneOrder }));
  m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.renderOrder = zoneOrder++; parent.add(m);
  parent.add(Object.assign(line([[x0, y + 1, z0], [x1, y + 1, z0], [x1, y + 1, z1], [x0, y + 1, z1], [x0, y + 1, z0]], color, .8), { renderOrder: zoneOrder++ }));
  return m;
}
function polyZone(parent, pts, color, opacity = .07, y = 3) {
  const m = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)))), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -zoneOrder }));
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = zoneOrder++; parent.add(m); return m;
}
function ring(parent, x, z, r, color, opacity = .7, y = 8) {
  const m = new THREE.Mesh(new THREE.RingGeometry(r - 22, r + 22, 128), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.renderOrder = 2; parent.add(m); return m;
}
const floorMesh = (parent, pts, mat, y = 0) => {
  const m = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)))), mat);
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true; parent.add(m); return m;
};

// 沿多邊形內牆輪廓外推建牆；gapsOf(邊) 回傳該邊的開口 [沿邊起點, 終點, 開口頂高]；skip(邊) 為 true 的邊不建（共用牆只建一次）
function walls(group, poly, H, { gapsOf = () => [], skip = () => false, lowerMaterial } = {}) {
  const t = ROOM.wall;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
    if (skip([ax, az], [bx, bz])) continue;
    const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L;
    let nx = -dz, nz = dx; const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (pointInPolygon([mx + nx * 20, mz + nz * 20], poly)) { nx = -nx; nz = -nz; }
    const yaw = Math.atan2(-dz, dx);
    // 開口在沿邊距離上的區間
    const gaps = gapsOf([ax, az], [bx, bz]).map(([p, q, top, bottom = 0]) => { const s0 = (p[0] - ax) * dx + (p[1] - az) * dz, s1 = (q[0] - ax) * dx + (q[1] - az) * dz; return [Math.min(s0, s1), Math.max(s0, s1), top, bottom]; }).sort((u, v) => u[0] - v[0]);
    const piece = (s0, s1, y0, y1, mat) => {
      if (s1 - s0 < 1 || y1 - y0 < 1) return;
      const c = (s0 + s1) / 2, ext = (s0 <= 0 ? t / 2 : 0) + (s1 >= L ? t / 2 : 0), off = (s1 >= L ? t / 4 : 0) - (s0 <= 0 ? t / 4 : 0);
      const w = new THREE.Mesh(new THREE.BoxGeometry(s1 - s0 + ext, y1 - y0, t), mat);
      w.position.set(ax + dx * (c + off) + nx * t / 2, (y0 + y1) / 2, az + dz * (c + off) + nz * t / 2); w.rotation.y = yaw; w.receiveShadow = true; group.add(w);
    };
    for (const [bottom, h, mat] of [[0, 160, MAT.wallBase], [160, 1200, lowerMaterial], [1200, H, MAT.wall]]) {
      // 各牆帶獨立切割，容許輸送開口上方另設管線穿孔，保留兩者間的牆。
      const active = gaps.filter(g => g[2] > bottom && g[3] < h);
      const cuts = [...new Set([0, L, ...active.flatMap(g => g.slice(0, 2))])].sort((a, b) => a - b);
      for (let j = 1; j < cuts.length; j++) {
        const s0 = cuts[j - 1], s1 = cuts[j], mid = (s0 + s1) / 2;
        const holes = active.filter(g => g[0] < mid && mid < g[1]).sort((a, b) => a[3] - b[3]);
        let y0 = bottom;
        for (const [, , top, base] of holes) {
          piece(s0, s1, y0, Math.min(base, h), mat); y0 = Math.max(y0, top);
        }
        piece(s0, s1, y0, h, mat);
      }
    }
  }
}
// 捲門：兩側導軌（嵌在門邊牆內，不佔開口）＋門楣內側的捲門箱
function rollerDoor(group, x0, x1, z, top, inward) {
  for (const x of [x0 - 50, x1 + 50]) block(group, [120, top, 260], [x, top / 2, z], MAT.yellow);   // 凸出開口 10 mm，與牆端面不共面
  const curtain = shutterMaterial();
  // 收捲後露出的葉片位於門楣內，既有開口淨高保持不變。
  block(group, [x1 - x0 + 240, 380, 300], [(x0 + x1) / 2, top + 200, z + inward * 160], [MAT.steelDark, MAT.steelDark, MAT.steelDark, MAT.steelDark, curtain, curtain]);
  const rails = [];
  for (const x of [x0 - 50, x1 + 50]) {
    rails.push([[28, top - 80, 18], [x, top / 2, z + inward * 144]]);
    for (let y = 300; y < top; y += 600) rails.push([[55, 22, 10], [x, y, z + inward * 158]]);
  }
  detailBoxes(group, 'roller door guide covers', rails, MAT.steelDark);
  plate(group, ['AGV 通行 · 保持淨空'], Math.min(1800, x1 - x0 - 100), 220,
    [(x0 + x1) / 2, top + 205, z - inward * 155], inward < 0 ? 0 : Math.PI,
    { bg: '#efc13b', fg: '#1c2730', w: 1024, h: 128 });
}

export function createBuilding(scene) {
  const group = new THREE.Group(); group.name = 'building'; scene.add(group);
  const lowerMaterial = new THREE.MeshStandardMaterial({ color: 0xaab9b9, roughness: .88 });
  // 地坪（廠區外地）
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(76000, 58000), MAT.floorOut);
  outside.rotation.x = -Math.PI / 2; outside.position.set(23000, -2, 19000); outside.receiveShadow = true; group.add(outside);
  // 填裝區地坪、更衣室（區外，僅示意）
  floorMesh(group, OUTLINE, MAT.floor);
  floorMesh(group, [[-2050, 4700], [1770, 4700], [1770, 8520], [-2050, 8520]], new THREE.MeshStandardMaterial({ color: 0x59636c, roughness: .9 }), -1);
  // 清洗區地坪
  floorMesh(group, CLEAN_OUTLINE, MAT.floor);

  // ---- 牆 ----
  const t = ROOM.wall, conv = OPENINGS.conveyor;
  walls(group, OUTLINE, ROOM.H, {
    lowerMaterial,
    gapsOf: ([ax, az], [bx, bz]) => {
      if (az === ROOM.D && bz === ROOM.D) return Object.values(OPENINGS).filter(o => o.wall === 'fillS').map(o => [[o.x0, az], [o.x1, az], o.y1]);
      if (ax === ROOM.W && bx === ROOM.W) {
        const p = SERVICES.pass;
        return [[[ax, conv.z0], [ax, conv.z1], conv.y1], [[ax, p.z0], [ax, p.z1], p.top, p.bottom]];
      }
      return [];
    },
  });
  walls(group, CLEAN_OUTLINE, CLEAN.H, {
    lowerMaterial,
    skip: ([ax], [bx]) => ax === CLEAN.x0 && bx === CLEAN.x0,   // 西牆就是填裝區東牆（共用）
    gapsOf: ([, az], [, bz]) => az === CLEAN.z1 && bz === CLEAN.z1 ? [[[OPENINGS.clean.x0, az], [OPENINGS.clean.x1, az], OPENINGS.clean.y1]] : [],
  });
  // 更衣室西牆（輪廓以外）
  block(group, [t, 1200, 3820], [-2150, 600, 6610], lowerMaterial);
  block(group, [t, ROOM.H - 1200, 3820], [-2150, (ROOM.H + 1200) / 2, 6610], MAT.wall);
  // 捲門（南牆三樘：填裝區兩樘、清洗區一樘）
  for (const o of Object.values(OPENINGS)) if (o.wall !== 'shared') rollerDoor(group, o.x0, o.x1, ROOM.D + t / 2, o.y1, -1);
  // 共用牆輸送口的框
  for (const z of [conv.z0 + 40, conv.z1 - 40]) block(group, [t + 40, conv.y1, 80], [ROOM.W + t / 2, conv.y1 / 2, z], MAT.yellow);
  // 樓高輪廓線
  group.add(line([...OUTLINE, OUTLINE[0]].map(([x, z]) => [x, ROOM.H, z]), 0x8fb6c8, .55));
  group.add(line([...CLEAN_OUTLINE, CLEAN_OUTLINE[0]].map(([x, z]) => [x, CLEAN.H, z]), 0x8fb6c8, .55));
  const ceilMat = new THREE.MeshBasicMaterial({ color: 0x9fc3d6, transparent: true, opacity: .07, side: THREE.DoubleSide, depthWrite: false });
  const ceiling = new THREE.Group(); ceiling.visible = false; group.add(ceiling);
  floorMesh(ceiling, OUTLINE, ceilMat, ROOM.H); floorMesh(ceiling, CLEAN_OUTLINE, ceilMat, CLEAN.H);

  // 門（門扇以 30° 半開示意）＋開啟範圍
  for (const d of DOORS) {
    const w = d.x1 - d.x0;
    const leaf = block(group, [w, 2100, 45], [0, 1050, 0], MAT.door);
    const hinge = new THREE.Group(); hinge.position.set(d.x0, 0, d.z); group.add(hinge); hinge.add(leaf); leaf.position.x = w / 2;
    hinge.rotation.y = -d.dir * 30 * Math.PI / 180;
    const pts = []; for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI / 2; pts.push([d.x0 + w * Math.cos(a), 6, d.z + d.dir * w * Math.sin(a)]); }
    group.add(line([[d.x0, 6, d.z], ...pts, [d.x0, 6, d.z]], 0xffd27a, .8));
  }
  // 窗（填裝區南牆剩兩樘；原東牆窗改為共用牆，不再保留）
  for (const x of [7200, 9800]) block(group, [1700, 1500, 30], [x + 850, 1650, ROOM.D + 105], MAT.window);
  // 柱
  block(group, [COLUMN.size, ROOM.H, COLUMN.size], [COLUMN.x, ROOM.H / 2, COLUMN.z], MAT.column);

  // ---- 道路 ----
  const road = asphaltMaterial();
  const roadPlane = (x0, z0, x1, z1, y = 1) => {
    const geometry = new THREE.PlaneGeometry(x1 - x0, z1 - z0), uv = geometry.attributes.uv;
    // 世界尺度 600 mm 一塊紋理；長短路段使用同一個材質，不拉長骨材。
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / 600, uv.getY(i) * (z1 - z0) / 600);
    const m = new THREE.Mesh(geometry, road); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.receiveShadow = true; group.add(m);
  };
  roadPlane(ROAD3.x0, ROAD3.z0, ROAD3.x1, ROAD3.z1);
  roadPlane(ROAD5.x0, ROAD5.z0, ROAD5.x1, ROAD3.z0);
  roadPlane(ROAD5.x0, ROAD3.z1, ROAD5.x1, ROAD5.z1);
  const paint = new THREE.MeshBasicMaterial({ color: 0xe8e8e0 }), paintY = new THREE.MeshBasicMaterial({ color: 0xf2c230 });
  const mark = (x0, z0, x1, z1, mat = paint) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 4, (z0 + z1) / 2); group.add(m); };
  for (let x = ROAD3.x0 + 500; x < ROAD3.x1 - 1500; x += 3000) if (x + 1500 < ROAD5.x0 || x > ROAD5.x1) mark(x, ROAD3.zc - 60, x + 1500, ROAD3.zc + 60);
  for (let z = ROAD5.z0 + 500; z < ROAD3.z0 - 1500; z += 3000) mark(ROAD5.xc - 60, z, ROAD5.xc + 60, z + 1500);
  for (const z of [ROAD3.z0 + 80, ROAD3.z1 - 80]) for (const [a, b] of [[ROAD3.x0, ROAD5.x0], [ROAD5.x1, ROAD3.x1]]) mark(a, z - 50, b, z + 50, paintY);
  for (const x of [ROAD5.x0 + 80, ROAD5.x1 - 80]) mark(x - 50, ROAD5.z0, x + 50, ROAD3.z0, paintY);

  // ---- 倉庫 ----
  const W = WAREHOUSE, whPoly = [[W.x0, W.z0], [W.x1, W.z0], [W.x1, W.z1], [W.x0, W.z1]];
  floorMesh(group, whPoly, MAT.floor);
  walls(group, whPoly, W.H, { lowerMaterial, gapsOf: ([, az], [, bz]) => az === W.z0 && bz === W.z0 ? [[[W.door[0], az], [W.door[1], az], 4200]] : [] });
  rollerDoor(group, W.door[0], W.door[1], W.z0 - t / 2, 4200, 1);
  group.add(line([...whPoly, whPoly[0]].map(([x, z]) => [x, W.H, z]), 0x8fb6c8, .55));
  floorMesh(ceiling, whPoly, ceilMat, W.H);
  // 充電櫃：在北牆，各自充電位車尾旁
  for (const ch of AGV.chargers) { const c = agvCharger.create({ w: 600, h: 1400, d: 400 }); c.root.position.set(ch.x + 900, 0, W.z0 + 250); group.add(c.root); }
  // 倉儲棧板與桶（靜態，InstancedMesh）：待洗區、成品 A～D；動畫用的卸板位留空
  const store = createStaticStore(group);
  addPlantDetails(group);

  // ---- 分區 ----
  const zones = new THREE.Group(); group.add(zones);
  // 填裝區
  FILL.lines.forEach((x, i) => {
    zone(zones, [x - FILL.frameHalf - 60, FILL.frame[0] - 60, x + FILL.frameHalf + 60, FILL.frame[1] + 60], 0x4aa8ff, .08);
    floorText(zones, [`L${i + 1} 液體 ${FILL.liquids[i]}`], x, FILL.frame[1] + 420, 1000, 260, { fg: '#9fd0ff' });
  });
  zone(zones, [STAGING.gantry.x0, 12900, STAGING.gantry.x1, 15500], 0xffc233, .08);
  floorText(zones, ['暫存區 · 同液體同板', '龍門夾桶上棧板（田字型 2×2）'], 1600, 13300, 3200, 600, { fg: '#ffd56a' });
  zone(zones, FILL.ng.box, 0xff5a5a, .14);
  zone(zones, [1770, 2100, 2350, 12050], 0x3dd68c, .1);
  floorText(zones, '人員通道', 2060, 9800, 1200, 240, { fg: '#9ff0c6', rot: Math.PI / 2 });
  floorText(zones, ['填裝區（原洗桶區）', '4 線 × 4 填裝位，各自獨立啟動'], 6200, 3200, 4600, 600, { fg: '#c7e3ff' });
  floorText(zones, '更衣室 106', -150, 6600, 2000, 300, { fg: '#c7d1da' });
  // 清洗區
  const cellPoly = FENCE.slice(0, -1).map(([x, z]) => toWorld('cell', x, z));
  polyZone(zones, cellPoly, 0x4fd1e8, .07);
  zone(zones, rectToWorld('front', GANTRY_FENCE[0].concat(GANTRY_FENCE[2])), 0x9b7cff, .06);
  zone(zones, rectToWorld('util', WASTE.bund), 0xff9f43, .12);
  zone(zones, [13300, 3000, 20200, 11300], 0x7d8b97, .06);
  floorText(zones, ['清洗前暫存（預留）', '待洗棧板 2 位、維修空間'], 16750, 7000, 4200, 700, { fg: '#8796a3' });
  floorText(zones, '手臂清洗區（DCS＋圍籬）', ...toWorld('cell', 8000, 13300), 2600, 260, { fg: '#8fe5f2' });
  floorText(zones, ['清洗區', '翻桶 → 側標 → 翻正 → 開蓋 → 手臂清洗 → 秤重 → 頂面貼標'], 19300, 14650, 6200, 600, { fg: '#bff3ea' });
  // 倉庫
  zone(zones, WH_ZONES.dirty, 0x4aa8ff, .08);
  for (const [k, r] of Object.entries(WH_ZONES.finished)) { zone(zones, r, 0x3dd68c, .08); floorText(zones, `成品 ${k}`, (r[0] + r[2]) / 2, 24600, 1800, 420, { fg: '#9ff0c6' }); }
  floorText(zones, ['待洗桶區', '田字型棧板 4 桶'], (WH_ZONES.dirty[0] + WH_ZONES.dirty[2]) / 2, 24600, 3600, 700, { fg: '#9fd0ff' });
  floorText(zones, ['倉庫（取代原倉儲區）', 'W 30 × L 20 × H 5 m'], 40000, 22500, 6000, 700, { fg: '#c7d1da' });
  for (const c of AGV.chargers) zone(group, [c.x - 300, c.z - 550, c.x + 1600, c.z + 550], 0x3dd68c, .25, 4);   // AGV 地面充電板（停車時朝西）
  // 道路文字
  floorText(zones, '道路 3 m', 6000, ROAD3.zc + 900, 1600, 300, { fg: '#c9ced4' });
  floorText(zones, '道路 5 m（手稿：馬路）', ROAD5.xc, 6000, 3600, 360, { fg: '#c9ced4', rot: Math.PI / 2 });

  // ---- 尺寸與淨空標註（可切換）----
  const dims = new THREE.Group(); dims.visible = false; group.add(dims);
  const dimLabels = [];
  // 尺寸線用細圓桿（WebGL 線寬固定 1 px，俯視全場時看不到）
  const dimMat = c => new THREE.MeshBasicMaterial({ color: c });
  const dim = (a, b, text, color = 0x7fd0ff) => {
    const m = dimMat(color); rod(dims, a, b, 18, m, 6);
    const d = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)).normalize();
    const n = Math.abs(d.y) > .9 ? new THREE.Vector3(150, 0, 0) : new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(150);
    for (const p of [a, b]) rod(dims, [p[0] - n.x, p[1], p[2] - n.z], [p[0] + n.x, p[1], p[2] + n.z], 14, m, 6);
    dimLabels.push({ text, pos: new THREE.Vector3(...a).add(new THREE.Vector3(...b)).multiplyScalar(.5) });
  };
  dim([0, 30, -900], [ROOM.W, 30, -900], '填裝區 12,560');
  dim([-3300, 30, 0], [-3300, 30, ROOM.D], '15,520');
  dim([CLEAN.x0, 30, -900], [CLEAN.x1, 30, -900], '清洗區 13,500（建議）');
  dim([ROAD5.x0, 30, 2000], [ROAD5.x1, 30, 2000], '道路 5,000');
  dim([-6000, 30, ROAD3.z0], [-6000, 30, ROAD3.z1], '道路 3,000');
  dim([W.x0, 30, W.z1 + 900], [W.x1, 30, W.z1 + 900], '倉庫 30,000');
  dim([W.x1 + 900, 30, W.z0], [W.x1 + 900, 30, W.z1], '20,000');
  dim([W.x1 - 600, 0, W.z0 + 600], [W.x1 - 600, W.H, W.z0 + 600], '倉庫 H 5,000', 0xffd27a);
  dim([-1500, 0, 600], [-1500, ROOM.H, 600], '樓高 4,500', 0xffd27a);
  dim([COLUMN.x - 400, 30, COLUMN.z - 900], [COLUMN.x + 400, 30, COLUMN.z - 900], '柱 800（圖面量測）', 0xff9f9f);
  dim([FILL.lines[0], 30, FILL.pos[1] + DRUM.envelopeR], [FILL.lines[0], 30, FILL.pos[0] - DRUM.envelopeR], `桶間 ${FILL.pos[0] - FILL.pos[1] - 2 * DRUM.envelopeR}`, 0xd7bcff);
  // AGV 迴轉圈與手臂伸展範圍
  const agvRings = new THREE.Group(); dims.add(agvRings);
  for (const tn of AGV_TURNS) ring(agvRings, tn.x, tn.z, agvSweep(tn.loaded), 0xffc233, .8);
  dimLabels.push({ text: `AGV 迴轉 R${agvSweep(true).toFixed(0)}（道路上原地迴轉）`, pos: new THREE.Vector3(AGV_TURNS[1].x, 40, AGV_TURNS[1].z + agvSweep(true) + 300) });
  const [rx, rz] = toWorld('cell', ROBOT.x, ROBOT.z);
  ring(dims, rx, rz, 2655, 0x4fd1e8, .45);
  dimLabels.push({ text: 'R-2000iC 最大伸展 R2655（DCS 限制在圍籬內）', pos: new THREE.Vector3(rx - 1900, 40, rz + 1850) });
  for (const d of DOORS) zone(dims, doorSwing(d), 0xffd27a, .08, 2);

  return { group, zones, dims, dimLabels, ceiling, store,
    setWallCutaway(on) {
      lowerMaterial.transparent = on; lowerMaterial.opacity = on ? .16 : 1;
      lowerMaterial.depthWrite = !on; lowerMaterial.needsUpdate = true;
    },
  };
}

// 固定建築細節：立柱放在牆帶內，燈具高於所有製程機構；不占 AGV 路肩。
function addPlantDetails(group) {
  const columns = [], lights = [], housings = [], girts = [];
  // 橫樑與柱同在 200 mm 牆帶內，讓半透明上牆仍讀得出連續鋼構。
  for (const y of [1250, 2900, 4100]) {
    girts.push([[26060, 90, 65], [13030, y, -120]]);
    girts.push([[30000, 90, 65], [39000, y, WAREHOUSE.z1 + 120]]);
  }
  detailBoxes(group, 'wall steel girts', girts, MAT.column);
  for (const x of [1000, 6000, 12000, 14000, 18000, 22000, 25500]) {
    columns.push([[130, 4380, 140], [x, 2250, -120]]);
    housings.push([[1200, 65, 180], [x, 4280, 350]]);
    housings.push([[40, 35, 350], [x, 4280, 85]]);
    lights.push([[1140, 12, 130], [x, 4238, 350]]);
  }
  for (const x of [25000, 30500, 36000, 41500, 47000, 52500]) {
    columns.push([[160, 4880, 140], [x, 2500, WAREHOUSE.z1 + 120]]);
    housings.push([[1600, 65, 220], [x, 4780, WAREHOUSE.z1 - 350]]);
    housings.push([[40, 35, 350], [x, 4780, WAREHOUSE.z1 - 85]]);
    lights.push([[1540, 12, 170], [x, 4738, WAREHOUSE.z1 - 350]]);
  }
  detailBoxes(group, 'wall pilasters', columns, MAT.column);
  detailBoxes(group, 'wall light housings', housings, MAT.steelDark);
  detailBoxes(group, 'wall light diffusers', lights, new THREE.MeshStandardMaterial({ color: 0xe8f0ee, emissive: 0xcfe2e1, emissiveIntensity: .65, roughness: .65 }));
  // 通道標線是薄漆膜，不建立會擋車的實體路緣或護柱。
  const paint = new THREE.MeshBasicMaterial({ color: 0xf2c230 });
  const markings = [];
  for (const x of [1795, 2325]) markings.push([[40, 1, 7600], [x, 8, 6500]]);
  for (const o of Object.values(OPENINGS).filter(o => o.wall !== 'shared')) {
    markings.push([[o.x1 - o.x0 - 240, 1, 120], [(o.x0 + o.x1) / 2, 8, ROOM.D + 450]]);
    floorText(group, 'STOP', (o.x0 + o.x1) / 2, ROOM.D + 760, 850, 210, { fg: '#f5d36b', y: 9 });
  }
  detailBoxes(group, 'walkway and door stop paint', markings, paint).castShadow = false;
  for (const x of [9000, 21000, 39000]) floorText(group, '➜', x, ROAD3.zc + 650, 1000, 550, { fg: '#e6e4d5', y: 9 });
  // 預留維修區只畫邊界與斜線，保留原本的棧板與人員通路。
  const hatch = new THREE.Group(); hatch.name = 'maintenance floor paint'; group.add(hatch);
  for (let x = 13900; x < 19100; x += 500) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(80, 760), paint); m.rotation.set(-Math.PI / 2, 0, -Math.PI / 4); m.position.set(x, 9, 10400); hatch.add(m);
  }
  floorText(group, '維修淨空 / KEEP CLEAR', 16500, 10900, 3000, 280, { fg: '#f5d36b', y: 9 });
  // 倉庫採地面儲位，不新增貨架；儲位號與牆牌讓棧板區可辨識。
  floorSlotLabels(group, warehouseStore());
  for (const [k, r] of Object.entries(WH_ZONES.finished)) plate(group, [`成品 ${k}`, 'FINISHED GOODS'], 2200, 580, [(r[0] + r[2]) / 2, 3450, WAREHOUSE.z1 - 8], Math.PI, { bg: '#205e52', fg: '#ffffff', w: 1024, h: 256 });
  plate(group, ['待洗桶 / INBOUND', '依儲位號存放'], 3000, 580, [(WH_ZONES.dirty[0] + WH_ZONES.dirty[2]) / 2, 3450, WAREHOUSE.z1 - 8], Math.PI, { bg: '#24527b', fg: '#ffffff', w: 1024, h: 256 });
}

// 倉庫靜態儲位：棧板（core 棧板模型的 InstancedMesh）＋桶（InstancedMesh）
function createStaticStore(group) {
  const slots = warehouseStore();
  const many = pallet.instances(slots.map(({ x, z }) => [x, 0, z]), { size: PALLET.W, height: PALLET.H }); many.root.name = 'warehouse pallets'; group.add(many.root);
  const drums = slots.flatMap(({ x, z, n }) => PALLET.slots.slice(0, n).map(([sx, sz]) => [x + sx, z + sz]));
  const inst = createDrumInstances(drums.length), m = new THREE.Matrix4();
  const q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  drums.forEach(([x, z], i) => inst.add(m.compose(new THREE.Vector3(x, PALLET.H + DRUM.H / 2, z), q.setFromAxisAngle(Y, (i * 73) % 360 * Math.PI / 180), one)));
  inst.done(); inst.group.name = 'warehouse drums'; group.add(inst.group);
  return { pallets: slots.length, drums: drums.length };
}
