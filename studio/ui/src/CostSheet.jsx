// 專案的成本表（評估平台 Q3）：BOM＋即時計算。元件的行鎖定使用當時的版本，元件更新不會改變這裡的金額；
// 有新版時上方提示，可以看差異、逐行或全部升級（升級前自動留快照）。另外有費率設定、快照與比較、xlsx 匯出。
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Select, ConfirmButton } from './fields.jsx';
import { PartPicker } from './PartLinks.jsx';
import { DiffTable } from './PartVersions.jsx';

const nt = v => v == null ? '—' : `NT$ ${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const pct = v => +(v * 100).toFixed(4);
const NATURE = { equipment: '設備與材料', labor: '工程人日', option: '選配' };
const SOURCE = { version: '元件版本', override: '自填單價', custom: '客製件', labor: '人日費率', 'labor-override': '自填人日單價' };
const FLAG = { estimate: '估價（C 級）', expired: '報價過期', pending: '元件待確認', noPrice: '沒有單價', noFx: '沒有匯率', noGrade: '沒填等級（當 C）', partialSum: '模組加總不完整' };
const BLANK = { kind: 'part', part: null, line: '', section: '', grp: '', nature: 'equipment', labor: 'eng', name: '', spec: '', model: '', reason: '', qty: '1', unit: '', unit_price: '', currency: 'TWD', grade: '' };

// 新增或編輯一行：元件（挑選）、工程人日、客製件
function ItemForm({ item, onSave, onCancel }) {
  const [f, setF] = useState(() => item ? { ...BLANK, ...item, kind: item.labor ? 'labor' : item.part_id ? 'part' : 'custom', part: item.part_id ? { id: item.part_id, code: item.code, name: item.name } : null,
    qty: String(item.qty), unit_price: item.source === 'version' || item.source === 'labor' ? '' : String(item.price ?? ''), grade: item.flags?.includes('noGrade') ? '' : item.grade } : BLANK);
  const [msg, setMsg] = useState('');
  const set = (k, v) => { setMsg(''); setF(x => ({ ...x, [k]: v })); };
  async function save() {
    const v = { line: f.line, section: f.section, grp: f.grp, nature: f.kind === 'labor' ? 'labor' : f.nature, name: f.name, spec: f.spec, model: f.model, reason: f.reason, qty: f.qty, unit: f.unit,
      unit_price: f.unit_price === '' ? null : f.unit_price, currency: f.currency, grade: f.grade, labor: f.kind === 'labor' ? f.labor : '' };
    if (!item && f.kind === 'part') { if (!f.part) { setMsg('✗ 先挑一個元件'); return; } v.part = f.part.id; }
    try { await onSave(v); } catch (e) { setMsg('✗ ' + e.message); }
  }
  const field = (k, label, props = {}) => <label style={props.style}><span>{label}</span><input value={f[k] ?? ''} onChange={e => set(k, e.target.value)} {...props} /></label>;
  return <section className="card form bom-form"><h3>{item ? `編輯 ${item.line || '這一行'}` : '加一行'}</h3>
    {!item && <div className="bar"><Select value={f.kind} onChange={v => set('kind', v)} options={[['part', '元件（從元件庫挑，鎖定目前版本）'], ['labor', '工程人日'], ['custom', '客製件（加工件、治具，自己填單價）']]} />
      {f.kind === 'part' && (f.part ? <span><code className="p-code">{f.part.code}</code> {f.part.name} <button type="button" onClick={() => set('part', null)}>換一個</button></span>
        : <PartPicker onPick={p => setF(x => ({ ...x, part: p, unit: x.unit || p.unit }))} />)}</div>}
    <div className="row">
      {field('line', '編號', { placeholder: '1-01', style: { flex: '0 1 90px', minWidth: 80 } })}
      {field('section', '子系統', { placeholder: '1 視覺' })}
      {field('grp', '分部（選填）', { placeholder: '第 1 部分' })}
      {f.kind !== 'labor' && <label><span>性質</span><Select value={f.nature} onChange={v => set('nature', v)} options={[['equipment', '設備與材料'], ['option', '選配']]} /></label>}
      {f.kind === 'labor' && <label><span>人日</span><Select value={f.labor} onChange={v => set('labor', v)} options={[['eng', '工程師（工程費率）'], ['tech', '技術員（技術費率）']]} /></label>}
    </div>
    <div className="row">
      {field('name', f.kind === 'part' ? '項目名稱（留白用元件名稱）' : '項目名稱 *')}
      {field('spec', f.kind === 'part' ? '規格要求（留白用元件規格）' : '規格要求')}
      {f.kind !== 'labor' && field('model', f.kind === 'part' ? '建議選型（留白用廠牌型號）' : '建議選型')}
    </div>
    <div className="row">
      {field('qty', '數量 *', { type: 'number', min: 0, step: 'any', style: { flex: '0 1 100px', minWidth: 80 } })}
      {field('unit', '單位', { placeholder: f.kind === 'labor' ? '人日' : '台、組、式', style: { flex: '0 1 100px', minWidth: 80 } })}
      {field('unit_price', f.kind === 'part' ? '單價（留白用元件版本的參考單價）' : f.kind === 'labor' ? '單價（留白用人日費率）' : '單價 *', { type: 'number', min: 0, step: 'any' })}
      <label style={{ flex: '0 1 100px', minWidth: 90 }}><span>幣別</span><Select value={f.currency} onChange={v => set('currency', v)} options={['TWD', 'USD', 'JPY', 'EUR', 'CNY'].map(c => [c, c])} /></label>
      <label style={{ flex: '0 1 150px', minWidth: 130 }}><span>等級</span><Select value={f.grade} onChange={v => set('grade', v)} options={[['', f.kind === 'part' ? '（用元件的）' : '—'], ['A', 'A ±10%'], ['B', 'B ±20%'], ['C', 'C ±30%']]} /></label>
    </div>
    {field('reason', '選型理由')}
    <div className="bar"><button type="button" className="primary" onClick={save}>{item ? '儲存' : '加入'}</button><button type="button" onClick={onCancel}>取消</button><span className="bad">{msg}</span></div>
  </section>;
}

function Summary({ s, title }) {
  return <div className="cost-sum">{title && <h4>{title}</h4>}
    <div className="facts">
      <div><b>{nt(s.equipment)}</b><span>設備與材料</span></div><div><b>{nt(s.labor)}</b><span>工程人日（{s.laborDays} 人日）</span></div><div><b>{nt(s.option)}</b><span>已選選配</span></div>
      <div><b>{nt(s.subtotal)}</b><span>小計（未稅）</span></div><div><b>{nt(s.contingency)}</b><span>預備費</span></div>
      <div className="main"><b>{nt(s.total)}</b><span>含預備費，未稅（預算主數字）</span></div>
      <div><b>{nt(s.low)} ～ {nt(s.high)}</b><span>下限～上限（逐行幅度加總）</span></div><div><b>{nt(s.taxed)}</b><span>含稅</span></div>
    </div></div>;
}

export function CostSheet({ id, canEdit }) {
  const [d, setD] = useState(undefined), [msg, setMsg] = useState(''), [form, setForm] = useState(null), [nv, setNv] = useState(null), [pick, setPick] = useState(new Set());
  const [settings, setSettings] = useState(null), [snapName, setSnapName] = useState(''), [view, setView] = useState(null);
  const load = useCallback(() => api.bom(id).then(r => setD(r.bom ? r : null)).catch(e => setMsg('✗ ' + e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn, done = '') => { setMsg(''); try { await fn(); await load(); if (done) setMsg('✓ ' + done); } catch (e) { setMsg('✗ ' + e.message); } };
  if (d === undefined) return <p className="mute">載入中…</p>;
  const lines = d?.lines || [], s = d?.summary;
  const sections = [...new Set(lines.map(l => l.section))];
  const loadNew = () => api.bomNewVersions(id).then(r => { setNv(r.items); setPick(new Set(r.items.map(x => x.id))); }).catch(e => setMsg('✗ ' + e.message));

  return <div className="cost">
    {msg && <div className={`notice ${msg.startsWith('✗') ? 'bad' : 'ok'}`}>{msg}</div>}
    {!d ? <section className="card"><h3>成本表</h3><p className="mute">這個專案還沒有 BOM。規劃角色的元件表（Q6）會自動帶進來；也可以在這裡一行一行加。</p>
      {canEdit && !form && <div className="bar"><button className="primary" onClick={() => setForm('new')}>＋ 加第一行</button></div>}</section> : <>
      <section className="card">
        <div className="chart-h"><div><h3>成本摘要<span className="chip">{d.bom.name}</span></h3>
          <p className="mute hint">金額由平台依 BOM 即時計算（新台幣；外幣依匯率日期 {d.settings.fxDate} 的匯率）。元件的行鎖定版本，元件庫改價不會改變這裡，有新版時會提示。</p></div>
          <div className="bar" style={{ margin: 0 }}><a className="btn" href={`/api/projects/${encodeURIComponent(id)}/bom/xlsx`} download>⤓ 匯出 xlsx</a></div></div>
        <Summary s={s} />
        {s.groups.length > 1 && <div className="scroll"><table className="data"><thead><tr><th>分部</th><th className="num">設備與材料</th><th className="num">工程人日</th><th className="num">選配</th><th className="num">小計</th><th className="num">含預備費</th><th className="num">含稅</th></tr></thead>
          <tbody>{s.groups.map(g => <tr key={g.grp}><td>{g.grp}</td>{['equipment', 'labor', 'option', 'subtotal', 'total', 'taxed'].map(k => <td key={k} className="num">{nt(g[k])}</td>)}</tr>)}</tbody></table></div>}
        <div className="bar">{Object.entries(s.flags).filter(([k, n]) => n && k !== 'newer').map(([k, n]) => <span key={k} className={`chip ${k === 'estimate' ? '' : 'warn'}`}>{({ estimate: '估價', expired: '報價過期', pending: '元件待確認', noPrice: '沒有單價', noFx: '沒有匯率' })[k]} {n} 行</span>)}</div>
      </section>

      {s.flags.newer > 0 && <section className="card notice-card">
        <div className="bar" style={{ margin: 0 }}><b>{s.flags.newer} 行的元件有新版</b><span className="mute">目前的金額用的是當初鎖定的版本；看過差異再決定要不要升級（升級前會自動留快照）。</span>
          <span className="grow" /><button onClick={() => nv ? setNv(null) : loadNew()}>{nv ? '收起' : '比較差異'}</button></div>
        {nv && <>
          <div className="scroll"><table className="data"><thead><tr><th /><th>編號</th><th>元件</th><th>版本</th><th className="num">單價</th><th className="num">小計差額</th><th>改了什麼</th></tr></thead><tbody>
            {nv.map(n => <tr key={n.id}><td><input type="checkbox" aria-label={`升級 ${n.line}`} checked={pick.has(n.id)} disabled={!canEdit} onChange={e => setPick(p => { const x = new Set(p); if (e.target.checked) x.add(n.id); else x.delete(n.id); return x; })} /></td>
              <td>{n.line}</td><td><code className="p-code">{n.code}</code> {n.name}</td><td>v{n.from} → v{n.to}</td><td className="num">{nt(n.from_price)} → {nt(n.to_price)}</td>
              <td className={`num ${n.delta > 0 ? 'bad' : n.delta < 0 ? 'ok' : ''}`}>{n.delta > 0 ? '+' : ''}{nt(n.delta)}</td><td><details><summary>{n.diff.length} 項</summary><DiffTable diff={n.diff} /></details></td></tr>)}
          </tbody></table></div>
          {canEdit && <div className="bar"><button className="primary" disabled={!pick.size} onClick={() => act(() => api.bomUpgrade(id, [...pick]).then(() => setNv(null)), '已升級，升級前的狀態留成快照')}>升級勾選的 {pick.size} 行</button>
            <button onClick={() => act(() => api.bomUpgrade(id, 'all').then(() => setNv(null)), '已全部升級，升級前的狀態留成快照')}>全部升級</button></div>}
        </>}
      </section>}

      <section className="card"><h3>明細<span className="chip">{lines.length} 行</span></h3>
        <div className="scroll"><table className="data bom"><thead><tr><th>編號</th><th>項目／規格／選型</th><th className="num">數量</th><th className="num">單價</th><th className="num">小計</th><th>等級</th><th className="num">下限～上限</th><th /></tr></thead>
          <tbody>{sections.map(sec => [<tr className="cat" key={`s:${sec}`}><td colSpan={8}>{sec || '（沒有子系統）'}<span className="n">{nt(lines.filter(l => l.section === sec).reduce((a, l) => a + l.subtotal, 0))}</span></td></tr>,
            ...lines.filter(l => l.section === sec).map(l => <tr key={l.id} className={l.qty === 0 ? 'zero' : ''}>
              <td className="nowrap">{l.line}{l.nature !== 'equipment' && <div><span className="chip">{NATURE[l.nature]}</span></div>}</td>
              <td><div><b>{l.name}</b>{l.code && <> <code className="p-code">{l.code}</code> <span className="chip" title={l.newer ? `鎖定 v${l.part_version}，元件庫已經是 v${l.latest_version}` : '鎖定的版本'}>v{l.part_version}{l.newer ? ` → v${l.latest_version}` : ''}</span></>}</div>
                {(l.spec || l.model) && <div className="mute">{[l.spec, l.model].filter(Boolean).join('｜')}</div>}
                {l.flags.filter(f => f !== 'estimate').map(f => <span key={f} className="chip warn">{FLAG[f]}</span>)}</td>
              <td className="num nowrap">{l.qty} {l.unit}</td>
              <td className="num nowrap" title={SOURCE[l.source]}>{nt(l.unit_twd)}{l.currency !== 'TWD' && l.price != null && <div className="mute">{l.currency} {l.price.toLocaleString('en-US')} × {l.fx}</div>}<div className="mute">{SOURCE[l.source]}</div></td>
              <td className="num"><b>{nt(l.subtotal)}</b></td><td>{l.grade}</td><td className="num mute nowrap">{nt(l.low)}～{nt(l.high)}</td>
              <td className="ops">{canEdit && <><button type="button" onClick={() => setForm(l)}>編輯</button><ConfirmButton onConfirm={() => act(() => api.deleteBomItem(id, l.id))} /></>}</td></tr>)])}</tbody></table></div>
        {canEdit && !form && <div className="bar"><button onClick={() => setForm('new')}>＋ 加一行</button></div>}
      </section>
    </>}
    {form && <ItemForm item={form === 'new' ? null : form} onCancel={() => setForm(null)}
      onSave={v => (form === 'new' ? api.addBomItem(id, v) : api.updateBomItem(id, form.id, v)).then(() => { setForm(null); return load(); })} />}

    {d && <section className="card form"><h3>費率與匯率</h3>
      <p className="mute hint">建立 BOM 時從系統設定帶入，之後這個專案自己的；改了立刻重算。外幣用「匯率日期」那天以前最近的匯率（匯率在「設定」頁由管理者維護）。</p>
      {(() => { const st = settings || d.settings, set = (k, v) => setSettings({ ...st, [k]: v }); return <>
        <div className="row">
          {[['engRate', '工程人日費率'], ['techRate', '技術人日費率']].map(([k, label]) => <label key={k}><span>{label}</span><input type="number" min="0" disabled={!canEdit} value={st[k]} onChange={e => set(k, e.target.value)} /></label>)}
          {[['contingency', '預備金（%）'], ['tax', '稅率（%）']].map(([k, label]) => <label key={k}><span>{label}</span><input type="number" min="0" step="any" disabled={!canEdit} value={pct(st[k])} onChange={e => set(k, Number(e.target.value) / 100)} /></label>)}
          <label><span>匯率日期</span><input type="date" disabled={!canEdit} value={st.fxDate} onChange={e => set('fxDate', e.target.value)} /></label>
        </div>
        <div className="row">{['A', 'B', 'C'].map(g => <label key={g}><span>等級 {g} 幅度（±%）</span><input type="number" min="0" step="any" disabled={!canEdit} value={pct(st.gradeRange[g])}
          onChange={e => set('gradeRange', { ...st.gradeRange, [g]: Number(e.target.value) / 100 })} /></label>)}</div>
        {canEdit && settings && <div className="bar"><button className="primary" onClick={() => act(() => api.bomSettings(id, settings).then(() => setSettings(null)), '已重算')}>儲存並重算</button><button onClick={() => setSettings(null)}>復原</button></div>}
      </>; })()}
    </section>}

    {d && <section className="card"><h3>快照<span className="chip">{d.snapshots.length}</span></h3>
      <p className="mute hint">快照凍結當時的明細與金額（例如報價給客戶前），之後不能改，可以和目前的成本表比較。升級元件版本前也會自動留一份。</p>
      {canEdit && <div className="bar"><input value={snapName} onChange={e => setSnapName(e.target.value)} placeholder="快照名稱，例如「報價 v1 給客戶」" aria-label="快照名稱" />
        <button onClick={() => act(() => api.bomSnapshot(id, { name: snapName }).then(() => setSnapName('')), '已保存快照')}>儲存快照</button></div>}
      {d.snapshots.length > 0 && <table className="data"><tbody>{d.snapshots.map(x => <tr key={x.id}><td><b>{x.name}</b> <span className="mute">{x.note}</span></td><td className="mute nowrap">{new Date(x.created_at).toLocaleString()}{x.created_by ? `　${x.created_by}` : ''}</td>
        <td className="ops"><button onClick={() => api.bomCompare(id, x.id).then(r => setView(r)).catch(e => setMsg('✗ ' + e.message))}>和目前比較</button></td></tr>)}</tbody></table>}
      {view && <div className="cost-compare"><div className="bar"><b>{view.snapshot.name}</b> → 目前<span className="grow" /><button onClick={() => setView(null)}>收起</button></div>
        <p>小計 {nt(view.from.subtotal)} → {nt(view.to.subtotal)}（{view.totals.subtotal >= 0 ? '+' : ''}{nt(view.totals.subtotal)}）；含預備費 {nt(view.from.total)} → {nt(view.to.total)}；含稅 {nt(view.from.taxed)} → {nt(view.to.taxed)}</p>
        {view.rows.length ? <table className="data"><thead><tr><th>編號</th><th>項目</th><th>變化</th><th className="num">原本</th><th className="num">現在</th><th className="num">差額</th></tr></thead><tbody>
          {view.rows.map(r => <tr key={r.line}><td>{r.line}</td><td>{r.name}</td><td>{({ added: '新增', removed: '刪除', changed: '改變' })[r.change]}{r.version && r.version[0] !== r.version[1] ? `（v${r.version[0]} → v${r.version[1]}）` : ''}</td>
            <td className="num">{nt(r.from)}</td><td className="num">{nt(r.to)}</td><td className="num">{r.delta >= 0 ? '+' : ''}{nt(r.delta)}</td></tr>)}</tbody></table> : <p className="mute">明細沒有差異。</p>}</div>}
      {d.upgrades.length > 0 && <details><summary>升級紀錄（{d.upgrades.length}）</summary><table className="data"><tbody>{d.upgrades.map(u => <tr key={u.id}><td>{u.line}</td><td><code className="p-code">{u.code}</code></td><td>v{u.from_version} → v{u.to_version}</td>
        <td className="num">{nt(u.from_price)} → {nt(u.to_price)}</td><td className="mute">{u.by}</td><td className="mute nowrap">{new Date(u.at).toLocaleString()}</td></tr>)}</tbody></table></details>}
    </section>}
  </div>;
}
