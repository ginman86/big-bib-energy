// Real trainers over Web Bluetooth. One pairing flow, three protocols:
//   FTMS         — the open standard (Elite Suito, current Wahoo KICKR firmware, most modern trainers)
//   Wahoo        — Wahoo's proprietary control inside Cycling Power (older KICKR / KICKR Core firmware)
//   Power meter  — any Cycling Power device with no control: Target mode only
// Requires Chrome/Edge on desktop or Android, served from localhost or HTTPS.

import {
  CrankCadence,
  CYCLING_POWER_MEASUREMENT,
  CYCLING_POWER_SERVICE,
  parseCyclingPower,
  WAHOO_CONTROL,
  wahooErg,
  wahooGrade,
  wahooSimMode,
  wahooUnlock,
} from '../core/cps';
import {
  FTMS_CONTROL_POINT,
  FTMS_SERVICE,
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
  INDOOR_BIKE_DATA,
  parseControlResponse,
  parseHeartRate,
  parseIndoorBikeData,
  requestControl,
  setSimulation,
  setTargetPower,
  startResume,
} from '../core/ftms';
import { RateMeter } from '../core/latency';
import type { Reading } from '../core/session';
import { GattLink, LinkStatus } from './gatt-link';
import type { Trainer } from './trainer';

/** A trainer silent for this long isn't being pedalled (some stop notifying when idle). */
const STALE_MS = 3000;

export const bluetoothAvailable = () => typeof navigator !== 'undefined' && 'bluetooth' in navigator;

type Bytes = Uint8Array<ArrayBuffer>;
const valueOf = (e: Event) => (e.target as BluetoothRemoteGATTCharacteristic).value!;

async function subscribe(char: BluetoothRemoteGATTCharacteristic, onValue: (v: DataView) => void) {
  char.addEventListener('characteristicvaluechanged', (e) => onValue(valueOf(e)));
  await char.startNotifications();
}

type Control = { kind: 'erg'; watts: number } | { kind: 'grade'; pct: number };

export abstract class BluetoothTrainer implements Trainer {
  readonly simulated = false;
  abstract readonly protocol: string;
  abstract readonly controllable: boolean;
  readonly name: string;
  readonly link: GattLink;

  protected reading: Reading = { power: 0 };
  private readonly rate = new RateMeter();
  private control?: BluetoothRemoteGATTCharacteristic;
  /** Control writes must not overlap (KICKRs drop them); chain them. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Replayed after a reconnect: the trainer forgets its ERG target / grade when the link drops. */
  private lastControl?: Control;

  constructor(readonly device: BluetoothDevice) {
    this.name = device.name ?? 'Smart trainer';
    this.link = new GattLink(device, (server) => this.setup(server));
  }

  get id() {
    return this.device.id;
  }

  get connection(): LinkStatus {
    return this.link.status;
  }

  /** Subscribe to data and take control on a fresh GATT server. Runs on every (re)connect. */
  protected abstract init(server: BluetoothRemoteGATTServer): Promise<void>;
  protected abstract sendErg(watts: number): Promise<void>;
  protected abstract sendGrade(gradePct: number): Promise<void>;
  /** Forget per-connection command dedupe state. */
  protected abstract resetControlCache(): void;

  async connect() {
    await this.link.connect();
  }

  async disconnect() {
    this.link.close();
  }

  async setTargetPower(watts: number) {
    this.lastControl = { kind: 'erg', watts };
    await this.sendErg(watts);
  }

  async setGrade(gradePct: number, sim?: { massKg?: number }) {
    if (sim?.massKg) this.massKg = sim.massKg;
    this.lastControl = { kind: 'grade', pct: gradePct };
    await this.sendGrade(gradePct);
  }

  /** Rider + bike, for trainers whose simulation takes a weight. */
  protected massKg = 83;

  latest(): Reading {
    // Don't freeze on the last number if the trainer has gone quiet.
    const age = this.rate.ageMs(performance.now());
    if (age !== undefined && age > STALE_MS) return { ...this.reading, power: 0, cadence: 0 };
    return this.reading;
  }

  stats(nowMs: number) {
    return { hz: this.rate.hz(nowMs), ageMs: this.rate.ageMs(nowMs) };
  }

  /** Call on every power/cadence data notification. */
  protected noteSample() {
    this.rate.mark(performance.now());
  }

  protected setControl(char: BluetoothRemoteGATTCharacteristic) {
    this.control = char;
  }

  protected write(bytes: Bytes) {
    const control = this.control;
    if (!control) return Promise.resolve();
    this.queue = this.queue
      .then(() => control.writeValueWithResponse(bytes))
      .catch((err) => console.warn(`${this.protocol} write failed`, err));
    return this.queue;
  }

  private async setup(server: BluetoothRemoteGATTServer) {
    this.control = undefined;
    this.queue = Promise.resolve();
    this.resetControlCache();
    await this.init(server);
    await this.attachHeartRate(server);
    const c = this.lastControl;
    if (c?.kind === 'erg') await this.sendErg(c.watts);
    else if (c?.kind === 'grade') await this.sendGrade(c.pct);
  }

  /** Some trainers relay a paired HR strap; use it if present. */
  private async attachHeartRate(server: BluetoothRemoteGATTServer) {
    try {
      const hr = await (await server.getPrimaryService(HEART_RATE_SERVICE)).getCharacteristic(HEART_RATE_MEASUREMENT);
      await subscribe(hr, (v) => (this.reading = { ...this.reading, heartRate: parseHeartRate(v) }));
    } catch {
      // No HR on this device.
    }
  }
}

class FtmsTrainer extends BluetoothTrainer {
  readonly protocol = 'FTMS';
  readonly controllable = true;
  private lastPowerCmd = -1;

  protected async init(server: BluetoothRemoteGATTServer) {
    const service = await server.getPrimaryService(FTMS_SERVICE);
    await subscribe(await service.getCharacteristic(INDOOR_BIKE_DATA), (v) => {
      const d = parseIndoorBikeData(v);
      this.noteSample();
      this.reading = {
        power: d.power ?? this.reading.power,
        cadence: d.cadence ?? this.reading.cadence,
        heartRate: d.heartRate ?? this.reading.heartRate,
      };
    });
    const control = await service.getCharacteristic(FTMS_CONTROL_POINT);
    await subscribe(control, (v) => {
      const r = parseControlResponse(v);
      if (r && r.result !== 0x01) console.warn('FTMS control point rejected op', r.requestOp, 'result', r.result);
    });
    this.setControl(control);
    await this.write(requestControl());
    await this.write(startResume());
  }

  protected resetControlCache() {
    this.lastPowerCmd = -1;
  }

  protected async sendErg(watts: number) {
    // Ramps call this every frame; only send when the watt value actually changes.
    const w = Math.round(watts);
    if (w === this.lastPowerCmd) return;
    this.lastPowerCmd = w;
    await this.write(setTargetPower(w));
  }

  protected async sendGrade(gradePct: number) {
    this.lastPowerCmd = -1;
    await this.write(setSimulation({ gradePct }));
  }
}

/** Reads power and derives cadence from Cycling Power Measurement. */
class CyclingPowerTrainer extends BluetoothTrainer {
  readonly protocol: string = 'Power meter';
  readonly controllable: boolean = false;
  private readonly cadence = new CrankCadence();
  protected cps?: BluetoothRemoteGATTService;

  protected async init(server: BluetoothRemoteGATTServer) {
    this.cps = await server.getPrimaryService(CYCLING_POWER_SERVICE);
    await subscribe(await this.cps.getCharacteristic(CYCLING_POWER_MEASUREMENT), (v) => {
      const d = parseCyclingPower(v);
      this.noteSample();
      this.reading = {
        ...this.reading,
        power: d.power,
        cadence: d.crank ? this.cadence.update(d.crank, performance.now()) : this.reading.cadence,
      };
    });
  }

  // Nothing to control on a plain power meter.
  protected resetControlCache() {}
  protected async sendErg(_watts: number) {}
  protected async sendGrade(_gradePct: number) {}
}

class WahooTrainer extends CyclingPowerTrainer {
  readonly protocol = 'Wahoo';
  readonly controllable = true;
  private mode: 'erg' | 'sim' | undefined;
  private simMass = 0;
  private lastPowerCmd = -1;

  protected async init(server: BluetoothRemoteGATTServer) {
    await super.init(server);
    const control = await this.cps!.getCharacteristic(WAHOO_CONTROL);
    // Responses arrive as indications: [0x01, requestOp, status]. Status 0x01 = success.
    await subscribe(control, (v) => {
      if (v.byteLength >= 3 && v.getUint8(0) === 0x01 && v.getUint8(2) !== 0x01) {
        console.warn('Wahoo control rejected op', v.getUint8(1), 'status', v.getUint8(2));
      }
    });
    this.setControl(control);
    await this.write(wahooUnlock());
  }

  protected resetControlCache() {
    this.mode = undefined;
    this.lastPowerCmd = -1;
  }

  protected async sendErg(watts: number) {
    const w = Math.round(watts);
    if (this.mode === 'erg' && w === this.lastPowerCmd) return;
    this.mode = 'erg';
    this.lastPowerCmd = w;
    await this.write(wahooErg(w));
  }

  protected async sendGrade(gradePct: number) {
    // Leaving ERG requires re-entering sim mode before a grade is accepted (and a new weight needs it too).
    if (this.mode !== 'sim' || this.simMass !== this.massKg) {
      this.mode = 'sim';
      this.simMass = this.massKg;
      await this.write(wahooSimMode({ weightKg: this.massKg }));
    }
    this.lastPowerCmd = -1;
    await this.write(wahooGrade(gradePct));
  }
}

/** Connects to a device and picks the best protocol it supports: FTMS, then Wahoo, then read-only power. */
export async function openTrainer(device: BluetoothDevice): Promise<BluetoothTrainer> {
  const server = await device.gatt!.connect();
  let trainer: BluetoothTrainer;
  try {
    const ftms = await server.getPrimaryService(FTMS_SERVICE).catch(() => undefined);
    if (ftms) {
      trainer = new FtmsTrainer(device);
    } else {
      const cps = await server.getPrimaryService(CYCLING_POWER_SERVICE);
      const wahoo = await cps.getCharacteristic(WAHOO_CONTROL).catch(() => undefined);
      trainer = wahoo ? new WahooTrainer(device) : new CyclingPowerTrainer(device);
    }
    await trainer.connect();
  } catch (err) {
    device.gatt?.disconnect();
    throw err;
  }
  return trainer;
}

/** Shows the browser's device picker, then opens the chosen trainer. */
export async function pickTrainer(): Promise<BluetoothTrainer> {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [FTMS_SERVICE] }, { services: [CYCLING_POWER_SERVICE] }],
    optionalServices: [FTMS_SERVICE, CYCLING_POWER_SERVICE, HEART_RATE_SERVICE],
  });
  return openTrainer(device);
}
