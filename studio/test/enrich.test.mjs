// 元件補全（評估平台 Q5）：結果驗證、工作的狀態、逐欄採用（升版、來源、C 級價格、下載附件）、命令列；代理換成 test/fake-agent.mjs。
//   node --test studio/test/enrich.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { openPartsDb } from '../lib/partsdb.mjs';
import { validateResult, runEnrichJob, jobDir } from '../lib/enrich.mjs';
import { ADAPTERS } from '../lib/adapters/index.mjs';
import { claude } from '../lib/adapters/claude.mjs';
import { codex } from '../lib/adapters/codex.mjs';
import { adapters as fakeAdapters } from './fake-adapters.mjs';
import { STUDIO } from '../lib/util.mjs';

Object.assign(ADAPTERS, fakeAdapters);
const camCategory = db => db.categories.tree().nodes.find(n => n.name === '視覺').children.find(c => c.name === '相機與讀碼').id;

test('驗證代理的結果：單位去掉、沒有來源與型別不對的標出來、和目前相同的標 same、指定欄位以外的標 extra', () => {
  const db = openPartsDb(':memory:');
  const part = db.getPart(db.createPart({ name: '5MP 相機', brand: '示範廠', category_id: camCategory(db), attrs: { 介面: 'GigE' } }).id);
  const src = 'https://example.com/a';
  const r = validateResult({
    fields: { brand: { value: '示範廠', source: src }, model: { value: 'X1', source: 'ftp://x' }, name: { value: '改名', source: src } },
    attrs: { 像素尺寸: { value: '3.45 µm', source: src, confidence: 'sure' }, 幀率: { value: '1,000', source: src }, 水平像素: { value: '很多', source: src }, 介面: { value: 'GigE', source: src }, 重量: { value: '90 g', source: src } },
    price: { value: '-5', source: src }, files: [{ url: 'https://example.com/d.pdf', kind: 'datasheet' }, { url: 'nope', kind: 'zzz' }],
  }, part, ['像素尺寸']);
  const by = k => r.items.find(x => x.key === k);
  assert.equal(by('name'), undefined, '名稱不讓代理改');
  assert.equal(by('brand').same, true);
  assert.equal(by('model').error, '沒有來源網址');
  assert.equal(by('attrs.像素尺寸').value, '3.45'); assert.equal(by('attrs.像素尺寸').unit, 'µm'); assert.equal(by('attrs.像素尺寸').confidence, 'medium', '不認得的信心度用中');
  assert.equal(by('attrs.幀率').value, '1000');
  assert.match(by('attrs.水平像素').error, /數字/);
  assert.equal(by('attrs.介面').same, true);
  assert.equal(by('attrs.重量').value, '90 g', '範本沒有的欄位是文字，原樣保留');
  assert.equal(by('attrs.像素尺寸').extra, undefined); assert.equal(by('attrs.幀率').extra, true, '這次只查像素尺寸');
  assert.match(r.price.error, /正數/);
  assert.equal(r.files[0].error, undefined); assert.equal(r.files[1].error, '網址格式不對'); assert.equal(r.files[1].kind, 'other');
  db.close();
});

test('工作的流程：建立 → 假代理查詢 → 待審核 → 逐欄採用（升版、來源、C 級價格、下載附件；下載失敗只記錄）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vs3d-enrich-')), file = join(dir, 'studio.db');
  const http = createServer((req, res) => {
    if (req.url === '/ds.pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end('%PDF-1.4 demo'); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise(r => http.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${http.address().port}`;
  process.env.FAKE_ENRICH_FILE = `${base}/ds.pdf`;
  const db = openPartsDb(file);
  try {
    const p = db.createPart({ name: '5MP 相機', category_id: camCategory(db) });
    const job = db.enrich.create(p.code, { fields: '', by: 'kevin' });
    assert.equal(job.status, 'queued');
    assert.throws(() => db.enrich.create(p.id), /已經有補全工作/);
    const logs = [], done = await runEnrichJob(db, job.id, { rc: { cli: 'fake' }, log: s => logs.push(s) });
    assert.equal(done.status, 'review', done.error);
    assert.ok(existsSync(join(jobDir(file, job.id), 'part.json')) && existsSync(join(jobDir(file, job.id), 'task.md')));
    assert.equal(JSON.parse(readFileSync(join(jobDir(file, job.id), 'part.json'), 'utf8')).template.some(f => f.key === '像素尺寸'), true, '給代理的資料含欄位範本');
    const items = Object.fromEntries(done.result.items.map(x => [x.key, x]));
    assert.equal(items['attrs.像素尺寸'].value, '3.45');
    assert.equal(items.model.error, '沒有來源網址');
    assert.match(items['attrs.幀率'].error, /數字/);
    assert.equal(done.result.files.length, 1);
    assert.equal(db.enrich.list({ status: 'review' }).length, 1);

    await assert.rejects(() => db.enrich.accept(job.id, { keys: ['model'] }), /不能採用/);
    const before = db.getPart(p.id).version;
    const r = await db.enrich.accept(job.id, { keys: ['brand', 'attrs.像素尺寸', 'attrs.介面'], price: true, files: [0, 3], by: 'kevin' });
    assert.equal(r.part.brand, '示範廠'); assert.equal(r.part.attrs.像素尺寸, '3.45'); assert.equal(r.part.attrs.介面, 'GigE');
    assert.equal(r.part.version, before + 1, '欄位一次寫進去，只升一版');
    assert.equal(r.part.prices[0].grade, 'C'); assert.equal(r.part.prices[0].unit_price, 21000); assert.match(r.part.prices[0].source, /^網路查詢 https:\/\/example.com/);
    assert.equal(r.part.files.length, 1); assert.equal(r.part.files[0].kind, 'datasheet'); assert.match(r.part.files[0].name, /\.pdf$/);
    assert.deepEqual(r.job.applied.keys.sort(), ['attrs.介面', 'attrs.像素尺寸', 'brand']);
    assert.equal(r.job.applied.errors.length, 1, '不存在的檔案序號記成錯誤，不影響其他');
    const src = db.enrich.sources(p.id);
    assert.equal(src.length, 4, '三個欄位＋價格都記下來源');
    assert.ok(src.every(s => s.url.startsWith('https://example.com') && s.accepted_by === 'kevin' && s.job_id === job.id));
    assert.equal(src.find(s => s.field === 'brand').version, before + 1);
    await assert.rejects(() => db.enrich.accept(job.id, { keys: [] }), /只有待審核/);
    assert.throws(() => db.enrich.dismiss(job.id), /已經採用/);

    // 下載失敗（404）只記錄；放棄；佇列中斷時改成失敗
    const j2 = db.enrich.create(p.id); await runEnrichJob(db, j2.id, { rc: { cli: 'fake' }, log: () => {} });
    const r2 = await db.enrich.accept(j2.id, { keys: [], files: [0] }, { download: async () => { throw new Error('下載失敗（HTTP 404）'); } });
    assert.deepEqual(r2.job.applied.errors, ['規格書：下載失敗（HTTP 404）']);
    const j3 = db.enrich.create(p.id);
    assert.equal(db.enrich.failStale(p.code), 1); assert.equal(db.enrich.get(j3.id).status, 'failed');
    const j4 = db.enrich.create(p.id); assert.equal(db.enrich.dismiss(j4.id, 'kevin').status, 'dismissed');
    // 代理沒寫 result.json：失敗
    const j5 = db.enrich.create(p.id), orig = fakeAdapters.fake.command;
    ADAPTERS.fake = { ...fakeAdapters.fake, command: () => ({ cmd: process.execPath, args: ['-e', 'process.stdout.write(JSON.stringify({type:"result",subtype:"success",result:"找不到"})+"\\n")'], input: '', env: {} }) };
    const f5 = await runEnrichJob(db, j5.id, { rc: { cli: 'fake' }, log: () => {} });
    ADAPTERS.fake = { ...fakeAdapters.fake, command: orig };
    assert.equal(f5.status, 'failed'); assert.match(f5.error, /沒有寫出 result.json/);
  } finally {
    delete process.env.FAKE_ENRICH_FILE; db.close(); http.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('只有元件補全可以上網：Claude 的工具清單換成讀寫檔＋上網（沒有 shell），Codex 加 --search', () => {
  const tools = { allow: ['Read', 'Write', 'WebSearch', 'WebFetch'], deny: ['Bash'] };
  const a = claude.command({ prompt: 'x', tools }).args, b = claude.command({ prompt: 'x' }).args;
  const after = (args, flag) => args.slice(args.indexOf(flag) + 1, args.findIndex((x, i) => i > args.indexOf(flag) && x.startsWith('--')) >>> 0);
  assert.ok(after(a, '--allowedTools').includes('WebSearch')); assert.deepEqual(after(a, '--disallowedTools'), ['Bash']);
  assert.ok(after(b, '--disallowedTools').includes('WebSearch'), '其他角色照舊禁止上網');
  const c = codex.command({ prompt: 'x', search: true }).args, d = codex.command({ prompt: 'x' }).args;
  assert.ok(c.indexOf('--search') >= 0 && c.indexOf('--search') < c.indexOf('exec'), '--search 是 codex 的全域選項，要放在 exec 前面');
  assert.equal(d.includes('--search'), false);
});

test('命令列：vs3d enrich <元件> 建立並執行、show、accept --all', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vs3d-enrich-cli-')), file = join(dir, 'studio.db');
  try {
    const db = openPartsDb(file); const p = db.createPart({ name: '5MP 相機', category_id: camCategory(db) }); db.close();
    const vs3d = (...args) => spawnSync(process.execPath, [join(STUDIO, 'vs3d.mjs'), ...args, '--db', file, '--workspace', dir], { encoding: 'utf8', env: { ...process.env, VS3D_EXTRA_ADAPTERS: join(STUDIO, 'test', 'fake-adapters.mjs') } });
    const run = vs3d('enrich', p.code, '--cli', 'fake');
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.match(run.stdout, /\+ attrs\.像素尺寸：3\.45 µm/); assert.match(run.stdout, /✗ model：DEMO-5MP.*沒有來源網址/);
    const acc = vs3d('enrich', 'accept', '1', '--all', '--price');
    assert.equal(acc.status, 0, acc.stderr + acc.stdout);
    assert.match(acc.stdout, /採用 3 個欄位、1 筆價格/);
    assert.match(vs3d('enrich', 'list').stdout, /#1 P-00001 5MP 相機｜已採用/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
