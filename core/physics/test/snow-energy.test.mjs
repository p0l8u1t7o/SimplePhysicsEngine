// 積雪損失接進全年發電：weather/snow.js 的 snowLossSeries → core/solar 的 simulate({ hourlyLoss })
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEPW, simulate } from '../../solar/energy.js';
import { snowLossSeries } from '../../weather/snow.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const base = readEPW(gunzipSync(readFileSync(join(HERE, '..', '..', 'solar', 'test', 'fixtures', 'synthetic-tainan.epw.gz'))).toString('utf8'));
const site = { lat: 23.0, lon: 120.2, elevation: 15, tz: 8, deltaT: 69.2 };
const sys = tilt => ({ mount: { type: 'fixed', tilt, azimuth: 180 }, pdc0: 100000, losses: 14 });
// 合成的降雪：1 月 10 日 00～12 時每小時雪深 +2.5 cm（共 30 cm），之後 4 天低溫（台南沒有雪，只用來測接線）
function snowy() {
  const w = { ...base, snowDepth: new Float64Array(base.n), tempAir: Float64Array.from(base.tempAir) };
  const s = 9 * 24;
  for (let i = s; i < s + 12; i++) w.snowDepth[i] = 2.5 * (i - s + 1);
  for (let i = s + 12; i < s + 96; i++) w.snowDepth[i] = 30;
  for (let i = s; i < s + 96; i++) w.tempAir[i] = i < s + 12 ? -3 : -6 + 6 * Math.cos(2 * Math.PI * ((i % 24) - 14) / 24);
  return w;
}

test('沒給 hourlyLoss、或全部 0：和原本逐位元相同', () => {
  const r0 = simulate({ weather: base, site, system: sys(25) });
  const r1 = simulate({ weather: base, site, system: sys(25), hourlyLoss: new Float64Array(base.n) });
  assert.equal(r1.annual.acKWh, r0.annual.acKWh);
  assert.equal(r1.annual.shadeKWh, r0.annual.shadeKWh);
  assert.equal(r0.annual.hourlyLossKWh, undefined);
  assert.equal(r1.annual.hourlyLossKWh, 0);
  assert.equal(base.snowDepth.length, base.n, 'readEPW 讀第 30 欄雪深');
});

test('積雪：雪深增量變成降雪、有損失、只在下雪那幾天；陡的板損失比較少', () => {
  const w = snowy(), run = tilt => {
    const r0 = simulate({ weather: w, site, system: sys(tilt), keepHourly: true });
    const snow = snowLossSeries({ weather: w, poa: r0.hourly.poa, tilt });
    const r1 = simulate({ weather: w, site, system: sys(tilt), hourlyLoss: snow.loss });
    return { r0, r1, snow };
  };
  const a = run(10), b = run(40), s = 9 * 24;
  assert.equal(a.snow.snowfall[s + 3], 2.5);
  assert.equal(a.snow.snowfall.reduce((x, y) => x + y, 0), 30, '雪深 0 → 30 cm 的增量全部算成降雪，之後持平與歸零不算');
  assert.ok(a.snow.loss[s + 14] > 0.9, `下雪後隔天早上被蓋住：${a.snow.loss[s + 14]}`);
  assert.ok(a.snow.loss.slice(0, s).every(v => v === 0) && a.snow.loss.slice(s + 24 * 10).every(v => v === 0), '其他時間沒有損失');
  for (const k of [a, b]) {
    assert.ok(k.r1.annual.hourlyLossKWh > 0);
    assert.ok(Math.abs(k.r0.annual.acKWh - k.r1.annual.acKWh - k.r1.annual.hourlyLossKWh) < 0.05 * k.r1.annual.hourlyLossKWh + 1, '交流的差和積雪損失同量級（扣掉變流器效率）');
    assert.equal(k.r1.annual.shadeKWh, k.r0.annual.shadeKWh, '積雪不算進遮陰損失');
  }
  assert.ok(b.r1.annual.hourlyLossKWh < a.r1.annual.hourlyLossKWh, `40° ${b.r1.annual.hourlyLossKWh.toFixed(1)} kWh 應小於 10° ${a.r1.annual.hourlyLossKWh.toFixed(1)} kWh`);
  assert.ok(b.snow.panel.clearedAt != null && b.snow.panel.clearedAt < (a.snow.panel.clearedAt ?? Infinity), '40° 先清掉');
});

test('追日：逐時轉角（夜間 NaN 當 0°）；下雪時收藏到 60° 的積雪損失比不收藏少', () => {
  const w = snowy(), system = { mount: { type: 'singleAxis', gcr: 0.4, maxAngle: 60, backtrack: true }, pdc0: 100000, losses: 14 };
  const r0 = simulate({ weather: w, site, system, keepHourly: true });
  assert.ok(r0.hourly.theta.some(Number.isNaN), '夜間的轉角是 NaN');
  const flat = snowLossSeries({ weather: w, poa: r0.hourly.poa, tilt: r0.hourly.theta });
  const stow = snowLossSeries({ weather: w, poa: r0.hourly.poa, tilt: r0.hourly.theta, stowAngle: 60 });
  const kwh = s => simulate({ weather: w, site, system, hourlyLoss: s.loss }).annual.hourlyLossKWh;
  assert.equal(stow.panel.timeline.tilt[9 * 24 * 4 + 8], 60, '下雪那幾小時轉到 60°');
  assert.ok(kwh(stow) < kwh(flat), `收藏 ${kwh(stow).toFixed(1)} kWh 應小於不收藏 ${kwh(flat).toFixed(1)} kWh`);
});
