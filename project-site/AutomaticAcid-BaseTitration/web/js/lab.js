import {robotController} from '@core/electrical/electrical-components.js';
// 實驗桌、設備與器皿（樣品瓶、瓶蓋、滴定杯、移液模組、吸頭）
import * as THREE from 'three';
import {cabinetShell,controlPanel,entryGland,panelFeed} from '@core/electrical/electrical-cabinet.js';
import { cable, cableTray, carrier, support, CABLE } from '@core/electrical/cable-routing.js';
import { finish } from '@core/geom/finish.js';
import { perforated } from '@core/geom/perforated.js';
import { floor as floorPlane } from '@core/geom/environment.js';
import { block, cylinder, decal, tube } from '@core/geom/shapes.js';
import { MAT, finished } from '@core/geom/materials.js';
// 市購品用 core 的共用模型（1.10.0）：條碼讀取器、瓶座氣缸、操作電腦、安全雷射掃描器、分析天平、自動進樣器、滴定儀、移液模組與吸頭、廢液桶。
// 材質由本站傳入（下面的 M），外觀與換用前相同；加工件（桌、料架、夾座、停放座）與器皿（瓶、蓋、杯）留在本檔。
import { codeReader } from '@core/models/vision.js';
import { airCylinder } from '@core/models/motion.js';
import { operatorPc, safetyScanner } from '@core/models/equipment.js';
import { analyticalBalance, autosampler, titrator, pipetteModule, pipetteTip, wasteCanister } from '@core/models/equipment-lab.js';
import { Y0, BENCH, ST, BEAKER, BOTTLES, CAP, PIPETTE, SAMPLES } from './layout.js';
import { glassRim, liquidMaterial, glassVessel, glassBottle, graduations, createLiquid, flowLine, tipFillHeight } from './render-details.js';

// 常見材質用共用材質表（core/geom/materials.js 的 MAT）：桌架＝深色鋼、不鏽鋼件（finished：帶金屬細紋的快取複本）、黑件、狀態燈。
// 實驗室與產品專屬外觀（桌面、Metrohm 外殼、POM、瓶蓋、吸頭、玻璃與液體、雷射與安全區）留在本專案。
// grey 不換成 MAT.frame：用在電控箱外殼、天平防風罩框與滑門、瓶座夾爪座、鍵盤鍵帽、移液模組本體，
// 是烤漆／塑膠件（霧面塑膠細紋、低金屬度），不是鋁擠型；MAT.frame（較深、金屬度 .6）會改變外觀。
const M = {
  benchTop: new THREE.MeshStandardMaterial({ color: 0xd9dcd6, roughness: 0.6 }),          // 耐酸鹼實驗桌面
  frame: MAT.steelDark,
  steel: finished(MAT.steel, 'metal', .008),
  white: new THREE.MeshStandardMaterial({ color: 0xeef0ee, roughness: 0.45 }),
  grey: new THREE.MeshStandardMaterial({ color: 0x8c949c, roughness: 0.5, metalness: 0.2 }),
  dark: MAT.black,
  metrohm: new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.4, metalness: 0.1 }),
  metrohmDark: new THREE.MeshStandardMaterial({ color: 0x33414f, roughness: 0.45, metalness: 0.2 }),
  pom: new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.6 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x2f6fb5, roughness: 0.5 }),
  cap: new THREE.MeshStandardMaterial({ color: 0x2c6fcf, roughness: 0.55 }),
  capRed: new THREE.MeshStandardMaterial({ color: 0xd24a3c, roughness: 0.55 }),
  shield: new THREE.MeshPhysicalMaterial({ color: 0xcfe6ff, roughness: 0.05, transparent: true, opacity: 0.18, depthWrite: false }),
  tip: new THREE.MeshPhysicalMaterial({ color: 0xe5eeee, roughness: .21, clearcoat: .6, transparent: true, opacity: .28, depthWrite: false, side: THREE.DoubleSide }),
  liquid: liquidMaterial,
  laser: new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),   // 讀碼光束（雙面；讀碼器模型不改外部材質）
  zoneWarn: new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }),
  zoneStop: new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
  screen: new THREE.MeshBasicMaterial({ color: 0x0b1220 }),
  led: MAT.green,
};

for (const name of ['white','grey','metrohm','metrohmDark','pom','cap','capRed']) finish(M[name],'polymer',.02);
finish(M.benchTop,'polymer',.035);
function ring(parent, rIn, rOut, h, pos, material) {
  const shape = new THREE.Shape(); shape.absarc(0, 0, rOut, 0, Math.PI * 2);
  const hole = new THREE.Path(); hole.absarc(0, 0, rIn, 0, Math.PI * 2, true); shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 36 }); geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, material); m.position.set(...pos); m.castShadow = m.receiveShadow = true; m.userData.bore = rIn; parent.add(m); return m;   // bore：內孔半徑（全場檢查判斷零件是否在孔內）
}
// 動態文字貼圖（天平讀值、滴定儀與電腦畫面）在各模型裡（core 的 liveScreen）；Node 驗證環境沒有 canvas 時用 M.screen（screenFallback）

export function createLab(scene) {
  const root = new THREE.Group(); root.name = 'lab'; scene.add(root);
  const keepout = [];                                 // { name, mesh } 固定結構（驗證用）
  const K = (name, mesh) => { mesh.userData.keep = name; keepout.push({ name, mesh }); return mesh; };
  const W = (x, y, z) => [x, Y0 + y, z];

  // ---------------------------------------------------------------- 地面與實驗桌
  // 9 × 7 m 地坪、100 mm 格（格線 9 m 見方、高 1 mm）；顏色沿用本站原本略深的地坪與格線
  const { mesh: floor } = floorPlane(root, { size: [9000, 7000], cell: 100, color: 0x1a1f26, grid: [0x2c3440, 0x222831], gridY: 1 });
  const [bx0, bx1] = BENCH.x, [bz0, bz1] = BENCH.z, bw = bx1 - bx0, bd = bz1 - bz0;
  const benchPorts=[[-165,0,14],[-760,20,9],[1060,300,10]];
  const bench=perforated(root,[bw,40,bd],[0,Y0-20,0],[[ST.dock.x,ST.dock.z,22],[ST.tipChute.x,ST.tipChute.z,34],[ST.funnel.x,ST.funnel.z,10],...benchPorts],M.benchTop);bench.name='bench-with-service-bores';bench.userData.entryPlate=true;K('bench',bench);
  const subplate=perforated(root,[bw-40,30,bd-40],[0,Y0-55,0],benchPorts,M.frame);subplate.name='bench-lower-entry-plate';subplate.userData.entryPlate=true;
  for(const [i,[x,z,hole]] of benchPorts.entries())entryGland(root,'BENCH / sealed entry '+i,{at:[x,Y0,z],hole,wire:[6,2.5,3][i],thickness:70});
  for (const x of [bx0 + 40, 0, bx1 - 40]) for (const z of [bz0 + 40, bz1 - 40]) block(root, [50, Y0 - 70, 50], [x, (Y0 - 70) / 2, z], M.frame);
  block(root, [bw - 80, 20, bd - 120], [0, 180, 0], M.frame);                                   // 下層板
  // 桌下：手臂控制器、I/O、廢液桶
  cabinetShell(root,'ROBOT / controller cabinet',{center:[-300,320,0],size:[460,260,420],entries:[{x:0,z:0,hole:12}],thickness:6,material:M.dark});
  cabinetShell(root,'IO / cabinet',{center:[390,440,150],size:[560,500,420],entries:[{x:-190,z:-120,hole:9},{x:-90,z:-120,hole:10}],thickness:6,material:M.grey});
  robotController(root,{at:[-300,302,-180],crc:true,floor:194});
  const ioPanel=controlPanel(root,'IO / terminals',{center:[390,430,-30],width:490,height:420,backZ:-57,profile:'acid'});
  entryGland(root,'ROBOT / cabinet inlet',{at:[-300,450,0],hole:12,wire:6,thickness:6});
  for(const [x,hole,wire] of [[200,9,2.5],[300,10,3]])entryGland(root,'IO / cabinet inlet '+x,{at:[x,690,30],hole,wire,thickness:6});
  panelFeed(root,'ROBOT / internal terminal lead',[[-300,450,0],[-300,425,0],[-300,425,192],[-300,340,192],[-300,340,181]],{radius:6,color:CABLE.power});
  const can = wasteCanister.create({ w: 260, h: 330, d: 200 }); can.root.position.set(60, 190, -340); root.add(can.root);   // 廢液桶（含液位開關標示）
  cylinder(root, 12, Y0 - 540, [100, (Y0 + 520) / 2, -345], M.pom);                           // 漏斗排液管
  tube(root, [[100, 520, -345], [80, 510, -345], [60, 525, -330]], 10, M.pom);

  // ---------------------------------------------------------------- 分析天平（上方滑門，由手臂推開）
  // core 模型的原點在秤室中心（＝秤盤軸線，B.x／B.z 正好等於 cx／cz）與桌面的交點；防風罩四片玻璃、滑門與推把登記為避讓件
  const B = ST.balance, ch = B.chamber, cx = (ch.x[0] + ch.x[1]) / 2, cz = (ch.z[0] + ch.z[1]) / 2;
  const bal = analyticalBalance.create({ w: ch.x[1] - ch.x[0], d: ch.z[1] - ch.z[0], baseH: ch.y[0], top: ch.y[1], pan: B.pan, doorTravel: B.doorTravel, tabX: B.tab - cx,
    materials: { body: M.white, frame: M.grey, steel: M.steel, shield: M.shield }, screenFallback: M.screen });
  bal.root.position.set(cx, Y0, cz); root.add(bal.root);
  // 換用前天平是本站的群組，root 上的走線（BALANCE / rear signal）不會把線夾釘在天平底座上；模型 root 預設算固定面，這裡關掉以維持原本的走線五金
  bal.root.userData.cableHost = false;
  const balance = bal.root, door = bal.door, panel = bal.display;                                 // door：上方滑門（群組），panel：讀值畫面
  K('balance', bal.base); K('balance', bal.console); bal.walls.forEach(m => K('balance-wall', m)); K('balance-door', bal.doorPanel); K('balance-door', bal.handle);

  // ---------------------------------------------------------------- 樣品瓶座＋開蓋區（氣動自定心 V 型夾座）
  const C = ST.clamp, clamp = new THREE.Group(); clamp.position.set(C.x, Y0, C.z); root.add(clamp);
  K('clamp', block(clamp, [180, C.base, 190], [0, C.base / 2, 0], M.steel));                    // 寬 180：不伸入瓶蓋暫放座與滴定杯座
  const jaws = [];
  for (const s of [-1, 1]) {
    const jg = new THREE.Group(); clamp.add(jg);
    K('clamp', block(jg, [120, 36, 26], [0, C.base + 26, 0], M.pom));                          // V 型夾爪（示意為平面）
    block(jg, [60, 30, 40], [0, C.base + 22, s * 34], M.steel);
    jg.userData.side = s; jaws.push(jg);
  }
  // 氣缸：每側兩支夾在夾爪兩旁（夾爪與滑座在中間滑動，開到 150 mm 也不穿過缸體）
  for (const s of [-1, 1]) for (const x of [-73, 73]) {
    const c = airCylinder.create({ w: 22, h: 44, d: 50, rod: false, bodyMaterial: M.grey }); c.root.position.set(x, C.base + 22, s * 88); clamp.add(c.root); K('clamp', c.body);
  }
  decal(clamp, 110, 20, [0, C.base + 0.6, 80], [-Math.PI / 2, 0, 0], '樣品瓶座 / 開蓋', { color: '#20242a', center: true, bold: true });
  const capRest = new THREE.Group(); capRest.position.set(ST.capRest.x, Y0, ST.capRest.z); root.add(capRest);
  // 底座＋比瓶蓋細的承台：夾爪指尖低於瓶蓋底面，承台外側要讓出手指的空間
  K('caprest', cylinder(capRest, 38, 10, [0, 5, 0], M.pom, 'y', 32));
  K('caprest', cylinder(capRest, 22, ST.capRest.base - 10, [0, 10 + (ST.capRest.base - 10) / 2, 0], M.pom, 'y', 32));
  const holder = new THREE.Group(); holder.position.set(ST.holder.x, Y0, ST.holder.z); root.add(holder);
  K('holder', cylinder(holder, 55, 6, [0, 3, 0], M.steel, 'y', 36));
  ring(holder, BEAKER.d / 2 + 2, BEAKER.d / 2 + 10, ST.holder.base + 6, [0, 6, 0], M.pom);       // 從底盤頂面起，底面不與底盤重合
  decal(holder, 80, 16, [0, 6.6, 45], [-Math.PI / 2, 0, 0], '滴定杯座', { color: '#20242a', center: true, bold: true });

  // ---------------------------------------------------------------- 移液區：廢液漏斗、吸頭廢料口、吸頭架、移液模組停放座
  const F = ST.funnel;
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(52, 10, F.top - 10, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.6, side: THREE.DoubleSide }));
  funnel.position.set(F.x, Y0 + 10 + (F.top - 10) / 2, F.z); root.add(K('funnel', funnel));
  ring(root,10,60,10,[F.x,Y0,F.z],M.steel);
  const S = ST.tipChute, strip = new THREE.Group(); strip.position.set(S.x, Y0, S.z); root.add(strip);
  // 局部 +Z 朝手臂：支柱在遠端，叉口開向手臂
  ring(strip, 34, 44, 5, [0, -1, 0], M.dark); // 真正落料孔，不以實心黑片封住（下沉 1 mm，底面不與外環重合）
  K('chute', ring(strip, 44, 48, 12, [0, 0, 0], M.steel));
  decal(strip, 70, 16, [0, 1, 62], [-Math.PI / 2, 0, 0], '吸頭廢料口', { color: '#e6edf3', center: true, bold: true });
  const TR = ST.tipRack, tipRack = new THREE.Group(); root.add(tipRack);
  const trx = TR.x0 + (TR.n - 1) * TR.pitch / 2, trz = (TR.z[0] + TR.z[1]) / 2;
  const tipHoles=TR.z.flatMap(z=>Array.from({length:TR.n},(_,i)=>[TR.x0+i*TR.pitch-trx,z-trz,PIPETTE.tipR+.6]));
  const rackBody=perforated(tipRack,[TR.n*TR.pitch+16,TR.top-35,70],[trx,Y0+15+(TR.top-35)/2,trz],tipHoles,M.blue);rackBody.name='tiprack-bored-body';K('tiprack',rackBody);
  block(tipRack,[TR.n*TR.pitch+16,15,70],[trx,Y0+7.5,trz],M.blue);
  perforated(tipRack,[TR.n*TR.pitch+16,6,70],[trx,Y0+TR.top-17,trz],tipHoles,M.white);
  const D = ST.dock, dock = new THREE.Group(); dock.position.set(D.x, Y0, D.z); root.add(dock);
  const ddir = new THREE.Vector3(D.x, 0, D.z).normalize();
  ring(dock,22,26,4,[0,0,0],M.dark); // 吸頭可穿過桌面孔
  K('dock', block(dock, [30, D.collar - 17, 30], [ddir.x * 55, (D.collar - 17) / 2, ddir.z * 55], M.steel));   // 頂端低於叉口 2 mm：夾爪下到夾持環時手指不撞柱頂
  const fork = ring(dock, 21, 34, 8, [0, D.collar - 23, 0], M.pom); K('dock', fork);
  decal(dock, 70, 16, [ddir.x * 55 - ddir.z * 16, 120, ddir.z * 55 + ddir.x * 16], [0, Math.atan2(-ddir.z, ddir.x), 0], '移液模組座', { color: '#e6edf3', center: true, bold: true });

  // ---------------------------------------------------------------- 條碼讀取器（固定式，手臂把瓶子送到讀取點旋轉）
  const SC = ST.scanner, scanner = new THREE.Group(); scanner.position.set(SC.x, Y0, SC.z); root.add(scanner);
  K('scanner', block(scanner, [40, SC.h - 20, 40], [0, (SC.h - 20) / 2, -20], M.dark));            // 立柱（加工件）
  // 讀碼器本體＋讀碼光束（水平光帶與扇形，效果件 userData.fx，建立時隱藏；setState 用 reader.set 顯示）
  const reader = codeReader.create({ material: M.dark, beamMaterial: M.laser }); reader.root.position.y = SC.h; scanner.add(reader.root);
  K('scanner', reader.body);

  // ---------------------------------------------------------------- 料架：待處理杯區、待驗樣品瓶區、完成樣品瓶區、完成滴定杯區
  const rackPlate = (name, cols, rows, base, pitchX, pitchZ, hole) => {
    const xs = cols, zs = rows, x0 = Math.min(...xs) - pitchX / 2, x1 = Math.max(...xs) + pitchX / 2, z0 = Math.min(...zs) - pitchZ / 2, z1 = Math.max(...zs) + pitchZ / 2;
    K(name, block(root, [x1 - x0, base, z1 - z0], [(x0 + x1) / 2, Y0 + base / 2, (z0 + z1) / 2], M.pom));
    for (const x of xs) for (const z of zs) ring(root, hole, hole + 5, 10, [x, Y0 + base, z], M.pom);
  };
  const ER = ST.emptyRack; rackPlate('rack-empty', ER.cols, ER.rows, ER.base, 100, 80, BEAKER.d / 2 + 2);
  const DR = ST.doneRack; rackPlate('rack-done', DR.cols, DR.rows, DR.base, 100, 80, BEAKER.d / 2 + 2);
  for (const rk of [ST.sampleRack, ST.doneBottleRack]) {
    const zs = [rk.rows[500], rk.rows[100]], name = rk === ST.sampleRack ? 'rack-sample' : 'rack-donebottle';
    K(name, block(root, [3 * rk.pitch, rk.base, 250], [(rk.cols[0] + rk.cols[2]) / 2, Y0 + rk.base / 2, (zs[0] + zs[1]) / 2], M.pom));
    for (const x of rk.cols) { ring(root, BOTTLES[500].d / 2 + 2, BOTTLES[500].d / 2 + 7, 12, [x, Y0 + rk.base, zs[0]], M.pom); ring(root, BOTTLES[100].d / 2 + 2, BOTTLES[100].d / 2 + 7, 12, [x, Y0 + rk.base, zs[1]], M.pom); }
  }
  const tagPos = [[ER.cols[1], ER.rows[0] - 55, '待處理杯區'], [DR.cols[1], DR.rows[3] + 50, '完成滴定杯區'], [ST.sampleRack.cols[1], ST.sampleRack.rows[100] + 58, '待驗樣品瓶區'], [ST.doneBottleRack.cols[1], ST.doneBottleRack.rows[100] + 58, '完成樣品瓶區']];
  for (const [x, z, t] of tagPos) decal(root, 120, 24, [x, Y0 + 0.6, z], [-Math.PI / 2, 0, 0], t, { color: '#c9d1d9', center: true, bold: true });

  // ---------------------------------------------------------------- Metrohm 自動進樣器（轉盤＋滴定頭）＋滴定儀＋電腦
  // 進樣器用 at：整台建在模型 root 內的桌面座標上、root 留在原點，所以 head.position.y、探針的本地位置仍是桌面座標
  //（setState 與 tools/verify-clearance.mjs、verify-render.mjs 照舊讀寫）。
  const SP = ST.sampler, H = SP.housing;
  const smp = autosampler.create({ at: [SP.x, Y0, SP.z], r: SP.r, slots: SP.slots, plate: SP.plate, cupD: BEAKER.d, towerX: SP.towerX - SP.x,
    housing: { x: H.x.map(v => v - SP.x), z: H.z.map(v => v - SP.z), h: H.h },
    materials: { body: M.metrohm, dark: M.metrohmDark, seat: M.pom, steel: M.steel, black: M.dark, bulb: glassRim } });
  root.add(smp.root);
  // rack：轉盤（旋轉）；head：滴定頭（升降，帶電極、滴定管尖、加水管、噴洗嘴、攪拌軸）；prop：攪拌槳
  const sampler = smp.root, { rack, head, prop, slotPos, headX, headDown, towerX } = smp;
  K('sampler', smp.housing); K('sampler', smp.disc); K('sampler-tower', smp.tower); K('sampler-head', smp.arm); K('sampler-head', smp.hub);
  // Separate colour coded fluid lines and electrode cable, attached to the moving head.
  const tubing=[[-12,10,0xd5e7ef],[14,8,0xf0e7c6],[0,-14,0x41484e]];
  for(const [i,[dx,dz,color]] of tubing.entries()) cable(head,'HEAD / probe line '+i,[[headX+dx,headDown+232,SP.z+dz],[headX+dx-20,headDown+275,SP.z+60],[headX,headDown+300,SP.z+100],[towerX+130,headDown+330,SP.z+100+(i-1)*8.32]],{radius:2,color,clips:2});
  // 滴定儀（Titrando 級）＋ 2 支 Dosino（NaOH 滴定液、純水）＋液瓶（純水瓶用本站的玻璃器皿畫法）
  const T = ST.titrator;
  const ti = titrator.create({ materials: { body: M.metrohm }, screenFallback: M.screen,
    bottles: [{ z: -80, label: 'NaOH 0.1 mol/L', material: new THREE.MeshPhysicalMaterial({ color: 0xa06a3a, transparent: true, opacity: 0.5, roughness: 0.1 }) },
              { z: 30, label: 'H₂O', create: (parent, r, h) => glassVessel(parent, r, h, 2) }] });
  ti.root.position.set(T.x, Y0, T.z); root.add(ti.root);
  const titr = ti.root, tscreen = ti.screen;
  K('titrator', ti.body); ti.dosinos.forEach(m => K('titrator', m));
  for(const [i,dz] of [-80,30].entries())cable(root,'DOSE / separate fluid line '+i,[[T.x-40,Y0+420,T.z+dz],[T.x-40,Y0+620,T.z+dz],[towerX+50,Y0+760,SP.z+100+(i-1)*8.32],[towerX+50,Y0+700,SP.z+100+(i-1)*8.32]],{radius:2,color:i?0xd5e7ef:0xf0e7c6,clips:5,backing:{offset:[18,0,0],feet:[[1,[towerX,Y0+680,SP.z-36]],[3,[towerX,Y0+700,SP.z+36]]]}});
  // 電腦（整合軟體＋Metrohm 軟體）
  const P = ST.pc;
  const pcm = operatorPc.create({ material: M.dark, keyMaterial: M.grey, screenFallback: M.screen }); pcm.root.position.set(P.x, Y0, P.z); root.add(pcm.root);
  const pc = pcm.root, screen = pcm.screen;
  K('pc', pcm.monitor);
  // 安全雷射掃描器（地面）＋減速區／停止區（半圓朝操作員側 +Z；兩片區域是示意，不是實體）
  const sc = safetyScanner.create({ warnMaterial: M.zoneWarn, stopMaterial: M.zoneStop }); sc.root.position.set(0, 0, bz1 + 60); root.add(sc.root);
  const scan = sc.root, [zoneW, zoneS] = sc.zones;

  // ---------------------------------------------------------------- 器皿
  const items = {};
  function bottleMesh(i) {
    const s = SAMPLES[i], b = BOTTLES[s.size], g = new THREE.Group(); root.add(g);
    glassBottle(g,b);
    const fluid = createLiquid(g,b.d/2-3,4), liquid=fluid.body;
    graduations(g,b.d/2,b.h-30,4,b.d/2-3,s.size===500?50:10,s.size);
    const label = decal(g, Math.min(70, b.d * 0.8), b.h * 0.42, [0, b.h * 0.42, b.d / 2 + 0.8], [0, 0, 0], [s.barcode, `樣品 ${i + 1}`], { color: '#111', bg: '#f4f4ee', center: true, barcode: true });
    label.material.transparent = false;
    const labelArc=Math.min(70,b.d*.8)/(b.d/2+.4);
    label.geometry.dispose();label.geometry=new THREE.CylinderGeometry(b.d/2+.4,b.d/2+.4,b.h*.42,40,1,true,-labelArc/2,labelArc);label.position.z=0;label.renderOrder=5;
    g.userData = { kind: 'bottle', i, liquid, fluid, r: b.d / 2 - 3, capY: b.h + b.neckH - CAP.h + 4 };
    return g;
  }
  function capMesh(i) {
    const g = new THREE.Group(); root.add(g);
    const c = cylinder(g, CAP.d / 2, CAP.h, [0, CAP.h / 2, 0], i < 3 ? M.cap : M.capRed, 'y', 28);
    for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2; block(g, [1.5, CAP.h - 4, 3], [Math.cos(a) * (CAP.d / 2 + .5), CAP.h / 2, Math.sin(a) * (CAP.d / 2 + .5)], c.material).rotation.y = -a; }   // 止滑紋：內外面都不與夾爪指墊同面
    g.userData = { kind: 'cap', i }; return g;
  }
  function beakerMesh(k) {
    const g = new THREE.Group(); root.add(g);
    const vessel=glassVessel(g, BEAKER.d / 2, BEAKER.h, 3, true),lip=vessel.children[1];
    const fluid = createLiquid(g,BEAKER.d/2-2,3), liquid=fluid.body;
    graduations(g,BEAKER.d/2,BEAKER.h,3,BEAKER.d/2-2,25,200);
    const label=decal(g,34,12,[0,55,0],[0,0,0],`#${k+1}`,{color:'#1b2a3a',bg:'#ffffffcc',center:true,bold:true});
    const rr=BEAKER.d/2+.2,arc=34/rr;label.geometry.dispose();label.geometry=new THREE.CylinderGeometry(rr,rr,12,32,1,true,-arc/2,arc);label.renderOrder=5;
    g.userData = { kind: 'beaker', k, liquid, fluid, r: BEAKER.d / 2 - 2, lip }; return g;
  }
  // 移液模組與吸頭用 core 模型；root 就是整支被手臂帶著走的群組。userData 逐欄設定（不整個換掉，保留模型的 coreModel／cableHost 標記）
  function pipetteMesh() {
    const p = PIPETTE, pip = pipetteModule.create({ collar: p.collar, top: p.top, r: p.r, nose: p.nose, materials: { white: M.white, grey: M.grey, ring: M.blue, dark: M.dark, led: M.led } });
    root.add(pip.root); pip.root.userData.kind = 'pipette'; return pip.root;
  }
  function tipMesh(i) {
    const p = PIPETTE, tip = pipetteTip.create({ length: p.tipLen, radius: p.tipR, material: M.tip, liquidMaterial: M.liquid });
    root.add(tip.root); Object.assign(tip.root.userData, { kind: 'tip', i, liquid: tip.liquid, unitVertices: tip.unitVertices }); return tip.root;   // 液柱由 setState 依體積變形
  }
  SAMPLES.forEach((s, i) => { items[`bottle${i}`] = bottleMesh(i); items[`cap${i}`] = capMesh(i); });
  for (let t = 0; t < 12; t++) items[`tip${t}`] = tipMesh(t);
  for (let k = 0; k < 12; k++) items[`beaker${k}`] = beakerMesh(k);
  items.pip = pipetteMesh();
  const pipFlow=flowLine(root,.6),waterFlow=flowLine(root,.8);
  const doseDrop=new THREE.Mesh(new THREE.SphereGeometry(.85,16,12),liquidMaterial);doseDrop.renderOrder=2;doseDrop.userData.fx=true;root.add(doseDrop);
  const sprayLines=Array.from({length:3},()=>flowLine(root,.25));
  const headHarness=carrier(root,'SAMPLER / electrode and fluid service',{origin:[towerX+50,Y0+headDown+330,SP.z+100],axis:[0,1,0],rise:[1,0,0],fixed:248,min:0,max:190,radius:40,width:32,pitch:16,colors:[0xd5e7ef,0xf0e7c6,CABLE.signal]});
  support(root,'SAMPLER / fixed guide bracket',[towerX,Y0+690,SP.z+36],[towerX+39,Y0+700,SP.z+100],6);
  support(head,'SAMPLER / moving strain-relief arm',[towerX+20,headDown+228,SP.z+30],[towerX+130,headDown+330,SP.z+100],6);
  cableTray(root,'BENCH / dry electrical distribution',[-1100,710,390],[1100,710,390],{width:52});
  for(const x of [-1000,0,1000])support(root,'BENCH / trough suspension',[x,780,390],[x,699,390],6);
  cable(root,'ROBOT / cabinet to sealed bench bore',[[-300,450,0],[-300,480,0],[-230,470,0],[-165,650,0],[-165,Y0,0]],{radius:6,color:CABLE.power,clips:4,backing:{offset:[0,0,22],path:[[-300,450,22],[-300,480,22],[-230,470,22],[-165,650,22],[-165,780,22]],feet:[[0,[-300,450,22]],[4,[-165,780,22]]]}});
  cable(root,'BALANCE / rear signal',[[-700,Y0+40,20],[-750,Y0+30,20],[-760,Y0+30,20],[-760,Y0+15,20]],{radius:2.5,color:CABLE.signal,clips:3});
  panelFeed(root,'BALANCE / desk to IO',[[-760,Y0+15,20],[-760,735,20],[-760,706,410],[200,706,410],[200,735,240],[200,735,30],[200,630,30],ioPanel.ports[2]],{radius:2.5});
  cable(pc,'PC / protected rear data',[[35,300,-42],[45,250,-65],[45,50,-65],[60,15,-100]],{radius:2.5,color:CABLE.signal,clips:3});
  panelFeed(root,'PC / desk to IO',[[1060,Y0+15,300],[1060,735,300],[1060,706,397],[300,706,397],[300,735,240],[300,735,30],[300,630,30],ioPanel.ports[8]],{radius:3});
  cable(root,'SAMPLER / dry electrode feed',[[T.x+85,Y0+60,T.z],[1140,Y0+180,-210],[1140,Y0+690,100],[towerX+50,Y0+700,SP.z+108.32]],{radius:2.2,color:CABLE.signal,clips:5,backing:{offset:[18,0,0],feet:[[1,[1158,Y0,-210]],[2,[towerX+36,Y0+690,SP.z]]]}});

  // ---------------------------------------------------------------- 狀態套用
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  function worldOf(id, locs, ctx, out = { p: new THREE.Vector3(), q: new THREE.Quaternion() }) {
    const L = locs[id];
    if (L.w) { out.p.set(...L.w); out.q.setFromAxisAngle(UP, L.yaw || 0); }
    else if (L.g) { ctx.robot.getTcpWorld('grip', out.p); ctx.robot.tool.getWorldQuaternion(_q); out.p.add(_v.set(...L.g).applyQuaternion(_q)); out.q.copy(_q).multiply(_q2.set(...L.q)); }
    else if (L.on) { const par = worldOf(L.on, locs, ctx, { p: new THREE.Vector3(), q: new THREE.Quaternion() }); out.p.copy(par.p).add(_v.set(...L.off).applyQuaternion(par.q)); out.q.copy(par.q).multiply(_q2.setFromAxisAngle(UP, L.yaw || 0)); }
    else if (L.as !== undefined) { const a = ctx.rackAngle + L.as * 2 * Math.PI / SP.slots; out.p.set(SP.x + Math.cos(a) * SP.r, Y0 + SP.plate, SP.z - Math.sin(a) * SP.r); out.q.setFromAxisAngle(UP, a + (L.yaw || 0)); }
    return out;
  }
  const tmp = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  /** 依排程狀態擺放器皿與設備；ctx = { robot, rackAngle, headDrop, stir, scanning } */
  function setState(s, ctx) {
    for (const id in items) {
      const g = items[id], L = s.loc[id];
      g.visible = !!L && !L.gone; if (!g.visible) continue;
      worldOf(id, s.loc, ctx, tmp); g.position.copy(tmp.p); g.quaternion.copy(tmp.q);
      const u = g.userData;
      if (u.kind === 'bottle' || u.kind === 'beaker') {
        u.fluid.set(s.vol[id]||0,ctx.time,ctx.stir&&id===`beaker${ctx.job?.beaker}`);
      }
      if (u.kind === 'tip') {
        const v=s.tipVol?.[id]||0;u.liquid.visible=v>.01;
        if(u.lastVolume!==v){u.lastVolume=v;const h=tipFillHeight(v),p=u.liquid.geometry.attributes.position;
          for(let n=0;n<p.count;n++){const y=u.unitVertices[n*3+1]+.5,r=.7+7.5*y*h/140;
            p.setXYZ(n,u.unitVertices[n*3]*r,y*h,u.unitVertices[n*3+2]*r);}
          p.needsUpdate=true;u.liquid.geometry.computeVertexNormals();u.liquid.geometry.computeBoundingSphere();}
        u.liquid.position.y=-PIPETTE.tipLen+2;
      }
    }
    door.position.x = -B.doorTravel * s.door;
    for (const jg of jaws) jg.position.z = jg.userData.side * (s.clampGap / 2 + 13);
    rack.rotation.y = ctx.rackAngle;
    head.position.y = Y0 + 190 * (1 - ctx.headDrop);
    prop.rotation.y = ctx.stir ? (ctx.time-ctx.job.start) * 12 : 0;
    headHarness.set(head.position.y-Y0);
    root.updateMatrixWorld(true);
    pipFlow.mesh.visible=waterFlow.mesh.visible=doseDrop.visible=false;sprayLines.forEach(l=>l.mesh.visible=false);
    if(ctx.step.label.startsWith('吐出')&&ctx.progress<1){
      const tipId=ctx.step.touch?.find(id=>id.startsWith('tip')&&items[id]),tip=items[tipId];
      if(tip?.visible){const a=tip.localToWorld(new THREE.Vector3(0,-PIPETTE.tipLen,0)),b=a.clone();
        const beakerId=ctx.step.touch?.find(id=>id.startsWith('beaker'));
        b.y=beakerId?items[beakerId].position.y+items[beakerId].userData.fluid.surface.position.y:Y0+15;
        pipFlow.set(a,b,a.y>b.y);}}
    if(ctx.job){
      const cup=items[`beaker${ctx.job.beaker}`],surfaceY=cup.position.y+cup.userData.fluid.surface.position.y;
      const a=new THREE.Vector3(headX-12,head.position.y+headDown+20,SP.z+10);
      waterFlow.set(a,new THREE.Vector3(a.x,surfaceY,a.z),ctx.time>=ctx.job.start&&ctx.time<ctx.job.start+15);
      if(ctx.time>=ctx.job.start+35&&ctx.time<ctx.job.end-20){
        const top=head.position.y+headDown+20,phase=((ctx.time-ctx.job.start)*2)%1;
        doseDrop.visible=top>surfaceY;doseDrop.position.set(headX+14,top-(top-surfaceY)*phase*phase,SP.z+8);doseDrop.scale.set(.7,1.3,.7);}
      if(ctx.spray)for(let i=0;i<3;i++){
        const from=new THREE.Vector3(headX-16,head.position.y+headDown+20,SP.z-14),to=new THREE.Vector3(headX+(i-1)*3,head.position.y+headDown+3,SP.z-14);
        sprayLines[i].set(from,to,true);}}
    reader.set(!!ctx.scanning);                       // 讀碼光束（光帶＋扇形）
    panel.draw(s.balText, (g, w, h) => { g.fillStyle = '#0a1a10'; g.fillRect(0, 0, w, h); g.fillStyle = s.balStable ? '#6dff9c' : '#c9f7d5'; g.font = 'bold 64px Consolas, monospace'; g.textAlign = 'right'; g.fillText(s.balText, w - 16, 92); g.font = '28px Arial'; g.textAlign = 'left'; g.fillText(s.balStable ? '穩定' : '', 14, 138); });
  }
  // 各設備群組（全場檢查分工位：不同設備的固定件互相穿插視為架設相撞）
  const stations = { balance, clamp, capRest, holder, chute: strip, tipRack, dock, scanner, sampler, titrator: titr, pc, safetyScanner: scan };
  return { root, items, keepout, setState, worldOf, screen, tscreen, slotPos, headX, head, prop, pipFlow, waterFlow, doseDrop, sprayLines, balanceDoor: door, jaws, zones: [zoneW, zoneS], floor, stations };
}
