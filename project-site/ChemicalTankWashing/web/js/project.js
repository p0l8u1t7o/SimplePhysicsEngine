// 專案介面（core 統一檢查與 main.js 共用）：建立全場設備與動畫排程，apply(t) 把場景放到時間 t。
// 規格見 core/README.md「專案介面」。
import * as THREE from 'three';
import { buildPlant, applyPlant } from './plant.js';
import { createSequence } from './sequence.js';
import { layoutChecks } from './layout.js';

export function createProject({ scene }) {
  const plant = buildPlant(scene), seq = createSequence({ robot: plant.ikRobot });
  const nonPhysical = new Set([plant.building.zones, plant.building.dims, plant.building.ceiling]);
  const top = o => { let p = o; while (p.parent && p.parent !== scene) p = p.parent; return p.name || 'misc'; };
  const isDrum = o => { for (let p = o; p; p = p.parent) if (p.name?.startsWith('drum ')) return true; return false; };
  const moduleOf = m => isDrum(m) ? 'drum' : top(m);
  return {
    total: seq.total, plant, seq,
    apply(t, { playing = false } = {}) { const sm = seq.sample(t); applyPlant(plant, sm, { playing }); return sm; },
    layoutChecks,
    verify: {
      dt: .5,
      skip: o => nonPhysical.has(o),
      moduleOf,
      // 產線（line）內依 line.js 建立時標記的工位分組：不同工位的固定件互相穿插也算架設相撞
      stationOf: m => { for (let p = m; p; p = p.parent) if (p.userData.station) return p.userData.station; return 'misc'; },
      allow: [
        { why: '桶由各站支撐、夾持或噴槍伸入，桶的干涉另由 verify.mjs 檢查', test: (a, b, c) => c.moduleOf(a) === 'drum' || c.moduleOf(b) === 'drum' },
        { why: 'AGV 叉取棧板：貨叉插入棧板底樑之間屬正常；AGV 車身另以 2D 多邊形對牆與設備驗證（verify.mjs）', test: (a, b, c) => [a, b].some(m => c.moduleOf(m) === 'agv') && [a, b].some(m => c.moduleOf(m) === 'pallets') },
        { why: '手臂本體與夾爪內部零件為廠商／夾爪模型，自身干涉另見 verify-gripper.mjs', test: (a, b, c) => c.moduleOf(a) === 'robot' && c.moduleOf(b) === 'robot' },
      ],
      envelope: ['robot'],
    },
  };
}
