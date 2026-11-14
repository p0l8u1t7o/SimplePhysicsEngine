// 代理的 skills（2026-11-14，E 項）：API 金鑰模式的代理用 studio/data/agent-home/<cli> 當設定目錄，讀不到使用者的 skills；
//   每次執行前把白名單（系統設定 skills.list）裡的 skill 從使用者的 ~/.claude/skills（含 synced/ 底下同步來的）複製到 <設定目錄>/skills/。
//   只管自己複製過去的（.vs3d-managed.json 記名單），白名單拿掉的會刪掉；設定目錄裡別人放的不動。
//   訂閱帳號模式的 Claude 本來就用使用者自己的 ~/.claude（全部 skills 都在），不必同步；使用者自己的 ~/.codex 不動。
import { existsSync, readdirSync, statSync, cpSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readJson, writeJson } from './util.mjs';

// 開發機預設給常用的；部署版預設只給公司自己的（Anthropic 同步來的 skill 由管理者決定要不要加）
export const DEFAULT_SKILLS = { dev: ['zq-work-deck', 'coding-action', 'pptx', 'xlsx', 'docx', 'pdf'], deploy: ['zq-work-deck', 'coding-action'] };
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isSkill = d => existsSync(join(d, 'SKILL.md'));

// 使用者有哪些 skill：{ 名稱: 資料夾 }（synced/ 底下有好幾份時取 SKILL.md 最新的）
export function availableSkills(root = process.env.VS3D_SKILLS_SOURCE || join(homedir(), '.claude', 'skills')) {
  const out = {}, mt = d => statSync(join(d, 'SKILL.md')).mtimeMs;
  const consider = (name, d) => { if (SKILL_NAME_RE.test(name) && isSkill(d) && (!out[name] || mt(d) > mt(out[name]))) out[name] = d; };
  if (!existsSync(root)) return out;
  for (const n of readdirSync(root)) {
    const d = join(root, n);
    try { if (!statSync(d).isDirectory()) continue; } catch { continue; }
    if (n === 'synced') { for (const acct of readdirSync(d)) { const a = join(d, acct); try { if (statSync(a).isDirectory()) for (const s of readdirSync(a)) consider(s, join(a, s)); } catch { /* 略過 */ } } }
    else consider(n, d);
  }
  return out;
}

// 同步到 <home>/skills/；回傳 { copied, removed, missing }
export function syncSkills(home, names = [], { available = availableSkills() } = {}) {
  const dir = join(home, 'skills'), manifest = join(dir, '.vs3d-managed.json'), prev = readJson(manifest, []);
  mkdirSync(dir, { recursive: true });
  const want = [...new Set(names)].filter(n => SKILL_NAME_RE.test(n)), out = { copied: [], removed: [], missing: [] };
  for (const n of prev.filter(n => !want.includes(n))) { rmSync(join(dir, n), { recursive: true, force: true }); out.removed.push(n); }
  for (const n of want) {
    if (!available[n]) { out.missing.push(n); continue; }
    rmSync(join(dir, n), { recursive: true, force: true });
    cpSync(available[n], join(dir, n), { recursive: true, filter: s => !/[\\/](__pycache__|\.git)([\\/]|$)/.test(s) });
    out.copied.push(n);
  }
  writeJson(manifest, out.copied);
  return out;
}
