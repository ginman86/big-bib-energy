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
import type { Reading } from '../core/session';
import type { Trainer } from './trainer';

export const bluetoothAvailable = () => typeof navigator !== 'undefined' && 'bluetooth' in navigator;

type Bytes = Uint8Array<ArrayBuffer>;
const valueOf = (e: Event) => (e.target as BluetoothRemoteGATTCharacteristic).value!;

async function subscribe(char: BluetoothRemoteGATTCharacteristic, onValue: (v: DataView) => void) {
  char.addEventListener('characteristicvaluechanged', (e) => onValue(valueOf(e)));
  await char.startNotifications();
}

export abstract class BluetoothTrainer implements Trainer {
  readonly simulated = false;
  abstract readonly protocol: string;
  abstract readonly controllable: boolean;
  readonly name: string;
  onDisconnect?: () => void;

  protected reading: Reading = { power: 0 };
  private control?: BluetoothRemoteGATTCharacteristic;
  /** Control writes must not overlap (KICKRs drop them); chain them. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    protected readonly device: BluetoothDevice,
    protected readonly server: BluetoothRemoteGATTServer,
  ) {
    this.name = device.name ?? 'Smart trainer';
    device.addEventListener('gattserverdisconnected', () => this.onDisconnect?.());
  }

  abstract init(): Promise<void>;
  abstract setTargetPower(watts: number): Promise<void>;
  abstract setGrade(gradePct: number): Promise<void>;

  async connect() {
    // Connection happens in connectTrainer(); kept for the Trainer interface.
  }

  async disconnect() {
    this.device.gatt?.disconnect();
  }

  latest(): Reading {
    return this.reading;
  }

  /** Some trainers relay a paired HR strap; use it if present. */
  async attachHeartRate() {
    try {
      const hr = await (await this.server.getPrimaryService(HEART_RATE_SERVICE)).getCharacteristic(HEART_RATE_MEASUREMENT);
      await subscribe(hr, (v) => (this.reading = { ...this.reading, heartRate: parseHeartRate(v) }));
    } catch {
      // No HR on this device.
    }
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
}

class FtmsTrainer extends BluetoothTrainer {
  readonly protocol = 'FTMS';
  readonly controllable = true;
  private lastPowerCmd = -1;

  constructor(
    device: BluetoothDevice,
    server: BluetoothRemoteGATTServer,
    private readonly service: BluetoothRemoteGATTService,
  ) {
    super(device, server);
  }

  async init() {
    await subscribe(await this.service.getCharacteristic(INDOOR_BIKE_DATA), (v) => {
      const d = parseIndoorBikeData(v);
      this.reading = {
        power: d.power ?? this.reading.power,
        cadence: d.cadence ?? this.reading.cadence,
        heartRate: d.heartRate ?? this.reading.heartRate,
      };
    });
    const control = await this.service.getCharacteristic(FTMS_CONTROL_POINT);
    await subscribe(control, (v) => {
      const r = parseControlResponse(v);
      if (r && r.result !== 0x01) console.warn('FTMS control point rejected op', r.requestOp, 'result', r.result);
    });
    this.setControl(control);
    await this.write(requestControl());
    await this.write(startResume());
  }

  async setTargetPower(watts: number) {
    // Ramps call this every frame; only send when the watt value actually changes.
    const w = Math.round(watts);
    if (w === this.lastPowerCmd) return;
    this.lastPowerCmd = w;
    await this.write(setTargetPower(w));
  }

  async setGrade(gradePct: number) {
    this.lastPowerCmd = -1;
    await this.write(setSimulation({ gradePct }));
  }
}

/** Reads power and derives cadence from Cycling Power Measurement. */
class CyclingPowerTrainer extends BluetoothTrainer {
  readonly protocol: string = 'Power meter';
  readonly controllable: boolean = false;
  private readonly cadence = new CrankCadence();

  constructor(
    device: BluetoothDevice,
    server: BluetoothRemoteGATTServer,
    protected readonly service: BluetoothRemoteGATTService,
  ) {
    super(device, server);
  }

  async init() {
    await subscribe(await this.service.getCharacteristic(CYCLING_POWER_MEASUREMENT), (v) => {
      const d = parseCyclingPower(v);
      this.reading = {
        ...this.reading,
        power: d.power,
        cadence: d.crank ? this.cadence.update(d.crank, performance.now()) : this.reading.cadence,
      };
    });
  }

  // Nothing to control on a plain power meter.
  async setTargetPower(_watts: number) {}
  async setGrade(_gradePct: number) {}
}

class WahooTrainer extends CyclingPowerTrainer {
  readonly protocol = 'Wahoo';
  readonly controllable = true;
  private mode: 'erg' | 'sim' | undefined;
  private lastPowerCmd = -1;

  constructor(
    device: BluetoothDevice,
    server: BluetoothRemoteGATTServer,
    service: BluetoothRemoteGATTService,
    private readonly controlChar: BluetoothRemoteGATTCharacteristic,
  ) {
    super(device, server, service);
  }

  async init() {
    await super.init();
    // Responses arrive as indications: [0x01, requestOp, status]. Status 0x01 = success.
    await subscribe(this.controlChar, (v) => {
      if (v.byteLength >= 3 && v.getUint8(0) === 0x01 && v.getUint8(2) !== 0x01) {
        console.warn('Wahoo control rejected op', v.getUint8(1), 'status', v.getUint8(2));
      }
    });
    this.setControl(this.controlChar);
    await this.write(wahooUnlock());
  }

  async setTargetPower(watts: number) {
    const w = Math.round(watts);
    if (this.mode === 'erg' && w === this.lastPowerCmd) return;
    this.mode = 'erg';
    this.lastPowerCmd = w;
    await this.write(wahooErg(w));
  }

  async setGrade(gradePct: number) {
    // Leaving ERG requires re-entering sim mode before a grade is accepted.
    if (this.mode !== 'sim') {
      this.mode = 'sim';
      await this.write(wahooSimMode());
    }
    this.lastPowerCmd = -1;
    await this.write(wahooGrade(gradePct));
  }
}

/** Shows the browser's device picker, connects, and picks the best protocol the device supports. */
export async function connectTrainer(): Promise<BluetoothTrainer> {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [FTMS_SERVICE] }, { services: [CYCLING_POWER_SERVICE] }],
    optionalServices: [FTMS_SERVICE, CYCLING_POWER_SERVICE, HEART_RATE_SERVICE],
  });
  const server = await device.gatt!.connect();

  let trainer: BluetoothTrainer;
  const ftms = await server.getPrimaryService(FTMS_SERVICE).catch(() => undefined);
  if (ftms) {
    trainer = new FtmsTrainer(device, server, ftms);
  } else {
    const cps = await server.getPrimaryService(CYCLING_POWER_SERVICE);
    const wahoo = await cps.getCharacteristic(WAHOO_CONTROL).catch(() => undefined);
    trainer = wahoo ? new WahooTrainer(device, server, cps, wahoo) : new CyclingPowerTrainer(device, server, cps);
  }
  try {
    await trainer.init();
    await trainer.attachHeartRate();
  } catch (err) {
    device.gatt?.disconnect();
    throw err;
  }
  return trainer;
}
