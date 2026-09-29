import './ui/styles.css';
import { Account, completeStravaSignIn, loadAccount, saveRemoteSettings, signOut, startStravaSignIn } from './api/account';
import { syncHistory } from './api/history';
import { flushQueue, pendingRide, sendRide } from './api/uploads';
import { deleteWorkout, localWorkouts, saveWorkout, syncWorkouts } from './api/workouts';
import { FormatError, importWorkoutFile, newWorkoutId, toZwo } from './core/formats';
import { openBuilder } from './ui/builder';
import { toHistoryRide } from './core/history';
import { earnedBy } from './core/achievements';
import { HistoryRide, progression } from './core/progression';
import { computeFacts, FactsRecorder } from './core/facts';
import { sustainedMaxHr } from './core/hr';
import type { Session } from './core/session';
import type { Workout } from './core/workout';
import { bluetoothAvailable, BluetoothTrainer, openTrainer, pickTrainer } from './devices/bluetooth-trainer';
import { openWhenInRange, rememberedDevice } from './devices/gatt-link';
import { HeartRateMonitor, openHeartRate, pickHeartRate } from './devices/heart-rate';
import { SimulatedTrainer } from './devices/simulated';
import type { Trainer } from './devices/trainer';
import { DeviceSlot, renderHome } from './ui/home';
import { renderRide } from './ui/ride';
import { appendHistory, loadHistory, loadSettings, saveSettings, Settings, unitsOf } from './ui/storage';
import { CATALOG, DEFAULT_COURSE_ID, loadBuiltinCourse, metaOf } from './courses';
import { deleteCourse, localCourses, saveCourse, syncCourses } from './api/courses';
import { importGpx } from './core/gpx';
import { FreeRideGoal, freeRideWorkout } from './core/free-ride';
import type { Course } from './core/course';
import { SURPRISE } from './ui/course-picker';
import { renderSummary } from './ui/summary';

type Kind = 'trainer' | 'hr';

const app = document.getElementById('app')!;
let settings = loadSettings();
let realTrainer: BluetoothTrainer | undefined;
let heartRate: HeartRateMonitor | undefined;
const searching: Record<Kind, boolean> = { trainer: false, hr: false };
let screen: 'home' | 'ride' | 'summary' = 'home';
let account: Account | undefined;
/** One-off message about sign-in (e.g. Strava declined). */
let accountNote: string | undefined;
let ftpOfferDismissed = false;
let setupOpen = false;
/** The rider's own workouts: local, merged with the account's when signed in. */
let custom: Workout[] = localWorkouts();
let libraryNote: string | undefined;
/** Whether the ride that just finished used the simulated rider. */
let lastRideSimulated = true;
/** Local rides until signed in; then local merged with the account's synced rides. */
let history: HistoryRide[] = loadHistory().map(toHistoryRide);

// ——— Courses ———

let customCourses: Course[] = localCourses();
let courseNote: string | undefined;
let coursesOpen = false;

const courseMetas = () => [...CATALOG, ...customCourses.map(metaOf)];

async function refreshCourses() {
  if (!account) return;
  try {
    customCourses = await syncCourses();
    refreshHome();
  } catch (err) {
    console.warn('Course sync failed', err);
  }
}

/** The course to ride: the chosen one, a random one for "Surprise me", or the default. */
async function resolveCourse(id = settings.courseId ?? DEFAULT_COURSE_ID): Promise<Course | undefined> {
  if (id === SURPRISE) {
    const all = courseMetas();
    id = all[Math.floor(Math.random() * all.length)].id;
  }
  return customCourses.find((c) => c.id === id) ?? (await loadBuiltinCourse(id)) ?? loadBuiltinCourse(DEFAULT_COURSE_ID);
}

function pickCourse(id: string) {
  coursesOpen = false;
  settings = { ...settings, courseId: id };
  saveSettings(settings);
  pushSettings();
  home();
}

async function importCourses(files: File[]) {
  const notes: string[] = [];
  let last: Course | undefined;
  for (const f of files) {
    try {
      const { course, warnings } = importGpx(f.name, await f.text());
      customCourses = [course, ...customCourses];
      void saveCourse(course, !!account);
      last = course;
      notes.push(`Added ${course.name}${warnings.length ? `: ${warnings.join(' ')}` : ''}`);
    } catch (err) {
      notes.push(`${f.name}: ${err instanceof FormatError ? err.message : 'Could not read the file'}`);
    }
  }
  courseNote = notes.join(' · ');
  coursesOpen = true;
  if (last) settings = { ...settings, courseId: last.id };
  saveSettings(settings);
  pushSettings();
  home();
}

async function refreshWorkouts() {
  if (!account) return;
  try {
    custom = await syncWorkouts();
    refreshHome();
  } catch (err) {
    console.warn('Workout sync failed', err);
  }
}

// ——— Workout library ———

function saveCustom(w: Workout) {
  custom = [w, ...custom.filter((x) => x.id !== w.id)];
  libraryNote = undefined;
  void saveWorkout(w, !!account);
  home();
}

function build(initial?: Workout, existing = false, warnings?: string[]) {
  openBuilder({ initial, existing, warnings, ftp: settings.ftp, onSave: saveCustom });
}

async function importFiles(all: File[]) {
  const isGpx = (f: File) => /\.gpx$/i.test(f.name);
  if (all.some(isGpx)) void importCourses(all.filter(isGpx));
  const files = all.filter((f) => !isGpx(f));
  if (!files.length) return;
  const results = await Promise.all(
    files.map(async (f) => {
      try {
        return { file: f.name, ...importWorkoutFile(f.name, await f.text(), settings.ftp) };
      } catch (err) {
        return { file: f.name, error: err instanceof FormatError ? err.message : 'Could not read the file' };
      }
    }),
  );
  const ok = results.filter((r) => 'workout' in r);
  const failed = results.filter((r) => 'error' in r);
  libraryNote = failed.map((r) => `${r.file}: ${'error' in r ? r.error : ''}`).join(' · ') || undefined;
  if (files.length === 1 && ok.length === 1) {
    // One file: review it in the builder before saving.
    const r = ok[0] as { workout: Workout; warnings: string[] };
    home();
    build(r.workout, false, r.warnings);
    return;
  }
  for (const r of ok) saveCustom((r as { workout: Workout }).workout);
  if (ok.length) libraryNote = [`Imported ${ok.length} workout${ok.length > 1 ? 's' : ''}`, libraryNote].filter(Boolean).join(' · ');
  home();
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function refreshHistory() {
  if (!account) return;
  try {
    history = await syncHistory(loadHistory());
    refreshHome();
  } catch (err) {
    console.warn('History sync failed', err);
  }
}
let teardown: (() => void) | undefined;

function show(name: typeof screen, render: (root: HTMLElement) => () => void) {
  teardown?.();
  app.replaceChildren();
  screen = name;
  teardown = render(app);
}

/** Device state changed in the background: redraw home if that's what's showing. */
const refreshHome = () => screen === 'home' && home();

function remember(kind: Kind, device: { id: string; name: string }) {
  settings = { ...settings, devices: { ...settings.devices, [kind]: { id: device.id, name: device.name } } };
  saveSettings(settings);
}

function adoptTrainer(t: BluetoothTrainer) {
  if (realTrainer && realTrainer !== t) void realTrainer.disconnect();
  realTrainer = t;
  t.link.onStatus = refreshHome;
  remember('trainer', t);
}

function adoptHeartRate(m: HeartRateMonitor) {
  if (heartRate && heartRate !== m) void heartRate.disconnect();
  heartRate = m;
  m.link.onStatus = refreshHome;
  remember('hr', m);
}

function slot(kind: Kind): DeviceSlot {
  const saved = settings.devices[kind]?.name;
  if (kind === 'trainer' && realTrainer) {
    const t = realTrainer;
    const detail = `${t.protocol}${t.controllable ? '' : ' (Target mode only)'}`;
    return { connected: { name: t.name, detail, reconnecting: t.connection === 'reconnecting' }, searching: false };
  }
  if (kind === 'hr' && heartRate) {
    return { connected: { name: heartRate.name, reconnecting: heartRate.connection === 'reconnecting' }, searching: false };
  }
  return { remembered: saved, searching: searching[kind] };
}

/**
 * Reconnect last session's devices without a prompt. Needs the browser to expose previously
 * permitted devices (getDevices(), behind Chrome flags today); silently does nothing otherwise.
 */
async function autoConnect() {
  if (!bluetoothAvailable()) return;
  const open = { trainer: openTrainer, hr: openHeartRate } as const;
  await Promise.all(
    (['trainer', 'hr'] as const).map(async (kind) => {
      const saved = settings.devices[kind];
      const device = saved && (await rememberedDevice(saved.id).catch(() => undefined));
      if (!device) return;
      searching[kind] = true;
      refreshHome();
      try {
        const d = await openWhenInRange<BluetoothTrainer | HeartRateMonitor>(device, open[kind]);
        if (d instanceof HeartRateMonitor) adoptHeartRate(d);
        else adoptTrainer(d);
      } catch (err) {
        console.warn(`Auto-connect to ${saved.name} failed`, err);
      } finally {
        searching[kind] = false;
        refreshHome();
      }
    }),
  );
}

// ——— Account ———

/** Settings that follow you between devices. Paired devices stay per-browser. */
const syncable = (s: Settings) => ({ ftp: s.ftp, mode: s.mode, avatar: s.avatar, hr: s.hr, weeklyGoal: s.weeklyGoal, weightKg: s.weightKg, units: s.units, courseId: s.courseId });

const progressionOf = (rides: HistoryRide[]) =>
  progression(rides, { weeklyGoal: settings.weeklyGoal, utcOffsetMin: -new Date().getTimezoneOffset(), now: Date.now() });

function pushSettings() {
  if (account) saveRemoteSettings(syncable(settings)).catch((err) => console.warn('Settings sync failed', err));
}

/** On sign-in, the account's saved settings win; a brand-new account adopts this browser's. */
function adoptAccount(a: Account) {
  account = a;
  const remote = a.settings as Partial<Settings> | undefined;
  if (remote && typeof remote === 'object') {
    settings = { ...settings, ...remote, hr: { ...settings.hr, ...remote.hr } };
    saveSettings(settings);
  } else {
    pushSettings();
  }
}

async function boot() {
  home();
  const callback = await completeStravaSignIn();
  if (callback?.account) adoptAccount(callback.account);
  else if (callback?.error) accountNote = callback.error;
  else {
    const a = await loadAccount();
    if (a) adoptAccount(a);
  }
  refreshHome();
  if (account?.canUpload) void flushQueue();
  void refreshHistory();
  void refreshWorkouts();
  void refreshCourses();
  void autoConnect();
}

function home() {
  const stravaFtp = account?.athlete.ftp;
  show('home', (root) =>
    renderHome(root, {
      settings,
      history,
      progression: progressionOf(history),
      onWeeklyGoal(goal) {
        settings = { ...settings, weeklyGoal: Math.max(1, Math.min(7, goal)) };
        saveSettings(settings);
        pushSettings();
        home();
      },
      trainer: slot('trainer'),
      heartRate: slot('hr'),
      account: account && {
        name: `${account.athlete.firstname} ${account.athlete.lastname.slice(0, 1)}.`.trim(),
        canUpload: account.canUpload,
      },
      accountNote,
      ftpOffer: stravaFtp && stravaFtp !== settings.ftp && !ftpOfferDismissed ? stravaFtp : undefined,
      onStravaConnect: startStravaSignIn,
      async onSignOut() {
        await signOut().catch(() => undefined);
        account = undefined;
        history = loadHistory().map(toHistoryRide);
        home();
      },
      onUseStravaFtp(ftp) {
        settings = { ...settings, ftp };
        saveSettings(settings);
        pushSettings();
        home();
      },
      onDismissFtp() {
        ftpOfferDismissed = true;
        home();
      },
      onSettings(next: Settings) {
        settings = next;
        saveSettings(settings);
        pushSettings();
        home();
      },
      async onConnect() {
        try {
          adoptTrainer(await pickTrainer());
        } catch (err) {
          // User cancelled the chooser, or the connection failed.
          console.warn('Trainer connection failed', err);
        }
        home();
      },
      async onDisconnect() {
        await realTrainer?.disconnect();
        realTrainer = undefined;
        home();
      },
      async onConnectHr() {
        try {
          adoptHeartRate(await pickHeartRate());
        } catch (err) {
          console.warn('Heart rate connection failed', err);
        }
        home();
      },
      async onDisconnectHr() {
        await heartRate?.disconnect();
        heartRate = undefined;
        home();
      },
      onRide: ride,
      custom,
      libraryNote,
      onNewWorkout: () => build(),
      onImport: (files) => void importFiles(files),
      onEdit: (w) => build(w, true),
      onDuplicate: (w) => build({ ...structuredClone(w), id: newWorkoutId(w.name), name: `${w.name} (copy)` }),
      onDeleteWorkout(w) {
        if (!confirm(`Delete "${w.name}"?`)) return;
        custom = custom.filter((x) => x.id !== w.id);
        void deleteWorkout(w.id, !!account);
        home();
      },
      onExport: (w) => download(`${w.name.replace(/[^\w.-]+/g, '-')}.zwo`, toZwo(w), 'application/xml'),
      setupOpen,
      onSetup(open) {
        setupOpen = open;
      },
      onFreeRide(goal) {
        settings = { ...settings, freeRideGoal: goal };
        saveSettings(settings);
        void ride(freeRideWorkout(goal), goal);
      },
      course: {
        courses: courseMetas(),
        courseId: settings.courseId ?? DEFAULT_COURSE_ID,
        units: unitsOf(settings),
        note: courseNote,
        open: coursesOpen,
        onOpen(open) {
          coursesOpen = open;
          if (!open) courseNote = undefined;
        },
        onPick: pickCourse,
        onImport: (files) => void importCourses(files),
        onDelete(id) {
          const c = customCourses.find((x) => x.id === id);
          if (!c || !confirm(`Delete "${c.name}"?`)) return;
          customCourses = customCourses.filter((x) => x.id !== id);
          if (settings.courseId === id) settings = { ...settings, courseId: DEFAULT_COURSE_ID };
          saveSettings(settings);
          void deleteCourse(id, !!account);
          home();
        },
      },
    }),
  );
}

async function ride(workout: Workout, goal?: FreeRideGoal) {
  const course = await resolveCourse();
  const trainer: Trainer = realTrainer ?? new SimulatedTrainer(settings.ftp);
  lastRideSimulated = trainer.simulated;
  show('ride', (root) =>
    renderRide(root, {
      workout,
      ftp: settings.ftp,
      mode: settings.mode,
      trainer,
      heartRate,
      avatar: settings.avatar,
      lthr: settings.hr.lthr,
      course,
      courses: courseMetas(),
      loadCourse: resolveCourse,
      goal,
      // Strava's profile weight when the rider hasn't set one here.
      weightKg: settings.weightKg ?? account?.athlete.weightKg,
      units: unitsOf(settings),
      onModeChange(mode) {
        settings = { ...settings, mode };
        saveSettings(settings);
      },
      onFinish: summary,
      onQuit: home,
    }),
  );
}

function summary(session: Session, recorder: FactsRecorder) {
  const s = session.summary();
  s.facts = computeFacts({
    summary: s,
    samples: session.samples,
    recorder,
    completed: session.completed,
    simulated: lastRideSimulated,
    lthr: settings.hr.lthr,
    startHourLocal: new Date(s.startedAtMs ?? Date.now()).getHours(),
  });
  // One ID for this ride everywhere: local history, the upload, and the synced copy.
  const rideId = crypto.randomUUID();
  const before = progressionOf(history);
  if (s.seconds >= 60) {
    const { segments: _segments, ...rest } = s;
    const startedAt = new Date(s.startedAtMs ?? Date.now() - s.seconds * 1000).toISOString();
    const record = { id: rideId, startedAt, summary: rest };
    appendHistory(record);
    history = [...history, toHistoryRide(record)];
  }
  const maxHr = sustainedMaxHr(session.samples);
  // Only real HR counts toward max seen, not the simulator's.
  if (maxHr && (realTrainer || heartRate) && maxHr > (settings.hr.maxSeen ?? 0)) {
    settings = { ...settings, hr: { ...settings.hr, maxSeen: maxHr } };
    saveSettings(settings);
  }
  // Built once so a retry re-sends the identical ride (same ID), which the API treats as idempotent.
  const pending = account && s.seconds >= 60 ? pendingRide(rideId, s, session.samples) : undefined;
  const after = progressionOf(history);
  const reveal = {
    xp: after.rides.find((r) => r.id === rideId)?.xp,
    simulated: lastRideSimulated,
    before,
    after,
    newlyEarned: earnedBy(after.achievements, rideId),
  };
  show('summary', (root) =>
    renderSummary(root, {
      session,
      upload: pending && (() => sendRide(pending)),
      reveal,
      manualUpload: lastRideSimulated,
      lthr: settings.hr.lthr,
      simulated: lastRideSimulated,
      units: unitsOf(settings),
      onAcceptFtp(ftp) {
        settings = { ...settings, ftp };
        saveSettings(settings);
        pushSettings();
      },
      onAcceptLthr(lthr) {
        settings = { ...settings, hr: { ...settings.hr, lthr, source: 'learned' } };
        saveSettings(settings);
      },
      onDone: home,
    }),
  );
}

void boot();
