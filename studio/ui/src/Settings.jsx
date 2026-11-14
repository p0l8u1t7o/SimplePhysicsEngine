// 設定：兩種 CLI 的安裝狀態與認證方式（訂閱帳號／API 金鑰）、API 金鑰（管理者）；工作區各角色的 CLI＋模型（寫入 .studio/settings.json）；
// 系統設定（附件上限、允許的檔案類型、成本費率；存在資料庫，只有管理者能改）。
import { useEffect, useState } from 'react';
import { api, ROLE } from './api.js';
import { CliSelect, ModelSelect, EffortSelect, ConfirmButton } from './fields.jsx';

// 卡片的資料載入失敗：顯示原因與重試（不要整張卡片消失或一直顯示「載入中」）
function LoadFailed({ title, msg, retry }) {
  return <section className="card"><h3>{title}</h3><p className="bad">載入失敗：{String(msg).replace(/^✗ /, '')}</p><div className="bar"><button type="button" onClick={retry}>重試</button></div></section>;
}

// 比例在畫面上用百分比（0.15 ↔ 15）
const PCT = new Set(['cost.contingency', 'cost.tax']);
const pct = v => +(v * 100).toFixed(4), unpct = v => v === '' ? '' : Number(v) / 100;

function SystemSettings({ canEdit }) {
  const [sys, setSys] = useState(null);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState('');
  const load = () => api.system().then(d => { setSys(d); setForm(d.values); }).catch(e => setMsg('✗ ' + e.message));
  useEffect(() => { load(); }, []);
  if (!sys || !form) return <section className="card"><h3>系統設定</h3><p className="mute">{msg || '載入中…'}</p></section>;
  const set = (k, v) => { setMsg(''); setForm(f => ({ ...f, [k]: v })); };
  // 這張卡片只管附件與成本；代理的認證方式在「代理 CLI」卡片另外存
  const mineOnly = v => Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('agents.') && !k.startsWith('trash.') && !k.startsWith('web.')));
  const dirty = JSON.stringify(mineOnly(form)) !== JSON.stringify(mineOnly(sys.values));
  const field = k => <label key={k}><span>{sys.defs[k].label}</span>
    <input type="number" step="any" min="0" disabled={!canEdit} value={PCT.has(k) ? pct(form[k]) : form[k]} onChange={e => set(k, PCT.has(k) ? unpct(e.target.value) : e.target.value)} />
    {(sys.defs[k].hint || PCT.has(k)) && <small className="mute">{PCT.has(k) ? '%' : ''}{sys.defs[k].hint ? `${PCT.has(k) ? '　' : ''}${sys.defs[k].hint}` : ''}</small>}</label>;
  async function save() {
    try { const d = await api.saveSystem(mineOnly(form)); setSys(d); setForm(d.values); setMsg('✓ 已儲存'); } catch (e) { setMsg('✗ ' + e.message); }
  }
  const types = form['attachment.types'], grade = form['cost.gradeRange'];
  return (
    <section className="card form"><h3>系統設定</h3>
      <p className="mute hint">{canEdit ? '存在資料庫，所有人共用。' : '只有管理者可以修改。'}新專案的成本表用這裡的費率（專案可以另外覆寫）。</p>
      <div className="lbl">附件</div>
      <div className="row">{['attachment.maxMB', 'attachment.cadMaxMB'].map(field)}</div>
      <div className="lbl">允許上傳的檔案類型</div>
      <div className="types">{Object.entries(sys.fileTypes).map(([t, d]) => <label key={t} className="check" title={d.ext.join('、')}>
        <input type="checkbox" disabled={!canEdit} checked={types.includes(t)} onChange={e => set('attachment.types', e.target.checked ? [...types, t] : types.filter(x => x !== t))} />{d.label}</label>)}</div>
      <div className="lbl" style={{ marginTop: 12 }}>成本費率</div>
      <div className="row">{['cost.engRate', 'cost.techRate', 'cost.contingency', 'cost.tax'].map(field)}</div>
      <div className="row">{['A', 'B', 'C'].map(g => <label key={g}><span>等級 {g} 的上下幅度</span>
        <input type="number" step="any" min="0" max="100" disabled={!canEdit} value={pct(grade[g])} onChange={e => set('cost.gradeRange', { ...grade, [g]: unpct(e.target.value) })} /><small className="mute">±%</small></label>)}</div>
      {canEdit && <div className="bar"><button className="primary" disabled={!dirty} onClick={save}>儲存</button>
        {dirty && <button onClick={() => { setForm(sys.values); setMsg(''); }}>復原</button>}<span className={msg.startsWith('✗') ? 'bad' : 'ok'}>{msg}</span></div>}
    </section>
  );
}

// 代理 CLI：安裝狀態、認證方式（開發機可以切換訂閱帳號／API 金鑰；部署版只有 API 金鑰）、能不能用
function AgentCli({ isAdmin }) {
  const [doctor, setDoctor] = useState(null), [sys, setSys] = useState(null), [msg, setMsg] = useState('');
  const load = () => Promise.all([api.doctor().then(setDoctor), api.system().then(setSys)]).catch(e => setMsg('✗ ' + e.message));
  useEffect(() => { load(); }, []);
  const setMode = (cli, v) => { setMsg(''); api.saveSystem({ [`agents.auth.${cli}`]: v }).then(() => { setMsg('✓ 已切換'); load(); }).catch(e => setMsg('✗ ' + e.message)); };
  return <section className="card"><h3>代理 CLI</h3>
    <p className="mute hint">{sys?.subscription ? '開發機：每種 CLI 可以用自己的訂閱帳號登入，或改用 API 金鑰（換了之後，進行中的工作階段會重新開始）。'
      : '部署版：只用 API 金鑰（2026-10-06 拍板：多人共用的主機不使用個人訂閱帳號，避免違反條款）。'}</p>
    {!doctor ? (msg ? null : <p className="mute">偵測中…</p>) : <table><tbody>{doctor.map(a => <tr key={a.name}><td><b>{a.label}</b></td><td>{a.installed ? a.version : <span className="bad">未安裝</span>}</td>
      <td>{sys?.subscription && isAdmin ? <select value={a.mode} onChange={e => setMode(a.name, e.target.value)} aria-label={`${a.label} 的認證方式`}>
        <option value="subscription">訂閱帳號登入</option><option value="apiKey">API 金鑰</option></select> : a.modeLabel}</td>
      <td>{a.installed && (a.loggedIn ? <span className="ok">● 可以用 <span className="mute">{a.detail}</span></span> : <span className="bad">● 不能用：{a.detail}</span>)}</td></tr>)}</tbody></table>}
    {msg && <div className={msg.startsWith('✗') ? 'bad' : 'ok'}>{msg}</div>}
  </section>;
}

// API 金鑰（管理者）：只看得到末四碼；金鑰用 Windows DPAPI 加密存在這台主機
function ApiKeys() {
  const [d, setD] = useState(null), [input, setInput] = useState({}), [msg, setMsg] = useState('');
  const load = () => api.secrets().then(setD).catch(e => setMsg('✗ ' + e.message));
  useEffect(() => { load(); }, []);
  if (!d) return msg ? <LoadFailed title="API 金鑰" msg={msg} retry={() => { setMsg(''); load(); }} /> : null;
  const act = fn => { setMsg(''); fn().then(() => { setInput({}); setMsg('✓ 已更新'); load(); }).catch(e => setMsg('✗ ' + e.message)); };
  return <section className="card form"><h3>API 金鑰</h3>
    <p className="mute hint">給選了「API 金鑰」的 CLI 用（部署版一律用它）。金鑰只存在這台主機（Windows 用 DPAPI 加密），畫面只顯示末四碼；執行代理時才解開，以環境變數交給 CLI。</p>
    <table><tbody>{Object.entries(d.providers).map(([p, label]) => { const k = d.keys[p]; return <tr key={p}>
      <td><b>{label}</b></td>
      <td>{k.set ? <span className="ok">● …{k.last4}<span className="mute">　{k.updatedAt?.slice(0, 10)}{k.by ? ` · ${k.by}` : ''}{k.protection === 'none' ? ' · 未加密' : ''}</span></span> : <span className="mute">還沒有設定</span>}</td>
      <td><input type="password" autoComplete="off" value={input[p] || ''} onChange={e => setInput(x => ({ ...x, [p]: e.target.value }))} placeholder={k.set ? '輸入新的金鑰以更換' : '貼上金鑰'} aria-label={`${label} 的 API 金鑰`} /></td>
      <td className="ops"><button type="button" className="primary" disabled={!input[p]} onClick={() => act(() => api.saveSecret(p, input[p]))}>儲存</button>
        {k.set && <ConfirmButton onConfirm={() => act(() => api.deleteSecret(p))} />}</td></tr>; })}</tbody></table>
    {msg && <div className={msg.startsWith('✗') ? 'bad' : 'ok'}>{msg}</div>}
  </section>;
}

// 匯率（管理者）：每 1 單位外幣折合多少新台幣，帶日期；成本表用 BOM 設定的「匯率日期」以前最近的一筆
function FxRates() {
  const [rates, setRates] = useState(null), [f, setF] = useState({ currency: 'USD', rate: '', date: new Date().toLocaleDateString('sv'), note: '' }), [msg, setMsg] = useState('');
  const load = () => api.fx().then(r => setRates(r.rates)).catch(e => setMsg('✗ ' + e.message));
  useEffect(() => { load(); }, []);
  if (!rates) return msg ? <LoadFailed title="匯率" msg={msg} retry={() => { setMsg(''); load(); }} /> : null;
  const act = fn => { setMsg(''); fn().then(r => { setRates(r.rates); setMsg('✓ 已更新'); }).catch(e => setMsg('✗ ' + e.message)); };
  return <section className="card form"><h3>匯率<span className="chip">{rates.length}</span></h3>
    <p className="mute hint">成本表把外幣單價換成新台幣：用專案成本表設定的「匯率日期」那天以前最近的一筆。改了匯率不會改變已經存成快照的金額。</p>
    {rates.length > 0 && <table className="data"><thead><tr><th>幣別</th><th>日期</th><th className="num">匯率（NT$）</th><th>備註</th><th /></tr></thead><tbody>
      {rates.map(r => <tr key={`${r.currency}${r.date}`}><td>{r.currency}</td><td>{r.date}</td><td className="num">{r.rate}</td><td className="mute">{r.note}</td>
        <td className="ops"><ConfirmButton onConfirm={() => act(() => api.deleteFx(r.currency, r.date))} /></td></tr>)}</tbody></table>}
    <div className="row">
      <label><span>幣別</span><input value={f.currency} maxLength={3} onChange={e => setF(x => ({ ...x, currency: e.target.value.toUpperCase() }))} /></label>
      <label><span>匯率（1 單位折合 NT$）</span><input type="number" min="0" step="any" value={f.rate} onChange={e => setF(x => ({ ...x, rate: e.target.value }))} /></label>
      <label><span>日期</span><input type="date" value={f.date} onChange={e => setF(x => ({ ...x, date: e.target.value }))} /></label>
      <label><span>備註</span><input value={f.note} onChange={e => setF(x => ({ ...x, note: e.target.value }))} placeholder="例如 台銀即期賣出" /></label>
    </div>
    <div className="bar"><button className="primary" disabled={!f.rate} onClick={() => act(() => api.setFx(f))}>新增或更新</button>{msg && <span className={msg.startsWith('✗') ? 'bad' : 'ok'}>{msg}</span>}</div>
  </section>;
}

// 回收桶（管理者）：刪除的專案留在工作區的 .studio/trash/；可以永久刪除一個、清掉超過幾天的，或設定自動清理的天數
function Trash() {
  const [d, setD] = useState(null), [keep, setKeep] = useState(null), [days, setDays] = useState('30'), [msg, setMsg] = useState('');
  const load = () => Promise.all([api.trash().then(setD), api.system().then(s => setKeep(String(s.values['trash.keepDays'])))]).catch(e => setMsg('✗ ' + e.message));
  useEffect(() => { load(); }, []);
  if (!d) return msg ? <LoadFailed title="回收桶（刪除的專案）" msg={msg} retry={() => { setMsg(''); load(); }} /> : null;
  const act = fn => { setMsg(''); fn().then(r => { setMsg(r?.purged ? `✓ 永久刪除 ${r.purged.length} 個` : '✓ 已儲存'); load(); }).catch(e => setMsg('✗ ' + e.message)); };
  const mb = b => `${(b / 1048576).toFixed(1)} MB`;
  return <section className="card form"><h3>回收桶（刪除的專案）<span className="chip">{d.items.length}</span></h3>
    <p className="mute hint">刪除的專案整個搬到工作區的 <code>.studio/trash/</code>，想救回來就把資料夾搬回 <code>projects/</code>。這裡的「永久刪除」就救不回來了。</p>
    {d.items.length > 0 && <div className="scroll"><table className="data"><thead><tr><th>專案</th><th>刪除時間</th><th className="num">大小</th><th /></tr></thead><tbody>
      {d.items.map(x => <tr key={x.name}><td><b>{x.project}</b> <span className="mute">{x.name}</span></td><td className="mute nowrap">{new Date(x.deletedAt).toLocaleString()}</td><td className="num mute">{mb(x.bytes)}</td>
        <td className="ops"><ConfirmButton label="永久刪除" confirmLabel="確定永久刪除？" onConfirm={() => act(() => api.purgeTrashItem(x.name))} /></td></tr>)}
    </tbody></table></div>}
    <div className="bar">
      <label className="inline">清掉超過 <input type="number" min="0" style={{ width: 80 }} value={days} onChange={e => setDays(e.target.value)} aria-label="清掉超過幾天" /> 天的</label>
      <ConfirmButton label="清理" confirmLabel="確定清理？" disabled={!d.items.length || days === ''} onConfirm={() => act(() => api.purgeTrash(Number(days)))} />
      <span className="grow" />
      <label className="inline">自動清理：留 <input type="number" min="0" style={{ width: 80 }} value={keep ?? ''} onChange={e => { setMsg(''); setKeep(e.target.value); }} aria-label="自動清理的天數" /> 天（0 是不自動清）</label>
      <button type="button" onClick={() => act(() => api.saveSystem({ 'trash.keepDays': keep }))}>儲存</button>
    </div>
    {msg && <div className={msg.startsWith('✗') ? 'bad' : 'ok'}>{msg}</div>}
  </section>;
}

// 規劃角色上網查規格（lib/web-policy.mjs）：開關與 WebFetch 可以開的廠商網域；只有管理者能改
function WebSettings({ canEdit }) {
  const [sys, setSys] = useState(null), [on, setOn] = useState(false), [domains, setDomains] = useState(''), [msg, setMsg] = useState('');
  const load = () => api.system().then(d => { setSys(d); setOn(!!d.values['web.planSearch']); setDomains((d.values['web.domains'] || []).join('\n')); }).catch(e => setMsg('✗ ' + e.message));
  useEffect(() => { load(); }, []);
  if (!sys) return msg ? <LoadFailed title="代理上網" msg={msg} retry={() => { setMsg(''); load(); }} /> : null;
  const save = () => api.saveSystem({ 'web.planSearch': on, 'web.domains': domains }).then(d => { setSys(d); setDomains(d.values['web.domains'].join('\n')); setMsg('✓ 已儲存'); }).catch(e => setMsg('✗ ' + e.message));
  return <section className="card form"><h3>代理上網</h3>
    <p className="mute hint">只有規劃角色可以上網查設備型錄與規格（其他角色不上網；元件補全另有規則）。Claude 的 WebFetch 只能開下面的網域，搜尋字串與網址出現用戶名稱會記為違規。部署版預設關閉。</p>
    <label className="check"><input type="checkbox" disabled={!canEdit} checked={on} onChange={e => { setMsg(''); setOn(e.target.checked); }} /> 規劃角色可以上網查規格</label>
    <label><span>可以開啟的廠商網域（一行一個，不用加 www）</span><textarea rows={6} disabled={!canEdit} value={domains} onChange={e => { setMsg(''); setDomains(e.target.value); }} aria-label="廠商網域" /></label>
    {canEdit && <div className="bar"><button className="primary" onClick={save}>儲存</button><span className={msg.startsWith('✗') ? 'bad' : 'ok'}>{msg}</span></div>}
  </section>;
}

// 常見錯誤清單：審查必修項的通則（lib/lessons.mjs），規劃與開發前附給代理；可以改寫、停用、刪除
function Lessons({ canEdit }) {
  const [items, setItems] = useState(null), [msg, setMsg] = useState(''), [edit, setEdit] = useState(null);
  const load = () => api.lessons().then(r => setItems(r.items)).catch(e => setMsg('✗ ' + e.message));
  useEffect(() => { load(); }, []);
  if (!items) return msg ? <LoadFailed title="常見錯誤清單" msg={msg} retry={() => { setMsg(''); load(); }} /> : null;
  const act = fn => { setMsg(''); fn().then(() => { setEdit(null); load(); }).catch(e => setMsg('✗ ' + e.message)); };
  const list = [...items].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
  return <section className="card form"><h3>常見錯誤清單<span className="chip">{items.filter(x => !x.disabled).length}</span></h3>
    <p className="mute hint">審查角色抓到的必修問題整理成的通則（不含站名與用戶名稱），每次執行前寫到專案的 <code>.studio/lessons.md</code> 給規劃、開發、修正、補強先看。次數高的排前面，最多附 40 條；不適用的停用或刪除。</p>
    {list.length ? <div className="scroll"><table className="data"><thead><tr><th>通則</th><th className="num">次數</th><th>專案</th><th /></tr></thead><tbody>
      {list.map(x => <tr key={x.id} className={x.disabled ? 'mute' : ''}>
        <td>{edit?.id === x.id ? <input value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} aria-label="通則內容" style={{ width: '100%' }} /> : x.text}</td>
        <td className="num">{x.count}</td><td className="mute">{x.projects.join('、')}</td>
        <td className="ops nowrap">{canEdit && (edit?.id === x.id
          ? <><button type="button" onClick={() => act(() => api.updateLesson(x.id, { text: edit.text }))}>儲存</button><button type="button" onClick={() => setEdit(null)}>取消</button></>
          : <><button type="button" onClick={() => setEdit({ id: x.id, text: x.text })}>改寫</button>
            <button type="button" onClick={() => act(() => api.updateLesson(x.id, { disabled: !x.disabled }))}>{x.disabled ? '啟用' : '停用'}</button>
            <ConfirmButton label="刪除" confirmLabel="確定刪除？" onConfirm={() => act(() => api.deleteLesson(x.id))} /></>)}</td></tr>)}
    </tbody></table></div> : <p className="mute">還沒有。審查角色在必修項寫了通則（lesson）後會出現在這裡。</p>}
    {msg && <div className="bad">{msg}</div>}
  </section>;
}

export function Settings({ info, user }) {
  const isAdmin = !user || user.role === 'admin';       // 還沒有帳號的單機模式等同管理者
  const [data, setData] = useState(null);
  const [roles, setRoles] = useState({});
  const [defaultCli, setDefaultCli] = useState('claude');
  const [msg, setMsg] = useState('');
  const [loadError, setLoadError] = useState('');
  const load = () => { setLoadError(''); api.settings().then(d => { setData(d); setRoles(d.settings.roles || {}); setDefaultCli(d.settings.defaultCli || 'claude'); }).catch(e => setLoadError(e.message)); };
  useEffect(() => { load(); }, []);
  const set = (r, k, v) => { setMsg(''); setRoles(x => ({ ...x, [r]: { ...x[r], [k]: v || undefined } })); };
  // 換 CLI 時清掉模型與推理強度（另一個 CLI 不一定有同名的值）；選模型時一併固定 CLI，之後預設 CLI 改了也不會配錯
  const setCli = (r, v) => { setMsg(''); setRoles(x => ({ ...x, [r]: { cli: v || undefined } })); };
  async function save() {
    const clean = Object.fromEntries(Object.entries(roles).map(([r, v]) => [r, Object.fromEntries(Object.entries(v || {}).filter(([, x]) => x))]).filter(([, v]) => Object.keys(v).length));
    const d = await api.saveSettings({ defaultCli, roles: clean }); setData(d); setMsg('✓ 已儲存');
  }
  const opts = info?.options;

  return (
    <div className="page narrow">
      <h2>設定</h2>
      <p className="sub">工作區：{info?.ws}</p>
      {loadError && <div className="notice bad">設定載入失敗：{loadError}　<button type="button" onClick={load}>重試</button></div>}
      <AgentCli isAdmin={isAdmin} />
      {isAdmin && <ApiKeys />}
      <section className="card"><h3>角色與模型（這個工作區的預設）</h3>
        <p className="mute hint">選「（預設）」代表用 app 預設：規劃、開發、修正、審查、光學用 Claude opus 高推理（high；角色改用 Claude 補強時也是），元件補全用 Claude sonnet，補強用 Codex gpt-6-astra 高推理（第二段的開發與修正也是）。專案建立時指定的 CLI／模型、或專案的 studio.json 會優先。模型清單來自各 CLI（Codex 另外讀 ~/.codex/config.toml）。</p>
        <div className="bar"><label className="inline">預設 CLI <CliSelect value={defaultCli} onChange={v => { setMsg(''); setDefaultCli(v); }} /></label></div>
        <div className="scroll"><table className="roles"><thead><tr><th>角色</th><th>CLI</th><th>模型</th><th>推理強度</th><th>目前實際指派</th></tr></thead><tbody>
          {Object.keys(ROLE).map(r => { const cli = roles[r]?.cli, eff = cli || data?.resolved?.[r]?.cli; return <tr key={r}><td><b>{ROLE[r]}</b></td>
            <td><CliSelect value={cli} defaultLabel="（預設）" onChange={v => setCli(r, v)} /></td>
            <td><ModelSelect cli={eff} options={opts} value={roles[r]?.model} onChange={v => setRoles(x => ({ ...x, [r]: { ...x[r], cli: v ? eff : x[r]?.cli, model: v || undefined } }))} defaultLabel="（預設）" /></td>
            <td><EffortSelect cli={eff} options={opts} value={roles[r]?.effort} onChange={v => set(r, 'effort', v)} defaultLabel="（預設）" /></td>
            <td className="mute">{data?.resolved?.[r] ? `${data.resolved[r].cli} ${data.resolved[r].model || '（帳號預設）'}${data.resolved[r].effort ? ` ${data.resolved[r].effort}` : ''}` : ''}</td></tr>; })}
        </tbody></table></div>
        <div className="bar"><button className="primary" disabled={!data} title={data ? undefined : '設定還沒載入，不能儲存'} onClick={() => save().catch(e => setMsg('✗ ' + e.message))}>儲存</button><span className={msg.startsWith('✗') ? 'bad' : 'ok'}>{msg}</span></div>
      </section>
      <SystemSettings canEdit={isAdmin} />
      {isAdmin && <FxRates />}
      <WebSettings canEdit={isAdmin} />
      <Lessons canEdit={!user || user.role !== 'viewer'} />
      {isAdmin && <Trash />}
    </div>
  );
}
