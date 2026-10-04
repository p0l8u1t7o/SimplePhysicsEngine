// 提問卡片：代理與 app 的問題都在這裡回答。補強項目（vs3d-render-pick）改成勾選清單。
import { useState } from 'react';
import { api } from './api.js';

export function QuestionCard({ projectId, q, suggest = [], onDone }) {
  const pick = q.id.startsWith('vs3d-render-pick');
  const [sel, setSel] = useState(q.recommended != null ? [q.recommended] : []);
  const [other, setOther] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState(() => suggest.map(x => x.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = i => setSel(s => q.multiSelect ? (s.includes(i) ? s.filter(x => x !== i) : [...s, i]) : [i]);

  async function send() {
    setBusy(true); setError('');
    try {
      if (pick) await api.answer(projectId, { qid: q.id, choices: [2], note: items.join(',') || '（不補強）' });
      else if (sel.includes(-1)) { if (!other.trim()) throw new Error('請輸入你的說明'); await api.answer(projectId, { qid: q.id, text: other.trim(), note }); }
      else { if (!sel.length) throw new Error('請選一個選項'); await api.answer(projectId, { qid: q.id, choices: sel, note }); }
      onDone?.();
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <div className="card qcard">
      <h3>{q.header && <span className="chip" style={{ marginRight: 6 }}>{q.header}</span>}{q.question}</h3>
      {pick ? (
        <div>
          <p className="mute">勾選要交給補強角色處理的項目（預設全選）：</p>
          {suggest.map(x => (
            <label key={x.id} className="opt"><input type="checkbox" checked={items.includes(x.id)} onChange={() => setItems(s => s.includes(x.id) ? s.filter(i => i !== x.id) : [...s, x.id])} />
              <div><b>{x.id}</b>［{x.area || '其他'}］{x.item} <span className="mute">優先 {x.priority ?? 2}</span></div></label>
          ))}
          <div className="bar"><button type="button" onClick={() => setItems(suggest.map(x => x.id))}>全選</button><button type="button" onClick={() => setItems(suggest.filter(x => (x.priority ?? 2) <= 1).map(x => x.id))}>只選高優先</button><button type="button" onClick={() => setItems([])}>全不選</button></div>
        </div>
      ) : (
        <div>
          {q.options.map((o, i) => (
            <label key={i} className="opt"><input type={q.multiSelect ? 'checkbox' : 'radio'} name={q.id} checked={sel.includes(i)} onChange={() => toggle(i)} />
              <div><div>{o.label}{i === q.recommended && <span className="chip ok" style={{ marginLeft: 6 }}>建議</span>}</div>{o.description && <div className="d">{o.description}</div>}</div></label>
          ))}
          <label className="opt"><input type="radio" name={q.id} checked={sel.includes(-1)} onChange={() => setSel([-1])} /><div style={{ flex: 1 }}><div>其他（自己輸入說明）</div>
            {sel.includes(-1) && <textarea rows={2} value={other} onChange={e => setOther(e.target.value)} />}</div></label>
          <input style={{ width: '100%', marginTop: 4 }} value={note} onChange={e => setNote(e.target.value)} placeholder="補充說明（可留空）" />
        </div>
      )}
      {error && <div className="bad">{error}</div>}
      <div className="bar"><button className="primary" disabled={busy} onClick={send}>{busy ? '送出中…' : '送出'}</button><span className="mute">{q.id}</span></div>
    </div>
  );
}
