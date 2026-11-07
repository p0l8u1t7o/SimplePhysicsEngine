// 測試與瀏覽器決定性檢查共用的小情境（Node 的 node --test 與 browser.html 都 import 這份）
// 時間函式裡的三角函數用 collide.js 的 dsin／dcos：Math.sin 在 Node 26 與 Chrome 157 有時差 1 ulp，烘焙雜湊就會不同
import { dsin } from '../collide.js';
export const clothSmall = () => ({ name: '小布', size: [800, 800], segments: [16, 16], origin: [0, 600, 0], duration: 1.5, thickness: 3,
  pins: [{ node: [0, 0], pos: t => [-400, 600 + 80 * dsin(3 * t), -400] }, { node: [16, 0], pos: [400, 600, -400] }],
  wind: { velocity: [0, 0, 500], drag: 1 },
  colliders: [{ shape: 'plane', y: 0 }, { shape: 'sphere', r: 150, pos: [0, 300, 0] }, { shape: 'box', size: [200, 200, 200], pos: t => [300 * t, 100, 200], rot: [0, 30, 0] }] });

export const fluidSmall = () => ({ name: '小流體', spacing: 10, duration: 1.5, max: 1500, seed: 3, vorticity: 100,
  emitters: [{ type: 'nozzle', pos: [0, 300, 0], dir: [0.3, -1, 0], speed: 1200, flow: 30 }, { type: 'fill', min: [-90, 0, -40], max: [-30, 60, 40] }],
  colliders: [{ shape: 'tank', size: [240, 200, 160], wall: 10, pos: [0, 0, 0] }], kill: [{ min: [-1e4, -1e4, -1e4], max: [1e4, -100, 1e4] }] });

export const drumSmall = () => ({ name: '圓桶', spacing: 12, duration: 2, max: 1200,
  emitters: [{ type: 'nozzle', pos: [0, 450, 0], dir: [0, -1, 0], speed: 1500, flow: 50, stop: 1.2 }],
  colliders: [{ shape: 'drum', r: 120, h: 300, wall: 6, pos: [0, 0, 0] }, { shape: 'plane', y: -6 }], contain: { min: [-120, -1, -120], max: [120, 400, 120] } });
