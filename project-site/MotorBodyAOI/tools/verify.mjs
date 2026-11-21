// 本站自有檢查（快速檢查會跑）：
//   1. 12 面對照：STEP 網格上各面的 Z、半徑範圍與 body.js 的對照表一致
//   2. 取像覆蓋：用 STEP 射線重算，結果要和 web/js/coverage-data.js 的 SUMMARY 完全相同（不同代表忘了重跑 tools/plan.mjs），且 12 面覆蓋、照明都 ≥ 99%
//   3. 對照組：C2-4 斜到 50° 一定要被杯口凸緣擋住；C1-4 反射鏡縮小時面 8 一定要掉覆蓋（抓不到代表檢查失效）
//   4. 面板檢核（解析度、景深、入射角、CT、伺服軸數、夾持、抬升淨空）全部通過
//   5. 客戶名稱整字檢查：本站進版控的檔案不得出現單獨的那個英文縮寫（名單只放長字串，見根目錄規則）
//   node core/tools/run.mjs MotorBodyAOI tools/verify.mjs
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, mkdirSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject } from '../web/js/project.js';
import { CAMERAS, dirAzTilt } from '../web/js/optics-plan.js';
import { coverageReport, checkFaceGeometry, computeCoverage } from '../web/js/coverage.js';
import { SUMMARY } from '../web/js/coverage-data.js';
import { CT, STATION_TIMES, XFER_TIME, BOTTLENECK, SERVO_AXES } from '../web/js/sequence.js';

const SITE = fileURLToPath(new URL('..', import.meta.url));
const failures = [], notes = [];

// 1. 12 面對照
failures.push(...checkFaceGeometry());

// 2. 覆蓋重算
const { summary } = coverageReport();
if (JSON.stringify(summary) !== JSON.stringify(SUMMARY)) failures.push('coverage-data.js 過期：請重跑 node core/tools/run.mjs MotorBodyAOI tools/plan.mjs');
for (const [no, f] of Object.entries(summary.faces)) if (f.coverage < 99 || f.lit < 99) failures.push(`面 ${no} 覆蓋 ${f.coverage}%、照明 ${f.lit}%（< 99%）`);

// 3. 對照組：斜過頭一定要被凸緣擋住
for (const [id, az, tilt, face] of [['C2-4', 270, 50, 11]]) {
  const cam = { ...CAMERAS.find(c => c.id === id), toCam: dirAzTilt(az, tilt), b: .3 };
  const s = computeCoverage({ cameras: [cam] }).cameras[id].faces[face];
  const blocked = s.lost['被遮擋'];
  if (!(blocked > 10)) failures.push(`對照組失效：${id} 斜到 ${tilt}° 時面 ${face} 應被杯口凸緣擋住，實際被擋 ${blocked?.toFixed(1)} mm²`);
  else notes.push(`對照組：${id} 斜到 ${tilt}° 面 ${face} 被擋 ${blocked.toFixed(0)} mm²（覆蓋 ${(s.coverage * 100).toFixed(1)}%）`);
}

// 3b. 對照組：反射鏡縮小到看不到整個壁高時，面 8 一定要掉覆蓋（否則鏡面範圍檢查失效）
{
  const c14 = CAMERAS.find(c => c.id === 'C1-4'), cam = { ...c14, mirror: { ...c14.mirror, halfU: 12 } };
  const s = computeCoverage({ cameras: [cam] }).cameras['C1-4'].faces[8];
  if (!(s.coverage < .8)) failures.push(`對照組失效：C1-4 反射鏡縮小時面 8 覆蓋仍有 ${(s.coverage * 100).toFixed(1)}%`);
  else notes.push(`對照組：C1-4 反射鏡縮成 ±12 mm 時面 8 覆蓋 ${(s.coverage * 100).toFixed(1)}%`);
}

// 3c. 對照組：反射鏡相機改回鏡頭環形光（經鏡子照內凹壁）時，反光分析一定要抓到局部反光
{
  const { specularReport } = await import('../web/js/specular.js');
  const c14 = CAMERAS.find(c => c.id === 'C1-4'), cam = { ...c14, light: { kind: 'lensRing', r: 30 } };
  const k = specularReport({ cameras: [cam] })['C1-4'][8].kind;
  if (k !== '局部反光') failures.push(`對照組失效：C1-4 改用鏡頭環形光時面 8 應為局部反光，實際 ${k}`);
  else notes.push('對照組：C1-4 改用鏡頭環形光時面 8 判為局部反光');
}

// 3d. 對照組：C1-3 條形光放回相機上方 45 mm 時，刀紋（γ 20°）一定要被判為亮帶
{
  const { grooveReport } = await import('../web/js/specular.js');
  const c13 = CAMERAS.find(c => c.id === 'C1-3'), cam = { ...c13, light: { ...c13.light, offset: [0, 0, -45] } };
  const k = grooveReport({ cameras: [cam], groove: { gamma: 20, step: 2, narrow: 3 } })['C1-3'][3].kind;
  if (k !== '刀紋亮帶') failures.push(`對照組失效：C1-3 條光 45 mm 時面 3 應有刀紋亮帶，實際 ${k}`);
  else notes.push('對照組：C1-3 條光放回 45 mm 時面 3 判為刀紋亮帶');
}

// 4. 面板檢核
const scene = new THREE.Scene(), project = createProject({ scene });
for (const r of project.layoutChecks()) if (!r.ok) failures.push(`${r.group}：${r.name}（${r.value}）`);

// 5. 單獨英文縮寫的整字檢查（生成的網格資料先去掉 base64 字串）
const BANNED = new RegExp('(^|[^A-Za-z])' + ['n', 's', 'k'].join('') + '([^A-Za-z]|$)', 'i');   // 拆開寫，避免本檔自己被擋
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return ['docs', 'review', 'node_modules', '.studio'].includes(n) ? [] : statSync(p).isDirectory() ? walk(p) : [p]; });
for (const f of walk(SITE).filter(p => /\.(js|mjs|json|md|html|css)$/.test(p))) {
  const text = readFileSync(f, 'utf8').replace(/'(i16|u16|u32|f32):[A-Za-z0-9+/=]+'/g, "''");
  text.split('\n').forEach((l, i) => { if (BANNED.test(l)) failures.push(`${relative(SITE, f)}:${i + 1} 出現客戶縮寫`); });
}

const result = {
  ok: !failures.length, ct: +CT.toFixed(2), transfer: +XFER_TIME.toFixed(2), bottleneck: BOTTLENECK,
  stations: Object.fromEntries(Object.entries(STATION_TIMES).map(([k, v]) => [k, +v.toFixed(2)])), servoAxes: SERVO_AXES.length,
  faces: Object.fromEntries(Object.entries(summary.faces).map(([k, f]) => [k, f.coverage])), notes, failures,
};
mkdirSync(join(SITE, 'review'), { recursive: true });
writeFileSync(join(SITE, 'review/verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ok: result.ok, ct: result.ct, failures: failures.slice(0, 10), notes }));
process.exit(result.ok ? 0 : 1);
