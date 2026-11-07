// core/solar 的跨引擎決定性（check.mjs 的 core · solar）：同一份工作量（SPA、追日＋Perez、BVH 遮陰、全年發電）
// 在 Node 跑兩次、在無頭 Chrome 跑一次，四個雜湊必須逐位元相同。
//   node core/solar/test/browser-check.mjs [--no-browser]
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workload } from './workload.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), KEYS = ['spa', 'tracking', 'shading', 'energy'];
const epw = gunzipSync(readFileSync(join(HERE, 'fixtures', 'synthetic-tainan.epw.gz'))).toString('utf8');
const a = workload(epw), b = workload(epw), fails = [];
for (const k of KEYS) if (a[k] !== b[k]) fails.push(`${k}：Node 跑兩次結果不同`);
let engine = '';
if (!process.argv.includes('--no-browser')) {
  const { startServer } = await import('../../tools/serve.mjs'), { openBrowser } = await import('../../tools/cdp.mjs');
  const port = await new Promise(r => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const server = await startServer({ port, quiet: true });
  const br = await openBrowser({ width: 800, height: 600 });
  try {
    if (!await br.goto(`http://127.0.0.1:${port}/core/solar/test/browser.html`, '!!window.solarHash', 120000)) fails.push('瀏覽器：頁面沒有算完');
    else {
      const h = await br.evaluate('window.solarHash');
      engine = (await br.send('Browser.getVersion')).result?.product || 'Chrome';
      for (const k of KEYS) if (h[k] !== a[k]) fails.push(`${k}：瀏覽器 ${h[k]} 和 Node ${a[k]} 不同`);
    }
    if (br.errors.length) fails.push(`瀏覽器錯誤：${br.errors.slice(0, 3).join('；')}`);
  } finally { await br.close(); server.close(); }
}
console.log(`${fails.length ? '✗' : '✓'} solar：SPA、追日、遮陰、全年發電四個雜湊 Node（${process.version}）${engine ? `與 ${engine} ` : ''}逐位元相同；年發電 ${Math.round(a.acKWh).toLocaleString('en-US')} kWh`);
for (const f of fails) console.log('   ' + f);
process.exit(fails.length ? 1 : 0);
