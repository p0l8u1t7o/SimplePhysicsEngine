# 四站 3D 干涉回歸檢查

使用 Node.js 22 以上，不需安裝 npm 套件。在工作區根目錄執行：

```powershell
node tools/verify-interference.mjs
```

每次修改模型、工具尺寸、配方或路徑後重跑。可單獨指定一個或多個專案：

```powershell
node tools/verify-interference.mjs MilitaryGradePC RobotArmPressSSD
```

完整執行包含 16 組檢查。失敗或測試期間原始碼變更時，程序回傳非零退出碼；可直接作為後續提交或 CI 的檢查步驟。選擇部分專案時，報告只代表這次選定範圍。

- 總表：[interference-checks.json](review/interference-checks.json)，記錄各項結果、耗時、來源 SHA-256 及完整紀錄路徑。
- 詳細輸出：各專案的 `review/checks/*.log`。
- 修正及涵蓋範圍：[四站干涉修正紀錄](docs/interference-review.md)。

`geometry-clearance.mjs` 提供模型網格的有向包圍盒分離軸檢查及含端點的時間取樣。工具法蘭安裝、壓頭接觸、滑軌支承等允許接觸由各測試明確定義。包圍盒正間距為保守淨空下限；重疊需要再檢視中空或曲面幾何，不能視為精確穿透深度。

這是可重跑的動畫回歸檢查，不是背景排程或實機安全認證；有限時間取樣不構成連續碰撞證明，仍未涵蓋完整動態軟管、線纜、公差與所有非相鄰連桿。

## 配線、穿板孔與電盤（已移到 core）

2026-10-04 起，配線動態取樣、穿板孔與電盤配置檢查都由 `core/tools/check.mjs` 內建的 `electrical` 執行（快速檢查就會跑，CI 部署前也會擋）。判定邏輯在 `core/verify/cables.mjs`、`feedthroughs.mjs`、`electrical.mjs`；各站在 `web/js/project.js` 的 `verify.cables` 宣告情境（配方、SKU、OK／NG）、障礙物與取樣時間。原本的 `verify-cable-routing.mjs`、`verify-cables.mjs`、`verify-electrical-plan.mjs` 已退役：退役前 5 站逐情境比對，線路、支架、拖鏈與取樣數完全相同、0 個失敗。

```powershell
node core/tools/check.mjs --only electrical          # 全部專案；結果在各站 review/electrical-checks.json
```

檢查內容：外露線路與支架對選定剛體的取樣碰撞（線端 10 mm 可插入接頭）、拖鏈定長與折返半徑、穿板孔真的開孔且有線穿過、背板固定柱接觸櫃壁、元件主體在櫃內且不重疊、櫃內連線不穿過元件。未模擬軟線下垂、疲勞、全線材互撞及支架強度。配置與選型依據見[五站線材研究](docs/cable-routing-review.md)、[支架檢查紀錄](docs/support-routing-review.md)、[穿板與電盤紀錄](docs/electrical-routing-review.md)、[五站電控規劃](docs/electrical-control-plan.md)（這幾份是當時的研究紀錄，裡面提到的根目錄工具已經退役）。

## 五站共用視窗控制

`core/ui/viewer-workspace.js`、`viewer-workspace.css` 管理相機拖曳、獨立視窗與產品焦點，五站直接引用同一份。詳見[操作說明](docs/viewer-controls.md)與[瀏覽器驗證紀錄](review/viewer-workspace-checks.json)。

## 跨站視覺檢查

`verify-vision.mjs` 檢查 SSD 壓合、PCB 散熱板、軍規筆電、酸鹼滴定四站的取像與結果標記（投影、曝光前不顯示結果、NG 門檻、液面追蹤）。它同時引用四站的程式，所以放在這裡，不放在某一站底下；四站干涉回歸與 RobotArmPressSSD 的完整檢查都會跑它。說明見 [視覺標記檢視](docs/vision-review.md)。

```powershell
node --import ./core/tools/register.mjs tools/verify-vision.mjs
```

## 共用執行檔（bin/）

`bin/` 放各站共用的 ffmpeg／ffprobe（錄影輸出與影片驗證用），由 `scripts\setup.ps1 -Ffmpeg` 下載，不進版控。core 的 `export-mp4.mjs`、studio、`movie-export/verify.py` 與軍規專案的錄影工具都從這裡找；也可以用環境變數 `FFMPEG_PATH` 指到別的位置。

## MP4 展示影片

[movie-export](movie-export/README.md) 使用五站網站的本機副本逐格渲染完整流程，並以 NVIDIA NVENC 編碼 1080p／30 fps MP4。包含產品追隨、電盤剖視、整線與穿板接頭。影片與抽查影格集中於忽略版控的 `TEMP/videos/`，不放進 GitHub Pages。
