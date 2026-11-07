// 剛體動力學檢查（check.mjs 的 physics，評估平台 Q8）：站在 createProject 裡用 core/physics 烘焙，把結果放在 project.physics（一個或陣列）。
// 檢查：同一份設定再烘焙一次雜湊相同（決定性）、靜止接觸的穿透在門檻內、烘焙時間在預算內。沒有用物理的站略過。
//   線材（rope）：最大伸長率 ≤ stretchTol（線長夠不夠）。
//   布料（cloth）：最大伸長率 ≤ clothStretchTol（布被拉破、釘點移動超過布的尺寸）。
//   流體（fluid）：平均密度誤差 ≤ densityTol（太大代表 iterations 不夠、步長太大，液面會矮一截）；鄰居清單滿了（neighborOverflow）要調 kernel；
//                 spec.contain（{ min, max }，容器內部）給了就檢查結束時留在裡面的比例 ≥ containTol（液體漏出或濺出容器）；
//                 粒子到上限（capped）只記在結果裡，不算失敗（注入量被截掉，畫面上的液位會比設定的少）。
// 門檻可以在 project.verify.physics 改：{ restTol（mm，預設 8）, budgetMs（每份烘焙，預設 10000；流體預設 20000）, stretchTol（線材，0.03）,
//   clothStretchTol（布料，0.05）, densityTol（流體，0.05）, containTol（流體，0.98） }
export async function verifyPhysics(project) {
  const list = project.physics ? [].concat(project.physics) : [];
  if (!list.length) return { ok: true, applicable: false };
  const cfg = project.verify?.physics || {}, restTol = cfg.restTol ?? 8, stretchTol = cfg.stretchTol ?? 0.03, clothTol = cfg.clothStretchTol ?? 0.05;
  const densityTol = cfg.densityTol ?? 0.05, containTol = cfg.containTol ?? 0.98;
  const budgetOf = b => cfg.budgetMs ?? (b.kind === 'fluid' ? 20000 : 10000);
  const failures = [], rows = [];
  // 各種烘焙各自載入：只用線材、布料、流體的站不載入 Rapier
  const kinds = new Set(list.map(b => b.kind || 'rigid'));
  const bakers = {
    rigid: kinds.has('rigid') ? (await import('../physics/physics.js')).bake : null,
    rope: kinds.has('rope') ? (await import('../physics/rope.js')).bakeRope : null,
    cloth: kinds.has('cloth') ? (await import('../physics/cloth.js')).bakeCloth : null,
    fluid: kinds.has('fluid') ? (await import('../physics/fluid.js')).bakeFluid : null,
  };
  const fluidStats = kinds.has('fluid') ? (await import('../physics/fluid.js')).fluidStats : null;
  for (const [i, b] of list.entries()) {
    const kind = b.kind || 'rigid', name = b.spec?.name || `烘焙 ${i + 1}`, again = await bakers[kind](b.spec);
    if (again.stats.hash !== b.stats.hash) failures.push(`${name}：同一份設定再烘焙一次結果不同（${b.stats.hash} / ${again.stats.hash}），可能用了 Math.random 或時間`);
    if (b.stats.maxPenetration > restTol) failures.push(`${name}：靜止接觸穿透 ${b.stats.maxPenetration} mm 超過 ${restTol} mm（物體生成太密、太重的堆疊或太薄的固定物）`);
    if (again.stats.ms > budgetOf(b)) failures.push(`${name}：烘焙 ${again.stats.ms} ms 超過預算 ${budgetOf(b)} ms（網頁載入時要等）`);
    const row = { name, kind, bodies: b.stats.bodies, steps: b.stats.steps, rest: b.stats.maxPenetration, peak: b.stats.peakPenetration, hash: b.stats.hash };
    if (kind === 'rope') {
      if (b.stats.maxStretch > stretchTol) failures.push(`${name}：線材最大伸長 ${(b.stats.maxStretch * 100).toFixed(1)}% 超過 ${(stretchTol * 100).toFixed(0)}%（線長不夠：兩端在某個時刻比線長還遠，加長線材或改走線）`);
      Object.assign(row, { nodes: b.stats.nodes, stretch: b.stats.maxStretch });
    }
    if (kind === 'cloth') {
      if (b.stats.maxStretch > clothTol) failures.push(`${name}：布料最大伸長 ${(b.stats.maxStretch * 100).toFixed(1)}% 超過 ${(clothTol * 100).toFixed(0)}%（釘點拉得比布還開，或 substeps 不夠；吊掛的薄膜可以放寬 clothStretchTol）`);
      Object.assign(row, { nodes: b.stats.nodes, stretch: b.stats.maxStretch });
    }
    if (kind === 'fluid') {
      const s = b.stats;
      if (s.avgDensityError > densityTol) failures.push(`${name}：流體平均密度誤差 ${(s.avgDensityError * 100).toFixed(1)}% 超過 ${(densityTol * 100).toFixed(0)}%（加 iterations、縮小 dt，或粒子太少）`);
      if (s.neighborOverflow > 0) failures.push(`${name}：鄰居清單滿了 ${s.neighborOverflow} 次（kernel 相對 spacing 太大）`);
      Object.assign(row, { particles: s.particles, alivePeak: s.peak, killed: s.killed, capped: s.capped, density: s.avgDensityError });
      if (b.spec.contain) {
        const st = fluidStats(b, b.duration, { region: b.spec.contain }), frac = st.total ? st.count / st.total : 1;
        row.contained = Math.round(frac * 1e4) / 1e4;
        if (frac < containTol) failures.push(`${name}：結束時只有 ${(frac * 100).toFixed(1)}% 的液體留在容器內（${st.outside} 顆在外面；噴嘴對不準、速度太快或容器太淺）`);
      }
    }
    // 烘焙耗時只拿來比預算，不放進結果：結果會寫成 review JSON，耗時每次都不同（AGENTS.md：review JSON 不要寫入耗時）
    rows.push(row);
  }
  return { ok: !failures.length, applicable: true, bakes: rows.length, bodies: rows.reduce((a, r) => a + (r.bodies || 0), 0), rest: Math.max(...rows.map(r => r.rest)),
    rows, failures };
}
