// 光學工作台（評估平台 Q4）：從元件庫挑相機、鏡頭、光源（參數取元件的規格欄位，可以覆寫），設定工件與場景，
// 即時算出視野、解析度、最小缺陷、景深、運動模糊、頻寬、打光（core/optics，和 vs3d optics eval 同一份公式），右邊是 3D 視錐。
// 方案存在專案底下（AOI 方案），可以並排比較；「選用」會把相機、鏡頭、光源加進專案的成本表。
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, sameHost } from './api.js';
import { Select, ConfirmButton } from './fields.jsx';
import { flatten } from './PartsCategories.jsx';

const MOUNTS = ['', 'C', 'CS', 'F', 'M42', 'M58', 'M72'];
const F = {
  camera: [['sensorW', '感光元件寬', 'mm'], ['sensorH', '感光元件高', 'mm'], ['pixel', '像素尺寸', 'µm'], ['hPx', '水平像素', 'px'], ['vPx', '垂直像素', 'px'], ['fps', '幀率', 'fps'],
    ['interface', '介面', '', ['', 'GigE', '2.5GigE', '5GigE', '10GigE', 'USB3', 'CoaXPress', 'Camera Link']], ['mount', '鏡頭接口', '', MOUNTS], ['lineScan', '線掃描', '', ['', '是']], ['lineRate', '最高行頻', 'kHz']],
  lens: [['type', '鏡頭類型', '', ['', '定焦', '遠心', '變焦', '微距', '線掃描']], ['focal', '焦距', 'mm'], ['magnification', '倍率（遠心）', '×'], ['fNumber', '使用光圈', 'F'],
    ['imageCircle', '像圈', 'mm'], ['mount', '鏡頭接口', '', MOUNTS], ['mod', '最近對焦距離', 'mm'], ['wd', '工作距離（遠心）', 'mm']],
  light: [['type', '光源類型', '', ['', '環形', '條形', '穹頂', '同軸', '背光', '點光', '線光', '平面']], ['size', '發光尺寸', 'mm'], ['distance', '距離工件', 'mm'], ['beamAngle', '光束角', '°'], ['wavelength', '波長', 'nm']],
  scene: [['wd', '工作距離', 'mm'], ['target.w', '工件寬', 'mm'], ['target.h', '工件長', 'mm'], ['target.heightRange', '工件高低差', 'mm'], ['defect', '最小缺陷', 'mm'], ['pxPerDefect', '缺陷要佔幾個像素', 'px'],
    ['speed', '輸送速度', 'mm/s'], ['exposureUs', '曝光時間', 'µs'], ['taktS', '節拍', 's'], ['imagesPerCycle', '每節拍取像', '張']],
};
const TITLE = { camera: '相機', lens: '鏡頭', light: '光源', scene: '工件與場景' };
const CAT = { camera: '相機與讀碼', lens: '鏡頭與光學', light: '光源' };
const STATUS = { ok: '✓ 符合', warn: '! 注意', fail: '✗ 不符合', info: '' };
const BLANK = { camera: {}, lens: {}, light: {}, scene: { pxPerDefect: 3 }, quantity: {} };
const getIn = (o, path) => path.split('.').reduce((x, k) => x?.[k], o);
const setIn = (o, path, v) => { const [k, ...rest] = path.split('.'); return { ...o, [k]: rest.length ? setIn(o?.[k] || {}, rest.join('.'), v) : v }; };
const nt = v => v == null ? '—' : `NT$ ${Number(v).toLocaleString('en-US')}`;
// 數字欄位：空字串＝沒填（用元件的值）；其他轉成數字
const val = (f, v) => v === '' ? undefined : f[2] && !f[3] ? Number(v) : f[0] === 'lineScan' ? v === '是' : v;

export function Optics({ projects, catalogPort }) {
  const [project, setProject] = useState(''), [setups, setSetups] = useState([]), [cur, setCur] = useState({ id: null, name: '', data: BLANK });
  const [res, setRes] = useState(null), [msg, setMsg] = useState(''), [opts, setOpts] = useState({}), [cmp, setCmp] = useState(new Set());
  const frame = useRef(null);
  const proj = projects.find(p => p.id === project), canEdit = proj?.canEdit !== false;
  useEffect(() => { if (!project && projects.length) setProject(projects[0].id); }, [projects, project]);
  // 三種元件的候選：分類樹裡對應的分類（含子分類）
  useEffect(() => {
    api.categories().then(t => Promise.all(Object.entries(CAT).map(async ([k, name]) => {
      const node = flatten(t.nodes).find(n => n.name === name);
      return [k, node ? (await api.parts({ cat: node.id, limit: 500 })).parts : []];
    }))).then(e => setOpts(Object.fromEntries(e))).catch(e => setMsg('✗ ' + e.message));
  }, []);
  const loadSetups = useCallback(() => project && api.aoiList(project).then(r => setSetups(r.setups)).catch(e => setMsg('✗ ' + e.message)), [project]);
  useEffect(() => { loadSetups(); setCmp(new Set()); }, [loadSetups]);
  // 即時計算（停止輸入 300 ms 後），結果也送給 3D 檢視
  useEffect(() => {
    const t = setTimeout(() => api.opticsEval(cur.data).then(r => { setRes(r); frame.current?.contentWindow?.postMessage({ type: 'optics', setup: r.setup }, '*'); }).catch(e => setMsg('✗ ' + e.message)), 300);
    return () => clearTimeout(t);
  }, [cur.data]);
  const set = (path, v) => { setMsg(''); setCur(c => ({ ...c, data: setIn(c.data, path, v) })); };
  const filled = res?.setup || {};
  const act = async (fn, done) => { setMsg(''); try { await fn(); await loadSetups(); if (done) setMsg('✓ ' + done); } catch (e) { setMsg('✗ ' + e.message); } };
  const save = asNew => act(async () => { const r = await (cur.id && !asNew ? api.aoiSave(project, cur.id, cur) : api.aoiSave(project, null, cur)); setCur({ id: r.id, name: r.name, data: r.data }); }, '已儲存方案');
  const metric = (s, key) => s.result.results?.find(x => x.key === key);
  const shown = setups.filter(s => cmp.has(s.id));

  const section = kind => <section className="card form optics-sec" key={kind}><h3>{TITLE[kind]}{res?.parts?.[kind] && <span className="chip">{res.parts[kind].code}</span>}</h3>
    {kind !== 'scene' && <div className="row">
      <label style={{ flex: 3 }}><span>從元件庫挑</span><Select value={String(cur.data[kind]?.part ?? '')} onChange={v => set(`${kind}.part`, v || undefined)}
        options={[['', '（不引用，自己填參數）'], ...(opts[kind] || []).map(p => [p.code, `${p.code}　${p.name}${p.brand || p.model ? `｜${[p.brand, p.model].filter(Boolean).join(' ')}` : ''}`])]} /></label>
      <label style={{ flex: 1, minWidth: 90 }}><span>數量</span><input type="number" min="0" value={cur.data.quantity?.[kind] ?? 1} onChange={e => set(`quantity.${kind}`, Number(e.target.value))} /></label>
    </div>}
    <div className="tfields">{F[kind].map(f => {
      const path = `${kind}.${f[0]}`, mine = getIn(cur.data, path), from = getIn(filled, path);
      const shownVal = mine === undefined ? '' : f[0] === 'lineScan' ? (mine ? '是' : '') : String(mine);
      const ph = mine === undefined && from !== undefined && from !== null && from !== '' ? String(from === true ? '是' : from) : '';
      return <label key={f[0]}><span>{f[1]}{f[2] && <small className="mute">（{f[2]}）</small>}</span>
        {f[3] ? <Select value={shownVal} onChange={v => set(path, val(f, v))} options={f[3].map(o => [o, o || (ph ? `（元件：${ph}）` : '—')])} />
          : <input inputMode="decimal" value={shownVal} placeholder={ph} onChange={e => set(path, val(f, e.target.value))} aria-label={`${TITLE[kind]} ${f[1]}`} />}</label>;
    })}</div>
  </section>;

  return <div className="page wide optics">
    <div className="head"><div><h2>光學工作台</h2><div className="sub" style={{ marginBottom: 0 }}>評估 AOI 架構：相機、鏡頭、光源的選用與配置。公式在 core/optics（L1 計算，薄透鏡近似）；結果是選型估算，不能取代實際打樣。</div></div>
      <label className="inline">專案 <Select value={project} onChange={v => { setProject(v); setCur({ id: null, name: '', data: BLANK }); }} options={projects.map(p => [p.id, `${p.title}${p.repo ? '（本庫）' : ''}`])} /></label></div>
    {msg && <div className={`notice ${msg.startsWith('✗') ? 'bad' : 'ok'}`}>{msg}</div>}
    <div className="optics-layout">
      <div>{['camera', 'lens', 'light', 'scene'].map(section)}</div>
      <div className="optics-side">
        <section className="card"><h3>結果{res && <span className={`chip ${res.status === 'fail' ? 'bad' : res.status === 'warn' ? 'warn' : 'ok'}`}>{STATUS[res.status] || '✓ 符合'}</span>}</h3>
          {!res ? <p className="mute">計算中…</p> : <table className="data optics-res"><tbody>{res.results.map(r => <tr key={r.key} className={r.status}>
            <td>{r.label}</td><td className="num nowrap"><b>{r.value ?? '—'}</b> {r.unit}</td><td className={`nowrap ${r.status === 'fail' ? 'bad' : r.status === 'warn' ? 'warn' : 'ok'}`}>{STATUS[r.status]}</td><td className="mute">{r.note}</td></tr>)}</tbody></table>}
          {res?.cost > 0 && <p>元件參考成本：<b>{nt(res.cost)}</b>　<span className="mute">（引用元件的最新參考單價 × 數量）</span></p>}
        </section>
        <section className="card"><h3>3D 配置</h3>
          {catalogPort ? <iframe ref={frame} className="frame optics-frame" title="光學配置 3D" src={sameHost(`http://127.0.0.1:${catalogPort}/core/optics/view.html`)}
            onLoad={() => res && frame.current?.contentWindow?.postMessage({ type: 'optics', setup: res.setup }, '*')} /> : <p className="mute">預覽伺服器還沒準備好。</p>}
        </section>
        <section className="card form"><h3>方案{proj && <span className="chip">{proj.title}</span>}</h3>
          <fieldset className="plain" disabled={!canEdit || !project}>
            <div className="bar"><input value={cur.name} onChange={e => setCur(c => ({ ...c, name: e.target.value }))} placeholder="方案名稱，例如「5MP＋遠心＋同軸光」" aria-label="方案名稱" style={{ flex: 1 }} />
              <button className="primary" disabled={!cur.name.trim()} onClick={() => save(false)}>{cur.id ? '儲存' : '存成方案'}</button>
              {cur.id && <button onClick={() => save(true)}>另存新方案</button>}
              <button onClick={() => setCur({ id: null, name: '', data: BLANK })}>新方案</button></div>
          </fieldset>
          {!canEdit && <p className="mute">你不是這個專案的成員，只能看與試算，不能存方案。</p>}
          {setups.length > 0 && <table className="data"><thead><tr><th>比較</th><th>方案</th><th>視野</th><th>每像素</th><th>缺陷</th><th>結果</th><th className="num">成本</th><th /></tr></thead><tbody>
            {setups.map(s => <tr key={s.id} className={cur.id === s.id ? 'on' : ''}>
              <td><input type="checkbox" aria-label={`比較 ${s.name}`} checked={cmp.has(s.id)} onChange={e => setCmp(x => { const n = new Set(x); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} /></td>
              <td><b>{s.name}</b>{s.status === 'chosen' && <span className="chip ok">選用</span>}</td>
              <td className="nowrap">{metric(s, 'fov')?.value ?? '—'}</td><td className="nowrap">{metric(s, 'resolution')?.value ?? '—'} µm</td><td className="nowrap">{metric(s, 'defect')?.value ?? '—'} px</td>
              <td className={s.result.status === 'fail' ? 'bad' : s.result.status === 'warn' ? 'warn' : 'ok'}>{STATUS[s.result.status] || '✓'}</td><td className="num">{nt(s.result.cost)}</td>
              <td className="ops"><button onClick={() => setCur({ id: s.id, name: s.name, data: s.data })}>開啟</button>
                {canEdit && s.status !== 'chosen' && <button title="其他方案改回草稿；這個方案的相機、鏡頭、光源加進專案的成本表" onClick={() => act(async () => { const r = await api.aoiChoose(project, s.id); setMsg(`✓ 已選用「${s.name}」${r.added.length ? `，${r.added.join('、')} 加進成本表` : ''}`); })}>選用</button>}
                {canEdit && <ConfirmButton onConfirm={() => act(() => api.aoiDelete(project, s.id), '已刪除')} />}</td></tr>)}
          </tbody></table>}
          {shown.length > 1 && <div className="scroll"><table className="data compare"><thead><tr><th>項目</th>{shown.map(s => <th key={s.id}>{s.name}</th>)}</tr></thead><tbody>
            {[...new Set(shown.flatMap(s => s.result.results.map(r => r.key)))].map(k => { const lab = shown.map(s => s.result.results.find(r => r.key === k)).find(Boolean); return <tr key={k}><td>{lab.label}</td>
              {shown.map(s => { const r = s.result.results.find(x => x.key === k); return <td key={s.id} className={r?.status === 'fail' ? 'bad' : r?.status === 'warn' ? 'warn' : ''}>{r ? `${r.value ?? '—'} ${r.unit}` : '—'}</td>; })}</tr>; })}
            <tr><td>元件成本</td>{shown.map(s => <td key={s.id}>{nt(s.result.cost)}</td>)}</tr></tbody></table></div>}
        </section>
      </div>
    </div>
  </div>;
}
