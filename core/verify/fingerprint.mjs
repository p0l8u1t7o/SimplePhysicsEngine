// 排程指紋：渲染與細節補強前後比對用，補強只能改「看起來」，不能改「做了什麼」。
//   total     時間軸總長
//   events    事件表（時間、名稱、站別），取自 project.timeline／sequence／events
//   states    固定時間點 apply(t) 回傳的狀態（只取數字、字串、布林；Three 物件與函式略過）；
//             比對時原有欄位必須相同，補強新增的欄位（例如拖鏈角度）不算改變
//   moving    有名稱且會動的物件，在各時間點的世界座標（mm，取到 0.1）
// 新增的細節幾何（沒名稱、或不會動）不影響指紋；改節拍、改動作、改站位都會被抓到。
import * as THREE from 'three';

const r3 = x => Math.round(x * 1000) / 1000, r1 = x => Math.round(x * 10) / 10;

// 只保留純資料；Three 物件、函式、DOM 都略過，循環參照只走一次
function plain(v, seen = new WeakSet(), depth = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? r3(v) : String(v);
  if (typeof v === 'string' || typeof v === 'boolean' || v == null) return v ?? null;
  if (typeof v !== 'object' || depth > 6 || v.isObject3D || v.isMaterial || v.isBufferGeometry || seen.has(v)) return undefined;
  seen.add(v);
  if (Array.isArray(v)) return v.map(x => plain(x, seen, depth + 1));
  if (v.isVector3 || v.isVector2 || v.isEuler || v.isQuaternion) return v.toArray().map(r3);
  const o = {};
  for (const k of Object.keys(v).sort()) { const x = plain(v[k], seen, depth + 1); if (x !== undefined) o[k] = x; }
  return o;
}

const pathOf = o => { const p = []; for (let x = o; x && x.parent; x = x.parent) if (x.name) p.unshift(x.name); return p.join('/'); };

export function fingerprint(project, scene, { samples = 40 } = {}) {
  const total = project.total;
  const times = Array.from({ length: samples }, (_, i) => +(total * (i + .37) / samples).toFixed(4));
  const src = project.timeline?.events || project.sequence?.events || project.events || [];
  const events = src.map(e => [r3(e.time ?? e.t ?? 0), e.label ?? e.name ?? '', e.station ?? null]);
  const named = []; scene.traverse(o => { if (o.name) named.push(o); });
  const track = new Map(named.map(o => [o, []])), states = [], w = new THREE.Vector3();
  for (const t of times) {
    states.push(plain(project.apply(t)) ?? null);
    scene.updateMatrixWorld(true);
    for (const o of named) track.get(o).push(o.getWorldPosition(w).toArray().map(r1));
  }
  const moving = {};
  for (const [o, ps] of track) {
    if (!ps.some(p => p.some((x, k) => Math.abs(x - ps[0][k]) > .05))) continue;
    let key = pathOf(o); for (let n = 2; key in moving; n++) key = `${pathOf(o)}#${n}`;
    moving[key] = ps;
  }
  return { total: r3(total), samples, events, states, moving };
}
