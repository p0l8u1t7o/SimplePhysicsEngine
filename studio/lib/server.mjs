// vs3d ui 的本機伺服器（不需要 npm 套件）：API、即時輸出（SSE）、上傳、專案檔案、3D 預覽、前端靜態檔。
//   GET  /api/auth/me；POST /api/auth/login｜logout｜setup｜password   登入狀態、登入、登出、建立第一個管理者、改自己的密碼（lib/auth.mjs）
//   GET｜POST /api/users；PUT｜DELETE /api/users/:帳號          帳號管理與操作紀錄（管理者）
//   GET  /api/models；GET /api/models/:id/thumb                core 共用模型清單與渲染圖（元件庫的 3D 顯示）
//   GET  /api/info                  工作區、正在執行的專案、預覽 port
//   GET  /api/doctor                兩種 CLI 是否已安裝與登入
//   GET  /api/settings ／ PUT        工作區 .studio/settings.json（defaultCli、roles）與各角色目前的指派
//   GET  /api/projects              專案清單與狀態
//   GET  /api/dashboard             儀表板首頁：專案、代理執行統計、各站檢查與審查結果、元件資料庫統計
//   GET  /api/projects/:id          單一專案：狀態、每輪紀錄、問題、提案、審查、補強、截圖、最近輸出
//   POST /api/uploads?token=&name=  原始位元組上傳到暫存（影片會自動每 5 秒擷取一張影格；Office 檔在建立時抽出文字與圖片）
//   POST /api/projects              新建並開始（{ id, title, prompt, token, cli, model, effort, autoApprove, pick }）
//   POST /api/projects/:id/answer   回答問題（{ qid, choices, text, note }）；全部回答完就自動續跑
//   POST /api/projects/:id/run      { cmd: resume｜review｜render, pick, focus }
//   POST /api/projects/:id/cancel   取消進行中的流程，回到「完成」
//   DELETE /api/projects/:id        刪除工作區的專案（{ confirm: 專案名稱 }；移到工作區的 .studio/trash/）
//   POST /api/stop                  停止目前的執行
//   GET  /api/events                SSE：line（輸出一行）、exit（執行結束）
//   GET｜POST｜PUT｜DELETE /api/parts、/api/prices、/api/usages、/api/suppliers、/api/files   元件資料庫（lib/parts-api.mjs）
//   GET｜PUT /api/system            系統設定（附件上限、成本費率…；改只有管理者）
//   GET  /files/:id/<路徑>           專案內的 TEMP/、docs/、.studio/plan|reviews|render/ 檔案（截圖、對照頁）
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, extname, normalize, basename } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { STUDIO, readJson, writeJson, readText, inside, freePort, findFfmpeg } from './util.mjs';
import { paths, projectPaths, initWorkspace, deleteProject } from './workspace.mjs';
import { loadState, cancelFlow } from './loop.mjs';
import { loadQuestions, recordAnswer, parseChoice } from './questions.mjs';
import { ADAPTERS } from './adapters/index.mjs';
import { ROLES, resolveRole, loadRoleContext } from './roles.mjs';
import { createRunner } from './runner.mjs';
import { OFFICE, OLD_OFFICE } from './office.mjs';
import { importHandoff } from './handoff.mjs';
import { stationChanges } from './repo.mjs';
import { readRounds, agentStats, checkStats } from './dashboard.mjs';
import { createAuth, denied, AuthError, ROLE_LABEL } from './auth.mjs';
import { coreModels, withThumbs, renderThumbs, thumbFile } from './thumbs.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.ico': 'image/x-icon' };
const VIDEO = /\.(mp4|mov|avi|mkv|m4v|webm)$/i;
const FILE_AREAS = /^(TEMP|docs|\.studio\/(plan|reviews|render))(\/|$)/;

// repo：本庫根目錄（本庫模式，計畫書 4.10）；給了就同時列出 project-site/ 的各站，專案代號用 @<名稱>
// host：預設只聽本機；要讓區網的其他電腦連就給 0.0.0.0（先建立帳號，連線沒有加密，只在信任的區網用）
export async function startUi(ws, { port = 8780, log = console.log, repo = null, partsDb, host = '127.0.0.1', authFile } = {}) {
  if (!existsSync(paths(ws).marker)) initWorkspace(ws, { log });
  const P = paths(ws), ffmpeg = findFfmpeg(), dist = join(STUDIO, 'ui', 'dist');
  const clients = new Set();
  const broadcast = (event, data) => { const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(msg); };
  const runner = createRunner(ws, {
    onLine: (id, line) => broadcast('line', { id, line }),
    onExit: (id, status) => broadcast('exit', { id, status }),
  });

  // 3D 預覽：工作區 core 的 serve.mjs（工作區模式會從 projects/ 找專案）
  const previewPort = await freePort();
  const preview = spawn(process.execPath, [join(P.core, 'tools', 'serve.mjs'), '--port', String(previewPort), '--host', host, '--no-open'], { cwd: ws, windowsHide: true, stdio: 'ignore' });

  // 本庫的站另開一個預覽伺服器（本庫 core 的 serve.mjs 從 project-site/ 找專案）
  const repoPort = repo ? await freePort() : 0;
  const repoPreview = repo ? spawn(process.execPath, [join(repo, 'core', 'tools', 'serve.mjs'), '--port', String(repoPort), '--host', host, '--no-open'], { cwd: repo, windowsHide: true, stdio: 'ignore' }) : null;
  const loc = raw => raw.startsWith('@') ? { root: repo, name: raw.slice(1), repo: true } : { root: ws, name: raw, repo: false };
  const Jof = raw => { const l = loc(raw); return projectPaths(l.root, l.name); };
  const start = (cmd, raw, args = []) => { const l = loc(raw); return runner.start(cmd, raw, args, { name: l.name, root: l.root }); };
  const repoIds = () => repo && existsSync(join(repo, 'project-site')) ? readdirSync(join(repo, 'project-site')).filter(n => existsSync(join(repo, 'project-site', n, 'project.json'))).map(n => '@' + n) : [];
  const projectIds = () => [...(existsSync(P.projects) ? readdirSync(P.projects).filter(n => existsSync(join(P.projects, n, 'studio.json'))) : []), ...repoIds()];
  // 本庫的站：別的工具改過、還沒提交的檔案（清單一次算完；vs3d 執行中的站不算，那是代理正在改）
  const repoDirty = () => { try { return repo ? stationChanges(repo) : {}; } catch { return {}; } };
  const summary = (id, dirtyMap) => {
    const J = Jof(id), s = loadState(J), pj = readJson(join(J.dir, 'project.json'), {}), pending = loadQuestions(J).list.filter(q => !q.answered);
    let updated = 0; try { updated = statSync(J.state).mtimeMs; } catch { updated = statSync(J.dir).mtimeMs; }
    return { id, name: loc(id).name, repo: loc(id).repo, branch: s.branch || null, flowActive: !!s.flowActive, title: pj.title || id, summary: pj.summary || '', stage: s.stage, segment: s.segment || 1, round: s.round, pending: pending.length, lastCheck: s.lastCheck && { ok: s.lastCheck.ok, quick: s.lastCheck.quick },
      render: s.render?.result || null, reviews: s.reviews || 0, updated, running: runner.current?.id === id,
      dirty: loc(id).repo && runner.current?.id !== id ? ((dirtyMap || repoDirty())[loc(id).name] || []) : [] };
  };
  // 匯出的成品：TEMP/exports/ 底下的壓縮檔、HTML、影片（影片在子資料夾）
  const listExports = J => {
    const root = join(J.temp, 'exports'), out = [];
    const walk = (d, depth) => { if (!existsSync(d)) return; for (const n of readdirSync(d)) { if (n.startsWith('.')) continue; const f = join(d, n), st = statSync(f);
      if (st.isDirectory()) { if (depth < 1) walk(f, depth + 1); } else if (/\.(zip|html|mp4)$/i.test(n)) out.push({ path: rel(f), size: st.size, at: st.mtimeMs }); } };
    const rel = f => f.slice(J.dir.length + 1).split(/[\\/]/).join('/');
    walk(root, 0);
    return out.sort((x, y) => y.at - x.at);
  };
  const detail = id => {
    const J = Jof(id), s = loadState(J), qs = loadQuestions(J);
    const rounds = existsSync(J.rounds) ? readFileSync(J.rounds, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    const shotDir = s.shots && join(s.shots, loc(id).name), shots = shotDir && existsSync(shotDir) ? readdirSync(shotDir).filter(f => f.endsWith('.png') && !f.endsWith('.diff.png')).sort() : [];
    const rel = f => f.slice(J.dir.length + 1).replace(/\\/g, '/');
    // 可以取消的流程：本庫的站不是「完成」，或工作區的專案在完成第一段之後開始的流程（重新審查、補強、修改指令、第二段）
    const cancellable = s.stage !== 'done' || !!s.flowActive ? (loc(id).repo || !!s.flow || (s.segment || 1) === 2) : false;
    return {
      ...summary(id), cancellable, state: s, rounds, questions: qs.list, invalid: qs.invalid,
      proposal: readText(join(J.plan, 'proposal.md')), segment2: readText(join(J.plan, 'segment2.md')), agents: readText(J.agents), studio: readJson(J.studioJson, {}),
      // Office 抽取資料夾列出它的 text.md（資料夾本身不能開）
      docs: existsSync(J.docs) ? readdirSync(J.docs).map(f => f.endsWith('.extract') && existsSync(join(J.docs, f, 'text.md')) ? `${f}/text.md` : f) : [], shots: shots.map(f => rel(join(shotDir, f))),
      compare: existsSync(join(J.temp, 'render-compare', 'index.html')) ? 'TEMP/render-compare/index.html' : null,
      exports: listExports(J), log: runner.history(id), previewUrl: `http://127.0.0.1:${loc(id).repo ? repoPort : previewPort}/${encodeURIComponent(loc(id).name)}/`,
    };
  };
  // 元件資料庫：第一次用到才載入（node:sqlite 需要 Node.js 22.13 以上，舊版本其他功能照常）
  let partsApi = null;
  const parts = async () => partsApi ||= (await import('./parts-api.mjs')).createPartsApi(partsDb);
  const auth = createAuth(authFile ? { file: authFile } : {});
  // core 共用模型（元件庫的 3D 顯示）：本庫模式用本庫的 core，否則用工作區的；縮圖過期就在背景重拍，一次只跑一批
  const modelCore = repo ? join(repo, 'core') : P.core, catalogUrl = `http://127.0.0.1:${repo ? repoPort : previewPort}/core/catalog/`;
  let thumbJob = null, thumbError = '';
  const models = () => {
    const list = withThumbs(coreModels(modelCore)), stale = list.filter(m => m.stale);
    if (stale.length && !thumbJob) thumbJob = renderThumbs(modelCore, catalogUrl, stale).then(() => { thumbError = ''; }, e => { thumbError = String(e.message || e).split('\n')[0]; }).finally(() => { setTimeout(() => { thumbJob = null; }, thumbError ? 60000 : 0); });
    return { models: list, rendering: !!thumbJob, error: thumbError, catalogPort: repo ? repoPort : previewPort };
  };
  // 儀表板首頁：本庫的站用 core check 寫在 TEMP/ 的結果，工作區的專案用 vs3d 自己記的最近一次檢查
  const dashboard = async () => {
    const dirty = repoDirty(), list = projectIds().map(id => summary(id, dirty)).sort((x, y) => y.updated - x.updated);
    const repoChecks = repo ? checkStats(['check-quick.json', 'check-full.json'].map(f => { try { return readJson(join(repo, 'TEMP', f), null); } catch { return null; } }).filter(Boolean)) : {};
    const stations = list.map(p => {
      const s = loadState(Jof(p.id)), lc = s.lastCheck;
      const check = p.repo ? repoChecks[p.name] || null : lc ? { at: null, passed: Math.max(0, (lc.rows || 0) - lc.failures.length), failed: lc.failures.length, failures: lc.failures.map(f => ({ check: f.check, note: f.note || '' })) } : null;
      return { id: p.id, title: p.title, repo: p.repo, segment: p.segment, check, reviews: s.reviews || 0, must: s.reviewData ? s.reviewData.must.length : null, suggest: s.reviewData ? s.reviewData.suggest.length : null, render: s.render?.result || null };
    });
    let partsInfo;
    try { partsInfo = (await parts()).overview(); } catch (e) { partsInfo = { error: e.code === 'ERR_UNKNOWN_BUILTIN_MODULE' ? '元件資料庫需要 Node.js 22.13 以上' : String(e.message || e) }; }
    return { projects: list, running: runner.current, agents: agentStats(list.map(p => ({ id: p.id, title: p.title, rounds: readRounds(Jof(p.id).rounds) }))), stations, parts: partsInfo };
  };
  const resumeIfReady = id => { const J = Jof(id); if (!runner.current && !loadQuestions(J).list.some(q => !q.answered)) start('resume', id); };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), seg = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const user = auth.fromRequest(req);
    const json = (code, v, headers = {}) => {
      // 操作紀錄：登入的人做了會改東西的請求
      if (user && req.method !== 'GET' && seg[0] === 'api' && seg[1] !== 'auth') auth.audit({ user: user.name, method: req.method, path: url.pathname, status: code });
      res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(v));
    };
    // limit：位元組上限；先看 Content-Length，再邊讀邊數，超過就停（回應後關掉連線，不讀完剩下的內容）
    const tooLarge = () => { res.setHeader('Connection', 'close'); res.on('finish', () => req.destroy()); return Object.assign(new Error('too large'), { code: 'TOO_LARGE' }); };
    const body = async (limit = Infinity) => {
      if (Number(req.headers['content-length']) > limit) throw tooLarge();
      const chunks = []; let n = 0;
      for await (const c of req) { n += c.length; if (n > limit) throw tooLarge(); chunks.push(c); }
      return Buffer.concat(chunks);
    };
    const jbody = async () => { const b = await body(); return b.length ? JSON.parse(b.toString('utf8')) : {}; };
    try {
      // 會改東西的請求如果是別的網站送來的（Origin 不是自己）就拒絕
      if (req.method !== 'GET' && req.headers.origin) { let o = ''; try { o = new URL(req.headers.origin).host; } catch { /* 不是網址 */ } if (o !== req.headers.host) return json(403, { error: '請求來源不符' }); }
      if (seg[0] === 'api' && seg[1] === 'auth') {
        const act = seg[2], post = req.method === 'POST', set = token => ({ 'Set-Cookie': auth.cookie(token) });
        try {
          if (act === 'me') return json(200, { required: auth.enabled(), user, roles: ROLE_LABEL });
          if (act === 'login' && post) { const v = await jbody(), r = auth.login(v.name, v.password); auth.audit({ user: r.user.name, action: '登入' }); return json(200, { user: r.user }, set(r.token)); }
          if (act === 'logout' && post) return json(200, { ok: true }, set(''));
          if (act === 'setup' && post) {      // 建立第一個管理者：只有還沒有任何帳號時可以
            if (auth.enabled()) return json(400, { error: '已經有帳號了，請登入' });
            const v = await jbody(); auth.create({ ...v, role: 'admin' }); const r = auth.login(v.name, v.password);
            auth.audit({ user: r.user.name, action: '建立第一個管理者' }); return json(200, { user: r.user }, set(r.token));
          }
          if (act === 'password' && post) {
            if (!user) return json(401, { error: '請先登入' });
            const v = await jbody(); auth.login(user.name, v.current); auth.update(user.name, { password: v.password });
            auth.audit({ user: user.name, action: '改密碼' }); return json(200, { ok: true }, set(auth.login(user.name, v.password).token));
          }
        } catch (e) { if (e instanceof AuthError) return json(e.status === 401 && act === 'password' ? 400 : e.status, { error: act === 'password' && e.status === 401 ? '目前的密碼不對' : e.message }); throw e; }
        return json(404, { error: '未知的 API' });
      }
      // 有帳號之後：API 與專案檔案都要登入；再看角色能不能做這個請求
      if (auth.enabled() && !user && (seg[0] === 'api' || seg[0] === 'files')) return json(401, { error: '請先登入' });
      if (user && seg[0] === 'api') { const why = denied(user.role, req.method, seg.slice(1)); if (why) return json(403, { error: why }); }
      if (seg[0] === 'api') {
        const [, a, id, b] = seg;
        if (a === 'users') {
          try {
            if (!id && req.method === 'GET') return json(200, { users: auth.list(), roles: ROLE_LABEL, audit: auth.recent(100), enabled: auth.enabled(), me: user?.name || null });
            if (!id && req.method === 'POST') return json(200, auth.create(await jbody()));
            if (id && req.method === 'PUT') return json(200, auth.update(id, await jbody()));
            if (id && req.method === 'DELETE') { if (user && id.toLowerCase() === user.name.toLowerCase()) return json(400, { error: '不能刪除自己的帳號' }); return json(200, auth.remove(id)); }
          } catch (e) { if (e instanceof AuthError) return json(e.status, { error: e.message }); throw e; }
          return json(404, { error: '未知的 API' });
        }
        if (a === 'models') {
          if (!id) return json(200, models());
          const f = thumbFile(id.replace(/[^\w-]/g, ''));
          if (b === 'thumb' && existsSync(f)) { res.writeHead(200, { 'Content-Type': MIME['.png'], 'Cache-Control': 'no-store' }); createReadStream(f).pipe(res); return; }
          return json(404, { error: '沒有這張渲染圖' });
        }
        if (a === 'events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          res.write(`event: hello\ndata: ${JSON.stringify({ running: runner.current })}\n\n`);
          clients.add(res); req.on('close', () => clients.delete(res)); return;
        }
        // options：介面的下拉選單（各 CLI 可選的模型與推理強度），不必呼叫 CLI
        if (a === 'info') return json(200, { options: Object.fromEntries(Object.values(ADAPTERS).filter(x => x.name !== 'fake').map(x => [x.name, { label: x.label, models: x.listModels(), efforts: x.efforts || [] }])), ws, repo, running: runner.current, ffmpeg: !!ffmpeg, previewPort, roles: ROLES });
        if (a === 'doctor') return json(200, Object.values(ADAPTERS).filter(x => x.name !== 'fake').map(x => ({ name: x.name, label: x.label, models: x.listModels(), ...x.detect() })));
        if (a === 'settings') {
          if (req.method === 'PUT') { const v = await jbody(); writeJson(P.settings, { defaultCli: v.defaultCli || 'claude', roles: v.roles || {} }); }
          const ctx = loadRoleContext(P.settings, '', {});
          return json(200, { settings: readJson(P.settings, {}), resolved: Object.fromEntries(Object.keys(ROLES).map(r => [r, resolveRole(r, ctx)])) });
        }
        if (a === 'dashboard') return json(200, await dashboard());
        if (a === 'stop' && req.method === 'POST') return json(200, { stopped: runner.stop() });
        if (a === 'uploads' && req.method === 'POST') {
          const token = (url.searchParams.get('token') || '').replace(/[^\w-]/g, '') || randomUUID(), name = basename(url.searchParams.get('name') || 'file');
          const dir = join(P.ws, '.studio', 'uploads', token); mkdirSync(dir, { recursive: true });
          const file = join(dir, name); writeFileSync(file, await body());
          const files = [name];
          if (VIDEO.test(name) && ffmpeg) {     // 代理看不了影片：每 5 秒擷取一張影格，最多 30 張
            const stem = name.replace(/\.[^.]+$/, '');
            const r = spawnSync(ffmpeg, ['-loglevel', 'error', '-y', '-i', file, '-vf', 'fps=1/5', '-frames:v', '30', '-q:v', '3', join(dir, `${stem}-影格-%02d.jpg`)], { windowsHide: true });
            if (r.status === 0) files.push(...readdirSync(dir).filter(f => f.startsWith(`${stem}-影格-`)).sort());
          }
          // Office 檔在建立專案時才抽取（createProject）；舊格式先提示
          const notice = OLD_OFFICE.test(name) ? '舊版格式：代理讀不了，請另存成新格式（.pptx／.docx／.xlsx）後重新上傳'
            : OFFICE.test(name) ? '建立專案時會自動抽出文字與圖片' : '';
          return json(200, { token, files, notice });
        }
        // 匯入交接包：先用 /api/uploads 上傳 zip，再帶 token 呼叫
        if (a === 'import' && req.method === 'POST') {
          const v = await jbody(), dir = join(P.ws, '.studio', 'uploads', String(v.token || '').replace(/[^\w-]/g, ''));
          const zip = existsSync(dir) ? readdirSync(dir).find(f => /\.zip$/i.test(f)) : null;
          if (!zip) return json(400, { error: '請先上傳交接包（.zip）' });
          try { const r = await importHandoff(ws, join(dir, zip), { id: (v.name || '').trim() || undefined, log: () => {} }); return json(200, { id: r.id, stage: r.stage, rounds: r.rounds }); }
          catch (e) { return json(400, { error: e.message }); }
        }
        if (a === 'projects' && !id) {
          if (req.method === 'POST') {
            const v = await jbody();
            if (!/^[\w][\w .-]*$/.test(v.id || '')) return json(400, { error: '專案名稱請用英數、空白、- 或 _' });
            if (existsSync(projectPaths(ws, v.id).dir)) return json(400, { error: `專案已存在：${v.id}` });
            const dir = v.token ? join(P.ws, '.studio', 'uploads', v.token.replace(/[^\w-]/g, '')) : null;
            const files = dir && existsSync(dir) ? readdirSync(dir).filter(f => !VIDEO.test(f)).map(f => join(dir, f)) : [];
            const promptFile = join(P.ws, '.studio', 'uploads', `${randomUUID()}.txt`); mkdirSync(join(P.ws, '.studio', 'uploads'), { recursive: true });
            writeFileSync(promptFile, v.prompt || '');
            const args = ['--title', v.title || v.id, '--prompt-file', promptFile, ...(files.length ? ['--files', ...files] : [])];
            if (v.clientNames) args.push('--private', v.clientNames);
            if (v.cli) args.push('--cli', v.cli);
            if (v.model) args.push('--model', v.model);
            if (v.effort) args.push('--effort', v.effort);
            if (v.autoApprove) args.push('--auto-approve');
            if (v.pick) args.push('--pick');
            runner.start('new', v.id, args);
            return json(200, { started: true });
          }
          return json(200, { projects: (d => projectIds().map(id => summary(id, d)))(repoDirty()).sort((x, y) => y.updated - x.updated), running: runner.current });
        }
        if (a === 'projects' && id) {
          if (!projectIds().includes(id)) return json(404, { error: `找不到專案：${id}` });
          if (!b && req.method === 'DELETE') {
            const v = await jbody(), l = loc(id);
            if (l.repo) return json(400, { error: '本庫的站在版控裡，不能從這裡刪除（要移除請用 git）' });
            if (runner.current?.id === id) return json(400, { error: '這個專案正在執行，先停止再刪除' });
            if (String(v.confirm || '') !== l.name) return json(400, { error: '請輸入專案名稱確認刪除' });
            try { return json(200, { deleted: id, movedTo: deleteProject(ws, l.name) }); } catch (e) { return json(400, { error: e.message }); }
          }
          if (!b) return json(200, detail(id));
          if (b === 'cancel' && req.method === 'POST') {
            if (runner.current?.id === id) return json(400, { error: '這個專案正在執行，先按「停止」再取消流程' });
            const l = loc(id);
            try { return json(200, cancelFlow(l.root, l.name)); } catch (e) { return json(400, { error: e.message }); }
          }
          if (b === 'answer' && req.method === 'POST') {
            const v = await jbody(), J = Jof(id), q = loadQuestions(J).list.find(x => x.id === v.qid);
            if (!q) return json(404, { error: `找不到問題 ${v.qid}` });
            const parsed = v.text ? { choices: [], text: v.text } : parseChoice(q, (v.choices || []).map(i => i + 1).join(','));
            recordAnswer(J, q, { ...parsed, note: v.note || '' });
            resumeIfReady(id);
            return json(200, { ok: true, running: runner.current });
          }
          if (b === 'run' && req.method === 'POST') {
            const v = await jbody(), cmd = ['resume', 'review', 'render', 'stage2', 'export', 'handoff', 'change', 'check', 'push'].includes(v.cmd) ? v.cmd : 'resume';
            if (cmd === 'change' && !String(v.text || '').trim()) return json(400, { error: '請輸入要修改的內容' });
            const args = cmd === 'export' ? (v.formats || ['zip', 'html']).filter(f => ['zip', 'html', 'mp4'].includes(f)).map(f => '--' + f)
              : cmd === 'change' ? ['--text', String(v.text).trim(), ...(v.keepTiming ? ['--keep-timing'] : [])]
              : cmd === 'check' ? (v.full ? ['--full'] : [])
              : [...(v.pick ? ['--pick'] : []), ...(v.focus ? ['--focus', v.focus] : [])];
            start(cmd, id, args);
            return json(200, { started: true });
          }
        }
        if (['parts', 'prices', 'usages', 'suppliers', 'files', 'system'].includes(a)) {
          let api; try { api = await parts(); } catch (e) { return json(500, { error: e.code === 'ERR_UNKNOWN_BUILTIN_MODULE' ? '元件資料庫需要 Node.js 22.13 以上（內建 node:sqlite）' : String(e.message || e) }); }
          const r = await api.handle({ method: req.method, seg: seg.slice(1), query: url.searchParams, body: jbody, raw: body, user });
          if (r.file) {      // 附件：下載，或圖片與 PDF 直接顯示（inline）
            res.writeHead(200, { 'Content-Type': r.file.inline ? r.file.mime : 'application/octet-stream', 'X-Content-Type-Options': 'nosniff',
              'Content-Disposition': `${r.file.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(r.file.name)}`, 'Cache-Control': 'no-store' });
            createReadStream(r.file.path).pipe(res); return;
          }
          return json(r.code, r.body);
        }
        return json(404, { error: '未知的 API' });
      }
      if (seg[0] === 'files' && seg[1]) {
        const J = Jof(seg[1]), relPath = seg.slice(2).join('/');
        const file = normalize(join(J.dir, relPath));
        if (!FILE_AREAS.test(relPath) || !inside(J.dir, file) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('404'); return; }
        res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        createReadStream(file).pipe(res); return;
      }
      // 前端（studio/ui/dist），單頁應用：找不到的路徑都回 index.html
      if (!existsSync(dist)) { res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end('<meta charset="utf-8"><p>前端還沒建置：<code>npm --prefix studio/ui install</code> 後 <code>npm --prefix studio/ui run build</code>。</p>'); return; }
      let file = normalize(join(dist, ...seg));
      if (!inside(dist, file) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
      res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': file.endsWith('index.html') ? 'no-store' : 'max-age=3600' });
      createReadStream(file).pipe(res);
    } catch (e) { json(500, { error: String(e.message || e) }); }
  });
  await new Promise((ok, fail) => server.listen(port, host, ok).on('error', fail));
  if (host !== '127.0.0.1' && !auth.enabled()) log('⚠ 介面開放給其他電腦連線，但還沒有任何帳號：任何連得到的人都能操作。請先在「帳號」頁建立管理者。');
  log(`vs3d 介面：http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/（${auth.enabled() ? '需要登入；' : ''}工作區 ${ws}${repo ? `；本庫 ${repo}（預覽 port ${repoPort}）` : ''}；預覽 port ${previewPort}；ffmpeg ${ffmpeg ? '可用' : '找不到，影片不會擷取影格'}）`);
  const close = () => { preview.kill(); repoPreview?.kill(); runner.stop(); partsApi?.close(); for (const c of clients) c.end(); server.close(); };
  return { server, port, previewPort, close, runner };
}
