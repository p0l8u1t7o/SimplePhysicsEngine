// 元件的關聯件與模組（評估平台 Q2）：
//   part_links  元件 → 關聯元件、關係、數量、備註
//     component   組成：模組由哪些子件、各幾個組成（只有「模組」元件能有；不能形成循環）
//     accessory   配件：選購時通常要一起買（加進 BOM 時提示）
//     alternative 替代：可以互換的選型（雙向，存一筆）
//     compatible  相容：接口或規格相容（雙向，存一筆；光學工作台篩選、代理選型用）
// 模組 parts.kind = 'module'；單價 price_mode：own 用自己的價格紀錄（例如供應商的整組報價），sum 是子件單價 × 數量加總
// （只加新台幣；有子件沒有單價或是外幣時標出來）。
export const LINK_RELS = { component: '組成', accessory: '配件', alternative: '替代', compatible: '相容' };
export const PART_KINDS = { part: '一般', module: '模組' };
export const PRICE_MODES = { own: '用自己的報價', sum: '子件加總' };
const SYMMETRIC = new Set(['alternative', 'compatible']);

export const V5_LINKS = `
ALTER TABLE parts ADD COLUMN kind TEXT NOT NULL DEFAULT 'part';
ALTER TABLE parts ADD COLUMN price_mode TEXT NOT NULL DEFAULT 'own';
ALTER TABLE parts ADD COLUMN model_params TEXT NOT NULL DEFAULT '{}';
CREATE TABLE part_links (id INTEGER PRIMARY KEY, part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE, related_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  rel TEXT NOT NULL, qty REAL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, UNIQUE (part_id, related_id, rel));
CREATE INDEX part_links_related ON part_links(related_id);
`;

const text = v => v == null ? '' : String(v).trim();

// db：partsdb 的小工具；fail(訊息, 狀態碼)；findPart(id 或元件編號) → 元件或 null
export function linkOps({ all, get, run, insert, now, fail, findPart }) {
  const need = id => findPart(id) || fail(`找不到元件（${id}）`, 404);
  // 模組底下（含多層）所有的子件 id
  function descendants(id, seen = new Set()) {
    for (const r of all("SELECT related_id FROM part_links WHERE part_id = ? AND rel = 'component'", id)) if (!seen.has(r.related_id)) { seen.add(r.related_id); descendants(r.related_id, seen); }
    return seen;
  }
  const latest = id => get('SELECT unit_price, currency, grade FROM part_latest WHERE id = ?', id);

  const ops = {
    descendants,
    addLink(partId, v) {
      const p = need(partId), r = need(v.related), rel = text(v.rel);
      if (!LINK_RELS[rel]) fail(`關係只能是：${Object.values(LINK_RELS).join('、')}`);
      if (p.id === r.id) fail('不能和自己建立關聯');
      if (rel === 'component') {
        if (p.kind !== 'module') fail('只有「模組」元件可以加子件：先把種類改成模組');
        if (descendants(r.id).has(p.id)) fail(`${r.code} 本身（或它的子件）已經包含 ${p.code}，會形成循環`);
      }
      const dup = SYMMETRIC.has(rel)
        ? get('SELECT id FROM part_links WHERE rel = ? AND ((part_id = ? AND related_id = ?) OR (part_id = ? AND related_id = ?))', rel, p.id, r.id, r.id, p.id)
        : get('SELECT id FROM part_links WHERE rel = ? AND part_id = ? AND related_id = ?', rel, p.id, r.id);
      if (dup) fail(`已經有這個${LINK_RELS[rel]}關聯`);
      const qty = v.qty == null || v.qty === '' ? (rel === 'component' || rel === 'accessory' ? 1 : null) : Number(v.qty);
      if (qty != null && !(qty > 0)) fail('數量要大於 0');
      return get('SELECT * FROM part_links WHERE id = ?', insert('part_links', { part_id: p.id, related_id: r.id, rel, qty, note: text(v.note), created_at: now() }));
    },
    updateLink(id, v) {
      const l = get('SELECT * FROM part_links WHERE id = ?', Number(id)) || fail(`找不到關聯（${id}）`, 404);
      const qty = v.qty === undefined ? l.qty : v.qty == null || v.qty === '' ? null : Number(v.qty);
      if (qty != null && !(qty > 0)) fail('數量要大於 0');
      run('UPDATE part_links SET qty = ?, note = ? WHERE id = ?', qty, v.note !== undefined ? text(v.note) : l.note, l.id);
      return get('SELECT * FROM part_links WHERE id = ?', l.id);
    },
    deleteLink(id) { const l = get('SELECT * FROM part_links WHERE id = ?', Number(id)) || fail(`找不到關聯（${id}）`, 404); run('DELETE FROM part_links WHERE id = ?', l.id); return { deleted: l.id, part_id: l.part_id }; },
    // 一個元件的關聯：組成（子件）、用在哪些模組（上層）、配件、被當成誰的配件、替代與相容（雙向）
    linksOf(partId) {
      const rows = all(`SELECT l.*, CASE WHEN l.part_id = ?1 THEN 'out' ELSE 'in' END AS dir, o.id AS other_id, o.code, o.name, o.brand, o.model, o.unit, o.kind, o.model_id,
          pl.unit_price, pl.currency, pl.grade
        FROM part_links l JOIN parts o ON o.id = CASE WHEN l.part_id = ?1 THEN l.related_id ELSE l.part_id END
        LEFT JOIN part_latest pl ON pl.id = o.id
        WHERE l.part_id = ?1 OR l.related_id = ?1 ORDER BY l.rel, l.id`, partId);
      const pick = (rel, dir) => rows.filter(r => r.rel === rel && (!dir || r.dir === dir));
      return { components: pick('component', 'out'), usedIn: pick('component', 'in'), accessories: pick('accessory', 'out'), accessoryOf: pick('accessory', 'in'),
        alternatives: pick('alternative'), compatible: pick('compatible') };
    },
    // 模組的子件加總單價（多層模組往下算）；回傳 { total, currency: 'TWD', missing: [編號], foreign: [編號] }
    sumPrice(id, seen = new Set()) {
      const out = { total: 0, currency: 'TWD', missing: [], foreign: [] };
      if (seen.has(id)) return out;
      seen.add(id);
      for (const c of all("SELECT l.qty, p.id, p.code, p.kind, p.price_mode FROM part_links l JOIN parts p ON p.id = l.related_id WHERE l.part_id = ? AND l.rel = 'component'", id)) {
        const qty = c.qty ?? 1;
        if (c.kind === 'module' && c.price_mode === 'sum') {
          const sub = ops.sumPrice(c.id, seen); out.total += sub.total * qty; out.missing.push(...sub.missing); out.foreign.push(...sub.foreign); continue;
        }
        const pr = latest(c.id);
        if (!pr || pr.unit_price == null) out.missing.push(c.code);
        else if (pr.currency !== 'TWD') out.foreign.push(c.code);
        else out.total += pr.unit_price * qty;
      }
      return out;
    },
    // 種類與單價算法：一般元件不能用子件加總；模組還有子件時不能改回一般
    cleanKind(v, cur) {
      const kind = v.kind === undefined ? cur?.kind || 'part' : text(v.kind) || 'part';
      if (!PART_KINDS[kind]) fail('種類只能是一般或模組');
      const mode = kind === 'module' ? (v.price_mode === undefined ? cur?.price_mode || 'own' : text(v.price_mode) || 'own') : 'own';
      if (!PRICE_MODES[mode]) fail('單價算法只能是「用自己的報價」或「子件加總」');
      if (cur && cur.kind === 'module' && kind !== 'module' && get("SELECT 1 AS x FROM part_links WHERE part_id = ? AND rel = 'component'", cur.id)) fail('模組還有子件，先移除子件再改回一般元件');
      return { kind, price_mode: mode };
    },
  };
  return ops;
}
