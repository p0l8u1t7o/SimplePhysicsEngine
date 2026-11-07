// 2026-11-07 巡檢記下的疑點（studio）的回歸測試：建立第一個管理者的競態、補全下載的 SSRF 防護、成本表 SUMIFS 條件的跳脫、
// git status -z 的改名解析、介面的節流與 401 處理、本庫模式的併改偵測（單元部分；整合部分在 repo.test.mjs）。
//   node --test studio/test/fixes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { createAuth } from '../lib/auth.mjs';
import { startUi } from '../lib/server.mjs';
import { setReadOnly, paths } from '../lib/workspace.mjs';

const temp = async (fn, prefix = 'vs3d-fix-') => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try { return await fn(dir); } finally { for (const d of [paths(dir).core, paths(dir).pristine]) try { setReadOnly(d, false); } catch { } rmSync(dir, { recursive: true, force: true }); }
};

// ---------------------------------------------------------------- 1. 建立第一個管理者的競態
// 兩個請求先送出標頭、等兩邊都進到伺服器（都通過「還沒有帳號」的檢查、在等內容）後才送內容：修正前兩個都會建成管理者
function slowPost(port, path, body) {
  const data = JSON.stringify(body);
  const q = request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } });
  const done = new Promise((ok, fail) => { q.on('response', r => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => ok({ status: r.statusCode, body: b })); }); q.on('error', fail); });
  q.flushHeaders();
  return { send: () => q.end(data), done };
}

test('setup：兩個並行請求只能建出一個管理者', () => temp(async dir => {
  const authFile = join(dir, 'users.json');
  const ui = await startUi(dir, { port: 0, log: () => {}, partsDb: join(dir, 'studio.db'), authFile });
  try {
    const port = ui.server.address().port;
    const a = slowPost(port, '/api/auth/setup', { name: 'alice', password: 'correct-horse' }), b = slowPost(port, '/api/auth/setup', { name: 'bob', password: 'correct-horse' });
    await new Promise(r => setTimeout(r, 300));           // 兩邊的標頭都到了、都在等內容
    a.send(); b.send();
    const res = await Promise.all([a.done, b.done]);
    assert.deepEqual(res.map(r => r.status).sort(), [200, 400], res.map(r => r.body).join(' / '));
    assert.match(res.find(r => r.status === 400).body, /已經有帳號/);
    assert.equal(createAuth({ file: authFile }).list().length, 1, '帳號檔只有一個帳號');
  } finally { ui.close(); }
}));

test('setup：命令列先建了帳號（另一個程序），介面的 setup 也要拒絕', () => temp(async dir => {
  const file = join(dir, 'users.json'), ui = createAuth({ file });
  createAuth({ file }).create({ name: 'boss', password: 'correct-horse' });     // 另一個程序寫進檔案
  assert.throws(() => ui.setup({ name: 'eve', password: 'correct-horse' }), /已經有帳號/);
  assert.deepEqual(createAuth({ file }).list().map(u => u.name), ['boss']);
  assert.equal(ui.enabled(), true, '重新讀檔後知道已經有帳號');
}));

// ---------------------------------------------------------------- 2. 補全採用檔案：主機下載代理給的網址（SSRF）
import { createServer } from 'node:http';
import { blockedAddress, safeGet } from '../lib/safe-fetch.mjs';
import { downloadFile } from '../lib/enrich.mjs';
import { openPartsDb } from '../lib/partsdb.mjs';

test('內部位址判斷：本機、私有網段、link-local／metadata、CGNAT、IPv6 的對應位址都擋；公開位址放行', () => {
  for (const a of ['127.0.0.1', '127.8.8.8', '10.1.2.3', '172.16.5.4', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fd00:ec2::254', 'fc00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::a00:1', '2002:c0a8:101::1', '[::1]', 'localhost', ''])
    assert.equal(blockedAddress(a), true, a);
  for (const a of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808'])
    assert.equal(blockedAddress(a), false, a);
});

async function withSite(handler, fn) {
  const site = createServer(handler);
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${site.address().port}`, site.address().port); } finally { site.closeAllConnections?.(); site.close(); }
}

test('補全下載：只收 http／https，本機與內部位址（含名稱解析到本機的）一律拒絕', () => withSite((req, res) => { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end('%PDF secret'); }, async (base, port) => {
  const db = openPartsDb(':memory:');
  for (const u of ['file:///C:/Windows/win.ini', 'ftp://example.com/a.pdf', 'gopher://x/', 'not a url']) await assert.rejects(downloadFile(u, db), /http／https|網址格式/, u);
  await assert.rejects(downloadFile(`${base}/a.pdf`, db), /內部網路/);
  await assert.rejects(downloadFile(`http://localhost:${port}/a.pdf`, db), /內部網路/);
  await assert.rejects(downloadFile(`http://[::1]:${port}/a.pdf`, db), /內部網路/);
  await assert.rejects(downloadFile(`http://169.254.169.254/latest/meta-data/`, db), /內部網路/);
  await assert.rejects(downloadFile(`http://user:pw@example.com/a.pdf`, db), /帳號密碼/);
  // 名稱解析到內部位址（例如內網 DNS、DNS rebinding）：連線用的 lookup 檢查解析結果
  const resolver = (host, opts, cb) => cb(null, [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.7', family: 4 }]);
  await assert.rejects(downloadFile(`http://files.example.com:${port}/a.pdf`, db, { resolver }), /files\.example\.com → 10\.0\.0\.7/);
  // 明確打開（測試或內網檔案伺服器）才抓得到
  const got = await downloadFile(`${base}/a.pdf`, db, { allowPrivate: true });
  assert.equal(got.name, 'a.pdf'); assert.equal(got.data.toString(), '%PDF secret');
}));

test('補全下載：每一次轉址都重新檢查（外部轉到內部位址會擋）、轉址次數有上限、整體逾時、大小上限', () => withSite((req, res) => {
  if (req.url === '/to-internal') { res.writeHead(302, { Location: 'http://10.0.0.5/secret.pdf' }); return res.end(); }
  if (req.url === '/to-ok') { res.writeHead(301, { Location: '/files/ok.pdf' }); return res.end(); }
  if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); return res.end(); }
  if (req.url === '/files/ok.pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end('%PDF ok'); }
  if (req.url === '/big.pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.write(Buffer.alloc(1024 * 1024)); res.write(Buffer.alloc(1024 * 1024)); return; }   // 不給長度、一直不結束
  if (req.url === '/hang') return;                    // 一直不回應
  res.writeHead(404); res.end();
}, async base => {
  const db = openPartsDb(':memory:');
  // 把測試站（127.0.0.1）當成外部網站，其他照常判斷
  const net = { blocked: a => a !== '127.0.0.1' && blockedAddress(a) };
  await assert.rejects(downloadFile(`${base}/to-internal`, db, net), /內部網路的位址（10\.0\.0\.5）/);
  assert.equal((await downloadFile(`${base}/to-ok`, db, net)).name, 'ok.pdf', '同站轉址照常跟');
  await assert.rejects(downloadFile(`${base}/loop`, db, net), /轉址超過 5 次/);
  await assert.rejects(downloadFile(`${base}/hang`, db, { ...net, timeoutMs: 300 }), /逾時/);
  db.writeSettings({ 'attachment.maxMB': 1 });
  await assert.rejects(downloadFile(`${base}/big.pdf`, db, { ...net, timeoutMs: 5000 }), /超過附件上限 1 MB/);
  const r = await safeGet(`${base}/files/ok.pdf`, net); r.res.resume(); r.abort();
}));

// ---------------------------------------------------------------- 3. 成本表 xlsx：分部名稱含 " * ? ~ 或開頭是比較符號時，SUMIFS 條件要跳脫
import { costWorkbook, sumifsEquals } from '../lib/cost-xlsx.mjs';
import { readZip } from '../lib/office.mjs';

// Excel 條件的比對規則（簡化版，只做文字）：開頭的比較運算子、* ? 萬用字元、~ 跳脫、不分大小寫
function excelCriteria(crit) {
  const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(crit), op = m[1] || '=', pat = m[2];
  if (op !== '=' && op !== '<>') return cell => op === '<' ? cell < pat : op === '>' ? cell > pat : op === '<=' ? cell <= pat : cell >= pat;   // 文字比較（夠測試用）
  let re = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '~' && i + 1 < pat.length && '~*?'.includes(pat[i + 1])) { re += pat[++i].replace(/[~*?]/, '\\$&'); continue; }
    re += c === '*' ? '[\\s\\S]*' : c === '?' ? '[\\s\\S]' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const rx = new RegExp(`^${re}$`, 'i');
  return cell => op === '=' ? (pat === '' && !m[1] ? cell === '' : rx.test(cell)) : !rx.test(cell);
}
// 公式裡的字串常值 → 內容（"" → "）
const literal = s => s.slice(1, -1).replace(/""/g, '"');

test('成本表 xlsx：分部名稱含 " * ? ~、開頭是 > 時，各分部的 SUMIFS 只加到自己', () => {
  assert.equal(sumifsEquals('機構"A"*?~'), '"=機構""A""~*~?~~"');
  assert.equal(sumifsEquals(''), '""');
  const groups = ['機構"A"', '機構*', '機構X', '>5 區', '品?管~'];
  const lines = groups.flatMap((grp, gi) => [1, 2].map(k => ({ line: `${gi + 1}-0${k}`, section: `${gi + 1} 子系統`, grp, name: `品項${gi}${k}`, spec: '', model: '', reason: '', qty: 1, unit: '台',
    unit_twd: (gi + 1) * 1000 + k, subtotal: (gi + 1) * 1000 + k, grade: 'B', low: 0, high: 0, nature: 'equipment', code: '', part_version: null, currency: 'TWD', price: null, fx: null, flags: [], source: 'version' })));
  const sum = grp => lines.filter(l => l.grp === grp).reduce((a, l) => a + l.subtotal, 0);
  const total = lines.reduce((a, l) => a + l.subtotal, 0);
  const data = { lines, settings: { engRate: 8000, techRate: 5500, contingency: 0.1, tax: 0.05, fxDate: '2026-11-07', gradeRange: { A: 0.1, B: 0.2, C: 0.3 } },
    summary: { equipment: total, labor: 0, option: 0, subtotal: total, contingency: 0, total, low: 0, high: 0, taxed: 0, laborDays: 0, flags: {},
      groups: groups.map(grp => ({ grp, equipment: sum(grp), labor: 0, option: 0, subtotal: sum(grp), total: sum(grp), taxed: sum(grp) })) } };
  const zip = readZip(costWorkbook(data, { title: '測試' })), xml = zip.get('xl/worksheets/sheet1.xml').toString('utf8');
  const unxml = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const formulas = [...xml.matchAll(/<f>([^<]*)<\/f>/g)].map(m => unxml(m[1])).filter(f => f.includes(`"設備與材料",'明細'!$C$`));
  assert.equal(formulas.length, groups.length, '每個分部一個「設備與材料」的 SUMIFS');
  for (const [i, f] of formulas.entries()) {
    // SUMIFS(K, O, "設備與材料", C, <條件>)：條件是最後一個參數，必須是完整的字串常值（引號成對）
    const m = /,('明細'!\$C\$2:\$C\$\d+),("(?:[^"]|"")*")\)$/.exec(f);
    assert.ok(m, `公式的引號沒有成對：${f}`);
    const match = excelCriteria(literal(m[2]));
    const got = lines.filter(l => l.nature === 'equipment' && match(l.grp)).reduce((a, l) => a + l.subtotal, 0);
    assert.equal(got, sum(groups[i]), `${groups[i]}：${f}`);
  }
  // 修正前的寫法（直接把名稱放進引號）：* 會吃到別的分部、" 讓公式壞掉
  const old = grp => `"${grp}"`;
  assert.notEqual(lines.filter(l => excelCriteria(literal(old('機構*')))(l.grp)).length, 2, '舊寫法的 機構* 會配到其他分部');
});

// ---------------------------------------------------------------- 4. git status --porcelain -z：已 stage 的改名（R）下一筆是原路徑
import * as repoGit from '../lib/repo.mjs';
import { git } from '../lib/util.mjs';

test('git status -z 解析：已 stage 的改名只算一筆（新路徑，記下原路徑），不會把原路徑當成另一個檔', () => temp(async root => {
  git(root, ['init', '-q', '-b', 'main']); git(root, ['config', 'core.autocrlf', 'false']);
  const st = join(root, 'project-site', 'Demo');
  mkdirSync(join(st, 'web'), { recursive: true });
  writeFileSync(join(st, 'web', 'old-name.js'), 'export const a = 1;\n'.repeat(20)); writeFileSync(join(st, 'README.md'), '# Demo\n');
  git(root, ['add', '-A']); git(root, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  git(root, ['mv', 'project-site/Demo/web/old-name.js', 'project-site/Demo/web/new-name.js']);
  appendFileSync(join(st, 'README.md'), '改\n');
  const J = { dir: st };
  assert.deepEqual(repoGit.changes(J).map(c => [c.code, c.path, c.from || '']).sort(), [[' M', 'README.md', ''], ['R ', 'web/new-name.js', 'web/old-name.js']]);
  assert.deepEqual(repoGit.stationChanges(root).Demo.sort(), ['README.md', 'web/new-name.js']);
  // 工作區模式（專案自己是 git 庫，沒有前綴）：修正前原路徑會被切成 code「we」、path「/old-name.js」的假項目
  git(st, ['init', '-q', '-b', 'main']); git(st, ['add', '-A']); git(st, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  git(st, ['mv', 'web/new-name.js', 'web/renamed.js']);
  assert.deepEqual(repoGit.parseStatusZ(git(st, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])), [{ code: 'R ', path: 'web/renamed.js', from: 'web/new-name.js' }]);
  assert.deepEqual(repoGit.parseStatusZ('R  b.txt\0a.txt\0 M c.txt\0?? d.txt\0'), [{ code: 'R ', path: 'b.txt', from: 'a.txt' }, { code: ' M', path: 'c.txt' }, { code: '??', path: 'd.txt' }]);
}));

// ---------------------------------------------------------------- 5～8. 介面（studio/ui/src）：節流、上傳的 401、檔案清單的 key、設定頁載入失敗
import { mock } from 'node:test';
import { STUDIO } from '../lib/util.mjs';
import { createThrottle, call, send, UNAUTHORIZED_EVENT } from '../ui/src/net.js';

test('介面節流：每一行輸出都通知時，500 ms 內最多重新載入一次，最後一次一定會載到；結束時立刻再載', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  try {
    let n = 0; const t = createThrottle(() => { n++; }, 500);
    t.call(); assert.equal(n, 1, '閒置時第一行馬上載');
    for (let i = 0; i < 200; i++) { mock.timers.tick(10); t.call(); }      // 2 秒內 200 行
    assert.equal(n, 5, '0、500、1000、1500、2000 ms 各一次（修正前是 201 次）');
    assert.equal(t.pending, true, '最後幾行合併成一次，排在 2500 ms');
    mock.timers.tick(500); assert.equal(n, 6, '最後一行之後一定會再載一次'); assert.equal(t.pending, false);
    t.call(); assert.equal(n, 6, '剛載過，排著'); assert.equal(t.pending, true);
    t.flush(); assert.equal(n, 7, 'flush（執行結束）立刻載並取消排著的'); assert.equal(t.pending, false);
    mock.timers.tick(1000); assert.equal(n, 7, '取消的那次不會再做');
    t.call(); assert.equal(n, 8); t.call(); t.cancel(); mock.timers.tick(1000); assert.equal(n, 8, 'cancel（離開畫面）後不再載');
  } finally { mock.timers.reset(); }
});

test('介面的上傳（api.upload／uploadPartFile 用的 send）遇到 401 也會通知回到登入頁；伺服器回的不是 JSON 也有錯誤訊息', async () => {
  const events = [], saved = { fetch: globalThis.fetch, dispatchEvent: globalThis.dispatchEvent };
  globalThis.dispatchEvent = e => { events.push(e.type); return true; };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: '請先登入' }), { status: 401, statusText: 'Unauthorized' });
    await assert.rejects(send('/api/uploads?token=x&name=a.pdf', new Blob(['x'])), /請先登入/);
    await assert.rejects(send('/api/parts/1/files?name=a.pdf', new Blob(['x'])), /請先登入/);
    await assert.rejects(call('GET', '/api/projects'), /請先登入/);
    await assert.rejects(call('POST', '/api/auth/login', { name: 'a' }), /請先登入/);       // 登入本身的 401 是密碼錯，不跳回登入頁
    assert.deepEqual(events, [UNAUTHORIZED_EVENT, UNAUTHORIZED_EVENT, UNAUTHORIZED_EVENT]);
    globalThis.fetch = async () => new Response('<html>413</html>', { status: 413, statusText: 'Payload Too Large' });
    await assert.rejects(send('/api/uploads?token=x&name=big.mp4', new Blob(['x'])), /413 Payload Too Large/);
    globalThis.fetch = async () => new Response(JSON.stringify({ token: 't', files: ['a.pdf'] }), { status: 200 });
    assert.deepEqual(await send('/api/uploads?token=t&name=a.pdf', new Blob(['x'])), { token: 't', files: ['a.pdf'] });
  } finally { Object.assign(globalThis, saved); }
  // api.js 的上傳都走 send（不要再自己 fetch 而漏掉 401）
  const api = readFileSync(join(STUDIO, 'ui', 'src', 'api.js'), 'utf8');
  assert.match(api, /upload: \(token, file\) => send\(/); assert.match(api, /uploadPartFile: \(partId, file\) => send\(/);
  assert.doesNotMatch(api, /fetch\(`\/api\/(uploads|parts)/);
});

test('介面原始碼：新建專案的檔案清單用唯一 id 當 key、設定頁載入失敗有提示且不能儲存、輸出行經過節流', () => {
  const src = f => readFileSync(join(STUDIO, 'ui', 'src', f), 'utf8');
  const np = src('NewProject.jsx');
  assert.doesNotMatch(np, /key=\{f\.name\}/, '同名檔會讓 key 重複');
  assert.doesNotMatch(np, /x\.name === file\.name \? \{ \.\.\.x, status/, '同名檔的狀態會互相蓋掉');
  assert.match(np, /<tr key=\{f\.id\}>/);
  const st = src('Settings.jsx');
  assert.match(st, /api\.settings\(\)\.then\([\s\S]*?\)\.catch\(e => setLoadError/, '主設定載入失敗要接住');
  assert.match(st, /設定載入失敗/); assert.match(st, /disabled=\{!data\}/, '沒載入時不能儲存（會把角色指派存成空的）');
  for (const t of ['API 金鑰', '匯率', '回收桶（刪除的專案）']) assert.match(st, new RegExp(`<LoadFailed title="${t.replace(/[()（）]/g, '.')}"`), t);
  const app = src('App.jsx');
  assert.match(app, /line: \(\) => bump\.call\(\)/); assert.match(app, /exit: \(\) => \{ refresh\(\); bump\.flush\(\); \}/);
});

// ---------------------------------------------------------------- 本庫模式的併改偵測（單元；整合測試在 repo.test.mjs）
import { claude } from '../lib/adapters/claude.mjs';
import { codex } from '../lib/adapters/codex.mjs';

test('併改偵測：代理寫完之後、或代理讀過之後你又改了同一個檔＝併改；只有你改的檔另外列出；代理的指令改的不算你的', () => temp(async dir => {
  const f = p => join(dir, p), put = (p, s) => { mkdirSync(join(f(p), '..'), { recursive: true }); writeFileSync(f(p), s); };
  put('web/a.js', 'a0'); put('web/b.js', 'b0'); put('web/c.js', 'c0'); put('README.md', 'r0'); put('review/x.json', '{}'); put('.studio/state.json', '{}');
  const t = repoGit.createEditTracker(dir);
  // 1. 代理用 Edit 改 a（事件在寫檔之前，像真的 Claude），之後你也改了 a → 併改
  t.on({ kind: 'tool', name: 'Edit', id: 'e1', paths: [f('web/a.js')] }); put('web/a.js', 'a1-agent'); t.on({ kind: 'tool_result', id: 'e1' });
  put('web/a.js', 'a1-agent+user');
  // 2. 你先改 b，代理讀 b（查核點）後再寫 b → 也是併改
  put('web/b.js', 'b1-user'); t.on({ kind: 'tool', name: 'Read', id: 'r1' });
  t.on({ kind: 'tool', name: 'Write', id: 'w1', paths: [f('web/b.js')] }); put('web/b.js', 'b2-agent'); t.on({ kind: 'tool_result', id: 'w1' });
  // 2b. 你改 d，代理的 Edit 發現檔案被改過而失敗（沒寫），重讀後再改成功 → 併改（失敗的那次不能把你的改動算成代理的）
  put('web/d.js', 'd1-user');
  t.on({ kind: 'tool', name: 'Edit', id: 'e2', paths: [f('web/d.js')] }); t.on({ kind: 'tool_result', id: 'e2', ok: false });
  t.on({ kind: 'tool', name: 'Read', id: 'r2' });
  t.on({ kind: 'tool', name: 'Edit', id: 'e3', paths: [f('web/d.js')] }); put('web/d.js', 'd2-agent'); t.on({ kind: 'tool_result', id: 'e3', ok: true });
  // 3. 代理寫 c，之後代理自己的指令（Bash）又改 c 與 review/x.json → 不算併改
  t.on({ kind: 'tool', name: 'Write', id: 'w2', paths: [f('web/c.js')] }); put('web/c.js', 'c1'); t.on({ kind: 'tool_result', id: 'w2' });
  t.on({ kind: 'tool', name: 'Bash', id: 'b1' }); put('web/c.js', 'c2-by-agent-shell'); put('review/x.json', '{"ok":1}'); t.on({ kind: 'tool_result', id: 'b1' });
  // 4. 只有你改的檔（代理沒碰）：列為「其他」，不是併改；app 自己的 .studio/ 不算
  put('README.md', 'r1-user'); put('.studio/state.json', '{"x":1}');
  const r = t.finish();
  assert.deepEqual(r.conflicts, ['web/a.js', 'web/b.js', 'web/d.js']);
  assert.deepEqual(r.others, ['README.md']);
  assert.deepEqual(r.touched, ['web/a.js', 'web/b.js', 'web/c.js', 'web/d.js']);
}));

test('併改偵測：事件比寫檔晚到（假代理、Codex 的 file_change）與沒收到結束事件時，都算代理的；Codex 的指令區間也算代理的', () => temp(async dir => {
  const f = p => join(dir, p), put = (p, s) => { mkdirSync(join(f(p), '..'), { recursive: true }); writeFileSync(f(p), s); };
  put('web/a.js', 'a0'); put('web/b.js', 'b0'); put('web/e.js', 'e0');
  const t = repoGit.createEditTracker(dir);
  // 輸出讀得慢：代理已經寫了 a 和 e，才處理到寫 a 的事件（查核點看到 e 變了），接著才是寫 e 的事件
  put('web/a.js', 'a1'); put('web/e.js', 'e1');
  t.on({ kind: 'tool', name: 'Write', id: 't', paths: [f('web/a.js')] });          // 先寫才送事件、沒有 tool_result（假代理）
  t.on({ kind: 'tool', name: 'Edit', id: 'te', paths: [f('web/e.js')] }); t.on({ kind: 'tool_result', id: 'te', ok: true });
  put('web/b.js', 'b1'); t.on({ kind: 'tool', name: 'edit', id: 'fc1', paths: ['web/b.js'], done: true });  // Codex：改完才送、相對路徑
  t.on({ kind: 'tool', name: 'shell', id: 'c1' }); put('web/b.js', 'b2'); t.on({ kind: 'tool_result', id: 'c1' });
  t.on({ kind: 'tool', name: 'Write', id: 'out', paths: [join(dir, '..', 'outside.txt')] });                 // 站外的路徑不追蹤
  assert.deepEqual(t.finish(), { conflicts: [], others: [], touched: ['web/a.js', 'web/b.js', 'web/e.js'] });
}));

test('介面卡的事件帶併改偵測要的 id 與 paths（Claude 的 tool_use／tool_result、Codex 的 command_execution／file_change）', () => {
  const [tool] = claude.parse({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: 'D:/x/web/a.js' } }] } });
  assert.deepEqual([tool.id, tool.paths], ['toolu_1', ['D:/x/web/a.js']]);
  const [bash] = claude.parse({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'node x' } }] } });
  assert.deepEqual([bash.id, bash.paths], ['toolu_2', undefined]);
  assert.equal(claude.parse({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] } })[0].id, 'toolu_1');
  assert.equal(codex.parse({ type: 'item.started', item: { id: 'item_3', type: 'command_execution', command: 'ls' } })[0].id, 'item_3');
  assert.equal(codex.parse({ type: 'item.completed', item: { id: 'item_3', type: 'command_execution', exit_code: 0, aggregated_output: '' } })[0].id, 'item_3');
  const [fc] = codex.parse({ type: 'item.completed', item: { id: 'item_4', type: 'file_change', changes: [{ kind: 'update', path: 'web/a.js' }, { kind: 'add', path: 'web/b.js' }] } });
  assert.deepEqual([fc.paths, fc.done], [['web/a.js', 'web/b.js'], true]);
});
