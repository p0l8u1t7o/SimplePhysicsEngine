# Rapier（決定性版）

- 套件：`@dimforge/rapier3d-deterministic-compat` 0.21.0（WebAssembly 以 base64 內嵌在 `rapier.mjs`，瀏覽器與 Node 直接 `import`，不需要另外載入 .wasm）
- 授權：Apache-2.0（`LICENSE`）
- 來源：https://rapier.rs ／ https://github.com/dimforge/rapier
- 只放 `dist/rapier.mjs` 一個檔（約 4.4 MB）；core 用 `core/physics/` 包裝（`loadRapier()` 初始化一次），站不要直接引用這個檔。
- 更新：`npm pack @dimforge/rapier3d-deterministic-compat@<版本>`，解開後把 `package/dist/rapier.mjs` 與 `LICENSE` 換過來，改這份說明的版本號；換版後 `core/examples/physics/check.mjs` 的烘焙雜湊會變，要一起更新並記進 `core/MIGRATION.md`。
- 決定性：同一版、同樣的輸入與固定步長，瀏覽器與 Node 的結果逐位元相同（`core/examples/physics/check.mjs` 驗證）。
