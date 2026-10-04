// 展示外觀（尺寸皆為示意）：材質與固定細節，不參與製程排程。
import * as THREE from 'three';
import { MAT, finished } from '@core/geom/materials.js';
import { block, rod, decal, floorText } from '@core/geom/shapes.js';

export const SURFACE = {
  extrusion: finished(MAT.alu, 'metal', .045),
  sheet: finished(MAT.frame, 'polymer', .025),
  support: finished(MAT.steel, 'metal', .06),
  cabinet: finished(MAT.cabinet, 'polymer', .035),
};
SURFACE.extrusion.color.setHex(0x9aa7b0); SURFACE.extrusion.roughness = .55;
SURFACE.sheet.color.setHex(0x4d5962); SURFACE.sheet.roughness = .66;
SURFACE.support.roughness = .32;
SURFACE.cabinet.color.setHex(0x697782); SURFACE.cabinet.roughness = .63;

// 低對比皮帶紋理：固定種子的細刮痕、水漬與接縫，維持原來的 UV 位移速率。
export function beltTexture(color) {
  const n = 128, data = new Uint8Array(n * n * 4), c = new THREE.Color(color);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const h = ((Math.imul(x + 7, 1973) ^ Math.imul(y + 11, 9277)) >>> 0) % 256;
    const stain = Math.sin(x * .067 + Math.sin(y * .09)) * Math.sin(y * .045);
    const k = .93 + stain * .035 + h / 255 * .025 - (x === 2 ? .025 : 0);
    data.set([c.r * 255 * k, c.g * 255 * k, c.b * 255 * k, 255], (y * n + x) * 4);
  }
  const t = new THREE.DataTexture(data, n, n);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// 貼圖直接畫在瓶身材質上：不增加一層圓柱殼，也不會改變工件外形與吸附高度。
const labels = new Map();
export function packageMaterial(base, cls, form, flat = false) {
  const key = [base.uuid, cls, form, flat].join('|');
  if (labels.has(key)) return labels.get(key);
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const ctx = c.getContext('2d'), food = cls === 'food', nonfood = cls === 'nonfood';
  ctx.fillStyle = '#f0f3f0'; ctx.fillRect(0, 0, 512, 256);
  const y = flat ? 0 : 56, h = flat ? 256 : 146;
  ctx.fillStyle = food ? '#209fa8' : nonfood ? '#d8522e' : form === 'can' ? '#38699a' : '#499363';
  ctx.fillRect(0, y, 512, h);
  ctx.fillStyle = '#f5f6eb'; ctx.fillRect(0, y + h * .58, 512, h * .2);
  for (let i = 0; i < 2; i++) {
    const x = i * 256 + 32;
    ctx.fillStyle = food ? '#16456c' : '#713327';
    ctx.font = 'bold 32px "Microsoft JhengHei",sans-serif';
    ctx.fillText(food ? '乳品' : nonfood ? '清潔' : '回收', x, y + h * .45);
    ctx.fillStyle = '#faf9ee'; ctx.fillRect(x + 130, y + 16, 50, 34);
    ctx.fillStyle = '#314650';
    for (let j = 0; j < 22; j++) ctx.fillRect(x + j * 4, y + h * .84, j % 3 ? 2 : 3, 12);
  }
  // 少量掉墨，避免所有舊包材都像新品。
  ctx.fillStyle = '#e8eeeb';
  for (let i = 0; i < 16; i++) ctx.fillRect((i * 97 + 17) % 512, y + (i * 37) % h, 2, 4);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const mat = base.clone(); mat.map = map; mat.color.setHex(0xffffff); mat.roughness = .57;
  labels.set(key, mat); return mat;
}

// 相同幾何、材質合為實例批次；回歸工具會把這些實例展開後再做干涉檢查。
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const boltGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
const ringGeo = new THREE.TorusGeometry(1, .045, 4, 24);
export function detailBatch(parent) {
  const groups = new Map(), object = new THREE.Object3D();
  const add = (geo, mat, pos, scale, rot = [0, 0, 0]) => {
    const key = geo.uuid + mat.uuid;
    if (!groups.has(key)) groups.set(key, { geo, mat, matrices: [] });
    object.position.set(...pos); object.scale.set(...scale); object.rotation.set(...rot); object.updateMatrix();
    groups.get(key).matrices.push(object.matrix.clone());
  };
  return {
    box: (size, pos, mat = SURFACE.extrusion, rot) => add(boxGeo, mat, pos, size, rot),
    bolt: (pos, r = 4, axis = 'y') => add(boltGeo, MAT.steel, pos, [r, r * .8, r], axis === 'z' ? [Math.PI / 2, 0, 0] : axis === 'x' ? [0, 0, Math.PI / 2] : [0, 0, 0]),
    ring: (pos, r) => add(ringGeo, MAT.steelDark, pos, [r, r, r], [Math.PI / 2, 0, 0]),
    flush() {
      for (const { geo, mat, matrices } of groups.values()) {
        const m = new THREE.InstancedMesh(geo, mat, matrices.length);
        matrices.forEach((matrix, i) => m.setMatrixAt(i, matrix));
        m.userData.detailBatch = true; m.castShadow = m.receiveShadow = true; parent.add(m);
      }
    },
  };
}

export function addDetails({ belt, vision, robot, frame, bins, L }) {
  const b = L.belt, v = L.vision, f = L.frame, a = L.arm;
  const vb = detailBatch(vision), fb = detailBatch(frame), rb = detailBatch(robot), bb = detailBatch(bins);
  // 懸臂頂部雙斜撐；全部位於既有相機及燈具之上。
  block(vision, [6, 24, 26], [-817, 1722, -728], SURFACE.support);
  for (const x of [-735, -665]) rod(vision, [-810, 1722, -728], [x, 1687, -175], 7, SURFACE.support, 8);
  // 雙軌端蓋保留第一段的 10 mm 厚度與 Z 135 外緣；相機細節由共用相機模型提供。
  for (const x of [v.x - 80, v.x + 80]) {
    block(vision, [43, 116, 10], [x, v.beamY, 130], SURFACE.sheet);
    for (const side of [-1, 1]) for (const dy of [-30, 30])
      vb.box([1.4, 5, 830], [x + side * 23.6, v.beamY + dy, -307], MAT.steelDark);
  }
  // 視窗密封膠條安置於玻璃與外框之間，不與透明面重合。
  const [wx, wz] = v.windowSize;
  for (const s of [-1, 1]) {
    vb.box([wx + 12, 10, 6], [v.x, v.windowY, b.z + s * (wz / 2 + 5)], MAT.black);
    vb.box([6, 10, wz - 4], [v.x + s * (wx / 2 + 5), v.windowY, b.z], MAT.black);
  }
  decal(vision, 210, 19, [v.x, v.windowY + 14.5, b.z + wz / 2 + 20], [-Math.PI / 2, 0, 0], '光學防汙視窗（示意）', { center: true, color: '#233542', bg: '#ccd5da' });

  // 立柱細溝槽：批次窄槽面貼在柱外側，間距大於重合面門檻。
  for (const px of [-f.postX, f.postX]) for (const pz of f.postZ) for (const offset of [-12, 12]) {
    fb.box([3, 1640, 1.2], [px + offset, 850, pz + (pz < 0 ? 31.2 : -31.2)], MAT.steelDark);
    fb.box([1.2, 1640, 3], [px + Math.sign(px) * 31.2, 850, pz + offset], MAT.steelDark);
  }
  // 兩端護板框保留主帶／分流帶穿越口，僅補上半部外框。
  for (const px of [-f.postX, f.postX]) {
    for (const pz of [-682, 622]) fb.box([18, 790, 18], [px, 1310, pz]);
    for (const y of [911, 1715]) fb.box([18, 18, 1280], [px, y, -30]);
  }
  // 立座四面三角肋板，薄板位於底部且不增加手臂動件。
  const [pw, pd] = a.pedestal;
  for (let i = 0; i < 4; i++) {
    const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(24, 0); shape.lineTo(0, 165); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 7, bevelEnabled: false }); geo.translate(0, 0, -3.5);
    const m = new THREE.Mesh(geo, SURFACE.support), ang = i * Math.PI / 2;
    m.rotation.y = ang;
    m.position.set(a.x + Math.cos(ang) * (i % 2 ? pd / 2 : pw / 2), 23, a.z - Math.sin(ang) * (i % 2 ? pd / 2 : pw / 2));
    m.castShadow = true; robot.add(m);
  }
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
    rb.box([24, 3, 24], [a.x + dx * 190, 22.5, a.z + dz * 150], SURFACE.support);
    rb.bolt([a.x + dx * 190, 27, a.z + dz * 150], 7);
  }
  // 收料箱翻邊及底部叉孔面板：開口以分段實體構成。
  for (const key of ['A', 'B']) {
    const bn = L['bin' + key], [w, h, d] = L.bin;
    for (const s of [-1, 1]) {
      bb.box([w + 12, 12, 28], [bn.x, h + 45, bn.z + s * (d / 2 - 9)], SURFACE.sheet);
      bb.box([28, 12, d - 66], [bn.x + s * (w / 2 - 9), h + 45, bn.z], SURFACE.sheet);
      for (const dx of [-285, 0, 285]) bb.box([dx ? 78 : 174, 16, 18], [bn.x + dx, 9, bn.z + s * (d / 2 - 12)], SURFACE.sheet);
    }
  }
  vb.flush(); fb.flush(); rb.flush(); bb.flush();
  // 方向資訊放在地坪操作面，避開帶上工件與出料落點。
  const arrows = new THREE.Group(); arrows.name = 'outfeed directions'; arrows.userData.fx = true; frame.parent.add(arrows);
  floorText(arrows, '← A 食品 HDPE', -430, 870, 620, 100, { fg: '#80cfd0', y: 7 });
  floorText(arrows, 'B 非食品 HDPE →', 480, 870, 620, 100, { fg: '#edac82', y: 7 });
}

export function createLightPatch(parent, v, b) {
  const n = 64, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot((x - 31.5) / 31.5, (y - 31.5) / 31.5);
    data.set([218, 243, 255, Math.max(0, 1 - r) ** 2 * 40], (y * n + x) * 4);
  }
  const map = new THREE.DataTexture(data, n, n); map.needsUpdate = true; map.magFilter = THREE.LinearFilter;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(430, 550), new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(v.x, b.top + 1, b.z);
  mesh.userData.fx = true; parent.add(mesh); return mesh;
}
