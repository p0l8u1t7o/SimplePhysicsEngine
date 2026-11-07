// 構件清單的共用部分：建立構件紀錄、彙總 BOM、切長清單。純計算，不依賴 three。
// 構件紀錄（member）：
//   { id, kind: 'pile'|'rafter'|'purlin'|'brace'|'tube'|'rail', profile（斷面 id）, a, b（兩端中心線點，mm）,
//     up（斷面局部 y＝腹板方向的單位向量）, length（mm，0.1）, angle（與水平面的夾角，度）, mid, kg,
//     row, table, frame, 以及各類型的額外欄位（基樁的 ground／top／reveal／embed，追日可動件的 pivot）}
import { sub, len, lerp, elevationDeg, round3 } from './vec.js';
import { profile } from './profiles.js';

export function member(kind, prof, a, b, up, extra = {}) {
  const P = profile(prof), L = len(sub(b, a));
  return {
    kind, profile: P.id, a: round3(a), b: round3(b), up, length: Math.round(L * 10) / 10,
    angle: Math.round(elevationDeg(sub(b, a)) * 100) / 100, mid: round3(lerp(a, b, .5)),
    kg: Math.round(P.kgPerM * L / 1000 * 100) / 100, ...extra,
  };
}

// BOM：依斷面、依構件類型彙總；切長清單把長度進位到 cutRound（mm）後合併同長度
export function bom(members, { cutRound = 10 } = {}) {
  const byProfile = new Map(), byKind = new Map(), cuts = new Map();
  let kg = 0, length = 0;
  for (const m of members) {
    const P = profile(m.profile);
    const bp = byProfile.get(m.profile) ?? { profile: m.profile, type: P.type, kgPerM: Math.round(P.kgPerM * 1000) / 1000, count: 0, lengthM: 0, kg: 0 };
    bp.count++; bp.lengthM += m.length / 1000; bp.kg += m.kg; byProfile.set(m.profile, bp);
    const k = m.kind + '|' + m.profile;
    const bk = byKind.get(k) ?? { kind: m.kind, profile: m.profile, count: 0, lengthM: 0, kg: 0, min: Infinity, max: 0 };
    bk.count++; bk.lengthM += m.length / 1000; bk.kg += m.kg; bk.min = Math.min(bk.min, m.length); bk.max = Math.max(bk.max, m.length); byKind.set(k, bk);
    const cutLen = Math.ceil(m.length / cutRound) * cutRound, ck = k + '|' + cutLen;
    const c = cuts.get(ck) ?? { kind: m.kind, profile: m.profile, cut: cutLen, count: 0 };
    c.count++; cuts.set(ck, c);
    kg += m.kg; length += m.length / 1000;
  }
  const r2 = o => ({ ...o, lengthM: Math.round(o.lengthM * 100) / 100, kg: Math.round(o.kg * 10) / 10 });
  return {
    byProfile: [...byProfile.values()].map(r2).sort((a, b) => a.profile.localeCompare(b.profile)),
    byKind: [...byKind.values()].map(r2).sort((a, b) => a.kind.localeCompare(b.kind) || a.profile.localeCompare(b.profile)),
    cuts: [...cuts.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.profile.localeCompare(b.profile) || a.cut - b.cut),
    cutRound,
    total: { count: members.length, kg: Math.round(kg * 10) / 10, lengthM: Math.round(length * 100) / 100 },
  };
}

// 長料分段：總長 L 依庫存長度 stock 分段；splitAt 給候選接頭位置（例如斜樑所在處），盡量把接頭放在上面
export function splitStock(L, stock, splitAt = []) {
  const n = Math.ceil(L / stock - 1e-9);
  if (n <= 1) return [[0, L]];
  const cuts = [];
  for (let i = 1; i < n; i++) {
    const want = L * i / n;
    let best = want, bd = Infinity;
    for (const u of splitAt) if (u > 0 && u < L && Math.abs(u - want) < bd) { bd = Math.abs(u - want); best = u; }
    cuts.push(best);
  }
  const bounds = [0, ...cuts, L], pieces = [];
  for (let i = 0; i < bounds.length - 1; i++) pieces.push([bounds[i], bounds[i + 1]]);
  // 接頭靠到支點後如果有一段超過庫存長度，退回等分
  if (pieces.some(([a, b]) => b - a > stock + 1e-6 || b - a <= 0)) return Array.from({ length: n }, (_, i) => [L * i / n, L * (i + 1) / n]);
  return pieces;
}
