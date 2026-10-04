# 規則在 AGENTS.md

本庫的規則只寫在一份：根目錄的 `AGENTS.md`（共通規則），加上各站的 `project-site/<專案>/AGENTS.md`（該站規格與已拍板事項）。動手前先讀這兩份，照裡面的範圍、框架慣例與檢查做法進行。

重點摘要（以 `AGENTS.md` 為準）：

- 一律用繁體中文（台灣用語）回覆；程式碼、檔名保持英文，註解用繁體中文，commit 訊息用英文。
- 不得出現用戶（客戶）名稱，改用中性描述。
- 新專案只能用 `node core/tools/new-project.mjs <資料夾> "<標題>"` 建立，放在 `project-site/<專案>/`。
- 只改自己負責的站；core 缺功能時登記到 `core/REQUESTS.md`。
- 交付前跑 `node core/tools/check.mjs <專案> --quick`（含結構檢查 `structure`）；pre-commit 與 PR CI 也會檢查。
- 有未提交改動的檔案不要 `git checkout`／`restore`／`stash`；推送只在使用者要求時才做。
