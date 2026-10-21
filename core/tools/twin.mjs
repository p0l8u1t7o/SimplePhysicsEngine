// SPE 孿生 server（Twin Protocol v2 的 SPE 端；AutoSequence Twin Hub 以 TCP 連入）。
//   node core/tools/twin.mjs <站> [--md <MD 檔>] [--schema-repo <路徑>] [--schema-unlocked] [--port 7600] [--host 127.0.0.1]
//                            [--sse <port>] [--max-line <bytes>] [--validate] [--transcript <檔>] [--port-file <檔>] [--test-hook no-ack-at:<n>]
//
// 啟動時（接受連線之前）：Automation-Schema 定位與版本檢查（twin-schema.mjs，不符就拒絕啟動）→ 載入並驗證 MD、計算 mdHash
// → 無頭建立站的場景（web/js/project.js）→ 站的孿生描述（web/js/twin-binding.js 的 createTwinBinding）→ 綁定解析。
// --md 省略時用 project-site/<站>/twin/<站>.md.json；--port 0 取任意空埠（實際埠號印出，並寫到 --port-file）。
// --validate：逐則驗證收到的訊息（除錯用；握手階段一律驗證）。--transcript：寫出工作階段紀錄（{"dir","msg"} 每行一則，validate.py session 可驗）。
// 協定沒有認證：預設只聽 127.0.0.1；--host 改成其他位址時印警告。Ctrl+C 關閉所有連線並以 0 結束。
import './register.mjs';
import '../verify/dom-stub.mjs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pickProjects, CORE } from './projects.mjs';
import { loadSchema, SchemaError } from './twin-schema.mjs';
import { createTwinServer } from './twin-server.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const station = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;
if (!station) { console.error('用法：node core/tools/twin.mjs <站> [--md <MD>] [--port 7600] [--sse 8776] …（見檔頭）'); process.exit(2); }

const fail = msg => { console.error(msg); process.exit(1); };
try {
  const [project] = pickProjects([station]);
  const as = await loadSchema({ repo: opt('--schema-repo'), unlocked: argv.includes('--schema-unlocked') }).catch(e => fail(e instanceof SchemaError ? e.message : e.stack));
  for (const w of as.warnings) console.warn('! ' + w);
  const schema = as.schema;

  const mdFile = resolve(opt('--md') || join(project.dir, 'twin', `${project.id}.md.json`));
  if (!existsSync(mdFile)) fail(`找不到 MD：${mdFile}`);
  const mdText = readFileSync(mdFile, 'utf8'), md = JSON.parse(mdText);
  const v = schema.validateMachineDescription(md);
  if (!v.valid) fail(`MD 不合 schema（${mdFile}）：\n${v.errors.slice(0, 10).map(e => `- ${e.path} ${e.message}`).join('\n')}`);
  const mdHash = schema.mdHashOfText(mdText);

  const THREE = await import('three');
  const { createProject } = await import(pathToFileURL(join(project.web, 'js', 'project.js')).href);
  const bindingFile = join(project.web, 'js', 'twin-binding.js');
  if (!existsSync(bindingFile)) fail(`${project.id} 沒有孿生描述 web/js/twin-binding.js（規格見 core/twin/README.md）`);
  const { createTwinBinding } = await import(pathToFileURL(bindingFile).href);
  const { prepareTwin } = await import('../twin/session.js');
  const scene = new THREE.Scene(), proj = await createProject({ scene, headless: true });
  const prepared = prepareTwin({ md, twin: createTwinBinding(proj, scene) });

  const hook = opt('--test-hook'), noAckAt = /^no-ack-at:(\d+)$/.exec(hook || '')?.[1];
  if (hook && !noAckAt) fail(`不認得的 --test-hook：${hook}（支援 no-ack-at:<n>）`);
  const host = opt('--host', '127.0.0.1');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) console.warn(`! --host ${host}：Twin Protocol 沒有認證，只在信任的網路使用`);
  const maxLine = opt('--max-line') ? Number(opt('--max-line')) : null;
  const version = readFileSync(join(CORE, 'VERSION'), 'utf8').trim();
  const server = createTwinServer({
    prepared, mdHash, schema, maxLine, software: { name: 'SPE core/twin', version },
    options: { validate: argv.includes('--validate'), noAckAt: noAckAt ? Number(noAckAt) : undefined },
    transcript: opt('--transcript') ? resolve(opt('--transcript')) : null,
    log: m => console.log(`[${new Date().toISOString()}] ${m}`),
  });
  const ssePort = opt('--sse') !== null ? Number(opt('--sse')) : null;
  const addr = await server.listen({ port: Number(opt('--port', 7600)), host, ssePort });
  if (opt('--port-file')) writeFileSync(opt('--port-file'), String(addr.port));
  const b = prepared.bound;
  console.log([
    `SPE 孿生 server：${project.id}  tcp://${host}:${addr.port}${addr.ssePort ? `  SSE http://${host}:${addr.ssePort}/events` : ''}`,
    `Automation-Schema：${as.dir}  ${as.release}${as.commit ? `  ${as.commit.slice(0, 7)}` : ''}${as.unlocked ? '（未鎖定，不得用於聯調驗收）' : ''}`,
    `MD：${mdFile}  ${mdHash}`,
    `綁定 ${b.bindings} 個實體；unbound：${b.unbound.length ? b.unbound.join('、') : '（無）'}`,
  ].join('\n'));
  const stop = async () => { await server.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (e) { fail(e?.stack || String(e)); }
