// Twin Protocol 的分框（JSON Lines，twin-protocol README §1）：UTF-8、不可有 BOM、每則訊息一行、以 LF 結尾。
// 接收端容忍行尾多一個 \r、忽略空行；單行（含 LF）超過自己宣告的上限 → LINE_TOO_LONG（fatal）；BOM、非 UTF-8、非 JSON 物件 → BAD_JSON（fatal）。
// 傳送端只送 LF，且不得超過對方宣告的 maxLine。瀏覽器與 Node 都能載入（只用 Uint8Array、TextEncoder／TextDecoder）。
//
//   const reader = createLineReader({ maxLine: 1048576 });
//   socket.on('data', chunk => { const { lines, error } = reader.push(chunk); … });
//   const r = parseMessage(line);           // { msg } 或 { error: { code: 'BAD_JSON', msg } }
//   const out = encodeMessage(msg, peerMaxLine);   // { text, bytes } 或 { error: { code: 'LINE_TOO_LONG', msg } }

export const DEFAULT_MAX_LINE = 1048576;
export const MIN_MAX_LINE = 65536;
export const MAX_MAX_LINE = 16777216;

const LF = 10, CR = 13;
const encoder = new TextEncoder();

// 行讀取器：push(chunk) 回傳這次湊齊的完整行（字串，已去掉 LF 與行尾 \r、略過空行）；
// 一旦發生錯誤（error 非 null）就不再輸出任何行，呼叫端回 fatal error 後關閉連線、不重新同步
export function createLineReader({ maxLine = DEFAULT_MAX_LINE } = {}) {
  let parts = [], size = 0, dead = false;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const fail = (lines, code, msg) => { dead = true; parts = []; size = 0; return { lines, error: { code, msg } }; };
  function finish(piece) {
    let bytes = piece;
    if (parts.length) { parts.push(piece); bytes = new Uint8Array(size + piece.length); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; } }
    parts = []; size = 0;
    return bytes;
  }
  return {
    get closed() { return dead; },
    push(chunk) {
      const lines = [];
      if (dead) return { lines, error: null };
      const data = chunk instanceof Uint8Array ? chunk : encoder.encode(String(chunk));
      let start = 0;
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== LF) continue;
        const piece = data.subarray(start, i); start = i + 1;
        if (size + piece.length + 1 > maxLine) return fail(lines, 'LINE_TOO_LONG', `一行超過 ${maxLine} 位元組（含 LF）`);
        let bytes = finish(piece);
        if (bytes.length && bytes[bytes.length - 1] === CR) bytes = bytes.subarray(0, bytes.length - 1);
        if (!bytes.length) continue;
        if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return fail(lines, 'BAD_JSON', '行首有 UTF-8 BOM');
        let text;
        try { text = decoder.decode(bytes); } catch { return fail(lines, 'BAD_JSON', '不是合法的 UTF-8'); }
        lines.push(text);
      }
      const rest = data.subarray(start);
      if (rest.length) {
        // 還沒收到 LF：先累積；累積量已經放不下 LF 時立即判超長（不等 LF）
        if (size + rest.length + 1 > maxLine) return fail(lines, 'LINE_TOO_LONG', `一行超過 ${maxLine} 位元組（含 LF）`);
        parts.push(rest.slice()); size += rest.length;
      }
      return { lines, error: null };
    },
  };
}

// 一行文字 → 訊息物件；不是 JSON 或不是物件（含陣列、null）→ BAD_JSON
export function parseMessage(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return { error: { code: 'BAD_JSON', msg: '不是 JSON' } }; }
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return { error: { code: 'BAD_JSON', msg: '每一行必須是一個 JSON 物件' } };
  return { msg };
}

// 訊息 → 單行緊湊 JSON＋LF；超過對方宣告的 maxLine 時不送（不送半行），回傳 error
export function encodeMessage(msg, maxLine = DEFAULT_MAX_LINE) {
  const text = JSON.stringify(msg) + '\n';
  const bytes = encoder.encode(text);
  if (bytes.length > maxLine) return { error: { code: 'LINE_TOO_LONG', msg: `訊息 ${msg?.t} 有 ${bytes.length} 位元組，超過對方宣告的 ${maxLine}` } };
  return { text, bytes };
}
