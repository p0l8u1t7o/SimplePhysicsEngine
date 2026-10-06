// 元件的版本（評估平台 Q3，2026-10-06 拍板：影響選型或成本的欄位儲存就升版；專案 BOM 鎖定使用當時的版本）。
//   part_versions  每一版的完整快照（JSON）、這一版改了哪些欄位、誰、什麼時候
//   parts.version  目前的版本號
// 快照的內容：名稱、廠牌、型號、規格、規格欄位 attrs、單位、種類、模組單價算法、3D 模型參數、目前的參考單價（最新一筆價格；
// 子件加總的模組是加總結果）、模組的子件（編號、數量、子件當時的版本）。
// 不升版的欄位：備註、標籤、選型備註、替代方案文字、資料連結、狀態、封面圖、3D 模型、分類（直接改在目前版本上）。
// 每次會改到元件的操作之後呼叫 bump：快照和最新一版不同才升版，所以重複呼叫不會多出版本。
export const V6_VERSIONS = `
ALTER TABLE parts ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE part_versions (id INTEGER PRIMARY KEY, part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE, version INTEGER NOT NULL,
  snapshot TEXT NOT NULL, changed TEXT NOT NULL DEFAULT '[]', by TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', at TEXT NOT NULL, UNIQUE (part_id, version));
`;
// 快照裡各欄位的中文名稱（版本紀錄與差異比較用）
export const FIELD_LABELS = { name: '名稱', brand: '廠牌', model: '型號', spec: '規格', unit: '單位', kind: '種類', price_mode: '模組單價算法', model_params: '3D 模型參數', price: '參考單價', components: '模組組成' };

const PRICE_KEYS = ['unit_price', 'currency', 'grade', 'quoted_on', 'valid_until', 'source'];
const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// 兩個快照的差異：[{ key, label, from, to }]；規格欄位逐欄列出（key 是 attrs.<名稱>）
export function diffSnapshots(a, b) {
  const out = [], push = (key, label, from, to) => { if (!eq(from, to)) out.push({ key, label, from: from ?? null, to: to ?? null }); };
  for (const k of ['name', 'brand', 'model', 'spec', 'unit', 'kind', 'price_mode']) push(k, FIELD_LABELS[k], a?.[k], b?.[k]);
  for (const k of [...new Set([...Object.keys(a?.attrs || {}), ...Object.keys(b?.attrs || {})])].sort()) push(`attrs.${k}`, k, a?.attrs?.[k], b?.attrs?.[k]);
  push('model_params', FIELD_LABELS.model_params, a?.model_params, b?.model_params);
  push('price', FIELD_LABELS.price, a?.price, b?.price);
  push('components', FIELD_LABELS.components, a?.components, b?.components);
  return out;
}

// db：partsdb 的小工具；links：part-links 的 ops（模組加總）
export function versionOps({ all, get, run, insert, now, links }) {
  function snapshot(id) {
    const p = get('SELECT * FROM parts WHERE id = ?', id);
    if (!p) return null;
    let price = null;
    if (p.kind === 'module' && p.price_mode === 'sum') { const s = links.sumPrice(id); price = { unit_price: s.total, currency: 'TWD', grade: '', source: '子件加總', missing: s.missing, foreign: s.foreign }; }
    else { const pr = get('SELECT * FROM prices WHERE part_id = ? ORDER BY quoted_on DESC, id DESC LIMIT 1', id); if (pr) price = Object.fromEntries(PRICE_KEYS.map(k => [k, pr[k]])); }
    const components = p.kind === 'module' ? all("SELECT c.id AS part_id, c.code, l.qty, c.version FROM part_links l JOIN parts c ON c.id = l.related_id WHERE l.part_id = ? AND l.rel = 'component' ORDER BY c.code", id) : [];
    return { name: p.name, brand: p.brand, model: p.model, spec: p.spec, attrs: JSON.parse(p.attrs || '{}'), unit: p.unit, kind: p.kind, price_mode: p.price_mode,
      model_params: JSON.parse(p.model_params || '{}'), price, components };
  }
  const latest = id => { const v = get('SELECT * FROM part_versions WHERE part_id = ? ORDER BY version DESC LIMIT 1', id); return v && { ...v, snapshot: JSON.parse(v.snapshot), changed: JSON.parse(v.changed) }; };

  const ops = {
    snapshot,
    // 快照和最新一版不同才升版；回傳目前的版本號
    bump(id, { by = '', note = '' } = {}) {
      const snap = snapshot(id);
      if (!snap) return null;
      const last = latest(id);
      if (last && eq(last.snapshot, snap)) return last.version;
      const version = (last?.version || 0) + 1, changed = last ? diffSnapshots(last.snapshot, snap).map(d => d.key) : [];
      insert('part_versions', { part_id: id, version, snapshot: JSON.stringify(snap), changed: JSON.stringify(changed), by, note: note || (last ? '' : '建立'), at: now() });
      run('UPDATE parts SET version = ? WHERE id = ?', version, id);
      return version;
    },
    // 版本清單（新的在前），每一版附上和前一版的差異
    list(id) {
      const rows = all('SELECT * FROM part_versions WHERE part_id = ? ORDER BY version', id).map(v => ({ ...v, snapshot: JSON.parse(v.snapshot), changed: JSON.parse(v.changed) }));
      return rows.map((v, i) => ({ version: v.version, by: v.by, note: v.note, at: v.at, changed: v.changed, diff: i ? diffSnapshots(rows[i - 1].snapshot, v.snapshot) : [] })).reverse();
    },
    get(id, version) {
      const v = get('SELECT * FROM part_versions WHERE part_id = ? AND version = ?', id, Number(version));
      return v ? { ...v, snapshot: JSON.parse(v.snapshot), changed: JSON.parse(v.changed) } : null;
    },
    // 任兩版的差異
    compare(id, a, b) { const x = ops.get(id, a), y = ops.get(id, b); return x && y ? diffSnapshots(x.snapshot, y.snapshot) : null; },
    // 模組的子件出了新版、但模組還記著舊版的：[{ code, from, to }]（模組要按「更新模組」才會升版）
    childUpdates(id) {
      const last = latest(id);
      return (last?.snapshot.components || []).map(c => ({ ...c, now: get('SELECT version FROM parts WHERE id = ?', c.part_id)?.version }))
        .filter(c => c.now != null && c.now > c.version).map(c => ({ code: c.code, from: c.version, to: c.now }));
    },
  };
  return ops;
}
