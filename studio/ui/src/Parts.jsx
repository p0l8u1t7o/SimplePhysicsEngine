// 元件資料庫：左邊樹狀選單（群組 → 類別），右邊清單；查詢、新增、編輯、刪除元件；每個元件底下有多筆價格紀錄與專案使用紀錄；另一個分頁管理供應商。
// 資料在本機的 SQLite 檔（studio/data/parts.db，不進版控），各站做設計、選型與成本表時由這裡查。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, sameHost } from './api.js';
import { Icon } from './icons.jsx';
import { Select, ConfirmButton } from './fields.jsx';

const CURRENCIES = ['TWD', 'USD', 'JPY', 'EUR', 'CNY'];
const UNCATEGORIZED = '（未分類）', UNGROUPED = '（未分組）';
const today = () => new Date().toLocaleDateString('sv');
export const money = (v, currency = 'TWD') => v == null ? '' : `${currency === 'TWD' ? 'NT$' : currency} ${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const PENDING = '待確認';
const size = n => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const BLANK_PART = { status: '', model_id: '', grp: '', category: '', name: '', brand: '', model: '', spec: '', unit: '', selection_note: '', alternatives: '', tags: '', url: '', note: '' };

// 可以逐列編輯的表格（價格紀錄、使用紀錄、供應商共用）。
// columns：{ key, label, type: text｜number｜date｜select, options, list（datalist 的 id）, show(row)（顯示用）, cls }
function RecordTable({ columns, rows, blank, onSave, onDelete, addLabel, empty, deleteTitle }) {
  const [edit, setEdit] = useState(null);      // 正在編輯的列；沒有 id 是新增
  const [error, setError] = useState('');
  const begin = row => { setError(''); setEdit(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v ?? '']))); };
  const act = async fn => { setError(''); try { await fn(); setEdit(null); } catch (e) { setError(e.message); } };
  const input = c => c.type === 'select'
    ? <Select value={String(edit[c.key] ?? '')} onChange={v => setEdit(x => ({ ...x, [c.key]: v }))} options={c.options} />
    : <input type={c.type || 'text'} step={c.type === 'number' ? 'any' : undefined} list={c.list} value={edit[c.key] ?? ''} placeholder={c.placeholder} aria-label={c.label}
        onChange={e => setEdit(x => ({ ...x, [c.key]: e.target.value }))}
        onKeyDown={e => { if (e.key === 'Enter') act(() => onSave(edit)); else if (e.key === 'Escape') { e.stopPropagation(); setEdit(null); } }} />;
  const editRow = edit && <tr key="edit" className="editing">{columns.map(c => <td key={c.key}>{input(c)}</td>)}
    <td className="ops"><button type="button" className="primary" onClick={() => act(() => onSave(edit))}>儲存</button><button type="button" onClick={() => setEdit(null)}>取消</button></td></tr>;
  return <>
    <div className="scroll"><table className="records"><thead><tr>{columns.map(c => <th key={c.key}>{c.label}</th>)}<th /></tr></thead><tbody>
      {rows.map(r => edit?.id === r.id ? editRow : <tr key={r.id}>{columns.map(c => <td key={c.key} className={c.cls}>{c.show ? c.show(r) : r[c.key]}</td>)}
        <td className="ops"><button type="button" onClick={() => begin(r)}>編輯</button><ConfirmButton title={deleteTitle?.(r)} onConfirm={() => act(() => onDelete(r.id))} /></td></tr>)}
      {edit && !edit.id && editRow}
      {!rows.length && !edit && <tr><td colSpan={columns.length + 1} className="mute">{empty}</td></tr>}
    </tbody></table></div>
    {error && <div className="notice bad">{error}</div>}
    {!edit && <div className="bar"><button type="button" onClick={() => begin(blank)}>＋ {addLabel}</button></div>}
  </>;
}

// 單一元件：基本資料、自由規格欄位、價格紀錄、使用紀錄
function PartEditor({ id, facets, suppliers, models, projectNames, onClose, onChanged }) {
  const [part, setPart] = useState(null);       // 伺服器上的內容（新增時是 null）
  const [form, setForm] = useState(BLANK_PART);
  const [attrs, setAttrs] = useState([]);       // [[名稱, 值], …]
  const [msg, setMsg] = useState('');
  const fill = p => { setPart(p); setForm(Object.fromEntries(Object.keys(BLANK_PART).map(k => [k, p[k] ?? '']))); setAttrs(Object.entries(p.attrs || {})); };
  const load = useCallback(() => api.part(id).then(fill).catch(e => setMsg('✗ ' + e.message)), [id]);
  useEffect(() => { if (id === 'new') { setPart(null); setForm(BLANK_PART); setAttrs([]); } else load(); }, [id, load]);
  const set = (k, v) => { setMsg(''); setForm(f => ({ ...f, [k]: v })); };
  const setAttr = (i, j, v) => { setMsg(''); setAttrs(a => a.map((x, n) => n === i ? (j ? [x[0], v] : [v, x[1]]) : x)); };
  const dirty = useMemo(() => !part ? JSON.stringify(form) !== JSON.stringify(BLANK_PART) || attrs.length > 0
    : Object.keys(BLANK_PART).some(k => (part[k] ?? '') !== form[k]) || JSON.stringify(Object.entries(part.attrs || {})) !== JSON.stringify(attrs), [part, form, attrs]);
  useEffect(() => { const f = e => { if (e.key === 'Escape' && !dirty) onClose(); }; addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, [dirty, onClose]);

  async function save(e) {
    e?.preventDefault();
    try { const p = await api.savePart(part?.id, { ...form, attrs: Object.fromEntries(attrs) }); fill(p); setMsg('✓ 已儲存'); onChanged(p.id); }
    catch (err) { setMsg('✗ ' + err.message); }
  }
  const record = kind => ({
    onSave: async row => { await api.saveRecord(kind, part.id, row.id, row); await load(); onChanged(part.id); },
    onDelete: async rid => { await api.deleteRecord(kind, rid); await load(); onChanged(part.id); },
  });
  const supplierOptions = [['', '（未指定）'], ...suppliers.map(s => [String(s.id), s.name])];
  const expired = d => d && d < today();
  const priceColumns = [
    { key: 'quoted_on', label: '報價日', type: 'date' },
    { key: 'unit_price', label: '單價', type: 'number', cls: 'num', show: r => money(r.unit_price, r.currency) },
    { key: 'currency', label: '幣別', type: 'select', options: CURRENCIES.map(c => [c, c]) },
    { key: 'grade', label: '等級', type: 'select', options: [['', '—'], ['A', 'A 型錄或近期採購價'], ['B', 'B 同級品預算價'], ['C', 'C 規格未定或自製']], show: r => r.grade || '—' },
    { key: 'supplier_id', label: '供應商', type: 'select', options: supplierOptions, show: r => r.supplier || '' },
    { key: 'source', label: '來源／報價單號', placeholder: '報價單號、型錄、成本表' },
    { key: 'valid_until', label: '有效期限', type: 'date', show: r => r.valid_until && <span className={expired(r.valid_until) ? 'warn' : ''}>{r.valid_until}{expired(r.valid_until) ? '（已過期）' : ''}</span> },
    { key: 'note', label: '備註' },
  ];
  const usageColumns = [
    { key: 'project', label: '專案', list: 'parts-projects' }, { key: 'source', label: '來源檔', placeholder: 'cost-estimate.xlsx' }, { key: 'item_code', label: '編號', placeholder: '1-01' },
    { key: 'subsystem', label: '子系統' }, { key: 'qty', label: '數量', type: 'number', cls: 'num' }, { key: 'reason', label: '選型理由' }, { key: 'note', label: '備註' },
  ];

  return (
    <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget && !dirty) onClose(); }}>
      <div className="panel" role="dialog" aria-label="元件">
        <div className="head">
          <div><h2>{part ? part.name : '新增元件'}</h2>{part && <div className="meta"><code className="p-code">{part.code}</code>{part.status && <span className="chip warn">{part.status}</span>}<span className="mute">更新於 {part.updated_at.slice(0, 10)}</span></div>}</div>
          <div className="bar" style={{ margin: 0 }}>
            {part?.status === PENDING && <button type="button" className="primary" title="代理提案帶進來的新元件：看過沒問題就按這裡" onClick={() => api.savePart(part.id, { ...part, status: '' }).then(p => { fill(p); setMsg('✓ 已確認'); onChanged(p.id); }).catch(e => setMsg('✗ ' + e.message))}>✓ 確認這個元件</button>}
            <button type="button" onClick={onClose}>✕ 關閉</button>
          </div>
        </div>
        <form onSubmit={save}>
          <section className="card form"><h3>基本資料</h3>
            <div className="row">
              <label><span>名稱 *</span><input value={form.name} onChange={e => set('name', e.target.value)} placeholder="例如 工業相機" autoFocus={id === 'new'} /></label>
              <label><span>類別</span><input value={form.category} onChange={e => set('category', e.target.value)} list="parts-categories" placeholder="例如 相機與讀碼" /></label>
              <label><span>群組</span><input value={form.grp} onChange={e => set('grp', e.target.value)} list="parts-groups" placeholder="留白就依類別帶入" /></label>
            </div>
            <div className="row">
              <label><span>廠牌</span><input value={form.brand} onChange={e => set('brand', e.target.value)} list="parts-brands" /></label>
              <label style={{ flex: 2 }}><span>型號／建議選型</span><input value={form.model} onChange={e => set('model', e.target.value)} /></label>
              <label style={{ flex: '0 1 110px', minWidth: 90 }}><span>單位</span><input value={form.unit} onChange={e => set('unit', e.target.value)} list="parts-units" placeholder="台、組、式" /></label>
            </div>
            <label><span>3D 模型（core 共用模型）</span>
              <Select value={form.model_id} onChange={v => set('model_id', v)} options={[['', '（沒有）'], ...models.models.map(m => [m.id, `${m.category}｜${m.name}`]), ...(form.model_id && !models.models.some(m => m.id === form.model_id) ? [[form.model_id, `${form.model_id}（找不到這個模型）`]] : [])]} />
              <small className="mute">選了之後下面會顯示這個模型的 3D 畫面。它和各專案用的是同一份模型程式，模型一改這裡就是新的。</small></label>
            <label><span>規格</span><textarea rows={2} value={form.spec} onChange={e => set('spec', e.target.value)} placeholder="主要規格與需求" /></label>
            <div>
              <div className="lbl">自由規格欄位<small className="mute">依元件種類自訂，例如 解析度、行程、負載、介面</small></div>
              {attrs.map(([k, v], i) => <div className="attr" key={i}>
                <input value={k} onChange={e => setAttr(i, 0, e.target.value)} placeholder="欄位名稱" aria-label="規格欄位名稱" />
                <input value={v} onChange={e => setAttr(i, 1, e.target.value)} placeholder="值" aria-label="規格欄位值" />
                <button type="button" title="移除這個欄位" onClick={() => { setMsg(''); setAttrs(a => a.filter((_, n) => n !== i)); }}>✕</button>
              </div>)}
              <button type="button" onClick={() => setAttrs(a => [...a, ['', '']])}>＋ 規格欄位</button>
            </div>
            <div className="row">
              <label><span>選型備註</span><textarea rows={2} value={form.selection_note} onChange={e => set('selection_note', e.target.value)} placeholder="什麼情況選它、要注意什麼" /></label>
              <label><span>替代方案</span><textarea rows={2} value={form.alternatives} onChange={e => set('alternatives', e.target.value)} /></label>
            </div>
            <div className="row">
              <label><span>標籤</span><input value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="用逗號分隔，例如 自製, 長交期" /></label>
              <label><span>資料連結</span><input value={form.url} onChange={e => set('url', e.target.value)} placeholder="型錄或產品頁網址" /></label>
            </div>
            <label><span>備註</span><textarea rows={2} value={form.note} onChange={e => set('note', e.target.value)} /></label>
            <div className="bar">
              <button className="primary" disabled={!dirty}>{part ? '儲存' : '新增'}</button>
              <span className={msg.startsWith('✗') ? 'bad' : 'ok'}>{msg}</span>
              <span className="grow" />
              {part && <ConfirmButton label="刪除元件" title="連同價格紀錄與使用紀錄一起刪除" onConfirm={() => api.deletePart(part.id).then(() => { onChanged(null); onClose(); }).catch(e => setMsg('✗ ' + e.message))} />}
            </div>
          </section>
        </form>
        {form.model_id && models.models.some(m => m.id === form.model_id) && <section className="card"><h3>3D 顯示<span className="chip">{models.models.find(m => m.id === form.model_id).name}</span></h3>
          <iframe className="frame model" title="3D 模型" src={sameHost(`http://127.0.0.1:${models.catalogPort}/core/catalog/#${form.model_id}`)} key={form.model_id} />
          <p className="mute hint" style={{ margin: '8px 0 0' }}>可以拖曳旋轉、調參數、按「來回動作」看動畫。這是模型目錄頁，左邊的清單可以看其他共用模型。</p>
        </section>}
        {part ? <>
          <section className="card"><h3>附件（CAD 檔、型錄）<span className="chip">{part.files.length}</span></h3>
            <p className="mute hint">匯入的 STEP、IGES、DWG、SLDPRT、PDF 等原始檔存在這台電腦（資料庫旁邊的 <code>parts-files/</code>），可以下載；目前不會把 CAD 轉成 3D 畫面。單一檔案上限 300 MB。</p>
            {part.files.length > 0 && <table className="data"><tbody>{part.files.map(f => <tr key={f.id}>
              <td><Icon name="file" size={15} /> <a href={`/api/parts/${part.id}/files/${f.id}`} download={f.name}>{f.name}</a></td><td className="mute num">{size(f.size)}</td><td className="mute nowrap">{f.added_at.slice(0, 10)}</td>
              <td className="ops"><ConfirmButton onConfirm={() => api.deletePartFile(f.id).then(() => { load(); onChanged(part.id); }).catch(e => setMsg('✗ ' + e.message))} /></td></tr>)}</tbody></table>}
            <div className="bar"><label className="file"><span className="btn">＋ 加入檔案<input type="file" multiple hidden onChange={async e => {
              const list = [...e.target.files]; e.target.value = '';
              try { for (const f of list) { setMsg(`上傳 ${f.name}…`); await api.uploadPartFile(part.id, f); } setMsg('✓ 已上傳'); await load(); onChanged(part.id); } catch (err) { setMsg('✗ ' + err.message); }
            }} /></span></label><span className={msg.startsWith('✗') ? 'bad' : 'mute'}>{/上傳/.test(msg) ? msg : ''}</span></div>
          </section>
          <section className="card"><h3>價格紀錄<span className="chip">{part.prices.length}</span></h3>
            <p className="mute hint">清單上的參考單價取報價日最新的一筆。等級沿用成本表的 A／B／C（幅度 ±10%／±20%／±30%）。</p>
            <RecordTable columns={priceColumns} rows={part.prices} blank={{ quoted_on: today(), unit_price: '', currency: 'TWD', grade: '', supplier_id: '', source: '', valid_until: '', note: '' }}
              addLabel="新增價格" empty="還沒有價格紀錄" {...record('prices')} />
          </section>
          <section className="card"><h3>專案使用紀錄<span className="chip">{part.usages.length}</span></h3>
            <RecordTable columns={usageColumns} rows={part.usages} blank={{ project: '', source: '', item_code: '', subsystem: '', qty: '', reason: '', note: '' }}
              addLabel="新增使用紀錄" empty="還沒有專案用過" {...record('usages')} />
          </section>
        </> : <p className="mute">先新增元件，接著就能加價格紀錄與專案使用紀錄。</p>}
        <datalist id="parts-categories">{facets.categories.filter(c => c.name).map(c => <option key={c.name} value={c.name} />)}</datalist>
        <datalist id="parts-groups">{facets.groups.map(g => <option key={g} value={g} />)}</datalist>
        <datalist id="parts-brands">{facets.brands.map(b => <option key={b} value={b} />)}</datalist>
        <datalist id="parts-units">{facets.units.map(u => <option key={u} value={u} />)}</datalist>
        <datalist id="parts-projects">{[...new Set([...projectNames, ...facets.projects.map(p => p.name)])].sort().map(p => <option key={p} value={p} />)}</datalist>
      </div>
    </div>
  );
}

function Suppliers({ suppliers, kinds, reload }) {
  const columns = [
    { key: 'name', label: '名稱 *' }, { key: 'kind', label: '類型', type: 'select', options: [['', '—'], ...kinds.map(k => [k, k])] },
    { key: 'contact', label: '聯絡窗口' }, { key: 'phone', label: '電話' }, { key: 'email', label: 'Email' },
    { key: 'website', label: '網站', show: r => r.website && <a href={/^https?:/.test(r.website) ? r.website : `https://${r.website}`} target="_blank" rel="noreferrer">{r.website}</a> },
    { key: 'lead_time', label: '交期', placeholder: '例如 4～6 週' }, { key: 'payment_terms', label: '付款條件', placeholder: '例如 月結 60 天' }, { key: 'note', label: '備註' },
    { key: 'part_count', label: '元件數', cls: 'num', type: 'hidden' },
  ];
  return <section className="card">
    <p className="mute hint">價格紀錄可以連到這裡的供應商。刪除供應商不會刪掉價格紀錄，只是那些紀錄不再連到供應商。</p>
    <RecordTable columns={columns} rows={suppliers} blank={{ name: '', kind: '', contact: '', phone: '', email: '', website: '', lead_time: '', payment_terms: '', note: '' }}
      addLabel="新增供應商" empty="還沒有供應商" deleteTitle={r => r.price_count ? `有 ${r.price_count} 筆價格紀錄連到這個供應商` : undefined}
      onSave={async row => { await api.saveSupplier(row.id, row); await reload(); }} onDelete={async id => { await api.deleteSupplier(id); await reload(); }} />
  </section>;
}

// 樹狀選單：群組 → 類別，各有元件數；點群組或類別就篩選右邊的清單，箭頭收合
function Tree({ tree, sel, onSel }) {
  const [closed, setClosed] = useState(() => new Set());
  const total = tree.reduce((n, g) => n + g.count, 0);
  const toggle = name => setClosed(s => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  return (
    <aside className="card tree" aria-label="元件分類">
      <h3>分類</h3>
      <button type="button" className={!sel.group && !sel.category ? 'on' : ''} onClick={() => onSel({ group: '', category: '' })}><span className="t-name">全部元件</span><span className="n">{total}</span></button>
      {tree.map(g => {
        const gn = g.name || UNGROUPED, open = !closed.has(g.name);
        return <div className="t-group" key={g.name}>
          <div className="t-row">
            <button type="button" className={`caret ${open ? 'open' : ''}`} aria-expanded={open} aria-label={`${open ? '收合' : '展開'} ${gn}`} onClick={() => toggle(g.name)}>›</button>
            <button type="button" className={sel.group === gn && !sel.category ? 'on' : ''} onClick={() => { onSel({ group: gn, category: '' }); setClosed(s => { const n = new Set(s); n.delete(g.name); return n; }); }}><span className="t-name">{gn}</span><span className="n">{g.count}</span></button>
          </div>
          {open && <div className="t-kids">{g.categories.map(c => { const cn = c.name || UNCATEGORIZED; return (
            <button type="button" key={c.name} className={sel.group === gn && sel.category === cn ? 'on' : ''} onClick={() => onSel({ group: gn, category: cn })}><span className="t-name">{cn}</span><span className="n">{c.count}</span></button>); })}</div>}
        </div>;
      })}
    </aside>
  );
}

// 清單：依類別分段（每段一條綠色的類別標題），同一段內隔列上淺色
function PartList({ parts, thumbs, onOpen, empty }) {
  const rows = [];
  let key = null, n = 0;
  for (const p of parts) {
    const k = `${p.grp}\n${p.category}`;
    if (k !== key) { key = k; n = 0; rows.push(<tr className="cat" key={`c:${k}`}><td colSpan={6}>{p.grp && <span className="g">{p.grp} ›</span>}{p.category || UNCATEGORIZED}<span className="n">{parts.filter(x => x.grp === p.grp && x.category === p.category).length} 個</span></td></tr>); }
    // 型號開頭已經寫了廠牌就不重複顯示
    const model = p.brand && p.model.toLowerCase().startsWith(p.brand.toLowerCase()) ? p.model.slice(p.brand.length).trim() : p.model;
    rows.push(
      <tr key={p.id} className={`part ${n++ % 2 ? 'alt' : ''}`} tabIndex={0} onClick={() => onOpen(p.id)} onKeyDown={e => { if (e.key === 'Enter') onOpen(p.id); }}>
        <td><div className="p-cell">{thumbs.has(p.model_id) && <img className="p-thumb" src={`/api/models/${p.model_id}/thumb?h=${thumbs.get(p.model_id)}`} alt="" loading="lazy" />}<div>
          <div className="p-name">{p.name}{p.status && <span className="chip warn">{p.status}</span>}</div>{(p.brand || model) && <div className="p-model">{p.brand && <b>{p.brand}</b>}{p.brand && model ? '　' : ''}{model}</div>}
          <div className="p-sub"><code className="p-code">{p.code}</code>{p.model_id && <span title="有 3D 模型">　<Icon name="parts" size={12} /> 3D</span>}{p.file_count > 0 && <span title="附件">　<Icon name="file" size={12} /> {p.file_count}</span>}</div>
        </div></div></td>
        <td><div className="p-spec" title={p.spec}>{p.spec}</div></td>
        <td>{p.unit}</td>
        <td className="num">{p.unit_price == null ? <span className="mute">—</span> : <>
          <div className="p-price">{money(p.unit_price, p.currency)}</div>
          <div className="p-sub">{p.grade && <span className="grade" title="估價等級">{p.grade}</span>}{p.quoted_on}{p.price_count > 1 ? ` · ${p.price_count} 筆` : ''}</div></>}</td>
        <td>{p.supplier}</td>
        <td>{p.projects.map(x => <span key={x} className="chip proj">{x}</span>)}</td>
      </tr>);
  }
  return (
    <div className="card table scroll"><table className="parts">
      <thead><tr><th>名稱／廠牌、型號／編號</th><th>規格</th><th>單位</th><th className="num">參考單價</th><th>供應商</th><th>用過的專案</th></tr></thead>
      <tbody>{rows}{!parts.length && <tr className="none"><td colSpan={6} className="mute">{empty}</td></tr>}</tbody>
    </table></div>
  );
}

export function Parts({ projectNames = [] }) {
  const [tab, setTab] = useState('parts');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState({ group: '', category: '' });       // 樹狀選單選到的群組／類別
  const [filter, setFilter] = useState({ project: '', supplier: '', status: '' });
  const [models, setModels] = useState({ models: [], catalogPort: 0, rendering: false });
  const [data, setData] = useState(null);
  const [sup, setSup] = useState({ suppliers: [], kinds: [] });
  const [open, setOpen] = useState(null);       // null｜'new'｜元件 id
  const [error, setError] = useState('');
  const load = useCallback(() => api.parts({ q, ...sel, ...filter }).then(d => { setData(d); setError(''); }).catch(e => setError(e.message)), [q, sel, filter]);
  const loadSuppliers = useCallback(() => api.suppliers().then(setSup).catch(e => setError(e.message)), []);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);     // 打字時稍等再查
  useEffect(() => { loadSuppliers(); }, [loadSuppliers]);
  // core 共用模型與渲染圖：縮圖過期時伺服器會在背景重拍，拍的時候每 4 秒再問一次
  const loadModels = useCallback(() => api.models().then(setModels).catch(() => {}), []);
  useEffect(() => { loadModels(); }, [loadModels]);
  useEffect(() => { if (!models.rendering) return; const t = setTimeout(loadModels, 4000); return () => clearTimeout(t); }, [models, loadModels]);
  const thumbs = new Map(models.models.filter(m => m.thumb).map(m => [m.id, m.hash]));
  const setF = (k, v) => setFilter(f => ({ ...f, [k]: v }));
  const filtered = q || filter.project || filter.supplier || filter.status, narrowed = filtered || sel.group;
  const close = useCallback(() => setOpen(null), []);
  const count = data ? data.tree.reduce((n, g) => n + g.count, 0) : 0;

  return (
    <div className="page wide">
      <div className="head">
        <div><h2>元件資料庫</h2>
          <div className="sub" style={{ marginBottom: 0 }}>設計、選型與成本表的共用參考：元件、歷次價格、哪些專案用過、供應商。{data && <>資料只留本機：<code>{data.file}</code></>}</div></div>
        <button className="primary" onClick={() => { setTab('parts'); setOpen('new'); }}>＋ 新增元件</button>
      </div>
      <div className="tabs">
        <button className={tab === 'parts' ? 'on' : ''} onClick={() => setTab('parts')}>元件{data ? ` ${count}` : ''}</button>
        <button className={tab === 'suppliers' ? 'on' : ''} onClick={() => setTab('suppliers')}>供應商 {sup.suppliers.length}</button>
      </div>
      {error && <div className="notice bad">{error}</div>}

      {tab === 'parts' && (!data ? <p className="mute">載入中…</p> : <div className="parts-layout">
        <Tree tree={data.tree} sel={sel} onSel={setSel} />
        <div>
          <div className="bar filters">
            <input className="grow" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋名稱、廠牌、型號、規格、專案、供應商…（空白分隔多個關鍵字）" aria-label="搜尋元件" />
            <Select value={filter.project} onChange={v => setF('project', v)} options={[['', '全部專案'], ...data.projects.map(p => [p.name, `${p.name}（${p.count}）`])]} />
            <Select value={filter.supplier} onChange={v => setF('supplier', v)} options={[['', '全部供應商'], ...sup.suppliers.map(s => [String(s.id), s.name])]} />
            {(data.pending > 0 || filter.status) && <button className={filter.status ? 'primary' : ''} title="代理提案帶進來、還沒審核的新元件" onClick={() => setF('status', filter.status ? '' : PENDING)}>待確認 {data.pending}</button>}
            {narrowed && <button onClick={() => { setQ(''); setFilter({ project: '', supplier: '', status: '' }); setSel({ group: '', category: '' }); }}>清除條件</button>}
          </div>
          <div className="crumb">
            <b>{sel.category || sel.group || '全部元件'}</b>{sel.category && <span>{sel.group}</span>}
            <span>{narrowed ? `符合 ${data.total} 個` : `共 ${data.total} 個`}{data.total > data.parts.length ? `，只列出前 ${data.parts.length} 個，請加上條件縮小範圍` : ''}</span>
          </div>
          <PartList parts={data.parts} thumbs={thumbs} onOpen={setOpen} empty={narrowed ? '沒有符合條件的元件' : '資料庫還是空的：按「＋ 新增元件」，或執行 node studio/vs3d.mjs parts seed 從各站的成本表匯入。'} />
        </div>
      </div>)}
      {tab === 'suppliers' && <Suppliers suppliers={sup.suppliers} kinds={sup.kinds} reload={() => Promise.all([loadSuppliers(), load()])} />}
      {open != null && data && <PartEditor id={open} facets={data} suppliers={sup.suppliers} models={models} projectNames={projectNames} onClose={close}
        onChanged={id => { load(); if (id != null && open === 'new') setOpen(id); }} />}
    </div>
  );
}
