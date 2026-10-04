// 視角名稱：從 main.js 讀出 const views／VIEWS 物件第一層的鍵（shots.mjs、perf-check.mjs 共用）。
export function viewNames(src) {
  const m = /const\s+(?:views|VIEWS)\s*=\s*\{/.exec(src); if (!m) return ['iso'];
  // 第一層：鍵出現在開頭或逗號之後，緊接冒號
  const names = []; let depth = 1, expectKey = true, tok = '';
  for (let i = m.index + m[0].length; i < src.length && depth > 0; i++) {
    const c = src[i];
    if ('{[('.includes(c)) { depth++; expectKey = false; tok = ''; continue; }
    if ('}])'.includes(c)) { depth--; continue; }
    if (depth !== 1) continue;
    if (c === ',') { expectKey = true; tok = ''; }
    else if (expectKey && /[\w$]/.test(c)) tok += c;
    else if (expectKey && c === ':' && tok) { names.push(tok); expectKey = false; tok = ''; }
    else if (!/\s/.test(c)) { expectKey = false; tok = ''; }
  }
  return [...new Set(names)];
}
