import type { Reading } from '../core/session';
import type { ControlMode, Trainer } from './trainer';

/**
 * A fake rider on a fake trainer. In ERG mode power converges on the commanded
 * watts; in target mode a simulated human chases the goal imperfectly — lagging
 * target changes and drifting — so the on/under/over feedback has something to show.
 * `bias` lets you nudge the rider with the keyboard.
 */
export class SimulatedTrainer implements Trainer {
  readonly name = 'Simulated rider';
  readonly simulated = true;
  readonly controllable = true;
  readonly protocol = 'Simulated';

  mode: ControlMode = 'erg';
  /** What the simulated human is aiming for (the on-screen target). */
  goal = 0;
  /** Manual offset in watts, e.g. from arrow keys. */
  bias = 0;

  private ergTarget = 0;
  private power = 0;
  private drift = 0;
  private cadence = 88;
  private heartRate = 62;
  private readonly ftp: number;

  constructor(ftp: number) {
    this.ftp = ftp;
  }

  async connect() {}
  async disconnect() {}

  async setTargetPower(watts: number) {
    this.mode = 'erg';
    this.ergTarget = watts;
  }

  async setGrade(_gradePct: number) {
    this.mode = 'target';
  }

  latest(): Reading {
    const noise = (Math.random() - 0.5) * 0.04 * this.power;
    return {
      power: Math.max(0, Math.round(this.power + noise)),
      cadence: Math.round(this.cadence),
      heartRate: Math.round(this.heartRate),
    };
  }

  tick(dt: number) {
    let aim: number;
    let tau: number;
    if (this.mode === 'erg') {
      // Trainer enforces power quickly; rider bias barely matters.
      aim = this.ergTarget + this.bias * 0.1;
      tau = 1.2;
    } else {
      // Human: slower response, wandering attention.
      this.drift += (Math.random() - 0.5) * 6 * Math.sqrt(dt) - this.drift * 0.02 * dt;
      aim = this.goal + this.bias + this.drift;
      tau = 3.5;
    }
    this.power += (aim - this.power) * (1 - Math.exp(-dt / tau));

    const cadenceAim = 86 + Math.min(10, this.power / 40) + (Math.random() - 0.5) * 3;
    this.cadence += (cadenceAim - this.cadence) * (1 - Math.exp(-dt / 2));

    const hrAim = 60 + (this.power / this.ftp) * 105;
    this.heartRate += (hrAim - this.heartRate) * (1 - Math.exp(-dt / 35));
  }
}
