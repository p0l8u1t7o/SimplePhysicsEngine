// 設定：兩種 CLI 的安裝與登入狀態；工作區各角色的 CLI＋模型（寫入 .studio/settings.json）。
import { useEffect, useState } from 'react';
import { api, ROLE } from './api.js';

export function Settings() {
  const [doctor, setDoctor] = useState(null);
  const [data, setData] = useState(null);
  const [roles, setRoles] = useState({});
  const [defaultCli, setDefaultCli] = useState('claude');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api.doctor().then(setDoctor).catch(e => setMsg(e.message));
    api.settings().then(d => { setData(d); setRoles(d.settings.roles || {}); setDefaultCli(d.settings.defaultCli || 'claude'); });
  }, []);
  const set = (r, k, v) => setRoles(x => ({ ...x, [r]: { ...x[r], [k]: v || undefined } }));
  async function save() {
    const clean = Object.fromEntries(Object.entries(roles).map(([r, v]) => [r, Object.fromEntries(Object.entries(v || {}).filter(([, x]) => x))]).filter(([, v]) => Object.keys(v).length));
    const d = await api.saveSettings({ defaultCli, roles: clean }); setData(d); setMsg('已儲存');
  }

  return (
    <div className="page">
      <h2>設定</h2>
      <div className="card"><h3>代理 CLI</h3>
        {!doctor ? <p className="mute">偵測中…</p> : <table><tbody>{doctor.map(a => <tr key={a.name}><td><b>{a.label}</b></td><td>{a.installed ? a.version : <span className="bad">未安裝</span>}</td>
          <td>{a.installed && (a.loggedIn ? <span className="ok">已登入 {a.detail}</span> : <span className="bad">未登入：{a.detail}</span>)}</td></tr>)}</tbody></table>}
      </div>
      <div className="card"><h3>角色與模型（這個工作區的預設）</h3>
        <p className="mute">空白代表用 app 預設：規劃、開發、修正、審查用 Claude opus，補強用 Codex gpt-6-astra 高推理。專案建立時指定的 CLI／模型、或專案的 studio.json 會優先。</p>
        <div className="bar"><label>預設 CLI　<select value={defaultCli} onChange={e => setDefaultCli(e.target.value)}><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label></div>
        <table><thead><tr><th>角色</th><th>CLI</th><th>模型</th><th>推理強度</th><th>目前實際指派</th></tr></thead><tbody>
          {Object.keys(ROLE).map(r => <tr key={r}><td>{ROLE[r]}</td>
            <td><select value={roles[r]?.cli || ''} onChange={e => set(r, 'cli', e.target.value)}><option value="">（預設）</option><option value="claude">Claude Code</option><option value="codex">Codex</option></select></td>
            <td><input value={roles[r]?.model || ''} onChange={e => set(r, 'model', e.target.value)} placeholder="（預設）" /></td>
            <td><input value={roles[r]?.effort || ''} onChange={e => set(r, 'effort', e.target.value)} placeholder="（預設）" style={{ width: 90 }} /></td>
            <td className="mute">{data?.resolved?.[r] ? `${data.resolved[r].cli} ${data.resolved[r].model || '（帳號預設）'}${data.resolved[r].effort ? ` ${data.resolved[r].effort}` : ''}` : ''}</td></tr>)}
        </tbody></table>
        <div className="bar"><button className="primary" onClick={() => save().catch(e => setMsg(e.message))}>儲存</button><span className="ok">{msg}</span></div>
      </div>
    </div>
  );
}
