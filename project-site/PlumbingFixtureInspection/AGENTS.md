# 水五金外觀 AOI 檢測機（`PlumbingFixtureInspection`）

DENSO VM-60B1：匯入 CAD 自動產生產品檔（A/B 面、遮罩、視角、路徑），偏折術免教導檢測

本檔是這個子專案的規則；全庫共通的規則在根目錄 `AGENTS.md`，從這個資料夾啟動 Claude Code 或 Codex 時會一併載入。

## 範圍

- 本站範圍是 `project-site/PlumbingFixtureInspection/`；PR 分支名稱用 `plumbingfixtureinspection/<說明>`。規則見根目錄 `AGENTS.md`「範圍」。
- core 缺功能：先在本站暫代，並登記到 `core/REQUESTS.md`。
- 待辦與待確認事項記在根目錄 `PENDING.md`「各站待確認」。

## 規格摘要

資料來源：`docs/` 的開發計畫書（客戶需求、取像模式、免教導產品檔、CT 預算、附錄 A 的 14 個分鏡）與一個真實產品 STEP（`12449.stp`，Creo 匯出、英制，套筒約 Ø41 × 69 mm，內孔底部有底環與 3 個鍵槽）。只留本機。

**免教導的做法**：新料號只要匯入 CAD，跑 `tools/import-cad.mjs` 就自動產生產品檔（`web/js/products/<id>.js`），產線端不教導；規則庫只依「表面處理 × 瑕疵類型 × A/B 面」，不依料號。

```
STEP ─(occt-import-js)→ 網格（0.01 mm）→ A/B/不檢（開放度＋夾持端）→ 遮罩（B-rep 面曲率、銳邊、孔與螺牙）
     → 候選視角（錨點 × 傾角 × 方位 × 自轉）→ 可量測（入射角、景深、視野、偏折反射打到條紋屏、遮擋）
     → 貪婪集合覆蓋（IK 可達、J5 ≤ 116°、手臂本體不碰光學艙）→ 類 TSP 排序（關節時間；會撞的段改直線退出）
```

- **規劃器**（`web/js/planner.js`，Node 與網頁共用、決定性）：光柵化深度圖算可視性（`raster.js`）；光學條件來自 `layout.js` 的 `OPTICS`／`MEASURE`（主相機選型經 `core/optics` 計算：視野 282 × 206 mm、0.069 mm/px、0.3 mm 瑕疵 4.3 px、景深 63 mm）。
- **產品**：套筒 12449（客戶 STEP，鏡面鉻，內撐式轉接頭）16 個姿態、A 面覆蓋 98.4%、單件 CT 約 63 s；鵝頸出水管（參數化示範件，筒夾式）28 個姿態、A 面 97.2%、CT 約 93 s。情境切換 `?product=gooseneck`。
- **機台**（尺寸都在 `layout.js`）：下層機櫃＋封閉遮光艙 2400 × 2000 × 2250；DENSO VM-60B1 底座轉 180°（J1 零度朝光學艙；不轉時光學艙正好在 J1 −170° 限位上）；光學艙在西側、U 形三片 43 吋直立條紋屏開口朝東、上方 8 扇區 LED 陣列、主相機＋彩色相機吊在甜蜜點正上方；3D 結構光掃描器在開口東南上方（掃描時產品軸往西傾 80°）；雙工位上料抽屜在正面東側，轉接頭水平躺在 V 形定位座上，快換器從手臂側對接。
- **流程**（`sequence.js`，8 站）：上料 → 取件辨識（快換器對接、讀轉接頭 ID）→ 3D 快掃對位（料號辨識、ICP）→ 產品檔（展示 CAD 自動生成的內容，不計 CT）→ 多姿態取像（每姿態：移動、穩定 0.3 s、條紋垂直／水平各相移 4 張＋擴散白光）→ 判定（候選 → AI 分類 → 依 A/B 面查規則庫）→ 送回輸出（右工位下一件並行）→ 品質回饋（3D 熱圖、柏拉圖）。
- **畫面**：數位空間（機台西側，`twin.js`）顯示點雲與 ICP、A/B 面、遮罩、視角圖示與路徑、取像覆蓋進度、候選點分級、熱圖；主相機子畫面；鏡面鉻產品用甜蜜點的 CubeCamera 環境貼圖反射條紋。
- **檢查**：`tools/verify.mjs`（兩種產品：產品檔一致、取像時不動且前面有穩定、條紋時機、抽屜互鎖、快換器鎖定、直線段、最後狀態、倒序一致、CT ≤ 120 s）。

## 已拍板事項

- 手臂用 DENSO VM-60B1（使用者 2026-10-11 選，13 kg、半徑約 1300 mm，符合計畫書 10～12 kg 級）。
- 客戶的 12449 STEP 轉成網格放進站內、進版控並公開發布（使用者 2026-10-11 選）。
- 「匯入 CAD 免教導」做成動畫＋離線轉檔工具（STEP → 網格 → 自動產品檔），不在網頁內拖放 STEP（2026-10-11）。
- 示範產品：套筒（12449）與鵝頸出水管兩種（2026-10-11）。

## 產品檔重產

改了光學艙配置（`layout.js` 的 `OPTICS`、`SCAN`、`ROBOT`）、規劃器或手臂工具後，兩個產品檔都要重跑（第一次先 `npm install --prefix TEMP/occt occt-import-js@0.0.23`，在根目錄）：

```powershell
node --import ../../core/tools/register.mjs tools/import-cad.mjs docs/12449.stp --id sleeve-12449 --part 12449 --name 套筒 --adapter mandrel --mount-band 6
node --import ../../core/tools/register.mjs tools/import-cad.mjs gooseneck --id gooseneck-demo --part GN-350 --name 鵝頸出水管 --adapter collet --mount-band 45
```

## 假設與待確認

標「假設」的數值都要 Phase 0／1 實測或與客戶確認後改 `layout.js`、`inspection.js`，清單在根目錄 `PENDING.md`「各站待確認」。
