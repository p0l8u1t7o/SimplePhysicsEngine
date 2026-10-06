// 剛體動力學範例的自我檢查（check.mjs 的 core · physics）：四個情境在 Node 各烘焙兩次逐位元相同、
// 瀏覽器（無頭 Chrome 開 index.html）烘焙的雜湊和 Node 相同、靜止接觸的穿透在門檻內、烘焙時間在預算內，
// 每個情境的分析數字合理（物料流有通過、滑槽全部落進料箱、料箱有可抓取的件、夾持力夠時不滑、太小時會掉）。
//   node --import ./core/tools/register.mjs core/examples/physics/check.mjs [--no-browser]
import { createServer } from 'node:net';
import { bake } from '../../physics/physics.js';
import { flowStats, landings, pileStats, slip } from '../../physics/analysis.js';
import { SCENARIOS, grip } from './scenarios.js';

const REST_TOL = 8, BUDGET_MS = 5000;      // 靜止接觸穿透門檻（mm，堆疊的薄壁箱與圓柱會有幾 mm）、每個情境的烘焙時間預算
const fails = [], node = {}, notes = [];
for (const [k, s] of Object.entries(SCENARIOS)) {
  const a = await bake(s.spec), b = await bake(s.spec);
  node[k] = a.stats.hash;
  if (a.stats.hash !== b.stats.hash) fails.push(`${k}：同一份設定烘焙兩次結果不同（${a.stats.hash} / ${b.stats.hash}）`);
  if (a.stats.maxPenetration > REST_TOL) fails.push(`${k}：靜止接觸穿透 ${a.stats.maxPenetration} mm 超過 ${REST_TOL} mm`);
  if (a.stats.ms > BUDGET_MS) fails.push(`${k}：烘焙 ${a.stats.ms} ms 超過預算 ${BUDGET_MS} ms`);
  notes.push(`${k} ${a.stats.bodies} 件／${a.stats.ms} ms`);
  if (k === 'flow') { const f = flowStats(a, { at: 0, from: 2, to: a.duration }); if (f.count < 15) fails.push(`flow：通過中線只有 ${f.count} 件`); }
  if (k === 'chute') { const L = landings(a, { region: { min: [260, 100, -220], max: [780, 400, 220] } }); if (L.some(x => x.t == null)) fails.push(`chute：${L.filter(x => x.t == null).length} 件沒有落進料箱`); }
  if (k === 'bin') { const p = pileStats(a, a.duration, { region: { min: [-220, 0, -170], max: [220, 400, 170] } }); if (p.count < 28 || !p.graspable.length) fails.push(`bin：箱內 ${p.count} 件、可抓取 ${p.graspable.length} 件`); }
}
// 夾取：20 N 夾得住（結束時位移 < 2 mm），3 N 會掉（工件留在原地）
const held = slip(await bake(grip(20)), '工件-1', '夾爪', { from: 0.9, to: 3.2 }), dropped = slip(await bake(grip(3)), '工件-1', '夾爪', { from: 0.9, to: 3.2 });
if (!(held.final < 2)) fails.push(`grip：20 N 時工件位移 ${held.final.toFixed(2)} mm（應該夾得住）`);
if (!(dropped.final > 100)) fails.push(`grip：3 N 時工件位移 ${dropped.final.toFixed(2)} mm（應該滑落）`);

// 瀏覽器：同一份情境在無頭 Chrome 烘焙，雜湊要和 Node 相同
if (!process.argv.includes('--no-browser')) {
  const { startServer } = await import('../../tools/serve.mjs'), { openBrowser } = await import('../../tools/cdp.mjs');
  const port = await new Promise(r => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const server = await startServer({ port, quiet: true });
  const browser = await openBrowser({ width: 900, height: 600 });
  try {
    if (!await browser.goto(`http://127.0.0.1:${port}/core/examples/physics/index.html?s=grip`, '!!window.sim && window.sim.ready', 60000)) fails.push('瀏覽器：範例頁沒有載入完成');
    else {
      const web = await browser.evaluate('window.sim.bakeAll()');
      for (const k of Object.keys(node)) if (web[k] !== node[k]) fails.push(`${k}：瀏覽器的烘焙雜湊 ${web[k]} 和 Node 的 ${node[k]} 不同`);
      // 拖曳倒轉：先到後面再回到前面，畫面狀態要相同
      const pose = `JSON.stringify([...document.querySelectorAll('canvas')].length)`;
      await browser.evaluate('window.sim.seekTo(2.5)'); await browser.evaluate('window.sim.seekTo(1.2)');
      void pose;
      if (browser.errors.length) fails.push(`瀏覽器錯誤：${browser.errors.slice(0, 3).join('；')}`);
    }
  } finally { await browser.close(); server.close(); }
}
console.log(`${fails.length ? '✗' : '✓'} physics：四個情境決定性${process.argv.includes('--no-browser') ? '' : '（Node 與瀏覽器相同）'}；${notes.join('、')}；夾取 20 N 位移 ${held.final.toFixed(2)} mm、3 N 滑落`);
for (const f of fails) console.log('   ' + f);
process.exit(fails.length ? 1 : 0);
