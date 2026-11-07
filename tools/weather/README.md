# 案場天候資料（TMY）

`core/solar` 的全年發電（`simulate`）要一份逐時的典型氣象年。2026-11-07 的建議：

| 用途 | 來源 | 取得方式 | 說明 |
|---|---|---|---|
| 可行性評估（預設） | **PVGIS 5.3**（歐盟 JRC） | `node tools/weather/fetch-tmy.mjs --lat <緯度> --lon <經度> --out <站>/data/tmy.epw` | 免金鑰、直接輸出 EPW。台灣只有 **PVGIS-ERA5**（再分析，格點約 30 km、2005～2023），沒有 SARAH 衛星資料；多雲多雨地區的日射偏差比衛星資料大。台南（23.0°N、120.2°E）全年 GHI 1683 kWh/m²，20° 固定式 1392 kWh/kWp（PR 0.754） |
| 正式發電量 | **NSRDB Himawari**（NREL，衛星 2 km） | NREL 開發者帳號的 API 金鑰＋電子郵件，在 NSRDB Viewer 或 API 下載 SAM CSV | 下載時選當地標準時間（`utc=false`），用 `readCSV` 讀（欄位對照見下）；下載與授權由使用者處理，工具不代為申請 |
| 校正 | 中央氣象署日射觀測站 | 觀測資料申購或開放資料 | 用實測 GHI 檢查上面兩者的年總量與月分布，差太多時改用實測縮放 |
| 商用 | Meteonorm、Solargis | 購買 | 有授權時直接匯出 EPW 或 TMY3（`readEPW`／`readTMY3`） |

`fetch-tmy.mjs` 只送經緯度（和選用的 `--db`、`--start`、`--end`）給 PVGIS，另寫 `<檔名>.source.json` 記錄來源網址、資料庫、筆數、全年 GHI 與下載日期；檔案放在站的 `data/` 或 `docs/`（使用者資料只留本機的照各站規則）。

## 讀取

```js
import { readEPW, readCSV, simulate } from '@core/solar/index.js';
const w = readEPW(await (await fetch('./data/tmy.epw')).text());          // PVGIS 的 EPW：時區取 LOCATION 第 8 欄（台灣 +8），缺值 999 變 NaN
// NSRDB 的 SAM CSV：前兩列是站點資訊，第三列起是資料；去掉前兩列後用 readCSV 對照欄名
const nsrdb = readCSV(text.split(/\r?\n/).slice(2).join('\n'), {
  columns: { year: 'Year', month: 'Month', day: 'Day', hour: 'Hour', minute: 'Minute', ghi: 'GHI', dni: 'DNI', dhi: 'DHI', tempAir: 'Temperature', windSpeed: 'Wind Speed', albedo: 'Surface Albedo' },
  label: 'start' });   // NSRDB 的時間是區間起點（minute = 0）；minute = 30 的半點資料改用 'center'，下載後先和 pvlib.iotools 讀的結果對一次
```

注意：

- PVGIS 的 TMY 每個月取自不同年份（例如 1 月 2018、2 月 2006），`prepareSolar` 用各列自己的年份算太陽位置。
- PVGIS 的 EPW 沒有反照率與雪深（999），`simulate` 用 `system.albedo`（預設 0.2）；積雪損失（`weather/snow.js` 的 `snowLossSeries`）要另外的降雪資料。
- ΔT 預設用 Espenak–Meeus 多項式（和 pvlib 相同，2026 年估 75.4 s，實測約 69.2 s）；只影響星曆時間，台灣的太陽方向夾角差 < 0.0001°。要和實測對時請在 `site.deltaT` 傳 69.2。
