// A virtual course and the physics that turns power into speed on it. Indoor rides get a distance
// the way Zwift's do: ride a real loop's gradients with your watts and your weight.

export interface Course {
  id: string;
  name: string;
  /** Where the loop is, for the ride screen ("Richmond, VA"). */
  place: string;
  lapMeters: number;
  /** One lap: [distance m, elevation m], ascending, starting at 0 and ending at lapMeters. */
  profile: [number, number][];
}

/** Position within a lap, 0 ≤ d < lapMeters. */
const wrap = (c: Course, d: number) => ((d % c.lapMeters) + c.lapMeters) % c.lapMeters;

export function elevationAt(c: Course, distance: number): number {
  const d = wrap(c, distance);
  const p = c.profile;
  let lo = 0;
  let hi = p.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p[mid][0] <= d) lo = mid;
    else hi = mid;
  }
  const [d0, e0] = p[lo];
  const [d1, e1] = p[hi];
  return d1 > d0 ? e0 + ((e1 - e0) * (d - d0)) / (d1 - d0) : e0;
}

/** Grade (rise/run, 0.05 = 5%) around a point, over ±`span` metres so it doesn't flicker. */
export const gradeAt = (c: Course, distance: number, span = 15) =>
  (elevationAt(c, distance + span) - elevationAt(c, distance - span)) / (2 * span);

/** Metres climbed over one lap. */
export function lapClimb(c: Course): number {
  let up = 0;
  for (let i = 1; i < c.profile.length; i++) up += Math.max(0, c.profile[i][1] - c.profile[i - 1][1]);
  return up;
}

// ——— Physics ———

export interface BikeModel {
  /** Rider + bike, kg. */
  massKg: number;
  /** Drag area, m² (~0.32 on the hoods, ~0.25 in the drops). */
  cda: number;
  /** Rolling resistance coefficient (~0.004 for good road tyres). */
  crr: number;
}

export const BIKE_KG = 8;
export const DEFAULT_RIDER_KG = 75;
export const bikeModel = (riderKg = DEFAULT_RIDER_KG): BikeModel => ({ massKg: riderKg + BIKE_KG, cda: 0.32, crr: 0.004 });

const G = 9.81;
const RHO = 1.225; // air density at sea level, 15 °C
const DRIVETRAIN = 0.97;
/** Rotating wheels behave like ~1 kg of extra mass under acceleration. */
const WHEEL_INERTIA_KG = 1;

/**
 * Integrates speed from power on the course, with momentum: surges take a moment to show,
 * you carry speed over a crest, and freewheeling downhill still moves you.
 */
export class VirtualBike {
  speed = 0; // m/s
  distance = 0; // m
  climbed = 0; // m
  maxSpeed = 0;

  constructor(
    readonly course: Course,
    readonly model: BikeModel,
  ) {}

  get grade() {
    return gradeAt(this.course, this.distance);
  }

  get elevation() {
    return elevationAt(this.course, this.distance);
  }

  get lap() {
    return Math.floor(this.distance / this.course.lapMeters) + 1;
  }

  step(powerW: number, dt: number) {
    const { massKg, cda, crr } = this.model;
    const m = massKg + WHEEL_INERTIA_KG;
    // Small steps: forces change quickly with speed at low speeds.
    for (let left = dt; left > 1e-9; ) {
      const h = Math.min(0.1, left);
      left -= h;
      const g = this.grade;
      const cos = 1 / Math.sqrt(1 + g * g);
      const sin = g * cos;
      // Force at the wheel; below walking pace, treat it as a standing start rather than infinite force.
      const drive = (powerW * DRIVETRAIN) / Math.max(this.speed, 1.5);
      const resist = massKg * G * (sin + crr * cos) + 0.5 * RHO * cda * this.speed * this.speed;
      let v = this.speed + ((drive - resist) / m) * h;
      // Rolling resistance can stop you, not push you backwards.
      if (v < 0) v = 0;
      const before = this.elevation;
      this.distance += ((this.speed + v) / 2) * h;
      this.speed = v;
      this.climbed += Math.max(0, this.elevation - before);
      this.maxSpeed = Math.max(this.maxSpeed, v);
    }
  }
}

/** Steady-state speed on a constant grade, for tests and sanity checks. */
export function steadySpeed(powerW: number, grade: number, model: BikeModel): number {
  const flat: Course = { id: 'x', name: 'x', place: '', lapMeters: 1e9, profile: [[0, 0], [1e9, grade * 1e9]] };
  const bike = new VirtualBike(flat, model);
  bike.distance = 1000; // away from the (open) lap's ends
  for (let i = 0; i < 600; i++) bike.step(powerW, 1);
  return bike.speed;
}
