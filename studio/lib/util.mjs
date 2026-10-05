// 共用小工具：路徑、JSON 讀寫、雜湊、子程序、空閒 port。
import { createHash } from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = resolve(STUDIO, '..');
export const SOURCE_CORE = join(REPO, 'core');          // P1：直接用本庫的 core 當內附版本

export const defaultWorkspace = () => process.env.VS3D_WORKSPACE || join(homedir(), 'Documents', '3D-Studio');

export const posix = p => p.split(sep).join('/');
export const rel = (from, p) => posix(relative(from, p));
export const inside = (root, p) => { const r = relative(root, p); return !r.startsWith('..') && !isAbsolute(r); };

export const readJson = (f, fallback = null) => existsSync(f) ? JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')) : fallback;
export function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); }
export function appendJsonl(f, v) { mkdirSync(dirname(f), { recursive: true }); appendFileSync(f, JSON.stringify(v) + '\n'); }
export const readText = (f, fallback = '') => existsSync(f) ? readFileSync(f, 'utf8') : fallback;
export function writeText(f, s) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, s); }

export const sha1 = buf => createHash('sha1').update(buf).digest('hex');

// 走訪資料夾（posix 相對路徑）；skip(相對路徑, 是否資料夾) 回傳 true 就略過
export function walk(root, skip = () => false, base = root, out = []) {
  if (!existsSync(root)) return out;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const f = join(root, e.name), r = rel(base, f);
    if (skip(r, e.isDirectory())) continue;
    if (e.isDirectory()) walk(f, skip, base, out); else out.push(r);
  }
  return out;
}

export function hashTree(root, skip) {
  const map = {};
  for (const r of walk(root, skip)) map[r] = sha1(readFileSync(join(root, r)));
  return map;
}

export const git = (cwd, args, opts = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

// 子程序：收集輸出，可即時轉印；回傳 { code, out }
export function run(cmd, args, { cwd, env, input, echo = false, signal } = {}) {
  return new Promise(ok => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, signal });
    let out = '';
    for (const s of [child.stdout, child.stderr]) s.on('data', d => { out += d; if (echo) process.stdout.write(d); });
    child.on('error', e => { out += String(e); });
    child.on('close', code => ok({ code, out }));
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

export const freePort = () => new Promise((ok, fail) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }).on('error', fail);
});

// ffmpeg：環境變數 FFMPEG_PATH ＞ 本庫共用的 tools/bin（scripts/setup.ps1 -Ffmpeg 下載）＞ PATH；找不到回傳 null
export function findFfmpeg() {
  const cands = [process.env.FFMPEG_PATH, join(REPO, 'tools', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')].filter(Boolean);
  for (const c of cands) if (existsSync(c)) return c;
  return spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0 ? 'ffmpeg' : null;
}

export const now = () => new Date().toISOString();
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const isDir = p => existsSync(p) && statSync(p).isDirectory();
