/**
 * 地理与里程工具：全部为纯函数，不依赖任何地图服务。
 */

const EARTH_RADIUS_M = 6_371_008.8;

/** 两点间大圆距离（米）。 */
export function haversineMeters(a, b) {
  if (!a || !b) return 0;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = lat2 - lat1;
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 折线总长（米）。 */
export function pathLengthMeters(points = []) {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversineMeters(points[i - 1], points[i]);
  return total;
}

/**
 * 里程融合：不同来源各有盲区，按场景选一个可信的。
 *
 * - 里程表：整数公里，长途准确、抗断帧，但 1 km 分辨率让短途直接归零；
 * - GPS 轨迹：有小数精度，短途准确，但隧道/高架会漏点，静止时还会漂移。
 *
 * @param {Object} input
 * @param {number|null} input.odometerKm   里程表差值（结束 − 开始）
 * @param {number} input.gpsMeters         GPS 轨迹长度
 * @param {boolean} input.hasFrameGap      中途是否有长时间断帧
 * @returns {{distanceKm:number|null, source:'ODOMETER'|'GPS'|'NONE'}}
 */
export function fuseDistance({ odometerKm, gpsMeters, hasFrameGap = false }) {
  const odo = Number.isFinite(odometerKm) ? odometerKm : null;
  const gpsKm = Number(gpsMeters) / 1000;
  const odoResolved = odo !== null && odo >= 0.5;
  const gpsResolved = Number.isFinite(gpsKm) && gpsKm >= 0.3;

  // 长途：里程表最可靠。
  if (odo !== null && odo >= 3) return { distanceKm: odo, source: 'ODOMETER' };

  // 短途：两者相差在一个"公里刻度"以内时，GPS 的小数更接近真实值。
  if (odoResolved && gpsResolved && Math.abs(gpsKm - odo) <= 1.0 && !hasFrameGap) {
    return { distanceKm: round(gpsKm, 1), source: 'GPS' };
  }
  if (odoResolved) return { distanceKm: odo, source: 'ODOMETER' };
  if (gpsResolved) return { distanceKm: round(gpsKm, 1), source: 'GPS' };

  return { distanceKm: odo, source: odo === null ? 'NONE' : 'ODOMETER' };
}

/**
 * 轨迹抽稀：按距离间隔保留点，避免存储与渲染压力。
 * 首尾点永远保留。
 */
export function simplifyByDistance(points = [], minSpacingMeters = 15) {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    if (haversineMeters(out[out.length - 1], points[i]) >= minSpacingMeters) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

function toRad(deg) {
  return (Number(deg) * Math.PI) / 180;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
