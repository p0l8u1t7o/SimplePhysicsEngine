// 下載案場的典型氣象年（TMY），存成 core/solar 的 readEPW 讀得到的 EPW，另寫一份來源說明（.source.json）。
//
//   node tools/weather/fetch-tmy.mjs --lat 23.0 --lon 120.2 --out project-site/<站>/data/tmy.epw [--source pvgis] [--db PVGIS-ERA5] [--start 2005 --end 2023]
//
// 來源（2026-11-07 的建議，見 tools/weather/README.md）：
//   pvgis（預設）：歐盟 JRC 的 PVGIS 5.3，不需要金鑰。台灣只有 PVGIS-ERA5（再分析，格點約 30 km、2005～2023），
//                 適合可行性評估；多雲多雨地區的日射偏差比衛星資料大，正式發電量要換 NSRDB Himawari 或實測校正。
//   NSRDB Himawari（衛星 2 km）要 NREL 的 API 金鑰與電子郵件，用網頁下載 SAM CSV 後以 readCSV 讀（README 有欄位對照），這個工具不代為申請或下載。
// 只送出經緯度（和選用的資料庫、年份）給 PVGIS，不送任何專案資料。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const lat = +arg('lat'), lon = +arg('lon'), out = arg('out'), source = arg('source', 'pvgis');
if (!Number.isFinite(lat) || !Number.isFinite(lon) || !out) {
  console.error('用法：node tools/weather/fetch-tmy.mjs --lat <緯度> --lon <經度> --out <檔名.epw> [--db PVGIS-ERA5] [--start 2005 --end 2023]');
  process.exit(2);
}
if (source !== 'pvgis') { console.error(`不支援的來源 ${source}：目前只有 pvgis；NSRDB Himawari 請手動下載（見 tools/weather/README.md）`); process.exit(2); }

const q = new URLSearchParams({ lat: String(lat), lon: String(lon), outputformat: 'epw' });
if (arg('db')) q.set('raddatabase', arg('db'));
if (arg('start')) q.set('startyear', arg('start'));
if (arg('end')) q.set('endyear', arg('end'));
const url = `https://re.jrc.ec.europa.eu/api/v5_3/tmy?${q}`;
const res = await fetch(url, { headers: { 'user-agent': 'SimplePhysicsEngine-fetch-tmy' } });
const text = await res.text();
if (!res.ok || !text.startsWith('LOCATION')) { console.error(`PVGIS 回應 ${res.status}：${text.slice(0, 300)}`); process.exit(1); }

// 檢查：8760 筆、時區、日射欄位有值
const lines = text.split(/\r?\n/), data = lines.slice(8).filter(l => /^\d{4},/.test(l));
const loc = lines[0].split(','), comment = lines.find(l => l.startsWith('COMMENTS 1')) || '';
const ghi = data.reduce((s, l) => s + (+l.split(',')[13] || 0), 0) / 1000;
const db = arg('db') || (/ERA/.test(loc[4] + comment) ? 'PVGIS-ERA5' : /SARAH/i.test(loc[4] + comment) ? 'PVGIS-SARAH3' : loc[4]);
if (data.length !== 8760) console.warn(`注意：資料 ${data.length} 筆（應為 8760）`);
const file = resolve(out);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, text);
const meta = { source: 'PVGIS 5.3 TMY（European Commission, Joint Research Centre）', url, radiationDb: db, lat, lon, tz: +loc[8], elevation: +loc[9],
  rows: data.length, ghiKWhm2: Math.round(ghi), fetched: new Date().toISOString().slice(0, 10),
  note: db === 'PVGIS-ERA5' ? '再分析資料（約 30 km），適合可行性評估；正式發電量請用衛星資料（NSRDB Himawari）或實測日射校正' : '' };
writeFileSync(file.replace(/\.epw$/i, '') + '.source.json', JSON.stringify(meta, null, 2) + '\n');
console.log(`✓ ${file}：${data.length} 筆、時區 UTC${meta.tz >= 0 ? '+' : ''}${meta.tz}、全年 GHI ${meta.ghiKWhm2} kWh/m²（${db}）`);
if (meta.note) console.log('  ' + meta.note);
