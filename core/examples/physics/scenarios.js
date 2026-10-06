// core/physics 的四種用途範例（評估平台 Q8）：物料流、掉落／滑槽、料箱堆積、夾取穩定。
// 每個情境：{ title, note, spec, view: [相機位置, 注視點], analyze(baked) → [{ label, value }] }。尺寸 mm，y 朝上。
// 範例頁（index.html）與檢查（check.mjs）共用；檢查會在 Node 與瀏覽器各烘焙一次，比對雜湊。
import { flowStats, settleTime, landings, pileStats, slip } from '../../physics/analysis.js';

const box = (id, size, pos, rot) => ({ id, size, pos, ...(rot ? { rot } : {}) });
const floor = box('地面', [6000, 20, 3000], [0, -10, 0]);
// 開口朝上的箱子：底板＋四面牆（內部尺寸 w × d，高 h，底面高度 y）
const tote = (id, [x, y, z], w, d, h, t = 10) => [
  box(`${id}底`, [w + 2 * t, t, d + 2 * t], [x, y - t / 2, z]),
  box(`${id}左`, [t, h, d + 2 * t], [x - w / 2 - t / 2, y + h / 2, z]), box(`${id}右`, [t, h, d + 2 * t], [x + w / 2 + t / 2, y + h / 2, z]),
  box(`${id}前`, [w, h, t], [x, y + h / 2, z + d / 2 + t / 2]), box(`${id}後`, [w, h, t], [x, y + h / 2, z - d / 2 - t / 2]),
];
const PARTS = [
  { name: '杯', shape: 'cylinder', size: { r: 35, h: 90 }, density: 300, weight: 1, color: 0x4f8fd8 },
  { name: '盒', shape: 'box', size: [80, 50, 120], density: 350, weight: 2, color: 0xe8a33d },
  { name: '球', shape: 'sphere', size: { r: 30 }, density: 200, weight: 0.5, color: 0x6cbf6a },
];
// 平滑的位移（0→1，加減速 S 曲線）
const smooth = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);

// 夾取：force 是每根手指的夾持力（N）
export function grip(force = 20) {
  const lift = t => smooth((t - 1.0) / 0.5) * 120, move = t => smooth((t - 1.7) / 0.6) * 500;
  return { duration: 3.2, seed: 1, statics: [floor, box('工作台', [400, 40, 300], [0, 0, 0])],
    spawners: [{ id: '工件', at: [0, 60, 0], every: 1, count: 1, spin: 0, items: [{ name: '鋁塊', shape: 'box', size: [60, 80, 40], density: 2600, friction: 0.6, color: 0xb7c3cd }] }],
    grippers: [{ id: '夾爪', pose: t => ({ pos: [move(t), 70 + lift(t), 0] }), finger: [12, 50, 40], open: 45, force, closeAt: 0.3, friction: 0.6, mass: 0.1 }] };
}

export const SCENARIOS = {
  flow: {
    title: '輸送物料流', note: '皮帶 300 mm/s（兩側有護欄），入料口每 0.5 秒投一件（杯、盒、球隨機），末端掉進料箱；統計通過中線的件數與皮帶上的密度。',
    spec: { duration: 14, seed: 7,
      statics: [floor, ...tote('料箱', [1350, 300, 0], 500, 500, 260), box('護欄 1', [2200, 70, 10], [0, 735, 215]), box('護欄 2', [2200, 70, 10], [0, 735, -215])],
      conveyors: [{ id: '皮帶', size: [2200, 40, 420], pos: [0, 680, 0], speed: 300 }],
      spawners: [{ id: '入料', at: [-950, 780, 0], spread: [40, 0, 200], every: 0.5, count: 24, spin: 30, items: PARTS }] },
    view: [[600, 1700, 2600], [200, 500, 0]],
    analyze(b) {
      const f = flowStats(b, { axis: 0, at: 0, from: 2, to: 14, region: { min: [-1100, 690, -230], max: [1100, 900, 230] } });
      return [{ label: '通過中線', value: `${f.count} 件（${f.perMinute.toFixed(1)} 件／分）` }, { label: '皮帶上的平均密度', value: `${f.density.toFixed(2)} 件／m` },
        { label: '最小間隔', value: f.gap ? `${f.gap.min.toFixed(2)} s` : '—' }];
    },
  },
  chute: {
    title: '掉落與滑槽', note: '零件從 1 m 高落到 30° 滑槽，滑進下方的料箱；統計落進料箱的時間與全部靜止的時間。',
    spec: { duration: 8, seed: 3,
      statics: [floor, box('滑槽', [900, 16, 360], [-150, 620, 0], [0, 0, -30]), box('滑槽側板 1', [900, 120, 10], [-150, 670, 185], [0, 0, -30]), box('滑槽側板 2', [900, 120, 10], [-150, 670, -185], [0, 0, -30]),
        ...tote('料箱', [520, 120, 0], 520, 440, 220)],
      spawners: [{ id: '投料', at: [-480, 1000, 0], spread: [60, 0, 160], every: 0.25, count: 16, spin: 180, items: PARTS }] },
    view: [[300, 1500, 2300], [80, 500, 0]],
    analyze(b) {
      const L = landings(b, { region: { min: [260, 100, -220], max: [780, 400, 220] } }), inn = L.filter(x => x.t != null), st = settleTime(b, { speed: 5 });
      return [{ label: '落進料箱', value: `${inn.length}／${L.length} 件` }, { label: '最後一件落入', value: inn.length ? `${Math.max(...inn.map(x => x.t)).toFixed(2)} s` : '—' },
        { label: '全部靜止', value: st != null ? `${st.toFixed(2)} s` : '還沒靜止' }];
    },
  },
  bin: {
    title: '料箱堆積與隨機取料', note: '30 件零件從 600 mm 高落進料箱堆積；統計箱內件數、堆高，以及可以從正上方抓取的件（朝上、上方沒有別的件擋）。',
    spec: { duration: 9, seed: 11,
      statics: [floor, ...tote('料箱', [0, 20, 0], 420, 320, 240)],
      spawners: [{ id: '投料', at: [0, 620, 0], spread: [300, 0, 200], every: 0.15, count: 30, spin: 180, items: PARTS.filter(p => p.shape !== 'sphere') }] },
    view: [[700, 1300, 1200], [0, 150, 0]],
    analyze(b) {
      const p = pileStats(b, b.duration, { region: { min: [-220, 0, -170], max: [220, 400, 170] }, approachDeg: 30 }), st = settleTime(b, { speed: 5 });
      return [{ label: '箱內', value: `${p.count} 件` }, { label: '堆高', value: `${p.height.toFixed(0)} mm` }, { label: '可以從上方抓的', value: `${p.graspable.length} 件` },
        { label: '全部靜止', value: st != null ? `${st.toFixed(2)} s` : '還沒靜止' }];
    },
  },
  grip: {
    title: '夾取穩定與加減速', note: '兩指夾爪（每指夾持力 20 N、摩擦 0.6）夾住 0.5 kg 的鋁塊，抬起 120 mm 後水平移動 500 mm（S 曲線，峰值加速度約 6 m/s²）；統計工件在夾爪裡滑了多少。夾持力降到 3 N 就會在抬起時滑落。',
    spec: grip(20),
    view: [[250, 500, 900], [250, 130, 0]],
    analyze(b) {
      const s = slip(b, '工件-1', '夾爪', { from: 0.9, to: 3.2 });
      return [{ label: '工件在夾爪裡的最大位移', value: s ? `${s.max.toFixed(2)} mm` : '—' }, { label: '移動結束時', value: s ? `${s.final.toFixed(2)} mm` : '—' }];
    },
  },
};
