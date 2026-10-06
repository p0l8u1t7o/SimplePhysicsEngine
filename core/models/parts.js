// 元件 ↔ 共用模型（評估平台 Q9）：用元件編號建出共用模型，並在模型的根標 userData.partRef（bom 檢查用編號比對成本表）。
//   import parts from './parts-models.js';             // studio 寫的元件清單：{ 'P-00132': { model: 'camera', params: {…}, name } }
//   registerParts(parts);
//   const cam = fromPart('P-00132', { focal: 16 });    // 建出 camera 模型（元件的 model_params 加上這裡的覆寫），root.userData.partRef = 'P-00132'
//   tagPart(myOwnGroup, 'P-00077');                    // 自己畫的設備也可以標編號
// 元件清單由 studio 在每輪代理執行前寫到專案的 web/js/parts-models.js（有 3D 模型的元件；瀏覽器與 Node 都直接 import）。
import { MODELS } from './index.js';

const registry = new Map();
export function registerParts(map = {}) { for (const [code, v] of Object.entries(map)) registry.set(code.toUpperCase(), v); return registry.size; }
export const partInfo = code => registry.get(String(code).toUpperCase()) || null;

export function tagPart(obj, code) { Object.assign((obj.root || obj).userData, { partRef: String(code).toUpperCase() }); return obj; }

export function fromPart(code, params = {}) {
  const p = partInfo(code);
  if (!p) throw new Error(`元件 ${code} 不在清單裡（registerParts 了嗎？清單只列有 3D 模型的元件）`);
  const M = MODELS.find(m => m.meta.id === p.model);
  if (!M) throw new Error(`元件 ${code} 的模型 ${p.model} 不在 core/models`);
  const inst = tagPart(M.create({ ...(p.params || {}), ...params }), code);
  inst.root.userData.coreModel ||= p.model;      // bom 檢查與走線靠它認得共用模型
  return inst;
}
