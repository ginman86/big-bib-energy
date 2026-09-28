// Sending finished rides to the API (which stores them and uploads to Strava), with a small
// local queue for rides that couldn't be sent or were still processing.

import { encodeFitActivity } from '../core/fit';
import { rideDescription, rideTitle } from '../core/activity-text';
import type { RideSummary, Sample } from '../core/session';
import { api, ApiError } from './client';

export interface StravaStatus {
  status: 'uploaded' | 'processing' | 'failed' | 'not-connected';
  activityId?: number;
  url?: string;
  error?: string;
}

interface PendingRide {
  id: string;
  startedAt: string;
  name: string;
  description: string;
  summary: Omit<RideSummary, 'segments'>;
  fit: string; // base64
}

const QUEUE_KEY = 'bbe.uploadQueue';
const MAX_QUEUE = 20;

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Builds the upload payload once, so retries send the identical ride (same ID → idempotent). */
export function pendingRide(summary: RideSummary, samples: Sample[]): PendingRide {
  const startedAtMs = summary.startedAtMs ?? Date.now() - summary.seconds * 1000;
  const fit = encodeFitActivity({ startedAtMs, utcOffsetS: -new Date(startedAtMs).getTimezoneOffset() * 60, summary, samples });
  const { segments: _segments, ...rest } = summary;
  return {
    id: crypto.randomUUID(),
    startedAt: new Date(startedAtMs).toISOString(),
    name: rideTitle(summary),
    description: rideDescription(summary),
    summary: rest,
    fit: toBase64(fit),
  };
}

function readQueue(): PendingRide[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as PendingRide[];
  } catch {
    return [];
  }
}

function writeQueue(q: PendingRide[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
  } catch {
    // Storage full or blocked: the ride is still downloadable from the summary.
  }
}

const enqueue = (r: PendingRide) => writeQueue([...readQueue().filter((x) => x.id !== r.id), r]);
const dequeue = (id: string) => writeQueue(readQueue().filter((x) => x.id !== id));

/** Upload one ride. Anything worth retrying later is queued. */
export async function sendRide(ride: PendingRide): Promise<StravaStatus> {
  try {
    const res = await api<{ strava: StravaStatus }>('POST', '/rides', ride);
    if (res.strava.status === 'processing') enqueue(ride);
    else dequeue(ride.id);
    return res.strava;
  } catch (err) {
    // Network errors and server errors are retried; a 4xx won't get better.
    if (!(err instanceof ApiError) || err.status >= 500) enqueue(ride);
    return { status: 'failed', error: err instanceof ApiError ? err.message : 'Offline: will retry next time' };
  }
}

/** Retry queued rides (call once signed in). */
export async function flushQueue(): Promise<void> {
  for (const ride of readQueue()) await sendRide(ride);
}
