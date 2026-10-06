// 元件的版本紀錄（評估平台 Q3）：每一版改了什麼、誰改的；任兩版比較；模組的子件出了新版時「更新模組」。
// 影響選型或成本的欄位儲存就升版；備註、標籤這類不升。專案的 BOM 鎖定使用當時的版本。
import { useState } from 'react';
import { api } from './api.js';
import { Select } from './fields.jsx';

const show = v => v == null || v === '' ? <span className="mute">（空白）</span>
  : typeof v === 'object' ? (v.unit_price !== undefined ? `${v.currency === 'TWD' || !v.currency ? 'NT$' : v.currency} ${Number(v.unit_price).toLocaleString('en-US')}${v.grade ? `（${v.grade}）` : ''}${v.quoted_on ? `　${v.quoted_on}` : ''}`
    : Array.isArray(v) ? v.map(c => `${c.code}×${c.qty ?? 1}`).join('、') || '（沒有）' : JSON.stringify(v)) : String(v);

export function DiffTable({ diff }) {
  if (!diff.length) return <p className="mute">沒有差異。</p>;
  return <table className="data diff"><thead><tr><th>欄位</th><th>原本</th><th>改成</th></tr></thead>
    <tbody>{diff.map(d => <tr key={d.key}><td>{d.label}</td><td className="from">{show(d.from)}</td><td className="to">{show(d.to)}</td></tr>)}</tbody></table>;
}

export function PartVersions({ part, onChanged }) {
  const vs = part.versions || [], [a, setA] = useState(''), [b, setB] = useState(''), [diff, setDiff] = useState(null), [msg, setMsg] = useState(''), [open, setOpen] = useState(null);
  const opts = vs.map(v => [String(v.version), `v${v.version}　${v.at.slice(0, 10)}${v.by ? `　${v.by}` : ''}`]);
  const compare = () => api.partVersions(part.id, a, b).then(r => setDiff(r.diff)).catch(e => setMsg('✗ ' + e.message));
  const labels = v => v.changed.map(k => k.startsWith('attrs.') ? k.slice(6) : ({ name: '名稱', brand: '廠牌', model: '型號', spec: '規格', unit: '單位', kind: '種類', price_mode: '模組單價', model_params: '3D 參數', price: '參考單價', components: '組成' })[k] || k).join('、');
  return <section className="card"><h3>版本紀錄<span className="chip">v{part.version}</span></h3>
    <p className="mute hint">影響選型或成本的欄位（名稱、廠牌、型號、規格、規格欄位、單位、參考單價、模組組成…）儲存就升一版；備註、標籤、分類不升版。{part.boms?.length > 0 && <>專案 {part.boms.join('、')} 的 BOM 引用這個元件，它們鎖定使用當時的版本，新版要在成本表上升級才會帶入。</>}</p>
    {part.childUpdates?.length > 0 && <div className="notice warn">子件有新版：{part.childUpdates.map(c => `${c.code}（v${c.from} → v${c.to}）`).join('、')}。模組不會自己跟著變，
      <button type="button" onClick={() => api.refreshModule(part.id).then(onChanged).catch(e => setMsg('✗ ' + e.message))}>更新模組</button> 之後模組升一版、記下子件的新版。</div>}
    <div className="scroll"><table className="data click"><thead><tr><th>版本</th><th>時間</th><th>誰</th><th>改了什麼</th></tr></thead><tbody>
      {vs.map(v => [<tr key={v.version} tabIndex={0} onClick={() => setOpen(open === v.version ? null : v.version)}>
        <td><b>v{v.version}</b>{v.version === part.version && <span className="chip ok">目前</span>}</td><td className="mute nowrap">{new Date(v.at).toLocaleString()}</td><td>{v.by || <span className="mute">—</span>}</td>
        <td>{v.note || labels(v) || <span className="mute">—</span>}</td></tr>,
      open === v.version && v.diff.length > 0 && <tr key={`d${v.version}`}><td colSpan={4}><DiffTable diff={v.diff} /></td></tr>])}
    </tbody></table></div>
    {vs.length > 1 && <div className="bar"><span>比較</span><Select value={a} onChange={setA} options={[['', '選版本'], ...opts]} /><span>和</span>
      <Select value={b} onChange={setB} options={[['', '選版本'], ...opts]} /><button type="button" disabled={!a || !b || a === b} onClick={compare}>比較</button></div>}
    {diff && <DiffTable diff={diff} />}
    {msg && <div className="bad">{msg}</div>}
  </section>;
}
