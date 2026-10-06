// 設定：兩種 CLI 的安裝與登入狀態；工作區各角色的 CLI＋模型（寫入 .studio/settings.json）；
// 系統設定（附件上限、允許的檔案類型、成本費率；存在資料庫，只有管理者能改）。
import { useEffect, useState } from 'react';
import { api, ROLE } from './api.js';
import { CliSelect, ModelSelect, EffortSelect } from './fields.jsx';

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
  const dirty = JSON.stringify(form) !== JSON.stringify(sys.values);
  const field = k => <label key={k}><span>{sys.defs[k].label}</span>
    <input type="number" step="any" min="0" disabled={!canEdit} value={PCT.has(k) ? pct(form[k]) : form[k]} onChange={e => set(k, PCT.has(k) ? unpct(e.target.value) : e.target.value)} />
    {(sys.defs[k].hint || PCT.has(k)) && <small className="mute">{PCT.has(k) ? '%' : ''}{sys.defs[k].hint ? `${PCT.has(k) ? '　' : ''}${sys.defs[k].hint}` : ''}</small>}</label>;
  async function save() {
    try { const d = await api.saveSystem(form); setSys(d); setForm(d.values); setMsg('✓ 已儲存'); } catch (e) { setMsg('✗ ' + e.message); }
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

export function Settings({ info, user }) {
  const [doctor, setDoctor] = useState(null);
  const [data, setData] = useState(null);
  const [roles, setRoles] = useState({});
  const [defaultCli, setDefaultCli] = useState('claude');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api.doctor().then(setDoctor).catch(e => setMsg(e.message));
    api.settings().then(d => { setData(d); setRoles(d.settings.roles || {}); setDefaultCli(d.settings.defaultCli || 'claude'); });
  }, []);
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
      <section className="card"><h3>代理 CLI</h3>
        {!doctor ? <p className="mute">偵測中…</p> : <table><tbody>{doctor.map(a => <tr key={a.name}><td><b>{a.label}</b></td><td>{a.installed ? a.version : <span className="bad">未安裝</span>}</td>
          <td>{a.installed && (a.loggedIn ? <span className="ok">● 已登入 <span className="mute">{a.detail}</span></span> : <span className="bad">● 未登入：{a.detail}</span>)}</td></tr>)}</tbody></table>}
      </section>
      <section className="card"><h3>角色與模型（這個工作區的預設）</h3>
        <p className="mute hint">選「（預設）」代表用 app 預設：規劃、開發、修正、審查用 Claude opus，補強用 Codex gpt-6-astra 高推理。專案建立時指定的 CLI／模型、或專案的 studio.json 會優先。模型清單來自各 CLI（Codex 另外讀 ~/.codex/config.toml）。</p>
        <div className="bar"><label className="inline">預設 CLI <CliSelect value={defaultCli} onChange={v => { setMsg(''); setDefaultCli(v); }} /></label></div>
        <div className="scroll"><table className="roles"><thead><tr><th>角色</th><th>CLI</th><th>模型</th><th>推理強度</th><th>目前實際指派</th></tr></thead><tbody>
          {Object.keys(ROLE).map(r => { const cli = roles[r]?.cli, eff = cli || data?.resolved?.[r]?.cli; return <tr key={r}><td><b>{ROLE[r]}</b></td>
            <td><CliSelect value={cli} defaultLabel="（預設）" onChange={v => setCli(r, v)} /></td>
            <td><ModelSelect cli={eff} options={opts} value={roles[r]?.model} onChange={v => setRoles(x => ({ ...x, [r]: { ...x[r], cli: v ? eff : x[r]?.cli, model: v || undefined } }))} defaultLabel="（預設）" /></td>
            <td><EffortSelect cli={eff} options={opts} value={roles[r]?.effort} onChange={v => set(r, 'effort', v)} defaultLabel="（預設）" /></td>
            <td className="mute">{data?.resolved?.[r] ? `${data.resolved[r].cli} ${data.resolved[r].model || '（帳號預設）'}${data.resolved[r].effort ? ` ${data.resolved[r].effort}` : ''}` : ''}</td></tr>; })}
        </tbody></table></div>
        <div className="bar"><button className="primary" onClick={() => save().catch(e => setMsg('✗ ' + e.message))}>儲存</button><span className={msg.startsWith('✗') ? 'bad' : 'ok'}>{msg}</span></div>
      </section>
      <SystemSettings canEdit={!user || user.role === 'admin'} />
    </div>
  );
}
