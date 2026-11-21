// 手臂持件方案（R5，網頁 ?plan=arm）的檢查（快速檢查會跑）。
//   這個方案是比較用的第二方案，沒有放進 project.json 的 variants：core 的 bom 檢查會拿同一份成本表比對而不通過（需求已登記 core/REQUESTS.md），
//   所以在站內直接呼叫 core 的全場干涉與決定性檢查：
//   1. 取像覆蓋：用 STEP 射線重算手臂方案的 7 筆拍攝設定，要和 coverage-data.js 的 ARM_SUMMARY 完全相同，12 面覆蓋、照明都 ≥ 99%
//   2. 面板檢核（覆蓋、解析度與景深、反光、刀紋、相機共用、飛拍曝光上限、IK、J6 掃描範圍、夾持、節拍、判定就緒）：參考項（info）以外全部通過
//   3. 決定性（倒序取樣一致）
//   4. 全場干涉＋重合面（core/verify/scene.mjs，每 0.1 s 取樣）
//   node core/tools/run.mjs MotorBodyAOI tools/verify-arm.mjs
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyScene, sceneText } from '@core/verify/scene.mjs';
import { verifyDeterminism } from '@core/verify/determinism.mjs';
import { createProject } from '../web/js/project.js';
import { ARM_CAMERAS } from '../web/js/arm-optics.js';
import { coverageReport } from '../web/js/coverage.js';
import { ARM_SUMMARY } from '../web/js/coverage-data.js';
import { ARM_CT, DECIDE_AT } from '../web/js/arm-plan.js';

const SITE = fileURLToPath(new URL('..', import.meta.url));
const failures = [], notes = [], t0 = Date.now();

// 1. 覆蓋重算
const { summary } = coverageReport({ cameras: ARM_CAMERAS });
if (JSON.stringify(summary) !== JSON.stringify(ARM_SUMMARY)) failures.push('coverage-data.js 的 ARM_SUMMARY 過期：請重跑 node core/tools/run.mjs MotorBodyAOI tools/plan.mjs');
for (const [no, f] of Object.entries(summary.faces)) if (f.coverage < 99 || f.lit < 99) failures.push(`面 ${no} 覆蓋 ${f.coverage}%、照明 ${f.lit}%（< 99%）`);

// 2. 面板檢核
const scene = new THREE.Scene(), project = createProject({ scene, plan: 'arm' });
const rows = project.layoutChecks();
for (const r of rows) if (!r.ok && !r.info) failures.push(`${r.group}：${r.name}（${r.value}）`);
for (const r of rows) if (!r.ok && r.info) notes.push(`參考：${r.name}（${r.value}）`);

// 3. 決定性
const det = verifyDeterminism(project, scene);
if (!det.ok) failures.push(`決定性：${(det.failures || []).slice(0, 3).map(f => JSON.stringify(f)).join('；')}`);

// 4. 全場干涉
const sc = verifyScene(project, scene, { dt: .1, report: s => notes.push(s) });
mkdirSync(join(SITE, 'review'), { recursive: true });
writeFileSync(join(SITE, 'review/arm-scene.txt'), sceneText(sc) + '\n');
if (!sc.ok) failures.push(`全場干涉：動態 ${sc.dynamic.length}、靜態 ${sc.static.length}、重合面 ${sc.zfight.length}（見 review/arm-scene.txt）`);

const v = project.queue.verdicts;
const result = {
  ok: !failures.length, ct: +ARM_CT.toFixed(2), decideAt: +DECIDE_AT.toFixed(2), shots: project.shots.length,
  imagesPerPart: v[0]?.n, minSlack: +Math.min(...v.map(x => x.slack)).toFixed(2), ng: v.filter(x => x.ng).map(x => x.part + 1),
  faces: Object.fromEntries(Object.entries(summary.faces).map(([k, f]) => [k, f.coverage])),
  scene: { dynamic: sc.dynamic.length, static: sc.static.length, zfight: sc.zfight.length }, notes, failures,
};
writeFileSync(join(SITE, 'review/arm-verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ok: result.ok, ct: result.ct, minSlack: result.minSlack, scene: result.scene, failures: failures.slice(0, 10), seconds: ((Date.now() - t0) / 1000).toFixed(0) }));
process.exit(result.ok ? 0 : 1);
