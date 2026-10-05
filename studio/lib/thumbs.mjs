// core 共用模型的清單與渲染圖（元件庫的 3D 顯示用；2026-10-05 拍板：元件只連 core/models 的共用模型）。
// 專案和元件庫用的是同一份 core 模型程式：元件庫裡的 3D 是即時由模型程式算出來的，模型一改兩邊都是新的。
// 清單上的縮圖是模型目錄頁的截圖，放在 studio/data/thumbs/（不進版控）；旁邊記模型程式的雜湊，模型程式或 core 版本變了就重拍。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { STUDIO, sha1, walk, sleep, readText } from './util.mjs';

export const thumbsDir = () => process.env.VS3D_THUMBS || join(STUDIO, 'data', 'thumbs');      // 環境變數：測試用暫存資料夾
export const thumbFile = id => join(thumbsDir(), `${id}.png`);

// 掃 core/models 的 meta（不載入 three.js）：[{ id, name, category, hash }]
export function coreModels(core) {
  const dir = join(core, 'models'), version = readText(join(core, 'VERSION')).trim(), out = [];
  for (const rel of walk(dir).filter(f => f.endsWith('.js') && !f.endsWith('index.js')).sort()) {
    const src = readFileSync(join(dir, rel), 'utf8'), hash = sha1(src + version).slice(0, 12);
    for (const m of src.matchAll(/id:\s*'([\w-]+)',\s*name:\s*'([^']+)',\s*category:\s*'([^']+)'/g)) out.push({ id: m[1], name: m[2], category: m[3], hash });
  }
  return out;
}
// 元件庫自動連到 core 模型：模型 id 去掉廠牌後帶數字的那一段當型號關鍵字（denso-vs068 → vs068），
// 元件的名稱、廠牌、型號去掉空白與符號後含有這個關鍵字就連上。只處理還沒連模型的元件；
// 沒有型號數字的通用模型（camera、conveyor、motor…）對不準，不自動連，在介面上手動選。
const squash = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const modelKey = id => { const k = squash(id.replace(/^[a-z]+-/, '')); return /\d/.test(k) && k.length >= 5 ? k : null; };
export function linkCoreModels(db, models, { dryRun = false } = {}) {
  const keyed = models.map(m => ({ ...m, key: modelKey(m.id) })).filter(m => m.key), out = [];
  for (const p of db.listParts({ limit: 5000 }).parts) {
    if (p.model_id) continue;
    const text = squash(`${p.name} ${p.brand} ${p.model}`), hit = keyed.find(m => text.includes(m.key));
    if (!hit) continue;
    if (!dryRun) db.updatePart(p.id, { ...p, model_id: hit.id });
    out.push({ code: p.code, name: p.name, model: hit.id });
  }
  return out;
}

// 加上縮圖狀態：有沒有圖、是不是用目前的模型程式拍的
export const withThumbs = models => models.map(m => {
  const has = existsSync(thumbFile(m.id)), fresh = has && readText(thumbFile(m.id) + '.hash').trim() === m.hash;
  return { ...m, thumb: has, stale: !fresh };
});

// 用無頭瀏覽器開模型目錄頁，只留 3D 畫面，一個模型拍一張。catalogUrl 例如 http://127.0.0.1:53210/core/catalog/
export async function renderThumbs(core, catalogUrl, models, { log = () => {} } = {}) {
  if (!models.length) return 0;
  const { openBrowser } = await import(pathToFileURL(join(core, 'tools', 'cdp.mjs')).href);
  const browser = await openBrowser({ width: 560, height: 420 });
  let done = 0;
  try {
    await browser.goto(catalogUrl, '!!window.sim');
    await browser.evaluate(`(() => { const s = document.createElement('style'); s.textContent = '#app > *:not(#view) { display: none !important } #view { position: fixed !important; inset: 0 !important } #title { display: none !important }'; document.head.appendChild(s); dispatchEvent(new Event('resize')); return true; })()`);
    mkdirSync(thumbsDir(), { recursive: true });
    for (const m of models) {
      await browser.evaluate(`sim.setView(${JSON.stringify(m.id)}); true`);
      await sleep(900);
      writeFileSync(thumbFile(m.id), await browser.screenshot('png')); writeFileSync(thumbFile(m.id) + '.hash', m.hash);
      done++; log(`渲染圖：${m.name}`);
    }
  } finally { await browser.close(); }
  return done;
}
