// 動畫排程（createStepSequence）：單件從上料到品質回饋（計畫書附錄 A 的 14 個分鏡，合併成 8 站）。任一時刻的狀態只由時間決定。
//   S1 上料（作業員把產品裝上轉接頭、推入抽屜）→ S2 取件辨識（快換器對接、讀轉接頭 ID）→ S3 3D 快掃對位（料號辨識＋ICP）
//   → S4 產品檔（由 CAD 自動生成：A/B 面、遮罩、視角、路徑；離線產生，這裡展示內容）→ S5 多姿態取像（偏折術＋擴散白光）
//   → S6 判定（候選 → AI 分類 → 依 A/B 面查規則庫）→ S7 送回與輸出（另一工位的下一件已就緒）→ S8 品質回饋（3D 熱圖、柏拉圖）
// 狀態鍵：
//   q 手臂關節角（rad，逐軸插值）；直線段 step.lin 記起訖工具位姿，apply 時沿直線追蹤
//   adL 左轉接頭在哪：nest／robot（步驟結束才換手）；prodL 左產品：hand／adapter／out；mountL 上料進度、outL 下料進度（0～1）
//   dL dR 抽屜拉出量（0～1）；lampL lampR 工位燈；gripL 內撐撐開（0～1）；lock 快換器鎖定
//   reader 讀碼光束；scan 掃描光；cloud 點雲進度；twin 數位空間模式；icp、plan、judge、heat 數位空間進度；cov 已取像的姿態數
//   pose 正在取像的姿態（1 起算，0＝無）；verdict 總判定（''／OK／NG）
import * as THREE from 'three';
import { createStepSequence } from '@core/anim/sequence.js';
import { nestTool, scanPose } from './poses.js';
import { OPTICS } from './layout.js';

export const STATIONS = ['上料', '取件辨識', '3D 快掃對位', '產品檔', '多姿態取像', '判定', '送回輸出', '品質回饋'];
const DISCRETE = ['lampL', 'lampR', 'reader', 'scan', 'twin', 'pose', 'verdict', 'tower'];
const LATCH = ['adL', 'prodL', 'lock'];          // 快換器鎖定與轉接頭換手同時（步驟結束）
export const CAPTURE = OPTICS.capture.fringe * OPTICS.capture.steps + OPTICS.capture.white;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export function createSequence(robot, prod, verdict) {
  const kind = prod.adapter, anchor = V(...prod.anchor);
  const tp = (quat, pos) => robot.toolPoseFor(kind, quat, pos);
  const NEST = nestTool(kind, 'L', 0), NEST_R = nestTool(prod.adapter, 'R', 0);
  const shift = (p, d) => ({ quat: p.quat.clone(), origin: p.origin.clone().add(V(...d)) });
  const PRE = shift(NEST, [0, 0, -150]), LIFT = shift(NEST, [0, 22, 0]), BACK = shift(NEST, [0, 22, -190]);
  const PRE_R = shift(NEST_R, [0, 0, -150]);
  const sp = scanPose(anchor, 0), SCAN0 = tp(sp.quat, sp.pos), sp2 = scanPose(anchor, Math.PI), SCAN1 = tp(sp2.quat, sp2.pos);
  const VIEWS = prod.file.views.map(v => tp(new THREE.Quaternion(...v.quat), V(...v.pos)));
  const deg2rad = d => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v * Math.PI / 180]));

  // 起始姿態：手臂在左工位抽屜後方的等待位
  const HOME = robot.solve(shift(PRE, [0, 160, -120])).q;
  const base = {
    q: HOME, adL: 'nest', prodL: 'hand', mountL: 0, outL: 0, dL: 1, dR: 0, lampL: 'off', lampR: 'green', gripL: 0, lock: 0,
    reader: 0, scan: 0, cloud: 0, twin: 'off', icp: 0, plan: 0, judge: 0, heat: 0, cov: 0, pose: 0, verdict: '', tower: 'yellow',
  };
  const seq = createStepSequence({ base, discrete: DISCRETE, latch: LATCH, nested: true, stations: STATIONS });
  let q = HOME, pose = null;
  const poses = [];
  const ptpTime = (a, b) => Math.max(.6, robot.jointTime(a, b) * 1.875);
  function ptp(st, to, action, sub = '', values = {}, ref = null) {
    const r = robot.solve(to, ref || q), dur = +ptpTime(q, r.q).toFixed(2);
    poses.push({ action, pose: to, err: r.err, ok: r.ok });
    const s = seq.add(st, dur, action, sub, { q: r.q, ...values }, { robot: 'ptp' });
    q = r.q; pose = to; return s;
  }
  function lin(st, to, speed, action, sub = '', values = {}) {
    const r = robot.solve(to, q), dur = +Math.max(.4, pose.origin.distanceTo(to.origin) / speed * 1.875).toFixed(2);
    poses.push({ action, pose: to, err: r.err, ok: r.ok });
    const s = seq.add(st, dur, action, sub, { q: r.q, ...values }, { robot: 'lin', lin: { from: pose, to, q0: q } });
    q = r.q; pose = to; return s;
  }
  const hold = (st, dur, action, sub = '', values = {}, extra = {}) => seq.add(st, dur, action, sub, values, extra);
  pose = shift(PRE, [0, 160, -120]);

  // ---------------------------------------------------------------- S1 上料（作業員；與檢測並行，不計 CT）
  hold(0, 1.2, '待機：左工位抽屜已拉出', '右工位已有下一件（工位燈綠）；左工位空的轉接頭在定位座上', {});
  hold(0, 2.4, `作業員把${prod.name}套上${kind === 'mandrel' ? '內撐式' : '筒夾式'}轉接頭`, kind === 'mandrel' ? '心軸穿過底環、定向鍵對準鍵槽' : '接管端插入筒夾 30 mm', { mountL: 1, prodL: 'adapter' });
  hold(0, .8, kind === 'mandrel' ? '轉接頭撐開固定' : '筒夾鎖緊', '轉接頭依夾持介面分 3～4 種，不依料號；夾持區＝B 面', { gripL: 1 });
  hold(0, 1.6, '推入左工位抽屜', '抽屜到位感測 ON、定位座有料 ON', { dL: 0, lampL: 'yellow' });
  hold(0, .5, '抽屜鎖定、工位燈轉綠', '人機不共區：抽屜鎖定後手臂才進入取件', { lampL: 'green', tower: 'green' });
  // ---------------------------------------------------------------- S2 取件辨識
  ptp(1, PRE, '手臂移到左工位定位座後方', '快換器與轉接頭快換盤同軸');
  lin(1, NEST, 120, '快換器對接', '最後 150 mm 慢速插入');
  hold(1, .5, '快換器鎖定', '鎖定銷伸出、氣路與訊號接通（鎖定燈）', { lock: 1, adL: 'robot' });
  lin(1, LIFT, 60, '抬離定位座', '');
  hold(1, .7, '讀取轉接頭 ID', `ID 讀碼器：${kind === 'mandrel' ? '內撐式' : '筒夾式'} #${kind === 'mandrel' ? 'M' : 'C'}-03 → 對應產品族`, { reader: 1 });
  lin(1, BACK, 400, '退出上料窗', '', { reader: 0, lampL: 'off' });
  ptp(1, SCAN0, '送到 3D 掃描位', '');
  // ---------------------------------------------------------------- S3 3D 快掃與對位
  hold(2, 1.4, '結構光掃描（正面）', '藍色條紋投影；點雲逐步建立', { scan: 1, twin: 'cloud', cloud: .55 });
  ptp(2, SCAN1, '產品轉 180°', 'J6 旋轉', { scan: 0 }, null);
  hold(2, 1.4, '結構光掃描（背面）', '', { scan: 1, cloud: 1 });
  hold(2, 2.6, 'ICP 對位', 'CAD 從偏移位置滑進點雲；補償夾持旋轉與插入深度誤差', { scan: 0, twin: 'icp', icp: 1 });
  hold(2, 1.2, `料號辨識：${prod.partNo}（${prod.name}）`, '比對產品檔庫；未知料號提示走首件掃描建檔（B 路徑）', {});
  // ---------------------------------------------------------------- S4 產品檔（離線由 CAD 自動生成，這裡展示內容）
  const st = prod.file.stats;
  hold(3, 2.2, 'A／B 面：依安裝方向自動判定', `A 面 ${st.area.A} mm²、B 面 ${st.area.B} mm²、不檢（內孔等） ${st.area.none} mm²`, { twin: 'plan', plan: 1 }, { presentation: true });
  hold(3, 1.6, '設計特徵遮罩：稜線、標誌、孔與螺牙', Object.entries(st.mask).filter(([, v]) => v).map(([k, v]) => `${k} ${v} mm²`).join('、'), { plan: 2 }, { presentation: true });
  hold(3, 3.2, `視角規劃：${st.views} 個姿態`, `集合覆蓋：A 面 ${(st.coverage.A * 100).toFixed(1)}%（候選 ${st.candidates}、撞到光學艙排除 ${st.rejected.collision}、手臂不可達 ${st.rejected.unreachable}）`, { plan: 3 }, { presentation: true });
  hold(3, 1.6, '拍攝路徑（類 TSP）', `移動約 ${st.moveTime} s＋取像 ${st.captureTime} s；產品檔存入產品檔庫`, { plan: 4 }, { presentation: true });
  // ---------------------------------------------------------------- S5 多姿態取像
  // 進出光學艙：在 U 形開口外對好姿態，沿 +X 直線送入；需要大幅轉腕的段（轉檔工具標 via）先直線退出再轉
  const outOf = p => shift(p, [OPTICS.entry, 0, 0]);
  VIEWS.forEach((to, k) => {
    const v = prod.file.views[k], ref = deg2rad(v.q), label = `姿態 ${k + 1}／${VIEWS.length}`;
    if (k === 0 || v.via) {
      if (k > 0) lin(4, outOf(pose), 500, `${label}：直線退出`, '直接轉腕會掃到條紋屏（轉檔工具的移動檢查），先退出 U 形屏', { pose: 0 });
      ptp(4, outOf(to), `${label}：在開口外對好姿態`, k === 0 ? '產品檔的第一個姿態' : '', { twin: 'scan', pose: 0 }, ref);
      lin(4, to, 450, `${label}：直線送入甜蜜點`, '沿 U 形屏開口方向，不轉腕', {});
    } else ptp(4, to, `${label}：移動`, 'GPU 同時重建、判定上一姿態（管線化）', { twin: 'scan', pose: 0 }, ref);
    hold(4, OPTICS.settle, `${label}：穩定`, '手臂到位 DO → PC 等待殘振衰減', {});
    hold(4, +CAPTURE.toFixed(3), `${label}：取像`, '硬體觸發：垂直／水平條紋各相移 4 張，再擴散白光彩色一張', { pose: k + 1, cov: k + 1 }, { capture: k });
  });
  lin(4, outOf(pose), 500, '直線退出光學艙', '最後一個姿態的影像還在 GPU 重建', { pose: 0 });
  // ---------------------------------------------------------------- S6 判定（手臂同時退出光學艙、送回上料窗）
  const cs = verdict.cands;
  ptp(5, SCAN0, '候選點浮現', '曲率高通、調變度下降、色彩自我參照', { twin: 'judge', judge: .33 });
  ptp(5, BACK, `物理候選 ${cs.length} 點投影到 CAD`, '手臂同時送回上料窗', {});
  hold(5, 2, 'AI 分類：排除設計特徵與拋光紋', cs.filter(c => c.verdict === 'ignore').map(c => c.type).join('、') + ' → 非瑕疵', { judge: .66 });
  hold(5, 2.2, '依 A/B 面查判定規則庫', cs.filter(c => c.verdict !== 'ignore').map(c => `${c.type}（${c.face} 面 ${c.value} ${c.unit}，限 ${c.limit}）${c.verdict === 'NG' ? 'NG' : '允收'}`).join('；'), { judge: 1 });
  hold(5, 1, `總判定：${verdict.result}`, verdict.result === 'NG' ? 'A 面超過允收值' : '全部在允收值內', { verdict: verdict.result, tower: verdict.result === 'NG' ? 'red' : 'green' });
  // ---------------------------------------------------------------- S7 送回與輸出
  lin(6, LIFT, 400, '送回左工位定位座', '');
  lin(6, NEST, 60, '放回定位座', '');
  hold(6, .5, '快換器解鎖', '鎖定銷退回；轉接頭留在定位座', { lock: 0, adL: 'nest' });
  lin(6, PRE, 300, '手臂退出', '');
  hold(6, 1.4, '左工位抽屜推出', `操作螢幕顯示 ${verdict.result} 與瑕疵位置；工位燈 ${verdict.result === 'NG' ? '紅' : '綠'}`, { dL: 1, lampL: verdict.result === 'NG' ? 'red' : 'green' });
  ptp(6, PRE_R, '手臂轉向右工位取下一件', '上料與檢測並行：右工位的下一件早已就緒', {});
  hold(6, .8, kind === 'mandrel' ? '作業員鬆開內撐、取下產品' : '作業員鬆開筒夾、取下產品', '', { gripL: 0 });
  hold(6, 2.2, verdict.result === 'NG' ? '放入 NG 料架' : '放入 OK 料箱', verdict.result === 'NG' ? 'NG 料架格位編號（追溯方式待定：格位編號或 QR 標籤）' : '', { outL: 1, prodL: 'out', lampL: 'off', tower: 'green' });
  // ---------------------------------------------------------------- S8 品質回饋
  hold(7, 3, '3D 熱圖：同料號瑕疵位置累積', '固定點反覆碰傷 → 疑似電鍍掛架接觸點', { twin: 'stats', heat: 1 });
  hold(7, 2.6, '柏拉圖：依料號、表面處理、瑕疵類型', '重工站平板可旋轉 3D 模型、點瑕疵看截圖', {});
  hold(7, 1, '循環：下一件', '', {});

  // 每件 CT：手臂對接（S2 開始）到放回定位座解鎖，扣掉產品檔展示（離線產生）
  const s2 = seq.stationStart[1], s7 = seq.steps.find(s => s.action === '快換器解鎖');
  const shown = seq.steps.filter(s => s.presentation).reduce((a, s) => a + s.dur, 0);
  const cycle = s7.start + s7.dur - s2 - shown;
  return { seq, poses, cycle, HOME, NEST, PRE, VIEWS, SCAN0 };
}

// 直線段：依緩動內插工具位姿（位置線性、姿態球面內插）
export function linPose(step, e) {
  const { from, to } = step.lin;
  return { origin: from.origin.clone().lerp(to.origin, e), quat: from.quat.clone().slerp(to.quat, e) };
}
