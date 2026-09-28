import { hoursMinutes, pct } from '../core/format';
import { since, startOfMonth, totals } from '../core/history';
import { LthrSource, lthrFromMaxHr, maxHrFromAge } from '../core/hr';
import { normalizedPower, trainingStress } from '../core/metrics';
import { expand, peakFraction, targetAt, totalDuration, Workout } from '../core/workout';
import { zoneFor } from '../core/zones';
import { bluetoothAvailable } from '../devices/bluetooth-trainer';
import type { ControlMode } from '../devices/trainer';
import { LIBRARY } from '../workouts/library';
import { asset } from './asset';
import { $, esc, html } from './dom';
import { drawProfile } from './profile';
import { loadHistory, Settings } from './storage';

/** What the home screen knows about one device (trainer or HR strap). */
export interface DeviceSlot {
  connected?: { name: string; detail?: string; reconnecting: boolean };
  /** Name of the last-used device, when not connected. */
  remembered?: string;
  /** Auto-connecting to the remembered device right now. */
  searching: boolean;
}

export interface HomeProps {
  settings: Settings;
  trainer: DeviceSlot;
  heartRate: DeviceSlot;
  onSettings(s: Settings): void;
  onConnect(): Promise<void>;
  onDisconnect(): Promise<void>;
  onConnectHr(): Promise<void>;
  onDisconnectHr(): Promise<void>;
  onRide(w: Workout): void;
}

function deviceField(label: string, role: 'trainer' | 'hr', slot: DeviceSlot, idleHint: string, hasBt: boolean): string {
  const suffix = role === 'hr' ? '-hr' : '';
  const kind = role === 'hr' ? 'HR' : 'trainer';
  let control: string;
  let status: string;
  if (slot.connected) {
    const c = slot.connected;
    control = `<button class="btn" data-role="disconnect${suffix}">Disconnect</button>`;
    status = c.reconnecting ? `◌ ${esc(c.name)} · reconnecting…` : `● ${esc(c.name)}${c.detail ? ` · ${esc(c.detail)}` : ''}`;
  } else {
    const verb = slot.remembered ? `Reconnect ${esc(slot.remembered)}` : `Connect ${kind}`;
    control = `<button class="btn" data-role="connect${suffix}" ${hasBt ? '' : 'disabled'}>${verb}</button>`;
    status = !hasBt ? 'Bluetooth needs Chrome or Edge' : slot.searching ? `Looking for ${esc(slot.remembered ?? kind)}…` : idleHint;
  }
  return `
    <div class="field">
      <span class="label">${label}</span>
      <div style="display:flex;gap:14px;align-items:center">${control}<span class="trainer-status">${status}</span></div>
    </div>`;
}

function estimate(w: Workout, ftp: number) {
  const segs = expand(w);
  const seconds = totalDuration(segs);
  const watts = Array.from({ length: seconds }, (_, t) => (targetAt(segs, t) ?? 0) * ftp);
  const np = normalizedPower(watts);
  return { seconds, tss: trainingStress(seconds, np, ftp), focus: zoneFor(peakFraction(segs)).name };
}

function lthrNote(source?: LthrSource, maxSeen?: number): string {
  const base = {
    entered: 'Sets your HR zones',
    max: 'From max HR · rides will refine it',
    age: 'Estimated from age · rides will refine it',
    learned: 'Learned from your rides',
  }[source ?? 'entered'];
  return maxSeen ? `${base} · max seen ${maxSeen}` : base;
}

export function renderHome(root: HTMLElement, props: HomeProps): () => void {
  const { settings } = props;
  const month = totals(since(loadHistory(), startOfMonth(new Date())));
  const hasBt = bluetoothAvailable();

  const page = html(`
    <main class="home">
      <header class="topbar">
        <span class="wordmark">Big Bib<i>/</i>Energy</span>
        <span class="label">Indoor training</span>
      </header>

      <section class="hero-head">
        <div class="headline">
          <h1>Hold<br/><em>the line.</em></h1>
          <img class="patch" src="${asset('brand/patch.jpg')}" alt="Big Bib Energy club patch" />
        </div>
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
          <span class="label">Rider</span>
          <div class="seg" data-role="avatar">
            ${(['m', 'f', 'off'] as const)
              .map((a) => `<button data-avatar="${a}" aria-pressed="${settings.avatar === a}">${{ m: 'Male', f: 'Female', off: 'Off' }[a]}</button>`)
              .join('')}
          </div>
        </div>
        ${deviceField('Trainer', 'trainer', props.trainer, 'Simulated rider until connected', hasBt)}
        ${deviceField('Heart rate', 'hr', props.heartRate, 'Strap or watch in broadcast mode', hasBt)}
        <div class="field">
          <span class="label">LTHR (bpm)</span>
          <div class="lthr-row">
            <input class="ftp-input num" data-role="lthr" type="number" min="100" max="220" step="1" value="${settings.hr.lthr ?? ''}" placeholder="—" />
            <div class="lthr-help">
              <span class="trainer-status">${esc(lthrNote(settings.hr.source, settings.hr.maxSeen))}</span>
              <button class="link" data-role="estimate-toggle">Don't know it?</button>
            </div>
          </div>
          <div class="estimate" hidden>
            <label><span class="label">Max HR</span><input class="mini-input num" data-role="maxhr" type="number" min="120" max="230" /></label>
            <span class="trainer-status">or</span>
            <label><span class="label">Age</span><input class="mini-input num" data-role="age" type="number" min="10" max="100" /></label>
            <button class="btn" data-role="estimate">Estimate</button>
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
  const setHr = (lthr: number, source: LthrSource) => {
    if (lthr >= 100 && lthr <= 220) props.onSettings({ ...settings, hr: { ...settings.hr, lthr, source } });
  };
  $<HTMLInputElement>(page, '[data-role=lthr]').addEventListener('change', (e) =>
    setHr(Math.round(Number((e.target as HTMLInputElement).value)), 'entered'),
  );
  $(page, '[data-role=estimate-toggle]').addEventListener('click', () => {
    const box = $(page, '.estimate');
    box.hidden = !box.hidden;
  });
  $(page, '[data-role=estimate]').addEventListener('click', () => {
    const maxHr = Number($<HTMLInputElement>(page, '[data-role=maxhr]').value);
    const age = Number($<HTMLInputElement>(page, '[data-role=age]').value);
    if (maxHr) setHr(lthrFromMaxHr(maxHr), 'max');
    else if (age) setHr(lthrFromMaxHr(maxHrFromAge(age)), 'age');
  });
  page.querySelectorAll<HTMLButtonElement>('[data-avatar]').forEach((b) =>
    b.addEventListener('click', () => props.onSettings({ ...settings, avatar: b.dataset.avatar as Settings['avatar'] })),
  );
  page.querySelector('[data-role=connect]')?.addEventListener('click', () => props.onConnect());
  page.querySelector('[data-role=disconnect]')?.addEventListener('click', () => props.onDisconnect());
  page.querySelector('[data-role=connect-hr]')?.addEventListener('click', () => props.onConnectHr());
  page.querySelector('[data-role=disconnect-hr]')?.addEventListener('click', () => props.onDisconnectHr());

  return () => window.removeEventListener('resize', draw);
}
