// AOI 方案（評估平台 Q4）：光學工作台與 optics 角色產出的方案，存在資料庫的 aoi_setups（屬於專案）。
// 方案的內容是 core/optics 的 setup（camera／lens／light／scene），相機、鏡頭、光源可以引用元件庫的元件（part：元件編號或 id），
// 計算前用元件的規格欄位補上沒填的參數（方案裡自己填的值優先）。計算結果一起存，清單與比較直接用。
// 「選用」一個方案：同專案的其他方案改回草稿，這個方案引用的元件加進專案的 BOM（已經有同一個元件的行就不重複加）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STUDIO, posix } from './util.mjs';
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

// ---- 光學代理（評估平台 Q7）：依 AOI 需求提 2～3 個方案，平台用 L1＋L2 檢查，通過的存成 AOI 方案 ----
export const OPTICS_DIR = '.studio/optics';
const VS3D = posix(join(STUDIO, 'vs3d.mjs'));
// 給代理的元件清單：相機、鏡頭、光源分類（含子分類）的元件、規格欄位與最新參考單價
export function opticsCatalog(db) {
  const tree = db.categories.tree(), flat = [], walk = (ns, path) => ns.forEach(n => { flat.push({ ...n, path: [...path, n.name] }); walk(n.children || [], [...path, n.name]); });
  walk(tree.nodes, []);
  const out = {};
  for (const [k, name] of Object.entries({ camera: '相機與讀碼', lens: '鏡頭與光學', light: '光源' })) {
    const node = flat.find(n => n.name === name), ids = node ? flat.filter(n => n.path.includes(name)).map(n => n.id) : [];
    out[k] = ids.flatMap(id => db.listParts({ cat: String(id), limit: 500 }).parts).filter((p, i, a) => a.findIndex(x => x.id === p.id) === i)
      .map(p => ({ code: p.code, name: p.name, brand: p.brand, model: p.model, attrs: db.getPart(p.id).attrs, price: p.unit_price, currency: p.currency, status: p.status || '' }));
  }
  return out;
}
export const opticsPrompt = request => `## 任務：AOI 光學方案

使用者的 AOI 需求：

${String(request).split('\n').map(l => '> ' + l).join('\n')}

另外參考 \`AGENTS.md\` 的需求、\`docs/\` 的資料與 \`.studio/plan/\`（有的話）。可以選的元件在 \`${OPTICS_DIR}/parts.json\`（相機、鏡頭、光源，含規格欄位與參考單價）。

請提出 2～3 個方案（例如 5MP＋遠心＋同軸光 vs 12MP＋一般鏡頭＋低角度環形光），寫成 \`${OPTICS_DIR}/setups.json\`：

\`\`\`json
{ "setups": [
  { "name": "甲：5MP＋0.35× 遠心＋同軸光", "rationale": "為什麼這樣選、優缺點",
    "setup": {
      "camera": { "part": "P-00132" }, "lens": { "part": "P-00140" }, "light": { "part": "P-00160", "distance": 50 },
      "scene": { "wd": 110, "target": { "w": 20, "h": 16, "heightRange": 1 }, "defect": 0.05, "pxPerDefect": 3, "speed": 0, "exposureUs": 200, "taktS": 3, "imagesPerCycle": 1,
                 "material": "鏡面金屬", "background": "黑色塑膠", "defectKinds": ["刮傷", "髒污"] },
      "quantity": { "camera": 1, "lens": 1, "light": 1 } } }
], "compare": "幾句話比較這些方案，建議哪一個、為什麼" }
\`\`\`

- 相機、鏡頭、光源優先引用 parts.json 的元件（\`part\` 寫元件編號）；元件缺的參數直接寫在同一個物件裡（自己寫的值優先）。清單裡沒有合適的，可以不寫 part、只寫參數，並在 rationale 註明「新元件」。
- 欄位與單位照 core 的 \`optics/README.md\`（長度 mm、像素尺寸 µm、曝光 µs、速度 mm/s）。光源類型：環形、條形、穹頂、同軸、背光、點光、線光、平面；\`distance\` 是光源到工件的距離，條形與點光可以加 \`offset\`（水平偏移）。
- 工件材質 \`material\`：鏡面金屬、霧面金屬、黑色塑膠、白色塑膠、透明、PCB 綠漆、銅箔；\`defectKinds\` 是要檢出的缺陷（刮傷、凹痕、髒污、缺件），平台會用幾何打光模型估算每種缺陷的對比，對比太低的方案不通過。有治具擋住視線時用 \`obstacles\`（[{ x, y, w, d, h }]，工件座標 mm）。
- 每個方案都要通過平台的檢查（視野、解析度、最小缺陷、景深、運動模糊、頻寬、要檢出的缺陷）；可以先自己檢查：\`node "${VS3D}" optics eval <只含 setup 的 JSON 檔> --json\`。
- 只寫 \`${OPTICS_DIR}/\` 與 \`.studio/questions/\`；需求不清楚就寫問題檔。
`;
// 檢查代理的方案檔：回傳 { setups: [{ name, rationale, setup, result }], errors: [] }
export function checkSetups(db, file) {
  let raw; try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { setups: [], errors: [`${OPTICS_DIR}/setups.json 讀不到或不是 JSON：${e.message}`], compare: '' }; }
  const list = Array.isArray(raw?.setups) ? raw.setups : [], errors = [];
  if (list.length < 2) errors.push(`至少要 2 個方案（現在 ${list.length} 個）`);
  const setups = list.map((s, i) => {
    const name = text(s?.name) || `方案 ${i + 1}`;
    let result; try { result = db.aoi.evaluate(s?.setup || {}); } catch (e) { errors.push(`「${name}」：${e.message}`); return null; }
    const bad = result.results.filter(r => r.status === 'fail');
    if (bad.length) errors.push(`「${name}」沒有通過：${bad.map(r => `${r.label}（${r.note || r.value}）`).join('；')}`);
    return { name, rationale: text(s?.rationale), setup: s.setup, result };
  }).filter(Boolean);
  return { setups, errors, compare: text(raw?.compare) };
}
