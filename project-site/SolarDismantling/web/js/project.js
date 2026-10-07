// 專案介面：網頁（main.js）與 core 統一檢查共用。規格見 core/README.md「專案介面」。
// 太陽能板拆框機的機器人上下料（第二版）：FANUC M-710iC/45M＋置中吸盤架負責棧板 ⇄ 交接台，懸臂移載機負責交接台 ⇄ 拆框機；
// 入出料 A/B 雙工位、拆框機訊號交握、餘料送到機台外大料車。配置與尺寸在 layout.js，排程在 sequence.js。
// 情境：createProject({ scene, fault: true }) 示範拆框機故障（project.json 的 variants）。
import * as THREE from 'three';
import { createCell, FULL_BEAM_Y } from './cell.js';
import { createDismantler, CHUTE } from './machine.js';
import { createTransfer } from './transfer.js';
import { createRobot, RATING } from './robot.js';
import { createPanelParts, placeParts, FRAME_OUT } from './panel.js';
import { createSequence, linPose, STATIONS, CYCLES, PLAN } from './sequence.js';
import { evaluate } from './selection.js';
import { PANEL, MACHINE, GRIP, BAYS, TABLE, LOADER, GLASS_Y, FENCE, SCRAP, IN_MAX, OUT_MAX, OUT_WARN, inGlassY, outGlassY } from './layout.js';

export { STATIONS };

const PANEL_MESH = /^(panel |frame |junction )/;
const isPanel = m => PANEL_MESH.test(m.name);
const named = re => m => re.test(m.name);
const pair = (a, b, f, g) => (f(a) && g(b)) || (f(b) && g(a));

export function createProject({ scene, fault = false }) {
  const cell = createCell(scene);
  const machine = createDismantler(scene);
  const transfer = createTransfer(scene);
  const robot = createRobot(scene);
  // 會動的兩片板：各零件是場景第一層的群組（模組名稱 p0 laminate、p0 frame x+…）
  const movers = Array.from({ length: CYCLES }, (_, k) => createPanelParts(scene, 'p' + k));
  const { seq, poses, cycle } = createSequence(robot, { fault });

  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), I = new THREE.Quaternion();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  function rotateAt(g, pivot, euler) {                    // 繞零件自身的點旋轉
    g.quaternion.setFromEuler(euler);
    g.position.add(pivot).sub(pivot.clone().applyQuaternion(g.quaternion));
  }
  function lamPose(where, k, st) {
    const p = PLAN[k];
    switch (where) {
      case 'robot': robot.tcp.getWorldPosition(_p); robot.tcp.getWorldQuaternion(_q); return [_p, _q];
      case 'loader': return [V(TABLE.x, st.ly, st.lz), I];
      case 'table': return [V(TABLE.x, GLASS_Y, TABLE.z), I];
      case 'machine': return [V(MACHINE.x, GLASS_Y, MACHINE.z), I];
      case 'outA': case 'outB': return [V(BAYS[where].x, outGlassY(p.toIdx), BAYS[where].z), I];
      default: return [V(BAYS[where].x, inGlassY(p.fromIdx), BAYS[where].z), I];
    }
  }
  // 滑槽中心線：u＝0 起點、1 終點；回傳接線盒中心的世界位置（盒底貼滑槽面）與滑槽傾角
  const ch0 = V(...CHUTE.from), ch1 = V(...CHUTE.to), chDir = ch1.clone().sub(ch0).normalize(), chN = new THREE.Vector3(1, 0, 0).cross(chDir).normalize();
  const chSlope = Math.atan2(ch0.y - ch1.y, ch0.z - ch1.z);
  const bh = PANEL.jbox.size[1], boxLocal = V(PANEL.jbox.x, -PANEL.lam - bh / 2, 0);
  const onChute = u => ch0.clone().lerp(ch1, u).addScaledVector(chN.y > 0 ? chN : chN.negate(), 4 + bh / 2);

  const presentation = { signals: [], bays: {}, lines: [] };
  let hmiKey = '';
  function apply(t) {
    const smp = seq.sample(t), st = smp.state, step = smp.step;
    let q = st.q;
    if (step.robot === 'lin' && smp.u > 0 && smp.u < 1) q = robot.track(linPose(step, smp.e), st.q);
    robot.setJoints(q);
    machine.set(st);
    transfer.set({ z: st.lz, y: st.ly, center: st.ctr });

    for (let k = 0; k < CYCLES; k++) {
      const parts = movers[k], [pos, rot] = lamPose(st['lam' + k], k, st);
      placeParts(parts, pos, rot);
      // 鋁框：長邊（i 0、1）落到輸送帶 → 送往東側料車；短邊（i 2、3）落入抽屜料箱（第 k 片疊在第 k 層）
      const f = st['frm' + k];
      if (f > 0) parts.frames.forEach((g, i) => {
        const d = FRAME_OUT[i], out = MACHINE.pull * Math.min(f, 1), long = i < 2, below = PANEL.T - PANEL.lip;
        let x = MACHINE.x + d[0] * out, y = GLASS_Y, z = MACHINE.z + d[2] * out;
        const yBelt = SCRAP.conveyor.top + below, yBin = SCRAP.bin.y[0] + 10 + below + k * (PANEL.T + 1);
        if (f > 1) y = GLASS_Y + ((long ? yBelt : yBin) - GLASS_Y) * Math.min(f - 1, 1);
        if (long && f > 2) x += 1900 * Math.min(f - 2, 1);
        if (long && f > 3) {                                       // 滑出輸送帶尾端 → 落入料車
          const u = f - 3, slide = Math.min(u / .5, 1), drop = Math.max(0, (u - .5) / .5);
          x += 450 * slide;
          y = yBelt + (140 + 12 + below + k * (PANEL.T + 1) - yBelt) * drop * drop;            // 料車底板頂 152
        }
        g.position.set(x, y, z); g.quaternion.identity();
        if (f > 1 && f < 2) {
          const u = f - 1, wobble = Math.sin(Math.PI * u) * (1 - u), c = (long ? PANEL.W : PANEL.L) / 2 - PANEL.edge / 2;
          rotateAt(g, V(d[0] * c, -14, d[2] * c), new THREE.Euler(long ? 0 : .04 * wobble, .006 * wobble, long ? .03 * wobble : 0));
        }
      });
      // 接線盒：0 在背板；0～1 被刮刀往北推；1～2 經漏斗落到滑槽起點；2～3 沿滑槽滑下再落入料箱
      const b = st['box' + k];
      if (b > 0) {
        const pushed = V(MACHINE.x + PANEL.jbox.x, GLASS_Y - PANEL.lam - bh / 2, MACHINE.z + Math.min(0, machine.bladeZ(Math.min(b, 1)) - 10 - PANEL.jbox.size[2] / 2));
        let c = pushed, ang = new THREE.Euler();
        if (b > 1 && b <= 2) { const u = b - 1; c = pushed.clone().lerp(onChute(0), u); ang = new THREE.Euler(chSlope * u + Math.PI * .5 * Math.sin(Math.PI * u), 0, .2 * Math.sin(Math.PI * u)); }
        if (b > 2) {
          const u = b - 2, slide = Math.min(u / .7, 1), drop = Math.max(0, (u - .7) / .3);
          c = onChute(slide);
          if (drop > 0) c = c.clone().lerp(V(MACHINE.x + PANEL.jbox.x + (k - .5) * 160, 12 + bh / 2, SCRAP.tote.z[1] - 250), drop * drop);
          ang = new THREE.Euler(chSlope * (1 - drop), 0, 0);
        }
        parts.jbox.position.copy(c).sub(boxLocal); parts.jbox.quaternion.identity();
        rotateAt(parts.jbox, boxLocal, ang);
      }
    }

    // ---------------------------------------------------------------- 工位、訊號交握、指示燈與 HMI（只由時間決定）
    const done = t >= seq.total - 1e-6, lams = movers.map((_, k) => st['lam' + k]);
    const count = key => {
      const b = BAYS[key];
      if (key.startsWith('in')) return b.n - PLAN.filter((p, k) => p.from === key && lams[k] !== key).length;
      return b.n + PLAN.filter((p, k) => p.to === key && lams[k] === key).length;
    };
    const bays = {};
    for (const key of Object.keys(BAYS)) {
      const n = count(key), isIn = key.startsWith('in');
      const state = isIn ? (n === 0 ? 'empty' : n <= 3 ? 'low' : 'ok') : (n >= OUT_MAX ? 'full' : n >= OUT_WARN ? 'warn' : 'ok');
      bays[key] = { n, state };
      cell.bays[key].lamp.set(state === 'ok' ? 'green' : state === 'empty' || state === 'full' ? 'red' : 'yellow');
      if (cell.bays[key].full) cell.bays[key].full.material.opacity = state === 'full' ? .85 : .25;
    }
    const inMachine = lams.includes('machine'), kIn = lams.indexOf('machine');
    const stripped = kIn >= 0 && st['frm' + kIn] >= 2;
    const loaderIn = st.lz - 290 < MACHINE.z + MACHINE.W / 2;
    robot.tcp.getWorldPosition(_p);
    const robotClear = _p.z > TABLE.z + 650 || _p.y > GLASS_Y + 700;
    const sig = {
      ready: !st.fault && !inMachine && st.press < 1e-3 && st.pull < 1e-3,
      busy: !st.fault && step.station === 3 && !stripped,
      done: !st.fault && stripped && inMachine,
      fault: st.fault > .5,
      start: !!step.startSignal && t - step.start < .5,
      loaderIn, robotClear,
      table: lams.includes('table'),
      cartFull: false, toteFull: false,
    };
    presentation.signals = [
      ['拆框機 → 待料', sig.ready], ['拆框機 → 拆框中', sig.busy], ['拆框機 → 拆框完成', sig.done], ['拆框機 → 故障', sig.fault, 'bad'],
      ['PLC → 拆框啟動', sig.start], ['移載機在機內（禁止拆框）', sig.loaderIn, 'warn'], ['手臂離開交接台區', sig.robotClear], ['交接台有板', sig.table],
    ].map(([label, on, kind]) => ({ label, on, kind }));
    presentation.bays = bays;
    const anyRed = Object.values(bays).some(b => b.state === 'empty' || b.state === 'full');
    const tower = sig.fault ? 'red' : anyRed || done || t < 1 ? 'yellow' : 'green';
    cell.tower.set(tower);
    const frames = movers.filter((_, k) => st['frm' + k] >= 2).length, boxes = movers.filter((_, k) => st['box' + k] >= 3).length;
    const lines = sig.fault ? ['拆框上下料　故障', step.action, '拆框機：外拉逾時（鋁框卡料）', '排除後按「復歸」', `入料 A ${bays.inA.n}／B ${bays.inB.n}　出料 A ${bays.outA.n}／B ${bays.outB.n}`]
      : ['拆框上下料', done ? '完成：手臂回等待位' : step.action, `入料 A ${bays.inA.n}／B ${bays.inB.n} 片`, `出料 A ${bays.outA.n}／B ${bays.outB.n} 片（滿 ${OUT_MAX}）`,
        bays.inA.state === 'empty' ? '入料 A 空：請叉車補料' : bays.outA.state === 'full' ? '出料 A 滿：請換棧板' : `鋁框 ${frames} 片份／接線盒 ${boxes} 個`];
    const key = lines.join('|');
    if (key !== hmiKey) { cell.hmi.drawText(lines); hmiKey = key; }
    Object.assign(presentation, { lines, tower, frames, boxes });

    // 效果：雷射測高（打到板堆最上層）、破真空吹氣；負壓開關燈
    let laserTo = 0;
    if (step.laser) { const k = PLAN.findIndex(p => p.from === step.laser), p = PLAN[k]; laserTo = inGlassY(p.fromIdx); }
    robot.setDetail({ vac: st.vac, laserTo, blowProgress: step.blow ? Math.min(1, (t - step.start) / .3) : 0 });
    return st;
  }
  apply(0);

  // ---------------------------------------------------------------- 空間檢核
  function layoutChecks() {
    const save = { ...robot.q }, rows = [];
    const reach = (name, c) => {
      const r = robot.solve(robot.posePanel(c), save), ok = r.err.position <= 1 && r.err.angle <= .1;
      rows.push({ group: '手臂可達', name, ok, value: ok ? `誤差 ${r.err.position.toFixed(2)} mm` : `差 ${r.err.position.toFixed(1)} mm` });
    };
    for (const key of ['inA', 'inB']) { reach(`入料 ${key.slice(-1)} 最底層`, [BAYS[key].x, inGlassY(0), BAYS[key].z]); reach(`入料 ${key.slice(-1)} 滿疊（第 ${IN_MAX} 片）`, [BAYS[key].x, inGlassY(IN_MAX - 1), BAYS[key].z]); }
    for (const key of ['outA', 'outB']) { reach(`出料 ${key.slice(-1)} 第 1 片`, [BAYS[key].x, outGlassY(0), BAYS[key].z]); reach(`出料 ${key.slice(-1)} 滿疊（第 ${OUT_MAX} 片）`, [BAYS[key].x, outGlassY(OUT_MAX - 1), BAYS[key].z]); }
    reach('交接台放板位', [TABLE.x, GLASS_Y, TABLE.z]);
    const worst = Math.max(...poses.map(([, , j]) => j.err.position));
    rows.push({ group: '手臂可達', name: `排程內 ${poses.length} 個位姿`, ok: worst <= 1, value: `最大誤差 ${worst.toFixed(2)} mm` });
    robot.setJoints(save);
    const sel = evaluate().find(c => c.model === 'M-710iC/45M').results[0];
    rows.push({ group: '負載', name: `整板＋吸盤架 ≤ ${RATING.payload} kg（M-710iC/45M）`, ok: PANEL.kg + GRIP.kg <= RATING.payload, value: `${(PANEL.kg + GRIP.kg).toFixed(1)} kg` });
    rows.push({ group: '負載', name: '手腕力矩與慣量在容許內', ok: sel.ok, value: sel.ok ? '置中吸取' : sel.reasons.join('；') });
    const outer = BAYS.outA.x + 875, fenceGap = FENCE.x - outer;
    rows.push({ group: '圍籬', name: '棧板外緣在圍籬內', ok: fenceGap >= 100, value: `餘裕 ${Math.round(fenceGap)} mm` });
    rows.push({ group: '節拍', name: '每片節拍 ≤ 60 s', ok: cycle <= 60, value: `${cycle.toFixed(1)} s／片（約 ${Math.floor(3600 / cycle)} 片／時）` });
    return rows;
  }

  return {
    total: seq.total, sequence: seq, timeline: seq, apply, layoutChecks, stationStart: seq.stationStart,
    cycleTime: cycle, robot, machine, transfer, movers, cell, presentation, selection: evaluate(), fault,
    verify: {
      allow: [
        { why: '腕部線束第 0 段端口接續前臂固定外皮；僅此端點配對', test: (a, b) => pair(a, b, named(/^forearm dress pack$/), named(/^wrist dress segment 0$/)) },
        { why: '腕部線束最後一段插進手腕叉外側的旋轉接頭座；僅此端點配對', test: (a, b) => pair(a, b, named(/^dress connector$/), named(/^wrist dress segment 11$/)) },
        { why: '同一片板的零件互相貼合；板堆框疊框', test: (a, b) => isPanel(a) && isPanel(b) },
        { why: '吸盤吸附玻璃面（手臂與移載機）', test: (a, b) => pair(a, b, named(/^suction cup$/), isPanel) },
        { why: '板放在交接台托條、拆框機承板與支撐軌上，被壓板、壓指壓住，刮刀推接線盒', test: (a, b) => pair(a, b, isPanel, named(/^(table ledge|table pad|jaw shelf|jaw finger|support rail|press rubber|scraper blade)$/)) },
        { why: '鋁框落在輸送帶面、抽屜料箱底、料車底；接線盒落在滑槽與料箱底', test: (a, b) => pair(a, b, isPanel, named(/^(belt carry|bin floor|frame cart floor|chute floor|jbox tote floor)$/)) },
        { why: '板堆放在棧板上', test: (a, b) => pair(a, b, isPanel, named(/^pallet deck$/)) },
      ],
      dt: .08,                                   // 鋁框、接線盒落下只有 0.7～0.9 s，取樣要夠密
      envelope: ['robot', 'loader'],
    },
  };
}
