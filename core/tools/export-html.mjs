// 單一 HTML 匯出：把專案網頁用到的一切（importmap 模組、css、圖示、程式內以 import.meta.url 取的資源）內嵌成一個檔案，離線雙擊（file://）即可開。
//   node core/tools/export-html.mjs <專案> [輸出檔] [--verify] [--shot <截圖.png>]
//   預設輸出 <庫>/TEMP/exports/<專案>.html（工作區模式：<專案>/TEMP/exports/）
// 內嵌方式：
//   模組原始碼放在 <script type="text/x-module" data-key>（& 與 < 轉成實體，避免提早結束 script），
//   開機程式逐一建 Blob URL、動態插入 importmap，再載入入口模組。blob: 底下的相對路徑無法解析，
//   所以所有 specifier 先改寫成 importmap 的鍵（@x/core/…、@x/site/…）。
//   資源（css 的 url()、favicon、<img>、new URL('…', import.meta.url)、字串常數的 fetch()／.load()）改成 data URL。
// 處理不了的寫法（非常數的動態 import、其他 import.meta 用法、站外連結、找不到的檔案）列在 warnings。
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pickProjects, CORE, REPO, WORKSPACE } from './projects.mjs';
import { scan, clientNames } from './check-names.mjs';

const IMPORT_RE = /(?:^|[;\n}\s])(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream', '.exr': 'application/octet-stream', '.ktx2': 'image/ktx2',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain', '.csv': 'text/csv' };
const TEXT = new Set(['.css', '.svg', '.json', '.gltf', '.txt', '.csv']);
const isExternal = s => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(s);
const esc = s => s.replace(/[&<]/g, c => c === '&' ? '&amp;' : '&lt;');
const attr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const mask = n => n[0] + '○'.repeat(Math.max(1, n.length - 1));

// 開機程式：模組文字 → Blob URL → importmap → 入口
const BOOT = `(() => { try {
  const imports = {}, dec = t => t.replace(/&(lt|amp);/g, (m, k) => k === 'lt' ? '<' : '&');
  for (const s of document.querySelectorAll('script[type="text/x-module"]')) imports[s.dataset.key] = URL.createObjectURL(new Blob([dec(s.textContent)], { type: s.dataset.type || 'text/javascript' }));
  const map = document.createElement('script'); map.type = 'importmap'; map.textContent = JSON.stringify({ imports }); document.head.append(map);
  const main = document.createElement('script'); main.type = 'module'; main.textContent = ENTRY; document.body.append(main);
} catch (e) { document.body.insertAdjacentHTML('afterbegin', '<p style="position:fixed;z-index:99;inset:0 0 auto;margin:0;padding:12px;background:#a00;color:#fff">此瀏覽器無法開啟離線版本：' + e.message + '</p>'); throw e; } })();`;

export async function exportHtml(projectId, outFile, { log = console.log } = {}) {
  const [p] = pickProjects([projectId]);
  const file = resolve(outFile || join(WORKSPACE ? join(p.dir, 'TEMP', 'exports') : join(REPO, 'TEMP', 'exports'), `${p.id}.html`));
  const base = `/${encodeURIComponent(p.id)}/`, warnings = [], warn = w => { if (!warnings.includes(w)) warnings.push(w); };
  const texts = new Map();                     // 內嵌的文字內容（用戶名稱檢查用）
  let assets = 0;

  // 網址空間（/core/…、/<專案>/…）與磁碟、importmap 鍵的對應
  const abs = (spec, from) => new URL(spec, 'http://x' + from).pathname;
  const toDisk = url => {
    const parts = url.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] === 'core') return join(CORE, ...parts.slice(1));
    if (parts[0] === p.id) return join(p.web, ...parts.slice(1));
    return null;
  };
  const keyOf = url => url.startsWith('/core/') ? '@x' + url : '@x/site/' + decodeURIComponent(url.slice(base.length));
  const short = url => decodeURIComponent(url.startsWith(base) ? url.slice(base.length) : url.slice(1));

  const dataUrl = (url, from) => {
    const f = toDisk(url);
    if (!f || !existsSync(f) || !statSync(f).isFile()) { warn(`${from}：找不到 ${short(url)}`); return null; }
    const ext = extname(f).toLowerCase(), mime = MIME[ext] || 'application/octet-stream';
    let buf = readFileSync(f);
    if (ext === '.css') buf = Buffer.from(inlineCss(buf.toString('utf8'), url));
    if (TEXT.has(ext)) texts.set(f, buf.toString('utf8'));
    assets++;
    return `data:${mime};base64,${buf.toString('base64')}`;
  };
  // css 的 url(…) 與 @import 以 css 檔位置解析
  function inlineCss(css, url) {
    texts.set(toDisk(url) || url, css);
    return css.replace(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?([^;]*);/g, (m, q, ref, media) => {
      if (isExternal(ref)) { warn(`${short(url)}：@import 站外樣式 ${ref}`); return m; }
      const f = toDisk(abs(ref, url));
      if (!f || !existsSync(f)) { warn(`${short(url)}：找不到 ${ref}`); return m; }
      const inner = inlineCss(readFileSync(f, 'utf8'), abs(ref, url));
      return media.trim() ? `@media ${media.trim()}{${inner}}` : inner;
    }).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, ref) => {
      if (isExternal(ref) || ref.startsWith('data:')) return m;
      const d = dataUrl(abs(ref.trim(), url), short(url)); return d ? `url("${d}")` : m;
    });
  }

  // index.html：取出 importmap 與入口模組；HTML 註解先拿掉（不在 script 內的）
  let html = readFileSync(join(p.web, 'index.html'), 'utf8');
  html = html.split(/(<script\b[\s\S]*?<\/script>)/i).map((s, i) => i % 2 ? s : s.replace(/<!--[\s\S]*?-->\s*/g, '')).join('');
  let map = {};
  html = html.replace(/<script\s+type="importmap"\s*>([\s\S]*?)<\/script>\s*/i, (m, j) => { map = JSON.parse(j).imports || {}; return ''; });
  const resolveSpec = (spec, from) => {
    if (spec.startsWith('.') || spec.startsWith('/')) return abs(spec, from);
    for (const [k, v] of Object.entries(map)) if (k.endsWith('/') ? spec.startsWith(k) : spec === k) return abs(v + (k.endsWith('/') ? spec.slice(k.length) : ''), base);
    return null;
  };
  const entries = [], inline = new Map();
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>\s*/gi, (m, a, body) => {
    const src = /\bsrc="([^"]+)"/.exec(a)?.[1];
    if (/\btype="module"/.test(a)) {
      if (src) entries.push(abs(src, base));
      else { const url = `${base}__inline${inline.size}.js`; inline.set(url, body); entries.push(url); }
      return '';
    }
    if (/\btype="/.test(a) && !/\btype="(?:text|application)\/javascript"/.test(a)) return m;   // 資料區塊照留
    if (!src || isExternal(src)) { if (src) warn(`index.html：站外程式 ${src}`); return m; }
    const f = toDisk(abs(src, base));
    if (!f || !existsSync(f)) { warn(`index.html：找不到 ${src}`); return m; }
    const code = readFileSync(f, 'utf8'); texts.set(f, code); assets++;
    return `<script>${code.replace(/<\/(script)/gi, '<\\/$1')}</script>\n`;
  });

  // 走訪 import 圖並改寫 specifier
  const mods = new Map(), queue = [...entries];
  while (queue.length) {
    const url = queue.shift(); if (mods.has(url)) continue;
    const disk = inline.has(url) ? null : toDisk(url);
    if (!inline.has(url) && (!disk || !existsSync(disk))) { warn(`找不到模組 ${short(url)}`); mods.set(url, null); continue; }
    let src = inline.has(url) ? inline.get(url) : readFileSync(disk, 'utf8');
    const ext = disk ? extname(disk).toLowerCase() : '.js', from = short(url);
    if (ext === '.json') { texts.set(disk, src); mods.set(url, { key: keyOf(url), src, type: 'application/json' }); continue; }
    const deps = new Map();
    for (const m of strip(src).matchAll(IMPORT_RE)) {
      const spec = m[1] || m[2], r = resolveSpec(spec, url);
      if (r) { deps.set(spec, r); queue.push(r); } else warn(`${from}：無法解析 import '${spec}'`);
    }
    src = src.replace(IMPORT_RE, (m, s1, s2) => {
      const spec = s1 || s2, r = deps.get(spec); if (!r) return m;
      const i = m.lastIndexOf(spec); return m.slice(0, i) + keyOf(r) + m.slice(i + spec.length);
    });
    // new URL('…', import.meta.url)：以模組位置解析，改成 data URL
    src = src.replace(/new\s+URL\(\s*(['"`])([^'"`$]+)\1\s*,\s*import\.meta\.url\s*\)/g, (m, q, ref) => {
      if (isExternal(ref)) return m;
      const d = dataUrl(abs(ref, url), from); return d ? `new URL(${JSON.stringify(d)})` : m;
    });
    // fetch('…')、loader.load('…')：字串常數以頁面位置解析，改成 data URL；組字串的列為警告
    src = src.replace(/(\bfetch|\.loadAsync|\.load)\(\s*(['"`])([^'"`$]*)\2(\s*[,)])/g, (m, fn, q, ref, tail) => {
      if (!ref || isExternal(ref)) return m;
      if (!/\.\w{1,5}$/.test(ref.split(/[?#]/)[0])) { if (fn === 'fetch') warn(`${from}：fetch('${ref}') 離線無法使用`); return m; }
      const d = dataUrl(abs(ref, base), from); return d ? `${fn}(${JSON.stringify(d)}${tail}` : m;
    });
    const rest = strip(src);
    for (const m of rest.matchAll(/\bfetch\(\s*(['"`])([^'"`]*)\1\s*\+/g)) warn(`${from}：fetch('${m[2]}'＋…) 組出的網址離線無法使用`);
    // three.js 本體的 loader 實作也是這種寫法，不算
    if (!url.startsWith('/core/vendor/')) for (const m of rest.matchAll(/(?:\bfetch|[Ll]oader(?:\(\))?\s*\.load(?:Async)?)\(\s*([A-Za-z_$][\w.$]*)\s*[,)]/g)) warn(`${from}：${m[0]} 以變數取資源，無法內嵌`);
    if (/import\.meta\.(?:url|resolve)/.test(rest)) warn(`${from}：import.meta.url／resolve 的其他用法無法內嵌`);
    for (const m of rest.matchAll(/import\(\s*(?!['"][^'"]+['"]\s*\))([^)]{0,40})/g)) warn(`${from}：動態 import(${m[1].trim()}…) 不是字串常數，無法內嵌`);
    for (const m of rest.matchAll(IMPORT_RE)) { const spec = m[1] || m[2]; if (!spec.startsWith('@x/')) warn(`${from}：import '${spec}' 未改寫`); }
    if (disk) texts.set(disk, src);
    mods.set(url, { key: keyOf(url), src: src + `\n//# sourceURL=${keyOf(url)}\n` });
  }
  const list = [...mods.values()].filter(Boolean);

  // <link>：stylesheet → <style>；圖示等 → data URL；modulepreload 拿掉
  html = html.replace(/<link\b[^>]*>\s*/gi, m => {
    const href = /\bhref="([^"]+)"/.exec(m)?.[1], rel = /\brel="([^"]+)"/.exec(m)?.[1] || '';
    if (!href || isExternal(href)) { if (href && /^https?:|^\/\//.test(href)) warn(`index.html：站外資源 ${href}（離線無法載入）`); return m; }
    if (/modulepreload/i.test(rel)) return '';
    if (/stylesheet/i.test(rel)) {
      const url = abs(href, base), f = toDisk(url);
      if (!f || !existsSync(f)) { warn(`index.html：找不到 ${href}`); return m; }
      const media = /\bmedia="([^"]+)"/.exec(m)?.[1];
      assets++; return `<style${media ? ` media="${media}"` : ''}>\n${inlineCss(readFileSync(f, 'utf8'), url).replace(/<\/(style)/gi, '<\\/$1')}\n</style>\n`;
    }
    const d = dataUrl(abs(href, base), 'index.html'); return d ? m.replace(href, d) : m;
  });
  // src／poster 屬性與行內 style 的 url()
  html = html.replace(/(<(?:img|source|video|audio|input|track)\b[^>]*?\s(?:src|poster)=")([^"]+)"/gi, (m, pre, ref) => {
    if (isExternal(ref)) return m;
    const d = dataUrl(abs(ref, base), 'index.html'); return d ? `${pre}${d}"` : m;
  });
  if (/\ssrcset="/i.test(html)) warn('index.html：srcset 未內嵌');
  html = html.replace(/\sstyle="([^"]*url\([^"]*)"/gi, (m, s) => ` style="${attr(inlineCss(s.replace(/&quot;/g, '"'), base))}"`);
  for (const m of html.matchAll(/<a\b[^>]*\shref="([^"#][^"]*)"/gi)) if (!isExternal(m[1])) warn(`index.html：連結 ${m[1]} 離線版本沒有這一頁`);

  // 組合：模組文字＋開機程式放在 </body> 前
  const entry = entries.map(u => `import ${JSON.stringify(keyOf(u))};`).join('\n');
  const blocks = list.map(m => `<script type="text/x-module" data-key="${attr(m.key)}"${m.type ? ` data-type="${m.type}"` : ''}>${esc(m.src)}</script>`).join('\n');
  const boot = `<script>\n${BOOT.replace('ENTRY', () => JSON.stringify(entry))}\n</script>`;
  const tail = `${blocks}\n${boot}\n`;
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => tail + '</body>') : html + tail;

  // 用戶名稱：輸出檔與所有內嵌的文字（base64 之前）
  const names = clientNames();
  if (names.length) {
    texts.set(file, html);
    const hits = scan([...texts.keys()], names, f => texts.get(f));
    for (const n of new Set(hits.map(h => h.name))) warn(`✗ 出現用戶名稱 ${mask(n)}（${hits.filter(h => h.name === n).length} 處），不可對外提供`);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
  const bytes = Buffer.byteLength(html);
  if (bytes > 15 * 1048576) warn(`檔案 ${(bytes / 1048576).toFixed(1)} MB 超過 15 MB，建議改用網站壓縮檔`);
  log(`${p.id}：${(bytes / 1048576).toFixed(2)} MB，${list.length} 個模組、${assets} 個資源 → ${file}`);
  for (const w of warnings) log('   ⚠ ' + w);
  return { file, bytes, modules: list.length, assets, warnings };
}

// 以 Chrome／Edge 的 file:// 開啟匯出檔：無主控台錯誤、window.sim 就緒、跳到 total/2、畫布有內容、沒有載入其他本機檔案
export async function verifyHtml(file, { shot = null, log = console.log } = {}) {
  const { openBrowser, sleep } = await import('./cdp.mjs'), { decodePng } = await import('./png.mjs');
  const browser = await openBrowser(), r = { ok: false, errors: [] };
  try {
    const ready = await browser.goto(pathToFileURL(resolve(file)).href, '!!(window.sim && window.sim.total)', 60000);
    if (!ready) r.errors.push('window.sim 未就緒或 total 不是正數');
    else {
      await sleep(1500);
      Object.assign(r, await browser.evaluate(`(async () => { const s = window.sim, total = +s.total; let seek = null;
        try { s.pause?.(); s.seekTo(total / 2); } catch (e) { seek = String(e && e.stack || e); }
        const files = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.startsWith('file:'));
        return { total, seek, files }; })()`));
      await browser.frames(); await sleep(600); await browser.frames();
      const rect = await browser.evaluate(`(() => { const c = [...document.querySelectorAll('canvas')].filter(c => c.offsetWidth).sort((a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight)[0];
        if (!c) return null; const b = c.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`);
      const png = await browser.screenshot('png');
      if (shot) { mkdirSync(dirname(resolve(shot)), { recursive: true }); writeFileSync(resolve(shot), png); }
      r.canvas = rect ? contentRatio(decodePng(png), rect) : 0;
      if (!(r.total > 0)) r.errors.push(`total = ${r.total}`);
      if (r.seek) r.errors.push('seekTo 失敗：' + r.seek.split('\n')[0]);
      if (r.files.length) r.errors.push('載入了其他本機檔案：' + r.files.join('、'));
      if (r.canvas < .05) r.errors.push(`畫布幾乎空白（非背景像素 ${(r.canvas * 100).toFixed(1)}%）`);
    }
    r.errors.push(...browser.errors.splice(0).map(e => 'console：' + String(e).split('\n')[0]));
    r.ok = !r.errors.length;
  } finally { await browser.close(); }
  log(`${r.ok ? '✓' : '✗'} file:// 驗證：total ${r.total ?? '-'} s，畫布內容 ${((r.canvas || 0) * 100).toFixed(0)}%`);
  for (const e of r.errors) log('   ✗ ' + e.slice(0, 300));
  return r;
}

// 畫布範圍內與最常見顏色差異明顯的像素比例
function contentRatio({ width, height, data }, { x, y, w, h }) {
  const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y)), x1 = Math.min(width, Math.floor(x + w)), y1 = Math.min(height, Math.floor(y + h));
  const hist = new Map(), px = [];
  for (let j = y0; j < y1; j += 3) for (let i = x0; i < x1; i += 3) {
    const o = (j * width + i) * 4, q = (data[o] >> 4) << 8 | (data[o + 1] >> 4) << 4 | data[o + 2] >> 4;
    hist.set(q, (hist.get(q) || 0) + 1); px.push(o);
  }
  if (!px.length) return 0;
  const bg = [...hist].sort((a, b) => b[1] - a[1])[0][0], br = (bg >> 8) * 16 + 8, bgG = ((bg >> 4) & 15) * 16 + 8, bb = (bg & 15) * 16 + 8;
  return px.filter(o => Math.abs(data[o] - br) + Math.abs(data[o + 1] - bgG) + Math.abs(data[o + 2] - bb) > 48).length / px.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2), opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const shot = opt('--shot'), verify = argv.includes('--verify') || !!shot, [id, out] = argv.filter(a => !a.startsWith('--'));
  if (!id) { console.log('用法：node core/tools/export-html.mjs <專案> [輸出檔] [--verify] [--shot <截圖.png>]'); process.exit(2); }
  const res = await exportHtml(id, out);
  const v = verify ? await verifyHtml(res.file, { shot }) : { ok: true };
  process.exit(v.ok && !res.warnings.some(w => w.startsWith('✗')) ? 0 : 1);
}
