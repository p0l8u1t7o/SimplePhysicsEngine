// 支架的檢查列：回傳 [{ group, name, ok, value }]，可以直接放進專案的 layoutChecks()。
// 門檻有預設值（示意），站可以用 limits 覆蓋；value 一律帶單位、給最差的那一筆。
const f1 = v => (Math.round(v * 10) / 10).toLocaleString('en-US');

export function structureChecks(layout, limits = {}) {
  const P = layout.params, L = {
    clearance: P.clearance, minEmbed: P.pile.minEmbed, maxReveal: P.pile.maxReveal, maxPileSpacing: P.pileSpacing,
    steelClear: 150, maxRowSlope: P.maxRowSlope, maxKink: 1.5, maxGcr: .6, minRowGap: 0, ...limits,
  };
  const piles = layout.members.filter(m => m.kind === 'pile'), rows = [], group = layout.kind === 'fixed' ? '固定式支架' : '單軸追日';
  const worst = (arr, f, cmp) => arr.reduce((a, b) => (a == null || cmp(f(b), f(a)) ? b : a), null);
  const minEmb = worst(piles, m => m.embed, (a, b) => a < b), maxRev = worst(piles, m => m.reveal, (a, b) => a > b), minRev = worst(piles, m => m.reveal, (a, b) => a < b);
  rows.push({ group, name: `基樁埋深 ≥ ${L.minEmbed} mm`, ok: !minEmb || minEmb.embed >= L.minEmbed - .05, value: minEmb ? `${f1(minEmb.embed)} mm（${minEmb.id}）` : '—' });
  rows.push({ group, name: `基樁外露 ≤ ${L.maxReveal} mm`, ok: !maxRev || maxRev.reveal <= L.maxReveal + .05, value: maxRev ? `${f1(maxRev.reveal)} mm（${maxRev.id}）` : '—' });
  rows.push({ group, name: '基樁外露 > 0（樁頂在地面上）', ok: !minRev || minRev.reveal > 0, value: minRev ? `${f1(minRev.reveal)} mm（${minRev.id}）` : '—' });
  if (layout.kind === 'fixed') {
    const t = worst(layout.tables, x => x.clearMin, (a, b) => a < b), s = worst(layout.tables, x => x.steelClear, (a, b) => a < b);
    const slope = worst(layout.tables, x => Math.abs(x.groundSlope), (a, b) => a > b);
    rows.push({ group, name: `模組下緣離地 ≥ ${L.clearance} mm`, ok: t.clearMin >= L.clearance - .05, value: `${f1(t.clearMin)} mm（${t.id}）` });
    rows.push({ group, name: `斜樑下緣離地 ≥ ${L.steelClear} mm`, ok: s.steelClear >= L.steelClear, value: `${f1(s.steelClear)} mm（${s.id}）` });
    rows.push({ group, name: `地面沿列坡度 ≤ ${L.maxRowSlope * 100}%（超過時桌面坡度被限制，靠樁長吸收）`, ok: Math.abs(slope.groundSlope) <= L.maxRowSlope, value: `${f1(Math.abs(slope.groundSlope) * 100)}%（${slope.id}）` });
    rows.push({ group, name: `框架間距 ≤ ${L.maxPileSpacing} mm`, ok: layout.summary.frameSpacing <= L.maxPileSpacing + .05, value: `${f1(layout.summary.frameSpacing)} mm` });
    rows.push({ group, name: `列間淨距 ≥ ${L.minRowGap} mm（排距遮陰另由 core/solar 檢查）`, ok: layout.summary.rowGap >= L.minRowGap, value: `${f1(layout.summary.rowGap)} mm，GCR ${layout.summary.gcr}` });
  } else {
    const r = worst(layout.rows, x => x.clearMin, (a, b) => a < b);
    rows.push({ group, name: `轉 ±${P.maxAngle}° 時模組下緣離地 ≥ ${L.clearance} mm`, ok: r.clearMin >= L.clearance - .05, value: `${f1(r.clearMin)} mm（${r.id}）` });
    rows.push({ group, name: `樁距 ≤ ${L.maxPileSpacing} mm`, ok: layout.summary.pileSpacing <= L.maxPileSpacing + .05, value: `${f1(layout.summary.pileSpacing)} mm` });
    const sl = Math.max(0, ...layout.rows.flatMap(x => x.slopes.map(Math.abs))), rs = layout.rows.find(x => x.slopes.some(s => Math.abs(s) === sl));
    rows.push({ group, name: `轉軸坡度 ≤ ${L.maxRowSlope * 100}%`, ok: sl <= L.maxRowSlope + 1e-9, value: `${f1(sl * 100)}%${rs ? `（${rs.id}）` : ''}` });
    if (P.follow === 'terrain') {
      const k = Math.max(0, ...layout.rows.flatMap(x => x.kinks)), rk = layout.rows.find(x => x.kinks.includes(k));
      rows.push({ group, name: `軸承處轉折 ≤ ${L.maxKink}°（跟地形）`, ok: k <= L.maxKink, value: `${k.toFixed(2)}°${rk ? `（${rk.id}）` : ''}` });
    }
    rows.push({ group, name: `GCR ≤ ${L.maxGcr}（回溯另由 core/solar 算）`, ok: layout.summary.gcr <= L.maxGcr, value: String(layout.summary.gcr) });
  }
  return rows;
}
