// 第二段資料回歸：取像投影、跳播、還原與電控功能連線；不啟動瀏覽器。
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fingerprint } from '@core/verify/fingerprint.mjs';
import { compareFingerprints } from '@core/verify/fingerprint-compare.mjs';
import { createProject } from '../web/js/project.js';
import { withVisionFrame, renderVisionFrame } from '../web/js/vision.js';
import { projectRegion } from '@core/ui/vision-overlay.js';

const scene=new THREE.Scene(), p=createProject({scene});
// app 的守門條件包含空間檢核值，不能只比較排程與動件。
// 基準由 app 管理；獨立部署沒有 .studio 時仍執行下方相機與電控檢查。
const baselinePath = '.studio/segment2/base-fingerprint.json';
if (existsSync(baselinePath)) {
  const saved = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const baseline = saved.variants?.find(v => v.variant === '預設') ?? saved;
  const current = fingerprint(p, scene, { samples: baseline.samples });
  const result = compareFingerprints(baseline, current);
  assert.ok(result.ok, result.diffs.join('\n'));
  const layout = p.layoutChecks().map(r => [r.group || '', r.name, !!r.ok, r.value ?? null]);
  assert.deepEqual(layout, baseline.layout, '第二段不得改變第一段空間檢核結果');
  writeFileSync('review/segment2-fingerprint.json', JSON.stringify({
    ...result, total: current.total, samples: current.samples,
    movingPreserved: Object.keys(baseline.moving).length, layoutUnchanged: true, layoutChecks: layout.length,
  }, null, 2));
  console.log(`第二段指紋：排程、動件與 ${layout.length} 項空間檢核維持第一段基準`);
}
const fov=p.visionCameras[0].fieldOfView(800);
assert.ok(Math.abs(fov[0]-704)<1e-8 && Math.abs(fov[1]-528)<1e-8);
assert.equal(p.visionCameras.length,2);
assert.equal(p.visionCameras[0].root.position.distanceTo(p.visionCameras[1].root.position),300);
// 前段（ABB 站）的立體取像站與後段同規格
const frontFov=p.frontCameras[0].fieldOfView(1050);
assert.ok(Math.abs(frontFov[0]-924)<1e-8 && Math.abs(frontFov[1]-693)<1e-8);
assert.ok(frontFov[0]-300>=600,'前段雙眼重疊視野要涵蓋 600 帶寬');
assert.equal(p.frontCameras.length,2);
assert.equal(p.frontCameras[0].root.position.distanceTo(p.frontCameras[1].root.position),300);
const snapshot=()=>{
  scene.updateMatrixWorld(true);
  return p.items.map(i=>[i.id,i.grp.visible,...i.grp.matrixWorld.elements]);
};
const frames=[];
for(const t of [0,41,46,51.8,57,62,80.4,95.6,109,117,46,57]) {
  p.apply(t);const original=snapshot(), q={...p.state.q};
  const sample=[];
  for(const source of ['CAM1','CAM2','CAM3','CAM4','auto']) {
    withVisionFrame(p,scene,source,data=>{
      assert.ok(data.captureTime<=t+1e-8,'取像不可來自未來');
      assert.ok(data.title.includes('SIM／示意'));
      const direction=data.camera.getWorldDirection(new THREE.Vector3());
      assert.ok(direction.distanceTo(new THREE.Vector3(0,-1,0))<1e-8,'光軸應朝帶面');
      sample.push({source,capture:data.captureTime,regions:data.marks.marks.map(m=>({label:m.label,status:m.status,
        region:projectRegion(m.points,data.camera,704,528)}))});
      assert.ok(!p.marks.visible,'取像不可含展示用光束與尺寸線');
      assert.ok(!p.lightPatch.visible,'取像不可含展示用帶面光斑');
    });
    assert.equal(p.state.t,t);assert.deepEqual(p.state.q,q);
    // 未顯示的工件允許保留上次位置；可見物件必須完整還原。
    const after=snapshot();
    for(let i=0;i<after.length;i++) if(original[i][1]) assert.deepEqual(after[i],original[i]);
  }
  frames.push({t,sample});
}
assert.deepEqual(frames[2].sample,frames[10].sample,'倒序回到相同時間應取到相同影像');
assert.deepEqual(frames[4].sample,frames[11].sample,'直接跳到分析段應得到同一份判定');
assert.deepEqual(frames[3].sample,frames[4].sample,'分析段維持前次取像');
assert.ok(frames.some(f=>f.sample.some(s=>s.regions.some(r=>r.region&&!r.region.clipped))),'至少一個完整工件落在相機視野內');
// 前段的凍結分析段：同一張取像、看得到完整工件，且同時有「派給 ABB」與「放行」兩種判定
const frontFrames=[14.85,20,14.85].map(t=>{p.apply(t);let out;withVisionFrame(p,scene,'CAM3',data=>{assert.ok(data.title.includes('前段'));out=data.marks.marks.map(m=>({label:m.label,status:m.status,region:projectRegion(m.points,data.camera,704,528)}));});return out;});
assert.deepEqual(frontFrames[0],frontFrames[1],'前段分析段維持前次取像');assert.deepEqual(frontFrames[0],frontFrames[2],'前段倒序回到相同時間應取到相同影像');
assert.ok(frontFrames[0].some(r=>r.status==='ok'&&r.region&&!r.region.clipped)&&frontFrames[0].some(r=>r.status==='preview'&&r.region&&!r.region.clipped),'前段取像應同時看到派給 ABB 與放行的目標');
p.apply(73);const before=snapshot();
const patchBefore=p.lightPatch.visible;
assert.throws(()=>withVisionFrame(p,scene,'CAM1',()=>{throw new Error('測試還原');}));
assert.equal(p.state.t,73);const after=snapshot();
assert.equal(p.lightPatch.visible,patchBefore,'取像失敗也應還原展示光斑');
for(let i=0;i<after.length;i++) if(before[i][1]) assert.deepEqual(after[i],before[i]);
// 手機隱藏子畫面時不得倒轉製程、更新 HMI 或執行相機繪製；重新開啟仍還原時間。
const originalApply=p.apply;let applyCalls=0,drawCalls=0;
p.apply=(...args)=>{applyCalls++;return originalApply(...args);};
assert.equal(renderVisionFrame(p,scene,'CAM1',()=>{drawCalls++;},false),false);
assert.equal(applyCalls,0);assert.equal(drawCalls,0);assert.deepEqual(snapshot(),after);
assert.equal(renderVisionFrame(p,scene,'CAM2',data=>{drawCalls++;assert.ok(data.title.includes('CAM-R'));},true),true);
assert.equal(applyCalls,2);assert.equal(drawCalls,1);assert.equal(p.state.t,73);
assert.equal(p.lightPatch.visible,patchBefore);p.apply=originalApply;
const connections=[];scene.traverse(o=>{if(o.userData.electricalWire)connections.push(o.userData.electricalWire);});
for(const [from,to] of [['QF2','K1'],['K1','K2'],['K2','D1'],['K2','D2'],['K2','D3'],['GC1','K1'],['GC1','K2'],['K1','IO2'],['K2','IO2'],['QF1','IPC1']])
  assert.ok(connections.some(w=>w.from===from&&w.to===to),`缺少功能連線 ${from} → ${to}`);
assert.equal(p.electrical.rc.userData.electrical.free,true);
assert.ok(p.verify.cables.obstacles().includes(p.arm.armParts[0]));
writeFileSync('review/segment2-data.json',JSON.stringify({ok:true,cameras:2,frontCameras:2,fov,connections:connections.length,frames,frontFrames:frontFrames[0]},null,2));
console.log('第二段：雙相機投影、凍結取像、倒序還原與安全功能連線通過');
