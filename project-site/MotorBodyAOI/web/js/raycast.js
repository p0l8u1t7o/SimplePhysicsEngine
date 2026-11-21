// 射線遮擋檢查：三角形湯＋均勻格點（3D DDA）＋Möller–Trumbore。純數學，網頁與 tools/ 共用。
// 用途：工件座標下，檢測點 → 相機（或光源）的線段是否被工件本身或夾爪擋住。

// tri：Float32Array，每個三角形 9 個數（三個頂點 xyz）；ids：每個三角形的來源編號（自我遮擋排除用，-1 表示夾爪等外加物）
export function createRaycaster(tri, { cell = 2.5 } = {}) {
  const n = tri.length / 9, min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (let i = 0; i < tri.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], tri[i + k]); max[k] = Math.max(max[k], tri[i + k]); }
  for (let k = 0; k < 3; k++) { min[k] -= .01; max[k] += .01; }
  const dim = [0, 1, 2].map(k => Math.max(1, Math.ceil((max[k] - min[k]) / cell)));
  const cellOf = (v, k) => Math.min(dim[k] - 1, Math.max(0, Math.floor((v - min[k]) / cell)));
  // 每格的三角形清單（以三角形外框登記，保守）
  const lists = new Map();
  for (let t = 0; t < n; t++) {
    const o = t * 9, lo = [0, 1, 2].map(k => cellOf(Math.min(tri[o + k], tri[o + 3 + k], tri[o + 6 + k]), k)), hi = [0, 1, 2].map(k => cellOf(Math.max(tri[o + k], tri[o + 3 + k], tri[o + 6 + k]), k));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const key = (x * dim[1] + y) * dim[2] + z; let l = lists.get(key); if (!l) lists.set(key, l = []); l.push(t);
    }
  }
  const stamp = new Uint32Array(n); let gen = 0;

  // Möller–Trumbore：回傳 0 < t < tMax 的交點參數，沒有交點回傳 Infinity
  function hitTri(t, o, d, tMax) {
    const b = t * 9;
    const e1x = tri[b + 3] - tri[b], e1y = tri[b + 4] - tri[b + 1], e1z = tri[b + 5] - tri[b + 2];
    const e2x = tri[b + 6] - tri[b], e2y = tri[b + 7] - tri[b + 1], e2z = tri[b + 8] - tri[b + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) return Infinity;
    const inv = 1 / det, sx = o[0] - tri[b], sy = o[1] - tri[b + 1], sz = o[2] - tri[b + 2];
    const u = (sx * px + sy * py + sz * pz) * inv; if (u < 0 || u > 1) return Infinity;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) return Infinity;
    const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return tt > 1e-6 && tt < tMax ? tt : Infinity;
  }

  // 線段 o → o + d·len（d 為單位向量）是否被擋；skip(t) 為 true 的三角形不算（例如起點所在的三角形）
  function blocked(o, d, len, skip) {
    // 先把線段裁到格點外框內
    let t0 = 0, t1 = len;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-12) { if (o[k] < min[k] || o[k] > max[k]) return false; continue; }
      let a = (min[k] - o[k]) / d[k], b = (max[k] - o[k]) / d[k]; if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return false;
    }
    gen++;
    const p = [0, 1, 2].map(k => o[k] + d[k] * t0), c = [0, 1, 2].map(k => cellOf(p[k], k));
    const step = d.map(v => v > 0 ? 1 : v < 0 ? -1 : 0);
    const tNext = [0, 1, 2].map(k => step[k] === 0 ? Infinity : (min[k] + (c[k] + (step[k] > 0 ? 1 : 0)) * cell - o[k]) / d[k]);
    const tDelta = [0, 1, 2].map(k => step[k] === 0 ? Infinity : cell / Math.abs(d[k]));
    for (let guard = 0; guard < 10000; guard++) {
      const l = lists.get((c[0] * dim[1] + c[1]) * dim[2] + c[2]);
      if (l) for (const t of l) {
        if (stamp[t] === gen) continue; stamp[t] = gen;
        if (skip && skip(t)) continue;
        if (hitTri(t, o, d, len) < Infinity) return true;
      }
      const k = tNext[0] < tNext[1] ? (tNext[0] < tNext[2] ? 0 : 2) : (tNext[1] < tNext[2] ? 1 : 2);
      if (tNext[k] > t1) return false;
      c[k] += step[k]; if (c[k] < 0 || c[k] >= dim[k]) return false;
      tNext[k] += tDelta[k];
    }
    return false;
  }
  return { blocked, count: n, dim };
}

// 方塊 → 12 個三角形（center、三個半軸向量 ax/ay/az，皆為工件座標）
export function boxTriangles(center, ax, ay, az) {
  const P = (sx, sy, sz) => [0, 1, 2].map(k => center[k] + sx * ax[k] + sy * ay[k] + sz * az[k]);
  const v = [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
  const F = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return F.flatMap(([a, b, c, d]) => [...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]]);
}
