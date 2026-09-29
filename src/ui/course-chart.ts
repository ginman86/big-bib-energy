// Course strip: one lap's elevation profile with the rider's position on it.

import { Course, elevationAt } from '../core/course';
import { prepare } from './profile';

const profileCache = new WeakMap<Course, { lo: number; hi: number }>();
function range(c: Course) {
  let r = profileCache.get(c);
  if (!r) {
    const els = c.profile.map((p) => p[1]);
    r = { lo: Math.min(...els), hi: Math.max(...els) };
    profileCache.set(c, r);
  }
  return r;
}

let palette: { text: string; text2: string; text3: string; accent: string; line: string } | undefined;
function colors() {
  if (!palette) {
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    palette = { text: v('--text'), text2: v('--text-2'), text3: v('--text-3'), accent: v('--accent'), line: v('--line-strong') };
  }
  return palette;
}

export function drawCourse(canvas: HTMLCanvasElement, course: Course, distance: number) {
  const { ctx, width, height } = prepare(canvas);
  const c = colors();
  const { lo, hi } = range(course);
  // Headroom for the course name above the highest point.
  const top = 20;
  const bottom = 3;
  // Keep gentle loops from looking alpine: at least 40 m of vertical range.
  const span = Math.max(40, hi - lo);
  const x = (d: number) => (d / course.lapMeters) * width;
  const y = (e: number) => height - bottom - ((e - lo) / span) * (height - top - bottom);
  const at = ((distance % course.lapMeters) + course.lapMeters) % course.lapMeters;

  const path = (to: number) => {
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (const [d, e] of course.profile) {
      if (d > to) break;
      ctx.lineTo(x(d), y(e));
    }
    ctx.lineTo(x(to), y(elevationAt(course, to)));
    ctx.lineTo(x(to), height);
    ctx.closePath();
  };

  // Whole lap, then the part of this lap already ridden.
  ctx.fillStyle = c.line;
  ctx.globalAlpha = 0.5;
  path(course.lapMeters);
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = c.text3;
  path(at);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Rider.
  const rx = x(at);
  const ry = y(elevationAt(course, at));
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.arc(rx, ry, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = c.text;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** Track projected to canvas space, cached per course and size. */
const routeCache = new WeakMap<Course, { w: number; h: number; pts: [number, number][] }>();
function project(course: Course, w: number, h: number, pad: number): [number, number][] {
  const hit = routeCache.get(course);
  if (hit && hit.w === w && hit.h === h) return hit.pts;
  const track = course.track!;
  const lat0 = (track.reduce((a, p) => a + p[0], 0) / track.length) * (Math.PI / 180);
  // Equirectangular: fine at neighbourhood scale.
  const xy = track.map(([lat, lon]) => [lon * Math.cos(lat0), -lat] as [number, number]);
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.min((w - 2 * pad) / Math.max(1e-9, x1 - x0), (h - 2 * pad) / Math.max(1e-9, y1 - y0));
  const ox = (w - (x1 - x0) * k) / 2;
  const oy = (h - (y1 - y0) * k) / 2;
  const pts = xy.map(([x, y]) => [ox + (x - x0) * k, oy + (y - y0) * k] as [number, number]);
  routeCache.set(course, { w, h, pts });
  return pts;
}

/** Mini route map: the lap's outline, what you've ridden of it, and where you are. */
export function drawRoute(canvas: HTMLCanvasElement, course: Course, distance: number) {
  const { ctx, width, height } = prepare(canvas);
  if (!course.track?.length) return;
  const c = colors();
  const pts = project(course, width, height, 8);
  const at = ((distance % course.lapMeters) + course.lapMeters) % course.lapMeters;
  // Profile and track share indices; find the point we're at.
  let i = course.profile.findIndex((p) => p[0] > at) - 1;
  if (i < 0) i = course.profile.length - 1;

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = c.text3;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.strokeStyle = c.text;
  ctx.beginPath();
  pts.slice(0, i + 1).forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();

  const [a, b] = [course.profile[i], course.profile[Math.min(i + 1, course.profile.length - 1)]];
  const f = b[0] > a[0] ? (at - a[0]) / (b[0] - a[0]) : 0;
  const p = pts[i];
  const q = pts[Math.min(i + 1, pts.length - 1)];
  ctx.fillStyle = c.accent;
  ctx.strokeStyle = c.text;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

// ——— Road ahead (free ride's main chart) ———

const BEHIND_M = 250;
const AHEAD_M = 1750;

let roadPalette: { zones: string[]; text: string; text2: string; text3: string; accent: string; line: string } | undefined;
function roadColors() {
  if (!roadPalette) {
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    roadPalette = { zones: [1, 2, 3, 4, 5, 6, 7].map((z) => v(`--z${z}`)), text: v('--text'), text2: v('--text-2'), text3: v('--text-3'), accent: v('--accent'), line: v('--line-strong') };
  }
  return roadPalette;
}

/** Steeper is redder: flat and descents stay neutral, climbs deepen through the one accent colour. */
function gradeFill(g: number, c: ReturnType<typeof roadColors>): { color: string; alpha: number } {
  if (g < 0.02) return { color: c.line, alpha: 1 };
  if (g < 0.04) return { color: c.accent, alpha: 0.3 };
  if (g < 0.07) return { color: c.accent, alpha: 0.5 };
  if (g < 0.1) return { color: c.accent, alpha: 0.72 };
  return { color: c.accent, alpha: 0.95 };
}

/** The next ~2 km of road: elevation shaded by grade, climbs named, the rider on it. */
export function drawRoadAhead(canvas: HTMLCanvasElement, course: Course, distance: number, units: 'metric' | 'imperial') {
  const { ctx, width, height } = prepare(canvas);
  const c = roadColors();
  const d0 = distance - BEHIND_M;
  const d1 = distance + AHEAD_M;
  const step = 10;
  const pts: [number, number][] = [];
  for (let d = d0; d <= d1; d += step) pts.push([d, elevationAt(course, d)]);
  const els = pts.map((p) => p[1]);
  const lo = Math.min(...els);
  const hi = Math.max(...els);
  // Keep at least 30 m of vertical range so flat roads read as flat; leave room for labels.
  const span = Math.max(30, (hi - lo) * 1.15);
  const top = 28;
  const bottom = 22;
  const base = lo - (span - (hi - lo)) / 2;
  const x = (d: number) => ((d - d0) / (d1 - d0)) * width;
  const y = (e: number) => height - bottom - ((e - base) / span) * (height - top - bottom);

  // Road surface, one slice per step, coloured by its grade; the part behind the rider dimmed.
  for (let i = 1; i < pts.length; i++) {
    const [da, ea] = pts[i - 1];
    const [db, eb] = pts[i];
    const fill = gradeFill((eb - ea) / (db - da), c);
    ctx.globalAlpha = fill.alpha * (db <= distance ? 0.35 : 1);
    ctx.fillStyle = fill.color;
    ctx.beginPath();
    ctx.moveTo(x(da), height - bottom);
    ctx.lineTo(x(da), y(ea));
    ctx.lineTo(x(db), y(eb));
    ctx.lineTo(x(db), height - bottom);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Road edge.
  ctx.strokeStyle = c.text2;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  pts.forEach(([d, e], i) => (i ? ctx.lineTo(x(d), y(e)) : ctx.moveTo(x(d), y(e))));
  ctx.stroke();

  ctx.font = '600 11px Barlow, sans-serif';
  ctx.textBaseline = 'alphabetic';

  // Distance ticks ahead: every 0.25 mi or 500 m.
  const tick = units === 'imperial' ? 402.336 : 500;
  ctx.fillStyle = c.text3;
  ctx.textAlign = 'center';
  for (let k = 1; k * tick <= AHEAD_M; k++) {
    const d = distance + k * tick;
    ctx.fillRect(x(d), height - bottom, 1, 5);
    const label = units === 'imperial' ? `${(k * 0.25).toFixed(2).replace(/0$/, '')} mi` : `${(k * 0.5).toFixed(1)} km`;
    ctx.fillText(label, x(d), height - 5);
  }

  // Climb names where they start in view (this lap or the next).
  ctx.textAlign = 'left';
  for (const cl of course.climbs ?? []) {
    for (const lapStart of [Math.floor(distance / course.lapMeters) * course.lapMeters, (Math.floor(distance / course.lapMeters) + 1) * course.lapMeters]) {
      const s = lapStart + cl.start;
      const e = lapStart + cl.end;
      if (e < d0 || s > d1) continue;
      const sx = Math.max(4, x(s));
      ctx.strokeStyle = c.text3;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x(s), 16);
      ctx.lineTo(x(s), y(elevationAt(course, s)));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = c.text2;
      ctx.fillText(`${cl.name.toUpperCase()} · ${Math.round(cl.avgGrade * 100)}%`, sx + 4, 14);
    }
  }

  // The rider.
  const rx = x(distance);
  const ry = y(elevationAt(course, distance));
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(rx, top - 6);
  ctx.lineTo(rx, height - bottom);
  ctx.stroke();
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.arc(rx, ry, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = c.text;
  ctx.lineWidth = 2;
  ctx.stroke();
}
