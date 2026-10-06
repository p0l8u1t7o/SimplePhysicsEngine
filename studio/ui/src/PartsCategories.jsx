// 元件庫的分類樹與欄位範本（評估平台 Q2）：
//   CategoryTree     左邊的樹狀選單（不限層、最多 4 層）；管理者按「管理分類」可以新增子分類、開分類設定
//   CategoryEditor   分類設定：名稱、搬到別的上層、說明、欄位範本（子分類繼承上層的欄位）、刪除
//   CategorySelect   元件表單的分類下拉選單（縮排顯示路徑）
//   TemplateFields   元件表單裡依分類的欄位範本產生的規格欄位
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Select, ConfirmButton } from './fields.jsx';

// 樹攤平成清單（下拉選單、找節點用）：[{ id, name, path, depth, count }]
export const flatten = nodes => nodes.flatMap(n => [n, ...flatten(n.children)]);
export const pathText = path => path.join(' › ');

export function CategoryTree({ tree, sel, onSel, isAdmin, onEdit }) {
  const [closed, setClosed] = useState(() => new Set());
  const [manage, setManage] = useState(false);
  const total = flatten(tree.nodes).filter(n => n.depth === 1).reduce((s, n) => s + n.count, 0) + tree.uncategorized;
  const toggle = id => setClosed(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const node = n => {
    const open = !closed.has(n.id), on = String(sel) === String(n.id);
    return <div className="t-group" key={n.id}>
      <div className="t-row">
        {n.children.length ? <button type="button" className={`caret ${open ? 'open' : ''}`} aria-expanded={open} aria-label={`${open ? '收合' : '展開'} ${n.name}`} onClick={() => toggle(n.id)}>›</button> : <span className="caret-sp" />}
        <button type="button" className={on ? 'on' : ''} title={pathText(n.path)} onClick={() => { onSel(n.id); setClosed(s => { const x = new Set(s); x.delete(n.id); return x; }); }}>
          <span className="t-name">{n.name}</span>{n.fields > 0 && <span className="t-fields" title={`${n.fields} 個欄位範本`}>▤</span>}<span className="n">{n.count}</span></button>
        {manage && <span className="t-ops">
          {n.depth < tree.maxDepth && <button type="button" title={`在「${n.name}」底下新增子分類`} onClick={() => onEdit({ parent_id: n.id })}>＋</button>}
          <button type="button" title="分類設定（名稱、搬移、欄位範本、刪除）" onClick={() => onEdit({ id: n.id })}>⚙</button></span>}
      </div>
      {open && n.children.length > 0 && <div className="t-kids">{n.children.map(node)}</div>}
    </div>;
  };
  return (
    <aside className="card tree" aria-label="元件分類">
      <div className="t-head"><h3>分類</h3>{isAdmin && <button type="button" className={manage ? 'primary' : ''} onClick={() => setManage(m => !m)}>{manage ? '完成' : '管理分類'}</button>}</div>
      <button type="button" className={!sel ? 'on' : ''} onClick={() => onSel('')}><span className="t-name">全部元件</span><span className="n">{total}</span></button>
      {tree.nodes.map(node)}
      {tree.uncategorized > 0 && <button type="button" className={sel === 'none' ? 'on' : ''} onClick={() => onSel('none')}><span className="t-name mute">（未分類）</span><span className="n">{tree.uncategorized}</span></button>}
      {manage && <div className="bar"><button type="button" onClick={() => onEdit({ parent_id: null })}>＋ 最上層分類</button></div>}
    </aside>
  );
}

// 分類下拉選單：「（未分類）」＋所有節點（縮排）；exclude 是不能選的節點（搬家時自己與子分類）
export function CategorySelect({ tree, value, onChange, exclude = [], noneLabel = '（未分類）', ariaLabel }) {
  const opts = [['', noneLabel], ...flatten(tree.nodes).filter(n => !exclude.includes(n.id)).map(n => [String(n.id), `${'　'.repeat(n.depth - 1)}${n.name}`])];
  return <select value={value == null ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} aria-label={ariaLabel}>
    {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}

const BLANK_FIELD = { key: '', type: 'text', unit: '', options: '', required: false };

// 分類設定（管理者）：target 是 { id } 或 { parent_id }（新增）
export function CategoryEditor({ target, tree, fieldTypes, onClose, onChanged }) {
  const [cat, setCat] = useState(null), [form, setForm] = useState({ name: '', parent_id: target.parent_id ?? null, note: '' });
  const [fields, setFields] = useState([]), [msg, setMsg] = useState('');
  const isNew = target.id == null;
  useEffect(() => {
    if (isNew) return;
    api.category(target.id).then(c => { setCat(c); setForm({ name: c.name, parent_id: c.parent_id, note: c.note }); setFields(c.fields.map(f => ({ ...f, options: f.options.join('、') }))); }).catch(e => setMsg('✗ ' + e.message));
  }, [target.id, isNew]);
  const self = !isNew && flatten(tree.nodes).find(n => n.id === target.id);
  const exclude = self ? flatten([self]).map(n => n.id) : [];
  const parent = flatten(tree.nodes).find(n => n.id === form.parent_id);
  const act = async fn => { setMsg(''); try { await fn(); onChanged(); } catch (e) { setMsg('✗ ' + e.message); } };
  const setField = (i, k, v) => { setMsg(''); setFields(fs => fs.map((f, n) => n === i ? { ...f, [k]: v } : f)); };
  const move = (i, d) => setFields(fs => { const a = [...fs], j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; });

  async function save() {
    await act(async () => {
      const c = isNew ? await api.saveCategory(null, form) : await api.saveCategory(target.id, form);
      if (!isNew) await api.saveCategoryFields(c.id, fields.map(f => ({ ...f, options: f.type === 'select' ? f.options : '' })));
      onClose();
    });
  }
  return (
    <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel narrow-panel" role="dialog" aria-label="分類設定">
        <div className="head"><div className="grow"><h2>{isNew ? '新增分類' : `分類設定：${cat?.name || ''}`}</h2>
          {!isNew && cat && <div className="meta"><span className="mute">{pathText(cat.path)}　·　{cat.parts} 個元件、{cat.children} 個子分類</span></div>}</div>
          <button type="button" onClick={onClose}>✕ 關閉</button></div>
        <section className="card form"><h3>基本資料</h3>
          <div className="row">
            <label><span>名稱 *</span><input value={form.name} autoFocus onChange={e => { setMsg(''); setForm(f => ({ ...f, name: e.target.value })); }} placeholder="例如 遠心鏡頭" /></label>
            <label><span>上層分類</span><CategorySelect tree={tree} value={form.parent_id} exclude={exclude} noneLabel="（最上層）" ariaLabel="上層分類" onChange={v => { setMsg(''); setForm(f => ({ ...f, parent_id: v })); }} /></label>
          </div>
          <label><span>說明</span><input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="什麼元件放這裡" /></label>
          {isNew && <p className="mute hint">建立之後再打開分類設定，就能編輯欄位範本。</p>}
        </section>
        {!isNew && cat && <section className="card form"><h3>欄位範本<span className="chip">{fields.length}</span></h3>
          <p className="mute hint">這個分類（和它的子分類）的元件，編輯面板會出現這些規格欄位。「選項」只是建議，仍然可以填別的值；「數字」要填純數字，單位寫在這裡。必填的欄位沒填時，元件會標出資料不完整。</p>
          {cat.inherited.length > 0 && <p className="mute">從上層繼承：{cat.inherited.map(f => `${f.label}${f.unit ? `（${f.unit}）` : ''}`).join('、')}</p>}
          {fields.length > 0 && <div className="scroll"><table className="data fields"><thead><tr><th>欄位名稱</th><th>型別</th><th>單位</th><th>選項（逗號分隔）</th><th>必填</th><th /></tr></thead><tbody>
            {fields.map((f, i) => <tr key={i}>
              <td><input value={f.key} onChange={e => setField(i, 'key', e.target.value)} aria-label="欄位名稱" placeholder="例如 焦距" /></td>
              <td><Select value={f.type} onChange={v => setField(i, 'type', v)} options={Object.entries(fieldTypes)} /></td>
              <td><input value={f.unit} onChange={e => setField(i, 'unit', e.target.value)} aria-label="單位" placeholder="mm" style={{ width: 70 }} /></td>
              <td><input value={f.options} disabled={f.type !== 'select'} onChange={e => setField(i, 'options', e.target.value)} aria-label="選項" placeholder={f.type === 'select' ? 'C、CS、F' : ''} /></td>
              <td><input type="checkbox" checked={!!f.required} onChange={e => setField(i, 'required', e.target.checked)} aria-label="必填" /></td>
              <td className="ops"><button type="button" title="往上" onClick={() => move(i, -1)}>↑</button><button type="button" title="往下" onClick={() => move(i, 1)}>↓</button>
                <button type="button" onClick={() => setFields(fs => fs.filter((_, n) => n !== i))}>移除</button></td>
            </tr>)}</tbody></table></div>}
          <div className="bar"><button type="button" onClick={() => setFields(fs => [...fs, { ...BLANK_FIELD }])}>＋ 欄位</button></div>
        </section>}
        <div className="bar">
          <button type="button" className="primary" disabled={!form.name.trim()} onClick={save}>{isNew ? '新增' : '儲存'}</button>
          {parent && <span className="mute">放在：{pathText(parent.path)}</span>}
          <span className={msg.startsWith('✗') ? 'bad' : 'ok'}>{msg}</span>
          <span className="grow" />
          {!isNew && <ConfirmButton label="刪除分類" title="底下沒有元件與子分類時才能刪" onConfirm={() => act(async () => { await api.deleteCategory(target.id); onClose(); })} />}
        </div>
      </div>
    </div>
  );
}

// 元件表單裡依欄位範本產生的欄位；values 是 attrs（{ 欄位名稱: 值 }）
export function TemplateFields({ fields, values, onChange, missing = [] }) {
  if (!fields.length) return null;
  const input = f => {
    const v = values[f.key] ?? '', set = x => onChange(f.key, x);
    if (f.type === 'bool') return <Select value={v} onChange={set} options={[['', '—'], ['是', '是'], ['否', '否']]} />;
    if (f.type === 'select') return <><input value={v} list={`tf-${f.key}`} onChange={e => set(e.target.value)} aria-label={f.label} />
      <datalist id={`tf-${f.key}`}>{f.options.map(o => <option key={o} value={o} />)}</datalist></>;
    return <input value={v} inputMode={f.type === 'number' ? 'decimal' : undefined} onChange={e => set(e.target.value)} aria-label={f.label} />;
  };
  return <div className="tfields">
    {fields.map(f => <label key={f.key} className={missing.includes(f.key) ? 'missing' : ''}>
      <span>{f.label}{f.required && <b className="req" title="必填">＊</b>}{f.unit && <small className="mute">（{f.unit}）</small>}</span>{input(f)}</label>)}
  </div>;
}
