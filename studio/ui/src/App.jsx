// 版面：左側深綠側欄（導覽、專案清單、新建專案），右側主面板（上方是搜尋與狀態列，下面是選取的畫面）。
// 網址 hash 記住目前的畫面（#home 儀表板、#new、#parts、#settings、#p/<專案>）。
import { useCallback, useEffect, useState } from 'react';
import { api, useEvents, STAGE } from './api.js';
import { NewProject } from './NewProject.jsx';
import { ProjectView } from './ProjectView.jsx';
import { Settings } from './Settings.jsx';
import { Parts } from './Parts.jsx';
import { Dashboard } from './Dashboard.jsx';
import { Icon, Logo } from './icons.jsx';

const NAV = [['home', '儀表板', 'home'], ['parts', '元件庫', 'parts'], ['settings', '設定', 'settings']];
// 外觀：跟著系統 → 淺色 → 深色
const THEMES = { auto: ['auto', '外觀：跟著系統'], light: ['sun', '外觀：淺色'], dark: ['moon', '外觀：深色'] };
const readHash = () => { const h = decodeURIComponent(location.hash.slice(1)); return h.startsWith('p/') ? { view: 'project', id: h.slice(2) } : { view: h || 'home' }; };
const savedTheme = () => { try { return localStorage.getItem('vs3d-theme') || 'auto'; } catch { return 'auto'; } };

export function App() {
  const [route, setRoute] = useState(readHash());
  const [info, setInfo] = useState(null);
  const [projects, setProjects] = useState([]);
  const [running, setRunning] = useState(null);
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState(savedTheme);
  const go = r => { location.hash = r.view === 'project' ? `p/${r.id}` : r.view; };
  useEffect(() => { const f = () => setRoute(readHash()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = theme;
    try { localStorage.setItem('vs3d-theme', theme); } catch { /* 私密視窗：不記住也沒關係 */ }
  }, [theme]);

  const refresh = useCallback(async () => {
    try { const j = await api.projects(); setProjects(j.projects); setRunning(j.running); } catch { /* 伺服器重啟中 */ }
  }, []);
  useEffect(() => { api.info().then(setInfo).catch(() => {}); refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);
  useEvents({
    hello: d => setRunning(d.running),
    line: () => setTick(t => t + 1),
    exit: () => { refresh(); setTick(t => t + 1); },
  });

  const q = query.trim().toLowerCase(), shown = q ? projects.filter(p => `${p.title} ${p.name}`.toLowerCase().includes(q)) : projects;
  const waiting = projects.filter(p => p.pending > 0), questions = waiting.reduce((n, p) => n + p.pending, 0);
  const [themeIcon, themeLabel] = THEMES[theme];
  const sections = [['工作區', shown.filter(p => !p.repo)], ['本庫 project-site', shown.filter(p => p.repo).sort((a, b) => a.name.localeCompare(b.name))]].filter(([, list]) => list.length);

  return (
    <div className="app">
      <aside className="side">
        <header className="brand"><Logo /><div><h1>3D 設備動畫</h1><div className="ws">vs3d studio</div></div></header>
        <nav className="nav">
          {NAV.map(([view, label, icon]) => <button key={view} className={route.view === view ? 'on' : ''} onClick={() => go({ view })}><Icon name={icon} />{label}</button>)}
        </nav>
        <div className="list">
          {/* 兩個分區：工作區的專案、本庫 project-site/ 的站（本庫模式） */}
          {sections.map(([label, list]) => <div key={label}>
            <div className="sec">{label}<span>{list.length}</span></div>
            {list.map(p => (
              <button key={p.id} className={`item ${route.id === p.id ? 'on' : ''}`} onClick={() => go({ view: 'project', id: p.id })}>
                <div className="t"><span className={`dot ${p.running ? 'run' : p.pending > 0 || p.dirty?.length > 0 ? 'warn' : p.stage === 'done' ? 'ok' : ''}`} />{p.title}</div>
                <div className="m">
                  <span className={`chip ${p.running ? 'run' : p.stage === 'done' ? 'ok' : ''}`}>{p.running ? '執行中' : (p.segment === 2 ? '第二段 · ' : '') + (STAGE[p.stage] || p.stage)}</span>
                  {p.pending > 0 && <span className="chip warn">{p.pending} 個問題</span>}
                  {p.dirty?.length > 0 && <span className="chip warn" title={`別的工具改過、還沒提交：\n${p.dirty.slice(0, 10).join('\n')}`}>{p.dirty.length} 個未提交</span>}
                  {p.render && <span className="chip">補強{p.render === 'accepted' ? '已接受' : p.render === 'reverted' ? '已還原' : ''}</span>}
                  {p.repo ? (p.branch && p.flowActive ? <span className="chip">{p.branch}</span> : null) : <span>{p.round} 輪</span>}
                </div>
              </button>
            ))}
          </div>)}
          {!projects.length && <p className="mute" style={{ padding: 10 }}>還沒有專案，按下面的「新建專案」開始。</p>}
          {projects.length > 0 && !shown.length && <p className="mute" style={{ padding: 10 }}>沒有符合「{query}」的專案。</p>}
        </div>
        <div className="side-foot">
          <button onClick={() => go({ view: 'new' })}><Icon name="plus" size={16} />新建專案</button>
          <div className="ws" title="工作區">{info?.ws}</div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <label className="search">
            <input type="search" value={query} placeholder="搜尋專案…" aria-label="搜尋專案" onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && shown.length) { go({ view: 'project', id: shown[0].id }); setQuery(''); } else if (e.key === 'Escape') setQuery(''); }} />
            <Icon name="search" />
          </label>
          <div className="tools">
            <button className={`state ${running ? 'run' : ''}`} disabled={!running} title={running ? '開啟正在執行的專案' : '目前沒有在執行'} onClick={() => running && go({ view: 'project', id: running.id })}>
              {running ? `● 執行中：${running.id}（${running.cmd}）` : '閒置'}</button>
            <button className="round" disabled={!questions} title={questions ? `${questions} 個問題等你回答：${waiting.map(p => p.title).join('、')}` : '沒有等待回答的問題'}
              onClick={() => waiting[0] && go({ view: 'project', id: waiting[0].id })}><Icon name="bell" />{questions > 0 && <span className="badge">{questions}</span>}</button>
            <button className="round avatar" title={`${themeLabel}（按一下切換）`} aria-label={themeLabel} onClick={() => setTheme(t => ({ auto: 'light', light: 'dark', dark: 'auto' })[t])}><Icon name={themeIcon} /></button>
          </div>
        </div>
        {route.view === 'home' && <Dashboard go={go} tick={tick} />}
        {route.view === 'new' && <NewProject info={info} running={running} onCreated={id => { refresh(); go({ view: 'project', id }); }} />}
        {route.view === 'settings' && <Settings info={info} />}
        {route.view === 'parts' && <Parts projectNames={projects.filter(p => p.repo).map(p => p.name)} />}
        {route.view === 'project' && <ProjectView key={route.id} id={route.id} tick={tick} running={running} onChange={refresh} />}
      </main>
    </div>
  );
}
