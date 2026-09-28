import './ui/styles.css';
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
import { appendHistory, loadSettings, saveSettings, Settings } from './ui/storage';
import { renderSummary } from './ui/summary';

type Kind = 'trainer' | 'hr';

const app = document.getElementById('app')!;
let settings = loadSettings();
let realTrainer: BluetoothTrainer | undefined;
let heartRate: HeartRateMonitor | undefined;
const searching: Record<Kind, boolean> = { trainer: false, hr: false };
let screen: 'home' | 'ride' | 'summary' = 'home';
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

function home() {
  show('home', (root) =>
    renderHome(root, {
      settings,
      trainer: slot('trainer'),
      heartRate: slot('hr'),
      onSettings(next: Settings) {
        settings = next;
        saveSettings(settings);
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
    }),
  );
}

function ride(workout: Workout) {
  const trainer: Trainer = realTrainer ?? new SimulatedTrainer(settings.ftp);
  show('ride', (root) =>
    renderRide(root, {
      workout,
      ftp: settings.ftp,
      mode: settings.mode,
      trainer,
      heartRate,
      avatar: settings.avatar,
      lthr: settings.hr.lthr,
      onModeChange(mode) {
        settings = { ...settings, mode };
        saveSettings(settings);
      },
      onFinish: summary,
      onQuit: home,
    }),
  );
}

function summary(session: Session) {
  const s = session.summary();
  if (s.seconds >= 60) {
    const { segments: _segments, ...rest } = s;
    appendHistory({ id: crypto.randomUUID(), startedAt: new Date(Date.now() - s.seconds * 1000).toISOString(), summary: rest });
  }
  const maxHr = sustainedMaxHr(session.samples);
  // Only real HR counts toward max seen, not the simulator's.
  if (maxHr && (realTrainer || heartRate) && maxHr > (settings.hr.maxSeen ?? 0)) {
    settings = { ...settings, hr: { ...settings.hr, maxSeen: maxHr } };
    saveSettings(settings);
  }
  show('summary', (root) =>
    renderSummary(root, {
      session,
      lthr: settings.hr.lthr,
      onAcceptLthr(lthr) {
        settings = { ...settings, hr: { ...settings.hr, lthr, source: 'learned' } };
        saveSettings(settings);
      },
      onDone: home,
    }),
  );
}

home();
void autoConnect();
