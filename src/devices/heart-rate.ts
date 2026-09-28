// Standalone Bluetooth heart-rate monitor (chest strap, or a watch broadcasting HR).

import { HEART_RATE_MEASUREMENT, HEART_RATE_SERVICE, parseHeartRate } from '../core/ftms';
import { GattLink, LinkStatus } from './gatt-link';

/** Straps notify ~1 Hz; treat silence beyond this as "no reading" rather than showing a frozen number. */
const STALE_MS = 5000;

export class HeartRateMonitor {
  readonly name: string;
  readonly link: GattLink;

  private bpm?: number;
  private at = 0;

  constructor(readonly device: BluetoothDevice) {
    this.name = device.name ?? 'Heart rate';
    this.link = new GattLink(device, (server) => this.setup(server));
  }

  get id() {
    return this.device.id;
  }

  get connection(): LinkStatus {
    return this.link.status;
  }

  async connect() {
    await this.link.connect();
  }

  async disconnect() {
    this.link.close();
  }

  latest(): number | undefined {
    return performance.now() - this.at < STALE_MS ? this.bpm : undefined;
  }

  private async setup(server: BluetoothRemoteGATTServer) {
    const hr = await (await server.getPrimaryService(HEART_RATE_SERVICE)).getCharacteristic(HEART_RATE_MEASUREMENT);
    hr.addEventListener('characteristicvaluechanged', (e) => {
      const bpm = parseHeartRate((e.target as BluetoothRemoteGATTCharacteristic).value!);
      // Straps report 0 while they have no skin contact.
      this.bpm = bpm > 0 ? bpm : undefined;
      this.at = performance.now();
    });
    await hr.startNotifications();
  }
}

export async function openHeartRate(device: BluetoothDevice): Promise<HeartRateMonitor> {
  const m = new HeartRateMonitor(device);
  await m.connect();
  return m;
}

export async function pickHeartRate(): Promise<HeartRateMonitor> {
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [HEART_RATE_SERVICE] }] });
  return openHeartRate(device);
}
