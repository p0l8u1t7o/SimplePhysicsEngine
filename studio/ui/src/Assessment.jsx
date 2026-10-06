// 評估（評估平台 Q6）：可行性分析（結論、條件、全文）、版本、平台檢查、在介面上修改或請代理修改、匯出評估報告。
// 資料只在資料庫（每次修改存一版）；報告在下載時才產生。
import { useCallback, useEffect, useState } from 'react';
import { api, reportUrl } from './api.js';
import { Select } from './fields.jsx';
import { mdToHtml } from '../../lib/md.mjs';

const VCLS = { 可行: 'ok', 有條件可行: 'warn', 不可行: 'bad' };
const MARK = { ok: '✓', warn: '!', fail: '✗' };
const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);

export function Assessment({ id, canEdit, busy, done }) {
  const [d, setD] = useState(null), [ver, setVer] = useState(''), [shown, setShown] = useState(null), [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState(''), [ask, setAsk] = useState('');
  const load = useCallback(() => api.assessment(id).then(r => { setD(r); setMsg(m => m.startsWith('✗') ? '' : m); }).catch(e => setMsg('✗ ' + e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!ver) { setShown(null); return; } api.assessment(id, { kind: 'feasibility', version: ver }).then(setShown).catch(e => setMsg('✗ ' + e.message)); }, [id, ver]);
  if (!d) return <p className="mute">{msg || '載入中…'}</p>;
  const f = shown || d.feasibility, data = f?.data || {};
  const begin = () => setEdit({ content: f?.content || d.sections.map((s, i) => `## ${i + 1}. ${s}\n\n`).join('\n'), verdict: data.verdict || '有條件可行', summary: data.summary || '',
    conditions: (data.conditions || []).join('\n'), risks: (data.risks || []).map(r => `${r.risk}｜${r.mitigation}`).join('\n'), poc: (data.poc || []).map(p => p.item + (p.why ? `｜${p.why}` : '')).join('\n'), note: '' });
  const save = async () => {
    setMsg('');
    const risks = lines(edit.risks).map(l => { const [risk, mitigation = ''] = l.split(/[｜|]/); return { risk: risk.trim(), mitigation: mitigation.trim() }; });
    const poc = lines(edit.poc).map(l => { const [item, why = ''] = l.split(/[｜|]/); return { item: item.trim(), ...(why.trim() ? { why: why.trim() } : {}) }; });
    try {
      await api.saveAssessment(id, { kind: 'feasibility', content: edit.content, note: edit.note || '在介面上修改',
        data: { ...(d.feasibility?.data || {}), verdict: edit.verdict, summary: edit.summary, conditions: lines(edit.conditions), risks, poc } });
      setEdit(null); setVer(''); setMsg('✓ 已存成新的一版'); load();
    } catch (e) { setMsg('✗ ' + e.message); }
  };
  const revise = async () => { setMsg(''); try { await api.run(id, { cmd: 'assess', text: ask }); setAsk(''); setMsg('✓ 已排進代理佇列：規劃角色會照要求修改，改完存成新的一版'); } catch (e) { setMsg('✗ ' + e.message); } };
  const hist = d.history.feasibility;

  return <div className="assess">
    <section className="card">
      <div className="bar" style={{ marginTop: 0 }}>
        <h3 style={{ margin: 0 }}>可行性分析</h3>
        {f ? <span className={`chip ${VCLS[f.verdict] || ''} verdict`}>{f.verdict}</span> : <span className="mute">還沒有（規劃角色寫完、提案確認後會存進來）</span>}
        <span className="grow" />
        {hist.length > 0 && <Select value={ver} onChange={setVer} options={[['', `最新（v${hist[0].version}）`], ...hist.slice(1).map(h => [String(h.version), `v${h.version}　${h.created_at.slice(0, 10)}　${h.source === 'user' ? h.created_by || '使用者' : '代理'}`])]} />}
        {canEdit && !edit && <button disabled={!!ver} title={ver ? '回到最新版才能修改' : undefined} onClick={begin}>{f ? '修改' : '自己寫'}</button>}
      </div>
      {f && !edit && <>
        {data.summary && <p className="lead">{data.summary}</p>}
        {(data.conditions || []).length > 0 && <div><b>關鍵條件</b><ul>{data.conditions.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
        {data.cycle && <p className="mute">節拍：目標 {data.cycle.target ?? '—'} s、估算 {data.cycle.estimate ?? '—'} s</p>}
        <p className="mute small">v{f.version}　{f.created_at.slice(0, 16).replace('T', ' ')}　{f.source === 'user' ? `${f.created_by || '使用者'}在介面上修改` : '代理'}{f.note ? `：${f.note}` : ''}</p>
      </>}
      {edit && <div className="form">
        <div className="row">
          <label style={{ flex: '0 1 200px' }}><span>結論</span><Select value={edit.verdict} onChange={v => setEdit(e => ({ ...e, verdict: v }))} options={d.verdicts.map(v => [v, v])} /></label>
          <label style={{ flex: 3 }}><span>一段話的結論</span><input value={edit.summary} onChange={e => setEdit(x => ({ ...x, summary: e.target.value }))} /></label>
        </div>
        <div className="row">
          <label><span>關鍵條件（一行一項）</span><textarea rows={3} value={edit.conditions} onChange={e => setEdit(x => ({ ...x, conditions: e.target.value }))} /></label>
          <label><span>風險｜對策（一行一項）</span><textarea rows={3} value={edit.risks} onChange={e => setEdit(x => ({ ...x, risks: e.target.value }))} /></label>
          <label><span>POC 項目｜原因（一行一項）</span><textarea rows={3} value={edit.poc} onChange={e => setEdit(x => ({ ...x, poc: e.target.value }))} /></label>
        </div>
        <label><span>全文（Markdown；章節：{d.sections.join('、')}）</span><textarea className="mono" rows={18} value={edit.content} onChange={e => setEdit(x => ({ ...x, content: e.target.value }))} /></label>
        <div className="bar"><input value={edit.note} onChange={e => setEdit(x => ({ ...x, note: e.target.value }))} placeholder="這次改了什麼（記在版本上）" style={{ flex: 1 }} aria-label="修改說明" />
          <button className="primary" onClick={save}>存成新的一版</button><button onClick={() => setEdit(null)}>取消</button></div>
      </div>}
      {msg && <div className={msg.startsWith('✗') ? 'bad' : 'ok'}>{msg}</div>}
    </section>

    <section className="card">
      <h3>平台檢查</h3>
      <ul className="checks">{d.checks.map(c => <li key={c.check} className={c.level}><b>{MARK[c.level]} {({ feasibility: '可行性分析', bom: 'BOM', cost: '成本表', aoi: 'AOI 方案' })[c.check] || c.check}</b>　{c.note}
        {c.detail.length > 0 && <ul>{c.detail.slice(0, 12).map((x, i) => <li key={i} className="mute">{x}</li>)}</ul>}</li>)}</ul>
      <div className="bar">
        <span>匯出評估報告</span>
        <a className="btn" href={reportUrl(id, 'html')} download>HTML</a><a className="btn" href={reportUrl(id, 'pdf')} download>PDF</a><a className="btn" href={reportUrl(id, 'md')} download>Markdown</a>
        <span className="mute">封面結論、提案、可行性分析、成本摘要與明細、AOI 方案、3D 截圖；成本表 xlsx 在「成本表」分頁。</span>
      </div>
    </section>

    {canEdit && <section className="card">
      <h3>請代理修改</h3>
      <div className="mute hint">規劃角色會拿資料庫目前的版本（含你在介面上改的）照要求修改提案、可行性分析或 BOM，檢查格式後存成新的一版；BOM 重新匯入前自動留快照。</div>
      <textarea rows={3} value={ask} onChange={e => setAsk(e.target.value)} placeholder="例如「節拍目標改成 8 秒，重新核算；視覺改用兩台相機」" aria-label="要代理修改的內容" />
      <div className="bar"><span className="grow" /><button className="primary" disabled={busy || !done || !ask.trim()} title={!done ? '流程完成後才能下指令' : undefined} onClick={revise}>送出</button></div>
    </section>}

    {f && !edit && <section className="card doc md" dangerouslySetInnerHTML={{ __html: mdToHtml(f.content) }} />}
    {d.proposal && <details className="card"><summary>配置提案（資料庫 v{d.proposal.version}）</summary><div className="doc md" dangerouslySetInnerHTML={{ __html: mdToHtml(d.proposal.content) }} /></details>}
  </div>;
}

// 專案組成（評估＋成本／3D 動畫／AOI）：之後可以再加項目
export function Components({ id, value = [], canEdit, onSaved }) {
  const [sel, setSel] = useState(value), [msg, setMsg] = useState('');
  useEffect(() => setSel(value), [value.join(',')]);     // eslint-disable-line
  const ALL = [['assess', '評估＋成本'], ['3d', '3D 動畫'], ['aoi', 'AOI']];
  const dirty = sel.join(',') !== value.join(',');
  const save = async () => { setMsg(''); try { const r = await api.setComponents(id, sel); setMsg(r.resume ? '✓ 已加上 3D 動畫：按「續跑」開始第一段開發' : '✓ 已儲存'); onSaved?.(); } catch (e) { setMsg('✗ ' + e.message); } };
  return <div className="bar components">
    <span>專案組成</span>
    {ALL.map(([k, label]) => <label key={k} className="check"><input type="checkbox" disabled={!canEdit} checked={sel.includes(k)} onChange={e => setSel(s => e.target.checked ? ALL.map(x => x[0]).filter(x => x === k || s.includes(x)) : s.filter(x => x !== k))} />{label}</label>)}
    {dirty && <button className="primary" disabled={!sel.length} onClick={save}>儲存</button>}
    {msg && <span className={msg.startsWith('✗') ? 'bad' : 'ok'}>{msg}</span>}
  </div>;
}
