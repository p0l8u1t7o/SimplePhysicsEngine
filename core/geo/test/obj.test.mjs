// OBJ 實景網格（core/geo/obj.js）：解析、三角化、負索引、MTL、大座標精度、分塊
import test from 'node:test';
import assert from 'node:assert/strict';
import { twd97, createSiteFrame } from '../coords.js';
import { readOBJ, readMTL, createOBJMesh } from '../obj.js';

const E0 = 182345.123, N0 = 2543210.456, H0 = 35.2;
const site = createSiteFrame({ crs: twd97(), origin: { E: E0, N: N0, H: H0 } });
// 3×3 頂點的起伏網格（間距 10 m），左半一個四邊形面（多邊形）、右半三角形＋負索引，兩種材質
function sampleOBJ() {
  const L = ['# 合成的地理參考網格（x = E、y = N、z = H）', 'mtllib site.mtl'];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) L.push(`v ${(E0 - 10 + i * 10).toFixed(3)} ${(N0 - 10 + j * 10).toFixed(3)} ${(H0 + 0.37 * i - 0.21 * j + 0.004 * i * j).toFixed(4)}`);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) L.push(`vt ${i / 2} ${j / 2}`);
  const v = (i, j) => j * 3 + i + 1;
  L.push('usemtl ground');
  L.push(`f ${v(0, 0)}/${v(0, 0)} ${v(1, 0)}/${v(1, 0)} ${v(1, 1)}/${v(1, 1)} ${v(0, 1)}/${v(0, 1)}`);   // 四邊形
  L.push(`f ${v(0, 1)}/${v(0, 1)} ${v(1, 1)}/${v(1, 1)} ${v(1, 2)}/${v(1, 2)} ${v(0, 2)}/${v(0, 2)}`);
  L.push('usemtl roof');
  L.push(`f ${v(1, 0)}/${v(1, 0)}/1 ${v(2, 0)}/${v(2, 0)}/1 ${v(2, 1)}/${v(2, 1)}/1`);
  L.push('f -8/-8 -4/-4 -5/-5');   // 負索引（−n 是倒數第 n 個，共 9 個頂點）：頂點 2、6、5
  L.push(`f ${v(1, 1)} ${v(2, 1)} ${v(2, 2)} ${v(1, 2)}`);   // 沒有貼圖座標的面（這組就不輸出 uv）
  return L.join('\n');
}

test('解析：多邊形扇形三角化、負索引、材質分組、包圍盒', () => {
  const o = readOBJ(sampleOBJ());
  assert.equal(o.stats.vertices, 9);
  assert.equal(o.stats.faces, 5);
  assert.equal(o.stats.polygons, 3);
  assert.equal(o.stats.triangles, 2 * 2 + 1 + 1 + 2);
  assert.deepEqual(o.groups.map(g => g.material), ['ground', 'roof']);
  assert.deepEqual([...o.groups[1].indices.slice(3, 6)], [1, 5, 4], '負索引換成正確的 0 起算索引');
  assert.equal(o.groups[0].uvIndices.length, 12);
  assert.equal(o.groups[1].uvIndices, null, '同組有面沒有貼圖座標時不輸出 uv');
  assert.deepEqual(o.mtllib, ['site.mtl']);
  assert.ok(Math.abs(o.bounds.min[0] - (E0 - 10)) < 1e-9 && Math.abs(o.bounds.max[1] - (N0 + 10)) < 1e-9);
  assert.throws(() => readOBJ('v 0 0 0\nv 1 0 0\nf 1 2 7'), /超出範圍/);
});

test('大座標：分塊後的 Float32 頂點還原到 0.01 mm；直接用 Float32 存投影座標會差到公分以上', () => {
  const o = readOBJ(sampleOBJ()), m = createOBJMesh(o, site, { chunk: 12000 });
  assert.ok(m.chunks.length >= 3, `分成 ${m.chunks.length} 塊`);
  assert.equal(m.stats.triangles, o.stats.triangles);
  assert.equal(m.root.userData.geo, 'mesh');
  let worst = 0;
  for (const c of m.chunks) {
    const P = c.geometry.attributes.position.array;
    for (let k = 0; k < P.length; k += 3) {
      const x = P[k] + c.position.x, y = P[k + 1] + c.position.y, z = P[k + 2] + c.position.z;
      // 找最近的原始頂點（案場座標）比對
      let best = Infinity;
      for (let i = 0; i < 9; i++) { const q = site.fromMap(o.positions[3 * i], o.positions[3 * i + 1], o.positions[3 * i + 2]); best = Math.min(best, Math.hypot(q.x - x, q.y - y, q.z - z)); }
      worst = Math.max(worst, best);
    }
  }
  assert.ok(worst < 0.01, `還原誤差 ${worst} mm`);
  const naive = Math.abs(Math.fround(N0 + 10) - (N0 + 10));
  assert.ok(naive > 0.01, `Float32 直接存北距的誤差 ${naive} m`);
});

test('軸向：up = y 時 −z 是北；local 直接把公尺換成 mm', () => {
  const o = readOBJ(`v ${E0 + 3} ${H0 + 2} ${-(N0 + 5)}\nv ${E0 + 4} ${H0 + 2} ${-(N0 + 5)}\nv ${E0 + 3} ${H0 + 2} ${-(N0 + 6)}\nf 1 2 3`);
  const m = createOBJMesh(o, site, { up: 'y' }), c = m.chunks[0], P = c.geometry.attributes.position.array;
  const q = site.fromMap(E0 + 3, N0 + 5, H0 + 2);
  assert.ok(Math.hypot(P[0] + c.position.x - q.x, P[1] + c.position.y - q.y, P[2] + c.position.z - q.z) < 0.01);
  const l = createOBJMesh(readOBJ('v 1 2 3\nv 2 2 3\nv 1 2 4\nf 1 2 3'), null, { local: true });
  assert.deepEqual([...l.bounds.min], [1000, 2000, 3000]);
});

test('MTL：顏色、透明度、貼圖檔名（前面的選項略過）；找不到貼圖時用 Kd 顏色', () => {
  const mtl = readMTL('newmtl ground\nKd 0.5 0.6 0.4\nmap_Kd -s 1 1 1 ground_tex.png\nnewmtl glass\nKd 0.2 0.3 0.4\nd 0.4\n');
  assert.deepEqual(mtl.ground, { Kd: [0.5, 0.6, 0.4], map_Kd: 'ground_tex.png' });
  assert.equal(mtl.glass.d, 0.4);
  const m = createOBJMesh(readOBJ(sampleOBJ()), site, { materials: mtl });
  const g = m.chunks.find(c => /ground/.test(c.name)).material;
  assert.equal(g.map, null);
  assert.ok(Math.abs(g.color.r - 0.5) < 1e-6);
});
