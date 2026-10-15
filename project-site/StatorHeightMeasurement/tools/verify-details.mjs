// 細節補強驗證：補上 core 決定性未涵蓋的頂點、實例矩陣、發光材質與量測畫布指令。
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createProject } from '../web/js/project.js';
import { drawMeasurement } from '../web/js/measurement-view.js';

const failures = [], variants = [];
let assertions = 0;
const check = (ok, message) => { assertions++; if (!ok) failures.push(message); };
const visible = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
for (const plan of ['box-laser', 'box-vision', 'piece-laser', 'piece-vision']) for (const part of ['stator', 'rotor']) {
  const scene = new THREE.Scene(), p = createProject({ scene, plan, part }), tag = `${plan}/${part}`;
  const times = [0, p.total];
  for (let t = 0; t <= p.total; t += .1) if (p.measured(t).current >= 0 && (times.length < 4 || t - times.at(-1) > 1)) times.push(+t.toFixed(3));
  times.sort((a, b) => a - b);
  const render = t => {
    const commands = [], ctx = new Proxy({}, {
      get: (_, key) => (...args) => { check(args.every(a => typeof a !== 'number' || Number.isFinite(a)), `${tag} 畫布 ${String(key)} 有非有限座標`); commands.push([key, ...args]); },
      set: (_, key, value) => { commands.push([key, value]); return true; },
    });
    drawMeasurement(ctx, 800, 500, t, p, (c, w, h, at) => commands.push(['grid', w, h, at, p.measured(at).count]));
    return commands;
  };
  const snapshot = t => {
    p.apply(t); scene.updateMatrixWorld(true);
    const hash = createHash('sha256');
    scene.traverse(o => {
      if (!visible(o) || (o.isInstancedMesh && o.count === 0)) return;
      for (const a of [o.geometry?.attributes?.position?.array, o.instanceMatrix?.array.subarray(0, o.count * 16)]) if (a) hash.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of materials) if (m) hash.update(JSON.stringify([m.emissiveIntensity, m.opacity, m.color?.getHex(), m.emissive?.getHex()]));
    });
    hash.update(JSON.stringify(render(t)));
    return hash.digest('hex');
  };
  const baseline = times.map(snapshot);
  [...times].reverse().forEach((t, i) => check(snapshot(t) === baseline[times.length - 1 - i], `${tag}@${t} 細節倒序不一致`));
  const waiting = render(0);
  check(waiting.some(c => c[0] === 'fillText' && String(c[1]).includes('WAIT')), `${tag} 等待時應顯示 WAIT`);
  check(waiting.some(c => c[0] === 'grid'), `${tag} 缺少 OK/NG 格位圖`);
  p.apply(0);
  const line = scene.getObjectByName('surface laser trace');
  check(line.userData.fx === true && !line.visible, `${tag} 未量測時雷射軌跡應隱藏且標示 FX`);
  check(p.operator.root.userData.operatorProxy === true, `${tag} 作業員標記遺失`);
  check(p.verify.allow.length === 0, `${tag} 不得新增 allow`);
  if (plan === 'box-laser') {
    let hits = 0, activeFrames = 0;
    for (const t of times) {
      p.apply(t);
      if (!line.visible) continue; activeFrames++;
      const pos = line.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const d = pos.getY(i) - p.station.holder.position.y - .25;
        check(Math.abs(d) < .001 || Math.abs(d - p.part.h) < .001, `${tag} 光線不在工件或基準面`);
        if (Math.abs(d - p.part.h) < .001) hits++;
      }
    }
    check(activeFrames > 0 && hits > 0, `${tag} 掃描沒有命中工件表面`);
  }
  variants.push({ plan, part, samples: times.length });
}
const report = { ok: failures.length === 0, assertions, variants, failures };
writeFileSync(new URL('../review/detail-verification.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report)); process.exitCode = report.ok ? 0 : 1;
