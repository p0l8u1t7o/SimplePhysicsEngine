// 角色與模型指派。優先順序（後蓋前）：
//   1. 應用程式預設（本檔 ROLE_DEFAULTS 指定角色的 CLI，PRESETS 依 CLI 給模型）
//   2. 工作區設定 <工作區>/.studio/settings.json 的 { defaultCli, roles }
//   3. 專案設定 projects/<專案>/studio.json 的 roles
//   4. 單次指定（命令列 --cli、--model、--role plan=opus,fix=haiku）
// 正式預設（2026-10-04 使用者拍板）：規劃、開發、修正、審查用 Claude opus；
// 渲染與細節補強用 Codex gpt-6-astra 高推理（使用者的實務經驗：opus 規劃與實作，gpt-6 補強渲染、電盤、電線與細節）。
// 依段落指派（2026-10-04 拍板）：第二段（電控、電盤、配線、相機）的開發與修正預設 Codex gpt-6-astra high，審查維持 Claude opus。
// 各層可以用「角色@段」只指定某一段，例如 studio.json 的 roles: { "build@2": { cli: 'claude', model: 'opus' } }、--role build@2=codex:gpt-6-astra。
// P2 中 sonnet 在兩站都明顯較弱，而且規劃時容易偏離範圍。
// 元件補全（enrich，Q5）工作單純、次數多，Claude 預設用 sonnet。
import { readJson } from './util.mjs';

export const ROLES = {
  plan: '規劃：讀規格，產出配置提案與待確認事項',
  build: '開發：場景、排程、視角、面板、手機與平板版面',
  fix: '修正：依檢查失敗摘要修正',
  review: '審查：對照截圖與參考資料列出缺漏（P4b）',
  render: '渲染與細節補強（P4b）',
  enrich: '元件補全：上網查元件規格，結果由使用者逐欄審核（評估平台 Q5；唯一可以上網的角色）',
};

// 空字串的 model 代表用該 CLI 帳號的預設模型
export const PRESETS = {
  claude: { plan: 'opus', build: 'opus', fix: 'opus', review: 'opus', render: 'opus', enrich: 'sonnet' },
  codex: { plan: '', build: '', fix: '', review: '', render: '', enrich: '' },
};

// 指定 CLI 的角色預設（最底層；工作區、專案或命令列指定 CLI 時會被蓋過）
export const ROLE_DEFAULTS = {
  render: { cli: 'codex', model: 'gpt-6-astra', effort: 'high' },
};
// 各段的角色預設（蓋過 ROLE_DEFAULTS，但會被工作區、專案、命令列的指定蓋過）
export const SEGMENT_DEFAULTS = {
  2: { build: { cli: 'codex', model: 'gpt-6-astra', effort: 'high' }, fix: { cli: 'codex', model: 'gpt-6-astra', effort: 'high' } },
};

export const DEFAULT_STUDIO_JSON = {
  roles: {},
  budget: { drawCallsRatio: 1.3, trianglesRatio: 1.5, phoneMinFps: 30 },
};

// "plan=opus,fix=haiku" 或 "plan=codex:gpt-5" → { plan: { model: 'opus' }, … }
export function parseRoleOverrides(s = '') {
  const out = {};
  for (const part of s.split(',').map(x => x.trim()).filter(Boolean)) {
    const [role, value = ''] = part.split('=');
    if (!ROLES[role.replace(/@\d+$/, '')]) throw new Error(`未知的角色：${role}（可用：${Object.keys(ROLES).join('、')}）`);
    const m = /^(claude|codex):(.*)$/.exec(value);
    out[role] = m ? { cli: m[1], model: m[2] } : { model: value };
  }
  return out;
}

export function resolveRole(role, { workspaceSettings = {}, studioJson = {}, override = {} } = {}, segment = 1) {
  // 預設 CLI：專案 studio.json 的 defaultCli（vs3d new --cli 會寫入）＞ 工作區設定 ＞ claude
  const wsCli = workspaceSettings.defaultCli || 'claude', projCli = studioJson.defaultCli || wsCli;
  const seg = `${role}@${segment}`, ov = { ...override.roles?.[role], ...override.roles?.[seg] };
  const layers = [[ROLE_DEFAULTS[role], null], [SEGMENT_DEFAULTS[segment]?.[role], null], [workspaceSettings.roles?.[role], wsCli], [workspaceSettings.roles?.[seg], wsCli],
    [studioJson.roles?.[role], projCli], [studioJson.roles?.[seg], projCli], [Object.keys(ov).length ? ov : null, null]].filter(([l]) => l);
  const cli = ov.cli || override.cli || [...layers].reverse().find(([l]) => l.cli)?.[0].cli || projCli;
  const r = { cli, model: PRESETS[cli]?.[role] ?? '', effort: '' };
  // 只套用同一個 CLI 的層：沒寫 cli 的層屬於該層的預設 CLI（單次指定的層跟著這次的 CLI）；不同 CLI 的模型名稱不通用
  for (const [l, layerCli] of layers) {
    if ((l.cli || layerCli || cli) !== cli) continue;
    if (l.model != null) r.model = l.model;
    if (l.effort != null) r.effort = l.effort;
  }
  if (override.model && !ov.model) r.model = override.model;
  return r;
}

export const loadRoleContext = (settingsFile, studioJsonFile, override) =>
  ({ workspaceSettings: readJson(settingsFile, {}), studioJson: readJson(studioJsonFile, {}), override });
