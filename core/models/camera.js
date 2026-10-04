// 工業相機（參數化）：機身＋鏡頭＋選配環形光源，內含依感光元件與焦距算出視角的虛擬相機（給相機子畫面用）。
// 光軸是本地 −Y（預設朝下）；鏡頭前緣在原點。要斜看或朝上時旋轉 root。state：light（光源亮度 0～1）。
import * as THREE from 'three';
import { MAT } from '../geom/materials.js';

export const meta = {
  id: 'camera', name: '工業相機＋鏡頭＋環形光源', category: '視覺',
  params: {
    sensorW: { value: 8.8, min: 3, max: 36, step: .1, unit: 'mm', label: '感光元件寬（2/3" 為 8.8）' },
    sensorH: { value: 6.6, min: 2, max: 24, step: .1, unit: 'mm', label: '感光元件高（2/3" 為 6.6）' },
    focal: { value: 25, min: 4, max: 200, step: 1, unit: 'mm', label: '鏡頭焦距' },
    body: { value: 44, min: 25, max: 90, step: 1, unit: 'mm', label: '機身邊長' },
    lensD: { value: 34, min: 14, max: 80, step: 1, unit: 'mm', label: '鏡頭外徑' },
    lensL: { value: 45, min: 15, max: 200, step: 1, unit: 'mm', label: '鏡頭長度' },
    ring: { value: 60, min: 0, max: 200, step: 5, unit: 'mm', label: '環形光源外半徑（0 不裝）' },
  },
  states: { light: { value: 1, min: 0, max: 1, label: '光源亮度' } },
  usage: "import { create as visionCamera, lensFov } from '@core/models/camera.js';\nconst cam = visionCamera({ focal: 16 }); cam.root.position.set(x, 900, z); scene.add(cam.root);\ncam.set({ light: 1 }); workspace.renderCamera({ renderer, scene, camera: cam.camera, aspect: cam.aspect, title: '上視相機' });\ncam.fieldOfView(工作距離) → [寬, 高] mm（視野）",
};

// 垂直視角（度）：感光元件高 h、焦距 f
export const lensFov = (h, f) => 2 * Math.atan(h / 2 / f) * 180 / Math.PI;

export function create(p = {}) {
  const P = { ...Object.fromEntries(Object.entries(meta.params).map(([k, v]) => [k, v.value])), ...p };
  const root = new THREE.Group(); root.name = 'camera';
  const B = P.body, rL = P.lensD / 2;
  // 機身在鏡頭後方（+Y），接線端朝上
  const body = new THREE.Mesh(new THREE.BoxGeometry(B, B * 1.3, B), MAT.steelDark); body.name = 'camera body'; body.position.y = P.lensL + B * .65; root.add(body);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(rL, rL, P.lensL, 32), MAT.chrome || MAT.alu); lens.name = 'lens barrel'; lens.position.y = P.lensL / 2; root.add(lens);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(rL * .7, rL * .7, 1, 32), new THREE.MeshStandardMaterial({ color: 0x1b2a3a, metalness: .2, roughness: .05 }));
  glass.name = 'lens glass'; glass.position.y = -.5; root.add(glass);   // 貼在鏡筒前緣外側（面朝相反，不閃爍）
  const plug = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 14, 16), MAT.alu); plug.name = 'M12 connector'; plug.position.y = P.lensL + B * 1.3 + 7; root.add(plug);
  let ringMat = null;
  if (P.ring > 0) {
    const tube = Math.min(10, (P.ring - rL - 4) / 2);
    if (tube < 3) throw new Error('camera: ring light radius must exceed lens radius + 10 mm');
    ringMat = new THREE.MeshStandardMaterial({ color: 0xdfe8ee, emissive: 0xffffff, emissiveIntensity: 1, roughness: .4 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(P.ring - tube, tube, 12, 48), ringMat); ring.name = 'ring light'; ring.rotation.x = Math.PI / 2; ring.position.y = tube; root.add(ring);
  }
  // 虛擬相機：在鏡頭前緣、朝 −Y；aspect＝感光元件寬高比
  const aspect = P.sensorW / P.sensorH, fov = lensFov(P.sensorH, P.focal);
  const camera = new THREE.PerspectiveCamera(fov, aspect, 5, 8000); camera.name = 'camera view'; camera.rotation.x = -Math.PI / 2; root.add(camera);
  return {
    root, params: P, camera, fov, aspect,
    fieldOfView: wd => [wd * P.sensorW / P.focal, wd * P.sensorH / P.focal],
    set({ light = 1 } = {}) { if (ringMat) ringMat.emissiveIntensity = light; },
  };
}
