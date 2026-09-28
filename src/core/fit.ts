// FIT activity encoder: the file format Strava, Garmin Connect, TrainingPeaks and friends import.
// Hand-rolled so the app doesn't ship Garmin's 1 MB profile table; field numbers, scales and enums
// were checked against the official SDK profile (@garmin/fitsdk 21.217), and tests decode our
// output with that SDK.

import { mean, normalizedPower } from './metrics';
import type { RideSummary, Sample } from './session';
import type { Segment } from './workout';

/** FIT timestamps count seconds from 1989-12-31T00:00:00Z. */
const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);
const fitTime = (ms: number) => Math.round((ms - FIT_EPOCH_MS) / 1000);

type Base = 'enum' | 'uint8' | 'uint16' | 'uint32' | 'uint32z';
const BASE: Record<Base, { id: number; size: number; invalid: number }> = {
  enum: { id: 0x00, size: 1, invalid: 0xff },
  uint8: { id: 0x02, size: 1, invalid: 0xff },
  uint16: { id: 0x84, size: 2, invalid: 0xffff },
  uint32: { id: 0x86, size: 4, invalid: 0xffffffff },
  uint32z: { id: 0x8c, size: 4, invalid: 0 },
};
type Field = readonly [num: number, base: Base];

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01,
  0x8801, 0x4400,
];

export function fitCrc(bytes: Uint8Array, crc = 0): number {
  for (const b of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC_TABLE[b & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf];
  }
  return crc;
}

/** Writes definition + data messages; each message type gets its own local message number. */
class FitWriter {
  private out: number[] = [];
  private defs = new Map<number, readonly Field[]>();

  define(local: number, global: number, fields: readonly Field[]) {
    this.out.push(0x40 | local, 0, 0 /* little-endian */, global & 0xff, global >> 8, fields.length);
    for (const [num, base] of fields) this.out.push(num, BASE[base].size, BASE[base].id);
    this.defs.set(local, fields);
  }

  /** `undefined` (or NaN) writes the field's "invalid" value, which readers treat as absent. */
  data(local: number, values: (number | undefined)[]) {
    const fields = this.defs.get(local)!;
    this.out.push(local);
    fields.forEach(([, base], i) => {
      const { size, invalid } = BASE[base];
      const raw = values[i];
      const max = 2 ** (size * 8) - 1;
      const v = raw === undefined || !Number.isFinite(raw) ? invalid : Math.max(0, Math.min(max - 1, Math.round(raw)));
      for (let b = 0; b < size; b++) this.out.push(Math.floor(v / 2 ** (8 * b)) & 0xff);
    });
  }

  bytes(): Uint8Array<ArrayBuffer> {
    const data = new Uint8Array(this.out);
    const header = new DataView(new ArrayBuffer(14));
    header.setUint8(0, 14);
    header.setUint8(1, 0x20); // protocol 2.0
    header.setUint16(2, 21217, true); // profile 21.217
    header.setUint32(4, data.length, true);
    [0x2e, 0x46, 0x49, 0x54].forEach((c, i) => header.setUint8(8 + i, c)); // ".FIT"
    header.setUint16(12, fitCrc(new Uint8Array(header.buffer, 0, 12)), true);

    const file = new Uint8Array(14 + data.length + 2);
    file.set(new Uint8Array(header.buffer), 0);
    file.set(data, 14);
    const crc = fitCrc(file.subarray(0, 14 + data.length));
    file[file.length - 2] = crc & 0xff;
    file[file.length - 1] = crc >> 8;
    return file;
  }
}

// Messages (global numbers) and the fields we write, per the FIT profile.
const MSG = { fileId: 0, session: 18, lap: 19, record: 20, event: 21, activity: 34 } as const;
const F = {
  fileId: [[0, 'enum'], [1, 'uint16'], [2, 'uint16'], [3, 'uint32z'], [4, 'uint32']],
  event: [[253, 'uint32'], [0, 'enum'], [1, 'enum']],
  record: [[253, 'uint32'], [7, 'uint16'], [4, 'uint8'], [3, 'uint8']],
  lap: [
    [254, 'uint16'], [253, 'uint32'], [0, 'enum'], [1, 'enum'], [2, 'uint32'], [7, 'uint32'], [8, 'uint32'],
    [19, 'uint16'], [20, 'uint16'], [33, 'uint16'], [15, 'uint8'], [16, 'uint8'], [17, 'uint8'], [18, 'uint8'],
    [24, 'enum'], [25, 'enum'], [39, 'enum'],
  ],
  session: [
    [254, 'uint16'], [253, 'uint32'], [0, 'enum'], [1, 'enum'], [2, 'uint32'], [5, 'enum'], [6, 'enum'],
    [7, 'uint32'], [8, 'uint32'], [20, 'uint16'], [21, 'uint16'], [34, 'uint16'], [35, 'uint16'], [36, 'uint16'],
    [45, 'uint16'], [16, 'uint8'], [17, 'uint8'], [18, 'uint8'], [19, 'uint8'], [25, 'uint16'], [26, 'uint16'],
    [28, 'enum'],
  ],
  activity: [[253, 'uint32'], [0, 'uint32'], [1, 'uint16'], [2, 'enum'], [3, 'enum'], [4, 'enum'], [5, 'uint32']],
} as const satisfies Record<string, readonly Field[]>;

// Enum values.
const FILE_ACTIVITY = 4;
const MANUFACTURER_DEVELOPMENT = 255;
const EVENT = { timer: 0, session: 8, lap: 9, activity: 26 };
const EVENT_TYPE = { start: 0, stop: 1, stopAll: 4 };
const SPORT_CYCLING = 2;
const SUB_SPORT_INDOOR_CYCLING = 6;

export interface FitActivity {
  /** Wall-clock ride start (ms since Unix epoch). */
  startedAtMs: number;
  /** Local time offset from UTC in seconds, for the activity's local timestamp. */
  utcOffsetS: number;
  summary: RideSummary;
  samples: Sample[];
}

interface Stats {
  seconds: number;
  avgPower?: number;
  maxPower?: number;
  np?: number;
  avgHr?: number;
  maxHr?: number;
  avgCad?: number;
  maxCad?: number;
}

function stats(samples: Sample[]): Stats {
  const w = samples.map((s) => s.power);
  const hr = samples.flatMap((s) => (s.heartRate ? [s.heartRate] : []));
  const cad = samples.flatMap((s) => (s.cadence ? [s.cadence] : []));
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : undefined);
  const avg = (xs: number[]) => (xs.length ? mean(xs) : undefined);
  return {
    seconds: samples.length,
    avgPower: avg(w),
    maxPower: max(w),
    np: w.length ? normalizedPower(w) : undefined,
    avgHr: avg(hr),
    maxHr: max(hr),
    avgCad: avg(cad),
    maxCad: max(cad),
  };
}

/** One lap per workout block that was actually ridden. */
function laps(segments: Segment[], samples: Sample[]) {
  return segments
    .map((segment) => ({ segment, samples: samples.filter((s) => s.t >= segment.start && s.t < segment.end) }))
    .filter((l) => l.samples.length > 0);
}

export function encodeFitActivity({ startedAtMs, utcOffsetS, summary, samples }: FitActivity): Uint8Array<ArrayBuffer> {
  const start = fitTime(startedAtMs);
  const at = (t: number) => start + Math.round(t);
  const end = at(samples.length);
  const w = new FitWriter();

  w.define(0, MSG.fileId, F.fileId);
  w.data(0, [FILE_ACTIVITY, MANUFACTURER_DEVELOPMENT, 0, start || 1, start]);

  w.define(1, MSG.event, F.event);
  w.data(1, [start, EVENT.timer, EVENT_TYPE.start]);

  w.define(2, MSG.record, F.record);
  for (const s of samples) w.data(2, [at(s.t), s.power, s.cadence, s.heartRate]);

  w.data(1, [end, EVENT.timer, EVENT_TYPE.stopAll]);

  const ridden = laps(summary.segments.map((x) => x.segment), samples);
  w.define(3, MSG.lap, F.lap);
  ridden.forEach((lap, i) => {
    const st = stats(lap.samples);
    const lapStart = at(lap.samples[0].t);
    const ms = st.seconds * 1000;
    w.data(3, [
      i, lapStart + st.seconds, EVENT.lap, EVENT_TYPE.stop, lapStart, ms, ms,
      st.avgPower, st.maxPower, st.np, st.avgHr, st.maxHr, st.avgCad, st.maxCad,
      0 /* manual */, SPORT_CYCLING, SUB_SPORT_INDOOR_CYCLING,
    ]);
  });

  const all = stats(samples);
  const ms = samples.length * 1000;
  w.define(4, MSG.session, F.session);
  w.data(4, [
    0, end, EVENT.session, EVENT_TYPE.stop, start, SPORT_CYCLING, SUB_SPORT_INDOOR_CYCLING, ms, ms,
    all.avgPower, all.maxPower, summary.normalizedPower, summary.tss * 10, summary.intensityFactor * 1000, summary.ftp,
    all.avgHr, all.maxHr, all.avgCad, all.maxCad, 0, ridden.length, 0 /* activity end */,
  ]);

  w.define(5, MSG.activity, F.activity);
  w.data(5, [end, ms, 1, 0 /* manual */, EVENT.activity, EVENT_TYPE.stop, end + utcOffsetS]);

  return w.bytes();
}

/** e.g. big-bib-energy-2026-09-28-sweet-spot-3x10.fit */
export function fitFileName(summary: Pick<RideSummary, 'workoutName'>, startedAtMs: number): string {
  const d = new Date(startedAtMs);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const slug = summary.workoutName
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `big-bib-energy-${date}-${slug}.fit`;
}
