// 規劃角色上網（lib/web-policy.mjs）：系統設定 → 工具參數；查詢字串帶用戶名稱記為違規；網域清單清理
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webTools, webLeaks, planWebPolicy, DEFAULT_DOMAINS } from '../lib/web-policy.mjs';
import { cleanSystem } from '../lib/settings.mjs';

test('關掉就不上網；Claude 只放行白名單網域的 WebFetch，Codex 用 --search', () => {
  assert.equal(planWebPolicy({ 'web.planSearch': false }), null);
  assert.deepEqual(webTools(null, 'claude'), {});
  const p = planWebPolicy({ 'web.planSearch': true, 'web.domains': ['keyence.com'] });
  const t = webTools(p, 'claude').tools;
  assert.ok(t.allow.includes('WebSearch') && t.allow.includes('WebFetch(domain:keyence.com)') && t.allow.includes('WebFetch(domain:www.keyence.com)'));
  assert.ok(!t.deny.includes('WebSearch') && !t.deny.includes('WebFetch') && t.deny.includes('Bash(git push:*)'));
  assert.deepEqual(webTools(p, 'codex'), { search: true });
  assert.ok(planWebPolicy({ 'web.planSearch': true }).domains.length === DEFAULT_DOMAINS.length);
});

test('查詢字串或網址含用戶名稱就記為違規；網域清單去掉 https、www 與路徑', () => {
  const ev = [{ kind: 'tool', name: 'WebSearch', detail: 'DENSO VS-068 payload' }, { kind: 'tool', name: 'WebSearch', detail: '甲公司 回收 分揀' }, { kind: 'tool', name: 'Read', detail: '甲公司.txt' }];
  const v = webLeaks(ev, ['甲公司']);
  assert.equal(v.length, 1); assert.match(v[0].path, /^WebSearch：甲公司/);
  assert.deepEqual(cleanSystem({ 'web.domains': 'https://www.Keyence.com/tw/products\nsick.com, sick.com' })['web.domains'], ['keyence.com', 'sick.com']);
  assert.throws(() => cleanSystem({ 'web.domains': 'not a domain' }), /格式不對/);
  assert.throws(() => cleanSystem({ 'web.planSearch': 'yes' }), /true 或 false/);
});
