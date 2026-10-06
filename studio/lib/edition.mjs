// 版本別（2026-10-06 拍板）：開發機（dev）可以在訂閱帳號與 API 金鑰之間切換；打包部署（deploy，給同事用的中央主機）
// 拿掉訂閱帳號功能，只用 API 金鑰，避免違反訂閱方案的條款。
//   - 版本別：環境變數 VS3D_EDITION，或打包時寫進 studio/edition.json 的 { "edition": "deploy" }；都沒有就是 dev。
//   - 訂閱帳號的程式只放在 lib/subscription.mjs：打包部署時整個刪掉這個檔（不是只把選項藏起來），
//     `vs3d edition` 會檢查部署版裡確實沒有它。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { STUDIO, readJson } from './util.mjs';

export const EDITIONS = { dev: '開發機', deploy: '部署版' };
export const SUBSCRIPTION_MODULE = join(STUDIO, 'lib', 'subscription.mjs');

export function edition() {
  const e = process.env.VS3D_EDITION || readJson(join(STUDIO, 'edition.json'), null)?.edition || 'dev';
  if (!EDITIONS[e]) throw new Error(`不認得的版本別：${e}（只能是 dev 或 deploy）`);
  return e;
}
export const isDeploy = () => edition() === 'deploy';
// 訂閱帳號功能可不可以用：開發機、而且 subscription.mjs 還在
export const subscriptionAllowed = () => !isDeploy() && existsSync(SUBSCRIPTION_MODULE);

// 部署版的自我檢查：回傳問題清單（空的就是通過）
export function editionProblems() {
  const out = [];
  if (isDeploy() && existsSync(SUBSCRIPTION_MODULE)) out.push(`部署版不能包含訂閱帳號的程式：${SUBSCRIPTION_MODULE}`);
  return out;
}
