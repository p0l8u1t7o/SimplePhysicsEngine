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
// 沒有型號數字的通用模型用名稱規則（GENERIC）：只列名稱一看就對得上的市購小件；其他（輸送線、馬達…）在介面上手動選。
const squash = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const modelKey = id => { const k = squash(id.replace(/^[a-z]+-/, '')); return /\d/.test(k) && k.length >= 5 ? k : null; };
// [模型 id, 元件名稱要符合的, 名稱不能含有的]；由上而下取第一個符合的
const GENERIC = [
  ['signal-tower', /三色燈|警示燈/, /線|支架/],
  ['estop', /^急停/, /線/],
  ['light-curtain', /安全光柵|安全光幕/, /線|支架/],
  ['ft-sensor', /力覺感測器/, /授權|線/],
  ['dome-light', /穹頂光/, /控制器|線/],
  ['bar-light', /條形.*光源|條光|條形光/, /控制器|線|支架/],
  ['hmi', /^(維修 )?HMI|觸控螢幕/, /軟體|授權|線/],
  ['laser-profiler', /線雷射輪廓儀/, /支架|授權/],
  ['code-reader', /讀碼器/, /線|支架|授權/],
  ['camera', /相機/, /線|支架|防塵罩|鏡頭$|觸發|保護鏡|校正/],
  // 1.10.0 的市購品模型：名稱以該設備為主的才連；看不出主體的整包品項（「閥、氣源與感測器」）留給介面手動選
  ['safety-scanner', /安全雷射掃描器/, /線|支架/],
  ['door-switch', /門鎖開關|門互鎖開關/, /線/],
  ['rotary-encoder', /^(旋轉)?編碼器/, /線|電纜/],
  ['load-cell', /^荷重元/, /線|放大器/],
  ['operator-pc', /^操作(員)?(螢幕|電腦)/, /線/],
  ['teach-pendant', /教導器/, /線|支架/],
  ['cabinet-fan', /(櫃|盤)(側|內)?(散熱)?風扇/, /濾網/],
  ['titrator', /電位滴定儀/, /配件|軟體/],
  ['autosampler', /^自動進樣器/, /配件/],
  ['analytical-balance', /^分析天平/, /配件|推把/],
  ['pipette-module', /移液模組/, /支架|吸頭/],
  ['flex-feeder', /柔性(振動)?供料盤/, /配件/],
  ['edge-belt-conveyor', /雙帶.*輸送線|SMT 輸送模組|輸送本體/, /驅動|調寬/],
  ['belt-conveyor', /(平)?皮帶輸送(機|線)/, /驅動|馬達/],
  ['v-roller-conveyor', /V 槽滾輪輸送/, /驅動/],
  ['conveyor', /滾筒輸送/, /驅動/],
  ['slide-table', /^氣動滑台/, /支架/],
  ['linear-axis', /線性馬達軸|電動滑台$|取像頭滑軌|^線性模組/, /驅動器$/],
  ['parallel-gripper', /夾爪$/, /自製/],
  ['motor', /^伺服 \d/, /線|驅動器$/],
  ['frl-unit', /^氣源處理|三點組/, /管/],
  ['vacuum-ejector', /^真空發生器/, /管/],
  ['ionizer', /^離子風(嘴|扇|棒)/, /電源/],
  ['air-compressor', /^空壓機/, /管|保養/],
  ['air-tank', /^儲氣(筒|桶|槽)/, /管/],
  ['pe-tank', /^PE 儲槽/, /配管/],
  ['pump-diaphragm', /隔膜泵/, /配管|備品/],
  ['pump-centrifugal', /離心泵/, /配管|備品/],
  ['vacuum-pump', /^真空泵/, /配管|備品/],
  ['hot-air-blower', /^熱風機/, /風管/],
  ['air-knife', /^風刀/, /風管/],
  ['labeler', /^貼標機/, /耗材|標籤紙/],
  ['upender', /^翻桶機/, /基礎/],
  ['jib-crane', /^懸臂吊/, /基礎/],
  ['agv-charger', /AGV 充電/, /線/],
  ['agv-forklift', /堆高.*AGV|AGV.*堆高/, /充電|軟體|授權/],
  ['pallet-shuttle', /^(棧板)?穿梭車/, /架|充電/],
  ['shuttle-rack', /穿梭(車)?(密集)?架/, /基礎/],
];
export function linkCoreModels(db, models, { dryRun = false } = {}) {
  const keyed = models.map(m => ({ ...m, key: modelKey(m.id) })).filter(m => m.key), ids = new Set(models.map(m => m.id)), out = [];
  for (const p of db.listParts({ limit: 5000 }).parts) {
    if (p.model_id) continue;
    const text = squash(`${p.name} ${p.brand} ${p.model}`);
    const rule = GENERIC.find(([id, yes, no]) => ids.has(id) && yes.test(p.name) && !no.test(p.name));
    const hit = keyed.find(m => text.includes(m.key)) || (rule && { id: rule[0] });
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
