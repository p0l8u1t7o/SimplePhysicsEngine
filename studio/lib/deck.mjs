// 評估簡報與成本表（2026-11-14 拍板，core/SITE-RULES.md「評估簡報與成本表」）：
//   新站完成第一段後，在開發機上把可行性評估與成本分析寫到站的 docs/assessment/（不進版控）：
//     <站>-評估簡報-<日期>.pptx   公司簡報樣板（zqdeck，Python＋python-pptx），內容由資料庫的提案、可行性分析、成本表、AOI 方案與 3D 截圖組成
//     <站>-成本表-<日期>.xlsx     和介面「成本表」分頁匯出的相同（cost-xlsx.mjs）
//   部署版維持 2026-10-06 的拍板：下載時才產生、不留在主機（呼叫端判斷，這裡只負責產生）。
//   公司樣板只留本機、不進版控：VS3D_DECK_KIT 指定的資料夾，或 ~/.claude/skills 底下的 zq-work-deck
//   （裡面要有 assets/template.pptx 與 scripts/zqdeck.py）；找不到就只產生 xlsx 並回報原因。
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { STUDIO, readJson } from './util.mjs';
import { reportData } from './report.mjs';
import { costWorkbook } from './cost-xlsx.mjs';
import { redactNames, readClientNames, readProjectNames } from './workspace.mjs';
import { componentsOf } from './assess.mjs';

const KIT_OK = d => d && existsSync(join(d, 'assets', 'template.pptx')) && existsSync(join(d, 'scripts', 'zqdeck.py'));
// 公司樣板的位置；找不到回傳 null
export function findDeckKit(env = process.env) {
  if (env.VS3D_DECK_KIT) return KIT_OK(env.VS3D_DECK_KIT) ? env.VS3D_DECK_KIT : null;
  const root = join(homedir(), '.claude', 'skills'), found = [];
  const walk = (d, depth) => {
    if (depth > 4 || !existsSync(d)) return;
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      try { if (!statSync(f).isDirectory()) continue; } catch { continue; }
      if (n === 'zq-work-deck' && KIT_OK(f)) found.push(f); else walk(f, depth + 1);
    }
  };
  walk(root, 0);
  // 同步的 skill 可能有好幾份：取樣板最新的一份（決定性：同時間依路徑）
  return found.sort((a, b) => statSync(join(b, 'assets', 'template.pptx')).mtimeMs - statSync(join(a, 'assets', 'template.pptx')).mtimeMs || a.localeCompare(b))[0] || null;
}

// Markdown 的章節 → { 標題: [條列文字] }；拿掉粗體、行內程式碼、連結等標記（簡報不轉 Markdown）
const plain = s => String(s).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
export function mdSections(md) {
  const out = {}; let cur = null;
  for (const raw of String(md || '').split(/\r?\n/)) {
    const h = /^#{1,4}\s+(.*)$/.exec(raw);
    if (h) { cur = plain(h[1]).replace(/^\d+[.、]\s*/, ''); out[cur] = []; continue; }
    if (!cur || !raw.trim() || /^\s*\|?\s*-{3,}/.test(raw)) continue;
    if (/^\s*\|/.test(raw)) { out[cur].push(raw.split('|').slice(1, -1).map(c => plain(c)).filter(Boolean).join('：')); continue; }   // 表格列併成一行
    out[cur].push(plain(raw));
  }
  return out;
}
// 文件標題（「配置提案」「可行性分析」）不算章節，避免「配置」先撞到標題
const pick = (secs, re, n = 6) => (Object.entries(secs).find(([k]) => re.test(k) && !/提案$|可行性分析$|評估報告$/.test(k))?.[1] || []).filter(Boolean).slice(0, n);
const clip = (s, n = 70) => (s = String(s ?? '')).length > n ? s.slice(0, n - 1) + '…' : s;

// 簡報放 4 張截圖：shots.mjs 的檔名是 <視角>@<秒>.png；全景 iso 優先（取最後一張，設備都在動作中），每個視角一張
export function pickShots(paths, n = 4) {
  const byView = new Map();
  for (const p of [...paths].sort()) byView.set(basename(p, '.png').replace(/@[\d.]+$/, ''), p);      // 同一個視角留時間最晚的（依檔名排序）
  const views = [...byView.keys()].sort((a, b) => (b === 'iso') - (a === 'iso') || a.localeCompare(b));
  return views.slice(0, n).map(v => ({ path: byView.get(v), caption: v }));
}

// 給 Python 的資料（純 JSON；所有文字已遮掉用戶名稱）
export function deckData(d, { names = [] } = {}) {
  const red = s => redactNames(String(s ?? ''), names), f = d.feasibility, data = f?.data || {};
  const prop = mdSections(d.proposal?.content), feas = mdSections(f?.content);
  const b = d.bom, s = b?.summary;
  const sections = b ? [...new Set(b.lines.map(l => l.section || '（未分段）'))].map(name => {
    const ls = b.lines.filter(l => (l.section || '（未分段）') === name);
    return { name: red(name), lines: ls.length, subtotal: Math.round(ls.reduce((a, l) => a + (l.subtotal || 0), 0)) };
  }) : [];
  const out = {
    title: red(d.title), date: d.at.toISOString().slice(0, 10),
    verdict: f?.verdict || '', summary: red(data.summary || ''), conditions: (data.conditions || []).map(red),
    metrics: (data.metrics || []).map(m => ({ name: red(m.name), target: red(m.target ?? ''), estimate: red(m.estimate ?? '') })),
    cycle: data.cycle || null,
    risks: (data.risks || []).map(r => ({ risk: red(r.risk), level: red(r.level || ''), mitigation: red(r.mitigation) })),
    poc: (data.poc || []).map(p => ({ item: red(p.item), why: red(p.why || '') })),
    decisions: (data.decisions || []).map(red), assumptions: (data.assumptions || []).map(red),
    process: pick(prop, /製程|流程/).map(x => red(clip(x))), layout: pick(prop, /站位|配置/).map(x => red(clip(x))),
    equipment: pick(prop, /選型|設備/, 8).map(x => red(clip(x))), scope: pick(prop, /範圍/).map(x => red(clip(x))),
    requirement: pick(feas, /需求|指標/).map(x => red(clip(x))),
    cost: s ? { equipment: Math.round(s.equipment || 0), labor: Math.round(s.labor || 0), laborDays: s.laborDays || 0, option: Math.round(s.option || 0),
      contingency: Math.round(s.contingency || 0), total: Math.round(s.total || 0), low: Math.round(s.low || 0), high: Math.round(s.high || 0), taxed: Math.round(s.taxed || 0),
      contingencyRate: b.settings?.contingency ?? null, taxRate: b.settings?.tax ?? null, flags: s.flags || {}, sections, name: red(b.bom?.name || ''), updated: (b.bom?.updated_at || '').slice(0, 10) } : null,
    lines: b ? b.lines.map(l => ({ line: red(l.line), section: red(l.section || ''), name: red(clip(l.name, 40)), code: l.code || '', spec: red(clip([l.model, l.spec].filter(Boolean).join('｜'), 40)),
      qty: l.qty, unit: red(l.unit || ''), unit_twd: l.unit_twd == null ? null : Math.round(l.unit_twd), subtotal: Math.round(l.subtotal || 0), grade: l.grade || '' })) : [],
    aoi: (d.aoi || []).filter(a => a.status === 'chosen').map(a => ({ name: red(a.name), rows: (a.result?.results || []).filter(r => r.status !== 'info' || r.value != null).slice(0, 10)
      .map(r => ({ label: red(r.label), value: r.value == null ? '—' : `${r.value}${r.unit ? ' ' + r.unit : ''}`, status: r.status || '', note: red(clip(r.note || '', 40)) })) })),
    shots: pickShots(d.shots),
    versions: [d.proposal && `配置提案 v${d.proposal.version}`, f && `可行性分析 v${f.version}`, b && `成本表 ${red(b.bom?.name || '')}`].filter(Boolean),
  };
  return out;
}

// 專案的截圖：指定的資料夾，或 3D工作室最近一次截圖（state.shots/<站>），或 VS Code 端照 SITE-RULES 拍的 TEMP/<站>-shots/
export function projectShots(J, { shotsDir = null, state = null } = {}) {
  const cands = [shotsDir, state?.shots && join(state.shots, J.id), join(dirname(dirname(J.dir)), 'TEMP', `${J.id}-shots`, J.id), join(dirname(dirname(J.dir)), 'TEMP', `${J.id}-shots`)].filter(Boolean);
  for (const dir of cands) {
    if (!existsSync(dir)) continue;
    const pngs = readdirSync(dir).filter(f => f.endsWith('.png') && !f.endsWith('.diff.png')).sort().map(f => join(dir, f));
    if (pngs.length) return pngs;
  }
  return [];
}
// 依專案產生（命令列 vs3d assess <站> deck 與第一段完成後的自動產生共用）
export function buildProjectDeck(db, ws, J, { shotsDir = null, outDir, log = () => {} } = {}) {
  const pj = readJson(join(J.dir, 'project.json'), {}), state = readJson(J.state, {});
  return buildAssessmentDeck(db, { project: J.repo ? '@' + J.id : J.id, name: J.id, title: pj.title || J.id, components: componentsOf(readJson(J.studioJson, {})),
    shots: projectShots(J, { shotsDir, state }), outDir, names: [...new Set([...readClientNames(ws), ...readProjectNames(J)])] });
}

// 產生簡報與成本表。project：資料庫裡的專案代號（本庫的站是 @<名稱>）；outDir：輸出資料夾（站的 docs/assessment/）
//   回傳 { pptx, xlsx, warnings }；沒有任何評估資料時丟出錯誤
export function buildAssessmentDeck(db, { project, name, title, components = [], shots = [], outDir, names = [], kit = findDeckKit(), python = process.env.VS3D_PYTHON || 'python' }) {
  const d = { ...reportData(db, { project, title, components, shots }), shots };      // reportData 只留前 6 張；簡報自己挑（pickShots）
  if (!d.feasibility && !d.bom) throw new Error(`${project} 還沒有可行性分析與成本表：先寫 .studio/plan/ 的評估檔並匯入（vs3d assess <站> --repo import）`);
  mkdirSync(outDir, { recursive: true });
  const stamp = d.at.toISOString().slice(0, 10).replace(/-/g, ''), base = `${name}-${'評估簡報'}-${stamp}`, warnings = [];
  const out = { pptx: null, xlsx: null, warnings };
  if (d.bom) {
    const xlsx = join(outDir, `${name}-成本表-${stamp}.xlsx`);
    writeFileSync(xlsx, costWorkbook(d.bom, { title: redactNames(title, names) }));
    out.xlsx = xlsx;
  } else warnings.push('沒有成本表，跳過 xlsx');
  if (!d.feasibility) warnings.push('沒有可行性分析：簡報只有成本與截圖');
  if (!d.shots.length) warnings.push('沒有 3D 截圖：先跑 shots.mjs（或由 3D工作室完成檢查與截圖）再產生，簡報才有配置畫面');
  if (!kit) { warnings.push('找不到公司簡報樣板（zq-work-deck）：設環境變數 VS3D_DECK_KIT 指到含 assets/template.pptx 與 scripts/zqdeck.py 的資料夾；這次只產生 xlsx'); return out; }
  const json = join(outDir, `.${base}.json`), pptx = join(outDir, `${base}.pptx`);
  writeFileSync(json, JSON.stringify(deckData(d, { names }), null, 1));
  try {
    const r = spawnSync(python, ['-I', join(STUDIO, 'tools', 'assessment_deck.py'), kit, json, pptx], { encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    if (r.error) warnings.push(`執行 Python 失敗（${r.error.code || r.error.message}）：需要 Python 與 python-pptx（requirements.txt）；這次只產生 xlsx`);
    else if (r.status !== 0) warnings.push(`簡報產生失敗：${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`);
    else out.pptx = pptx;
  } finally { rmSync(json, { force: true }); }
  return out;
}
