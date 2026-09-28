// XP, ranks and weekly streaks: a pure fold over ride history (see docs/gamification.md).

import { AchievementState, evaluateAchievements, RideContext } from './achievements';
import type { RideFacts } from './facts';

/** What progression needs from a ride. Rides from before facts existed have only the basics. */
export interface HistoryRide {
  id: string;
  /** ms since Unix epoch. */
  startedAt: number;
  seconds: number;
  tss: number;
  compliance: number;
  facts?: RideFacts;
  /** For matching local and synced copies of rides saved before they shared an ID. */
  workoutId?: string;
}

export interface Rank {
  n: number;
  name: string;
  xp: number;
  unlock?: string;
}

export const RANKS: Rank[] = [
  { n: 1, name: 'Pedal Pusher', xp: 0 },
  { n: 2, name: 'Sweat Apprentice', xp: 250 },
  { n: 3, name: 'Tempo Tamer', xp: 750 },
  { n: 4, name: 'Sweet Spot Samurai', xp: 1_750, unlock: 'aura-steel' },
  { n: 5, name: 'Threshold Warrior', xp: 3_500 },
  { n: 6, name: 'VO2 Vanguard', xp: 6_000, unlock: 'aura-emerald' },
  { n: 7, name: 'Super Sweatyan', xp: 9_001, unlock: 'super-sweatyan' },
  { n: 8, name: 'Super Sweatyan 2', xp: 14_000, unlock: 'lightning' },
  { n: 9, name: 'Super Sweatyan 3', xp: 21_000, unlock: 'super-sweatyan-3' },
  { n: 10, name: 'Ultra Instinct Watts', xp: 30_000, unlock: 'ultra-instinct' },
];

export function rankFor(xp: number): { rank: Rank; next?: Rank; progress: number } {
  let i = 0;
  RANKS.forEach((r, j) => {
    if (xp >= r.xp) i = j;
  });
  const rank = RANKS[i];
  const next = RANKS[i + 1];
  return { rank, next, progress: next ? (xp - rank.xp) / (next.xp - rank.xp) : 1 };
}

export const XP_CAP = 300;

export interface XpBreakdown {
  xp: number;
  base: number; // TSS
  precision: number; // multiplier
  finished: boolean;
  streakBonus: number; // e.g. 0.1 = +10%
}

/** Target mode rewards holding the line (0.5–1.5×); ERG is neutral because the trainer holds it. */
export function xpForRide(r: HistoryRide, streakWeeks: number): XpBreakdown {
  const target = r.facts?.mode === 'target';
  const precision = target ? 0.5 + r.compliance : 1;
  const finished = r.facts?.completed ?? false;
  const streakBonus = Math.min(0.25, 0.05 * streakWeeks);
  const xp = Math.min(XP_CAP, r.tss * precision) * (finished ? 1.1 : 1) * (1 + streakBonus);
  return { xp: Math.round(xp), base: r.tss, precision, finished, streakBonus };
}

/** Monday-start local week number (consecutive integers), from minutes east of UTC. */
export function weekIndex(ms: number, utcOffsetMin: number): number {
  const day = Math.floor((ms + utcOffsetMin * 60_000) / 86_400_000);
  return Math.floor((day + 3) / 7); // 1970-01-01 was a Thursday
}

export interface ProgressionOptions {
  weeklyGoal: number;
  utcOffsetMin: number;
  now: number;
}

export interface Progression {
  xp: number;
  rank: ReturnType<typeof rankFor>;
  streak: { weeks: number; thisWeek: number; goal: number };
  /** Per ride, in history order (oldest first); simulated rides are absent. */
  rides: { id: string; xp: XpBreakdown }[];
  achievements: AchievementState;
}

export function progression(history: HistoryRide[], opts: ProgressionOptions): Progression {
  const rides = history.filter((r) => !r.facts?.simulated).sort((a, b) => a.startedAt - b.startedAt);
  const perWeek = new Map<number, number>();
  const met = (w: number) => (perWeek.get(w) ?? 0) >= opts.weeklyGoal;
  /** Consecutive goal-met weeks ending just before week w. */
  const runBefore = (w: number) => {
    let n = 0;
    while (met(w - 1 - n)) n++;
    return n;
  };

  let xp = 0;
  let hours = 0;
  let crests = 0;
  const out: Progression['rides'] = [];
  const contexts: RideContext[] = [];
  rides.forEach((ride, i) => {
    const w = weekIndex(ride.startedAt, opts.utcOffsetMin);
    const streakWeeks = runBefore(w) + (met(w) ? 1 : 0);
    const bd = xpForRide(ride, streakWeeks);
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
    xp += bd.xp;
    hours += ride.seconds / 3600;
    if (ride.compliance >= 0.9) crests++;
    out.push({ id: ride.id, xp: bd });
    contexts.push({
      ride,
      prev: rides[i - 1],
      totals: { rides: i + 1, hours, xp, crests },
      streakWeeks: runBefore(w) + (met(w) ? 1 : 0),
    });
  });

  const current = weekIndex(opts.now, opts.utcOffsetMin);
  return {
    xp,
    rank: rankFor(xp),
    streak: { weeks: runBefore(current) + (met(current) ? 1 : 0), thisWeek: perWeek.get(current) ?? 0, goal: opts.weeklyGoal },
    rides: out,
    achievements: evaluateAchievements(contexts),
  };
}
