// Workout file formats: .zwo (Zwift, also exported by TrainingPeaks), .mrc (% FTP) and .erg
// (watts). Pure string parsing; no DOM, so the core stays portable.

import { free, ramp, Step, steady, Workout } from './workout';

export interface Imported {
  workout: Workout;
  /** Things we couldn't represent exactly, shown before saving. */
  warnings: string[];
}

export class FormatError extends Error {}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'workout';

export const newWorkoutId = (name: string) => `custom-${slug(name)}-${Math.random().toString(36).slice(2, 8)}`;

/** Picks the parser by file extension. `ftp` converts .erg watts when the file doesn't say. */
export function importWorkoutFile(fileName: string, text: string, ftp: number): Imported {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'zwo') return parseZwo(text);
  if (ext === 'mrc') return parsePoints(text, 'mrc', ftp, fileName);
  if (ext === 'erg') return parsePoints(text, 'erg', ftp, fileName);
  throw new FormatError(`Unsupported file type .${ext}: use .zwo, .mrc or .erg`);
}

// ——— .zwo ———

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
    e.startsWith('#x') ? String.fromCodePoint(parseInt(e.slice(2), 16)) : e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1))) : (ENTITIES[e] ?? m),
  );
const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function attrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = decode(m[3] ?? m[4]);
  return out;
}

function textOf(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return undefined;
  const cdata = m[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return (cdata ? cdata[1] : decode(m[1])).trim();
}

export function parseZwo(xml: string): Imported {
  const body = xml.match(/<workout\b[^>]*>([\s\S]*?)<\/workout>/i);
  if (!/<workout_file\b/i.test(xml) || !body) throw new FormatError('Not a Zwift workout (.zwo) file');
  const name = textOf(xml, 'name') || 'Imported workout';
  const description = textOf(xml, 'description') ?? '';
  const warnings: string[] = [];
  const sport = textOf(xml, 'sportType');
  if (sport && sport.toLowerCase() !== 'bike') warnings.push(`This is a ${sport} workout; it's been imported as a ride.`);

  const steps: Step[] = [];
  let cadence = false;
  let textEvents = 0;
  const num = (a: Record<string, string>, ...keys: string[]) => {
    for (const k of keys) if (a[k] !== undefined && a[k] !== '') return Number(a[k]);
    return NaN;
  };

  // Only top-level blocks matter; <textevent> children are counted, not parsed.
  for (const m of body[1].matchAll(/<(\w+)\b([^>]*?)(\/?)>/g)) {
    const tag = m[1].toLowerCase();
    const a = attrs(m[2]);
    if (tag === 'textevent') {
      textEvents++;
      continue;
    }
    if (a.cadence || a.cadencelow || a.cadenceresting) cadence = true;
    const duration = Math.round(num(a, 'duration'));
    switch (tag) {
      case 'steadystate': {
        const p = num(a, 'power', 'powerlow');
        steps.push(steady(duration, p));
        break;
      }
      case 'warmup':
      case 'cooldown':
      case 'ramp': {
        // Zwift's PowerLow/PowerHigh are start/end, even when a cooldown goes down.
        const label = tag === 'warmup' ? 'Warm up' : tag === 'cooldown' ? 'Cool down' : undefined;
        steps.push(ramp(duration, num(a, 'powerlow'), num(a, 'powerhigh'), label));
        break;
      }
      case 'intervalst': {
        const n = Math.max(1, Math.round(num(a, 'repeat')));
        const on = Math.round(num(a, 'onduration'));
        const off = Math.round(num(a, 'offduration'));
        const onP = num(a, 'onpower', 'poweronhigh', 'poweronlow');
        const offP = num(a, 'offpower', 'poweroffhigh', 'powerofflow');
        for (let i = 1; i <= n; i++) {
          steps.push(steady(on, onP, `Interval ${i}/${n}`));
          if (off > 0) steps.push(steady(off, offP, `Recover ${i}/${n}`));
        }
        break;
      }
      case 'freeride':
        steps.push(free(duration));
        break;
      case 'maxeffort':
        steps.push(steady(duration, 1.5, 'Max effort'));
        warnings.push('Max-effort blocks became 150% FTP targets.');
        break;
      default:
        if (m[3] === '/' || a.duration) warnings.push(`Skipped an unsupported <${m[1]}> block.`);
    }
  }

  for (const s of steps) {
    if (!(s.duration > 0) || (s.kind === 'steady' && !(s.power >= 0)) || (s.kind === 'ramp' && !(s.from >= 0 && s.to >= 0))) {
      throw new FormatError('The file has a block with a missing or invalid duration or power');
    }
  }
  if (!steps.length) throw new FormatError('No workout blocks found');
  if (cadence) warnings.push('Cadence targets were ignored.');
  if (textEvents) warnings.push(`${textEvents} on-screen messages were ignored.`);
  return { workout: { id: newWorkoutId(name), name, description, steps }, warnings };
}

export function toZwo(w: Workout): string {
  const f = (n: number) => String(Math.round(n * 1000) / 1000);
  const blocks = w.steps.map((s, i) => {
    if (s.kind === 'free') return `    <FreeRide Duration="${s.duration}" FlatRoad="1"/>`;
    if (s.kind === 'steady') return `    <SteadyState Duration="${s.duration}" Power="${f(s.power)}"/>`;
    const tag = i === 0 && s.to > s.from ? 'Warmup' : i === w.steps.length - 1 && s.to < s.from ? 'Cooldown' : 'Ramp';
    return `    <${tag} Duration="${s.duration}" PowerLow="${f(s.from)}" PowerHigh="${f(s.to)}"/>`;
  });
  return [
    '<workout_file>',
    '  <author>Big Bib Energy</author>',
    `  <name>${encode(w.name)}</name>`,
    `  <description>${encode(w.description)}</description>`,
    '  <sportType>bike</sportType>',
    '  <workout>',
    ...blocks,
    '  </workout>',
    '</workout_file>',
    '',
  ].join('\n');
}

// ——— .mrc / .erg ———

/** Point lists ("minutes value" pairs). A repeated time is a step; a change between times is a ramp. */
function parsePoints(text: string, kind: 'mrc' | 'erg', riderFtp: number, fileName: string): Imported {
  const header = text.match(/\[COURSE HEADER\]([\s\S]*?)\[END COURSE HEADER\]/i)?.[1] ?? '';
  const data = text.match(/\[COURSE DATA\]([\s\S]*?)\[END COURSE DATA\]/i)?.[1];
  if (!data) throw new FormatError(`Not a valid .${kind} file (no [COURSE DATA])`);
  const field = (k: string) => header.match(new RegExp(`^\\s*${k}\\s*=\\s*(.+)$`, 'im'))?.[1].trim();

  const warnings: string[] = [];
  let scale = 0.01; // mrc: percent of FTP
  if (kind === 'erg') {
    const fileFtp = Number(field('FTP'));
    const ftp = fileFtp > 0 ? fileFtp : riderFtp;
    if (!(fileFtp > 0)) warnings.push(`The file has no FTP; watts were converted using yours (${riderFtp} W).`);
    scale = 1 / ftp;
  }
  if (/MINUTES\s+PERCENT/i.test(header) === false && kind === 'mrc' && /WATTS/i.test(header)) {
    throw new FormatError('This .mrc file uses watts; rename it .erg');
  }

  const pts = data
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter((p) => p.length >= 2 && p.every(Number.isFinite))
    .map(([m, v]) => ({ t: Math.round(m * 60), p: v * scale }));
  if (pts.length < 2) throw new FormatError('No workout data points found');

  const steps: Step[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (b.t <= a.t) continue; // same time: an instant step between blocks
    const round = (x: number) => Math.round(x * 1000) / 1000;
    steps.push(Math.abs(a.p - b.p) < 0.005 ? steady(b.t - a.t, round(a.p)) : ramp(b.t - a.t, round(a.p), round(b.p)));
  }
  if (!steps.length) throw new FormatError('No workout blocks found');

  const name = field('DESCRIPTION') || fileName.replace(/\.[^.]+$/, '') || 'Imported workout';
  return { workout: { id: newWorkoutId(name), name, description: '', steps }, warnings };
}
