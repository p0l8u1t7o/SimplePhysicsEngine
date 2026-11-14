// 規劃角色上網查規格（2026-11-14，D 項）：其他角色維持不上網（元件補全 enrich 另有自己的規則）。
//   - 系統設定 web.planSearch（開發機預設開、部署版預設關，管理者在「設定」頁切換）、web.domains（WebFetch 可以開的廠商網域）。
//   - Claude：允許 WebSearch，WebFetch 只允許白名單網域（WebFetch(domain:…)）；Codex：--search（沒有網域限制，靠事後檢查）。
//   - 每輪結束後檢查這一輪的搜尋字串與網址：出現用戶名稱就記為違規（查詢已送出無法收回，提醒使用者處理）。
import { ALLOWED_TOOLS, DISALLOWED_TOOLS } from './adapters/claude.mjs';

// 常見的設備、零件、光學廠商官網（可在系統設定改）
export const DEFAULT_DOMAINS = [
  'denso-wave.com', 'fanuc.com', 'abb.com', 'yaskawa.com', 'kuka.com', 'universal-robots.com', 'epson.com', 'mitsubishielectric.com', 'omron.com',
  'keyence.com', 'keyence.com.tw', 'sick.com', 'cognex.com', 'baslerweb.com', 'ids-imaging.com', 'edmundoptics.com', 'computar.com', 'ccs-grp.com', 'moritex.com',
  'smcworld.com', 'smc.com', 'festo.com', 'schunk.com', 'ati-ia.com', 'robotiq.com', 'piab.com', 'schmalz.com',
  'hiwin.com.tw', 'hiwin.tw', 'thk.com', 'misumi-ec.com', 'misumi.com.tw', 'boschrexroth.com', 'orientalmotor.com', 'iai-robot.co.jp',
  'pepperl-fuchs.com', 'ifm.com', 'balluff.com', 'panasonic.com', 'siemens.com', 'beckhoff.com', 'weidmueller.com', 'phoenixcontact.com', 'rs-online.com', 'digikey.com',
];
export const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

// 這個 CLI 要加的參數（給 runAgent 的 opts）
export function webTools(policy, cli) {
  if (!policy) return {};
  if (cli === 'codex') return { search: true };
  const fetch = policy.domains.flatMap(d => [`WebFetch(domain:${d})`, `WebFetch(domain:www.${d})`]);
  return { tools: { allow: [...ALLOWED_TOOLS, 'WebSearch', ...fetch], deny: DISALLOWED_TOOLS.filter(t => t !== 'WebSearch' && t !== 'WebFetch') } };
}

// 這一輪的上網紀錄（代理事件裡的 WebSearch／WebFetch，Codex 的 web_search）；出現用戶名稱的回傳成違規
export const isWebEvent = e => e?.kind === 'tool' && /^(WebSearch|WebFetch|web_search)$/i.test(e.name || '');
export function webLeaks(events, names = []) {
  const low = names.map(n => String(n).toLowerCase()).filter(n => n.length >= 2);
  return events.filter(isWebEvent).filter(e => low.some(n => String(e.detail || '').toLowerCase().includes(n)))
    .map(e => ({ area: '上網查詢含用戶名稱', path: `${e.name}：${e.detail}`, change: 'sent', restored: false }));
}

// 系統設定 → 這次執行的政策（null 是不上網）
export function planWebPolicy(system) {
  if (!system?.['web.planSearch']) return null;
  return { domains: system['web.domains'] || DEFAULT_DOMAINS };
}
