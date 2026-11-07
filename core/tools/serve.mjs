// 本機伺服器：網址配置與 GitHub Pages 相同（/ 首頁、/core/ 共用、/<專案>/ 各專案）。
//   node core/tools/serve.mjs [專案] [--port 8770] [--host 127.0.0.1] [--no-open]
// ES module 必須以 http:// 載入；停用快取，改檔後重新整理即生效。
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { CORE, listProjects, pickProjects } from './projects.mjs';
import { galleryHtml } from './site.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8',
};

// 網址 → 本機檔案；回傳 null 代表不存在
export function resolveUrl(pathname) {
  // 格式錯誤的 % 編碼（例如 /core/%E0%A4%A）會讓 decodeURIComponent 丟 URIError，沒接住的話整個伺服器會結束
  let decoded; try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const parts = decoded.split('/').filter(Boolean);
  if (!parts.length) return { gallery: true };
  const [head, ...rest] = parts;
  let base;
  if (head === 'core') base = CORE;
  else { const p = listProjects().find(x => x.id === head); if (!p) return null; base = p.web; }
  const file = normalize(join(base, ...rest));
  const root = normalize(base).replace(/[\\/]+$/, '');
  if (file !== root && !file.startsWith(root + sep)) return null;            // 擋掉 ../ 與同名前綴的兄弟資料夾（web-old）
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!pathname.endsWith('/')) return { redirect: pathname + '/' };
    return existsSync(join(file, 'index.html')) ? { file: join(file, 'index.html') } : null;
  }
  return existsSync(file) ? { file } : null;
}

export function startServer({ port = 8770, host = '127.0.0.1', quiet = false } = {}) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const hit = resolveUrl(url.pathname);
    const head = { 'Cache-Control': 'no-store, must-revalidate' };
    if (!hit) { res.writeHead(404, { ...head, 'Content-Type': MIME['.txt'] }); res.end('404 ' + url.pathname); return; }
    if (hit.redirect) { res.writeHead(301, { ...head, Location: hit.redirect + url.search }); res.end(); return; }
    if (hit.gallery) { res.writeHead(200, { ...head, 'Content-Type': MIME['.html'] }); res.end(galleryHtml(listProjects(), { catalog: existsSync(join(CORE, 'catalog', 'index.html')) })); return; }
    res.writeHead(200, { ...head, 'Content-Type': MIME[extname(hit.file).toLowerCase()] || 'application/octet-stream' });
    // 檔案被鎖住或沒有權限時 stream 會發 error；沒有處理的話伺服器會結束
    createReadStream(hit.file).on('error', () => res.destroy()).pipe(res);
    if (!quiet && hit.file.endsWith('index.html')) console.log(`[serve] ${req.method} ${url.pathname}`);
  });
  return new Promise((ok, fail) => { server.once('error', fail); server.listen(port, host, () => ok(server)); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2), opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const port = +(opt('--port') || 8770), host = opt('--host') || '127.0.0.1';
  const noOpen = argv.includes('--no-open'), names = argv.filter(a => !a.startsWith('--'));
  const target = names.length ? pickProjects(names)[0] : null;
  await startServer({ port, host });
  const url = `http://${host}:${port}/${target ? encodeURIComponent(target.id) + '/' : ''}`;
  console.log(`[serve] ${target ? target.title : '自動化設備 3D 展示'}：${url}   (Ctrl+C 結束)`);
  if (!noOpen) spawn(process.platform === 'win32' ? 'cmd' : 'xdg-open', process.platform === 'win32' ? ['/c', 'start', '', url] : [url], { stdio: 'ignore', detached: true }).unref();
}
