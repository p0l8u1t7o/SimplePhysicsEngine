#!/usr/bin/env node
// vs3d：3D 設備動畫生成應用程式的命令列原型（P1）。不需要 npm 套件。
//   node studio/vs3d.mjs doctor                                   檢查 Claude Code／Codex 是否已安裝、已登入
//   node studio/vs3d.mjs init [--refresh-core]                    建立工作區（複製 core、寫入共通規則）；--refresh-core 換成本庫目前的 core
//   node studio/vs3d.mjs new <名稱> --prompt "<需求>" [--files 檔案…] [--title 標題] [--cli claude|codex] [--private "用戶名稱,…"]
//                                                                 --private：不得顯示的用戶名稱（加進工作區名單，需求原文裡換成「（用戶）」）
//   node studio/vs3d.mjs resume <名稱>                            續跑（回答問題後、中斷後）
//   node studio/vs3d.mjs answer <名稱> <問題 id> <編號或文字> [--note 補充]
//   node studio/vs3d.mjs status [<名稱>]                          進度、等待中的問題、最近一次檢查
//   node studio/vs3d.mjs check <名稱> [--full]                    手動跑檢查
//   node studio/vs3d.mjs review <名稱> [--no-fix]                 重新審查（必修項自動送修正），接著補強；--no-fix 只審查、不修正
//   node studio/vs3d.mjs render <名稱> [--pick] [--focus "範圍"]  重新做渲染與細節補強（--pick 先挑項目）
//   node studio/vs3d.mjs stage2 <名稱>                            開始第二段（電控、電盤、配線、相機）；第一段完成時也會出卡片詢問
//   node studio/vs3d.mjs probe <名稱> [--cli …] [--other <專案>] [--simulate]   寫入隔離自我測試（--simulate：app 另外模擬越界寫入）
//   node studio/vs3d.mjs models                                   各 CLI 可用的模型與各角色目前的指派
//   node studio/vs3d.mjs ui [--port 8780] [--no-open]             開啟網頁介面（http://127.0.0.1:8780/）
// 共通選項：--workspace <資料夾>（預設 %USERPROFILE%\Documents\3D-Studio，或環境變數 VS3D_WORKSPACE）
//   --cli、--model（所有角色）、--role plan=opus,fix=haiku（個別角色；可寫 codex:<模型>）、--effort
//   --no-wait（有問題時寫出後結束，不在終端機詢問）、--auto-approve（配置提案不必確認）、--max-rounds 40、--timeout 90（分鐘／輪）
//   new 另有 --create-only（只建立專案，之後用 resume 開始）
//   每段完成後預設自動審查與補強；--no-review、--no-render 關掉，--no-perf 不量效能，--pick 讓你先挑補強項目；--no-stage2 第一段完成後不問第二段
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { ADAPTERS, adapterFor } from './lib/adapters/index.mjs';
import { initWorkspace, createProject, paths, projectPaths } from './lib/workspace.mjs';
import { runProject, loadState, beginSegment2 } from './lib/loop.mjs';
import { loadQuestions, parseChoice, recordAnswer, printQuestion } from './lib/questions.mjs';
import { runChecks, failureSummary } from './lib/checks.mjs';
import { ROLES, resolveRole, loadRoleContext, parseRoleOverrides } from './lib/roles.mjs';
import { isolationProbe } from './lib/probe.mjs';
import { defaultWorkspace, readText, readJson, writeJson } from './lib/util.mjs';

const VALUE = new Set(['--workspace', '--private', '--prompt', '--prompt-file', '--title', '--summary', '--cli', '--model', '--role', '--effort', '--note', '--max-rounds', '--timeout', '--other', '--focus', '--port']);

// 測試用：VS3D_EXTRA_ADAPTERS 指向一個匯出 { adapters: { 名稱: adapter } } 的模組（例如假代理），讓介面的端對端測試走真正的命令列
if (process.env.VS3D_EXTRA_ADAPTERS) Object.assign(ADAPTERS, (await import(pathToFileURL(resolve(process.env.VS3D_EXTRA_ADAPTERS)).href)).adapters);
function parseArgs(argv) {
  const opts = { _: [], files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--files') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) opts.files.push(resolve(argv[++i])); }
    else if (VALUE.has(a)) opts[a.slice(2)] = argv[++i];
    else if (a.startsWith('--')) opts[a.slice(2)] = true;
    else opts._.push(a);
  }
  return opts;
}

const o = parseArgs(process.argv.slice(2)), [cmd, name, ...rest] = o._;
const ws = resolve(o.workspace || defaultWorkspace());
const override = { cli: o.cli, model: o.model, roles: parseRoleOverrides(o.role || ''), autoApprove: !!o['auto-approve'], pick: !!o.pick, focus: o.focus || '' };
if (o.effort) for (const r of Object.keys(ROLES)) override.roles[r] = { ...override.roles[r], effort: o.effort };
if (o.cli && !ADAPTERS[o.cli]) fail(`--cli 只能是 ${Object.keys(ADAPTERS).join('、')}`);
const runOpts = () => ({ interactive: !!process.stdin.isTTY && !o['no-wait'], override, maxRounds: +(o['max-rounds'] || 40), timeoutMin: +(o.timeout || 90),
  review: !o['no-review'], reviewFix: !o['no-fix'], render: !o['no-render'], perf: !o['no-perf'], stage2: !o['no-stage2'] });
const needWs = () => { if (!existsSync(paths(ws).marker)) fail(`工作區還沒建立：${ws}（先執行 vs3d init，或用 --workspace 指定）`); };
const needProject = () => { needWs(); if (!name) fail('請指定專案名稱'); if (!existsSync(projectPaths(ws, name).dir)) fail(`找不到專案：${name}`); return projectPaths(ws, name); };
function fail(msg) { console.error(msg); process.exit(2); }

switch (cmd) {
  case 'doctor': {
    for (const a of Object.values(ADAPTERS)) {
      const d = a.detect();
      console.log(`${d.installed && d.loggedIn ? '✓' : '✗'} ${a.label.padEnd(12)} ${d.installed ? d.version : '未安裝'}${d.installed ? (d.loggedIn ? `，已登入（${d.detail}）` : `，未登入：${d.detail}`) : ''}`);
    }
    console.log(`工作區：${ws}${existsSync(paths(ws).marker) ? '' : '（尚未建立）'}`);
    break;
  }
  case 'init': initWorkspace(ws, { refreshCore: !!o['refresh-core'] }); console.log(`工作區就緒：${ws}`); break;
  case 'new': {
    if (!name) fail('用法：vs3d new <名稱> --prompt "<需求>" [--files …]');
    if (!/^[\w][\w .-]*$/.test(name)) fail('專案名稱請用英數、空白、- 或 _');
    if (!existsSync(paths(ws).marker)) initWorkspace(ws);
    const prompt = o['prompt-file'] ? readText(resolve(o['prompt-file'])) : (o.prompt || '');
    if (!prompt.trim() && !o.files.length) fail('請用 --prompt 或 --files 提供需求');
    for (const f of o.files) if (!existsSync(f)) fail(`找不到檔案：${f}`);
    const J = await createProject(ws, { id: name, title: o.title || name, summary: o.summary || '', prompt, files: o.files, cli: o.cli, clientNames: String(o.private || '').split(/[,，、]/) });
    // new 時指定的 --model／--effort／--role 寫進 studio.json，之後 resume 沒帶參數也沿用（否則續接會退回預設模型）
    const sj = readJson(J.studioJson, {});
    for (const r of Object.keys(ROLES)) {
      const x = { ...(o.cli ? { cli: o.cli } : {}), ...(o.model ? { model: o.model } : {}), ...(override.roles[r] || {}) };
      if (Object.keys(x).length) sj.roles = { ...sj.roles, [r]: x };
    }
    writeJson(J.studioJson, sj);
    console.log(`已建立專案：${J.dir}`);
    for (const n of J.notes || []) console.log(n);
    if (!o['create-only']) report(await runProject(ws, name, runOpts()));
    break;
  }
  case 'resume': needProject(); report(await runProject(ws, name, runOpts())); break;
  case 'review':
  case 'render': {
    const J = needProject(), s = loadState(J);
    if (!['done', 'review', 'render', 'render-guard', 'render-revise'].includes(s.stage)) fail(`專案目前在「${s.stage}」階段，第一段完成後才能${cmd === 'review' ? '審查' : '補強'}`);
    Object.assign(s, { stage: cmd, waiting: null, renderBase: null, renderPicked: false, renderItems: null, renderTries: 0 });
    if (cmd === 'review') s.reviews = 0;
    writeJson(J.state, s);
    report(await runProject(ws, name, runOpts()));
    break;
  }
  case 'stage2': {
    const J = needProject(), s = loadState(J);
    if ((s.segment || 1) === 2) fail(`專案已經在第二段（階段 ${s.stage}）；續跑用 vs3d resume`);
    if (s.stage !== 'done') fail(`專案目前在「${s.stage}」階段，第一段完成後才能開始第二段`);
    writeJson(J.state, beginSegment2(s));
    report(await runProject(ws, name, runOpts()));
    break;
  }
  case 'answer': {
    const J = needProject(), [qid, ...words] = rest;
    const q = loadQuestions(J).list.find(x => x.id === qid);
    if (!q) fail(`找不到問題 ${qid}（vs3d status "${name}" 可以看等待中的問題）`);
    let parsed; try { parsed = parseChoice(q, words.join(' ')); } catch (e) { fail(e.message); }
    if (!parsed) fail('選 0（其他）時請直接輸入說明文字');
    const a = recordAnswer(J, q, { ...parsed, note: o.note || '' });
    console.log(`已記錄：${q.header || q.id} → ${[...a.labels, a.text].filter(Boolean).join('、')}`);
    const left = loadQuestions(J).list.filter(x => !x.answered);
    console.log(left.length ? `還有 ${left.length} 題：${left.map(x => x.id).join('、')}` : `全部回答完畢，執行 vs3d resume "${name}" 續跑。`);
    break;
  }
  case 'status': {
    needWs();
    const ids = name ? [name] : readdirSync(paths(ws).projects).filter(n => existsSync(join(paths(ws).projects, n, '.studio', 'state.json')));
    for (const id of ids) {
      const J = projectPaths(ws, id), s = loadState(J), pending = loadQuestions(J).list.filter(q => !q.answered);
      console.log(`\n${id}：${(s.segment || 1) === 2 ? '第二段，' : ''}階段 ${s.stage}，${s.round} 輪${s.lastCheck ? `，最近檢查 ${s.lastCheck.ok ? '通過' : `${s.lastCheck.failures.length} 項失敗`}` : ''}`);
      for (const [r, v] of Object.entries(s.sessions)) console.log(`  ${r.padEnd(6)} ${v.cli}${v.model ? ' ' + v.model : ''}  ${v.sessionId}`);
      pending.forEach((q, i) => printQuestion(q, i, pending.length));
    }
    break;
  }
  case 'check': {
    needProject();
    const c = await runChecks(ws, name, { quick: !o.full });
    console.log(failureSummary(c));
    process.exitCode = c.ok ? 0 : 1;
    break;
  }
  case 'probe': {
    needProject();
    const r = await isolationProbe(ws, name, { cli: o.cli || 'claude', model: o.model, other: o.other, simulate: !!o.simulate });
    process.exitCode = r.ok ? 0 : 1;
    break;
  }
  case 'models': {
    for (const a of Object.values(ADAPTERS)) console.log(`${a.label}：${a.listModels().join('、') || '（帳號預設模型；可在 studio.json 指定名稱）'}`);
    const ctx = loadRoleContext(paths(ws).settings, name ? projectPaths(ws, name).studioJson : '', override);
    console.log(`\n角色指派${name ? `（${name}）` : ''}：`);
    for (const [r, desc] of Object.entries(ROLES)) { const x = resolveRole(r, ctx); console.log(`  ${r.padEnd(6)} ${x.cli}${x.model ? ' ' + x.model : '（預設模型）'}${x.effort ? ` effort=${x.effort}` : ''}　${desc}`); }
    break;
  }
  case 'ui': {
    const { startUi } = await import('./lib/server.mjs');
    const ui = await startUi(ws, { port: +(o.port || 8780) });
    if (!o['no-open'] && process.platform === 'win32') spawn('cmd', ['/c', 'start', '', `http://127.0.0.1:${ui.port}/`], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
    process.on('SIGINT', () => { ui.close(); process.exit(0); });
    break;
  }
  default:
    console.log(readText(new URL(import.meta.url)).split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n'));
    if (cmd) process.exitCode = 2;
}

function report(r) {
  if (r.status === 'waiting') process.exitCode = 10;
  else if (r.status === 'stopped') process.exitCode = 1;
}
