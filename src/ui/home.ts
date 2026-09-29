import { hoursMinutes, Units } from '../core/format';
import type { FreeRideGoal } from '../core/free-ride';
import { monthTotals } from '../core/history';
import { normalizedPower, trainingStress } from '../core/metrics';
import type { HistoryRide, Progression } from '../core/progression';
import { expand, peakFraction, targetAt, totalDuration, Workout } from '../core/workout';
import { zoneFor } from '../core/zones';
import { bluetoothAvailable } from '../devices/bluetooth-trainer';
import { LIBRARY } from '../workouts/library';
import { asset } from './asset';
import { $, esc, html, setText } from './dom';
import { drawProfile } from './profile';
import { patchWall, powerBlock, statsLine } from './progress';
import { bindCoursePicker, courseChipLabel, coursePicker, CoursePickerProps } from './course-picker';
import { bindSetup, deviceView, setupSheet } from './setup';
import type { Settings } from './storage';

function accountArea(p: HomeProps): string {
  if (p.account) {
    return `
      <div class="account">
        <span class="account-name">${esc(p.account.name)}</span>
        <img class="powered-by" src="${asset('strava/powered-by-strava.svg')}" alt="Powered by Strava" />
      </div>`;
  }
  return `
    <div class="account">
      ${p.accountNote ? `<span class="hint">${esc(p.accountNote)}</span>` : ''}
      <button class="strava-connect" data-role="strava-connect">
        <img src="${asset('strava/connect-with-strava.svg')}" alt="Connect with Strava" />
      </button>
    </div>`;
}

function chip(kind: 'trainer' | 'hr', slot: DeviceSlot, hasBt: boolean): string {
  const v = deviceView(slot, kind, hasBt);
  return `<button class="chip" data-chip="${kind}" ${!hasBt && !slot.connected ? 'disabled' : ''}>
    <span class="chip-dot ${v.state}"></span>${esc(v.text)}</button>`;
}

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
  /** Merged local + synced rides, oldest first. */
  history: HistoryRide[];
  progression: Progression;
  onWeeklyGoal(goal: number): void;
  account?: { name: string; canUpload: boolean };
  accountNote?: string;
  /** Strava's FTP, when it differs from ours. */
  ftpOffer?: number;
  onStravaConnect(): void;
  onSignOut(): void;
  onUseStravaFtp(ftp: number): void;
  onDismissFtp(): void;
  trainer: DeviceSlot;
  heartRate: DeviceSlot;
  onSettings(s: Settings): void;
  onConnect(): Promise<void>;
  onDisconnect(): Promise<void>;
  onConnectHr(): Promise<void>;
  onDisconnectHr(): Promise<void>;
  onRide(w: Workout): void;
  /** The rider's own workouts (newest first). */
  custom: Workout[];
  /** One-off message about imports. */
  libraryNote?: string;
  onNewWorkout(): void;
  onImport(files: File[]): void;
  onEdit(w: Workout): void;
  onDuplicate(w: Workout): void;
  onDeleteWorkout(w: Workout): void;
  onExport(w: Workout): void;
  /** Whether the setup sheet is open (kept by main so it survives re-renders). */
  setupOpen: boolean;
  onSetup(open: boolean): void;
  /** Course picker (dialog opened from the status bar). */
  course: CoursePickerProps;
  onFreeRide(goal: FreeRideGoal): void;
}

const M_PER_MI = 1609.344;
type GoalKind = FreeRideGoal['kind'];
/** The number shown in the goal box, in the rider's units. */
function goalValue(g: FreeRideGoal, units: Units): number {
  if (g.kind === 'time') return Math.round(g.seconds / 60);
  if (g.kind === 'distance') return Math.round((g.meters / (units === 'imperial' ? M_PER_MI : 1000)) * 10) / 10;
  if (g.kind === 'laps') return g.laps;
  return 0;
}
const GOAL_DEFAULT: Record<GoalKind, (u: Units) => number> = { open: () => 0, time: () => 60, distance: (u) => (u === 'imperial' ? 12 : 20), laps: () => 3 };
const goalUnit = (k: GoalKind, u: Units) => (k === 'time' ? 'min' : k === 'distance' ? (u === 'imperial' ? 'mi' : 'km') : k === 'laps' ? 'laps' : '');
function toGoal(k: GoalKind, v: number, u: Units): FreeRideGoal {
  if (!(v > 0)) return { kind: 'open' };
  if (k === 'time') return { kind: 'time', seconds: Math.round(v * 60) };
  if (k === 'distance') return { kind: 'distance', meters: v * (u === 'imperial' ? M_PER_MI : 1000) };
  if (k === 'laps') return { kind: 'laps', laps: Math.max(1, Math.round(v)) };
  return { kind: 'open' };
}

function freeRidePanel(p: HomeProps, units: Units): string {
  const g = p.settings.freeRideGoal ?? { kind: 'open' };
  const kinds: [GoalKind, string][] = [['open', 'Open'], ['time', 'Time'], ['distance', 'Distance'], ['laps', 'Laps']];
  return `
    <section class="free-ride-panel">
      <div class="fr-text">
        <h2>Free ride</h2>
        <p class="hint">No workout. Ride ${esc(courseChipLabel(p.course))} and the trainer follows the road: climbs get hard, descents easy.</p>
      </div>
      <div class="fr-goal" data-kind="${g.kind}">
        <div class="seg">${kinds.map(([k, l]) => `<button data-goal-kind="${k}" aria-pressed="${k === g.kind}">${l}</button>`).join('')}</div>
        <span class="fr-value">
          <input class="sheet-input num" data-role="goal-value" type="number" min="1" step="any" value="${g.kind === 'open' ? '' : goalValue(g, units)}" aria-label="Goal" />
          <span class="label" data-role="goal-unit">${goalUnit(g.kind, units)}</span>
        </span>
      </div>
      <button class="btn primary" data-role="free-ride">Ride</button>
    </section>`;
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
  const month = monthTotals(props.history, new Date());
  const hasBt = bluetoothAvailable();

  const page = html(`
    <main class="home">
      <header class="topbar">
        <span class="wordmark">Big Bib<i>/</i>Energy</span>
        ${accountArea(props)}
      </header>

      <section class="hero-head">
        <div class="headline">
          <h1>Hold<br/><em>the line.</em></h1>
          <img class="patch" src="${asset('brand/patch.jpg')}" alt="Big Bib Energy club patch" />
        </div>
        ${powerBlock(props.progression)}
      </section>

      ${statsLine(props.progression, month, settings.weeklyGoal)}

      <section class="status-bar">
        ${chip('trainer', props.trainer, hasBt)}
        ${chip('hr', props.heartRate, hasBt)}
        <button class="chip" data-role="open-courses" title="Course"><span class="chip-icon" aria-hidden="true">⛰</span>${esc(courseChipLabel(props.course))}</button>
        <span class="status-summary">FTP ${settings.ftp} · LTHR ${settings.hr.lthr ?? '—'} · ${settings.mode === 'erg' ? 'ERG' : 'Target'}</span>
        <button class="btn" data-role="open-setup">Setup</button>
      </section>
      ${
        props.ftpOffer
          ? `<div class="offer">
              <span>Strava has your FTP at <b>${props.ftpOffer} W</b> (you're using ${settings.ftp} W).</span>
              <button class="btn primary" data-role="use-strava-ftp">Use ${props.ftpOffer} W</button>
              <button class="link" data-role="dismiss-ftp">Keep ${settings.ftp} W</button>
            </div>`
          : ''
      }

      ${freeRidePanel(props, props.course.units)}

      <section class="library-head">
        <span class="label">Workouts</span>
        ${props.libraryNote ? `<span class="hint">${esc(props.libraryNote)}</span>` : ''}
        <span class="library-actions">
          <button class="btn" data-role="new-workout">New</button>
          <button class="btn" data-role="import">Import</button>
          <input type="file" data-role="import-file" accept=".zwo,.mrc,.erg,.gpx" multiple hidden />
        </span>
      </section>
      ${props.custom.length ? `<span class="label library-section">Mine</span><ol class="workouts" data-list="mine"></ol>` : ''}
      ${props.custom.length ? `<span class="label library-section">Built-in</span>` : ''}
      <ol class="workouts" data-list="builtin"></ol>
      <div class="drop-hint" hidden><span>Drop workouts (.zwo, .mrc, .erg) or courses (.gpx) to import</span></div>

      ${setupSheet(props, hasBt)}
      ${coursePicker(props.course)}
      <dialog class="wall-dialog" data-role="wall" aria-label="Patches">
        <header class="sheet-head">
          <span class="wordmark">Patches</span>
          <button class="link" data-role="close-wall">Close</button>
        </header>
        <div class="patch-wall">${patchWall(props.progression)}</div>
      </dialog>
    </main>
  `);

  const canvases: [HTMLCanvasElement, Workout][] = [];
  const addRows = (list: HTMLElement, workouts: Workout[], mine: boolean) =>
    workouts.forEach((w, i) => {
      const est = estimate(w, settings.ftp);
      const actions = mine
        ? `<button class="link" data-act="edit">Edit</button><button class="link" data-act="dup">Duplicate</button>
           <button class="link" data-act="export">Export .zwo</button><button class="link" data-act="delete">Delete</button>`
        : w.test
          ? '' // a copy would be plain steps, without the test's stop-when-you-fail logic
          : `<button class="link" data-act="dup">Duplicate &amp; edit</button>`;
      // A ramp test's length and load depend on where you crack, so the full profile misleads.
      const meta = w.test
        ? `<span class="label">~20–25M</span><span class="label">FTP test</span>`
        : `<span class="label">${hoursMinutes(est.seconds)}</span>
              <span class="label">TSS ${Math.round(est.tss)}</span>
              <span class="label">${esc(est.focus)}</span>`;
      const li = html(`
        <li class="workout" tabindex="0">
          <span class="workout-idx">${String(i + 1).padStart(2, '0')}</span>
          <div>
            <div class="workout-name">${esc(w.name)}</div>
            ${w.description ? `<p class="workout-desc">${esc(w.description)}</p>` : ''}
            <div class="workout-meta">
              ${meta}
              <span class="workout-actions">${actions}</span>
            </div>
          </div>
          <canvas></canvas>
        </li>
      `);
      li.addEventListener('click', (e) => {
        const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
        if (act === 'edit') props.onEdit(w);
        else if (act === 'dup') props.onDuplicate(w);
        else if (act === 'export') props.onExport(w);
        else if (act === 'delete') props.onDeleteWorkout(w);
        else props.onRide(w);
      });
      li.addEventListener('keydown', (e) => e.key === 'Enter' && e.target === li && props.onRide(w));
      list.append(li);
      canvases.push([$(li, 'canvas'), w]);
    });
  const mineList = page.querySelector<HTMLElement>('[data-list=mine]');
  if (mineList) addRows(mineList, props.custom, true);
  addRows($(page, '[data-list=builtin]'), LIBRARY, false);

  // Import: button, or drop files anywhere on the page.
  const fileInput = $<HTMLInputElement>(page, '[data-role=import-file]');
  $(page, '[data-role=import]').addEventListener('click', () => fileInput.click());
  $(page, '[data-role=new-workout]').addEventListener('click', () => props.onNewWorkout());
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.length) props.onImport([...fileInput.files]);
    fileInput.value = '';
  });
  const dropHint = $(page, '.drop-hint');
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  page.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dropHint.hidden = false;
  });
  page.addEventListener('dragleave', (e) => {
    if (e.target === dropHint) dropHint.hidden = true;
  });
  page.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dropHint.hidden = true;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) props.onImport(files);
  });

  root.append(page);

  const draw = () => canvases.forEach(([c, w]) => drawProfile(c, { segments: expand(w), ftp: settings.ftp }));
  draw();
  document.fonts?.ready.then(draw);
  window.addEventListener('resize', draw);

  const openSetup = () => {
    props.onSetup(true);
    const d = $<HTMLDialogElement>(page, '[data-role=setup]');
    if (!d.open) d.showModal();
  };
  $(page, '[data-role=open-setup]').addEventListener('click', openSetup);
  // Chips: connect when disconnected, otherwise open setup to manage the device.
  page.querySelectorAll<HTMLButtonElement>('[data-chip]').forEach((b) =>
    b.addEventListener('click', () => {
      const trainer = b.dataset.chip === 'trainer';
      const slot = trainer ? props.trainer : props.heartRate;
      if (slot.connected) openSetup();
      else void (trainer ? props.onConnect() : props.onConnectHr());
    }),
  );

  const wall = $<HTMLDialogElement>(page, '[data-role=wall]');
  $(page, '[data-role=open-wall]').addEventListener('click', () => wall.showModal());
  $(wall, '[data-role=close-wall]').addEventListener('click', () => wall.close());
  wall.addEventListener('click', (e) => {
    if (e.target === wall) wall.close();
  });

  page.querySelector('[data-role=strava-connect]')?.addEventListener('click', () => props.onStravaConnect());
  page.querySelector('[data-role=use-strava-ftp]')?.addEventListener('click', () => props.onUseStravaFtp(props.ftpOffer!));
  page.querySelector('[data-role=dismiss-ftp]')?.addEventListener('click', () => props.onDismissFtp());
  const unbindSetup = bindSetup(page, props);
  const unbindCourses = bindCoursePicker(page, props.course);

  // Free ride goal: pick a kind, type a number, ride.
  const goalBox = $(page, '.fr-goal');
  const goalInput = $<HTMLInputElement>(page, '[data-role=goal-value]');
  let goalKind = (goalBox.dataset.kind ?? 'open') as GoalKind;
  page.querySelectorAll<HTMLButtonElement>('[data-goal-kind]').forEach((b) =>
    b.addEventListener('click', () => {
      goalKind = b.dataset.goalKind as GoalKind;
      goalBox.dataset.kind = goalKind;
      page.querySelectorAll('[data-goal-kind]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      goalInput.value = goalKind === 'open' ? '' : String(GOAL_DEFAULT[goalKind](props.course.units));
      setText($(page, '[data-role=goal-unit]'), goalUnit(goalKind, props.course.units));
      if (goalKind !== 'open') goalInput.focus();
    }),
  );
  $(page, '[data-role=free-ride]').addEventListener('click', () => props.onFreeRide(toGoal(goalKind, Number(goalInput.value), props.course.units)));
  $(page, '[data-role=open-courses]').addEventListener('click', () => {
    props.course.onOpen(true);
    const d = $<HTMLDialogElement>(page, '[data-role=courses]');
    if (!d.open) d.showModal();
  });

  return () => {
    unbindSetup();
    unbindCourses();
    window.removeEventListener('resize', draw);
  };
}
