// 網頁的孿生觀看模式：以 SSE 訂閱孿生 server 的 view（core/tools/twin.mjs --sse <port> 的 /events），收到就交給站的 twin.apply。
// 只觀看：不跑時間軸、不算感測器、不回送任何東西（關掉頁面不影響 Hub 的工作階段，SPE-AC-12）。
//
//   const twin = createTwinBinding(project, scene);
//   const viewer = connectTwinView({ url: 'http://127.0.0.1:8776/events', apply: v => twin.apply(v), onStatus: s => … });
//   viewer.close();
export function connectTwinView({ url, apply, onStatus = () => { } }) {
  const source = new EventSource(url);
  let last = null;
  onStatus({ state: 'connecting', url });
  source.onopen = () => onStatus({ state: 'open', url });
  source.onerror = () => onStatus({ state: source.readyState === EventSource.CLOSED ? 'closed' : 'retrying', url });
  source.onmessage = e => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    if (!data?.view) return;
    last = data;
    apply(data.view, data);
    onStatus({ state: 'open', url, tick: data.tick, timeUs: data.t });
  };
  return { close() { source.close(); }, get last() { return last; } };
}

// 網址參數 ?twin=<SSE 位址>；只給埠號（?twin=8776）時用目前主機的 /events
export function twinUrl(param) {
  if (!param) return null;
  if (/^\d+$/.test(param)) return `http://127.0.0.1:${param}/events`;
  return /\/events$/.test(param) ? param : param.replace(/\/$/, '') + '/events';
}
