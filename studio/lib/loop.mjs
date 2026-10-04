// 流程主體：規劃 → 提問 → 開發 → 檢查 ⇄ 修正 → 審查 → 渲染與細節補強 → 完成。狀態存在 .studio/state.json，隨時可以中斷後用 resume 續跑。
//   每輪：開工前 commit → 記雜湊 → 執行代理 → 比對還原（越界）→ 角色範圍檢查 → commit → 記錄 rounds.jsonl
//   品質迴圈：快速檢查 → 完整檢查（含 ui 四尺寸）→ 截圖；失敗就回送修正角色，同一項連續失敗 3 次轉成提問
//   審查（計畫書 4.7）：看截圖、比對拍板事項與規則；必修項自動送修正 → 重新檢查 → 再審查（最多 3 次）
//   補強：記下基準（commit、排程指紋、效能、截圖）→ 補強角色 → 守門檢查（檢查全過、指紋與空間檢核不變、效能在預算內，
//         沒過就退回補強角色，最多 3 次）→ 前後對照頁 → 使用者接受／要求調整／整批還原
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { adapterFor, runAgent } from './adapters/index.mjs';
import { resolveRole, loadRoleContext } from './roles.mjs';
import { paths, projectPaths, acquireLock } from './workspace.mjs';
import { snapshot, verifyAndRestore } from './isolation.mjs';
import { loadQuestions, askInteractive, writeAppQuestion, readAnswer, printQuestion } from './questions.mjs';
import { runChecks, takeShots, failureSummary, runFingerprint, compareRenderFingerprint, runPerf, comparePerf } from './checks.mjs';
import { rolePrompt, answersPrompt, fixAgainPrompt, invalidQuestionsPrompt, mustFixPrompt, renderGuardPrompt, renderRevisePrompt } from './prompts.mjs';
import { writeComparePage } from './compare.mjs';
import { readJson, writeJson, appendJsonl, git, now, readText, rel } from './util.mjs';
import { readdirSync } from 'node:fs';

const REVIEW_LIMIT = 3, RENDER_TRIES = 3;
const pngs = dir => dir && existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.png') && !f.endsWith('.diff.png')).sort().map(f => join(dir, f)) : [];
const refImages = J => existsSync(J.docs) ? readdirSync(J.docs).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).sort().slice(0, 12).map(f => join(J.docs, f)) : [];

const STREAK_LIMIT = 3;
const GIT_ID = ['-c', 'user.name=vs3d', '-c', 'user.email=vs3d@localhost'];
const short = (s, n = 160) => (s = String(s ?? '').replace(/\s+/g, ' ').trim()).length > n ? s.slice(0, n) + '…' : s;

export const loadState = J => readJson(J.state, { stage: 'plan', round: 0, sessions: {}, streak: {}, waiting: null, lastCheck: null, violations: [] });

// full：快速檢查通過後是否再跑完整檢查（含 ui）；shots：通過後是否截圖；perf：補強前後是否量效能（測試時可關掉以節省時間）
// review／render：第一段完成後是否自動審查、補強（override.pick 時先讓使用者挑補強項目，override.focus 限定範圍）
export async function runProject(ws, id, { interactive = false, override = {}, maxRounds = 40, timeoutMin = 60, full = true, shots: wantShots = true,
  perf: wantPerf = true, review: wantReview = true, render: wantRender = true, log = console.log } = {}) {
  const P = paths(ws), J = projectPaths(ws, id);
  if (!existsSync(J.dir)) throw new Error(`找不到專案：${J.dir}`);
  let release;
  try { release = acquireLock(ws, id); } catch (e) { log(`■ ${e.message}`); return { status: 'stopped', message: e.message }; }
  const state = loadState(J);
  const save = () => writeJson(J.state, state);
  const roleCtx = () => loadRoleContext(P.settings, J.studioJson, override);
  const abort = new AbortController();
  const onInt = () => { log('\n中斷：停止代理，狀態已保存，之後用 vs3d resume 續跑。'); abort.abort(); };
  process.once('SIGINT', onInt);

  // ---------------------------------------------------------------- 一輪
  async function round(role, prompt, { resume = false, images = [] } = {}) {
    if (state.round >= maxRounds) throw new Error(`已達 ${maxRounds} 輪上限（--max-rounds 可調整）`);
    const rc = resolveRole(role, roleCtx()), adapter = adapterFor(rc.cli);
    const prev = state.sessions[role], sessionId = resume && prev?.cli === rc.cli ? prev.sessionId : null;
    if (resume && prev && prev.cli !== rc.cli) log(`  ! ${role} 上次用 ${prev.cli}，這次指派為 ${rc.cli}：無法續接，改開新的工作階段`);
    if (git(J.dir, ['status', '--porcelain']).trim()) { git(J.dir, ['add', '-A']); git(J.dir, [...GIT_ID, 'commit', '-qm', `Changes before round ${state.round + 1}`]); }
    const startHead = git(J.dir, ['rev-parse', 'HEAD']).trim(), snap = snapshot(ws, id), scope = roleScope(role, J);
    const n = ++state.round, t0 = now();
    state.lastRole = role;
    log(`\n▶ 第 ${n} 輪 ${role}（${adapter.label}${rc.model ? ' ' + rc.model : ''}${rc.effort ? ` effort=${rc.effort}` : ''}${sessionId ? '，續接' : ''}）`);
    save();
    const res = await runAgent(adapter, {
      cwd: J.dir, prompt, sessionId, model: rc.model || undefined, effort: rc.effort || undefined,
      readDirs: [P.core], allowWrite: scope.allow, denyWrite: scope.deny, images,
      logFile: join(J.logs, `round-${String(n).padStart(2, '0')}-${role}.jsonl`), timeoutMs: timeoutMin * 60000, signal: abort.signal,
    }, e => printEvent(e, log));
    const iso = verifyAndRestore(ws, id, snap), roleViol = enforceRoleScope(role, J, startHead);
    const violations = [...iso.violations, ...roleViol];
    for (const v of violations) log(`  ⚠ 越界：${v.area} ${v.path}（${v.change}）${v.restored ? '→ 已還原' : '→ 未能自動還原，請檢查'}`);
    let commit = null;
    if (git(J.dir, ['status', '--porcelain']).trim()) {
      git(J.dir, ['add', '-A']);
      git(J.dir, [...GIT_ID, 'commit', '-qm', `Round ${n} (${role}): ${short(res.text.split('\n').find(l => l.trim()) || 'no summary', 60)}`]);
      commit = git(J.dir, ['rev-parse', '--short', 'HEAD']).trim();
    }
    if (res.sessionId) state.sessions[role] = { cli: rc.cli, model: rc.model, sessionId: res.sessionId };
    state.violations = violations;
    appendJsonl(J.rounds, { round: n, role, cli: rc.cli, model: rc.model, effort: rc.effort, sessionId: res.sessionId, resumed: !!sessionId, startedAt: t0, seconds: res.seconds,
      ok: res.ok, aborted: res.aborted, timedOut: res.timedOut, usage: res.usage, costUsd: res.costUsd, turns: res.turns, commit, violations, summary: short(res.text, 400) });
    save();
    log(`  ${res.ok ? '✓' : '✗'} 第 ${n} 輪結束（${res.seconds} s${commit ? `，commit ${commit}` : '，沒有變更'}）`);
    if (!res.ok) {
      if (res.aborted) throw new Stop('中斷');
      throw new Stop(`代理執行失敗（${res.timedOut ? `超過 ${timeoutMin} 分鐘` : `exit ${res.code}`}）：${short(res.stderr || res.text, 300)}\n之後可用 vs3d resume 重試。`);
    }
    return res;
  }
  const ctxFor = extra => ({ ws, J, adapter: adapterFor(resolveRole(extra.role, roleCtx()).cli), scope: roleScope(extra.role, J).text, violations: state.violations, ...extra });

  // ---------------------------------------------------------------- 回答後續接
  async function handleAnswers(answers) {
    const asker = state.waiting?.askedBy;
    state.waiting = null; save();
    const appAnswers = answers.filter(a => a.id.startsWith('vs3d-'));
    for (const a of appAnswers) applyAppAnswer(a);
    const agentAnswers = answers.filter(a => !a.id.startsWith('vs3d-'));
    if (agentAnswers.length && asker && asker !== 'app' && state.sessions[asker])
      await round(asker, answersPrompt(agentAnswers, ctxFor({ role: asker })), { resume: true });
  }
  function applyAppAnswer(a) {
    if (a.id.startsWith('vs3d-proposal')) {
      if (a.choices[0] === 0 && !a.text) state.proposalApproved = true;
      else state.planFeedback = [a.text, a.note].filter(Boolean).join('；') || '請修改提案';
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
        git(J.dir, ['reset', '-q', '--hard', state.renderBase.commit]); git(J.dir, ['clean', '-fdq']);
        state.render = { ...state.render, result: 'reverted' }; state.stage = 'done';
        log(`  ↺ 已還原到補強前（${state.renderBase.commit.slice(0, 7)}）`);
      } else { state.render = { ...state.render, result: 'accepted-with-failures' }; state.stage = 'done'; }
    }
    save();
  }

  // ---------------------------------------------------------------- 主迴圈
  try {
    for (;;) {
      const { list, invalid } = loadQuestions(J);
      const asker = state.lastRole;
      if (invalid.length && asker && asker !== 'app' && state.sessions[asker]) {
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
          const proposal = readText(join(J.plan, 'proposal.md')).trim();
          if (state.planFeedback) {
            const fb = state.planFeedback; state.planFeedback = null;
            await round('plan', `使用者看過配置提案，要求修改：\n\n${fb}\n\n請更新 \`.studio/plan/proposal.md\`；還有必須由使用者決定的事就寫問題檔。`, { resume: true });
            break;
          }
          if (proposal && state.sessions.plan) {
            if (state.proposalApproved || override.autoApprove) { state.stage = 'build'; break; }
            // 提案做成提問卡片請使用者確認（計畫書第 5 節第 3 步）
            log(`\n配置提案：${join(J.plan, 'proposal.md')}`);
            const qid = `vs3d-proposal-r${state.round}`;
            writeAppQuestion(J, {
              id: qid, header: '確認提案', question: `請看過配置提案（.studio/plan/proposal.md），要直接開始第一段開發嗎？`,
              options: [
                { label: '確認，開始開發', description: '依目前的提案與已拍板事項開始第一段（場景、排程、視角、播放列、手機版面）' },
                { label: '要修改', description: '在補充說明寫下要改的地方，規劃角色會更新提案後再請你確認' },
              ], recommended: 0,
            });
            state.waiting = { askedBy: 'app', ids: [qid] };
            break;
          }
          state.planTries = (state.planTries || 0) + 1;
          if (state.planTries > 3) throw new Stop('規劃角色沒有寫出 .studio/plan/proposal.md');
          await round('plan', state.sessions.plan ? '你還沒有寫出 `.studio/plan/proposal.md`。請完成配置提案（需要拍板的事寫問題檔）。' : rolePrompt('plan', ctxFor({ role: 'plan' })), { resume: !!state.sessions.plan });
          break;
        }
        case 'build': {
          // 上次開發中斷（額度、逾時）時續接同一個工作階段
          const again = !!state.sessions.build && state.buildStarted;
          state.buildStarted = true; save();
          await round('build', again ? '上一輪開發中斷了。請檢查目前的進度，繼續完成第一段開發，完成後跑快速檢查。' : rolePrompt('build', ctxFor({ role: 'build', check: state.lastCheck })), { resume: again });
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
          state.lastCheck = { quick: c.quick, ok: c.ok, rows: c.rows.length, failures: c.failures };
          if (c.ok) {
            if (wantShots) { log('▶ 截圖'); const s = await takeShots(ws, id, join(J.temp, `shots-r${state.round}`)); state.shots = s.ok ? s.dir : null; }
            state.stage = wantReview ? 'review' : wantRender ? 'render' : 'done';
          } else state.stage = 'fix';
          break;
        }
        case 'review': {
          const n = (state.reviews || 0) + 1, shotList = pngs(state.shots && join(state.shots, id)), refs = refImages(J);
          state.reviews = n; save();
          await round('review', rolePrompt('review', ctxFor({ role: 'review', round: n, shots: shotList.map(f => rel(J.dir, f)), refs: refs.map(f => rel(J.dir, f)) })), { images: [...shotList, ...refs] });
          const rv = readJson(join(J.studio, 'reviews', `review-${n}.json`), null);
          if (!rv) { log('  ! 審查角色沒有寫出審查結果，略過審查'); state.reviewData = { must: [], suggest: [] }; state.stage = wantRender ? 'render' : 'done'; break; }
          state.reviewData = { n, must: rv.must || [], suggest: (rv.suggest || []).sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2)), summary: rv.summary || '' };
          log(`  審查：必修 ${state.reviewData.must.length} 項、建議補強 ${state.reviewData.suggest.length} 項${rv.summary ? `；${short(rv.summary, 120)}` : ''}`);
          for (const m of state.reviewData.must) log(`    ✗ ${m.id} ${short(m.issue, 140)}`);
          appendJsonl(J.rounds, { review: n, at: now(), must: state.reviewData.must.map(m => `${m.id}：${m.issue}`), suggest: state.reviewData.suggest.length });
          if (state.reviewData.must.length && n < REVIEW_LIMIT) state.stage = 'review-fix';
          else {
            if (state.reviewData.must.length) log(`  ! 審查 ${n} 次後仍有 ${state.reviewData.must.length} 項必修，先繼續；請在最後的對照中確認`);
            state.stage = wantRender ? 'render' : 'done';
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
            if (git(J.dir, ['status', '--porcelain']).trim()) { git(J.dir, ['add', '-A']); git(J.dir, [...GIT_ID, 'commit', '-qm', 'Before render']); }
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
          const resume = !!state.sessions.fix;
          await round('fix', (resume ? fixAgainPrompt(c, ctxFor({ role: 'fix' })) : rolePrompt('fix', ctxFor({ role: 'fix', check: c }))) + note, { resume });
          state.stage = 'check';
          break;
        }
        case 'paused':
          log('\n⏸ 已暫停（你選擇手動處理）。處理完後 vs3d resume 會重新檢查。');
          state.stage = 'check'; save();
          return { status: 'paused' };
        case 'done':
          log(`\n✔ 第一段完成：${state.lastCheck?.ok ? '檢查全部通過' : '依你的選擇結束（檢查未全過）'}，共 ${state.round} 輪。`);
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

// 「1,3,5」「S2、S4」只做這些；「除了 2、4」做其他全部（編號從 1 起，也可以寫審查的 id）
export function pickItems(all, text = '') {
  const tokens = [...String(text).matchAll(/S?\d+/gi)].map(m => m[0].toUpperCase());
  const hit = (x, i) => tokens.includes(String(i + 1)) || tokens.includes(String(x.id).toUpperCase());
  if (!tokens.length) return all;
  return /除了|除外|不要|排除|except/i.test(text) ? all.filter((x, i) => !hit(x, i)) : all.filter(hit);
}

// 角色的可寫範圍：寫檔關卡（Claude）用 allow／deny；結束後再用 git 檢查追蹤中的檔案
export function roleScope(role, J) {
  if (role === 'plan' || role === 'review') {
    const allow = role === 'plan' ? [J.plan, J.questions] : [join(J.studio, 'reviews'), J.questions];
    return { allow, deny: [], text: role === 'plan' ? '只有 `.studio/plan/` 與 `.studio/questions/`' : '只有 `.studio/reviews/` 與 `.studio/questions/`' };
  }
  const deny = [J.agents, J.studioJson, join(J.dir, 'CLAUDE.md'), join(J.dir, '.gitignore'), join(J.dir, '.git'), J.answers, J.state, J.rounds, J.logs, J.handoff];
  return { allow: [J.dir], deny, text: '整個專案資料夾，但不含 `AGENTS.md`、`CLAUDE.md`、`studio.json`、`.gitignore` 與 `.studio/`（`.studio/questions/` 除外）' };
}

// 用 git 檢查這一輪追蹤中的變更；不在角色範圍內的檔案退回開工前的版本（工作區的專案由 app 管理，可以直接還原）
function enforceRoleScope(role, J, startHead) {
  const changed = git(J.dir, ['status', '--porcelain', '-z', '--untracked-files=all']).split('\0').filter(Boolean).map(l => ({ code: l.slice(0, 2), path: l.slice(3) }));
  const bad = changed.filter(c => role === 'plan' || role === 'review' || ['AGENTS.md', 'CLAUDE.md', 'studio.json', '.gitignore'].includes(c.path));
  const out = [];
  for (const c of bad) {
    let restored = false;
    try {
      if (c.code.includes('?')) git(J.dir, ['clean', '-fq', '--', c.path]);
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
