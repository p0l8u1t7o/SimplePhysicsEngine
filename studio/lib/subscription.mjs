// 訂閱帳號登入（只有開發機能用；2026-10-06 拍板）。打包部署時整個刪掉這個檔：部署版只用 API 金鑰。
// 訂閱模式下 CLI 用使用者自己的登入（~/.claude、~/.codex），app 不注入任何金鑰；這裡只負責查登入狀態。
import { execFileSync, spawnSync } from 'node:child_process';
import { resolveCodex } from './adapters/codex.mjs';

export function subscriptionStatus(cli) {
  try {
    if (cli === 'claude') {
      const s = JSON.parse(execFileSync('claude', ['auth', 'status'], { encoding: 'utf8', windowsHide: true }));
      return { loggedIn: !!s.loggedIn, detail: s.authMethod || '' };
    }
    if (cli === 'codex') {
      // login status 的結果印在 stderr
      const { cmd, pre } = resolveCodex(), r = spawnSync(cmd, [...pre, 'login', 'status'], { encoding: 'utf8', windowsHide: true });
      const detail = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n')[0] || '';
      return { loggedIn: r.status === 0 && /logged in/i.test(detail), detail };
    }
  } catch (e) { return { loggedIn: false, detail: String(e.message).split('\n')[0] }; }
  return { loggedIn: false, detail: '' };
}

// 訂閱模式：不改環境變數，CLI 用自己的設定目錄與登入
export const subscriptionEnv = () => ({ env: {}, unset: [] });
