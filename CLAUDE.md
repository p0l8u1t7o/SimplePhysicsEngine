@AGENTS.md

# Claude Code 專屬

- 選項對話用 AskUserQuestion 工具。
- 從子專案資料夾啟動時，該站 `.claude/settings.json` 的寫檔關卡會擋下範圍外的寫入。被擋下時，照提示改登記到 `core/REQUESTS.md` 或交給主 session，不要改用 shell 指令繞過。
- 從根目錄啟動的 session 不受寫檔關卡限制；用 Agent 工具派出的代理也是，照 AGENTS.md「平行代理的慣例」約束。
