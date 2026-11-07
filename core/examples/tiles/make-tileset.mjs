// 產生範例頁用的合成 3D Tiles（不是空拍資料）：案場原點附近 200 m × 200 m 的起伏地形＋一棟 12 m 高的建物，一個 glb 圖磚。
// 圖磚座標是 ECEF（根節點的 transform＝原點的 ENU → ECEF），高程是橢球高＝正高＋大地起伏 N（範例取 20 m）。
//   node --import ./core/tools/register.mjs core/examples/tiles/make-tileset.mjs   → core/examples/tiles/data/
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { twd97, createSiteFrame, geodeticToECEF } from '../../geo/coords.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'data');
export const SITE = { crs: 'TWD97', origin: { E: 182000, N: 2543000, H: 30 } }, GEOID = 20;
const site = createSiteFrame({ crs: twd97(), origin: SITE.origin });
const { lat, lon, H } = site.origin, D = Math.PI / 180;

// ENU → ECEF（column-major 4×4），原點在 (lat, lon, H + N)
const o = geodeticToECEF(lat, lon, H + GEOID), p = lat * D, l = lon * D;
const E = [-Math.sin(l), Math.cos(l), 0], Nn = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)], U = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
const transform = [...E, 0, ...Nn, 0, ...U, 0, o.x, o.y, o.z, 1];

// 地形（ENU，公尺）：和結構範例同一個形狀，加一棟方形建物
const shape = (e, n) => 0.7 * Math.sin(e * 1000 / 9000) + 0.45 * Math.cos(-n * 1000 / 6500 + .7) + .025 * e - .03 * -n;
const S = 100, step = 4, nx = 2 * S / step + 1, pos = [], col = [], idx = [];
for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
  const e = -S + i * step, n = -S + j * step, u = shape(e, n);
  pos.push(e, u, -n);                                                      // glTF 是 Y 朝上：(東, 上, −北)
  const g = 0.45 + 0.15 * Math.sin(i * 0.7) * Math.cos(j * 0.5); col.push(0.42 * g + 0.2, 0.55 * g + 0.2, 0.30 * g + 0.15);
}
for (let j = 0; j < nx - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i; idx.push(a, a + 1, a + nx, a + 1, a + nx + 1, a + nx); }   // 逆時針朝上（glTF 的 z 是 −北）
// 建物：東 40 m、北 30 m，12 × 18 m、高 12 m（底面埋進地形 1 m）
const box = (ce, cn, w, d, h0, h1, c) => {
  const b = pos.length / 3, P = [[-w, -d], [w, -d], [w, d], [-w, d]];
  for (const z of [h0, h1]) for (const [x, y] of P) { pos.push(ce + x, z, -(cn + y)); col.push(...c); }
  const f = [[0, 1, 5, 0, 5, 4], [1, 2, 6, 1, 6, 5], [2, 3, 7, 2, 7, 6], [3, 0, 4, 3, 4, 7], [4, 5, 6, 4, 6, 7]];
  for (const q of f) idx.push(...q.map(k => b + k));
};
const g0 = shape(40, 30); box(40, 30, 6, 9, g0 - 1, g0 + 12, [0.78, 0.76, 0.72]);

function glb(positions, colors, indices) {
  const P = new Float32Array(positions), C = new Float32Array(colors), I = new Uint32Array(indices);
  const min = [0, 1, 2].map(k => Math.min(...P.filter((_, i) => i % 3 === k))), max = [0, 1, 2].map(k => Math.max(...P.filter((_, i) => i % 3 === k)));
  const bin = Buffer.concat([Buffer.from(P.buffer), Buffer.from(C.buffer), Buffer.from(I.buffer)]);
  const json = {
    asset: { version: '2.0', generator: 'SimplePhysicsEngine core/examples/tiles（合成資料）' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: P.byteLength, target: 34962 }, { buffer: 0, byteOffset: P.byteLength, byteLength: C.byteLength, target: 34962 }, { buffer: 0, byteOffset: P.byteLength + C.byteLength, byteLength: I.byteLength, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: P.length / 3, type: 'VEC3', min, max }, { bufferView: 1, componentType: 5126, count: C.length / 3, type: 'VEC3' }, { bufferView: 2, componentType: 5125, count: I.length, type: 'SCALAR' }],
  };
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
  const pad = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + pad.length, 8);
  jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4); bh.writeUInt32LE(pad.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, js, bh, pad]);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'terrain.glb'), glb(pos, col, idx));
// 包圍盒在圖磚座標（Z 朝上，經 transform 之前）：中心、三個半軸
const tileset = { asset: { version: '1.0', generator: '合成資料（make-tileset.mjs）' }, geometricError: 50,
  root: { transform, boundingVolume: { box: [0, 0, 5, S + 5, 0, 0, 0, S + 5, 0, 0, 0, 15] }, geometricError: 0, refine: 'REPLACE', content: { uri: 'terrain.glb' } } };
writeFileSync(join(OUT, 'tileset.json'), JSON.stringify(tileset, null, 1) + '\n');
console.log(`${OUT}：terrain.glb（${pos.length / 3} 個頂點、${idx.length / 3} 個三角形）、tileset.json（原點 ${lat.toFixed(6)}, ${lon.toFixed(6)}，N = ${GEOID} m）`);
