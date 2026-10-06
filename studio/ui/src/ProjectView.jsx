// 單一專案：狀態列與操作按鈕（續跑、取消流程、審查與補強、匯出、刪除專案）；分頁：進度、問題、提案、審查、預覽、截圖、補強對照、規則與紀錄。
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fileUrl, sameHost, STAGE, ROLE } from './api.js';
import { QuestionCard } from './QuestionCard.jsx';
import { Select, ConfirmButton, RENDER_FOCUS } from './fields.jsx';

const TABS = [['progress', '進度'], ['questions', '問題'], ['proposal', '提案'], ['review', '審查'], ['preview', '預覽'], ['shots', '截圖'], ['compare', '補強對照'], ['rules', '規則'], ['members', '成員']];
const min = s => `${(s / 60).toFixed(1)} 分`;
const RENDER_RESULT = { accepted: '已接受', reverted: '已整批還原', 'accepted-with-failures': '已接受（守門未全過）' };

// 專案成員（依專案分權限）：有成員時只有成員與管理者能執行與修改；沒有成員的專案所有一般帳號都能動。擁有者與管理者可以改名單
function Members({ id, onChange }) {
  const [d, setD] = useState(null), [list, setList] = useState([]), [add, setAdd] = useState(''), [msg, setMsg] = useState('');
  const load = useCallback(() => api.members(id).then(x => { setD(x); setList(x.members.map(m => ({ user: m.user, role: m.role }))); }).catch(e => setMsg('✗ ' + e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <p className="mute">{msg || '載入中…'}</p>;
  const name = u => d.users.find(x => x.name.toLowerCase() === u.toLowerCase())?.display || u;
  const dirty = JSON.stringify(list) !== JSON.stringify(d.members.map(m => ({ user: m.user, role: m.role })));
  const others = d.users.filter(u => u.role !== 'viewer' && !list.some(m => m.user.toLowerCase() === u.name.toLowerCase()));
  const save = () => api.saveMembers(id, list).then(() => { setMsg('✓ 已儲存'); load(); onChange?.(); }).catch(e => setMsg('✗ ' + e.message));
  return <section className="card">
    <h3>專案成員</h3>
    <p className="mute hint">{list.length ? '只有下面的成員與管理者能執行流程、回答問題、修改與刪除；其他人只能看。' : '目前沒有成員：所有一般帳號都能執行與修改（舊專案與本庫的站預設如此）。加入第一個成員時要指定擁有者。'}
      {!d.canManage && ' 只有擁有者或管理者可以改名單。'}</p>
    {list.length > 0 && <table className="data"><tbody>{list.map((m, i) => <tr key={m.user}>
      <td><b>{name(m.user)}</b> <span className="mute">{m.user}</span></td>
      <td><Select value={m.role} disabled={!d.canManage} onChange={v => { setMsg(''); setList(l => l.map((x, n) => n === i ? { ...x, role: v } : x)); }} options={Object.entries(d.roles)} /></td>
      <td className="ops">{d.canManage && <button type="button" onClick={() => { setMsg(''); setList(l => l.filter((_, n) => n !== i)); }}>移除</button>}</td></tr>)}</tbody></table>}
    {d.canManage && <div className="bar">
      <Select value={add} onChange={setAdd} options={[['', others.length ? '選擇帳號…' : '（沒有其他可以加的帳號）'], ...others.map(u => [u.name, `${u.display}（${u.name}）`])]} />
      <button type="button" disabled={!add} onClick={() => { setList(l => [...l, { user: add, role: l.length ? 'member' : 'owner' }]); setAdd(''); setMsg(''); }}>＋ 加入</button>
      <span className="grow" />
      {dirty && <button type="button" onClick={() => { setList(d.members.map(m => ({ user: m.user, role: m.role }))); setMsg(''); }}>復原</button>}
      <button type="button" className="primary" disabled={!dirty} onClick={save}>儲存</button>
    </div>}
    {msg && <div className={msg.startsWith('✗') ? 'bad' : 'ok'}>{msg}</div>}
  </section>;
}

export function ProjectView({ id, tick, running, onChange, onDeleted }) {
  const [p, setP] = useState(null);
  const [tab, setTab] = useState('progress');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [del, setDel] = useState(null);         // 刪除專案的確認欄：null 是沒打開
  const [zoom, setZoom] = useState(null);
  const [focus, setFocus] = useState('');
  const [change, setChange] = useState(''), [keepTiming, setKeepTiming] = useState(true);
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

  const canEdit = p.canEdit !== false;      // 不是專案成員或唯讀帳號：只能看
  const done = p.stage === 'done', blocked = busy || pending.length > 0;
  // 本庫的站有未提交的改動（多半是別的工具改的）：vs3d 開工會拒絕，開分支的指令先停用
  const dirty = p.repo ? p.dirty || [] : [], flowBlocked = blocked || dirty.length > 0;
  const exportBtn = (fmt, label, title) => <button disabled={busy} title={title} onClick={() => act(() => api.run(id, { cmd: 'export', formats: [fmt] }))}>{label}</button>;

  return (
    <div className="page">
      <div className="head">
        <div>
          <h2>{p.title}</h2>
          <div className="meta">
            <span className="mute">{p.id}</span>
            <span className={`chip ${isRunning ? 'run' : done ? 'ok' : ''}`}>{isRunning ? `● 執行中：${running.cmd}` : (p.segment === 2 ? '第二段 · ' : '') + (STAGE[p.stage] || p.stage)}</span>
            {pending.length > 0 && <span className="chip warn">{pending.length} 個問題待回答</span>}
            {p.repo ? <span className="chip">本庫{p.branch ? ` · ${p.branch}${p.flowActive ? '（進行中）' : ''}` : ''}</span> : <span className="chip">{p.round} 輪</span>}
            {p.lastCheck && <span className={`chip ${p.lastCheck.ok ? 'ok' : 'bad'}`}>最近檢查{p.lastCheck.ok ? '通過' : '未過'}</span>}
            {p.render && <span className="chip">補強{RENDER_RESULT[p.render] || p.render}</span>}
          </div>
        </div>
        <div className="bar" style={{ margin: 0 }}>
          <a className="btn" href={sameHost(p.previewUrl)} target="_blank" rel="noreferrer">↗ 在新分頁開啟預覽</a>
          {!p.repo && <button className="danger" disabled={isRunning || !canEdit} title={isRunning ? '執行中不能刪除，先停止' : '刪除這個專案'} onClick={() => setDel(del == null ? '' : null)}>刪除專案</button>}
        </div>
      </div>

      {!canEdit && <div className="notice warn">你不是這個專案的成員（或用的是唯讀帳號）：可以看所有內容，不能執行流程、回答問題或修改。成員名單在「成員」分頁。</div>}
      {dirty.length > 0 && !isRunning && <div className="notice warn">
        <b>本站有 {dirty.length} 個未提交的改動</b>（可能是 Claude Code、Codex 桌面版或其他工具改的）。vs3d 只在乾淨的站上開工，避免把別人的改動當成代理的成果提交；先提交或處理這些檔案，審查、補強、第二段與修改指令才能用。檢查與匯出不受影響。
        <ul className="files-list">{dirty.slice(0, 12).map(f => <li key={f}><code>{f}</code></li>)}{dirty.length > 12 && <li className="mute">…另外 {dirty.length - 12} 個</li>}</ul>
      </div>}

      {del != null && <section className="card danger">
        <h3>刪除專案</h3>
        <p className="hint">整個專案資料夾（程式、上傳的資料、提問與紀錄）會移到工作區的 <code>.studio/trash/</code>，介面上不再出現；之後想救回來，把資料夾搬回 <code>projects/</code> 就可以。輸入專案名稱 <b>{p.name}</b> 確認：</p>
        <div className="bar">
          <input value={del} onChange={e => setDel(e.target.value)} placeholder={p.name} aria-label="輸入專案名稱確認刪除" />
          <button className="danger" disabled={del !== p.name} onClick={() => api.deleteProject(id, del).then(() => onDeleted?.()).catch(e => setError(e.message))}>確定刪除</button>
          <button onClick={() => setDel(null)}>不刪了</button>
        </div>
      </section>}
      {notice && <div className="notice ok">{notice}</div>}

      <fieldset className="plain" disabled={!canEdit}>
      <div className="acts">
        <section className="group">
          <h4>流程</h4>
          <div className="bar">
            {isRunning ? <button className="danger" onClick={() => act(api.stop)}>■ 停止</button>
              : !done ? <button className="primary" disabled={blocked} onClick={() => act(() => api.run(id, { cmd: 'resume' }))}>▶ 續跑</button>
              : p.segment !== 2 ? <button className="primary" disabled={flowBlocked} title="電控、電盤、配線、相機" onClick={() => act(() => api.run(id, { cmd: 'stage2' }))}>開始第二段</button>
              : <span className="ok">✓ 第二段已完成</span>}
          </div>
          {p.cancellable && !isRunning && <div className="bar">
            <ConfirmButton label="取消流程" confirmLabel="確定取消？" title="放棄這次還沒做完的流程，回到「完成」；已經提交的內容不動"
              onConfirm={() => act(async () => { const r = await api.cancel(id); setNotice(`已取消流程，回到「完成」。${r.questions ? `${r.questions} 個還沒回答的問題已收起來。` : ''}${r.branch ? `已提交的內容留在分支 ${r.branch}。` : ''}`); })} />
          </div>}
          {!isRunning && pending.length > 0 && <small className="warn">先到「問題」分頁回答，才能繼續{p.cancellable ? '；不想繼續就按「取消流程」' : ''}。</small>}
          {!isRunning && busy && <small className="mute">工作區正在執行 {running.id}。</small>}
        </section>

        <section className="group">
          <h4>審查與補強</h4>
          {done ? <>
            <div className="bar">
              <button disabled={flowBlocked} onClick={() => act(() => api.run(id, { cmd: 'review' }))}>重新審查</button>
            </div>
            <div className="bar">
              <Select value={focus} onChange={setFocus} options={RENDER_FOCUS} title="補強範圍" />
              <button disabled={flowBlocked} onClick={() => act(() => api.run(id, { cmd: 'render', pick: true, focus }))}>重新補強（挑項目）</button>
            </div>
          </> : <small className="mute">完成後可以重新審查、補強。</small>}
        </section>

        <section className="group">
          <h4>成品與交付</h4>
          <div className="bar">
            {exportBtn('zip', '網站壓縮檔', '首頁＋本站＋core，附 open-demo.cmd，解壓後雙擊即可離線開啟')}
            {exportBtn('html', '單一 HTML', '全部內嵌成一個檔案，雙擊就能開（超過 15 MB 建議改用壓縮檔）')}
            {exportBtn('mp4', '錄影 MP4', 'Chrome＋ffmpeg 自動錄製 1080p')}
            {!p.repo && <button disabled={busy} title="git 歷史、上傳檔、提問與紀錄、不得顯示的名稱；給接手的同事匯入" onClick={() => act(() => api.run(id, { cmd: 'handoff' }))}>交接包</button>}
            <button disabled={busy} title="快速檢查（imports、names、determinism、layout、scene、electrical 與本站檢查）" onClick={() => act(() => api.run(id, { cmd: 'check' }))}>檢查</button>
          </div>
          {p.exports?.length > 0 && <ul className="exports">{p.exports.map(x => <li key={x.path}><a href={fileUrl(id, x.path)} download>⤓ {x.path.split('/').pop()}</a> <span className="mute">{(x.size / 1048576).toFixed(1)} MB · {new Date(x.at).toLocaleString()}</span></li>)}</ul>}
        </section>
      </div>

      {(done || p.repo) && <section className="card">
        <h3>修改指令</h3>
        <div className="mute hint">代理照你的描述修改，之後檢查、審查。{p.repo && <>開工時本站不能有未提交的改動；app 會開本機分支 <code>{p.name.toLowerCase().replace(/\s+/g, '-')}/vs3d-…</code>，每輪只提交本站的路徑，不會 checkout／reset／stash 你的工作目錄。</>}</div>
        <textarea rows={3} value={change} onChange={e => setChange(e.target.value)} placeholder="要改什麼，例如「出料台改成兩層，第二層放 NG 品」或「手臂換成 VS-087，夾爪改兩指」" />
        <div className="bar">
          <label className="check"><input type="checkbox" checked={keepTiming} onChange={e => setKeepTiming(e.target.checked)} /> 不能改節拍與動作（比對排程指紋）</label>
          <span className="grow" />
          {p.repo && <button disabled={busy || !p.branch || p.flowActive} title="推送這次的 vs3d 分支到 GitHub，之後開 PR" onClick={() => act(() => api.run(id, { cmd: 'push' }))}>推送分支</button>}
          <button className="primary" disabled={flowBlocked || !change.trim() || !done} onClick={() => act(() => api.run(id, { cmd: 'change', text: change, keepTiming }))}>送出修改指令</button>
        </div>
      </section>}
      </fieldset>
      {error && <div className="notice bad">{error}</div>}
      <div className="tabs">{TABS.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}{k === 'questions' && pending.length ? `（${pending.length}）` : ''}</button>)}</div>

      {tab === 'progress' && <>
        <div className="log" ref={logRef}>{p.log.length ? p.log.join('\n') : '（這次開啟介面後還沒有輸出；下面是每輪紀錄）'}</div>
        <div className="card" style={{ marginTop: 12 }}>
          <h3>每輪紀錄</h3>
          {!p.rounds.length ? <p className="mute">還沒有紀錄（app 執行過的開發、檢查、審查、補強會列在這裡）。</p> : <table><thead><tr><th>輪</th><th>角色</th><th>CLI／模型</th><th>時間</th><th>摘要</th></tr></thead><tbody>
            {p.rounds.map((r, i) => r.role
              ? <tr key={i}><td>{r.round}</td><td>{ROLE[r.role] || r.role}{r.resumed ? '（續接）' : ''}</td><td>{r.cli} {r.model}{r.effort ? ` ${r.effort}` : ''}</td><td>{min(r.seconds)}</td><td>{r.ok ? '' : <span className="bad">失敗 </span>}{r.violations?.length ? <span className="warn">越界 {r.violations.length}　</span> : ''}{r.summary}</td></tr>
              : r.check ? <tr key={i}><td></td><td>檢查 {r.check}</td><td></td><td>{r.seconds} s</td><td className={r.ok ? 'ok' : 'bad'}>{r.ok ? '通過' : r.failures.join('；')}</td></tr>
              : r.review ? <tr key={i}><td></td><td>審查 {r.review}</td><td></td><td></td><td>必修 {r.must.length}、建議 {r.suggest}</td></tr>
              : r.guard ? <tr key={i}><td></td><td>守門</td><td></td><td></td><td className={r.ok ? 'ok' : 'bad'}>{r.ok ? '通過' : r.fails.join('；')}</td></tr>
              : r.cancel ? <tr key={i}><td></td><td>取消流程</td><td></td><td></td><td className="mute">原本在「{STAGE[r.cancel] || r.cancel}」階段</td></tr> : null)}
          </tbody></table>}
          {agentRounds.length > 0 && <p className="mute">代理合計 {min(agentRounds.reduce((a, r) => a + (r.seconds || 0), 0))}{agentRounds.some(r => r.costUsd) && `，Claude API 等值 $${agentRounds.reduce((a, r) => a + (r.costUsd || 0), 0).toFixed(2)}`}</p>}
        </div>
      </>}

      {tab === 'questions' && <fieldset className="plain" disabled={!canEdit}>
        {pending.map(q => <QuestionCard key={q.id} projectId={id} q={q} suggest={rv?.suggest || []} onDone={() => { onChange?.(); load(); }} />)}
        {pending.some(q => q.id.startsWith('vs3d-render-accept')) && p.compare && <iframe className="frame" title="補強對照" src={fileUrl(id, p.compare)} />}
        {!pending.length && <p className="mute">沒有等待回答的問題。</p>}
        {p.questions.filter(q => q.answered).length > 0 && <details className="card"><summary>已回答（{p.questions.filter(q => q.answered).length}）</summary>
          <ul>{p.questions.filter(q => q.answered).map(q => <li key={q.id}><span className="chip">{q.header || q.id}</span> {q.question}</li>)}</ul></details>}
      </fieldset>}

      {tab === 'proposal' && <>{p.segment2 && <div className="card pre"><b>第二段提案（電控、電盤、配線、相機）</b>{'\n\n' + p.segment2}</div>}<div className="card pre">{p.proposal || <span className="mute">還沒有配置提案。</span>}</div></>}

      {tab === 'review' && (rv ? <>
        <div className="card"><h3>第 {rv.n} 次審查</h3><p>{rv.summary}</p></div>
        <div className="card"><h3>必修（{rv.must.length}）</h3>{rv.must.length ? <ul>{rv.must.map(m => <li key={m.id}><b>{m.id}</b> {m.issue}<div className="mute">{m.evidence}　→ {m.fix}</div></li>)}</ul> : <p className="ok">沒有違反拍板事項或規則的問題。</p>}</div>
        <div className="card"><h3>建議補強（{rv.suggest.length}）</h3><table><tbody>{rv.suggest.map(x => <tr key={x.id}><td>{x.id}</td><td>{x.area}</td><td>{x.item}</td><td className="mute">優先 {x.priority ?? 2}</td></tr>)}</tbody></table></div>
      </> : <p className="mute">第一段完成後才會審查。</p>)}

      {tab === 'preview' && <iframe className="frame" title="3D 預覽" src={sameHost(p.previewUrl)} />}

      {tab === 'shots' && (p.shots.length ? <div className="grid">{p.shots.map(f => <figure key={f}><img src={fileUrl(id, f)} loading="lazy" onClick={() => setZoom(fileUrl(id, f))} /><figcaption>{f.split('/').pop()}</figcaption></figure>)}</div> : <p className="mute">檢查通過後才會截圖。</p>)}

      {tab === 'compare' && (p.compare ? <iframe className="frame" title="補強對照" src={fileUrl(id, p.compare)} /> : <p className="mute">還沒有補強。</p>)}

      {tab === 'rules' && <><div className="card pre">{p.agents}</div><div className="card"><h3>上傳的資料（docs/）</h3><ul>{p.docs.map(f => <li key={f}><a href={fileUrl(id, `docs/${f}`)} target="_blank" rel="noreferrer">{f}</a></li>)}</ul></div></>}

      {tab === 'members' && <Members id={id} onChange={load} />}

      {zoom && <div className="zoom" onClick={() => setZoom(null)}><img src={zoom} /></div>}
    </div>
  );
}
