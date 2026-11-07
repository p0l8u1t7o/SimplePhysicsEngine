// 射線遮陰：三角形 BVH（自寫、決定性）、逐片／逐旁路二極體區段的遮陰比例、地平線輪廓、天空視角因子、太陽位置分箱快取。
// 座標：X 東、Y 上、Z 南（右手系），長度單位不限（場景用 mm）；太陽向量是「從地面指向太陽」的單位向量（spa.js 的 sunVector）。
// 決定性：只用 Float64 運算與固定順序（無亂數、無 Map 疊代順序依賴）；同一組三角形建出的樹逐位元相同。
// 不依賴 three.js：BufferGeometry 以鴨子型別讀取（attributes.position.array、index.array、matrixWorld.elements）。
import * as dm from '../math/dmath.js';

// ---------------------------------------------------------------- 三角形收集
// 三角形清單：positions（每個三角形 9 個數）、owners（每個三角形的擁有者編號，例如板片編號；-1 = 一般遮擋物）
export function createTriangleList() {
  const pos = [], own = [];
  return {
    positions: pos, owners: own,
    get count() { return own.length; },
    add(ax, ay, az, bx, by, bz, cx, cy, cz, owner = -1) { pos.push(ax, ay, az, bx, by, bz, cx, cy, cz); own.push(owner); },
    // 四邊形 p0→p1→p2→p3（兩個三角形）
    addQuad(p0, p1, p2, p3, owner = -1) {
      this.add(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], owner);
      this.add(p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], owner);
    },
    // three.js BufferGeometry（或同形狀的物件）＋ 4×4 欄主序矩陣（Matrix4.elements）
    addGeometry(geometry, matrix = null, owner = -1) {
      const P = geometry.attributes.position, a = P.array, st = P.itemSize ?? 3, idx = geometry.index ? geometry.index.array : null;
      const off = P.offset ?? 0, stride = P.data?.stride ?? st;   // InterleavedBufferAttribute
      const n = idx ? idx.length : P.count ?? a.length / stride, e = matrix && (matrix.elements || matrix);
      const v = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i + 2 < n; i += 3) {
        for (let k = 0; k < 3; k++) {
          const vi = (idx ? idx[i + k] : i + k) * stride + off;
          const x = a[vi], y = a[vi + 1], z = a[vi + 2];
          if (e) { v[k * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]; v[k * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; v[k * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]; }
          else { v[k * 3] = x; v[k * 3 + 1] = y; v[k * 3 + 2] = z; }
        }
        this.add(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], owner);
      }
    },
    // three.js 物件樹：呼叫前請先 root.updateMatrixWorld(true)。owner(mesh) 回傳擁有者編號；filter(mesh) 為 false 的略過
    // InstancedMesh：每個實例 = matrixWorld × instanceMatrix，owner(mesh, instanceIndex)
    addObject(root, { owner = () => -1, filter = m => m.visible !== false } = {}) {
      const meshes = [];
      (function walk(o) { if (o.isMesh && o.geometry && filter(o)) meshes.push(o); for (const c of o.children || []) walk(c); })(root);
      const M = new Float64Array(16);
      for (const m of meshes) {
        if (m.isInstancedMesh && m.instanceMatrix) {
          const W = m.matrixWorld.elements, A = m.instanceMatrix.array;
          for (let k = 0; k < m.count; k++) { mul4(W, A, k * 16, M); this.addGeometry(m.geometry, M, owner(m, k)); }
        } else this.addGeometry(m.geometry, m.matrixWorld, owner(m, -1));
      }
    },
  };
}

// 4×4 欄主序矩陣乘法 out = a × b（b 從 bo 起算）
function mul4(a, b, bo, out) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    out[c * 4 + r] = a[r] * b[bo + c * 4] + a[4 + r] * b[bo + c * 4 + 1] + a[8 + r] * b[bo + c * 4 + 2] + a[12 + r] * b[bo + c * 4 + 3];
  return out;
}

// ---------------------------------------------------------------- BVH
/**
 * 建立 BVH（分箱 SAH，12 箱、三軸）。
 * @param {ArrayLike<number>} positions 9n 個數
 * @param {ArrayLike<number>} owners n 個擁有者編號（可省略）
 * @returns BVH 物件：anyHit、raycast、refit、stats
 */
export function buildBVH(positions, owners = null, { leafSize = 4, bins = 12 } = {}) {
  const n = Math.floor(positions.length / 9);
  const tri = new Float64Array(n * 9), own = new Int32Array(n), order = new Int32Array(n);
  const cen = new Float64Array(n * 3), tb = new Float64Array(n * 6);
  for (let i = 0; i < n; i++) {
    order[i] = i;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const x = positions[i * 9 + k * 3], y = positions[i * 9 + k * 3 + 1], z = positions[i * 9 + k * 3 + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    tb[i * 6] = x0; tb[i * 6 + 1] = y0; tb[i * 6 + 2] = z0; tb[i * 6 + 3] = x1; tb[i * 6 + 4] = y1; tb[i * 6 + 5] = z1;
    cen[i * 3] = (x0 + x1) / 2; cen[i * 3 + 1] = (y0 + y1) / 2; cen[i * 3 + 2] = (z0 + z1) / 2;
  }
  const maxNodes = Math.max(1, 2 * n);
  const box = new Float64Array(maxNodes * 6), first = new Int32Array(maxNodes), count = new Int32Array(maxNodes), axisOf = new Uint8Array(maxNodes);
  // first：葉節點 = 三角形起點；內部節點 = 左子節點編號（右子 = 左 + 1）。count：葉節點的三角形數，內部 = 0
  let nodes = 1;
  const binCnt = new Int32Array(bins), binBox = new Float64Array(bins * 6), rightArea = new Float64Array(bins), rightCnt = new Int32Array(bins);
  const stack = [[0, 0, n]];
  const area = (x0, y0, z0, x1, y1, z1) => { const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0; return dx * dy + dy * dz + dz * dx; };
  while (stack.length) {
    const [ni, s, e] = stack.pop();
    let bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
    let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
    for (let i = s; i < e; i++) {
      const t = order[i], b = t * 6, c = t * 3;
      if (tb[b] < bx0) bx0 = tb[b]; if (tb[b + 1] < by0) by0 = tb[b + 1]; if (tb[b + 2] < bz0) bz0 = tb[b + 2];
      if (tb[b + 3] > bx1) bx1 = tb[b + 3]; if (tb[b + 4] > by1) by1 = tb[b + 4]; if (tb[b + 5] > bz1) bz1 = tb[b + 5];
      if (cen[c] < cx0) cx0 = cen[c]; if (cen[c] > cx1) cx1 = cen[c]; if (cen[c + 1] < cy0) cy0 = cen[c + 1]; if (cen[c + 1] > cy1) cy1 = cen[c + 1];
      if (cen[c + 2] < cz0) cz0 = cen[c + 2]; if (cen[c + 2] > cz1) cz1 = cen[c + 2];
    }
    box.set([bx0, by0, bz0, bx1, by1, bz1], ni * 6);
    const cnt = e - s;
    const makeLeaf = () => { first[ni] = s; count[ni] = cnt; };
    if (cnt <= leafSize) { makeLeaf(); continue; }
    // 分箱 SAH：三軸各試 bins−1 個切點
    let bestCost = Infinity, bestAxis = -1, bestSplit = -1;
    const cmin = [cx0, cy0, cz0], cext = [cx1 - cx0, cy1 - cy0, cz1 - cz0];
    for (let ax = 0; ax < 3; ax++) {
      if (!(cext[ax] > 0)) continue;
      binCnt.fill(0); for (let k = 0; k < bins; k++) binBox.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], k * 6);
      const sc = bins / cext[ax];
      for (let i = s; i < e; i++) {
        const t = order[i]; let k = Math.floor((cen[t * 3 + ax] - cmin[ax]) * sc); if (k >= bins) k = bins - 1;
        binCnt[k]++; const b = t * 6, o = k * 6;
        if (tb[b] < binBox[o]) binBox[o] = tb[b]; if (tb[b + 1] < binBox[o + 1]) binBox[o + 1] = tb[b + 1]; if (tb[b + 2] < binBox[o + 2]) binBox[o + 2] = tb[b + 2];
        if (tb[b + 3] > binBox[o + 3]) binBox[o + 3] = tb[b + 3]; if (tb[b + 4] > binBox[o + 4]) binBox[o + 4] = tb[b + 4]; if (tb[b + 5] > binBox[o + 5]) binBox[o + 5] = tb[b + 5];
      }
      let rx0 = Infinity, ry0 = Infinity, rz0 = Infinity, rx1 = -Infinity, ry1 = -Infinity, rz1 = -Infinity, rc = 0;
      for (let k = bins - 1; k > 0; k--) {
        const o = k * 6; rc += binCnt[k];
        if (binCnt[k]) { rx0 = Math.min(rx0, binBox[o]); ry0 = Math.min(ry0, binBox[o + 1]); rz0 = Math.min(rz0, binBox[o + 2]); rx1 = Math.max(rx1, binBox[o + 3]); ry1 = Math.max(ry1, binBox[o + 4]); rz1 = Math.max(rz1, binBox[o + 5]); }
        rightCnt[k] = rc; rightArea[k] = rc ? area(rx0, ry0, rz0, rx1, ry1, rz1) : 0;
      }
      let lx0 = Infinity, ly0 = Infinity, lz0 = Infinity, lx1 = -Infinity, ly1 = -Infinity, lz1 = -Infinity, lc = 0;
      for (let k = 0; k < bins - 1; k++) {
        const o = k * 6; lc += binCnt[k];
        if (binCnt[k]) { lx0 = Math.min(lx0, binBox[o]); ly0 = Math.min(ly0, binBox[o + 1]); lz0 = Math.min(lz0, binBox[o + 2]); lx1 = Math.max(lx1, binBox[o + 3]); ly1 = Math.max(ly1, binBox[o + 4]); lz1 = Math.max(lz1, binBox[o + 5]); }
        if (!lc || !rightCnt[k + 1]) continue;
        const cost = lc * area(lx0, ly0, lz0, lx1, ly1, lz1) + rightCnt[k + 1] * rightArea[k + 1];
        if (cost < bestCost) { bestCost = cost; bestAxis = ax; bestSplit = k; }
      }
    }
    const leafCost = cnt * area(bx0, by0, bz0, bx1, by1, bz1);
    if (bestAxis < 0 || (bestCost >= leafCost && cnt <= 16)) {
      if (bestAxis < 0 && cnt > 16) {   // 質心全部重合：依序對半切
        const mid = s + (cnt >> 1), l = nodes; nodes += 2; first[ni] = l; count[ni] = 0; axisOf[ni] = 0;
        stack.push([l + 1, mid, e], [l, s, mid]); continue;
      }
      makeLeaf(); continue;
    }
    // 依切點分割（就地、決定性）
    const sc = bins / cext[bestAxis];
    let i = s, j = e - 1;
    while (i <= j) {
      let k = Math.floor((cen[order[i] * 3 + bestAxis] - cmin[bestAxis]) * sc); if (k >= bins) k = bins - 1;
      if (k <= bestSplit) i++; else { const t = order[i]; order[i] = order[j]; order[j] = t; j--; }
    }
    const l = nodes; nodes += 2; first[ni] = l; count[ni] = 0; axisOf[ni] = bestAxis;
    stack.push([l + 1, i, e], [l, s, i]);
  }
  // 依葉節點順序重排三角形
  const fill = src => { for (let i = 0; i < n; i++) { const t = order[i]; for (let k = 0; k < 9; k++) tri[i * 9 + k] = src[t * 9 + k]; } };
  fill(positions);
  for (let i = 0; i < n; i++) own[i] = owners ? owners[order[i]] : -1;
  const stk = new Int32Array(128);

  // 射線與三角形（Möller–Trumbore，雙面）；回傳 t 或 Infinity
  function hitTri(i, ox, oy, oz, dx, dy, dz, tMin, tMax) {
    const p = i * 9;
    const ax = tri[p], ay = tri[p + 1], az = tri[p + 2];
    const e1x = tri[p + 3] - ax, e1y = tri[p + 4] - ay, e1z = tri[p + 5] - az;
    const e2x = tri[p + 6] - ax, e2y = tri[p + 7] - ay, e2z = tri[p + 8] - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det === 0) return Infinity;   // 射線與三角形平行（近平行時 u、v 自然落在範圍外）
    const inv = 1 / det, tx = ox - ax, ty = oy - ay, tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) return Infinity;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) return Infinity;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t > tMin && t < tMax ? t : Infinity;
  }
  // 射線與節點包圍盒（slab）；回傳進入距離或 Infinity
  function hitBox(ni, ox, oy, oz, ix, iy, iz, tMax) {
    const b = ni * 6;
    let t0 = (box[b] - ox) * ix, t1 = (box[b + 3] - ox) * ix; if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
    let u0 = (box[b + 1] - oy) * iy, u1 = (box[b + 4] - oy) * iy; if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
    if (u0 > t0) t0 = u0; if (u1 < t1) t1 = u1;
    let w0 = (box[b + 2] - oz) * iz, w1 = (box[b + 5] - oz) * iz; if (w0 > w1) { const t = w0; w0 = w1; w1 = t; }
    if (w0 > t0) t0 = w0; if (w1 < t1) t1 = w1;
    return t1 >= t0 && t1 >= 0 && t0 <= tMax ? t0 : Infinity;
  }
  const inv = d => 1 / (d !== 0 ? d : 1e-300);   // 分量為 0 時避免 0×∞ = NaN

  const bvh = {
    count: n, get nodeCount() { return nodes; },
    /** 是否被擋（陰影射線）。skipOwner：略過這個擁有者的三角形（板片自己）；tMin 起點偏移 */
    anyHit(ox, oy, oz, dx, dy, dz, tMax = Infinity, skipOwner = -2, tMin = 1e-6) {
      if (!n) return false;
      const ix = inv(dx), iy = inv(dy), iz = inv(dz);
      let sp = 0; stk[sp++] = 0;
      while (sp) {
        const ni = stk[--sp];
        if (hitBox(ni, ox, oy, oz, ix, iy, iz, tMax) === Infinity) continue;
        const c = count[ni];
        if (c) {
          for (let i = first[ni], e = i + c; i < e; i++) if (own[i] !== skipOwner && hitTri(i, ox, oy, oz, dx, dy, dz, tMin, tMax) !== Infinity) return true;
        } else {
          const l = first[ni], ax = axisOf[ni], d = ax === 0 ? dx : ax === 1 ? dy : dz;
          if (d > 0) { stk[sp++] = l + 1; stk[sp++] = l; } else { stk[sp++] = l; stk[sp++] = l + 1; }
        }
      }
      return false;
    },
    /** 最近交點：{ t, tri（原始三角形編號）, owner } 或 null */
    raycast(ox, oy, oz, dx, dy, dz, tMax = Infinity, skipOwner = -2, tMin = 1e-6) {
      if (!n) return null;
      const ix = inv(dx), iy = inv(dy), iz = inv(dz);
      let best = tMax, bi = -1, sp = 0; stk[sp++] = 0;
      while (sp) {
        const ni = stk[--sp];
        if (hitBox(ni, ox, oy, oz, ix, iy, iz, best) === Infinity) continue;
        const c = count[ni];
        if (c) {
          for (let i = first[ni], e = i + c; i < e; i++) {
            if (own[i] === skipOwner) continue;
            const t = hitTri(i, ox, oy, oz, dx, dy, dz, tMin, best);
            if (t < best || (t === best && t !== Infinity && i < bi)) { best = t; bi = i; }
          }
        } else {
          const l = first[ni], ax = axisOf[ni], d = ax === 0 ? dx : ax === 1 ? dy : dz;
          if (d > 0) { stk[sp++] = l + 1; stk[sp++] = l; } else { stk[sp++] = l; stk[sp++] = l + 1; }
        }
      }
      return bi < 0 ? null : { t: best, tri: order[bi], owner: own[bi] };
    },
    /** 三角形移動後（例如追日轉動）重算包圍盒，不改樹的拓撲；positions 用原始順序 */
    refit(newPositions) {
      fill(newPositions);
      for (let ni = nodes - 1; ni >= 0; ni--) {
        const b = ni * 6;
        if (count[ni]) {
          let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
          for (let i = first[ni] * 9, e = (first[ni] + count[ni]) * 9; i < e; i += 3) {
            const x = tri[i], y = tri[i + 1], z = tri[i + 2];
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
          }
          box[b] = x0; box[b + 1] = y0; box[b + 2] = z0; box[b + 3] = x1; box[b + 4] = y1; box[b + 5] = z1;
        } else {
          const l = first[ni] * 6, r = l + 6;
          for (let k = 0; k < 3; k++) { box[b + k] = Math.min(box[l + k], box[r + k]); box[b + 3 + k] = Math.max(box[l + 3 + k], box[r + 3 + k]); }
        }
      }
    },
    stats() { let leaves = 0, maxLeaf = 0; for (let i = 0; i < nodes; i++) if (count[i]) { leaves++; if (count[i] > maxLeaf) maxLeaf = count[i]; } return { triangles: n, nodes, leaves, maxLeaf }; },
  };
  return bvh;
}

// ---------------------------------------------------------------- 板片與旁路二極體區段
/**
 * 板片的取樣點。板面是平行四邊形：角點 o、長邊向量 a、短邊向量 b（法向 = a × b 正規化，指向受光面）。
 * @param m { o, a, b, owner = -1, samples = [12, 6]（沿 a、沿 b 的取樣格數；預設 72 片電池一格一點）,
 *            diodes = 3（旁路二極體數，沿 b 方向等分成長條；直式 60／72 片板的常見接法）,
 *            halfCut = false（半片板：每個二極體區段沿 a 分上下兩半並聯）, diodeAxis = 'b' }
 */
export function moduleLayout(m) {
  const { o, a, b, samples = [12, 6], diodes = 3, halfCut = false, diodeAxis = 'b' } = m;
  const [na, nb] = samples;
  let nx = a[1] * b[2] - a[2] * b[1], ny = a[2] * b[0] - a[0] * b[2], nz = a[0] * b[1] - a[1] * b[0];
  const nl = dm.hypot3(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
  const pts = new Float64Array(na * nb * 3), group = new Int32Array(na * nb);
  const groups = diodes * (halfCut ? 2 : 1);
  for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) {
    const u = (i + 0.5) / na, v = (j + 0.5) / nb, k = i * nb + j;
    pts[k * 3] = o[0] + a[0] * u + b[0] * v; pts[k * 3 + 1] = o[1] + a[1] * u + b[1] * v; pts[k * 3 + 2] = o[2] + a[2] * u + b[2] * v;
    const along = diodeAxis === 'b' ? v : u, across = diodeAxis === 'b' ? u : v;
    const d = Math.min(diodes - 1, Math.floor(along * diodes));
    group[k] = halfCut ? d * 2 + (across < 0.5 ? 0 : 1) : d;
  }
  return { points: pts, group, groups, diodes, halfCut, normal: [nx, ny, nz], owner: m.owner ?? -1, count: na * nb };
}

/**
 * 單片板的遮陰。
 * @returns {{ area, blocks: Float64Array(diodes) }}
 *   area：被遮的取樣點比例（面積比例，線性模型用）；
 *   blocks[k]：第 k 個二極體區段的直達光可用比例 0～1（串聯電池以最暗的一格為準；半片板兩半並聯取平均）。
 *   太陽在板背面時 area = 1、blocks 全為 0。
 */
export function shadeModule(bvh, layout, sun, { eps = 1, horizon = null, sunAngles = null, out = null } = {}) {
  const { points, group, groups, diodes, halfCut, normal, owner, count } = layout;
  const blocks = out || new Float64Array(diodes);
  const cosI = normal[0] * sun[0] + normal[1] * sun[1] + normal[2] * sun[2];
  if (cosI <= 0 || (horizon && sunAngles && horizon.blocks(sunAngles.zenith, sunAngles.azimuth))) { blocks.fill(0); return { area: 1, blocks }; }
  // 每個群組（串聯段）的取樣點數與被遮點數：最暗格 = 群組內是否有被遮的點（取樣點代表一片電池）
  const tot = new Int32Array(groups), hit = new Int32Array(groups);
  let shaded = 0;
  for (let k = 0; k < count; k++) {
    const x = points[k * 3] + normal[0] * eps, y = points[k * 3 + 1] + normal[1] * eps, z = points[k * 3 + 2] + normal[2] * eps;
    const g = group[k]; tot[g]++;
    if (bvh.anyHit(x, y, z, sun[0], sun[1], sun[2], Infinity, owner)) { hit[g]++; shaded++; }
  }
  for (let d = 0; d < diodes; d++) {
    if (halfCut) blocks[d] = ((hit[2 * d] ? 0 : 1) + (hit[2 * d + 1] ? 0 : 1)) / 2;
    else blocks[d] = hit[d] ? 0 : 1;
  }
  return { area: shaded / count, blocks };
}

// 批次：所有板片，回傳 { area: Float64Array(n), blocks: Float64Array(n × diodes) }
export function shadeModules(bvh, layouts, sun, opts = {}) {
  const n = layouts.length, d = n ? layouts[0].diodes : 0;
  const area = new Float64Array(n), blocks = new Float64Array(n * d);
  for (let i = 0; i < n; i++) {
    const r = shadeModule(bvh, layouts[i], sun, { ...opts, out: blocks.subarray(i * d, i * d + d) });
    area[i] = r.area;
  }
  return { area, blocks, diodes: d };
}

// ---------------------------------------------------------------- 地平線
/**
 * 地平線輪廓：profile = [[方位角, 高度角], ...]（度，方位由北順時針；不需等距，會依方位排序後循環線性內插）。
 * blocks(zenith, azimuth)：太陽高度低於地平線時為 true。
 */
export function createHorizon(profile) {
  const p = profile.map(([a, e]) => [((a % 360) + 360) % 360, e]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const az = p.map(q => q[0]), el = p.map(q => q[1]), n = p.length;
  function elevation(a) {
    if (!n) return 0;
    a = ((a % 360) + 360) % 360;
    let i = 0; while (i < n && az[i] <= a) i++;
    const i0 = (i - 1 + n) % n, i1 = i % n;
    const a0 = az[i0], a1 = az[i1] + (i1 <= i0 ? 360 : 0), aa = a < a0 ? a + 360 : a;
    return a1 === a0 ? el[i0] : el[i0] + (el[i1] - el[i0]) * (aa - a0) / (a1 - a0);
  }
  return { profile: p, elevation, blocks: (zenith, azimuth) => 90 - zenith < elevation(azimuth) };
}
/**
 * 由 BVH（地形、建物）算某點的地平線輪廓：每個方位二分搜尋最高被擋的高度角。
 * 對高度場（地形）而言被擋與否隨高度角單調，二分有效；懸空物（雲、橋）不適用。
 */
export function horizonFromBVH(bvh, point, { azStep = 2, maxElevation = 60, tol = 0.01, skipOwner = -2, lift = 1 } = {}) {
  const out = [], D = Math.PI / 180, [px, py, pz] = point;
  for (let a = 0; a < 360 - 1e-9; a += azStep) {
    const blocked = e => bvh.anyHit(px, py + lift, pz, dm.cos(e * D) * dm.sin(a * D), dm.sin(e * D), -dm.cos(e * D) * dm.cos(a * D), Infinity, skipOwner);
    let lo = 0, hi = maxElevation;
    if (!blocked(lo)) { out.push([a, 0]); continue; }
    if (blocked(hi)) { out.push([a, hi]); continue; }
    while (hi - lo > tol) { const m = (lo + hi) / 2; if (blocked(m)) lo = m; else hi = m; }
    out.push([a, (lo + hi) / 2]);
  }
  return out;
}

// ---------------------------------------------------------------- 天空視角因子（散射遮蔽）
/**
 * 斜面上一點看得到的天空比例（相對於同傾角、無遮擋時的等向天空），用於縮減等向散射。
 * 取樣：板面半球的餘弦加權 Fibonacci 螺線（決定性），只計向上（y > 0）的方向。
 * @returns {number} 0～1
 */
export function skyViewFactor(bvh, point, normal, { n = 256, skipOwner = -2, eps = 1, horizon = null } = {}) {
  const [nx, ny, nz] = normal;
  // 切線基底
  const h = Math.abs(ny) < 0.9 ? [0, 1, 0] : [1, 0, 0];   // 輔助軸 → 切線 t = h × n
  const tr = [h[1] * nz - h[2] * ny, h[2] * nx - h[0] * nz, h[0] * ny - h[1] * nx], tl = dm.hypot3(tr[0], tr[1], tr[2]);
  const t = [tr[0] / tl, tr[1] / tl, tr[2] / tl];
  const bt = [ny * t[2] - nz * t[1], nz * t[0] - nx * t[2], nx * t[1] - ny * t[0]];
  const ox = point[0] + nx * eps, oy = point[1] + ny * eps, oz = point[2] + nz * eps;
  const golden = Math.PI * (3 - Math.sqrt(5));
  let open = 0, up = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n), phi = i * golden, c = Math.sqrt(1 - r * r);
    const dx = t[0] * r * dm.cos(phi) + bt[0] * r * dm.sin(phi) + nx * c;
    const dy = t[1] * r * dm.cos(phi) + bt[1] * r * dm.sin(phi) + ny * c;
    const dz = t[2] * r * dm.cos(phi) + bt[2] * r * dm.sin(phi) + nz * c;
    if (dy <= 0) continue;
    up++;
    if (horizon) { const el = dm.asin(Math.min(1, dy)) / (Math.PI / 180), az = ((dm.atan2(dx, -dz) / (Math.PI / 180)) + 360) % 360; if (el < horizon.elevation(az)) continue; }
    if (!bvh.anyHit(ox, oy, oz, dx, dy, dz, Infinity, skipOwner)) open++;
  }
  return up ? open / up : 0;
}

// ---------------------------------------------------------------- 太陽位置分箱快取
/**
 * 依太陽（天頂角、方位角）分箱快取遮陰結果；每箱只在箱中心計算一次，結果與呼叫順序無關（決定性）。
 * evaluate(binZenith, binAzimuth, binIndex) → 任意結果。
 * zenStep 度、azStep 度；箱中心 = ((i + 0.5)·zenStep, (j + 0.5)·azStep)。
 */
export function createSunBinCache(evaluate, { zenStep = 1, azStep = 2 } = {}) {
  const nAz = Math.round(360 / azStep), cache = new Map();
  let evaluations = 0;
  return {
    index(zenith, azimuth) { const i = Math.floor(zenith / zenStep), j = Math.floor((((azimuth % 360) + 360) % 360) / azStep) % nAz; return i * nAz + j; },
    center(idx) { const i = Math.floor(idx / nAz), j = idx % nAz; return { zenith: (i + 0.5) * zenStep, azimuth: (j + 0.5) * azStep }; },
    get(zenith, azimuth) {
      const k = this.index(zenith, azimuth);
      let v = cache.get(k);
      if (v === undefined) { const c = this.center(k); v = evaluate(c.zenith, c.azimuth, k); cache.set(k, v); evaluations++; }
      return v;
    },
    get size() { return cache.size; }, get evaluations() { return evaluations; },
  };
}
