// 排程：三種場型各一條時間軸（現況 → 建置 → 聯測 → 全天調度 → 客戶情境；都會型另有模組擴充）。
// 狀態只由時間決定：構件出現方式（rise／drop／pop／lift／show）、吊車吊裝、時鐘對照（動畫秒 → 一天中的時刻）、
// 客戶車輛的腿段與閘門開啟時機都在這裡算好，project.js 的 apply(t) 只取樣。
import { createTimeline } from '@core/anim/track.js';
import { CAR, STALL, chargerPose } from './sites.js';
import { gateGeom } from './lot.js';
import { rounded, makePath } from './paths.js';
import { planInteraction } from './customer-motion.js';

export const STATIONS = {
  flagship: ['現況與測量', '基礎與立柱', '光電車棚', '儲能與配電', '充電樁', '系統聯測', '全天調度', '客戶充電'],
  mixed: ['現況與規劃', '儲能與配電', '充電樁', '系統聯測', '全天調度', '夜泊充電'],
  urban: ['現況與規劃', '模組儲能', '充電樁', '系統聯測', '全天調度', '快充補電', '模組擴充'],
};
const WORK_HOUR = 10.5;          // 施工期間畫面固定在上午 10:30
export const DRIVE = .6;         // 全天調度時充電格進出車的動畫秒數

// 吊車停放位置與堆料點（世界座標，mm；yaw 給 root.rotation.y）
const CRANE = {
  flagship: { scale: 1, boom: 30000, at: [{ x: 0, z: -16000, yaw: 0 }, { x: 34250, z: -2000, yaw: -Math.PI / 2 }], laydown: [[6000, -11000], [34250, 9500]] },
  mixed: { scale: 1, boom: 26000, at: [{ x: 25500, z: 2500, yaw: -Math.PI / 2 }], laydown: [[25500, 12000]] },
  urban: { scale: .7, boom: 16000, at: [{ x: 14500, z: 0, yaw: 0 }], laydown: [[20500, 1500]] },
};

export function createSequence(site, project) {
  const id = site.id, tl = createTimeline(), story = tl.track('story', {});
  const stations = STATIONS[id];
  // 步驟物件的 end 是終點狀態值（Track 用），結束時刻另記在 t1
  const step = (station, dur, action, sub = '', o = {}) => { const s = story.add(dur, {}, { action, sub, station }); Object.assign(s, o, { t1: s.start + s.dur }); return s; };
  const builds = [];          // { key, t0, t1, mode, dy?, until? }
  const lifts = [];           // { key, t0, t1, pick:[x,y,z], target:[x,y,z], clear, top }
  const hourMap = [];         // { t0, t1, h0, h1 }
  const craneMoves = [];      // { t0, t1, from, to }
  const craneShow = [];       // [t0, t1]
  const zones = [];           // 施工封閉的車位：{ t0, t1, test(stall) }
  const build = (key, t0, t1, mode, o = {}) => builds.push({ key, t0, t1, mode, ...o });
  const C = CRANE[id];
  const lift = (key, t0, dur, target, { top, at = 0, clear = 3500, laydown = 0, pickY = target[1] } = {}) => {
    const [lx, lz] = C.laydown[laydown];
    lifts.push({ key, t0, t1: t0 + dur, pick: [lx, pickY, lz], target, clear, top, at: craneAt(t0) });
    build(key, t0, t0 + dur, 'lift');
  };
  // 吊裝時吊車停在哪個位置（旗艦型能源區的吊裝在移車之後）
  const craneAt = t => craneMoves.filter(m => t >= m.t1).reduce((k, m) => m.to, 0);
  const stagger = (n, t0, dur, gap) => Array.from({ length: n }, (_, i) => [t0 + i * gap, t0 + i * gap + dur]);

  // ================================================================ 旗艦型
  if (id === 'flagship') {
    const cp = site.carport, L = site.lot;
    step(0, 3, '既有停車場：入口車辨、繳費機與車流', `旗艦型 ${L.stalls.length} 車位，開闊露天場域`);
    const s1b = step(0, 2.5, '現勘與測量：放樣車棚柱位、儲能區與管線路徑', '照片僅用於空間辨識；車位數、位置與租約待現勘');
    build('stakes', s1b.start, 22, 'show');
    const s1c = step(0, 2.5, '分區圍設：保留車道與消防通道，其他車位照常營業', '施工區：車棚兩排、能源區、DC 充電島');
    build('fence', s1c.start, 64, 'show');
    zones.push({ t0: s1c.start, t1: 64, test: s => s.row === 1 || s.row === 2 || (s.row === 0 && Math.abs(s.x) < 7500) || (s.row === 3 && s.j >= 21) || (s.row === 4 && s.j >= 21) });
    const s2a = step(1, 3, '基礎開挖與澆置（8 處獨立基礎）', '動畫省略地下工程、許可與結構驗算，實際須在工程計畫中完成');
    stagger(8, s2a.start, .8, .3).forEach(([a, b], i) => build(`footing${i}`, a, b, 'rise'));
    craneShow.push([s2a.start, 56]);
    const s2b = step(1, 9, '吊裝鋼柱（跨距 7.5 m，保留車道淨高）', '一次吊一支，吊車停在北側車道');
    cp.cols.forEach((x, i) => lift(`column${i}`, s2b.start + .1 + i * 1.1, 1.05, [x, 300, cp.zLine], { top: cp.colH - 300, clear: 1800, pickY: 300 }));
    const s3a = step(2, 6.5, '吊裝 T 型懸臂樑', '樑頂沿屋面 3° 斜度，模組朝南');
    cp.cols.forEach((x, i) => lift(`beam${i}`, s3a.start + .1 + i * .8, .76, [x, 0, cp.zLine], { top: cp.colH + 360, clear: 1500, pickY: -3200 }));
    const s3b = step(2, 5.5, `光電模組分區裝設（${cp.nx * cp.ny} 片 × ${cp.mod.kw * 1000} Wp ≈ ${cp.kwp} kWp）`, '形成遮陽與發電車棚');
    stagger(cp.bays, s3b.start, 1.2, .6).forEach(([a, b], k) => build(`bay${k}`, a, b, 'drop', { dy: 1800 }));
    const s3c = step(2, 2, '逆變器與直流配線', '');
    build('inverter', s3c.start, s3c.start + .8, 'pop');
    const s4a = step(3, 2.5, '吊車移到能源區', '');
    craneMoves.push({ t0: s4a.start + .2, t1: s4a.start + 2.3, from: 0, to: 1, via: [[34250, -16000]] });
    const s4b = step(3, 2.2, '受電變壓器與低壓配電盤就位', '高壓受電與變壓器依台電供電方式確認');
    lift('transformer', s4b.start + .05, 1.05, [site.transformer.x, 0, site.transformer.z], { top: 2060, laydown: 1, clear: 3000, pickY: 0 });
    lift('msb', s4b.start + 1.1, 1.05, [site.msb.x, 0, site.msb.z], { top: 2200, laydown: 1, clear: 3000, pickY: 0 });
    const s4c = step(3, 3.5, '吊裝儲能櫃 100 kW／215 kWh', '位置隔離、熱失控偵測、維修通路');
    lift('bess0', s4c.start + .2, 3, [site.bess[0].x, 0, site.bess[0].z], { top: 2600, laydown: 1, clear: 3200, pickY: 0 });
    const s4d = step(3, 2, 'EMS 櫃、接地與緊急停止', '');
    build('ems', s4d.start, s4d.start + .8, 'pop');
    const s4e = step(3, 2, '管線：配電盤 → 車棚、充電區、儲能', '');
    build('conduits', s4e.start, s4e.start + 1.6, 'grow');
    const s5a = step(4, 3, 'DC 60 kW × 2 吊裝到充電島', '需求足夠才建 DC 快充');
    site.chargers.filter(c => c.type === 'DC').forEach((c, i) => { const p = chargerPose(site, c); lift(c.id, s5a.start + .1 + i * 1.45, 1.35, [p.x, p.y, p.z], { top: 2050, laydown: 1, clear: 2600, pickY: 0 }); });
    const s5b = step(4, 3, 'AC 7 kW × 8 掛裝在車棚立柱', '月租、購物停留以 AC 慢充為主');
    site.chargers.filter(c => c.type === 'AC').forEach((c, i) => build(c.id, s5b.start + i * .3, s5b.start + i * .3 + .6, 'drop', { dy: 500 }));
    const s5c = step(4, 2, '充電格標線與防撞設施', '');
    build('evPaint', s5c.start, s5c.start + 1, 'appear');
    step(4, 2, '吊車撤場', '');
    const s6a = step(5, 3, '通訊聯測：OCPP、EMS、停車系統', '電表、PCS／BMS、充電交易、車牌與帳單');
    const s6b = step(5, 2.5, '保護、限功率與告警測試', '儲能功率不足或 SOC 偏低時依公告規則降功率');
    const s6c = step(5, 2.5, '拆除圍籬，正式上線', '');
    build('test', s6a.start, s6b.t1, 'show');
    return finish(s6c.t1, [
      [9, '離峰：依隔日需求補充儲能（只補到 35%，白天留空間給光電）', '時段依各站適用的台電方案設定，圖示不代表統一費率'],
      [4.5, '日出：光電開始供電，早班車主接上 AC', ''],
      [10.5, '白天：光電優先供負載，剩餘電力充儲能', '光電剩餘依策略輸出或限發'],
      [9, '尖峰：儲能放電削峰，DC 快充照常服務', '需量峰值由儲能壓低'],
      [3, '夜間：恢復離峰，結算當日', ''],
    ], 'DC2');
  }

  // ================================================================ 住商型
  if (id === 'mixed') {
    const L = site.lot;
    step(0, 3, `既有停車場：住商周邊平面場域（${L.stalls.length} 車位）`, '照片僅用於空間辨識；車位數、位置與租約待現勘');
    const s1b = step(0, 3, '現勘：夜泊需求、噪音與儲能隔離空間；分區圍設', '儲能放在遠離住宅的東南角');
    build('stakes', s1b.start, 12, 'show');
    build('fence', s1b.start + 1, 34, 'show');
    zones.push({ t0: s1b.start + 1, t1: 34, test: s => (s.row === 0 && s.j >= 3 && s.j <= 14) || s.j >= 16 });
    craneShow.push([s1b.t1, 28]);
    const s2a = step(1, 2, '能源區基礎與隔音牆', '');
    build('bessPad', s2a.start, s2a.start + 1.2, 'rise');
    build('noise', s2a.start + .6, s2a.t1, 'rise');
    const s2b = step(1, 2, '低壓配電盤與電表箱就位', '');
    lift('msb', s2b.start + .1, 1.7, [site.msb.x, 0, site.msb.z], { top: 2050, clear: 3200, pickY: 0 });
    const s2c = step(1, 3.5, '吊裝儲能櫃 50 kW／100 kWh', '位置隔離、熱失控偵測、維修通路');
    lift('bess0', s2c.start + .2, 3, [site.bess[0].x, 0, site.bess[0].z], { top: 2500, clear: 3200, pickY: 0 });
    const s2d = step(1, 2, 'EMS 櫃、接地與緊急停止', '');
    build('ems', s2d.start, s2d.start + .8, 'pop');
    const s2e = step(1, 2.5, '管線：配電盤 → 北排充電格（住戶夜泊）', '');
    build('conduits', s2e.start, s2e.start + 2, 'grow');
    const s3a = step(2, 4, 'AC 7 kW × 10 立柱式充電樁（北排）', '夜泊 AC 為主');
    site.chargers.forEach((c, i) => build(c.id, s3a.start + i * .3, s3a.start + i * .3 + .7, 'rise'));
    const s3b = step(2, 2.5, 'DC 預留：管線與基座（依需求評估）', '先不建 DC，保留擴充彈性');
    build('reserve', s3b.start, s3b.start + 1, 'rise');
    const s3c = step(2, 2.5, '充電格標線、吊車撤場', '');
    build('evPaint', s3c.start, s3c.start + 1, 'appear');
    const s4a = step(3, 3, '通訊聯測：OCPP、EMS、停車系統', '月租會員與充電方案綁定');
    const s4b = step(3, 3, '限功率與告警測試，拆除圍籬上線', '');
    build('test', s4a.start, s4b.t1 - .5, 'show');
    return finish(s4b.t1, [
      [9, '離峰：夜泊住戶 AC 直接用離峰電，剩餘容量補儲能', '夜泊直充不經儲能，避免往返損耗'],
      [4.5, '清晨：住戶陸續離場，儲能已補滿', ''],
      [10.5, '日間：購物洽公車輛充電，儲能削峰', '依預測車流安排放電'],
      [9, '尖峰：儲能供電並限制契約需量', ''],
      [3, '22:00 起：住戶排程離峰直充（不經儲能）', 'EMS 依離場時間錯開起充，不超過契約容量'],
    ], 'AC5');
  }

  // ================================================================ 都會型
  const L = site.lot;
  step(0, 3, `既有停車場：狹長入口、車道受限（${L.stalls.length} 車位）`, '照片僅用於空間辨識；車位數、位置與租約待現勘');
  const s1b = step(0, 3, '現勘：保留通行與消防空間，確認設備占地與逃生動線', '設備集中在東端角落');
  build('stakes', s1b.start, 12, 'show');
  build('fence', s1b.start + 1, 31, 'show');
  const zone = s => s.j >= 9;
  zones.push({ t0: s1b.start + 1, t1: 31, test: zone });
  craneShow.push([s1b.t1, 25]);
  const s2a = step(1, 2, '設備區基礎與護欄', '小占地：一格車位寬的設備區');
  build('bessPad', s2a.start, s2a.start + 1.2, 'rise');
  const s2b = step(1, 2, '配電盤就位', '');
  lift('msb', s2b.start + .1, 1.7, [site.msb.x, 0, site.msb.z], { top: 1950, clear: 2600, pickY: 0 });
  const s2c = step(1, 3, '吊裝模組儲能 30 kW／64 kWh', '小型吊車經狹長入口進場');
  lift('bess0', s2c.start + .2, 2.6, [site.bess[0].x, 0, site.bess[0].z], { top: 2300, clear: 2800, pickY: 0 });
  const s2d = step(1, 2, 'EMS、接地與緊急停止', '');
  build('ems', s2d.start, s2d.start + .8, 'pop');
  const s2e = step(1, 2, '管線：設備區 → 充電格', '');
  build('conduits', s2e.start, s2e.start + 1.6, 'grow', { only: c => !c.expand });
  const s3a = step(2, 3, 'DC 40 kW × 2 壁掛式（北側）', '短停補電：適量 DC');
  site.chargers.filter(c => c.type === 'DC' && !c.expand).forEach((c, i) => build(c.id, s3a.start + i * .6, s3a.start + i * .6 + .9, 'drop', { dy: 900 }));
  const s3b = step(2, 2.5, 'AC 7 kW × 2（南側）', '少量 AC');
  site.chargers.filter(c => c.type === 'AC').forEach((c, i) => build(c.id, s3b.start + i * .5, s3b.start + i * .5 + .8, 'rise'));
  const s3c = step(2, 2.5, '充電格標線、吊車撤場', '');
  build('evPaint', s3c.start, s3c.start + 1, 'appear');
  const s4a = step(3, 3, '通訊聯測：OCPP、EMS、停車系統', '');
  const s4b = step(3, 3, '限功率與告警測試，上線', '');
  build('test', s4a.start, s4b.t1 - .5, 'show');
  const end = finish(s4b.t1, [
    [10.5, '離峰：補充儲能到 90%', ''],
    [13.5, '日間：短停補電為主，兩支 DC 同時使用時儲能補足', ''],
    [9, '尖峰：儲能供電；SOC 偏低時依公告降低充電功率', '不承諾所有車位同時滿載'],
    [3, '夜間：離峰補充儲能', ''],
  ], 'DC2', true);
  // ---- 模組擴充
  const x0 = story.t;
  const e1 = step(6, 2, '使用率提高：決定擴充', '依上線 90 天的充電量、時段與限功率紀錄');
  craneShow.push([e1.start + .5, e1.start + 7.5]);
  zones.push({ t0: e1.start + .5, t1: e1.start + 9.5, test: zone });
  build('fence2', e1.start + .3, e1.start + 9.5, 'show');
  const e2 = step(6, 3.5, '加裝第二組模組儲能（30 kW／64 kWh）', '標準模組：儲能櫃、控制盤、通訊介面');
  lift('bess1', e2.start + .2, 3, [site.bess[1].x, 0, site.bess[1].z], { top: 2300, clear: 2800, pickY: 0 });
  const e3 = step(6, 2.5, '增設 DC 40 kW × 1、契約容量檢討為 75 kW（假設）', '');
  const dc3 = site.chargers.find(c => c.expand);
  build(dc3.id, e3.start + .2, e3.start + 1.2, 'drop', { dy: 900 });
  build('conduitsX', e3.start + .8, e3.start + 2.2, 'grow', { only: c => c.expand });
  build('evPaintX', e3.start + 1.5, e3.start + 2.5, 'appear');
  const e4 = step(6, 2, '聯測上線', '');
  const e5 = step(6, 12, '擴充後尖峰（17:00–21:00）：不再限功率', '比較儲能擴充與直接智慧充電，依需求決定');
  hourMap.push({ t0: e5.start, t1: e5.t1, h0: 17, h1: 21, expanded: true });
  return { ...end, expandT: e2.start, total: tl.total };

  // ---------------------------------------------------------------- 全天調度＋客戶情境（三種場型共用）
  function finish(opStart, dayPlan, heroCh, keepGoing = false) {
    const st = stations.length - (id === 'urban' ? 3 : 2);
    let t = opStart, h = 0;
    const dayStart = t;
    for (const [dur, action, sub] of dayPlan) {
      const span = dur / 1.5;      // 1.5 s／h
      step(st, dur, action, sub);
      hourMap.push({ t0: t, t1: t + dur, h0: h, h1: h + span });
      t += dur; h += span;
    }
    const dayEnd = t;
    const hero = heroPlan(site, heroCh, st + 1, step, hourMap);
    return { tl, stations, builds, lifts, hourMap, craneMoves, craneShow, zones, crane: C, opStart, dayStart, dayEnd, hero, total: keepGoing ? null : tl.total, events: tl.events, stationStart: tl.stationStart };
  }
}

// ---------------------------------------------------------------- 客戶車輛：進場 → 停妥 → 插槍 → 充電 → 拔槍 → 倒車 → 結算離場
function heroPlan(site, chId, station, step, hourMap) {
  const E = site.entrance, G = gateGeom(site), ch = site.chargers.find(c => c.id === chId), S = ch.stall;
  const zs = site.street.z0 + 2200, aZ = S.aisleZ, half = CAR.len / 2;
  const R = 4500;
  const inPath = makePath(rounded([[G.xIn + 26000, zs], [G.xIn, zs], [G.xIn, aZ], [S.x, aZ], [S.x, S.z]], R));
  const back = S.x + 5000 <= site.lot.east.x1 - 1500 ? 5000 : -5000;
  const revPath = makePath(rounded([[S.x, S.z], [S.x, aZ], [S.x + back, aZ]], 4000), { reverse: true });
  const outPath = makePath(rounded([[S.x + back, aZ], [G.xOut, aZ], [G.xOut, zs], [G.xOut - 30000, zs]], R));
  const sStopIn = inPath.crossing('z', G.armIn + 800 + half), sPassIn = inPath.crossing('z', G.armIn - half - 400);
  const sStopOut = outPath.crossing('z', G.armOut - 800 - half), sPassOut = outPath.crossing('z', G.armOut + half + 400);
  const night = site.id === 'mixed';
  const T = {
    flagship: { h: [13.86, 13.9, 13.92, 14.58, 14.62, 14.66], text: ['進場：車牌辨識、柵欄開啟', '導引至 DC 快充格停妥', '插槍、確認費率並授權', '充電中：光電＋儲能供電，EMS 動態分配功率', '充電完成、拔槍', '倒車出格', '停車＋充電一次結算，離場'], d: [3.8, 6, 2, 9, 1.5, 2, 6.5] },
    mixed: { h: [18.94, 19, 19.05, 22, 31.2, 31.4, 31.5], text: ['19:00 住戶返家：車牌辨識進場', '停入北排 AC 充電格', '插槍：排程 22:00 離峰開始（月租＋充電方案）', '等待離峰（琥珀燈）', '22:00 起離峰直充，充滿後待機', '隔日 07:30 拔槍、倒車出格', '月結帳單含充電明細，離場'], d: [3.8, 5, 2, 3.5, 7, 2.5, 5.5] },
    urban: { h: [17.55, 17.6, 17.62, 18.2, 18.23, 18.28], text: ['17:35 進場：狹長入口單車道通行，車牌辨識', '停入 DC 快充格', '插槍授權，顯示費率', '尖峰快充：儲能供電，SOC 偏低時動態限功率', '充電完成、拔槍', '倒車出格', '結算離場'], d: [3.8, 4.5, 2, 8, 1.5, 2, 6.5] },
  }[site.id];
  const subs = { flagship: ['', '停車場既有車流就是充電服務入口', '插槍不一定自動啟動，需顯示價格確認與啟動成功', '', '', '', '帳單整合充電明細'], mixed: ['', '', '夜泊 AC 直接用離峰電，不經儲能', '', '', '', ''], urban: ['', '', '', '', '', '', ''] }[site.id];
  const interaction = planInteraction(site,ch);
  T.d[2] = interaction.connectDuration;
  T.d[night ? 5 : 4] = interaction.leaveDuration + (night ? 3 : 0);
  if(!night)T.d[5]=3;
  const s = T.text.map((a, i) => step(station, T.d[i], a, subs[i] || ''));
  // 時鐘：進場與停妥 h0→h1；插槍 h1→h2；（住商：等待 h2→h3）充電 → 拔槍 → 離場
  const H = T.h, last = s.at(-1);
  if (night) {
    hourMap.push({ t0: s[0].start, t1: s[1].t1, h0: H[0], h1: H[1] }, { t0: s[2].start, t1: s[2].t1, h0: H[1], h1: H[2] },
      { t0: s[3].start, t1: s[3].t1, h0: H[2], h1: H[3] }, { t0: s[4].start, t1: s[4].t1, h0: H[3], h1: H[4] },
      { t0: s[5].start, t1: s[5].t1, h0: H[4], h1: H[5] }, { t0: s[6].start, t1: s[6].t1, h0: H[5], h1: H[6] });
  } else {
    hourMap.push({ t0: s[0].start, t1: s[1].t1, h0: H[0], h1: H[1] }, { t0: s[2].start, t1: s[2].t1, h0: H[1], h1: H[2] },
      { t0: s[3].start, t1: s[3].t1, h0: H[2], h1: H[3] }, { t0: s[4].start, t1: s[4].t1, h0: H[3], h1: H[4] },
      { t0: s[5].start, t1: last.t1, h0: H[4], h1: H[5] });
  }
  const iCharge = night ? 4 : 3, iUnplug = night ? 5 : 4, iRev = night ? 5 : 5;
  const tStop = s[0].start + 2.6, tGo = s[0].t1, tPark = s[1].t1;
  const leaveStart=s[iUnplug].start;
  const plugT = s[2].start + interaction.plugOffset, unplugT = leaveStart + interaction.unplugOffset;
  const revT0 = night ? s[5].start + interaction.leaveDuration : s[5].start, revT1 = s[5].t1;
  const g = last, tOutStop = g.start + (night ? 3 : 3.8), tOutGo = tOutStop + (night ? .9 : 1);
  const legs = [
    { path: inPath, t0: s[0].start, t1: tStop, s0: 0, s1: sStopIn, ease: u => 1 - (1 - u) ** 2 },
    { path: inPath, t0: tGo, t1: tPark, s0: sStopIn, s1: inPath.length },
    { path: revPath, t0: revT0, t1: revT1 },
    { path: outPath, t0: g.start, t1: tOutStop, s0: 0, s1: sStopOut },
    { path: outPath, t0: tOutGo, t1: g.t1, s0: sStopOut, s1: outPath.length, ease: u => u * u },
  ];
  // 閘門：停車等候時開啟；車尾通過閘桿後關閉（以取樣找出通過時刻）
  const passTime = (leg, sPass) => { for (let k = 0; k <= 400; k++) { const tt = leg.t0 + (leg.t1 - leg.t0) * k / 400, u = k / 400, e = (leg.ease || (x => x < .5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2))(u); if (leg.s0 + (leg.s1 - leg.s0) * e >= sPass) return tt; } return leg.t1; };
  const inPass = passTime(legs[1], sPassIn), outPass = passTime(legs[4], sPassOut);
  const gates = {
    entry: { open: [tStop + .25, tStop + 1.05], close: [inPass + .2, inPass + 1] },
    exit: { open: [tOutStop + .2, tOutStop + .85], close: [outPass + .2, outPass + 1] },
    lprIn: [tStop - .1, tStop + .35], lprOut: [tOutStop - .1, tOutStop + .3],
  };
  return { ch, chId, legs, gates, plugT, unplugT, leaveStart, interaction, chargeStep: s[iCharge], steps: s, t0: s[0].start, t1: last.t1, tPark, night, hours: H, revT0 };
}

// 動畫秒 → 一天中的時刻（h；施工期固定 10:30；超過 24 表示隔天）
export function hourAt(seq, t) {
  const m = seq.hourMap;
  if (!m.length || t < m[0].t0) return WORK_HOUR;
  for (let i = 0; i < m.length; i++) {
    const a = m[i];
    if (t < a.t0) return m[i - 1].h1;
    if (t <= a.t1) return a.h0 + (a.h1 - a.h0) * (a.t1 > a.t0 ? (t - a.t0) / (a.t1 - a.t0) : 1);
  }
  return m.at(-1).h1;
}
// 目前的時鐘區段與某時刻 h 在該區段對應的動畫秒（給進出車的動畫）
export function segmentAt(seq, t) { return seq.hourMap.find(a => t >= a.t0 && t <= a.t1) || null; }
export const timeOfHour = (seg, h) => seg.h1 === seg.h0 ? seg.t0 : seg.t0 + (h - seg.h0) / (seg.h1 - seg.h0) * (seg.t1 - seg.t0);
export { STALL };
