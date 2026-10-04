// 新建專案：拖放規格、圖面、照片、影片（伺服器會自動擷取影格）、Office 檔（建立時抽出文字與圖片），輸入需求，選 CLI 與模型後開始。
import { useState } from 'react';
import { api } from './api.js';
import { CliSelect, ModelSelect, EffortSelect } from './fields.jsx';

const newToken = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// 匯入同事給的交接包（vs3d handoff 產生的 zip）：上傳後直接建成專案，之後按續跑
function ImportHandoff({ onCreated, disabled }) {
  const [name, setName] = useState(''), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false);
  async function pick(file) {
    if (!file) return;
    setBusy(true); setMsg('上傳中…');
    try { const token = newToken(); await api.upload(token, file); const r = await api.importHandoff({ token, name }); setMsg(`✓ 已匯入 ${r.id}（${r.rounds} 輪）`); onCreated(r.id); }
    catch (e) { setMsg(`✗ ${e.message}`); } finally { setBusy(false); }
  }
  return (
    <section className="card form">
      <h3>匯入交接包</h3>
      <p className="mute hint">同事用「交接包」匯出的 .zip：含 git 歷史、上傳的資料、提問與紀錄；匯入後按「續跑」接手。</p>
      <div className="row">
        <label><span>專案名稱（選填）</span><input value={name} onChange={e => setName(e.target.value)} placeholder="預設沿用原名" /></label>
        <label className="file"><span>交接包</span>
          <span className={`btn ${disabled || busy ? 'disabled' : ''}`}>{busy ? '上傳中…' : '選擇 .zip 檔'}<input type="file" accept=".zip" hidden disabled={disabled || busy} onChange={e => pick(e.target.files[0])} /></span></label>
      </div>
      {msg && <div className={msg.startsWith('✗') ? 'bad' : 'mute'}>{msg}</div>}
    </section>
  );
}

export function NewProject({ info, running, onCreated }) {
  const [token] = useState(newToken);
  const [form, setForm] = useState({ id: '', title: '', prompt: '', clientNames: '', cli: '', model: '', effort: '', autoApprove: false, pick: false });
  const [files, setFiles] = useState([]);             // { name, size, status, extra }
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const opts = info?.options;

  async function add(list) {
    for (const file of list) {
      setFiles(fs => [...fs, { name: file.name, size: file.size, status: '上傳中…' }]);
      try {
        const r = await api.upload(token, file);
        const frames = r.files.filter(n => n !== file.name);
        setFiles(fs => fs.map(x => x.name === file.name ? { ...x, status: '✓', extra: frames.length ? `已擷取 ${frames.length} 張影格` : r.notice || '' } : x));
      } catch (e) { setFiles(fs => fs.map(x => x.name === file.name ? { ...x, status: `✗ ${e.message}` } : x)); }
    }
  }
  async function submit(e) {
    e.preventDefault(); setError('');
    if (!form.id.trim()) return setError('請輸入專案名稱（英數、空白、- 或 _）');
    if (!form.prompt.trim() && !files.length) return setError('請輸入需求，或上傳至少一個檔案');
    setBusy(true);
    try { await api.create({ ...form, id: form.id.trim(), token }); onCreated(form.id.trim()); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  const mb = n => n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} KB`;
  const uploading = files.some(f => f.status === '上傳中…');

  return (
    <div className="page narrow">
      <h2>新建專案</h2>
      <p className="sub">代理會先讀資料、寫配置提案，需要拍板的事會變成問題卡片；確認提案後開始開發、檢查、審查與補強。</p>
      <form onSubmit={submit}>
        <section className="card form">
          <h3><span className="step">1</span>基本資料</h3>
          <div className="row">
            <label><span>專案名稱</span><input value={form.id} onChange={e => set('id', e.target.value)} placeholder="例如 PickPlace（英數）" /></label>
            <label><span>顯示標題</span><input value={form.title} onChange={e => set('title', e.target.value)} placeholder="例如 輸送帶龍門取放站" /></label>
          </div>
          <label><span>不得顯示的用戶名稱</span><input value={form.clientNames} onChange={e => set('clientNames', e.target.value)} placeholder="多個用逗號分隔" />
            <small className="mute">畫面與檔案都不會出現這些名稱；需求與資料裡的會換成「（用戶）」。</small></label>
        </section>

        <section className="card form">
          <h3><span className="step">2</span>需求與資料</h3>
          <label><span>需求</span><textarea rows={6} value={form.prompt} onChange={e => set('prompt', e.target.value)} placeholder="描述要自動化的作業、節拍、限制，以及上傳的資料各是什麼" /></label>
          <div>
            <label className={`drop ${over ? 'over' : ''}`}
              onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={e => { e.preventDefault(); setOver(false); add([...e.dataTransfer.files]); }}>
              <div className="big">⇪</div>
              把規格 PDF、Office 檔、圖面、照片、影片拖到這裡，或 <u style={{ color: 'var(--accent)' }}>選擇檔案</u>
              <input type="file" multiple hidden onChange={e => add([...e.target.files])} />
              {!info?.ffmpeg && <div className="warn" style={{ marginTop: 6 }}>找不到 ffmpeg：影片不會自動擷取影格（代理看不了影片）</div>}
            </label>
            {files.length > 0 && <table className="files"><tbody>{files.map(f => <tr key={f.name}><td>{f.name}</td><td className="mute">{mb(f.size)}</td><td>{f.status} <span className="mute">{f.extra}</span></td></tr>)}</tbody></table>}
          </div>
        </section>

        <section className="card form">
          <h3><span className="step">3</span>代理與流程</h3>
          <div className="row">
            <label><span>CLI</span><CliSelect value={form.cli} defaultLabel="依設定頁的分工" onChange={v => setForm(f => ({ ...f, cli: v, model: '', effort: '' }))} /></label>
            <label><span>模型</span><ModelSelect cli={form.cli} options={opts} value={form.model} onChange={v => set('model', v)} defaultLabel={form.cli ? '帳號預設模型' : '依設定頁'} /></label>
            <label><span>推理強度</span><EffortSelect cli={form.cli} options={opts} value={form.effort} onChange={v => set('effort', v)} defaultLabel={form.cli ? '預設' : '依設定頁'} /></label>
          </div>
          <small className="mute">指定 CLI 後，模型與推理強度會套用到這個專案的所有角色；「依設定頁的分工」會照設定頁（預設 Claude 規劃、開發與審查，Codex 補強）。</small>
          <label className="check"><input type="checkbox" checked={form.autoApprove} onChange={e => set('autoApprove', e.target.checked)} /> 配置提案不必確認，直接開始開發</label>
          <label className="check"><input type="checkbox" checked={form.pick} onChange={e => set('pick', e.target.checked)} /> 補強前先讓我挑項目</label>
        </section>

        {error && <div className="notice bad">{error}</div>}
        {running && <div className="notice warn">工作區正在執行 {running.id}，要等它結束才能開始新專案。</div>}
        <div className="bar"><button className="primary big" disabled={busy || !!running || uploading}>{busy ? '建立中…' : uploading ? '等上傳完成…' : '建立並開始'}</button></div>
      </form>
      <ImportHandoff onCreated={onCreated} disabled={!!running} />
    </div>
  );
}
