import test from 'node:test';
import assert from 'node:assert/strict';
import { TripRecorder, classifyMotion, fuseDistance, integrateEnergy, isPlausibleCumulative } from '../src/index.js';

const T0 = 1_800_000_000_000;

function frame(overrides = {}) {
  return {
    timestamp: T0,
    gear: 'P',
    speed: 0,
    powered: false,
    odometerKm: 1000,
    batteryVoltageV: 350,
    batteryCurrentA: 0,
    location: { latitude: 24.9, longitude: 102.7 },
    ...overrides,
  };
}

test('parked/driving: gear first, then speed, then power state', () => {
  assert.equal(classifyMotion(frame({ gear: 'P', speed: 30 })), 'parked');
  assert.equal(classifyMotion(frame({ gear: 'D', speed: 0 })), 'driving');
  assert.equal(classifyMotion(frame({ gear: '', speed: 20 })), 'driving');
  assert.equal(classifyMotion(frame({ gear: '', speed: 0, powered: false })), 'parked');
});

test('full trip: start -> 5 min parked -> finish', () => {
  const recorder = new TripRecorder();
  recorder.observe(frame({ timestamp: T0, gear: 'P' }));
  recorder.observe(frame({ timestamp: T0 + 10_000, gear: 'D', speed: 40, powered: true, odometerKm: 1000 }));

  for (let i = 1; i <= 20; i += 1) {
    recorder.observe({
      timestamp: T0 + 10_000 + i * 60_000,
      gear: 'D',
      speed: 36,
      powered: true,
      odometerKm: 1000 + i * 0.6,
      batteryVoltageV: 350,
      batteryCurrentA: 40,
      location: { latitude: 24.9 + i * 0.002, longitude: 102.7 + i * 0.002 },
    });
  }

  recorder.observe(frame({ timestamp: T0 + 30 * 60_000, odometerKm: 1012 }));
  assert.equal(recorder.list().length, 0, 'not finished before the parking windows elapses');

  recorder.observe(frame({ timestamp: T0 + 36 * 60_000, odometerKm: 1012 }));
  const trips = recorder.list();
  assert.equal(trips.length, 1);
  assert.equal(trips[0].distanceKm, 12);
  assert.equal(trips[0].distanceSource, 'ODOMETER');
  assert.equal(trips[0].endedAt, T0 + 30 * 60_000);
});

test('restarting during the parking window keeps a single trip', () => {
  const recorder = new TripRecorder();
  recorder.observe(frame({ timestamp: T0, gear: 'P', odometerKm: 100 }));
  recorder.observe(frame({ timestamp: T0 + 1_000, gear: 'D', speed: 30, odometerKm: 100 }));
  recorder.observe(frame({ timestamp: T0 + 2 * 60_000, gear: 'P', odometerKm: 101 }));
  assert.equal(recorder.list().length, 0);
  recorder.observe(frame({ timestamp: T0 + 3 * 60_000, gear: 'D', speed: 30, odometerKm: 101 }));
  recorder.observe(frame({ timestamp: T0 + 12 * 60_000, gear: 'P', odometerKm: 105 }));
  recorder.observe(frame({ timestamp: T0 + 18 * 60_000, gear: 'P', odometerKm: 105 }));
  assert.equal(recorder.list().length, 1);
  assert.equal(recorder.list()[0].distanceKm, 5);
});

test('short trip: falls back to the GPS length when the odometer reads 0', () => {
  const { distanceKm, source } = fuseDistance({ odometerKm: 0, gpsMeters: 720 });
  assert.equal(distanceKm, 0.7);
  assert.equal(source, 'GPS');
});

test('short trip: GPS keeps the decimal when it agrees with the odometer', () => {
  const { distanceKm } = fuseDistance({ odometerKm: 1, gpsMeters: 810 });
  assert.equal(distanceKm, 0.8);
});

test('long trip: odometer wins (GPS loses points in tunnels)', () => {
  const { distanceKm, source } = fuseDistance({ odometerKm: 35, gpsMeters: 30_000 });
  assert.equal(distanceKm, 35);
  assert.equal(source, 'ODOMETER');
});

test('energy integration: trapezoid over power and time', () => {
  const a = frame({ timestamp: T0, batteryVoltageV: 400, batteryCurrentA: 0 });
  const b = frame({ timestamp: T0 + 3_600_000, batteryVoltageV: 400, batteryCurrentA: 25 });
  const { kwh } = integrateEnergy(a, b);
  assert.ok(Math.abs(kwh - 5) < 0.01, 'expected about 5 kWh');
});

test('cumulative delta plausibility gate', () => {
  assert.equal(isPlausibleCumulative({ deltaKwh: 6, distanceKm: 2 }), false);
  assert.equal(isPlausibleCumulative({ deltaKwh: 0.23, distanceKm: 0.8 }), true);
  assert.equal(isPlausibleCumulative({ deltaKwh: 6, distanceKm: 40 }), true);
});

test('frame gap marks the trip PARTIAL', () => {
  const recorder = new TripRecorder();
  recorder.observe(frame({ timestamp: T0, gear: 'P' }));
  recorder.observe(frame({ timestamp: T0 + 1_000, gear: 'D', speed: 30, odometerKm: 100 }));
  recorder.observe(frame({ timestamp: T0 + 30 * 60_000, gear: 'D', speed: 30, odometerKm: 120 }));
  recorder.observe(frame({ timestamp: T0 + 40 * 60_000, gear: 'P', odometerKm: 121 }));
  recorder.observe(frame({ timestamp: T0 + 46 * 60_000, gear: 'P', odometerKm: 121 }));
  assert.equal(recorder.list()[0].completeness, 'PARTIAL');
});
