// 場景裡的市購品 ↔ 元件庫編號（bom 檢查用編號比對成本表 .studio/plan/bom.json）。
// 沿用的元件寫既有編號；新元件在 vs3d assess --repo import 時取得編號（2026-11-26 匯入）。
export const REF = {
  scara: 'P-00205',        // DENSO HSR065＋RC8A
  conveyor: 'P-00164',     // SMT 邊皮帶輸送模組
  stopper: 'P-00112',      // 頂升定位與止擋（自製平台＋SMC 元件）
  cylinder: 'P-00112',
  trayAxis: 'P-00051',     // 電動滑台（Tray 抽屜）
  lockX: 'P-00051',        // 電動滑台（鎖附 X 軸）
  profiler: 'P-00047',     // 3D 線雷射（底面 PIN，FOV 25～32.5 mm）
  profilerTop: 'P-00279',  // 新元件：大視野 3D 線雷射（頂面 PIN，FOV ≥ 95 mm）
  camTop: 'P-00035',       // 20 MP 相機（Tray 上面外觀）
  camUp: 'P-00101',        // 20 MP 相機（上視覆拍）
  bar: 'P-00270',          // 條形光
  ionizer: 'P-00219',      // 離子風嘴
  nutrunner: 'P-00282',    // 新元件：伺服電動起子（扭力／角度／轉數紀錄）
  slide: 'P-00210',        // 氣動滑台（壓持、雙頭切換）
  tower: 'P-00084',        // 三色燈
  hmi: 'P-00221',          // HMI
};
