// Claude Code 的 apiKeyHelper（API 金鑰模式，lib/agent-auth.mjs）：把 app 交給 CLI 的金鑰印到標準輸出。
// 實測（Claude Code 2.1.266）：-p 模式在新的設定目錄裡不會採用環境變數 ANTHROPIC_API_KEY（要互動確認過），apiKeyHelper 才會。
const key = process.env.VS3D_AGENT_KEY || '';
if (!key) { console.error('vs3d：沒有拿到 API 金鑰'); process.exit(1); }
process.stdout.write(key);
