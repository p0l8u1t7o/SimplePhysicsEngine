// 和 vs3d ui 伺服器溝通的小工具
import { useEffect, useRef } from 'react';

async function call(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  // 登入過期或帳號被停用：通知主畫面回到登入頁
  if (r.status === 401 && !url.startsWith('/api/auth/')) dispatchEvent(new Event('vs3d-unauthorized'));
  if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`);
  return j;
}
export const api = {
  // 登入與帳號
  me: () => call('GET', '/api/auth/me'),
  login: v => call('POST', '/api/auth/login', v),
  logout: () => call('POST', '/api/auth/logout'),
  setup: v => call('POST', '/api/auth/setup', v),
  changePassword: v => call('POST', '/api/auth/password', v),
  users: () => call('GET', '/api/users'),
  createUser: v => call('POST', '/api/users', v),
  updateUser: (name, v) => call('PUT', `/api/users/${encodeURIComponent(name)}`, v),
  deleteUser: name => call('DELETE', `/api/users/${encodeURIComponent(name)}`),
  info: () => call('GET', '/api/info'),
  doctor: () => call('GET', '/api/doctor'),
  settings: () => call('GET', '/api/settings'),
  saveSettings: v => call('PUT', '/api/settings', v),
  projects: () => call('GET', '/api/projects'),
  dashboard: () => call('GET', '/api/dashboard'),
  project: id => call('GET', `/api/projects/${encodeURIComponent(id)}`),
  create: v => call('POST', '/api/projects', v),
  answer: (id, v) => call('POST', `/api/projects/${encodeURIComponent(id)}/answer`, v),
  run: (id, v) => call('POST', `/api/projects/${encodeURIComponent(id)}/run`, v),
  stop: () => call('POST', '/api/stop'),
  cancelQueued: qid => call('DELETE', `/api/queue/${encodeURIComponent(qid)}`),     // 取消代理佇列裡排隊中的一筆
  cancel: id => call('POST', `/api/projects/${encodeURIComponent(id)}/cancel`),
  // 專案成員（依專案分權限）：members 是 [{ user, role: owner｜member }]
  members: id => call('GET', `/api/projects/${encodeURIComponent(id)}/members`),
  saveMembers: (id, members) => call('PUT', `/api/projects/${encodeURIComponent(id)}/members`, { members }),
  deleteProject: (id, confirm) => call('DELETE', `/api/projects/${encodeURIComponent(id)}`, { confirm }),
  importHandoff: v => call('POST', '/api/import', v),
  // 元件資料庫；kind 是 prices（價格紀錄）或 usages（使用紀錄），id 空白是新增
  parts: query => call('GET', `/api/parts?${new URLSearchParams(query)}`),
  part: id => call('GET', `/api/parts/${id}`),
  savePart: (id, v) => id ? call('PUT', `/api/parts/${id}`, v) : call('POST', '/api/parts', v),
  deletePart: id => call('DELETE', `/api/parts/${id}`),
  saveRecord: (kind, partId, id, v) => id ? call('PUT', `/api/${kind}/${id}`, v) : call('POST', `/api/parts/${partId}/${kind}`, v),
  deleteRecord: (kind, id) => call('DELETE', `/api/${kind}/${id}`),
  // 分類樹與欄位範本（改只有管理者）；id 空白是新增
  categories: () => call('GET', '/api/categories'),
  category: id => call('GET', `/api/categories/${id}`),
  saveCategory: (id, v) => id ? call('PUT', `/api/categories/${id}`, v) : call('POST', '/api/categories', v),
  saveCategoryFields: (id, fields) => call('PUT', `/api/categories/${id}/fields`, { fields }),
  deleteCategory: id => call('DELETE', `/api/categories/${id}`),
  // 關聯件與模組的子件：rel 是 component｜accessory｜alternative｜compatible
  addLink: (partId, v) => call('POST', `/api/parts/${partId}/links`, v),
  updateLink: (id, v) => call('PUT', `/api/links/${id}`, v),
  deleteLink: id => call('DELETE', `/api/links/${id}`),
  // 元件版本：兩版的差異；模組依子件的新版升一版
  partVersions: (id, a, b) => call('GET', `/api/parts/${id}/versions/${a}..${b}`),
  refreshModule: id => call('POST', `/api/parts/${id}/refresh`),
  // 元件補全（評估平台 Q5）
  enrichStart: (partId, fields = []) => call('POST', `/api/parts/${partId}/enrich`, { fields }),
  enrichBatch: parts => call('POST', '/api/enrich/batch', { parts }),
  enrichJobs: query => call('GET', `/api/enrich?${new URLSearchParams(query)}`),
  enrichAccept: (job, v) => call('POST', `/api/enrich/${job}/accept`, v),
  enrichDismiss: job => call('DELETE', `/api/enrich/${job}`),
  // 專案的 BOM 與成本表
  bom: id => call('GET', `/api/projects/${encodeURIComponent(id)}/bom`),
  addBomItem: (id, v) => call('POST', `/api/projects/${encodeURIComponent(id)}/bom/items`, v),
  updateBomItem: (id, item, v) => call('PUT', `/api/projects/${encodeURIComponent(id)}/bom/items/${item}`, v),
  deleteBomItem: (id, item) => call('DELETE', `/api/projects/${encodeURIComponent(id)}/bom/items/${item}`),
  bomSettings: (id, v) => call('PUT', `/api/projects/${encodeURIComponent(id)}/bom/settings`, v),
  bomNewVersions: id => call('GET', `/api/projects/${encodeURIComponent(id)}/bom/new-versions`),
  bomUpgrade: (id, ids) => call('POST', `/api/projects/${encodeURIComponent(id)}/bom/upgrade`, { ids }),
  bomSnapshot: (id, v) => call('POST', `/api/projects/${encodeURIComponent(id)}/bom/snapshots`, v),
  bomGetSnapshot: (id, sid) => call('GET', `/api/projects/${encodeURIComponent(id)}/bom/snapshots/${sid}`),
  bomCompare: (id, sid) => call('GET', `/api/projects/${encodeURIComponent(id)}/bom/compare/${sid}`),
  // 光學計算與 AOI 方案
  opticsEval: setup => call('POST', '/api/optics/eval', { setup }),
  // 評估資料（評估平台 Q6）：最新版、某一版、在介面上修改（存一版）、平台檢查、專案組成
  assessment: (id, q) => call('GET', `/api/projects/${encodeURIComponent(id)}/assessment${q ? '?' + new URLSearchParams(q) : ''}`),
  saveAssessment: (id, v) => call('PUT', `/api/projects/${encodeURIComponent(id)}/assessment`, v),
  setComponents: (id, components) => call('PUT', `/api/projects/${encodeURIComponent(id)}/components`, { components }),
  aoiList: id => call('GET', `/api/projects/${encodeURIComponent(id)}/aoi`),
  aoiSave: (id, sid, v) => sid ? call('PUT', `/api/projects/${encodeURIComponent(id)}/aoi/${sid}`, v) : call('POST', `/api/projects/${encodeURIComponent(id)}/aoi`, v),
  aoiDelete: (id, sid) => call('DELETE', `/api/projects/${encodeURIComponent(id)}/aoi/${sid}`),
  aoiChoose: (id, sid) => call('POST', `/api/projects/${encodeURIComponent(id)}/aoi/${sid}/choose`),
  // 匯率（改只有管理者）
  fx: () => call('GET', '/api/fx'),
  setFx: v => call('PUT', '/api/fx', v),
  deleteFx: (currency, date) => call('DELETE', `/api/fx/${currency}/${date}`),
  // core 共用模型（元件的 3D 顯示）與元件的附件（CAD 檔等）
  models: () => call('GET', '/api/models'),
  async uploadPartFile(partId, file) {
    const r = await fetch(`/api/parts/${partId}/files?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j;
  },
  updatePartFile: (id, v) => call('PUT', `/api/files/${id}`, v),
  deletePartFile: id => call('DELETE', `/api/files/${id}`),
  // 系統設定（附件上限、允許的檔案類型、成本費率；改只有管理者）
  system: () => call('GET', '/api/system'),
  saveSystem: v => call('PUT', '/api/system', v),
  // API 金鑰（管理者）：provider 是 anthropic 或 openai；只回末四碼
  secrets: () => call('GET', '/api/secrets'),
  saveSecret: (provider, key) => call('PUT', `/api/secrets/${provider}`, { key }),
  deleteSecret: provider => call('DELETE', `/api/secrets/${provider}`),
  // 回收桶（管理者）：刪除的專案
  trash: () => call('GET', '/api/trash'),
  purgeTrashItem: name => call('DELETE', `/api/trash/${encodeURIComponent(name)}`),
  purgeTrash: days => call('POST', '/api/trash/purge', { days }),
  suppliers: () => call('GET', '/api/suppliers'),
  saveSupplier: (id, v) => id ? call('PUT', `/api/suppliers/${id}`, v) : call('POST', '/api/suppliers', v),
  deleteSupplier: id => call('DELETE', `/api/suppliers/${id}`),
  async upload(token, file) {
    const r = await fetch(`/api/uploads?token=${encodeURIComponent(token)}&name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j;
  },
};
// 預覽與模型目錄在另一個 port（伺服器的代理）：伺服器給的是 http://127.0.0.1，換成目前的協定（HTTPS 時一起）與主機名稱
export const sameHost = u => String(u || '').replace(/^https?:\/\/127\.0\.0\.1:/,`${location.protocol}//${location.hostname}:`);
// 元件附件的網址：inline 是在瀏覽器直接開（圖片、PDF），否則下載
export const partFileUrl = (partId, fileId, inline) => `/api/parts/${partId}/files/${fileId}${inline ? '?inline=1' : ''}`;
// 依副檔名找附件的類型（系統設定 fileTypes），找不到回傳空字串
export const fileTypeOf = (fileTypes, name) => { const e = (String(name).match(/\.([^.]+)$/)?.[1] || '').toLowerCase(); return Object.keys(fileTypes || {}).find(t => fileTypes[t].ext.includes(e)) || ''; };
export const fileUrl = (id, path) => `/files/${encodeURIComponent(id)}/${path.split('/').map(encodeURIComponent).join('/')}`;

// SSE：line（輸出一行）、exit（執行結束）
export function useEvents(handlers) {
  const ref = useRef(handlers); ref.current = handlers;
  useEffect(() => {
    const es = new EventSource('/api/events');
    for (const ev of ['hello', 'line', 'exit', 'queue']) es.addEventListener(ev, e => ref.current[ev]?.(JSON.parse(e.data)));
    return () => es.close();
  }, []);
}

export const STAGE = {
  plan: '規劃', build: '開發', check: '檢查', fix: '修正', review: '審查', 'review-fix': '修正必修', render: '補強',
  'render-guard': '守門檢查', 'render-revise': '補強調整', 'assess-revise': '修改評估', change: '修改', paused: '暫停', done: '完成',
};
export const ROLE = { plan: '規劃', build: '開發', fix: '修正', review: '審查', render: '補強' };
// 評估報告的下載網址（html｜pdf｜md）
export const reportUrl = (id, format) => `/api/projects/${encodeURIComponent(id)}/report?format=${format}`;
