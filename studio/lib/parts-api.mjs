// 元件資料庫的 HTTP 介面（掛在 vs3d ui 的伺服器底下）：
//   GET  /api/parts?q=&category=&project=&supplier=   清單＋篩選用的類別、專案、單位、廠牌
//   POST /api/parts                                    新增元件
//   GET｜PUT｜DELETE /api/parts/:id                    單一元件（含價格紀錄與使用紀錄）、修改、刪除
//   POST /api/parts/:id/prices、/api/parts/:id/usages  新增價格紀錄、使用紀錄
//   PUT｜DELETE /api/prices/:id、/api/usages/:id        修改、刪除
//   GET｜POST /api/suppliers；PUT｜DELETE /api/suppliers/:id   供應商
import { openPartsDb, defaultPartsDb, PartsError, GRADES, SUPPLIER_KINDS } from './partsdb.mjs';

// 第一次呼叫才開資料庫；回傳 { handle({ method, seg, query, body }) → { code, body }, close }
export function createPartsApi(file = defaultPartsDb()) {
  let db = null;
  const open = () => db ||= openPartsDb(file);

  function route(method, [a, id, b], query, v) {
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
    async handle({ method, seg, query, body }) {
      try {
        const v = method === 'POST' || method === 'PUT' ? await body() : {};
        return { code: 200, body: route(method, seg, query, v) };
      } catch (e) {
        if (e instanceof PartsError) return { code: e.status, body: { error: e.message } };
        if (e instanceof SyntaxError) return { code: 400, body: { error: '請求內容不是 JSON' } };
        throw e;
      }
    },
    close() { db?.close(); db = null; },
  };
}
