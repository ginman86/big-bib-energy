// Coggan power zones, by fraction of FTP.

export interface Zone {
  id: number;
  name: string;
  /** Upper bound (exclusive) as a fraction of FTP. */
  max: number;
}

export const ZONES: Zone[] = [
  { id: 1, name: 'Recovery', max: 0.56 },
  { id: 2, name: 'Endurance', max: 0.76 },
  { id: 3, name: 'Tempo', max: 0.88 },
  { id: 4, name: 'Sweet spot', max: 0.95 },
  { id: 5, name: 'Threshold', max: 1.06 },
  { id: 6, name: 'VO2 max', max: 1.21 },
  { id: 7, name: 'Anaerobic', max: Infinity },
];

export function zoneFor(fraction: number): Zone {
  return ZONES.find((z) => fraction < z.max) ?? ZONES[ZONES.length - 1];
}
