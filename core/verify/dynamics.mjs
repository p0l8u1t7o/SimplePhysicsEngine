// 站層的手臂動力學檢查（check.mjs 的 dynamics，core 1.20.0）：站在 project.verify.dynamics 宣告手臂與關節軌跡，
// 用 MuJoCo 逆動力學（core/robot/dynamics.js）算每軸峰值扭矩對型錄上限的比例、負載質量與手腕力矩、軌跡是否連續。
// 2026-11-07 拍板「扭矩比例先只警告」：超過的列標 warn，整體 ok 仍是 true；型錄上限多是估計值（見 core/robot/dynamics/）。
//
//   project.verify.dynamics = {
//     arms: [{
//       name: '手臂 A',                         // 檢查列的群組名
//       spec: 'denso-vs068' | spec 物件,         // 內建型號或 core/robot/dynamics 格式的物件
//       payload: { mass, com: [x, y, z] } | () => …, // 工具＋工件（kg、mm，法蘭座標）；取整個週期最重的情況（保守）。給函式時只在檢查時算
//                                                // （core/robot/payload.js 的 estimatePayload 從 3D 工具模型估，比較費時）
//       sample: t => ({ j1, …, j6 }) | [q1…q6], // 時間 t（s）的關節角（rad），通常由站的排程與 IK 算
//       gravity = [0, −9.81, 0] | t => [x, y, z], // 手臂基座座標的重力（m/s²）；倒吊、斜裝時把世界重力轉到基座座標。給函式時取 from 那一刻，
//                                                // 並在週期內 9 個時間點比對，基座方向會變時加一列警告（MuJoCo 模型只能用一個重力方向）
//       from = 0, to = project.total, step = 0.01,
//     }],
//     warn = 0.8,                               // 扭矩比例超過這個值在備註提醒
//   }
// 沒宣告就略過（applicable: false），也不會載入 MuJoCo。
const SPECS = {
  'denso-vs068': async () => (await import('../robot/dynamics/denso-vs068.js')).VS068_DYNAMICS,
};

export async function verifyDynamics(project) {
  const cfg = project.verify?.dynamics;
  if (!cfg?.arms?.length) return { ok: true, applicable: false };
  const { inverseDynamics } = await import('../robot/dynamics.js');
  const rows = [], arms = [];
  for (const a of cfg.arms) {
    const spec = typeof a.spec === 'string' ? await SPECS[a.spec]?.() : a.spec;
    if (!spec) { rows.push({ group: a.name, name: '手臂型號', ok: false, warn: false, value: String(a.spec), note: `沒有這個型號；內建：${Object.keys(SPECS).join('、')}` }); continue; }
    const from = a.from ?? 0, to = a.to ?? project.total, step = a.step ?? 0.01, samples = [];
    for (let i = 0, t = from; t <= to + 1e-9; i++, t = from + i * step) samples.push({ t, q: a.sample(t) });
    let gravity;
    if (typeof a.gravity === 'function') {
      gravity = a.gravity(from).slice();
      let dev = 0; for (let k = 1; k <= 8; k++) { const g = a.gravity(from + (to - from) * k / 8); dev = Math.max(dev, Math.hypot(g[0] - gravity[0], g[1] - gravity[1], g[2] - gravity[2])); }
      if (dev > 1e-3) rows.push({ group: a.name, name: '基座重力方向', ok: true, warn: true, value: +dev.toFixed(3), note: '週期內基座方向會變（m/s² 差）；扭矩只用 t=' + from + ' s 的重力方向算，結果是近似' });
    } else if (a.gravity) gravity = a.gravity;
    const payload = typeof a.payload === 'function' ? a.payload() : a.payload ?? null;
    const r = await inverseDynamics(spec, samples, { payload: payload ? { mass: payload.mass, com: payload.com } : null, gravity, warn: cfg.warn ?? 0.8, group: a.name });
    if (payload?.estimate) rows.push({ group: a.name, name: '負載來源', ok: true, warn: false, value: `${payload.mass} kg`, note: `${payload.note ?? '估計值'}；質心 [${payload.com.join(', ')}] mm（法蘭座標）${payload.skipped?.length ? `；${payload.skipped.length} 件算不出體積沒算進去` : ''}` });
    arms.push({ name: a.name, samples: samples.length, gravity: gravity ? gravity.map(v => +v.toFixed(4)) : undefined, hash: r.hash, peak: Object.fromEntries(Object.entries(r.peak).map(([k, v]) => [k, { tau: +v.tau.toFixed(2), t: +v.t.toFixed(2), ratio: v.ratio == null ? null : +v.ratio.toFixed(3) }])) });
    // 只警告：保留原本的判定在 warn，ok 一律 true（軌跡不連續是資料問題，也只警告）
    for (const x of r.rows) rows.push({ ...x, warn: !x.ok, ok: true });
  }
  const bad = rows.filter(x => !x.ok);
  return { ok: bad.length === 0, applicable: true, rows, arms, warnings: rows.filter(x => x.warn).map(x => `${x.group} ${x.name}：${x.value}（${x.note}）`), failures: bad.map(x => `${x.group} ${x.name}：${x.note}`) };
}
