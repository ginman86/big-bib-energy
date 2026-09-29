// GPX → Course: draw a route in Strava, RideWithGPS or Komoot, export GPX, ride it here.
// Resampled to even spacing and lightly smoothed (GPS/DEM elevation is noisy), then closed into a
// lap: a route that ends near its start becomes a loop, anything else an out-and-back.

import type { Course } from './course';
import { FormatError } from './formats';

export interface ImportedCourse {
  course: Course;
  warnings: string[];
}

interface Pt {
  d: number;
  lat: number;
  lon: number;
  ele?: number;
}

const R = 6_371_000;
const rad = (x: number) => (x * Math.PI) / 180;
export function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A route that ends within this of its start is a loop; we join the gap with a straight line. */
const CLOSE_M = 200;
const MAX_KM = 150;
/** Even spacing of the resampled profile; widened for long routes to keep the course small. */
const SPACING_M = 25;
const MAX_POINTS = 4000;
/** Steeper than this is a data glitch, not a road. */
const MAX_GRADE = 0.25;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'course';

function decode(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function parsePoints(xml: string): Pt[] {
  const pts: Pt[] = [];
  // Track points, or route points when the file is a planned route without a track.
  const tag = /<trkpt\b/i.test(xml) ? 'trkpt' : 'rtept';
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'gi');
  for (const m of xml.matchAll(re)) {
    const lat = Number(m[1].match(/\blat\s*=\s*["']([^"']+)/i)?.[1]);
    const lon = Number(m[1].match(/\blon\s*=\s*["']([^"']+)/i)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const eleText = m[2]?.match(/<ele>\s*([^<]+?)\s*<\/ele>/i)?.[1];
    const ele = eleText === undefined ? undefined : Number(eleText);
    const prev = pts[pts.length - 1];
    const d = prev ? prev.d + haversine(prev, { lat, lon }) : 0;
    if (prev && d - prev.d < 0.5) continue; // duplicate point
    pts.push({ d, lat, lon, ele: Number.isFinite(ele) ? ele : undefined });
  }
  return pts;
}

/** Fills missing elevations by interpolating between known ones. */
function fillElevation(pts: Pt[]): number {
  const known = pts.filter((p) => p.ele !== undefined);
  if (!known.length) return 0;
  let k = 0;
  for (const p of pts) {
    if (p.ele !== undefined) continue;
    while (k < known.length - 1 && known[k + 1].d < p.d) k++;
    const a = known[k];
    const b = known[Math.min(k + 1, known.length - 1)];
    p.ele = b.d > a.d ? a.ele! + ((b.ele! - a.ele!) * (p.d - a.d)) / (b.d - a.d) : a.ele;
  }
  return known.length / pts.length;
}

function resample(pts: Pt[], step: number): Pt[] {
  const total = pts[pts.length - 1].d;
  const out: Pt[] = [];
  let j = 0;
  for (let d = 0; d < total; d += step) {
    while (j < pts.length - 2 && pts[j + 1].d < d) j++;
    const a = pts[j];
    const b = pts[j + 1];
    const f = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
    out.push({ d, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, ele: a.ele! + (b.ele! - a.ele!) * f });
  }
  const last = pts[pts.length - 1];
  // Don't leave a sliver of a final step (a tiny run makes any rise look like a wall).
  if (out.length > 1 && last.d - out[out.length - 1].d < step / 2) out.pop();
  out.push({ ...last });
  return out;
}

/** Rolling median (kills spikes) then a moving average (smooths steps), each over ±`half` samples. */
export function smooth(values: number[], half: number): number[] {
  const med = values.map((_, i) => {
    const w = values.slice(Math.max(0, i - half), i + half + 1).sort((a, b) => a - b);
    return w[w.length >> 1];
  });
  return med.map((_, i) => {
    const w = med.slice(Math.max(0, i - half), i + half + 1);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
}

export function importGpx(fileName: string, xml: string): ImportedCourse {
  if (!/<gpx\b/i.test(xml)) throw new FormatError('Not a GPX file');
  const warnings: string[] = [];
  let pts = parsePoints(xml);
  if (pts.length < 2) throw new FormatError('No route points found in this GPX');
  const total = pts[pts.length - 1].d;
  if (total < 500) throw new FormatError('That route is under 500 m; draw a longer one');
  if (total > MAX_KM * 1000) throw new FormatError(`That route is ${Math.round(total / 1000)} km; keep courses under ${MAX_KM} km`);
  const coverage = fillElevation(pts);
  if (coverage === 0) {
    throw new FormatError('This GPX has no elevation. Export it from Strava, RideWithGPS or Komoot, which include it.');
  }
  if (coverage < 0.8) warnings.push('Some points had no elevation; they were filled in between known ones.');

  // Close the lap.
  const start = pts[0];
  const end = pts[pts.length - 1];
  const gap = haversine(end, start);
  let kind: Course['kind'] = 'loop';
  if (gap > 0.5 && gap <= CLOSE_M) {
    pts.push({ ...start, d: end.d + gap });
  } else if (gap > CLOSE_M) {
    kind = 'out-and-back';
    const back = pts
      .slice(0, -1)
      .reverse()
      .map((p) => ({ ...p, d: 2 * end.d - p.d }));
    pts = [...pts, ...back];
    warnings.push(`It ends ${(gap / 1000).toFixed(1)} km from where it starts, so it rides out and back.`);
  }

  const lapTotal = pts[pts.length - 1].d;
  const step = Math.max(SPACING_M, lapTotal / MAX_POINTS);
  const rs = resample(pts, step);
  // ~75 m windows at 25 m spacing, like the built-in courses.
  const ele = smooth(
    rs.map((p) => p.ele!),
    Math.max(1, Math.round(37 / step)),
  );
  // Cap grade glitches.
  for (let i = 1; i < ele.length; i++) {
    const run = rs[i].d - rs[i - 1].d;
    const rise = ele[i] - ele[i - 1];
    if (Math.abs(rise) > run * MAX_GRADE) ele[i] = ele[i - 1] + Math.sign(rise) * run * MAX_GRADE;
  }
  // The lap must end where it starts: spread any leftover difference over the whole lap.
  const drift = ele[ele.length - 1] - ele[0];
  for (let i = 1; i < ele.length; i++) ele[i] -= (drift * rs[i].d) / lapTotal;

  const name =
    decode(xml.match(/<trk>[\s\S]*?<name>([\s\S]*?)<\/name>/i)?.[1] ?? xml.match(/<metadata>[\s\S]*?<name>([\s\S]*?)<\/name>/i)?.[1] ?? '')
      .replace(/<!\[CDATA\[|\]\]>/g, '')
      .trim() || fileName.replace(/\.[^.]+$/, '');
  const round = (x: number, k: number) => Math.round(x * k) / k;
  return {
    course: {
      id: `gpx-${slug(name)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      place: '',
      kind,
      lapMeters: Math.round(lapTotal),
      profile: rs.map((p, i) => [Math.round(p.d), round(ele[i], 10)]),
      track: rs.map((p) => [round(p.lat, 1e5), round(p.lon, 1e5)]),
      source: `Imported from ${fileName}`,
    },
    warnings,
  };
}
