// Rider avatar power levels, driven by power zone.

import type { Zone } from './zones';

export const POWER_LEVELS = 5;

/** Z1–2 calm, Z3–4 glow, Z5 gold, Z6 gold + lightning, Z7 max. */
export function powerLevel(zone: Zone): number {
  if (zone.id <= 2) return 1;
  if (zone.id <= 4) return 2;
  return zone.id - 2;
}

/**
 * Debounces level changes so the avatar doesn't flicker when power hovers on a
 * zone boundary. Powering up is quick (it's the fun part); calming down is slower.
 */
export class LevelFilter {
  level = 1;
  private pending = 1;
  private since = 0;

  constructor(
    private readonly upMs = 600,
    private readonly downMs = 1800,
  ) {}

  /** Feed the raw level at time `nowMs`; returns the level to display. */
  update(raw: number, nowMs: number): number {
    if (raw !== this.pending) {
      this.pending = raw;
      this.since = nowMs;
    }
    if (this.pending !== this.level && nowMs - this.since >= (this.pending > this.level ? this.upMs : this.downMs)) {
      this.level = this.pending;
    }
    return this.level;
  }

  reset(level = 1) {
    this.level = this.pending = level;
  }
}
