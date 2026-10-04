// 測試用假代理的轉接層：flow.test 直接匯入；介面的端對端測試用環境變數 VS3D_EXTRA_ADAPTERS 指向本檔，讓 vs3d 命令列也能用。
import { join } from 'node:path';
import { claude } from '../lib/adapters/claude.mjs';
import { STUDIO } from '../lib/util.mjs';

export const adapters = {
  fake: { ...claude, name: 'fake', label: '假代理', models: [], detect: () => ({ installed: true, loggedIn: true, version: 'fake', detail: '' }),
    command: ({ prompt, sessionId }) => ({ cmd: process.execPath, args: [join(STUDIO, 'test', 'fake-agent.mjs')], input: prompt, env: { FAKE_SESSION: sessionId || '' } }) },
};
