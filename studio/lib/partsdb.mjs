// 元件資料庫（SQLite，用 Node 內建的 node:sqlite，不需要 npm 套件；Node 22.13 以上）。
//   suppliers  供應商主檔（類型、聯絡窗口、交期、付款條件）
//   parts      元件主表（唯一編號 code：P-00001 起的流水號，給了就不變也不重用；群組 grp、類別、狀態 status（「待確認」是代理提案帶進來、還沒審核的）、
//              core 共用模型 model_id（3D 顯示用）、名稱、廠牌、型號、規格、自由規格欄位 attrs、選型備註、替代方案、標籤、資料連結）
//   prices     價格紀錄：一個元件多筆（日期、單價、幣別、等級 A/B/C、供應商、來源或報價單號、有效期限）
//   files      元件的附件（報價單、圖片、型錄、CAD 檔）：檔案放在資料庫旁邊的 files/<SHA-256>（同一個檔只存一份），這裡記檔名、類型、大小、上傳者、對應的價格紀錄
//   usages     專案使用紀錄：哪個專案的哪一列成本表用過（專案、來源檔、編號、子系統、數量、選型理由）
//   settings   系統設定（附件上限、成本費率…；鍵值與驗證在 lib/settings.mjs）
//   part_latest 檢視表：元件＋最新一筆價格＋供應商。各站的成本表產生器可以直接讀（Python 用內建的 sqlite3）
// 資料庫檔只留本機，不進版控（2026-10-05 拍板）：預設 studio/data/studio.db（第 4 版以前叫 parts.db，開啟時自動改名），
// 環境變數 VS3D_DB（舊的 VS3D_PARTS_DB 也可以）改位置；換電腦時複製資料庫檔與旁邊的 files/。結構升級前會自動備份成 <檔名>.bak-v<舊版>。
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { STUDIO, now } from './util.mjs';
import { categoryOps, V5_CATEGORIES } from './categories.mjs';
import { linkOps, V5_LINKS } from './part-links.mjs';

export const defaultPartsDb = () => process.env.VS3D_DB || process.env.VS3D_PARTS_DB || join(STUDIO, 'data', 'studio.db');

// 附件：依副檔名分成幾類（系統設定決定哪幾類可以上傳；CAD 另有自己的大小上限），使用者另外標用途 kind
export const FILE_TYPES = {
  image: { label: '圖片', ext: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
  pdf: { label: 'PDF', ext: ['pdf'] },
  office: { label: 'Office 文件', ext: ['doc', 'docx', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'csv', 'odt', 'ods'] },
  cad: { label: 'CAD 檔', ext: ['step', 'stp', 'iges', 'igs', 'sldprt', 'sldasm', 'slddrw', 'dwg', 'dxf', 'stl', 'x_t', 'x_b', '3mf', 'obj', 'ipt', 'iam', 'prt', 'catpart', 'catproduct', 'jt', '3dxml', 'glb', 'gltf'] },
  archive: { label: '壓縮檔', ext: ['zip', '7z', 'rar'] },
  text: { label: '文字檔', ext: ['txt', 'md', 'json', 'xml'] },
};
export const fileType = name => { const e = extname(String(name || '')).slice(1).toLowerCase(); return Object.keys(FILE_TYPES).find(t => FILE_TYPES[t].ext.includes(e)) || ''; };
export const FILE_KINDS = { quote: '報價單', image: '圖片', datasheet: '型錄／規格書', cad: 'CAD', other: '其他' };
const MIMES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv', xml: 'application/xml', zip: 'application/zip' };
export const mimeOf = name => MIMES[extname(String(name || '')).slice(1).toLowerCase()] || 'application/octet-stream';
const guessKind = name => ({ image: 'image', cad: 'cad', pdf: 'datasheet' })[fileType(name)] || 'other';
const sha256 = data => createHash('sha256').update(data).digest('hex');
export const GRADES = ['A', 'B', 'C'];
export const SUPPLIER_KINDS = ['原廠', '代理商', '經銷商', '加工廠', '網購', '其他'];

// 群組（元件庫樹狀選單的第一層）與預設歸在底下的類別；新增元件沒填群組時依類別帶入，使用者可以自己改成別的群組
export const GROUPS = {
  '機器人與末端': ['機器人', '夾爪與末端工具'],
  '視覺': ['相機與讀碼', '鏡頭與光學', '光源'],
  '感測與量測': ['量測與感測', '校正與標準件', '實驗室儀器'],
  '運動與機構': ['運動與驅動', '氣動與真空', '輸送與供料', '機構與結構'],
  '電控與配線': ['控制器與 I/O', '安全', '電力與配電', '線材與耗材'],
  '資訊與服務': ['電腦與網路', '軟體與授權', '服務'],
};
export const groupOf = category => Object.keys(GROUPS).find(g => GROUPS[g].includes(category)) || '';

const SCHEMA_VERSION = 5;      // 2：parts.grp（群組）；3：唯一編號 code、狀態 status、core 模型 model_id、附件 files；4：系統設定、附件的類型／雜湊／上傳者／價格紀錄、元件封面圖；5：分類樹與欄位範本、關聯件與模組
export const PENDING = '待確認';
export const codeOf = n => `P-${String(n).padStart(5, '0')}`;
const CODE_RE = /^P-\d+$/i;
const VIEW = `
CREATE VIEW part_latest AS
  SELECT p.*, pr.id AS price_id, pr.unit_price, pr.currency, pr.grade, pr.quoted_on, pr.valid_until, pr.source AS price_source, pr.supplier_id, s.name AS supplier
  FROM parts p
  LEFT JOIN prices pr ON pr.id = (SELECT id FROM prices WHERE part_id = p.id ORDER BY quoted_on DESC, id DESC LIMIT 1)
  LEFT JOIN suppliers s ON s.id = pr.supplier_id;
`;
const SCHEMA = `
CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '',
  lead_time TEXT NOT NULL DEFAULT '', payment_terms TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE parts (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  grp TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', spec TEXT NOT NULL DEFAULT '',
  attrs TEXT NOT NULL DEFAULT '{}',
  unit TEXT NOT NULL DEFAULT '',
  selection_note TEXT NOT NULL DEFAULT '', alternatives TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE prices (
  id INTEGER PRIMARY KEY,
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  quoted_on TEXT NOT NULL DEFAULT '',
  unit_price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TWD',
  grade TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '', valid_until TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE usages (
  id INTEGER PRIMARY KEY,
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  project TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '', item_code TEXT NOT NULL DEFAULT '', subsystem TEXT NOT NULL DEFAULT '',
  qty REAL,
  reason TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX prices_part ON prices(part_id, quoted_on);
CREATE INDEX usages_part ON usages(part_id);
CREATE INDEX usages_project ON usages(project, source, item_code);
`;
// 第 3 版加的東西（新資料庫與升級共用）：編號的流水號、附件表
const V3 = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  name TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL
);
CREATE INDEX files_part ON files(part_id);
`;
// 第 4 版：系統設定；附件記類型（用途）、MIME、SHA-256（檔名）、上傳者、對應的價格紀錄；元件的封面圖
const V4 = `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
ALTER TABLE files ADD COLUMN kind TEXT NOT NULL DEFAULT '';
ALTER TABLE files ADD COLUMN mime TEXT NOT NULL DEFAULT '';
ALTER TABLE files ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE files ADD COLUMN uploaded_by TEXT NOT NULL DEFAULT '';
ALTER TABLE files ADD COLUMN price_id INTEGER REFERENCES prices(id) ON DELETE SET NULL;
ALTER TABLE parts ADD COLUMN cover_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL;
CREATE INDEX files_sha ON files(sha256);
CREATE TABLE project_members (project TEXT NOT NULL, user TEXT NOT NULL COLLATE NOCASE, role TEXT NOT NULL DEFAULT 'member', added_by TEXT NOT NULL DEFAULT '', added_at TEXT NOT NULL, PRIMARY KEY (project, user));
`;

export class PartsError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const bad = msg => { throw new PartsError(msg); };

const PART_TEXT = ['status', 'model_id', 'grp', 'category', 'name', 'brand', 'model', 'spec', 'unit', 'selection_note', 'alternatives', 'tags', 'url', 'note'];
const PRICE_TEXT = ['quoted_on', 'currency', 'grade', 'source', 'valid_until', 'note'];
const USAGE_TEXT = ['project', 'source', 'item_code', 'subsystem', 'reason', 'note'];
const SUPPLIER_TEXT = ['name', 'kind', 'contact', 'phone', 'email', 'website', 'lead_time', 'payment_terms', 'note'];
// 搜尋比對的欄位
const SEARCH_PART = ['code', 'name', 'brand', 'model', 'spec', 'grp', 'category', 'tags', 'selection_note', 'alternatives', 'note', 'attrs'];

const text = v => v == null ? '' : String(v).trim();
const pickText = (v, keys) => Object.fromEntries(keys.map(k => [k, text(v[k])]));
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
function numberOrNull(v, label) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) bad(`${label}要是數字`);
  return n;
}
function cleanAttrs(v) {
  if (typeof v === 'string') { try { v = JSON.parse(v || '{}'); } catch { bad('自由規格欄位的格式不對'); } }
  if (v == null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) bad('自由規格欄位要是「名稱：值」的組合');
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [text(k), text(x)]).filter(([k]) => k));
}
function cleanPart(v) {
  const p = pickText(v, PART_TEXT);
  if (!p.name) bad('請輸入元件名稱');
  delete p.grp; delete p.category;            // 分類由 placement 決定（分類樹，文字欄位跟著同步）
  if (p.status && p.status !== PENDING) bad(`狀態只能留白或「${PENDING}」`);
  return { ...p, attrs: JSON.stringify(cleanAttrs(v.attrs)) };
}
function cleanPrice(v) {
  const p = pickText(v, PRICE_TEXT), price = numberOrNull(v.unit_price, '單價');
  if (price == null) bad('請輸入單價');
  if (price < 0) bad('單價不能是負數');
  if (p.quoted_on && !isDate(p.quoted_on)) bad('報價日期的格式是 YYYY-MM-DD');
  if (p.valid_until && !isDate(p.valid_until)) bad('有效期限的格式是 YYYY-MM-DD');
  p.grade = p.grade.toUpperCase();
  if (p.grade && !GRADES.includes(p.grade)) bad('等級只能是 A、B、C 或留白');
  p.currency = (p.currency || 'TWD').toUpperCase();
  return { ...p, unit_price: price, supplier_id: numberOrNull(v.supplier_id, '供應商') };
}
function cleanUsage(v) {
  const u = pickText(v, USAGE_TEXT);
  if (!u.project) bad('請輸入專案');
  return { ...u, qty: numberOrNull(v.qty, '數量') };
}
function cleanSupplier(v) {
  const s = pickText(v, SUPPLIER_TEXT);
  if (!s.name) bad('請輸入供應商名稱');
  return s;
}
const likeEscape = s => `%${s.replace(/[\\%_]/g, c => '\\' + c)}%`;

// 第 4 版以前的預設檔名是 parts.db：新檔名還不存在而舊檔在同一個資料夾時，連同 WAL 檔一起改名
function renameLegacy(file) {
  if (basename(file) !== 'studio.db' || existsSync(file)) return;
  const old = join(dirname(file), 'parts.db');
  if (!existsSync(old)) return;
  try { for (const s of ['', '-wal', '-shm']) if (existsSync(old + s)) renameSync(old + s, file + s); }
  catch (e) { throw new PartsError(`資料庫要從 parts.db 改名成 studio.db，但檔案正在被別的程式使用（多半是還在執行的舊版 vs3d ui），請先停止再重新開啟：${e.message}`, 500); }
}

export function openPartsDb(file = defaultPartsDb()) {
  if (file !== ':memory:') { mkdirSync(dirname(file), { recursive: true }); renameLegacy(file); }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  let depth = 0;      // 交易的巢狀深度（tx 用）
  // 附件的內容：資料庫旁邊的 files/<SHA-256>，同一個檔只存一份
  const filesDir = file === ':memory:' ? null : join(dirname(file), 'files');
  const blobPath = sha => join(filesDir, sha);
  function storeBlob(sha, data) { mkdirSync(filesDir, { recursive: true }); if (!existsSync(blobPath(sha))) writeFileSync(blobPath(sha), data); }
  let version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > SCHEMA_VERSION) { db.close(); throw new PartsError(`元件資料庫的版本（${version}）比這個程式新（${SCHEMA_VERSION}），請更新程式：${file}`, 500); }
  // 升級前先備份（VACUUM INTO 會寫出一份完整的副本；同名的備份已經存在就加上時間）
  if (version > 0 && version < SCHEMA_VERSION && file !== ':memory:') {
    let bak = `${file}.bak-v${version}`;
    if (existsSync(bak)) bak += `-${now().slice(0, 19).replace(/[-:T]/g, '')}`;
    db.exec(`VACUUM INTO '${bak.replace(/'/g, "''")}'`);
  }
  if (version === 0) tx(() => { db.exec(SCHEMA); db.exec(V3); db.exec(V4); db.exec("CREATE UNIQUE INDEX parts_code ON parts(code); INSERT INTO meta VALUES ('code_seq', 0)"); db.exec(VIEW); db.exec('PRAGMA user_version = 4'); version = 4; });
  // 1 → 2：加上群組欄位，既有元件依類別帶入預設群組；檢視表的 p.* 要重建才看得到新欄位
  if (version === 1) tx(() => {
    version = 2;
    db.exec("ALTER TABLE parts ADD COLUMN grp TEXT NOT NULL DEFAULT ''"); db.exec('DROP VIEW part_latest'); db.exec(VIEW);
    for (const { category } of db.prepare("SELECT DISTINCT category FROM parts WHERE category <> ''").all()) db.prepare('UPDATE parts SET grp = ? WHERE category = ?').run(groupOf(category), category);
    db.exec('PRAGMA user_version = 2');
  });
  // 2 → 3：唯一編號（既有元件用原本的流水 id，之後由 code_seq 往上編，刪掉的編號不重用）、狀態、core 模型、附件表
  if (version === 2) tx(() => {
    for (const c of ["code TEXT NOT NULL DEFAULT ''", "status TEXT NOT NULL DEFAULT ''", "model_id TEXT NOT NULL DEFAULT ''"]) db.exec(`ALTER TABLE parts ADD COLUMN ${c}`);
    db.exec("UPDATE parts SET code = 'P-' || printf('%05d', id)"); db.exec(V3);
    db.exec("CREATE UNIQUE INDEX parts_code ON parts(code); INSERT INTO meta SELECT 'code_seq', coalesce(max(id), 0) FROM parts");
    db.exec('DROP VIEW part_latest'); db.exec(VIEW); db.exec('PRAGMA user_version = 3');
    version = 3;
  });
  // 3 → 4：系統設定、附件欄位、封面圖；舊的附件（parts-files/<id>-<檔名>）搬成 files/<SHA-256>
  if (version === 3) tx(() => {
    db.exec(V4); db.exec('DROP VIEW part_latest'); db.exec(VIEW);
    const oldDir = file === ':memory:' ? null : join(dirname(file), 'parts-files');
    for (const f of db.prepare('SELECT * FROM files').all()) {
      const src = oldDir && join(oldDir, `${f.id}-${f.name}`);
      let sha = '';
      if (src && existsSync(src)) { const data = readFileSync(src); sha = sha256(data); storeBlob(sha, data); rmSync(src); }
      db.prepare('UPDATE files SET sha256 = ?, mime = ?, kind = ? WHERE id = ?').run(sha, mimeOf(f.name), guessKind(f.name), f.id);
    }
    if (oldDir && existsSync(oldDir) && !readdirSync(oldDir).length) rmdirSync(oldDir);
    db.exec('PRAGMA user_version = 4'); version = 4;
  });

  // 交易可以巢狀呼叫（匯入時整批包一層，裡面的新增元件不再另開）
  function tx(fn) {
    if (depth) return fn();
    db.exec('BEGIN'); depth++;
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { depth--; }
  }
  // 沒有其他附件用到同一個內容時，才刪掉檔案
  const dropBlobs = shas => { for (const sha of new Set(shas)) if (sha && filesDir && !get('SELECT 1 AS x FROM files WHERE sha256 = ?', sha)) rmSync(blobPath(sha), { force: true }); };
  const all =(sql, ...a) => db.prepare(sql).all(...a).map(r => ({ ...r }));
  const get = (sql, ...a) => { const r = db.prepare(sql).get(...a); return r ? { ...r } : null; };
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const insert = (table, v) => { const k = Object.keys(v); return Number(run(`INSERT INTO ${table} (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`, ...k.map(x => v[x])).lastInsertRowid); };
  const update = (table, id, v) => { const k = Object.keys(v); run(`UPDATE ${table} SET ${k.map(x => `${x} = ?`).join(', ')} WHERE id = ?`, ...k.map(x => v[x]), id); };
  function need(table, id, label) {
    const row = Number.isInteger(Number(id)) ? get(`SELECT * FROM ${table} WHERE id = ?`, Number(id)) : null;
    if (!row) throw new PartsError(`找不到${label}（${id}）`, 404);
    return row;
  }
  const touch = partId => run('UPDATE parts SET updated_at = ? WHERE id = ?', now(), partId);
  const needSupplier = id => { if (id != null) need('suppliers', id, '供應商'); };
  const unique = fn => { try { return fn(); } catch (e) { if (/UNIQUE/.test(e.message)) bad('已經有同名的供應商'); throw e; } };
  const withAttrs = p => ({ ...p, attrs: JSON.parse(p.attrs || '{}') });
  const fail = (msg, status = 400) => { throw new PartsError(msg, status); };
  const findPart = id => CODE_RE.test(String(id)) ? get('SELECT * FROM parts WHERE code = ? COLLATE NOCASE', String(id).trim())
    : Number.isInteger(Number(id)) ? get('SELECT * FROM parts WHERE id = ?', Number(id)) : null;
  const cats = categoryOps({ all, get, run, insert, tx, now, fail });
  const links = linkOps({ all, get, run, insert, now, fail, findPart });
  // 4 → 5：分類樹（現有的群組與類別放進預設的樹）、欄位範本、關聯件與模組。建表、放資料、改版本號在同一個交易裡
  if (version === 4) tx(() => {
    db.exec(V5_CATEGORIES); db.exec(V5_LINKS); db.exec('DROP VIEW part_latest'); db.exec(VIEW);
    cats.seedDefaults(); cats.placeLegacyParts();
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`); version = 5;
  });
  // 元件放進哪個分類：給 category_id 就用它（null 是未分類）；只給文字（成本表匯入、代理提案、命令列）就依名稱找，createCategory 時找不到就建
  function placement(v, { createCategory = false } = {}) {
    let id;
    if (v.category_id !== undefined) id = v.category_id === null || v.category_id === '' ? null : (cats.textOf(v.category_id), Number(v.category_id));
    else id = cats.resolve(text(v.grp) || groupOf(text(v.category)), text(v.category), { create: createCategory });
    return { category_id: id, ...cats.textOf(id) };
  }
  // 子件加總的模組：清單上的參考單價換成加總（只加新台幣；缺價或外幣的子件標出來）
  function modulePrice(r) {
    if (r.kind !== 'module' || r.price_mode !== 'sum') return {};
    const s = links.sumPrice(r.id);
    return { unit_price: s.total, currency: 'TWD', grade: '', quoted_on: '', price_source: '子件加總', sum_missing: s.missing, sum_foreign: s.foreign };
  }
  function cleanModelParams(v) {
    if (v == null || v === '') return '{}';
    let o = v; if (typeof v === 'string') { try { o = JSON.parse(v); } catch { bad('3D 模型參數要是 JSON'); } }
    if (!o || typeof o !== 'object' || Array.isArray(o)) bad('3D 模型參數要是「參數：值」的組合');
    return JSON.stringify(o);
  }
  function cleanFileMeta(partId, { kind, price_id }) {
    if (!FILE_KINDS[kind]) bad(`附件類型只能是：${Object.values(FILE_KINDS).join('、')}`);
    const pid = price_id == null || price_id === '' ? null : Number(price_id);
    if (pid != null && !get('SELECT 1 AS x FROM prices WHERE id = ? AND part_id = ?', pid, partId)) bad('對應的價格紀錄要是這個元件的');
    return { kind, price_id: pid };
  }

  return {
    file,
    close: () => db.close(),
    tx,

    // q：空白分隔的關鍵字，每個都要出現在元件欄位、使用紀錄（專案、編號、理由）或價格紀錄（來源、供應商）裡
    // cat：分類節點的 id（含子分類），'none' 是未分類；group／category 是舊的文字篩選（命令列沿用）
    listParts({ q = '', group = '', category = '', cat = '', project = '', supplier = '', status = '', kind = '', limit = 500 } = {}) {
      const params = [], p = v => { params.push(v); return `?${params.length}`; }, where = [];
      for (const token of text(q).split(/\s+/).filter(Boolean)) {
        const t = p(likeEscape(token)), like = col => `${col} LIKE ${t} ESCAPE '\\'`;
        where.push(`(${SEARCH_PART.map(c => like(`pl.${c}`)).join(' OR ')}
          OR EXISTS (SELECT 1 FROM usages u WHERE u.part_id = pl.id AND (${['u.project', 'u.item_code', 'u.subsystem', 'u.reason', 'u.note'].map(like).join(' OR ')}))
          OR EXISTS (SELECT 1 FROM prices x LEFT JOIN suppliers s ON s.id = x.supplier_id WHERE x.part_id = pl.id AND (${['x.source', 'x.note', 's.name'].map(like).join(' OR ')})))`);
      }
      if (group) where.push(`pl.grp = ${p(group === '（未分組）' ? '' : group)}`);
      if (status) where.push(`pl.status = ${p(status)}`);
      if (category) where.push(`pl.category = ${p(category === '（未分類）' ? '' : category)}`);
      if (cat === 'none') where.push('pl.category_id IS NULL');
      else if (cat) where.push(`pl.category_id IN (${cats.descendantIds(cat).map(Number).join(', ')})`);
      if (kind) where.push(`pl.kind = ${p(kind)}`);
      if (project) where.push(`EXISTS (SELECT 1 FROM usages u WHERE u.part_id = pl.id AND u.project = ${p(project)})`);
      if (supplier) where.push(`EXISTS (SELECT 1 FROM prices x WHERE x.part_id = pl.id AND x.supplier_id = ${p(Number(supplier))})`);
      const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = get(`SELECT count(*) AS n FROM part_latest pl ${cond}`, ...params).n;
      const idx = cats.index();
      // 模組沒有自己的 3D 模型時，縮圖用第一個有模型的子件
      const parts = all(`SELECT pl.*, (SELECT group_concat(DISTINCT project) FROM usages WHERE part_id = pl.id) AS projects,
          (SELECT count(*) FROM prices WHERE part_id = pl.id) AS price_count, (SELECT count(*) FROM files WHERE part_id = pl.id) AS file_count,
          coalesce(nullif(pl.model_id, ''), (SELECT c.model_id FROM part_links l JOIN parts c ON c.id = l.related_id WHERE l.part_id = pl.id AND l.rel = 'component' AND c.model_id <> '' ORDER BY l.id LIMIT 1), '') AS thumb_model_id,
          (SELECT count(*) FROM part_links l WHERE l.part_id = pl.id AND l.rel = 'component') AS component_count
        FROM part_latest pl ${cond} ORDER BY ${cats.orderSql()}, pl.name, pl.model, pl.id LIMIT ${Math.max(1, Math.min(5000, Number(limit) || 500))}`, ...params)
        .map(r => ({ ...withAttrs(r), projects: r.projects ? r.projects.split(',').sort() : [], category_path: idx.byId.get(r.category_id)?.path || [], ...modulePrice(r) }));
      return { parts, total, ...this.facets() };
    },
    // 分類樹（介面的樹狀選單）
    tree: () => cats.tree(),
    facets() { return {
      pending: get('SELECT count(*) AS n FROM parts WHERE status = ?', PENDING).n,
      tree: this.tree(),
      groups: [...new Set([...Object.keys(GROUPS), ...all("SELECT DISTINCT grp FROM parts WHERE grp <> '' ORDER BY grp").map(r => r.grp)])],
      categories: all('SELECT category AS name, count(*) AS count FROM parts GROUP BY category ORDER BY category'),
      projects: all('SELECT project AS name, count(DISTINCT part_id) AS count FROM usages GROUP BY project ORDER BY project'),
      units: all("SELECT DISTINCT unit FROM parts WHERE unit <> '' ORDER BY unit").map(r => r.unit),
      brands: all("SELECT DISTINCT brand FROM parts WHERE brand <> '' ORDER BY brand").map(r => r.brand),
    }; },
    // id 可以是內部的流水 id，也可以是元件編號（P-00132）
    getPart(id) {
      const part = withAttrs(CODE_RE.test(String(id)) ? this.findByCode(id) || need('parts', -1, `元件 ${id}`) : need('parts', id, '元件'));
      return {
        ...part, model_params: JSON.parse(part.model_params || '{}'),
        category_path: part.category_id != null ? cats.index().byId.get(part.category_id)?.path || [] : [],
        fields: cats.fieldsOf(part.category_id), missing: cats.missing(part.attrs, part.category_id),
        prices: all('SELECT x.*, s.name AS supplier FROM prices x LEFT JOIN suppliers s ON s.id = x.supplier_id WHERE x.part_id = ? ORDER BY x.quoted_on DESC, x.id DESC', part.id),
        usages: all('SELECT * FROM usages WHERE part_id = ? ORDER BY project, source, item_code, id', part.id),
        files: all('SELECT * FROM files WHERE part_id = ? ORDER BY id', part.id),
        links: links.linksOf(part.id),
        ...(part.kind === 'module' ? { sum: links.sumPrice(part.id) } : {}),
      };
    },
    // 分類樹與欄位範本（lib/categories.mjs）、關聯件與模組（lib/part-links.mjs）
    categories: cats,
    links,
    findByCode: code => get('SELECT * FROM parts WHERE code = ? COLLATE NOCASE', String(code).trim()),
    // 名稱與型號完全相同（不分大小寫、不計空白）的既有元件：自動匯入時用來避免重複新增
    findSame(name, model = '') {
      const n = s => String(s || '').toLowerCase().replace(/[\s　]+/g, '');
      return all('SELECT * FROM parts WHERE lower(name) = lower(?) ORDER BY id', String(name).trim()).find(p => n(p.model) === n(model))
        || all('SELECT * FROM parts ORDER BY id').find(p => n(p.name) === n(name) && n(p.model) === n(model)) || null;
    },
    // 附件：內容寫到 files/<SHA-256>；kind 是用途（報價單、圖片…，沒給就依副檔名猜），price_id 是這份報價單對應的價格紀錄
    addFile(partId, { name, data, note = '', kind = '', by = '', priceId = null }) {
      const p = need('parts', partId, '元件'), safe = String(name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 120);
      if (!safe || /^\.+$/.test(safe)) bad('請提供檔名');
      if (!filesDir) bad('記憶體資料庫不能存附件');
      const meta = cleanFileMeta(p.id, { kind: kind || guessKind(safe), price_id: priceId });
      const sha = sha256(data);
      storeBlob(sha, data);
      const id = insert('files', { part_id: p.id, name: safe, size: data.length, note: text(note), added_at: now(), mime: mimeOf(safe), sha256: sha, uploaded_by: text(by), ...meta });
      touch(p.id);
      return get('SELECT * FROM files WHERE id = ?', id);
    },
    updateFile(id, v) {
      const f = need('files', id, '附件');
      update('files', f.id, { ...cleanFileMeta(f.part_id, { kind: v.kind ?? f.kind, price_id: v.price_id === undefined ? f.price_id : v.price_id }), note: text(v.note ?? f.note) });
      touch(f.part_id);
      return get('SELECT * FROM files WHERE id = ?', f.id);
    },
    fileOf(id) { const f = need('files', id, '附件'); return { ...f, path: blobPath(f.sha256), type: fileType(f.name) }; },
    deleteFile(id) { const f = need('files', id, '附件'); run('DELETE FROM files WHERE id = ?', f.id); dropBlobs([f.sha256]); touch(f.part_id); return { deleted: f.id }; },
    // createCategory：用文字指定分類時，找不到就建立（預設；代理提案帶進來的元件不建，放在群組底下或未分類）
    createPart(v, { createCategory = true } = {}) {
      const c = cleanPart(v), t = now(), place = placement(v, { createCategory }), kind = links.cleanKind(v, null);
      cats.checkAttrs(JSON.parse(c.attrs), place.category_id);
      return this.getPart(tx(() => {
        run("UPDATE meta SET value = value + 1 WHERE key = 'code_seq'");
        return insert('parts', { ...c, ...place, ...kind, model_params: cleanModelParams(v.model_params), code: codeOf(get("SELECT value FROM meta WHERE key = 'code_seq'").value), created_at: t, updated_at: t });
      }));
    },
    // cover_file_id：封面圖（這個元件的圖片附件）；沒給就不變，null 或空白是拿掉
    updatePart(id, v) {
      const p = need('parts', id, '元件'), c = { ...cleanPart(v), ...placement(v), ...links.cleanKind(v, p) };
      cats.checkAttrs(JSON.parse(c.attrs), c.category_id, JSON.parse(p.attrs || '{}'));
      if (v.model_params !== undefined) c.model_params = cleanModelParams(v.model_params);
      if (v.cover_file_id !== undefined) {
        const fid = v.cover_file_id === null || v.cover_file_id === '' ? null : Number(v.cover_file_id);
        if (fid != null) { const f = get('SELECT * FROM files WHERE id = ? AND part_id = ?', fid, p.id); if (!f) bad('封面圖要是這個元件的附件'); if (fileType(f.name) !== 'image') bad('封面圖要是圖片檔'); }
        c.cover_file_id = fid;
      }
      update('parts', p.id, { ...c, updated_at: now() });
      return this.getPart(p.id);
    },
    deletePart(id) {
      const p = need('parts', id, '元件'), files = all('SELECT * FROM files WHERE part_id = ?', p.id);
      run('DELETE FROM parts WHERE id = ?', p.id);
      dropBlobs(files.map(f => f.sha256));
      return { deleted: p.id, code: p.code };
    },
    // 合併重複的元件：drop 的價格與使用紀錄移到 keep，keep 空白的欄位用 drop 補上，再刪掉 drop
    mergeParts(keepId, dropId) {
      const keep = need('parts', keepId, '元件'), drop = need('parts', dropId, '元件');
      if (keep.id === drop.id) bad('不能和自己合併');
      return tx(() => {
        run('UPDATE prices SET part_id = ? WHERE part_id = ?', keep.id, drop.id);
        run('UPDATE usages SET part_id = ? WHERE part_id = ?', keep.id, drop.id);
        run('UPDATE files SET part_id = ? WHERE part_id = ?', keep.id, drop.id);
        const fill = Object.fromEntries(PART_TEXT.filter(k => k !== 'grp' && k !== 'category' && !keep[k] && drop[k]).map(k => [k, drop[k]]));
        if (keep.category_id == null && drop.category_id != null) Object.assign(fill, { category_id: drop.category_id, ...cats.textOf(drop.category_id) });      // 分類也用併入的補
        update('parts', keep.id, { ...fill, attrs: JSON.stringify({ ...JSON.parse(drop.attrs || '{}'), ...JSON.parse(keep.attrs || '{}') }), updated_at: now() });
        run('DELETE FROM parts WHERE id = ?', drop.id);
        return this.getPart(keep.id);
      });
    },

    addPrice(partId, v) {
      const p = need('parts', partId, '元件'), c = cleanPrice(v); needSupplier(c.supplier_id);
      const id = insert('prices', { ...c, part_id: p.id, created_at: now() }); touch(p.id);
      return get('SELECT * FROM prices WHERE id = ?', id);
    },
    updatePrice(id, v) {
      const x = need('prices', id, '價格紀錄'), c = cleanPrice(v); needSupplier(c.supplier_id);
      update('prices', x.id, c); touch(x.part_id);
      return get('SELECT * FROM prices WHERE id = ?', x.id);
    },
    deletePrice(id) { const x = need('prices', id, '價格紀錄'); run('DELETE FROM prices WHERE id = ?', x.id); touch(x.part_id); return { deleted: x.id }; },

    addUsage(partId, v) {
      const p = need('parts', partId, '元件'), id = insert('usages', { ...cleanUsage(v), part_id: p.id, created_at: now() }); touch(p.id);
      return get('SELECT * FROM usages WHERE id = ?', id);
    },
    updateUsage(id, v) { const u = need('usages', id, '使用紀錄'); update('usages', u.id, cleanUsage(v)); touch(u.part_id); return get('SELECT * FROM usages WHERE id = ?', u.id); },
    deleteUsage(id) { const u = need('usages', id, '使用紀錄'); run('DELETE FROM usages WHERE id = ?', u.id); touch(u.part_id); return { deleted: u.id }; },
    findUsage: (project, source, itemCode) => get('SELECT * FROM usages WHERE project = ? AND source = ? AND item_code = ? ORDER BY id LIMIT 1', project, source, itemCode),

    listSuppliers: () => all(`SELECT s.*, (SELECT count(*) FROM prices WHERE supplier_id = s.id) AS price_count,
        (SELECT count(DISTINCT part_id) FROM prices WHERE supplier_id = s.id) AS part_count FROM suppliers s ORDER BY s.name`),
    getSupplier: id => need('suppliers', id, '供應商'),
    findSupplier: name => get('SELECT * FROM suppliers WHERE name = ?', text(name)),
    createSupplier(v) { const t = now(), c = cleanSupplier(v); return this.getSupplier(unique(() => insert('suppliers', { ...c, created_at: t, updated_at: t }))); },
    updateSupplier(id, v) { const s = need('suppliers', id, '供應商'), c = cleanSupplier(v); unique(() => update('suppliers', s.id, { ...c, updated_at: now() })); return this.getSupplier(s.id); },
    // 刪除供應商：價格紀錄留著，只是不再連到供應商
    deleteSupplier(id) { const s = need('suppliers', id, '供應商'); run('DELETE FROM suppliers WHERE id = ?', s.id); return { deleted: s.id }; },

    // 儀表板用的統計：各類別數量、各專案用到的元件數、各成本表的參考金額（數量 × 最新單價，只算新台幣）、30 天內到期或已過期的報價、待整理的數量
    overview(today = new Date().toLocaleDateString('sv')) {
      const soon = new Date(Date.parse(today) + 30 * 864e5).toISOString().slice(0, 10);
      const q = get(`SELECT count(*) AS total, sum(category = '') AS uncategorized, sum(unit_price IS NULL) AS unpriced, sum(unit_price IS NOT NULL AND supplier_id IS NULL) AS noSupplier FROM part_latest`);
      return {
        today, ...this.stats(),
        categories: (idx => all('SELECT category_id AS id, count(*) AS count FROM parts GROUP BY category_id ORDER BY count DESC').map(r => ({ name: idx.byId.get(r.id)?.path.join(' › ') || '', count: r.count })))(cats.index()),
        projects: all('SELECT project AS name, count(DISTINCT part_id) AS parts FROM usages GROUP BY project ORDER BY parts DESC, project'),
        sources: all(`SELECT u.project, u.source, count(*) AS items, sum(CASE WHEN pl.currency = 'TWD' THEN coalesce(u.qty, 0) * coalesce(pl.unit_price, 0) ELSE 0 END) AS amount
          FROM usages u JOIN part_latest pl ON pl.id = u.part_id GROUP BY u.project, u.source ORDER BY u.project, u.source`),
        expiring: all(`SELECT id, name, brand, model, unit_price, currency, valid_until, supplier FROM part_latest WHERE valid_until <> '' AND valid_until <= ? ORDER BY valid_until, id LIMIT 20`, soon),
        quality: { total: q.total, uncategorized: q.uncategorized || 0, unpriced: q.unpriced || 0, noSupplier: q.noSupplier || 0, pending: get('SELECT count(*) AS n FROM parts WHERE status = ?', PENDING).n },
      };
    },
    // 專案成員（依專案分權限）：project 是介面用的專案代號（本庫的站是 @<名稱>）；role 是 owner 或 member
    members: project => all('SELECT user, role, added_by, added_at FROM project_members WHERE project = ? ORDER BY role DESC, user', String(project)),
    allMembers() {
      const map = {};
      for (const r of all('SELECT project, user, role FROM project_members ORDER BY project, role DESC, user')) (map[r.project] ||= []).push({ user: r.user, role: r.role });
      return map;
    },
    // 整份換掉；至少要有一個擁有者（清空成員就回到「所有一般帳號都能動」）
    setMembers(project, list, by = '') {
      const rows = (list || []).map(m => ({ user: text(m.user), role: m.role === 'owner' ? 'owner' : 'member' })).filter(m => m.user);
      if (rows.length && !rows.some(m => m.role === 'owner')) bad('至少要有一個擁有者');
      if (new Set(rows.map(m => m.user.toLowerCase())).size !== rows.length) bad('成員重複了');
      tx(() => { run('DELETE FROM project_members WHERE project = ?', String(project)); for (const m of rows) insert('project_members', { project: String(project), ...m, added_by: text(by), added_at: now() }); });
      return this.members(project);
    },
    // 建立專案的人成為擁有者（已經有成員時不動）
    claimProject(project, user) { if (user && !get('SELECT 1 AS x FROM project_members WHERE project = ?', String(project))) insert('project_members', { project: String(project), user, role: 'owner', added_by: user, added_at: now() }); },
    dropMembers: project => { run('DELETE FROM project_members WHERE project = ?', String(project)); },

    // 系統設定：值以 JSON 存；預設值與驗證在 lib/settings.mjs
    readSettings: () => Object.fromEntries(all('SELECT key, value FROM settings').map(r => [r.key, JSON.parse(r.value)])),
    writeSettings(values, by = '') {
      tx(() => { for (const [k, v] of Object.entries(values)) run(`INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`, k, JSON.stringify(v), text(by), now()); });
    },
    stats: () => get('SELECT (SELECT count(*) FROM parts) AS parts, (SELECT count(*) FROM prices) AS prices, (SELECT count(*) FROM usages) AS usages, (SELECT count(*) FROM suppliers) AS suppliers'),
  };
}
