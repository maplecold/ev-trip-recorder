import { classifyMotion } from './policy.js';
import { haversineMeters, pathLengthMeters, fuseDistance, simplifyByDistance } from './geo.js';
import { integrateEnergy, clampCalibration, medianCalibration, isPlausibleCumulative } from './energy.js';

/**
 * 琛岀▼褰曞埗鍣細鍚冦€屾爣鍑嗗寲閬ユ祴甯с€嶏紝鍚愩€岃绋嬭褰曘€嶃€? *
 * 鍒ゅ畾娴佺▼锛堟牳蹇冨彧鏈変袱鏉¤鍒欙級锛? *
 *   1) 浠€涔堟椂鍊欏紑濮嬶細绗竴甯у垽瀹氫负銆岃椹躲€嶁啋 绔嬪埢寮€濮嬩竴娈佃绋嬶紱
 *   2) 浠€涔堟椂鍊欑粨鏉燂細鍒ゅ畾涓恒€岄┗杞︺€嶅悗锛?*杩炵画椹昏溅婊?N 鍒嗛挓**涓旀湡闂存病鏈夎椹跺抚鎵嶇畻缁撴潫锛? *      缁撴潫鏃堕棿鍙栥€屽垰寮€濮嬮┗杞﹂偅涓€鍒汇€嶏紝涓嶆妸绛夊緟鐨?N 鍒嗛挓绠楄繘琛岀▼鏃堕暱銆? *
 * 瑙勫垯 2 鏄繖濂楃畻娉曟渶閲嶈鐨勮璁★細鍙湅涓€甯у氨缁撴潫鐨勮瘽锛岀瓑绾㈢伅銆佽矾杈逛笅浜? * 浼氭妸涓€瓒熻矾鍒囨垚濂藉嚑娈碉紙鎴戜滑鏈€鍒濆氨鏄繖鏍凤紝涓€澶╄兘鍒囧嚭涓冨叓娈碉級銆? */
export const DEFAULTS = Object.freeze({
  /** 杩炵画椹昏溅澶氫箙绠楃湡鐨勫仠杞︼紙姣锛夈€?*/
  stableParkingMs: 5 * 60_000,
  /** 鐩搁偦涓ゅ抚闂撮殧瓒呰繃杩欎釜鍊艰涓恒€屾柇甯с€嶏紙姣锛夈€?*/
  frameGapMs: 10 * 60_000,
  /** 杞ㄨ抗鐐规渶灏忛棿璺濓紙绫筹級锛屽お杩戠殑鐐逛細琚涪鎺夈€?*/
  routeMinSpacingMeters: 8,
  /** 琛岀▼淇濈暀澶╂暟锛堟竻鐞嗙敤锛夈€?*/
  retainDays: 30,
  /** 绉垎瑕嗙洊鐜囦綆浜庤繖涓瘮渚嬫椂锛屼笉閲囦俊绉垎鑳借€楋紙0~1锛夈€?*/
  minElectricalCoverageRatio: 0.5,
});

export class TripRecorder {
  /**
   * @param {Object} [options]
   * @param {number} [options.stableParkingMs]
   * @param {number} [options.frameGapMs]
   * @param {(trip:Object)=>void} [options.onTripFinished]
   * @param {Object} [options.store] 鍙€夛細{ trips, runtime, save } 褰㈠紡鐨勬寔涔呭寲瀹瑰櫒
   */
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.onTripFinished = options.onTripFinished ?? null;
    this.store = options.store ?? { trips: [], runtime: {} };
    this.store.trips ??= [];
    this.store.runtime ??= {};
    this.active = this.store.runtime.active ?? null;
    this.baseline = this.store.runtime.baseline ?? null;
    this.cumulativeEnergy = this.store.runtime.cumulativeEnergy ?? null;
    this.calibration = this.store.runtime.energyCalibration ?? { samples: [], factor: 1 };
  }

  /**
   * 鍠備竴甯ч仴娴嬨€?   *
   * @param {import('./policy.js').Telemetry} frame
   * @returns {{started?:Object, finished?:Object}}
   */
  observe(frame) {
    const result = {};
    if (!frame || !Number.isFinite(Number(frame.timestamp))) return result;

    const motion = classifyMotion(frame);
    const timestamp = Number(frame.timestamp);

    if (Number.isFinite(Number(frame.cumulativeEnergyKwh))) {
      this.cumulativeEnergy = { kwh: Number(frame.cumulativeEnergyKwh), timestamp };
      this.store.runtime.cumulativeEnergy = this.cumulativeEnergy;
    }

    if (motion === 'parked') {
      if (this.active) this.handleParkedFrame(frame);
      else this.baseline = { frame, timestamp };
      this.persist();
      return result;
    }

    if (!this.active) {
      result.started = this.startTrip(frame);
      this.persist();
      return result;
    }

    // 刚恢复行驶：中间那段驻车不计入能耗积分
    if (this.active.pendingParkingAt) {
      this.active.pendingParkingAt = null;
      this.active.lastFrame = frame;
      this.active.lastAt = timestamp;
      this.appendPoint(frame);
      this.persist();
      return result;
    }

    this.appendFrame(frame);
    this.persist();
    return result;
  }

  startTrip(frame) {
    const timestamp = Number(frame.timestamp);
    const start = this.baseline?.frame ?? frame;
    this.active = {
      tripId: randomId(),
      startedAt: timestamp,
      startFrame: start,
      route: [],
      lastFrame: frame,
      lastAt: timestamp,
      pendingParkingAt: null,
      integratedKwh: 0,
      integratedCoveredMs: 0,
      maxGapMs: 0,
      startCumulativeKwh: Number.isFinite(this.cumulativeEnergy?.kwh) ? this.cumulativeEnergy.kwh : null,
      calibrationFactor: clampCalibration(this.calibration.factor ?? 1),
    };
    this.appendPoint(start);
    this.appendPoint(frame);
    this.baseline = null;
    this.store.runtime.active = this.active;
    return { tripId: this.active.tripId, startedAt: timestamp };
  }

  handleParkedFrame(frame) {
    const timestamp = Number(frame.timestamp);

    if (!this.active.pendingParkingAt) {
      this.active.pendingParkingAt = timestamp;
      this.active.lastAt = timestamp;
      return;
    }

    // 鏈熼棿娌℃湁琛岄┒甯э紝涓旈┗杞﹀凡鎸佺画瓒冲涔?鈫?缁撶畻
    const parkedMs = timestamp - this.active.pendingParkingAt;
    if (parkedMs >= this.options.stableParkingMs) {
      const trip = this.finishTrip(frame);
      if (trip) this.onTripFinished?.(trip);
    }
  }

  appendFrame(frame) {
    const timestamp = Number(frame.timestamp);
    const gap = this.active.lastAt ? timestamp - this.active.lastAt : 0;
    if (gap > this.options.frameGapMs) this.active.maxGapMs = Math.max(this.active.maxGapMs, gap);

    // 琛岄┒甯у埌杈?鈫?鍙栨秷"寰呯‘璁ら┗杞?
    this.active.pendingParkingAt = null;

    const energy = integrateEnergy(this.active.lastFrame, frame);
    if (energy.coveredMs > 0) {
      this.active.integratedKwh += energy.kwh;
      this.active.integratedCoveredMs += energy.coveredMs;
    }

    this.appendPoint(frame);
    this.active.lastFrame = frame;
    this.active.lastAt = timestamp;
  }

  appendPoint(frame) {
    const location = frame?.location;
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return;
    const last = this.active.route[this.active.route.length - 1];
    if (last && haversineMeters(last, location) < this.options.routeMinSpacingMeters) return;
    this.active.route.push({ ...location, timestamp: Number(frame.timestamp), speedKmh: frame.speed ?? null });
  }

  finishTrip(endFrame) {
    const active = this.active;
    if (!active) return null;

    const endedAt = active.pendingParkingAt ?? Number(endFrame.timestamp);
    const durationMs = Math.max(0, endedAt - active.startedAt);
    const gpsMeters = pathLengthMeters(active.route);
    const odometerKm = Number.isFinite(active.startFrame?.odometerKm) && Number.isFinite(endFrame?.odometerKm)
      ? Number(endFrame.odometerKm) - Number(active.startFrame.odometerKm)
      : null;
    const hasFrameGap = active.maxGapMs > this.options.frameGapMs;

    const { distanceKm, source } = fuseDistance({ odometerKm, gpsMeters, hasFrameGap });

    // Energy: use the integrated value, overridden by a trustworthy cumulative delta.
    const coverage = durationMs > 0 ? active.integratedCoveredMs / durationMs : 0;
    const rawIntegrated = coverage >= this.options.minElectricalCoverageRatio && active.integratedKwh > 0.001
      ? active.integratedKwh
      : null;
    const calibratedIntegrated = rawIntegrated === null
      ? null
      : round(rawIntegrated * clampCalibration(active.calibrationFactor), 3);

    let energyKwh = calibratedIntegrated;
    let energySource = calibratedIntegrated === null ? 'UNAVAILABLE' : 'INTEGRATED';

    const delta = Number.isFinite(this.cumulativeEnergy?.kwh) && Number.isFinite(active.startCumulativeKwh)
      ? this.cumulativeEnergy.kwh - active.startCumulativeKwh
      : null;

    if (delta !== null && delta > 0 && isPlausibleCumulative({ deltaKwh: delta, distanceKm })) {
      energyKwh = round(delta, 3);
      energySource = 'CUMULATIVE_DELTA';
      this.learnCalibration(delta, rawIntegrated, distanceKm);
    }

    const trip = {
      tripId: active.tripId,
      startedAt: active.startedAt,
      endedAt,
      durationMinutes: Math.round(durationMs / 60_000),
      distanceKm,
      distanceSource: source,
      gpsDistanceMeters: Math.round(gpsMeters),
      energyKwh,
      energySource,
      completeness: hasFrameGap ? 'PARTIAL' : 'COMPLETE',
      maxFrameGapMs: active.maxGapMs,
      route: simplifyByDistance(active.route, this.options.routeMinSpacingMeters),
    };

    this.store.trips.push(trip);
    this.active = null;
    this.store.runtime.active = null;
    this.baseline = { frame: endFrame, timestamp: endedAt };
    this.cleanup(Date.now());
    this.persist();
    return trip;
  }

  /** 闀块€旓紙鈮? km锛夋椂锛岀敤绱宸€?/ 绉垎鍊?寰楀埌涓€涓瘮渚嬫牱鏈€?*/
  learnCalibration(deltaKwh, integratedKwh, distanceKm) {
    if (!Number.isFinite(integratedKwh) || integratedKwh <= 0.2) return;
    if (!Number.isFinite(distanceKm) || distanceKm < 2) return;
    const ratio = deltaKwh / integratedKwh;
    if (ratio < 0.4 || ratio > 2.5) return;
    const samples = Array.isArray(this.calibration.samples) ? this.calibration.samples.slice() : [];
    samples.push(round(ratio, 3));
    while (samples.length > 20) samples.shift();
    this.calibration = { samples, factor: round(medianCalibration(samples), 3) };
    this.store.runtime.energyCalibration = this.calibration;
  }

  /** 鍒犻櫎瓒呰繃淇濈暀鏈熺殑琛岀▼銆?*/
  cleanup(now = Date.now()) {
    const cutoff = now - this.options.retainDays * 24 * 60 * 60_000;
    this.store.trips = this.store.trips.filter((trip) => Number(trip.startedAt) >= cutoff);
  }

  /** 鍙鍒楄〃锛堟寜鏃堕棿鍊掑簭锛夈€?*/
  list() {
    return this.store.trips.slice().sort((a, b) => b.startedAt - a.startedAt);
  }

  persist() {
    this.store.runtime.active = this.active;
    this.store.runtime.baseline = this.baseline;
    this.store.runtime.cumulativeEnergy = this.cumulativeEnergy;
    this.store.runtime.energyCalibration = this.calibration;
    this.store.save?.();
  }
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function randomId() {
  return `trip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
