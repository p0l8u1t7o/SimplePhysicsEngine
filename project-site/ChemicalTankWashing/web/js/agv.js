// 平衡重式堆高 AGV：模型在共用模型庫（core/models/agv-forklift.js），這裡只套用本專案的尺寸。
import { AGV, FORK } from './layout.js';
import { create } from '@core/models/agv-forklift.js';
import * as THREE from 'three';
import { MAT } from '@core/geom/materials.js';

// 透明藍色投影是視覺提醒，不是可碰撞零件；貼圖與幾何由兩台車共用。
const pixels = new Uint8Array(64 * 64 * 4);
for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
  const i = (y * 64 + x) * 4, edge = Math.min(x, y, 63 - x, 63 - y);
  pixels.set([22, 135, 255, edge < 2 ? 220 : edge < 5 ? 100 : 24], i);
}
const zoneMap = new THREE.DataTexture(pixels, 64, 64); zoneMap.colorSpace = THREE.SRGBColorSpace; zoneMap.needsUpdate = true;
const zoneGeometry = new THREE.PlaneGeometry(1400, 1500);
const zoneMaterial = new THREE.MeshBasicMaterial({ map: zoneMap, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
const beaconGeometry = new THREE.CylinderGeometry(59, 59, 80, 12, 1, true, 0, Math.PI / 2);
const beaconCapGeometry = new THREE.CylinderGeometry(58, 58, 10, 16);

export function createAgv(scene, name = 'agv') {
  const agv = create({
    rear: AGV.rear, halfW: AGV.halfW, mast: AGV.mast, mastLowered: AGV.mastLowered, backrest: AGV.backrest,
    forkStart: AGV.fork[0], forkEnd: AGV.fork[1], forkHalf: AGV.forkHalf, palletX: AGV.palletX, deck: FORK.deck,
  });
  agv.root.name = name; scene.add(agv.root);
  const cap = new THREE.Mesh(beaconCapGeometry, MAT.steelDark);
  cap.position.set(-650, 1296, 0); cap.name = 'beacon top cap'; agv.root.add(cap);
  const lensMaterial = new THREE.MeshStandardMaterial({ color: 0xffa522, emissive: 0xff9a0b, emissiveIntensity: .08, roughness: .3, side: THREE.DoubleSide });
  const lens = new THREE.Mesh(beaconGeometry, lensMaterial);
  lens.position.set(-650, 1235, 0); lens.name = 'rotating amber beacon'; agv.root.add(lens);
  const zone = new THREE.Mesh(zoneGeometry, zoneMaterial);
  zone.name = 'AGV forward safety projection'; zone.userData.fx = true;
  zone.rotation.x = -Math.PI / 2; zone.position.set(2500, 12, 0); zone.visible = false; agv.root.add(zone);
  const setBase = agv.set;
  agv.safety = { lens, zone };
  agv.set = (state = {}) => {
    setBase(state);
    const { moving = false, time = 0 } = state;
    zone.visible = moving;
    lens.rotation.y = moving ? time * 7 : 0;
    lensMaterial.emissiveIntensity = moving ? (Math.sin(time * 8) > -.2 ? 2.4 : .25) : .08;
  };
  return agv;
}
