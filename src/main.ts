import './ui/styles.css';
import type { Session } from './core/session';
import type { Workout } from './core/workout';
import { FtmsTrainer } from './devices/ftms-trainer';
import { HeartRateMonitor } from './devices/heart-rate';
import { SimulatedTrainer } from './devices/simulated';
import type { Trainer } from './devices/trainer';
import { renderHome } from './ui/home';
import { renderRide } from './ui/ride';
import { appendHistory, loadSettings, saveSettings, Settings } from './ui/storage';
import { renderSummary } from './ui/summary';

const app = document.getElementById('app')!;
let settings = loadSettings();
let realTrainer: FtmsTrainer | undefined;
let heartRate: HeartRateMonitor | undefined;
let teardown: (() => void) | undefined;

function show(render: (root: HTMLElement) => () => void) {
  teardown?.();
  app.replaceChildren();
  teardown = render(app);
}

function home() {
  show((root) =>
    renderHome(root, {
      settings,
      trainer: realTrainer,
      onSettings(next: Settings) {
        settings = next;
        saveSettings(settings);
        home();
      },
      async onConnect() {
        const t = new FtmsTrainer();
        try {
          await t.connect();
          t.onDisconnect = () => {
            realTrainer = undefined;
          };
          realTrainer = t;
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
      heartRate,
      async onConnectHr() {
        const m = new HeartRateMonitor();
        try {
          await m.connect();
          m.onDisconnect = () => {
            heartRate = undefined;
          };
          heartRate = m;
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
  show((root) =>
    renderRide(root, {
      workout,
      ftp: settings.ftp,
      mode: settings.mode,
      trainer,
      heartRate,
      avatar: settings.avatar,
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
  show((root) => renderSummary(root, { session, onDone: home }));
}

home();
