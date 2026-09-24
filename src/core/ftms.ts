// Bluetooth FTMS (Fitness Machine Service) and Heart Rate byte formats.
// Pure encode/decode only — the Web Bluetooth plumbing lives in src/devices.
// Spec: Bluetooth SIG "Fitness Machine Service 1.0", §4.9 Indoor Bike Data, §4.16 Control Point.

export const FTMS_SERVICE = 0x1826;
export const INDOOR_BIKE_DATA = 0x2ad2;
export const FTMS_CONTROL_POINT = 0x2ad9;
export const HEART_RATE_SERVICE = 0x180d;
export const HEART_RATE_MEASUREMENT = 0x2a37;

export interface IndoorBikeData {
  speedKph?: number;
  cadence?: number;
  power?: number;
  heartRate?: number;
}

/** Parses an Indoor Bike Data notification. Fields appear in flag-bit order. */
export function parseIndoorBikeData(view: DataView): IndoorBikeData {
  const flags = view.getUint16(0, true);
  const has = (bit: number) => (flags & (1 << bit)) !== 0;
  const out: IndoorBikeData = {};
  let o = 2;

  // Bit 0 is inverted: "More Data" = 0 means Instantaneous Speed IS present.
  if (!has(0)) {
    out.speedKph = view.getUint16(o, true) / 100;
    o += 2;
  }
  if (has(1)) o += 2; // average speed
  if (has(2)) {
    out.cadence = view.getUint16(o, true) / 2;
    o += 2;
  }
  if (has(3)) o += 2; // average cadence
  if (has(4)) o += 3; // total distance (uint24)
  if (has(5)) o += 2; // resistance level
  if (has(6)) {
    out.power = view.getInt16(o, true);
    o += 2;
  }
  if (has(7)) o += 2; // average power
  if (has(8)) o += 5; // expended energy: total, per hour, per minute
  if (has(9)) {
    out.heartRate = view.getUint8(o);
    o += 1;
  }
  return out;
}

/** Parses a Heart Rate Measurement notification. */
export function parseHeartRate(view: DataView): number {
  const flags = view.getUint8(0);
  return flags & 0x01 ? view.getUint16(1, true) : view.getUint8(1);
}

// Control point op codes.
export const OP_REQUEST_CONTROL = 0x00;
export const OP_RESET = 0x01;
export const OP_SET_TARGET_POWER = 0x05;
export const OP_START_RESUME = 0x07;
export const OP_STOP_PAUSE = 0x08;
export const OP_SET_SIMULATION = 0x11;
export const OP_RESPONSE = 0x80;

export const requestControl = () => new Uint8Array([OP_REQUEST_CONTROL]);
export const startResume = () => new Uint8Array([OP_START_RESUME]);

/** ERG: hold this many watts regardless of cadence. */
export function setTargetPower(watts: number): Uint8Array<ArrayBuffer> {
  const buf = new DataView(new ArrayBuffer(3));
  buf.setUint8(0, OP_SET_TARGET_POWER);
  buf.setInt16(1, Math.round(watts), true);
  return new Uint8Array(buf.buffer);
}

export interface SimulationParams {
  gradePct: number;
  windMps?: number;
  crr?: number;
  cwKgPerM?: number;
}

/** SIM: resistance follows a virtual road; the rider controls power via gearing. */
export function setSimulation({ gradePct, windMps = 0, crr = 0.004, cwKgPerM = 0.51 }: SimulationParams): Uint8Array<ArrayBuffer> {
  const buf = new DataView(new ArrayBuffer(7));
  buf.setUint8(0, OP_SET_SIMULATION);
  buf.setInt16(1, Math.round(windMps * 1000), true);
  buf.setInt16(3, Math.round(gradePct * 100), true);
  buf.setUint8(5, Math.round(crr * 10000));
  buf.setUint8(6, Math.round(cwKgPerM * 100));
  return new Uint8Array(buf.buffer);
}

export interface ControlResponse {
  requestOp: number;
  /** 0x01 = success. */
  result: number;
}

export function parseControlResponse(view: DataView): ControlResponse | undefined {
  if (view.byteLength < 3 || view.getUint8(0) !== OP_RESPONSE) return undefined;
  return { requestOp: view.getUint8(1), result: view.getUint8(2) };
}
