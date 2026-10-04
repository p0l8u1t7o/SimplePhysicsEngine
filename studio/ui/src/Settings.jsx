// 設定：兩種 CLI 的安裝與登入狀態；工作區各角色的 CLI＋模型（寫入 .studio/settings.json）。
import { useEffect, useState } from 'react';
import { api, ROLE } from './api.js';
import { CliSelect, ModelSelect, EffortSelect } from './fields.jsx';

export function Settings({ info }) {
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
    </div>
  );
}
