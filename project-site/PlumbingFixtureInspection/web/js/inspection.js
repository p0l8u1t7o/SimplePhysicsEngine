// 判定：產品登錄、判定規則庫（表面處理 × 瑕疵類型 × A/B 面，計畫書 4.5）、動畫用的示範瑕疵與候選點。
// 規則庫是整套系統唯一的「配方」；允收值待客戶瑕疵量化表（假設值，見 PENDING.md）。
import * as THREE from 'three';
import sleeve from './products/sleeve-12449.js';
import gooseneck from './products/gooseneck-demo.js';
import { productData, nearestTri } from './product-mesh.js';

export const PRODUCTS = { sleeve, gooseneck };
export const FINISH = { chrome: '鏡面鉻', brushed: '拉絲緞面鎳', pvd: 'PVD 色系' };
export const MODE = { chrome: '相位偏折術＋擴散白光', brushed: '光度立體＋擴散白光', pvd: '偏折術（HDR）＋色差' };

// 判定規則庫（假設值）：碰傷直徑 mm、刮痕長度 mm、異色 ΔE
export const RULES = {
  chrome: { 碰傷: { A: .3, B: .6, unit: 'mm' }, 刮痕: { A: 1, B: 3, unit: 'mm' }, 異色: { A: 2, B: 3.5, unit: 'ΔE' } },
};

// 示範候選點（產品座標的大概位置，吸附到最近的表面三角形）：
//   kind：defect＝真瑕疵（依規則庫分級）、feature＝設計特徵（遮罩內，AI 分類排除）、texture＝拋光紋（正常紋理，AI 分類排除）
const DEMO = {
  'sleeve-12449': [
    { kind: 'defect', type: '碰傷', at: [-18.3, 56, -6.7], value: .6 },
    { kind: 'defect', type: '異色', at: [9.9, 30, -17.1], value: 2.6 },
    { kind: 'defect', type: '刮痕', at: [0, 3, 17.7], value: 1.8 },
    { kind: 'feature', type: '設計特徵（凸環稜線）', at: [17.3, 12.5, 10] },
    { kind: 'texture', type: '拋光紋', at: [-10.6, 45, 18.4] },
  ],
  'gooseneck-demo': [
    { kind: 'defect', type: '刮痕', at: [0, 38, 16], value: 2.2 },
    { kind: 'defect', type: '異色', at: [0, 150, 11], value: 1.2 },
    { kind: 'feature', type: '設計特徵（起泡器螺牙）', at: [170, 196, 12.5] },
    { kind: 'texture', type: '拋光紋', at: [85, 345, 11] },
  ],
};

// 候選點：位置、法向量、A/B 面、哪個姿態第一次量到、判定結果
export function candidates(prod) {
  const { m, cls, firstView } = productData(prod), rules = RULES[prod.finish] || RULES.chrome;
  return (DEMO[prod.id] || []).map(c => {
    const t = nearestTri(prod, c.at), face = cls[t] === 0 ? 'A' : 'B';
    const pos = new THREE.Vector3(m.cen[t * 3], m.cen[t * 3 + 1], m.cen[t * 3 + 2]), nor = new THREE.Vector3(m.nor[t * 3], m.nor[t * 3 + 1], m.nor[t * 3 + 2]);
    let verdict = 'ignore', limit = null;
    if (c.kind === 'defect') { const r = rules[c.type]; limit = r[face]; verdict = c.value > limit ? 'NG' : 'OK'; }
    return { ...c, tri: t, face, pos, nor, view: firstView[t], verdict, limit, unit: rules[c.type]?.unit };
  });
}
export const overall = prod => candidates(prod).some(c => c.verdict === 'NG') ? 'NG' : 'OK';
