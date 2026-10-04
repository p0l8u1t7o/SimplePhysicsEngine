// 第二段範例的自我檢查（check.mjs 的 core · examples）：龍門＋segment2.js 單獨建場景，
// 台車走完整個行程，跑電控配置與配線檢查；core 改了電控或線材模組時確認範例仍然可以照抄。
//   node --import ./core/tools/register.mjs core/examples/segment2/check.mjs
import '../../verify/dom-stub.mjs';
import * as THREE from 'three';
import { create as createGantry } from '../../models/gantry.js';
import { createSegment2 } from './segment2.js';
import { checkElectricalPlan } from '../../verify/electrical.mjs';
import { checkCableScenarios } from '../../verify/cables.mjs';

const scene = new THREE.Scene(), gantry = createGantry({ span: 1300, height: 1700, offset: 400 });
gantry.root.position.set(350, 0, -400); scene.add(gantry.root);
const seg = createSegment2(scene, { gantry, cab: { center: [1600, 450, -500], size: [600, 900, 400] }, cam: { at: [-600, 1250, 0], postZ: 450 } });
const [min, max] = [-gantry.params.span / 2 + 100, gantry.params.span / 2];
const apply = t => { const x = min + (max - min) * t; gantry.set({ x, y: 1250, jaw: 1 }); seg.set({ x, light: t }); scene.updateMatrixWorld(true); };
apply(0);
const plan = checkElectricalPlan(scene);
const obstacles = []; for (const o of [gantry.root, scene.getObjectByName('camera mount'), seg.camera.root]) o.traverse(m => { if (m.isMesh && !m.userData.routingHardware) obstacles.push(m); });
const cables = checkCableScenarios([{ name: 'sweep', scene, apply, times: Array.from({ length: 41 }, (_, i) => i / 40), obstacles }], { minRoutes: 4 });
const fails = [...plan.failures, ...cables.failures.map(f => `${f.key}（${f.method}）`)];
if (plan.devices < 9 || plan.feedthroughs.glands < 2) fails.push(`元件 ${plan.devices}、接頭 ${plan.feedthroughs.glands}：範例不完整`);
console.log(`${fails.length ? '✗' : '✓'} segment2：${plan.devices} 個元件、${plan.connections} 條櫃內連線、${plan.feedthroughs.glands} 個接頭、${cables.report[0].routes} 條線路`);
for (const f of fails) console.log('   ' + f);
process.exit(fails.length ? 1 : 0);
