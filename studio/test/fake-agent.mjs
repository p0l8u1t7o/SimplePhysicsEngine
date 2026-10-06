// 測試用假代理：從 stdin 讀提示，依劇本動作，輸出 Claude 格式的 stream-json。不連網、不耗額度。
//   規劃：先問一題 → 收到回答後寫提案
//   開發：讓 tools/verify.mjs 在沒有 web/fixed.txt 時失敗，並刻意越界改 core（測試還原）
//   修正：建立 web/fixed.txt
import { writeFileSync, mkdirSync, chmodSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let prompt = '';
for await (const c of process.stdin) prompt += c;
const sid = process.env.FAKE_SESSION || 'fake-' + Math.random().toString(36).slice(2, 8);
const say = o => process.stdout.write(JSON.stringify(o) + '\n');
const tool = (name, file_path) => say({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name, input: { file_path } }] } });
say({ type: 'system', subtype: 'init', session_id: sid });
const cwd = process.cwd(), w = (f, s) => { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, s); tool('Write', f); };
const log = process.env.FAKE_LOG; if (log) appendFileSync(log, prompt.split('\n')[0] + '\n');

let text = 'DONE';
const reviewN = /任務：審查(?:第一段|修改後的|第二段（[^）]*）)成品（第 (\d+) 次）/.exec(prompt)?.[1];
if (/任務：元件補全/.test(prompt)) {
  // 元件補全：照 part.json 寫 result.json（一個合格、一個沒有來源、一個數字欄位寫錯；FAKE_ENRICH_FILE 是可以下載的網址）
  const part = JSON.parse(readFileSync(join(cwd, 'part.json'), 'utf8')), src = 'https://example.com/cam';
  w(join(cwd, 'result.json'), JSON.stringify({
    matched: true, note: `查到 ${part.name} 的原廠頁面`,
    fields: { brand: { value: '示範廠', source: src, quote: 'Brand: 示範廠', confidence: 'high' }, model: { value: 'DEMO-5MP' } },
    attrs: { 像素尺寸: { value: '3.45 µm', source: src, quote: 'Pixel size 3.45 µm', confidence: 'high' }, 幀率: { value: '很快', source: src }, 介面: { value: 'GigE', source: src, confidence: 'medium' } },
    price: { value: 21000, currency: 'TWD', date: '2026-10-01', source: src, quote: '含稅 21,000' },
    files: process.env.FAKE_ENRICH_FILE ? [{ url: process.env.FAKE_ENRICH_FILE, kind: 'datasheet', title: '規格書' }] : [],
  }));
  text = '查到 4 個欄位';
} else if (/任務：依使用者的要求修改/.test(prompt)) {
  // 修改指令：在專案裡加一個檔，並改一個既有檔
  w(join(cwd, 'web/change.txt'), 'changed');
  const readme = join(cwd, 'README.md'); appendFileSync(readme, '\n修改紀錄：假代理\n'); tool('Edit', readme);
  text = '修改完成';
} else if (/任務：第二段規劃/.test(prompt)) {
  // 第二段規劃：寫提案與元件表，並列出一個用戶名稱（測試名單同步）
  w(join(cwd, '.studio/plan/segment2.md'), '# 第二段提案\n\n電盤放東側\n');
  w(join(cwd, '.studio/plan/segment2.json'), JSON.stringify({ cabinet: { center: [1600, 450, -500], size: [600, 900, 400] }, components: [], cameras: [] }));
  w(join(cwd, '.studio/plan/client-names.txt'), '測試用戶甲\n');
  text = '第二段提案完成';
} else if (/任務：第二段開發/.test(prompt)) {
  // FAKE_SEG2_BREAK：第二段改到第一段的節拍（要被排程指紋擋下）
  const pj = join(cwd, 'web/js/project.js');
  if (process.env.FAKE_SEG2_BREAK) { writeFileSync(pj, readFileSync(pj, 'utf8').replace('total: tl.total,', 'total: tl.total + 1,')); tool('Edit', pj); }
  w(join(cwd, 'web/segment2.txt'), 'electrical');
  text = '第二段完成';
} else if (/排程指紋/.test(prompt) && /修正/.test(prompt)) {
  const pj = join(cwd, 'web/js/project.js');
  writeFileSync(pj, readFileSync(pj, 'utf8').replace('total: tl.total + 1,', 'total: tl.total,')); tool('Edit', pj);
  text = '已還原第一段的節拍';
} else if (reviewN) {
  // 第 1 次審查抓到 1 項必修，修好後第 2 次只剩建議補強
  const must = reviewN === '1' && !existsSync(join(cwd, 'web/review-fixed.txt')) ? [{ id: 'M1', issue: '順序做反（違反已拍板事項）', evidence: 'web/js/project.js', fix: '改回先小後大' }] : [];
  w(join(cwd, `.studio/reviews/review-${reviewN}.json`), JSON.stringify({ must, suggest: [{ id: 'S1', area: '材質', item: '鋁件加細紋', priority: 1 }, { id: 'S2', area: '標籤', item: '標籤加底色', priority: 2 }], summary: '假審查' }));
  text = '審查完成';
} else if (/任務：修正審查發現的必修問題/.test(prompt)) {
  w(join(cwd, 'web/review-fixed.txt'), 'ok');
  text = '必修已修正';
} else if (/任務：渲染與細節補強/.test(prompt)) {
  const pj = join(cwd, 'web/js/project.js');
  if (process.env.FAKE_RENDER_BREAK) { writeFileSync(pj, readFileSync(pj, 'utf8').replace('total: tl.total,', 'total: tl.total + 1,')); tool('Edit', pj); }
  w(join(cwd, 'web/render-detail.txt'), 'detail');
  text = '補強完成';
} else if (/守門檢查沒有通過/.test(prompt)) {
  const pj = join(cwd, 'web/js/project.js');
  writeFileSync(pj, readFileSync(pj, 'utf8').replace('total: tl.total + 1,', 'total: tl.total,')); tool('Edit', pj);
  text = '已修正守門檢查';
} else if (/任務：配置提案/.test(prompt)) {
  w(join(cwd, '.studio/questions/site-1.json'), JSON.stringify({ id: 'site-1', header: '站位', question: '輸送帶放左邊還是右邊？', options: [{ label: '左邊', description: 'a' }, { label: '右邊', description: 'b' }], recommended: 0 }));
  text = '寫了 1 個問題';
} else if (/^使用者回答了你的問題/.test(prompt) || /要求修改/.test(prompt)) {
  w(join(cwd, '.studio/plan/proposal.md'), '# 配置提案\n\n輸送帶在' + (/左邊/.test(prompt) ? '左邊' : '右邊') + '\n');
  text = '提案完成';
} else if (/任務：第一段開發/.test(prompt)) {
  const v = join(cwd, 'tools/verify.mjs');
  w(v, `import { existsSync } from 'node:fs';\nif (!existsSync(new URL('../web/fixed.txt', import.meta.url))) { console.log('缺少 fixed.txt'); process.exit(1); }\nconsole.log('ok');\n`);
  if (process.env.FAKE_ESCAPE) {   // 模擬用 shell 繞過關卡改 core
    const f = join(cwd, '../../core/README.md'); chmodSync(f, 0o644); appendFileSync(f, '\nescape\n');
    writeFileSync(join(cwd, 'AGENTS.md'), readFileSync(join(cwd, 'AGENTS.md'), 'utf8') + '\n偷改\n');
  }
  text = '第一段完成';
} else if (/修正/.test(prompt) || /仍有問題/.test(prompt)) {
  if (!process.env.FAKE_NEVER_FIX) w(join(cwd, 'web/fixed.txt'), 'ok');
  text = '修正完成';
}
say({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
say({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: sid, num_turns: 1, usage: {} });
if (existsSync(join(cwd, 'NEVER'))) process.exit(1);
