import { describe, expect, it } from 'vitest';
import { earnedBy } from '../core/achievements';
import { HistoryRide, progression } from '../core/progression';
import { patchWall, powerBlock, statsLine, xpReveal } from './progress';

const DAY = 86_400_000;
const MON = Date.UTC(2026, 8, 28, 7);
const opts = { weeklyGoal: 3, utcOffsetMin: 0, now: MON + 30 * DAY };
const ride = (i: number, tss = 60): HistoryRide => ({ id: `r${i}`, startedAt: MON + i * DAY, seconds: 3600, tss, compliance: 0.8 });

describe('progress UI', () => {
  it('reveals XP, a rank-up and new patches for the ride that earned them', () => {
    const history = Array.from({ length: 4 }, (_, i) => ride(i));
    const before = progression(history.slice(0, 3), opts); // 180 XP: Pedal Pusher
    const after = progression(history, opts); // 4 × 60 = 240 XP: still Pedal Pusher
    const bigRide = ride(4, 120);
    const after2 = progression([...history, bigRide], opts);
    const html = xpReveal({
      xp: after2.rides.at(-1)!.xp,
      simulated: false,
      before: after,
      after: after2,
      newlyEarned: earnedBy(after2.achievements, bigRide.id),
    });
    expect(before.rank.rank.name).toBe('Pedal Pusher');
    expect(after2.rank.rank.name).toBe('Sweat Apprentice');
    // 120 TSS plus the +5% streak bonus: these rides are daily, so this week already met the goal.
    expect(after2.rides.at(-1)!.xp).toMatchObject({ xp: 126, streakBonus: 0.05 });
    expect(html).toContain('data-xp="126"');
    expect(html).toContain('+5% streak');
    expect(html).toContain('Rank up');
    expect(html).toContain('Sweat Apprentice');
    expect(html).toContain('Century of Stress'); // TSS 120 ≥ 100
  });

  it('says simulated rides earn nothing, and shows the wall with every patch', () => {
    const p = progression([ride(0)], opts);
    expect(xpReveal({ simulated: true, before: p, after: p, newlyEarned: [] })).toContain("don't earn XP");
    expect(powerBlock(p)).toContain('Pedal Pusher');
    expect(statsLine(p, { rides: 1, seconds: 3600, avgCompliance: 0.8 }, 3)).toContain('1</b>/23 patches');
    const wall = patchWall(p);
    expect((wall.match(/class="patch-badge/g) ?? []).length).toBe(23);
    expect((wall.match(/class="patch-badge earned/g) ?? []).length).toBe(1); // Big Bib Debut
  });
});
