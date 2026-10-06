// 元件補全（評估平台 Q5，2026-10-06 拍板：enrich 是唯一可以上網的角色，結果由使用者逐欄審核）。
//   enrich_jobs   一次補全：哪個元件、要查哪些欄位、狀態、代理的結果（驗證過）、採用了哪些
//   part_sources  採用的值從哪裡來：欄位、值、來源網址、原文摘錄、採用後的元件版本、誰採用
// 流程：建工作（queued）→ 佇列跑 `vs3d enrich <元件> --job <id>`（running）→ 代理在工作資料夾寫 result.json → 驗證後存起來（review）
//   → 使用者逐欄勾選採用（accepted，元件升一版；價格記成 C 級的價格紀錄；檔案由主機下載成附件）或放棄（dismissed）。
// 工作資料夾：資料庫旁邊的 enrich/<工作 id>/（task.md、part.json、result.json、agent.jsonl），只留本機。
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

export const V8_ENRICH = `
CREATE TABLE enrich_jobs (id INTEGER PRIMARY KEY, part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'queued',
  fields TEXT NOT NULL DEFAULT '[]', result TEXT NOT NULL DEFAULT '{}', applied TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '',
  cli TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', cost REAL, created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT '', finished_at TEXT NOT NULL DEFAULT '', reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at TEXT NOT NULL DEFAULT '');
CREATE INDEX enrich_part ON enrich_jobs(part_id);
CREATE TABLE part_sources (id INTEGER PRIMARY KEY, part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE, version INTEGER, field TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', quote TEXT NOT NULL DEFAULT '', job_id INTEGER, accepted_by TEXT NOT NULL DEFAULT '', accepted_at TEXT NOT NULL);
CREATE INDEX part_sources_part ON part_sources(part_id);
`;
export const JOB_STATUS = { queued: '排隊中', running: '查詢中', review: '待審核', accepted: '已採用', dismissed: '已放棄', failed: '失敗' };
// 代理可以補的基本欄位（名稱不讓代理改；規格欄位用分類的欄位範本，另外查到的也可以列）
export const PART_FIELDS = { brand: '廠牌', model: '型號', spec: '規格', unit: '單位', url: '產品網址' };
export const CONFIDENCE = { high: '高', medium: '中', low: '低' };
export const MAX_FILES = 5, MAX_BATCH = 10;
const FILE_KIND_OK = ['datasheet', 'image', 'cad', 'other'];
const text = v => v == null ? '' : String(v).trim();
const isUrl = s => /^https?:\/\/[^\s]+$/i.test(text(s));
const cut = (s, n) => (s = text(s).replace(/\s+/g, ' ')).length > n ? s.slice(0, n) + '…' : s;

// 工作資料夾
export const jobDir = (dbFile, id) => join(dbFile === ':memory:' ? join(tmpdir(), 'vs3d-enrich') : join(dirname(dbFile), 'enrich'), String(id));

// 數字欄位：「3.45 µm」「3.45um」去掉單位；千分位逗號去掉；其他字就不收
function asNumber(v, unit) {
  let s = text(v).replace(/,/g, '');
  if (unit) s = s.replace(new RegExp(`\\s*${unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), '');
  s = s.replace(/\s*(mm|µm|um|nm|px|fps|kg|g|w|v|a|hz|khz|ms|s)$/i, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
}
const asBool = v => ({ 是: '是', 否: '否', yes: '是', no: '否', true: '是', false: '否', 有: '是', 無: '否' })[text(v).toLowerCase()] || null;

// 代理的 result.json → 待審核的清單。不合格的項目留下來並標出原因（介面顯示，不能採用）
//   part：getPart 的結果（含 fields 欄位範本）；only：只查這幾個欄位（空的是全部）
export function validateResult(raw, part, only = []) {
  const items = [], fields = new Map((part.fields || []).map(f => [f.key, f]));
  const attrsNow = part.attrs || {}, want = new Set(only);
  const entry = (group, key, label, x, current, type, unit) => {
    const o = x && typeof x === 'object' && !Array.isArray(x) ? x : { value: x };
    let value = text(o.value), error = '';
    if (!value) return;
    if (type === 'number') { const n = asNumber(value, unit); if (n == null) error = `要是數字${unit ? `（${unit}）` : ''}`; else value = n; }
    if (type === 'bool') { const b = asBool(value); if (!b) error = '只能是「是」或「否」'; else value = b; }
    if (key === 'url' && group === 'part' && !isUrl(value)) error = '網址格式不對';
    if (value.length > 500) error = '值太長（500 字以內）';
    if (!isUrl(o.source)) error ||= '沒有來源網址';
    const conf = CONFIDENCE[o.confidence] ? o.confidence : 'medium';
    items.push({ key: group === 'attr' ? `attrs.${key}` : key, group, label, value, current: text(current), unit: unit || '', source: text(o.source), quote: cut(o.quote, 200),
      confidence: conf, same: value === text(current), ...(error ? { error } : {}), ...(want.size && !want.has(key) && !want.has(`attrs.${key}`) ? { extra: true } : {}) });
  };
  for (const [k, x] of Object.entries(raw?.fields || {})) if (PART_FIELDS[k]) entry('part', k, PART_FIELDS[k], x, part[k]);
  for (const [k, x] of Object.entries(raw?.attrs || {})) {
    const key = text(k).slice(0, 40), f = fields.get(key);
    if (key) entry('attr', key, f?.label || key, x, attrsNow[key], f?.type, f?.unit);
  }
  let price = null;
  const p = raw?.price;
  if (p && p.value != null && p.value !== '') {
    const value = Number(String(p.value).replace(/,/g, '')), currency = text(p.currency || 'TWD').toUpperCase(), date = text(p.date);
    const error = !Number.isFinite(value) || value <= 0 ? '單價要是正數' : !/^[A-Z]{3}$/.test(currency) ? '幣別要是三個英文字母' : !isUrl(p.source) ? '沒有來源網址'
      : date && !/^\d{4}-\d{2}-\d{2}$/.test(date) ? '日期格式是 YYYY-MM-DD' : '';
    price = { value, currency, date, source: text(p.source), quote: cut(p.quote, 200), ...(error ? { error } : {}) };
  }
  const files = (Array.isArray(raw?.files) ? raw.files : []).slice(0, MAX_FILES).map(f => ({
    url: text(f?.url), kind: FILE_KIND_OK.includes(f?.kind) ? f.kind : 'other', title: cut(f?.title, 80), ...(!isUrl(f?.url) ? { error: '網址格式不對' } : {}) }));
  return { matched: raw?.matched !== false, note: cut(raw?.note, 500), items, price, files };
}

// 資料庫的部分（partsdb 呼叫）。api：partsdb 本身（updatePart、addFile、tx、versions、系統設定…）
export function enrichOps({ all, get, run, insert, now, fail, findPart, api }) {
  const row = id => get('SELECT * FROM enrich_jobs WHERE id = ?', Number(id)) || fail(`找不到補全工作 ${id}`, 404);
  const pub = j => j && {
    ...j, fields: JSON.parse(j.fields || '[]'), result: JSON.parse(j.result || '{}'), applied: JSON.parse(j.applied || '{}'), status_label: JOB_STATUS[j.status] || j.status,
    ...(j.code ? {} : (p => p ? { code: p.code, name: p.name } : {})(get('SELECT code, name FROM parts WHERE id = ?', j.part_id))),
  };
  const ops = {
    // 建工作：同一個元件已經有排隊中或查詢中的就不重複建
    create(partId, { fields = [], by = '' } = {}) {
      const p = findPart(partId) || fail(`找不到元件 ${partId}`, 404);
      const busy = get("SELECT id FROM enrich_jobs WHERE part_id = ? AND status IN ('queued', 'running')", p.id);
      if (busy) fail(`${p.code} 已經有補全工作在進行（#${busy.id}）`);
      const list = (Array.isArray(fields) ? fields : String(fields).split(',')).map(text).filter(Boolean).slice(0, 40);
      return ops.get(insert('enrich_jobs', { part_id: p.id, fields: JSON.stringify(list), created_by: text(by), created_at: now() }));
    },
    get: id => pub(row(id)),
    list({ status = '', part = '', limit = 100 } = {}) {
      const p = part ? findPart(part) || fail(`找不到元件 ${part}`, 404) : null;
      return all(`SELECT j.*, p.code, p.name FROM enrich_jobs j JOIN parts p ON p.id = j.part_id WHERE (? = '' OR j.status = ?) AND (? IS NULL OR j.part_id = ?)
        ORDER BY j.id DESC LIMIT ?`, status, status, p?.id ?? null, p?.id ?? null, Math.min(500, Number(limit) || 100)).map(pub);
    },
    start(id, { cli = '', model = '' } = {}) {
      const j = row(id);
      if (j.status !== 'queued') fail(`補全工作 #${j.id} 的狀態是「${JOB_STATUS[j.status]}」，不能再執行`);
      run("UPDATE enrich_jobs SET status = 'running', cli = ?, model = ?, started_at = ? WHERE id = ?", cli, model, now(), j.id);
      return ops.get(j.id);
    },
    finish(id, { result = null, error = '', cost = null } = {}) {
      const j = row(id);
      run('UPDATE enrich_jobs SET status = ?, result = ?, error = ?, cost = ?, finished_at = ? WHERE id = ?',
        error ? 'failed' : 'review', JSON.stringify(result || {}), cut(error, 1000), cost, now(), j.id);
      return ops.get(j.id);
    },
    // 佇列的子程序結束了，工作卻還在排隊中或查詢中（被停止、當掉）：改成失敗
    failStale(partId, reason = '執行中斷') {
      const p = findPart(partId); if (!p) return 0;
      return run("UPDATE enrich_jobs SET status = 'failed', error = ?, finished_at = ? WHERE part_id = ? AND status IN ('queued', 'running')", reason, now(), p.id).changes;
    },
    dismiss(id, by = '') {
      const j = row(id);
      if (j.status === 'running') fail('查詢中的工作要先停止');
      if (j.status === 'accepted') fail('已經採用的工作不能放棄');
      run("UPDATE enrich_jobs SET status = 'dismissed', reviewed_by = ?, reviewed_at = ? WHERE id = ?", text(by), now(), j.id);
      return ops.get(j.id);
    },
    sources: partId => all('SELECT * FROM part_sources WHERE part_id = ? ORDER BY id DESC', (findPart(partId) || fail('找不到元件', 404)).id),
    // 採用：keys 是要採用的欄位（'brand'、'attrs.像素尺寸'…）；price：是否加價格紀錄；files：要下載的檔案序號。
    // 欄位一次寫進元件（升一版）；價格加一筆 C 級紀錄；檔案由主機下載成附件（大小與類型照系統設定，失敗的列在 errors，不影響其他）。
    async accept(id, { keys = [], price = false, files = [], by = '' } = {}, { download = downloadFile } = {}) {
      const j = row(id);
      if (j.status !== 'review') fail(`補全工作 #${j.id} 的狀態是「${JOB_STATUS[j.status]}」，只有待審核的可以採用`);
      const r = JSON.parse(j.result || '{}'), part = api.getPart(j.part_id), errors = [];
      const pick = (r.items || []).filter(x => keys.includes(x.key));
      for (const x of pick) if (x.error) fail(`「${x.label}」不能採用：${x.error}`);
      if (price && r.price?.error) fail(`價格不能採用：${r.price.error}`);
      const applied = { keys: [], price: null, files: [], errors };
      const changed = pick.filter(x => !x.same), by_ = text(by), t = now();
      // 欄位與價格在同一個交易裡寫進去，元件只升一版（價格直接寫入，值已經在 validateResult 驗過）
      api.tx(() => {
        if (price && r.price) applied.price = insert('prices', { part_id: part.id, unit_price: r.price.value, currency: r.price.currency, grade: 'C', quoted_on: r.price.date || t.slice(0, 10),
          source: cut(`網路查詢 ${r.price.source}`, 300), valid_until: '', note: `元件補全 #${j.id}`, supplier_id: null, created_at: t });
        if (changed.length) {
          const attrs = { ...part.attrs }, v = { ...part, attrs };
          for (const x of changed) { if (x.group === 'attr') attrs[x.key.slice(6)] = x.value; else v[x.key] = x.value; }
          delete v.cover_file_id;
          api.updatePart(part.id, v);
        } else if (applied.price) api.versions.bump(part.id, { by: by_, note: `元件補全 #${j.id}` });
        const version = get('SELECT version FROM parts WHERE id = ?', part.id).version;
        for (const x of changed) insert('part_sources', { part_id: part.id, version, field: x.key, value: x.value, url: x.source, quote: x.quote, job_id: j.id, accepted_by: by_, accepted_at: t });
        if (applied.price) insert('part_sources', { part_id: part.id, version, field: 'price', value: String(r.price.value), url: r.price.source, quote: r.price.quote || '', job_id: j.id, accepted_by: by_, accepted_at: t });
        applied.keys = changed.map(x => x.key);
      });
      for (const i of files) {
        const f = r.files?.[Number(i)];
        if (!f || f.error) { errors.push(`檔案 ${Number(i) + 1}：${f?.error || '不存在'}`); continue; }
        try {
          const got = await download(f.url, api);
          const added = api.addFile(part.id, { name: got.name, data: got.data, kind: f.kind, note: cut(`元件補全 #${j.id}：${f.url}`, 300), by });
          applied.files.push(added.id);
        } catch (e) { errors.push(`${f.title || f.url}：${e.message}`); }
      }
      run("UPDATE enrich_jobs SET status = 'accepted', applied = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?", JSON.stringify(applied), text(by), now(), j.id);
      return { job: ops.get(j.id), part: api.getPart(part.id) };
    },
  };
  return ops;
}

// 下載檔案成附件：類型與大小上限照系統設定的附件規則（lib/settings.mjs 的 attachmentRule），逾時 60 秒；db 是 partsdb
export async function downloadFile(url, db, { timeoutMs = 60000 } = {}) {
  const { attachmentRule, readSystem } = await import('./settings.mjs'), { fileType } = await import('./partsdb.mjs'), system = readSystem(db);
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'vs3d-enrich' } });
  if (!res.ok) throw new Error(`下載失敗（HTTP ${res.status}）`);
  const ctype = res.headers.get('content-type') || '', disp = res.headers.get('content-disposition') || '';
  let name = /filename\*=UTF-8''([^;]+)/i.exec(disp)?.[1] || /filename="?([^";]+)"?/i.exec(disp)?.[1] || decodeURIComponent(new URL(res.url || url).pathname.split('/').pop() || '');
  if (!fileType(name)) {
    const ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/zip': 'zip' }[ctype.split(';')[0].trim()];
    if (ext) name = `${name.replace(/\.[^.]*$/, '') || 'download'}.${ext}`;
  }
  const rule = attachmentRule(system, fileType(name));
  if (Number(res.headers.get('content-length')) > rule.limit) throw new Error(`超過附件上限 ${rule.mb} MB`);
  const chunks = []; let size = 0;
  for await (const c of res.body) { size += c.length; if (size > rule.limit) throw new Error(`超過附件上限 ${rule.mb} MB`); chunks.push(c); }
  if (!size) throw new Error('下載到的檔案是空的');
  return { name, data: Buffer.concat(chunks) };
}

// 給代理的元件資料（part.json）
function partBrief(part, only) {
  return {
    code: part.code, name: part.name, brand: part.brand, model: part.model, spec: part.spec, unit: part.unit, url: part.url, note: part.note,
    category: part.category_path?.map(c => c.name ?? c).join(' / ') || part.category || '',
    attrs: part.attrs,
    template: (part.fields || []).map(f => ({ key: f.key, label: f.label, type: f.type, unit: f.unit, options: f.options, required: !!f.required })),
    missing: part.missing, latestPrice: part.prices?.[0] ? { value: part.prices[0].unit_price, currency: part.prices[0].currency, date: part.prices[0].quoted_on, grade: part.prices[0].grade } : null,
    only: only.length ? only : null,
  };
}

export function enrichPrompt(only = []) {
  return `任務：元件補全（vs3d 元件資料庫）

同一個資料夾的 part.json 是元件庫裡一個元件目前的資料。請上網查這個元件的原廠規格，把結果寫成同一個資料夾的 result.json。
${only.length ? `這次只查這幾個欄位：${only.join('、')}（part.json 的 only）。\n` : '先補 template 裡沒填的欄位（missing 是必填但空白的），再補 template 裡其他沒填的欄位；已經有值的欄位查到不同的值也列出來（使用者會比對）。\n'}
result.json 的格式（只能是 JSON）：
{
  "matched": true,
  "note": "查到的是哪個型號、哪個網站；有疑慮在這裡說明",
  "fields": { "brand": { "value": "…", "source": "https://…", "quote": "原文摘錄", "confidence": "high" } },
  "attrs": { "像素尺寸": { "value": "3.45", "source": "https://…", "quote": "Pixel size 3.45 µm", "confidence": "high" } },
  "price": { "value": 12000, "currency": "TWD", "date": "YYYY-MM-DD", "source": "https://…", "quote": "…" },
  "files": [ { "url": "https://…/datasheet.pdf", "kind": "datasheet", "title": "規格書" } ]
}

規則：
- fields 只能用 brand（廠牌）、model（型號）、spec（規格，一行摘要）、unit（單位）、url（原廠產品頁）；不要改名稱。
- attrs 的鍵用 template 的 key；template 沒有、但對選型重要的規格也可以列（鍵用中文短名）。
- 數字欄位只填數字，用 template 的單位（例如 µm 就填 3.45，不要寫單位）；選項欄位優先用 options 裡的寫法；是否欄位填「是」或「否」。
- 每一個值都要附來源網址 source（原廠網站或代理商的產品頁、規格書優先）與原文摘錄 quote（60 字以內）。沒有來源的不要填。
- confidence：high＝原廠規格書明寫；medium＝代理商或經銷商頁面；low＝推論或來源不一致。
- 找不到或不確定就不要填，不要猜。查到的型號和 part.json 對不上時，matched 設 false 並在 note 說明。
- price 只有公開標價時才填（含幣別與日期；未稅或含稅寫在 quote）；沒有就省略。
- files 只列原廠的規格書 PDF、產品圖、CAD 下載網址（kind：datasheet、image、cad），最多 ${MAX_FILES} 個；要登入才能下載的不要列。檔案由主機在使用者採用後下載，你不用下載。
- 只寫 result.json，不要建立或修改其他檔案。
- 最後回覆一行摘要（查到幾個欄位、來源網站）。
`;
}

// 執行一個補全工作（vs3d enrich 呼叫；介面經由代理佇列）：準備工作資料夾 → 跑 enrich 角色 → 驗證 result.json → 存成待審核
//   rc：resolveRole('enrich', …) 的結果 { cli, model, effort }
export async function runEnrichJob(db, jobId, { rc, log = console.log, timeoutMin = 20 } = {}) {
  const { adapterFor, runAgent } = await import('./adapters/index.mjs'), { agentEnv } = await import('./agent-auth.mjs');
  const job = db.enrich.start(jobId, { cli: rc.cli, model: rc.model || '' }), part = db.getPart(job.part_id), dir = jobDir(db.file, job.id);
  mkdirSync(dir, { recursive: true });
  const prompt = enrichPrompt(job.fields);
  writeFileSync(join(dir, 'part.json'), JSON.stringify(partBrief(part, job.fields), null, 2) + '\n');
  writeFileSync(join(dir, 'task.md'), prompt);
  const out = join(dir, 'result.json');
  try {
    const adapter = adapterFor(rc.cli), auth = await agentEnv(rc.cli);
    log(`▶ 元件補全 #${job.id}：${part.code} ${part.name}（${adapter.label}${rc.model ? ' ' + rc.model : ''}${job.fields.length ? `；只查 ${job.fields.join('、')}` : ''}）`);
    const res = await runAgent(adapter, {
      cwd: dir, prompt, model: rc.model || undefined, effort: rc.effort || undefined, allowWrite: [dir], denyWrite: [],
      // Claude：只能讀寫檔與上網，不能用 shell；Codex：開網路搜尋，沙箱只能寫工作資料夾
      tools: { allow: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'], deny: ['Bash', 'NotebookEdit'] }, search: true,
      env: auth.env, unsetEnv: auth.unset, settings: auth.settings, logFile: join(dir, 'agent.jsonl'), timeoutMs: timeoutMin * 60000,
    }, e => { if (e.kind === 'tool') log(`  · ${e.name} ${e.detail}`); if (e.kind === 'warn') log(`  ! ${e.message}`); });
    if (!res.ok && !existsSync(out)) return db.enrich.finish(job.id, { error: `代理執行失敗（${res.timedOut ? `超過 ${timeoutMin} 分鐘` : `exit ${res.code}`}）：${cut(res.stderr || res.text, 300)}`, cost: res.costUsd });
    if (!existsSync(out)) return db.enrich.finish(job.id, { error: `代理沒有寫出 result.json：${cut(res.text, 300)}`, cost: res.costUsd });
    let raw; try { raw = JSON.parse(readFileSync(out, 'utf8')); } catch (e) { return db.enrich.finish(job.id, { error: `result.json 不是 JSON：${e.message}`, cost: res.costUsd }); }
    const result = validateResult(raw, db.getPart(job.part_id), job.fields);
    const r = db.enrich.finish(job.id, { result, cost: res.costUsd });
    log(`  ✓ 查到 ${result.items.length} 個欄位${result.price ? '、價格' : ''}${result.files.length ? `、${result.files.length} 個檔案` : ''}；${result.items.filter(x => x.error).length ? `${result.items.filter(x => x.error).length} 個不合格；` : ''}到元件庫審核`);
    return r;
  } catch (e) {
    return db.enrich.finish(job.id, { error: String(e.message || e) });
  }
}
