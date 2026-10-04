// MP4 展示影片匯出（Node 版，取代 tools/movie-export 的 Python 接收端）：全自動，不需要人按按鈕。
//   node core/tools/export-mp4.mjs <專案> [輸出資料夾] [--port 8810] [--encoder auto|h264_nvenc|libx264] [--ffmpeg 路徑] [--chrome 路徑] [--samples] [--manual]
// 流程：build-site.mjs 建單站網站副本 → 本機接收端（只聽 127.0.0.1，網站＋/render/ 端點）→ 無頭 Chrome 開 /<專案>/?pause&movie&auto
//       （core/movie/movie.js 的 ?auto 會自動按「輸出完整影片」）→ JPEG 影格依序送進 ffmpeg → ffprobe 核對影格數。
// 預設輸出 <庫>/TEMP/videos/<專案>-<日期>/（工作區模式為 <專案>/TEMP/videos/…）：<專案>_1080p30.mp4 與 .shots.json（tools/movie-export/verify.py 可直接用）。
// --manual 只開接收端不開瀏覽器，可在自己的瀏覽器用「檢查鏡頭與固定影格」等按鈕（檢查影格寫到 <輸出>/audit/）。
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, normalize, extname, sep } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CORE, REPO, WORKSPACE, pickProjects } from './projects.mjs';

const W = 1920, H = 1080, FPS = 30, MAX_BODY = 12_000_000, PORTS = [8810, 8819];
const EXE = process.platform === 'win32' ? '.exe' : '';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8',
};
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
// 編碼參數照 Python 版
const ENCODE = {
  h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', '18', '-b:v', '0'],
  libx264: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18'],
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wait = (ms, v) => new Promise(r => setTimeout(() => r(v), ms).unref());   // 競速用逾時，不拖住程序結束
const isJpeg = b => b.length > 2 && b[0] === 0xff && b[1] === 0xd8;
const clock = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// ffmpeg：參數 ＞ FFMPEG_PATH ＞ 軍規專案 tools/bin ＞ PATH（同 studio/lib/server.mjs 的 findFfmpeg）
export function findFfmpeg(given) {
  if (given) { if (!existsSync(given)) throw new Error(`找不到 ffmpeg：${given}`); return given; }
  for (const c of [process.env.FFMPEG_PATH, join(REPO, 'project-site', 'MilitaryGradePC', 'tools', 'bin', 'ffmpeg' + EXE)].filter(Boolean)) if (existsSync(c)) return c;
  return spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0 ? 'ffmpeg' : null;
}

// 實際試編碼 3 格；NVENC 不可用時回退 libx264
function pickEncoder(ffmpeg, want, warnings) {
  if (want === 'libx264') return want;
  const r = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=size=${W}x${H}:rate=${FPS}`, '-frames:v', '3', '-c:v', 'h264_nvenc', '-f', 'null', '-'], { windowsHide: true, timeout: 20000 });
  if (r.status === 0) return 'h264_nvenc';
  if (want === 'h264_nvenc') warnings.push('h264_nvenc 不可用，改用 libx264');
  return 'libx264';
}

// 成品影格數：ffprobe（ffmpeg 同資料夾或 PATH）；沒有就用 ffmpeg 複製串流計數
function probe(ffmpeg, file) {
  const fp = ffmpeg === 'ffmpeg' ? 'ffprobe' : join(dirname(ffmpeg), 'ffprobe' + EXE);
  const r = spawnSync(fp, ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=codec_name,width,height,nb_read_packets,duration', '-of', 'json', file], { windowsHide: true, encoding: 'utf8' });
  if (r.status === 0) { const s = JSON.parse(r.stdout).streams[0]; return { frames: +s.nb_read_packets, duration: +s.duration, codec: s.codec_name, width: s.width, height: s.height }; }
  const f = spawnSync(ffmpeg, ['-hide_banner', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-'], { windowsHide: true, encoding: 'utf8' }).stderr || '';
  const d = f.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return { frames: +([...f.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1] ?? NaN), duration: d ? d[1] * 3600 + d[2] * 60 + +d[3] : NaN };
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const parts = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { fail(new Error('Payload too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => ok(Buffer.concat(parts))); req.on('error', fail);
  });
}

// 接收端：網站副本＋movie.js 呼叫的 /render/ 端點（status、start、frame、finish、audit-start、audit-frame），格式同 server.py
async function startReceiver({ site, project, file, outDir, ffmpeg, encoder, samples, port, onEvent }) {
  let job = null, chain = Promise.resolve(), origin = '';
  const shotsFile = file.replace(/\.mp4$/, '.shots.json'), sampleDir = join(outDir, 'samples', project), auditDir = join(outDir, 'audit', project);
  const handlers = {
    'audit-start'(h, body) {
      const spec = JSON.parse(body); if (spec.project !== project) throw new Error('Invalid project');
      mkdirSync(auditDir, { recursive: true }); writeFileSync(join(auditDir, 'spec.json'), JSON.stringify(spec, null, 2)); return { ok: true };
    },
    'audit-frame'(h, body) {
      const name = h['x-sample-name'] || '';
      if (decodeURIComponent(h['x-project'] || '') !== project || !/^(frame-\d{6}|repeat-\d{2})$/.test(name) || !isJpeg(body)) throw new Error('Invalid audit sample');
      mkdirSync(auditDir, { recursive: true }); writeFileSync(join(auditDir, name + '.jpg'), body);
      writeFileSync(join(auditDir, name + '.json'), JSON.stringify(JSON.parse(h['x-telemetry']), null, 2)); return { ok: true };
    },
    start(h, body) {
      const spec = JSON.parse(body);
      if (spec.project !== project || spec.width !== W || spec.height !== H || spec.fps !== FPS || !(spec.frames >= 1 && spec.frames <= 150000)) throw new Error('Invalid specification');
      if (job) {
        if (JSON.stringify(job.spec) !== JSON.stringify(spec)) throw new Error('Changed specification; restart receiver');
        return { token: job.token, nextFrame: job.frames, complete: job.complete };
      }
      if (existsSync(file)) throw new Error('Output already exists: ' + file);
      mkdirSync(outDir, { recursive: true });
      const proc = spawn(ffmpeg, ['-hide_banner', '-nostats', '-n', '-f', 'image2pipe', '-framerate', String(FPS), '-vcodec', 'mjpeg', '-i', 'pipe:0', '-an',
        ...ENCODE[encoder], '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
      const pick = new Set([0, spec.frames - 1]);
      for (const s of spec.shots) if (s.kind !== 'process' || s.firstInPhase) pick.add(Math.min(spec.frames - 1, s.startFrame + Math.floor(s.frameCount * .6)));
      for (let i = 0; i <= 24; i++) pick.add(Math.round(i * (spec.frames - 1) / 24));
      job = { spec, token: randomBytes(24).toString('base64url'), proc, frames: 0, complete: false, samples: pick, log: '', exit: null };
      proc.stderr.on('data', d => { job.log = (job.log + d).slice(-6000); });
      proc.stdin.on('error', () => { });
      job.exit = new Promise(r => proc.on('exit', code => { job.code = code; r(code); }));
      job.exit.then(code => { if (!job.complete && !job.finishing) onEvent('error', new Error(`ffmpeg 提前結束（${code}）：${job.log.slice(-800)}`)); });
      writeFileSync(shotsFile, JSON.stringify({ ...spec, encoder }, null, 2));
      onEvent('start', spec);
      return { token: job.token, nextFrame: 0 };
    },
    async frame(h, body) {
      const i = +(h['x-frame-index'] ?? -1), digest = createHash('sha256').update(body).digest('hex');
      if (i === job.frames - 1 && digest === job.hash) return { frame: i };              // 重送的同一格
      if (i !== job.frames || i >= job.spec.frames || !isJpeg(body)) throw new Error('Out of order frame');
      if (job.code != null) throw new Error('Encoder stopped');
      if (!job.proc.stdin.write(body)) await Promise.race([new Promise(r => job.proc.stdin.once('drain', r)), job.exit]);
      job.frames++; job.hash = digest;
      if (samples && job.samples.has(i)) { mkdirSync(sampleDir, { recursive: true }); writeFileSync(join(sampleDir, `${String(i).padStart(6, '0')}.jpg`), body); }
      onEvent('frame', { frame: i, frames: job.frames, total: job.spec.frames });
      return { frame: i };
    },
    async finish() {
      if (job.complete) return { file };
      if (job.frames !== job.spec.frames) throw new Error('Incomplete film');
      job.finishing = true; job.proc.stdin.end();
      const code = await Promise.race([job.exit, wait(180000, 'timeout')]);
      if (code !== 0) { job.finishing = false; throw new Error(`Encoding failed（${code}）：${job.log.slice(-800)}`); }
      job.complete = true; onEvent('finish', { file });
      return { file };
    },
  };
  const tokenOk = t => { if (!job) return false; const a = Buffer.from(String(t || '')), b = Buffer.from(job.token); return a.length === b.length && timingSafeEqual(a, b); };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (code, obj) => { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': b.length, 'Cache-Control': 'no-store' }); res.end(b); };
    if (url.pathname.startsWith('/render/')) {
      const name = url.pathname.slice(8);
      if (name === 'status' && req.method === 'GET') return json(200, job ? { [project]: { frames: job.frames, total: job.spec.frames, complete: job.complete } } : {});
      if (req.method !== 'POST' || !handlers[name]) return json(404, { error: 'Unknown endpoint' });
      if (req.headers.origin !== origin) return json(403, { error: 'Same origin only' });
      const length = +(req.headers['content-length'] ?? 0);
      if (!(length >= 0 && length <= MAX_BODY)) return json(413, { error: 'Payload too large' });
      let body; try { body = await readBody(req); } catch { return json(413, { error: 'Payload too large' }); }
      // 依序處理（同 Python 版的鎖）
      const run = chain.then(async () => {
        if (!name.startsWith('audit') && name !== 'start' && !tokenOk(req.headers['x-render-token'])) return [403, { error: 'Invalid token' }];
        return [200, await handlers[name](req.headers, body)];
      }).catch(e => [400, { error: e.message }]);
      chain = run; const [code, obj] = await run; return json(code, obj);
    }
    // 靜態檔：只限網站副本內
    let parts; try { parts = decodeURIComponent(url.pathname).split('/').filter(Boolean); } catch { res.writeHead(400); return res.end(); }
    let f = normalize(join(site, ...parts));
    const head = { 'Cache-Control': 'no-store' };
    if (f !== site && !f.startsWith(site + sep)) { res.writeHead(404, head); return res.end(); }
    if (existsSync(f) && statSync(f).isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(301, { ...head, Location: url.pathname + '/' + url.search }); return res.end(); }
      f = join(f, 'index.html');
    }
    if (!existsSync(f)) { res.writeHead(404, { ...head, 'Content-Type': MIME['.txt'] }); return res.end('404'); }
    res.writeHead(200, { ...head, 'Content-Type': MIME[extname(f).toLowerCase()] || 'application/octet-stream' });
    createReadStream(f).pipe(res);
  });
  const ports = port ? [port] : Array.from({ length: PORTS[1] - PORTS[0] + 1 }, (_, k) => PORTS[0] + k);
  for (const p of ports) {
    const ok = await new Promise(r => { server.once('error', () => r(false)); server.listen(p, '127.0.0.1', () => r(true)); });
    if (ok) { origin = `http://127.0.0.1:${p}`; break; }
    if (p === ports.at(-1)) throw new Error(`port ${ports.join('、')} 都被占用`);
  }
  return {
    origin, server,
    get job() { return job; },
    async close() {
      if (job && job.code == null) { job.proc.stdin.destroy(); job.proc.kill(); await Promise.race([job.exit, wait(5000)]); }
      server.closeAllConnections?.(); await new Promise(r => server.close(r));
    },
  };
}

// 無頭 Chrome（新模式）＋GPU：--remote-debugging-port=0，由設定檔的 DevToolsActivePort 取得 port，連瀏覽器層級 CDP
async function launchChrome(exe, profile) {
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${W},${H}`, '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), 'about:blank'];
  const proc = spawn(exe, args, { stdio: 'ignore', windowsHide: true });
  const exited = new Promise(r => proc.on('exit', r));
  const portFile = join(profile, 'DevToolsActivePort');
  let line;
  for (let i = 0; i < 100 && !line; i++) { await sleep(150); try { const [p, path] = readFileSync(portFile, 'utf8').split(/\r?\n/); if (p && path) line = `ws://127.0.0.1:${p}${path}`; } catch { } }
  const kill = async () => {
    if (proc.exitCode != null || proc.signalCode != null) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); else proc.kill('SIGKILL');
    await Promise.race([exited, wait(5000)]);
  };
  if (!line) { await kill(); throw new Error('Chrome DevTools 未啟動'); }
  const ws = new WebSocket(line); await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error('CDP 連線失敗')); });
  let id = 0, closing = false; const pending = new Map(), listeners = [];
  ws.onmessage = m => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const [ok, fail] = pending.get(msg.id); pending.delete(msg.id); msg.error ? fail(new Error(msg.error.message)) : ok(msg.result); }
    else if (msg.method) for (const fn of listeners) fn(msg);
  };
  ws.onclose = () => { for (const [, fail] of pending.values()) fail(new Error('CDP 連線中斷')); pending.clear(); if (!closing) for (const fn of listeners) fn({ method: 'closed' }); };
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => { const i = ++id; pending.set(i, [ok, fail]); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetInfos } = await send('Target.getTargets');
  const page = targetInfos.find(t => t.type === 'page') || { targetId: (await send('Target.createTarget', { url: 'about:blank' })).targetId };
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const s = (method, params) => send(method, params, sessionId);
  await s('Runtime.enable'); await s('Page.enable'); await s('Inspector.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  return {
    send: s, on: fn => listeners.push(fn),
    async evaluate(expression) {
      const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result?.value;
    },
    async close() {
      closing = true;
      if (ws.readyState === 1) { send('Browser.close').catch(() => { }); await Promise.race([exited, wait(4000)]); try { ws.close(); } catch { } }
      await kill();
    },
  };
}

function defaultOutDir(p) {
  const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const base = join(WORKSPACE ? join(p.dir, 'TEMP') : join(REPO, 'TEMP'), 'videos');
  for (let k = 1; ; k++) {
    const dir = join(base, `${p.id}-${stamp}${k > 1 ? '-' + k : ''}`);
    if (!existsSync(join(dir, `${p.id}_1080p30.mp4`))) return dir;
  }
}

/** 匯出單站 MP4。回傳 { file, frames, seconds（實際耗時）, duration（影片秒數）, size, encoder, gpu, warnings }。
 *  另可傳 signal（AbortSignal）中止：會關掉 Chrome、ffmpeg、伺服器並刪掉未完成的成品；samples 另存抽查影格；manual 只開接收端等 signal。 */
export async function exportMp4(projectId, outDir, { log = console.log, port, ffmpeg, encoder = 'auto', chrome, signal, samples = false, manual = false } = {}) {
  const t0 = Date.now(), warnings = [], cleanup = [];
  const p = pickProjects([projectId])[0];
  const main = join(p.web, 'js', 'main.js');
  if (existsSync(main) && !readFileSync(main, 'utf8').includes('installMovie')) throw new Error(`${p.id} 尚未接上錄影（main.js 沒有呼叫 installMovie）`);
  outDir = resolve(outDir || defaultOutDir(p));
  const file = join(outDir, `${p.id}_1080p30.mp4`);
  if (existsSync(file) && !manual) throw new Error(`成品已存在：${file}（請指定新的輸出資料夾）`);
  const ff = findFfmpeg(ffmpeg); if (!ff) throw new Error('找不到 ffmpeg（可用 --ffmpeg 或環境變數 FFMPEG_PATH 指定）');
  if (encoder !== 'auto' && !ENCODE[encoder]) throw new Error(`不支援的編碼器：${encoder}（auto、h264_nvenc、libx264）`);
  const enc = pickEncoder(ff, encoder, warnings);
  const exe = chrome || BROWSERS.find(existsSync);
  if (!manual && (!exe || !existsSync(exe))) throw new Error('找不到 Chrome／Edge，可用 --chrome 或環境變數 CHROME_PATH 指定');

  const work = join(REPO, 'TEMP', `mp4-export-${p.id.replace(/[^\w-]/g, '_')}-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  cleanup.push(() => rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));
  let rx, browser, done = false;
  try {
    const site = join(work, 'site');
    const b = spawnSync(process.execPath, [join(CORE, 'tools', 'build-site.mjs'), site, p.id], { encoding: 'utf8', windowsHide: true });
    if (b.status !== 0) throw new Error('build-site 失敗：' + (b.stderr || b.stdout).trim().slice(-800));

    let fail, finish; const outcome = new Promise((ok, no) => { finish = ok; fail = no; });
    outcome.catch(() => { });
    let started = 0, lastStep = -1, lastFrameAt = 0, gpu = '';
    rx = await startReceiver({
      site, project: p.id, file, outDir, ffmpeg: ff, encoder: enc, samples, port,
      onEvent(type, d) {
        if (type === 'start') {
          started = lastFrameAt = Date.now(); gpu = d.gpu || '';
          log(`[mp4] 開始輸出 ${d.frames} 格（${clock(d.frames / FPS)}），GPU：${gpu || '未知'}`);
          if (/swiftshader|llvmpipe|basic render|software/i.test(gpu)) warnings.push(`WebGL 不是硬體 GPU：${gpu}`);
        } else if (type === 'frame') {
          lastFrameAt = Date.now();
          const step = Math.floor(d.frames / d.total * 20);
          if (step > lastStep && step > 0) {
            lastStep = step; const el = (Date.now() - started) / 1000, fps = d.frames / el;
            log(`[mp4] ${String(step * 5).padStart(3)}%  ${d.frames}/${d.total} 格  ${fps.toFixed(1)} 格/秒  已 ${clock(el)}${d.frames < d.total ? `，剩約 ${clock((d.total - d.frames) / fps)}` : ''}`);
          }
        } else if (type === 'finish') finish();
        else if (type === 'error') fail(d);
      },
    });
    cleanup.push(() => rx.close());
    const url = `${rx.origin}/${encodeURIComponent(p.id)}/?pause&movie${manual ? '' : '&auto'}`;
    log(`[mp4] ${p.id}：網站副本與接收端 ${rx.origin}，編碼器 ${enc}，ffmpeg ${ff}`);
    const aborted = new Promise((_, no) => { if (signal?.aborted) no(new Error('已中止')); signal?.addEventListener('abort', () => no(new Error('已中止')), { once: true }); });
    aborted.catch(() => { });
    if (manual) { log(`[mp4] 手動模式：開啟 ${url}（Ctrl+C 結束）`); await Promise.race([outcome, aborted]).catch(() => { }); return { file, warnings }; }

    const profile = join(work, 'chrome-profile'); mkdirSync(profile, { recursive: true });
    browser = await launchChrome(exe, profile);
    cleanup.push(() => browser.close());
    const pageErrors = [];
    browser.on(m => {
      if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Inspector.targetCrashed') fail(new Error('Chrome 分頁當掉'));
      if (m.method === 'closed') fail(new Error('Chrome 意外關閉'));
    });
    await browser.send('Page.navigate', { url });
    // 監看：頁面狀態列的失敗訊息、錄影程式未啟動、影格停滯
    const loaded = Date.now(); let lastStatus = '', lastStatusLog = 0;
    const watch = (async () => {
      while (!done) {
        await wait(2000); if (done) break;
        const st = await browser.evaluate(`document.getElementById('filmStatus')?.textContent ?? null`).catch(() => null);
        if (st?.startsWith('輸出失敗')) return fail(new Error(`頁面回報：${st}${pageErrors.length ? '；' + pageErrors[0].split('\n')[0] : ''}`));
        if (!started) {
          if (st == null && Date.now() - loaded > 90000) return fail(new Error(`錄影程式未啟動（90 秒內沒有 #film）${pageErrors.length ? '：' + pageErrors[0].split('\n')[0] : ''}`));
          if (st && st !== lastStatus && Date.now() - lastStatusLog > 10000) { log(`[mp4] 頁面：${st}`); lastStatusLog = Date.now(); }
          lastStatus = st || lastStatus;
          if (Date.now() - loaded > 20 * 60000) return fail(new Error('20 分鐘內沒有開始輸出'));
        } else if (Date.now() - lastFrameAt > 180000) return fail(new Error('超過 3 分鐘沒有收到新影格'));
      }
    })();
    await Promise.race([outcome, aborted]);
    done = true; await watch;
    if (pageErrors.length) warnings.push(...pageErrors.slice(0, 3).map(e => '頁面錯誤：' + e.split('\n')[0]));

    const job = rx.job, info = probe(ff, file), size = statSync(file).size;
    if (info.frames !== job.spec.frames) throw new Error(`影格數不符：成品 ${info.frames}，預期 ${job.spec.frames}`);
    const seconds = Math.round((Date.now() - t0) / 1000);
    log(`[mp4] 完成：${file}（${info.frames} 格、${info.duration.toFixed(1)} 秒、${(size / 1048576).toFixed(1)} MB、耗時 ${clock(seconds)}）`);
    return { file, frames: info.frames, seconds, duration: info.duration, size, encoder: enc, gpu, warnings };
  } catch (e) {
    // 未完成：刪掉殘缺成品，之後可用同一資料夾重來
    if (!rx?.job?.complete) cleanup.unshift(() => { for (const f of [file, file.replace(/\.mp4$/, '.shots.json')]) rmSync(f, { force: true }); rmSync(join(outDir, 'samples', p.id), { recursive: true, force: true }); try { rmdirSync(join(outDir, 'samples')); } catch { } try { rmdirSync(outDir); } catch { } });
    throw e;
  } finally {
    done = true;
    for (const fn of cleanup.reverse()) { try { await fn(); } catch { } }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2), opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
  const flag = k => { const i = argv.indexOf(k); return i >= 0 ? (argv.splice(i, 1), true) : false; };
  const port = opt('--port'), o = { port: port ? +port : undefined, encoder: opt('--encoder'), ffmpeg: opt('--ffmpeg'), chrome: opt('--chrome'), samples: flag('--samples'), manual: flag('--manual') };
  const [name, out] = argv.filter(a => !a.startsWith('--'));
  if (!name) { console.log('用法：node core/tools/export-mp4.mjs <專案> [輸出資料夾] [--port 8810] [--encoder auto|h264_nvenc|libx264] [--ffmpeg 路徑] [--chrome 路徑] [--samples] [--manual]'); process.exit(2); }
  const ac = new AbortController(); let hits = 0;
  process.on('SIGINT', () => { if (++hits > 1) process.exit(130); console.log('[mp4] 中止中，正在關閉 Chrome、ffmpeg 與伺服器…'); ac.abort(); });
  try {
    const r = await exportMp4(name, out, { ...o, encoder: o.encoder || 'auto', signal: ac.signal });
    for (const w of r.warnings) console.log('   ! ' + w);
    process.exit(0);
  } catch (e) { console.error('[mp4] ✗ ' + e.message); process.exit(ac.signal.aborted ? 130 : 1); }
}
