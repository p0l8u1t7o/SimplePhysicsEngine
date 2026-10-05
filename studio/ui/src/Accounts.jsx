// 登入與帳號管理。還沒有任何帳號時介面不需要登入；在「帳號」頁建立第一個管理者之後，所有人都要登入。
// 角色：管理者（全部，含帳號與設定）、一般（執行流程、改元件、建立與刪除專案）、唯讀（只能看）。
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Select, ConfirmButton } from './fields.jsx';
import { Logo } from './icons.jsx';

const ROLE_HINT = { admin: '全部功能，含帳號與設定', editor: '執行流程、改元件、建立與刪除專案', viewer: '只能看，不能修改' };
const when = t => new Date(t).toLocaleString();

// 登入畫面（有帳號之後、還沒登入時整頁顯示）
export function Login({ onDone }) {
  const [name, setName] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.login({ name, password }); onDone(); } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <div className="login">
      <form className="card form" onSubmit={submit}>
        <div className="login-brand"><Logo size={30} /><div><h1>3D工作室</h1><div className="mute">請登入</div></div></div>
        <label><span>帳號</span><input value={name} onChange={e => setName(e.target.value)} autoFocus autoComplete="username" /></label>
        <label><span>密碼</span><input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {error && <div className="bad">{error}</div>}
        <button className="primary big" disabled={busy || !name || !password}>{busy ? '登入中…' : '登入'}</button>
        <small className="mute">忘記密碼請找管理者重設；管理者自己忘記時，在這台電腦執行 <code>node studio/vs3d.mjs users passwd &lt;帳號&gt; --password &lt;新密碼&gt;</code>。</small>
      </form>
    </div>
  );
}

// 改自己的密碼
export function ChangePassword({ onClose }) {
  const [current, setCurrent] = useState(''), [password, setPassword] = useState(''), [again, setAgain] = useState(''), [msg, setMsg] = useState('');
  async function submit(e) {
    e.preventDefault();
    if (password !== again) return setMsg('✗ 兩次輸入的新密碼不一樣');
    try { await api.changePassword({ current, password }); setMsg('✓ 已更新'); setCurrent(''); setPassword(''); setAgain(''); } catch (err) { setMsg('✗ ' + err.message); }
  }
  return (
    <section className="card form">
      <h3>改密碼</h3>
      <form className="form" onSubmit={submit}>
        <div className="row">
          <label><span>目前的密碼</span><input type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" /></label>
          <label><span>新密碼（至少 8 個字）</span><input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" /></label>
          <label><span>再輸入一次</span><input type="password" value={again} onChange={e => setAgain(e.target.value)} autoComplete="new-password" /></label>
        </div>
        <div className="bar"><button className="primary" disabled={!current || password.length < 8 || !again}>更新密碼</button>{onClose && <button type="button" onClick={onClose}>關閉</button>}<span className={msg.startsWith('✗') ? 'bad' : 'ok'}>{msg}</span></div>
      </form>
    </section>
  );
}

export function Accounts({ me, onAuthChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', display: '', role: 'editor', password: '' });
  const [reset, setReset] = useState(null);      // 正在重設密碼的帳號：{ name, password }
  const load = useCallback(() => api.users().then(d => { setData(d); setError(''); }).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const act = async fn => { setError(''); try { await fn(); await load(); } catch (e) { setError(e.message); } };
  if (!data) return <div className="page narrow mute">{error || '載入中…'}</div>;
  const first = !data.enabled, roles = Object.entries(data.roles);

  async function create(e) {
    e.preventDefault(); setError('');
    try {
      if (first) { await api.setup(form); onAuthChange(); }      // 第一個帳號：建立後直接登入
      else await api.createUser(form);
      setForm({ name: '', display: '', role: 'editor', password: '' }); await load();
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="page narrow">
      <h2>帳號</h2>
      <p className="sub">{first ? '現在還沒有任何帳號，介面不需要登入（單機模式）。建立第一個管理者之後，所有人都要登入才能使用。' : '登入這個介面的帳號與權限。帳號資料只存在這台電腦，不進版控。'}</p>
      {error && <div className="notice bad">{error}</div>}

      {!first && <section className="card">
        <h3>帳號清單<span className="chip">{data.users.length}</span></h3>
        <div className="scroll"><table className="data"><thead><tr><th>帳號</th><th>顯示名稱</th><th>角色</th><th>狀態</th><th>建立</th><th /></tr></thead><tbody>
          {data.users.map(u => <tr key={u.name}>
            <td><b>{u.name}</b>{u.name === data.me && <span className="chip run">你</span>}</td>
            <td>{u.display}</td>
            <td><Select value={u.role} onChange={v => act(() => api.updateUser(u.name, { role: v }))} options={roles} title={ROLE_HINT[u.role]} /></td>
            <td><label className="check"><input type="checkbox" checked={!u.disabled} onChange={e => act(() => api.updateUser(u.name, { disabled: !e.target.checked }))} /> 啟用</label></td>
            <td className="mute nowrap">{u.createdAt?.slice(0, 10)}</td>
            <td className="ops"><button type="button" onClick={() => setReset(reset?.name === u.name ? null : { name: u.name, password: '' })}>重設密碼</button>
              {u.name !== data.me && <ConfirmButton onConfirm={() => act(() => api.deleteUser(u.name))} />}</td>
          </tr>)}
        </tbody></table></div>
        {reset && <form className="bar" onSubmit={e => { e.preventDefault(); act(async () => { await api.updateUser(reset.name, { password: reset.password }); setReset(null); }); }}>
          <span>重設 <b>{reset.name}</b> 的密碼：</span>
          <input type="password" value={reset.password} onChange={e => setReset({ ...reset, password: e.target.value })} placeholder="新密碼（至少 8 個字）" autoComplete="new-password" />
          <button className="primary" disabled={reset.password.length < 8}>確定</button><button type="button" onClick={() => setReset(null)}>取消</button>
        </form>}
        <p className="mute hint" style={{ marginTop: 10 }}>{roles.map(([k, label]) => `${label}：${ROLE_HINT[k]}`).join('　｜　')}。改角色、停用或重設密碼後，那個帳號要重新登入。</p>
      </section>}

      <section className="card form">
        <h3>{first ? '建立第一個管理者' : '新增帳號'}</h3>
        <form className="form" onSubmit={create}>
          <div className="row">
            <label><span>帳號</span><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="英數，例如 kevin" autoComplete="off" /></label>
            <label><span>顯示名稱</span><input value={form.display} onChange={e => setForm({ ...form, display: e.target.value })} placeholder="可留空" /></label>
            {!first && <label><span>角色</span><Select value={form.role} onChange={v => setForm({ ...form, role: v })} options={roles} /></label>}
            <label><span>密碼（至少 8 個字）</span><input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></label>
          </div>
          <div className="bar"><button className="primary" disabled={!form.name || form.password.length < 8}>{first ? '建立並登入' : '新增'}</button>
            {first && <span className="mute">建立後這個瀏覽器會直接登入；之後其他人要用就在這裡幫他開帳號。</span>}</div>
        </form>
      </section>

      {me && <ChangePassword />}

      {!first && <section className="card">
        <h3>操作紀錄<span className="chip">最近 {data.audit.length} 筆</span></h3>
        {data.audit.length ? <div className="scroll" style={{ maxHeight: 360, overflowY: 'auto' }}><table className="data"><thead><tr><th>時間</th><th>帳號</th><th>操作</th><th>結果</th></tr></thead><tbody>
          {data.audit.map((a, i) => <tr key={i}><td className="mute nowrap">{when(a.at)}</td><td>{a.user}</td><td>{a.action || <><code>{a.method}</code> {decodeURIComponent(a.path || '')}</>}</td>
            <td>{a.status ? <span className={a.status < 400 ? 'ok' : 'bad'}>{a.status < 400 ? '成功' : `失敗（${a.status}）`}</span> : ''}</td></tr>)}
        </tbody></table></div> : <p className="mute">還沒有紀錄（只記會改東西的操作）。</p>}
      </section>}
    </div>
  );
}
