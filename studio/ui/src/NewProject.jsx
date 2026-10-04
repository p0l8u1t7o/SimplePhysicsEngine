// 新建專案：拖放規格、圖面、照片、影片（伺服器會自動擷取影格）、Office 檔（建立時抽出文字與圖片），輸入需求，選 CLI 與模型後開始。
import { useState } from 'react';
import { api } from './api.js';

const newToken = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export function NewProject({ info, running, onCreated }) {
  const [token] = useState(newToken);
  const [form, setForm] = useState({ id: '', title: '', prompt: '', cli: '', model: '', effort: '', autoApprove: false, pick: false });
  const [files, setFiles] = useState([]);             // { name, size, status, extra }
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

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

  return (
    <div className="page">
      <h2>新建專案</h2>
      <p className="sub">代理會先讀資料、寫配置提案，需要拍板的事會變成問題卡片；確認提案後開始開發、檢查、審查與補強。</p>
      <form className="form" onSubmit={submit}>
        <div className="row">
          <label><span>專案名稱</span><input value={form.id} onChange={e => set('id', e.target.value)} placeholder="例如 PickPlace（英數）" /></label>
          <label><span>顯示標題</span><input value={form.title} onChange={e => set('title', e.target.value)} placeholder="例如 輸送帶龍門取放站" /></label>
        </div>
        <label><span>需求</span><textarea rows={6} value={form.prompt} onChange={e => set('prompt', e.target.value)} placeholder="描述要自動化的作業、節拍、限制，以及上傳的資料各是什麼" /></label>
        <div>
          <div className={`drop ${over ? 'over' : ''}`}
            onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); add([...e.dataTransfer.files]); }}>
            把規格 PDF、Office 檔、圖面、照片、影片拖到這裡，或 <label style={{ color: 'var(--accent)', cursor: 'pointer' }}>選擇檔案<input type="file" multiple hidden onChange={e => add([...e.target.files])} /></label>
            {!info?.ffmpeg && <div className="warn" style={{ marginTop: 6 }}>找不到 ffmpeg：影片不會自動擷取影格（代理看不了影片）</div>}
          </div>
          {files.length > 0 && <table style={{ marginTop: 8 }}><tbody>{files.map(f => <tr key={f.name}><td>{f.name}</td><td className="mute">{mb(f.size)}</td><td>{f.status} <span className="mute">{f.extra}</span></td></tr>)}</tbody></table>}
        </div>
        <div className="row">
          <label><span>CLI</span><select value={form.cli} onChange={e => set('cli', e.target.value)}><option value="">預設（依設定頁）</option><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label>
          <label><span>模型（選填）</span><input value={form.model} onChange={e => set('model', e.target.value)} placeholder="例如 opus、gpt-6-astra" /></label>
          <label><span>推理強度（選填）</span><select value={form.effort} onChange={e => set('effort', e.target.value)}><option value="">預設</option><option value="medium">medium</option><option value="high">high</option></select></label>
        </div>
        <p className="mute" style={{ margin: 0 }}>這裡指定的 CLI 與模型會套用到這個專案的所有角色；留空就照設定頁的分工（預設 opus 規劃與開發、gpt-6 補強）。</p>
        <label><input type="checkbox" checked={form.autoApprove} onChange={e => set('autoApprove', e.target.checked)} /> 配置提案不必確認，直接開始開發</label>
        <label><input type="checkbox" checked={form.pick} onChange={e => set('pick', e.target.checked)} /> 補強前先讓我挑項目</label>
        {error && <div className="bad">{error}</div>}
        {running && <div className="warn">工作區正在執行 {running.id}，要等它結束才能開始新專案。</div>}
        <div><button className="primary" disabled={busy || !!running || files.some(f => f.status === '上傳中…')}>{busy ? '建立中…' : '建立並開始'}</button></div>
      </form>
    </div>
  );
}
