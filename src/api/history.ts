// Ride history: this browser's rides merged with the account's synced rides. Local rides that the
// account doesn't have yet (recorded before signing in) are imported, without going to Strava.

import { mergeHistory, RideRecord, toHistoryRide } from '../core/history';
import type { HistoryRide } from '../core/progression';
import type { RideSummary } from '../core/session';
import { api } from './client';

interface RemoteRide {
  id: string;
  startedAt: string;
  name: string;
  summary: Omit<RideSummary, 'segments'>;
  stravaActivityId?: number;
}

const toHistory = (r: RemoteRide): HistoryRide => toHistoryRide({ id: r.id, startedAt: r.startedAt, summary: r.summary });

const IMPORT_BATCH = 200;

/** Fetch synced rides, import local-only ones, and return the merged history (oldest first). */
export async function syncHistory(local: RideRecord[]): Promise<HistoryRide[]> {
  const { rides } = await api<{ rides: RemoteRide[] }>('GET', '/rides');
  const merged = mergeHistory(rides.map(toHistory), local.map(toHistoryRide));

  const byId = new Map(local.map((r) => [r.id, r]));
  const pending = merged.localOnly.map((h) => byId.get(h.id)!).filter(Boolean);
  for (let i = 0; i < pending.length; i += IMPORT_BATCH) {
    const batch = pending.slice(i, i + IMPORT_BATCH).map((r) => ({
      id: r.id,
      startedAt: r.startedAt,
      name: r.summary.workoutName,
      summary: r.summary,
    }));
    await api('POST', '/rides/import', { rides: batch });
  }
  return merged.rides;
}
