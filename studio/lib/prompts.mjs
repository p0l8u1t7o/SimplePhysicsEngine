// 各角色的提示詞。每輪提示＝共通開頭（位置、規則、可寫範圍）＋交接摘要＋角色任務。
import { join } from 'node:path';
import { readText, rel } from './util.mjs';
import { formatAnswers } from './questions.mjs';

const ROLE_TITLE = { change: '依要求修改', optics: '光學方案（AOI）', plan: '規劃（配置提案）', build: '開發（第一段）', fix: '修正', review: '審查', render: '渲染與細節補強' };
const ROLE_TITLE2 = { plan: '第二段規劃（電控、電盤、配線、相機）', build: '開發（第二段）', fix: '修正（第二段）', review: '審查（第二段）', render: '渲染與細節補強 B（第二段）' };

export function header({ ws, J, role, adapter, scope, segment = 1 }) {
  const title = `# vs3d 任務：${(segment === 2 ? ROLE_TITLE2 : ROLE_TITLE)[role] || role}`;
  // 本庫模式：本庫既有的站，規則是根目錄 AGENTS.md＋本站 AGENTS.md（Claude Code 與 Codex 都會從 git 根目錄讀到）
  if (J.repo) return [title, '',
    `- 專案資料夾（你的工作目錄）：\`${J.dir}\`，本庫的站 \`${J.id}\``,
    `- 本庫：\`${ws}\`；core 在 \`${join(ws, 'core')}\`（不要修改：core 由主 session 負責，缺功能就在本站暫代並登記到 \`core/REQUESTS.md\`）`,
    `- 規則：本站的 \`AGENTS.md\`（規格與已拍板事項），以及本庫根目錄的 \`AGENTS.md\`（必讀；你是從本站資料夾啟動的子專案代理，只能改本站）`,
    `- 這一輪可以寫的範圍：${scope}`,
    `- **不要執行 git commit、checkout、restore、stash、reset、clean、switch**：使用者也在這個工作目錄工作，版本控制由 app 負責，每輪結束只提交本站的路徑`,
    `- 快速檢查：\`node ../../core/tools/check.mjs "${J.id}" --quick\``,
  ].join('\n');
  const lines = [
    title,
    '',
    `- 專案資料夾（你的工作目錄）：\`${J.dir}\`，專案名稱 \`${J.id}\``,
    `- 工作區：\`${ws}\`；core 在 \`${join(ws, 'core')}\`（唯讀，框架說明在 \`core/README.md\`）`,
    `- 規則：專案的 \`AGENTS.md\`，以及工作區的 \`${join(ws, 'AGENTS.md')}\`（共通規則，必讀）`,
    `- 這一輪可以寫的範圍：${scope}`,
    `- 快速檢查：\`node ../../core/tools/check.mjs "${J.id}" --quick\``,
  ];
  // Codex 只從 git 根目錄往下找 AGENTS.md，工作區規則直接附上
  if (!adapter.loadsParentRules) lines.push('', '## 工作區共通規則（全文）', '', readText(join(ws, 'AGENTS.md')).replace(/^# .*\n/, ''));
  return lines.join('\n');
}

export function handoff({ J, check, shotsDir, notes = [], violations = [] }) {
  const out = ['## 交接摘要', ''];
  out.push(`- 需求與已拍板事項：\`AGENTS.md\``);
  if (readText(join(J.plan, 'proposal.md'))) out.push(`- 配置提案：\`.studio/plan/proposal.md\``);
  if (readText(join(J.studio, 'parts-catalog.md'))) out.push(`- 元件資料庫清單：\`.studio/parts-catalog.md\`（過去專案用過的元件、規格與參考單價；選型、列元件表、估成本時先查，沿用的寫出元件編號，例如 P-00132；清單沒有的標「新元件」。不要修改這個檔）`);
  if (readText(join(J.plan, 'segment2.md'))) out.push(`- 第二段提案：\`.studio/plan/segment2.md\`、\`.studio/plan/segment2.json\`；寫法見 \`core/examples/segment2/README.md\``);
  if (check) out.push(`- 最近一次檢查（${check.quick ? '快速' : '完整'}）：${check.ok ? '全部通過' : `${check.failures.length} 項失敗`}`);
  if (shotsDir) out.push(`- 截圖：\`${rel(J.dir, shotsDir)}\``);
  for (const n of notes) out.push(`- ${n}`);
  if (violations.length) out.push('', '**上一輪有越界寫入，已被 app 還原，不要再寫這些路徑：**', ...violations.slice(0, 20).map(v => `- ${v.area}：${v.path}（${v.change}${v.restored ? '，已還原' : '，未能自動還原'}）`));
  return out.join('\n');
}

// 只做 3D 的專案：元件表 parts.json（提案確認後匯入元件資料庫）
const PARTS_JSON = `另外寫一份元件表 \`.studio/plan/parts.json\`（使用者確認提案後，app 會把它匯入公司的元件資料庫）：列出提案裡要採購或選型的元件（手臂、夾爪、相機、鏡頭、光源、感測器、PLC、驅動、輸送等；自製的機架、治具不用列），格式如下。\`ref\` 是沿用的元件編號（查 \`.studio/parts-catalog.md\`）；資料庫沒有合用的就不要寫 \`ref\`，app 會新增成「待確認」的新元件。

\`\`\`json
{ "parts": [
  { "ref": "P-00132", "name": "工業相機", "qty": 2, "reason": "沿用：兩站各一台" },
  { "name": "環形光源", "brand": "", "model": "示意", "spec": "白光、外徑 90 mm", "category": "光源", "unit": "組", "qty": 2, "reason": "新元件：資料庫沒有合用的" }
] }
\`\`\`
`;

// 評估＋成本（評估平台 Q6）：可行性分析與 BOM（取代元件表 parts.json）；app 在提案確認前檢查結構（lib/assess.mjs）
const ASSESS_TASK = `另外寫可行性分析與 BOM（app 會先檢查格式，不對會退回給你改；使用者確認提案後存進公司的資料庫，BOM 變成成本表）。

**\`.studio/plan/feasibility.md\`**，章節（標題要含這些字）：

1. 結論：可行／有條件可行／不可行，一段話＋關鍵條件
2. 需求摘要與量化指標：節拍、精度、產品尺寸範圍、良率要求
3. 技術評估：各子系統（機構、手臂可達、物料流、視覺、電控、安全），每項寫做法、依據、餘裕；有物料流、掉落、料箱堆積或夾取穩定的問題時，寫出要做哪些物理模擬
4. 節拍核算：各步驟秒數、瓶頸、和目標的差距
5. 風險與對策
6. POC 項目：哪些要先打樣驗證、為什麼
7. 需要拍板的事、要到現場確認的事
8. 假設值清單：標「示意」的數字與依據

**\`.studio/plan/feasibility.json\`**（和 feasibility.md 一致；verdict 只能是「可行」「有條件可行」「不可行」，有條件可行一定要列 conditions；cycle 的數字是秒）：

\`\`\`json
{ "verdict": "有條件可行", "summary": "一段話的結論",
  "conditions": ["關鍵條件"], "metrics": [{ "name": "節拍", "target": "≤ 10 s", "estimate": "8.5 s" }],
  "cycle": { "target": 10, "estimate": 8.5 },
  "risks": [{ "risk": "風險", "level": "高", "mitigation": "對策" }], "poc": [{ "item": "打樣項目", "why": "原因" }],
  "decisions": ["要拍板的事"], "assumptions": ["假設值與依據"] }
\`\`\`

**\`.studio/plan/bom.json\`**：提案裡要採購、加工、施工的每一項，依子系統分段（不用另外寫 parts.json）：

\`\`\`json
{ "items": [
  { "line": "3-01", "section": "3 視覺", "ref": "P-00132", "qty": 2, "reason": "沿用：兩站各一台" },
  { "line": "3-02", "section": "3 視覺", "name": "環形光源", "brand": "", "model": "示意", "spec": "白光、外徑 90 mm", "category": "光源", "unit": "組", "qty": 2, "estimate": 8000, "reason": "新元件" },
  { "line": "4-01", "section": "4 治具", "custom": true, "name": "定位治具", "spec": "SKD11", "qty": 2, "unit": "套", "estimate": 90000, "grade": "C" },
  { "line": "6-01", "section": "6 工程", "labor": "eng", "name": "機構設計", "qty": 30, "unit": "人日" }
] }
\`\`\`

- **市購品一律查元件清單** \`.studio/parts-catalog.md\`：有合用的就用 \`ref\` 寫元件編號；沒有的列成新元件（name、category、spec 或 brand／model，加 estimate 估價），app 會新增成「待確認」元件。
- \`custom: true\` 只能用在加工件、治具、機架、外罩這類自製品，要寫 estimate；市購品不能標成客製。
- \`labor\` 是工程人日：eng（工程師）或 tech（技術員），單價用公司費率，不用寫。
- **不要自己加總成本**：單價、預備費與稅由平台的成本表計算。
`;

// 審查：有評估＋成本的專案另外對照可行性與 BOM（評估平台 Q6）
const ASSESS_REVIEW = '- 這個專案有評估＋成本：另外讀 `.studio/plan/feasibility.md`、`feasibility.json` 與 `.studio/plan/bom-summary.md`（app 從資料庫寫出的成本表摘要）。必修另外看：可行性的結論、節拍與 3D 的排程、配置是否一致；BOM 有沒有漏列場景裡的設備，或列了場景沒有的設備；有 AOI 方案時是否符合檢測需求。\n';

export const TASK = {
  plan: ({ components = ['3d'] } = {}) => `## 任務：配置提案

讀 \`AGENTS.md\` 的需求與 \`docs/\` 裡的資料（圖片、PDF 也要看；Office 檔看 app 抽出的 \`docs/<檔名>.extract/text.md\` 與同資料夾的圖片），寫出配置提案到 \`.studio/plan/proposal.md\`，章節如下：

1. 製程流程：工站與順序
2. 站位配置：各設備的位置與尺寸範圍（mm）
3. 設備選型：手臂、相機、輸送等；先找 \`core/models\` 有沒有現成模型，並查元件資料庫清單（\`.studio/parts-catalog.md\`，有這個檔的話）有沒有過去用過的同類元件，沿用的寫出元件編號（例如 P-00132）；規格沒指定的用合理選型並標「示意」，清單裡沒有的標「新元件」
4. 節拍估算：各步驟秒數與總節拍
${components.includes('3d') ? '5. 第一段範圍：場景、排程、視角、播放列、手機與平板版面；列出這一段不做的事（電控、配線、相機子畫面屬於第二段）' : `5. 範圍：這個專案只做評估${components.includes('aoi') ? '與 AOI' : ''}，不做 3D 動畫（之後要做時會再加）`}${components.includes('aoi') ? '\n   視覺：設備選型列出相機、鏡頭、光源的初步選型與檢測項目（AOI 方案之後在光學工作台細化）' : ''}
6. 假設與待確認事項

${components.includes('assess') ? ASSESS_TASK : PARTS_JSON}
資料裡如果出現用戶（客戶、委託方）的公司或品牌名稱，一行一個寫進 \`.studio/plan/client-names.txt\`（app 會加進名單，之後所有角色都不得顯示）；提案本身也改用中性描述。

需要使用者拍板的事（例如兩種站位方案、設備選型、規格不清楚的地方）寫成問題檔，一輪最多 4 題。
這一輪只寫 \`.studio/plan/\` 與 \`.studio/questions/\`，不要建立或修改網頁與程式檔。`,

  build: () => `## 任務：第一段開發

依配置提案（\`.studio/plan/proposal.md\`）與 \`AGENTS.md\`「已拍板事項」，完成第一段：

- 場景：設備與工件寫在 \`web/js/project.js\`，能用 \`core/models\` 的模型就用；元件庫有的設備用 \`fromPart('P-xxxxx')\`（\`core/models/parts.js\`，清單在 \`web/js/parts-models.js\`）建立，模型根會帶 \`partRef\`，平台的 bom 檢查靠它對成本表；自己畫的設備用 \`tagPart(group, 'P-xxxxx')\` 標編號，現場既有、不採購的設備在根群組標 \`userData.noBom = '原因'\`
- 有物料流、掉落、料箱堆積或夾取穩定要表現時，用 \`core/physics\`（預先烘焙，\`createProject\` 可以是 async；說明在 core 的 \`physics/README.md\`）；工作點用 \`core/robot/reach.js\` 的可達檢查放進 \`layoutChecks\`
- 排程：製程時間軸（\`createStepSequence\` 或 \`createTimeline\`），節拍符合提案
- 介面：站別按鈕、視角、3D 標籤、側欄說明（\`web/js/main.js\`；\`index.html\` 的版面骨架保留）
- 播放列與手機、平板精簡版面、\`?movie\` 錄影掛鉤（範本已接好，不要拿掉；錄影的追焦對象改成本專案的工件）
- \`tools/verify.mjs\` 改成本專案的製程規則檢查（例如節拍上限、放置位置）
- \`project.json\` 的 \`title\`、\`summary\`

範本裡的示範龍門與工件要換成本專案的內容；範本的相機子畫面屬於第二段，第一段不要顯示（相機設備本身可以建模）。完成後跑快速檢查並修到通過。`,

  fix: ({ check }) => `## 任務：修正檢查失敗

app 執行的檢查結果如下：

${check ? failureText(check) : '（沒有檢查結果）'}

找出根因並修正：不要用 allow 規則蓋掉真的干涉，閃爍要改幾何。修完跑快速檢查確認。`,

  // 第二段：電控、電盤、配線、相機子畫面、視覺疊圖（第一段已經使用者確認）
  plan2: () => `## 任務：第二段規劃（電控、電盤、配線、相機）

第一段（場景、排程、視角、播放列、手機版面）已經完成並經使用者確認。讀 \`AGENTS.md\`（需求與已拍板事項）、\`.studio/plan/proposal.md\`（第一段提案）、\`docs/\` 的資料、現有的 \`web/js/\`，以及 \`core/examples/segment2/README.md\`（第二段的寫法、元件種類、相機模型與檢查），寫出：

**\`.studio/plan/segment2.md\`**，章節如下：

1. 電控架構：電源、PLC、I/O、通訊、安全、各軸驅動、視覺電腦；與各設備（手臂控制器、輸送、相機）的交握。PLC、安全元件、相機、鏡頭、光源等先查元件資料庫清單（\`.studio/parts-catalog.md\`，有這個檔的話），沿用的寫出編號，沒有的標「新元件」
2. 電盤：放在哪裡（不擋動線與維修、門打得開）、櫃體尺寸、背板元件分列（每列寬度要放得下）
3. 外露線路與拖鏈：每條線從哪裡到哪裡、沿什麼結構走；哪些軸要拖鏈、行程多少
4. 相機與光源：每台相機的用途、感光元件、焦距、工作距離與視野（要涵蓋工件加定位誤差）、安裝位置與支架、光源；相機子畫面要呈現什麼、何時取像、疊圖標記什麼
5. 不改的東西：第一段的節拍、動作、站位（真的需要改就寫問題檔）
6. 假設與待確認事項（型號未定的標「示意」）

**\`.studio/plan/segment2.json\`**（開發角色照這份做）：

\`\`\`json
{
  "cabinet": { "center": [0, 0, 0], "size": [600, 900, 400], "panel": [500, 700] },
  "components": [
    { "id": "PLC1", "kind": "plc", "title": "設備 PLC", "size": [80, 90, 85], "role": "control", "category": "dc", "source": "PS1", "row": 1, "model": "示意" }
  ],
  "routes": [ { "name": "X 軸動力", "from": "D1", "to": "X 軸馬達", "via": "拖鏈 → 樑後側 → 腳柱 → 櫃頂接頭", "carrier": true } ],
  "cameras": [
    { "id": "CAM1", "purpose": "尺寸檢查", "sensor": [8.8, 6.6], "focal": 16, "workingDistance": 450, "fov": [248, 186], "at": [0, 0, 0], "aim": "down", "light": "環形光源", "trigger": "工件到位後 0.2 s" }
  ]
}
\`\`\`

\`kind\`、\`role\`、\`category\` 的可用值見 \`core/examples/segment2/README.md\`。

另外寫一份元件表 \`.studio/plan/parts-segment2.json\`（使用者確認提案後，app 會把它匯入公司的元件資料庫）：列出第二段新增的採購元件（PLC、I/O、驅動器、安全元件、電源、相機、鏡頭、光源、視覺電腦等；線材與自製件不用列），格式如下。\`ref\` 是沿用的元件編號（查 \`.studio/parts-catalog.md\`）；資料庫沒有合用的就不要寫 \`ref\`，app 會新增成「待確認」的新元件。

\`\`\`json
{ "parts": [
  { "ref": "P-00132", "name": "工業相機", "qty": 2, "reason": "沿用：兩站各一台" },
  { "name": "環形光源", "brand": "", "model": "示意", "spec": "白光、外徑 90 mm", "category": "光源", "unit": "組", "qty": 2, "reason": "新元件：資料庫沒有合用的" }
] }
\`\`\`
需要使用者拍板的事（例如電盤放哪一側、相機數量、規格不清楚）寫成問題檔，一輪最多 4 題。
這一輪只寫 \`.studio/plan/\` 與 \`.studio/questions/\`，不要建立或修改網頁與程式檔。`,

  build2: () => `## 任務：第二段開發（電控、電盤、配線、相機）

依 \`.studio/plan/segment2.md\`、\`segment2.json\` 與 \`AGENTS.md\`「已拍板事項」，照 \`core/examples/segment2/README.md\` 的寫法完成第二段：

- 電控：\`web/js/electrical.js\`（參考 \`core/examples/segment2/segment2.js\`，import 改成 \`@core/…\`）：電盤櫃、背板元件表（\`component()\`）、穿板接頭、櫃內連線
- 外露線路與拖鏈：會動的軸用 \`carrier\`，在 \`apply(t)\` 設位置；固定線沿結構、地面或線槽走，不能懸空
- 相機與光源：\`core/models/camera.js\`；支架要接到結構上；相機線接到電盤
- 網頁：電控檢視器（⚡）、「電盤配線」視角（進入時剖視）、線材圖例、相機子畫面（\`renderCamera\`＋\`createVisionOverlay\` 疊圖，標「SIM／示意」），多台相機用 \`setSources\`
- \`project.js\` 的 \`verify.cables\` 宣告會動的機構與要讓開的零件（app 會做配線動態取樣）
- 側欄或面板加上電控與相機的說明（型號未定的標「示意」）

**不能改第一段**：時間軸總長、事件、\`apply(t)\` 原有的狀態、會動物件的軌跡都要相同（可以新增欄位與會動的細節，例如拖鏈、光源亮度）；app 會比對第一段的排程指紋，不同就退回。完成後跑快速檢查（含 \`electrical\`）並修到通過。`,
};

// 審查：看截圖、對照拍板事項與規則，輸出必修與建議補強
// 修改指令：使用者對已完成的專案（含本庫既有的站）下的一段要求
TASK.change = ({ request = '', lockSchedule = false }) => `## 任務：依使用者的要求修改

這個專案已經完成，使用者要求修改：

${request.split('\n').map(l => '> ' + l).join('\n')}

先讀 \`AGENTS.md\`（規格與已拍板事項）、\`README.md\` 與 \`web/js/\`，了解現在的做法，再照要求修改：

- 只改要求的部分，其他設備、動作、視角、面板維持原樣；要求和已拍板事項衝突時，寫問題檔問使用者，不要自己決定。
${lockSchedule ? '- **不能改節拍與動作**：時間軸總長、事件、\`apply(t)\` 原有的狀態、會動物件的軌跡都要和修改前相同（可以新增欄位與會動的細節）；app 會比對排程指紋，不同就退回。\n' : '- 可以改節拍與動作；改了的話同步更新側欄說明、\`layoutChecks()\` 與本站的 \`tools/verify.mjs\`。\n'}- 新的幾何不能撞到東西、不能和既有的面重合（scene 干涉、閃爍維持 0）；用得到 core 的模型與元件就用。
- 完成後跑快速檢查並修到通過；結束訊息列出改了哪些檔案、做了哪些假設。`;

TASK.review = ({ shots = [], refs = [], round = 1, segment = 1, request = '', components = ['3d'] }) => `## 任務：審查${request ? '修改後的' : segment === 2 ? '第二段（電控、電盤、配線、相機）' : '第一段'}成品（第 ${round} 次）
${request ? `\n這次審查的是依使用者要求修改後的結果。使用者的要求：\n\n${request.split('\n').map(l => '> ' + l).join('\n')}\n\n必修另外看：有沒有照要求做到、有沒有改到要求以外的東西。\n` : ''}

你是審查者，不是開發者：**不要修改任何專案檔案**，只寫審查結果。

請看下列截圖（用讀檔工具開啟圖片），並讀 \`AGENTS.md\` 的需求與「已拍板事項」、\`.studio/plan/proposal.md\`${segment === 2 ? '、`.studio/plan/segment2.md`／`segment2.json`、`core/examples/segment2/README.md`' : ''}、工作區規則，必要時讀 \`web/js/\` 的程式確認：

${shots.map(s => `- \`${s}\``).join('\n') || '- （沒有截圖）'}
${refs.length ? `\n使用者提供的參考資料（照片、圖面）：\n\n${refs.map(s => `- \`${s}\``).join('\n')}\n` : ''}
把結果寫成 \`.studio/reviews/review-${round}.json\`：

\`\`\`json
{
  "must": [
    { "id": "M1", "issue": "違反了什麼（引用拍板事項或規則原文）", "evidence": "在哪裡看到（截圖檔名、檔案與函式）", "fix": "要怎麼改" }
  ],
  "suggest": [
    { "id": "S1", "area": "材質｜細部幾何｜燈光｜鏡頭｜標籤｜其他", "item": "建議補強的具體內容", "priority": 1 }
  ],
  "summary": "一兩句總評"
}
\`\`\`

- **must（必修）只放違反已拍板事項、需求或工作區規則的問題**，例如順序做反、做了明講不做的東西、拍板的設備沒出現、畫面或檔案出現用戶名稱。外觀好不好看不算必修。
- **suggest（建議補強）**只放外觀：材質、細部幾何（倒角、螺絲、溝槽、管線、標示）、燈光、鏡頭構圖、標籤樣式；不可以要求改節拍、動作或站位。priority 1 最重要、3 最次要，最多 15 項。
${components.includes('assess') && segment === 1 && !request ? ASSESS_REVIEW : ''}${segment === 2 ? '- 第二段的必修另外看：提案列的電控元件、相機與光源有沒有做出來，位置與視野是否照提案；電盤是否擋到動線或門打不開；線路或相機懸空沒有固定；相機子畫面與疊圖有沒有呈現；第一段的內容有沒有被改壞。\n- 第二段的建議補強集中在電盤內部（線槽、標籤、端子）、線材（束帶、固定座、彎曲）、相機與光源外觀。\n' : ''}- 沒有問題就給空陣列。寫完檔案就結束。`;

// 渲染與細節補強：只改「看起來」，不改「做了什麼」
TASK.render = ({ items = [], focus = '', round = 1, segment = 1 }) => `## 任務：渲染與細節補強${segment === 2 ? ' B（第二段）' : ''}（第 ${round} 次）

依下列審查建議，提升場景的外觀：材質（\`MAT\`、\`finished()\`、貼圖）、細部幾何（倒角、螺絲、溝槽、管線、標示）、燈光（\`look\`、\`extraLights\`、陰影範圍）、鏡頭（視角構圖）、標籤樣式。core 的 \`geom/finish.js\`、\`hardware.js\`、\`surfaces.js\`、\`perforated.js\` 可以直接用。

${items.map(x => `- **${x.id}**［${x.area || '其他'}］${x.item}`).join('\n') || '- （審查沒有具體建議，請自行找出最影響觀感的 3～5 處補強）'}
${focus ? `\n這次的處理範圍：${focus}\n` : ''}
**硬性限制**（app 會在你結束後檢查，任何一項沒過都會退回給你）：

- 不能改節拍與動作：時間軸總長、事件、\`apply(t)\` 回傳的原有狀態、會動物件的軌跡都要和補強前相同（可以新增欄位與會動的細節，例如拖鏈）。不要改有名稱的會動物件的名稱。
- 不能改配置：\`layoutChecks()\` 的結果要相同。${segment === 2 ? '\n- 不能改電控元件表、相機位置與視野；electrical 檢查（元件、連線、接頭、配線取樣）要維持通過。' : ''}
- 新細節不能撞到東西，也不能和既有的面重合（scene 干涉、閃爍要維持 0）。
- 效能預算：三角面數不超過補強前的 1.5 倍、draw call 不超過 1.3 倍，手機幀率不能明顯下降。重複的細節用共用幾何或 InstancedMesh。
- 完成後跑快速檢查並修到通過。`;

const failureText = c => c.failures.map(f => [`- **${f.check}**：${f.note}`, ...f.detail.slice(0, 25).map(d => `    ${d}`)].join('\n')).join('\n');

export function rolePrompt(role, ctx) {
  const key = ctx.segment === 2 && TASK[role + '2'] ? role + '2' : role;   // 第二段有自己的規劃與開發任務
  if (!TASK[key]) throw new Error(`角色 ${role} 尚未提供提示`);
  return [header({ ...ctx, role }), handoff(ctx), TASK[key](ctx)].join('\n\n');
}

// 續接：使用者回答問題後
export const answersPrompt = (answers, ctx) => [
  '使用者回答了你的問題：', '', formatAnswers(answers), '',
  ctx?.violations?.length ? handoff(ctx) : '',
  '請依回答繼續原本的任務；如果還有必須由使用者決定的事，再寫問題檔後結束。',
].filter(Boolean).join('\n');

// 續接：同一個修正工作階段的下一輪
export const fixAgainPrompt = (check, ctx) => [
  ctx?.violations?.length ? handoff(ctx) : '',
  `app 重新執行檢查，仍有問題：`, '', failureText(check), '', '請繼續修正，修完跑快速檢查確認。',
].filter(Boolean).join('\n');

// 審查的必修項交給修正角色
export const mustFixPrompt = (must, ctx) => [
  rolePromptHeader(ctx),
  '## 任務：修正審查發現的必修問題', '',
  '審查者比對已拍板事項與規則後，發現以下問題，請逐項修正（不要順便做外觀補強）：', '',
  ...must.map(m => `- **${m.id}**：${m.issue}\n  依據／位置：${m.evidence || '—'}\n  建議改法：${m.fix || '—'}`), '',
  '修完跑快速檢查並修到通過。',
].join('\n');
const rolePromptHeader = ctx => [header({ ...ctx, role: 'fix' }), handoff(ctx)].join('\n\n');

// 補強沒過守門檢查時回送同一個補強工作階段
export const renderGuardPrompt = (fails, ctx) => [
  ctx?.violations?.length ? handoff(ctx) : '',
  '補強後的守門檢查沒有通過，請修正以下問題（保留其他補強成果）：', '',
  ...fails.map(f => `- ${f}`), '',
  '修完跑快速檢查確認。',
].filter(Boolean).join('\n');

// 使用者要求部分退回
export const renderRevisePrompt = (text, ctx) => [
  ctx?.violations?.length ? handoff(ctx) : '',
  `使用者看過補強前後對照，要求調整：\n\n${text}\n\n其餘補強保留。改完跑快速檢查確認，硬性限制同前。`,
].filter(Boolean).join('\n');

// 問題檔格式錯誤時回送
export const invalidQuestionsPrompt = invalid => [
  '你寫的問題檔格式有誤，app 無法顯示給使用者：', '',
  ...invalid.map(x => `- \`.studio/questions/${x.file}\`：${x.errors.join('；')}`), '',
  '請依工作區 AGENTS.md「問題檔」的格式修正後結束。',
].join('\n');
