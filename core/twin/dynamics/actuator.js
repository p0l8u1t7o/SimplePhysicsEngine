// 致動器的運動學模型（與假 SPE 的 ActuatorSimModel 相同）：行程比例 0..1 依 travelTime 線性變化；
// 只有停在端點時 state 才是 states[0]／states[1]，移動中與中間位置為 null。actuatorStuck 生效時卡在 stuck 的比例。
import { targetOf, travelTimeOf } from '../md.js';

// md：indexMd 的致動器（已補上 actions／states）；pos：初始行程比例
export function createActuator(md, pos = 0) {
  return {
    md, pos, from: pos, target: pos, startUs: 0, travelUs: 0, moving: false,
    stuck: null,        // actuatorStuck：卡住的比例（null = 沒有卡住）
    // 往 target 移動，全行程時間 travelUs；同一目標不重來
    drive(target, travelUs, nowUs) {
      if (this.moving && this.target === target) return;
      if (!this.moving && this.pos === target) return;
      this.from = this.pos; this.target = target; this.startUs = nowUs;
      // 剩餘距離比例 × 全行程時間（整數 µs，進位）
      this.travelUs = Math.ceil(Math.abs(target - this.pos) * travelUs);
      this.moving = this.travelUs > 0;
      if (!this.moving) this.pos = target;
    },
    update(tUs) {
      if (this.stuck !== null) { this.pos = this.stuck; this.moving = false; return; }
      if (!this.moving) return;
      const elapsed = tUs - this.startUs;
      if (elapsed >= this.travelUs) { this.pos = this.target; this.moving = false; return; }
      this.pos = this.from + (this.target - this.from) * (elapsed / this.travelUs);
    },
    get stateName() { return this.moving ? null : this.pos === 0 ? md.states[0] : this.pos === 1 ? md.states[1] : null; },
    state() { return { pos: this.pos, state: this.stateName, fault: null }; },
  };
}

// 數位輸出改變 → 驅動的致動器（machine-description README §7）：ON 執行 drives.action；
// solenoid single／none 的 OFF 彈簧復歸到 states[0]（行程比例 0），行程時間取回到 0 的動作（沒有則同一動作）
export function driveFromOutput(actuator, action, on, nowUs) {
  const md = actuator.md, target = targetOf(md, action);
  if (target === null) return;
  if (on) { actuator.update(nowUs); actuator.drive(target, Math.round(travelTimeOf(md, action) * 1e6), nowUs); return; }
  const solenoid = md.solenoid ?? 'single';
  if (solenoid !== 'single' && solenoid !== 'none') return;
  const back = md.actions.find(a => targetOf(md, a) === 0) ?? action;
  actuator.update(nowUs); actuator.drive(0, Math.round(travelTimeOf(md, back) * 1e6), nowUs);
}
