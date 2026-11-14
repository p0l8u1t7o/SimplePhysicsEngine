// 外觀補強回歸與純程序影像預覽（不讀 docs，不需要瀏覽器）。
// node --import ../../core/tools/register.mjs tools/verify-appearance.mjs
// 預覽不等同 WebGL／手機效能驗收；時間量測只寫 TEMP。
import '@core/verify/dom-stub.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodePng } from '../../../core/tools/png.mjs';
import { pattern, renderTile, inspectAll, mergeCandidates, scoreAgainstTruth } from '../web/js/inspection-sim.js';
import { SCENARIOS, resolveParams } from '../web/js/spec.js';
import { opticsOf } from '../web/js/budget.js';
import { scanPlan } from '../web/js/scan-plan.js';
import { exposureCue, buildSchedule, createSequence } from '../web/js/sequence.js';

const { p } = resolveParams({}), o = opticsOf(p), plan = scanPlan(p, o.fov), all = plan.positions.map(q => q.k);
const out = new URL('../TEMP/appearance/', import.meta.url); mkdirSync(out, { recursive: true });
const metrics = {};
for (const [id, sc] of Object.entries(SCENARIOS)) {
  const times = []; let ins;
  for (let i = 0; i < 5; i++) {
    const start = performance.now(); ins = inspectAll(plan, p, sc, o.dof); times.push(performance.now() - start);
    assert.equal(ins.per.length, 777); assert.ok(times.at(-1) < 3000, `${id}: inspectAll 必須低於 3 s`);
  }
  const ordered = times.slice(1).sort((a, b) => a - b);
  metrics[id] = { positions: ins.per.length, coldMs: times[0], warmP50Ms: (ordered[1] + ordered[2]) / 2, warmP95Ms: ordered[3], maxMs: Math.max(...times) };
  const candidates = mergeCandidates(ins.per, all), score = scoreAgainstTruth(sc, candidates, ins.per, all, plan);
  if (id === 'clean') assert.ok(ins.per.every(r => r.status === 'ok'));
  if (id === 'line') assert.ok(score.rows.every(r => r.found.length), '所有注入暗線與旁邊顆粒都要有候選');
  if (id === 'particle') for (const row of score.rows) assert.equal(row.result, row.id === 'A5' ? 'SIM 漏檢' : '有候選');
  if (id === 'defocus') for (const row of score.rows) assert.ok(row.found.length, '失焦、暗帶與缺圖都要待複檢');
}

const shot = renderTile(-26, 6, o.fov, p, { defects: SCENARIOS.line.defects, ref: true });
const mono = renderTile(-26, 6, o.fov, p, { defects: SCENARIOS.line.defects, ref: true, color: false });
assert.deepEqual(shot.bf, mono.bf); assert.deepEqual(shot.df, mono.df);
assert.deepEqual(shot, renderTile(-26, 6, o.fov, p, { defects: SCENARIOS.line.defects, ref: true }));
let colorPixels = 0, darkPixels = 0, scatterPixels = 0;
for (let i = 0; i < shot.bf.length; i++) {
  if (Math.abs(shot.rgb[0][i] - shot.rgb[1][i]) > .1) colorPixels++;
  if (shot.ref.bf[i] - shot.bf[i] > .08) darkPixels++;
  if (shot.df[i] - shot.ref.df[i] > .1) scatterPixels++;
  const luminance = .2126 * shot.rgb[0][i] + .7152 * shot.rgb[1][i] + .0722 * shot.rgb[2][i];
  assert.ok(Math.abs(luminance - shot.bf[i]) < .008);
}
assert.ok(colorPixels > shot.bf.length / 2); assert.ok(darkPixels > 5 && scatterPixels > 5);
let variants = 0;
for (let y = .1; y < 10; y += .31) for (let x = .1; x < 10; x += .29) {
  const a = pattern(x, y, 10, 10), b = pattern(x + 10, y, 10, 10);
  assert.ok(a.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
  if (a.some((v, i) => Math.abs(v - b[i]) > .05)) variants++;
}
assert.ok(variants > 50);
const schedule = buildSchedule({ p, plan, optics: o, list: all }), seq = createSequence(schedule);
let glows = 0;
for (const st of schedule.steps) {
  const T = st.start + st.dur / 2, s = seq.sample(T).state, cue = exposureCue(T, s, schedule.posTime.get(s.pos));
  if (['move', 'settle', 'theta'].includes(s.mode)) { assert.equal(cue, 'off'); assert.equal(s.light, 'off'); }
  if (cue !== 'off') glows++;
}
assert.ok(glows > 0);
for (const pt of schedule.posTime.values()) {
  assert.equal(exposureCue(pt.exp[0] - 1e-6, { mode: 'wait' }, pt), 'off');
  assert.equal(exposureCue(pt.exp[1], { mode: 'switch' }, pt), 'BF');
  assert.equal(exposureCue(pt.exp[3], { mode: 'move' }, pt), 'off');
  assert.equal(exposureCue(pt.exp[3] + .086, { mode: 'tail' }, pt), 'off');
}

// 每張預覽左上加 SIM；所有像素只從 renderTile 產生。
function preview(name, at, fov, sc, options = {}) {
  const img = renderTile(...at, fov, p, { defects: SCENARIOS[sc].defects, res: .02, ...options });
  for (const ch of ['bf', 'df']) {
    const data = Buffer.alloc(img.w * img.h * 4);
    for (let i = 0; i < img.w * img.h; i++) {
      for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(255 * (ch === 'bf' ? img.rgb[c][i] : img.df[i]));
      data[i * 4 + 3] = 255;
    }
    const glyphs = ['111/100/111/001/111', '111/010/010/010/111', '10001/11011/10101/10001/10001'];
    let left = 8;
    for (const glyph of glyphs) {
      const rows = glyph.split('/'); rows.forEach((row, y) => [...row].forEach((v, x) => {
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
          const k = ((8 + y * 3 + a) * img.w + left + x * 3 + b) * 4;
          data[k] = data[k + 1] = v === '1' ? 255 : 10; data[k + 2] = v === '1' ? 70 : 10;
        }
      })); left += rows[0].length * 3 + 4;
    }
    writeFileSync(new URL(`${name}-${ch}.png`, out), encodePng({ width: img.w, height: img.h, data }));
  }
}
preview('pattern', [0, 0], [24, 14], 'clean');
preview('line', [-26, 6], [18, 10], 'line');
preview('pad', [55.8, -.85], [4, 3], 'line', { res: .008 });
preview('banded', [70, 2], o.fov, 'defocus');
preview('defocus', [-60, 6], o.fov, 'defocus', { focusErr: .32, dof: o.dof });
writeFileSync(new URL('performance.json', out), JSON.stringify({ node: process.version, metrics }, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, positions: 777, scenarios: 4, previews: 10, metrics }));
