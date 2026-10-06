// 剛體動力學檢查（check.mjs 的 physics，評估平台 Q8）：站在 createProject 裡用 core/physics 烘焙，把結果放在 project.physics（一個或陣列）。
// 檢查：同一份設定再烘焙一次雜湊相同（決定性）、靜止接觸的穿透在門檻內、烘焙時間在預算內。沒有用物理的站略過。
// 門檻可以在 project.verify.physics 改：{ restTol（mm，預設 8）, budgetMs（每份烘焙，預設 10000） }
export async function verifyPhysics(project) {
  const list = project.physics ? [].concat(project.physics) : [];
  if (!list.length) return { ok: true, applicable: false };
  const { bake } = await import('../physics/physics.js'), cfg = project.verify?.physics || {}, restTol = cfg.restTol ?? 8, budgetMs = cfg.budgetMs ?? 10000;
  const failures = [], rows = [];
  for (const [i, b] of list.entries()) {
    const name = b.spec?.name || `烘焙 ${i + 1}`, again = await bake(b.spec);
    if (again.stats.hash !== b.stats.hash) failures.push(`${name}：同一份設定再烘焙一次結果不同（${b.stats.hash} / ${again.stats.hash}），可能用了 Math.random 或時間`);
    if (b.stats.maxPenetration > restTol) failures.push(`${name}：靜止接觸穿透 ${b.stats.maxPenetration} mm 超過 ${restTol} mm（物體生成太密、太重的堆疊或太薄的固定物）`);
    if (again.stats.ms > budgetMs) failures.push(`${name}：烘焙 ${again.stats.ms} ms 超過預算 ${budgetMs} ms（網頁載入時要等）`);
    rows.push({ name, bodies: b.stats.bodies, steps: b.stats.steps, rest: b.stats.maxPenetration, peak: b.stats.peakPenetration, ms: again.stats.ms, hash: b.stats.hash });
  }
  return { ok: !failures.length, applicable: true, bakes: rows.length, bodies: rows.reduce((a, r) => a + r.bodies, 0), rest: Math.max(...rows.map(r => r.rest)),
    ms: rows.reduce((a, r) => a + r.ms, 0), rows, failures };
}
