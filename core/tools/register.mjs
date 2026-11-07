// node --import <本庫>/core/tools/register.mjs <script>：註冊 loader.mjs（three、three/addons/、@core/）。
// Node 22.15／23.5 起用同步的 module.registerHooks（同一執行緒，沒有棄用警告）；
// 更舊的 Node 22 退回 module.register（Node 26 起會印 DEP0205 棄用警告）。
import * as mod from 'node:module';
import { resolve } from './loader.mjs';

if (typeof mod.registerHooks === 'function') mod.registerHooks({ resolve });
else mod.register('./loader.mjs', import.meta.url);
