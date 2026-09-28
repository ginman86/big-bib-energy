// Keeps a Bluetooth device connected. Once the user has picked a device, the page may reconnect
// to it without another prompt, so on an unexpected drop we retry with backoff until it's back
// or the user disconnects.

import { reconnectDelayMs } from '../core/latency';

export type LinkStatus = 'connected' | 'reconnecting' | 'disconnected';

export class GattLink {
  status: LinkStatus = 'disconnected';
  onStatus?: (s: LinkStatus) => void;
  private closing = false;
  private retrying = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly device: BluetoothDevice,
    /** (Re)builds characteristics and subscriptions on a fresh GATT server. */
    private readonly setup: (server: BluetoothRemoteGATTServer) => Promise<void>,
  ) {
    device.addEventListener('gattserverdisconnected', () => this.dropped());
  }

  async connect() {
    this.closing = false;
    const gatt = this.device.gatt!;
    // Already connected (e.g. during protocol detection): reuse it rather than connecting twice.
    const server = gatt.connected ? gatt : await gatt.connect();
    await this.setup(server);
    this.set('connected');
  }

  close() {
    this.closing = true;
    this.retrying = false;
    clearTimeout(this.timer);
    this.device.gatt?.disconnect();
    this.set('disconnected');
  }

  private dropped() {
    if (this.closing || this.retrying) return;
    this.retrying = true;
    this.set('reconnecting');
    this.attempt(0);
  }

  private attempt(n: number) {
    this.timer = setTimeout(async () => {
      if (this.closing) return;
      try {
        await this.connect();
        this.retrying = false;
      } catch (err) {
        console.warn(`Reconnect to ${this.device.name ?? 'device'} failed (attempt ${n + 1})`, err);
        if (this.device.gatt?.connected) this.device.gatt.disconnect();
        this.attempt(n + 1);
      }
    }, reconnectDelayMs(n));
  }

  private set(s: LinkStatus) {
    if (s === this.status) return;
    this.status = s;
    this.onStatus?.(s);
  }
}

/** Devices this site was previously allowed to use, if the browser exposes them (behind flags today). */
export async function rememberedDevice(id: string): Promise<BluetoothDevice | undefined> {
  const bt = navigator.bluetooth as Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> };
  if (typeof bt.getDevices !== 'function') return undefined;
  return (await bt.getDevices()).find((d) => d.id === id);
}

/**
 * Opens a remembered device without a prompt. If it's not reachable yet (trainer still asleep),
 * waits for it to advertise, when the browser supports that, for up to `waitMs`.
 */
export async function openWhenInRange<T>(device: BluetoothDevice, open: (d: BluetoothDevice) => Promise<T>, waitMs = 5 * 60_000): Promise<T> {
  try {
    return await open(device);
  } catch (err) {
    const d = device as BluetoothDevice & { watchAdvertisements?: (o?: { signal?: AbortSignal }) => Promise<void> };
    if (typeof d.watchAdvertisements !== 'function') throw err;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), waitMs);
    await d.watchAdvertisements({ signal: abort.signal });
    return new Promise<T>((resolve, reject) => {
      let seen = false;
      // We abort the watch ourselves once seen; only a timeout abort is a failure.
      abort.signal.addEventListener('abort', () => !seen && reject(new Error('Device not seen')));
      d.addEventListener(
        'advertisementreceived',
        () => {
          seen = true;
          clearTimeout(timeout);
          abort.abort();
          open(device).then(resolve, reject);
        },
        { once: true },
      );
    });
  }
}
