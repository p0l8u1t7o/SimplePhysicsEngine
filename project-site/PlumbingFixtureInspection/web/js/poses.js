// 產品在機台各處的固定姿態（排程、轉檔工具的拍攝順序起點與空間檢核共用）。
// 產品姿態 = { quat, pos }：產品座標（+Y 安裝軸、原點在安裝端面中心）到世界。
import * as THREE from 'three';
import { DRAWER, QC, ADAPTERS, SCAN, nestZ } from './layout.js';
import { PRODUCT_IN_TOOL } from './robot.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// 轉接頭躺在抽屜定位座上：工具座標與世界同向（快換盤朝 −Z＝手臂側、產品往 +Z），本體中心在定位座中心
export function nestTool(kind, side, ext = 0) {
  const A = ADAPTERS[kind], center = QC.master + QC.plate + A.body[1] / 2;
  return { quat: new THREE.Quaternion(), origin: V(DRAWER.xs[side], DRAWER.axisY, nestZ(ext) - center) };
}
export const productFromTool = (kind, tool) => ({
  quat: tool.quat.clone().multiply(PRODUCT_IN_TOOL),
  pos: tool.origin.clone().add(V(0, 0, ADAPTERS[kind].mount).applyQuaternion(tool.quat)),
});
// 把產品的 anchor（產品座標）放到 point，產品軸朝 axis、繞軸自轉 spin
export function productAt(anchor, axis, spin, point) {
  const quat = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), axis.clone().normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), spin));
  return { quat, pos: point.clone().sub(anchor.clone().applyQuaternion(quat)) };
}
// 3D 快掃：錨點在掃描位、產品軸往西傾 SCAN.tilt；兩個自轉角各掃一次（正面、背面）
const SCAN_AXIS = V(-Math.sin(SCAN.tilt * Math.PI / 180), Math.cos(SCAN.tilt * Math.PI / 180), 0);
export const scanPose = (anchor, spin = 0) => productAt(anchor, SCAN_AXIS, spin, V(...SCAN.spot));
