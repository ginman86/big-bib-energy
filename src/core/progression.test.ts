import { describe, expect, it } from 'vitest';
import { earnedBy, tiersEarned } from './achievements';
import { computeFacts, FactsRecorder, RideFacts } from './facts';
import { HistoryRide, progression, rankFor, weekIndex, xpForRide } from './progression';
import { Session } from './session';
import { minutes, repeat, steady, Workout } from './workout';

const DAY = 86_400_000;
// Monday 2026-09-28 07:00 UTC.
const MON = Date.UTC(2026, 8, 28, 7);

function facts(over: Partial<RideFacts> = {}): RideFacts {
  return {
    v: 1, mode: 'erg', simulated: false, seconds: 3600, tss: 60, kJ: 700, compliance: 0.8, completed: true,
    hardBlocks: 0, hardBlocksAllOn: false, powerZoneSeconds: [0, 0, 0, 0, 0, 0, 0], maxAvatarLevel: 2,
    pauses: 0, ergReleases: 0, reconnects: 0, startHourLocal: 7, crest: false, ...over,
  };
}

let n = 0;
function ride(startedAt: number, over: Partial<HistoryRide> & { f?: Partial<RideFacts> } = {}): HistoryRide {
  const { f, ...rest } = over;
  const base = { id: `r${n++}`, startedAt, seconds: 3600, tss: 60, compliance: 0.8, ...rest };
  return { ...base, facts: f === undefined && 'facts' in over ? undefined : facts({ ...f, seconds: base.seconds, tss: base.tss, compliance: base.compliance }) };
}

const opts = { weeklyGoal: 3, utcOffsetMin: 0, now: MON };

describe('xp', () => {
  it('is neutral in ERG and 0.5–1.5× in Target mode', () => {
    expect(xpForRide(ride(MON, { f: { mode: 'erg', completed: false } }), 0).xp).toBe(60);
    expect(xpForRide(ride(MON, { compliance: 1, f: { mode: 'target', completed: false } }), 0).xp).toBe(90);
    expect(xpForRide(ride(MON, { compliance: 0, f: { mode: 'target', completed: false } }), 0).xp).toBe(30);
  });

  it('rewards finishing and streaks, and caps a single ride', () => {
    expect(xpForRide(ride(MON, { f: { completed: true } }), 0).xp).toBe(66);
    expect(xpForRide(ride(MON, { f: { completed: false } }), 2).xp).toBe(66); // +10% from 2 streak weeks
    expect(xpForRide(ride(MON, { f: { completed: false } }), 10).streakBonus).toBe(0.25);
    expect(xpForRide(ride(MON, { tss: 900, f: { completed: false } }), 0).xp).toBe(300);
  });

  it('treats rides without facts as ERG-neutral and unfinished', () => {
    const legacy: HistoryRide = { id: 'old', startedAt: MON, seconds: 3600, tss: 50, compliance: 1 };
    expect(xpForRide(legacy, 0)).toMatchObject({ xp: 50, precision: 1, finished: false });
  });
});

describe('ranks', () => {
  it('climbs by thresholds; 9,001 is Super Sweatyan', () => {
    expect(rankFor(0).rank.name).toBe('Pedal Pusher');
    expect(rankFor(9000).rank.name).toBe('VO2 Vanguard');
    expect(rankFor(9001).rank.name).toBe('Super Sweatyan');
    expect(rankFor(9001).rank.unlock).toBe('super-sweatyan');
    expect(rankFor(500).progress).toBeCloseTo(0.5);
    expect(rankFor(99_999)).toMatchObject({ next: undefined, progress: 1 });
  });
});

describe('weeks and streaks', () => {
  it('starts weeks on Monday in local time', () => {
    expect(weekIndex(MON, 0)).toBe(weekIndex(MON + 6 * DAY, 0)); // Mon..Sun
    expect(weekIndex(MON + 7 * DAY, 0)).toBe(weekIndex(MON, 0) + 1);
    // 01:00 Monday UTC is still Sunday evening in Denver (UTC-6).
    const earlyMon = Date.UTC(2026, 8, 28, 1);
    expect(weekIndex(earlyMon, -360)).toBe(weekIndex(earlyMon, 0) - 1);
  });

  it('counts consecutive weeks that hit the goal', () => {
    const rides = [0, 1, 2].flatMap((w) => [0, 1, 2].map((d) => ride(MON + w * 7 * DAY + d * DAY)));
    const p = progression(rides, { ...opts, now: MON + 2 * 7 * DAY + 3 * DAY });
    expect(p.streak).toEqual({ weeks: 3, thisWeek: 3, goal: 3 });
    // The streak bonus grows as weeks stack up: week 0's rides have none, week 2's have more.
    expect(p.rides[0].xp.streakBonus).toBe(0);
    expect(p.rides.at(-1)!.xp.streakBonus).toBeGreaterThan(p.rides[3].xp.streakBonus);
  });

  it("doesn't count an unfinished current week, and a missed week resets", () => {
    const rides = [0, 1, 2].map((d) => ride(MON + d * DAY)); // week 0: goal met
    // Week 1: two rides only. Now = week 2.
    rides.push(ride(MON + 7 * DAY), ride(MON + 8 * DAY));
    expect(progression(rides, { ...opts, now: MON + 14 * DAY }).streak.weeks).toBe(0);
    // Now = week 1, in progress with 2 of 3: last complete week (0) still counts.
    expect(progression(rides, { ...opts, now: MON + 9 * DAY }).streak).toMatchObject({ weeks: 1, thisWeek: 2 });
  });

  it('ignores simulated rides entirely', () => {
    const p = progression([ride(MON, { f: { simulated: true } })], opts);
    expect(p.xp).toBe(0);
    expect(p.rides).toEqual([]);
    expect(p.achievements.earned).toEqual([]);
  });
});

describe('achievements', () => {
  it('awards the debut on the first ride and records which ride', () => {
    const first = ride(MON);
    const p = progression([first], opts);
    expect(earnedBy(p.achievements, first.id).map((e) => e.id)).toContain('first-ride');
  });

  it('requires Target mode for precision patches', () => {
    const erg = ride(MON, { compliance: 0.99, f: { mode: 'erg' } });
    const tgt = ride(MON + DAY, { compliance: 0.96, f: { mode: 'target' } });
    const t = tiersEarned(progression([erg, tgt], opts).achievements);
    expect(t['dialled-in']).toBe(0);
    expect(t['laser-focus']).toBe(0);
    expect(progression([erg], opts).achievements.progress['dialled-in']).toBe(0);
  });

  it('tiers up: Dialled In at 1 / 10 / 50', () => {
    const rides = Array.from({ length: 10 }, (_, i) => ride(MON + i * DAY, { compliance: 0.92, f: { mode: 'target' } }));
    const s = progression(rides, opts).achievements;
    expect(tiersEarned(s)['dialled-in']).toBe(1);
    expect(s.earned.filter((e) => e.id === 'dialled-in').map((e) => e.rideId)).toEqual([rides[0].id, rides[9].id]);
  });

  it("it's over 9000 (exactly 9,000 isn't)", () => {
    // 300 XP each, no finish bonus, and an unreachable weekly goal so there's no streak bonus.
    const rides = Array.from({ length: 31 }, (_, i) => ride(MON + i * DAY, { tss: 300, f: { completed: false } }));
    const noStreak = { ...opts, weeklyGoal: 99 };
    expect(progression(rides.slice(0, 30), noStreak).xp).toBe(9000);
    expect(tiersEarned(progression(rides.slice(0, 30), noStreak).achievements)['over-9000']).toBe(-1);
    expect(tiersEarned(progression(rides, noStreak).achievements)['over-9000']).toBe(0);
  });

  it('comeback kid, silly ones, and legacy rides', () => {
    const legacy: HistoryRide = { id: 'legacy', startedAt: MON - 30 * DAY, seconds: 3600, tss: 50, compliance: 0.95 };
    const back = ride(MON, { f: { startHourLocal: 5, ergReleases: 1, completed: true, avgCadence: 97 } });
    const t = tiersEarned(progression([legacy, back], opts).achievements);
    expect(t['comeback-kid']).toBe(0);
    expect(t['early-bird']).toBe(0);
    expect(t['death-spiral-survivor']).toBe(0);
    expect(t['spin-doctor']).toBe(0);
    expect(t['night-owl']).toBe(-1);
    // The legacy ride counts toward volume and the crest (compliance only), not fact-based rules.
    expect(progression([legacy], opts).achievements.progress).toMatchObject({ rides: 1, 'big-bib-energy': 1, 'early-bird': 0 });
  });
});

describe('ride facts', () => {
  it('recorder counts pauses, ERG releases while riding, reconnects, and dominant mode', () => {
    const r = new FactsRecorder();
    const frame = (o: Partial<Parameters<FactsRecorder['frame']>[0]>) =>
      r.frame({ dt: 1, running: true, paused: false, mode: 'erg', erg: 'engaged', reconnecting: false, avatarLevel: 2, ...o });
    frame({});
    frame({ erg: 'released' }); // death-spiral rescue
    frame({ erg: 'engaged' });
    frame({ running: false, paused: true, erg: 'released' }); // pause: not a spiral release
    frame({ running: true });
    frame({ reconnecting: true, avatarLevel: 4 });
    frame({ reconnecting: true });
    for (let i = 0; i < 10; i++) frame({ mode: 'target' });
    expect(r).toMatchObject({ pauses: 1, ergReleases: 1, reconnects: 1, maxAvatarLevel: 4 });
    expect(r.mode).toBe('target');
  });

  it('computes zones, kJ, blocks and crest from a ride', () => {
    const w: Workout = {
      id: 'x',
      name: 'x',
      description: '',
      steps: [steady(minutes(20), 0.9), ...repeat(3, steady(120, 1.1), steady(60, 0.5))],
    };
    const s = new Session(w, 250);
    s.start(MON);
    while (s.status === 'running') s.advance(1, { power: s.targetWatts(), cadence: 90, heartRate: 160 });
    const fx = computeFacts({
      summary: s.summary(), samples: s.samples, recorder: new FactsRecorder(), completed: s.completed,
      simulated: false, lthr: 165, startHourLocal: 7,
    });
    expect(fx.completed).toBe(true);
    expect(fx.bestBlock).toMatchObject({ minutes: 20 });
    expect(fx.bestBlock!.compliance).toBeGreaterThan(0.95);
    expect(fx.hardBlocks).toBe(4); // the 20-min block at 90% plus three 110% intervals
    expect(fx.hardBlocksAllOn).toBe(true);
    expect(fx.powerZoneSeconds[3]).toBe(20 * 60); // 90% FTP is sweet spot (Z4)
    expect(fx.powerZoneSeconds.reduce((a, b) => a + b)).toBe(s.samples.length);
    expect(fx.hrZoneSeconds![3]).toBe(s.samples.length); // 160/165 = 97% → Z4
    expect(fx.kJ).toBeGreaterThan(300);
    expect(fx.avgCadence).toBe(90);
    expect(fx.crest).toBe(true);
  });

  it('a ride with skipped blocks is not completed', () => {
    const s = new Session({ id: 'y', name: 'y', description: '', steps: [steady(600, 0.6), steady(600, 0.6)] }, 250);
    s.start(MON);
    s.skip();
    while (s.status === 'running') s.advance(1, { power: 150 });
    expect(s.completed).toBe(false);
  });
});
