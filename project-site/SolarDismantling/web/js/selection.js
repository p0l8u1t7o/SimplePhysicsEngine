// 手臂選型評估（使用者要求評估 FANUC 負載約 30 kg 級）：以型錄的負載、伸展、手腕容許力矩與慣量，對照兩種夾持方式的需求。
// 型錄值來源：FANUC 各型號資料表（R-2000iC/165F 取自 fanucamerica 資料表；M-710iC 系列、M-20iD/35 取自 FANUC 型錄摘要），採用前再以原廠資料核對。
// 需求計算（概略，供選型比較，不取代原廠負載診斷軟體）：
//   力矩＝質量 × g × 重心離手腕軸的水平距離；慣量＝Σ（自身慣量＋質量 × 距離²），板以均質矩形板計。
import { PANEL, GRIP } from './layout.js';

const g = 9.81;
const plateI = (m, a, b) => m * (a * a + b * b) / 12;          // 矩形板繞法線軸（kg·m²，a、b 為邊長 m）
const rodI = (m, a) => m * a * a / 12;

export const CANDIDATES = [
  { model: 'M-20iD/35', payload: 35, reach: 1831, moment: { j5: 110, j6: 60 }, inertia: { j5: 4, j6: 1.5 }, note: '30 kg 級' },
  { model: 'M-710iC/50', payload: 50, reach: 2050, moment: { j5: 206, j6: 127 }, inertia: { j5: 21, j6: 13 }, note: '' },
  { model: 'M-710iC/45M', payload: 45, reach: 2606, moment: { j5: 206, j6: 127 }, inertia: { j5: 28, j6: 20 }, note: '採用' },
  { model: 'R-2000iC/165F', payload: 165, reach: 2655, moment: { j5: 940, j6: 490 }, inertia: { j5: 89, j6: 46 }, note: '第一版' },
];

// 兩種夾持方式的需求
export function requirements() {
  const m = PANEL.kg, L = PANEL.L / 1000, W = PANEL.W / 1000;
  // 置中吸盤架（本版）：板中心在法蘭軸下方；放板誤差取 50 mm 偏心；J5 軸在吸盤面上方 389 mm（手腕 175＋吸盤架 214）
  const h = (175 + GRIP.D) / 1000, gm = GRIP.kg;
  const centered = {
    name: '置中吸盤架（本版）', kg: m + gm, reach: 2404 + 150,                     // 最遠工位中心到 J1 軸＋J5 前伸
    moment: (m + gm) * g * .05,
    j5: plateI(m, L, .035) + m * (h + .015) ** 2 + rodI(gm, 1.26) + gm * .3 ** 2,
    j6: plateI(m, L, W) + plateI(gm, 1.26, .58),
  };
  // 懸臂側進吸盤架（第一版）：板中心水平外伸 1.1 m；吸盤架 32 kg、重心約外伸 0.55 m
  const C = 1.1, cm = 32;
  const cantilever = {
    name: '懸臂側進吸盤架（第一版）', kg: m + cm, reach: 2655,
    moment: (m * C + cm * .55) * g,
    j5: plateI(m, W, .035) + m * (C * C + .515 ** 2) + cm * (.55 ** 2 + .3 ** 2) + rodI(cm, 1.43),
    j6: plateI(m, L, W) + m * C * C + cm * .55 ** 2 + rodI(cm, 1.43),
  };
  return [centered, cantilever];
}

// 每個候選型號對每種夾持方式的判定：{ ok, reasons[] }
export function evaluate() {
  const reqs = requirements();
  return CANDIDATES.map(c => ({
    ...c,
    results: reqs.map(r => {
      const reasons = [];
      if (r.kg > c.payload) reasons.push(`負載 ${r.kg.toFixed(1)} > ${c.payload} kg`);
      if (r.moment > c.moment.j5) reasons.push(`手腕力矩 ${Math.round(r.moment)} > ${c.moment.j5} N·m`);
      if (r.j5 > c.inertia.j5) reasons.push(`J5 慣量 ${r.j5.toFixed(1)} > ${c.inertia.j5} kg·m²`);
      if (r.j6 > c.inertia.j6) reasons.push(`J6 慣量 ${r.j6.toFixed(1)} > ${c.inertia.j6} kg·m²`);
      if (r.reach > c.reach) reasons.push(`伸展 ${r.reach} > ${c.reach} mm（要重排配置）`);
      return { req: r.name, ok: !reasons.length, reasons };
    }),
  }));
}
