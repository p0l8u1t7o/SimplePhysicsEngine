// 儀表板首頁：專案總覽、代理執行統計、檢查與審查結果、元件資料庫統計（資料來自 /api/dashboard，每 10 秒更新）。
import { useCallback, useEffect, useState } from 'react';
import { api, STAGE, ROLE } from './api.js';
import { Icon } from './icons.jsx';
import { ChartCard, StatTile, BarList, Columns, Ring, Meter, SERIES, num } from './charts.jsx';

const STAGE_ORDER = ['plan', 'build', 'change', 'check', 'fix', 'review', 'review-fix', 'render', 'render-guard', 'render-revise', 'paused', 'done'];
const RENDER = { accepted: '已接受', reverted: '已還原', 'accepted-with-failures': '已接受（守門未全過）' };
const CLI = { claude: 'Claude Code', codex: 'Codex' };
const mins = s => s / 60;
const dur = s => s >= 3600 ? `${(s / 3600).toFixed(1)} 小時` : s >= 60 ? `${(s / 60).toFixed(1)} 分` : `${Math.round(s)} 秒`;
const ago = t => { const m = (Date.now() - new Date(t)) / 60000; return m < 1 ? '剛剛' : m < 60 ? `${Math.floor(m)} 分鐘前` : m < 1440 ? `${Math.floor(m / 60)} 小時前` : `${Math.floor(m / 1440)} 天前`; };
const twd = v => `NT$ ${Math.round(v).toLocaleString('en-US')}`;
// 狀態一律「圖示＋文字」，不只靠顏色
const Status = ({ ok, children }) => <span className={`status ${ok ? 'good' : 'bad'}`}><Icon name={ok ? 'check' : 'alert'} size={14} />{children}</span>;

export function Dashboard({ go, tick }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.dashboard().then(v => { setD(v); setError(''); }).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => { const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);
  if (!d) return <div className="page wide mute">{error ? `讀不到資料：${error}` : '載入中…'}</div>;

  const { projects, agents, stations, parts, running } = d;
  const open = id => go({ view: 'project', id });
  const pending = projects.reduce((n, p) => n + p.pending, 0), firstPending = projects.find(p => p.pending > 0);
  const dirty = projects.filter(p => p.dirty?.length > 0), checked = stations.filter(s => s.check), failing = checked.filter(s => s.check.failed > 0);
  const reviewed = stations.filter(s => s.must != null), clean = reviewed.filter(s => s.must === 0);
  const stageRows = STAGE_ORDER.map(k => ({ key: k, label: STAGE[k] || k, value: projects.filter(p => p.stage === k).length })).filter(r => r.value > 0);
  const partsOk = parts && !parts.error;

  // 代理執行：每天耗時（分）、各角色耗時（依 CLI 堆疊）
  const clis = agents.clis.slice(0, 3), active = agents.daily.filter(x => x.rounds > 0);
  const daily = agents.daily.map(x => ({ label: x.day.slice(5).replace('-', '/'), tipTitle: x.day, value: mins(x.seconds), tip: [['耗時', dur(x.seconds), SERIES[0]], ['輪數', `${x.rounds} 輪`]] }));
  const roleRows = agents.byRole.map(r => ({ label: ROLE[r.role] || r.role, value: mins(r.seconds), parts: clis.map(c => mins(r.byCli[c]?.seconds || 0)), raw: r })).sort((a, b) => b.value - a.value);

  return (
    <div className="page wide dash">
      <div className="head">
        <div><h2>儀表板</h2><div className="sub">專案進度、代理執行、檢查結果與元件資料庫的總覽。</div></div>
        <button className="primary" onClick={() => go({ view: 'new' })}><Icon name="plus" size={16} />新建專案</button>
      </div>
      {error && <div className="notice bad">更新失敗：{error}（顯示的是上一次的資料）</div>}

      <div className="stats">
        <StatTile icon="folder" label="專案" value={projects.length} sub={`工作區 ${projects.filter(p => !p.repo).length} · 本庫 ${projects.filter(p => p.repo).length}`} />
        <StatTile icon="play" label="執行中" value={running ? 1 : 0} sub={running ? `${running.id}（${running.cmd}）` : '目前沒有在執行'} tone={running ? 'run' : ''} onClick={running ? () => open(running.id) : undefined} />
        <StatTile icon="question" label="待回答的問題" value={pending} sub={firstPending ? `${firstPending.title} 等 ${projects.filter(p => p.pending > 0).length} 個專案` : '沒有等待中的問題'} tone={pending ? 'warn' : ''} onClick={firstPending ? () => open(firstPending.id) : undefined} />
        <StatTile icon="branch" label="有未提交改動的站" value={dirty.length} sub={dirty.length ? `共 ${dirty.reduce((n, p) => n + p.dirty.length, 0)} 個檔案` : '本庫的站都是乾淨的'} tone={dirty.length ? 'warn' : ''} onClick={dirty.length ? () => open(dirty[0].id) : undefined} />
        <StatTile icon="alert" label="檢查未過的站" value={failing.length} sub={`${checked.length} 站有檢查結果`} tone={failing.length ? 'bad' : ''} onClick={failing.length ? () => open(failing[0].id) : undefined} />
        <StatTile icon="parts" label="元件" value={partsOk ? num(parts.parts) : '—'} sub={partsOk ? `${num(parts.prices)} 筆價格 · ${parts.suppliers} 家供應商` : parts?.error} onClick={() => go({ view: 'parts' })} />
      </div>

      <h4 className="sect">專案總覽</h4>
      <div className="dgrid">
        <ChartCard className="span5" title="各階段的專案數" sub="本庫的站沒有進行中的流程時算「完成」"
          table={{ head: ['階段', '專案數'], rows: stageRows.map(r => [r.label, r.value]) }}>
          <BarList rows={stageRows} unit=" 個" empty="還沒有專案" />
        </ChartCard>
        <section className="card span7">
          <div className="chart-h"><div><h3>最近更新</h3></div></div>
          {projects.length ? <table className="data click"><thead><tr><th>專案</th><th>階段</th><th>狀態</th><th>更新</th></tr></thead><tbody>
            {projects.slice(0, 7).map(p => <tr key={p.id} tabIndex={0} onClick={() => open(p.id)} onKeyDown={e => { if (e.key === 'Enter') open(p.id); }}>
              <td><b>{p.title}</b><div className="mute small">{p.repo ? '本庫' : '工作區'} · {p.name}</div></td>
              <td><span className={`chip ${p.running ? 'run' : p.stage === 'done' ? 'ok' : ''}`}>{p.running ? '執行中' : (p.segment === 2 ? '第二段 · ' : '') + (STAGE[p.stage] || p.stage)}</span></td>
              <td>{p.pending > 0 && <span className="chip warn">{p.pending} 個問題</span>}{p.dirty?.length > 0 && <span className="chip warn">{p.dirty.length} 個未提交</span>}{!p.pending && !p.dirty?.length && <span className="mute">—</span>}</td>
              <td className="mute nowrap">{ago(p.updated)}</td>
            </tr>)}
          </tbody></table> : <p className="mute empty">還沒有專案，按右上角「新建專案」開始。</p>}
        </section>
      </div>

      <h4 className="sect">代理執行統計</h4>
      {agents.totals.rounds === 0 ? <section className="card"><p className="mute empty">還沒有代理執行紀錄。用 vs3d 跑過規劃、開發、修正、審查或補強之後，這裡會列出各角色的輪數與耗時。</p></section> : <div className="dgrid">
        <ChartCard className="span7" title="每天的代理耗時" sub={`最近 ${agents.daily.length} 天，單位：分鐘；深色是耗時最多的一天`}
          table={{ head: ['日期', '耗時（分）', '輪數'], rows: agents.daily.map(x => [x.day, +mins(x.seconds).toFixed(1), x.rounds]) }}>
          <Columns data={daily} unit=" 分" every={2} avg={active.length > 1 ? mins(active.reduce((n, x) => n + x.seconds, 0)) / active.length : null} avgLabel="有執行的日子平均" />
        </ChartCard>
        <ChartCard className="span5" title="各角色的耗時" sub="單位：分鐘" legend={clis.map(c => CLI[c] || c)}
          table={{ head: ['角色', ...clis.map(c => `${CLI[c] || c}（分）`), '合計（分）', '輪數', '失敗'], rows: roleRows.map(r => [r.label, ...r.parts.map(v => +v.toFixed(1)), +r.value.toFixed(1), r.raw.rounds, r.raw.failed]) }}>
          <div className="facts">
            <div><b>{agents.totals.rounds}</b><span>輪</span></div>
            <div><b>{dur(agents.totals.seconds)}</b><span>合計耗時</span></div>
            <div><b>{agents.totals.failed}</b><span>失敗的輪</span></div>
            <div><b>{agents.totals.violations}</b><span>越界寫入</span></div>
          </div>
          <BarList rows={roleRows} series={clis.map(c => CLI[c] || c)} format={v => num(+v.toFixed(1))} unit=" 分" />
        </ChartCard>
        <section className="card span12">
          <div className="chart-h"><div><h3>最近的執行</h3></div></div>
          <div className="scroll"><table className="data click"><thead><tr><th>專案</th><th>輪</th><th>角色</th><th>CLI／模型</th><th className="num">耗時</th><th>結果</th><th>開始</th></tr></thead><tbody>
            {agents.recent.map((r, i) => <tr key={i} tabIndex={0} onClick={() => open(r.id)} onKeyDown={e => { if (e.key === 'Enter') open(r.id); }}>
              <td><b>{r.title}</b></td><td>{r.round}</td><td>{ROLE[r.role] || r.role}</td><td>{CLI[r.cli] || r.cli} <span className="mute">{r.model}</span></td><td className="num">{dur(r.seconds)}</td>
              <td><Status ok={r.ok}>{r.ok ? '完成' : '失敗'}</Status>{r.violations > 0 && <span className="chip warn">越界 {r.violations}</span>}</td><td className="mute nowrap">{ago(r.at)}</td>
            </tr>)}
          </tbody></table></div>
        </section>
      </div>}

      <h4 className="sect">檢查與審查結果</h4>
      <div className="dgrid">
        <section className="card span4 rings">
          <div className="chart-h"><div><h3>彙整</h3></div></div>
          <Ring slot={0} done={checked.length - failing.length} total={checked.length} label="檢查全過的站" detail={failing.length ? `${failing.length} 站未過` : ''} />
          <Ring slot={1} done={reviewed.length} total={stations.length} label="審查過的專案" />
          <Ring slot={2} done={clean.length} total={reviewed.length} label="審查沒有必修項" />
        </section>
        <section className="card span8">
          <div className="chart-h"><div><h3>各站最近一次的結果</h3><div className="mute chart-sub">本庫的站取 core 檢查寫在 TEMP/ 的結果，工作區的專案取 vs3d 最近一次檢查</div></div></div>
          <div className="scroll"><table className="data click"><thead><tr><th>專案</th><th>檢查</th><th>未過的項目</th><th className="num">審查</th><th className="num">必修</th><th className="num">建議</th><th>補強</th></tr></thead><tbody>
            {stations.map(s => <tr key={s.id} tabIndex={0} onClick={() => open(s.id)} onKeyDown={e => { if (e.key === 'Enter') open(s.id); }}>
              <td><b>{s.title}</b></td>
              <td className="nowrap">{s.check ? <Status ok={!s.check.failed}>{s.check.failed ? `${s.check.failed} 項未過` : `${s.check.passed} 項通過`}</Status> : <span className="mute">沒有結果</span>}{s.check?.at && <div className="mute small">{ago(s.check.at)}</div>}</td>
              <td className="mute">{s.check?.failures.map(f => f.check).join('、') || '—'}</td>
              <td className="num">{s.reviews || '—'}</td><td className="num">{s.must ?? '—'}</td><td className="num">{s.suggest ?? '—'}</td>
              <td>{s.render ? RENDER[s.render] || s.render : <span className="mute">—</span>}</td>
            </tr>)}
            {!stations.length && <tr><td colSpan={7} className="mute">還沒有專案</td></tr>}
          </tbody></table></div>
        </section>
      </div>

      <h4 className="sect">元件資料庫</h4>
      {!partsOk ? <section className="card"><p className="mute empty">讀不到元件資料庫：{parts?.error}</p></section> : parts.parts === 0 ? <section className="card"><p className="mute empty">元件資料庫還是空的：到「元件庫」新增，或執行 <code>node studio/vs3d.mjs parts seed</code> 從各站的成本表匯入。</p></section> : <PartsStats parts={parts} go={go} />}
    </div>
  );
}

function PartsStats({ parts, go }) {
  const top = parts.categories.slice(0, 20), rest = parts.categories.slice(20);
  const catRows = [...top.map(c => ({ label: c.name || '（未分類）', value: c.count })), ...(rest.length ? [{ label: `其他 ${rest.length} 類`, value: rest.reduce((n, c) => n + c.count, 0) }] : [])];
  const q = parts.quality, expired = parts.expiring.filter(x => x.valid_until < parts.today);
  return <div className="dgrid">
    <ChartCard className="span5" title="各類別的元件數" table={{ head: ['類別', '元件數'], rows: parts.categories.map(c => [c.name || '（未分類）', c.count]) }}
      action={<button type="button" className="ghost" onClick={() => go({ view: 'parts' })}>開啟元件庫</button>}>
      <BarList rows={catRows} unit=" 個" />
    </ChartCard>
    <ChartCard className="span4" title="各專案用到的元件" sub="下表是各成本表的參考金額：數量 × 最新單價（新台幣；選配數量為 0 不計）"
      table={{ head: ['專案', '來源檔', '品項', '參考金額 NT$'], rows: parts.sources.map(s => [s.project, s.source || '（手動）', s.items, Math.round(s.amount)]) }}>
      <BarList rows={parts.projects.map(p => ({ label: p.name, value: p.parts }))} unit=" 個" empty="還沒有使用紀錄" />
      <table className="data compact"><tbody>{parts.sources.map(s => <tr key={s.project + s.source}><td>{s.project}<div className="mute small">{s.source || '（手動）'} · {s.items} 項</div></td><td className="num">{twd(s.amount)}</td></tr>)}</tbody></table>
    </ChartCard>
    <section className="card span3">
      <div className="chart-h"><div><h3>資料整理進度</h3></div></div>
      <Meter slot={0} label="已分類" done={q.total - q.uncategorized} total={q.total} />
      <Meter slot={1} label="有價格" done={q.total - q.unpriced} total={q.total} />
      <Meter slot={2} label="價格有供應商" done={q.total - q.unpriced - q.noSupplier} total={q.total - q.unpriced} />
      <h3 className="sub-h">報價到期提醒</h3>
      {parts.expiring.length ? <ul className="plain">{parts.expiring.slice(0, 6).map(x => <li key={x.id}>
        <span className={`status ${x.valid_until < parts.today ? 'bad' : 'warn'}`}><Icon name={x.valid_until < parts.today ? 'alert' : 'clock'} size={14} />{x.valid_until < parts.today ? '已過期' : '快到期'}</span>
        <b>{x.name}</b><div className="mute small">{x.valid_until}{x.supplier ? ` · ${x.supplier}` : ''}</div></li>)}
        {parts.expiring.length > 6 && <li className="mute small">…另外 {parts.expiring.length - 6} 筆（已過期 {expired.length} 筆）</li>}</ul>
        : <p className="mute small">30 天內沒有到期的報價（只看有填有效期限的最新價格）。</p>}
    </section>
  </div>;
}
