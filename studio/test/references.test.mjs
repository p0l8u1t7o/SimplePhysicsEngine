// 參考站（lib/references.mjs）與讀取限制（guard.mjs 的 VS3D_NOREAD）的單元測試：不跑代理、不跑檢查。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { tokens, rankStations, pickReferences, prepareReferences, listStations, snapshotRefs, diffRefs } from '../lib/references.mjs';
import { claude } from '../lib/adapters/claude.mjs';
import { STUDIO } from '../lib/util.mjs';

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'vs3d-refu-'));
  const st = (name, title, summary, body) => {
    const d = join(root, 'project-site', name);
    mkdirSync(join(d, 'web', 'js'), { recursive: true }); mkdirSync(join(d, 'docs'), { recursive: true }); mkdirSync(join(d, 'TEMP'), { recursive: true });
    writeFileSync(join(d, 'project.json'), JSON.stringify({ title, summary }));
    writeFileSync(join(d, 'AGENTS.md'), `# ${title}\n\n${body}\n`);
    writeFileSync(join(d, 'README.md'), `# ${title}\n\n規格摘要\n`);
    writeFileSync(join(d, 'web', 'js', 'project.js'), '// x\n');
    writeFileSync(join(d, 'docs', 'spec.txt'), '本機');
    writeFileSync(join(d, 'TEMP', 'x.txt'), '暫存');
  };
  st('Bravo', '手臂壓合', '手臂把接頭壓進外殼', 'DENSO 手臂');
  st('Alpha', '輸送分揀', '輸送帶加相機分揀回收物', '輸送帶、相機、分揀氣缸');
  st('Charlie', '輸送檢測', '輸送帶加相機檢測外觀', '輸送帶、相機、光源');
  mkdirSync(join(root, 'project-site', 'NoJson'), { recursive: true });       // 沒有 project.json 的資料夾不算站
  return root;
}
const project = (root, text, extra = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'vs3d-refp-')), studio = join(dir, '.studio');
  mkdirSync(join(studio, 'plan'), { recursive: true });
  writeFileSync(join(dir, 'AGENTS.md'), text);
  return { id: 'P', dir, repo: false, agents: join(dir, 'AGENTS.md'), plan: join(studio, 'plan'), studio, ...extra };
};

test('關鍵字：中文兩字詞、英數單字（3 個字元以上、小寫）', () => {
  assert.deepEqual([...tokens('輸送帶 GigE ab 相')].sort(), ['gige', '輸送', '送帶'].sort());
});

test('自動挑選：依共有關鍵字加權、同分依名稱、決定性；每站都有的字不算', () => {
  const root = repo(), J = project(root, '# 回收物分揀\n\n輸送帶上方用相機辨識回收物，氣缸分揀');
  try {
    assert.deepEqual(listStations(root).map(s => s.name), ['Alpha', 'Bravo', 'Charlie']);
    const a = pickReferences({ root, J }), b = pickReferences({ root, J });
    assert.equal(a.how, 'auto');
    assert.deepEqual(a.list.map(s => s.name), ['Alpha', 'Charlie']);
    assert.deepEqual(b.list.map(s => s.name), a.list.map(s => s.name));
    // 同分依名稱：兩站內容相同時名稱小的在前
    const r = rankStations('輸送帶', [{ name: 'Z', text: '輸送帶' }, { name: 'A', text: '輸送帶' }, { name: 'M', text: '手臂' }]);
    assert.deepEqual(r.map(x => x.name), ['A', 'Z', 'M']);
    assert.equal(r[2].score, 0);
    // 每站都有的字（df = N）權重為 0
    assert.equal(rankStations('輸送', [{ name: 'A', text: '輸送' }, { name: 'B', text: '輸送' }])[0].score, 0);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(J.dir, { recursive: true, force: true }); }
});

test('指定與關閉：studio.json 的 references；本庫模式不挑自己', () => {
  const root = repo(), J = project(root, '輸送帶相機');
  try {
    assert.deepEqual(pickReferences({ root, J, studioJson: { references: ['Bravo', 'Nope'] } }), { list: pickReferences({ root, J, studioJson: { references: ['Bravo'] } }).list, how: 'set', unknown: ['Nope'] });
    assert.equal(pickReferences({ root, J, studioJson: { references: [] } }).how, 'off');
    assert.equal(pickReferences({ root, J, studioJson: { references: false } }).how, 'off');
    assert.equal(pickReferences({ root, J, enabled: false }).how, 'off');
    assert.equal(pickReferences({ root: null, J }).list.length, 0);
    const self = { ...J, repo: true, id: 'Alpha' };
    assert.ok(!pickReferences({ root, J: self }).list.some(s => s.name === 'Alpha'));
    assert.ok(!pickReferences({ root, J: self, studioJson: { references: ['Alpha'] } }).list.length);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(J.dir, { recursive: true, force: true }); }
});

test('規格摘要複製到 .studio/references/、不帶 docs 與 TEMP；參考站被改會被偵測', () => {
  const root = repo(), J = project(root, '輸送帶相機'), ws = mkdtempSync(join(tmpdir(), 'vs3d-refw-'));
  try {
    const { list } = pickReferences({ root, J, studioJson: { references: ['Alpha'] } });
    const refs = prepareReferences(ws, J, list, root), site = join(root, 'project-site', 'Alpha');
    assert.equal(refs[0].web, join(site, 'web'));
    assert.deepEqual(refs[0].docs, ['.studio/references/Alpha/AGENTS.md', '.studio/references/Alpha/README.md']);
    assert.deepEqual(refs[0].noRead, ['docs', '.studio', 'TEMP'].map(d => join(site, d)));
    assert.match(readFileSync(join(J.studio, 'references', 'Alpha', 'AGENTS.md'), 'utf8'), /輸送分揀/);
    assert.ok(!existsSync(join(J.studio, 'references', 'Alpha', 'docs')));
    const snap = snapshotRefs(refs);
    assert.deepEqual(Object.keys(snap.Alpha).sort(), ['AGENTS.md', 'README.md', 'project.json', 'web/js/project.js']);
    writeFileSync(join(site, 'docs', 'spec.txt'), '改了也不管（本機資料）');
    assert.deepEqual(diffRefs(refs, snap), []);
    writeFileSync(join(site, 'web', 'js', 'project.js'), '// 被改了\n');
    assert.deepEqual(diffRefs(refs, snap).map(v => `${v.area}:${v.path}:${v.change}`), ['參考站 Alpha:web/js/project.js:modified']);
    prepareReferences(ws, J, [], root);                                         // 不用參考站時清掉舊的複本
    assert.ok(!existsSync(join(J.studio, 'references')));
  } finally { for (const d of [root, J.dir, ws]) rmSync(d, { recursive: true, force: true }); }
});

test('讀取限制：VS3D_NOREAD 的資料夾不能 Read／Glob／Grep，搜尋範圍包含它也擋；Claude 指令只在有限制時掛上讀取關卡', () => {
  const guard = join(STUDIO, 'lib', 'guard.mjs'), root = process.platform === 'win32' ? 'D:\\vs3d-guard-test' : '/vs3d-guard-test';
  const site = join(root, 'project-site', 'A'), noRead = [join(site, 'docs')];
  const call = (tool_name, tool_input, cwd = join(root, 'proj')) => {
    const r = spawnSync(process.execPath, [guard], { input: JSON.stringify({ cwd, tool_name, tool_input }), env: { ...process.env, VS3D_ALLOW: '[]', VS3D_NOREAD: JSON.stringify(noRead) }, encoding: 'utf8' });
    return r.stdout.includes('"deny"') ? 'deny' : 'allow';
  };
  assert.equal(call('Read', { file_path: join(site, 'web', 'js', 'main.js') }), 'allow');
  assert.equal(call('Read', { file_path: join(site, 'docs', 'spec.pdf') }), 'deny');
  assert.equal(call('Glob', { pattern: '**/*.js', path: join(site, 'web') }), 'allow');
  assert.equal(call('Glob', { pattern: 'docs/**', path: site }), 'deny');
  assert.equal(call('Glob', { pattern: '**/*', path: join(root, 'project-site') }), 'deny');     // 範圍包含 docs
  assert.equal(call('Grep', { pattern: 'docs', path: join(site, 'web') }), 'allow');              // pattern 是正規表示式，不是路徑
  assert.equal(call('Grep', { pattern: 'x', path: site }), 'deny');
  assert.equal(call('Grep', { pattern: 'x' }), 'allow');                                             // 預設是工作目錄
  assert.equal(call('Write', { file_path: join(site, 'docs', 'x') }), 'allow');                     // 寫入照原本的規則（VS3D_ALLOW 空＝不限制）

  const plain = claude.command({ prompt: 'p' }), hooks = c => JSON.parse(c.args[c.args.indexOf('--settings') + 1]).hooks.PreToolUse.map(h => h.matcher);
  assert.deepEqual(hooks(plain), ['Write|Edit|MultiEdit|NotebookEdit']);
  const c = claude.command({ prompt: 'p', readDirs: ['/core', '/site/web'], denyRead: ['/site/docs'] });
  assert.deepEqual(hooks(c), ['Write|Edit|MultiEdit|NotebookEdit', 'Read|Glob|Grep']);
  assert.deepEqual(JSON.parse(c.env.VS3D_NOREAD), ['/site/docs']);
  assert.deepEqual(c.args.flatMap((a, i) => a === '--add-dir' ? [c.args[i + 1]] : []), ['/core', '/site/web']);
});
