// 角色與模型指派。優先順序（後蓋前）：
//   1. 應用程式預設（本檔 PRESETS，依 CLI）
//   2. 工作區設定 <工作區>/.studio/settings.json 的 { defaultCli, roles }
//   3. 專案設定 projects/<專案>/studio.json 的 roles
//   4. 單次指定（命令列 --cli、--model、--role plan=opus,fix=haiku）
// 正式預設（2026-10-04 依 P2 實測，使用者拍板）：維持 Claude，所有角色用 opus。
// P2 中 sonnet 在兩站都明顯較弱，而且規劃時容易偏離範圍；Codex 成品較好、較快，但不強制同事安裝。
import { readJson } from './util.mjs';

export const ROLES = {
  plan: '規劃：讀規格，產出配置提案與待確認事項',
  build: '開發：場景、排程、視角、面板、手機與平板版面',
  fix: '修正：依檢查失敗摘要修正',
  review: '審查：對照截圖與參考資料列出缺漏（P4b）',
  render: '渲染與細節補強（P4b）',
};

// 空字串的 model 代表用該 CLI 帳號的預設模型
export const PRESETS = {
  claude: { plan: 'opus', build: 'opus', fix: 'opus', review: 'opus', render: 'opus' },
  codex: { plan: '', build: '', fix: '', review: '', render: '' },
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
    if (!ROLES[role]) throw new Error(`未知的角色：${role}（可用：${Object.keys(ROLES).join('、')}）`);
    const m = /^(claude|codex):(.*)$/.exec(value);
    out[role] = m ? { cli: m[1], model: m[2] } : { model: value };
  }
  return out;
}

export function resolveRole(role, { workspaceSettings = {}, studioJson = {}, override = {} } = {}) {
  // 預設 CLI：專案 studio.json 的 defaultCli（vs3d new --cli 會寫入）＞ 工作區設定 ＞ claude
  const wsCli = workspaceSettings.defaultCli || 'claude', projCli = studioJson.defaultCli || wsCli;
  const layers = [[workspaceSettings.roles?.[role], wsCli], [studioJson.roles?.[role], projCli], [override.roles?.[role], null]].filter(([l]) => l);
  const cli = override.roles?.[role]?.cli || override.cli || [...layers].reverse().find(([l]) => l.cli)?.[0].cli || projCli;
  const r = { cli, model: PRESETS[cli]?.[role] ?? '', effort: '' };
  // 只套用同一個 CLI 的層：沒寫 cli 的層屬於該層的預設 CLI（單次指定的層跟著這次的 CLI）；不同 CLI 的模型名稱不通用
  for (const [l, layerCli] of layers) {
    if ((l.cli || layerCli || cli) !== cli) continue;
    if (l.model != null) r.model = l.model;
    if (l.effort != null) r.effort = l.effort;
  }
  if (override.model && !override.roles?.[role]?.model) r.model = override.model;
  return r;
}

export const loadRoleContext = (settingsFile, studioJsonFile, override) =>
  ({ workspaceSettings: readJson(settingsFile, {}), studioJson: readJson(studioJsonFile, {}), override });
