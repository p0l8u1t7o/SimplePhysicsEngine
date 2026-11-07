// 1D 管網水力（不可壓縮、穩態）：Darcy–Weisbach＋局部損失 K＋高程。樹狀管網直接累加流量；有迴路時用 Hardy Cross 迭代。
//
// 單位（全部 SI，和幾何的 mm 分開）：
//   長度 L、管內徑 D、粗糙度 eps、高程 z：m；流量 Q：m³/s（helpers：lpm()、m3h() 轉換）；
//   壓力 p：Pa（結果另給 kPa、bar）；水頭 head、損失 h：m；密度 kg/m³；黏度 Pa·s；動黏度 m²/s。
//   節點水頭 H = z + p/(ρg)（不含速度頭）；管段 from → to 的流量為正。
//
// 摩擦係數：層流 Re < 2000：f = 64/Re；紊流 Re > 4000：Colebrook（預設，迭代到 1e-12）或 Swamee–Jain（顯式）；
//   2000～4000 過渡區在兩端之間線性內插（regime: 'transitional'，結果只當量級）。
// 局部損失 K（K_FITTINGS）：Çengel & Cimbala《Fluid Mechanics》表 8-4 的典型值（示意，實際依廠商資料）；
//   彎管 kBend：Crane TP-410 的 90° 彎 K = fT × 係數(r/D)，其他角度依 θ/90 線性折算（近似）。
export const G = 9.80665;
export const lpm = v => v / 60000;          // L/min → m³/s
export const m3h = v => v / 3600;           // m³/h → m³/s
export const toLpm = q => q * 60000;

// 水的物性：密度（Tanaka 等 2001 的 Thiesen 型式公式）、黏度（Vogel 方程式），0～100 °C
export function water(T = 20) {
  const rho = 1000 * (1 - (T + 288.9414) / (508929.2 * (T + 68.12963)) * (T - 3.9863) ** 2);
  const mu = 2.414e-5 * 10 ** (247.8 / (T + 273.15 - 140));
  return { T, rho, mu, nu: mu / rho };
}

export const K_FITTINGS = Object.freeze({
  'elbow90-flanged': .3, 'elbow90-threaded': .9, 'elbow45-threaded': .4, 'miter90': 1.1, 'miter90-vanes': .2,
  'tee-line-flanged': .2, 'tee-line-threaded': .9, 'tee-branch-flanged': 1.0, 'tee-branch-threaded': 2.0,
  'union': .08, 'valve-globe': 10, 'valve-angle': 5, 'valve-ball': .05, 'valve-gate': .2, 'check-swing': 2,
  'entrance-sharp': .5, 'entrance-reentrant': .8, 'entrance-rounded': .03, 'exit': 1.0,
  'nozzle': 0,     // 噴嘴本身的壓降用節點的 pMin 表示
});
// Crane TP-410：90° 彎管 K = fT × 係數（r/D）
export const CRANE_BEND = [[1, 20], [1.5, 14], [2, 12], [3, 12], [4, 14], [6, 17], [8, 24], [10, 30], [12, 34], [14, 38], [16, 42], [20, 50]];

export const reynolds = (v, D, nu) => v * D / nu;
// 完全紊流的摩擦係數（Crane 的 fT）
export const fTurbulent = relRough => .25 / Math.log10(relRough / 3.7) ** 2;

export function swameeJain(Re, relRough) { return .25 / Math.log10(relRough / 3.7 + 5.74 / Re ** .9) ** 2; }
export function colebrook(Re, relRough) {
  let x = 1 / Math.sqrt(swameeJain(Re, relRough));          // x = 1/√f
  for (let i = 0; i < 100; i++) {
    const nx = -2 * Math.log10(relRough / 3.7 + 2.51 * x / Re);
    if (Math.abs(nx - x) < 1e-12) { x = nx; break; }
    x = nx;
  }
  return 1 / (x * x);
}
export function frictionFactor(Re, relRough, { method = 'colebrook' } = {}) {
  const turb = method === 'swamee-jain' ? swameeJain : colebrook;
  if (Re <= 0) return { f: 0, regime: 'none' };
  if (Re < 2000) return { f: 64 / Re, regime: 'laminar' };
  if (Re > 4000) return { f: turb(Re, relRough), regime: 'turbulent' };
  const t = (Re - 2000) / 2000;
  return { f: (1 - t) * 64 / 2000 + t * turb(4000, relRough), regime: 'transitional' };
}

export function kBend(angleDeg, rOverD, fT) {
  const T = CRANE_BEND, x = Math.max(T[0][0], Math.min(T.at(-1)[0], rOverD));
  let c = T.at(-1)[1];
  for (let i = 0; i < T.length - 1; i++) if (x <= T[i + 1][0]) { const t = (x - T[i][0]) / (T[i + 1][0] - T[i][0]); c = T[i][1] + t * (T[i + 1][1] - T[i][1]); break; }
  return fT * c * angleDeg / 90;
}

// 一段管：給流量 Q（可為負，代表反向），回傳損失（帶正負號：from → to 的水頭降）
export function pipeLoss({ Q, D, L, eps = 4.5e-5, K = 0 }, fluid = water(20), { method } = {}) {
  const A = Math.PI * D * D / 4, v = Math.abs(Q) / A, Re = reynolds(v, D, fluid.nu);
  const { f, regime } = frictionFactor(Re, eps / D, { method });
  const vh = v * v / (2 * G), hf = f * L / D * vh, hm = K * vh, s = Math.sign(Q);
  return { Q, v, Re, f, regime, hf: s * hf, hm: s * hm, dh: s * (hf + hm), dp: s * (hf + hm) * fluid.rho * G, velocityHead: vh };
}

// 一段管的 K 合計：K（數字）＋ fittings（K_FITTINGS 的名稱或數字）＋ bends（{ angle, rOverD, K? }，沒給 K 用 kBend）
export function linkK(link) {
  const fT = fTurbulent((link.eps ?? 4.5e-5) / link.D);
  let K = link.K ?? 0;
  for (const f of link.fittings ?? []) { const k = typeof f === 'number' ? f : K_FITTINGS[f]; if (k == null) throw new Error(`K_FITTINGS 沒有 ${f}`); K += k; }
  for (const b of link.bends ?? []) K += b.K ?? kBend(b.angle, b.rOverD ?? 1.5, fT);
  return K;
}

// 管網求解
//   nodes: [{ id, z（m）, demand（流出 m³/s，預設 0）, pMin（Pa，需要的最低壓力，選填）}]
//   links: [{ id, from, to, L, D, eps, K, fittings, bends }]
//   source: { node, head（m，總水頭）或 pressure（Pa），suction（m，泵吸入側總水頭，給了才算泵揚程）, eta（泵效率，預設 0.65）}
//     head／pressure 都沒給：取剛好滿足所有 pMin 的水頭（沒有 pMin 時＝水源高程，表壓 0）
export function solveNetwork({ nodes, links, source, fluid = water(20), method = 'colebrook', tol = 1e-10, maxIter = 500 }) {
  const N = new Map(nodes.map(n => [n.id, n]));
  const lk = links.map(l => ({ ...l, Ksum: linkK(l), eps: l.eps ?? 4.5e-5 }));
  const loss = (i, Q) => pipeLoss({ Q, D: lk[i].D, L: lk[i].L, eps: lk[i].eps, K: lk[i].Ksum }, fluid, { method }).dh;
  // 生成樹（從水源 BFS，依 links 順序，結果決定）
  const adj = new Map(nodes.map(n => [n.id, []]));
  lk.forEach((l, i) => { if (!adj.has(l.from) || !adj.has(l.to)) throw new Error(`管段 ${l.id ?? i} 連到不存在的節點`); adj.get(l.from).push([i, l.to]); adj.get(l.to).push([i, l.from]); });
  const parent = new Map([[source.node, null]]), order = [source.node], treeLink = new Map(), inTree = new Set();
  for (let q = 0; q < order.length; q++) for (const [i, nb] of adj.get(order[q])) if (!parent.has(nb)) { parent.set(nb, order[q]); treeLink.set(nb, i); inTree.add(i); order.push(nb); }
  if (order.length !== nodes.length) throw new Error('管網有節點沒有連到水源');
  // 初始流量：樹上的管段帶下游需求，迴路弦為 0
  const Q = new Array(lk.length).fill(0), sub = new Map(nodes.map(n => [n.id, n.demand ?? 0]));
  for (let q = order.length - 1; q > 0; q--) {
    const c = order[q], p = parent.get(c), i = treeLink.get(c);
    Q[i] = lk[i].from === p ? sub.get(c) : -sub.get(c);
    sub.set(p, sub.get(p) + sub.get(c));
  }
  // 迴路：每條弦＋樹上的路徑
  const depth = new Map([[source.node, 0]]); for (const id of order.slice(1)) depth.set(id, depth.get(parent.get(id)) + 1);
  const loops = [];
  lk.forEach((l, i) => {
    if (inTree.has(i)) return;
    const loop = [[i, 1]];                                       // u → v 走弦
    let a = l.to, b = l.from; const up = [], down = [];          // 從 v 走回 u：v 往上到共同祖先，再往下到 u
    while (depth.get(a) > depth.get(b)) { up.push(a); a = parent.get(a); }
    while (depth.get(b) > depth.get(a)) { down.push(b); b = parent.get(b); }
    while (a !== b) { up.push(a); a = parent.get(a); down.push(b); b = parent.get(b); }
    for (const n of up) { const j = treeLink.get(n); loop.push([j, lk[j].from === n ? 1 : -1]); }          // n → parent(n)
    for (const n of down.reverse()) { const j = treeLink.get(n); loop.push([j, lk[j].to === n ? 1 : -1]); } // parent(n) → n
    loops.push(loop);
  });
  let iterations = 0, residual = 0;
  if (loops.length) {
    for (; iterations < maxIter; iterations++) {
      let maxDQ = 0;
      for (const loop of loops) {
        let h = 0, d = 0;
        for (const [i, s] of loop) {
          h += s * loss(i, Q[i]);
          const dq = Math.max(1e-9, Math.abs(Q[i]) * 1e-4);
          d += (loss(i, Q[i] + dq) - loss(i, Q[i] - dq)) / (2 * dq);
        }
        const dQ = d > 0 ? -h / d : 0;
        for (const [i, s] of loop) Q[i] += s * dQ;
        maxDQ = Math.max(maxDQ, Math.abs(dQ));
      }
      if (maxDQ < tol) { iterations++; break; }
    }
    residual = Math.max(...loops.map(loop => Math.abs(loop.reduce((t, [i, s]) => t + s * loss(i, Q[i]), 0))));
  }
  // 水頭：先以水源 H = 0 求各點的相對水頭，再決定水源水頭
  const rel = new Map([[source.node, 0]]);
  for (const c of order.slice(1)) { const p = parent.get(c), i = treeLink.get(c), dh = loss(i, Q[i]); rel.set(c, lk[i].from === p ? rel.get(p) - dh : rel.get(p) + dh); }
  const rhoG = fluid.rho * G, zs = N.get(source.node).z;
  let required = zs, governing = null;
  for (const n of nodes) if (n.pMin != null) { const need = n.z + n.pMin / rhoG - rel.get(n.id); if (need > required + 1e-12) { required = need; governing = n.id; } }
  const Hs = source.head ?? (source.pressure != null ? zs + source.pressure / rhoG : required);
  const totalQ = nodes.reduce((t, n) => t + (n.demand ?? 0), 0) - (N.get(source.node).demand ?? 0);
  const out = {
    units: 'm、m³/s、Pa（kPa、bar 另列）', fluid,
    links: lk.map((l, i) => { const r = pipeLoss({ Q: Q[i], D: l.D, L: l.L, eps: l.eps, K: l.Ksum }, fluid, { method }); return { id: l.id ?? i, from: l.from, to: l.to, L: l.L, D: l.D, K: l.Ksum, ...r }; }),
    nodes: nodes.map(n => { const H = Hs + rel.get(n.id), p = (H - n.z) * rhoG; return { id: n.id, z: n.z, head: H, p, kPa: p / 1000, bar: p / 1e5, pMin: n.pMin ?? null, ok: n.pMin == null || p >= n.pMin - 1e-6 }; }),
    source: { node: source.node, head: Hs, requiredHead: required, governing, flow: totalQ },
    loops: loops.length, iterations, loopResidual: residual,
  };
  if (source.suction != null) {
    const H = required - source.suction, eta = source.eta ?? .65;
    out.pump = { head: H, flow: totalQ, hydraulicW: fluid.rho * G * totalQ * H, shaftW: fluid.rho * G * totalQ * H / eta, eta };
  }
  return out;
}
