// 完整檢查：三個方案各以極端焊道排版（環縫夾到可調範圍兩端、兩道縱縫）跑一次 tools/verify.mjs 的全部項目，結果寫 review/verification-extreme.json。
// 快速檢查（CI）只跑預設排版，避免超過 30 分鐘上限。
process.env.TW_VERIFY = 'extreme';
await import('./verify.mjs');
