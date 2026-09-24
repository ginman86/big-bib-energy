// Real smart trainer over Web Bluetooth FTMS (e.g. Elite Suito).
// Requires Chrome/Edge on desktop or Android, served from localhost or HTTPS.

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

export class FtmsTrainer implements Trainer {
  readonly simulated = false;
  name = 'Smart trainer';

  private device?: BluetoothDevice;
  private control?: BluetoothRemoteGATTCharacteristic;
  private reading: Reading = { power: 0 };
  private lastPowerCmd = -1;
  /** Control point writes must not overlap; chain them. */
  private queue: Promise<unknown> = Promise.resolve();
  onDisconnect?: () => void;

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [FTMS_SERVICE] }],
      optionalServices: [HEART_RATE_SERVICE],
    });
    this.name = this.device.name ?? this.name;
    this.device.addEventListener('gattserverdisconnected', () => this.onDisconnect?.());

    const server = await this.device.gatt!.connect();
    const ftms = await server.getPrimaryService(FTMS_SERVICE);

    const data = await ftms.getCharacteristic(INDOOR_BIKE_DATA);
    data.addEventListener('characteristicvaluechanged', (e) => {
      const d = parseIndoorBikeData((e.target as BluetoothRemoteGATTCharacteristic).value!);
      this.reading = {
        power: d.power ?? this.reading.power,
        cadence: d.cadence ?? this.reading.cadence,
        heartRate: d.heartRate ?? this.reading.heartRate,
      };
    });
    await data.startNotifications();

    this.control = await ftms.getCharacteristic(FTMS_CONTROL_POINT);
    this.control.addEventListener('characteristicvaluechanged', (e) => {
      const r = parseControlResponse((e.target as BluetoothRemoteGATTCharacteristic).value!);
      if (r && r.result !== 0x01) console.warn('FTMS control point rejected op', r.requestOp, 'result', r.result);
    });
    await this.control.startNotifications();
    await this.write(requestControl());
    await this.write(startResume());

    // Some trainers expose HR from a paired strap; use it if present.
    try {
      const hr = await (await server.getPrimaryService(HEART_RATE_SERVICE)).getCharacteristic(HEART_RATE_MEASUREMENT);
      hr.addEventListener('characteristicvaluechanged', (e) => {
        this.reading = { ...this.reading, heartRate: parseHeartRate((e.target as BluetoothRemoteGATTCharacteristic).value!) };
      });
      await hr.startNotifications();
    } catch {
      // No HR on this device.
    }
  }

  async disconnect() {
    this.device?.gatt?.disconnect();
  }

  latest(): Reading {
    return this.reading;
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

  private write(bytes: Uint8Array<ArrayBuffer>) {
    const control = this.control;
    if (!control) return Promise.resolve();
    this.queue = this.queue.then(() => control.writeValueWithResponse(bytes)).catch((err) => console.warn('FTMS write failed', err));
    return this.queue;
  }
}
