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
const reviewN = /任務：審查第一段成品（第 (\d+) 次）/.exec(prompt)?.[1];
if (reviewN) {
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
