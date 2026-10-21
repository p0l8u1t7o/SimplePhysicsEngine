# 200L 化學桶自動清洗線（`ChemicalTankWashing`）

穿梭車密集架＋AGV、龍門翻桶、貼標定位、自動開蓋、FANUC 手臂沖洗與負壓抽乾。

本檔是這個子專案的規則；全庫共通的規則在根目錄 `AGENTS.md`，從這個資料夾啟動 Claude Code 或 Codex 時會一併載入。

## 範圍

- 本站範圍是 `project-site/ChemicalTankWashing/`；PR 分支名稱用 `chemicaltankwashing/<說明>`。規則見根目錄 `AGENTS.md`「範圍」。
- core 缺功能：先在本站暫代，並登記到 `core/REQUESTS.md`。
- 待辦與待確認事項記在根目錄 `PENDING.md`「各站待確認」。

## 規格摘要

見 [README.md](README.md)（完整的拍板清單在 README「已拍板」）。使用者提供的規格與圖面在 `docs/`（只留本機）。

## 已拍板事項

- 穿梭車密集架（每層一台共 3 台，換道由 AGV 搬運）、龍門翻轉上料、線上自動開蓋、FANUC R-2000iC/165F 沖洗。
- 產能維持約 24 桶／h，不加站；手臂節拍約 151 s（瓶頸），動畫全長 753.1 s（散桶入庫 4 桶＋一個棧板 4 桶清洗）。
- 末道負壓抽乾＋熱風吹乾，放回位秤重殘水 < 100 g 才放行；酸、鹼依桶號分兩個廢液槽。
- 換用 core 模型不能改變本站的檢查結果；被安裝關係放行蓋住的既有干涉另記在根目錄 `PENDING.md`。
