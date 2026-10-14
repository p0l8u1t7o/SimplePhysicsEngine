// 顯示狀態只取樣既有排程；不改寫事件、車輛腿段或 EMS 數值。
import { easeInOut } from './paths.js';

export const clamp = u => Math.max(0, Math.min(1, u));
export function wheelTravel(legs, t) {
  let distance = 0;
  for (const leg of legs) {
    const u = clamp((t - leg.t0) / (leg.t1 - leg.t0));
    distance += ((leg.s1 ?? leg.path.length) - (leg.s0 ?? 0)) * (leg.ease || easeInOut)(u) * (leg.path.reverse ? -1 : 1);
  }
  return distance;
}

export function transactionAt(H, t, session) {
  if (t < H.tPark || t > H.t1) return '';
  if (t < H.plugT) return '確認費率（示意）';
  if (t < H.plugT + .45) return '授權';
  if (t < H.plugT + 1.05) return '啟動成功';
  if (t >= H.unplugT || session?.frac >= .995) return '完成';
  return session?.p > .05 ? '充電中' : '排程等待';
}

// 車載電池容量與起始 SOC 未建模；只以固定 60 kWh／30% 作顯示假設。
export const displaySoc = got => Math.min(100, 30 + got / 60 * 100);
