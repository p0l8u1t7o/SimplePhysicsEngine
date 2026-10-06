// 系統設定（介面「設定」頁的「系統」分頁，只有管理者能改）：存在資料庫的 settings 表，這裡定義鍵、預設值與驗證。
// 讀取時沒有存過的鍵用預設值；寫入時只收認得的鍵，型別與範圍不對就拒絕。
import { FILE_TYPES } from './partsdb.mjs';
import { isDeploy, subscriptionAllowed } from './edition.mjs';
import { COST_DEFAULTS } from './bom.mjs';

// 代理 CLI 的認證方式：開發機可以選訂閱帳號或 API 金鑰；部署版只有 API 金鑰（lib/edition.mjs）
const authCheck = (v, label) => {
  if (v !== 'subscription' && v !== 'apiKey') throw new Error(`${label}只能是 subscription 或 apiKey`);
  if (v === 'subscription' && !subscriptionAllowed()) throw new Error(`${label}：${isDeploy() ? '部署版' : '這個版本'}沒有訂閱帳號功能，只能用 API 金鑰`);
  return v;
};

const num = (min, max) => (v, label) => {
  const n = Number(v);
  if (v === '' || v == null || !Number.isFinite(n) || n < min || n > max) throw new Error(`${label}要是 ${min}～${max} 的數字`);
  return n;
};
const ratio = num(0, 1);

export const SYSTEM_SETTINGS = {
  'attachment.maxMB': { label: '一般附件上限（MB）', value: 20, check: num(1, 2048), hint: '報價單、圖片、型錄、文件等' },
  'attachment.cadMaxMB': { label: 'CAD 檔上限（MB）', value: 300, check: num(1, 4096), hint: 'STEP、IGES、SLDPRT、DWG、STL…' },
  'attachment.types': {
    label: '允許上傳的檔案類型', value: Object.keys(FILE_TYPES),
    check: (v, label) => { if (!Array.isArray(v) || v.some(t => !FILE_TYPES[t])) throw new Error(`${label}只能從 ${Object.keys(FILE_TYPES).join('、')} 選`); return [...new Set(v)]; },
  },
  'cost.engRate': { label: '工程人日費率（TWD）', value: COST_DEFAULTS.engRate, check: num(0, 1e6) },
  'cost.techRate': { label: '技術人日費率（TWD）', value: COST_DEFAULTS.techRate, check: num(0, 1e6) },
  'cost.contingency': { label: '預備金比例', value: COST_DEFAULTS.contingency, check: ratio },
  'cost.tax': { label: '稅率', value: COST_DEFAULTS.tax, check: ratio },
  'cost.gradeRange': {
    label: '估價等級的上下幅度', value: COST_DEFAULTS.gradeRange,
    check: (v, label) => { if (!v || typeof v !== 'object') throw new Error(`${label}格式不對`); return Object.fromEntries(['A', 'B', 'C'].map(g => [g, ratio(v[g], `${label} ${g}`)])); },
  },
  'trash.keepDays': { label: '回收桶自動清理（天）', value: 0, check: num(0, 3650), hint: '刪除的專案留幾天後自動永久刪除；0 是不自動清' },
  'agents.auth.claude': { label: 'Claude Code 的認證', value: 'subscription', check: authCheck },
  'agents.auth.codex': { label: 'Codex 的認證', value: 'subscription', check: authCheck },
};

// 部署版沒有訂閱帳號：不管資料庫裡存了什麼，認證一律讀成 apiKey
const forceAuth = s => subscriptionAllowed() ? s : { ...s, 'agents.auth.claude': 'apiKey', 'agents.auth.codex': 'apiKey' };
export const systemDefaults = () => forceAuth(Object.fromEntries(Object.entries(SYSTEM_SETTINGS).map(([k, d]) => [k, d.value])));
export const readSystem = db => forceAuth({ ...systemDefaults(), ...Object.fromEntries(Object.entries(db.readSettings()).filter(([k]) => SYSTEM_SETTINGS[k])) });

// 驗證要寫入的值；回傳清理過的值（不認得的鍵直接拒絕）
export function cleanSystem(values) {
  const out = {};
  for (const [k, v] of Object.entries(values || {})) {
    const d = SYSTEM_SETTINGS[k];
    if (!d) throw new Error(`不認得的設定：${k}`);
    out[k] = d.check(v, d.label);
  }
  return out;
}

// 這個檔案可以上傳嗎？回傳 { type, limit }，不行就丟出錯誤（status 400／413）
export function attachmentRule(system, type) {
  if (!type || !system['attachment.types'].includes(type)) {
    const allowed = system['attachment.types'].flatMap(t => FILE_TYPES[t].ext);
    throw Object.assign(new Error(`不接受這種檔案；可以上傳：${allowed.join('、')}`), { status: 400 });
  }
  const mb = type === 'cad' ? system['attachment.cadMaxMB'] : system['attachment.maxMB'];
  return { type, limit: mb * 1024 * 1024, mb };
}
