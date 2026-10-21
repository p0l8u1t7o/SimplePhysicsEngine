// 孿生的即時干涉（開發計畫 4.4 S5）：站指定會動的網格（movers）與要避開的網格（obstacles），
// broad-phase 用世界外框、narrow-phase 用 core/verify/scene.mjs 的 OBB 分離軸（obb、gap）；穿插超過 tol（mm）才算干涉。
// 定位是警示，不是安全保證，也不是連續碰撞證明（只在取樣時刻判斷）。呼叫前場景要已套用到目前狀態（twin.apply(view)）。
//
//   const watch = createCollisionWatch({ root: scene, movers: () => robotMeshes, obstacles: () => keepout, allow: (a, b) => false });
//   twin.collide = () => watch.check();   // → [{ a, b, depth }]（a、b 是場景路徑，依路徑排序）
import * as THREE from 'three';
import { obb, gap } from '../verify/scene.mjs';

// 物件 → 場景路徑（common scenePath：/ 分段、每段非空、前後不可有空白、總長 ≤ 256）：
// 只列有名字的祖先（沒命名的群組略過），所以沿名稱逐段往子孫找（core/twin/binding.js 的 resolvePath）可以找回；網格本身沒名字時用型別
export function scenePath(o, root = null) {
  const segs = [], clean = s => s.replace(/\//g, '-').trim();
  for (let p = o; p && p !== root && p.parent; p = p.parent) if (p === o || clean(p.name || '')) segs.unshift(clean(p.name || '') || p.type);
  let path = segs.join('/');
  while (path.length > 256 && segs.length > 1) { segs.shift(); path = segs.join('/'); }
  return path.slice(-256);
}

export function createCollisionWatch({ root = null, movers, obstacles, allow = () => false, tol = 2 }) {
  const list = v => (typeof v === 'function' ? v() : v).filter(m => m.isMesh);
  const boxA = new THREE.Box3(), boxB = new THREE.Box3();
  const visible = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  return {
    check() {
      const out = [], A = list(movers).filter(visible), B = list(obstacles).filter(visible);
      const boxes = B.map(m => boxB.clone().setFromObject(m));
      for (const a of A) {
        boxA.setFromObject(a).expandByScalar(-tol);
        if (boxA.isEmpty()) continue;
        let oa = null;
        B.forEach((b, i) => {
          if (a === b || !boxA.intersectsBox(boxes[i]) || allow(a, b)) return;
          oa = oa || obb(a);
          const g = gap(oa, obb(b));
          if (g < -tol) out.push({ a: scenePath(a, root), b: scenePath(b, root), depth: Math.round(-g * 1000) / 1000 });
        });
      }
      return out.sort((x, y) => (x.a + '\u0000' + x.b < y.a + '\u0000' + y.b ? -1 : 1));
    },
  };
}
