// 第二段電控與外露配線。只讀取製程狀態，不修改第一段排程或關節。
// 2026-10-05 拍板：DENSO 系統盤裝在現場既有電控櫃（frontline.js 建的 siteCabinet）上層的側板內面，RC8A 放在櫃內的控制器鐵架上；
// 主輸送帶沿用既有驅動；壓縮空氣來自櫃內下層的空壓機與儲氣筒。
import * as THREE from 'three';
import { component, robotController, CIRCUITS } from '@core/electrical/electrical-components.js';
import { controlPanel, entryGland, entryPlate, panelFeed } from '@core/electrical/electrical-cabinet.js';
import { cable, cableTray, CABLE } from '@core/electrical/cable-routing.js';
import { create as visionCamera } from '@core/models/camera.js';
import { estop } from '@core/models/indicators.js';
import { lightCurtain } from '@core/models/sensors.js';
import { frl } from '@core/models/motion.js';
import { block, plate, decal } from '@core/geom/shapes.js';
import { MAT, std } from '@core/geom/materials.js';
import { motor } from '@core/geom/hardware.js';
import { ELECTRICAL_SPEC as S } from './electrical-spec.js';
import { CAB_BODY } from './frontline.js';
import { cameraDetails, curtainSign, dressRoute, cabinetDetails, lightAdjusters } from './electrical-details.js';

// 動力需經兩顆接觸器；元件清單的支路來源 QF2 展開為實際串聯路徑。
export const SCHEDULE = S.rows.map(r => ({ y: r.y, items: S.components.filter(c => c.row === r.row)
  .map(c => component(c.kind === 'drive' ? { ...c, source: 'K2' } : c)) }));

export function createCameras(vision, v) {
  return v.camZ.map((z, i) => {
    const cam = visionCamera({ sensorW: 8.8, sensorH: 6.6, focal: 10, ring: 0 });
    cam.root.name = `CAM${i + 1}`; cam.root.position.set(v.x, v.camY, z); cam.root.rotation.y = Math.PI / 2;
    vision.add(cam.root);
    // 吊板跨在雙軌頂面；側板連接相機機身，避開頂部 M12 接頭。
    cameraDetails(vision, cam, i);
    block(vision, [8, 63, 38], [v.x + 26, 1650, z], MAT.steelDark);
    block(vision, [16, 8, 42], [v.x + 26, 1675, z + 20], MAT.alu);
    return cam;
  });
}

export function createElectrical(scene, { cab, frame, robot, belt, vision, hmi, hmiPanel, marks, cameras, tool, leds, towerLights, L, airOut }) {
  const e = new THREE.Group(); e.name = 'electrical'; scene.add(e);
  const spec = S.cabinet;
  // DENSO 系統盤的背板直接裝在既有電控櫃上層的下游側板內面（盤面朝櫃內），沒有自己的箱體；穿板接頭開在櫃頂，
  // 立管由櫃頂翻到側板外面下到地面。群組裡的座標仍照原本獨立電盤的寫法（盤面朝本地 +Z、背板安裝面在本地 Z = backZ、
  // 頂板頂面在本地 Y = top），整個群組繞 Y 轉 −90°（本地 +Z → 世界 −X、本地 +X → 世界 +Z）再平移到側板上。
  const K = L.siteCabinet, WALL = 20, DROP = K.h - spec.top, PX = K.x[1] - WALL + spec.backZ, PZ = K.panelZ - spec.center[0];
  cab.rotation.y = -Math.PI / 2; cab.position.set(PX, DROP, PZ);
  const world = ([x, y, z]) => [PX - z, y + DROP, x + PZ];                          // 群組座標 → 世界座標
  // 櫃頂靠下游側板的穿板接頭板：補在既有電控櫃頂板的缺口上，六個孔是真的開孔
  const glandZ = spec.center[2] + spec.entries[0].z, plateZ = spec.backZ + 65;
  entryPlate(cab, 'CTRL / 櫃頂穿板接頭板', [480, WALL, 130], [spec.center[0], spec.top - WALL / 2, plateZ], spec.entries.map(en => [en.x, glandZ - plateZ, en.hole]), CAB_BODY);
  const panel = controlPanel(cab, 'CTRL / 背板', { center: spec.panelCenter, width: spec.panel[0], height: spec.panel[1], backZ: spec.backZ, schedule: SCHEDULE });
  // 額外電源、網路與安全回授；沿每列下方與兩側線槽，與主要 source 連線共用元件端子。
  function net(from, to, category) {
    const pin = (id, sign) => {
      const d=panel.devices.get(id), s=d.userData.electrical;
      return [d.position.x+sign*s.size[0]*.28,d.position.y-s.size[1]/2-3,15+s.size[2]*.65];
    };
    const bottom = id => { const r=SCHEDULE.find(r=>r.items.some(c=>c.id===id)); return r.y-Math.max(...r.items.map(c=>c.size[1]))/2-13; };
    const a=pin(from,1), b=pin(to,-1), ya=bottom(from), yb=bottom(to), side=category==='ac'?-225:225;
    const z=19+Object.keys(CIRCUITS).indexOf(category)*2;
    const points=[a,[a[0],ya,a[2]],[a[0],ya,z],[side,ya,z],[side,yb,z],[b[0],yb,z],[b[0],yb,b[2]],b];
    const path=new THREE.CurvePath();
    for(let i=1;i<points.length;i++) if(new THREE.Vector3(...points[i]).distanceTo(new THREE.Vector3(...points[i-1]))>.01)
      path.add(new THREE.LineCurve3(new THREE.Vector3(...points[i-1]),new THREE.Vector3(...points[i])));
    const wire=new THREE.Mesh(new THREE.TubeGeometry(path,64,.8,6,false),std(CIRCUITS[category].color));
    wire.name=`連線 / ${from} → ${to}`;wire.userData.electricalWire={from,to,category,points};panel.group.add(wire);
  }
  for(const [from,to,category] of [
    ['QF2','K1','ac'],['K1','K2','ac'],['QF1','IPC1','ac'],
    ['K1','IO2','signal'],['K2','IO2','signal'],['HSC1','LC1','signal'],
    ['PLC1','SW1','network'],['PS1','LC1','dc'],['PS1','VAC1','dc'],
  ]) net(from,to,category);
  const feedColors = [CABLE.power, CABLE.power, CABLE.power, CABLE.signal, CABLE.signal, 0xefda57];
  const wires = [];
  const routeNumber = name => {
    if (name.includes('立管')) return {E1:'#1',E2:'#3–4',E3:'#5',E4:'#8–10',E5:'#11–14',E6:'#15–16b'}[name.split(' ')[0]];
    if (name.startsWith('CAM')) return name.includes('硬體') ? '#9' : '#8';
    if (name.startsWith('D2')) return '#3'; if (name.startsWith('D3')) return '#4';
    if (name.includes('手臂編碼器')) return '#7'; if (name.includes('手臂動力')) return '#6';
    if (name.startsWith('E1')) return '#1'; if (name.startsWith('E3')||name.startsWith('RC1 背面')) return '#5';
    if (name.startsWith('E4')) return '#8–10'; if (name.includes('同步觸發分接')) return '#9';
    if (name.startsWith('LC1')) return '#10'; if (name.startsWith('HSC1')) return '#11';
    if (name.includes('入料光電')) return '#12'; if (name.startsWith('E5')) return '#13';
    if (name.includes('三色')) return '#14'; if (name.includes('投光器')) return '#16'; if (name.includes('受光器')) return '#16b';
    if (name.startsWith('GC1')) return '#15'; if (name.startsWith('儲氣筒 /')) return '#17';
    if (name.startsWith('FRL')||name.startsWith('VAC1')||name.startsWith('工具')) return '#18'; return null;
  };
  const route = (parent, name, points, color = CABLE.signal, radius = 4, extra = {}) => {
    const g = cable(parent, name, points, { color, radius, clips: Math.max(2, points.length), ...extra });
    dressRoute(g, routeNumber(name), wires.length); wires.push(g); return g;
  };
  const tray = (name, a, b, parent = e, width = 46) => cableTray(parent, name, a, b, { width });
  const DZ = L.divA.z;                                                              // 分流帶中心線
  // 地面主幹 C1：既有電控櫃背後沿機台操作側往下游走的線床，每條線自己一道（BUS，由北到南）。
  // 排法的原則：線都由南邊（電控櫃）進來、往北邊（機台）出去，越早往北轉出去的排越北，轉出去時才不會跨過別條線；
  // 由櫃側立管過來的線先升到 Y 95 的跨線高度，越過比自己南邊的幾道才降到線床（見 fromRiser）。
  const BUS = { GC1: -800, E5: -812, E4: -824, D2: -836, RC0: -848, RC1: -860, D3: -872, E3: -884 };
  const busX = [-2320, 600], busC = (busX[0] + busX[1]) / 2;
  block(e, [busX[1] - busX[0], 2, 116], [busC, 52, -842], MAT.steelDark).name = 'C1 / 地面主幹線床';
  for (let x = busX[0] + 40; x < busX[1]; x += 480) for (const z of [-886, -798]) block(e, [20, 51, 20], [x, 25.5, z], MAT.steelDark);
  for (const [name, a, b] of [
    ['C7-A', [-500, 60, -784], [-500, 60, DZ - 62]], ['C7-B', [560, 60, -784], [560, 60, DZ - 62]],
    ['手臂支路', [150, 60, -784], [150, 60, -100]], ['氣源支路', [420, 60, -730], [420, 60, 310]],
  ]) tray(name, a, b);
  tray('C5 / 編碼器與入料感測', [-1250, 660, -686], [-910, 660, -686], belt, 30);
  // 線槽以腳座落地，未用支架懸在地面上方。
  for (const [x, z] of [[-500,-765],[560,-765],[150,-765],[420,-712],[-500,DZ-110],[560,DZ-110],[150,-100],[420,310]])
    block(e, [30, 50, 30], [x, 25, z], MAT.steelDark);
  const RZ = spec.backZ - WALL - 14;                                                // 立管：側板外面 14 mm（本地 Z）
  const entries = spec.entries.map((en, i) => {
    const x = 300 + en.x, z = -1760 + en.z, p = panel.ports[en.port];
    entryGland(cab, `${en.id} / ${en.use}`, { at: [x, 1200, z], ...en, thickness: 20 });
    panelFeed(cab, `${en.id} / 穿板至端子`, [[x,1240,z],[x,1140,z],[x,1140,p[2]],[p[0],1140,p[2]],p], { radius: en.wire, color: feedColors[i] });
    // 立管由櫃頂翻到下游側板外面，貼著側板下到地面；群組被抬高了 DROP，所以下端是群組座標的 60 − DROP。
    route(cab, `${en.id} / 櫃側立管`, [[x,1240,z],[x,1240,RZ],[x,60-DROP,RZ],[x,60-DROP,RZ-20]], feedColors[i], en.wire);
    block(cab, [12,1110+DROP,8], [x,(1250-DROP)/2,spec.backZ-WALL-4], MAT.steelDark);   // 側板外面的承接軌，下端落地
    return world([x,60-DROP,RZ-20]);
  });
  cabinetDetails(cab,panel);
  lightAdjusters(vision,L.vision);
  const rcSpec = S.components.find(c => c.id === 'RC1');
  // RC8A 放在控制器鐵架的上層（下層是 ABB 的 OmniCore C30，frontline.js 建）。robotController() 的面板固定朝本地 +Z，
  // 所以放進一個轉 180° 的安裝座，正面朝門（−Z）。
  const RK = K.rack, tierTop = K.shelf + RK.tier[1], rcY = tierTop + 30 + rcSpec.size[1] / 2;
  const rcFront = K.z[0] + WALL + 100 + 10, rcBack = rcFront + rcSpec.size[2];      // 鐵架正面離門內面 100，控制器再退 10
  const rcMount = new THREE.Group(); rcMount.name = 'RC1 安裝座'; rcMount.rotation.y = Math.PI; rcMount.position.set(RK.x, 0, rcBack); e.add(rcMount);
  const rc = robotController(rcMount, { at: [0, rcY, 0], floor: tierTop }); Object.assign(rc.userData.electrical, rcSpec);
  // 元件表的 source 表示主要交握；串聯動力與安全回授另以連線表明確列出。
  const fromPanel = (id, dst, points, color, radius=4) => route(e, `${id} → ${dst}`, points, color, radius);
  // 立管落地後的走線：六條立管在側板外沿 Z 排成一列。線先往下游錯開一道（laneX，各自不同），升到 Y 95 的跨線高度往北走，
  // 到主幹線床上自己那一道才降到 Y 60——所以立管之間、和主幹上已經在走的線都不交叉。
  const laneX = k => K.x[1] + 60 + k * 14;
  const fromRiser = (i, k, z, dz = 0) => [entries[i],[laneX(k),60,entries[i][2]+dz],[laneX(k),95,entries[i][2]+dz],[laneX(k),95,z],[laneX(k),60,z]];
  block(e,[92,4,440],[K.x[1]+100,50,-1250],MAT.steelDark).name='櫃側落地線床';
  for (const z of [-1440,-1250,-1060]) block(e,[30,48,30],[K.x[1]+100,24,z],MAT.steelDark);
  for (const z of [-1000,-925]) {                                                    // 跨線段的托桿
    block(e,[134,6,10],[K.x[1]+88,86,z],MAT.steelDark);
    for (const x of [26,150]) block(e,[10,83,10],[K.x[1]+x,41.5,z],MAT.steelDark);
  }
  // E1：由既有電控櫃下層的主電源分電（同一座櫃內），不另拉廠務進線
  block(e,[50,130,110],[K.x[1]-WALL-25,250,entries[0][2]],MAT.steelDark).name='既有電控櫃主電源分電盒';
  fromPanel('E1', '既有電控櫃主電源分電（示意）', [entries[0],[K.x[1]+60,60,entries[0][2]],[K.x[1]+60,250,entries[0][2]],[K.x[1]+1,250,entries[0][2]]], CABLE.power,6);
  // E3 與手臂纜線：由 RC8A 背面到櫃背的線槽空間（上層底板後緣留 70 mm），下到地面後從櫃背底部出線接到 C1
  const WZ = K.z[1] - WALL - 35, rcX = RK.x + 100;
  fromPanel('E3', 'RC1 動力與交握', [...fromRiser(2,5,BUS.E3),[rcX,60,BUS.E3],[rcX,60,WZ],[rcX,rcY,WZ],[rcX,rcY,rcBack+2]], CABLE.power,5);
  for (const [j,z] of [[0,-10],[1,-10]]) {
    const x = RK.x - 155 + j * 16;
    route(robot, j ? 'RC1 / 手臂編碼器與煞車' : 'RC1 / 手臂動力', [[x,rcY,rcBack+2],[x,rcY,WZ],[x,60,WZ],[x,60,BUS['RC'+j]],[150+j*16,60,BUS['RC'+j]],[150+j*16,60,z],[150+j*16,1025,z],[150+j*16,1040,-110],[150,1090,-128]], j?CABLE.signal:CABLE.power,j?4:5);
  }
  // 原廠基座後方出線口離立座 120 mm：L 形托架承接服務彎，避開底座本體。
  // 托架只伸到出線口正下方（Z −121）：再往外就進到搬運中工件的掃掠範圍（0.1 s 取樣抓到瓶蓋擦過原本伸到 Z −175 的托架）。
  block(robot,[100,12,112],[150,1038,-65],MAT.steelDark);
  block(robot,[100,65,10],[150,1008,-12],MAT.steelDark);
  block(robot,[24,940,4],[150,510,-3],MAT.alu);

  // 馬達支路沿地面線槽與支脚上升，不穿過承載面。主輸送帶是既有皮帶，沿用既有驅動，這裡只拉 A／B 兩條分流帶。
  // 分流帶與手臂架台同列（中心 Z = DZ）：橫越主帶下方的分支線槽直接到分流帶腳邊，沿支腳的 −Z 面上到馬達。
  // 分流帶馬達吊在帶子下方、兩支腳之間（原本放在帶尾外側，正好擋在工件由帶尾落進收料箱的路徑上）。
  // 馬達線沿支腳上到 Y 485，在吊架底板下方走到馬達。
  for (const [key,xm,leg,cross] of [['A',-420,L.divA.legX[0],-500],['B',565,L.divB.legX[1],560]]) {
    const group = scene.getObjectByName('div'+key), zT = DZ - 62, side = Math.sign(leg - cross), top = L['div'+key].top - 95;
    const parts = [motor(group,xm,560,DZ,.42), block(group,[100,12,278],[xm,504,DZ],MAT.steelDark),
      ...[-1,1].map(s => block(group,[100,top-510,8],[xm,(top+510)/2,DZ+s*135],MAT.steelDark))];
    for (const p of parts) p.traverse(m => { if (m.isMesh) m.name = 'drive motor'; });   // 馬達與吊架不是承載面：全場檢查要查工件有沒有撞到
    // 兩條馬達線出自同一支立管（E2）：B 帶那條一落地就往旁邊岔開 14 mm，各走各的道
    const start = key === 'A' ? fromRiser(1,3,BUS.D2) : [entries[1],...fromRiser(1,4,BUS.D3,-14).slice(1)];
    const path=[...start,[cross,60,BUS['D'+(key==='A'?2:3)]],[cross,60,zT],[leg,60,zT],[leg,485,zT],[xm,485,zT],[xm,485,DZ-40],[xm,494,DZ-40]];
    route(group,`D${key==='A'?2:3} / ${key} 帶馬達`,path,CABLE.power,5);
    if (Math.abs(leg - cross) > 170) tray(`${key} 帶地面分支`,[cross+side*30,60,zT],[leg-side*80,60,zT]);
  }
  const rear = [-895,60,-730], upper = [-895,1755,-730], front = [-895,1755,670];
  // C6 夾在立柱外側；跨到 C8 由原有托架承接。
  const toPost = (i, k, z) => [...fromRiser(i,k,z),[-850,60,z],rear];
  route(frame,'E4 / 雙相機與光源幹線',[...toPost(3,2,BUS.E4),[-895,1698,-730],[-780,1698,-730],[-730,1698,-730]],CABLE.signal,4);
  route(vision,'相機 / 同步觸發分接',[[-730,1698,-730],[-741,1698,-730]],CABLE.signal,3);
  for (const [i,cam] of cameras.entries()) {
    const z=cam.root.position.z;
    route(vision,`CAM${i+1} / GigE PoE 與同步觸發`,[[-730,1698,-730],[-730,1698,z],[-700,1698,z],[-700,1663,z]],CABLE.signal,4);
    // 雙軌內側的承接軌連到相機吊板；鏡頭前方保持淨空。
    block(vision,[8,8,Math.abs(z+730)+30],[-736,1688,(z-730)/2],MAT.alu);
    route(vision,`CAM${i+1} / 硬體觸發`,[[-741,1698,-730],[-741,1698,z],[-706,1698,z],[-706,1663,z]],CABLE.signal,3);
  }
  for (const lx of L.vision.ledX) {
    route(vision,`LC1 / 條燈 ${lx}`,[[-730,1698,-730],[-730,1698,-570],[lx,1598,-570],[lx-23,1535,-610],[lx-23,1330,-610],[lx,1320,-585]],CABLE.signal,4,
      {backing:{offset:[0,0,-12],feet:[[0,[-780,1680,-730]],[2,[lx,1565,-540]],[4,[lx,1330,-585]]],radius:3}});
  }
  route(frame,'E5 / 感測與操作面幹線',[...toPost(4,1,BUS.E5),upper,front,[-895,1500,670],[-810,1560,610],[-770,1560,610],[-560,1560,624],[-560,1500,640]],CABLE.signal,4);
  route(frame,'IO1 / 三色警示燈',[[-895,1755,-730],[-895,1840,-730],[-877,1840,-730]],CABLE.signal,3);
  route(belt,'HSC1 / 編碼器 A B Z',[rear,[-895,660,-730],[-1250,660,-730],[-1250,700,-757]],CABLE.signal,4);
  route(belt,'IO1 / 入料光電',[[-895,660,-730],[-1160,660,-730],[-1160,780,-730],[-1160,790,-700]],CABLE.signal,3);
  // 立柱與頂樑外表面的固定承接條；固定線在條外緣，不埋進鋁擠型。
  block(frame,[10,1695,18],[-888,907.5,-730],MAT.steelDark);
  block(frame,[10,18,1400],[-888,1755,-30],MAT.steelDark);
  block(frame,[10,300,18],[-888,1605,670],MAT.steelDark);

  // 光幕示意保留既有佔地，投／受光器靠托架掛在既有骨架。
  const safetyColor=0xefda57;
  // core 的安全光柵模型（投、受光器在 X ±875，機身 40 × 1200 × 36，Y 400…1600）。
  // 提案中心會撞上分流帶馬達；保留既有中心，縮窄外殼並留柱面間隙（示意）。
  // 透光面朝向對側收發器，中心與光幕 Z 610 共面（offset −10）；托架在 Y 440、1560，掛在既有骨架上。光幕面另外畫在 marks（下面）。
  const guard=lightCurtain.create({span:1750,height:1200,w:40,d:36,window:{gap:.5,offset:-10},brackets:{ys:[40,1160]},beam:false});
  guard.root.position.set(0,400,620); frame.add(guard.root);
  const curtain=new THREE.Mesh(new THREE.PlaneGeometry(1705,1200),std(safetyColor,.8,0,{transparent:true,opacity:.035,side:THREE.DoubleSide,depthWrite:false}));
  curtain.name='curtain'; curtain.position.set(0,1000,610); marks.add(curtain);
  const curtainPlate = curtainSign(frame);
  route(frame,'GC1 / 投光器與急停幹線',[...toPost(5,0,BUS.GC1),[-892,1755,-730],[-892,1755,670],[-850,1730,625],[-875,1601,620]],safetyColor,4);
  route(frame,'GC1 / 受光器 OSSD 雙通道',[[-892,1755,670],[-875,1790,690],[875,1790,690],[850,1730,625],[875,1601,620]],safetyColor,4);
  // 急停與復歸鈕（各帶按鈕盒）：core 的 estop 模型，原點在按鈕盒正面前 12 mm、按鈕軸朝 +Z
  const stopButton=estop.create({collarR:25,capR:18,capH:14,collarZ:-6,capZ:2,collarMaterial:MAT.amber,capMaterial:MAT.red,box:{size:[76,65,16]}});
  const resetButton=estop.create({reset:1,collarR:13,capR:10,capH:14,collarZ:-6,capZ:2,box:{size:[52,65,16]}});
  stopButton.root.position.set(-560,1250,680); resetButton.root.position.set(-500,1250,680);
  hmi.add(stopButton.root,resetButton.root);                                       // 盤側急停改用既有電控櫃門上的急停（與既有系統連鎖）
  // HMI 與兩顆按鈕的網格在 core 模型的 root 裡；core 1.10.0 的 cable() 會把模型 root 裡的網格當線夾固定面，直接走線即可
  block(hmi,[150,10,20],[-530,1290,651],MAT.steelDark);
  block(hmi,[18,70,16],[-560,1322,639],MAT.alu);
  route(hmi,'GC1 / 急停與復歸',[[-892,1755,670],[-892,1695,670],[-810,1695,610],[-770,1695,610],[-770,1328,610],[-560,1328,631],[-560,1250,648],[-500,1250,648]],safetyColor,4);

  // 三點組與氣壓表，固定在立座 +Z 面；旋轉關節及浮動桿內部通道以接口表示。
  // core 的 FRL 三點組模型（預設尺寸：背板 150 × 18 × 28、三顆間距 45、壓力表朝 +Z）；原點在中間那顆的頭部中心
  const frlUnit=frl.create(); frlUnit.root.position.set(150,470,304); robot.add(frlUnit.root);
  decal(robot,90,22,[150,525,296],[0,0,0],'0.5 MPa（示意）',{center:true});
  // 氣源：既有電控櫃下層的空壓機＋儲氣筒（分配座的 DENSO 出口），沿櫃背地面到機台，接立座上的三點組
  route(robot,'儲氣筒 / 壓縮空氣（往 DENSO 站）',[airOut,[airOut[0],6,airOut[2]],[airOut[0],6,-865],[400,6,-865],[400,6,310],[230,6,310],[230,470,310],[213,470,304]],CABLE.air,6);
  route(robot,'FRL / 臂內氣路入口',[[88,470,304],[65,470,304],[65,1010,304],[65,1020,-110],[150,1060,-110],[150,1090,-128]],CABLE.air,4,
    {backing:{offset:[-12,0,0],feet:[[0,[105,470,280]],[2,[65,1000,280]],[5,[150,1038,-128]]],radius:4}});
  // 氣壓回授要由機台走回 E5 的立管，方向和其他線相反：在線床底下（Y 22）走，不和線床上的線交叉
  const vx = K.x[1] + 44, z4 = entries[4][2];
  route(robot,'VAC1 / 氣壓回授',[[230,470,304],[240,470,304],[240,60,310],[420,60,310],[420,60,-775],[420,22,-775],[420,22,-842],[vx,22,-842],[vx,22,z4],[vx,50,z4],[K.x[1]+37,58,z4]],CABLE.signal,3);
  route(tool,'工具 / 真空訊號',[[48,-24,48],[67,-24,70],[67,-100,70],[30,-115,80]],CABLE.signal,2,
    {backing:{offset:[8,0,0],feet:[[0,[60,-30,46]],[2,[40,-80,86]]],radius:2}});
  route(tool,'工具 / 氣管',[[46,-24,52],[67,-24,100],[67,-60,100],[42,-60,86]],CABLE.air,3);
  // HMI 以同一份狀態更新畫布，避免另設模擬時鐘。畫布（960 × 540）與畫面網格在 core 的 hmi 模型裡（project.js 建立）。
  // 動態螢幕只在文字改變時上傳，不為每次更新重建整組 mipmap（模型的 display.mipmaps: false）。
  const {ctx,texture}=hmiPanel;
  let displayKey='';
  const lampMats=towerLights.map((_,i)=>MAT[['red','amber','green'][i]].clone());
  lampMats.forEach(m=>{m.emissive=m.color.clone();});
  const flashMat=leds[0].material.clone();
  function set(st) {
    const phase=((st.s%200)+200)%200;
    const capture=st.rate>.01 && phase<.4;
    const analysis=st.chapter.id==='ai';
    for(const lens of leds) lens.material=flashMat;
    flashMat.emissiveIntensity=capture?1.4:analysis?.5:.12;
    for(const [i,m] of lampMats.entries()) {m.emissiveIntensity=(i===0?st.alarm:i===1?!st.alarm&&st.rate<.01:!st.alarm&&st.rate>.01)?.7:0; towerLights[i].material=m;}
    // 未排入遮斷事件；保留第一段運轉，漏抓警報不冒充光幕遮斷。
    curtain.material.color.setHex(safetyColor);
    const key=`${st.counts.A}/${st.counts.B}/${st.counts.other}/${st.counts.missed}/${st.action}/${Math.floor(st.s/200)}`;
    if(ctx?.fillText && key!==displayKey) {
      displayKey=key; ctx.fillStyle='#10232d';ctx.fillRect(0,0,960,540);
      const line=(text,y,color='#d8eef6',size=36)=>{ctx.fillStyle=color;ctx.font=`${size}px sans-serif`;ctx.fillText(text,32,y);};
      line('回收物自動分揀　SIM／示意',55,'#55d9b0');
      line('自動模式 · PLC／雙相機／手臂連線',115,'#8eafc0',27);
      line(`A 食品 HDPE：${st.counts.A}`,185,'#d8eef6',30);
      line(`B 非食品 HDPE：${st.counts.B}`,238,'#d8eef6',30);
      line(`其餘：${st.counts.other}／漏抓：${st.counts.missed}`,291,'#d8eef6',30);
      line('同類 1.4 s／混合約 1.6 s',342,'#8eafc0',27);
      // 同步計數旁的取像示意縮圖，固定 ROI 不宣稱實測影像。
      ctx.fillStyle='#638395';ctx.fillRect(568,145,360,212);
      ctx.fillStyle='#243844';ctx.fillRect(573,150,350,202);
      ctx.fillStyle='#50606a';ctx.fillRect(580,192,336,125);
      ctx.fillStyle='#d4e5df';ctx.fillRect(700,225,65,50);ctx.fillRect(718,213,29,12);
      ctx.strokeStyle='#55d9b0';ctx.lineWidth=3;ctx.strokeRect(682,204,101,92);
      ctx.fillStyle='#edf5f4';ctx.font='22px sans-serif';ctx.fillText('CAM-L／ROI · SIM／示意',588,177);
      ctx.fillText(`取像 #${Math.floor(st.s/200)}`,588,342);
      line(st.alarm?'警報：目標間距不足':st.action,395,st.alarm?'#ff9c64':'#55d9b0',29);
      line('光幕位置為示意 · 安全距離待實機評估',470,'#e4ce70',25);
      texture.needsUpdate=true;
    }
    return {capture,analysis,triggerIndex:Math.floor(st.s/200),safetyBlocked:false};
  }
  return {panel,rc,cameras,wires,set,curtain,curtainPlate};
}
