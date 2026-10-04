// 版面：左側專案清單（新建、設定），右側是選取的畫面。網址 hash 記住目前的畫面（#new、#settings、#p/<專案>）。
import { useCallback, useEffect, useState } from 'react';
import { api, useEvents, STAGE } from './api.js';
import { NewProject } from './NewProject.jsx';
import { ProjectView } from './ProjectView.jsx';
import { Settings } from './Settings.jsx';

const readHash = () => { const h = decodeURIComponent(location.hash.slice(1)); return h.startsWith('p/') ? { view: 'project', id: h.slice(2) } : { view: h || 'home' }; };

export function App() {
  const [route, setRoute] = useState(readHash());
  const [info, setInfo] = useState(null);
  const [projects, setProjects] = useState([]);
  const [running, setRunning] = useState(null);
  const [tick, setTick] = useState(0);
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

  return (
    <div className="app">
      <aside className="side">
        <header>
          <h1>3D 設備動畫</h1>
          <div className="ws">{info?.ws}</div>
        </header>
        <div className="actions">
          <button className="primary" onClick={() => go({ view: 'new' })}>＋ 新建</button>
          <button onClick={() => go({ view: 'settings' })}>⚙ 設定</button>
        </div>
        <div className="list">
          {projects.map(p => (
            <button key={p.id} className={`item ${route.id === p.id ? 'on' : ''}`} onClick={() => go({ view: 'project', id: p.id })}>
              <div className="t">{p.title}</div>
              <div className="m">
                <span className={`chip ${p.running ? 'run' : p.stage === 'done' ? 'ok' : ''}`}>{p.running ? '執行中' : (p.segment === 2 ? '第二段 · ' : '') + (STAGE[p.stage] || p.stage)}</span>
                {p.pending > 0 && <span className="chip warn">{p.pending} 個問題</span>}
                {p.render && <span className="chip">補強{p.render === 'accepted' ? '已接受' : p.render === 'reverted' ? '已還原' : ''}</span>}
                <span>{p.round} 輪</span>
              </div>
            </button>
          ))}
          {!projects.length && <p className="mute" style={{ padding: 8 }}>還沒有專案，按「＋ 新建」開始。</p>}
        </div>
      </aside>
      <main className="main">
        {route.view === 'new' && <NewProject info={info} running={running} onCreated={id => { refresh(); go({ view: 'project', id }); }} />}
        {route.view === 'settings' && <Settings info={info} />}
        {route.view === 'project' && <ProjectView key={route.id} id={route.id} tick={tick} running={running} onChange={refresh} />}
        {route.view === 'home' && (
          <div className="page">
            <h2>歡迎</h2>
            <p className="sub">上傳規格、圖面、照片或影片，輸入需求，代理會產出配置提案、詢問需要你拍板的事，再做出 3D 動畫，並自動審查與補強細節。</p>
            <button className="primary" onClick={() => go({ view: 'new' })}>＋ 新建專案</button>
          </div>
        )}
      </main>
    </div>
  );
}
