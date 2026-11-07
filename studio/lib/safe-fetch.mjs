// 主機代替使用者抓外部網址（元件補全採用檔案時下載代理給的網址）的防護：避免被拿來打內部網路（SSRF）。
//   - 只允許 http／https；網址不能帶帳號密碼。
//   - 連線前解析 DNS，任何一個位址落在本機、私有網段、link-local（含雲端 metadata 169.254.169.254）、CGNAT、多播、保留或文件用網段就拒絕；
//     檢查放在 http.request 的 lookup 裡，連線用的就是檢查過的位址（不會檢查一次、連線時又解析到別的位址）。網址直接寫 IP 時另外檢查。
//   - 轉址自己跟（最多 5 次），每一跳都重做上面的檢查，所以外部網址轉到內部位址也會被擋。
//   - 整體逾時（含讀內容）；內容大小上限由呼叫的人邊讀邊數。
//   - 測試或確定要抓內網檔案時，環境變數 VS3D_ENRICH_ALLOW_PRIVATE=1 可以關掉位址檢查（協定與轉址次數照樣限制）。
import { lookup as dnsLookup } from 'node:dns';
import { isIP, BlockList } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const BLOCK = new BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) BLOCK.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) BLOCK.addSubnet(a, p, 'ipv6');

// IPv6 展開成 8 組數字（支援 :: 與結尾的 IPv4 寫法）
function v6groups(addr) {
  let a = addr.replace(/%.*$/, '');
  const m = a.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) { const [x, y, z, w] = m.slice(1).map(Number); a = a.slice(0, -m[0].length) + `${((x << 8) | y).toString(16)}:${((z << 8) | w).toString(16)}`; }
  const [head, tail] = a.split('::'), hp = head ? head.split(':') : [];
  const groups = tail === undefined ? hp : [...hp, ...Array(Math.max(0, 8 - hp.length - (tail ? tail.split(':').length : 0))).fill('0'), ...(tail ? tail.split(':') : [])];
  return groups.map(g => parseInt(g, 16) || 0);
}
const v4of = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
// IPv6 裡夾帶的 IPv4：IPv4-mapped（::ffff:a.b.c.d）、IPv4-compatible（::a.b.c.d）、NAT64（64:ff9b::/96）、6to4（2002::/16）
function embeddedV4(g) {
  if (g.slice(0, 5).every(x => x === 0) && (g[5] === 0xffff || g[5] === 0) && (g[6] || g[7])) return v4of(g[6], g[7]);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return v4of(g[6], g[7]);
  if (g[0] === 0x2002) return v4of(g[1], g[2]);
  return null;
}

// 這個 IP 位址能不能讓主機去連；不是 IP 的字串一律當成不能
export function blockedAddress(addr) {
  const a = String(addr || '').replace(/^\[|\]$/g, ''), v = isIP(a);
  if (v === 4) return BLOCK.check(a, 'ipv4');
  if (v === 6) {
    const v4 = embeddedV4(v6groups(a));
    if (v4 && blockedAddress(v4)) return true;
    return BLOCK.check(a, 'ipv6');
  }
  return true;
}

class FetchBlocked extends Error { constructor(message) { super(message); this.code = 'VS3D_BLOCKED'; } }

// 回傳 { res（http.IncomingMessage）, url（最後的網址）, abort }；讀完內容或放棄時呼叫 abort() 收掉計時器與連線
export async function safeGet(url, { timeoutMs = 60000, maxRedirects = 5, headers = {}, allowPrivate = process.env.VS3D_ENRICH_ALLOW_PRIVATE === '1', blocked = blockedAddress, resolver = dnsLookup } = {}) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(new Error(`逾時（${Math.round(timeoutMs / 1000)} 秒）`)), timeoutMs);
  const abort = () => { clearTimeout(timer); if (!ctl.signal.aborted) ctl.abort(new Error('已取消')); };
  const check = addr => !allowPrivate && blocked(addr);
  const lookup = (host, opts, cb) => resolver(host, { ...opts, all: true }, (err, list) => {
    if (err) return cb(err);
    const bad = list.find(x => check(x.address));
    if (bad) return cb(new FetchBlocked(`不允許連到內部網路的位址（${host} → ${bad.address}）`));
    if (opts?.all) cb(null, list); else cb(null, list[0].address, list[0].family);
  });
  try {
    let cur = String(url || '');
    for (let hop = 0; ; hop++) {
      let u; try { u = new URL(cur); } catch { throw new FetchBlocked('網址格式不對'); }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchBlocked(`只接受 http／https 網址（${u.protocol}）`);
      if (u.username || u.password) throw new FetchBlocked('網址不能帶帳號密碼');
      const host = u.hostname.replace(/^\[|\]$/g, '');
      if (!allowPrivate && (/^localhost$|\.localhost$/i.test(host) || (isIP(host) && check(host)))) throw new FetchBlocked(`不允許連到內部網路的位址（${host}）`);
      const res = await new Promise((ok, fail) => {
        const q = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, { method: 'GET', headers, lookup, signal: ctl.signal }, ok);
        q.on('error', e => fail(ctl.signal.aborted ? ctl.signal.reason : e)); q.end();
      });
      const loc = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && loc) {
        res.resume();
        if (hop >= maxRedirects) throw new FetchBlocked(`轉址超過 ${maxRedirects} 次`);
        cur = new URL(loc, u).href; continue;
      }
      res.on('error', () => {});      // 逾時中止時的錯誤由讀內容的人處理
      return { res, url: u.href, abort, signal: ctl.signal };
    }
  } catch (e) { abort(); throw e; }
}
