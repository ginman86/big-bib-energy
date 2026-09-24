// Standard training-load metrics over a 1 Hz power series.

/** Normalized Power: 4th-power mean of the 30 s rolling average. */
export function normalizedPower(watts: number[]): number {
  if (watts.length === 0) return 0;
  const window = 30;
  if (watts.length < window) return mean(watts);
  let sum = 0;
  for (let i = 0; i < window; i++) sum += watts[i];
  let acc = 0;
  let n = 0;
  for (let i = window - 1; i < watts.length; i++) {
    if (i >= window) sum += watts[i] - watts[i - window];
    acc += (sum / window) ** 4;
    n++;
  }
  return (acc / n) ** 0.25;
}

export const intensityFactor = (np: number, ftp: number) => (ftp > 0 ? np / ftp : 0);

/** Training Stress Score. 100 = one hour at FTP. */
export function trainingStress(seconds: number, np: number, ftp: number): number {
  if (ftp <= 0) return 0;
  const ifac = np / ftp;
  return ((seconds * np * ifac) / (ftp * 3600)) * 100;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
