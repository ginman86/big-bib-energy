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
