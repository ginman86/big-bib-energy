import { hoursMinutes, pct } from '../core/format';
import { since, startOfMonth, totals } from '../core/history';
import { normalizedPower, trainingStress } from '../core/metrics';
import { expand, peakFraction, targetAt, totalDuration, Workout } from '../core/workout';
import { zoneFor } from '../core/zones';
import { bluetoothAvailable } from '../devices/ftms-trainer';
import type { HeartRateMonitor } from '../devices/heart-rate';
import type { ControlMode, Trainer } from '../devices/trainer';
import { LIBRARY } from '../workouts/library';
import { $, esc, html } from './dom';
import { drawProfile } from './profile';
import { loadHistory, Settings } from './storage';

export interface HomeProps {
  settings: Settings;
  trainer: Trainer | undefined;
  onSettings(s: Settings): void;
  onConnect(): Promise<void>;
  onDisconnect(): Promise<void>;
  heartRate: HeartRateMonitor | undefined;
  onConnectHr(): Promise<void>;
  onDisconnectHr(): Promise<void>;
  onRide(w: Workout): void;
}

function estimate(w: Workout, ftp: number) {
  const segs = expand(w);
  const seconds = totalDuration(segs);
  const watts = Array.from({ length: seconds }, (_, t) => (targetAt(segs, t) ?? 0) * ftp);
  const np = normalizedPower(watts);
  return { seconds, tss: trainingStress(seconds, np, ftp), focus: zoneFor(peakFraction(segs)).name };
}

export function renderHome(root: HTMLElement, props: HomeProps): () => void {
  const { settings } = props;
  const month = totals(since(loadHistory(), startOfMonth(new Date())));
  const hasBt = bluetoothAvailable();
  const real = props.trainer && !props.trainer.simulated ? props.trainer : undefined;

  const page = html(`
    <main class="home">
      <header class="topbar">
        <span class="wordmark">Zwifty<i>/</i>Pants</span>
        <span class="label">Indoor training</span>
      </header>

      <section class="hero-head">
        <h1>Hold<br/><em>the line.</em></h1>
        <div class="month">
          <div><span class="label">Rides · month</span><span class="num">${month.rides}</span></div>
          <div><span class="label">Time</span><span class="num">${month.rides ? hoursMinutes(month.seconds) : '—'}</span></div>
          <div><span class="label">On target</span><span class="num">${month.rides ? pct(month.avgCompliance) : '—'}</span></div>
        </div>
      </section>

      <section class="settings">
        <label class="field">
          <span class="label">FTP (W)</span>
          <input class="ftp-input num" type="number" min="80" max="600" step="1" value="${settings.ftp}" />
        </label>
        <div class="field">
          <span class="label">Control</span>
          <div class="seg" data-role="mode">
            <button data-mode="erg" aria-pressed="${settings.mode === 'erg'}">ERG</button>
            <button data-mode="target" aria-pressed="${settings.mode === 'target'}">Target</button>
          </div>
        </div>
        <div class="field">
          <span class="label">Trainer</span>
          <div style="display:flex;gap:14px;align-items:center">
            ${
              real
                ? `<button class="btn" data-role="disconnect">Disconnect</button><span class="trainer-status">● ${esc(real.name)}</span>`
                : `<button class="btn" data-role="connect" ${hasBt ? '' : 'disabled'}>Connect trainer</button>
                   <span class="trainer-status">${hasBt ? 'Simulated rider until connected' : 'Bluetooth needs Chrome or Edge · using simulated rider'}</span>`
            }
          </div>
        </div>
        <div class="field">
          <span class="label">Heart rate</span>
          <div style="display:flex;gap:14px;align-items:center">
            ${
              props.heartRate
                ? `<button class="btn" data-role="disconnect-hr">Disconnect</button><span class="trainer-status">● ${esc(props.heartRate.name)}</span>`
                : `<button class="btn" data-role="connect-hr" ${hasBt ? '' : 'disabled'}>Connect HR</button>
                   <span class="trainer-status">${hasBt ? 'Strap or watch in broadcast mode' : ''}</span>`
            }
          </div>
        </div>
      </section>

      <ol class="workouts"></ol>
    </main>
  `);

  const list = $(page, '.workouts');
  const canvases: [HTMLCanvasElement, Workout][] = [];
  LIBRARY.forEach((w, i) => {
    const est = estimate(w, settings.ftp);
    const li = html(`
      <li class="workout" tabindex="0">
        <span class="workout-idx">${String(i + 1).padStart(2, '0')}</span>
        <div>
          <div class="workout-name">${esc(w.name)}</div>
          <p class="workout-desc">${esc(w.description)}</p>
          <div class="workout-meta">
            <span class="label">${hoursMinutes(est.seconds)}</span>
            <span class="label">TSS ${Math.round(est.tss)}</span>
            <span class="label">${esc(est.focus)}</span>
          </div>
        </div>
        <canvas></canvas>
      </li>
    `);
    li.addEventListener('click', () => props.onRide(w));
    li.addEventListener('keydown', (e) => e.key === 'Enter' && props.onRide(w));
    list.append(li);
    canvases.push([$(li, 'canvas'), w]);
  });

  root.append(page);

  const draw = () => canvases.forEach(([c, w]) => drawProfile(c, { segments: expand(w), ftp: settings.ftp }));
  draw();
  document.fonts?.ready.then(draw);
  window.addEventListener('resize', draw);

  $<HTMLInputElement>(page, '.ftp-input').addEventListener('change', (e) => {
    const ftp = Math.round(Number((e.target as HTMLInputElement).value));
    if (ftp >= 80 && ftp <= 600) props.onSettings({ ...settings, ftp });
  });
  page.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => props.onSettings({ ...settings, mode: b.dataset.mode as ControlMode })),
  );
  page.querySelector('[data-role=connect]')?.addEventListener('click', () => props.onConnect());
  page.querySelector('[data-role=disconnect]')?.addEventListener('click', () => props.onDisconnect());
  page.querySelector('[data-role=connect-hr]')?.addEventListener('click', () => props.onConnectHr());
  page.querySelector('[data-role=disconnect-hr]')?.addEventListener('click', () => props.onDisconnectHr());

  return () => window.removeEventListener('resize', draw);
}
