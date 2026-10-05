import { useEffect, useState } from 'react';

// 共用的下拉選單：能列舉的值一律用選單，不讓使用者打字。選項來自 /api/info 的 options（各 CLI 的模型與推理強度）。
export const CLIS = [['claude', 'Claude Code'], ['codex', 'Codex']];

// 補強範圍：對應審查建議的分類（render 角色的 focus）；空字串＝照審查建議全部處理
export const RENDER_FOCUS = [
  ['', '全部（照審查建議）'],
  ['材質與表面處理（金屬、塑膠、塗裝）', '材質與表面處理'],
  ['細部幾何（倒角、螺絲、溝槽、管線、標示）', '細部幾何'],
  ['燈光與陰影', '燈光與陰影'],
  ['鏡頭構圖（各視角的取景）', '鏡頭構圖'],
  ['3D 標籤樣式', '標籤樣式'],
  ['電盤內部（線槽、標籤、端子）', '電盤內部'],
  ['線材（束帶、固定座、拖鏈）', '線材與拖鏈'],
  ['相機與光源外觀', '相機與光源'],
];

const EFFORT_LABEL = { low: 'low（快）', medium: 'medium', high: 'high（建議）', xhigh: 'xhigh（較慢）', max: 'max（最慢）' };

// 危險操作要按兩次：第一次變成「確定…？」，4 秒內沒按就復原
export function ConfirmButton({ onConfirm, label = '刪除', confirmLabel = '確定刪除？', title, disabled }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  return <button type="button" className="danger" title={title} disabled={disabled} onClick={() => { if (armed) onConfirm(); setArmed(!armed); }}>{armed ? confirmLabel : label}</button>;
}

export function Select({ value, onChange, options, disabled, title, style }) {
  return <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled} title={title} style={style}>
    {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
  </select>;
}

// CLI：defaultLabel 有值時多一個「預設」選項（值為空字串）
export const CliSelect = ({ value, onChange, defaultLabel, ...rest }) =>
  <Select value={value || ''} onChange={onChange} options={[...(defaultLabel ? [['', defaultLabel]] : []), ...CLIS]} {...rest} />;

// 模型：依 CLI 列出可選的模型；沒指定 CLI 時只能選預設
export function ModelSelect({ cli, value, onChange, options, defaultLabel = '預設模型', ...rest }) {
  const models = options?.[cli]?.models || [];
  const list = [['', defaultLabel], ...models.map(m => [m, m]), ...(value && !models.includes(value) ? [[value, `${value}（目前設定）`]] : [])];
  return <Select {...rest} value={value || ''} onChange={onChange} options={list} disabled={!cli || rest.disabled} title={!cli ? '先選 CLI' : rest.title} />;
}

export function EffortSelect({ cli, value, onChange, options, defaultLabel = '預設', ...rest }) {
  const efforts = (cli ? options?.[cli]?.efforts : options?.claude?.efforts?.filter(e => (options?.codex?.efforts || []).includes(e))) || [];
  const list = [['', defaultLabel], ...efforts.map(e => [e, EFFORT_LABEL[e] || e]), ...(value && !efforts.includes(value) ? [[value, `${value}（目前設定）`]] : [])];
  return <Select value={value || ''} onChange={onChange} options={list} {...rest} />;
}
