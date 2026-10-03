// 各角色的提示詞。每輪提示＝共通開頭（位置、規則、可寫範圍）＋交接摘要＋角色任務。
import { join } from 'node:path';
import { readText, rel } from './util.mjs';
import { formatAnswers } from './questions.mjs';

const ROLE_TITLE = { plan: '規劃（配置提案）', build: '開發（第一段）', fix: '修正（檢查失敗）', review: '審查', render: '渲染與細節補強' };

export function header({ ws, J, role, adapter, scope }) {
  const lines = [
    `# vs3d 任務：${ROLE_TITLE[role] || role}`,
    '',
    `- 專案資料夾（你的工作目錄）：\`${J.dir}\`，專案名稱 \`${J.id}\``,
    `- 工作區：\`${ws}\`；core 在 \`${join(ws, 'core')}\`（唯讀，框架說明在 \`core/README.md\`）`,
    `- 規則：專案的 \`AGENTS.md\`，以及工作區的 \`${join(ws, 'AGENTS.md')}\`（共通規則，必讀）`,
    `- 這一輪可以寫的範圍：${scope}`,
    `- 快速檢查：\`node ../../core/tools/check.mjs "${J.id}" --quick\``,
  ];
  // Codex 只從 git 根目錄往下找 AGENTS.md，工作區規則直接附上
  if (!adapter.loadsParentRules) lines.push('', '## 工作區共通規則（全文）', '', readText(join(ws, 'AGENTS.md')).replace(/^# .*\n/, ''));
  return lines.join('\n');
}

export function handoff({ J, check, shotsDir, notes = [], violations = [] }) {
  const out = ['## 交接摘要', ''];
  out.push(`- 需求與已拍板事項：\`AGENTS.md\``);
  if (readText(join(J.plan, 'proposal.md'))) out.push(`- 配置提案：\`.studio/plan/proposal.md\``);
  if (check) out.push(`- 最近一次檢查（${check.quick ? '快速' : '完整'}）：${check.ok ? '全部通過' : `${check.failures.length} 項失敗`}`);
  if (shotsDir) out.push(`- 截圖：\`${rel(J.dir, shotsDir)}\``);
  for (const n of notes) out.push(`- ${n}`);
  if (violations.length) out.push('', '**上一輪有越界寫入，已被 app 還原，不要再寫這些路徑：**', ...violations.slice(0, 20).map(v => `- ${v.area}：${v.path}（${v.change}${v.restored ? '，已還原' : '，未能自動還原'}）`));
  return out.join('\n');
}

const TASK = {
  plan: () => `## 任務：配置提案

讀 \`AGENTS.md\` 的需求與 \`docs/\` 裡的資料（圖片、PDF 也要看），寫出配置提案到 \`.studio/plan/proposal.md\`，章節如下：

1. 製程流程：工站與順序
2. 站位配置：各設備的位置與尺寸範圍（mm）
3. 設備選型：手臂、相機、輸送等；先找 \`core/models\` 有沒有現成模型；規格沒指定的用合理選型並標「示意」
4. 節拍估算：各步驟秒數與總節拍
5. 第一段範圍：場景、排程、視角、播放列、手機與平板版面；列出這一段不做的事（電控、配線、相機子畫面屬於第二段）
6. 假設與待確認事項

需要使用者拍板的事（例如兩種站位方案、設備選型、規格不清楚的地方）寫成問題檔，一輪最多 4 題。
這一輪只寫 \`.studio/plan/\` 與 \`.studio/questions/\`，不要建立或修改網頁與程式檔。`,

  build: () => `## 任務：第一段開發

依配置提案（\`.studio/plan/proposal.md\`）與 \`AGENTS.md\`「已拍板事項」，完成第一段：

- 場景：設備與工件寫在 \`web/js/project.js\`，能用 \`core/models\` 的模型就用
- 排程：製程時間軸（\`createStepSequence\` 或 \`createTimeline\`），節拍符合提案
- 介面：站別按鈕、視角、3D 標籤、側欄說明（\`web/js/main.js\`；\`index.html\` 的版面骨架保留）
- 播放列與手機、平板精簡版面（範本已接好，不要拿掉）
- \`tools/verify.mjs\` 改成本專案的製程規則檢查（例如節拍上限、放置位置）
- \`project.json\` 的 \`title\`、\`summary\`

範本裡的示範龍門與工件要換成本專案的內容。完成後跑快速檢查並修到通過。`,

  fix: ({ check }) => `## 任務：修正檢查失敗

app 執行的檢查結果如下：

${check ? failureText(check) : '（沒有檢查結果）'}

找出根因並修正：不要用 allow 規則蓋掉真的干涉，閃爍要改幾何。修完跑快速檢查確認。`,
};

const failureText = c => c.failures.map(f => [`- **${f.check}**：${f.note}`, ...f.detail.slice(0, 25).map(d => `    ${d}`)].join('\n')).join('\n');

export function rolePrompt(role, ctx) {
  if (!TASK[role]) throw new Error(`角色 ${role} 尚未提供提示（P4b）`);
  return [header({ ...ctx, role }), handoff(ctx), TASK[role](ctx)].join('\n\n');
}

// 續接：使用者回答問題後
export const answersPrompt = (answers, ctx) => [
  '使用者回答了你的問題：', '', formatAnswers(answers), '',
  ctx?.violations?.length ? handoff(ctx) : '',
  '請依回答繼續原本的任務；如果還有必須由使用者決定的事，再寫問題檔後結束。',
].filter(Boolean).join('\n');

// 續接：同一個修正工作階段的下一輪
export const fixAgainPrompt = (check, ctx) => [
  ctx?.violations?.length ? handoff(ctx) : '',
  `app 重新執行檢查，仍有問題：`, '', failureText(check), '', '請繼續修正，修完跑快速檢查確認。',
].filter(Boolean).join('\n');

// 問題檔格式錯誤時回送
export const invalidQuestionsPrompt = invalid => [
  '你寫的問題檔格式有誤，app 無法顯示給使用者：', '',
  ...invalid.map(x => `- \`.studio/questions/${x.file}\`：${x.errors.join('；')}`), '',
  '請依工作區 AGENTS.md「問題檔」的格式修正後結束。',
].join('\n');
