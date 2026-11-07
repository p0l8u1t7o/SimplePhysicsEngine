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
//   頁面從本機或內網主機開（localhost、127.x、10.x、172.16～31.x、192.168.x、*.local、IPv6 本機／ULA）→ 用那台主機（孿生 server 用 --host 開給內網時才連得到）；
//   其他情況（GitHub Pages、匯出的 file://）→ 127.0.0.1（看的人自己電腦上的孿生 server）
const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[?::1\]?|\[?f[cd][0-9a-f]{2}:.*|.+\.local)$/i;
export function twinUrl(param, loc = globalThis.location) {
  if (!param) return null;
  if (/^\d+$/.test(param)) {
    const host = loc && /^https?:$/.test(loc.protocol) && PRIVATE_HOST.test(loc.hostname) ? loc.hostname : '127.0.0.1';
    return `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${param}/events`;
  }
  return /\/events$/.test(param) ? param : param.replace(/\/$/, '') + '/events';
}
