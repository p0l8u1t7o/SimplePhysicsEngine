// BOM 與成本表（評估平台 Q3，2026-10-06 拍板：元件有版本，專案記錄使用當時的版本；元件更新後專案成本不跟著變，
// 平台提示新版並做差異比較，可以逐行或全部升級，升級前自動留快照）。
//   boms          專案的 BOM：每個專案一份「目前」（status = current），另外有凍結的快照（status = snapshot，frozen 是當時的計算結果）
//   bom_items     一行：引用元件（part_id＋鎖定的 part_version）、工程人日（labor = eng／tech）或客製件（自己的單價）
//   bom_upgrades  升級紀錄：哪一行、舊版 → 新版、單價差、誰、什麼時候
//   fx_rates      匯率（每 1 單位外幣折合新台幣、日期）；BOM 的設定記著用哪一天的匯率
// 成本的算法照各站原本的成本表：小計 = 數量 × 單價；上下限依等級幅度（A ±10%、B ±20%、C ±30%）；
// 設備＋工程人日＋已選選配 = 小計，×（1＋預備費）= 主數字，再 ×（1＋稅）= 含稅；上下限是逐行幅度加總 ×（1＋預備費）。
export const V6_BOM = `
CREATE TABLE boms (id INTEGER PRIMARY KEY, project TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'current',
  settings TEXT NOT NULL DEFAULT '{}', frozen TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX boms_current ON boms(project) WHERE status = 'current';
CREATE TABLE bom_items (id INTEGER PRIMARY KEY, bom_id INTEGER NOT NULL REFERENCES boms(id) ON DELETE CASCADE, sort INTEGER NOT NULL DEFAULT 0,
  line TEXT NOT NULL DEFAULT '', section TEXT NOT NULL DEFAULT '', grp TEXT NOT NULL DEFAULT '', nature TEXT NOT NULL DEFAULT 'equipment',
  part_id INTEGER REFERENCES parts(id), part_version INTEGER, labor TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '', spec TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 1, unit TEXT NOT NULL DEFAULT '', unit_price REAL, currency TEXT NOT NULL DEFAULT 'TWD', grade TEXT NOT NULL DEFAULT '',
  no_scene INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '');
CREATE INDEX bom_items_bom ON bom_items(bom_id, sort);
CREATE INDEX bom_items_part ON bom_items(part_id);
CREATE TABLE bom_upgrades (id INTEGER PRIMARY KEY, bom_id INTEGER NOT NULL REFERENCES boms(id) ON DELETE CASCADE, item_id INTEGER, line TEXT NOT NULL DEFAULT '',
  part_id INTEGER, from_version INTEGER, to_version INTEGER, from_price REAL, to_price REAL, by TEXT NOT NULL DEFAULT '', at TEXT NOT NULL);
CREATE TABLE fx_rates (currency TEXT NOT NULL, rate REAL NOT NULL, date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', PRIMARY KEY (currency, date));
`;

// 成本費率的預設值（系統設定 cost.* 的預設也用這份，lib/settings.mjs）
export const COST_DEFAULTS = { engRate: 8000, techRate: 5500, contingency: 0.15, tax: 0.05, gradeRange: { A: 0.1, B: 0.2, C: 0.3 } };
export const NATURES = { equipment: '設備與材料', labor: '工程人日', option: '選配' };
export const LABOR = { eng: '工程師', tech: '技術員' };
const ITEM_TEXT = ['line', 'section', 'grp', 'name', 'spec', 'model', 'reason', 'unit', 'note'];
const text = v => v == null ? '' : String(v).trim();
const today = () => new Date().toLocaleDateString('sv');
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
// 金額取到小數兩位（避免浮點誤差累積；新台幣報價通常是整數）
const r2 = n => Math.round(n * 100) / 100;

// db：partsdb 的小工具；versions：lib/versions.mjs；actor()：目前在改的人；system()：系統設定（資料庫裡存的值）
export function bomOps({ all, get, run, insert, update, tx, now, fail, findPart, versions, actor, system }) {
  const by = () => actor() || '';
  // 新 BOM 的成本設定：系統設定的 cost.*（沒存就用預設），匯率日期是今天
  function defaultSettings() {
    const s = system(), pick = k => s[`cost.${k}`] ?? COST_DEFAULTS[k];
    return { engRate: pick('engRate'), techRate: pick('techRate'), contingency: pick('contingency'), tax: pick('tax'), gradeRange: { ...COST_DEFAULTS.gradeRange, ...pick('gradeRange') }, fxDate: today() };
  }
  function cleanSettings(v, cur) {
    const out = { ...cur }, num = (k, max, label) => { if (v[k] === undefined) return; const n = Number(v[k]); if (v[k] === '' || !Number.isFinite(n) || n < 0 || n > max) fail(`${label}要是 0～${max} 的數字`); out[k] = n; };
    num('engRate', 1e6, '工程人日費率'); num('techRate', 1e6, '技術人日費率'); num('contingency', 1, '預備金比例'); num('tax', 1, '稅率');
    if (v.gradeRange !== undefined) out.gradeRange = Object.fromEntries(['A', 'B', 'C'].map(g => { const n = Number(v.gradeRange?.[g]); if (!Number.isFinite(n) || n < 0 || n > 1) fail(`等級 ${g} 的幅度要是 0～1`); return [g, n]; }));
    if (v.fxDate !== undefined) { if (!isDate(text(v.fxDate))) fail('匯率日期的格式是 YYYY-MM-DD'); out.fxDate = text(v.fxDate); }
    return out;
  }
  const bomRow = b => b && { ...b, settings: JSON.parse(b.settings || '{}'), frozen: b.frozen ? JSON.parse(b.frozen) : null };
  const current = project => bomRow(get("SELECT * FROM boms WHERE project = ? AND status = 'current'", String(project)));
  const needCurrent = project => current(project) || fail(`專案 ${project} 還沒有 BOM`, 404);
  const needItem = id => get('SELECT * FROM bom_items WHERE id = ?', Number(id)) || fail(`找不到 BOM 的這一行（${id}）`, 404);
  const touchBom = id => run('UPDATE boms SET updated_at = ? WHERE id = ?', now(), id);

  // 匯率：currency 在 date（含）以前最近的一筆；新台幣是 1；沒有就是 null
  function rate(currency, date) {
    if (!currency || currency === 'TWD') return 1;
    return get('SELECT rate FROM fx_rates WHERE currency = ? AND date <= ? ORDER BY date DESC LIMIT 1', currency, date)?.rate ?? null;
  }

  function cleanItem(v, cur = {}) {
    const o = Object.fromEntries(ITEM_TEXT.filter(k => v[k] !== undefined).map(k => [k, text(v[k])]));
    if (v.nature !== undefined) { if (!NATURES[v.nature]) fail(`性質只能是：${Object.values(NATURES).join('、')}`); o.nature = v.nature; }
    if (v.labor !== undefined) { const l = text(v.labor); if (l && !LABOR[l]) fail('工程人日只能是工程師或技術員'); o.labor = l; }
    if (v.qty !== undefined) { const n = Number(v.qty); if (v.qty === '' || !Number.isFinite(n) || n < 0) fail('數量要是 0 以上的數字'); o.qty = n; }
    if (v.unit_price !== undefined) { if (v.unit_price === null || v.unit_price === '') o.unit_price = null; else { const n = Number(v.unit_price); if (!Number.isFinite(n) || n < 0) fail('單價要是 0 以上的數字'); o.unit_price = n; } }
    if (v.currency !== undefined) o.currency = (text(v.currency) || 'TWD').toUpperCase();
    if (v.grade !== undefined) { const g = text(v.grade).toUpperCase(); if (g && !['A', 'B', 'C'].includes(g)) fail('等級只能是 A、B、C 或留白'); o.grade = g; }
    if (v.no_scene !== undefined) o.no_scene = v.no_scene ? 1 : 0;
    const m = { ...cur, ...o };
    if (m.labor) { m.nature = 'labor'; o.nature = 'labor'; }
    if (!m.part_id && !m.labor && !text(m.name)) fail('客製件要寫名稱');
    return o;
  }

  // 一行的計算：單價來源（鎖定版本的參考單價／自己填的單價／人日費率）、折合新台幣、小計、上下限、提醒
  function line(it, s, todayStr = today()) {
    const ver = it.part_id ? versions.get(it.part_id, it.part_version) : null, snap = ver?.snapshot;
    const part = it.part_id ? get('SELECT id, code, version, status FROM parts WHERE id = ?', it.part_id) : null;
    let price = null, currency = 'TWD', source = 'custom', grade = it.grade, flags = [];
    if (it.unit_price != null) { price = it.unit_price; currency = it.currency || 'TWD'; source = it.labor ? 'labor-override' : it.part_id ? 'override' : 'custom'; }
    else if (it.labor) { price = it.labor === 'tech' ? s.techRate : s.engRate; source = 'labor'; }
    else if (snap?.price) {
      price = snap.price.unit_price; currency = snap.price.currency || 'TWD'; source = 'version'; grade = grade || snap.price.grade || '';
      if (snap.price.valid_until && snap.price.valid_until < todayStr) flags.push('expired');
      if (snap.price.missing?.length || snap.price.foreign?.length) flags.push('partialSum');
    }
    if (price == null) flags.push('noPrice');
    const fx = price == null ? 1 : rate(currency, s.fxDate);
    if (fx == null) flags.push('noFx');
    const unitTwd = price == null || fx == null ? null : r2(price * fx);
    if (!grade && it.labor) grade = 'B';
    if (!grade) { grade = 'C'; flags.push('noGrade'); }
    if (grade === 'C') flags.push('estimate');
    if (part?.status === '待確認') flags.push('pending');
    const range = s.gradeRange[grade] ?? 0.3, subtotal = unitTwd == null ? 0 : r2(unitTwd * it.qty);
    return {
      id: it.id, sort: it.sort, line: it.line, section: it.section, grp: it.grp, nature: it.nature, labor: it.labor, part_id: it.part_id, part_version: it.part_version,
      code: part?.code || '', latest_version: part?.version ?? null, newer: !!(part && it.part_version != null && part.version > it.part_version),
      name: it.name || snap?.name || '', spec: it.spec || snap?.spec || '', model: it.model || [snap?.brand, snap?.model].filter(Boolean).join(' '), reason: it.reason,
      qty: it.qty, unit: it.unit || snap?.unit || (it.labor ? '人日' : ''), price, currency, fx, unit_twd: unitTwd, source, grade,
      subtotal, low: r2(subtotal * (1 - range)), high: r2(subtotal * (1 + range)), no_scene: !!it.no_scene, note: it.note, flags,
    };
  }
  // 摘要：依性質加總，再算預備費、上下限、含稅；有分部（grp）時每個分部也算一份
  function summarize(lines, s) {
    const sum = list => {
      const by = n => r2(list.filter(l => l.nature === n).reduce((a, l) => a + l.subtotal, 0));
      const equipment = by('equipment'), labor = by('labor'), option = by('option'), subtotal = r2(equipment + labor + option), k = 1 + s.contingency;
      return { equipment, labor, option, subtotal, contingency: r2(subtotal * s.contingency), total: r2(subtotal * k),
        low: r2(list.reduce((a, l) => a + l.low, 0) * k), high: r2(list.reduce((a, l) => a + l.high, 0) * k), taxed: r2(subtotal * k * (1 + s.tax)),
        laborDays: r2(list.filter(l => l.labor).reduce((a, l) => a + l.qty, 0)) };
    };
    const groups = [...new Set(lines.map(l => l.grp).filter(Boolean))];
    const count = f => lines.filter(l => l.flags.includes(f)).length;
    return { ...sum(lines), groups: groups.map(g => ({ grp: g, ...sum(lines.filter(l => l.grp === g)) })),
      flags: { estimate: count('estimate'), expired: count('expired'), pending: count('pending'), noPrice: count('noPrice'), noFx: count('noFx'), newer: lines.filter(l => l.newer).length } };
  }
  function compute(bom) {
    const items = all('SELECT * FROM bom_items WHERE bom_id = ? ORDER BY sort, id', bom.id), s = bom.settings;
    const lines = items.map(it => line(it, s));
    return { lines, summary: summarize(lines, s), settings: s };
  }
  const nextSort = bomId => (get('SELECT max(sort) AS m FROM bom_items WHERE bom_id = ?', bomId).m ?? -1) + 1;

  const ops = {
    NATURES, LABOR,
    current,
    // 目前的 BOM（沒有就建一份空的，成本設定取系統設定）
    ensure(project, { name = 'R1', note = '' } = {}) {
      const b = current(project); if (b) return b;
      const t = now(); insert('boms', { project: String(project), name, status: 'current', settings: JSON.stringify(defaultSettings()), note, created_by: by(), created_at: t, updated_at: t });
      return current(project);
    },
    // 成本表：目前的 BOM＋即時計算；沒有 BOM 回傳 null
    get(project) { const b = current(project); return b ? { bom: { ...b, frozen: null }, ...compute(b), snapshots: ops.snapshots(project), upgrades: ops.upgrades(b.id) } : null; },
    snapshots: project => all("SELECT id, name, note, created_by, created_at FROM boms WHERE project = ? AND status = 'snapshot' ORDER BY id DESC", String(project)),
    upgrades: bomId => all('SELECT u.*, p.code FROM bom_upgrades u LEFT JOIN parts p ON p.id = u.part_id WHERE u.bom_id = ? ORDER BY u.id DESC LIMIT 100', bomId),
    updateSettings(project, v) { const b = ops.ensure(project); run('UPDATE boms SET settings = ?, updated_at = ? WHERE id = ?', JSON.stringify(cleanSettings(v, b.settings)), now(), b.id); return ops.get(project); },
    // 加一行：引用元件時鎖定元件目前的版本；labor 是工程人日；都沒有是客製件
    addItem(project, v) {
      const b = ops.ensure(project);
      const part = v.part != null && v.part !== '' ? findPart(v.part) || fail(`找不到元件（${v.part}）`, 404) : null;
      const o = cleanItem(v, { part_id: part?.id });
      const id = insert('bom_items', { bom_id: b.id, sort: v.sort != null ? Number(v.sort) : nextSort(b.id), nature: 'equipment', qty: 1, ...o, part_id: part?.id ?? null, part_version: part ? part.version : null });
      touchBom(b.id);
      return line(get('SELECT * FROM bom_items WHERE id = ?', id), b.settings);
    },
    updateItem(id, v) {
      const it = needItem(id), b = bomRow(get('SELECT * FROM boms WHERE id = ?', it.bom_id));
      if (b.status !== 'current') fail('快照不能修改');
      update('bom_items', it.id, cleanItem(v, it)); touchBom(b.id);
      return line(needItem(it.id), b.settings);
    },
    deleteItem(id) {
      const it = needItem(id), b = get('SELECT status FROM boms WHERE id = ?', it.bom_id);
      if (b.status !== 'current') fail('快照不能修改');
      run('DELETE FROM bom_items WHERE id = ?', it.id); touchBom(it.bom_id);
      return { deleted: it.id };
    },
    // 有新版的行：鎖定版本 → 最新版本，列出改了哪些欄位、單價與小計的差
    newVersions(project) {
      const b = current(project); if (!b) return [];
      return compute(b).lines.filter(l => l.newer).map(l => {
        const latest = line({ ...needItem(l.id), part_version: l.latest_version }, b.settings);
        return { id: l.id, line: l.line, code: l.code, name: l.name, from: l.part_version, to: l.latest_version, diff: versions.compare(l.part_id, l.part_version, l.latest_version) || [],
          from_price: l.unit_twd, to_price: latest.unit_twd, from_subtotal: l.subtotal, to_subtotal: latest.subtotal, delta: r2(latest.subtotal - l.subtotal) };
      });
    },
    // 升級：ids 是要升級的行（'all' 是全部）；升級前自動留一份快照；回傳 { snapshot, upgraded }
    upgrade(project, ids = 'all') {
      const b = needCurrent(project), todo = ops.newVersions(project).filter(n => ids === 'all' || ids.map(Number).includes(n.id));
      if (!todo.length) fail('沒有可以升級的行');
      return tx(() => {
        const snap = ops.snapshot(project, { name: `${b.name} 升級前`, note: `升級 ${todo.length} 行之前自動保存` });
        for (const n of todo) {
          run('UPDATE bom_items SET part_version = ? WHERE id = ?', n.to, n.id);
          insert('bom_upgrades', { bom_id: b.id, item_id: n.id, line: n.line, part_id: needItem(n.id).part_id, from_version: n.from, to_version: n.to, from_price: n.from_price, to_price: n.to_price, by: by(), at: now() });
        }
        touchBom(b.id);
        return { snapshot: snap, upgraded: todo.length };
      });
    },
    // 快照：凍結目前的 BOM（行與當時的計算結果）；之後不能改，只能看、比較、匯出
    snapshot(project, { name = '', note = '' } = {}) {
      const b = needCurrent(project), t = now(), n = get("SELECT count(*) AS n FROM boms WHERE project = ? AND status = 'snapshot'", String(project)).n;
      return tx(() => {
        const id = insert('boms', { project: String(project), name: text(name) || `快照 ${n + 1}`, status: 'snapshot', settings: JSON.stringify(b.settings), frozen: '',
          note: text(note), created_by: by(), created_at: t, updated_at: t });
        for (const it of all('SELECT * FROM bom_items WHERE bom_id = ?', b.id)) { const { id: _, bom_id: __, ...rest } = it; insert('bom_items', { ...rest, bom_id: id }); }
        // 用快照自己的行計算後凍結（行的 id 是快照的）
        run('UPDATE boms SET frozen = ? WHERE id = ?', JSON.stringify(compute({ id, settings: b.settings })), id);
        return { id, name: text(name) || `快照 ${n + 1}`, created_at: t };
      });
    },
    getSnapshot(id) {
      const s = bomRow(get("SELECT * FROM boms WHERE id = ? AND status = 'snapshot'", Number(id))) || fail(`找不到快照（${id}）`, 404);
      return { bom: { ...s, frozen: null }, ...s.frozen };
    },
    // 快照和目前比較：依行號對照，列出新增、刪除、單價或數量改變的行，以及總計的差
    compare(project, snapshotId) {
      const cur = ops.get(project) || fail(`專案 ${project} 還沒有 BOM`, 404), old = ops.getSnapshot(snapshotId);
      if (old.bom.project !== String(project)) fail('這份快照不是這個專案的', 400);
      const key = l => l.line || `#${l.id}`, a = new Map(old.lines.map(l => [key(l), l])), b = new Map(cur.lines.map(l => [key(l), l]));
      const rows = [];
      for (const [k, l] of b) { const o = a.get(k); if (!o) rows.push({ line: k, change: 'added', name: l.name, to: l.subtotal, delta: l.subtotal });
        else if (o.subtotal !== l.subtotal || o.qty !== l.qty || o.part_version !== l.part_version) rows.push({ line: k, change: 'changed', name: l.name, from: o.subtotal, to: l.subtotal, delta: r2(l.subtotal - o.subtotal), qty: [o.qty, l.qty], version: [o.part_version, l.part_version] }); }
      for (const [k, o] of a) if (!b.has(k)) rows.push({ line: k, change: 'removed', name: o.name, from: o.subtotal, delta: -o.subtotal });
      const d = k => r2(cur.summary[k] - old.summary[k]);
      return { snapshot: old.bom, rows, totals: { subtotal: d('subtotal'), total: d('total'), taxed: d('taxed') }, from: old.summary, to: cur.summary };
    },
    // 整份換掉（成本表轉換、代理的 bom.json）：items 照順序；part 可以是元件編號或 id
    replaceItems(project, items) {
      const b = ops.ensure(project);
      return tx(() => {
        run('DELETE FROM bom_items WHERE bom_id = ?', b.id);
        items.forEach((v, i) => ops.addItem(project, { ...v, sort: i }));
        touchBom(b.id);
        return ops.get(project);
      });
    },
    // 有新版元件的專案（儀表板與專案清單用）：{ 專案: 行數 }
    newerByProject() {
      const out = {};
      for (const r of all("SELECT b.project, count(*) AS n FROM bom_items i JOIN boms b ON b.id = i.bom_id JOIN parts p ON p.id = i.part_id WHERE b.status = 'current' AND p.version > i.part_version GROUP BY b.project")) out[r.project] = r.n;
      return out;
    },
    // 這一行屬於哪個專案（HTTP 介面檢查權限用）；找不到是 null
    itemProject: id => get('SELECT b.project FROM bom_items i JOIN boms b ON b.id = i.bom_id WHERE i.id = ?', Number(id))?.project ?? null,
    // 匯率
    fxRates: () => all('SELECT * FROM fx_rates ORDER BY currency, date DESC'),
    setFx(v) {
      const currency = text(v.currency).toUpperCase(), r = Number(v.rate), date = text(v.date) || today();
      if (!/^[A-Z]{3}$/.test(currency) || currency === 'TWD') fail('幣別要是三個英文字母（新台幣不用設定）');
      if (!(r > 0)) fail('匯率要大於 0（每 1 單位外幣折合多少新台幣）');
      if (!isDate(date)) fail('日期的格式是 YYYY-MM-DD');
      run('INSERT INTO fx_rates (currency, rate, date, note) VALUES (?, ?, ?, ?) ON CONFLICT(currency, date) DO UPDATE SET rate = excluded.rate, note = excluded.note', currency, r, date, text(v.note));
      return ops.fxRates();
    },
    deleteFx(currency, date) { run('DELETE FROM fx_rates WHERE currency = ? AND date = ?', text(currency).toUpperCase(), text(date)); return ops.fxRates(); },
    rate,
  };
  return ops;
}
