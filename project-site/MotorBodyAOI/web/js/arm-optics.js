// 手臂持件方案（R5，2026-11-22 使用者選定評估）的取像設定：DENSO 六軸手臂夾工件，相機與光源固定在相機井，飛拍＋逐張控光。
// 實體相機 5 台（RIG）＋P0 定位相機；每台相機在每個拍攝段對工件的相對位置寫成一筆「拍攝設定」（ARM_CAMERAS，格式與 optics-plan.js 的 CAMERAS 相同，
// 覆蓋、反光、刀紋計算直接共用 coverage.js／specular.js）。同一台實體相機的各筆設定，感測器、焦距、視野一定相同（tools/verify.mjs 會查）。
// station 只決定遮擋計算用哪一種夾爪：'ST2'＝手臂從法蘭側夾（爪柱往 −Z），開口側朝相機；'ST1'＝從開口側夾（爪柱往 +Z），法蘭側朝相機。
import { CAMERAS, dirAzTilt } from './optics-plan.js';

const base = id => CAMERAS.find(c => c.id === id);

// 實體相機：型號示意，鏡頭與光源全部固定；光源每張可以各自設亮度（序列式頻閃控制器）
export const RIG = {
  R1: { name: '頂視全幅', sensor: '5MP', f: 16, fovH: 110, lens: '16 mm 定焦', fps: 75 },
  R2: { name: '同軸頂視', sensor: '5MP', f: 25, fovH: 98, lens: '25 mm 定焦＋同軸光', fps: 75 },
  R3: { name: '反射鏡探頭', sensor: '1.6MP', f: 25, fovH: 52, lens: '25 mm 定焦＋45° 反射鏡探頭', fps: 120 },
  R4: { name: '斜視外側（K-斜）', sensor: '5MP', f: 35, fovH: 40, lens: '35 mm 定焦＋鏡頭環形光＋條形光 3 支', fps: 75 },
  R5: { name: '斜視孔壁（K-孔）', sensor: '1.6MP', f: 50, fovH: 18, lens: '50 mm 定焦＋鏡頭環形光', fps: 120 },
};

const cfg = (from, id, rig, seg, station, extra = {}) => {
  const R = RIG[rig];
  return { ...base(from), id, rig, seg, station, from, sensor: R.sensor, f: R.f, fovH: R.fovH, lens: R.lens, ...extra };
};

// 拍攝設定（工件座標）。seg：拍攝段（arm-plan.js 的 SEGMENTS）
export const ARM_CAMERAS = [
  // 開口側朝下（手臂從法蘭側夾）
  cfg('C1-4', 'R3-8', 'R3', 'O1', 'ST2', { name: '反射鏡正視杯內壁' }),
  cfg('C2-1', 'R2-7', 'R2', 'O2', 'ST2', { name: '同軸杯底' }),
  cfg('C2-4', 'R5-11', 'R5', 'O2', 'ST2', { name: '斜視 Ø28 孔壁' }),
  cfg('C2-2', 'R4-5', 'R4', 'O3', 'ST2', { name: '斜視凸緣外側＋開口端面' }),
  // 法蘭側朝下（換夾後，手臂從開口側夾）
  cfg('C1-1', 'R1-1', 'R1', 'F1', 'ST1', { name: '頂視法蘭側' }),
  // 面 3：K-斜沿用固定方案 C1-3 的幾何（側視、頂條光），改用 R4 的 5 MP＋35 mm
  cfg('C1-3', 'R4-3', 'R4', 'F1', 'ST1', { name: '側視止口' }),
  // 面 2：K-孔沿用 C1-2 的方位，斜角改 40°（與面 11 相同，兩段都讓工件軸接近鉛直），焦距改 50 mm
  cfg('C1-2', 'R5-2', 'R5', 'F2', 'ST1', { name: '斜視 Ø22 軸孔', toCam: dirAzTilt(90, 140) }),
];
