#!/usr/bin/env node
// vs3d：3D 設備動畫生成應用程式的命令列原型（P1）。不需要 npm 套件。
//   node studio/vs3d.mjs doctor                                   檢查 Claude Code／Codex 是否已安裝、已登入
//   node studio/vs3d.mjs init [--refresh-core]                    建立工作區（複製 core、寫入共通規則）；--refresh-core 換成本庫目前的 core
//   node studio/vs3d.mjs new <名稱> --prompt "<需求>" [--files 檔案…] [--title 標題] [--cli claude|codex] [--private "用戶名稱,…"]
//                                                                 --private：不得顯示的用戶名稱（加進工作區名單，需求原文裡換成「（用戶）」）
//                                                                 --components assess,3d,aoi：專案組成（評估＋成本／3D 動畫／AOI；沒指定是只有 3D）
//   node studio/vs3d.mjs optics <專案> --text "AOI 需求"          光學角色提 2～3 個相機、鏡頭、光源方案，平台用 L1＋L2 檢查後存成 AOI 方案
//   node studio/vs3d.mjs components <名稱> [--set assess,3d,aoi]   看或改專案組成（只做評估的專案加上 3D 後用 resume 開始第一段）
//   node studio/vs3d.mjs assess <名稱> [show｜check] [--json]      評估資料：最新的可行性分析；平台檢查（feasibility、bom、cost）
//   node studio/vs3d.mjs assess <名稱> --text "要改的內容"          請規劃角色修改提案、可行性分析或 BOM（資料庫的最新版寫回後改，改完存成新的一版）
//   node studio/vs3d.mjs resume <名稱>                            續跑（回答問題後、中斷後）
//   node studio/vs3d.mjs answer <名稱> <問題 id> <編號或文字> [--note 補充]
//   node studio/vs3d.mjs status [<名稱>]                          進度、等待中的問題、最近一次檢查
//   node studio/vs3d.mjs check <名稱> [--full]                    手動跑檢查
//   node studio/vs3d.mjs review <名稱> [--no-fix]                 重新審查（必修項自動送修正），接著補強；--no-fix 只審查、不修正
//   node studio/vs3d.mjs render <名稱> [--pick] [--focus "範圍"]  重新做渲染與細節補強（--pick 先挑項目）
//   node studio/vs3d.mjs stage2 <名稱>                            開始第二段（電控、電盤、配線、相機）；第一段完成時也會出卡片詢問
//   node studio/vs3d.mjs export <名稱> [--zip] [--html] [--mp4]   匯出成品到專案 TEMP/exports/（不指定時輸出網站壓縮檔＋單一 HTML）
//   node studio/vs3d.mjs handoff <名稱> [--out 檔案]              匯出交接包（git 歷史、上傳檔、提問與紀錄、不得顯示的名稱）
//   node studio/vs3d.mjs import <交接包.zip> [--name 新名稱]       匯入交接包，之後用 resume 續跑
//   node studio/vs3d.mjs change <名稱> --text "要改的內容" [--keep-timing]   修改指令：開發角色照做 → 檢查 → 審查（--keep-timing 不能改節拍與動作）
//   node studio/vs3d.mjs push <名稱>                              本庫模式：推送這次的 vs3d 分支（之後在 GitHub 開 PR）
//   node studio/vs3d.mjs cancel <名稱>                            取消進行中的流程，回到「完成」（已提交的內容不動；第一段還沒完成的專案不能取消）
//   node studio/vs3d.mjs delete <名稱> --yes                      刪除工作區的專案（移到工作區的 .studio/trash/，可以搬回 projects/ 復原）
//   node studio/vs3d.mjs trash [--purge <項目>｜--older-than <天>]   回收桶：列出刪除的專案；永久刪除一個或超過幾天的
// 本庫模式：--repo（或 --workspace 指到本庫根目錄）就能對 project-site/ 的站下 review／render／stage2／change／check／export；
//   開工時該站不能有未提交的改動，每次指令開一個本機分支 <範圍>/vs3d-…，只提交該站的路徑，不會 checkout／reset／stash。
//   node studio/vs3d.mjs probe <名稱> [--cli …] [--other <專案>] [--simulate]   寫入隔離自我測試（--simulate：app 另外模擬越界寫入）
//   node studio/vs3d.mjs models                                   各 CLI 可用的模型與各角色目前的指派
//   node studio/vs3d.mjs ui [--port 8780] [--no-open] [--host 0.0.0.0] [--pfx 憑證.pfx｜--cert 憑證.pem --key 私鑰.pem] [--insecure-http]
//                                                                 開啟網頁介面（http://127.0.0.1:8780/）；--host 0.0.0.0 讓區網的其他電腦也能連：要先建立帳號並用 HTTPS
//                                                                 （PFX 的密碼放環境變數 VS3D_PFX_PASS；--insecure-http 只在測試時跳過 HTTPS）
//   node studio/vs3d.mjs edition                                  版本別（開發機／部署版）；部署版檢查沒有訂閱帳號的程式（lib/subscription.mjs）
//   node studio/vs3d.mjs users [add <帳號> --level admin|editor|viewer --password <密碼>｜passwd <帳號> --password <密碼>｜remove <帳號>]   介面的登入帳號（忘記密碼時從這裡重設）
//   node studio/vs3d.mjs parts [search <關鍵字…>] [--category 類別] [--project 專案] [--json]   查元件資料庫（選型、單價、哪些專案用過）
//   node studio/vs3d.mjs parts show <id> [--json]                 單一元件的規格、價格紀錄、使用紀錄
//   node studio/vs3d.mjs parts seed [--dry-run]                   從各站 docs/ 的成本表匯入採購品項（可重複執行，已匯入的列會跳過）
//   node studio/vs3d.mjs parts merge <保留 id> <併入 id>           合併重複的元件
//   node studio/vs3d.mjs parts link [--dry-run]                   把型號對得上的元件連到 core 共用模型（3D 顯示）；core 新增模型後再跑一次
//   node studio/vs3d.mjs parts bom <專案> [--json]                專案的成本表（平台即時計算；本庫的站寫 @<站>）
//   node studio/vs3d.mjs parts bom-import [--project 站]          把各站 docs/ 的成本表轉成平台的 BOM（@<站>），逐行與摘要和原檔比對（先跑過 parts seed）
//   node studio/vs3d.mjs enrich <元件> [--fields 欄位,…] [--cli …] [--model …]   元件補全：enrich 角色上網查規格，結果待審核（只有這個角色可以上網）
//   node studio/vs3d.mjs enrich [list [--status review]｜show <工作>｜accept <工作> (--all｜--keys a,attrs.b) [--price] [--download 0,1]｜dismiss <工作>]
//                                                                 資料庫檔只留本機：studio/data/studio.db（--db 或環境變數 VS3D_DB 可以改位置）
// 共通選項：--workspace <資料夾>（預設 %USERPROFILE%\Documents\3D-Studio，或環境變數 VS3D_WORKSPACE）
//   --cli、--model（所有角色）、--role plan=opus,fix=haiku（個別角色；可寫 codex:<模型>）、--effort
//   --no-wait（有問題時寫出後結束，不在終端機詢問）、--auto-approve（配置提案不必確認）、--max-rounds 40、--timeout 90（分鐘／輪）
//   new 另有 --create-only（只建立專案，之後用 resume 開始）
//   每段完成後預設自動審查與補強；--no-review、--no-render 關掉，--no-perf 不量效能，--pick 讓你先挑補強項目；--no-stage2 第一段完成後不問第二段
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { ADAPTERS, adapterFor } from './lib/adapters/index.mjs';
import { initWorkspace, createProject, deleteProject, paths, projectPaths, isRepo } from './lib/workspace.mjs';
import { runProject, loadState, beginSegment2, cancelFlow } from './lib/loop.mjs';
import { loadQuestions, parseChoice, recordAnswer, printQuestion } from './lib/questions.mjs';
import { runChecks, failureSummary, runFingerprint } from './lib/checks.mjs';
import { ROLES, resolveRole, loadRoleContext, parseRoleOverrides } from './lib/roles.mjs';
import { isolationProbe } from './lib/probe.mjs';
import { defaultWorkspace, readText, readJson, writeJson } from './lib/util.mjs';
import { exportHandoff, importHandoff } from './lib/handoff.mjs';
import * as repoGit from './lib/repo.mjs';
import { REPO, git, findFfmpeg } from './lib/util.mjs';

const VALUE = new Set(['--text', '--text-file', '--workspace', '--private', '--prompt', '--prompt-file', '--title', '--summary', '--cli', '--model', '--role', '--effort', '--note', '--max-rounds', '--timeout', '--other', '--focus', '--port', '--out', '--name', '--category', '--project', '--db', '--host', '--password', '--level', '--pfx', '--cert', '--key', '--purge', '--older-than', '--job', '--fields', '--keys', '--download', '--status', '--components', '--set', '--format']);

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
const ws = resolve(o.repo ? REPO : o.workspace || defaultWorkspace());
const override = { cli: o.cli, model: o.model, roles: parseRoleOverrides(o.role || ''), autoApprove: !!o['auto-approve'], pick: !!o.pick, focus: o.focus || '' };
if (o.effort) for (const r of Object.keys(ROLES)) override.roles[r] = { ...override.roles[r], effort: o.effort };
if (o.cli && !ADAPTERS[o.cli]) fail(`--cli 只能是 ${Object.keys(ADAPTERS).join('、')}`);
const runOpts = () => ({ interactive: !!process.stdin.isTTY && !o['no-wait'], override, maxRounds: +(o['max-rounds'] || 40), timeoutMin: +(o.timeout || 90),
  review: !o['no-review'], reviewFix: !o['no-fix'], render: !o['no-render'], perf: !o['no-perf'], stage2: !o['no-stage2'] });
// 本庫模式的指令：先做開工檢查並開本機分支（目前已經在本站的 vs3d 分支上就沿用）
function beginRepoFlow(J, s, label) {
  if (!J.repo) return;
  try { s.branch = repoGit.beginFlow(J, label); s.flowActive = true; console.log(`本庫：在分支 ${s.branch} 上進行（只提交 ${J.id} 的路徑）`); } catch (e) { fail(e.message); }
}
const needWs = () => { if (!existsSync(paths(ws).marker)) fail(`工作區還沒建立：${ws}（先執行 vs3d init，或用 --workspace 指定）`); };
const needProject = () => { needWs(); if (!name) fail('請指定專案名稱'); if (!existsSync(projectPaths(ws, name).dir)) fail(`找不到專案：${name}`); return projectPaths(ws, name); };
function fail(msg) { console.error(msg); process.exit(2); }

switch (cmd) {
  case 'doctor': {
    const { authStatus, loadSystem, AUTH_MODES } = await import('./lib/agent-auth.mjs'), { edition, EDITIONS } = await import('./lib/edition.mjs');
    const system = await loadSystem();
    for (const a of Object.values(ADAPTERS)) {
      const d = a.detect(), s = d.installed ? await authStatus(a.name, system) : null;
      console.log(`${d.installed && s.loggedIn ? '✓' : '✗'} ${a.label.padEnd(12)} ${d.installed ? d.version : '未安裝'}${s ? `，${AUTH_MODES[s.mode]}：${s.loggedIn ? '可以用' : '不能用'}（${s.detail}）` : ''}`);
    }
    console.log(`版本別：${EDITIONS[edition()]}；工作區：${ws}${existsSync(paths(ws).marker) ? '' : '（尚未建立）'}`);
    break;
  }
  // 版本別與部署版的自我檢查（部署版不能包含訂閱帳號的程式）；有問題時結束代碼 1
  case 'edition': {
    const { edition, EDITIONS, editionProblems, subscriptionAllowed } = await import('./lib/edition.mjs');
    const problems = editionProblems();
    console.log(`版本別：${EDITIONS[edition()]}（${edition()}）；訂閱帳號功能：${subscriptionAllowed() ? '可以用' : '沒有'}`);
    for (const p of problems) console.log(`✗ ${p}`);
    if (problems.length) process.exitCode = 1;
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
    // 專案組成（評估平台 Q6）：評估＋成本／3D 動畫／AOI，至少一項；沒指定是只有 3D（原本的流程）
    if (o.components) { const { cleanComponents } = await import('./lib/assess.mjs'); try { sj.components = cleanComponents(o.components); } catch (e) { fail(e.message); } }
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
    Object.assign(s, { stage: cmd, waiting: null, renderBase: null, renderPicked: false, renderItems: null, renderTries: 0, flow: cmd });
    if (cmd === 'review') s.reviews = 0;
    if (cmd === 'review' && !s.shots) s.stage = 'check';      // 本庫的站還沒有 vs3d 截圖：先檢查、截圖，再審查
    beginRepoFlow(J, s, cmd);
    writeJson(J.state, s);
    report(await runProject(ws, name, runOpts()));
    break;
  }
  case 'export': {
    needProject();
    const tool = join(paths(ws).core, 'tools', 'export.mjs');
    if (!existsSync(tool)) fail('工作區的 core 太舊，沒有匯出工具：先執行 vs3d init --refresh-core');
    const formats = ['zip', 'html', 'mp4'].filter(f => o[f]).map(f => '--' + f);
    // 工作區的 core 找不到本庫共用的 tools/bin，所以把 ffmpeg 的位置用環境變數交給它
    const ff = findFfmpeg();
    const child = spawn(process.execPath, [tool, name, ...formats, '--out', projectPaths(ws, name).temp + '/exports'], { cwd: ws, stdio: 'inherit', windowsHide: true, env: { ...process.env, ...(ff && ff !== 'ffmpeg' ? { FFMPEG_PATH: ff } : {}) } });
    process.exitCode = await new Promise(r => child.on('close', r));
    break;
  }
  case 'handoff': {
    const J = needProject(), day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    try { await exportHandoff(ws, name, resolve(o.out || join(J.temp, 'exports', `${name.replace(/\s+/g, '-')}-handoff-${day}.zip`))); } catch (e) { fail(e.message); }
    break;
  }
  case 'import': {
    if (!name || !existsSync(resolve(name))) fail('用法：vs3d import <交接包.zip> [--name 新名稱]');
    if (!existsSync(paths(ws).marker)) initWorkspace(ws);
    try { await importHandoff(ws, resolve(name), { id: o.name }); } catch (e) { fail(e.message); }
    break;
  }
  case 'change': {
    const J = needProject(), s = loadState(J), text = (o['text-file'] ? readText(resolve(o['text-file'])) : o.text || '').trim();
    if (!text) fail('用法：vs3d change <名稱> --text "要改的內容" [--keep-timing]');
    if (s.stage !== 'done') fail(`專案目前在「${s.stage}」階段，完成後才能下修改指令（續跑用 vs3d resume）`);
    Object.assign(s, { stage: 'change', flow: 'change', changeRequest: text, lockSchedule: !!o['keep-timing'], segBase: null, waiting: null, reviews: 0, reviewData: null, streak: {}, renderBase: null });
    beginRepoFlow(J, s, 'change');
    writeJson(J.state, s);
    report(await runProject(ws, name, { ...runOpts(), render: false, stage2: false }));
    break;
  }
  case 'assess': {
    // 評估資料（評估平台 Q6）：check 平台檢查（feasibility、bom、cost）；show 最新的可行性分析；--text 請規劃角色修改提案、可行性分析或 BOM
    const J = needProject(), key = J.repo ? '@' + name : name, sub = rest[0] || (o.text || o['text-file'] ? 'revise' : 'show');
    const A = await import('./lib/assess.mjs'), { openPartsDb, defaultPartsDb } = await import('./lib/partsdb.mjs');
    if (sub === 'revise') {
      const s = loadState(J), text = (o['text-file'] ? readText(resolve(o['text-file'])) : o.text || '').trim();
      if (!text) fail('用法：vs3d assess <名稱> --text "要改的內容"');
      if (s.stage !== 'done') fail(`專案目前在「${s.stage}」階段，完成後才能修改評估（續跑用 vs3d resume）`);
      Object.assign(s, { stage: 'assess-revise', flow: 'assess', assessRequest: text, assessRevised: false, assessTries: 0, waiting: null });
      beginRepoFlow(J, s, 'assess');
      writeJson(J.state, s);
      report(await runProject(ws, name, { ...runOpts(), review: false, render: false, stage2: false }));
      break;
    }
    const db = openPartsDb(resolve(o.db || defaultPartsDb()));
    try {
      if (sub === 'check') {
        let scheduleTotal = null;
        if (A.componentsOf(readJson(J.studioJson, {})).includes('3d') && loadState(J).buildStarted) {
          const fp = await runFingerprint(ws, name); if (fp.ok && Number.isFinite(fp.variants[0]?.total)) scheduleTotal = fp.variants[0].total;
        }
        const res = A.checkProject(db, key, { scheduleTotal, components: A.componentsOf(readJson(J.studioJson, {})) });
        if (o.json) console.log(JSON.stringify(res, null, 2));
        else for (const c of res) { console.log(`${{ ok: '✓', warn: '!', fail: '✗' }[c.level]} ${c.check}：${c.note}`); for (const d of c.detail) console.log(`    ${d}`); }
        if (res.some(c => !c.ok)) process.exitCode = 1;
      } else if (sub === 'show') {
        const f = db.assess.latest(key, 'feasibility');
        if (!f) fail(`${name} 還沒有可行性分析`);
        if (o.json) console.log(JSON.stringify(f, null, 2)); else console.log(`可行性分析 v${f.version}（${f.created_at.slice(0, 16).replace('T', ' ')}${f.created_by ? `，${f.created_by}` : ''}）：${f.verdict}\n\n${f.content}`);
      } else fail('用法：vs3d assess <名稱> [show｜check] [--json]，或 vs3d assess <名稱> --text "要改的內容"');
    } finally { db.close(); }
    break;
  }
  case 'components': {
    // 專案組成：之後可以再加項目（例如先做評估，報價通過後再加 3D）
    const J = needProject(), { cleanComponents, componentsOf, COMPONENTS } = await import('./lib/assess.mjs'), sj = readJson(J.studioJson, {}), before = componentsOf(sj);
    if (o.set) {
      let next; try { next = cleanComponents(o.set); } catch (e) { fail(e.message); }
      sj.components = next; writeJson(J.studioJson, sj);
      const s = loadState(J);
      if (next.includes('3d') && !before.includes('3d') && s.stage === 'done' && !s.buildStarted) { s.stage = 'build'; writeJson(J.state, s); console.log('加了 3D 動畫：用 vs3d resume 開始第一段開發'); }
    }
    console.log(`${name} 的專案組成：${componentsOf(readJson(J.studioJson, {})).map(c => COMPONENTS[c]).join('、')}`);
    break;
  }
  case 'push': {
    const J = needProject(), s = loadState(J);
    if (!J.repo) fail('push 只用於本庫模式（工作區的專案用 export／handoff 交付）');
    const br = repoGit.branch(J);
    if (!br.startsWith(`${repoGit.slugOf(J.id)}/vs3d-`)) fail(`目前在 ${br}，不是 ${J.id} 的 vs3d 分支${s.branch ? `（上次是 ${s.branch}）` : ''}；請先切到要推送的分支`);
    try { console.log(git(J.dir, ['push', '-u', 'origin', br])); } catch (e) { fail(String(e.stderr || e.message)); }
    const url = git(J.dir, ['remote', 'get-url', 'origin']).trim().replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
    console.log(`已推送 ${br}。開 PR：${url}/compare/main...${encodeURIComponent(br).replace(/%2F/g, '/')}?expand=1`);
    break;
  }
  case 'cancel': {
    needProject();
    try {
      const r = cancelFlow(ws, name);
      console.log(`已取消 ${name} 的流程（原本在「${r.from}」階段），回到「完成」${r.questions ? `；${r.questions} 個還沒回答的問題已收起來` : ''}${r.branch ? `。已提交的內容留在分支 ${r.branch}` : ''}`);
    } catch (e) { fail(e.message); }
    break;
  }
  case 'delete': {
    needProject();
    if (!o.yes) fail(`要刪除 ${name} 請加上 --yes（資料夾會移到工作區的 .studio/trash/，不會直接消失）`);
    try { console.log(`已刪除 ${name}，資料夾移到 ${deleteProject(ws, name)}`); } catch (e) { fail(e.message); }
    break;
  }
  // 回收桶：不帶參數列出；--purge <項目> 永久刪除一個；--older-than <天> 刪掉超過幾天的
  case 'trash': {
    const { listTrash, purgeTrash } = await import('./lib/workspace.mjs');
    const mb = b => `${(b / 1048576).toFixed(1)} MB`;
    try {
      if (o.purge || o['older-than'] != null) {
        const r = purgeTrash(ws, o.purge ? { name: o.purge } : { olderThanDays: Number(o['older-than']) });
        console.log(r.length ? `永久刪除 ${r.length} 個：${r.map(x => x.name).join('、')}` : '沒有符合的項目');
      } else {
        const list = listTrash(ws);
        for (const x of list) console.log(`${x.name}　${x.deletedAt.slice(0, 16).replace('T', ' ')}　${mb(x.bytes)}`);
        console.log(list.length ? `${list.length} 個，合計 ${mb(list.reduce((s, x) => s + x.bytes, 0))}；永久刪除用 --purge <項目> 或 --older-than <天>` : '回收桶是空的');
      }
    } catch (e) { fail(e.message); }
    break;
  }
  case 'stage2': {
    const J = needProject(), s = loadState(J);
    if ((s.segment || 1) === 2) fail(`專案已經在第二段（階段 ${s.stage}）；續跑用 vs3d resume`);
    if (s.stage !== 'done') fail(`專案目前在「${s.stage}」階段，第一段完成後才能開始第二段`);
    beginSegment2(s); beginRepoFlow(J, s, 'stage2');
    writeJson(J.state, s);
    report(await runProject(ws, name, runOpts()));
    break;
  }
  case 'answer': {
    const J = needProject(), [qid, ...words] = rest;
    const q = loadQuestions(J).list.find(x => x.id === qid);
    if (!q) fail(`找不到問題 ${qid}（vs3d status "${name}" 可以看等待中的問題）`);
    if (q.answered) fail(`問題 ${qid} 已經回答過（vs3d status "${name}" 可以看等待中的問題）`);
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
    const ids = name ? [name] : readdirSync(paths(ws).projects).filter(n => existsSync(join(paths(ws).projects, n, paths(ws).repo ? 'project.json' : '.studio/state.json')));
    for (const id of ids) {
      const J = projectPaths(ws, id), s = loadState(J), pending = loadQuestions(J).list.filter(q => !q.answered);
      console.log(`\n${id}：${(s.segment || 1) === 2 ? '第二段，' : ''}階段 ${s.stage}，${s.round} 輪${s.lastCheck ? `，最近檢查 ${s.lastCheck.ok ? '通過' : `${s.lastCheck.failures.length} 項失敗`}` : ''}`);
      for (const [r, v] of Object.entries(s.sessions)) console.log(`  ${r.padEnd(6)} ${v.cli}${v.model ? ' ' + v.model : ''}  ${v.sessionId}`);
      pending.forEach((q, i) => printQuestion(q, i, pending.length));
    }
    break;
  }
  case 'check': {
    const J = needProject(), c = await runChecks(ws, name, { quick: !o.full });
    if (J.repo) repoGit.revertTimestampOnly(J);      // 本庫慣例：只有時間變動的 review 寫回原內容；有實質變化的留給使用者提交
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
  // 光學計算（core/optics）：vs3d optics eval <方案.json> [--json]；方案引用的元件用元件庫的規格欄位補參數（代理與檢查用）
  case 'optics': {
    // vs3d optics <專案> --text "AOI 需求"：optics 角色提 2～3 個方案，平台檢查後存成 AOI 方案（評估平台 Q7）
    if (name && name !== 'eval') {
      const J = needProject(), s = loadState(J), text = (o['text-file'] ? readText(resolve(o['text-file'])) : o.text || '').trim();
      if (!text) fail('用法：vs3d optics <專案> --text "AOI 需求（檢測項目、缺陷尺寸、工件材質、節拍、空間限制）"');
      if (s.stage !== 'done') fail(`專案目前在「${s.stage}」階段，完成後才能請光學角色提方案（續跑用 vs3d resume）`);
      Object.assign(s, { stage: 'optics-design', flow: 'optics', opticsRequest: text, opticsAsked: false, opticsTries: 0, waiting: null });
      beginRepoFlow(J, s, 'optics');
      writeJson(J.state, s);
      report(await runProject(ws, name, { ...runOpts(), review: false, render: false, stage2: false }));
      break;
    }
    if (name !== 'eval' || !rest[0]) fail('用法：vs3d optics eval <方案.json> [--json]（方案格式見 core/optics/README.md），或 vs3d optics <專案> --text "AOI 需求"');
    let setup; try { setup = JSON.parse(readFileSync(resolve(rest[0]), 'utf8').replace(/^﻿/, '')); } catch (e) { fail(`讀不了方案檔：${e.message}`); }
    let r;
    try { const { openPartsDb, defaultPartsDb } = await import('./lib/partsdb.mjs'), db = openPartsDb(resolve(o.db || defaultPartsDb())); try { r = db.aoi.evaluate(setup.data || setup); } finally { db.close(); } }
    catch (e) { if (e.status) fail(e.message); const { evaluate } = await import('../core/optics/optics.js'); r = evaluate(setup.data || setup); }
    if (o.json) console.log(JSON.stringify(r, null, 2));
    else {
      const mark = { ok: '✓', warn: '!', fail: '✗', info: '·' };
      for (const x of r.results) console.log(`${mark[x.status]} ${x.label}：${x.value ?? '—'}${x.unit ? ` ${x.unit}` : ''}${x.note ? `（${x.note}）` : ''}`);
      if (r.cost) console.log(`元件參考成本：NT$ ${r.cost.toLocaleString('en-US')}`);
      console.log(r.status === 'fail' ? '✗ 有不符合的項目' : r.status === 'warn' ? '! 有要注意的項目' : '✓ 全部符合');
    }
    if (r.status === 'fail') process.exitCode = 1;
    break;
  }
  case 'enrich': {
    // 元件補全（評估平台 Q5）：enrich 角色上網查元件規格，結果存成待審核，到介面「元件庫」逐欄採用（或用 accept）
    const { openPartsDb, defaultPartsDb } = await import('./lib/partsdb.mjs'), { runEnrichJob, JOB_STATUS } = await import('./lib/enrich.mjs');
    const db = openPartsDb(resolve(o.db || defaultPartsDb()));
    const showJob = j => {
      console.log(`#${j.id} ${j.code} ${j.name}｜${j.status_label}${j.cli ? `｜${j.cli}${j.model ? ' ' + j.model : ''}` : ''}${j.cost ? `｜US$ ${j.cost.toFixed(3)}` : ''}${j.error ? `｜${j.error}` : ''}`);
      const r = j.result || {};
      if (r.note) console.log(`  ${r.matched === false ? '✗ 型號對不上：' : ''}${r.note}`);
      for (const x of r.items || []) console.log(`  ${x.error ? '✗' : x.same ? '=' : '+'} ${x.key}：${x.value}${x.unit ? ` ${x.unit}` : ''}${x.current && !x.same ? `（原本 ${x.current}）` : ''}　[${x.confidence}] ${x.source}${x.error ? `　${x.error}` : ''}`);
      if (r.price) console.log(`  ${r.price.error ? '✗' : '$'} 價格 ${r.price.currency} ${r.price.value}　${r.price.source}${r.price.error ? `　${r.price.error}` : ''}`);
      (r.files || []).forEach((f, i) => console.log(`  ${f.error ? '✗' : '↓'} 檔案 ${i}：${f.kind} ${f.title || ''} ${f.url}`));
    };
    try {
      if (name === 'list' || !name) {
        const list = db.enrich.list({ status: o.status || '' });
        if (o.json) console.log(JSON.stringify(list, null, 2)); else { for (const j of list) console.log(`#${j.id} ${j.code} ${j.name}｜${j.status_label}｜${j.created_at.slice(0, 16).replace('T', ' ')}${j.created_by ? `｜${j.created_by}` : ''}`); console.log(`${list.length} 筆（狀態：${Object.values(JOB_STATUS).join('、')}）`); }
      } else if (name === 'show') {
        const j = db.enrich.get(rest[0]); if (o.json) console.log(JSON.stringify(j, null, 2)); else showJob(j);
      } else if (name === 'accept') {
        // --all：所有合格且有變動的欄位；--keys brand,attrs.像素尺寸；--price；--download 0,1
        const j = db.enrich.get(rest[0]), split = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
        const keys = o.all ? (j.result.items || []).filter(x => !x.error && !x.same).map(x => x.key) : split(o.keys);
        const r = await db.enrich.accept(j.id, { keys, price: !!o.price, files: split(o.download).map(Number), by: process.env.VS3D_BY || 'cli' });
        console.log(`✓ 採用 ${r.job.applied.keys.length} 個欄位${r.job.applied.price ? '、1 筆價格' : ''}${r.job.applied.files.length ? `、${r.job.applied.files.length} 個檔案` : ''}；${r.part.code} 現在是 v${r.part.version}`);
        for (const e of r.job.applied.errors) console.log(`  ! ${e}`);
      } else if (name === 'dismiss') {
        db.enrich.dismiss(rest[0], process.env.VS3D_BY || 'cli'); console.log(`已放棄 #${rest[0]}`);
      } else {
        // vs3d enrich <元件> [--fields 欄位,…]：建工作並馬上執行；--job <id>：執行佇列建好的工作（介面用）
        const rc = resolveRole('enrich', loadRoleContext(paths(ws).settings, '', override));
        const job = o.job ? db.enrich.get(o.job) : db.enrich.create(name, { fields: o.fields || '', by: process.env.VS3D_BY || '' });
        if (o.job && db.getPart(job.part_id).code !== db.getPart(name).code) fail(`補全工作 #${job.id} 不是 ${name} 的`);
        const j = await runEnrichJob(db, job.id, { rc, timeoutMin: +(o.timeout || 20) });
        showJob(j);
        if (j.status === 'failed') process.exitCode = 2;
        else console.log(`到介面「元件庫」審核，或：node studio/vs3d.mjs enrich accept ${j.id} --all [--price] [--download 0,1]`);
      }
    } catch (e) { if (e.status) fail(e.message); throw e; } finally { db.close(); }
    break;
  }
  case 'models': {
    for (const a of Object.values(ADAPTERS)) console.log(`${a.label}：${a.listModels().join('、') || '（帳號預設模型；可在 studio.json 指定名稱）'}`);
    const ctx = loadRoleContext(paths(ws).settings, name ? projectPaths(ws, name).studioJson : '', override);
    console.log(`\n角色指派${name ? `（${name}）` : ''}：`);
    const fmt = x => `${x.cli}${x.model ? ' ' + x.model : '（預設模型）'}${x.effort ? ` effort=${x.effort}` : ''}`;
    for (const [r, desc] of Object.entries(ROLES)) { const x = resolveRole(r, ctx), y = resolveRole(r, ctx, 2); console.log(`  ${r.padEnd(6)} ${fmt(x)}${fmt(y) !== fmt(x) ? `；第二段 ${fmt(y)}` : ''}　${desc}`); }
    break;
  }
  case 'parts': {
    // 元件資料庫（node:sqlite，Node.js 22.13 以上）；新增、修改、刪除在網頁介面的「元件庫」做
    const { openPartsDb, defaultPartsDb, PartsError } = await import('./lib/partsdb.mjs');
    const db = openPartsDb(resolve(o.db || defaultPartsDb())), sub = name || 'search';
    const money = p => p.unit_price == null ? '（沒有價格）' : `${p.currency === 'TWD' ? 'NT$' : p.currency + ' '}${p.unit_price.toLocaleString('en-US')}${p.grade ? `（${p.grade}）` : ''}`;
    try {
      if (sub === 'search' || sub === 'list') {
        const r = db.listParts({ q: rest.join(' '), category: o.category || '', project: o.project || '' });
        if (o.json) console.log(JSON.stringify(r.parts, null, 2));
        else {
          for (const p of r.parts) console.log(`${p.code} [${p.category || '未分類'}] ${p.status ? `（${p.status}）` : ''}${p.name}${p.model ? `｜${p.model}` : ''}｜${money(p)}${p.unit ? `／${p.unit}` : ''}${p.projects.length ? `｜${p.projects.join('、')}` : ''}`);
          console.log(`${r.total} 個元件${r.total > r.parts.length ? `（只列出前 ${r.parts.length} 個）` : ''}；資料庫：${db.file}`);
        }
      } else if (sub === 'show') {
        const p = db.getPart(rest[0]);
        if (o.json) console.log(JSON.stringify(p, null, 2));
        else {
          console.log(`${p.code} [${p.grp ? p.grp + '／' : ''}${p.category || '未分類'}] ${p.name}${p.status ? `（${p.status}）` : ''}`);
          for (const [label, v] of [['廠牌', p.brand], ['型號／選型', p.model], ['規格', p.spec], ...Object.entries(p.attrs), ['單位', p.unit], ['選型備註', p.selection_note], ['替代方案', p.alternatives], ['標籤', p.tags], ['連結', p.url], ['備註', p.note]]) if (v) console.log(`  ${label}：${v}`);
          console.log('  價格紀錄：' + (p.prices.length ? '' : '（無）'));
          for (const x of p.prices) console.log(`    ${x.quoted_on || '（無日期）'}  ${money(x)}${x.supplier ? `  ${x.supplier}` : ''}${x.source ? `  ${x.source}` : ''}${x.valid_until ? `  有效至 ${x.valid_until}` : ''}${x.note ? `  ${x.note}` : ''}`);
          console.log('  使用紀錄：' + (p.usages.length ? '' : '（無）'));
          for (const u of p.usages) console.log(`    ${u.project} ${u.source} ${u.item_code}${u.qty != null ? `  ×${u.qty}` : ''}${u.note ? `（${u.note}）` : ''}${u.reason ? `  ${u.reason}` : ''}`);
        }
      } else if (sub === 'seed') {
        const { collectCostTables, seedFromCostTables } = await import('./lib/parts-seed.mjs');
        const names = readText(join(REPO, '.private', 'client-names.txt')).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const r = seedFromCostTables(db, collectCostTables(REPO), { names, dryRun: !!o['dry-run'] });
        for (const t of r.tables) console.log(`${t.project}／${t.source}：${t.rows} 列，匯入 ${t.imported}、已匯入過 ${t.existing}、不匯入 ${t.skipped}`);
        console.log(`${o['dry-run'] ? '（試跑，沒有寫入）' : ''}新增元件 ${r.parts}、併入既有元件 ${r.merged}、價格紀錄 ${r.prices}、使用紀錄 ${r.usages}；不匯入：${Object.entries(r.skipped).map(([k, n]) => `${k} ${n}`).join('、') || '無'}`);
      } else if (sub === 'link') {
        const { coreModels, linkCoreModels } = await import('./lib/thumbs.mjs');
        const hits = linkCoreModels(db, coreModels(join(REPO, 'core')), { dryRun: !!o['dry-run'] });
        for (const h of hits) console.log(`${h.code} ${h.name} → ${h.model}`);
        console.log(`${o['dry-run'] ? '（試跑，沒有寫入）' : ''}連上 ${hits.length} 個元件（型號對得上的手臂，以及名稱是單一市購設備的：指示與操作、感測與安全、視覺、輸送、氣動、實驗室與製程設備）；整包品項與其他通用模型請在元件庫的編輯面板手動選`);
      } else if (sub === 'merge') {
        if (rest.length !== 2) fail('用法：vs3d parts merge <保留 id> <併入 id>');
        const p = db.mergeParts(rest[0], rest[1]);
        console.log(`已合併到 ${p.code} ${p.name}：${p.prices.length} 筆價格、${p.usages.length} 筆使用紀錄`);
      } else if (sub === 'bom') {
        // 專案的成本表（平台即時計算）：本庫的站寫 @<站>；--json 給其他工具讀（例如回收物分揀的視覺品項表取單價）
        if (!rest[0]) fail('用法：vs3d parts bom <專案，本庫的站寫 @站名> [--json]');
        const g = db.bom.get(rest[0]);
        if (!g) fail(`專案 ${rest[0]} 還沒有 BOM`);
        if (o.json) console.log(JSON.stringify({ project: rest[0], name: g.bom.name, settings: g.settings, summary: g.summary,
          lines: g.lines.map(l => ({ line: l.line, section: l.section, grp: l.grp, nature: l.nature, code: l.code, part_version: l.part_version, name: l.name, spec: l.spec, model: l.model,
            qty: l.qty, unit: l.unit, unit_twd: l.unit_twd, subtotal: l.subtotal, grade: l.grade, flags: l.flags, model_id: l.model_id, no_scene: l.no_scene, labor: l.labor })) }, null, 2));
        else {
          for (const l of g.lines) console.log(`${l.line.padEnd(6)} ${l.name}｜${l.qty} ${l.unit}｜NT$ ${(l.unit_twd ?? 0).toLocaleString('en-US')}｜小計 ${l.subtotal.toLocaleString('en-US')}${l.code ? `｜${l.code} v${l.part_version}${l.newer ? `（有新版 v${l.latest_version}）` : ''}` : ''}`);
          const s = g.summary; console.log(`小計 ${s.subtotal.toLocaleString('en-US')}｜含預備費 ${s.total.toLocaleString('en-US')}｜含稅 ${s.taxed.toLocaleString('en-US')}`);
        }
      } else if (sub === 'bom-import') {
        // 本庫各站 docs/ 的成本表 → 平台的 BOM（@<站>），轉完逐行與摘要和原檔比對；--project 只轉一站
        const { importCostTable } = await import('./lib/cost-import.mjs'), { collectCostTables } = await import('./lib/parts-seed.mjs');
        const tables = collectCostTables(REPO).filter(t => t.rows.some(r => r.sheet === '明細') && (!o.project || t.project === o.project));
        if (!tables.length) fail(o.project ? `找不到 ${o.project} 的成本表` : '找不到任何成本表');
        let bad = 0;
        for (const t of tables) {
          const r = importCostTable(db, { project: t.project, source: t.source, file: join(REPO, 'project-site', t.project, 'docs', t.source) });
          if (r.skipped) { console.log(`- ${t.project} ${t.source}：${r.skipped}`); continue; }
          if (!r.ok) bad++;
          console.log(`${r.ok ? '✓' : '✗'} @${t.project}（${t.source}）：${r.lines} 行，元件 ${r.parts}、人日 ${r.labor}、客製 ${r.custom}；含預備費 ${r.totals.total?.got?.toLocaleString('en-US')}${r.cached ? '' : '（原檔沒有存結果，用原公式重算比對）'}`);
          for (const [k, x] of Object.entries(r.totals)) if (!x.ok) console.log(`   ${k}：原檔 ${x.want}，平台 ${x.got}`);
          for (const m of r.lineMismatches) console.log(`   ${m.line}：原檔 ${m.want}，平台 ${m.got}`);
        }
        if (bad) process.exitCode = 1;
      } else fail('用法：vs3d parts [search <關鍵字…>｜show <id>｜seed｜link｜merge <保留 id> <併入 id>｜bom-import [--project 站]]');
    } catch (e) { if (e instanceof PartsError) fail(e.message); throw e; } finally { db.close(); }
    break;
  }
  case 'users': {
    // 介面的登入帳號（studio/data/users.json）；忘記管理者密碼時從命令列重設
    const { createAuth, AuthError, ROLE_LABEL } = await import('./lib/auth.mjs');
    const auth = createAuth();
    try {
      if (!name || name === 'list') {
        for (const u of auth.list()) console.log(`${u.name.padEnd(16)} ${ROLE_LABEL[u.role]}${u.disabled ? '（停用）' : ''}${u.display !== u.name ? `　${u.display}` : ''}`);
        console.log(auth.enabled() ? `${auth.list().length} 個帳號；介面需要登入` : '還沒有帳號：介面不需要登入（單機模式）');
      } else if (name === 'add') { const u = auth.create({ name: rest[0], role: o.level || 'editor', password: o.password }); console.log(`已建立 ${u.name}（${ROLE_LABEL[u.role]}）`); }
      else if (name === 'passwd') { if (!o.password) fail('請用 --password 給新密碼'); auth.update(rest[0], { password: o.password }); console.log(`已重設 ${rest[0]} 的密碼`); }
      else if (name === 'remove') { auth.remove(rest[0]); console.log(`已刪除 ${rest[0]}`); }
      else fail('用法：vs3d users [list｜add <帳號> --level admin|editor|viewer --password <密碼>｜passwd <帳號> --password <密碼>｜remove <帳號>]');
    } catch (e) { if (e instanceof AuthError) fail(e.message); throw e; }
    break;
  }
  case 'ui': {
    const { startUi } = await import('./lib/server.mjs');
    // 從本庫執行時同時列出 project-site/ 的各站（本庫模式）；--no-repo 只看工作區
    const repoRoot = o['no-repo'] ? null : isRepo(REPO) ? REPO : null;
    // HTTPS：PFX（Windows 匯出的憑證，密碼放環境變數 VS3D_PFX_PASS）或 PEM 的憑證＋私鑰
    const tls = o.pfx ? { pfx: readFileSync(resolve(o.pfx)), passphrase: process.env.VS3D_PFX_PASS || '' }
      : o.cert || o.key ? (o.cert && o.key ? { cert: readFileSync(resolve(o.cert)), key: readFileSync(resolve(o.key)) } : fail('--cert 與 --key 要一起給')) : null;
    let ui;
    try { ui = await startUi(o.repo ? defaultWorkspace() : ws, { port: +(o.port || 8780), repo: repoRoot, partsDb: o.db ? resolve(o.db) : undefined, host: o.host || '127.0.0.1', tls, insecureHttp: !!o['insecure-http'] }); }
    catch (e) { fail(e.message); }
    if (!o['no-open'] && process.platform === 'win32') spawn('cmd', ['/c', 'start', '', `${tls ? 'https' : 'http'}://127.0.0.1:${ui.port}/`], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
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
