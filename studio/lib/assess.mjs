// 評估流程（評估平台 Q6，2026-10-06 拍板：專案組成可選「評估＋成本／3D 動畫／AOI」；評估資料只放資料庫，匯出時才產生檔案）。
//   專案組成：studio.json 的 components（沒寫的舊專案視為只有 3D）
//   規劃角色另外寫 .studio/plan/feasibility.md／feasibility.json（可行性分析）與 bom.json（BOM），平台檢查結構後
//   在提案確認時存進資料庫：assessments（提案、可行性，每次修改一版）、專案的 BOM（lib/bom.mjs；重新匯入前自動留快照）。
//   檢查（平台這一側，直接讀資料庫）：feasibility（章節、結構、節拍）、bom（市購品都引用元件、客製件只能是加工件類）、cost（只警告）。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, readText, writeJson, writeText } from './util.mjs';

export const COMPONENTS = { assess: '評估＋成本', '3d': '3D 動畫', aoi: 'AOI' };
export const DEFAULT_COMPONENTS = ['3d'];          // 沒寫 components 的舊專案
export const componentsOf = studioJson => { const c = (studioJson?.components || []).filter(x => COMPONENTS[x]); return c.length ? c : DEFAULT_COMPONENTS; };
export function cleanComponents(list) {
  const c = [...new Set((Array.isArray(list) ? list : String(list || '').split(/[,，、\s]+/)).map(s => String(s).trim().toLowerCase()).filter(Boolean))];
  const bad = c.filter(x => !COMPONENTS[x]);
  if (bad.length) throw Object.assign(new Error(`專案組成只能是 ${Object.keys(COMPONENTS).join('、')}（${Object.values(COMPONENTS).join('、')}）`), { status: 400 });
  if (!c.length) throw Object.assign(new Error('專案組成至少要選一項'), { status: 400 });
  return Object.keys(COMPONENTS).filter(k => c.includes(k));
}

export const V9_ASSESS = `
CREATE TABLE assessments (id INTEGER PRIMARY KEY, project TEXT NOT NULL, kind TEXT NOT NULL, version INTEGER NOT NULL, content TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '{}',
  verdict TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'agent', note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
  UNIQUE (project, kind, version));
CREATE INDEX assessments_project ON assessments(project, kind);
`;
export const KINDS = { proposal: '配置提案', feasibility: '可行性分析' };
export const VERDICTS = ['可行', '有條件可行', '不可行'];
// 可行性分析的章節（標題含關鍵字即可）
export const FEAS_SECTIONS = [
  ['結論', /結論/], ['需求摘要與量化指標', /需求|指標/], ['技術評估', /技術評估|子系統/], ['節拍核算', /節拍/],
  ['風險與對策', /風險/], ['POC 項目', /POC|打樣|驗證項目/i], ['需要拍板與現場確認的事', /拍板|確認/], ['假設值清單', /假設/],
];
// 客製件只能是這幾類（加工件、治具、機架、外罩、安裝與工程雜項）；市購品要引用元件或列成新元件，不能標成客製繞過元件庫
export const CUSTOM_OK = /加工|機加|治具|夾具|工裝|機架|機台|框架|底座|台架|鈑金|外罩|護罩|罩殼|圍籬|安全門|支架|固定座|機構件|銘板|配管|配線|線材|安裝|運費|運輸|包裝|試車|雜項|耗材|設計|軟體|程式|整合|教育訓練|文件|客製|自製/;
const text = v => v == null ? '' : String(v).trim();
const num = v => v === '' || v == null ? null : Number(v);
const isArr = Array.isArray;

// 可行性分析：章節與 feasibility.json 的結構；scheduleTotal（有 3D 時排程的總長，秒）給了就和 cycle.estimate 對照
export function checkFeasibility(md, data, { scheduleTotal = null } = {}) {
  const errors = [], warnings = [];
  const heads = String(md || '').split(/\r?\n/).filter(l => /^#{1,4}\s/.test(l)).map(l => l.replace(/^#+\s*/, ''));
  if (!text(md)) errors.push('沒有 feasibility.md');
  else for (const [label, re] of FEAS_SECTIONS) if (!heads.some(h => re.test(h))) errors.push(`feasibility.md 缺少章節「${label}」`);
  if (!data || typeof data !== 'object') { errors.push('沒有 feasibility.json，或不是 JSON'); return { ok: false, errors, warnings }; }
  if (!VERDICTS.includes(data.verdict)) errors.push(`verdict 要是 ${VERDICTS.join('、')} 其中之一`);
  if (!text(data.summary)) errors.push('summary（結論的一段話）是空的');
  for (const k of ['conditions', 'risks', 'poc', 'decisions', 'assumptions']) if (data[k] !== undefined && !isArr(data[k])) errors.push(`${k} 要是陣列`);
  if (data.verdict === '有條件可行' && !(data.conditions || []).length) errors.push('有條件可行要列出 conditions（關鍵條件）');
  (data.risks || []).forEach((r, i) => { if (!text(r?.risk) || !text(r?.mitigation)) errors.push(`risks 第 ${i + 1} 項要有 risk 與 mitigation`); });
  (data.poc || []).forEach((p, i) => { if (!text(p?.item)) errors.push(`poc 第 ${i + 1} 項要有 item`); });
  if (!(data.risks || []).length) warnings.push('沒有列風險');
  const c = data.cycle;
  if (c != null) {
    if (typeof c !== 'object' || (c.target != null && !Number.isFinite(num(c.target))) || (c.estimate != null && !Number.isFinite(num(c.estimate)))) errors.push('cycle 的 target、estimate 要是數字（秒）');
    else {
      if (c.target != null && c.estimate != null && num(c.estimate) > num(c.target)) warnings.push(`估算節拍 ${c.estimate} s 超過目標 ${c.target} s`);
      if (scheduleTotal != null && c.estimate != null && Math.abs(num(c.estimate) - scheduleTotal) > Math.max(0.5, scheduleTotal * 0.05))
        warnings.push(`可行性的估算節拍 ${c.estimate} s 和 3D 排程的總長 ${scheduleTotal.toFixed(2)} s 不一致（相差超過 5%）`);
    }
  }
  return { ok: !errors.length, errors, warnings };
}

// bom.json 的每一行：{ line, section, ref | name+category+規格 | custom | labor, qty, unit, estimate, grade, reason }
//   findByCode：元件庫找編號（null 時只檢查格式）
export function checkBomJson(bom, { findByCode = null } = {}) {
  const errors = [], warnings = [], items = isArr(bom?.items) ? bom.items : null;
  if (!items) return { ok: false, errors: ['bom.json 要有 items 陣列'], warnings };
  if (!items.length) errors.push('bom.json 的 items 是空的');
  const lines = new Set();
  items.forEach((it, i) => {
    const at = `第 ${i + 1} 行${text(it?.line) ? `（${text(it.line)}）` : ''}`, qty = num(it?.qty ?? 1);
    if (!it || typeof it !== 'object') { errors.push(`${at} 格式不對`); return; }
    if (text(it.line)) { if (lines.has(text(it.line))) errors.push(`${at} 的行號重複`); lines.add(text(it.line)); }
    if (!Number.isFinite(qty) || qty < 0) errors.push(`${at} 的 qty 要是 0 以上的數字`);
    if (it.estimate != null && it.estimate !== '' && (!Number.isFinite(num(it.estimate)) || num(it.estimate) < 0)) errors.push(`${at} 的 estimate 要是 0 以上的數字`);
    if (it.grade && !['A', 'B', 'C'].includes(String(it.grade).toUpperCase())) errors.push(`${at} 的 grade 只能是 A、B、C`);
    if (it.labor) { if (!['eng', 'tech'].includes(it.labor)) errors.push(`${at} 的 labor 只能是 eng（工程師）或 tech（技術員）`); if (!text(it.name)) errors.push(`${at} 的工程項目要寫 name`); return; }
    if (it.custom) {
      if (!text(it.name)) errors.push(`${at} 的客製件要寫 name`);
      else if (!CUSTOM_OK.test(`${text(it.section)} ${text(it.name)} ${text(it.spec)}`)) errors.push(`${at}「${text(it.name)}」標成客製件，但不像加工件、治具或機架；市購品要用 ref 引用元件，或列成新元件（name、category、spec）`);
      if (it.estimate == null || it.estimate === '') errors.push(`${at} 的客製件要寫 estimate（估價）`);
      return;
    }
    if (text(it.ref)) { if (findByCode && !findByCode(text(it.ref))) errors.push(`${at} 引用的元件 ${text(it.ref)} 不存在`); return; }
    // 新元件：要能建成元件（名稱、類別、規格或廠牌型號）
    if (!text(it.name) || !text(it.category) || !(text(it.spec) || text(it.model) || text(it.brand))) errors.push(`${at} 是新元件，要寫 name、category 與 spec（或 brand／model）；沿用的元件用 ref`);
    if (it.estimate == null || it.estimate === '') warnings.push(`${at}「${text(it.name)}」沒有估價，成本表會缺這一行的金額`);
  });
  return { ok: !errors.length, errors, warnings };
}

// 資料庫的部分（partsdb 呼叫）：每次存一版
export function assessOps({ all, get, insert, now, fail }) {
  const pub = r => r && { ...r, data: JSON.parse(r.data || '{}') };
  const ops = {
    save(project, kind, { content = '', data = {}, source = 'agent', note = '', by = '' } = {}) {
      if (!KINDS[kind]) fail(`評估資料只有 ${Object.keys(KINDS).join('、')}`);
      const v = (get('SELECT max(version) AS v FROM assessments WHERE project = ? AND kind = ?', String(project), kind).v || 0) + 1;
      const id = insert('assessments', { project: String(project), kind, version: v, content: String(content), data: JSON.stringify(data || {}), verdict: kind === 'feasibility' ? text(data?.verdict) : '',
        source, note: text(note), created_by: text(by), created_at: now() });
      return pub(get('SELECT * FROM assessments WHERE id = ?', id));
    },
    latest: (project, kind) => pub(get('SELECT * FROM assessments WHERE project = ? AND kind = ? ORDER BY version DESC LIMIT 1', String(project), kind)),
    version: (project, kind, version) => pub(get('SELECT * FROM assessments WHERE project = ? AND kind = ? AND version = ?', String(project), kind, Number(version))) || fail(`找不到第 ${version} 版`, 404),
    history: (project, kind) => all('SELECT id, version, verdict, source, note, created_by, created_at, length(content) AS size FROM assessments WHERE project = ? AND kind = ? ORDER BY version DESC', String(project), kind),
    // 儀表板：各專案最新的結論
    verdicts: () => all(`SELECT a.project, a.verdict, a.version, a.created_at FROM assessments a JOIN (SELECT project, max(version) AS v FROM assessments WHERE kind = 'feasibility' GROUP BY project) m
      ON m.project = a.project AND m.v = a.version WHERE a.kind = 'feasibility'`),
  };
  return ops;
}

// bom.json → 專案的 BOM：沿用的元件鎖定目前版本；新元件建成「待確認」並把估價記成第一筆價格（C 級、來源「代理估價」）；
// 客製件與工程人日是 BOM 自己的行。每個市購品記一筆使用紀錄。專案已經有 BOM 的行時先留快照再整份換掉。
export function importBom(db, project, bom, { by = '', redact = s => s, source = 'bom.json' } = {}) {
  const chk = checkBomJson(bom, { findByCode: c => db.findByCode(c) });
  if (!chk.ok) throw Object.assign(new Error(`BOM 有問題：${chk.errors.join('；')}`), { status: 400, errors: chk.errors });
  const R = v => typeof v === 'string' ? redact(v) : v;
  const out = { lines: 0, reused: 0, created: 0, custom: 0, labor: 0, snapshot: null, warnings: chk.warnings };
  return db.tx(() => {
    const cur = db.bom.get(project);
    if (cur?.lines.length) out.snapshot = db.bom.snapshot(project, { name: `${cur.bom.name} 重新匯入前`, note: `${source} 重新匯入之前自動保存` });
    const rows = bom.items.map((raw, i) => {
      const it = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, R(v)])), line = text(it.line) || String(i + 1);
      const base = { line, section: text(it.section), grp: text(it.group), reason: text(it.reason), qty: num(it.qty ?? 1) ?? 1, unit: text(it.unit), note: text(it.note) };
      if (it.labor) { out.labor++; return { ...base, labor: it.labor, name: text(it.name), ...(it.estimate != null && it.estimate !== '' ? { unit_price: num(it.estimate) } : {}) }; }
      if (it.custom) { out.custom++; return { ...base, name: text(it.name), spec: text(it.spec), model: text(it.model), unit_price: num(it.estimate), grade: text(it.grade).toUpperCase() || 'C' }; }
      let part = text(it.ref) ? db.findByCode(text(it.ref)) : db.findSame(it.name, it.model);
      if (part) out.reused++;
      else {
        part = db.createPart({ name: it.name, brand: it.brand, model: it.model, spec: it.spec, category: it.category, unit: it.unit, status: '待確認', selection_note: text(it.reason),
          note: `由 ${project} 的 BOM 帶入${text(it.category) ? `；提案的類別：${text(it.category)}` : ''}` }, { createCategory: false });
        if (it.estimate != null && it.estimate !== '') db.addPrice(part.id, { unit_price: num(it.estimate), currency: text(it.currency) || 'TWD', grade: text(it.grade).toUpperCase() || 'C', source: '代理估價', note: `${project} 的 BOM` });
        part = db.findByCode(part.code); out.created++;
      }
      if (!db.findUsage(project, source, line)) db.addUsage(part.id, { project, source, item_code: line, qty: base.qty, reason: base.reason, note: '' });
      return { ...base, part: part.code };
    });
    db.bom.replaceItems(project, rows);
    out.lines = rows.length;
    return out;
  });
}

// 目前的 BOM 匯出成 bom.json（代理修改可行性與 BOM 前，平台先把資料庫的最新版寫回 .studio/plan/）
export function bomToJson(db, project) {
  const b = db.bom.get(project);
  return { items: (b?.lines || []).map(l => ({ line: l.line, section: l.section, ...(l.grp ? { group: l.grp } : {}),
    ...(l.code ? { ref: l.code } : l.labor ? { labor: l.labor, name: l.name } : { custom: true, name: l.name, spec: l.spec, estimate: l.price, grade: l.grade }),
    qty: l.qty, ...(l.unit ? { unit: l.unit } : {}), ...(l.reason ? { reason: l.reason } : {}) })) };
}

// 規劃角色寫出的評估檔（.studio/plan/）：{ proposal, feasibility: { md, data }, bom }
export function readPlanFiles(J) {
  const plan = J.plan;
  return { proposal: readText(join(plan, 'proposal.md')), feasibility: { md: readText(join(plan, 'feasibility.md')), data: readJson(join(plan, 'feasibility.json'), null) },
    bom: existsSync(join(plan, 'bom.json')) ? readJson(join(plan, 'bom.json'), null) : null };
}
// 檢查規劃角色的評估檔（提案確認前）；回傳錯誤清單（空的是通過）
export function checkPlanFiles(J, db) {
  const f = readPlanFiles(J), errors = [];
  const fe = checkFeasibility(f.feasibility.md, f.feasibility.data);
  errors.push(...fe.errors);
  if (!f.bom) errors.push('沒有 .studio/plan/bom.json');
  else errors.push(...checkBomJson(f.bom, { findByCode: db ? c => db.findByCode(c) : null }).errors);
  return errors;
}
// 提案確認後：提案與可行性各存一版，BOM 匯入成本表
export function importAssessment(db, project, J, { by = '', redact = s => s, note = '' } = {}) {
  const f = readPlanFiles(J), out = {};
  if (text(f.proposal)) out.proposal = db.assess.save(project, 'proposal', { content: redact(f.proposal), by, note }).version;
  if (text(f.feasibility.md)) out.feasibility = db.assess.save(project, 'feasibility', { content: redact(f.feasibility.md), data: JSON.parse(redact(JSON.stringify(f.feasibility.data || {}))), by, note }).version;
  if (f.bom) out.bom = importBom(db, project, f.bom, { by, redact });
  return out;
}
// 代理修改前：資料庫的最新版寫回 .studio/plan/（之後改完再匯入）
export function writePlanFiles(db, project, J) {
  const p = db.assess.latest(project, 'proposal'), fe = db.assess.latest(project, 'feasibility');
  if (p) writeText(join(J.plan, 'proposal.md'), p.content);
  if (fe) { writeText(join(J.plan, 'feasibility.md'), fe.content); writeJson(join(J.plan, 'feasibility.json'), fe.data); }
  if (db.bom.get(project)) writeJson(join(J.plan, 'bom.json'), bomToJson(db, project));
}

// 審查用的成本表摘要（.studio/plan/bom-summary.md）：每一行與總計
export function writeBomSummary(db, project, J) {
  const b = db.bom.get(project);
  if (!b) return;
  const m = n => n == null ? '—' : Math.round(n).toLocaleString('en-US'), s = b.summary;
  writeText(join(J.plan, 'bom-summary.md'), [`# 成本表摘要（${project}，資料庫的目前版本）`, '',
    '| 行 | 子系統 | 元件 | 名稱 | 數量 | 小計（NT$） |', '|---|---|---|---|---|---|',
    ...b.lines.map(l => `| ${l.line} | ${l.section} | ${l.code || (l.labor ? '工程' : '客製')} | ${String(l.name).replace(/\|/g, '／')} | ${l.qty}${l.unit ? ' ' + l.unit : ''} | ${m(l.subtotal)} |`), '',
    `設備與材料 ${m(s.equipment)}、工程人日 ${m(s.labor)}（${s.laborDays} 人日）、小計 ${m(s.subtotal)}、預備費 ${m(s.contingency)}、總計 ${m(s.total)}（${m(s.low)}～${m(s.high)}）、含稅 ${m(s.taxed)}`, ''].join('\n'));
}

// 平台的檢查：{ check, ok, level: 'fail'|'warn'|'ok', note, detail[] }
export function checkProject(db, project, { scheduleTotal = null, components = [] } = {}) {
  const out = [];
  // AOI（評估平台 Q7）：有勾 AOI 的專案要有方案、選用一個，選用的要通過 L1＋L2
  if (components.includes('aoi')) {
    const list = db.aoi.list(project), chosen = list.find(s => s.status === 'chosen');
    const bad = chosen ? chosen.result.results.filter(r => r.status === 'fail').map(r => `${r.label}：${r.note || r.value}`) : [];
    out.push({ check: 'aoi', ok: !!chosen && !bad.length, level: !list.length || bad.length ? 'fail' : !chosen ? 'warn' : chosen.result.status === 'warn' ? 'warn' : 'ok',
      note: !list.length ? '還沒有 AOI 方案（光學工作台或光學代理）' : !chosen ? `${list.length} 個方案，還沒選用` : `選用「${chosen.name}」`, detail: bad });
  }
  if (!components.length || components.includes('assess') || db.assess.latest(project, 'feasibility')) out.push(...checkAssess(db, project, { scheduleTotal }));
  return out;
}
function checkAssess(db, project, { scheduleTotal }) {
  const out = [];
  const fe = db.assess.latest(project, 'feasibility');
  if (!fe) out.push({ check: 'feasibility', ok: false, level: 'fail', note: '還沒有可行性分析', detail: [] });
  else { const r = checkFeasibility(fe.content, fe.data, { scheduleTotal });
    out.push({ check: 'feasibility', ok: r.ok, level: r.ok ? (r.warnings.length ? 'warn' : 'ok') : 'fail', note: r.ok ? `第 ${fe.version} 版，結論「${fe.verdict}」` : `${r.errors.length} 個問題`, detail: [...r.errors, ...r.warnings] }); }
  const b = db.bom.get(project);
  if (!b) { out.push({ check: 'bom', ok: false, level: 'fail', note: '還沒有 BOM', detail: [] }); return out; }
  const bad = b.lines.filter(l => !l.code && !l.labor && !CUSTOM_OK.test(`${l.section} ${l.name} ${l.spec}`)).map(l => `${l.line}「${l.name}」沒有引用元件，也不像加工件、治具或機架`);
  const pending = b.lines.filter(l => l.flags.includes('pending')).map(l => `${l.line} ${l.code} ${l.name}：元件還是「待確認」`);
  out.push({ check: 'bom', ok: !bad.length, level: bad.length ? 'fail' : pending.length ? 'warn' : 'ok', note: `${b.lines.length} 行（引用元件 ${b.lines.filter(l => l.code).length}、客製 ${b.lines.filter(l => !l.code && !l.labor).length}、工程 ${b.lines.filter(l => l.labor).length}）`, detail: [...bad, ...pending] });
  const f = b.summary.flags, warn = [f.noPrice && `${f.noPrice} 行沒有單價`, f.noFx && `${f.noFx} 行缺匯率`, f.expired && `${f.expired} 行報價過期`, f.estimate && `${f.estimate} 行是估價（C 級）`, f.newer && `${f.newer} 行的元件有新版`].filter(Boolean);
  out.push({ check: 'cost', ok: true, level: warn.length ? 'warn' : 'ok', note: `總計 NT$ ${Math.round(b.summary.total).toLocaleString('en-US')}（含稅 ${Math.round(b.summary.taxed).toLocaleString('en-US')}）`, detail: warn });
  return out;
}
