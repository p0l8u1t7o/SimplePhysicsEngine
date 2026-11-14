// 提案簡報（本站自有的產生器，公司樣板 zqdeck）：前段以提案目標呈現方案與可達到的功能；
// 未知事項、假設、風險、POC、模擬與實機的界線、參數敏感度與 SIM 驗證放在最後的隱藏頁。簡報不放成本數字。
//   node --import ../../core/tools/register.mjs tools/proposal-deck.mjs   （在站資料夾執行）
// 先準備圖片（都在 TEMP/WaferInspection-shots/，不進版控）：
//   tools/presentation-shots.mjs（presentation/）、tools/vs-composite.mjs --clean（visionsequence/*-clean.png）
// 輸出：docs/assessment/WaferInspection-評估簡報-<日期>.pptx（docs/ 只留本機）。成本表 xlsx 另由 vs3d assess deck 產生。
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../../../core/tools/png.mjs';
import { findDeckKit } from '../../../studio/lib/deck.mjs';
import { createProject } from '../web/js/project.js';
import { renderTile, DISPLAY_RES } from '../web/js/inspection-sim.js';
import { SCENARIOS, PARAMS, SOURCE } from '../web/js/spec.js';

const SITE = fileURLToPath(new URL('../', import.meta.url)), ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SHOTS = join(ROOT, 'TEMP', 'WaferInspection-shots');
const kit = findDeckKit(); if (!kit) { console.log('✗ 找不到公司簡報樣板（zq-work-deck）'); process.exit(1); }
const tmp = mkdtempSync(join(tmpdir(), 'wafer-prop-'));
const r1 = (v, n = 1) => (+v).toFixed(n);
const build = o => createProject({ scene: new THREE.Scene(), ...o });

// ---------------------------------------------------------------- 數字
const base = build({ mode: 'full', scenario: 'clean' }), e = base.est, p = base.p;
const fast = build({ mode: 'full', scenario: 'clean', params: { camIf: '10GigE' } }).est;
const mag2 = build({ mode: 'full', scenario: 'clean', params: { mag: 2 } }).est;
const mag2f = build({ mode: 'full', scenario: 'clean', params: { mag: 2, camIf: '10GigE' } }).est;
const min = s => `${r1(s / 60)} 分鐘`;

// ---------------------------------------------------------------- 影像特寫（相機模擬直接輸出）
const png = (name, img, ch) => {
  const n = img.w * img.h, data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const c = ch === 'BF' ? [img.rgb[0][i], img.rgb[1][i], img.rgb[2][i]] : [img.df[i] * .88, img.df[i] * .94, img.df[i]];
    for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.max(0, Math.min(255, Math.round(c[k] * 255)));
    data[i * 4 + 3] = 255;
  }
  const f = join(tmp, name + '.png'); writeFileSync(f, encodePng({ width: img.w, height: img.h, data })); return f;
};
const line = build({ scenario: 'line' }), cand = line.candidates[0], q = line.plan.positions[cand.k];
const lineImg = renderTile(q.x, q.y, line.plan.fov, line.p, { defects: SCENARIOS.line.defects, seed: 1 + q.k * 3, res: DISPLAY_RES });
const a2 = SCENARIOS.line.defects.find(d => d.id === 'A2');
const padImg = renderTile((a2.a[0] + a2.b[0]) / 2, (a2.a[1] + a2.b[1]) / 2, [3.6, 2.4], line.p, { defects: SCENARIOS.line.defects, seed: 5, res: 0.006 });
const dim = SCENARIOS.defocus.defects.find(d => d.kind === 'dim');
const dimImg = renderTile(dim.at[0], dim.at[1], line.plan.fov, line.p, { defects: SCENARIOS.defocus.defects, seed: 9, res: DISPLAY_RES });
const closeups = [[png('line-bf', lineImg, 'BF'), '明場：線狀表面異常斜穿多個區塊'], [png('line-df', lineImg, 'DF'), '暗場：同一條線散射成亮線，對比更明顯'],
  [png('pad-bf', padImg, 'BF'), '明場近看：墊片內的細暗斜線與旁邊的顆粒'], [png('dim-bf', dimImg, 'BF'), '照明不足：自動判待複檢，不判良品']];

// ---------------------------------------------------------------- SIM 驗證（隱藏頁）
const simRows = Object.entries(SCENARIOS).map(([id, sc]) => {
  const pr = build({ scenario: id, mode: 'full' });
  const st = s => pr.per.filter(r => r.status === s).length;
  return [sc.label, String(pr.candidates.length), String(st('recheck') + st('missing')), pr.score.rows.map(r => `${r.id} ${r.result}`).join('；') || '—'];
});

const shot = f => { const x = join(SHOTS, f); return existsSync(x) ? x : null; };
const data = {
  date: new Date().toISOString().slice(0, 10),
  kpi: [[`${r1(e.umPerPx, 1)} µm`, '每像素物方解析度', `10 µm 缺陷約 ${r1(e.defectPx)} px`], ['100%', '有效區覆蓋', `${e.positions} 個取像位置`],
    ['2 通道', '明場＋暗場', '每個位置各取一張'], [`${r1(e.cycle / 60)} min`, '整片週期', `10GigE 約 ${r1(fast.cycle / 60)} min`]],
  kpiBody: ['單片晶圓真空吸附、自動對位與對焦，XY 平台停拍掃描整片有效區',
    '同軸明場看反射與暗線、低角度暗場看散射與顆粒，兩通道各自比對、結果合併',
    '候選位置自動回頭複檢，結果寫入 wafer map 並交人工確認；檢測平台採用 VisionSequence'],
  composition: ['花崗岩平台＋避震，固定龍門光學頭', `XY 精密平台（行程 X ±175、Y −175～+225 mm）＋θ 微調台`, '300 mm 多孔陶瓷真空吸盤，壓力開關確認吸附',
    '20MP 相機＋1× 同軸遠心鏡頭＋Z 調焦軸', '同軸明場光源＋Ø100 低角度環形光（暗場）', '遮光外罩、HMI、三色燈、安全門鎖'],
  flow: ['人工放片 → 真空吸附確認', `兩點對位、θ 自動修正`, `${p.afPoints} 點自動對焦，建立對焦平面`, `停拍掃描 ${e.positions} 個位置（明場＋暗場）`,
    '候選位置自動複檢（每處 3 張）', 'wafer map 與複檢清單輸出，人工確認'],
  capability: [
    ['物方解析度', `${r1(e.umPerPx, 2)} µm/px`, '20MP 相機（2.4 µm 像素）＋1× 固定倍率鏡頭'],
    ['單張視野', `${r1(e.fov[0], 2)} × ${r1(e.fov[1], 2)} mm`, `視野重疊 ${p.overlap * 100}%`],
    ['最小缺陷取樣', `10 µm 約 ${r1(e.defectPx)} px`, '每個缺陷至少 3 px'],
    ['景深', `約 ${r1(e.dof * 1000, 0)} µm`, '搭配對焦平面補償晶圓翹曲'],
    ['覆蓋', `有效區 100%（Ø${(2 * base.plan.Rv).toFixed(0)}）`, `${e.positions} 個位置、${e.rows} 列蛇形掃描、邊緣排除 ${p.edgeExcl} mm`],
    ['照明', '同軸明場＋低角度暗場', `暗場入射約 ${r1(base.optics.lightAngleDF, 0)}°，頻閃分時取像`],
    ['影像量', `${e.images} 張／片、約 ${r1(e.dataGB, 0)} GB`, '對位與複檢另計'],
    ['結果輸出', 'wafer map＋複檢清單', '候選位置、影像、人工確認紀錄'],
  ],
  algo: ['多光源取像：停穩後明場、暗場各一張', '影像品質：清晰度與亮度檢查', '陰影校正：分區明暗補正', '良品影像差異比對：明場、暗場各自比對', '粒子分析與框合併：輸出候選區'],
  guard: ['缺圖、失焦、照明不足：自動判待複檢，不判良品', '候選位置依最近路徑回頭複檢', '複檢後交人工確認，紀錄寫入 wafer map', '疑似暗線列為「線狀表面異常」，由人工判定性質'],
  vs: [
    ['取像', '多光源取像', '頻閃、曝光、明暗場通道切換'],
    ['影像品質', '區域指標量測、灰階統計', '清晰度、亮度檢查'],
    ['明暗補正', '陰影校正', '分區或白色參考影像補正'],
    ['差異比對', '良品影像差異比對、統計良品比對', '與良品樣板比較，輸出差異遮罩'],
    ['候選', '粒子分析、框操作', '面積篩選、相鄰候選合併'],
    ['驗證', '批次測試、Golden Set 回歸、驗收書', '影像集回歸與驗收紀錄'],
    ['輸出', '結果回報、運行介面、HTTP／TCP／Modbus', 'wafer map、複檢清單、MES 介面'],
    ['擴充', '良品學習異常檢測', '只需良品影像的異常檢測'],
  ],
  cycle: e.breakdown.filter(b => b.s > .05).map(b => [b.label, `${r1(b.s)} s`]).concat([['整片週期', `${r1(e.cycle)} s（約 ${min(e.cycle)}）`]]),
  options: [
    ['本版：20MP 面掃＋GigE', `約 ${min(e.cycle)}`, '影像傳輸為主要時間'],
    ['20MP 面掃＋10GigE', `約 ${min(fast.cycle)}`, '傳輸不再是瓶頸，時間主要在平台移動與停穩'],
    ...base.lineScan.map(c => [`${c.name} 線掃描（明暗場各一趟）`, `掃描約 ${c.scanS} s`, `掃描帶 ${c.swath} mm × ${c.swaths} 道、${c.speed} mm/s`]),
  ],
  summary: [['整片覆蓋', `有效區 100%、${e.positions} 個位置，明場＋暗場雙通道`], ['自動流程', '真空確認、對位、對焦、掃描、複檢、wafer map 一次完成'],
    ['品質把關', '缺圖、失焦、照明不足自動判待複檢'], ['檢測平台', 'VisionSequence 流程化建置、Golden Set 回歸與 MES 介面'],
    ['擴充路線', `10GigE 約 ${min(fast.cycle)}／片；線掃描可再縮短`], ['下一步', '以實際晶圓打光與規格確認，定版光學與節拍']],
  shots: { machine: shot('presentation/machine.png'), front: shot('presentation/machine-front.png'), optics: shot('presentation/optics.png'), stage: shot('presentation/stage.png'),
    top: shot('presentation/scan-top.png'), full: shot('presentation/full-scan.png'), vsEditor: shot('visionsequence/vs-editor-clean.png'), vsBoard: shot('visionsequence/vs-dashboard-clean.png') },
  closeups,
  // ---- 隱藏頁
  facts: [['客戶提供', '晶圓表面照片 9 張（6 張 1936×1096、3 張含紅色箭頭標記）；應用背景為 AI 伺服器'],
    ['未提供', '產品類型、製程站別、晶圓直徑與厚度、die 尺寸'], ['未提供', '最小缺陷、缺陷種類、允收規格、節拍、檢出率與誤判率'],
    ['照片限制', '沒有尺度與拍攝條件；照明呈水平帶狀；各張倍率與方向不同，不能拼接'], ['照片內容', '紅色箭頭是人工標記；疑似暗線不判定為裂紋']],
  assumptions: Object.entries(PARAMS).filter(([, d]) => d.src !== 'catalog' && d.src !== 'config').map(([k, d]) => [d.label, p[k] == null ? '待確認' : `${p[k]}${d.unit ? ' ' + d.unit : ''}`, SOURCE[d.src], d.note || '']),
  risks: [['缺陷在明暗場下對比不足，或被圖案繞射淹沒', '高', '打光 POC；評估偏振、波長、角度'], ['規格未知導致倍率、視野、節拍選型錯誤', '高', '先取得晶圓、缺陷規格與節拍'],
    ['GigE 頻寬限制週期', '中', '10GigE／CoaXPress 或線掃描'], ['翹曲超出景深造成大量待複檢', '中', '量測翹曲；增加對焦點或即時自動對焦'],
    ['誤判率高造成複檢負擔', '中', '建立標註資料與允收規格'], ['停穩時間比假設長', '中', '實測平台與基座，調整加減速']],
  poc: ['實拍打光（明場、暗場、偏振、波長）', '尺度校正（標準片）', '缺陷標註（線狀異常、顆粒、其他）', '允收規格與 MSA', '平台停穩與晶圓翹曲量測'],
  decisions: ['晶圓直徑、厚度、產品類型、製程站別、die 尺寸', '最小缺陷、缺陷種類、允收規格、節拍目標', '是否需要自動上下片與實體剔除', '面掃停拍或線掃描；相機介面', 'wafer map 與 MES 輸出格式'],
  boundary: [['晶圓、缺陷規格、節拍', '展示假設（300 mm、10 µm）', '客戶提供'], ['視野、解析度、缺陷像素、景深', 'core/optics 公式（幾何估算）', '鏡頭型錄＋尺度校正'],
    ['位置數、覆蓋率、資料量', '掃描規劃逐點計算', '確定倍率與重疊後重算'], ['整片週期', '時序模型（梯形速度、停穩、緩衝、傳輸）', '平台與相機實測'],
    ['明暗場分類', 'core/optics L2 幾何近似', '打光 POC'], ['晶圓影像、缺陷外觀、檢出結果', '程序產生的模擬影像與示意演算法', '實拍 POC＋標註＋MSA'],
    ['VisionSequence 畫面', '平台介面截圖套用模擬結果的合成圖；晶圓流程尚未在平台實作', '在平台建置晶圓流程']],
  sensitivity: [['本版（1×、GigE）', String(e.positions), String(e.reviewCount), `${r1(e.dataGB)} GB`, `${r1(e.cycle, 0)} s`, `${r1(e.dof * 1000, 0)} µm`],
    ['1×、10GigE', String(fast.positions), String(fast.reviewCount), `${r1(fast.dataGB)} GB`, `${r1(fast.cycle, 0)} s`, `${r1(fast.dof * 1000, 0)} µm`],
    ['2×、GigE', String(mag2.positions), String(mag2.reviewCount), `${r1(mag2.dataGB)} GB`, `${r1(mag2.cycle, 0)} s`, `${r1(mag2.dof * 1000, 0)} µm`],
    ['2×、10GigE', String(mag2f.positions), String(mag2f.reviewCount), `${r1(mag2f.dataGB)} GB`, `${r1(mag2f.cycle, 0)} s`, `${r1(mag2f.dof * 1000, 0)} µm`]],
  sim: simRows,
};
const outDir = join(SITE, 'docs', 'assessment'); mkdirSync(outDir, { recursive: true });
const pptx = join(outDir, `WaferInspection-評估簡報-${data.date.replace(/-/g, '')}.pptx`);
writeFileSync(join(tmp, 'data.json'), JSON.stringify(data));
const r = spawnSync(process.env.VS3D_PYTHON || 'python', ['-I', fileURLToPath(new URL('./proposal_deck.py', import.meta.url)), kit, join(tmp, 'data.json'), pptx], { encoding: 'utf8' });
process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
process.exit(r.status ?? 1);
