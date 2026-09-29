// A compact text syntax for workouts, round-tripping with the step model:
//
//   10m 50>75, 3x(10m 90, 5m 55), 5m free, 8m 65>40 "Cool down"
//
// Durations: 90s, 10m, 1h, 1m30s. Power: % FTP, or "a>b" for a ramp, or "free".
// Nx(...) repeats its contents N times. An optional "label" follows a step.

import { free, ramp, Step, steady } from './workout';

export class WorkoutSyntaxError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
  }
}

// ——— Parsing ———

export function parseWorkoutText(src: string): Step[] {
  let i = 0;
  const ws = () => {
    while (i < src.length && /[\s,;]/.test(src[i])) i++;
  };
  const fail = (msg: string): never => {
    throw new WorkoutSyntaxError(msg, i);
  };

  function duration(): number {
    const m = src.slice(i).match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?/i);
    if (!m || !m[0]) return fail('Expected a duration like 10m, 90s or 1m30s');
    i += m[0].length;
    const secs = Math.round((Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)));
    if (secs <= 0) fail('Duration must be more than 0');
    return secs;
  }

  function pct(): number {
    const m = src.slice(i).match(/^(\d+(?:\.\d+)?)%?/);
    if (!m) return fail('Expected a power like 90 (% FTP)');
    i += m[0].length;
    const v = Number(m[1]);
    if (v > 400) fail('Power is % of FTP; that looks like watts');
    return v / 100;
  }

  function label(): string | undefined {
    ws();
    const m = src.slice(i).match(/^"([^"]*)"/);
    if (!m) return undefined;
    i += m[0].length;
    return m[1] || undefined;
  }

  function step(): Step {
    const d = duration();
    if (!/\s/.test(src[i] ?? '')) fail('Expected a space between duration and power');
    ws();
    if (/^free\b/i.test(src.slice(i))) {
      i += 4;
      return free(d, label());
    }
    const a = pct();
    if (src[i] === '>') {
      i++;
      const b = pct();
      return ramp(d, a, b, label());
    }
    return steady(d, a, label());
  }

  function items(closing: boolean): Step[] {
    const out: Step[] = [];
    for (;;) {
      ws();
      if (i >= src.length) {
        if (closing) fail('Missing )');
        return out;
      }
      if (src[i] === ')') {
        if (!closing) fail('Unexpected )');
        i++;
        return out;
      }
      const rep = src.slice(i).match(/^(\d+)\s*x\s*\(/i);
      if (rep) {
        i += rep[0].length;
        const n = Number(rep[1]);
        const body = items(true);
        if (!body.length) fail('Empty repeat');
        if (n < 1 || n > 50) fail('Repeat count must be 1–50');
        out.push(...expandRepeat(n, body));
        continue;
      }
      out.push(step());
    }
  }

  const steps = items(false);
  if (!steps.length) fail('Add at least one step');
  return steps;
}

/** Nx(on, off): "Interval i/N" / "Recover i/N" labels, like the built-in library. */
function expandRepeat(n: number, body: Step[]): Step[] {
  const out: Step[] = [];
  for (let k = 1; k <= n; k++) {
    body.forEach((s, j) => {
      // Free ride keeps its own label so the ride screen reads "Free ride", not "Recover".
      const auto = s.kind === 'free' ? undefined : body.length === 2 ? (j === 0 ? `Interval ${k}/${n}` : `Recover ${k}/${n}`) : `Set ${k}/${n}`;
      out.push({ ...s, label: s.label ?? auto });
    });
  }
  return out;
}

// ——— Formatting ———

const fmtDur = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h ? `${h}h` : ''}${m ? `${m}m` : ''}${sec ? `${sec}s` : ''}` || '0s';
};
const fmtPct = (f: number) => `${Math.round(f * 1000) / 10}`;

/** Labels that parsing would regenerate don't need writing out. */
const autoLabel = /^(Interval|Recover|Set) \d+\/\d+$|^(Steady|Ramp up|Ramp down|Free ride)$/;

function fmtStep(s: Step, withLabel: boolean): string {
  const body =
    s.kind === 'free' ? `${fmtDur(s.duration)} free` : s.kind === 'ramp' ? `${fmtDur(s.duration)} ${fmtPct(s.from)}>${fmtPct(s.to)}` : `${fmtDur(s.duration)} ${fmtPct(s.power)}`;
  return withLabel && s.label && !autoLabel.test(s.label) ? `${body} "${s.label.replace(/"/g, "'")}"` : body;
}

const sameShape = (a: Step, b: Step) => fmtStep(a, false) === fmtStep(b, false);

/** Steps back to text, folding consecutive repeats of a 1–4 step pattern into Nx(...). */
export function formatWorkoutText(steps: Step[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < steps.length) {
    let best: { len: number; n: number } | undefined;
    for (let len = 1; len <= 4; len++) {
      let n = 1;
      while (i + (n + 1) * len <= steps.length && steps.slice(i + n * len, i + (n + 1) * len).every((s, j) => sameShape(s, steps[i + j]))) n++;
      if (n >= 2 && (!best || n * len > best.n * best.len)) best = { len, n };
    }
    if (best) {
      parts.push(`${best.n}x(${steps.slice(i, i + best.len).map((s) => fmtStep(s, false)).join(', ')})`);
      i += best.n * best.len;
    } else {
      parts.push(fmtStep(steps[i], true));
      i++;
    }
  }
  return parts.join(', ');
}
