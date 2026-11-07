// 太陽能案場平台的「高精度」門檻（2026-11-07 使用者拍板，照評估時的建議值）。檢查與測試都引用這裡，不要各自寫數字。
//   planMm     平面位置 ±50 mm（RTK 空拍重建的現況比對：樁位平面偏移、排直線度、排距）
//   heightMm   高程 ±30 mm（樁頂高程）
//   sunDeg     太陽位置 ±0.01°（天頂與方位；SPA 本身對 NREL 範例差約 1e-5°，主要的誤差來源是 ΔT 與時間）
//   energyRel  全年發電量和 pvlib 相差 < 2%（core/solar 目前在浮點捨入等級）
export const SITE_PRECISION = Object.freeze({ planMm: 50, heightMm: 30, sunDeg: 0.01, energyRel: 0.02 });
