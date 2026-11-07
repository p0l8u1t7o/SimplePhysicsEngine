// core/structure：參數化光伏鋼構（固定式支架、單軸追日），依地形逐支計算構件、切長、重量、基樁埋深與 BOM。
// 純計算（profiles、rack、tracker、members、loads、checks）不依賴 three，可以在 Node 直接跑；3D 在 build.js。
export { PROFILES, profile, sectionArea, kgPerM, sectionSize, STEEL_DENSITY } from './profiles.js';
export { member, bom, splitStock } from './members.js';
export { layoutFixedRack, tablePoint, RACK_DEFAULTS } from './rack.js';
export { layoutTracker, rotatePoint, TRACKER_DEFAULTS } from './tracker.js';
export { ESTIMATE, windPressure, cfMonoslope, CF_MONOSLOPE, snowMu1, snowOnPlane, groupLoads } from './loads.js';
export { structureChecks } from './checks.js';
export { buildStructure, profileGeometry, sectionShape, memberMatrix, pvFixedRack, pvTracker, STRUCT_MAT } from './build.js';
