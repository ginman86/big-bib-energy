// Standalone Bluetooth heart-rate monitor (chest strap, or a watch broadcasting HR).

import { HEART_RATE_MEASUREMENT, HEART_RATE_SERVICE, parseHeartRate } from '../core/ftms';

/** Straps notify ~1 Hz; treat silence beyond this as "no reading" rather than showing a frozen number. */
const STALE_MS = 5000;

export class HeartRateMonitor {
  name = 'Heart rate';
  onDisconnect?: () => void;

  private device?: BluetoothDevice;
  private bpm?: number;
  private at = 0;

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [HEART_RATE_SERVICE] }] });
    this.name = this.device.name ?? this.name;
    this.device.addEventListener('gattserverdisconnected', () => this.onDisconnect?.());

    const server = await this.device.gatt!.connect();
    const hr = await (await server.getPrimaryService(HEART_RATE_SERVICE)).getCharacteristic(HEART_RATE_MEASUREMENT);
    hr.addEventListener('characteristicvaluechanged', (e) => {
      const bpm = parseHeartRate((e.target as BluetoothRemoteGATTCharacteristic).value!);
      // Straps report 0 while they have no skin contact.
      this.bpm = bpm > 0 ? bpm : undefined;
      this.at = performance.now();
    });
    await hr.startNotifications();
  }

  async disconnect() {
    this.device?.gatt?.disconnect();
  }

  latest(): number | undefined {
    return performance.now() - this.at < STALE_MS ? this.bpm : undefined;
  }
}
