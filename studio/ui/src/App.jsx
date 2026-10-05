// 版面：左側深綠側欄（導覽、工作區的專案清單、新建專案），右側主面板（上方是搜尋與狀態列，下面是選取的畫面）。
// 本庫 project-site/ 的站不放在側欄，集中在「本庫的站」那一頁。
// 網址 hash 記住目前的畫面（#home 儀表板、#stations、#new、#parts、#settings、#p/<專案>）。
import { useCallback, useEffect, useState } from 'react';
import { api, useEvents, STAGE } from './api.js';
import { NewProject } from './NewProject.jsx';
import { ProjectView } from './ProjectView.jsx';
import { Settings } from './Settings.jsx';
import { Parts } from './Parts.jsx';
import { Dashboard } from './Dashboard.jsx';
import { Stations } from './Stations.jsx';
import { Icon, Logo } from './icons.jsx';

const readHash = () => { const h = decodeURIComponent(location.hash.slice(1)); return h.startsWith('p/') ? { view: 'project', id: h.slice(2) } : { view: h || 'home' }; };

export function App() {
  const [route, setRoute] = useState(readHash());
  const [info, setInfo] = useState(null);
  const [projects, setProjects] = useState([]);
  const [running, setRunning] = useState(null);
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState('');
  const go = r => { location.hash = r.view === 'project' ? `p/${r.id}` : r.view; };
  useEffect(() => { const f = () => setRoute(readHash()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);

  const refresh = useCallback(async () => {
    try { const j = await api.projects(); setProjects(j.projects); setRunning(j.running); } catch { /* 伺服器重啟中 */ }
  }, []);
  useEffect(() => { api.info().then(setInfo).catch(() => {}); refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);
  useEvents({
    hello: d => setRunning(d.running),
    line: () => setTick(t => t + 1),
    exit: () => { refresh(); setTick(t => t + 1); },
  });

  const q = query.trim().toLowerCase(), match = p => !q || `${p.title} ${p.name}`.toLowerCase().includes(q);
  const mine = projects.filter(p => !p.repo), stations = projects.filter(p => p.repo), shown = mine.filter(match);
  const hits = [...shown, ...stations.filter(match)];            // 搜尋按 Enter：先開工作區的專案，再來是本庫的站
  const waiting = projects.filter(p => p.pending > 0), questions = waiting.reduce((n, p) => n + p.pending, 0);
  const inStations = route.view === 'stations' || (route.view === 'project' && route.id?.startsWith('@'));
  const nav = [['home', '儀表板', 'home', route.view === 'home'], ...(stations.length || info?.repo ? [['stations', '本庫的站', 'folder', inStations]] : []),
    ['parts', '元件庫', 'parts', route.view === 'parts'], ['settings', '設定', 'settings', route.view === 'settings']];

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
          <button onClick={() => go({ view: 'new' })}><Icon name="plus" size={16} />新建專案</button>
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
              {running ? `● 執行中：${running.id}（${running.cmd}）` : '閒置'}</button>
            <button className="round" disabled={!questions} title={questions ? `${questions} 個問題等你回答：${waiting.map(p => p.title).join('、')}` : '沒有等待回答的問題'}
              onClick={() => waiting[0] && go({ view: 'project', id: waiting[0].id })}><Icon name="bell" />{questions > 0 && <span className="badge">{questions}</span>}</button>
          </div>
        </div>
        {route.view === 'home' && <Dashboard go={go} tick={tick} />}
        {route.view === 'stations' && <Stations projects={projects} query={query} go={go} />}
        {route.view === 'new' && <NewProject info={info} running={running} onCreated={id => { refresh(); go({ view: 'project', id }); }} />}
        {route.view === 'settings' && <Settings info={info} />}
        {route.view === 'parts' && <Parts projectNames={stations.map(p => p.name)} />}
        {route.view === 'project' && <ProjectView key={route.id} id={route.id} tick={tick} running={running} onChange={refresh} onDeleted={() => { refresh(); go({ view: 'home' }); }} />}
      </main>
    </div>
  );
}
