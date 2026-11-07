// PVGIS 輸出的 EPW（tools/weather/fetch-tmy.mjs 下載的格式）：時區、缺值 999、AOD 0.999 不能被當成反照率
import test from 'node:test';
import assert from 'node:assert/strict';
import { readEPW, simulate } from '../energy.js';

// 照 PVGIS 5.3 EPW 的版面合成（數值是假的）：LOCATION 第 9 欄時區 8；第 29 欄 AOD 0.999、第 30～32 欄雪深／天數／反照率都是缺值
function pvgisLike() {
  const head = ['LOCATION,unknown,-,unknown,ECMWF/ERA,unknown,23.000000,120.200000,8,11', 'DESIGN CONDITIONS,0', 'TYPICAL/EXTREME PERIODS,0', 'GROUND TEMPERATURES,0',
    'HOLIDAYS/DAYLIGHT SAVING,No,0,0,0', 'COMMENTS 1,Weather Analytics - Sensor Point System data - based on the ECMWF-ERA', 'COMMENTS 2,Irradiance Time Offset (h):-0.5', 'DATA PERIODS,1,1,Data,Thursday, 1/ 1,12/31'];
  const rows = [];
  for (let d = 1; d <= 2; d++) for (let h = 1; h <= 24; h++) {
    const sun = Math.max(0, Math.sin(Math.PI * (h - 6.5) / 12)), ghi = (900 * sun).toFixed(2), dni = (700 * sun).toFixed(2), dhi = (150 * sun).toFixed(2);
    rows.push(`2018,1,${d},${h},0,B8B8E8B8?1A1A1A1?0?0?0?0B8B8?0?0?0?0?0?0?0?0,${(18 + 5 * sun).toFixed(2)},15.57,86.92,102600.00,9999,9999,387.53,${ghi},${dni},${dhi},999999,999999,999999,9999,357,3.9,99,99,9999,99999,9,999999999,999,0.999,999,99,999,999,99`);
  }
  return [...head, ...rows].join('\r\n');
}

test('PVGIS 的 EPW：時區 +8、反照率與雪深缺值變 NaN、模擬用預設反照率', () => {
  const w = readEPW(pvgisLike());
  assert.equal(w.n, 48);
  assert.equal(w.meta.tz, 8);
  assert.equal(w.meta.source, 'ECMWF/ERA');
  assert.ok(w.albedo.every(Number.isNaN), '第 32 欄 999 是缺值（AOD 0.999 在第 29 欄，不能當成反照率）');
  assert.ok(w.snowDepth.every(Number.isNaN));
  assert.equal(w.ghi[12], +(900 * Math.sin(Math.PI * 6.5 / 12)).toFixed(2), '第 13 時（12:00～13:00）的 GHI 讀到第 14 欄');
  const sys = a => ({ mount: { type: 'fixed', tilt: 20, azimuth: 180 }, pdc0: 1000, albedo: a });
  const site = { lat: 23, lon: 120.2, elevation: 11 };
  const r2 = simulate({ weather: w, site, system: sys(0.2) }), r5 = simulate({ weather: w, site, system: sys(0.5) });
  assert.ok(r5.annual.poaKWhm2 > r2.annual.poaKWhm2, '反照率缺值時用 system.albedo');
});
