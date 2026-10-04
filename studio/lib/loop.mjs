// 流程主體：規劃 → 提問 → 開發 → 檢查 ⇄ 修正 → 第一段完成。狀態存在 .studio/state.json，隨時可以中斷後用 resume 續跑。
//   每輪：開工前 commit → 記雜湊 → 執行代理 → 比對還原（越界）→ 角色範圍檢查 → commit → 記錄 rounds.jsonl
//   品質迴圈：快速檢查 → 完整檢查（含 ui 四尺寸）→ 截圖；失敗就回送修正角色，同一項連續失敗 3 次轉成提問
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { adapterFor, runAgent } from './adapters/index.mjs';
import { resolveRole, loadRoleContext } from './roles.mjs';
import { paths, projectPaths, acquireLock } from './workspace.mjs';
import { snapshot, verifyAndRestore } from './isolation.mjs';
import { loadQuestions, askInteractive, writeAppQuestion, readAnswer, printQuestion } from './questions.mjs';
import { runChecks, takeShots, failureSummary } from './checks.mjs';
import { rolePrompt, answersPrompt, fixAgainPrompt, invalidQuestionsPrompt } from './prompts.mjs';
import { readJson, writeJson, appendJsonl, git, now, readText } from './util.mjs';

const STREAK_LIMIT = 3;
const GIT_ID = ['-c', 'user.name=vs3d', '-c', 'user.email=vs3d@localhost'];
const short = (s, n = 160) => (s = String(s ?? '').replace(/\s+/g, ' ').trim()).length > n ? s.slice(0, n) + '…' : s;

export const loadState = J => readJson(J.state, { stage: 'plan', round: 0, sessions: {}, streak: {}, waiting: null, lastCheck: null, violations: [] });

// full：快速檢查通過後是否再跑完整檢查（含 ui）；shots：通過後是否截圖（測試時可關掉以節省時間）
export async function runProject(ws, id, { interactive = false, override = {}, maxRounds = 24, timeoutMin = 60, full = true, shots: wantShots = true, log = console.log } = {}) {
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
  async function round(role, prompt, { resume = false } = {}) {
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
      readDirs: [P.core], allowWrite: scope.allow, denyWrite: scope.deny,
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
            state.stage = 'done';
          } else state.stage = 'fix';
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
