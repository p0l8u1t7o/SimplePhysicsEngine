// API 金鑰的保存（2026-10-06）：只存在這台電腦的 studio/data/secrets.json（不進版控、不進交接包）。
// Windows 用 DPAPI（目前的 Windows 使用者才解得開）加密；其他系統沒有 DPAPI，只能以檔案權限保護（記為 protection: 'none'）。
// 介面與 API 只看得到末四碼與修改時間，看不到金鑰本身。環境變數 VS3D_SECRETS 可以改檔案位置（測試用）。
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { STUDIO, readJson, writeJson, now } from './util.mjs';

export const PROVIDERS = { anthropic: 'Anthropic（Claude Code）', openai: 'OpenAI（Codex）' };
const file = () => process.env.VS3D_SECRETS || join(STUDIO, 'data', 'secrets.json');

// DPAPI：金鑰經 stdin 交給 PowerShell（不放在命令列參數，其他程式看不到）
function dpapi(op, base64) {
  const script = `Add-Type -AssemblyName System.Security; $i=[Console]::In.ReadToEnd().Trim(); $b=[Convert]::FromBase64String($i); `
    + `$o=[Security.Cryptography.ProtectedData]::${op}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($o))`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: base64, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`DPAPI ${op === 'Protect' ? '加密' : '解密'}失敗：${String(r.stderr || r.error || '').trim().split('\n')[0]}`);
  return r.stdout.trim();
}
const b64 = s => Buffer.from(s, 'utf8').toString('base64'), unb64 = s => Buffer.from(s, 'base64').toString('utf8');

function check(provider, key) {
  if (!PROVIDERS[provider]) throw new Error(`不認得的服務：${provider}`);
  if (key == null) return;
  if (!/^\S{20,}$/.test(key)) throw new Error('金鑰格式不對（至少 20 個字、不能有空白）');
  if (provider === 'anthropic' && !key.startsWith('sk-ant-')) throw new Error('Anthropic 的金鑰應該以 sk-ant- 開頭');
  if (provider === 'openai' && !key.startsWith('sk-')) throw new Error('OpenAI 的金鑰應該以 sk- 開頭');
}

// key 是 null 或空字串就刪除
export function setKey(provider, key, by = '') {
  key = key == null ? null : String(key).trim() || null;
  check(provider, key);
  const all = readJson(file(), {}) || {};
  if (!key) delete all[provider];
  else {
    const win = process.platform === 'win32';
    all[provider] = { data: win ? dpapi('Protect', b64(key)) : b64(key), protection: win ? 'dpapi' : 'none', last4: key.slice(-4), updatedAt: now(), by };
  }
  writeJson(file(), all);
  try { if (process.platform !== 'win32') chmodSync(file(), 0o600); } catch { /* 改不了權限就算了 */ }
  return keyInfo()[provider] || null;
}

export function getKey(provider) {
  check(provider);
  const s = existsSync(file()) ? readJson(file(), {})?.[provider] : null;
  if (!s) return null;
  return s.protection === 'dpapi' ? unb64(dpapi('Unprotect', s.data)) : unb64(s.data);
}

// 給介面看的：只有末四碼、保護方式、修改時間與修改者
export function keyInfo() {
  const all = existsSync(file()) ? readJson(file(), {}) || {} : {};
  return Object.fromEntries(Object.keys(PROVIDERS).map(p => [p, all[p] ? { set: true, last4: all[p].last4, protection: all[p].protection, updatedAt: all[p].updatedAt, by: all[p].by || '' } : { set: false }]));
}
