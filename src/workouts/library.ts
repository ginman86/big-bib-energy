import { rampTestWorkout } from '../core/ramp-test';
import { free, minutes, ramp, repeat, Step, steady, Workout } from '../core/workout';

const warmup = (m = 10) => ramp(minutes(m), 0.45, 0.72, 'Warm up');
const cooldown = (m = 8) => ramp(minutes(m), 0.65, 0.4, 'Cool down');

export const LIBRARY: Workout[] = [
  {
    id: 'demo-6',
    name: 'Shakeout',
    description: 'Six minutes to try the screen. Short blocks, quick changes.',
    steps: [
      ramp(60, 0.5, 0.7, 'Warm up'),
      ...repeat(3, steady(45, 1.05), steady(30, 0.55)),
      steady(60, 0.85, 'Tempo'),
      ramp(45, 0.7, 0.45, 'Cool down'),
    ],
  },
  rampTestWorkout(),
  {
    id: 'sweet-spot-3x10',
    name: 'Sweet Spot 3×10',
    description: 'Three ten-minute blocks just under threshold. The workhorse.',
    steps: [warmup(), ...repeat(3, steady(minutes(10), 0.9), steady(minutes(5), 0.55)), cooldown()],
  },
  {
    id: 'vo2-5x3',
    name: 'VO2 5×3',
    description: 'Five hard threes at 118%. Equal recovery. Breathe.',
    steps: [
      warmup(12),
      steady(minutes(2), 0.6, 'Openers'),
      ...repeat(5, steady(minutes(3), 1.18), steady(minutes(3), 0.5)),
      cooldown(),
    ],
  },
  {
    id: 'over-unders',
    name: 'Over–Unders',
    description: 'Surge above threshold, float just below. Teaches you to clear lactate at pace.',
    steps: [
      warmup(),
      ...[1, 2, 3].flatMap((set) => [
        ...[1, 2, 3].flatMap((rep) => [
          steady(minutes(2), 0.95, `Under ${set}.${rep}`),
          steady(minutes(1), 1.08, `Over ${set}.${rep}`),
        ]),
        ...(set < 3 ? [steady(minutes(5), 0.5, `Recover ${set}/3`)] : []),
      ]),
      cooldown(),
    ],
  },
  {
    id: 'pyramid',
    name: 'Pyramid',
    description: 'Up the ladder and back down. Every step two minutes.',
    steps: [
      warmup(),
      ...[0.7, 0.8, 0.9, 1.0, 1.1, 1.0, 0.9, 0.8, 0.7].map((p, i) => steady(minutes(2), p, `Step ${i + 1}/9`)),
      cooldown(),
    ],
  },
  {
    id: 'endurance-60',
    name: 'Long Steady',
    description: 'An hour of Zone 2 with a few tempo lifts to keep it honest.',
    steps: [
      ramp(minutes(8), 0.5, 0.68),
      steady(minutes(12), 0.68, 'Endurance'),
      steady(minutes(4), 0.82, 'Tempo lift'),
      steady(minutes(12), 0.68, 'Endurance'),
      steady(minutes(4), 0.82, 'Tempo lift'),
      steady(minutes(12), 0.68, 'Endurance'),
      ramp(minutes(8), 0.65, 0.45, 'Cool down'),
    ],
  },
  {
    id: 'sweet-spot-2x30',
    name: 'Sweet Spot 2×30',
    description: 'For when 3×10 gets easy. Two long ones, settle in and stay there.',
    steps: [warmup(), steady(minutes(30), 0.9, 'Sweet spot 1/2'), steady(minutes(5), 0.55, 'Recover'), steady(minutes(30), 0.9, 'Sweet spot 2/2'), cooldown()],
  },
  {
    id: 'threshold-2x20',
    name: 'Threshold 2×20',
    description: 'The classic FTP builder. Twenty minutes right at threshold, twice. Pace it; don’t chase it.',
    steps: [
      warmup(),
      ...repeat(3, steady(30, 1.1, 'Opener'), steady(90, 0.55, 'Easy')),
      steady(minutes(5), 0.55, 'Recover'),
      steady(minutes(20), 0.97, 'Threshold 1/2'),
      steady(minutes(5), 0.55, 'Recover'),
      steady(minutes(20), 0.97, 'Threshold 2/2'),
      cooldown(),
    ],
  },
  {
    id: 'thirty-fifteens',
    name: '30/15s',
    description: 'Rønnestad’s short intervals: three sets of 13 × 30 s hard, 15 s easy. Keeps you at VO2 max longer than long reps do.',
    steps: [
      warmup(),
      steady(minutes(3), 0.6, 'Settle'),
      ...[1, 2, 3].flatMap((set): Step[] => [
        ...Array.from({ length: 13 }, (_, i): Step[] => [steady(30, 1.2, `Set ${set} · ${i + 1}/13`), steady(15, 0.5, `Set ${set} · float`)]).flat(),
        steady(minutes(3), 0.5, set < 3 ? `Recover ${set}/2` : 'Recover'),
      ]),
      cooldown(),
    ],
  },
  {
    id: 'hard-start-4x4',
    name: 'Hard-Start 4×4',
    description: 'Each four opens with 30 s hard, then settles above threshold. You reach VO2 max sooner and stay there.',
    steps: [
      warmup(12),
      ...[1, 2, 3, 4].flatMap((i): Step[] => [
        steady(30, 1.4, `Hard start ${i}/4`),
        steady(210, 1.1, `Hold ${i}/4`),
        ...(i < 4 ? [steady(minutes(4), 0.5, `Recover ${i}/3`)] : []),
      ]),
      cooldown(),
    ],
  },
  {
    id: 'sprints',
    name: 'Sprints',
    description: 'Eight 10-second sprints. Free ride lets go of the trainer: shift up and go all out.',
    steps: [
      ramp(minutes(15), 0.5, 0.7, 'Warm up'),
      ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((i): Step[] => [free(10, `Sprint ${i}/8`), steady(290, 0.5, i < 8 ? `Recover ${i}/7` : 'Spin out')]),
      ramp(minutes(8), 0.55, 0.4, 'Cool down'),
    ],
  },
  {
    id: 'recovery-spin',
    name: 'Recovery Spin',
    description: 'Legs only. If it feels like training, go easier.',
    steps: [ramp(minutes(5), 0.4, 0.5, 'Spin up'), steady(minutes(30), 0.5, 'Easy'), ramp(minutes(5), 0.5, 0.4, 'Spin down')],
  },
];
