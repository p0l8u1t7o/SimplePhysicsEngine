// 剛體動力學檢查（check.mjs 的 physics，評估平台 Q8）：站在 createProject 裡用 core/physics 烘焙，把結果放在 project.physics（一個或陣列）。
// 檢查：同一份設定再烘焙一次雜湊相同（決定性）、靜止接觸的穿透在門檻內、烘焙時間在預算內。沒有用物理的站略過。
// 線材（core/physics/rope.js 的 bakeRope，kind: 'rope'）另外檢查最大伸長率（線長夠不夠）。
// 門檻可以在 project.verify.physics 改：{ restTol（mm，預設 8）, budgetMs（每份烘焙，預設 10000）, stretchTol（線材伸長率，預設 0.03） }
export async function verifyPhysics(project) {
  const list = project.physics ? [].concat(project.physics) : [];
  if (!list.length) return { ok: true, applicable: false };
  const cfg = project.verify?.physics || {}, restTol = cfg.restTol ?? 8, budgetMs = cfg.budgetMs ?? 10000, stretchTol = cfg.stretchTol ?? 0.03;
  const failures = [], rows = [];
  // 剛體（physics.js，要載入 Rapier）和線材（rope.js，純 JS）各自重烘；只用線材的站不載入 Rapier
  const rigid = list.some(b => b.kind !== 'rope') ? (await import('../physics/physics.js')).bake : null;
  const rope = list.some(b => b.kind === 'rope') ? (await import('../physics/rope.js')).bakeRope : null;
  for (const [i, b] of list.entries()) {
    const name = b.spec?.name || `烘焙 ${i + 1}`, again = b.kind === 'rope' ? rope(b.spec) : await rigid(b.spec);
    // 線材：伸長率超過門檻代表兩端在某個時刻比線長還遠（實機會被扯），要加長線或改走線
    if (b.kind === 'rope' && b.stats.maxStretch > stretchTol) failures.push(`${name}：線材最大伸長 ${(b.stats.maxStretch * 100).toFixed(1)}% 超過 ${(stretchTol * 100).toFixed(0)}%（線長不夠：兩端在某個時刻比線長還遠，加長線材或改走線）`);
    if (again.stats.hash !== b.stats.hash) failures.push(`${name}：同一份設定再烘焙一次結果不同（${b.stats.hash} / ${again.stats.hash}），可能用了 Math.random 或時間`);
    if (b.stats.maxPenetration > restTol) failures.push(`${name}：靜止接觸穿透 ${b.stats.maxPenetration} mm 超過 ${restTol} mm（物體生成太密、太重的堆疊或太薄的固定物）`);
    if (again.stats.ms > budgetMs) failures.push(`${name}：烘焙 ${again.stats.ms} ms 超過預算 ${budgetMs} ms（網頁載入時要等）`);
    // 烘焙耗時只拿來比預算，不放進結果：結果會寫成 review JSON，耗時每次都不同（AGENTS.md：review JSON 不要寫入耗時）
    rows.push({ name, ...(b.kind === 'rope' ? { kind: 'rope', nodes: b.stats.nodes, stretch: b.stats.maxStretch } : {}), bodies: b.stats.bodies, steps: b.stats.steps, rest: b.stats.maxPenetration, peak: b.stats.peakPenetration, hash: b.stats.hash });
  }
  return { ok: !failures.length, applicable: true, bakes: rows.length, bodies: rows.reduce((a, r) => a + r.bodies, 0), rest: Math.max(...rows.map(r => r.rest)),
    rows, failures };
}
