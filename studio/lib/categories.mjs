// 元件的分類樹與欄位範本（評估平台 Q2，2026-10-06 拍板：分類由使用者自訂，不限層、介面最多 4 層，子分類繼承上層的欄位範本）。
//   categories       分類節點：上層 parent_id、名稱、排序、說明
//   category_fields  欄位範本：鍵（同時是元件 attrs 裡的名稱）、顯示名稱、型別（文字／數字／選項／是否）、單位、選項、必填、排序
// 元件的 parts.category_id 指到節點；舊的文字欄位 parts.grp／category 保留，由這裡同步成「最上層／最下層的名稱」，
// 給成本表匯入、代理的元件清單與命令列沿用。
// 「選項」型別的選項只是建議（可以填別的值），避免既有資料因為寫法不同存不回去；數字欄位只檢查有改動的值。
import { GROUPS } from './partsdb.mjs';      // 循環匯入沒關係：只在函式裡用到

export const MAX_DEPTH = 4;
export const OTHER = '其他';      // 只有類別、沒有群組時放的最上層
export const FIELD_TYPES = { text: '文字', number: '數字', select: '選項', bool: '是／否' };
const MOUNTS = ['C', 'CS', 'F', 'M42', 'M58', 'M72'];
// 預設的欄位範本（光學計算 Q4 會用）：只在那個分類還沒有任何欄位時加上
export const DEFAULT_FIELDS = {
  相機與讀碼: [
    { key: '感光元件寬', type: 'number', unit: 'mm' }, { key: '感光元件高', type: 'number', unit: 'mm' }, { key: '像素尺寸', type: 'number', unit: 'µm' },
    { key: '水平像素', type: 'number', unit: 'px' }, { key: '垂直像素', type: 'number', unit: 'px' }, { key: '幀率', type: 'number', unit: 'fps' },
    { key: '介面', type: 'select', options: ['GigE', '10GigE', 'USB3', 'CoaXPress', 'Camera Link'] }, { key: '快門', type: 'select', options: ['全域', '捲簾'] },
    { key: '色彩', type: 'select', options: ['黑白', '彩色'] }, { key: '鏡頭接口', type: 'select', options: MOUNTS },
  ],
  鏡頭與光學: [
    { key: '鏡頭類型', type: 'select', options: ['定焦', '遠心', '變焦', '微距', '線掃描'] }, { key: '焦距', type: 'number', unit: 'mm' }, { key: '倍率', type: 'number', unit: '×' },
    { key: '最大光圈', type: 'number', unit: 'F' }, { key: '最小光圈', type: 'number', unit: 'F' }, { key: '像圈', type: 'number', unit: 'mm' },
    { key: '鏡頭接口', type: 'select', options: MOUNTS }, { key: '最近對焦距離', type: 'number', unit: 'mm' }, { key: '工作距離', type: 'number', unit: 'mm' },
  ],
  光源: [
    { key: '光源類型', type: 'select', options: ['環形', '條形', '穹頂', '同軸', '背光', '點光', '線光', '平面'] }, { key: '波長', type: 'number', unit: 'nm' },
    { key: '發光尺寸', type: 'text', unit: 'mm' }, { key: '建議工作距離', type: 'number', unit: 'mm' },
  ],
};

export const V5_CATEGORIES = `
CREATE TABLE categories (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES categories(id), name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX categories_parent ON categories(parent_id);
CREATE TABLE category_fields (id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE, key TEXT NOT NULL, label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text', unit TEXT NOT NULL DEFAULT '', options TEXT NOT NULL DEFAULT '[]', required INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (category_id, key));
ALTER TABLE parts ADD COLUMN category_id INTEGER REFERENCES categories(id);
CREATE INDEX parts_category ON parts(category_id);
`;

const text = v => v == null ? '' : String(v).trim();
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// db：partsdb 的小工具 { all, get, run, insert, tx, now }；fail(訊息, 狀態碼) 丟出 PartsError
export function categoryOps({ all, get, run, insert, tx, now, fail }) {
  // 整棵樹：byId（每個節點有 children、path、depth、order）、roots
  function index() {
    const byId = new Map(all('SELECT * FROM categories ORDER BY sort, name, id').map(n => [n.id, { ...n, children: [] }])), roots = [];
    for (const n of byId.values()) (n.parent_id && byId.has(n.parent_id) ? byId.get(n.parent_id).children : roots).push(n);
    let order = 0;
    const walk = (n, path, depth) => { n.path = [...path, n.name]; n.depth = depth; n.order = order++; n.children.forEach(c => walk(c, n.path, depth + 1)); };
    roots.forEach(r => walk(r, [], 1));
    return { byId, roots };
  }
  const need = id => { const n = id == null || id === '' ? null : get('SELECT * FROM categories WHERE id = ?', Number(id)); if (!n) fail(`找不到分類（${id}）`, 404); return n; };
  const subtree = n => [n, ...n.children.flatMap(subtree)];
  const height = n => 1 + Math.max(0, ...n.children.map(height));
  const siblings = parentId => all('SELECT * FROM categories WHERE parent_id IS ?', parentId ?? null);

  // 舊的文字欄位：最上層是群組、最下層是類別（只有一層時類別留白）
  const textOf = n => n ? { grp: n.path[0], category: n.path.length > 1 ? n.path.at(-1) : '' } : { grp: '', category: '' };
  function syncText(ids, idx = index()) {
    for (const id of ids) { const t = textOf(idx.byId.get(id)); run('UPDATE parts SET grp = ?, category = ? WHERE category_id = ?', t.grp, t.category, id); }
  }

  function checkName(name, parentId, selfId) {
    if (!name) fail('請輸入分類名稱');
    if (name.length > 40) fail('分類名稱最多 40 個字');
    if (siblings(parentId).some(s => s.id !== selfId && same(s.name, name))) fail(`同一層已經有「${name}」`);
  }

  // 欄位範本：鍵不能空白、同一個分類不重複，也不能和上層繼承來的重複
  function cleanFields(list, inherited = []) {
    const out = [], keys = new Set(inherited.map(f => f.key.toLowerCase()));
    (list || []).forEach((f, i) => {
      const key = text(f.key);
      if (!key) fail(`第 ${i + 1} 個欄位沒有名稱`);
      if (keys.has(key.toLowerCase())) fail(`欄位「${key}」重複了（可能是上層分類已經有）`);
      keys.add(key.toLowerCase());
      const type = f.type || 'text';
      if (!FIELD_TYPES[type]) fail(`欄位「${key}」的型別只能是：${Object.keys(FIELD_TYPES).join('、')}`);
      const options = type === 'select' ? [...new Set((Array.isArray(f.options) ? f.options : String(f.options || '').split(/[,，、\n]/)).map(text).filter(Boolean))] : [];
      if (type === 'select' && !options.length) fail(`欄位「${key}」是選項，要給至少一個選項`);
      out.push({ key, label: text(f.label) || key, type, unit: text(f.unit), options: JSON.stringify(options), required: f.required ? 1 : 0, sort: i });
    });
    return out;
  }
  const fieldRow = f => ({ key: f.key, label: f.label, type: f.type, unit: f.unit, options: JSON.parse(f.options || '[]'), required: !!f.required });
  const ownFields = id => all('SELECT * FROM category_fields WHERE category_id = ? ORDER BY sort, id', id).map(fieldRow);

  const ops = {
    index,
    textOf: id => { if (id == null) return textOf(null); const n = index().byId.get(Number(id)); if (!n) fail(`找不到分類（${id}）`, 404); return textOf(n); },
    // 樹（介面的樹狀選單）：每個節點有自己的元件數 own、含子分類的 count、自己的欄位數 fields
    tree() {
      const counts = new Map(all('SELECT category_id AS id, count(*) AS n FROM parts GROUP BY category_id').map(r => [r.id, r.n]));
      const fieldCounts = new Map(all('SELECT category_id AS id, count(*) AS n FROM category_fields GROUP BY category_id').map(r => [r.id, r.n]));
      const shape = n => { const children = n.children.map(shape); const own = counts.get(n.id) || 0;
        return { id: n.id, parent_id: n.parent_id, name: n.name, note: n.note, sort: n.sort, depth: n.depth, path: n.path, own, count: own + children.reduce((s, c) => s + c.count, 0), fields: fieldCounts.get(n.id) || 0, children }; };
      return { nodes: index().roots.map(shape), uncategorized: counts.get(null) || 0, maxDepth: MAX_DEPTH };
    },
    // 一個節點與它底下所有子分類的 id（篩選清單用）
    descendantIds(id) { const n = index().byId.get(Number(id)); if (!n) fail(`找不到分類（${id}）`, 404); return subtree(n).map(x => x.id); },
    // SQL 的排序式：依樹的順序排（沒有分類的最後）
    orderSql(col = 'pl.category_id') {
      const list = [...index().byId.values()];
      return list.length ? `CASE ${col} ${list.map(n => `WHEN ${n.id} THEN ${n.order}`).join(' ')} ELSE 999999 END` : '0';
    },
    createCategory(v) {
      const name = text(v.name), parent = v.parent_id == null || v.parent_id === '' ? null : need(v.parent_id);
      checkName(name, parent?.id ?? null);
      if (parent && index().byId.get(parent.id).depth >= MAX_DEPTH) fail(`分類最多 ${MAX_DEPTH} 層`);
      const t = now(), sort = v.sort != null ? Number(v.sort) || 0 : (get('SELECT max(sort) AS m FROM categories WHERE parent_id IS ?', parent?.id ?? null).m ?? -1) + 1;
      return ops.getCategory(insert('categories', { parent_id: parent?.id ?? null, name, sort, note: text(v.note), created_at: t, updated_at: t }));
    },
    getCategory(id) {
      const idx = index(), n = idx.byId.get(Number(id)); if (!n) fail(`找不到分類（${id}）`, 404);
      return { id: n.id, parent_id: n.parent_id, name: n.name, note: n.note, sort: n.sort, depth: n.depth, path: n.path,
        fields: ownFields(n.id), inherited: ops.fieldsOf(n.parent_id), parts: get('SELECT count(*) AS n FROM parts WHERE category_id = ?', n.id).n, children: n.children.length };
    },
    // 改名、搬到別的上層、排序、說明；搬家時檢查不能搬到自己底下、整棵子樹不能超過層數上限
    updateCategory(id, v) {
      const cur = need(id), idx = index(), node = idx.byId.get(cur.id);
      const name = v.name !== undefined ? text(v.name) : cur.name;
      const parentId = v.parent_id === undefined ? cur.parent_id : v.parent_id === null || v.parent_id === '' ? null : need(v.parent_id).id;
      if (parentId != null && subtree(node).some(x => x.id === parentId)) fail('不能搬到自己或自己的子分類底下');
      checkName(name, parentId, cur.id);
      const depth = parentId == null ? 1 : idx.byId.get(parentId).depth + 1;
      if (depth + height(node) - 1 > MAX_DEPTH) fail(`搬過去會超過 ${MAX_DEPTH} 層`);
      tx(() => {
        run('UPDATE categories SET name = ?, parent_id = ?, sort = ?, note = ?, updated_at = ? WHERE id = ?', name, parentId, v.sort != null ? Number(v.sort) || 0 : cur.sort, v.note !== undefined ? text(v.note) : cur.note, now(), cur.id);
        syncText(subtree(node).map(x => x.id));
      });
      return ops.getCategory(cur.id);
    },
    deleteCategory(id) {
      const cur = need(id);
      if (get('SELECT 1 AS x FROM categories WHERE parent_id = ?', cur.id)) fail('底下還有子分類，先移走或刪掉');
      const n = get('SELECT count(*) AS n FROM parts WHERE category_id = ?', cur.id).n;
      if (n) fail(`底下還有 ${n} 個元件，先移到別的分類`);
      run('DELETE FROM categories WHERE id = ?', cur.id);
      return { deleted: cur.id };
    },
    // 一個分類的有效欄位：從最上層往下（子分類繼承上層的），每個欄位標出來自哪一層
    fieldsOf(id) {
      if (id == null) return [];
      const n = get('SELECT id FROM categories WHERE id = ?', Number(id)); if (!n) return [];
      const idx = index(), chain = []; for (let x = idx.byId.get(n.id); x; x = x.parent_id ? idx.byId.get(x.parent_id) : null) chain.unshift(x);
      return chain.flatMap(c => ownFields(c.id).map(f => ({ ...f, from: c.name, fromId: c.id })));
    },
    setFields(id, list) {
      const cur = need(id), rows = cleanFields(list, ops.fieldsOf(cur.parent_id));
      // 子分類已經有同名欄位的話，上層不能再加（子分類會重複繼承）
      const below = subtree(index().byId.get(cur.id)).slice(1).flatMap(c => ownFields(c.id).map(f => ({ ...f, at: c.name })));
      for (const r of rows) { const dup = below.find(f => same(f.key, r.key)); if (dup) fail(`子分類「${dup.at}」已經有欄位「${r.key}」`); }
      tx(() => { run('DELETE FROM category_fields WHERE category_id = ?', cur.id); for (const r of rows) insert('category_fields', { category_id: cur.id, ...r }); });
      return ops.getCategory(cur.id);
    },
    // 依名稱找分類（成本表匯入、代理提案帶進來的文字）：先在群組底下找，再找全部；create 時沒有就建
    resolve(grp, category, { create = false } = {}) {
      grp = text(grp); category = text(category);
      if (!grp && !category) return null;
      const idx = index(), all = [...idx.byId.values()];
      const root = grp ? idx.roots.find(r => same(r.name, grp)) : null;
      if (category) {
        const hit = (root && subtree(root).find(n => n.id !== root.id && same(n.name, category))) || (!grp && all.find(n => same(n.name, category)));
        if (hit) return hit.id;
      } else if (root) return root.id;
      if (!create) return root ? root.id : null;
      // 沒有群組的類別放在「其他」底下，維持「群組 › 類別」兩層
      const r = root?.id ?? ops.createCategory({ name: grp || OTHER }).id;
      return category ? ops.createCategory({ name: category, parent_id: r }).id : r;
    },
    // 預設的樹：GROUPS 的群組與類別，以及光學相關的欄位範本（已經有的不動）
    seedDefaults() {
      for (const [g, cats] of Object.entries(GROUPS)) {
        ops.resolve(g, '', { create: true });
        for (const c of cats) {
          const id = ops.resolve(g, c, { create: true });
          if (DEFAULT_FIELDS[c] && !get('SELECT 1 AS x FROM category_fields WHERE category_id = ?', id)) ops.setFields(id, DEFAULT_FIELDS[c]);
        }
      }
    },
    // 舊資料：依 grp／category 文字放進樹（沒有的節點自動建立），再把文字同步成樹的寫法
    placeLegacyParts() {
      for (const p of all('SELECT id, grp, category FROM parts WHERE category_id IS NULL')) {
        const id = ops.resolve(p.grp, p.category, { create: true });
        if (id != null) run('UPDATE parts SET category_id = ? WHERE id = ?', id, p.id);
      }
      syncText([...index().byId.keys()]);
    },
    // 元件 attrs 對照欄位範本：數字欄位要是數字、是否欄位只能「是／否」；只檢查有改動的值（舊資料不會因此存不回去）
    checkAttrs(attrs, categoryId, before = {}) {
      for (const f of ops.fieldsOf(categoryId)) {
        const v = attrs[f.key];
        if (v == null || v === '' || v === before[f.key]) continue;
        if (f.type === 'number' && !Number.isFinite(Number(v))) fail(`「${f.label}」要填數字${f.unit ? `（單位是 ${f.unit}，不用另外寫）` : ''}`);
        if (f.type === 'bool' && !['是', '否'].includes(v)) fail(`「${f.label}」只能填「是」或「否」`);
      }
    },
    // 必填但沒填的欄位（資料完整度、之後的 AI 補全用）
    missing: (attrs, categoryId) => ops.fieldsOf(categoryId).filter(f => f.required && !text(attrs[f.key])).map(f => f.key),
  };
  return ops;
}
