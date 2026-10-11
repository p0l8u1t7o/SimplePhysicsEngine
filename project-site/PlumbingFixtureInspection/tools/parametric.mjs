// 參數化產品網格（沒有 CAD 時的示範件；正式導入時換成客戶 CAD 或首件 3D 掃描）。
// 輸出與 CAD 轉檔相同的格式：positions（mm，產品座標 +Y 為安裝軸、夾持端 y = 0）、index、face（每個三角形的面群組）。
// faceKinds：面群組預先指定的遮罩種類（螺牙、起泡器網面），其餘交給規劃器自動判斷。

// 鵝頸出水管（鏡面鉻；J 形彎管，高約 356 mm）：接管端螺牙 → 六角座 → 錐形座 → 直管 → R85 彎 180° → 下彎段 → 起泡器
export function gooseneck({ seg = 28 } = {}) {
  const R = 85, tubeR = 11, rise = 260, drop = 60;
  const path = [];                                                // { c:[x,y], t:[tx,ty], r, face }
  const line = (x, y0, y1, r, face, n, ripple = 0) => {
    for (let i = 0; i <= n; i++) { const y = y0 + (y1 - y0) * i / n; path.push({ c: [x, y], t: [0, Math.sign(y1 - y0)], r: typeof r === 'function' ? r(y) : r, face, ripple }); }
  };
  line(0, 0, 30, 11, 0, 40, .45);                                 // 接管端 G1/2 螺牙（夾持區）
  line(0, 30.01, 45, 16, 1, 3);                                   // 六角座（畫成圓柱）
  line(0, 45.01, 60, y => 16 - (y - 45) / 15 * 4.5, 2, 6);       // 錐形座
  line(0, 60.01, rise, tubeR, 3, 40);                             // 直管
  for (let i = 1; i <= 48; i++) {                                 // 彎管：圓心 (R, rise)，從 180° 轉到 0°
    const a = Math.PI - Math.PI * i / 48;
    path.push({ c: [R + R * Math.cos(a), rise + R * Math.sin(a)], t: [Math.sin(a), -Math.cos(a)], r: tubeR, face: 3 });
  }
  line(2 * R, rise - .01, rise - drop, tubeR, 3, 12);             // 下彎段
  line(2 * R, rise - drop - .01, rise - drop - 26, 12.5, 4, 8);   // 起泡器外殼
  const positions = [], index = [], face = [];
  const ring = [];
  path.forEach((p, k) => {
    const [tx, ty] = p.t, nx = ty, ny = -tx;                      // 法向量（彎管平面 XY 內），副法向量 = Z
    const start = positions.length / 3;
    for (let s = 0; s < seg; s++) {
      const a = s / seg * 2 * Math.PI, r = p.r + (p.ripple ? p.ripple * Math.cos(p.c[1] / 1.5 * 2 * Math.PI) : 0);
      positions.push(p.c[0] + r * Math.cos(a) * nx, p.c[1] + r * Math.cos(a) * ny, r * Math.sin(a));
    }
    ring.push(start);
    if (k) for (let s = 0; s < seg; s++) {
      const a = ring[k - 1] + s, b = ring[k - 1] + (s + 1) % seg, c = start + s, d = start + (s + 1) % seg;
      index.push(a, c, b, b, c, d); face.push(path[k].face, path[k].face);
    }
  });
  // 端蓋：底面（夾持端，朝 −Y）與起泡器網面（朝下，內凹 2 mm，面群組 5）
  const cap = (k, flip, f, inset = 0) => {
    const p = path[k], center = positions.length / 3;
    positions.push(p.c[0] + (inset ? p.t[0] * inset : 0), p.c[1] + (inset ? p.t[1] * inset : 0), 0);
    for (let s = 0; s < seg; s++) {
      const a = ring[k] + s, b = ring[k] + (s + 1) % seg;
      if (flip) index.push(center, b, a); else index.push(center, a, b); face.push(f);
    }
  };
  cap(0, false, 0);
  cap(path.length - 1, true, 5, -2);
  return {
    positions: Float32Array.from(positions), index: Uint32Array.from(index), face: Uint16Array.from(face),
    faceKinds: { 0: 3, 5: 3 },                                    // 螺牙、起泡器網面 → 孔／螺牙遮罩
  };
}
