// 流程主體：規劃 → 提問 → 開發 → 檢查 ⇄ 修正 → 審查 → 渲染與細節補強 → 完成；第一段完成後出卡片問要不要開始第二段（電控、電盤、配線、相機），
//   第二段走同一套流程（規劃寫 .studio/plan/segment2.md／json、開發不能改第一段的排程指紋），角色依段落指派（roles.mjs SEGMENT_DEFAULTS）。
// 原本：規劃 → 提問 → 開發 → 檢查 ⇄ 修正 → 審查 → 渲染與細節補強 → 完成。狀態存在 .studio/state.json，隨時可以中斷後用 resume 續跑。
//   每輪：開工前 commit → 記雜湊 → 執行代理 → 比對還原（越界）→ 角色範圍檢查 → commit → 記錄 rounds.jsonl
//   品質迴圈：快速檢查 → 完整檢查（含 ui 四尺寸）→ 截圖；失敗就回送修正角色，同一項連續失敗 3 次轉成提問
//   審查（計畫書 4.7）：看截圖、比對拍板事項與規則；必修項自動送修正 → 重新檢查 → 再審查（最多 3 次）
//   補強：記下基準（commit、排程指紋、效能、截圖）→ 補強角色 → 守門檢查（檢查全過、指紋與空間檢核不變、效能在預算內，
//         沒過就退回補強角色，最多 3 次）→ 前後對照頁 → 使用者接受／要求調整／整批還原
import { existsSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { adapterFor, runAgent } from './adapters/index.mjs';
import { agentEnv, AUTH_MODES } from './agent-auth.mjs';
import { resolveRole, loadRoleContext } from './roles.mjs';
import { paths, projectPaths, acquireLock, addClientNames, readClientNames, redactNames, addProjectNames } from './workspace.mjs';
import { snapshot, verifyAndRestore } from './isolation.mjs';
import { loadQuestions, pendingQuestions, askInteractive, writeAppQuestion, readAnswer, printQuestion } from './questions.mjs';
import { runChecks, takeShots, failureSummary, runFingerprint, compareRenderFingerprint, runPerf, comparePerf } from './checks.mjs';
import { header, rolePrompt, answersPrompt, fixAgainPrompt, invalidQuestionsPrompt, mustFixPrompt, renderGuardPrompt, renderRevisePrompt } from './prompts.mjs';
import { writeComparePage } from './compare.mjs';
import { componentsOf, checkPlanFiles, importAssessment, writePlanFiles, writeBomSummary } from './assess.mjs';
import * as repoGit from './repo.mjs';
import { readJson, writeJson, appendJsonl, git, now, readText, rel } from './util.mjs';
import { readdirSync } from 'node:fs';

const REVIEW_LIMIT = 3, RENDER_TRIES = 3;
const pngs = dir => dir && existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.png') && !f.endsWith('.diff.png')).sort().map(f => join(dir, f)) : [];
// 審查的參考圖：docs/ 第一層的圖優先，再補 Office 檔抽出的圖（docs/<檔名>.extract/），最多 12 張
const IMG = /\.(png|jpe?g|webp)$/i;
const refImages = J => {
  if (!existsSync(J.docs)) return [];
  const top = readdirSync(J.docs).filter(f => IMG.test(f)).sort().map(f => join(J.docs, f));
  const ext = readdirSync(J.docs).filter(f => f.endsWith('.extract')).sort().flatMap(d => readdirSync(join(J.docs, d)).filter(f => IMG.test(f)).sort().map(f => join(J.docs, d, f)));
  return [...top, ...ext].slice(0, 12);
};

const STREAK_LIMIT = 3;
const GIT_ID = ['-c', 'user.name=vs3d', '-c', 'user.email=vs3d@localhost'];
const short = (s, n = 160) => (s = String(s ?? '').replace(/\s+/g, ' ').trim()).length > n ? s.slice(0, n) + '…' : s;

export const loadState = J => readJson(J.state, { stage: J.repo ? 'done' : 'plan', round: 0, sessions: {}, streak: {}, waiting: null, lastCheck: null, violations: [] });   // 本庫的站沒有 vs3d 狀態時視為已完成

// full：快速檢查通過後是否再跑完整檢查（含 ui）；shots：通過後是否截圖；perf：補強前後是否量效能（測試時可關掉以節省時間）
// stage2：第一段完成後是否出卡片問要不要開始第二段
// review／render：每段完成後是否自動審查、補強；reviewFix：必修項是否自動送修正（override.pick 時先讓使用者挑補強項目，override.focus 限定範圍）
export async function runProject(ws, id, { interactive = false, override = {}, maxRounds = 40, timeoutMin = 90, full = true, shots: wantShots = true,
  perf: wantPerf = true, review: wantReview = true, reviewFix: wantReviewFix = true, render: wantRender = true, stage2: wantStage2 = true, log = console.log } = {}) {
  const P = paths(ws), J = projectPaths(ws, id);
  if (!existsSync(J.dir)) throw new Error(`找不到專案：${J.dir}`);
  let release;
  try { release = acquireLock(ws, id); } catch (e) { log(`■ ${e.message}`); return { status: 'stopped', message: e.message }; }
  const state = loadState(J);
  const save = () => writeJson(J.state, state);
  if (J.repo && state.flowActive && state.branch && repoGit.branch(J) !== state.branch) {
    release();
    const msg = `本庫的 ${id} 有進行中的 vs3d 流程在分支 ${state.branch}，目前是 ${repoGit.branch(J)}；請切回該分支再續跑（app 不會替你切換分支）`;
    log(`■ ${msg}`); return { status: 'stopped', message: msg };
  }
  // 元件資料庫的清單寫一份到專案裡給代理查（資料庫不存在、是空的、或 Node 版本太舊沒有 node:sqlite 就略過）
  try { const { writeCatalog } = await import('./parts-catalog.mjs'); const names = readClientNames(ws); writeCatalog(J, { redact: s => redactNames(s, names) }); } catch { /* 沒有清單不影響流程 */ }
  // 提案確認後：把規劃角色寫的元件表匯入元件資料庫（沿用的加使用紀錄，新的標「待確認」）；沒有元件表或讀不了資料庫都不影響流程
  async function importParts() {
    try {
      const { importFromProject } = await import('./parts-import.mjs'); const names = readClientNames(ws);
      const r = importFromProject(J, { redact: s => redactNames(s, names) });
      if (r && (r.reused || r.created)) log(`  元件資料庫：沿用 ${r.reused} 個、新增 ${r.created} 個（標「待確認」，到元件庫審核）${r.existing ? `、之前已匯入 ${r.existing} 個` : ''}`);
    } catch (e) { log(`  ! 元件表沒有匯入元件資料庫：${String(e.message || e).split('\n')[0]}`); }
  }
  const roleCtx = () => loadRoleContext(P.settings, J.studioJson, override);
  // 專案組成（評估平台 Q6）：評估＋成本／3D／AOI；資料庫裡的專案代號（本庫的站是 @<名稱>，和介面相同）
  const comps = () => componentsOf(readJson(J.studioJson, {})), has = c => comps().includes(c), pkey = J.repo ? '@' + id : id;
  async function withDb(fn) {
    const { openPartsDb, defaultPartsDb } = await import('./partsdb.mjs'), db = openPartsDb(defaultPartsDb());
    try { return await fn(db); } finally { db.close(); }
  }
  // 提案確認後（或修改評估後）：提案、可行性各存一版，BOM 匯入成本表（重新匯入前自動留快照）
  async function importAssess(note = '') {
    const names = readClientNames(ws);
    let r;
    try { r = await withDb(db => importAssessment(db, pkey, J, { by: process.env.VS3D_BY || '', redact: s => redactNames(s, names), note })); }
    catch (e) { throw new Stop(`評估資料沒有存進資料庫：${String(e.message || e).split('\n')[0]}`); }
    const b = r.bom;
    log(`  評估資料存進資料庫：提案 v${r.proposal ?? '—'}、可行性分析 v${r.feasibility ?? '—'}${b ? `；BOM ${b.lines} 行（沿用元件 ${b.reused}、新元件 ${b.created}（待確認）、客製 ${b.custom}、工程 ${b.labor}）${b.snapshot ? `，重新匯入前已留快照「${b.snapshot.name}」` : ''}` : ''}`);
    for (const w of b?.warnings || []) log(`    ! ${w}`);
  }
  // 評估＋成本：規劃角色寫的可行性分析與 BOM 先檢查格式；不對就退回（最多 3 次）。回傳 true 表示已經退回、這一步結束
  async function assessFormat(what) {
    const errs = await withDb(db => checkPlanFiles(J, db)).catch(e => [String(e.message || e)]);
    if (!errs.length) { state.assessTries = 0; return false; }
    state.assessTries = (state.assessTries || 0) + 1;
    if (state.assessTries > 3) throw new Stop(`${what}的格式修了 3 次還不對：${errs.slice(0, 5).join('；')}`);
    log(`  ! ${what}的格式不對（${errs.length} 項），退回規劃角色`);
    for (const e of errs.slice(0, 8)) log(`    ✗ ${e}`);
    await round('plan', `app 檢查 \`.studio/plan/\` 的可行性分析與 BOM，發現下列問題，請修正後結束（格式照原本的任務說明）：\n\n${errs.map(e => '- ' + e).join('\n')}`, { resume: true });
    return true;
  }
  // 段落：工作階段與角色指派分段（第二段的開發不續接第一段的工作階段）
  const seg = () => state.segment || 1, sk = role => seg() === 2 ? role + '@2' : role, resolve = role => resolveRole(role, roleCtx(), seg());
  const abort = new AbortController();
  const onInt = () => { log('\n中斷：停止代理，狀態已保存，之後用 vs3d resume 續跑。'); abort.abort(); };
  process.once('SIGINT', onInt);

  // ---------------------------------------------------------------- 一輪
  async function round(role, prompt, { resume = false, images = [] } = {}) {
    if (state.round >= maxRounds) throw new Error(`已達 ${maxRounds} 輪上限（--max-rounds 可調整）`);
    const rc = resolve(role), adapter = adapterFor(rc.cli);
    // 認證（訂閱帳號或 API 金鑰）：金鑰沒設好就在這裡停下；工作階段存在各認證方式自己的設定目錄，換了就不能續接
    const auth = await agentEnv(rc.cli);
    const prev = state.sessions[sk(role)], sameAuth = (prev?.auth || 'subscription') === (auth.mode || 'subscription');
    const sessionId = resume && prev?.cli === rc.cli && sameAuth ? prev.sessionId : null;
    if (resume && prev && prev.cli !== rc.cli) log(`  ! ${role} 上次用 ${prev.cli}，這次指派為 ${rc.cli}：無法續接，改開新的工作階段`);
    else if (resume && prev && !sameAuth) log(`  ! ${role} 上次用${AUTH_MODES[prev.auth || 'subscription']}，這次是${AUTH_MODES[auth.mode]}：無法續接，改開新的工作階段`);
    commitAll(`Changes before round ${state.round + 1}`);
    const startHead = git(J.dir, ['rev-parse', 'HEAD']).trim(), snap = J.repo ? repoGit.snapshotOutside(J) : snapshot(ws, id), scope = roleScope(role, J);
    const n = ++state.round, t0 = now();
    state.lastRole = role;
    log(`\n▶ 第 ${n} 輪 ${role}${seg() === 2 ? '（第二段）' : ''}（${adapter.label}${rc.model ? ' ' + rc.model : ''}${rc.effort ? ` effort=${rc.effort}` : ''}${sessionId ? '，續接' : ''}）`);
    save();
    const res = await runAgent(adapter, {
      cwd: J.dir, prompt, sessionId, model: rc.model || undefined, effort: rc.effort || undefined,
      readDirs: [P.core], allowWrite: scope.allow, denyWrite: scope.deny, images,
      logFile: join(J.logs, `round-${String(n).padStart(2, '0')}-${role}${seg() === 2 ? '-s2' : ''}.jsonl`), timeoutMs: timeoutMin * 60000, signal: abort.signal,
      env: auth.env, unsetEnv: auth.unset, settings: auth.settings,
    }, e => printEvent(e, log));
    // 本庫模式：專案外的變動只警告（可能是使用者同時在改；代理已被寫檔關卡與沙箱擋在專案外），不自動還原
    const iso = J.repo ? { violations: [], warnings: repoGit.diffOutside(J, snap) } : verifyAndRestore(ws, id, snap), roleViol = enforceRoleScope(role, J, startHead);
    for (const w of iso.warnings || []) log(`  ! 專案外有變動：${w.path}（${w.change}）；可能是你同時在改，app 沒有動它，請自行確認`);
    const violations = [...iso.violations, ...roleViol];
    if (role === 'plan') syncClientNames();
    for (const v of violations) log(`  ⚠ 越界：${v.area} ${v.path}（${v.change}）${v.restored ? '→ 已還原' : '→ 未能自動還原，請檢查'}`);
    const commit = commitAll(`${J.repo ? 'vs3d ' : ''}Round ${n} (${role}): ${short(res.text.split('\n').find(l => l.trim()) || 'no summary', 60)}`);
    if (res.sessionId) state.sessions[sk(role)] = { cli: rc.cli, model: rc.model, sessionId: res.sessionId, ...(auth.mode ? { auth: auth.mode } : {}) };
    state.violations = violations;
    appendJsonl(J.rounds, { round: n, role, segment: seg(), cli: rc.cli, model: rc.model, effort: rc.effort, sessionId: res.sessionId, resumed: !!sessionId, startedAt: t0, seconds: res.seconds,
      ok: res.ok, aborted: res.aborted, timedOut: res.timedOut, usage: res.usage, costUsd: res.costUsd, turns: res.turns, commit, violations, summary: short(res.text, 400),
      ...(process.env.VS3D_BY ? { by: process.env.VS3D_BY } : {}),      // 從介面啟動時記下是誰（代理佇列給的環境變數）
      ...(auth.mode ? { auth: auth.mode } : {}) });                       // 這一輪用訂閱帳號還是 API 金鑰
    save();
    log(`  ${res.ok ? '✓' : '✗'} 第 ${n} 輪結束（${res.seconds} s${commit ? `，commit ${commit}` : '，沒有變更'}）`);
    if (!res.ok) {
      if (res.aborted) throw new Stop('中斷');
      throw new Stop(`代理執行失敗（${res.timedOut ? `超過 ${timeoutMin} 分鐘` : `exit ${res.code}`}）：${short(res.stderr || res.text, 300)}\n之後可用 vs3d resume 重試。`);
    }
    return res;
  }
  // 提交：工作區＝專案自己的 git 全部提交；本庫＝只提交該專案路徑（review JSON 只有時間變動的不提交）
  function commitAll(message) {
    if (J.repo) return repoGit.commitProject(J, message);
    if (!git(J.dir, ['status', '--porcelain']).trim()) return null;
    git(J.dir, ['add', '-A']); git(J.dir, [...GIT_ID, 'commit', '-qm', message]);
    return git(J.dir, ['rev-parse', '--short', 'HEAD']).trim();
  }
  // 規劃角色列出的用戶名稱併進工作區名單，專案 AGENTS.md（app 寫的需求原文、拍板事項）裡的名稱換成「（用戶）」
  function syncClientNames() {
    const listed = readText(join(J.plan, 'client-names.txt')).split(/\r?\n/), added = addClientNames(ws, listed);
    addProjectNames(J, listed);
    if (added.length) log(`  ⊘ 規劃角色列出 ${added.length} 個用戶名稱，已加進名單（不得顯示）`);
    const names = readClientNames(ws), text = readText(J.agents);
    if (names.length && text && names.some(n => text.includes(n))) writeFileSync(J.agents, redactNames(text, names));
  }
  const ctxFor = extra => ({ ws, J, adapter: adapterFor(resolve(extra.role).cli), scope: roleScope(extra.role, J).text, violations: state.violations, segment: seg(), components: comps(), ...extra });

  // ---------------------------------------------------------------- 回答後續接
  async function handleAnswers(answers) {
    const asker = state.waiting?.askedBy;
    state.waiting = null; save();
    const appAnswers = answers.filter(a => a.id.startsWith('vs3d-'));
    for (const a of appAnswers) applyAppAnswer(a);
    const agentAnswers = answers.filter(a => !a.id.startsWith('vs3d-'));
    if (agentAnswers.length && asker && asker !== 'app' && state.sessions[sk(asker)])
      await round(asker, answersPrompt(agentAnswers, ctxFor({ role: asker })), { resume: true });
  }
  function applyAppAnswer(a) {
    if (a.id.startsWith('vs3d-proposal')) {
      if (a.choices[0] === 0 && !a.text) state.proposalApproved = true;
      else state.planFeedback = [a.text, a.note].filter(Boolean).join('；') || '請修改提案';
    }
    if (a.id.startsWith('vs3d-stage2')) {
      if (a.choices[0] === 0 && !a.text) { beginSegment2(state); log('\n▶ 開始第二段：電控、電盤、配線、相機'); }
      else if (a.text) { beginSegment2(state); state.planNote = [a.text, a.note].filter(Boolean).join('；'); log('\n▶ 開始第二段（附使用者說明）'); }
    }
    if (a.id.startsWith('vs3d-streak')) {
      if (a.choices[0] === 0 || a.text) { state.streak = {}; state.stage = 'fix'; state.extraNote = a.text || a.note || ''; }
      else if (a.choices[0] === 1) state.stage = 'paused';
      else state.stage = 'done';
    }
    if (a.id.startsWith('vs3d-render-pick')) {
      const all = state.reviewData?.suggest || [];
      if (a.choices[0] === 0 && !a.text) state.renderItems = all;
      else if (a.choices[0] === 1 && !a.text) state.renderItems = all.filter(x => (x.priority ?? 2) <= 1);
      else state.renderItems = pickItems(all, [a.text, a.note].filter(Boolean).join(' '));
      state.renderPicked = true;
    }
    if (a.id.startsWith('vs3d-render-accept') || a.id.startsWith('vs3d-render-stuck')) {
      const stuck = a.id.startsWith('vs3d-render-stuck'), c = a.choices[0], text = [a.text, a.note].filter(Boolean).join('；');
      if (!stuck && c === 0 && !a.text) { state.render = { ...state.render, result: 'accepted' }; state.stage = 'done'; }
      else if ((!stuck && (c === 1 || a.text)) || (stuck && c === 0)) { state.renderRevise = text || '請依守門檢查的結果修正'; state.renderTries = 0; state.stage = 'render-revise'; }
      else if ((!stuck && c === 2) || (stuck && c === 1)) {
        if (J.repo) {   // 本庫不能 reset：逐檔寫回補強前的內容，再提交一個還原 commit；使用者之後又改過的檔案不動
          const r = repoGit.revertToCommit(J, state.renderBase.commit, 'vs3d: revert render');
          log(`  ↺ 已寫回補強前的內容（${r.files} 個檔案${r.commit ? `，commit ${r.commit}` : ''}）${r.skipped.length ? `；你之後改過的 ${r.skipped.join('、')} 沒有動` : ''}`);
        } else { git(J.dir, ['reset', '-q', '--hard', state.renderBase.commit]); git(J.dir, ['clean', '-fdq']); log(`  ↺ 已還原到補強前（${state.renderBase.commit.slice(0, 7)}）`); }
        state.render = { ...state.render, result: 'reverted' }; state.stage = 'done';
      } else { state.render = { ...state.render, result: 'accepted-with-failures' }; state.stage = 'done'; }
    }
    save();
  }

  // ---------------------------------------------------------------- 主迴圈
  try {
    for (;;) {
      const { list, invalid } = loadQuestions(J);
      const asker = state.lastRole;
      if (invalid.length && asker && asker !== 'app' && state.sessions[sk(asker)]) {
        state.invalidRetries = (state.invalidRetries || 0) + 1;
        if (state.invalidRetries > 2) throw new Stop('問題檔格式連續錯誤：' + invalid.map(x => `${x.file}（${x.errors.join('；')}）`).join('、'));
        await round(asker, invalidQuestionsPrompt(invalid), { resume: true }); continue;
      }
      const pending = list.filter(q => !q.answered);
      if (pending.length) {
        state.waiting = { askedBy: state.waiting?.askedBy || (pending.every(q => q.source === 'app') ? 'app' : state.lastRole), ids: pending.map(q => q.id) };
        save();
        if (!interactive) {
          log(`\n？ 有 ${pending.length} 個問題等你回答：`);
          pending.forEach((q, i) => printQuestion(q, i, pending.length, log));
          log(`\n回答：vs3d answer "${id}" <問題 id> <編號或文字> [--note 補充]，全部回答後 vs3d resume "${id}"`);
          return { status: 'waiting', questions: pending.map(q => q.id) };
        }
        await handleAnswers(await askInteractive(J, pending));
        continue;
      }
      if (state.waiting) {   // 用 vs3d answer 回答完畢後 resume
        const answers = state.waiting.ids.map(qid => readAnswer(J, qid)).filter(Boolean);
        await handleAnswers(answers); continue;
      }

      switch (state.stage) {
        case 'plan': {
          const pfile = seg() === 2 ? 'segment2.md' : 'proposal.md', planSession = state.sessions[sk('plan')];
          const proposal = readText(join(J.plan, pfile)).trim();
          if (state.planFeedback) {
            const fb = state.planFeedback; state.planFeedback = null;
            await round('plan', `使用者看過${seg() === 2 ? '第二段提案' : '配置提案'}，要求修改：\n\n${fb}\n\n請更新 \`.studio/plan/${pfile}\`${seg() === 2 ? '與 `segment2.json`' : ''}；還有必須由使用者決定的事就寫問題檔。`, { resume: true });
            break;
          }
          if (proposal && planSession) {
            const assess = seg() === 1 && has('assess'), only = assess && !has('3d');
            if (assess && !state.proposalApproved && await assessFormat('可行性分析或 BOM')) break;
            if (state.proposalApproved || override.autoApprove) {
              await importParts();
              if (assess) await importAssess('提案確認');
              state.stage = seg() === 2 || has('3d') ? 'build' : 'done';
              break;
            }
            // 提案做成提問卡片請使用者確認（計畫書第 5 節第 3 步）
            log(`\n${seg() === 2 ? '第二段提案' : '配置提案'}：${join(J.plan, pfile)}`);
            const qid = `vs3d-proposal-r${state.round}`;
            writeAppQuestion(J, {
              id: qid, header: '確認提案', question: seg() === 2 ? `請看過第二段提案（.studio/plan/segment2.md），要開始開發電控、電盤、配線與相機嗎？`
                : only ? '請看過配置提案與可行性分析（介面的「提案」「可行性」分頁），確認後存進資料庫並產生成本表？' : `請看過配置提案（.studio/plan/proposal.md）${assess ? '與可行性分析' : ''}，要直接開始第一段開發嗎？`,
              options: [
                only ? { label: '確認提案', description: '提案與可行性分析存進資料庫、BOM 變成成本表草稿；之後可以在介面上修改或匯出評估報告' }
                  : { label: '確認，開始開發', description: seg() === 2 ? `依提案開發第二段（${(r => r.cli + (r.model ? ' ' + r.model : ''))(resolve('build'))}）；不會改第一段的節拍與動作` : `依目前的提案與已拍板事項開始第一段（場景、排程、視角、播放列、手機版面）${assess ? '；可行性分析與 BOM 先存進資料庫' : ''}` },
                { label: '要修改', description: '在補充說明寫下要改的地方，規劃角色會更新提案後再請你確認' },
              ], recommended: 0,
            });
            state.waiting = { askedBy: 'app', ids: [qid] };
            break;
          }
          state.planTries = (state.planTries || 0) + 1;
          if (state.planTries > 3) throw new Stop(`規劃角色沒有寫出 .studio/plan/${pfile}`);
          const note = state.planNote ? `\n\n使用者補充：${state.planNote}` : ''; state.planNote = '';
          await round('plan', planSession ? `你還沒有寫出 \`.studio/plan/${pfile}\`。請完成提案（需要拍板的事寫問題檔）。` : rolePrompt('plan', ctxFor({ role: 'plan' })) + note, { resume: !!planSession });
          break;
        }
        case 'optics-design': {   // AOI 光學方案（評估平台 Q7）：optics 角色提 2～3 個方案 → 平台用 L1＋L2 檢查（不通過退回，最多 3 次）→ 存成 AOI 方案
          const { opticsCatalog, opticsPrompt, checkSetups, OPTICS_DIR } = await import('./aoi.mjs'), dir = join(J.dir, ...OPTICS_DIR.split('/')), file = join(dir, 'setups.json');
          if (!state.opticsAsked) {
            mkdirSync(dir, { recursive: true });
            await withDb(db => writeJson(join(dir, 'parts.json'), opticsCatalog(db)));
            await round('optics', [header({ ...ctxFor({ role: 'optics' }), role: 'optics' }), '', opticsPrompt(state.opticsRequest || '')].join('\n'), { resume: false });
            state.opticsAsked = true; state.opticsTries = 0; break;
          }
          const r = await withDb(db => checkSetups(db, file));
          if (r.errors.length) {
            state.opticsTries = (state.opticsTries || 0) + 1;
            if (state.opticsTries > 3) throw new Stop(`光學方案修了 3 次還沒通過檢查：${r.errors.slice(0, 4).join('；')}`);
            log(`  ! 光學方案沒有通過檢查（${r.errors.length} 項），退回光學角色`); for (const e of r.errors.slice(0, 8)) log(`    ✗ ${e}`);
            await round('optics', `app 用 core/optics 檢查 \`${OPTICS_DIR}/setups.json\`，發現下列問題，請修正方案（可以換元件、改距離或光源）後結束：\n\n${r.errors.map(e => '- ' + e).join('\n')}`, { resume: true });
            break;
          }
          const saved = await withDb(db => db.withActor('optics 代理', () => r.setups.map(s => db.aoi.save(pkey, { name: s.name, data: s.setup, note: [s.rationale, r.compare && `比較：${r.compare}`].filter(Boolean).join('\n') }))));
          log(`  ✓ 光學方案 ${saved.length} 個存進專案的 AOI 方案：${saved.map(s => `${s.name}（${{ ok: '全部符合', warn: '有要注意的項目' }[s.result.status] || s.result.status}）`).join('、')}；到光學工作台比較、選用`);
          if (r.compare) log(`  比較：${short(r.compare, 300)}`);
          Object.assign(state, { opticsAsked: false, opticsRequest: null, opticsTries: 0, flow: null });
          state.stage = 'done'; break;
        }
        case 'assess-revise': {   // 修改評估（評估平台 Q6）：資料庫的最新版寫回 .studio/plan/ → 規劃角色照要求改 → 檢查格式 → 存回資料庫
          if (!state.assessRevised) {
            await withDb(db => writePlanFiles(db, pkey, J));
            const req = String(state.assessRequest || '').split('\n').map(l => '> ' + l).join('\n');
            await round('plan', [header({ ...ctxFor({ role: 'plan' }), role: 'plan' }), '', '## 任務：修改評估', '', '使用者要求修改配置提案、可行性分析或 BOM：', '', req, '',
              '`.studio/plan/` 的 proposal.md、feasibility.md、feasibility.json、bom.json 是資料庫目前的版本（使用者可能在介面上改過，以它為準）。照要求修改這幾個檔，格式和原本的規劃任務相同（bom.json 的市購品用 ref 引用元件、客製件只能是加工件類、不要自己加總成本）。只寫 `.studio/plan/` 與 `.studio/questions/`；要求不清楚就寫問題檔。'].join('\n'),
              { resume: !!state.sessions[sk('plan')] });
            state.assessRevised = true; break;
          }
          if (await assessFormat('修改後的可行性分析或 BOM')) break;
          await importAssess(`依要求修改：${short(state.assessRequest, 80)}`);
          Object.assign(state, { assessRevised: false, assessRequest: null, flow: null });
          state.stage = 'done'; break;
        }
        case 'change': {   // 修改指令（本庫的站與完成的專案）：開發角色照使用者的要求改，之後檢查 → 審查
          if (state.lockSchedule && !state.segBase) {
            commitAll('Before change');
            const fp = await runFingerprint(ws, id);
            if (!fp.ok) throw new Stop(`無法產生排程指紋：${fp.error}`);
            writeJson(join(J.studio, 'segment2', 'base-fingerprint.json'), fp); state.segBase = { commit: git(J.dir, ['rev-parse', 'HEAD']).trim() };
          }
          await round('build', rolePrompt('change', ctxFor({ role: 'build', request: state.changeRequest, lockSchedule: !!state.lockSchedule })));
          state.stage = 'check';
          break;
        }
        case 'build': {
          // 上次開發中斷（額度、逾時）時續接同一個工作階段
          const again = !!state.sessions[sk('build')] && state.buildStarted;
          if (seg() === 2 && !state.segBase) {   // 第二段不能改第一段的排程與動作：先記下指紋
            commitAll('Before segment 2');
            const fp = await runFingerprint(ws, id);
            if (!fp.ok) throw new Stop(`無法產生排程指紋，不能開始第二段：${fp.error}`);
            writeJson(join(J.studio, 'segment2', 'base-fingerprint.json'), fp); state.segBase = { commit: git(J.dir, ['rev-parse', 'HEAD']).trim() };
          }
          state.buildStarted = true; save();
          await round('build', again ? `上一輪開發中斷了。請檢查目前的進度，繼續完成${seg() === 2 ? '第二段' : '第一段'}開發，完成後跑快速檢查。` : rolePrompt('build', ctxFor({ role: 'build', check: state.lastCheck })), { resume: again });
          state.stage = 'check';
          break;
        }
        case 'check': {
          const record = c => {
            log(`  ${c.ok ? '✓' : '✗'} ${failureSummary(c).split('\n')[0]}（${c.seconds} s）`);
            appendJsonl(J.rounds, { check: c.quick ? 'quick' : 'full', at: now(), ok: c.ok, seconds: c.seconds, failures: c.failures.map(f => `${f.check}：${f.note}`) });
          };
          log('\n▶ 快速檢查');
          let c = await runChecks(ws, id, { quick: true });
          record(c);
          if (c.ok && full) { log('▶ 完整檢查（含 ui 四尺寸）'); c = await runChecks(ws, id, { quick: false }); record(c); }
          if (c.ok && state.segBase && (seg() === 2 || state.lockSchedule)) {
            const fails = compareRenderFingerprint(readJson(join(J.studio, 'segment2', 'base-fingerprint.json')), await runFingerprint(ws, id));
            if (fails.length) { c = { ...c, ok: false, failures: [...c.failures, { check: 'fingerprint', note: state.lockSchedule ? '修改改到了原本的排程或動作（排程指紋不同）' : '第二段改到第一段的排程或動作（排程指紋不同）', detail: fails.slice(0, 25) }] }; log(`  ✗ 排程指紋：${short(fails.join('；'), 200)}`); }
            else log('  ✓ 排程指紋與第一段相同');
          }
          state.lastCheck = { quick: c.quick, ok: c.ok, rows: c.rows.length, failures: c.failures };
          if (c.ok) {
            // 本庫的站：檢查寫出的 review 結果跟著流程分支提交（只有時間變動的寫回原內容），否則下次開工會被當成未提交的改動
            if (J.repo) { const h = commitAll(`vs3d check results (round ${state.round})`); if (h) log(`  已提交檢查結果 ${h}`); }
            if (wantShots) { log('▶ 截圖'); const s = await takeShots(ws, id, join(J.temp, `shots-r${state.round}`)); state.shots = s.ok ? s.dir : null; }
            state.stage = wantReview ? 'review' : wantRender ? 'render' : 'done';
          } else state.stage = 'fix';
          break;
        }
        case 'review': {
          const n = (state.reviews || 0) + 1, shotList = pngs(state.shots && join(state.shots, id)), refs = refImages(J);
          state.reviews = n; save();
          // 評估＋成本：審查時對照資料庫的最新版（可行性分析與 BOM 摘要寫到 .studio/plan/）
          if (seg() === 1 && has('assess')) await withDb(db => { writePlanFiles(db, pkey, J); writeBomSummary(db, pkey, J); }).catch(e => log(`  ! 評估資料沒有寫出給審查：${e.message}`));
          await round('review', rolePrompt('review', ctxFor({ role: 'review', round: n, request: state.flow === 'change' ? state.changeRequest : '', shots: shotList.map(f => rel(J.dir, f)), refs: refs.map(f => rel(J.dir, f)) })), { images: [...shotList, ...refs] });
          const rv = readJson(join(J.studio, 'reviews', `review-${n}.json`), null);
          if (!rv) { log('  ! 審查角色沒有寫出審查結果，略過審查'); state.reviewData = { must: [], suggest: [] }; state.stage = wantRender ? 'render' : 'done'; break; }
          state.reviewData = { n, must: rv.must || [], suggest: (rv.suggest || []).sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2)), summary: rv.summary || '' };
          log(`  審查：必修 ${state.reviewData.must.length} 項、建議補強 ${state.reviewData.suggest.length} 項${rv.summary ? `；${short(rv.summary, 120)}` : ''}`);
          for (const m of state.reviewData.must) log(`    ✗ ${m.id} ${short(m.issue, 140)}`);
          appendJsonl(J.rounds, { review: n, at: now(), must: state.reviewData.must.map(m => `${m.id}：${m.issue}`), suggest: state.reviewData.suggest.length });
          if (state.reviewData.must.length && n < REVIEW_LIMIT && wantReviewFix) state.stage = 'review-fix';
          else {
            if (state.reviewData.must.length && !wantReviewFix) log(`  ! 只審查（--no-fix）：${state.reviewData.must.length} 項必修沒有送修正`);
            else if (state.reviewData.must.length) log(`  ! 審查 ${n} 次後仍有 ${state.reviewData.must.length} 項必修，先繼續；請在最後的對照中確認`);
            state.stage = wantRender && state.flow !== 'change' ? 'render' : 'done';
          }
          break;
        }
        case 'review-fix':
          await round('fix', mustFixPrompt(state.reviewData.must, ctxFor({ role: 'fix' })));
          state.stage = 'check';
          break;
        case 'render': {
          if (!state.renderBase) {
            log('\n▶ 補強前基準：排程指紋與空間檢核' + (wantPerf ? '、效能' : ''));
            commitAll('Before render');
            const fp = await runFingerprint(ws, id);
            if (!fp.ok) throw new Stop(`無法產生排程指紋，不能開始補強：${fp.error}`);
            writeJson(join(J.studio, 'render', 'base-fingerprint.json'), fp);
            const perf = wantPerf ? await runPerf(ws, id, join(J.studio, 'render', 'base-perf.json')) : null;
            if (perf?.max) log(`  三角面 ${perf.max.triangles}、draw call ${perf.max.calls}、手機 ${perf.phoneFps} fps`);
            state.renderBase = { commit: git(J.dir, ['rev-parse', 'HEAD']).trim(), perf, shots: state.shots };
            state.renderPicked = false; state.renderItems = null; state.renderTries = 0;
          }
          const suggest = state.reviewData?.suggest || [];
          if (!state.renderPicked && override.pick && suggest.length) {
            log(`\n建議補強清單：`); suggest.forEach((x, i) => log(`  ${i + 1}. ［${x.area || '其他'}］${x.item}（優先 ${x.priority ?? 2}）`));
            const qid = `vs3d-render-pick-r${state.round}`;
            writeAppQuestion(J, { id: qid, header: '補強項目', question: `審查列出 ${suggest.length} 項建議補強（見上方清單），要交給補強角色處理哪些？`,
              options: [{ label: '全部補強', description: `${suggest.length} 項都做` },
                { label: '只補高優先', description: `只做優先 1 的 ${suggest.filter(x => (x.priority ?? 2) <= 1).length} 項` },
                { label: '我自己挑', description: '在補充說明寫編號，例如「1,3,5」或「除了 2、4」' }], recommended: 0 });
            state.waiting = { askedBy: 'app', ids: [qid] };
            break;
          }
          if (!state.renderItems) state.renderItems = suggest;
          state.renders = (state.renders || 0) + 1;
          await round('render', rolePrompt('render', ctxFor({ role: 'render', items: state.renderItems, focus: override.focus || '', round: state.renders })));
          state.stage = 'render-guard';
          break;
        }
        case 'render-revise': {
          const text = state.renderRevise; state.renderRevise = null;
          await round('render', renderRevisePrompt(text, ctxFor({ role: 'render' })), { resume: true });
          state.stage = 'render-guard';
          break;
        }
        case 'render-guard': {
          log('\n▶ 守門檢查：檢查、排程指紋、空間檢核' + (wantPerf ? '、效能預算' : ''));
          const fails = [], notes = [];
          let c = await runChecks(ws, id, { quick: true });
          if (c.ok && full) c = await runChecks(ws, id, { quick: false });
          if (!c.ok) fails.push(...c.failures.map(f => `檢查 ${f.check}：${f.note}${f.detail.length ? `（${short(f.detail.join(' '), 200)}）` : ''}`));
          fails.push(...compareRenderFingerprint(readJson(join(J.studio, 'render', 'base-fingerprint.json')), await runFingerprint(ws, id)));
          let perf = null;
          if (wantPerf && state.renderBase.perf?.max) {
            perf = await runPerf(ws, id, join(J.studio, 'render', `perf-${state.round}.json`));
            const r = comparePerf(state.renderBase.perf, perf, readJson(J.studioJson, {}).budget);
            fails.push(...r.fails); notes.push(...r.notes);
          }
          for (const f of fails) log(`  ✗ ${short(f, 200)}`);
          for (const x of notes) log(`  ! ${x}`);
          appendJsonl(J.rounds, { guard: state.renders, at: now(), ok: !fails.length, fails, notes, perf: perf?.max ? { ...perf.max, phoneFps: perf.phoneFps } : null });
          if (fails.length) {
            state.renderTries = (state.renderTries || 0) + 1;
            if (state.renderTries >= RENDER_TRIES) {
              const qid = `vs3d-render-stuck-r${state.round}`;
              writeAppQuestion(J, { id: qid, header: '補強卡關', question: `補強後的守門檢查連續 ${state.renderTries} 次沒通過（${short(fails.join('；'), 160)}），要怎麼處理？`,
                options: [{ label: '繼續修正', description: `再給補強角色 ${RENDER_TRIES} 次機會；可以在補充說明寫修正方向` },
                  { label: '整批還原', description: `退回補強前（${state.renderBase.commit.slice(0, 7)}），保留第一段成品` },
                  { label: '接受目前狀態', description: '保留補強結果（守門檢查未全過），之後再處理' }], recommended: 1 });
              state.waiting = { askedBy: 'app', ids: [qid] };
              break;
            }
            await round('render', renderGuardPrompt(fails, ctxFor({ role: 'render' })), { resume: true });
            break;
          }
          // 通過：截圖、前後對照頁，讓使用者決定
          let after = null;
          if (wantShots) { log('▶ 補強後截圖'); const s = await takeShots(ws, id, join(J.temp, `shots-render-r${state.round}`)); after = s.ok ? s.dir : null; state.shots = after || state.shots; }
          const page = writeComparePage(J, { id, before: state.renderBase.shots, after, basePerf: state.renderBase.perf, perf, items: state.renderItems, review: state.reviewData, notes });
          state.render = { round: state.round, page, after };
          log(`  ✓ 守門檢查通過；前後對照：${page}`);
          const qid = `vs3d-render-accept-r${state.round}`;
          writeAppQuestion(J, { id: qid, header: '補強結果', question: `補強通過守門檢查，請看前後對照（${rel(J.dir, page)}），要保留嗎？`,
            options: [{ label: '接受', description: '保留補強結果，第一段完成' },
              { label: '要調整', description: '在補充說明寫要改或退回的部分，補強角色會再處理一次' },
              { label: '整批還原', description: `退回補強前（${state.renderBase.commit.slice(0, 7)}）` }], recommended: 0 });
          state.waiting = { askedBy: 'app', ids: [qid] };
          break;
        }
        case 'fix': {
          const c = state.lastCheck;
          for (const f of c.failures) state.streak[f.check] = (state.streak[f.check] || 0) + 1;
          for (const k of Object.keys(state.streak)) if (!c.failures.some(f => f.check === k)) delete state.streak[k];
          const stuck = Object.entries(state.streak).filter(([, v]) => v > STREAK_LIMIT);
          if (stuck.length) { askStreak(stuck); break; }
          const note = state.extraNote ? `\n\n使用者補充：${state.extraNote}` : '';
          state.extraNote = '';
          const resume = !!state.sessions[sk('fix')];
          await round('fix', (resume ? fixAgainPrompt(c, ctxFor({ role: 'fix' })) : rolePrompt('fix', ctxFor({ role: 'fix', check: c }))) + note, { resume });
          state.stage = 'check';
          break;
        }
        case 'paused':
          log('\n⏸ 已暫停（你選擇手動處理）。處理完後 vs3d resume 會重新檢查。');
          state.stage = 'check'; save();
          return { status: 'paused' };
        case 'done':
          if (J.repo && state.flowActive) { state.flowActive = false; log(`\n本庫：成果在本機分支 ${state.branch}（只提交了 ${id} 的路徑）；要推送與開 PR 用 vs3d push "${id}" 或介面的按鈕`); }
          if (seg() === 1 && wantStage2 && !state.stage2Asked && !J.repo && has('3d')) {
            state.stage2Asked = true;
            const qid = `vs3d-stage2-r${state.round}`, b = resolve('build');
            writeAppQuestion(J, { id: qid, header: '第二段', question: '第一段完成了，要開始第二段（電控、電盤、配線、相機子畫面、視覺疊圖）嗎？',
              options: [{ label: '開始第二段', description: `先由規劃角色整理電控與相機提案給你確認，再由 ${b.cli}${b.model ? ' ' + b.model : ''} 開發；不會改第一段的節拍與動作` },
                { label: '先不要', description: '停在第一段；之後可以用 vs3d stage2 或介面的「開始第二段」按鈕' }], recommended: 0 });
            state.waiting = { askedBy: 'app', ids: [qid] };
            break;
          }
          if (!has('3d')) { log(`\n✔ 評估完成：提案、可行性分析與成本表在資料庫（介面的「可行性」「成本表」分頁可以修改與匯出），共 ${state.round} 輪。`); save(); return { status: 'done', rounds: state.round }; }
          log(`\n✔ ${seg() === 2 ? '第二段' : '第一段'}完成：${state.lastCheck?.ok ? '檢查全部通過' : '依你的選擇結束（檢查未全過）'}，共 ${state.round} 輪。`);
          if (state.reviewData) log(`  審查 ${state.reviews} 次：剩餘必修 ${state.reviewData.must.length} 項`);
          if (state.render) log(`  補強：${{ accepted: '已接受', reverted: '已整批還原', 'accepted-with-failures': '接受（守門檢查未全過）' }[state.render.result] || '未完成'}${state.render.page ? `；對照 ${state.render.page}` : ''}`);
          if (state.shots) log(`  截圖：${state.shots}`);
          log(`  預覽：node "${join(P.core, 'tools', 'serve.mjs')}" "${id}"`);
          save();
          return { status: 'done', rounds: state.round };
        default: throw new Error(`未知的階段：${state.stage}`);
      }
      save();
    }
  } catch (e) {
    save();
    if (e instanceof Stop) { log(`\n■ ${e.message}`); return { status: 'stopped', message: e.message }; }
    throw e;
  } finally { process.off('SIGINT', onInt); release(); }

  function askStreak(stuck) {
    const names = stuck.map(([k, v]) => `${k}（${v - 1} 次）`).join('、');
    writeAppQuestion(J, {
      id: `vs3d-streak-r${state.round}`, header: '檢查卡關', question: `檢查項目 ${names} 連續修正都沒有通過，要怎麼處理？`,
      options: [
        { label: '繼續修正', description: `再給修正角色 ${STREAK_LIMIT} 次機會；可以在補充說明寫下修正方向` },
        { label: '暫停，我手動處理', description: '停在目前狀態，你改完後用 vs3d resume 重新檢查' },
        { label: '接受目前狀態', description: '結束第一段（檢查未全過），之後再處理' },
      ], recommended: 0,
    });
    state.waiting = { askedBy: 'app', ids: [`vs3d-streak-r${state.round}`] };
  }
}

class Stop extends Error {}

// 取消進行中的流程，回到「完成」。已經提交的內容不動；本庫的站留在原本的 vs3d 分支上，要不要保留由使用者決定。
// 可以取消的：本庫的站，以及完成第一段之後才開始的流程（重新審查、補強、修改指令、第二段）。
// 第一段還沒做完的專案沒有可以回去的狀態，不要的話用刪除。還沒回答的問題移到 questions/cancelled/。
export function cancelFlow(ws, id) {
  const J = projectPaths(ws, id);
  if (!existsSync(J.dir)) throw new Error(`找不到專案：${id}`);
  const state = loadState(J), seg2 = (state.segment || 1) === 2;
  if (state.stage === 'done' && !state.flowActive) throw new Error('沒有進行中的流程');
  if (!J.repo && !state.flow && !seg2) throw new Error('第一段還沒完成，沒有可以回去的狀態；不要這個專案的話請刪除專案');
  const release = acquireLock(ws, id);      // 正在執行就會丟出錯誤：先停止再取消
  try {
    const pending = pendingQuestions(J);
    if (pending.length) mkdirSync(join(J.questions, 'cancelled'), { recursive: true });
    for (const q of pending) renameSync(join(J.questions, q.file), join(J.questions, 'cancelled', q.file));
    const from = state.stage;
    Object.assign(state, { stage: 'done', segment: seg2 && state.stage !== 'done' ? 1 : state.segment, waiting: null, flow: null, flowActive: false, changeRequest: null, lockSchedule: false,
      segBase: null, streak: {}, renderBase: null, renderPicked: false, renderItems: null, renderTries: 0 });
    writeJson(J.state, state);
    appendJsonl(J.rounds, { cancel: from, at: now(), branch: state.branch || null });
    return { from, branch: state.branch || null, questions: pending.length };
  } finally { release(); }
}

// 開始第二段：保留第一段的摘要，重設每段各自的狀態（工作階段用「角色@2」另存，不會續接第一段）
export function beginSegment2(state) {
  state.segments = { ...state.segments, 1: { rounds: state.round, reviews: state.reviews || 0, must: state.reviewData?.must?.length ?? null, render: state.render?.result || null } };
  Object.assign(state, { segment: 2, stage: 'plan', waiting: null, stage2Asked: true, proposalApproved: false, planFeedback: null, planTries: 0, planNote: '', buildStarted: false,
    reviews: 0, reviewData: null, renderBase: null, render: null, renders: 0, renderTries: 0, renderPicked: false, renderItems: null, streak: {}, invalidRetries: 0, segBase: null });
  return state;
}

// 「1,3,5」「S2、S4」只做這些；「除了 2、4」做其他全部（編號從 1 起，也可以寫審查的 id）
export function pickItems(all, text = '') {
  const tokens = [...String(text).matchAll(/S?\d+/gi)].map(m => m[0].toUpperCase());
  const hit = (x, i) => tokens.includes(String(i + 1)) || tokens.includes(String(x.id).toUpperCase());
  if (!tokens.length) return all;
  return /除了|除外|不要|排除|except/i.test(text) ? all.filter((x, i) => !hit(x, i)) : all.filter(hit);
}

// 角色的可寫範圍：寫檔關卡（Claude）用 allow／deny；結束後再用 git 檢查追蹤中的檔案
export function roleScope(role, J) {
  if (role === 'optics') return { allow: [join(J.studio, 'optics'), J.questions], deny: [], text: '只有 `.studio/optics/` 與 `.studio/questions/`' };
  if (role === 'plan' || role === 'review') {
    const allow = role === 'plan' ? [J.plan, J.questions] : [join(J.studio, 'reviews'), J.questions];
    return { allow, deny: [], text: role === 'plan' ? '只有 `.studio/plan/` 與 `.studio/questions/`' : '只有 `.studio/reviews/` 與 `.studio/questions/`' };
  }
  const deny = [J.agents, J.studioJson, join(J.dir, 'CLAUDE.md'), join(J.dir, '.gitignore'), join(J.dir, '.git'), J.answers, J.state, J.rounds, J.logs, J.handoff];
  return { allow: [J.dir], deny, text: '整個專案資料夾，但不含 `AGENTS.md`、`CLAUDE.md`、`studio.json`、`.gitignore` 與 `.studio/`（`.studio/questions/` 除外）' };
}

// 用 git 檢查這一輪追蹤中的變更；不在角色範圍內的檔案退回開工前的版本（工作區的專案由 app 管理，可以直接還原）
function enforceRoleScope(role, J, startHead) {
  const changed = J.repo ? repoGit.changes(J) : git(J.dir, ['status', '--porcelain', '-z', '--untracked-files=all']).split('\0').filter(Boolean).map(l => ({ code: l.slice(0, 2), path: l.slice(3) }));
  const bad = changed.filter(c => role === 'plan' || role === 'review' || role === 'optics' || ['AGENTS.md', 'CLAUDE.md', 'studio.json', '.gitignore'].includes(c.path));
  const out = [];
  for (const c of bad) {
    let restored = false;
    try {
      if (J.repo) repoGit.writeBack(J, startHead, c.path);     // 本庫不用 clean／checkout
      else if (c.code.includes('?')) git(J.dir, ['clean', '-fq', '--', c.path]);
      else git(J.dir, ['checkout', '-q', startHead, '--', c.path]);
      restored = true;
    } catch { /* 留給使用者 */ }
    out.push({ area: `角色 ${role} 範圍`, path: c.path, change: c.code.includes('?') ? 'added' : 'modified', restored });
  }
  return out;
}

function printEvent(e, log) {
  if (e.kind === 'tool') log(`  · ${e.name} ${e.detail}`);
  else if (e.kind === 'tool_result' && !e.ok) log(`    ✗ ${e.detail}`);
  else if (e.kind === 'text') log(`  » ${short(e.text, 200)}`);
  else if (e.kind === 'warn' && e.message) log(`  ! ${short(e.message, 160)}`);
  else if (e.kind === 'error') log(`  ✗ ${short(e.message, 200)}`);
}
