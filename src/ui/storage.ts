// Browser persistence. Everything is best-effort: private windows and blocked
// storage must not break the app.

import type { RideRecord } from '../core/history';
import { defaultUnits, Units } from '../core/format';
import type { FreeRideGoal } from '../core/free-ride';
import type { HrProfile } from '../core/hr';
import type { ControlMode } from '../devices/trainer';
import type { Rider } from './avatar';

export interface Settings {
  ftp: number;
  mode: ControlMode;
  avatar: Rider | 'off';
  hr: HrProfile;
  /** Rides per week that keep the streak alive. */
  weeklyGoal: number;
  /** Rider weight for virtual speed on the course (bike weight is added). */
  weightKg?: number;
  /** Last free-ride goal, so the next one starts the same way. */
  freeRideGoal?: FreeRideGoal;
  /** Course for rides: a built-in or imported course ID, or 'random'. */
  courseId?: string;
  /** Distance, speed and weight units; defaults from the browser's locale. */
  units?: Units;
  /** Last-used devices, for auto-connect and the "Reconnect …" button. */
  devices: { trainer?: RememberedDevice; hr?: RememberedDevice };
}

export interface RememberedDevice {
  id: string;
  name: string;
}

const SETTINGS_KEY = 'zp.settings';
const HISTORY_KEY = 'zp.history';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore: storage unavailable.
  }
}

export const loadSettings = (): Settings => read<Settings>(SETTINGS_KEY, { ftp: 250, mode: 'erg', avatar: 'm', hr: {}, weeklyGoal: 3, devices: {} });
export const unitsOf = (s: Settings): Units => s.units ?? defaultUnits(navigator.language);

export const saveSettings = (s: Settings) => write(SETTINGS_KEY, s);

export function loadHistory(): RideRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as RideRecord[]) : [];
  } catch {
    return [];
  }
}

export function appendHistory(record: RideRecord) {
  write(HISTORY_KEY, [...loadHistory(), record]);
}
