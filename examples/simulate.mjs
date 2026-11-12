import { TripRecorder } from '../src/index.js';

/**
 * 演示：用合成数据跑一趟完整行程。
 * 运行：node examples/simulate.mjs
 */

const T0 = Date.UTC(2026, 0, 1, 8, 0, 0); // 08:00
const MIN = 60_000;

function frame({ at, gear, speed, powered, odometerKm, amps, lat, lng }) {
  return {
    timestamp: at,
    gear,
    speed,
    powered,
    odometerKm,
    batteryVoltageV: 350,
    batteryCurrentA: amps,
    location: lat == null ? undefined : { latitude: lat, longitude: lng },
    cumulativeEnergyKwh: 1200, // 云端累计电量：整数 kWh
  };
}

const recorder = new TripRecorder({
  onTripFinished: (trip) => console.log('trip finished:', JSON.stringify({
    startedAt: new Date(trip.startedAt).toISOString(),
    endedAt: new Date(trip.endedAt).toISOString(),
    distanceKm: trip.distanceKm,
    distanceSource: trip.distanceSource,
    energyKwh: trip.energyKwh,
    energySource: trip.energySource,
    points: trip.route.length,
  })),
});

// 1) 在家停着（建立基线）
recorder.observe(frame({ at: T0, gear: 'P', speed: 0, powered: false, odometerKm: 21_500, amps: 0 }));

// 2) 开车出门：20 分钟，12 km
let at = T0 + MIN;
let odo = 21_500;
for (let i = 0; i < 20; i += 1) {
  at += MIN;
  odo += 0.6;
  const p = i / 19;
  recorder.observe(frame({
    at,
    gear: 'D',
    speed: 34,
    powered: true,
    odometerKm: odo,
    amps: 45,
    lat: 24.9 + p * 0.06,
    lng: 102.7 + p * 0.05,
  }));
}

// 3) 到达：先停 2 分钟（不结束），再停到满 5 分钟以上
recorder.observe(frame({ at: at + 2 * MIN, gear: 'P', speed: 0, powered: false, odometerKm: 21_512, amps: 0 }));
console.log('trips after 2 minutes parked:', recorder.list().length);

recorder.observe(frame({ at: at + 8 * MIN, gear: 'P', speed: 0, powered: false, odometerKm: 21_512, amps: 0 }));
console.log('trips after 8 minutes parked:', recorder.list().length);
