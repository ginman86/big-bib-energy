// Bluetooth Cycling Power Service (CPS) decoding, plus Wahoo's proprietary trainer
// control extension that older KICKRs expose inside CPS instead of FTMS.
// Wahoo's protocol is undocumented; encodings match GoldenCheetah (BT40Device.cpp)
// and Auuki (src/ble/wcps/control-point.js).

export const CYCLING_POWER_SERVICE = 0x1818;
export const CYCLING_POWER_MEASUREMENT = 0x2a63;
export const WAHOO_CONTROL = 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b';

export interface CyclingPower {
  power: number;
  /** Cumulative crank revolutions and last crank event time (1/1024 s), both uint16. */
  crank?: { revs: number; time: number };
}

/** Parses a Cycling Power Measurement notification. Fields appear in flag-bit order. */
export function parseCyclingPower(view: DataView): CyclingPower {
  const flags = view.getUint16(0, true);
  const has = (bit: number) => (flags & (1 << bit)) !== 0;
  const out: CyclingPower = { power: view.getInt16(2, true) };
  let o = 4;
  if (has(0)) o += 1; // pedal power balance
  if (has(2)) o += 2; // accumulated torque
  if (has(4)) o += 6; // wheel revolutions (uint32) + last wheel event time (uint16)
  if (has(5)) out.crank = { revs: view.getUint16(o, true), time: view.getUint16(o + 2, true) };
  return out;
}

/** Derives cadence from successive cumulative crank readings, handling uint16 wraparound. */
export class CrankCadence {
  private last?: { revs: number; time: number };
  private rpm?: number;
  private staleSince = 0;

  /** `nowMs` is wall-clock, used to drop to 0 rpm when the cranks stop turning. */
  update(crank: { revs: number; time: number }, nowMs: number): number | undefined {
    const prev = this.last;
    this.last = crank;
    if (!prev) return undefined;
    const dRevs = (crank.revs - prev.revs + 0x10000) % 0x10000;
    const dTime = (crank.time - prev.time + 0x10000) % 0x10000;
    if (dRevs > 0 && dTime > 0) {
      this.rpm = Math.round((dRevs / (dTime / 1024)) * 60);
      this.staleSince = nowMs;
    } else if (nowMs - this.staleSince > 3000) {
      // Same event repeated for 3 s: not pedalling.
      this.rpm = 0;
    }
    return this.rpm;
  }
}

// Wahoo control opcodes.
export const WAHOO_UNLOCK = 0x20;
export const WAHOO_SET_ERG = 0x42;
export const WAHOO_SET_SIM = 0x43;
export const WAHOO_SET_GRADE = 0x46;

type Bytes = Uint8Array<ArrayBuffer>;

function command(op: number, ...uint16s: number[]): Bytes {
  const view = new DataView(new ArrayBuffer(1 + uint16s.length * 2));
  view.setUint8(0, op);
  uint16s.forEach((v, i) => view.setUint16(1 + i * 2, Math.max(0, Math.min(0xffff, Math.round(v))), true));
  return new Uint8Array(view.buffer);
}

/** Must be sent once after connecting before the trainer accepts control. */
export const wahooUnlock = (): Bytes => new Uint8Array([WAHOO_UNLOCK, 0xee, 0xfc]);

export const wahooErg = (watts: number): Bytes => command(WAHOO_SET_ERG, watts);

/** Enters simulation mode. Required before grade commands after ERG. */
export const wahooSimMode = ({ weightKg = 75, crr = 0.004, cwKgPerM = 0.51 } = {}): Bytes =>
  command(WAHOO_SET_SIM, weightKg * 100, crr * 10000, cwKgPerM * 1000);

/** Grade in percent; encoded as (grade/100 + 1) * 32768. */
export const wahooGrade = (gradePct: number): Bytes =>
  command(WAHOO_SET_GRADE, (Math.max(-100, Math.min(100, gradePct)) / 100 + 1) * 32768);
