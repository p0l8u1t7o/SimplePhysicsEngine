// JSON 輸出：縮排 2，但純數字／字串的陣列放同一行（矩陣、座標好讀，檔案也小）。決定性。
export function stringifyCompact(obj) {
  return JSON.stringify(obj, null, 2).replace(/\[\s+([^\[\]{}]*?)\s+\]/g, (m, inner) => `[${inner.split(/,\s*/).join(', ')}]`);
}
