// 由 Browser 技能的 Node 工作階段呼叫：runReview(cdp, tab, outputDirectory)。
// 不啟動外部瀏覽器、不讀取使用者 profile；產物限於呼叫端指定的專案目錄。
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
export async function runReview(cdp, tab, out) {
  mkdirSync(out,{recursive:true});
  const evaluate=async expression=>{const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result?.value;};
  const state=await evaluate('({total:window.sim.total,events:window.sim.seq.events})');
  const at=(name,offset=0)=>{const e=state.events.find(e=>e.label.includes(name));if(!e)throw Error('Missing event: '+name);return e.time+offset;};
  const shots=[['overview',0,'iso'],['road',at('AGV 出倉庫送待洗棧板',8),'road'],['gantry',at('0001 翻轉放倒',1.7),'gantry'],['label',at('0001 讀碼',.3),'label'],['upender',at('0001 翻正',2),'upender'],['decap',at('拆 2" 桶蓋',1),'decap'],['robot',at('手臂開始取桶',3.7),'robot'],['spray',at('沖洗水由 TK-R 供應',5),'booth'],['pour',at('倒液進集液漏斗',2),'booth'],['dry',at('熱風吹乾內壁附著水',8),'booth'],['waste',at('末道沖洗水回收至 TK-R',1),'waste'],['toplabel',at('頂面貼標開始',2),'toplabel'],['fill',at('開始填裝',10),'line1'],['stage',at('組板龍門取桶',12),'stage'],['scale',at('秤重確認殘水 < 100 g',.7),'weigh']];
  const report={total:state.total,shots:[],checks:{}};
  for(const [name,t,view]of shots){
    await evaluate(`window.sim.pause();window.sim.seekTo(${t});window.sim.setView(${JSON.stringify(view)},true);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const bytes=await tab.screenshot({});writeFileSync(join(out,name+'.png'),bytes);report.shots.push({name,time:t,view});
  }
  report.checks.stateSamples=await evaluate(`(()=>{const bad=[];for(let t=0;t<=window.sim.total;t+=2){window.sim.seekTo(t);const s=window.sim.state;if(JSON.stringify(s.st).includes(':null'))bad.push({t,nan:true});if(s.robot.err?.position>1)bad.push({t,ik:s.robot.err});}return bad;})()`);
  report.checks.layout=await evaluate('document.getElementById("chkCount").textContent');
  report.checks.pip=await evaluate(`window.sim.seekTo(${at('0001 讀碼',.3)});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(!document.getElementById('pipFrame').hidden))))`);
  report.logs=await tab.dev.logs({levels:['error','warn'],limit:100});
  report.ok=report.checks.stateSamples.length===0&&report.checks.pip&&report.logs.every(l=>l.level!=='error');
  await evaluate('window.sim.seekTo(0);window.sim.setView("iso",true)');
  writeFileSync(join(out,'browser-review.json'),JSON.stringify(report,null,2));return report;
}

// 直接執行：node tools/review-scenes.mjs [--port 8770]，啟動 core 的本機伺服器與無頭瀏覽器，結果寫到 review/detail-screens/
// core/tools/cdp.mjs 的 send 回傳整則訊息，這裡轉成 Browser 技能的形狀（result 就是 Runtime.evaluate 的結果）
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { startServer } = await import('../../../core/tools/serve.mjs');
  const { openBrowser } = await import('../../../core/tools/cdp.mjs');
  const i = process.argv.indexOf('--port'), port = i > 0 ? +process.argv[i + 1] : 8770;
  const server = await startServer({ port, quiet: true }), b = await openBrowser();
  try {
    if (!await b.goto(`http://127.0.0.1:${port}/ChemicalTankWashing/?pause`)) throw new Error('頁面未就緒 ' + b.errors.join(' | '));
    const cdp = { send: async (m, p) => { const r = await b.send(m, p); return { ...r.result, exceptionDetails: r.result?.exceptionDetails }; } };
    const tab = { screenshot: () => b.screenshot('png'), dev: { logs: async () => b.errors.map(text => ({ level: 'error', text })) } };
    const report = await runReview(cdp, tab, join(root, 'review/detail-screens'));
    console.log(report.ok ? `通過：${report.shots.length} 張站位畫面、倒退取樣與相機子畫面正常` : '未通過', JSON.stringify(report.checks));
    process.exitCode = report.ok ? 0 : 1;
  } finally { await b.close(); server.close(); }
}
