// 更新 core/vendor/mujoco/：npm pack 的 @mujoco/mujoco 解開後，去掉 wasm 的自訂 section（name、.debug_*、sourceMappingURL；
// 不動 code／data，執行結果不變），gzip＋base64 包成 mujoco-wasm.mjs（像 Rapier 一樣不必另外載 .wasm、不受伺服器 MIME 影響、單一 HTML 匯出可以內嵌）。
//   npm pack @mujoco/mujoco@<版本>（在 TEMP/ 下的空資料夾）→ tar -xzf …tgz
//   node core/tools/vendor-mujoco.mjs <解開的 package 資料夾>
// 之後改 core/vendor/mujoco/README.md 的版本，跑 core 的 dynamics 檢查（換版後扭矩的雜湊會變，只比 Node 與瀏覽器、前後兩次）。
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const pkg = process.argv[2];
if (!pkg || !existsSync(join(pkg, 'mujoco.wasm'))) { console.log('用法：node core/tools/vendor-mujoco.mjs <@mujoco/mujoco 解開的 package 資料夾>'); process.exit(2); }
const out = new URL('../vendor/mujoco/', import.meta.url);

const b = readFileSync(join(pkg, 'mujoco.wasm')), parts = [b.subarray(0, 8)];
let p = 8;
const leb = () => { let r = 0, s = 0, x; do { x = b[p++]; r |= (x & 0x7f) << s; s += 7; } while (x & 0x80); return r >>> 0; };
while (p < b.length) { const s0 = p, id = b[p++], size = leb(), end = p + size; if (id !== 0) parts.push(b.subarray(s0, end)); p = end; }   // id 0 = 自訂 section
const wasm = Buffer.concat(parts);
new WebAssembly.Module(wasm);                                                     // 仍是合法模組
const gz = gzipSync(wasm, { level: 9 }), version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version;
writeFileSync(new URL('mujoco-wasm.mjs', out), `// MuJoCo ${version} 的 WebAssembly（去掉除錯與名稱 section 後 gzip＋base64；產生方式見 README.md）。不要手改。\nexport default ${JSON.stringify(gz.toString('base64'))};\n`);
copyFileSync(join(pkg, 'mujoco.js'), new URL('mujoco.js', out));
console.log(`MuJoCo ${version}：wasm ${b.length} → ${wasm.length} bytes，gzip ${gz.length}，mujoco-wasm.mjs ${Math.round(gz.length * 4 / 3 / 1024)} KB`);
