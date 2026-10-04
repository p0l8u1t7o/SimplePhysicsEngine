// 第二段電控與外露配線。只讀取製程狀態，不修改第一段排程或關節。
import * as THREE from 'three';
import { component, robotController, CIRCUITS } from '@core/electrical/electrical-components.js';
import { cabinetShell, controlPanel, entryGland, panelFeed } from '@core/electrical/electrical-cabinet.js';
import { cable, cableTray, CABLE } from '@core/electrical/cable-routing.js';
import { create as visionCamera } from '@core/models/camera.js';
import { block, cylinder, plate, decal } from '@core/geom/shapes.js';
import { MAT, std } from '@core/geom/materials.js';
import { motor } from '@core/geom/hardware.js';
import { ELECTRICAL_SPEC as S } from './electrical-spec.js';
import { cameraDetails, curtainSign, trayCover, dressRoute, cabinetDetails, lightAdjusters } from './electrical-details.js';

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

export function createElectrical(scene, { cab, frame, robot, belt, vision, hmi, marks, cameras, tool, leds, towerLights, L }) {
  const e = new THREE.Group(); e.name = 'electrical'; scene.add(e);
  const spec = S.cabinet;
  const shell = cabinetShell(cab, 'CTRL / 電盤櫃（示意）', spec);
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
    if (name.includes('櫃後立管')) return {E1:'#1',E2:'#2–4',E3:'#5',E4:'#8–10',E5:'#11–14',E6:'#15–16b'}[name.split(' ')[0]];
    if (name.startsWith('CAM')) return name.includes('硬體') ? '#9' : '#8';
    if (name.startsWith('D1')) return '#2'; if (name.startsWith('D2')) return '#3'; if (name.startsWith('D3')) return '#4';
    if (name.includes('手臂編碼器')) return '#7'; if (name.includes('手臂動力')) return '#6';
    if (name.startsWith('E1')) return '#1'; if (name.startsWith('E3')||name.startsWith('RC1 背面')) return '#5';
    if (name.startsWith('E4')) return '#8–10'; if (name.includes('同步觸發分接')) return '#9';
    if (name.startsWith('LC1')) return '#10'; if (name.startsWith('HSC1')) return '#11';
    if (name.includes('入料光電')) return '#12'; if (name.startsWith('E5')) return '#13';
    if (name.includes('三色')) return '#14'; if (name.includes('投光器')) return '#16'; if (name.includes('受光器')) return '#16b';
    if (name.startsWith('GC1')) return '#15'; if (name.startsWith('廠務 /')) return '#17';
    if (name.startsWith('FRL')||name.startsWith('VAC1')||name.startsWith('工具')) return '#18'; return null;
  };
  const route = (parent, name, points, color = CABLE.signal, radius = 4, extra = {}) => {
    // 共用地面線槽依動力／訊號／安全分道，避免不同色線材整段重合。
    const lane = color === CABLE.power ? -12 : color === 0xefda57 ? 12 : 0;
    points = points.map(([x,y,z]) => y === 60 ? [x === -40 ? x+lane : x,y,z === -830 || z === -1950 ? z+lane : z] : [x,y,z]);
    const g = cable(parent, name, points, { color, radius, clips: Math.max(2, points.length), ...extra });
    dressRoute(g, routeNumber(name), wires.length); wires.push(g); return g;
  };
  const tray = (name, a, b, parent = e, width = 46) => cableTray(parent, name, a, b, { width });
  // 地面主幹：貼電盤左側跨越走道，分支由機台內部通過。
  for (const [name, a, b] of [
    ['C1', [-850, 60, -830], [-40, 60, -830]], ['C2', [-40, 60, -830], [-40, 60, -1950]],
    ['C3', [-40, 60, -1950], [1050, 60, -1950]], ['C7-A', [-500, 60, -830], [-500, 60, 420]],
    ['C7-B', [700, 60, -830], [700, 60, 170]], ['C1 延伸', [-40, 60, -830], [1200, 60, -830]],
    ['手臂支路', [150, 60, -830], [150, 60, -50]], ['氣源支路', [420, 60, -830], [420, 60, 310]],
  ]) {
    const g=tray(name,a,b);
    if (['C1','C2','C3'].includes(name)) trayCover(g,new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b)));
  }
  tray('C5 / 編碼器與入料感測', [-1250, 660, -686], [-910, 660, -686], belt, 30);
  // 線槽以腳座落地，未用支架懸在地面上方。
  for (const [x, z] of [[-850,-830],[-500,-830],[-40,-830],[-40,-1400],[-40,-1950],[560,-1950],[1050,-1950],[-500,420],[700,170],[1200,-830],[150,-50],[420,310]])
    block(e, [30, 50, 30], [x, 25, z], MAT.steelDark);
  const entries = spec.entries.map((en, i) => {
    const x = 300 + en.x, z = -1760 + en.z, p = panel.ports[en.port];
    entryGland(cab, `${en.id} / ${en.use}`, { at: [x, 1200, z], ...en, thickness: 20 });
    panelFeed(cab, `${en.id} / 穿板至端子`, [[x,1240,z],[x,1140,z],[x,1140,p[2]],[p[0],1140,p[2]],p], { radius: en.wire, color: feedColors[i] });
    route(cab, `${en.id} / 櫃後立管`, [[x,1240,z],[x,1240,-1930],[x,60,-1930],[x,60,-1950]], feedColors[i], en.wire);
    // 櫃後固定夾的承接軌，上端高於櫃頂 40 mm。
    block(cab, [12,1230,8], [x,615,-1920], MAT.steelDark);
    for (const y of [200,600,1000]) block(cab, [18,14,18], [x,y,-1912], MAT.alu);
    return [x,60,-1950];
  });
  plate(cab, ['電控盤（示意）', 'AC 220 V／24 VDC 240 W'], 390, 90, [300,1080,-1605], 0);
  cabinetDetails(cab,shell,panel);
  lightAdjusters(vision,L.vision);
  const rcSpec = S.components.find(c => c.id === 'RC1');
  const rc = robotController(e, { at: rcSpec.at }); Object.assign(rc.userData.electrical, rcSpec);
  // 元件表的 source 表示主要交握；串聯動力與安全回授另以連線表明確列出。
  const fromPanel = (id, dst, points, color, radius=4) => route(e, `${id} → ${dst}`, points, color, radius);
  fromPanel('E1', '廠務 AC 220 V（示意）', [entries[0],[100,7,-2070],[100,7,-2270]], CABLE.power,6);
  // 貼地進線以兩侧斜邊壓條保護；跨越上升段留出進線口。
  block(e,[38,3,200],[100,17,-2170],MAT.steelDark);
  for(const x of [78,122]) block(e,[9,17,200],[x,8.5,-2170],MAT.steelDark);
  fromPanel('E3', 'RC1 動力與交握', [entries[2],[1050,60,-1950],[1050,660,-1950],[1000,660,-1950],[1000,660,-1710],[1000,652,-1702]], CABLE.power,5);
  tray('RC1 背側理線', [1050,60,-1950], [1050,670,-1950]);
  route(e, 'RC1 背面服務線', [[1000,660,-1950],[900,660,-1950],[900,705,-1914]], CABLE.signal,4, {backing:{offset:[0,-12,0],feet:[[0,[1050,660,-1950]],[2,[900,653,-1910]]],radius:4}});
  const trunk = i => [entries[i],[-40,60,-1950],[-40,60,-830]];
  for (const [j,z] of [[0,-10],[1,-10]]) {
    route(robot, j ? 'RC1 / 手臂編碼器與煞車' : 'RC1 / 手臂動力', [[900+j*16,652,-1702],[900+j*16,620,-1950],[900+j*16,60,-1950],[-40,60,-1950],[-40,60,-830],[150+j*16,60,-830],[150+j*16,60,z],[150+j*16,1025,z],[150+j*16,1040,-110],[150,1090,-128]], j?CABLE.signal:CABLE.power,j?4:5);
  }
  // 原廠基座後方出線口離立座 120 mm：L 形托架承接服務彎，避開底座本體。
  block(robot,[100,12,165],[150,1038,-92],MAT.steelDark);
  block(robot,[100,65,10],[150,1008,-12],MAT.steelDark);
  block(robot,[24,940,4],[150,510,-3],MAT.alu);

  // 馬達支路沿地面線槽與支脚上升，不穿過承載面。
  route(belt,'D1 / 主帶馬達', [...trunk(1),[1200,60,-830],[1200,450,-830],[1250,450,-808]],CABLE.power,5);
  block(belt,[16,370,16],[1200,270,-797],MAT.steelDark);
  block(belt,[100,12,70],[1210,452,-779],MAT.steelDark);
  for (const [key,x,leg,cross] of [['A',-860,-600,-500],['B',860,600,700]]) {
    const group = scene.getObjectByName('div'+key);
    motor(group,x,560,490,.42);
    block(group,[100,12,140],[x,504,490],MAT.steelDark);
    block(group,[Math.abs(x-leg)+24,18,24],[(x+leg)/2,510,490],MAT.frame);
    const path=[...trunk(1),[cross,60,-830],[cross,60,170],[leg,60,170],[leg,60,440],[leg,560,440],[x,560,440],[x,560,465]];
    route(group,`D${key==='A'?2:3} / ${key} 帶馬達`,path,CABLE.power,5);
    tray(`${key} 帶地面分支`,[cross,60,170],[leg,60,170]);
    tray(`${key} 帶腳側分支`,[leg,60,170],[leg,60,440]);
  }
  const rear = [-895,60,-730], upper = [-895,1755,-730], front = [-895,1755,670];
  // C6 夾在立柱外側；跨到 C8 由原有托架承接。
  const toPost = i => [...trunk(i),[-850,60,-830],rear];
  route(frame,'E4 / 雙相機與光源幹線',[...toPost(3),[-895,1698,-730],[-780,1698,-730],[-730,1698,-730]],CABLE.signal,4);
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
  route(frame,'E5 / 感測與操作面幹線',[...toPost(4),upper,front,[-895,1500,670],[-810,1560,610],[-770,1560,610],[-560,1560,624],[-560,1500,640]],CABLE.signal,4);
  route(frame,'IO1 / 三色警示燈',[[-895,1755,-730],[-895,1840,-730],[-877,1840,-730]],CABLE.signal,3);
  route(belt,'HSC1 / 編碼器 A B Z',[rear,[-895,660,-730],[-1250,660,-730],[-1250,700,-757]],CABLE.signal,4);
  route(belt,'IO1 / 入料光電',[[-895,660,-730],[-1160,660,-730],[-1160,780,-730],[-1160,790,-700]],CABLE.signal,3);
  // 立柱與頂樑外表面的固定承接條；固定線在條外緣，不埋進鋁擠型。
  block(frame,[10,1695,18],[-888,907.5,-730],MAT.steelDark);
  block(frame,[10,18,1400],[-888,1755,-30],MAT.steelDark);
  block(frame,[10,300,18],[-888,1605,670],MAT.steelDark);

  // 光幕示意保留既有佔地，投／受光器靠托架掛在既有骨架。
  const safetyColor=0xefda57;
  for (const x of [-875,875]) {
    // 提案中心會撞上分流帶馬達；保留既有中心，縮窄外殼並留柱面間隙（示意）。
    block(frame,[40,1200,36],[x,1000,620],MAT.amber);
    // 透光面朝向對側收發器，中心與光幕 Z 610 共面。
    block(frame,[2,1170,12],[x-Math.sign(x)*21.5,1000,610],MAT.black);
    for(const y of [440,1560]) block(frame,[28,18,10],[x,y,643],MAT.steelDark);
  }
  const curtain=new THREE.Mesh(new THREE.PlaneGeometry(1705,1200),std(safetyColor,.8,0,{transparent:true,opacity:.035,side:THREE.DoubleSide,depthWrite:false}));
  curtain.name='curtain'; curtain.position.set(0,1000,610); marks.add(curtain);
  const curtainPlate = curtainSign(frame);
  route(frame,'GC1 / 投光器與急停幹線',[...toPost(5),[-892,1755,-730],[-892,1755,670],[-850,1730,625],[-875,1601,620]],safetyColor,4);
  route(frame,'GC1 / 受光器 OSSD 雙通道',[[-892,1755,670],[-875,1790,690],[875,1790,690],[850,1730,625],[875,1601,620]],safetyColor,4);
  const button=(parent,x,y,z,reset=false)=>{
    block(parent,[reset?52:76,65,16],[x,y,z-20],MAT.cabinet);
    cylinder(parent,reset?13:25,12,[x,y,z-6],reset?MAT.green:MAT.amber,'z',20);
    cylinder(parent,reset?10:18,14,[x,y,z+2],reset?MAT.green:MAT.red,'z',20);
  };
  button(hmi,-560,1250,680); button(hmi,-500,1250,680,true); button(cab,560,900,-1578);
  block(cab,[34,36,6],[560,900,-1607],MAT.steelDark);
  block(hmi,[150,10,20],[-530,1290,651],MAT.steelDark);
  block(hmi,[18,70,16],[-560,1322,639],MAT.alu);
  route(hmi,'GC1 / 急停與復歸',[[-892,1755,670],[-892,1695,670],[-810,1695,610],[-770,1695,610],[-770,1328,610],[-560,1328,631],[-560,1250,648],[-500,1250,648]],safetyColor,4);
  route(cab,'GC1 / 盤側急停',[[500,1140,-1840],[575,1140,-1840],[575,900,-1700],[560,900,-1628]],safetyColor,4);

  // 三點組與氣壓表，固定在立座 +Z 面；旋轉關節及浮動桿內部通道以接口表示。
  block(robot,[150,18,28],[150,480,294],MAT.steelDark);
  for(const x of [105,150,195]) { cylinder(robot,17,84,[x,420,304],MAT.alu,'y',18); block(robot,[36,28,36],[x,470,304],MAT.steelBlue); }
  cylinder(robot,24,12,[150,473,330],MAT.cap,'z',24);
  decal(robot,90,22,[150,525,296],[0,0,0],'0.5 MPa（示意）',{center:true});
  route(robot,'廠務 / 壓縮空氣',[[-850,6,-880],[-850,6,-865],[420,6,-865],[420,6,310],[230,6,310],[230,470,310],[213,470,304]],CABLE.air,6);
  route(robot,'FRL / 臂內氣路入口',[[88,470,304],[65,470,304],[65,1010,304],[65,1020,-110],[150,1060,-110],[150,1090,-128]],CABLE.air,4,
    {backing:{offset:[-12,0,0],feet:[[0,[105,470,280]],[2,[65,1000,280]],[5,[150,1038,-128]]],radius:4}});
  route(robot,'VAC1 / 氣壓回授',[[230,470,304],[240,470,304],[240,60,310],[420,60,310],[420,60,-830],[-40,60,-830],[-40,60,-1950],entries[4]],CABLE.signal,3);
  route(tool,'工具 / 真空訊號',[[48,-24,48],[67,-24,70],[67,-100,70],[30,-115,80]],CABLE.signal,2,
    {backing:{offset:[8,0,0],feet:[[0,[60,-30,46]],[2,[40,-80,86]]],radius:2}});
  route(tool,'工具 / 氣管',[[46,-24,52],[67,-24,100],[67,-60,100],[42,-60,86]],CABLE.air,3);
  // HMI 以同一份狀態更新畫布，避免另設模擬時鐘。
  const canvas=document.createElement('canvas'); canvas.width=960; canvas.height=540;
  const ctx=canvas.getContext('2d'), texture=new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace;
  // 動態螢幕只在文字改變時上傳，不為每次更新重建整組 mipmap。
  texture.generateMipmaps=false;texture.minFilter=THREE.LinearFilter;
  const display=new THREE.Mesh(new THREE.PlaneGeometry(468,258),new THREE.MeshBasicMaterial({map:texture}));
  display.position.set(-560,1500,698.5); hmi.add(display);
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
      line('同類 1.4 s／混合約 1.5 s',342,'#8eafc0',27);
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
