// 影像緩存佇列與判定（兩個方案共用）：相機拍完不等演算法，影像直接進佇列；GPU 依序判定（先進先出）。
// 一顆工件的最後一張判完 → 結果就緒；分料點需要結果的時間 needAt 之前就緒就不用等，否則手臂（或分料）停下來等。
// 處理時間為示意值（缺陷分割模型＋前處理，單張 GPU 推論），打樣後實測。
export const PROC_MS = { '5MP': 30, '1.6MP': 12 };
export const WORKERS = 1;

// images：[{ t（拍攝時間）, part, cost（秒）, ng（這張拍到判 NG 的缺陷） }]
export function simulateQueue(images, { workers = WORKERS } = {}) {
  const free = Array(workers).fill(0), out = [...images].sort((a, b) => a.t - b.t || a.part - b.part);
  for (const im of out) {
    let w = 0; for (let i = 1; i < workers; i++) if (free[i] < free[w]) w = i;
    im.start = Math.max(im.t, free[w]); im.done = im.start + im.cost; free[w] = im.done;
  }
  return out;
}

// 每顆工件：張數、最後一張拍攝時間、全部判完時間、需要結果的時間、餘裕（正＝提前、負＝要等）、判定
export function partVerdicts(images, needAt) {
  const by = {};
  for (const im of images) {
    const p = by[im.part] ??= { part: im.part, n: 0, first: Infinity, last: 0, done: 0, ng: false, hits: [] };
    p.n++; p.first = Math.min(p.first, im.t); p.last = Math.max(p.last, im.t); p.done = Math.max(p.done, im.done);
    if (im.ng) { p.ng = true; p.hits.push(im); }
    if (im.defect && !im.ng) p.hits.push(im);
  }
  return Object.values(by).map(p => ({ ...p, needAt: needAt(p.part), slack: needAt(p.part) - p.done })).sort((a, b) => a.part - b.part);
}

// 時間 T 的佇列狀態：已拍、已判（每顆）、佇列中張數
export function queueAt(images, T) {
  let waiting = 0; const parts = {};
  for (const im of images) {
    if (im.t > T) continue;
    const p = parts[im.part] ??= { shot: 0, done: 0, ng: false };
    p.shot++; if (im.done <= T) { p.done++; if (im.ng) p.ng = true; } else waiting++;
  }
  return { waiting, parts };
}
