# 水五金外觀 AOI 檢測機

DENSO VM-60B1：匯入 CAD 自動產生產品檔（A/B 面、遮罩、視角、路徑），偏折術免教導檢測

由 `node core/tools/new-project.mjs` 從 `core/template` 建立。框架說明見 [core/README.md](../../core/README.md)。

## 啟動

在根目錄執行 `scripts\start.cmd -Station "PlumbingFixtureInspection"`（停止：`scripts\stop.cmd`），或：

```powershell
node ../../core/tools/serve.mjs "PlumbingFixtureInspection"
```

開啟 http://127.0.0.1:8770/PlumbingFixtureInspection/。網址參數：`?pause&t=5&view=pick`、`?shadow=0`、`?cam=x,y,z,tx,ty,tz`。

手機、平板與橫向手機自動改用精簡版面（☰ 製程與視角、⚙ 播放設定、工具列 ◨ 開側欄、▣ 相機視窗、◎ 追隨工件），由 `createViewerWorkspace` 處理；`css/style.css` 只寫桌面版面。

## 檢查

```powershell
node ../../core/tools/check.mjs "PlumbingFixtureInspection"          # 完整：import 路徑、倒序一致、空間檢核、全場干涉與閃爍、四種尺寸的介面測試（ui）、本專案檢查
node ../../core/tools/check.mjs "PlumbingFixtureInspection" --quick  # 部署前快速檢查
```

## 檔案

| 檔案 | 用途 |
|---|---|
| `project.json` | 標題、首頁說明、檢查清單、情境（鵝頸出水管） |
| `web/js/layout.js` | 配置與尺寸：機台、手臂、光學艙（甜蜜點、條紋屏、相機選型與 `core/optics` 計算）、掃描位、上料抽屜、轉接頭 |
| `web/js/planner.js`、`raster.js` | 產品檔自動規劃：A/B 面、遮罩、視角集合覆蓋、拍攝順序（Node 與網頁共用） |
| `web/js/products/*.js` | 產品模組（`tools/import-cad.mjs` 產生，勿手改）：網格＋產品檔 |
| `web/js/product-mesh.js`、`codec.js` | 產品模組解碼成 three.js 幾何 |
| `web/js/inspection.js` | 產品登錄、判定規則庫、示範候選點 |
| `web/js/cell.js` | 機台、抽屜、光學艙、掃描器、讀碼器、操作螢幕 |
| `web/js/robot.js`、`poses.js` | VM-60B1＋快換器＋轉接頭、逆解選解；產品在各處的姿態 |
| `web/js/sequence.js` | 8 站排程 |
| `web/js/twin.js` | 數位空間 |
| `web/js/project.js`、`main.js` | 專案介面、網頁 |
| `tools/import-cad.mjs`、`parametric.mjs` | 匯入 CAD 產生產品檔；參數化示範件 |
| `tools/verify.mjs` | 本站檢查 |

網址參數：`?product=gooseneck`（鵝頸出水管）、`?pause&t=40&view=optics`。
