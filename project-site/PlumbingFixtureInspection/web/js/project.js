// 專案介面：網頁（main.js）與 core 統一檢查共用。規格見 core/README.md「專案介面」。
// 水五金外觀 AOI 檢測機：DENSO VM-60B1 以快換器取轉接頭（產品已由作業員裝好），經 3D 快掃辨識料號與 ICP 對位，
// 依「由 CAD 自動生成的產品檔」逐姿態把受檢區送進 U 形條紋屏的甜蜜點取像（偏折術＋擴散白光），判定後送回上料窗。
// 情境：createProject({ scene, product: 'gooseneck' }) 換成鵝頸出水管（project.json 的 variants）；換料號不換配方、不教導。
import * as THREE from 'three';
import { floor } from '@core/geom/environment.js';
import { block, blockBetween, cylinder } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { createCell } from './cell.js';
import { createRobot, createAdapter, JOINTS } from './robot.js';
import { createSequence, linPose, STATIONS, CAPTURE } from './sequence.js';
import { createTwin } from './twin.js';
import { productGeometry } from './product-mesh.js';
import { nestTool, productFromTool } from './poses.js';
import { PRODUCTS, candidates, FINISH, MODE } from './inspection.js';
import { OPTICS, DRAWER, ADAPTERS, PAYLOAD, TAKT, NG_RACK, OK_BIN, MACHINE, CAMERA_EVAL } from './layout.js';

export { STATIONS };
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const pair = (a, b, f, g) => (f(a) && g(b)) || (f(b) && g(a));
const named = re => m => re.test(m.name);

// 鏡面鉻（主畫面另外給環境貼圖，反射條紋屏）
export const CHROME = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, metalness: 1, roughness: .07, envMapIntensity: 1.25 });

export function createProject({ scene, product: pid = 'sleeve' } = {}) {
  const prod = PRODUCTS[pid] || PRODUCTS.sleeve, kind = prod.adapter;
  floor(scene, { size: [9000, 6200], center: [0, 300], cell: 200 });
  const cell = createCell(scene);
  const robot = createRobot(scene);

  // ---------------------------------------------------------------- 轉接頭與產品（左：本次受檢件；右：下一件，示範上料與檢測並行）
  const adapters = { L: createAdapter(kind, 'adapter L'), R: createAdapter(kind, 'adapter R') };
  const products = {};
  for (const s of ['L', 'R']) {
    scene.add(adapters[s]);
    const g = new THREE.Group(); g.name = 'product ' + s; scene.add(g);
    const mesh = new THREE.Mesh(productGeometry(prod), CHROME); mesh.name = 'product body'; mesh.castShadow = mesh.receiveShadow = true; g.add(mesh);
    products[s] = g;
  }
  // 機台外的作業區：NG 料架（格位）、OK 料箱（示意）
  const area = new THREE.Group(); area.name = 'work area'; scene.add(area);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) block(area, [30, 1100, 30], [NG_RACK.x + x * 280, 550, NG_RACK.z + z * 180], MAT.frame).name = 'ng rack post';
  for (const y of [520, 880]) block(area, [584, 20, 384], [NG_RACK.x, y, NG_RACK.z], MAT.red).name = 'ng rack shelf';   // 立柱內側，面不重合
  blockBetween(area, [OK_BIN.x - 260, 0, OK_BIN.z - 180], [OK_BIN.x + 260, 560, OK_BIN.z + 180], MAT.steelBlue).name = 'ok bin stand';
  blockBetween(area, [OK_BIN.x - 240, 560, OK_BIN.z - 160], [OK_BIN.x + 240, 760, OK_BIN.z + 160], MAT.green).name = 'ok bin';
  const RACK = V(NG_RACK.x - 120, 892, NG_RACK.z), BIN = V(OK_BIN.x, 764, OK_BIN.z);

  // ---------------------------------------------------------------- 判定與排程
  const cands = candidates(prod), result = cands.some(c => c.verdict === 'NG') ? 'NG' : 'OK';
  const twin = createTwin(scene, prod, cands);
  const { seq, poses, cycle } = createSequence(robot, prod, { cands, result });

  // 產品姿態：轉接頭上、上料中（手上 → 套上）、下料中（定位座 → 料架）
  const onAdapter = s => { const a = adapters[s]; return { quat: a.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2)), pos: a.localToWorld(V(0, 0, ADAPTERS[kind].mount)) }; };
  const place = (g, p) => { g.position.copy(p.pos); g.quaternion.copy(p.quat); };
  const _p = V(), _q = new THREE.Quaternion();

  const presentation = { signals: [], lines: [], hmi: '' };
  let hmiKey = '', cardKey = '';
  function apply(t) {
    const smp = seq.sample(t), st = smp.state, step = smp.step;
    let q = st.q;
    if (step.robot === 'lin' && smp.u > 0 && smp.u < 1) q = robot.track(linPose(step, smp.e), st.q);
    robot.setJoints(q);
    cell.drawers.L.set(st.dL); cell.drawers.R.set(st.dR);
    cell.setLamp('L', st.lampL); cell.setLamp('R', st.lampR);
    // 轉接頭：在定位座（隨抽屜）或在快換器上
    for (const s of ['L', 'R']) {
      const a = adapters[s];
      if (s === 'L' && st.adL === 'robot') { robot.tool.getWorldPosition(_p); robot.tool.getWorldQuaternion(_q); a.position.copy(_p); a.quaternion.copy(_q); }
      else { const n = nestTool(kind, s, s === 'L' ? st.dL : st.dR); a.position.copy(n.origin); a.quaternion.copy(n.quat); }
      a.updateMatrixWorld(true);
      a.userData.setGrip(s === 'L' ? st.gripL : 1);
    }
    // 產品：上料（手上 → 對準 → 沿軸套上）、下料（抬起 → 料架）
    const held = onAdapter('L');
    if (st.outL > 0) {
      const u = st.outL, lift = held.pos.clone().add(V(0, 330, 0)),   // 先垂直抬過抽屜前板，再移到料架／料箱
         dest = (result === 'NG' ? RACK : BIN).clone().add(V(0, 0, 0));
      const pos = u < .3 ? held.pos.clone().lerp(lift, u / .3) : lift.clone().lerp(dest.clone().add(V(0, 120 * (1 - (u - .3) / .7), 0)), (u - .3) / .7);
      place(products.L, { quat: held.quat, pos });
      if (u >= 1) place(products.L, { quat: held.quat, pos: dest });
    } else if (st.mountL < 1) {
      const u = st.mountL, axis = V(0, 0, 1).applyQuaternion(adapters.L.quaternion), hand = held.pos.clone().add(V(0, 150, 60)), pre = held.pos.clone().addScaledVector(axis, 70);
      place(products.L, { quat: held.quat, pos: u < .55 ? hand.lerp(pre, u / .55) : pre.lerp(held.pos, (u - .55) / .45) });
    } else place(products.L, held);
    place(products.R, onAdapter('R'));
    robot.lock.material.emissiveIntensity = st.lock ? 1.2 : .05;
    cell.reader.set(!!st.reader);
    cell.scanBeam.visible = !!st.scan;
    // 光學艙：取像步驟裡依時間切換（垂直條紋相移 4 張 → 水平條紋相移 4 張 → 擴散白光彩色一張）
    let mode = 'off', phase = 0, white = false;
    if (step.capture != null) {
      const k = Math.floor((t - step.start) / OPTICS.capture.fringe);
      if (k < 4) { mode = 'fringeV'; phase = k; } else if (k < 8) { mode = 'fringeH'; phase = k - 4; } else { mode = 'white'; white = true; }
    } else if (step.station === 4) mode = 'dark';
    cell.setScreens(mode, phase); cell.setLeds(white ? 1 : 0); cell.cam.set(white);
    presentation.optics = { mode, phase, white };
    // 數位空間
    twin.set(st, t);
    cell.tower.set(st.tower);
    // 操作螢幕
    const done = t >= seq.total - 1e-6;
    const lines = st.verdict ? [`${prod.partNo} ${prod.name}`, `判定：${st.verdict}`, st.verdict === 'NG' ? cands.filter(c => c.verdict === 'NG').map(c => `${c.type} ${c.face} 面 ${c.value}${c.unit}`).join('、') : '全部在允收值內', `單件 ${cycle.toFixed(0)} s`]
      : [`${prod.partNo} ${prod.name}`, step.station === 4 ? `取像 ${st.cov}／${prod.file.views.length}` : step.action, `表面：${FINISH[prod.finish]}`, `模式：${MODE[prod.finish]}`];
    const key = lines.join('|');
    if (key !== hmiKey) { cell.hmi.drawText(lines); hmiKey = key; }
    // 資訊卡（數位空間）
    const s = prod.file.stats, cardLines = [`產品檔 ${prod.partNo}　${prod.name}`, `來源：${prod.source.format}${prod.source.faces ? `（${prod.source.faces} 面）` : ''}　${FINISH[prod.finish]}`,
      `A 面 ${s.area.A} mm²　B 面 ${s.area.B} mm²　不檢 ${s.area.none} mm²`, `姿態 ${s.views}　覆蓋 A ${(s.coverage.A * 100).toFixed(1)}%`,
      st.twin === 'scan' ? `取像 ${st.cov}／${s.views}` : st.twin === 'judge' ? `判定：${st.verdict || '…'}` : st.twin === 'stats' ? '3D 熱圖：掛架接觸點' : step.action];
    const ck = cardLines.join('|') + st.twin;
    if (ck !== cardKey) {
      cardKey = ck;
      twin.card.draw(ck, (g, w, h) => {
        g.fillStyle = 'rgba(10,24,38,.88)'; g.fillRect(0, 0, w, h); g.strokeStyle = '#3d8fd6'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
        g.fillStyle = '#e8f2fb'; g.font = 'bold 40px "Noto Sans TC","Microsoft JhengHei",sans-serif'; g.fillText(cardLines[0], 28, 60);
        g.font = '28px "Noto Sans TC","Microsoft JhengHei",sans-serif'; g.fillStyle = '#9fc3e0';
        cardLines.slice(1).forEach((l, i) => g.fillText(l, 28, 120 + i * 64));
        if (st.twin === 'scan' || st.twin === 'plan') { const f = st.twin === 'scan' ? st.cov / s.views : Math.min(1, Math.max(0, st.plan - 2)); g.fillStyle = '#1d3448'; g.fillRect(28, h - 40, w - 56, 18); g.fillStyle = '#3dd68c'; g.fillRect(28, h - 40, (w - 56) * f * s.coverage.A, 18); }
      });
    }
    // 訊號（PLC ⇄ 手臂 ⇄ 工控 PC）
    robot.tool.getWorldPosition(_p);
    const inCabin = _p.x < OPTICS.S[0] + 420;
    presentation.signals = [
      ['左工位抽屜鎖定', st.dL < 1e-3 && st.lampL === 'green' || (st.dL < 1e-3 && st.adL === 'robot')], ['右工位抽屜鎖定（下一件就緒）', st.dR < 1e-3 && st.lampR === 'green'],
      ['快換器鎖定', st.lock > .5], ['轉接頭 ID 讀取', !!st.reader], ['3D 掃描中', !!st.scan],
      ['手臂到位 DO', step.capture != null || /穩定/.test(step.action)], ['相機硬體觸發', step.capture != null, 'warn'],
      ['手臂在光學艙內', inCabin], [`總判定 ${st.verdict || ''}`, !!st.verdict, st.verdict === 'NG' ? 'bad' : ''],
    ].map(([label, on, kind2]) => ({ label, on: !!on, kind: kind2 }));
    Object.assign(presentation, { lines, done, mode, cov: st.cov, verdict: st.verdict });
    return st;
  }
  apply(0);

  // ---------------------------------------------------------------- 空間檢核
  function layoutChecks() {
    const rows = [], v = prod.file.views;
    const worst = poses.reduce((a, p) => Math.max(a, p.err.position), 0), bad = poses.filter(p => !p.ok);
    rows.push({ group: '手臂可達', name: `排程內 ${poses.length} 個位姿（含 ${v.length} 個取像姿態）`, ok: !bad.length, value: bad.length ? `${bad.length} 個不可達：${bad[0].action}` : `最大誤差 ${worst.toFixed(2)} mm` });
    rows.push({ group: '產品檔', name: `A 面覆蓋率 ≥ 95%（${prod.name}）`, ok: prod.file.stats.coverage.A >= .95, value: `${(prod.file.stats.coverage.A * 100).toFixed(1)}%（${v.length} 個姿態）` });
    rows.push({ group: '產品檔', name: '候選瑕疵都有姿態量到', ok: cands.every(c => c.view !== 255), value: cands.filter(c => c.view === 255).map(c => c.type).join('、') || `${cands.length} 點` });
    const kg = ADAPTERS[kind].kg + PAYLOAD.qc + (pid === 'gooseneck' ? 1.3 : .12);
    rows.push({ group: '負載', name: `轉接頭＋快換器＋產品 ≤ ${PAYLOAD.limit} kg（VM-60B1）`, ok: kg <= PAYLOAD.limit, value: `${kg.toFixed(2)} kg` });
    const dofOk = CAMERA_EVAL.results.find(r => r.key === 'defect');
    rows.push({ group: '光學', name: '0.3 mm 瑕疵 ≥ 3 px（主相機）', ok: dofOk.status === 'ok', value: `${dofOk.value} px` });
    rows.push({ group: '節拍', name: `單件 CT ≤ ${TAKT} s（每日 200 件）`, ok: cycle <= TAKT, value: `${cycle.toFixed(1)} s` });
    const lift = DRAWER.axisY;
    rows.push({ group: '上料窗', name: '轉接頭軸心高 900～1000 mm', ok: lift >= 900 && lift <= 1000, value: `${lift} mm` });
    rows.push({ group: '機台', name: '外形 ≤ 2400 × 2000 × 2300', ok: MACHINE.x[1] - MACHINE.x[0] <= 2400 && MACHINE.z[1] - MACHINE.z[0] <= 2000 && MACHINE.h <= 2300, value: `${MACHINE.x[1] - MACHINE.x[0]} × ${MACHINE.z[1] - MACHINE.z[0]} × ${MACHINE.h}` });
    return rows;
  }

  const capMesh = robot.parts.find(m => m.name === 'forearm-cap'), wristMesh = robot.parts.find(m => m.name === 'wrist'), flangeMesh = robot.arm.j.j6.children.find(o => o.isMesh);
  const isProduct = named(/^product body$/), isAdapter = m => /^adapter |^mandrel |^collet /.test(m.name);
  return {
    total: seq.total, sequence: seq, timeline: seq, apply, layoutChecks, stationStart: seq.stationStart, cycleTime: cycle,
    robot, cell, twin, adapters, products, prod, cands, result, presentation,
    verify: {
      allow: [
        { why: '產品套在自己的轉接頭上（內撐心軸穿過底環、撐爪與鍵；筒夾夾住接管端）', test: (a, b, ctx) => pair(a, b, isProduct, isAdapter) && ctx.moduleOf(a).slice(-1) === ctx.moduleOf(b).slice(-1) },
        { why: '轉接頭本體躺在 V 形定位座上（PU 墊相切）', test: (a, b) => pair(a, b, isAdapter, named(/^nest v block$/)) },
        { why: '快換盤與快換器主側貼合（對接、鎖定）', test: (a, b) => pair(a, b, named(/^adapter plate$/), named(/^qc master face$/)) },
        { why: 'VM-60B1 模型手腕大角度時，前臂端蓋（R56 圓柱）的外框盒與手腕方塊、法蘭重疊；以頂點實測 J5 ≤ 116° 時手腕方塊間隙 ≥ 3.0 mm、法蘭 ≥ 16 mm（轉檔工具把 J5 限在 116° 內）。只在當下 |J5| ≤ 116° 時放行',
          test: (a, b) => pair(a, b, m => m === capMesh, m => m === wristMesh || m === flangeMesh) && Math.abs(robot.q.j5) <= 116 * Math.PI / 180 + 1e-9 },
        { why: '下料：產品放在 NG 料架隔板或 OK 料箱上', test: (a, b) => pair(a, b, isProduct, named(/^(ng rack shelf|ok bin)$/)) },
      ],
      dt: .06,
      envelope: ['robot'],
    },
  };
}
