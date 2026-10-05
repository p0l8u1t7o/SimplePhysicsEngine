# core 需求登記

子專案發現 core 缺功能時，先在專案內暫代，再登記在這裡；由主 session（core 維護）判斷後統一實作（基準截圖 → 實作 → 全專案檢查 → 比對），再讓各站改用。規則見根目錄 `AGENTS.md`「範圍」。

任何範圍的 session 都可以改本檔。登記格式：

```
### <一句話需求>
- 提出：<專案>（<日期>）
- 暫代：<專案內的檔案與函式>
- 期望介面：<想要的 core API，例如 createX({ … })>
- 影響：<還有哪些站可能會用到>
```

實作完成後，把該條目移到 `core/MIGRATION.md` 的進度紀錄，並從這裡刪除。

## 待處理

### 並聯（Delta）手臂模型
- 提出：RecycleSorter（2026-10-05）
- 暫代：`project-site/RecycleSorter/web/js/delta.js` 的 `createDelta({ geometry, toolLen, hose })`、`deltaIK(p, geometry)`（ABB IRB 360 型：三支主動臂、平行連桿、中央伸縮軸；吸嘴與真空軟管是該站的工具）
- 期望介面：`core/models/robots/abb-irb360.js`，照共用模型的 `meta`＋`create(params) → { root, set(state) }`；state 是動平台中心 `[x, y, z]`，另匯出閉式逆解與幾何常數。工具與軟管留在專案
- 影響：之後有高速取放（食品、包裝、分揀）的站都會用到。搬進 core 時連桿尺寸要用型錄核對，目前是現場照片目測的示意值

### 擴張網護板材質
- 提出：RecycleSorter（2026-10-05）
- 暫代：`project-site/RecycleSorter/web/js/frontline.js` 的 `meshGuard` 材質與 `guard(parent, a, b)`（網目貼圖依實際尺寸換算 UV，所有護板共用一個材質）
- 期望介面：`@core/geom/materials.js` 的 `MAT.expandedMesh`（或 `meshPanel(parent, a, b, { cell })`）
- 影響：有圍籬或網籠的站（目前各站用半透明的 `MAT.mesh`，近看沒有網目）
