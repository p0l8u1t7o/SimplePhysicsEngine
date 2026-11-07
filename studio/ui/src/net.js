// 和 vs3d ui 伺服器溝通的底層工具（不依賴 React；studio/test/fixes.test.mjs 直接用 node:test 測）
//   call：JSON API；send：上傳檔案（內容直接當 body）；兩者遇到 401 都通知主畫面回到登入頁
//   createThrottle：把很密的通知合併（例如每一行執行輸出），一段時間內最多做一次，最後一次一定會做到

export const UNAUTHORIZED_EVENT = 'vs3d-unauthorized';

async function finish(r, url) {
  const j = await r.json().catch(() => ({}));
  // 登入過期或帳號被停用：通知主畫面回到登入頁（登入、setup 自己的 401 是密碼錯，不算）
  if (r.status === 401 && !url.startsWith('/api/auth/')) dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`);
  return j;
}

export async function call(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return finish(r, url);
}

export async function send(url, file) {
  const r = await fetch(url, { method: 'POST', body: file });
  return finish(r, url);
}

// 節流：call() 閒置時馬上做，之後 ms 內再來的合併成一次、在時間到時做；flush() 立刻做（取消排著的）；cancel() 只取消
export function createThrottle(fn, ms = 500, { now = () => Date.now(), set = (f, t) => setTimeout(f, t), clear = t => clearTimeout(t) } = {}) {
  let last = -Infinity, timer = null;
  const run = () => { timer = null; last = now(); fn(); };
  const cancel = () => { if (timer != null) { clear(timer); timer = null; } };
  return {
    call() { if (timer != null) return; const wait = last + ms - now(); if (wait <= 0) run(); else timer = set(run, wait); },
    flush() { cancel(); run(); },
    cancel,
    get pending() { return timer != null; },
  };
}
