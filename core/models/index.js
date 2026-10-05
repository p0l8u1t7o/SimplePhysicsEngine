// 共用模型清單：目錄頁（core/catalog）依此列出。新增模型時在這裡登記。
// 每個模型提供 meta（名稱、分類、可調參數、可動狀態、用法）與 create(params) → { root, set?(state) }。
// 排列順序＝目錄頁的順序（分類依第一次出現的先後）。各站換用的對照在 core/migrations/。
import * as conveyor from './conveyor.js';
import * as gantry from './gantry.js';
import * as camera from './camera.js';
import { motor, sensor, foot, gauge } from './hardware.js';
import * as agvForklift from './agv-forklift.js';
import * as drum200l from './drum-200l.js';
import * as densoVs068 from './robots/denso-vs068.js';
import * as fanucR2000 from './robots/fanuc-r2000ic.js';
import * as densoHsr065 from './robots/denso-hsr065.js';
import * as cobottaPro900 from './robots/denso-cobotta-pro900.js';
import * as densoVm60b1 from './robots/denso-vm60b1.js';
import * as abbIrb360 from './robots/abb-irb360.js';
import { signalTower, hmi, estop } from './indicators.js';
import { boxSensor, lightCurtain, ftSensor } from './sensors.js';
import { barLight, domeLight } from './lights.js';
import { visionCamera, codeReader, laserProfiler } from './vision.js';
import { airCylinder, pivotCylinder, slideTable, linearAxis, zThetaSpindle, nutrunner, parallelGripper,
  vacuumEjector, solenoidValve, floatRod, suctionCup, frl, rotaryEncoder, drawerSlide, doorSwitch, loadCell } from './motion.js';
import { beltConveyor, edgeBeltConveyor, vRollerConveyor, stopper, ballTurntable, flexFeeder } from './transport.js';
import { pallet, shuttleCar, shuttleRack, jibCrane, dolly, agvCharger } from './transport-handling.js';
import { airCompressor, airTank, airManifold, cabinetFan, teachPendant, ionizer, operatorPc, safetyScanner } from './equipment.js';
import { analyticalBalance, autosampler, titrator, pipetteModule, pipetteTip, wasteCanister } from './equipment-lab.js';
import { labeler, upender, weighIndicator, airKnife, sprayLance, hotAirBlower, vacuumPump, storageTank,
  centrifugalPump, diaphragmPump, valve, transferCoupling } from './equipment-process.js';

export const MODELS = [
  // 機械手臂
  fanucR2000, densoVs068, densoVm60b1, cobottaPro900, densoHsr065, abbIrb360,
  // 輸送、供料
  conveyor, beltConveyor, edgeBeltConveyor, vRollerConveyor, stopper, ballTurntable, flexFeeder,
  // 搬運、物流、工件
  gantry, pallet, shuttleCar, shuttleRack, jibCrane, dolly, agvCharger, agvForklift, drum200l,
  // 視覺
  camera, visionCamera, codeReader, laserProfiler, barLight, domeLight,
  // 運動、夾持
  linearAxis, zThetaSpindle, nutrunner, drawerSlide, parallelGripper,
  // 氣動、氣動與公用
  airCylinder, pivotCylinder, slideTable, floatRod, suctionCup, vacuumEjector, solenoidValve, frl,
  airCompressor, airTank, airManifold,
  // 標準件
  motor, sensor, foot, gauge,
  // 指示與操作
  signalTower, hmi, estop, operatorPc,
  // 感測與安全
  boxSensor, lightCurtain, ftSensor, safetyScanner, rotaryEncoder, doorSwitch, loadCell,
  // 電控周邊
  cabinetFan, teachPendant,
  // 實驗室儀器
  analyticalBalance, autosampler, titrator, pipetteModule, pipetteTip, wasteCanister,
  // 製程設備
  labeler, upender, weighIndicator, airKnife, sprayLance, hotAirBlower, vacuumPump, storageTank,
  centrifugalPump, diaphragmPump, valve, transferCoupling, ionizer,
];
