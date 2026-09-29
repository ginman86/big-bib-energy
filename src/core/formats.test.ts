import { describe, expect, it } from 'vitest';
import { liveWorkouts, mergeCustom } from './custom-workouts';
import { FormatError, importWorkoutFile, parseZwo, toZwo } from './formats';
import { formatWorkoutText, parseWorkoutText, WorkoutSyntaxError } from './workout-text';
import { expand, totalDuration } from './workout';

// Shaped like a TrainingPeaks power-workout export.
const TP_ZWO = `<?xml version="1.0" encoding="utf-8"?>
<workout_file>
  <author>TrainingPeaks</author>
  <name>Threshold 2x20 &amp; Openers</name>
  <description><![CDATA[Two threshold blocks. <b>Stay seated.</b>]]></description>
  <sportType>bike</sportType>
  <tags />
  <workout>
    <Warmup Duration="600" PowerLow="0.5" PowerHigh="0.75" />
    <IntervalsT Repeat="3" OnDuration="30" OffDuration="30" OnPower="1.2" OffPower="0.55" Cadence="100"/>
    <SteadyState Duration="1200" Power="0.97">
      <textevent timeoffset="10" message="Settle in"/>
    </SteadyState>
    <FreeRide Duration="300" FlatRoad="1"/>
    <SteadyState Duration="1200" Power="0.97"/>
    <Cooldown Duration="480" PowerLow="0.65" PowerHigh="0.4"/>
  </workout>
</workout_file>`;

describe('.zwo', () => {
  const { workout: w, warnings } = parseZwo(TP_ZWO);

  it('reads name, description and every block type', () => {
    expect(w.name).toBe('Threshold 2x20 & Openers');
    expect(w.description).toBe('Two threshold blocks. <b>Stay seated.</b>');
    expect(w.steps.map((s) => s.kind)).toEqual(['ramp', 'steady', 'steady', 'steady', 'steady', 'steady', 'steady', 'steady', 'free', 'steady', 'ramp']);
    expect(w.steps[0]).toMatchObject({ kind: 'ramp', duration: 600, from: 0.5, to: 0.75, label: 'Warm up' });
    expect(w.steps[1]).toMatchObject({ duration: 30, power: 1.2, label: 'Interval 1/3' });
    expect(w.steps[2]).toMatchObject({ duration: 30, power: 0.55, label: 'Recover 1/3' });
    expect(w.steps.at(-1)).toMatchObject({ from: 0.65, to: 0.4, label: 'Cool down' });
    expect(totalDuration(expand(w))).toBe(600 + 180 + 1200 + 300 + 1200 + 480);
  });

  it('warns about what it had to drop', () => {
    expect(warnings).toContain('Cadence targets were ignored.');
    expect(warnings).toContain('1 on-screen messages were ignored.');
  });

  it('round-trips through the writer', () => {
    const again = parseZwo(toZwo(w)).workout;
    expect(again.name).toBe(w.name);
    expect(again.steps.map(({ label: _l, ...s }) => s)).toEqual(w.steps.map(({ label: _l, ...s }) => s));
  });

  it('rejects files that are not workouts', () => {
    expect(() => parseZwo('<html></html>')).toThrow(FormatError);
    expect(() => parseZwo('<workout_file><workout><SteadyState Duration="60"/></workout></workout_file>')).toThrow(/invalid duration or power/);
  });
});

describe('.mrc / .erg', () => {
  const MRC = `[COURSE HEADER]
VERSION = 2
UNITS = ENGLISH
DESCRIPTION = Sweet Spot Ladder
FILE NAME = ssl.mrc
MINUTES PERCENT
[END COURSE HEADER]
[COURSE DATA]
0.00	50
10.00	75
10.00	88
20.00	88
20.00	55
25.00	55
[END COURSE DATA]`;

  it('reads percent points into ramps and steps', () => {
    const { workout: w, warnings } = importWorkoutFile('ssl.mrc', MRC, 250);
    expect(w.name).toBe('Sweet Spot Ladder');
    expect(warnings).toEqual([]);
    expect(w.steps).toEqual([
      { kind: 'ramp', duration: 600, from: 0.5, to: 0.75, label: undefined },
      { kind: 'steady', duration: 600, power: 0.88, label: undefined },
      { kind: 'steady', duration: 300, power: 0.55, label: undefined },
    ]);
  });

  it('converts .erg watts with the file FTP, or the rider FTP with a warning', () => {
    const erg = MRC.replace('MINUTES PERCENT', 'FTP = 200\nMINUTES WATTS').replace(/\t(\d+)/g, (_, v) => `\t${Number(v) * 2}`);
    expect(importWorkoutFile('x.erg', erg, 250).workout.steps[1]).toMatchObject({ power: 0.88 });
    const noFtp = erg.replace('FTP = 200\n', '');
    const r = importWorkoutFile('x.erg', noFtp, 400);
    expect(r.workout.steps[1]).toMatchObject({ power: 0.44 });
    expect(r.warnings[0]).toMatch(/using yours \(400 W\)/);
  });

  it('rejects unknown types', () => {
    expect(() => importWorkoutFile('ride.fit', '', 250)).toThrow(/Unsupported file type/);
  });
});

describe('text syntax', () => {
  it('parses durations, powers, ramps, free ride, labels and repeats', () => {
    const steps = parseWorkoutText('10m 50>75, 3x(10m 90, 5m 55), 1m30s free, 8m 65>40 "Cool down"');
    expect(steps).toHaveLength(1 + 6 + 1 + 1);
    expect(steps[0]).toMatchObject({ kind: 'ramp', duration: 600, from: 0.5, to: 0.75 });
    expect(steps[1]).toMatchObject({ kind: 'steady', duration: 600, power: 0.9, label: 'Interval 1/3' });
    expect(steps[6]).toMatchObject({ power: 0.55, label: 'Recover 3/3' });
    expect(steps[7]).toMatchObject({ kind: 'free', duration: 90 });
    expect(steps[8]).toMatchObject({ label: 'Cool down' });
  });

  it('formats back, folding repeats', () => {
    const src = '10m 50>75, 3x(10m 90, 5m 55), 1m30s free, 8m 65>40 "Cool down"';
    expect(formatWorkoutText(parseWorkoutText(src))).toBe(src);
    expect(formatWorkoutText(parseWorkoutText('4x(30s 120, 30s 50), 5m 60'))).toBe('4x(30s 120, 30s 50), 5m 60');
  });

  it('reports errors with a position', () => {
    for (const bad of ['', '10m', '10m 90 (', '3x(10m 90', 'abc', '10m 300 80', '5m 900']) {
      expect(() => parseWorkoutText(bad), bad).toThrow(WorkoutSyntaxError);
    }
  });
});

describe('custom workout sync', () => {
  const w = (name: string) => ({ id: 'custom-a', name, description: '', steps: [] });
  it('newest change wins either way, and tombstones stay dead', () => {
    const remote = [{ id: 'custom-a', workout: w('server'), updatedAt: '2026-09-28T10:00:00Z' }];
    const newerLocal = [{ id: 'custom-a', workout: w('local'), updatedAt: '2026-09-28T11:00:00Z' }];
    expect(mergeCustom(newerLocal, remote)).toMatchObject({ merged: [{ workout: { name: 'local' } }], push: [{ id: 'custom-a' }] });
    const olderLocal = [{ id: 'custom-a', workout: w('local'), updatedAt: '2026-09-28T09:00:00Z' }];
    expect(mergeCustom(olderLocal, remote)).toMatchObject({ merged: [{ workout: { name: 'server' } }], push: [] });
    const deletedRemote = [{ id: 'custom-a', deleted: true, updatedAt: '2026-09-28T12:00:00Z' }];
    expect(liveWorkouts(mergeCustom(newerLocal, deletedRemote).merged)).toEqual([]);
  });
});
