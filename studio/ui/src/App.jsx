// 版面：左側深綠側欄（導覽、工作區的專案清單、新建專案），右側主面板（上方是搜尋與狀態列，下面是選取的畫面）。
// 本庫 project-site/ 的站不放在側欄，集中在「本庫的站」那一頁。
// 網址 hash 記住目前的畫面（#home 儀表板、#stations、#new、#parts、#settings、#accounts、#p/<專案>）。
// 有帳號之後要先登入（App 先問 /api/auth/me，沒登入就顯示登入頁）；還沒有任何帳號時和以前一樣直接使用。
import { useCallback, useEffect, useState } from 'react';
import { api, useEvents, STAGE } from './api.js';
import { NewProject } from './NewProject.jsx';
import { ProjectView } from './ProjectView.jsx';
import { Settings } from './Settings.jsx';
import { Parts } from './Parts.jsx';
import { Dashboard } from './Dashboard.jsx';
import { Stations } from './Stations.jsx';
import { Login, Accounts, ChangePassword } from './Accounts.jsx';
import { Icon, Logo } from './icons.jsx';

const readHash = () => { const h = decodeURIComponent(location.hash.slice(1)); return h.startsWith('p/') ? { view: 'project', id: h.slice(2) } : { view: h || 'home' }; };

export function App() {
  const [me, setMe] = useState(undefined);      // undefined：還在問伺服器；之後是 { required, user, roles }
  const loadMe = useCallback(() => api.me().then(setMe).catch(() => setMe({ required: false, user: null, roles: {} })), []);
  useEffect(() => { loadMe(); addEventListener('vs3d-unauthorized', loadMe); return () => removeEventListener('vs3d-unauthorized', loadMe); }, [loadMe]);
  if (me === undefined) return null;
  if (me.required && !me.user) return <Login onDone={loadMe} />;
  return <Shell me={me} onAuthChange={loadMe} />;
}

function Shell({ me, onAuthChange }) {
  const user = me.user, [menu, setMenu] = useState(false);
  const readOnly = user?.role === 'viewer';      // 唯讀帳號：會改東西的按鈕先停用（伺服器也會拒絕）
  const [route, setRoute] = useState(readHash());
  const [info, setInfo] = useState(null);
  const [projects, setProjects] = useState([]);
  const [running, setRunning] = useState(null);
  const [queue, setQueue] = useState([]);         // 代理佇列裡排隊中的（執行中的是 running）
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState('');
  const go = r => { location.hash = r.view === 'project' ? `p/${r.id}` : r.view; };
  useEffect(() => { const f = () => setRoute(readHash()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);

  const refresh = useCallback(async () => {
    try { const j = await api.projects(); setProjects(j.projects); setRunning(j.running); setQueue(j.queue || []); } catch { /* 伺服器重啟中 */ }
  }, []);
  useEffect(() => { api.info().then(setInfo).catch(() => {}); refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);
  useEvents({
    hello: d => { setRunning(d.running); setQueue(d.queue || []); },
    queue: d => { setRunning(d.running); setQueue(d.queue || []); refresh(); },
    line: () => setTick(t => t + 1),
    exit: () => { refresh(); setTick(t => t + 1); },
  });

  const q = query.trim().toLowerCase(), match = p => !q || `${p.title} ${p.name}`.toLowerCase().includes(q);
  const mine = projects.filter(p => !p.repo), stations = projects.filter(p => p.repo), shown = mine.filter(match);
  const hits = [...shown, ...stations.filter(match)];            // 搜尋按 Enter：先開工作區的專案，再來是本庫的站
  const waiting = projects.filter(p => p.pending > 0), questions = waiting.reduce((n, p) => n + p.pending, 0);
  const inStations = route.view === 'stations' || (route.view === 'project' && route.id?.startsWith('@'));
  const nav = [['home', '儀表板', 'home', route.view === 'home'], ...(stations.length || info?.repo ? [['stations', '本庫的站', 'folder', inStations]] : []),
    ['parts', '元件庫', 'parts', route.view === 'parts'], ['settings', '設定', 'settings', route.view === 'settings'],
    ...(!user || user.role === 'admin' ? [['accounts', '帳號', 'user', route.view === 'accounts']] : [])];

  return (
    <div className="app">
      <aside className="side">
        <header className="brand"><Logo /><div><h1>3D工作室</h1><div className="ws">vs3d studio</div></div></header>
        <nav className="nav">
          {nav.map(([view, label, icon, on]) => <button key={view} className={on ? 'on' : ''} onClick={() => go({ view })}><Icon name={icon} />{label}</button>)}
        </nav>
        <div className="list">
          <div className="sec">專案<span>{shown.length}</span></div>
          {shown.map(p => (
            <button key={p.id} className={`item ${route.id === p.id ? 'on' : ''}`} onClick={() => go({ view: 'project', id: p.id })}>
              <div className="t"><span className={`dot ${p.running ? 'run' : p.pending > 0 ? 'warn' : p.stage === 'done' ? 'ok' : ''}`} />{p.title}</div>
              <div className="m">
                <span className={`chip ${p.running ? 'run' : p.stage === 'done' ? 'ok' : ''}`}>{p.running ? '執行中' : (p.segment === 2 ? '第二段 · ' : '') + (STAGE[p.stage] || p.stage)}</span>
                {p.pending > 0 && <span className="chip warn">{p.pending} 個問題</span>}
                {p.render && <span className="chip">補強{p.render === 'accepted' ? '已接受' : p.render === 'reverted' ? '已還原' : ''}</span>}
                <span>{p.round} 輪</span>
              </div>
            </button>
          ))}
          {!mine.length && <p className="mute" style={{ padding: 10 }}>還沒有專案，按下面的「新建專案」開始。</p>}
          {mine.length > 0 && !shown.length && <p className="mute" style={{ padding: 10 }}>沒有符合「{query}」的專案。</p>}
        </div>
        <div className="side-foot">
          <button disabled={readOnly} title={readOnly ? '唯讀帳號不能建立專案' : undefined} onClick={() => go({ view: 'new' })}><Icon name="plus" size={16} />新建專案</button>
          <div className="ws" title="工作區">{info?.ws}</div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <label className="search">
            <input type="search" value={query} placeholder="搜尋專案或本庫的站…" aria-label="搜尋專案" onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && hits.length) { go({ view: 'project', id: hits[0].id }); setQuery(''); } else if (e.key === 'Escape') setQuery(''); }} />
            <Icon name="search" />
          </label>
          <div className="tools">
            <button className={`state ${running ? 'run' : ''}`} disabled={!running} title={running ? '開啟正在執行的專案' : '目前沒有在執行'} onClick={() => running && go({ view: 'project', id: running.id })}>
              {running ? `● 執行中：${running.id}（${running.cmd}${running.by ? `，${running.by}` : ''}）` : '閒置'}</button>
            {queue.length > 0 && <button className="state" title={`排隊中：${queue.map((q, i) => `${i + 1}. ${q.id}（${q.cmd}${q.by ? `，${q.by}` : ''}）`).join('\n')}`}
              onClick={() => go({ view: 'project', id: queue[0].id })}>排隊 {queue.length}</button>}
            <button className="round" disabled={!questions} title={questions ? `${questions} 個問題等你回答：${waiting.map(p => p.title).join('、')}` : '沒有等待回答的問題'}
              onClick={() => waiting[0] && go({ view: 'project', id: waiting[0].id })}><Icon name="bell" />{questions > 0 && <span className="badge">{questions}</span>}</button>
            {user && <div className="user">
              <button className="round avatar" title={`${user.display}（${me.roles[user.role]}）`} aria-expanded={menu} onClick={() => setMenu(m => !m)}>{user.display.slice(0, 1).toUpperCase()}</button>
              {menu && <div className="user-menu" onMouseLeave={() => setMenu(false)}>
                <div className="u-name"><b>{user.display}</b><span className="mute">{user.name} · {me.roles[user.role]}</span></div>
                <button onClick={() => { setMenu(false); go({ view: 'accounts' }); }}>{user.role === 'admin' ? '帳號管理' : '改密碼'}</button>
                <button onClick={() => api.logout().then(onAuthChange)}>登出</button>
              </div>}
            </div>}
          </div>
        </div>
        {user?.role === 'viewer' && <div className="notice warn" style={{ margin: '0 26px 10px' }}>你用的是唯讀帳號：可以看所有內容，不能執行流程或修改資料。</div>}
        {route.view === 'home' && <Dashboard go={go} tick={tick} />}
        {route.view === 'stations' && <Stations projects={projects} query={query} go={go} />}
        {route.view === 'new' && <fieldset className="plain" disabled={readOnly}><NewProject info={info} running={running} onCreated={id => { refresh(); go({ view: 'project', id }); }} /></fieldset>}
        {route.view === 'settings' && <Settings info={info} user={user} />}
        {route.view === 'accounts' && (!user || user.role === 'admin' ? <Accounts me={user} onAuthChange={onAuthChange} /> : <div className="page narrow"><h2>我的帳號</h2><p className="sub">{user.display}（{user.name}）· {me.roles[user.role]}</p><ChangePassword /></div>)}
        {route.view === 'parts' && <Parts projectNames={stations.map(p => p.name)} readOnly={readOnly} />}
        {route.view === 'project' && <ProjectView key={route.id} id={route.id} tick={tick} running={running} queue={queue} onChange={refresh} onDeleted={() => { refresh(); go({ view: 'home' }); }} />}
      </main>
    </div>
  );
}
