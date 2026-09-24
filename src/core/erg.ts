// ERG soft start. Holding watts at near-zero cadence means huge torque (P = τω),
// so ERG stays released (free road) until the rider is spinning, then ramps in.
// Also releases if cadence collapses mid-ride — the "ERG death spiral".

export type ErgState = 'released' | 'ramping' | 'engaged';

export type ErgCommand = { kind: 'free' } | { kind: 'erg'; watts: number };

export interface ErgInput {
  nowMs: number;
  /** Is the ride clock running? Paused/ready always releases. */
  active: boolean;
  targetW: number;
  powerW: number;
  cadence?: number;
}

export interface ErgOptions {
  engageRpm: number;
  engageHoldMs: number;
  rampMs: number;
  releaseRpm: number;
  releaseHoldMs: number;
  /** Below this cadence the rider has stopped: release much sooner. */
  coastRpm: number;
  coastHoldMs: number;
  /** Without a cadence sensor, treat this much power as "pedalling". */
  engageWatts: number;
}

export const DEFAULT_ERG: ErgOptions = {
  engageRpm: 55,
  engageHoldMs: 1500,
  rampMs: 10_000,
  releaseRpm: 40,
  releaseHoldMs: 3000,
  coastRpm: 20,
  coastHoldMs: 1000,
  engageWatts: 40,
};

export class ErgGovernor {
  state: ErgState = 'released';
  private since = 0;
  /** Start of the current condition streak (spinning, or bogged down). */
  private streak?: number;
  private rampFrom = 0;

  constructor(private readonly opts: ErgOptions = DEFAULT_ERG) {}

  reset() {
    this.state = 'released';
    this.streak = undefined;
  }

  update(i: ErgInput): ErgCommand {
    const o = this.opts;
    if (!i.active) {
      this.reset();
      return { kind: 'free' };
    }
    const spinning = i.cadence !== undefined ? i.cadence >= o.engageRpm : i.powerW >= o.engageWatts;
    const bogged = i.cadence !== undefined && i.cadence < o.releaseRpm;

    switch (this.state) {
      case 'released':
        if (!this.held(spinning, i.nowMs, o.engageHoldMs)) return { kind: 'free' };
        this.state = 'ramping';
        this.since = i.nowMs;
        // Start from what the rider is already producing, but not absurdly low.
        this.rampFrom = Math.min(i.targetW, Math.max(i.powerW, i.targetW * 0.3));
        break;
      case 'ramping':
      case 'engaged': {
        // Stopped pedalling entirely: don't make the brake fight a coasting flywheel for long.
        const coasting = i.cadence !== undefined && i.cadence < o.coastRpm;
        if (this.held(bogged, i.nowMs, coasting ? o.coastHoldMs : o.releaseHoldMs)) {
          this.reset();
          return { kind: 'free' };
        }
      }
    }

    if (this.state === 'ramping') {
      const p = (i.nowMs - this.since) / o.rampMs;
      if (p >= 1) this.state = 'engaged';
      else return { kind: 'erg', watts: Math.round(this.rampFrom + (i.targetW - this.rampFrom) * p) };
    }
    return { kind: 'erg', watts: i.targetW };
  }

  /** True once `cond` has held continuously for `ms`. */
  private held(cond: boolean, nowMs: number, ms: number): boolean {
    if (!cond) {
      this.streak = undefined;
      return false;
    }
    this.streak ??= nowMs;
    if (nowMs - this.streak < ms) return false;
    this.streak = undefined;
    return true;
  }
}
