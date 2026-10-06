// 元件補全（評估平台 Q5）：AI 上網查元件規格（enrich 角色，排進代理佇列），結果逐欄審核後採用。
//   PartEnrich：元件編輯視窗裡的一張卡片（開始、查詢中、審核表、採用的來源紀錄）
//   EnrichJobs：元件庫的「補全」分頁（所有工作；點一筆打開元件審核）
//   EnrichBatch：批次補全（從目前的清單勾選，一次最多 10 個）
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

const CONF = { high: '高', medium: '中', low: '低' };
const KIND = { datasheet: '規格書', image: '產品圖', cad: 'CAD', other: '其他' };
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const Src = ({ url, quote }) => url ? <a href={url} target="_blank" rel="noreferrer noopener" title={quote || url}>{host(url)}</a> : <span className="mute">—</span>;
const BUSY = ['queued', 'running'];

export function PartEnrich({ part, readOnly, onChanged }) {
  const [jobs, setJobs] = useState(null), [msg, setMsg] = useState(''), [onlyMissing, setOnlyMissing] = useState(false);
  const [pick, setPick] = useState({ keys: new Set(), price: false, files: new Set() });
  const load = useCallback(() => api.enrichJobs({ part: part.id }).then(d => setJobs(d.jobs)).catch(e => setMsg('✗ ' + e.message)), [part.id]);
  useEffect(() => { load(); }, [load]);
  const job = jobs?.[0], r = job?.result || {};
  // 查詢中每 3 秒再問一次
  useEffect(() => { if (!job || !BUSY.includes(job.status)) return; const t = setTimeout(load, 3000); return () => clearTimeout(t); }, [job, load]);
  // 審核表的預設勾選：合格、有變動、信心不是低的欄位；價格與檔案預設不勾
  useEffect(() => {
    if (job?.status !== 'review') return;
    setPick({ keys: new Set((r.items || []).filter(x => !x.error && !x.same && x.confidence !== 'low').map(x => x.key)), price: false, files: new Set() });
  }, [job?.id, job?.status]);    // eslint-disable-line
  const act = async fn => { setMsg(''); try { await fn(); } catch (e) { setMsg('✗ ' + e.message); } };
  const start = () => act(async () => { await api.enrichStart(part.id, onlyMissing ? part.missing : []); await load(); });
  const toggle = (k, v) => setPick(p => { const s = new Set(p[k]); s.has(v) ? s.delete(v) : s.add(v); return { ...p, [k]: s }; });
  const accept = () => act(async () => {
    const res = await api.enrichAccept(job.id, { keys: [...pick.keys], price: pick.price, files: [...pick.files] });
    const a = res.job.applied;
    setMsg(`✓ 採用 ${a.keys.length} 個欄位${a.price ? '、1 筆價格（C 級）' : ''}${a.files.length ? `、${a.files.length} 個檔案` : ''}${a.errors.length ? `；${a.errors.join('；')}` : ''}`);
    await load(); await onChanged();
  });
  const dismiss = () => act(async () => { await api.enrichDismiss(job.id); await load(); });
  const sources = part.sources || [];

  return <section className="card enrich"><h3>AI 補全規格{job && <span className={`chip ${job.status === 'review' ? 'warn' : job.status === 'failed' ? 'bad' : ''}`}>{job.status_label}</span>}</h3>
    <p className="mute hint">由代理上網查原廠規格（只有這個角色可以上網），每個值都附來源網址與原文摘錄；你逐欄勾選後才寫進元件（元件升一版、記下來源）。價格記成 C 級的價格紀錄；檔案由主機下載成附件（大小照附件上限）。</p>
    {(!job || !BUSY.includes(job.status)) && job?.status !== 'review' && <div className="bar">
      <button type="button" className="primary" disabled={readOnly} onClick={start}>{job ? '再查一次' : '開始補全'}</button>
      {part.missing?.length > 0 && <label className="check"><input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} />只查必填但沒填的欄位（{part.missing.join('、')}）</label>}
      {job?.status === 'failed' && <span className="bad">上次失敗：{job.error}</span>}
    </div>}
    {job && BUSY.includes(job.status) && <div className="bar"><span className="spin" />{job.status === 'queued' ? '在代理佇列排隊中…' : `${job.cli || '代理'}查詢中，通常 1～5 分鐘…`}
      {job.status === 'queued' && <button type="button" disabled={readOnly} onClick={dismiss}>取消</button>}</div>}
    {job?.status === 'review' && <>
      {r.note && <div className={`notice ${r.matched === false ? 'bad' : ''}`}>{r.matched === false && <b>型號可能對不上：</b>}{r.note}</div>}
      <div className="scroll"><table className="data enrich-review"><thead><tr><th /><th>欄位</th><th>目前</th><th>查到的</th><th>信心</th><th>來源</th></tr></thead><tbody>
        {(r.items || []).map(x => <tr key={x.key} className={x.error ? 'bad-row' : x.same ? 'mute' : ''}>
          <td><input type="checkbox" aria-label={`採用 ${x.label}`} disabled={readOnly || !!x.error || x.same} checked={pick.keys.has(x.key)} onChange={() => toggle('keys', x.key)} /></td>
          <td>{x.label}{x.unit && <span className="mute">（{x.unit}）</span>}{x.extra && <span className="chip" title="這次沒有指定，代理另外查到的">另外查到</span>}</td>
          <td>{x.current || <span className="mute">（空白）</span>}</td>
          <td><b>{x.value}</b>{x.same && <span className="mute">　相同</span>}{x.error && <div className="bad">✗ {x.error}</div>}{x.quote && <div className="mute q">「{x.quote}」</div>}</td>
          <td className={`conf ${x.confidence}`}>{CONF[x.confidence]}</td>
          <td><Src url={x.source} quote={x.quote} /></td></tr>)}
        {r.price && <tr className={r.price.error ? 'bad-row' : ''}>
          <td><input type="checkbox" aria-label="採用價格" disabled={readOnly || !!r.price.error} checked={pick.price} onChange={() => setPick(p => ({ ...p, price: !p.price }))} /></td>
          <td>參考單價</td><td>{part.prices[0] ? `${part.prices[0].currency} ${part.prices[0].unit_price.toLocaleString('en-US')}` : <span className="mute">（沒有）</span>}</td>
          <td><b>{r.price.currency} {Number(r.price.value).toLocaleString('en-US')}</b>{r.price.date && <span className="mute">　{r.price.date}</span>}{r.price.error && <div className="bad">✗ {r.price.error}</div>}{r.price.quote && <div className="mute q">「{r.price.quote}」</div>}</td>
          <td className="conf low">C 級</td><td><Src url={r.price.source} quote={r.price.quote} /></td></tr>}
        {(r.files || []).map((f, i) => <tr key={`f${i}`} className={f.error ? 'bad-row' : ''}>
          <td><input type="checkbox" aria-label={`下載 ${f.title || f.url}`} disabled={readOnly || !!f.error} checked={pick.files.has(i)} onChange={() => toggle('files', i)} /></td>
          <td>附件：{KIND[f.kind]}</td><td /><td>{f.title || <span className="mute">（沒有標題）</span>}{f.error && <div className="bad">✗ {f.error}</div>}</td><td /><td><Src url={f.url} /></td></tr>)}
        {!(r.items || []).length && !r.price && !(r.files || []).length && <tr><td colSpan={6} className="mute">代理沒有查到可以用的資料。</td></tr>}
      </tbody></table></div>
      <div className="bar">
        <button type="button" className="primary" disabled={readOnly || (!pick.keys.size && !pick.price && !pick.files.size)} onClick={accept}>採用勾選的（{pick.keys.size + (pick.price ? 1 : 0) + pick.files.size}）</button>
        <button type="button" disabled={readOnly} onClick={dismiss}>全部不要</button>
        <span className="mute">{job.cli}{job.model ? ` ${job.model}` : ''}{job.cost ? `　US$ ${job.cost.toFixed(3)}` : ''}　{job.finished_at.slice(0, 16).replace('T', ' ')}</span>
      </div>
    </>}
    {msg && <div className={msg.startsWith('✗') ? 'bad' : 'ok'}>{msg}</div>}
    {sources.length > 0 && <details><summary>採用過的來源（{sources.length}）</summary>
      <table className="data"><thead><tr><th>欄位</th><th>值</th><th>版本</th><th>來源</th><th>誰採用</th></tr></thead><tbody>
        {sources.map(s => <tr key={s.id}><td>{s.field.replace(/^attrs\./, '')}</td><td>{s.value}</td><td>v{s.version}</td><td><Src url={s.url} quote={s.quote} /></td><td className="mute">{s.accepted_by}　{s.accepted_at.slice(0, 10)}</td></tr>)}
      </tbody></table></details>}
  </section>;
}

// 「補全」分頁：所有補全工作；待審核的排前面
export function EnrichJobs({ onOpen }) {
  const [jobs, setJobs] = useState(null), [err, setErr] = useState('');
  const load = useCallback(() => api.enrichJobs({}).then(d => setJobs(d.jobs)).catch(e => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!jobs?.some(j => BUSY.includes(j.status))) return; const t = setTimeout(load, 3000); return () => clearTimeout(t); }, [jobs, load]);
  if (err) return <div className="notice bad">{err}</div>;
  if (!jobs) return <p className="mute">載入中…</p>;
  const order = { review: 0, running: 1, queued: 2, failed: 3, accepted: 4, dismissed: 5 };
  const list = [...jobs].sort((a, b) => order[a.status] - order[b.status] || b.id - a.id);
  return <section className="card">
    <p className="mute hint">元件的「AI 補全規格」與批次補全建立的工作。點一筆打開元件，在「AI 補全規格」卡片逐欄審核。</p>
    <div className="scroll"><table className="data click"><thead><tr><th>#</th><th>元件</th><th>狀態</th><th>查到</th><th>代理</th><th>誰</th><th>時間</th></tr></thead><tbody>
      {list.map(j => <tr key={j.id} tabIndex={0} onClick={() => onOpen(j.part_id)} onKeyDown={e => { if (e.key === 'Enter') onOpen(j.part_id); }}>
        <td className="mute">{j.id}</td><td><code className="p-code">{j.code}</code> {j.name}</td>
        <td><span className={`chip ${j.status === 'review' ? 'warn' : j.status === 'failed' ? 'bad' : j.status === 'accepted' ? 'ok' : ''}`}>{j.status_label}</span>{j.error && <div className="bad small">{j.error.slice(0, 80)}</div>}</td>
        <td>{j.result?.items ? `${j.result.items.filter(x => !x.error && !x.same).length} 個欄位${j.result.price ? '＋價格' : ''}${j.result.files?.length ? `＋${j.result.files.length} 檔` : ''}` : ''}
          {j.status === 'accepted' && <span className="mute">　採用 {j.applied.keys?.length || 0}</span>}</td>
        <td className="mute">{j.cli}{j.cost ? `　US$ ${j.cost.toFixed(3)}` : ''}</td><td>{j.created_by}</td><td className="mute nowrap">{j.created_at.slice(0, 16).replace('T', ' ')}</td></tr>)}
      {!list.length && <tr><td colSpan={7} className="mute">還沒有補全工作。打開一個元件，按「開始補全」；或在清單上方按「批次補全」。</td></tr>}
    </tbody></table></div>
  </section>;
}

// 批次補全：從目前的清單勾選（最多 10 個），一起排進代理佇列
export function EnrichBatch({ parts, onClose, onDone }) {
  const [sel, setSel] = useState(new Set()), [msg, setMsg] = useState('');
  const MAX = 10;
  const toggle = id => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else if (n.size < MAX) n.add(id); return n; });
  const go = async () => {
    setMsg('');
    try { const r = await api.enrichBatch([...sel]); onDone(`✓ ${r.jobs.length} 個元件排進代理佇列${r.errors.length ? `；${r.errors.join('；')}` : ''}`); }
    catch (e) { setMsg('✗ ' + e.message); }
  };
  return <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="panel narrow-panel" role="dialog" aria-label="批次補全">
      <div className="head"><h2 className="grow">批次補全</h2><button type="button" onClick={onClose}>✕ 關閉</button></div>
      <p className="mute hint">勾選要補的元件（一次最多 {MAX} 個；清單是目前的搜尋與分類結果）。每個元件一個工作，依序在代理佇列執行，完成後到「補全」分頁審核。會用到 API 額度。</p>
      <div className="scroll" style={{ maxHeight: '50vh' }}><table className="data"><tbody>
        {parts.slice(0, 200).map(p => <tr key={p.id}><td><input type="checkbox" aria-label={`補全 ${p.name}`} checked={sel.has(p.id)} disabled={!sel.has(p.id) && sel.size >= MAX} onChange={() => toggle(p.id)} /></td>
          <td><code className="p-code">{p.code}</code></td><td>{p.name}</td><td className="mute">{[p.brand, p.model].filter(Boolean).join(' ')}</td></tr>)}
      </tbody></table></div>
      <div className="bar"><button type="button" className="primary" disabled={!sel.size} onClick={go}>開始補全（{sel.size}）</button>{msg && <span className="bad">{msg}</span>}</div>
    </div>
  </div>;
}
