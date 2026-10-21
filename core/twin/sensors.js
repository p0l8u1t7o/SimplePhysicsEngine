// 虛擬感測器 → 感測器輸出（套用 sensorStuck 與 io.logic 之前的值；twin-protocol README §6「sensorStuck 的值」）。
//   有 actuator＋at（reed、limitSwitch、inPosition…）   致動器停在端點且 state 等於 at（移動中、中間位置都是 OFF）
//   有 axis＋axisWindow                                    軸位置在視窗內（含端點）
//   vacuumSwitch                                           吸盤致動器在 at（預設 states[1]，例 held）且吸盤上有工件
//                                                          （工件的持有者是該致動器的 scene.object）；沒有 actuator 時交給站的 sense
//   photoEye、proximity                                    幾何：交給站的 sense(sensor)（core/twin/geometry.js 的射線／區域判定）
//   pressureSwitch                                         站的設定值，預設 ON；levelSwitch 與其他預設 OFF
// 站的 switches（config.switches）可以固定任何感測器的輸出。
export function sensorOutput(sensor, { actuators, axes, switches = {}, sense, workpieces = [] }) {
  if (Object.hasOwn(switches, sensor.id)) return !!switches[sensor.id];
  if (sensor.type === 'vacuumSwitch' && sensor.actuator) {
    const a = actuators.get(sensor.actuator);
    if (!a || a.stateName !== (sensor.at ?? a.md.states[1])) return false;
    const holder = a.md.scene?.object;
    return !holder || workpieces.some(w => w.holder === holder);
  }
  if (sensor.actuator && sensor.at !== undefined) {
    const a = actuators.get(sensor.actuator);
    return !!a && a.stateName === sensor.at;
  }
  if (sensor.axis && Array.isArray(sensor.axisWindow)) {
    const ax = axes.get(sensor.axis), w = sensor.axisWindow;
    return !!ax && w.length === 2 && ax.pos >= w[0] && ax.pos <= w[1];
  }
  switch (sensor.type) {
    case 'photoEye':
    case 'proximity':
    case 'vacuumSwitch':
      return sense ? !!sense(sensor) : false;
    case 'pressureSwitch':
      return true;
    default:
      return false;
  }
}

// 要套用場景才能判定的感測器（沒有致動器或軸可以看的幾何類）
export const isGeometric = s => (s.type === 'photoEye' || s.type === 'proximity' || s.type === 'vacuumSwitch') && !s.actuator && !s.axis;
