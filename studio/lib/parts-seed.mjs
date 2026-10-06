// 從各站既有的成本表（project-site/<專案>/docs/*.xlsx 的明細／品項表）匯入元件資料庫：vs3d parts seed。
// 只匯入採購品項（硬體與授權）：工程人日、工程類的列、純自製的「一式」項目不匯入（2026-10-05 拍板）。
// 每一列成本表變成一筆使用紀錄（專案、來源檔、編號），所以可以重複執行：已經匯入過的列會跳過，介面上改過的內容不會被蓋掉。
// 同名同選型的列併成同一個元件；品項表「對應成本表」欄指到的列、規格寫「同 X-01」的列也併到那個元件。
// 類別與廠牌是從文字猜的，匯入後可以在介面上修正。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readZip, xlsxSheets } from './office.mjs';
import { REPO } from './util.mjs';

// 表頭 → 欄位（各站成本表的表頭用字不完全相同）
const COLUMNS = {
  code: /^編號$/, subsystem: /^子系統$/, group: /^類別$/, name: /^(項目|品項)$/, spec: /^(功能需求／)?規格(要求)?$/, model: /^(主選型號|建議選型)/,
  reason: /^選型理由/, remark: /^(說明|備註)$/, alt: /^替代方案$/, qty: /^數量$/, qtyTotal: /^數量合計$/, unit: /^單位$/, price: /^單價/, usd: /USD/,
  grade: /^(等級|分級|信心)$/, basis: /依據$/, kind: /^(性質|範圍)$/, xref: /^對應成本表$/, part: /^部分$/,
};
const QTY_PARTS = /站$|共用$/;      // 品項表的分站數量欄（數量合計是公式，沒有快取值時用這幾欄加總）

// 廠牌：出現在名稱或選型文字裡就記下來（第一個當主要廠牌）
const BRANDS = [
  ['DENSO', /DENSO|COBOTTA|RC8A|WINCAPS/i], ['ABB', /\bABB\b|RobotWare|RobotStudio|PickMaster|OmniCore/i], ['Keyence', /Keyence|\bKV-|\bCL-\d|\bGC-1000|\bVT\d|SR-X/i],
  ['SMC', /\bSMC\b/], ['IDS', /\bIDS\b/], ['Basler', /Basler/i], ['HIKROBOT', /HIKROBOT/i], ['HIWIN', /HIWIN|上銀/i], ['ATI', /\bATI\b/], ['LMI', /\bLMI\b|Gocator/i],
  ['Bosch Rexroth', /Rexroth/i], ['CCS', /\bCCS\b/], ['OPT', /\bOPT\b/], ['Opto Engineering', /Opto Engineering/i], ['Asyril', /Asyril/i], ['OnRobot', /OnRobot/i],
  ['Advantech', /Advantech|研華/i], ['Moxa', /Moxa/i], ['Synology', /Synology/i], ['IDEC', /\bIDEC\b/], ['Patlite', /Patlite/i], ['Balluff', /Balluff/i], ['Axelent', /Axelent/i],
  ['MEAN WELL', /明緯|MEAN WELL/i], ['NVIDIA', /Jetson|NVIDIA|\bRTX\b/i], ['Intel', /\bIntel\b/], ['Micro-Epsilon', /induSENSOR|Micro-Epsilon/i], ['DH-Robotics', /\bDH\b/],
  ['Mettler Toledo', /Mettler|\bMT\b/i], ['Festo', /Festo/i], ['Omron', /Omron/i], ['Mitsubishi', /Mitsubishi|三菱/i], ['Panasonic', /Panasonic/i], ['THK', /\bTHK\b/], ['IAI', /\bIAI\b/],
  ['Cognex', /Cognex/i], ['Schunk', /Schunk/i], ['Robotiq', /Robotiq/i], ['Siemens', /Siemens/i], ['Beckhoff', /Beckhoff/i],
  ['Metrohm', /Metrohm/i], ['Sartorius', /Sartorius/i], ['Renishaw', /Renishaw/i], ['SICK', /\bSICK\b/], ['MVTec', /HALCON|MVTec/i],
];
// 類別：中文的中心語在後面，所以取名稱第一段裡「結束位置最後面」的那個關鍵字
const CATEGORIES = [
  ['軟體與授權', /授權|軟體|選項|SDK|作業系統|RobotStudio|PickMaster|WINCAPS|MES/i],
  ['機器人', /手臂|SCARA|機器人|COBOTTA|教導器/i],
  ['夾爪與末端工具', /夾爪|吸嘴|吸盤|夾頭|末端工具|工具板|快換|軟指|夾指|手指|夾墊|壓墊|壓條|壓頭/],
  ['相機與讀碼', /相機|攝影機|讀碼器|輪廓儀|取像/],
  ['鏡頭與光學', /鏡頭|偏光鏡|保護鏡|濾鏡/],
  ['光源', /光源(控制器)?|背光|環形光|條光|穹頂光|同軸光|打光/],
  ['安全', /安全(控制器|輸入擴充單元)?|急停(按鈕)?|門鎖|圍籬|光柵/],
  ['實驗室儀器', /滴定(儀主機)?|進樣器|移液|Dosino|tiamo|天平|電極|純水|廢液/i],
  ['量測與感測', /共焦|位移計|荷重元|力覺|感測器|材質感測|編碼器|深度計|RFID|量測輪|測厚|光學尺|檢知/],
  ['運動與驅動', /馬達|伺服|滑台|滑軌|螺桿|驅動|[XYZRθ] ?軸|旋轉軸|旋轉平台|θ 平台|減速|變頻|升降|傳動|龍門|移動台/],
  ['氣動與真空', /氣缸|電磁閥|閥島|真空|氣源|調壓|氣管|離子風|氣動/],
  ['控制器與 I/O', /PLC|I\/O|HMI|控制器|觸控|三色燈|蜂鳴|燈號|按鈕|操作盒|擴充板|運動單元|主站|觸發介面/],
  ['電腦與網路', /電腦|主機|工控機|工作站|交換器|路由器|網卡|NAS|儲存|硬碟|暫存碟|螢幕|鍵盤|KVM/],
  ['電力與配電', /電源|不斷電|UPS|電控|配電|盤內/],
  ['線材與耗材', /線材|網路線|電纜|纜線|跳線|延長線|耗材|走線|GPIO 線|I\/O 線|管線|配線$/],
  ['輸送與供料', /輸送|供料|料盤|吸塑盤|托盤|載具|堆料|抽屜|梭台|頂升|料斗|推.*機構/],
  ['校正與標準件', /校正(治具)?|標定|標準|環規|量塊/],
  ['機構與結構', /機台|外罩|框架|支架|立柱|底櫃|底座|實驗桌|花崗岩|門型架|防塵罩|遮光|治具|護罩|座$|橋板|結構/],
  ['服務', /技術支援|服務|顧問|運輸|安裝$|驗證$/],
];

const norm = s => String(s || '').toLowerCase().replace(/[\s　]+/g, '');
const num = v => { const n = Number(String(v ?? '').replace(/,/g, '')); return v === '' || v == null || !Number.isFinite(n) ? null : n; };
const blankModel = m => !m || /^[—\-–]+$/.test(m);

export function guessCategory(name, extra = '') {
  // head：取結束位置最後面的關鍵字（同位置時表列在前的優先）；否則取最先出現的
  const pick = (s, head) => {
    let best = null;
    for (const [cat, re] of CATEGORIES) for (const m of s.matchAll(new RegExp(re.source, re.flags + 'g'))) {
      const at = head ? m.index + m[0].length : -m.index;
      if (!best || at > best.at) best = { cat, at };
    }
    return best?.cat;
  };
  const first = String(name).split(/[＋+與、＆&]/)[0];
  return pick(first, true) || pick(String(name), true) || pick(String(extra), false) || '';
}
export const guessBrands = s => BRANDS.filter(([, re]) => re.test(s)).map(([b]) => b);

// 純自製的「一式」：選型只寫自製（沒有搭配外購件）
const pureCustomLot = r => r.unit === '式' && /^自製/.test(r.model) && !/[＋+]/.test(r.model);
export function skipReason(r) {
  if (!r.code || !r.name) return '空白列';
  if (r.unit === '人日') return '工程人日';
  if (r.kind === '工程' || /工程/.test(r.subsystem)) return '工程類';
  if (pureCustomLot(r)) return '純自製一式';
  return null;
}

// 讀一個成本表 xlsx：找表頭有「編號、單位、項目或品項」的工作表，回傳各列（文字欄位已去空白）
export function readCostSheet(file) {
  const out = [];
  for (const sh of xlsxSheets(readZip(readFileSync(file)))) {
    if (!sh.rows) continue;
    const hi = sh.rows.findIndex(r => String(r.cells[0] ?? '').trim() === '編號');
    if (hi < 0) continue;
    const head = sh.rows[hi].cells.map(c => String(c ?? '').trim()), col = {};
    for (const [k, re] of Object.entries(COLUMNS)) { const i = head.findIndex(h => re.test(h)); if (i >= 0) col[k] = i; }
    if (col.unit == null || col.name == null) continue;
    const qtyParts = head.map((h, i) => QTY_PARTS.test(h) ? i : -1).filter(i => i >= 0);
    for (const row of sh.rows.slice(hi + 1)) {
      const cell = k => col[k] == null ? '' : String(row.cells[col[k]] ?? '').trim();
      let qty = num(cell('qty') || cell('qtyTotal'));
      if (qty == null && qtyParts.length) qty = qtyParts.reduce((a, i) => a + (num(row.cells[i]) || 0), 0);
      out.push({
        sheet: sh.name, code: cell('code'), subsystem: cell('subsystem') || (/\D/.test(cell('group')) ? cell('group') : ''), name: cell('name'), spec: cell('spec'), model: cell('model'),
        reason: cell('reason'), remark: cell('remark'), alt: cell('alt'), qty, unit: cell('unit'), price: num(cell('price')), usd: num(cell('usd')),
        grade: cell('grade').toUpperCase().match(/^[ABC]$/)?.[0] || '', basis: cell('basis'), kind: cell('kind'), xref: cell('xref'), part: cell('part'),
      });
    }
  }
  return out;
}

// 掃描本庫各站 docs/ 的成本表：[{ project, source, date, rows }]
export function collectCostTables(repo = REPO) {
  const root = join(repo, 'project-site'), out = [];
  if (!existsSync(root)) return out;
  for (const project of readdirSync(root).sort()) {
    const docs = join(root, project, 'docs');
    if (!existsSync(docs) || !statSync(docs).isDirectory()) continue;
    for (const f of readdirSync(docs).filter(n => /\.xlsx$/i.test(n) && !n.startsWith('~$')).sort()) {
      let rows; try { rows = readCostSheet(join(docs, f)); } catch { continue; }
      if (rows.length) out.push({ project, source: f, date: statSync(join(docs, f)).mtime.toLocaleDateString('sv'), rows });
    }
  }
  return out;
}

// names：不得顯示的用戶名稱，匯入的文字裡出現就換成「（用戶）」
export function seedFromCostTables(db, tables, { names = [], dryRun = false } = {}) {
  const mask = s => names.reduce((t, n) => n ? t.split(n).join('（用戶）') : t, s);
  const report = { tables: [], parts: 0, merged: 0, prices: 0, usages: 0, existing: 0, skipped: {} };
  const byKey = new Map(), byCode = new Map();      // 同名同選型 → 元件；專案＋編號 → 元件（給「對應成本表」「同 X-01」用）
  // 沒有對應欄的表先匯（成本表），有對應欄的後匯（品項表），對應才找得到
  const ordered = [...tables].sort((a, b) => a.rows.some(r => r.xref) - b.rows.some(r => r.xref));
  const work = () => {
    for (const t of ordered) {
      const stat = { project: t.project, source: t.source, rows: t.rows.length, imported: 0, existing: 0, skipped: 0 };
      report.tables.push(stat);
      for (const raw of t.rows) {
        const r = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? mask(v) : v]));
        const why = skipReason(r);
        if (why) { report.skipped[why] = (report.skipped[why] || 0) + 1; stat.skipped++; continue; }
        const known = db.findUsage(t.project, t.source, r.code);
        if (known) { byCode.set(`${t.project}|${r.code}`, known.part_id); byKey.set(`${norm(r.name)}|${norm(r.model)}`, known.part_id); report.existing++; stat.existing++; continue; }
        const same = `${r.spec} ${r.model}`.match(/同 ?([A-Z]{0,2}-?\d{1,2}-?\d{2})/)?.[1];
        const key = `${norm(r.name)}|${norm(r.model)}`;
        let partId = (/^\S+-\d+$/.test(r.xref) && byCode.get(`${t.project}|${r.xref}`)) || (same && byCode.get(`${t.project}|${same}`)) || byKey.get(key);
        const optional = r.qty === 0 || /選配/.test(`${r.kind}${r.subsystem}`);
        if (partId) report.merged++;
        else {
          const brands = guessBrands(`${r.name} ${r.model}`);
          partId = db.createPart({
            category: guessCategory(r.name, `${r.model} ${r.spec}`), name: r.name, brand: brands[0] || '', model: blankModel(r.model) ? '' : r.model, spec: r.spec, unit: r.unit,
            alternatives: /^同規格替代品/.test(r.alt) ? '' : r.alt, tags: [/^自製/.test(r.model) ? '自製' : '', ...brands.slice(1)].filter(Boolean).join(', '),
          }, { createCategory: true }).id;      // 猜出來的類別在分類樹裡還沒有就建立
          report.parts++;
        }
        byKey.set(key, partId); byCode.set(`${t.project}|${r.code}`, partId);
        db.addUsage(partId, { project: t.project, source: t.source, item_code: r.code, subsystem: r.subsystem, qty: r.qty, reason: [r.reason, r.remark].filter(x => x && !/^依目前機構／流程配置/.test(x)).join('；'), note: optional ? '選配' : '' });
        report.usages++; stat.imported++;
        const price = r.price ?? r.usd, currency = r.price != null ? 'TWD' : 'USD', source = `${t.project} ${t.source} ${r.code}`;
        if (price != null && !db.getPart(partId).prices.some(x => x.unit_price === price && x.currency === currency && x.source.startsWith(`${t.project} `))) {
          db.addPrice(partId, { unit_price: price, currency, grade: r.grade, quoted_on: t.date, source, note: [r.basis, r.price != null && r.usd != null ? `參考價 USD ${r.usd}` : ''].filter(Boolean).join('；') });
          report.prices++;
        }
      }
    }
  };
  // 試跑：整批做完再復原，只留下統計
  const UNDO = new Error('dry-run');
  try { db.tx(() => { work(); if (dryRun) throw UNDO; }); } catch (e) { if (e !== UNDO) throw e; }
  return report;
}
