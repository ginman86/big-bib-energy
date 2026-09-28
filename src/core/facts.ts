// Ride facts: a compact record of what happened on a ride, stored with its summary. XP, ranks and
// achievements are computed from these, so new achievements can apply to past rides.

import { hrZoneFor } from './hr';
import type { RideSummary, Sample } from './session';
import { zoneFor, ZONES } from './zones';

export type Mode = 'erg' | 'target';

export interface RideFacts {
  /** Bumped when facts gain fields, so rules can tell old rides apart. */
  v: 1;
  mode: Mode;
  simulated: boolean;
  seconds: number;
  tss: number;
  kJ: number;
  compliance: number;
  completed: boolean;
  /** The best-held steady block of ≥ 20 min, if any. */
  bestBlock?: { minutes: number; compliance: number };
  /** Hard blocks: ≥ 60 s at ≥ 88% FTP. */
  hardBlocks: number;
  hardBlocksAllOn: boolean;
  powerZoneSeconds: number[];
  hrZoneSeconds?: number[];
  maxAvatarLevel: number;
  pauses: number;
  ergReleases: number;
  reconnects: number;
  startHourLocal: number;
  avgCadence?: number;
  crest: boolean;
}

/**
 * Follows the ride frame by frame for things only the ride loop knows. Feed it every frame;
 * it detects transitions itself so callers don't have to.
 */
export class FactsRecorder {
  private modeSeconds: Record<Mode, number> = { erg: 0, target: 0 };
  maxAvatarLevel = 1;
  pauses = 0;
  ergReleases = 0;
  reconnects = 0;
  private wasRunning = false;
  private wasPaused = false;
  private ergWasOn = false;
  private wasReconnecting = false;

  frame(f: {
    dt: number;
    running: boolean;
    paused: boolean;
    mode: Mode;
    avatarLevel?: number;
    /** ERG governor state, when in ERG. */
    erg?: 'released' | 'ramping' | 'engaged';
    reconnecting: boolean;
  }) {
    if (f.running) this.modeSeconds[f.mode] += f.dt;
    if (f.running && f.avatarLevel) this.maxAvatarLevel = Math.max(this.maxAvatarLevel, f.avatarLevel);
    if (f.paused && !this.wasPaused && this.wasRunning) this.pauses++;
    // A release while still riding (not from pausing) is the death-spiral rescue kicking in.
    const ergOn = f.erg === 'ramping' || f.erg === 'engaged';
    if (this.ergWasOn && f.erg === 'released' && f.running) this.ergReleases++;
    if (f.reconnecting && !this.wasReconnecting) this.reconnects++;
    this.wasRunning = f.running;
    this.wasPaused = f.paused;
    this.ergWasOn = ergOn && f.running;
    this.wasReconnecting = f.reconnecting;
  }

  get mode(): Mode {
    return this.modeSeconds.target > this.modeSeconds.erg ? 'target' : 'erg';
  }
}

export interface FactsInput {
  summary: RideSummary;
  samples: Sample[];
  recorder: FactsRecorder;
  completed: boolean;
  simulated: boolean;
  lthr?: number;
  /** Local hour the ride started (0–23). */
  startHourLocal: number;
}

const HARD = 0.88;

export function computeFacts({ summary, samples, recorder, completed, simulated, lthr, startHourLocal }: FactsInput): RideFacts {
  const ftp = summary.ftp;
  const powerZoneSeconds = ZONES.map(() => 0);
  const hrZoneSeconds = lthr ? [0, 0, 0, 0, 0] : undefined;
  let joules = 0;
  let cadSum = 0;
  let cadN = 0;
  for (const s of samples) {
    powerZoneSeconds[zoneFor(s.power / ftp).id - 1]++;
    if (hrZoneSeconds && s.heartRate) hrZoneSeconds[hrZoneFor(s.heartRate, lthr!).id - 1]++;
    joules += s.power;
    if (s.cadence) {
      cadSum += s.cadence;
      cadN++;
    }
  }

  // Blocks the rider actually spent time in (skipped blocks have no scored seconds).
  const ridden = summary.segments.filter((b) => b.under + b.over + b.compliance > 0);
  const steady20 = ridden.filter((b) => b.segment.from === b.segment.to && b.segment.end - b.segment.start >= 20 * 60);
  const best = steady20.sort((a, b) => b.compliance - a.compliance)[0];
  const hard = ridden.filter((b) => b.segment.end - b.segment.start >= 60 && Math.min(b.segment.from, b.segment.to) >= HARD);

  return {
    v: 1,
    mode: recorder.mode,
    simulated,
    seconds: summary.seconds,
    tss: summary.tss,
    kJ: Math.round(joules / 1000),
    compliance: summary.compliance,
    completed,
    bestBlock: best && { minutes: Math.round((best.segment.end - best.segment.start) / 60), compliance: best.compliance },
    hardBlocks: hard.length,
    hardBlocksAllOn: hard.length > 0 && hard.every((b) => b.compliance >= 0.9),
    powerZoneSeconds,
    hrZoneSeconds,
    maxAvatarLevel: recorder.maxAvatarLevel,
    pauses: recorder.pauses,
    ergReleases: recorder.ergReleases,
    reconnects: recorder.reconnects,
    startHourLocal,
    avgCadence: cadN ? Math.round(cadSum / cadN) : undefined,
    crest: summary.compliance >= 0.9,
  };
}
