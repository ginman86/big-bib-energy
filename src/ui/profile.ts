// Canvas rendering of a workout profile, optionally with the ridden power trace.

import { Band, bandHalfWidth, classify, DEFAULT_TOLERANCE, Tolerance } from '../core/compliance';
import { clock } from '../core/format';
import type { Sample } from '../core/session';
import { peakFraction, Segment, totalDuration } from '../core/workout';
import { zoneFor } from '../core/zones';

export interface ProfileOptions {
  segments: Segment[];
  ftp: number;
  samples?: Sample[];
  /** Ride clock position; draws the cursor and dims the past. */
  elapsed?: number;
  /** Current (sub-second) point, so the trace meets the cursor instead of trailing the last 1 Hz sample. */
  live?: Sample;
  /** Visible time range in seconds. Defaults to the whole workout. */
  range?: [number, number];
  tolerance?: Tolerance;
  /** FTP line, time axis, target tunnel. */
  detailed?: boolean;
}

type Palette = Record<'text' | 'text2' | 'text3' | 'line' | 'accent' | Band, string> & { zones: string[] };

let palette: Palette | undefined;
function colors(): Palette {
  if (palette) return palette;
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  palette = {
    text: v('--text'),
    text2: v('--text-2'),
    text3: v('--text-3'),
    line: v('--line-strong'),
    accent: v('--accent'),
    on: v('--on'),
    under: v('--under'),
    over: v('--over'),
    zones: [1, 2, 3, 4, 5, 6, 7].map((z) => v(`--z${z}`)),
  };
  return palette;
}

/** Sizes the backing store to the element's CSS size × devicePixelRatio. */
export function prepare(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

export function drawProfile(canvas: HTMLCanvasElement, opts: ProfileOptions) {
  const { ctx, width, height } = prepare(canvas);
  const c = colors();
  const { segments, ftp, samples = [], elapsed, detailed = false } = opts;
  const tol = opts.tolerance ?? DEFAULT_TOLERANCE;
  const [t0, t1] = opts.range ?? [0, totalDuration(segments)];
  if (t1 <= t0) return;

  const visible = samples.filter((s) => s.t >= t0 && s.t <= t1);
  const maxW = Math.max(peakFraction(segments) * ftp * 1.12, ftp * 1.15, ...visible.map((s) => s.power * 1.05));
  const top = detailed ? 14 : 2;
  const bottom = detailed ? 22 : 0;
  const x = (t: number) => ((t - t0) / (t1 - t0)) * width;
  // The detailed view raises its floor so deviations from target are easy to see.
  const minW = detailed ? ftp * 0.25 : 0;
  const y = (w: number) => height - bottom - ((Math.max(w, minW) - minW) / (maxW - minW)) * (height - top - bottom);

  // Zone blocks.
  for (const s of segments) {
    if (s.end <= t0 || s.start >= t1) continue;
    const past = elapsed !== undefined && s.end <= elapsed;
    const current = elapsed !== undefined && elapsed >= s.start && elapsed < s.end;
    const zone = zoneFor((s.from + s.to) / 2);
    ctx.globalAlpha = (past ? 0.45 : 1) * (detailed && !current ? 0.6 : 1);
    ctx.fillStyle = c.zones[zone.id - 1];
    ctx.beginPath();
    ctx.moveTo(x(s.start), y(0));
    ctx.lineTo(x(s.start), y(s.from * ftp));
    ctx.lineTo(x(s.end), y(s.to * ftp));
    ctx.lineTo(x(s.end), y(0));
    ctx.closePath();
    ctx.fill();

    // Top edge: the target line.
    ctx.strokeStyle = current ? c.text : c.text3;
    ctx.lineWidth = current ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(x(s.start), y(s.from * ftp));
    ctx.lineTo(x(s.end), y(s.to * ftp));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Tolerance tunnel ahead of the rider.
  if (detailed) {
    ctx.fillStyle = 'rgba(236,232,223,0.07)';
    for (const s of segments) {
      const a = Math.max(s.start, t0, elapsed ?? t0);
      const b = Math.min(s.end, t1);
      if (b <= a) continue;
      const at = (t: number) => (s.from + ((s.to - s.from) * (t - s.start)) / (s.end - s.start)) * ftp;
      const wa = at(a);
      const wb = at(b);
      ctx.beginPath();
      ctx.moveTo(x(a), y(wa + bandHalfWidth(wa, tol)));
      ctx.lineTo(x(b), y(wb + bandHalfWidth(wb, tol)));
      ctx.lineTo(x(b), y(wb - bandHalfWidth(wb, tol)));
      ctx.lineTo(x(a), y(wa - bandHalfWidth(wa, tol)));
      ctx.closePath();
      ctx.fill();
    }

    // FTP reference.
    ctx.strokeStyle = c.line;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(0, y(ftp));
    ctx.lineTo(width, y(ftp));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = c.text3;
    ctx.font = '600 10px Barlow, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`FTP ${ftp}`, 4, y(ftp) - 3);

    // Time axis.
    const span = t1 - t0;
    const step = span <= 4 * 60 ? 30 : span <= 12 * 60 ? 60 : span <= 60 * 60 ? 300 : 600;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
      if (x(t) > 20 && x(t) < width - 20) ctx.fillText(clock(t), x(t), height - 6);
    }
    ctx.textAlign = 'left';
  }

  drawTrace(ctx, visible, x, y, tol, c, opts.live);

  // Cursor.
  if (elapsed !== undefined && elapsed >= t0 && elapsed <= t1) {
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x(elapsed), 0);
    ctx.lineTo(x(elapsed), height - bottom);
    ctx.stroke();
  }
}

/** Power trace, 3 s smoothed, coloured by whether each moment was in the band. */
function drawTrace(
  ctx: CanvasRenderingContext2D,
  samples: Sample[],
  x: (t: number) => number,
  y: (w: number) => number,
  tol: Tolerance,
  c: Palette,
  live?: Sample,
) {
  const pts = samples.map((s, i) => {
    const win = samples.slice(Math.max(0, i - 2), i + 1);
    const p = win.reduce((a, w) => a + w.power, 0) / win.length;
    return { t: s.t, p, band: classify(p, s.target, tol) };
  });
  // live.power is already 3 s smoothed by the session.
  if (live && (!pts.length || live.t > pts[pts.length - 1].t)) {
    pts.push({ t: live.t, p: live.power, band: classify(live.power, live.target, tol) });
  }
  if (pts.length < 2) return;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  let i = 0;
  while (i < pts.length - 1) {
    const band = pts[i].band;
    ctx.strokeStyle = c[band];
    ctx.beginPath();
    ctx.moveTo(x(pts[i].t), y(pts[i].p));
    let j = i + 1;
    while (j < pts.length) {
      ctx.lineTo(x(pts[j].t), y(pts[j].p));
      if (pts[j].band !== band) break;
      j++;
    }
    ctx.stroke();
    i = j;
  }

  if (live) {
    const head = pts[pts.length - 1];
    ctx.fillStyle = c[head.band];
    ctx.beginPath();
    ctx.arc(x(head.t), y(head.p), 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
