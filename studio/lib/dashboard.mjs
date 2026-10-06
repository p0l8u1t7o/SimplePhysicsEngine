// 儀表板首頁的彙整：代理執行統計（各專案 .studio/rounds.jsonl）、檢查結果（core check 寫出的 TEMP/check-*.json）。只讀檔，不改任何東西。
import { existsSync, readFileSync } from 'node:fs';

const day = d => new Date(d).toLocaleDateString('sv');      // 本地日期 YYYY-MM-DD

// 每輪紀錄；壞掉的列略過（檔案可能正在被寫入）
export function readRounds(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
}

// list：[{ id, title, rounds }]。回傳合計、各角色（依 CLI 分開）、最近 days 天每天的耗時、最近幾輪
export function agentStats(list, { days = 14, today = new Date(), recent = 8 } = {}) {
  const runs = list.flatMap(p => p.rounds.filter(r => r.role).map(r => ({ ...r, id: p.id, title: p.title })));
  const totals = { rounds: runs.length, seconds: 0, failed: 0, violations: 0, costUsd: 0, projects: new Set(runs.map(r => r.id)).size };
  const roles = new Map(), clis = new Set();
  for (const r of runs) {
    totals.seconds += r.seconds || 0; totals.costUsd += r.costUsd || 0; totals.violations += r.violations?.length || 0; if (!r.ok) totals.failed++;
    const cli = r.cli || '其他'; clis.add(cli);
    const row = roles.get(r.role) || roles.set(r.role, { role: r.role, rounds: 0, seconds: 0, failed: 0, byCli: {} }).get(r.role);
    row.rounds++; row.seconds += r.seconds || 0; if (!r.ok) row.failed++;
    const c = row.byCli[cli] ||= { rounds: 0, seconds: 0 }; c.rounds++; c.seconds += r.seconds || 0;
  }
  const daily = Array.from({ length: days }, (_, i) => ({ day: day(new Date(today).setDate(new Date(today).getDate() - (days - 1 - i))), rounds: 0, seconds: 0 }));
  const at = Object.fromEntries(daily.map(d => [d.day, d]));
  for (const r of runs) { const d = r.startedAt && at[day(r.startedAt)]; if (d) { d.rounds++; d.seconds += r.seconds || 0; } }
  const last = runs.filter(r => r.startedAt).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, recent)
    .map(r => ({ id: r.id, title: r.title, round: r.round, role: r.role, cli: r.cli, model: r.model || '', seconds: r.seconds || 0, ok: !!r.ok, at: new Date(r.startedAt).toISOString(), violations: r.violations?.length || 0, by: r.by || '' }));
  // 依啟動的人（代理佇列記下的帳號；命令列或沒有帳號時是空字串）
  const users = new Map();
  for (const r of runs) { const u = users.get(r.by || '') || users.set(r.by || '', { user: r.by || '', rounds: 0, seconds: 0, costUsd: 0 }).get(r.by || ''); u.rounds++; u.seconds += r.seconds || 0; u.costUsd += r.costUsd || 0; }
  return { totals, clis: [...clis].sort(), byRole: [...roles.values()], byUser: [...users.values()].sort((a, b) => b.seconds - a.seconds), daily, recent: last };
}

// files：core check 寫出的結果檔內容 [{ at, quick, results: [{ project, check, ok, note }] }]（快速與完整各一份，可能只跑了部分專案）。
// 同一個專案的同一項檢查取最新的那次；回傳 { 專案: { at, passed, failed, failures: [{ check, note }] } }
export function checkStats(files) {
  const latest = new Map();
  for (const f of [...files].sort((a, b) => String(a.at).localeCompare(String(b.at)))) for (const r of f.results || []) latest.set(`${r.project}\n${r.check}`, { ...r, at: f.at });
  const out = {};
  for (const r of latest.values()) {
    const s = out[r.project] ||= { at: r.at, passed: 0, failed: 0, failures: [] };
    if (r.at > s.at) s.at = r.at;
    if (r.ok) s.passed++; else { s.failed++; s.failures.push({ check: r.check, note: r.note || '' }); }
  }
  return out;
}
