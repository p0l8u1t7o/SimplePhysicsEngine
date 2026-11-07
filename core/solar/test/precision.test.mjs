// 高精度門檻（core/solar/precision.js，2026-11-07 拍板）不依賴本機 pvlib 參考檔的部分：
//   太陽位置：NREL SPA 論文範例在 ±0.01° 內；預設 ΔT（Espenak–Meeus，和 pvlib 相同）和實測 ΔT 的差造成的位置差在台灣也在 ±0.01° 內
//   現況比對：asBuiltChecks 的預設容許值就是門檻
// 發電量對 pvlib < 2% 由 tools/solar-pvlib/compare.mjs 檢查（需要本機的 pvlib 參考值）。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../index.js';
import { asBuiltChecks } from '../../geo/asbuilt.js';

const P = S.SITE_PRECISION;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test('太陽位置：NREL SPA 論文範例（Reda & Andreas 2004）在門檻內', () => {
  // 2003-10-17 12:30:30 當地時間（UTC−7），39.742476°N、105.1786°W、1830.14 m、820 mbar、11 °C、ΔT 67 s
  const u = S.unixFromLocal(2003, 10, 17, 12, 30, 30, -7);
  const sp = S.solarPosition(u, { lat: 39.742476, lon: -105.1786, elevation: 1830.14, pressure: 82000, temperature: 11, deltaT: 67 });
  assert.ok(Math.abs(sp.apparentZenith - 50.11162) <= P.sunDeg, `天頂 ${sp.apparentZenith}`);
  assert.ok(angDiff(sp.azimuth, 194.34024) <= P.sunDeg, `方位 ${sp.azimuth}`);
});

// 位置誤差用兩個太陽方向的夾角量：方位角在太陽接近天頂時沒有意義（天頂角 0.3° 時，方位差 0.012° 只對應 0.00008° 的夾角）
test('ΔT：預設多項式（2026 年 75.4 s）對實測 69.2 s，台灣全年的太陽位置差在門檻內', () => {
  let worst = 0, worstAz = 0;
  for (let d = 0; d < 365; d += 5) for (let h = 6; h <= 18; h += 0.5) {
    const u = S.unixFromLocal(2026, 1, 1 + d, Math.floor(h), (h % 1) * 60, 0, 8), site = { lat: 23.0, lon: 120.2, elevation: 15 };
    const a = S.solarPosition(u, site), b = S.solarPosition(u, { ...site, deltaT: 69.2 });
    if (a.apparentElevation < 1) continue;
    const va = S.sunVector(a.apparentZenith, a.azimuth), vb = S.sunVector(b.apparentZenith, b.azimuth);
    worst = Math.max(worst, Math.acos(Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])) * 180 / Math.PI);
    if (a.apparentZenith > 5) worstAz = Math.max(worstAz, angDiff(a.azimuth, b.azimuth));      // 天頂 5° 以外，方位角本身也要在門檻內
  }
  assert.ok(worst <= P.sunDeg, `太陽方向最大夾角 ${worst.toFixed(5)}°`);
  assert.ok(worstAz <= P.sunDeg, `天頂 5° 以外的方位角最大差 ${worstAz.toFixed(5)}°`);
  assert.ok(worst > 0, '兩個 ΔT 應該有差（不然這個測試沒有意義）');
});

test('現況比對：asBuiltChecks 的預設容許值等於高精度門檻', () => {
  const pile = (dh, dx) => ({ id: 'P1', row: 'R1', design: { x: 0, z: 0, top: 1000 }, measured: { x: dx, z: 0, top: 1000 + dh } });
  const rows = asBuiltChecks([pile(P.heightMm - 1, P.planMm - 1)]), rowsBad = asBuiltChecks([pile(P.heightMm + 1, P.planMm + 1)]);
  const kind = (r, k) => r.find(x => x.kind === k);
  assert.equal(kind(rows, 'height').tol, P.heightMm);
  assert.equal(kind(rows, 'plan').tol, P.planMm);
  assert.ok(kind(rows, 'height').ok && kind(rows, 'plan').ok);
  assert.ok(!kind(rowsBad, 'height').ok && !kind(rowsBad, 'plan').ok);
});
