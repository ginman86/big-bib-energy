// Heart-rate strip: HR over time on the same timeline as the power window, over zone bands.

import { HR_ZONES, hrZoneFor } from '../core/hr';
import type { Sample } from '../core/session';
import { prepare } from './profile';

export interface HrStripOptions {
  samples: Sample[];
  range: [number, number];
  lthr?: number;
  /** Current (sub-second) reading so the line meets the cursor. */
  live?: { t: number; bpm?: number };
}

// Resolved once: this runs every frame, and getComputedStyle isn't free.
const cache = new Map<string, string>();
function css(name: string): string {
  let v = cache.get(name);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    cache.set(name, v);
  }
  return v;
}
export const hrZoneColor = (zoneId: number) => css(`--hr${zoneId}`);

export function drawHrStrip(canvas: HTMLCanvasElement, { samples, range: [t0, t1], lthr, live }: HrStripOptions) {
  const { ctx, width, height } = prepare(canvas);
  const pts = samples.filter((s) => s.t >= t0 && s.t <= t1 && s.heartRate).map((s) => ({ t: s.t, bpm: s.heartRate! }));
  if (live?.bpm && (!pts.length || live.t > pts[pts.length - 1].t)) pts.push({ t: live.t, bpm: live.bpm });

  const seen = pts.map((p) => p.bpm);
  const lo = Math.min(lthr ? lthr * 0.68 : 90, ...seen.map((b) => b - 5));
  const hi = Math.max(lthr ? lthr * 1.1 : 180, ...seen.map((b) => b + 5));
  const x = (t: number) => ((t - t0) / (t1 - t0)) * width;
  const y = (bpm: number) => height - ((bpm - lo) / (hi - lo)) * height;

  // Zone bands with labels.
  if (lthr) {
    let floor = lo;
    ctx.font = '600 10px Barlow, sans-serif';
    ctx.textBaseline = 'middle';
    for (const z of HR_ZONES) {
      const top = Math.min(hi, z.max * lthr);
      if (top <= floor) continue;
      const color = hrZoneColor(z.id);
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = color;
      ctx.fillRect(0, y(top), width, y(floor) - y(top));
      ctx.globalAlpha = 0.7;
      if (y(floor) - y(top) > 11) ctx.fillText(`Z${z.id}`, 6, (y(top) + y(floor)) / 2);
      ctx.globalAlpha = 1;
      floor = top;
    }
  }

  // HR line, coloured by zone.
  if (pts.length > 1) {
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      ctx.strokeStyle = lthr ? hrZoneColor(hrZoneFor(pts[i].bpm, lthr).id) : css('--text');
      ctx.beginPath();
      ctx.moveTo(x(pts[i - 1].t), y(pts[i - 1].bpm));
      ctx.lineTo(x(pts[i].t), y(pts[i].bpm));
      ctx.stroke();
    }
  }

  if (live && live.t >= t0 && live.t <= t1) {
    ctx.strokeStyle = css('--accent');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x(live.t), 0);
    ctx.lineTo(x(live.t), height);
    ctx.stroke();
  }
}
