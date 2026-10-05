// 線條圖示（24 × 24，顏色跟著文字）。只放介面用到的幾個，不引用圖示套件。
const PATHS = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h4.5v-6h4v6h4.5V10',
  parts: 'M12 3 4 7v10l8 4 8-4V7l-8-4ZM4 7l8 4 8-4M12 11v10',
  settings: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM19 12l2-1.2-2-3.4-2.2.8a7 7 0 0 0-1.6-.9L14.8 5h-4l-.4 2.3a7 7 0 0 0-1.6.9l-2.2-.8-2 3.4L6.6 12l-2 1.2 2 3.4 2.2-.8c.5.4 1 .7 1.6.9l.4 2.3h4l.4-2.3c.6-.2 1.1-.5 1.6-.9l2.2.8 2-3.4L19 12Z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-3.8-3.8',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 20.5h4',
  folder: 'M3.5 7.5v10a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 19 8h-7l-2-2.5H5A1.5 1.5 0 0 0 3.5 7v.5Z',
  play: 'M8 5.5v13l10.5-6.5L8 5.5Z',
  question: 'M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8M12 17h.01M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z',
  branch: 'M7 4.5v15M7 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM7 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 10.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 10.5c0 3-4 2.5-10 5',
  check: 'M4.5 12.5 10 18 19.5 6.5',
  alert: 'M12 4 2.5 20h19L12 4ZM12 10v5M12 17.5h.01',
  clock: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 7.5V12l3 2',
  table: 'M4 5.5h16v13H4v-13ZM4 10h16M4 14.5h16M9.5 5.5v13',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3',
};

export function Icon({ name, size = 18, className = '' }) {
  return <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>;
}

// 商標：兩道斜線
export const Logo = ({ size = 26 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M9 4 6 13M15 11l-3 9" /></svg>;
