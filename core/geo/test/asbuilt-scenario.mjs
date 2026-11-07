// 設計與現況比對的合成情境（測試與範例共用）：3 排 × 6 支樁，點雲帶已知的施工偏差。
// 決定性亂數（LCG），結果每次相同。

export function lcg(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/**
 * 設計：排沿 +X（東西向），排距 6000 mm 往南（+Z），樁距 3000 mm，樁頂設計高 1500 mm（地面 y = 坡度）。
 * 施工偏差（「答案」）：
 *   R2-P3 樁頂 +45 mm；R1-P5 往東偏 80 mm；第 3 排整排往南 120 mm（排距 R2–R3 多 120）；R3-P6 沒有施工（缺樁）；
 *   支架 R2 傾角 17°（設計 15°）。
 */
export function scenario() {
  const ground = (x, z) => 0.01 * x - 0.005 * z;   // 地面坡度（mm）
  const design = [];
  for (let r = 1; r <= 3; r++) for (let p = 1; p <= 6; p++) {
    const x = (p - 1) * 3000, z = (r - 1) * 6000;
    design.push({ id: `R${r}-P${p}`, row: `R${r}`, x, z, top: ground(x, z) + 1500 });
  }
  const asBuilt = design.map(d => {
    const a = { ...d };
    if (d.id === 'R2-P3') a.top += 45;
    if (d.id === 'R1-P5') a.x += 80;
    if (d.row === 'R3') a.z += 120;
    if (d.id === 'R3-P6') a.missing = true;
    return a;
  });
  // 點雲：地面點（間距 100 mm）＋每支樁的頂面圓盤（直徑 100 mm，點距 10 mm）＋高斯雜訊 3 mm
  const rnd = lcg(42);
  const noise = () => (rnd() + rnd() + rnd() - 1.5) * 2 * 3;
  const pts = [];
  for (let x = -1000; x <= 16000; x += 100) for (let z = -1000; z <= 13500; z += 100) pts.push(x, ground(x, z) + noise(), z);
  for (const a of asBuilt) {
    if (a.missing) continue;
    for (let u = -50; u <= 50; u += 10) for (let v = -50; v <= 50; v += 10) if (u * u + v * v <= 2500) pts.push(a.x + u, a.top + noise(), a.z + v);
  }
  // 支架面：每排一張 16 m × 3 m 的板面，中心在樁頂上 800 mm，朝南傾斜（北高南低）
  const tables = [];
  for (let r = 1; r <= 3; r++) {
    const tilt = (r === 2 ? 17 : 15) * Math.PI / 180;
    const cz = (r - 1) * 6000 + (r === 3 ? 120 : 0), cx = 7500, cy = ground(cx, cz) + 1500 + 800;
    const tp = [];
    for (let x = cx - 8000; x <= cx + 8000; x += 200) for (let s = -1500; s <= 1500; s += 100) {
      const z = cz + s * Math.cos(tilt), y = cy - s * Math.sin(tilt) + noise();   // 往南（+Z）越低
      tp.push({ x, y, z });
    }
    tables.push({ id: `R${r}`, points: tp, tiltDeg: 15, aspectDeg: 180 });
  }
  return { design, asBuilt, positions: Float64Array.from(pts), tables, ground };
}
