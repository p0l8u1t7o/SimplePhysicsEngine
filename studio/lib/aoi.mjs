// AOI 方案（評估平台 Q4）：光學工作台與 optics 角色產出的方案，存在資料庫的 aoi_setups（屬於專案）。
// 方案的內容是 core/optics 的 setup（camera／lens／light／scene），相機、鏡頭、光源可以引用元件庫的元件（part：元件編號或 id），
// 計算前用元件的規格欄位補上沒填的參數（方案裡自己填的值優先）。計算結果一起存，清單與比較直接用。
// 「選用」一個方案：同專案的其他方案改回草稿，這個方案引用的元件加進專案的 BOM（已經有同一個元件的行就不重複加）。
import { evaluate, fromAttrs } from '../../core/optics/optics.js';

export const V7_AOI = `
CREATE TABLE aoi_setups (id INTEGER PRIMARY KEY, project TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', result TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft', note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX aoi_project ON aoi_setups(project);
`;
const KINDS = ['camera', 'lens', 'light'], LABEL = { camera: '相機', lens: '鏡頭', light: '光源' };
const text = v => v == null ? '' : String(v).trim();
const clean = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== '' && v != null));

// db：partsdb 的小工具；findPart、getPart 找元件；bom：lib/bom.mjs 的 ops
export function aoiOps({ all, get, run, insert, now, fail, findPart, getPart, bom, actor }) {
  // 用元件庫補參數：{ setup（補過的）, parts: { camera: { code, name, price } … } }
  function resolve(setup) {
    const out = { ...setup }, parts = {};
    for (const k of KINDS) {
      const s = setup[k] || {};
      if (s.part == null || s.part === '') { out[k] = clean(s); continue; }
      const p = findPart(s.part) || fail(`${LABEL[k]}引用的元件找不到（${s.part}）`, 404), full = getPart(p.id);
      out[k] = { ...clean(fromAttrs(k, full.attrs)), ...clean(s), part: p.code };
      parts[k] = { id: p.id, code: p.code, name: p.name, brand: p.brand, model: p.model, version: p.version, unit_price: full.prices[0]?.unit_price ?? null, currency: full.prices[0]?.currency || 'TWD' };
    }
    return { setup: out, parts };
  }
  function calc(setup) {
    const { setup: filled, parts } = resolve(setup), r = evaluate(filled), qty = n => Number(setup.quantity?.[n] ?? 1);
    const cost = Object.entries(parts).reduce((a, [k, p]) => a + (p.currency === 'TWD' && p.unit_price != null ? p.unit_price * qty(k) : 0), 0);
    return { setup: filled, parts, ...r, cost };
  }
  const row = r => r && { ...r, data: JSON.parse(r.data), result: JSON.parse(r.result) };
  const need = id => row(get('SELECT * FROM aoi_setups WHERE id = ?', Number(id))) || fail(`找不到 AOI 方案（${id}）`, 404);
  function cleanData(v) {
    const d = v.data ?? v;
    if (!d || typeof d !== 'object') fail('方案的內容要是 { camera, lens, light, scene }');
    return Object.fromEntries(['camera', 'lens', 'light', 'scene', 'quantity'].filter(k => d[k] != null).map(k => [k, d[k]]));
  }
  const ops = {
    evaluate: calc,
    list: project => all('SELECT * FROM aoi_setups WHERE project = ? ORDER BY status = \'chosen\' DESC, id DESC', String(project)).map(row),
    get: need,
    save(project, v, id = null) {
      const name = text(v.name) || fail('請輸入方案名稱'), data = cleanData(v), result = calc(data), t = now();
      if (id != null) {
        const cur = need(id); if (cur.project !== String(project)) fail('這個方案不是這個專案的', 404);
        run('UPDATE aoi_setups SET name = ?, data = ?, result = ?, note = ?, updated_at = ? WHERE id = ?', name, JSON.stringify(data), JSON.stringify(result), text(v.note ?? cur.note), t, cur.id);
        return need(cur.id);
      }
      return need(insert('aoi_setups', { project: String(project), name, data: JSON.stringify(data), result: JSON.stringify(result), note: text(v.note), created_by: actor(), created_at: t, updated_at: t }));
    },
    delete(project, id) { const cur = need(id); if (cur.project !== String(project)) fail('這個方案不是這個專案的', 404); run('DELETE FROM aoi_setups WHERE id = ?', cur.id); return { deleted: cur.id }; },
    // 選用：其他方案改回草稿；引用的元件加進 BOM（子系統「AOI 視覺」，編號 V-xx；同一個元件已經在 BOM 就不加）
    choose(project, id) {
      const cur = need(id); if (cur.project !== String(project)) fail('這個方案不是這個專案的', 404);
      run("UPDATE aoi_setups SET status = 'draft' WHERE project = ?", String(project));
      run("UPDATE aoi_setups SET status = 'chosen', updated_at = ? WHERE id = ?", now(), cur.id);
      const parts = cur.result.parts || {}, b = bom.ensure(project), have = new Set(bom.get(project).lines.map(l => l.part_id).filter(Boolean));
      let n = bom.get(project).lines.filter(l => /^V-\d+$/.test(l.line)).length, added = [];
      for (const k of KINDS) {
        const p = parts[k]; if (!p || have.has(p.id)) continue;
        bom.addItem(project, { part: p.id, qty: Number(cur.data.quantity?.[k] ?? 1), line: `V-${String(++n).padStart(2, '0')}`, section: 'AOI 視覺', reason: `AOI 方案「${cur.name}」的${LABEL[k]}` });
        added.push(p.code);
      }
      void b;
      return { chosen: cur.id, added };
    },
  };
  return ops;
}
