// Setup: everything you set once (FTP, LTHR, weekly goal, defaults, devices, account), in a side
// sheet so home stays about riding. Home shows only a compact status bar.

import { KG_PER_LB, Units } from '../core/format';
import { LthrSource, lthrFromMaxHr, maxHrFromAge } from '../core/hr';
import type { ControlMode } from '../devices/trainer';
import { asset } from './asset';
import { $, esc } from './dom';
import type { DeviceSlot, HomeProps } from './home';
import { Settings, unitsOf } from './storage';

function lthrNote(source?: LthrSource, maxSeen?: number): string {
  const base = {
    entered: 'Sets your HR zones',
    max: 'From max HR · rides will refine it',
    age: 'Estimated from age · rides will refine it',
    learned: 'Learned from your rides',
  }[source ?? 'entered'];
  return maxSeen ? `${base} · max seen ${maxSeen}` : base;
}

type DeviceState = 'on' | 'reconnecting' | 'searching' | 'off';

/** Label and state for a device, shared by the sheet and the home status chips. */
export function deviceView(slot: DeviceSlot, kind: 'trainer' | 'hr', hasBt: boolean): { state: DeviceState; text: string } {
  const noun = kind === 'hr' ? 'HR' : 'trainer';
  if (slot.connected) {
    const c = slot.connected;
    if (c.reconnecting) return { state: 'reconnecting', text: `${c.name} · reconnecting…` };
    return { state: 'on', text: c.detail ? `${c.name} · ${c.detail}` : c.name };
  }
  if (!hasBt) return { state: 'off', text: kind === 'hr' ? 'No HR (needs Chrome/Edge)' : 'Simulated rider' };
  if (slot.searching) return { state: 'searching', text: `Looking for ${slot.remembered ?? noun}…` };
  return { state: 'off', text: slot.remembered ? `Reconnect ${slot.remembered}` : `Connect ${noun}` };
}

function deviceRow(label: string, kind: 'trainer' | 'hr', slot: DeviceSlot, hasBt: boolean): string {
  const v = deviceView(slot, kind, hasBt);
  const suffix = kind === 'hr' ? '-hr' : '';
  const action = slot.connected
    ? `<button class="btn" data-role="disconnect${suffix}">Disconnect</button>`
    : `<button class="btn" data-role="connect${suffix}" ${hasBt ? '' : 'disabled'}>${esc(v.text)}</button>`;
  return `
    <div class="sheet-row">
      <span class="label">${label}</span>
      <div class="sheet-control">
        ${slot.connected ? `<span class="chip-dot ${v.state}"></span><span>${esc(v.text)}</span>` : ''}
        ${action}
      </div>
    </div>`;
}

function seg<T extends string>(role: string, options: [T, string][], current: T): string {
  return `<div class="seg">${options
    .map(([v, label]) => `<button data-${role}="${v}" aria-pressed="${v === current}">${label}</button>`)
    .join('')}</div>`;
}

export function setupSheet(p: HomeProps, hasBt: boolean): string {
  const s = p.settings;
  return `
    <dialog class="sheet" data-role="setup" aria-label="Setup">
      <header class="sheet-head">
        <span class="wordmark">Setup</span>
        <button class="link" data-role="close-setup" aria-label="Close setup">Close</button>
      </header>

      <section class="sheet-group">
        <h3 class="label">Riding</h3>
        <label class="sheet-row">
          <span class="label">FTP</span>
          <span class="sheet-control"><input class="sheet-input num" name="ftp" data-role="ftp" type="number" min="80" max="600" value="${s.ftp}" /> W</span>
        </label>
        <div class="sheet-row">
          <span class="label">LTHR</span>
          <div class="sheet-control stack">
            <span><input class="sheet-input num" name="lthr" data-role="lthr" type="number" min="100" max="220" value="${s.hr.lthr ?? ''}" placeholder="—" /> bpm</span>
            <span class="hint">${esc(lthrNote(s.hr.source, s.hr.maxSeen))} · <button class="link" data-role="estimate-toggle">Don't know it?</button></span>
            <div class="estimate" hidden>
              <label><span class="label">Max HR</span><input class="sheet-input num" name="maxhr" data-role="maxhr" type="number" min="120" max="230" /></label>
              <span class="hint">or</span>
              <label><span class="label">Age</span><input class="sheet-input num" name="age" data-role="age" type="number" min="10" max="100" /></label>
              <button class="btn" data-role="estimate">Estimate</button>
            </div>
          </div>
        </div>
        <label class="sheet-row">
          <span class="label">Weight</span>
          <span class="sheet-control">
            <input class="sheet-input num" name="weight" data-role="weight" type="number" min="30" max="400" placeholder="—"
              value="${s.weightKg ? Math.round(unitsOf(s) === 'imperial' ? s.weightKg / KG_PER_LB : s.weightKg) : ''}" />
            ${unitsOf(s) === 'imperial' ? 'lb' : 'kg'}
            <span class="hint">for speed on the course${s.weightKg ? '' : ` · blank uses your Strava weight, or ${unitsOf(s) === 'imperial' ? '165 lb' : '75 kg'}`}</span>
          </span>
        </label>
        <div class="sheet-row">
          <span class="label">Units</span>
          <div class="sheet-control">${seg<Units>('units', [['imperial', 'mi · lb'], ['metric', 'km · kg']], unitsOf(s))}</div>
        </div>
        <div class="sheet-row">
          <span class="label">Weekly goal</span>
          <div class="sheet-control">
            <button class="btn step" data-goal="-1" aria-label="Fewer rides">−</button>
            <span class="num goal-value">${s.weeklyGoal}</span>
            <button class="btn step" data-goal="1" aria-label="More rides">+</button>
            <span class="hint">rides a week keeps the streak</span>
          </div>
        </div>
        <div class="sheet-row">
          <span class="label">Default mode</span>
          <div class="sheet-control">${seg<ControlMode>('mode', [['erg', 'ERG'], ['target', 'Target']], s.mode)}</div>
        </div>
        <div class="sheet-row">
          <span class="label">Rider</span>
          <div class="sheet-control">${seg<Settings['avatar']>('avatar', [['m', 'Male'], ['f', 'Female'], ['off', 'Off']], s.avatar)}</div>
        </div>
      </section>

      <section class="sheet-group">
        <h3 class="label">Devices</h3>
        ${deviceRow('Trainer', 'trainer', p.trainer, hasBt)}
        ${deviceRow('Heart rate', 'hr', p.heartRate, hasBt)}
      </section>

      <section class="sheet-group">
        <h3 class="label">Account</h3>
        <div class="sheet-row">
          <span class="label">Strava</span>
          <div class="sheet-control">
            ${
              p.account
                ? `<span>${esc(p.account.name)}</span>
                   <img class="powered-by" src="${asset('strava/powered-by-strava.svg')}" alt="Powered by Strava" />
                   <button class="link" data-role="signout">Sign out</button>`
                : `<button class="strava-connect" data-role="strava-connect"><img src="${asset('strava/connect-with-strava.svg')}" alt="Connect with Strava" /></button>`
            }
          </div>
        </div>
      </section>
    </dialog>`;
}

/** Wires the sheet. Returns a cleanup to run before the page is torn down (re-render). */
export function bindSetup(page: HTMLElement, p: HomeProps): () => void {
  const s = p.settings;
  const dialog = $<HTMLDialogElement>(page, '[data-role=setup]');
  $(dialog, '[data-role=close-setup]').addEventListener('click', () => p.onSetup(false));
  // Detached on teardown, so replacing the page during a re-render doesn't count as closing.
  const onClose = () => p.onSetup(false);
  dialog.addEventListener('close', onClose);
  // Click on the backdrop (outside the sheet) closes it.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  $<HTMLInputElement>(dialog, '[data-role=ftp]').addEventListener('change', (e) => {
    const ftp = Math.round(Number((e.target as HTMLInputElement).value));
    if (ftp >= 80 && ftp <= 600) p.onSettings({ ...s, ftp });
  });
  const setHr = (lthr: number, source: LthrSource) => {
    if (lthr >= 100 && lthr <= 220) p.onSettings({ ...s, hr: { ...s.hr, lthr, source } });
  };
  $<HTMLInputElement>(dialog, '[data-role=lthr]').addEventListener('change', (e) =>
    setHr(Math.round(Number((e.target as HTMLInputElement).value)), 'entered'),
  );
  $(dialog, '[data-role=estimate-toggle]').addEventListener('click', () => {
    const box = $(dialog, '.estimate');
    box.hidden = !box.hidden;
  });
  $(dialog, '[data-role=estimate]').addEventListener('click', () => {
    const maxHr = Number($<HTMLInputElement>(dialog, '[data-role=maxhr]').value);
    const age = Number($<HTMLInputElement>(dialog, '[data-role=age]').value);
    if (maxHr) setHr(lthrFromMaxHr(maxHr), 'max');
    else if (age) setHr(lthrFromMaxHr(maxHrFromAge(age)), 'age');
  });
  $<HTMLInputElement>(dialog, '[data-role=weight]').addEventListener('change', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    const kg = Math.round((unitsOf(s) === 'imperial' ? v * KG_PER_LB : v) * 10) / 10;
    if (kg >= 30 && kg <= 180) p.onSettings({ ...s, weightKg: kg });
  });
  dialog.querySelectorAll<HTMLButtonElement>('[data-units]').forEach((b) =>
    b.addEventListener('click', () => p.onSettings({ ...s, units: b.dataset.units as Units })),
  );
  dialog.querySelectorAll<HTMLButtonElement>('[data-goal]').forEach((b) =>
    b.addEventListener('click', () => p.onWeeklyGoal(s.weeklyGoal + Number(b.dataset.goal))),
  );
  dialog.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => p.onSettings({ ...s, mode: b.dataset.mode as ControlMode })),
  );
  dialog.querySelectorAll<HTMLButtonElement>('[data-avatar]').forEach((b) =>
    b.addEventListener('click', () => p.onSettings({ ...s, avatar: b.dataset.avatar as Settings['avatar'] })),
  );
  dialog.querySelector('[data-role=connect]')?.addEventListener('click', () => p.onConnect());
  dialog.querySelector('[data-role=disconnect]')?.addEventListener('click', () => p.onDisconnect());
  dialog.querySelector('[data-role=connect-hr]')?.addEventListener('click', () => p.onConnectHr());
  dialog.querySelector('[data-role=disconnect-hr]')?.addEventListener('click', () => p.onDisconnectHr());
  dialog.querySelector('[data-role=signout]')?.addEventListener('click', () => p.onSignOut());
  dialog.querySelector('[data-role=strava-connect]')?.addEventListener('click', () => p.onStravaConnect());

  if (p.setupOpen && !dialog.open) dialog.showModal();
  return () => dialog.removeEventListener('close', onClose);
}
