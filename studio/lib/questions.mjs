// 提問機制（計畫書 4.5）：代理寫 .studio/questions/<id>.json 後結束該輪；app 在終端機詢問（或由 vs3d answer 回答），
// 答案寫進 .studio/answers/<id>.json 與專案 AGENTS.md「已拍板事項」，再續接提問的工作階段。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { readJson, writeJson, readText, writeText, now } from './util.mjs';

const ID_RE = /^[\w.-]{1,64}$/;

export function validateQuestion(q, file = '') {
  const errors = [];
  if (!q || typeof q !== 'object') return { errors: [`${file} 不是 JSON 物件`] };
  if (!ID_RE.test(q.id || '')) errors.push('id 只能用英數、-、_、.');
  if (!String(q.question || '').trim()) errors.push('缺少 question');
  if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) errors.push('options 要 2～4 個');
  else q.options.forEach((o, i) => { if (!String(o?.label || '').trim()) errors.push(`options[${i}] 缺少 label`); });
  const rec = Number.isInteger(q.recommended) && q.recommended >= 0 && q.recommended < (q.options?.length || 0) ? q.recommended : null;
  return { errors, q: { ...q, header: String(q.header || '').slice(0, 12), recommended: rec, multiSelect: !!q.multiSelect } };
}

// 全部問題（含已回答）；格式錯的另外列出，回送代理修正
export function loadQuestions(J) {
  const list = [], invalid = [];
  if (!existsSync(J.questions)) return { list, invalid };
  for (const f of readdirSync(J.questions).filter(f => f.endsWith('.json')).sort()) {
    let raw; try { raw = JSON.parse(readFileSync(join(J.questions, f), 'utf8').replace(/^﻿/, '')); } catch (e) { invalid.push({ file: f, errors: [`JSON 解析失敗：${e.message}`] }); continue; }
    const { errors, q } = validateQuestion(raw, f);
    if (errors.length) { invalid.push({ file: f, errors }); continue; }
    list.push({ ...q, file: f, answered: existsSync(join(J.answers, `${q.id}.json`)) });
  }
  return { list, invalid };
}
export const pendingQuestions = J => loadQuestions(J).list.filter(q => !q.answered);

// "2"、"1,3"（多選）或任意文字（＝其他）
export function parseChoice(q, input) {
  const s = String(input ?? '').trim();
  if (/^\d+(\s*,\s*\d+)*$/.test(s)) {
    const idx = s.split(',').map(x => +x.trim() - 1);
    if (idx.every(i => i >= 0 && i < q.options.length) && (q.multiSelect || idx.length === 1)) return { choices: idx, text: '' };
    if (idx.length === 1 && idx[0] === -1) return null;          // 0＝其他，要再輸入文字
    throw new Error(`選項編號要在 1～${q.options.length}${q.multiSelect ? '（可用逗號多選）' : ''}`);
  }
  if (!s) throw new Error('沒有輸入');
  return { choices: [], text: s };
}

export function recordAnswer(J, q, { choices = [], text = '', note = '' }) {
  const labels = choices.map(i => q.options[i].label);
  const answer = { id: q.id, header: q.header, question: q.question, choices, labels, text, note, at: now() };
  writeJson(join(J.answers, `${q.id}.json`), answer);
  // 寫進專案 AGENTS.md「已拍板事項」
  const line = `- **${q.header || q.id}**：${[...labels, text].filter(Boolean).join('、')}${note ? `（${note}）` : ''}　<!-- ${q.id} -->`;
  writeText(J.agents, appendToSection(readText(J.agents), '## 已拍板事項', line));
  return answer;
}

// 在指定段落的最後加一行（段落不存在就加在檔尾）
export function appendToSection(md, heading, line) {
  const start = md.indexOf(heading);
  if (start < 0) return md.trimEnd() + `\n\n${heading}\n\n${line}\n`;
  const next = md.indexOf('\n## ', start + heading.length);
  const end = next < 0 ? md.length : next + 1;
  return md.slice(0, end).trimEnd() + '\n' + line + '\n' + (next < 0 ? '' : '\n' + md.slice(end));
}

export const formatAnswers = answers => answers.map(a =>
  `- ${a.header || a.id}（${a.id}）：${a.question}\n  回答：${[...a.labels, a.text].filter(Boolean).join('、') || '（未選）'}${a.note ? `\n  補充：${a.note}` : ''}`).join('\n');

export function printQuestion(q, i = 0, n = 1, out = console.log) {
  out(`\n── 問題 ${i + 1}/${n}${q.header ? `［${q.header}］` : ''}（${q.id}）`);
  out(q.question);
  q.options.forEach((o, k) => out(`  ${k + 1}. ${o.label}${k === q.recommended ? '（建議）' : ''}${o.description ? `\n     ${o.description}` : ''}`));
  out(`  0. 其他（自己輸入說明）`);
}

// 終端機互動：逐題詢問；回傳答案陣列
export async function askInteractive(J, qs) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answers = [];
  try {
    for (const [i, q] of qs.entries()) {
      printQuestion(q, i, qs.length);
      let parsed = null;
      while (!parsed) {
        const s = await rl.question(q.multiSelect ? '請輸入編號（可用逗號多選）：' : '請輸入編號：');
        try {
          parsed = parseChoice(q, s);
          if (parsed === null) { const t = (await rl.question('請輸入你的說明：')).trim(); if (t) parsed = { choices: [], text: t }; }
        } catch (e) { console.log('  ' + e.message); }
      }
      const note = (await rl.question('補充說明（可留空）：')).trim();
      answers.push(recordAnswer(J, q, { ...parsed, note }));
    }
  } finally { rl.close(); }
  return answers;
}

// app 自己發出的問題（例如同一項檢查連續失敗）
export function writeAppQuestion(J, q) { writeJson(join(J.questions, `${q.id}.json`), { ...q, source: 'app' }); }
export const readAnswer = (J, id) => readJson(join(J.answers, `${id}.json`));
