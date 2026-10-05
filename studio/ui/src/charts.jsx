// 儀表板的圖表元件（純 HTML／SVG，不用圖表套件）：數字卡、橫條圖（可堆疊）、直條圖、環形進度、進度條。
// 規則：長條細、資料端圓角 4 px、基線端直角；相鄰色塊留 2 px 間隙；文字一律用文字色，不用系列色；
// 每張圖都有滑鼠與鍵盤焦點的提示框，另有「表格」檢視。系列色（--s1～--s3）在 styles.css，淺色與深色各自驗證過。
import { useCallback, useState } from 'react';
import { Icon } from './icons.jsx';

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
const TRACKS = ['var(--s1-track)', 'var(--s2-track)', 'var(--s3-track)'];
// 百分比：沒有全部完成就不顯示 100%（238／239 顯示 99%）
const pct = (done, total) => done >= total ? 100 : Math.min(99, Math.round(done / total * 100));
export const num = v => Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 });
// 刻度上限取整：1、2、2.5、5 × 10ⁿ
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

// 提示框：滑鼠移到或鍵盤聚焦在圖形上時顯示。回傳 [提示框元素, 產生事件屬性的函式(標題, 列)]；列是 [[名稱, 值, 顏色?], …]
export function useTip() {
  const [tip, setTip] = useState(null);
  const bind = useCallback((title, rows) => {
    const show = (x, y) => setTip({ x, y, title, rows });
    return {
      tabIndex: 0,
      onPointerMove: e => show(e.clientX, e.clientY), onPointerLeave: () => setTip(null),
      // 聚焦時瀏覽器可能先把元素捲進畫面，下一格再量位置
      onFocus: e => { const el = e.currentTarget; requestAnimationFrame(() => { const r = el.getBoundingClientRect(); show(r.left + r.width / 2, r.top); }); }, onBlur: () => setTip(null),
    };
  }, []);
  const el = tip && <div className="tip" role="tooltip" style={{ left: Math.min(tip.x + 14, innerWidth - 240), top: Math.max(8, tip.y - 12) }}>
    <div className="tip-t">{tip.title}</div>
    {tip.rows.map(([k, v, c], i) => <div className="tip-r" key={i}>{c && <i style={{ background: c }} />}<b>{v}</b><span>{k}</span></div>)}
  </div>;
  return [el, bind];
}

// 圖表卡片：標題、說明、右上角切換「表格」檢視（table：{ head: [...], rows: [[...], …] }）
export function ChartCard({ title, sub, table, legend, action, className = '', children }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card chart ${className}`}>
      <div className="chart-h">
        <div><h3>{title}</h3>{sub && <div className="mute chart-sub">{sub}</div>}</div>
        <div className="chart-a">
          {action}
          {table && <button type="button" className="ghost" aria-pressed={asTable} title={asTable ? '回到圖表' : '用表格看同一份資料'} onClick={() => setAsTable(v => !v)}><Icon name={asTable ? 'chart' : 'table'} size={15} />{asTable ? '圖表' : '表格'}</button>}
        </div>
      </div>
      {legend?.length > 1 && !asTable && <div className="legend">{legend.map((l, i) => <span key={l}><i style={{ background: SERIES[i] }} />{l}</span>)}</div>}
      {asTable ? <div className="scroll"><table className="data"><thead><tr>{table.head.map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === 'number' ? 'num' : ''}>{typeof c === 'number' ? num(c) : c}</td>)}</tr>)}</tbody></table></div> : children}
    </section>
  );
}

// 數字卡：一個數字就用數字卡，不畫成圖
export function StatTile({ icon, label, value, sub, tone = '', onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return <Tag className={`stat ${tone}`} onClick={onClick} type={onClick ? 'button' : undefined}>
    <span className="stat-i"><Icon name={icon} size={20} /></span>
    <span className="stat-b"><span className="stat-l">{label}</span><span className="stat-v">{value}</span>{sub && <span className="stat-s">{sub}</span>}</span>
  </Tag>;
}

// 橫條圖。rows：[{ label, value, parts?: [各系列的值…], note? }]；series：系列名稱（給 parts 用，最多 3 個）。數值標在長條末端。
export function BarList({ rows, series, format = num, unit = '', onPick, empty = '沒有資料' }) {
  const [tipEl, tip] = useTip();
  if (!rows.length) return <p className="mute empty">{empty}</p>;
  const max = niceMax(Math.max(...rows.map(r => r.value)));
  return <div className="bars">
    {rows.map(r => {
      const parts = (r.parts || [r.value]).map((v, i) => ({ v, i })).filter(p => p.v > 0);
      const tipRows = series ? parts.map(p => [series[p.i], `${format(p.v)}${unit}`, SERIES[p.i]]).concat(parts.length > 1 ? [['合計', `${format(r.value)}${unit}`]] : []) : [[r.note || '數量', `${format(r.value)}${unit}`, SERIES[0]]];
      return <div className={`bar-r ${onPick ? 'pick' : ''}`} key={r.label} {...tip(r.label, tipRows)} onClick={onPick && (() => onPick(r))} onKeyDown={onPick && (e => { if (e.key === 'Enter') onPick(r); })}>
        <div className="bar-l" title={r.label}>{r.label}</div>
        <div className="bar-t">
          {parts.map((p, n) => <i key={p.i} className={n === parts.length - 1 ? 'end' : ''} style={{ width: `${p.v / max * 100}%`, background: SERIES[p.i] }} />)}
          <span className="bar-v">{format(r.value)}{unit}</span>
        </div>
      </div>;
    })}
    {tipEl}
  </div>;
}

// 直條圖（時間序列，單一系列）。data：[{ label, value, tip?: [[名稱, 值]] }]；mark：要強調並標出數值的那一根（預設最大值）；avg：畫出平均線
export function Columns({ data, format = num, unit = '', height = 190, every = 1, avg = null, avgLabel = '平均' }) {
  const [tipEl, tip] = useTip();
  const top = niceMax(Math.max(...data.map(d => d.value), avg || 0)), peak = data.reduce((a, d, i) => d.value > data[a].value ? i : a, 0);
  const ticks = [1, .75, .5, .25, 0];
  return <div className="cols" style={{ '--plot': `${height}px` }}>
    <div className="cols-y">{ticks.map(t => <span key={t} style={{ bottom: `${t * 100}%` }}>{format(top * t)}</span>)}</div>
    <div className="cols-p">
      {ticks.map(t => <div key={t} className={`gl ${t === 0 ? 'base' : ''}`} style={{ bottom: `${t * 100}%` }} />)}
      {avg > 0 && <div className="avg" style={{ bottom: `${avg / top * 100}%` }}><span>{avgLabel} {format(avg)}{unit}</span></div>}
      <div className="cols-b">
        {data.map((d, i) => <div className="col" key={d.label + i} {...tip(d.tipTitle || d.label, d.tip || [['', `${format(d.value)}${unit}`, SERIES[0]]])}>
          {i === peak && d.value > 0 && <span className="col-v" style={{ bottom: `${d.value / top * 100}%` }}>{format(d.value)}{unit}</span>}
          <i className={i === peak && d.value > 0 ? 'peak' : ''} style={{ height: `${d.value / top * 100}%` }} />
        </div>)}
      </div>
    </div>
    <div className="cols-x">{data.map((d, i) => <span key={d.label + i}>{i % every === 0 || i === data.length - 1 ? d.label : ''}</span>)}</div>
    {tipEl}
  </div>;
}

// 環形進度：一個比例（done／total）。底環是同色系的淺色；中間的百分比用文字色
export function Ring({ done, total, label, detail, slot = 0, size = 92 }) {
  const [tipEl, tip] = useTip();
  const ratio = total > 0 ? done / total : 0, r = (size - 12) / 2, c = 2 * Math.PI * r;
  return <div className="ring" {...tip(label, [[detail || '', `${done}／${total}`, SERIES[slot]]])}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}：${done}／${total}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={TRACKS[slot]} strokeWidth="10" />
      {ratio > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={SERIES[slot]} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${c * ratio} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="ring-t">{total > 0 ? `${pct(done, total)}%` : '—'}</text>
    </svg>
    <div><div className="ring-l">{label}</div><div className="ring-d">{total > 0 ? `${done}／${total}` : '沒有資料'}{detail ? `　${detail}` : ''}</div></div>
    {tipEl}
  </div>;
}

// 進度條：比例＋文字
export function Meter({ done, total, label, slot = 0 }) {
  const ratio = total > 0 ? done / total : 0;
  return <div className="meter">
    <div className="meter-h"><span>{label}</span><b>{total > 0 ? `${pct(done, total)}%` : '—'}</b><span className="mute">{done}／{total}</span></div>
    <div className="meter-t" style={{ background: TRACKS[slot] }} role="img" aria-label={`${label}：${done}／${total}`}><i style={{ width: `${ratio * 100}%`, background: SERIES[slot] }} /></div>
  </div>;
}
