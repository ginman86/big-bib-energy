// Decodes our FIT output with Garmin's official SDK, so correctness is judged by Garmin, not us.
import { Decoder, Stream } from '@garmin/fitsdk';
import { describe, expect, it } from 'vitest';
import { encodeFitActivity, fitCrc, fitFileName } from './fit';
import { Session } from './session';
import { ramp, repeat, steady, Workout } from './workout';

const workout: Workout = {
  id: 'fit-test',
  name: 'Sweet Spot 3×10',
  description: '',
  steps: [ramp(60, 0.5, 0.7), ...repeat(2, steady(90, 0.9), steady(30, 0.5))],
};
const START = Date.UTC(2026, 8, 28, 6, 30, 0);

function ride() {
  const s = new Session(workout, 250);
  s.start(START);
  let t = 0;
  while (s.status === 'running') {
    const target = s.targetWatts();
    s.advance(0.5, { power: target + (t % 2 ? 4 : -4), cadence: 88 + (t % 3), heartRate: 120 + Math.round(t / 10) });
    t++;
  }
  return s;
}

// The SDK's types are stricter than a test needs (optional arrays, Date | number timestamps).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Messages = Record<string, any[]>;
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : Number(v));

function decode(bytes: Uint8Array): Messages {
  const d = new Decoder(Stream.fromByteArray(Array.from(bytes)));
  expect(d.isFIT()).toBe(true);
  expect(d.checkIntegrity()).toBe(true);
  const { messages, errors } = d.read();
  expect(errors).toEqual([]);
  return messages as unknown as Messages;
}

describe('fit export', () => {
  const s = ride();
  const summary = s.summary();
  const bytes = encodeFitActivity({ startedAtMs: START, utcOffsetS: -7 * 3600, summary, samples: s.samples });
  const m = decode(bytes);

  it('is an activity file from a development device', () => {
    expect(m.fileIdMesgs[0].type).toBe('activity');
    expect(m.fileIdMesgs[0].manufacturer).toBe('development');
  });

  it('has a 1 Hz record per ridden second with power, cadence and HR', () => {
    expect(m.recordMesgs).toHaveLength(s.samples.length);
    const first = m.recordMesgs[0];
    expect(ms(first.timestamp)).toBe(START);
    expect(first.power).toBe(s.samples[0].power);
    expect(first.cadence).toBe(s.samples[0].cadence);
    expect(first.heartRate).toBe(s.samples[0].heartRate);
    expect(ms(m.recordMesgs.at(-1).timestamp)).toBe(START + (s.samples.length - 1) * 1000);
  });

  it('writes one lap per workout block', () => {
    expect(m.lapMesgs).toHaveLength(4);
    const interval = m.lapMesgs[1];
    expect(interval.totalTimerTime).toBe(90);
    expect(ms(interval.startTime)).toBe(START + 60_000);
    expect(interval.avgPower).toBeCloseTo(225, -1);
    expect(interval.sport).toBe('cycling');
    expect(interval.subSport).toBe('indoorCycling');
  });

  it('summarises the session with training load', () => {
    const sess = m.sessionMesgs[0];
    expect(sess.sport).toBe('cycling');
    expect(sess.subSport).toBe('indoorCycling');
    expect(sess.totalTimerTime).toBe(summary.seconds);
    expect(sess.thresholdPower).toBe(250);
    expect(sess.normalizedPower).toBe(Math.round(summary.normalizedPower));
    expect(sess.trainingStressScore).toBeCloseTo(summary.tss, 1);
    expect(sess.intensityFactor).toBeCloseTo(summary.intensityFactor, 2);
    expect(sess.numLaps).toBe(4);
    expect(m.activityMesgs[0].numSessions).toBe(1);
    // Local timestamp carries the UTC offset (-7 h).
    expect(m.activityMesgs[0].localTimestamp - ms(m.activityMesgs[0].timestamp) / 1000 + 631065600).toBe(-7 * 3600);
  });

  it('handles missing HR and cadence as absent, not zero', () => {
    const t = new Session(workout, 250);
    t.start(START);
    while (t.status === 'running') t.advance(1, { power: 200 });
    const mm = decode(encodeFitActivity({ startedAtMs: START, utcOffsetS: 0, summary: t.summary(), samples: t.samples }));
    expect(mm.recordMesgs[0].heartRate).toBeUndefined();
    expect(mm.recordMesgs[0].cadence).toBeUndefined();
    expect(mm.sessionMesgs[0].avgHeartRate).toBeUndefined();
  });

  it('uses the standard FIT CRC and a tidy file name', () => {
    // CRC-16 of "123456789" per the FIT algorithm (ARC/IBM).
    expect(fitCrc(new TextEncoder().encode('123456789'))).toBe(0xbb3d);
    expect(fitFileName(summary, START)).toMatch(/^big-bib-energy-2026-09-2\d-sweet-spot-3x10\.fit$/);
  });
});
