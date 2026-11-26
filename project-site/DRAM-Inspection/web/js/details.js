// 光學回饋與既有機構的表面標記；不新增市購元件，不改排程。
import * as THREE from 'three';
import { block } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { MOD, INT } from './parts.js';
import { LAY } from './machine.js';

export function createDetails({ scene, ints, st, locker }) {
  const light = new THREE.MeshBasicMaterial({ color: 0xff3535, toneMapped: false, depthWrite: false });
  const line = (w, d) => {
    const o = new THREE.Mesh(new THREE.PlaneGeometry(w, d), light);
    o.rotation.x = -Math.PI / 2; o.material = light; o.userData.fx = true; o.visible = false; scene.add(o); return o;
  };
  const top = line(MOD.L - 2, .28), bottom = line(.28, MOD.W - 1);
  bottom.rotation.x = Math.PI / 2;
  // 捲輪側面印記讓既有 tape 轉角可辨識；與端面留 0.08 mm，不共面。
  for (const reel of st.wipe.reels) for (const angle of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
    const mark = block(reel, [7, .12, 1.2], [10 * Math.cos(angle), 18.14, 10 * Math.sin(angle)], MAT.steelBlue);
    mark.name = 'wipe reel mark'; mark.rotation.y = -angle; mark.castShadow = false;
  }
  const tapeMarks = [];
  for (let i = 0; i < 6; i++) {
    const m = block(st.wipe.pad, [.7, .08, 2.2], [0, st.wipe.padTop - .58, LAY.st.wipe[1] + 10.8], MAT.steelBlue);
    m.castShadow = false; tapeMarks.push(m);
  }
  // 起子柄的偏心色帶隨原套筒轉數轉動，保留真實轉速（高速時可能有取樣混疊）。
  const bitMark = block(locker.nutrunner.socket, [.35, 10, .12], [0, 21, 1.68], MAT.steelOrange);
  bitMark.castShadow = false;
  function set(S) {
    top.visible = false; bottom.visible = false;
    for (let k = 0; k < ints.length; k++) {
      const p = ints[k], state = S['i' + k];
      if (S.trayI.laser > .5 && state.loc === 'tray' && Math.abs(p.position.z - (LAY.tray.scan - 20)) < MOD.W / 2) {
        top.visible = true; top.position.set(p.position.x, p.position.y + INT.t + INT.pin + .08, LAY.tray.scan - 20);
      }
      if (S.st.prof > .5 && state.loc === 'A' && Math.abs(p.position.x - LAY.st.prof[0]) < MOD.L / 2) {
        bottom.visible = true; bottom.position.set(LAY.st.prof[0], p.position.y - INT.pin - .08, p.position.z);
      }
    }
    for (let i = 0; i < tapeMarks.length; i++) tapeMarks[i].position.x = LAY.st.wipe[0] - 48 + (i * 16 + S.st.tape * 32) % 96;
  }
  return { set, top, bottom, tapeMarks };
}
