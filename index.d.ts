/**
 * Type definitions for ev-trip-recorder.
 */

/** A normalized telemetry frame. Feed one every ~30 s while driving. */
export interface TelemetryFrame {
  /** Capture time in milliseconds. */
  timestamp: number;
  /** Gear: 'P' | 'D' | 'R' | 'N' | '1' | '3' ... */
  gear?: string;
  /** Vehicle speed in km/h. */
  speed?: number;
  /** Whether the vehicle is powered on. */
  powered?: boolean;
  /** Odometer in km (usually an integer in the cloud API). */
  odometerKm?: number;
  /** Pack voltage in volts. */
  batteryVoltageV?: number;
  /** Pack current in amps; positive while discharging. */
  batteryCurrentA?: number;
  /** Position, when available. */
  location?: { latitude: number; longitude: number };
  /** Lifetime cumulative energy counter from the cloud (kWh). */
  cumulativeEnergyKwh?: number;
}

export interface RoutePoint {
  latitude: number;
  longitude: number;
  timestamp: number;
  speedKmh: number | null;
}

export type DistanceSource = 'ODOMETER' | 'GPS' | 'NONE';
export type EnergySource = 'INTEGRATED' | 'CUMULATIVE_DELTA' | 'UNAVAILABLE';
export type Completeness = 'COMPLETE' | 'PARTIAL';

export interface Trip {
  tripId: string;
  /** Trip start, ms epoch. */
  startedAt: number;
  /** Trip end = the moment the vehicle first appeared parked. */
  endedAt: number;
  durationMinutes: number;
  distanceKm: number | null;
  distanceSource: DistanceSource;
  gpsDistanceMeters: number;
  energyKwh: number | null;
  energySource: EnergySource;
  completeness: Completeness;
  maxFrameGapMs: number;
  route: RoutePoint[];
}

export interface RecorderOptions {
  /** Continuous parked time required to finish a trip. Default 5 minutes. */
  stableParkingMs?: number;
  /** Frame gap that marks the trip PARTIAL. Default 10 minutes. */
  frameGapMs?: number;
  /** Minimum spacing between stored route points, in meters. Default 8. */
  routeMinSpacingMeters?: number;
  /** Retention window in days. Default 30. */
  retainDays?: number;
  /** Minimum electrical coverage ratio to trust integration. Default 0.5. */
  minElectricalCoverageRatio?: number;
  /** Optional persistence container. */
  store?: { trips: Trip[]; runtime: Record<string, unknown>; save?: () => void };
  /** Called once per finished trip. */
  onTripFinished?: (trip: Trip) => void;
}

export interface ObserveResult {
  started?: { tripId: string; startedAt: number };
  finished?: Trip;
}

export type Motion = 'driving' | 'parked';

export declare class TripRecorder {
  constructor(options?: RecorderOptions);
  observe(frame: TelemetryFrame): ObserveResult;
  list(): Trip[];
  cleanup(now?: number): void;
}

export declare function classifyMotion(frame: TelemetryFrame): Motion;

export declare function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number;

export declare function pathLengthMeters(
  points: Array<{ latitude: number; longitude: number }>
): number;

export declare function fuseDistance(input: {
  odometerKm: number | null;
  gpsMeters: number;
  hasFrameGap?: boolean;
}): { distanceKm: number | null; source: DistanceSource };

export declare function simplifyByDistance<T extends { latitude: number; longitude: number }>(
  points: T[],
  minSpacingMeters?: number
): T[];

export declare function integrateEnergy(
  previous: TelemetryFrame,
  current: TelemetryFrame
): { kwh: number; coveredMs: number };

export declare function powerW(frame: TelemetryFrame): number;

export declare function clampCalibration(factor: number): number;

export declare function medianCalibration(samples?: number[]): number;

export declare function isPlausibleCumulative(input: {
  deltaKwh: number;
  distanceKm: number | null;
}): boolean;

export declare const POLLING: Readonly<{
  drivingMs: number;
  parkedMs: number;
  parkedWithRecordingMs: number;
}>;

export declare const DEFAULTS: Readonly<{
  stableParkingMs: number;
  frameGapMs: number;
  routeMinSpacingMeters: number;
  retainDays: number;
  minElectricalCoverageRatio: number;
}>;
