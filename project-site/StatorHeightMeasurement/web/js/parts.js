// 工件幾何（分割式定子齒、轉子）與整盒工件（每列一個 InstancedMesh，列可單獨頂升）。
// 工件本地座標：底面在 y=0、頂面在 y=h；定子軛在 +z、齒靴在 −z。
import * as THREE from 'three';
import { slot } from './spec.js';
import { punchedFace } from './finishes.js';

// 疊片側面：細橫紋（1 uv＝1 mm，兩道明暗＝約 0.5 mm 一片），DataTexture 不需要 DOM
function stackTexture() {
  const h = 8, data = new Uint8Array(4 * h);
  for (let i = 0; i < h; i++) { const v = [115, 185, 224, 231, 218, 208, 193, 160][i]; data.set([v, v, v, 255], i * 4); }
  const tex = new THREE.DataTexture(data, 1, h); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.y = 2; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}
let MATS = null;
export function partMaterials() {
  if (MATS) return MATS;
  const tex = stackTexture();
  MATS = {
    cap: new THREE.MeshStandardMaterial({ color: 0xd2d7dc, roughness: .3, metalness: .85, map: punchedFace, roughnessMap: punchedFace }),    // 沖切面：亮銀與淺凹鉚接痕
    side: new THREE.MeshStandardMaterial({ color: 0x62636a, roughness: .48, metalness: .72, map: tex, roughnessMap: tex }),   // 疊片側面：深灰帶紋
    ng: new THREE.MeshStandardMaterial({ color: 0xd8483f, roughness: .5, metalness: .3, emissive: 0x5a0f0b, emissiveIntensity: .6 }),
  };
  return MATS;
}

function statorShape(p) {
  const [yw, yt] = p.yoke, [sw] = p.stem, [tw, tt] = p.tip, L = p.len / 2;
  const s = new THREE.Shape([
    [-tw / 2, -L], [tw / 2, -L], [tw / 2, -L + tt], [sw / 2, -L + tt], [sw / 2, L - yt], [yw / 2, L - yt], [yw / 2, L],
    [-yw / 2, L], [-yw / 2, L - yt], [-sw / 2, L - yt], [-sw / 2, -L + tt], [-tw / 2, -L + tt],
  ].map(([x, y]) => new THREE.Vector2(x, y)));
  return s;
}
function rotorShape(p) {
  const R = p.d / 2, s = new THREE.Shape(); s.absarc(0, 0, R, 0, Math.PI * 2, false);
  const hole = (cx, cy, r) => { const q = new THREE.Path(); q.absarc(cx, cy, r, 0, Math.PI * 2, true); return q; };
  s.holes.push(hole(0, 0, p.bore / 2));
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; s.holes.push(hole(Math.cos(a) * 12.5, Math.sin(a) * 12.5, 2.6)); }
  return s;
}

const GEO = new Map();
export function partGeometry(p) {
  if (GEO.has(p.key)) return GEO.get(p.key);
  const shape = p.key === 'rotor' ? rotorShape(p) : statorShape(p);
  // 頂底各 0.3 mm 倒角：讓沖切面的高光邊看得出來
  const geo = new THREE.ExtrudeGeometry(shape, { depth: p.h - .6, bevelEnabled: true, bevelThickness: .3, bevelSize: .3, bevelSegments: 1, curveSegments: p.key === 'rotor' ? 40 : 4 });
  // 只改端面 UV；側面仍保留每毫米取樣，疊片線距不隨工件大小改變。
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (const g of geo.groups) if (g.materialIndex === 0) for (let i = g.start; i < g.start + g.count; i++) {
    uv.setXY(i, (pos.getX(i) / 48 + .5) * .5 + (p.key === 'rotor' ? .5 : 0), pos.getY(i) / 48 + .5);
  }
  geo.translate(0, 0, .3); geo.rotateX(-Math.PI / 2);   // 擠出方向 → +y；形狀 y → −z（再轉 180° 讓軛朝 +z）
  geo.rotateY(Math.PI); geo.computeVertexNormals(); geo.computeBoundingBox();
  GEO.set(p.key, geo);
  return geo;
}

export function partMesh(p, name = 'part') {
  const M = partMaterials(), m = new THREE.Mesh(partGeometry(p), [M.cap, M.side]);
  m.name = name; m.castShadow = true; m.receiveShadow = true; return m;
}

// 整盒工件：group 原點＝盒內底面（或基準板面）中心。inverted：翻盒後頂面朝下（繞 X 翻 180°：z → −z）。
// set({ from, to, hide, lift, ng }) 只顯示 [from, to) 且不在 hide 裡的格位；lift[r] 為該列頂升量；ng 集合的格位畫成紅色（量測結果）。
export function createLoad(p, { inverted = false, name = 'load', ngMark = false } = {}) {
  const g = p.grid, M = partMaterials(), geo = partGeometry(p);
  const group = new THREE.Group(); group.name = name;
  const rows = [], marks = [];
  const zero = new THREE.Matrix4().makeScale(0, 0, 0), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  for (let r = 0; r < g.rows; r++) {
    const rg = new THREE.Group(); rg.name = `${name} row ${r + 1}`; rg.position.z = (inverted ? -1 : 1) * slot(p, r * g.cols).z; group.add(rg);
    const inst = new THREE.InstancedMesh(geo, [M.cap, M.side], g.cols); inst.name = `${name} parts`; inst.castShadow = inst.receiveShadow = true;
    inst.frustumCulled = false; rg.add(inst); rows.push(rg);
    if (ngMark) { const mk = new THREE.InstancedMesh(geo, M.ng, g.cols); mk.name = `${name} NG`; mk.frustumCulled = false; mk.count = 0; rg.add(mk); marks.push(mk); }
  }
  function matrixOf(i) {
    const s = slot(p, i); e.set(0, s.rot, 0); q.setFromEuler(e);
    if (inverted) q.premultiply(flip);
    return m4.compose(new THREE.Vector3(s.x, inverted ? p.h : 0, 0), q, new THREE.Vector3(1, 1, 1));
  }
  let key = '';
  function set({ from = 0, to = g.rows * g.cols, hide = null, lift = null, ng = null } = {}) {
    rows.forEach((rg, r) => { rg.position.y = lift?.[r] ?? 0; });          // 頂升量每次直接設定（不進快取鍵，倒播才一致）
    const k = `${from}|${to}|${hide ? [...hide].join(',') : ''}|${ng ? [...ng].join(',') : ''}`;
    if (k === key) return; key = k;
    rows.forEach((rg, r) => {
      const inst = rg.children[0]; let n = 0;
      for (let c = 0; c < g.cols; c++) {
        const i = r * g.cols + c, on = i >= from && i < to && !hide?.has(i);
        inst.setMatrixAt(c, on && !ng?.has(i) ? matrixOf(i) : zero);
        if (marks[r]) { if (on && ng?.has(i)) marks[r].setMatrixAt(n++, matrixOf(i)); }
      }
      inst.instanceMatrix.needsUpdate = true;
      if (marks[r]) { marks[r].count = n; marks[r].instanceMatrix.needsUpdate = true; }
    });
  }
  set();
  return { group, rows, set };
}
