// 烘焙結果的分析（評估平台 Q8）：四種用途各一組數字，給可行性分析、檢查與範例頁用。全部只讀烘焙的軌跡（決定性）。
//   flowStats   輸送物料流：通過某一條線的件數與每分鐘產能、區段內的平均密度（件／m）、間距
//   settleTime  掉落／堆積：全部（或指定的）物體都慢於 speed 的時間
//   landings    掉落／滑槽：每個物體第一次進入落點區的時間與位置
//   pileStats   料箱堆積：箱內件數、堆高、可以從上方抓取的件（朝上、上方沒有別的物體擋）
//   slip        夾取穩定：物體相對夾爪（kinematic）的最大位移
const pose = (b, x, f) => { const i = Math.max(0, Math.min(b.frames - 1, f)) * 7, F = x.frames; return { p: [F[i], F[i + 1], F[i + 2]], q: [F[i + 3], F[i + 4], F[i + 5], F[i + 6]] }; };
const alive = (b, x, f) => f >= Math.round(x.born * b.hz) && (x.died === Infinity || f < Math.round(x.died * b.hz));
const frameOf = (b, t) => Math.max(0, Math.min(b.frames - 1, Math.round(t * b.hz)));
const inBox = (p, r) => p.every((v, k) => v >= r.min[k] && v <= r.max[k]);
const rotate = (q, v) => { const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
// 速度（mm/s）：前後一格的差分
export function speedAt(b, x, t) { const f = frameOf(b, t), g = Math.min(b.frames - 1, f + 1), h = Math.max(0, g - 1); if (!alive(b, x, h) || !alive(b, x, g) || g === h) return 0; const A = pose(b, x, h).p, B = pose(b, x, g).p; return Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) * b.hz; }

export function flowStats(b, { axis = 0, at = 0, from = 0, to = b.duration, region = null } = {}) {
  const f0 = frameOf(b, from), f1 = frameOf(b, to), times = [];
  for (const x of b.bodies) for (let f = Math.max(f0, 1); f <= f1; f++) {
    if (!alive(b, x, f) || !alive(b, x, f - 1)) continue;
    if (pose(b, x, f - 1).p[axis] < at && pose(b, x, f).p[axis] >= at) { times.push(f / b.hz); break; }
  }
  times.sort((a, c) => a - c);
  const gaps = times.slice(1).map((t, i) => t - times[i]), span = Math.max(1e-9, to - from);
  let density = null;
  if (region) {
    const len = (region.max[axis] - region.min[axis]) / 1000; let n = 0, k = 0;
    for (let f = f0; f <= f1; f += Math.max(1, Math.round(b.hz / 10))) { k++; n += b.bodies.filter(x => alive(b, x, f) && inBox(pose(b, x, f).p, region)).length; }
    density = k ? n / k / len : 0;
  }
  return { count: times.length, perMinute: times.length / span * 60, times, gap: gaps.length ? { min: Math.min(...gaps), mean: gaps.reduce((a, c) => a + c, 0) / gaps.length } : null, density };
}

export function settleTime(b, { speed = 5, ids = null } = {}) {
  const list = b.bodies.filter(x => !ids || ids.includes(x.id));
  for (let f = 0; f < b.frames - 1; f++) {
    let ok = true;
    for (let g = f; g < b.frames - 1 && ok; g += Math.max(1, Math.round(b.hz / 20))) for (const x of list) if (alive(b, x, g) && speedAt(b, x, g / b.hz) >= speed) { ok = false; break; }
    if (ok && list.every(x => x.born <= f / b.hz)) return f / b.hz;
  }
  return null;
}

export function landings(b, { region }) {
  return b.bodies.map(x => { for (let f = Math.round(x.born * b.hz); f < b.frames; f++) if (alive(b, x, f) && inBox(pose(b, x, f).p, region)) return { id: x.id, t: f / b.hz, pos: pose(b, x, f).p }; return { id: x.id, t: null, pos: null }; });
}

// 料箱：t 時在 region 內的物體；可抓取＝物體的上下軸（方塊的 y、圓柱的軸）和世界的上方夾角 ≤ approachDeg，而且水平 clearance 內沒有更高的物體
export function pileStats(b, t, { region, approachDeg = 30, clearance = 40 } = {}) {
  const f = frameOf(b, t), list = b.bodies.filter(x => alive(b, x, f)).map(x => ({ x, ...pose(b, x, f) })).filter(o => inBox(o.p, region));
  const half = o => o.x.shape === 'sphere' ? (o.x.size.r ?? o.x.size[0] / 2) : o.x.shape === 'cylinder' ? Math.max(o.x.size.h ?? o.x.size[1], (o.x.size.r ?? o.x.size[0] / 2) * 2) / 2 : Math.max(...o.x.size) / 2;
  const graspable = list.filter(o => {
    const up = rotate(o.q, [0, 1, 0]), tilt = Math.acos(Math.min(1, Math.abs(up[1]))) * 180 / Math.PI;
    if (o.x.shape !== 'sphere' && tilt > approachDeg) return false;
    return !list.some(k => k !== o && k.p[1] > o.p[1] + 5 && Math.hypot(k.p[0] - o.p[0], k.p[2] - o.p[2]) < clearance + half(k));
  }).map(o => ({ id: o.x.id, item: o.x.item, pos: o.p.map(v => +v.toFixed(1)) }));
  return { count: list.length, height: list.length ? Math.max(...list.map(o => o.p[1] + half(o))) - region.min[1] : 0, graspable };
}

// 夾取穩定：from～to 之間，物體在夾爪座標裡的位置和 from 時相比的最大位移（mm）
export function slip(b, bodyId, kinId, { from, to }) {
  const x = b.bodies.find(o => o.id === bodyId), k = b.kinematics.find(o => o.id === kinId);
  if (!x || !k) return null;
  const local = f => { const P = pose(b, x, f).p, K = pose(b, k, f), [qx, qy, qz, qw] = K.q; return rotate([-qx, -qy, -qz, qw], [P[0] - K.p[0], P[1] - K.p[1], P[2] - K.p[2]]); };
  const f0 = frameOf(b, from), f1 = frameOf(b, to), r0 = local(f0);
  let max = 0;
  for (let f = f0; f <= f1; f++) { if (!alive(b, x, f)) break; const r = local(f); max = Math.max(max, Math.hypot(r[0] - r0[0], r[1] - r0[1], r[2] - r0[2])); }
  return { max, final: (r => Math.hypot(r[0] - r0[0], r[1] - r0[1], r[2] - r0[2]))(local(f1)) };
}
