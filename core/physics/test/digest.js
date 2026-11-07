// Node 與瀏覽器共用：把每個情境烘焙一次，回傳 { 名稱: 雜湊 }（瀏覽器決定性檢查用）
import { bakeCloth } from '../cloth.js';
import { bakeFluid } from '../fluid.js';
import { fnv } from '../collide.js';
import { precipitation, precipPoints, precipSegments } from '../../weather/precip.js';
import { snowOnPanels } from '../../weather/snow.js';
import { tarp, fill } from '../../examples/physics/scenarios-extra.js';
import { clothSmall, fluidSmall, drumSmall } from './specs.js';

const h32 = arr => fnv(2166136261, new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)).toString(16).padStart(8, '0');

export function digest() {
  const out = {}, ms = {};
  for (const [k, f] of Object.entries({ clothSmall, tarp })) { const b = bakeCloth(f()); out[k] = b.stats.hash; ms[k] = b.stats.ms; }
  for (const [k, f] of Object.entries({ fluidSmall, fill, drumSmall })) { const b = bakeFluid(f()); out[k] = b.stats.hash; ms[k] = b.stats.ms; }
  const snow = precipitation({ kind: 'snow', area: { min: [-3000, -3000], max: [3000, 3000] }, wind: [400, 100], gust: { amp: [300, 0], period: 7 }, seed: 5 });
  const rain = precipitation({ kind: 'rain', area: { min: [-3000, -3000], max: [3000, 3000] }, wind: [1500, 0], seed: 6 });
  out.snowFlakes = h32(precipPoints(snow, 12.34)); out.rainStreaks = h32(precipSegments(rain, 3.21));
  const day = t => t % 24 > 8 && t % 24 < 16;
  const r = snowOnPanels({ hours: 72, weather: t => t < 6 ? { snowfall: 2, temp: -3, poa: 0 } : { snowfall: 0, temp: day(t) ? 1 : -4, poa: day(t) ? 450 : 0 }, panels: [{ id: 'a', tilt: 10 }, { id: 'b', tilt: 40 }] });
  out.snowPanels = h32(Float64Array.from(r.panels.flatMap(p => [...p.timeline.depth, ...p.timeline.coverage, p.energyLoss])));
  return { hashes: out, ms };
}
