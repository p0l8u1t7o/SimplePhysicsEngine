// 驗證素材完整性、高低畫質／對數深度管線與缺檔降級；不把 headless 視為實機 FPS 驗收。
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {startServer} from '../../../core/tools/serve.mjs';
import {openBrowser,sleep} from '../../../core/tools/cdp.mjs';

const root=new URL('../web/assets/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
for(const row of manifest)assert.equal(createHash('sha256').update(readFileSync(new URL(row.file,root))).digest('hex'),row.sha256,row.file);
const out=resolve(process.argv[2]||'TEMP/pems-cinema/pipeline'),port=Number(process.argv[3]||8854);mkdirSync(out,{recursive:true});
const server=await startServer({port,quiet:true}),browser=await openBrowser(),report={assetFiles:manifest.length,cases:[],failures:[]};
try{
  for(const site of ['flagship','mixed','urban'])for(const mode of ['desktop','mobile','linear-depth']){
    const mobile=mode==='mobile';
    await browser.send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1680,height:mobile?844:1000,deviceScaleFactor:mobile?3:1,mobile});
    await browser.send('Emulation.setTouchEmulationEnabled',{enabled:mobile});
    const start=performance.now();
    assert(await browser.goto(`http://127.0.0.1:${port}/ParkingEMS/?pause&site=${site}${mode==='linear-depth'?'&logdepth=0':''}`));
    const coldReadyMs=performance.now()-start;
    await browser.evaluate("sim.seekTo(sim.project.seq.hero.plugT);sim.setView('charging',true);true");await browser.frames();await sleep(180);
    const state=await browser.evaluate(`(()=>{const s=__coreStages[0],m=s.scene.getObjectByName('lot paving').material;return {quality:sim.renderQuality,assets:sim.assets,logDepth:s.useLog,dpr:s.renderer.getPixelRatio(),shadow:s.lights.sun.shadow.mapSize.x,normalMap:!!m.normalMap,roughnessMap:!!m.roughnessMap,environment:!!s.scene.environment,total:sim.total};})()`);
    assert.equal(state.quality,mobile?'low':'high');assert.equal(state.assets.loaded,7);assert.deepEqual(state.assets.failures,[]);
    assert.equal(state.assets.skyFile,mobile?'daylight.hdr':'daylight-4k.hdr');
    assert(state.normalMap&&state.roughnessMap&&state.environment);assert(state.dpr<=(mobile?1:1.5));assert.equal(state.shadow,mobile?1024:4096);
    assert.equal(state.logDepth,mode!=='linear-depth');assert.deepEqual(browser.errors,[]);
    writeFileSync(join(out,`${site}-${mode}.png`),await browser.screenshot());report.cases.push({site,mode,coldReadyMs,state});
    if(mode==='desktop'){
      for(const source of ['cctv','lpr']){
        await browser.evaluate(`(()=>{const e=document.querySelector('select[aria-label="相機來源"]');e.value='${source}';e.dispatchEvent(new Event('change'));})()`);
        await browser.frames();assert.deepEqual(browser.errors,[]);
        writeFileSync(join(out,`${site}-${source}.png`),await browser.screenshot());
      }
      await browser.evaluate(`(()=>{const e=document.querySelector('select[aria-label="相機來源"]');e.value='ems';e.dispatchEvent(new Event('change'));})()`);
    }
    console.log(`${site} ${mode}: ready ${Math.round(coldReadyMs)} ms, ${state.quality}, 7 assets`);
  }
  await browser.send('Network.enable');await browser.send('Network.setBlockedURLs',{urls:['*asphalt_02_nor_gl.jpg','*daylight*.hdr']});
  assert(await browser.goto(`http://127.0.0.1:${port}/ParkingEMS/?pause&quality=high`));
  await browser.frames();
  const fallback=await browser.evaluate(`({assets:sim.assets,warning:!!document.querySelector('.asset-warning'),environment:!!__coreStages[0].scene.environment,normal:!!__coreStages[0].scene.getObjectByName('lot paving').material.normalMap})`);
  assert.deepEqual([...fallback.assets.failures].sort(),['asphalt_02_nor_gl.jpg','daylight-4k.hdr']);assert(fallback.warning&&fallback.environment);assert.equal(fallback.normal,false);
  const unexpected=browser.errors.filter(e=>!e.includes('net::ERR_BLOCKED_BY_CLIENT'));assert.deepEqual(unexpected,[]);
  report.fallback={...fallback,expectedNetworkErrors:browser.errors};writeFileSync(join(out,'fallback.png'),await browser.screenshot());
  console.log('asset hashes, 9 render modes, missing normal/HDR fallback: PASS');
}catch(error){report.failures.push(error.stack);process.exitCode=1;console.error(error);}
finally{await browser.close();server.close();writeFileSync(join(out,'pipeline-review.json'),JSON.stringify(report,null,2));}
