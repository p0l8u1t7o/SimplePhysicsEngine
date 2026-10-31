// 本站加工件與離線表面；重複零件共用幾何，實例可由 verify-render-details.mjs 展開檢查。
import * as THREE from 'three';
import { block, cylinder, plate, HAS_DOM } from '@core/geom/shapes.js';
import { MAT, finished } from '@core/geom/materials.js';
import { hmi } from '@core/models/indicators.js';
import { loadCell } from '@core/models/motion.js';

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const steel = finished(MAT.steel, 'metal');
const textureCache = new Map();
export function detailBoxes(parent, name, entries, material = steel) {
  const mesh = new THREE.InstancedMesh(boxGeo, material, entries.length);
  mesh.name = name; mesh.userData.renderDetail = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  entries.forEach(([size, pos], i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(...pos), q, new THREE.Vector3(...size))));
  mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh); return mesh;
}

// 程序貼圖以固定種子產生；不讀網路、不改共用 MAT。
function canvasMap(key, w, h, paint) {
  if (!HAS_DOM) return null;
  if (!textureCache.has(key)) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    paint(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    textureCache.set(key, t);
  }
  return textureCache.get(key);
}

export function asphaltMaterial() {
  const map = canvasMap('asphalt', 256, 256, (g, w, h) => {
    g.fillStyle = '#61666a'; g.fillRect(0, 0, w, h);
    let seed = 1427;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 11000; i++) {
      const v = 65 + Math.floor(rnd() * 65); g.fillStyle = `rgb(${v},${v + 3},${v + 5})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
  });
  if (map) map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({ color: 0xb8bcc0, map, roughness: .96, metalness: 0 });
}

export function shutterMaterial() {
  const map = canvasMap('shutter', 512, 128, (g, w, h) => {
    g.fillStyle = '#b1b9bc'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      g.fillStyle = '#65717a'; g.fillRect(0, y, w, 3);
      g.fillStyle = '#e3e8e6'; g.fillRect(0, y + 4, w, 3);
      g.fillStyle = '#89969d'; g.fillRect(0, y + 27, w, 4);
    }
  });
  return new THREE.MeshStandardMaterial({ color: 0xffffff, map, metalness: .55, roughness: .42 });
}

// 儲位號共用一張圖集與一個網格，避免每個棧板新增貼圖與 draw call。
export function floorSlotLabels(parent, slots) {
  const cols = 8, rows = Math.ceil(slots.length / cols), cw = 128, ch = 48;
  const map = canvasMap(`slots-${slots.length}`, cols * cw, rows * ch, g => {
    g.fillStyle = '#d4dfdc'; g.font = 'bold 30px Consolas,monospace'; g.textAlign = 'center';
    slots.forEach((_, i) => g.fillText(`P${String(i + 1).padStart(2, '0')}`, (i % cols + .5) * cw, Math.floor(i / cols) * ch + 35));
  });
  const positions = [], uvs = [], normals = [];
  slots.forEach(({ x, z }, i) => {
    const u = i % cols / cols, v = 1 - (Math.floor(i / cols) + 1) / rows;
    for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) {
      positions.push(x + (a - .5) * 480, 9, z + 700 + (.5 - b) * 150);
      uvs.push(u + a / cols, v + b / rows); normals.push(0, 1, 0);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  mesh.name = 'warehouse slot label atlas'; parent.add(mesh);
}

// 籠架留在既有 IBC 外框附近；不更動槽體、底座或供液管的座標。
export function addIbcDetails(parent, x, z, liquid) {
  const bars = [];
  for (const sx of [-335, 335]) for (const dz of [-465, -230, 0, 230, 465]) bars.push([[16, 980, 16], [x + sx, 610, z + dz]]);
  for (const dz of [-465, 465]) for (const sx of [-165, 0, 165]) bars.push([[16, 980, 16], [x + sx, 610, z + dz]]);
  for (const y of [190, 490, 790, 1080]) {
    for (const dz of [-465, 465]) bars.push([[676, 12, 12], [x, y, z + dz]]);
    for (const sx of [-335, 335]) bars.push([[12, 12, 936], [x + sx, y, z]]);
  }
  detailBoxes(parent, `IBC ${liquid} cage`, bars);
  cylinder(parent, 65, 30, [x + 190, 1125, z], MAT.black, 'y', 16).name = 'IBC service cap';
  // 出液口偏離正面直條，並高於最下層橫條，籠架不可穿過閥口。
  cylinder(parent, 30, 100, [x + 80, 260, z + 500], MAT.ppDark, 'z', 12).name = 'IBC drain outlet';
  block(parent, [90, 18, 24], [x + 80, 305, z + 525], MAT.red).name = 'IBC drain handle';
  plate(parent, [`IBC · ${liquid}`, '供液專用 / SUPPLY'], 260, 150, [x, 690, z + 476], 0, { w: 512, h: 256 });
}

// 稱重元件採 core 荷重元模型；相同模型零件各合成一個 InstancedMesh。
function loadCells(parent, positions) {
  const model = loadCell.create({ r: 25, h: 36, segments: 12, material: steel });
  model.root.updateMatrixWorld(true);
  const group = new THREE.Group(); group.name = 'fill load cells'; group.userData.coreModel = 'load-cell'; parent.add(group);
  model.root.traverse(o => {
    if (!o.isMesh) return;
    const inst = new THREE.InstancedMesh(o.geometry, o.material, positions.length), m = new THREE.Matrix4();
    inst.name = o.name; inst.userData.renderDetail = true;
    positions.forEach((p, i) => inst.setMatrixAt(i, m.makeTranslation(...p).multiply(o.matrixWorld)));
    inst.instanceMatrix.needsUpdate = true; inst.castShadow = inst.receiveShadow = true; group.add(inst);
  });
}

export function addFillLineDetails(parent, x, index, fill, top) {
  const trays = [], pads = [], cells = [], magazines = [];
  for (const [i, z] of fill.pos.entries()) {
    // 接液盤位於滾筒下方、支腳內側；留出上方稱重元件的空間。
    trays.push([[610, 10, 660], [x, top - 205, z]]);
    for (const sx of [-300, 300]) trays.push([[10, 45, 660], [x + sx, top - 180, z]]);
    for (const dz of [-325, 325]) trays.push([[580, 45, 10], [x, top - 180, z + dz]]);
    for (const sx of [-275, 275]) for (const dz of [-235, 235]) {
      cells.push([x + sx, top - 121, z + dz]);
      pads.push([[70, 12, 70], [x + sx, top - 145, z + dz]]);
      pads.push([[70, 10, 70], [x + sx, top - 94, z + dz]]);
    }
    for (const sx of [-275, 275]) pads.push([[40, 26, 540], [x + sx, top - 76, z]]);
    for (const dz of [-235, 235]) pads.push([[800, 10, 40], [x, top - 150, z + dz]]);
    // 桶蓋備料盒為外觀示意，不暗示已實作供蓋或改變鎖蓋工序。
    magazines.push([[180, 12, 220], [x - 430, 1700, z - 420]]);
    for (const dx of [-84, 84]) magazines.push([[12, 100, 220], [x - 430 + dx, 1756, z - 420]]);
    magazines.push([[156, 100, 12], [x - 430, 1756, z - 524]]);
    magazines.push([[40, 1694, 40], [x - 480, 847, z - 420]]);
    magazines.push([[100, 10, 100], [x - 480, 6, z - 420]]);
    plate(parent, [`${index + 1}.${i + 1} / 備蓋`], 180, 70, [x - 522, 1756, z - 420], -Math.PI / 2, { w: 512, h: 128 });
  }
  detailBoxes(parent, 'fill drip trays', trays);
  detailBoxes(parent, 'load cell mounting pads', pads);
  detailBoxes(parent, 'cap reserve magazines', magazines, finished(MAT.alu));
  const caps = new THREE.InstancedMesh(new THREE.CylinderGeometry(36, 36, 18, 12), MAT.cap, fill.pos.length * 2);
  const matrix = new THREE.Matrix4();
  fill.pos.forEach((z, i) => {
    for (let k = 0; k < 2; k++) caps.setMatrixAt(i * 2 + k, matrix.makeTranslation(x - 430, 1715 + k * 20, z - 420));
  });
  caps.name = 'reserve drum caps'; caps.userData.renderDetail = true; caps.instanceMatrix.needsUpdate = true; parent.add(caps);
  loadCells(parent, cells);
  // 面板設在入口西側立柱，避開東側擦拭人員的巡迴路徑。
  const panel = hmi.create({ w: 350, h: 260, d: 55, display: { canvas: [640, 400] } });
  panel.root.position.set(x - fill.frameHalf - 85, 1450, fill.frame[0]); panel.root.rotation.y = -Math.PI / 2; parent.add(panel.root);
  block(parent, [70, 35, 60], [x - fill.frameHalf - 35, 1450, fill.frame[0]], MAT.steelDark).name = 'HMI mounting bracket';
  panel.drawText([`L${index + 1} · 液體 ${fill.liquids[index]}`, '秤重填裝 / 操作示意', '4 個獨立填裝位', '填裝 → 鎖蓋 → 人工放行', '桶蓋備料方式待確認']);
  // 固定背側防濺板不占東側操作通道，也不越過換位頭最低外框。
  const shields = fill.pos.map(z => [[14, 240, 740], [x - fill.frameHalf, 1930, z + 100]]);
  for (const y of [1795, 2065]) shields.push([[40, 30, fill.frame[1] - fill.frame[0]], [x - fill.frameHalf, y, (fill.frame[0] + fill.frame[1]) / 2]]);
  detailBoxes(parent, 'west splash shields', shields, finished(MAT.alu));
}
