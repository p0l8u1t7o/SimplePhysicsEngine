// 本站填裝頭加工件；供料軟管只在 e／sx 改變時更新實例矩陣，不重建幾何。
import * as THREE from 'three';
import { MAT, finished } from '@core/geom/materials.js';
import { HAS_DOM } from '@core/geom/shapes.js';
import { weighIndicator } from '@core/models/equipment-process.js';
import { detailBoxes } from './render-details.js';

const steel = finished(MAT.steel, 'metal');
const rubber = new THREE.MeshStandardMaterial({ color: 0x263c47, roughness: .76 });
const unitTube = new THREE.CylinderGeometry(1, 1, 1, 10);
const up = new THREE.Vector3(0, 1, 0);
const SEGMENTS = 20;

function instances(parent, name, geometry, material, count) {
  const m = new THREE.InstancedMesh(geometry, material, count);
  m.name = name; m.userData.renderDetail = true;
  m.castShadow = false; m.receiveShadow = true; parent.add(m); return m;
}

// 滑座保留原外框，西側開槽讓側接頭通過；導套背部圓弧與側翼保持原 90×380×90 外框。
export function openCarriageGeometry() {
  const shape = new THREE.Shape();
  [[-150, -570], [600, -570], [600, 330], [-150, 330], [-150, 235], [52, 235], [52, 165], [-150, 165]]
    .forEach(([x, z], i) => i ? shape.lineTo(x, -z) : shape.moveTo(x, -z));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 60, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2); geo.translate(-225, -30, 120); return geo;
}

export function openGuideGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-45, -45); shape.lineTo(0, -45);
  shape.absarc(0, 0, 45, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(-45, 45); shape.lineTo(-45, 36); shape.lineTo(0, 36);
  shape.absarc(0, 0, 36, Math.PI / 2, -Math.PI / 2, true);
  shape.lineTo(-45, -36); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 380, bevelEnabled: false, curveSegments: 8 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, -190, 0); return geo;
}

// 數字共用一張圖集；每格只在整公斤讀值改變時重畫，沒有逐幀產生材質。
export function createWeightAtlas() {
  const canvas = HAS_DOM ? document.createElement('canvas') : null;
  if (canvas) { canvas.width = 512; canvas.height = 512; }
  const ctx = canvas?.getContext('2d'), texture = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (texture) { texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter; }
  const values = Array(16).fill(undefined), material = new THREE.MeshBasicMaterial({ color: 0xffffff, map: texture });
  return {
    material, values,
    set(index, kg) {
      const value = kg == null ? null : Math.round(Math.max(0, Math.min(200, kg)));
      if (values[index] === value) return;
      values[index] = value;
      if (!ctx) return;
      const x = index % 2 * 256, y = Math.floor(index / 2) * 64;
      ctx.fillStyle = '#071d24'; ctx.fillRect(x, y, 256, 64);
      ctx.fillStyle = '#b1c5cd'; ctx.font = '14px sans-serif';
      ctx.fillText(`L${Math.floor(index / 4) + 1}.${index % 4 + 1}  NET kg / SIM`, x + 9, y + 17);
      ctx.fillStyle = value == null ? '#698b96' : '#88f0bb'; ctx.font = 'bold 36px monospace';
      ctx.fillText(value == null ? '---' : String(value).padStart(3, ' '), x + 70, y + 53);
      texture.needsUpdate = true;
    },
  };
}

export function createFillingHardware(parent, x, lineIndex, fill, top, heads, atlas) {
  const matrix = new THREE.Matrix4(), quat = new THREE.Quaternion(), pos = new THREE.Vector3(), scale = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), delta = new THREE.Vector3();
  const writeTube = (mesh, i, from, to, radius) => {
    a.fromArray(from); b.fromArray(to); delta.subVectors(b, a);
    quat.setFromUnitVectors(up, delta.clone().normalize());
    pos.copy(a).add(b).multiplyScalar(.5); scale.set(radius, delta.length(), radius);
    mesh.setMatrixAt(i, matrix.compose(pos, quat, scale));
  };
  const hose = instances(parent, `L${lineIndex + 1} flexible supply hoses`, unitTube, rubber, heads.length * SEGMENTS);
  hose.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // 管路在原門架上方，最後一段銜接既有 IBC 供液管端（y=2660）。
  const header = instances(parent, 'overhead fill manifold', unitTube, steel, 4);
  writeTube(header, 0, [x, 2660, 5060], [x, 2620, 5060], 26);
  writeTube(header, 1, [x, 2620, 5060], [x - 330, 2620, 5060], 26);
  writeTube(header, 2, [x - 330, 2620, 5060], [x - 330, 2880, 5060], 26);
  writeTube(header, 3, [x - 330, 2880, 5060], [x - 330, 2880, fill.frame[1] - 50], 26);
  header.instanceMatrix.needsUpdate = true;

  heads.forEach((h, i) => {
    // 閥、先導缸與接頭都屬於原升降槍管，外徑小於開槽導套內徑。
    const metal = instances(h.lance, 'lance valve and pneumatic fittings', unitTube, steel, 7);
    writeTube(metal, 0, [0, 1000, 0], [0, 1072, 0], 30);
    writeTube(metal, 1, [-220, 1036, 0], [-25, 1036, 0], 16);
    writeTube(metal, 2, [-222, 1036, 0], [-205, 1036, 0], 23);
    writeTube(metal, 3, [0, 1072, 0], [0, 1094, 0], 8);
    writeTube(metal, 4, [0, 1094, 0], [0, 1164, 0], 24);
    writeTube(metal, 5, [0, 1164, 0], [0, 1172, 0], 29);
    writeTube(metal, 6, [0, 900, 0], [0, 1000, 0], 14);
    metal.instanceMatrix.needsUpdate = true;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(34, 17, 36, 16), MAT.black);
    cone.name = 'lance sealing cone'; cone.position.y = 82; h.lance.add(cone);
    h.lance.userData.fillHardware = true;
    atlas.set(lineIndex * 4 + i, null);
  });

  const teeth = [], hangers = [];
  // 滾輪中心由 filling.belt 的相同 pitch 推算；梳齒只佔兩輥間 40 mm。
  const rollerStart = fill.distZ + 420 + 60;
  for (const z of fill.pos) {
    for (let gap = rollerStart + 60; gap < fill.collectZ - 420; gap += 120) {
      if (Math.abs(gap - z) < 270) teeth.push([[620, 58, 40], [x, top - 34, gap]]);
    }
    hangers.push([[35, 195, 35], [x - 330, 2762.5, z + 550]]);
    hangers.push([[220, 25, 50], [x - 440, 2652.5, z + 550]]);
  }
  detailBoxes(parent, 'weighing comb decks', teeth, steel).castShadow = false;
  detailBoxes(parent, 'manifold support brackets', hangers, MAT.steelDark).castShadow = false;

  // 使用 core 指示器的殼體與短支柱，固定在既有備蓋盒支柱上；朝東側走道與 L1 近景顯示。
  const indicator = weighIndicator.create({ height: 250, size: [48, 180, 320], post: [24, 200] });
  indicator.root.updateMatrixWorld(true);
  indicator.root.traverse(o => {
    if (!o.isMesh) return;
    const batch = instances(parent, `fill weight indicator ${o === indicator.screen ? 'case' : 'post'}`, o.geometry, o.material, 4);
    fill.pos.forEach((z, i) => {
      matrix.makeTranslation(x - 480, 1300, z - 420).multiply(o.matrixWorld); batch.setMatrixAt(i, matrix);
    });
    batch.userData.coreModel = 'weigh-indicator'; batch.instanceMatrix.needsUpdate = true;
  });
  const positions = [], uv = [];
  fill.pos.forEach((z, i) => {
    const n = lineIndex * 4 + i, u0 = n % 2 / 2, u1 = u0 + .5, v1 = 1 - Math.floor(n / 2) / 8, v0 = v1 - .125;
    const corners = [[x - 455, 1470, z - 275], [x - 455, 1470, z - 565], [x - 455, 1630, z - 565], [x - 455, 1630, z - 275]];
    const tex = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (const k of [0, 1, 2, 0, 2, 3]) { positions.push(...corners[k]); uv.push(...tex[k]); }
  });
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.computeVertexNormals();
  const display = new THREE.Mesh(geo, atlas.material); display.name = 'fill weight readouts'; parent.add(display);

  const previous = heads.map(() => [NaN, NaN]);
  const curves = heads.map(() => new THREE.CatmullRomCurve3(Array.from({ length: 6 }, () => new THREE.Vector3()), false, 'centripetal'));
  let updates = 0;
  return {
    hose, previous, get updates() { return updates; },
    setHead(i, e, sx) {
      if (previous[i][0] === e && previous[i][1] === sx) return;
      previous[i] = [e, sx]; updates++;
      const h = heads[i], z = fill.pos[i] + 200, endX = h.head.position.x - 224, endY = h.lance.position.y + 1036;
      const points = [[x - 330, 2880, z], [x - 330, 3060, z], [x - 450, 3070, z], [endX - 210, Math.max(2730, endY + 180), z], [endX - 110, endY, z], [endX - 50, endY, z]];
      points.forEach((p, k) => curves[i].points[k].fromArray(p));
      const samples = curves[i].getPoints(SEGMENTS - 1);
      for (let k = 0; k < SEGMENTS - 1; k++) writeTube(hose, i * SEGMENTS + k, samples[k].toArray(), samples[k + 1].toArray(), 17);
      writeTube(hose, i * SEGMENTS + SEGMENTS - 1, [endX - 50, endY, z], [endX, endY, z], 17);
      hose.instanceMatrix.needsUpdate = true; hose.computeBoundingSphere();
    },
  };
}
