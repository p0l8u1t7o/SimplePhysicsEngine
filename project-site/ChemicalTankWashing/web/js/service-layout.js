// 本輪新增附屬設施的世界座標（mm）；既有設備仍以 layout.js 為唯一來源。
import { CLEAN, FILL, ROBOT, toWorld } from './layout.js';

const [rx, rz] = toWorld('cell', ROBOT.x, ROBOT.z);
export const SERVICES = {
  trayY: 3800, northZ: FILL.distZ, trayWidth: 160,
  pass: { z0: FILL.distZ - 180, z1: FILL.distZ + 180, bottom: 3720, top: 3950 },
  robot: { x: rx, z: rz, reach: 2655, eastX: CLEAN.x1 - 110, endX: rx + 502 },
  showers: [[800, 300], [12100, 10800], [25200, 4100]],
};
