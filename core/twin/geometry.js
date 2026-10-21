// 幾何類虛擬感測器（站的 twin-binding.js 用它做 sense(sensor)）：photoEye 射線、proximity 區域（machine-description sensor.scene）。
// 偵測對象依類別：物件或它的祖先帶 userData.twinClass，且在 scene.detects 內；detects 為空陣列 = 所有實體網格。
// 呼叫前場景要已套用到目前狀態並更新世界矩陣（twin.apply(view)）。結果只依場景狀態決定（決定性）。
//
//   const sensors = createSceneSensors({ root: scene, resolve: path => … });
//   twin.sense = sensor => sensors.sense(sensor);
//   sensors.invalidate();   // 場景加入或移除網格後（例如工件）
import * as THREE from 'three';

const classOf = o => { for (let p = o; p; p = p.parent) if (p.userData?.twinClass) return p.userData.twinClass; return null; };
const visibleChain = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
// 半透明且不寫深度的輔助網格（防撞區、光束、雷射平面）不是實體
const solid = m => m.isMesh && !(m.material?.transparent && m.material.depthWrite === false);

export function createSceneSensors({ root, resolve = () => null }) {
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3(), dir = new THREE.Vector3(), sphere = new THREE.Sphere(), box = new THREE.Box3();
  let cache = new Map();
  function targets(detects) {
    const key = (detects || []).join('|');
    if (!cache.has(key)) {
      const list = [];
      root.traverse(o => { if (solid(o) && (!detects?.length || detects.includes(classOf(o)))) list.push(o); });
      cache.set(key, list);
    }
    return cache.get(key).filter(visibleChain);
  }
  function frame(g) {
    origin.fromArray(g.origin); dir.fromArray(g.dir || [0, 0, 1]);
    if (g.frame === 'object') {
      const obj = resolve(g.object);
      if (!obj) return false;
      obj.updateWorldMatrix(true, false);
      origin.applyMatrix4(obj.matrixWorld); dir.transformDirection(obj.matrixWorld);
    }
    dir.normalize();
    return true;
  }
  return {
    invalidate() { cache = new Map(); },
    sense(sensor) {
      const g = sensor.scene;
      if (!g || !Array.isArray(g.origin) || !frame(g)) return false;
      const list = targets(g.detects);
      if (sensor.type === 'proximity') {
        sphere.set(origin, g.range);
        return list.some(m => box.setFromObject(m).intersectsSphere(sphere));
      }
      raycaster.set(origin, dir); raycaster.near = 0; raycaster.far = g.range;
      return raycaster.intersectObjects(list, false).length > 0;
    },
  };
}
