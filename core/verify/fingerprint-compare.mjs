// 排程指紋比對（純資料，不依賴 three，studio 可以直接引用）。指紋由 fingerprint.mjs 產生。

// a 的每個欄位都要在 b 裡而且相同（b 可以多出欄位）；回傳第一個不同的路徑
function subsetDiff(a, b, path = '') {
  if (a === null || typeof a !== 'object') return a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= .001) ? null : `${path || '（整體）'}：${JSON.stringify(a)} → ${JSON.stringify(b)}`;
  if (b === null || typeof b !== 'object') return `${path}：型別改變`;
  for (const k of Object.keys(a)) { const d = subsetDiff(a[k], b[k], path ? `${path}.${k}` : k); if (d) return d; }
  return null;
}

// 比對兩份指紋：總長、事件、狀態要相同；原本會動的物件要還在，各時間點位置差 ≤ tol（mm）
export function compareFingerprints(a, b, { tol = .5 } = {}) {
  const diffs = [];
  if (Math.abs(a.total - b.total) > .001) diffs.push(`時間軸總長 ${a.total} → ${b.total} s`);
  if (JSON.stringify(a.events) !== JSON.stringify(b.events)) diffs.push(`事件表改變（${a.events.length} → ${b.events.length} 筆）`);
  for (let i = 0; i < a.states.length; i++) {
    const d = subsetDiff(a.states[i], b.states?.[i]);
    if (d) { diffs.push(`apply(t) 的狀態改變（第 ${i + 1} 個取樣點，${d}）`); break; }
  }
  for (const [k, ps] of Object.entries(a.moving)) {
    const q = b.moving[k];
    if (!q) { diffs.push(`會動的物件不見了或改名：${k}`); continue; }
    const d = Math.max(...ps.flatMap((p, i) => p.map((x, j) => Math.abs(x - (q[i]?.[j] ?? Infinity)))));
    if (d > tol) diffs.push(`${k} 的軌跡改變（最大 ${d.toFixed(1)} mm）`);
  }
  return { ok: !diffs.length, diffs };
}
