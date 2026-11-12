/**
 * 能耗估算。
 *
 * 电动车有两条互相独立的电量来源：
 *
 * 1. **云端累计电量**（`cumulativeEnergyKwh`）：整数 kWh，长期无偏，但分辨率太粗；
 *    0.7 km 的短途真实耗电可能只有 0.3 kWh，整数差值会把它算成 0 或 1。
 * 2. **电压 × 电流积分**：有小数精度，但受采样间隔、采样时机（漏掉起步/急加速）影响，
 *    通常有 5%–15% 的系统偏差。
 *
 * 策略：短途用积分值（乘一个学到的修正系数），长途直接信累计差值；
 * 两者都可用时，用长途样本反过来标定积分偏差。
 */

/** 梯形法积分：把每两帧之间的瞬时功率积成电量（kWh）。 */
export function integrateEnergy(previous, current) {
  if (!previous || !current) return { kwh: 0, coveredMs: 0 };
  const p1 = powerW(previous);
  const p2 = powerW(current);
  const elapsedMs = Math.max(0, Number(current.timestamp) - Number(previous.timestamp));
  if (!Number.isFinite(p1) || !Number.isFinite(p2) || elapsedMs <= 0) return { kwh: 0, coveredMs: 0 };
  const kwh = ((p1 + p2) / 2) * (elapsedMs / 3_600_000) / 1000;
  return { kwh: Math.max(0, kwh), coveredMs: elapsedMs };
}

/** 瞬时功率（瓦）。放电为正。 */
export function powerW(frame) {
  const v = Number(frame?.batteryVoltageV);
  const a = Number(frame?.batteryCurrentA);
  if (!Number.isFinite(v) || !Number.isFinite(a)) return NaN;
  return v * a;
}

/** 修正系数限制在合理范围，避免个别异常行程把系数带跑。 */
export function clampCalibration(factor) {
  if (!Number.isFinite(factor) || factor <= 0) return 1;
  return Math.min(1.4, Math.max(0.7, factor));
}

/** 用最近若干条比例的**中位数**作为修正系数（抗单次异常）。 */
export function medianCalibration(samples = []) {
  if (!Array.isArray(samples) || samples.length === 0) return 1;
  const sorted = samples.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * 累计差值是否可信：按百公里电耗做物理合理性检查。
 *
 * 短途开空调时 40+ kWh/100km 是正常的，所以上限放到 80；
 * 只拦「2 公里却差 6 度」这种数量级错误（那是 300 kWh/100km）。
 */
export function isPlausibleCumulative({ deltaKwh, distanceKm }) {
  const km = Number(distanceKm);
  if (!Number.isFinite(distanceKm) || km <= 0.3) return true; // 没有可靠里程时不作判断
  const per100 = (deltaKwh / km) * 100;
  return per100 >= 1 && per100 <= 80;
}
