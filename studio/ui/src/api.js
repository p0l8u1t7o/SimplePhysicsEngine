// 和 vs3d ui 伺服器溝通的小工具
import { useEffect, useRef } from 'react';

async function call(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`);
  return j;
}
export const api = {
  info: () => call('GET', '/api/info'),
  doctor: () => call('GET', '/api/doctor'),
  settings: () => call('GET', '/api/settings'),
  saveSettings: v => call('PUT', '/api/settings', v),
  projects: () => call('GET', '/api/projects'),
  project: id => call('GET', `/api/projects/${encodeURIComponent(id)}`),
  create: v => call('POST', '/api/projects', v),
  answer: (id, v) => call('POST', `/api/projects/${encodeURIComponent(id)}/answer`, v),
  run: (id, v) => call('POST', `/api/projects/${encodeURIComponent(id)}/run`, v),
  stop: () => call('POST', '/api/stop'),
  importHandoff: v => call('POST', '/api/import', v),
  async upload(token, file) {
    const r = await fetch(`/api/uploads?token=${encodeURIComponent(token)}&name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j;
  },
};
export const fileUrl = (id, path) => `/files/${encodeURIComponent(id)}/${path.split('/').map(encodeURIComponent).join('/')}`;

// SSE：line（輸出一行）、exit（執行結束）
export function useEvents(handlers) {
  const ref = useRef(handlers); ref.current = handlers;
  useEffect(() => {
    const es = new EventSource('/api/events');
    for (const ev of ['hello', 'line', 'exit']) es.addEventListener(ev, e => ref.current[ev]?.(JSON.parse(e.data)));
    return () => es.close();
  }, []);
}

export const STAGE = {
  plan: '規劃', build: '開發', check: '檢查', fix: '修正', review: '審查', 'review-fix': '修正必修', render: '補強',
  'render-guard': '守門檢查', 'render-revise': '補強調整', paused: '暫停', done: '完成',
};
export const ROLE = { plan: '規劃', build: '開發', fix: '修正', review: '審查', render: '補強' };
