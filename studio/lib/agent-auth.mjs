// 代理 CLI 的認證方式（2026-10-06 拍板）：開發機可以在「訂閱帳號登入」與「API 金鑰」之間切換（系統設定 agents.auth.<cli>）；
// 部署版只有 API 金鑰（lib/edition.mjs）。
// API 金鑰模式：啟動 CLI 時才解開金鑰交給它——Codex exec 用環境變數 CODEX_API_KEY；Claude Code 用 apiKeyHelper
// （--settings 掛 lib/key-helper.mjs，金鑰放在環境變數 VS3D_AGENT_KEY；實測 -p 模式在新的設定目錄不採用 ANTHROPIC_API_KEY）。
// 同時把 CLI 的設定目錄換成 studio/data/agent-home/<cli>（CLAUDE_CONFIG_DIR、CODEX_HOME），那裡沒有訂閱的登入憑證，
// 所以金鑰沒設好時只會失敗，不會悄悄改用訂閱帳號。工作階段存在各自的設定目錄，換認證方式後不能續接舊的工作階段。
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { STUDIO, posix } from './util.mjs';
import { isDeploy, subscriptionAllowed, SUBSCRIPTION_MODULE } from './edition.mjs';
import { getKey, keyInfo, PROVIDERS } from './secrets.mjs';

export const AUTH_MODES = { subscription: '訂閱帳號登入', apiKey: 'API 金鑰' };
export const PROVIDER_OF = { claude: 'anthropic', codex: 'openai' };
export const agentHome = cli => join(process.env.VS3D_AGENT_HOME || join(STUDIO, 'data', 'agent-home'), cli);
const subscription = () => import(pathToFileURL(SUBSCRIPTION_MODULE).href);

// 系統設定（認證方式存在資料庫）；資料庫開不了（Node 太舊）時用預設值
export async function loadSystem() {
  try {
    const [{ openPartsDb }, { readSystem }] = await Promise.all([import('./partsdb.mjs'), import('./settings.mjs')]);
    const db = openPartsDb(); try { return readSystem(db); } finally { db.close(); }
  } catch { return {}; }
}

// 這個 CLI 目前用哪一種認證：部署版（或訂閱的程式已經拿掉）一律是 apiKey
export function authMode(cli, system = {}) {
  if (isDeploy() || !subscriptionAllowed()) return 'apiKey';
  return system[`agents.auth.${cli}`] === 'apiKey' ? 'apiKey' : 'subscription';
}

export const KEY_HELPER = join(STUDIO, 'lib', 'key-helper.mjs');

// 執行代理時要加的東西：{ mode, env, unset, settings }（settings 是要併進 Claude Code --settings 的設定）。
// API 金鑰模式沒有金鑰就丟出錯誤（不退回訂閱帳號）
export async function agentEnv(cli, system) {
  if (!PROVIDER_OF[cli]) return { mode: '', env: {}, unset: [] };          // 測試用的假代理
  const mode = authMode(cli, system ?? await loadSystem());
  if (mode === 'subscription') return { mode, ...(await subscription()).subscriptionEnv(cli) };
  const provider = PROVIDER_OF[cli], key = getKey(provider);
  if (!key) throw new Error(`${cli} 設定為用 API 金鑰，但還沒有設定 ${PROVIDERS[provider]} 的金鑰（介面「設定」的 API 金鑰，管理者）`);
  const home = agentHome(cli); mkdirSync(home, { recursive: true });
  return cli === 'claude'
    ? { mode, env: { VS3D_AGENT_KEY: key, CLAUDE_CONFIG_DIR: home }, unset: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
        settings: { apiKeyHelper: `node "${posix(KEY_HELPER)}"` } }
    : { mode, env: { CODEX_API_KEY: key, CODEX_HOME: home }, unset: ['OPENAI_API_KEY'] };
}

// 介面與 doctor 用：{ mode, loggedIn, detail }
export async function authStatus(cli, system) {
  const mode = authMode(cli, system ?? await loadSystem());
  if (mode === 'subscription') return { mode, ...(await subscription()).subscriptionStatus(cli) };
  const k = keyInfo()[PROVIDER_OF[cli]];
  return { mode, loggedIn: !!k?.set, detail: k?.set ? `API 金鑰 …${k.last4}` : '還沒有設定 API 金鑰' };
}
