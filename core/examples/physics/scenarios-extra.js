// 物理範例的布料（tarp，cloth.js）與流體（fill，fluid.js）兩個情境；scenarios.js 以 SCENARIOS_EXTRA 併入（寫法和 cable 相同，用 kind 區分）。
// 每個情境：{ kind, title, note, spec, view: [相機位置, 注視點], analyze(baked) → [{ label, value }] }。尺寸 mm，y 朝上。
import { clothStats } from '../../physics/cloth.js';
import { fluidStats } from '../../physics/fluid.js';

const smooth = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);

// 篷布蓋棧板貨物：四角吊著從 1100 mm 降到 850 mm，2 s 放開，之後起一陣側風。drop 是下降量（mm）
export const LOAD = { size: [1000, 700, 800], pos: [0, 350, 0] };                       // 棧板＋貨物外框
export function tarp({ drop = 250, release = 2, wind = 900 } = {}) {
  return { name: '篷布', size: [1800, 1600], segments: [36, 32], origin: [0, 1100, 0], thickness: 4, duration: 5,
    stretch: 0, shear: 0.001, bend: 2, friction: 0.6, damping: 1,
    pins: [{ corners: true, move: t => [0, -drop * smooth(t / 1.5), 0], until: release }],
    wind: { velocity: t => [t > 3 ? wind * smooth((t - 3) / 0.5) : 0, 0, 0], drag: 1 },
    colliders: [{ shape: 'plane', y: 0 }, { shape: 'box', ...LOAD }] };
}

// 噴嘴注入開口方槽：內部 300 × 300（高）× 200 mm、壁厚 10 mm；噴嘴在槽口上方 200 mm，約 40 L/min 注入 3 s
export const TANK = { shape: 'tank', size: [300, 300, 200], wall: 10, pos: [0, 0, 0] };
export const TANK_INSIDE = { min: [-150, -1, -100], max: [150, 400, 100] };
export function fill({ flow = 40, stop = 3, speed = 1500, max = 4000 } = {}) {
  return { name: '注入方槽', spacing: 10, duration: 5, max, viscosity: 0.02,
    emitters: [{ type: 'nozzle', pos: [0, 500, 0], dir: [0, -1, 0], speed, flow, stop }],
    colliders: [{ shape: 'plane', y: -10 }, TANK], kill: [{ min: [-1e5, -1e5, -1e5], max: [1e5, -200, 1e5] }], contain: TANK_INSIDE };
}

export const SCENARIOS_EXTRA = {
  tarp: {
    kind: 'cloth',
    title: '篷布覆蓋（布料）', note: '1.8 × 1.6 m 的篷布（XPBD 布料，core/physics/cloth.js）四角吊著降到貨物上方，2 秒放開、垂落蓋住 1.0 × 0.8 × 0.7 m 的貨物，3 秒後起一陣 0.9 m/s 的側風；統計最大伸長率、蓋住頂面的節點比例與最低的布邊。',
    spec: tarp(),
    view: [[1800, 1700, 2200], [0, 500, 0]],
    analyze(b) {
      const s = clothStats(b, { region: { min: [-500, 690, -400], max: [500, 760, 400] } });
      return [{ label: '最大伸長率', value: `${(s.maxStretch * 100).toFixed(2)}%` }, { label: '頂面上的節點', value: `${(s.inside * 100).toFixed(0)}%` },
        { label: '最低的布邊', value: `${s.box.min[1].toFixed(0)} mm` }, { label: '節點', value: `${b.nodes} 個` }];
    },
  },
  fill: {
    kind: 'fluid',
    title: '噴嘴注入方槽（流體）', note: '噴嘴以 1.5 m/s、約 40 L/min 往 300 × 200 mm 的開口方槽注入 3 秒（PBF 粒子流體，core/physics/fluid.js；一顆 10 mm 粒子 = 1 mL）；統計槽內的液量、液位與密度誤差（越小越不可壓縮）。',
    spec: fill(),
    view: [[600, 700, 900], [0, 150, 0]],
    analyze(b) {
      const s = fluidStats(b, b.duration, { region: TANK_INSIDE });
      return [{ label: '槽內', value: `${s.count}／${s.total} 顆（${s.volumeL.toFixed(2)} L）` }, { label: '液位（體積 ÷ 面積）', value: `${s.level.toFixed(0)} mm` },
        { label: '表面高度（95%）', value: `${s.surface.toFixed(0)} mm` }, { label: '平均密度誤差', value: `${(b.stats.avgDensityError * 100).toFixed(2)}%` }];
    },
  },
};
