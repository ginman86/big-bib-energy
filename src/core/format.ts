export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function hoursMinutes(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export type Units = 'metric' | 'imperial';

/** Miles and pounds where that's what people use. */
export const defaultUnits = (locale: string): Units => (/^en-(US|LR)|^my\b/i.test(locale) ? 'imperial' : 'metric');

const M_PER_MI = 1609.344;
export const KG_PER_LB = 0.45359237;

export const distanceText = (m: number, u: Units) =>
  u === 'imperial' ? `${(m / M_PER_MI).toFixed(1)} mi` : `${(m / 1000).toFixed(1)} km`;

/** Just the number, for big readouts with the unit set apart. */
export const speedValue = (ms: number, u: Units) => (u === 'imperial' ? (ms * 3600) / M_PER_MI : ms * 3.6);
export const speedUnit = (u: Units) => (u === 'imperial' ? 'mph' : 'km/h');
export const speedText = (ms: number, u: Units) => `${speedValue(ms, u).toFixed(1)} ${speedUnit(u)}`;

export const climbText = (m: number, u: Units) => (u === 'imperial' ? `${Math.round(m * 3.28084)} ft` : `${Math.round(m)} m`);
