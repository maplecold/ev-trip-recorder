/**
 * 车辆运动状态判定。
 *
 * 输入是一帧「标准化遥测」，字段与具体车厂无关：
 *
 * @typedef {Object} Telemetry
 * @property {number}  timestamp     采集时间（毫秒）
 * @property {string}  [gear]        挡位：'P' | 'D' | 'R' | 'N' | '1' | '3' ...
 * @property {number}  [speed]       车速 km/h
 * @property {boolean} [powered]     整车是否上电
 * @property {number}  [odometerKm]  里程表（公里，通常整数）
 * @property {number}  [batteryVoltageV]
 * @property {number}  [batteryCurrentA] 放电为正、充电为负
 * @property {{latitude:number, longitude:number}} [location]
 * @property {number}  [cumulativeEnergyKwh] 云端累计充电/放电电量（整数 kWh 也可）
 */

const DRIVING_GEARS = new Set(['D', 'R', '1', '3']);
const PARKED_GEARS = new Set(['P', 'PARK', '0']);

/**
 * 判断一帧是「行驶」还是「驻车」。
 *
 * 顺序和车机主页一致：挡位优先，其次车速，最后电源状态。
 * 之所以不只看挡位：部分车型没有 P 挡，或挡位信号缺失。
 *
 * @param {Telemetry} frame
 * @returns {'driving'|'parked'}
 */
export function classifyMotion(frame) {
  const gear = String(frame?.gear ?? '').trim().toUpperCase();
  if (PARKED_GEARS.has(gear)) return 'parked';
  if (DRIVING_GEARS.has(gear)) return 'driving';

  const speed = Number(frame?.speed);
  if (Number.isFinite(speed) && speed > 0 && speed < 1000) return 'driving';

  // 没有挡位/车速信息时，用电源状态兜底：整车下电一定不是行驶。
  if (frame?.powered === false) return 'parked';
  return 'parked';
}

/**
 * 采样间隔建议（按场景分开，实测值）：
 *   - 行驶中：10 秒（越密越好；里程与能耗的积分误差随间隔线性变大）
 *   - 驻车但仍在记录：30 秒（用来确认「驻车满 5 分钟」）
 *   - 长时间驻车：120 秒（省电、省请求）
 */
export const POLLING = Object.freeze({
  drivingMs: 10_000,
  parkedMs: 120_000,
  parkedWithRecordingMs: 30_000,
});
