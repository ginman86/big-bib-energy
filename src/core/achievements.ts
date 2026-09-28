// Achievements (patches): rules over ride history. Each rule turns a ride, in order, into a running
// progress number; tiers unlock when progress first reaches their thresholds.

import type { RideFacts } from './facts';
import type { HistoryRide } from './progression';

export type Category = 'precision' | 'effort' | 'consistency' | 'volume' | 'silly';

export interface RideContext {
  ride: HistoryRide;
  prev?: HistoryRide;
  totals: { rides: number; hours: number; xp: number; crests: number };
  /** Weekly streak as of this ride. */
  streakWeeks: number;
}

export interface Achievement {
  id: string;
  name: string;
  category: Category;
  /** Progress thresholds; one entry for single achievements, three for bronze/silver/gold. */
  tiers: number[];
  /** Shown while locked. */
  hint: string;
  /** New progress after this ride. */
  step: (progress: number, c: RideContext) => number;
}

// ——— Rule helpers ———

const f = (c: RideContext): Partial<RideFacts> => c.ride.facts ?? {};
const target = (c: RideContext) => f(c).mode === 'target';
const minutes = (c: RideContext) => c.ride.seconds / 60;

/** Counts rides matching a condition. */
const count =
  (pred: (c: RideContext) => boolean) =>
  (p: number, c: RideContext): number =>
    p + (pred(c) ? 1 : 0);

/** Tracks the best value seen. */
const best =
  (value: (c: RideContext) => number) =>
  (p: number, c: RideContext): number =>
    Math.max(p, value(c));

const DAY = 86_400_000;

export const ACHIEVEMENTS: Achievement[] = [
  // Precision (Target mode: in ERG the trainer holds the number for you)
  {
    id: 'dialled-in',
    name: 'Dialled In',
    category: 'precision',
    tiers: [1, 10, 50],
    hint: '≥ 90% on target for 20+ minutes in Target mode',
    step: count((c) => target(c) && minutes(c) >= 20 && c.ride.compliance >= 0.9),
  },
  {
    id: 'laser-focus',
    name: 'Laser Focus',
    category: 'precision',
    tiers: [1],
    hint: '≥ 95% on target for 45+ minutes in Target mode',
    step: count((c) => target(c) && minutes(c) >= 45 && c.ride.compliance >= 0.95),
  },
  {
    id: 'metronome',
    name: 'Metronome',
    category: 'precision',
    tiers: [1],
    hint: 'Every hard interval ≥ 90% on target (3+ intervals) in Target mode',
    step: count((c) => target(c) && (f(c).hardBlocks ?? 0) >= 3 && !!f(c).hardBlocksAllOn),
  },
  {
    id: 'hold-the-line',
    name: 'Hold the Line',
    category: 'precision',
    tiers: [1],
    hint: 'A 20-minute block at ≥ 95% on target in Target mode',
    step: count((c) => target(c) && (f(c).bestBlock?.compliance ?? 0) >= 0.95),
  },

  // Effort
  {
    id: 'over-9000',
    name: "It's Over 9000",
    category: 'effort',
    tiers: [9001],
    hint: 'Reach a power level of 9,001',
    step: (_p, c) => c.totals.xp,
  },
  {
    id: 'full-transformation',
    name: 'Full Transformation',
    category: 'effort',
    tiers: [5],
    hint: 'Power your rider all the way up',
    step: best((c) => f(c).maxAvatarLevel ?? 0),
  },
  {
    id: 'red-zone',
    name: 'Red Zone',
    category: 'effort',
    tiers: [120],
    hint: '2 minutes in power zone 7 in one ride',
    step: best((c) => f(c).powerZoneSeconds?.[6] ?? 0),
  },
  {
    id: 'heart-of-steel',
    name: 'Heart of Steel',
    category: 'effort',
    tiers: [20 * 60],
    hint: '20 minutes in HR zone 4 in one ride',
    step: best((c) => f(c).hrZoneSeconds?.[3] ?? 0),
  },
  {
    id: 'kilojoule-club',
    name: 'Kilojoule Club',
    category: 'effort',
    tiers: [1000],
    hint: '1,000 kJ in one ride',
    step: best((c) => f(c).kJ ?? 0),
  },
  {
    id: 'century-of-stress',
    name: 'Century of Stress',
    category: 'effort',
    tiers: [100],
    hint: 'A TSS of 100 in one ride',
    step: best((c) => c.ride.tss),
  },

  // Consistency
  { id: 'first-ride', name: 'Big Bib Debut', category: 'consistency', tiers: [1], hint: 'Finish your first ride', step: (_p, c) => c.totals.rides },
  {
    id: 'streak',
    name: 'On Fire',
    category: 'consistency',
    tiers: [2, 4, 8, 12],
    hint: 'Hit your weekly ride goal several weeks in a row',
    step: best((c) => c.streakWeeks),
  },
  {
    id: 'comeback-kid',
    name: 'Comeback Kid',
    category: 'consistency',
    tiers: [1],
    hint: 'Ride again after 2+ weeks off',
    step: count((c) => !!c.prev && c.ride.startedAt - c.prev.startedAt >= 14 * DAY),
  },
  {
    id: 'big-bib-energy',
    name: 'Big Bib Energy',
    category: 'consistency',
    tiers: [1, 10, 25],
    hint: 'Earn the flaming-bibs crest (≥ 90% on target)',
    step: (_p, c) => c.totals.crests,
  },

  // Volume
  { id: 'rides', name: 'Saddle Time', category: 'volume', tiers: [10, 50, 100], hint: 'Rack up rides', step: (_p, c) => c.totals.rides },
  {
    id: 'hours',
    name: 'Hours in the Pain Cave',
    category: 'volume',
    tiers: [10, 50, 100],
    hint: 'Rack up hours',
    step: (_p, c) => c.totals.hours,
  },

  // Silly
  {
    id: 'early-bird',
    name: 'Early Bird',
    category: 'silly',
    tiers: [1],
    hint: 'Start a ride before 6 am',
    step: count((c) => f(c).startHourLocal !== undefined && f(c).startHourLocal! < 6),
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    category: 'silly',
    tiers: [1],
    hint: 'Start a ride at 10 pm or later',
    step: count((c) => (f(c).startHourLocal ?? 0) >= 22),
  },
  {
    id: 'spin-doctor',
    name: 'Spin Doctor',
    category: 'silly',
    tiers: [1],
    hint: 'Average 95+ rpm over 30+ minutes',
    step: count((c) => minutes(c) >= 30 && (f(c).avgCadence ?? 0) >= 95),
  },
  {
    id: 'grinder',
    name: 'Grinder',
    category: 'silly',
    tiers: [1],
    hint: 'Average under 75 rpm over 30+ minutes',
    step: count((c) => minutes(c) >= 30 && f(c).avgCadence !== undefined && f(c).avgCadence! < 75),
  },
  {
    id: 'death-spiral-survivor',
    name: 'Death Spiral Survivor',
    category: 'silly',
    tiers: [1],
    hint: 'ERG let go of you mid-ride, and you finished anyway',
    step: count((c) => (f(c).ergReleases ?? 0) >= 1 && !!f(c).completed),
  },
  {
    id: 'no-pause-button',
    name: 'No Pause Button',
    category: 'silly',
    tiers: [1],
    hint: 'Finish a 60+ minute workout without pausing',
    step: count((c) => minutes(c) >= 60 && !!f(c).completed && f(c).pauses === 0),
  },
  {
    id: 'back-from-the-void',
    name: 'Back From the Void',
    category: 'silly',
    tiers: [1],
    hint: 'Your trainer dropped out mid-ride, and you finished anyway',
    step: count((c) => (f(c).reconnects ?? 0) >= 1 && !!f(c).completed),
  },
];

export interface Earned {
  id: string;
  /** 0-based tier index (0 = bronze / single). */
  tier: number;
  rideId: string;
  at: number;
}

export interface AchievementState {
  earned: Earned[];
  /** Current progress per achievement ID. */
  progress: Record<string, number>;
}

export function evaluateAchievements(rides: RideContext[]): AchievementState {
  const progress: Record<string, number> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, 0]));
  const earned: Earned[] = [];
  for (const c of rides) {
    for (const a of ACHIEVEMENTS) {
      const before = progress[a.id];
      const after = a.step(before, c);
      progress[a.id] = after;
      a.tiers.forEach((t, tier) => {
        if (before < t && after >= t) earned.push({ id: a.id, tier, rideId: c.ride.id, at: c.ride.startedAt });
      });
    }
  }
  return { earned, progress };
}

/** Highest tier earned per achievement (-1 when locked). */
export function tiersEarned(state: AchievementState): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, -1]));
  for (const e of state.earned) out[e.id] = Math.max(out[e.id], e.tier);
  return out;
}

/** Achievements earned by one ride (for the summary reveal). */
export const earnedBy = (state: AchievementState, rideId: string) => state.earned.filter((e) => e.rideId === rideId);
