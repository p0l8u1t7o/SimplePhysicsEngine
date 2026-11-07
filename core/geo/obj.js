// OBJ 實景網格匯入（core 1.20.0）：空拍重建軟體（OpenDroneMap 的 odm_textured_model_geo.obj、Pix4D、DJI Terra）輸出的貼圖網格。
//
// 為什麼不用 three.js 的 OBJLoader：重建網格常用投影座標（TWD97、UTM，數十萬公尺），OBJLoader 直接讀成 Float32，
// 有效位數只有 7 位，50 萬公尺的座標只剩約 3～6 cm 的解析度。這裡用 float64 讀，先減掉案場原點、再轉成每塊相對塊中心的 Float32
// （和 terrain.js、las.js 的分塊作法相同），所以精度只看塊的大小。
//
//   const obj = readOBJ(text, { offset: [E0, N0, H0] })   // offset：檔案座標要加上的偏移（ODM 的 odm_georeferencing_model_geo.txt 等）
//   const mtl = readMTL(mtlText)                            // { 材質名: { map_Kd, Kd, d } }
//   const mesh = createOBJMesh(obj, site, { up: 'z', materials: mtl, textures: { 'odm_textured_model_geo_material0000_map_Kd.png': tex } })
//   scene.add(mesh.root)                                    // root.userData.geo = 'mesh'、noBom
//
// 檔案座標的軸：up = 'z'（預設，投影座標 x = E、y = N、z = H，地理參考網格的慣例）、'y'（一般 3D 軟體 Y 朝上，x = E、−z = N）、
// 或 local: true（不經 site.fromMap，單位 m、Y 朝上，直接乘 1000 變 mm）。支援 v、vt、f（v、v/vt、v//vn、v/vt/vn，負索引，多邊形扇形三角化）、
// usemtl、mtllib；法向量一律重算（vn 忽略）、o／g／s 忽略。
import * as THREE from 'three';

const num = s => +s;

/**
 * @param {string} text OBJ 文字
 * @param {{ offset?: number[] }} [o] 每個頂點加上 offset（檔案座標，常見於 ODM 把大座標拆成偏移＋小座標）
 * @returns {{ positions: Float64Array, uvs: Float64Array|null, groups: { material: string|null, indices: Uint32Array, uvIndices: Uint32Array|null }[], mtllib: string[], bounds: { min, max }, stats }}
 */
export function readOBJ(text, { offset = [0, 0, 0] } = {}) {
  const P = [], T = [], groups = [], mtllib = [];
  let cur = null, faces = 0, polys = 0;
  const group = name => { cur = groups.find(g => g.material === name); if (!cur) { cur = { material: name, v: [], t: [] }; groups.push(cur); } };
  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    while (line.endsWith('\\') && li + 1 < lines.length) line = line.slice(0, -1) + ' ' + lines[++li];   // 續行
    const s = line.trim(); if (!s || s[0] === '#') continue;
    const sp = s.indexOf(' '), key = sp < 0 ? s : s.slice(0, sp), rest = sp < 0 ? '' : s.slice(sp + 1).trim();
    if (key === 'v') { const a = rest.split(/\s+/); P.push(num(a[0]) + offset[0], num(a[1]) + offset[1], num(a[2]) + offset[2]); }
    else if (key === 'vt') { const a = rest.split(/\s+/); T.push(num(a[0]), num(a[1] ?? 0)); }
    else if (key === 'f') {
      if (!cur) group(null);
      const vs = rest.split(/\s+/).map(tok => { const [a, b] = tok.split('/'); const vi = +a, ti = b ? +b : 0; return [vi < 0 ? P.length / 3 + vi : vi - 1, ti === 0 ? -1 : ti < 0 ? T.length / 2 + ti : ti - 1]; });
      if (vs.length < 3) continue;
      if (vs.length > 3) polys++;
      for (let k = 1; k + 1 < vs.length; k++) for (const q of [vs[0], vs[k], vs[k + 1]]) { cur.v.push(q[0]); cur.t.push(q[1]); }
      faces++;
    }
    else if (key === 'usemtl') group(rest || null);
    else if (key === 'mtllib') mtllib.push(...rest.split(/\s+/));
  }
  const positions = Float64Array.from(P), n = positions.length / 3;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = positions[3 * i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  const out = groups.filter(g => g.v.length).map(g => {
    const bad = g.v.findIndex(i => i < 0 || i >= n);
    if (bad >= 0) throw new Error(`readOBJ：面的頂點索引超出範圍（${g.v[bad] + 1}，共 ${n} 個頂點）`);
    const hasUV = T.length && g.t.every(i => i >= 0);
    return { material: g.material, indices: Uint32Array.from(g.v), uvIndices: hasUV ? Uint32Array.from(g.t) : null };
  });
  return { positions, uvs: T.length ? Float64Array.from(T) : null, groups: out, mtllib, bounds: { min, max }, stats: { vertices: n, faces, polygons: polys, triangles: out.reduce((s, g) => s + g.indices.length / 3, 0) } };
}

/** MTL：{ 材質名: { Kd: [r, g, b], map_Kd: 檔名, d: 不透明度 } }（其他欄位忽略） */
export function readMTL(text) {
  const out = {}; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim(); if (!s || s[0] === '#') continue;
    const sp = s.indexOf(' '), key = sp < 0 ? s : s.slice(0, sp), rest = sp < 0 ? '' : s.slice(sp + 1).trim();
    if (key === 'newmtl') { cur = out[rest] = {}; continue; }
    if (!cur) continue;
    if (key === 'Kd') cur.Kd = rest.split(/\s+/).map(Number);
    else if (key === 'd') cur.d = +rest;
    else if (key === 'Tr') cur.d = 1 - +rest;
    else if (key === 'map_Kd') cur.map_Kd = rest.split(/\s+/).pop();        // 選項（-s、-o …）在前，檔名在最後
  }
  return out;
}

/**
 * OBJ → three.js 分塊網格（案場座標 mm）。每塊依平面位置分格（chunk mm），頂點相對塊中心存成 Float32，塊的位置放在 mesh.position。
 * @param obj readOBJ 的結果
 * @param site createSiteFrame 的結果（local: true 時可省略）
 * @param o { up = 'z' | 'y', local = false, chunk = 50000（mm）, materials（readMTL）, textures（{ 檔名: THREE.Texture }）, material（覆寫全部）, name = 'reality-mesh' }
 * @returns {{ root, chunks, bounds（案場 mm）, stats }}
 */
export function createOBJMesh(obj, site, { up = 'z', local = false, chunk = 50000, materials = {}, textures = {}, material = null, name = 'reality-mesh' } = {}) {
  const n = obj.positions.length / 3, S = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = obj.positions[3 * i], b = obj.positions[3 * i + 1], c = obj.positions[3 * i + 2];
    if (local) { S[3 * i] = a * 1000; S[3 * i + 1] = b * 1000; S[3 * i + 2] = c * 1000; continue; }
    const p = up === 'y' ? site.fromMap(a, -c, b) : site.fromMap(a, b, c);
    S[3 * i] = p.x; S[3 * i + 1] = p.y; S[3 * i + 2] = p.z;
  }
  const root = new THREE.Group(); root.name = name;
  root.userData.geo = 'mesh'; root.userData.noBom = '現場實景網格（空拍重建）';
  const matCache = new Map();
  const matOf = key => {
    if (material) return material;
    if (matCache.has(key)) return matCache.get(key);
    const m = materials[key] || {}, map = m.map_Kd ? textures[m.map_Kd] || null : null;
    if (map) map.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : new THREE.Color(...(m.Kd || [0.62, 0.64, 0.58])), roughness: 0.95, metalness: 0, side: THREE.DoubleSide,
      transparent: m.d != null && m.d < 1, opacity: m.d ?? 1 });
    matCache.set(key, mat); return mat;
  };
  const chunks = [], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let tris = 0;
  for (const g of obj.groups) {
    // 依三角形重心的平面格子分塊
    const cells = new Map();
    for (let f = 0; f < g.indices.length; f += 3) {
      const i0 = g.indices[f], i1 = g.indices[f + 1], i2 = g.indices[f + 2];
      const cx = (S[3 * i0] + S[3 * i1] + S[3 * i2]) / 3, cz = (S[3 * i0 + 2] + S[3 * i1 + 2] + S[3 * i2 + 2]) / 3;
      const key = `${Math.floor(cx / chunk)},${Math.floor(cz / chunk)}`;
      let list = cells.get(key); if (!list) cells.set(key, list = []); list.push(f);
    }
    for (const [key, faces] of [...cells].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) {
      // 塊中心：用三角形頂點的包圍盒中心，頂點相對它存
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const f of faces) for (let k = 0; k < 3; k++) { const i = g.indices[f + k]; for (let d = 0; d < 3; d++) { const v = S[3 * i + d]; if (v < lo[d]) lo[d] = v; if (v > hi[d]) hi[d] = v; } }
      const c = lo.map((v, d) => (v + hi[d]) / 2);
      for (let d = 0; d < 3; d++) { min[d] = Math.min(min[d], lo[d]); max[d] = Math.max(max[d], hi[d]); }
      // 有索引的頂點：同一個（頂點, 貼圖座標）只存一次，法向量才會在相鄰三角形間平滑
      const remap = new Map(), pos = [], uvs = [], idx = new Uint32Array(faces.length * 3), hasUV = !!g.uvIndices;
      faces.forEach((f, j) => {
        for (let k = 0; k < 3; k++) {
          const i = g.indices[f + k], t = hasUV ? g.uvIndices[f + k] : 0, key = hasUV ? `${i}/${t}` : i;
          let v = remap.get(key);
          if (v === undefined) {
            v = pos.length / 3; remap.set(key, v);
            pos.push(S[3 * i] - c[0], S[3 * i + 1] - c[1], S[3 * i + 2] - c[2]);
            if (hasUV) uvs.push(obj.uvs[2 * t], obj.uvs[2 * t + 1]);
          }
          idx[3 * j + k] = v;
        }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      if (hasUV) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
      geo.setIndex(new THREE.BufferAttribute(pos.length / 3 > 65535 ? idx : Uint16Array.from(idx), 1));
      geo.computeVertexNormals(); geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, matOf(g.material));
      mesh.name = `${name} ${g.material ?? '-'} ${key}`; mesh.position.set(c[0], c[1], c[2]);
      mesh.receiveShadow = true; mesh.castShadow = true; mesh.userData.geo = 'mesh';
      root.add(mesh); chunks.push(mesh); tris += faces.length;
    }
  }
  return { root, chunks, bounds: { min, max }, stats: { ...obj.stats, chunks: chunks.length, triangles: tris } };
}
