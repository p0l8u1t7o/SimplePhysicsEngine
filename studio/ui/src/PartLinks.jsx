// 元件的關聯件與模組（評估平台 Q2）：模組的組成（子件、數量、子件加總單價）、配件、替代、相容；
// 另外列出「用在哪些模組」「是哪些元件的配件」。點元件編號可以開那個元件。
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Select, ConfirmButton } from './fields.jsx';

const money = (v, c = 'TWD') => v == null ? '—' : `${c === 'TWD' ? 'NT$' : c} ${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

// 挑元件：打關鍵字（編號、名稱、廠牌、型號…）列出前幾個，點一下選定
export function PartPicker({ onPick, exclude = [], placeholder = '搜尋元件編號、名稱、型號…' }) {
  const [q, setQ] = useState(''), [hits, setHits] = useState([]);
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(() => api.parts({ q, limit: 8 }).then(d => setHits(d.parts.filter(p => !exclude.includes(p.id)))).catch(() => setHits([])), 200);
    return () => clearTimeout(t);
  }, [q]);     // eslint-disable-line
  return <div className="picker">
    <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} aria-label="搜尋要加的元件" />
    {hits.length > 0 && <ul className="picker-list">{hits.map(p => <li key={p.id}><button type="button" onClick={() => { onPick(p); setQ(''); setHits([]); }}>
      <code className="p-code">{p.code}</code> {p.name} <span className="mute">{[p.brand, p.model].filter(Boolean).join(' ')}</span></button></li>)}</ul>}
  </div>;
}

const Code = ({ r, onOpen }) => <button type="button" className="linklike" title="開啟這個元件" onClick={() => onOpen(r.other_id)}><code className="p-code">{r.code}</code></button>;

export function PartLinks({ part, rels, onChanged, onOpen }) {
  const [msg, setMsg] = useState(''), [rel, setRel] = useState('accessory');
  const L = part.links, self = [part.id];
  const act = async fn => { setMsg(''); try { await fn(); await onChanged(); } catch (e) { setMsg('✗ ' + e.message); } };
  const add = (p, r, qty) => act(() => api.addLink(part.id, { related: p.id, rel: r, qty }));
  const qtyInput = l => <input type="number" min="0" step="any" defaultValue={l.qty ?? ''} style={{ width: 70 }} aria-label="數量"
    onBlur={e => { if (String(l.qty ?? '') !== e.target.value) act(() => api.updateLink(l.id, { qty: e.target.value })); }} />;
  const remove = l => <ConfirmButton label="移除" confirmLabel="確定移除？" onConfirm={() => act(() => api.deleteLink(l.id))} />;
  const others = [...L.accessories.map(l => ({ ...l, label: rels.accessory })), ...L.alternatives.map(l => ({ ...l, label: rels.alternative })), ...L.compatible.map(l => ({ ...l, label: rels.compatible }))];
  const sum = part.sum;

  return <>
    {part.kind === 'module' && <section className="card"><h3>模組的組成<span className="chip">{L.components.length}</span></h3>
      <p className="mute hint">{part.price_mode === 'sum' ? '單價用子件加總（子件的參考單價 × 數量，只加新台幣）。' : '單價用這個模組自己的價格紀錄（例如供應商的整組報價）；下面的加總只供對照。'}子件可以也是模組（多層），但不能形成循環。</p>
      {L.components.length > 0 && <div className="scroll"><table className="data"><thead><tr><th>編號</th><th>子件</th><th className="num">數量</th><th className="num">單價</th><th className="num">小計</th><th /></tr></thead><tbody>
        {L.components.map(l => <tr key={l.id}><td><Code r={l} onOpen={onOpen} /></td><td>{l.name}{l.kind === 'module' && <span className="chip">模組</span>} <span className="mute">{[l.brand, l.model].filter(Boolean).join(' ')}</span></td>
          <td className="num">{qtyInput(l)} {l.unit}</td><td className="num">{money(l.unit_price, l.currency)}</td>
          <td className="num">{l.unit_price == null ? '—' : money(l.unit_price * (l.qty ?? 1), l.currency)}</td><td className="ops">{remove(l)}</td></tr>)}
      </tbody></table></div>}
      {sum && <p className="sum">子件加總：<b>{money(sum.total)}</b>
        {sum.missing.length > 0 && <span className="warn">　沒有單價：{sum.missing.join('、')}</span>}
        {sum.foreign.length > 0 && <span className="warn">　外幣沒加進去：{sum.foreign.join('、')}</span>}</p>}
      <div className="bar"><span>加入子件</span><PartPicker exclude={[...self, ...L.components.map(l => l.other_id)]} onPick={p => add(p, 'component', 1)} /></div>
    </section>}
    <section className="card"><h3>關聯件<span className="chip">{others.length}</span></h3>
      <p className="mute hint">配件：選這個元件時通常要一起買的；替代：可以互換的選型；相容：接口或規格相容（例如鏡頭接口、控制器與手臂）。替代與相容是雙向的，在任一邊加都可以。</p>
      {others.length > 0 && <div className="scroll"><table className="data"><tbody>{others.map(l => <tr key={l.id}>
        <td><span className="chip">{l.label}</span></td><td><Code r={l} onOpen={onOpen} /></td><td>{l.name} <span className="mute">{[l.brand, l.model].filter(Boolean).join(' ')}</span></td>
        <td className="num">{l.rel === 'accessory' ? <>{qtyInput(l)} {l.unit}</> : ''}</td><td className="mute">{l.note}</td><td className="num">{money(l.unit_price, l.currency)}</td><td className="ops">{remove(l)}</td></tr>)}</tbody></table></div>}
      <div className="bar"><Select value={rel} onChange={setRel} options={Object.entries(rels).filter(([k]) => k !== 'component')} />
        <PartPicker exclude={self} onPick={p => add(p, rel, rel === 'accessory' ? 1 : undefined)} /></div>
      {(L.usedIn.length > 0 || L.accessoryOf.length > 0) && <p className="mute">
        {L.usedIn.length > 0 && <>用在這些模組：{L.usedIn.map(l => <span key={l.id}><Code r={l} onOpen={onOpen} /> {l.name}（×{l.qty ?? 1}）　</span>)}</>}
        {L.accessoryOf.length > 0 && <>是這些元件的配件：{L.accessoryOf.map(l => <span key={l.id}><Code r={l} onOpen={onOpen} /> {l.name}　</span>)}</>}</p>}
      {msg && <div className="bad">{msg}</div>}
    </section>
  </>;
}
