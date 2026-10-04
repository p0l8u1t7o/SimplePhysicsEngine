// 專案交接包（換人接手）：vs3d handoff 匯出、vs3d import 匯入。
// 內容：handoff.json（說明）＋repo.bundle（專案 git 全部歷史）＋docs/（上傳檔與抽取結果）＋studio/（.studio 的狀態、提問、回答、
//       提案、審查、每輪紀錄；不含代理的完整對話記錄 logs/）＋client-names.txt（這個專案用得到的不得顯示名稱）。
// 匯入後代理的工作階段（session id）屬於原本那台電腦，會清掉；階段、拍板、提問都保留，對方可以直接 vs3d resume。
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { projectPaths, readClientNames, addClientNames, paths, readProjectNames } from './workspace.mjs';
import { git, readJson, writeJson, now } from './util.mjs';

// zip 用工作區 core 的 tools/zip.mjs（core 1.6.0 起）
const zipLib = async ws => {
  const f = join(paths(ws).core, 'tools', 'zip.mjs');
  if (!existsSync(f)) throw new Error('工作區的 core 太舊，沒有 zip 工具：先執行 vs3d init --refresh-core');
  return import(pathToFileURL(f).href);
};
const TEXT = /\.(md|txt|json|csv|html?)$/i;

function walk(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) { const f = join(dir, n); statSync(f).isDirectory() ? walk(f, base, out) : out.push(f); }
  return out;
}

// 這個專案用得到的名稱：專案名單（建立時的 --private、規劃角色列出的）＋工作區名單中出現在本專案上傳資料與紀錄裡的（不把其他專案的用戶名稱帶出去）
function projectNames(ws, J) {
  const own = existsSync(join(J.plan, 'client-names.txt')) ? readFileSync(join(J.plan, 'client-names.txt'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')) : [];
  const texts = [...walk(J.docs), J.agents, ...walk(J.studio).filter(f => !f.includes(join('.studio', 'logs')))].filter(f => TEXT.test(f) && existsSync(f)).map(f => readFileSync(f, 'utf8'));
  return [...new Set([...own, ...readProjectNames(J), ...readClientNames(ws).filter(n => texts.some(t => t.includes(n)))])];
}

export async function exportHandoff(ws, id, outFile, { log = console.log } = {}) {
  const J = projectPaths(ws, id);
  if (!existsSync(J.dir)) throw new Error(`找不到專案：${id}`);
  const { writeZip, dirEntries } = await zipLib(ws);
  if (git(J.dir, ['status', '--porcelain']).trim()) { git(J.dir, ['add', '-A']); git(J.dir, ['-c', 'user.name=vs3d', '-c', 'user.email=vs3d@localhost', 'commit', '-qm', 'Before handoff']); }
  const tmp = join(tmpdir(), `vs3d-handoff-${process.pid}-${Date.now()}.bundle`);
  try {
    git(J.dir, ['bundle', 'create', tmp, '--all']);
    const state = readJson(J.state, {}), names = projectNames(ws, J), pj = readJson(join(J.dir, 'project.json'), {});
    const meta = { format: 'vs3d-handoff', version: 1, id, title: pj.title || id, created: now(), core: readFileSync(join(paths(ws).core, 'VERSION'), 'utf8').trim(),
      stage: state.stage || 'plan', segment: state.segment || 1, rounds: state.round || 0, head: git(J.dir, ['rev-parse', 'HEAD']).trim(), names: names.length };
    const entries = [
      { name: 'handoff.json', data: JSON.stringify(meta, null, 2) + '\n' },
      { name: 'repo.bundle', data: readFileSync(tmp) },
      { name: 'client-names.txt', data: ['# 不得顯示的用戶名稱（匯入時加進工作區名單）', ...names].join('\n') + '\n' },
      ...dirEntries(J.docs, { prefix: 'docs' }),
      ...dirEntries(J.studio, { prefix: 'studio', filter: rel => !/^logs(\/|$)/.test(rel) && rel !== 'run.lock' }),
    ];
    const r = writeZip(outFile, entries);
    log(`✓ 交接包：${outFile}（${(r.bytes / 1048576).toFixed(1)} MB；階段 ${meta.segment === 2 ? '第二段 ' : ''}${meta.stage}、${meta.rounds} 輪、不得顯示的名稱 ${names.length} 個）`);
    return { file: outFile, ...meta };
  } finally { rmSync(tmp, { force: true }); }
}

export async function importHandoff(ws, file, { id: newId, log = console.log } = {}) {
  const { readZip } = await zipLib(ws);
  const entries = readZip(file), get = n => entries.find(e => e.name === n);
  const meta = JSON.parse(get('handoff.json')?.data.toString('utf8') || 'null');
  if (meta?.format !== 'vs3d-handoff') throw new Error('不是 vs3d 交接包（缺少 handoff.json）');
  const id = newId || meta.id, J = projectPaths(ws, id);
  if (existsSync(J.dir)) throw new Error(`專案已存在：${id}（用 --name 換一個名稱）`);
  const tmp = join(tmpdir(), `vs3d-import-${process.pid}-${Date.now()}.bundle`);
  writeFileSync(tmp, get('repo.bundle').data);
  try {
    mkdirSync(dirname(J.dir), { recursive: true });
    git(dirname(J.dir), ['clone', '-q', tmp, id]);
    git(J.dir, ['remote', 'remove', 'origin']);
    git(J.dir, ['config', 'core.autocrlf', 'false']);
  } finally { rmSync(tmp, { force: true }); }
  for (const e of entries) {
    const m = /^(docs|studio)\/(.+)$/.exec(e.name); if (!m) continue;
    const dest = join(m[1] === 'docs' ? J.docs : J.studio, ...m[2].split('/'));
    mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, e.data);
  }
  // 代理工作階段屬於原本的電腦；執行中的狀態也重設
  const s = readJson(J.state, null);
  if (s) { s.sessions = {}; s.importedFrom = { id: meta.id, at: now(), head: meta.head }; writeJson(J.state, s); }
  const names = (get('client-names.txt')?.data.toString('utf8') || '').split(/\r?\n/);
  const added = addClientNames(ws, names);
  log(`✓ 已匯入 ${id}：階段 ${meta.segment === 2 ? '第二段 ' : ''}${meta.stage}、${meta.rounds} 輪${added.length ? `；${added.length} 個不得顯示的名稱已加進工作區名單` : ''}。用 vs3d resume "${id}" 續跑。`);
  if (meta.core !== readFileSync(join(paths(ws).core, 'VERSION'), 'utf8').trim()) log(`! 交接包用 core ${meta.core}，這個工作區是 ${readFileSync(join(paths(ws).core, 'VERSION'), 'utf8').trim()}；續跑前先跑一次 vs3d check "${id}"`);
  return { ...meta, id, dir: J.dir, from: meta.id };
}
