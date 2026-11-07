// 視角名稱：從 main.js 讀出 const views／VIEWS 物件第一層的鍵（shots.mjs、perf-check.mjs 共用）。
// 註解（// 與 /* */）與字串（'、"、`）整段跳過：2026-11-08 以前不跳，註解後面的視角會被漏掉，截圖回歸就拍不到它。
export function viewNames(src) {
  const m = /const\s+(?:views|VIEWS)\s*=\s*\{/.exec(src); if (!m) return ['iso'];
  // 第一層：鍵出現在開頭或逗號之後，緊接冒號
  const names = []; let depth = 1, expectKey = true, tok = '';
  for (let i = m.index + m[0].length; i < src.length && depth > 0; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') {
      // 字串：引號的鍵（'my-view': …）也算鍵
      let j = i + 1; while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      const s = src.slice(i + 1, j); i = j;
      if (depth === 1 && expectKey) tok = s; else { expectKey = false; tok = ''; }
      continue;
    }
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
