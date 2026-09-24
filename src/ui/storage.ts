// Browser persistence. Everything is best-effort: private windows and blocked
// storage must not break the app.

import type { RideRecord } from '../core/history';
import type { ControlMode } from '../devices/trainer';
import type { Rider } from './avatar';

export interface Settings {
  ftp: number;
  mode: ControlMode;
  avatar: Rider | 'off';
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

export const loadSettings = (): Settings => read<Settings>(SETTINGS_KEY, { ftp: 250, mode: 'erg', avatar: 'm' });
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
