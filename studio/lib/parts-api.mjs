// 元件資料庫的 HTTP 介面（掛在 vs3d ui 的伺服器底下）：
//   GET  /api/parts?q=&group=&category=&project=&supplier=   清單＋樹狀選單（群組 → 類別）與篩選用的專案、單位、廠牌
//   POST /api/parts                                    新增元件
//   GET｜PUT｜DELETE /api/parts/:id                    單一元件（含價格紀錄、使用紀錄、附件）、修改（含封面圖 cover_file_id）、刪除
//   POST /api/parts/:id/prices、/api/parts/:id/usages  新增價格紀錄、使用紀錄
//   PUT｜DELETE /api/prices/:id、/api/usages/:id        修改、刪除
//   POST /api/parts/:id/files?name=<檔名>&kind=&price=（內容放在請求本體）   上傳附件；類型與大小上限依系統設定
//   GET  /api/parts/:id/files/:附件 id[?inline=1]       下載；圖片與 PDF 加 inline=1 直接在瀏覽器顯示
//   PUT｜DELETE /api/files/:附件 id                     改用途、對應的價格紀錄、備註；刪除
//   GET｜POST /api/suppliers；PUT｜DELETE /api/suppliers/:id   供應商
//   GET｜PUT /api/system                               系統設定（PUT 只有管理者，權限在 lib/auth.mjs 的 denied）
//   GET｜POST /api/categories；GET｜PUT｜DELETE /api/categories/:id；PUT /api/categories/:id/fields   分類樹與欄位範本（改只有管理者）
//   POST /api/parts/:id/links { related, rel, qty, note }；PUT｜DELETE /api/links/:id   關聯件（組成、配件、替代、相容）
import { openPartsDb, defaultPartsDb, PartsError, GRADES, SUPPLIER_KINDS, FILE_TYPES, FILE_KINDS, fileType, mimeOf } from './partsdb.mjs';
import { SYSTEM_SETTINGS, readSystem, cleanSystem, attachmentRule } from './settings.mjs';
import { edition, subscriptionAllowed } from './edition.mjs';
import { FIELD_TYPES } from './categories.mjs';
import { LINK_RELS, PART_KINDS, PRICE_MODES } from './part-links.mjs';

const INLINE = new Set(['image', 'pdf']);      // 可以直接在瀏覽器開的附件

// 第一次呼叫才開資料庫；回傳 { handle({ method, seg, query, body, raw, user }) → { code, body } 或 { code, file }, system(), close }
export function createPartsApi(file = defaultPartsDb()) {
  let db = null;
  const open = () => db ||= openPartsDb(file);

  async function route(method, [a, id, b, c], query, v, raw, user) {
    const d = open();
    if (a === 'system') {
      if (method === 'PUT') {
        let clean; try { clean = cleanSystem(v); } catch (e) { throw new PartsError(e.message); }
        d.writeSettings(clean, user?.name);
      }
      return { values: readSystem(d), defs: Object.fromEntries(Object.entries(SYSTEM_SETTINGS).map(([k, x]) => [k, { label: x.label, hint: x.hint || '', default: x.value }])),
        fileTypes: FILE_TYPES, fileKinds: FILE_KINDS, edition: edition(), subscription: subscriptionAllowed() };
    }
    // 分類樹與欄位範本（改只有管理者，權限在 lib/auth.mjs 的 denied）
    if (a === 'categories') {
      const C = d.categories;
      if (!id && method === 'GET') return { ...C.tree(), fieldTypes: FIELD_TYPES };
      if (!id && method === 'POST') return C.createCategory(v);
      if (id && b === 'fields' && method === 'PUT') return C.setFields(id, v.fields);
      if (id && !b && method === 'GET') return C.getCategory(id);
      if (id && !b && method === 'PUT') return C.updateCategory(id, v);
      if (id && !b && method === 'DELETE') return C.deleteCategory(id);
    }
    // 關聯件與模組的子件
    if (a === 'parts' && b === 'links' && method === 'POST') return d.links.addLink(id, v);
    if (a === 'links' && id && method === 'PUT') return d.links.updateLink(id, v);
    if (a === 'links' && id && method === 'DELETE') return d.links.deleteLink(id);
    if (a === 'parts' && !id) {
      if (method === 'GET') return { ...d.listParts(Object.fromEntries(query)), file: d.file, grades: GRADES, supplierKinds: SUPPLIER_KINDS, linkRels: LINK_RELS, partKinds: PART_KINDS, priceModes: PRICE_MODES };
      if (method === 'POST') return d.createPart(v);
    }
    if (a === 'parts' && id && !b) {
      if (method === 'GET') return d.getPart(id);
      if (method === 'PUT') return d.updatePart(id, v);
      if (method === 'DELETE') return d.deletePart(id);
    }
    if (a === 'parts' && b === 'files' && !c && method === 'POST') {
      d.getPart(id);                                   // 元件不存在就先擋下，不讀檔案內容
      const name = query.get('name');
      let rule; try { rule = attachmentRule(readSystem(d), fileType(name)); } catch (e) { throw new PartsError(e.message, e.status); }
      const data = await raw(rule.limit).catch(e => { if (e.code === 'TOO_LARGE') throw new PartsError(`檔案超過上限 ${rule.mb} MB（${rule.type === 'cad' ? 'CAD 檔' : '一般附件'}，可以在系統設定調整）`, 413); throw e; });
      if (!data.length) throw new PartsError('檔案是空的');
      return d.addFile(id, { name, data, note: query.get('note') || '', kind: query.get('kind') || '', priceId: query.get('price') || null, by: user?.name });
    }
    if (a === 'parts' && b === 'files' && c && method === 'GET') {
      const f = d.fileOf(c);
      if (f.part_id !== d.getPart(id).id) throw new PartsError('找不到附件', 404);
      return { __file: { path: f.path, name: f.name, inline: query.get('inline') === '1' && INLINE.has(f.type), mime: mimeOf(f.name) } };
    }
    if (a === 'files' && id && method === 'PUT') return d.updateFile(id, v);
    if (a === 'files' && id && method === 'DELETE') return d.deleteFile(id);
    if (a === 'parts' && b === 'prices' && method === 'POST') return d.addPrice(id, v);
    if (a === 'parts' && b === 'usages' && method === 'POST') return d.addUsage(id, v);
    if (a === 'prices' && id && method === 'PUT') return d.updatePrice(id, v);
    if (a === 'prices' && id && method === 'DELETE') return d.deletePrice(id);
    if (a === 'usages' && id && method === 'PUT') return d.updateUsage(id, v);
    if (a === 'usages' && id && method === 'DELETE') return d.deleteUsage(id);
    if (a === 'suppliers' && !id) {
      if (method === 'GET') return { suppliers: d.listSuppliers(), kinds: SUPPLIER_KINDS };
      if (method === 'POST') return d.createSupplier(v);
    }
    if (a === 'suppliers' && id && method === 'PUT') return d.updateSupplier(id, v);
    if (a === 'suppliers' && id && method === 'DELETE') return d.deleteSupplier(id);
    throw new PartsError('未知的 API', 404);
  }

  return {
    // body：回傳請求內容（JSON）的函式，只有 POST／PUT 才會讀；raw(上限位元組)：回傳原始內容，超過上限時丟出 code = 'TOO_LARGE' 的錯誤
    async handle({ method, seg, query, body, raw, user = null }) {
      try {
        const upload = seg[0] === 'parts' && seg[2] === 'files';      // 上傳的本體是檔案內容，不是 JSON
        const v = !upload && (method === 'POST' || method === 'PUT') ? await body() : {};
        const r = await route(method, seg, query, v, raw, user);
        return r?.__file ? { code: 200, file: r.__file } : { code: 200, body: r };
      } catch (e) {
        if (e instanceof PartsError) return { code: e.status, body: { error: e.message } };
        if (e instanceof SyntaxError) return { code: 400, body: { error: '請求內容不是 JSON' } };
        throw e;
      }
    },
    overview: () => open().overview(),      // 儀表板首頁用
    system: () => readSystem(open()),
    store: () => open(),                    // 資料庫本身（專案成員等伺服器直接用的資料）
    close() { db?.close(); db = null; },
  };
}
