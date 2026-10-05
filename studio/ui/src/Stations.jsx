// 本庫的站：project-site/ 底下的各站，用卡片列出；點進去是和工作區專案相同的專案頁（審查、修改指令、第二段、檢查、匯出）。
// 這些站不放在左邊的專案清單，集中在這一頁。
import { STAGE } from './api.js';
import { Icon } from './icons.jsx';

export function Stations({ projects, query = '', go }) {
  const q = query.trim().toLowerCase();
  const list = projects.filter(p => p.repo).sort((a, b) => a.name.localeCompare(b.name));
  const shown = q ? list.filter(p => `${p.title} ${p.name} ${p.summary}`.toLowerCase().includes(q)) : list;
  const dirty = list.filter(p => p.dirty?.length > 0).length;
  return (
    <div className="page wide">
      <div className="head">
        <div><h2>本庫的站</h2>
          <div className="sub" style={{ marginBottom: 0 }}>本庫 <code>project-site/</code> 底下的 {list.length} 個站。可以直接下審查、修改指令、第二段、檢查與匯出；每次指令開本機分支、只提交該站的路徑。
            {dirty > 0 && <span className="warn">　{dirty} 個站有未提交的改動（別的工具改的），要先提交或處理才能開始流程。</span>}</div></div>
      </div>
      {!list.length && <section className="card"><p className="mute">沒有本庫的站（從本庫以外的位置啟動，或啟動時加了 --no-repo）。</p></section>}
      {list.length > 0 && !shown.length && <p className="mute">沒有符合「{query}」的站。</p>}
      <div className="cards">
        {shown.map(p => (
          <button key={p.id} className="scard" onClick={() => go({ view: 'project', id: p.id })}>
            <div><b>{p.title}</b><div className="s-name">{p.name}</div></div>
            {p.summary && <div className="s-sum">{p.summary}</div>}
            <div className="s-meta">
              <span className={`chip ${p.running ? 'run' : p.stage === 'done' ? 'ok' : 'warn'}`}>{p.running ? '執行中' : (p.segment === 2 ? '第二段 · ' : '') + (STAGE[p.stage] || p.stage)}</span>
              {p.pending > 0 && <span className="chip warn">{p.pending} 個問題</span>}
              {p.dirty?.length > 0 && <span className="chip warn" title={`別的工具改過、還沒提交：\n${p.dirty.slice(0, 10).join('\n')}`}>{p.dirty.length} 個未提交</span>}
              {p.lastCheck && <span className={`chip ${p.lastCheck.ok ? 'ok' : 'bad'}`}>最近檢查{p.lastCheck.ok ? '通過' : '未過'}</span>}
              {p.branch && p.flowActive && <span className="chip" title="進行中的 vs3d 分支"><Icon name="branch" size={12} /> {p.branch}</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
