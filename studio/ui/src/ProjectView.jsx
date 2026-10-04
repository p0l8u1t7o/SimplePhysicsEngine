// 單一專案：狀態列與操作按鈕；分頁：進度、問題、提案、審查、預覽、截圖、補強對照、規則與紀錄。
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fileUrl, STAGE, ROLE } from './api.js';
import { QuestionCard } from './QuestionCard.jsx';

const TABS = [['progress', '進度'], ['questions', '問題'], ['proposal', '提案'], ['review', '審查'], ['preview', '預覽'], ['shots', '截圖'], ['compare', '補強對照'], ['rules', '規則']];
const min = s => `${(s / 60).toFixed(1)} 分`;
const RENDER_RESULT = { accepted: '已接受', reverted: '已整批還原', 'accepted-with-failures': '已接受（守門未全過）' };

export function ProjectView({ id, tick, running, onChange }) {
  const [p, setP] = useState(null);
  const [tab, setTab] = useState('progress');
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(null);
  const [focus, setFocus] = useState('');
  const logRef = useRef(null);
  // 剛建立的專案資料夾可能還沒出現（404）：先顯示「建立中」並持續重試，成功後清掉錯誤
  const load = useCallback(() => api.project(id).then(d => { setP(d); setError(''); }).catch(e => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => { const t = setInterval(load, 3000); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [p?.log?.length, tab]);
  const pending = p?.questions.filter(q => !q.answered) || [];
  useEffect(() => { if (pending.length && tab === 'progress') setTab('questions'); }, [pending.length]);    // eslint-disable-line

  if (!p) return <div className="page mute">{error ? `專案建立中…（${error}）` : '載入中…'}</div>;
  const isRunning = running?.id === id, busy = !!running;
  const act = async (fn) => { setError(''); try { await fn(); onChange?.(); load(); } catch (e) { setError(e.message); } };
  const s = p.state, rv = s.reviewData;
  const agentRounds = p.rounds.filter(r => r.role);

  return (
    <div className="page">
      <h2>{p.title}</h2>
      <div className="sub">{p.id}　<span className={`chip ${isRunning ? 'run' : p.stage === 'done' ? 'ok' : ''}`}>{isRunning ? `執行中：${running.cmd}` : (p.segment === 2 ? '第二段 · ' : '') + (STAGE[p.stage] || p.stage)}</span>
        　{p.round} 輪{p.lastCheck && <>　最近檢查 <span className={p.lastCheck.ok ? 'ok' : 'bad'}>{p.lastCheck.ok ? '通過' : '未過'}</span></>}{p.render && <>　補強{RENDER_RESULT[p.render] || p.render}</>}</div>
      <div className="bar">
        {isRunning ? <button onClick={() => act(api.stop)}>■ 停止</button>
          : <button className="primary" disabled={busy || pending.length > 0 || p.stage === 'done'} onClick={() => act(() => api.run(id, { cmd: 'resume' }))}>▶ 續跑</button>}
        {p.segment !== 2 && <button disabled={busy || p.stage !== 'done' || pending.length > 0} onClick={() => act(() => api.run(id, { cmd: 'stage2' }))}>開始第二段</button>}
        <button disabled={busy || p.stage !== 'done'} onClick={() => act(() => api.run(id, { cmd: 'review' }))}>重新審查</button>
        <button disabled={busy || p.stage !== 'done'} onClick={() => act(() => api.run(id, { cmd: 'render', pick: true, focus }))}>重新補強（挑項目）</button>
        <input value={focus} onChange={e => setFocus(e.target.value)} placeholder="補強範圍（選填，例如 手臂與吸盤）" style={{ minWidth: 220 }} />
        <a href={p.previewUrl} target="_blank" rel="noreferrer">在新分頁開啟預覽</a>
      </div>
      {error && <div className="bad">{error}</div>}
      <div className="tabs">{TABS.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}{k === 'questions' && pending.length ? `（${pending.length}）` : ''}</button>)}</div>

      {tab === 'progress' && <>
        <div className="log" ref={logRef}>{p.log.length ? p.log.join('\n') : '（這次開啟介面後還沒有輸出；下面是每輪紀錄）'}</div>
        <div className="card" style={{ marginTop: 12 }}>
          <h3>每輪紀錄</h3>
          <table><thead><tr><th>輪</th><th>角色</th><th>CLI／模型</th><th>時間</th><th>摘要</th></tr></thead><tbody>
            {p.rounds.map((r, i) => r.role
              ? <tr key={i}><td>{r.round}</td><td>{ROLE[r.role] || r.role}{r.resumed ? '（續接）' : ''}</td><td>{r.cli} {r.model}{r.effort ? ` ${r.effort}` : ''}</td><td>{min(r.seconds)}</td><td>{r.ok ? '' : <span className="bad">失敗 </span>}{r.violations?.length ? <span className="warn">越界 {r.violations.length}　</span> : ''}{r.summary}</td></tr>
              : r.check ? <tr key={i}><td></td><td>檢查 {r.check}</td><td></td><td>{r.seconds} s</td><td className={r.ok ? 'ok' : 'bad'}>{r.ok ? '通過' : r.failures.join('；')}</td></tr>
              : r.review ? <tr key={i}><td></td><td>審查 {r.review}</td><td></td><td></td><td>必修 {r.must.length}、建議 {r.suggest}</td></tr>
              : r.guard ? <tr key={i}><td></td><td>守門</td><td></td><td></td><td className={r.ok ? 'ok' : 'bad'}>{r.ok ? '通過' : r.fails.join('；')}</td></tr> : null)}
          </tbody></table>
          <p className="mute">代理合計 {min(agentRounds.reduce((a, r) => a + (r.seconds || 0), 0))}{agentRounds.some(r => r.costUsd) && `，Claude API 等值 $${agentRounds.reduce((a, r) => a + (r.costUsd || 0), 0).toFixed(2)}`}</p>
        </div>
      </>}

      {tab === 'questions' && <>
        {pending.map(q => <QuestionCard key={q.id} projectId={id} q={q} suggest={rv?.suggest || []} onDone={() => { onChange?.(); load(); }} />)}
        {pending.some(q => q.id.startsWith('vs3d-render-accept')) && p.compare && <iframe className="frame" title="補強對照" src={fileUrl(id, p.compare)} />}
        {!pending.length && <p className="mute">沒有等待回答的問題。</p>}
        {p.questions.filter(q => q.answered).length > 0 && <details className="card"><summary>已回答（{p.questions.filter(q => q.answered).length}）</summary>
          <ul>{p.questions.filter(q => q.answered).map(q => <li key={q.id}><span className="chip">{q.header || q.id}</span> {q.question}</li>)}</ul></details>}
      </>}

      {tab === 'proposal' && <>{p.segment2 && <div className="card pre"><b>第二段提案（電控、電盤、配線、相機）</b>{'\n\n' + p.segment2}</div>}<div className="card pre">{p.proposal || <span className="mute">還沒有配置提案。</span>}</div></>}

      {tab === 'review' && (rv ? <>
        <div className="card"><h3>第 {rv.n} 次審查</h3><p>{rv.summary}</p></div>
        <div className="card"><h3>必修（{rv.must.length}）</h3>{rv.must.length ? <ul>{rv.must.map(m => <li key={m.id}><b>{m.id}</b> {m.issue}<div className="mute">{m.evidence}　→ {m.fix}</div></li>)}</ul> : <p className="ok">沒有違反拍板事項或規則的問題。</p>}</div>
        <div className="card"><h3>建議補強（{rv.suggest.length}）</h3><table><tbody>{rv.suggest.map(x => <tr key={x.id}><td>{x.id}</td><td>{x.area}</td><td>{x.item}</td><td className="mute">優先 {x.priority ?? 2}</td></tr>)}</tbody></table></div>
      </> : <p className="mute">第一段完成後才會審查。</p>)}

      {tab === 'preview' && <iframe className="frame" title="3D 預覽" src={p.previewUrl} />}

      {tab === 'shots' && (p.shots.length ? <div className="grid">{p.shots.map(f => <figure key={f}><img src={fileUrl(id, f)} loading="lazy" onClick={() => setZoom(fileUrl(id, f))} /><figcaption>{f.split('/').pop()}</figcaption></figure>)}</div> : <p className="mute">檢查通過後才會截圖。</p>)}

      {tab === 'compare' && (p.compare ? <iframe className="frame" title="補強對照" src={fileUrl(id, p.compare)} /> : <p className="mute">還沒有補強。</p>)}

      {tab === 'rules' && <><div className="card pre">{p.agents}</div><div className="card"><h3>上傳的資料（docs/）</h3><ul>{p.docs.map(f => <li key={f}><a href={fileUrl(id, `docs/${f}`)} target="_blank" rel="noreferrer">{f}</a></li>)}</ul></div></>}

      {zoom && <div className="zoom" onClick={() => setZoom(null)}><img src={zoom} /></div>}
    </div>
  );
}
