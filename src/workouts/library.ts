import { minutes, ramp, repeat, steady, Workout } from '../core/workout';

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
];
