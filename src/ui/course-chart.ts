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
