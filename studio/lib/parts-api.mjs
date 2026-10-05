// 元件資料庫的 HTTP 介面（掛在 vs3d ui 的伺服器底下）：
//   GET  /api/parts?q=&group=&category=&project=&supplier=   清單＋樹狀選單（群組 → 類別）與篩選用的專案、單位、廠牌
//   POST /api/parts                                    新增元件
//   GET｜PUT｜DELETE /api/parts/:id                    單一元件（含價格紀錄與使用紀錄）、修改、刪除
//   POST /api/parts/:id/prices、/api/parts/:id/usages  新增價格紀錄、使用紀錄
//   PUT｜DELETE /api/prices/:id、/api/usages/:id        修改、刪除
//   POST /api/parts/:id/files?name=<檔名>（內容放在請求本體）、GET /api/parts/:id/files/:附件 id（下載）、DELETE /api/files/:附件 id   附件（CAD 檔等）
//   GET｜POST /api/suppliers；PUT｜DELETE /api/suppliers/:id   供應商
import { openPartsDb, defaultPartsDb, PartsError, GRADES, SUPPLIER_KINDS } from './partsdb.mjs';

// 第一次呼叫才開資料庫；回傳 { handle({ method, seg, query, body }) → { code, body }, close }
export function createPartsApi(file = defaultPartsDb()) {
  let db = null;
  const open = () => db ||= openPartsDb(file);

  const MAX_FILE = 300 * 1024 * 1024;      // 單一附件上限 300 MB
  async function route(method, [a, id, b, c], query, v, raw) {
    const d = open();
    if (a === 'parts' && !id) {
      if (method === 'GET') return { ...d.listParts(Object.fromEntries(query)), file: d.file, grades: GRADES, supplierKinds: SUPPLIER_KINDS };
      if (method === 'POST') return d.createPart(v);
    }
    if (a === 'parts' && id && !b) {
      if (method === 'GET') return d.getPart(id);
      if (method === 'PUT') return d.updatePart(id, v);
      if (method === 'DELETE') return d.deletePart(id);
    }
    if (a === 'parts' && b === 'files' && !c && method === 'POST') {
      const data = await raw();
      if (!data.length) throw new PartsError('檔案是空的');
      if (data.length > MAX_FILE) throw new PartsError('檔案超過 300 MB');
      return d.addFile(id, { name: query.get('name'), data, note: query.get('note') || '' });
    }
    if (a === 'parts' && b === 'files' && c && method === 'GET') {
      const f = d.fileOf(c);
      if (f.part_id !== d.getPart(id).id) throw new PartsError('找不到附件', 404);
      return { __file: { path: f.path, name: f.name } };
    }
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
    // body：回傳請求內容（JSON）的函式，只有 POST／PUT 才會讀
    async handle({ method, seg, query, body, raw }) {
      try {
        const upload = seg[0] === 'parts' && seg[2] === 'files';      // 上傳的本體是檔案內容，不是 JSON
        const v = !upload && (method === 'POST' || method === 'PUT') ? await body() : {};
        const r = await route(method, seg, query, v, raw);
        return r?.__file ? { code: 200, file: r.__file } : { code: 200, body: r };
      } catch (e) {
        if (e instanceof PartsError) return { code: e.status, body: { error: e.message } };
        if (e instanceof SyntaxError) return { code: 400, body: { error: '請求內容不是 JSON' } };
        throw e;
      }
    },
    overview: () => open().overview(),      // 儀表板首頁用
    close() { db?.close(); db = null; },
  };
}
