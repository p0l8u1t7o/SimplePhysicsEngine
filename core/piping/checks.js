// 配管、水力、電壓降的檢查列：[{ group, name, ok, value }]，直接放進專案的 layoutChecks()。門檻皆可覆蓋（預設為示意值）。
import { size } from './sizes.js';
import { groundClearance as clearanceOf } from './route.js';
const f1 = v => (Math.round(v * 10) / 10).toLocaleString('en-US');
const pct = v => `${(v * 100).toFixed(2)}%`;

// 配管路徑
//   limits: { minR（預設 route.minR）, height（地形函式，給了才查淨空）, minClear（地上管最小離地 mm）, minCover（埋管覆土 mm）,
//             cable（槽內／管內最粗的線材 id，查彎曲半徑）, maxBendPerPull（導線管，預設 360°）}
export function routeChecks(route, limits = {}, name = route.size ?? route.kind) {
  const group = `配管 ${name}`, rows = [], minR = limits.minR ?? route.minR;
  const worst = route.bends.reduce((a, b) => (!a || b.R < a.R ? b : a), null);
  rows.push({ group, name: `彎曲半徑 ≥ ${f1(minR)} mm`, ok: !worst || worst.R >= minR - .05, value: worst ? `最小 ${f1(worst.R)} mm（第 ${worst.at} 點）` : '無彎' });
  const tight = route.bends.filter(b => !b.fit);
  rows.push({ group, name: '相鄰彎之間有足夠直管', ok: !tight.length, value: tight.length ? `第 ${tight.map(b => b.at).join('、')} 點縮小半徑` : `${route.bends.length} 個彎` });
  if (route.slopes.length && (route.slopes.some(s => !s.ok) || limits.showSlope !== false)) {
    const bad = route.slopes.filter(s => !s.ok), flat = route.slopes.filter(s => !s.vertical).map(s => Math.abs(s.slope));
    rows.push({ group, name: '坡度符合（排水方向與最小坡度）', ok: !bad.length, value: bad.length ? `第 ${bad.map(s => s.seg + 1).join('、')} 段` : flat.length ? `最小 ${pct(Math.min(...flat))}` : '全垂直' });
  }
  if (route.kind === 'pipe' && route.bendType !== 'pipe-bend') {
    const ns = route.bends.filter(b => b.nonStandard);
    rows.push({ group, name: '彎頭為標準角度（90°／45°）', ok: !ns.length, value: ns.length ? `${ns.length} 個需切角：${ns.map(b => b.angle.toFixed(1) + '°').join('、')}` : '全標準' });
  }
  if (route.kind === 'conduit') {
    const max = limits.maxBendPerPull ?? 360;
    rows.push({ group, name: `兩拉線點之間彎曲合計 ≤ ${max}°`, ok: route.totalBend <= max + 1e-6, value: `${f1(route.totalBend)}°` });
  }
  if (limits.cable) {
    const c = size(limits.cable), R = worst ? worst.R : Infinity;
    rows.push({ group, name: `線材 ${c.id} 彎曲半徑 ≥ ${f1(c.minBendR)} mm`, ok: R >= c.minBendR, value: worst ? `${f1(R)} mm` : '無彎' });
  }
  if (limits.height) {
    const { min, minCover, buried } = clearanceOf(route, limits.height);
    if (limits.minCover != null) rows.push({ group, name: `埋管覆土 ≥ ${limits.minCover} mm`, ok: minCover >= limits.minCover, value: `${f1(minCover)} mm` });
    else rows.push({ group, name: `離地 ≥ ${limits.minClear ?? 0} mm`, ok: !buried && min >= (limits.minClear ?? 0), value: `${f1(min)} mm` });
  }
  return rows;
}
// 水力：流速範圍、各點壓力、泵揚程
export function hydraulicChecks(result, limits = {}) {
  const group = '水力', rows = [], vMin = limits.vMin ?? .3, vMax = limits.vMax ?? 3;
  const flowing = result.links.filter(l => Math.abs(l.Q) > 1e-9);
  const hi = flowing.reduce((a, b) => (!a || b.v > a.v ? b : a), null), lo = flowing.reduce((a, b) => (!a || b.v < a.v ? b : a), null);
  if (hi) rows.push({ group, name: `流速 ${vMin}～${vMax} m/s`, ok: hi.v <= vMax && lo.v >= vMin, value: `${lo.v.toFixed(2)}～${hi.v.toFixed(2)} m/s` });
  const bad = result.nodes.filter(n => !n.ok), need = result.nodes.filter(n => n.pMin != null);
  if (need.length) {
    const w = need.reduce((a, b) => (!a || b.p - b.pMin < a.p - a.pMin ? b : a), null);
    rows.push({ group, name: '各出水點壓力 ≥ 需求', ok: !bad.length, value: `最少餘 ${((w.p - w.pMin) / 1000).toFixed(1)} kPa（${w.id}）` });
  }
  if (result.loops) rows.push({ group, name: '迴路收斂（閉合誤差 < 1 mm）', ok: result.loopResidual < 1e-3, value: `${(result.loopResidual * 1000).toFixed(3)} mm，${result.iterations} 次` });
  if (result.pump && limits.pumpHead != null) rows.push({ group, name: `泵揚程 ≤ ${limits.pumpHead} m`, ok: result.pump.head <= limits.pumpHead, value: `${result.pump.head.toFixed(1)} m @ ${(result.pump.flow * 60000).toFixed(0)} L/min` });
  return rows;
}

// 電壓降：items = [{ id, pct }]（dcDrop／stringDrop 的結果加上 id）
export function voltageDropChecks(items, { maxPct = 1.5, group = '電壓降' } = {}) {
  const w = items.reduce((a, b) => (!a || b.pct > a.pct ? b : a), null);
  return w ? [{ group, name: `直流電壓降 ≤ ${maxPct}%`, ok: w.pct <= maxPct, value: `最大 ${w.pct.toFixed(2)}%（${w.id}）` }] : [];
}
