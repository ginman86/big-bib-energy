// Rider-made items (workouts, courses): kept in this browser, and synced to the account when
// signed in. Newest change wins; deletes are tombstones (see core/custom-items).

import { mergeCustom } from '../core/custom-items';
import { api, ApiError } from './client';

type Entry<T> = { id: string; deleted?: boolean; updatedAt: string } & Record<string, T | string | boolean | undefined>;

export interface CustomStore<T extends { id: string }> {
  /** Live items in this browser, most recently changed first. */
  local(): T[];
  save(item: T, signedIn: boolean): Promise<void>;
  remove(id: string, signedIn: boolean): Promise<void>;
  /** Merge with the account's copies, push anything newer here, return the live list. */
  sync(): Promise<T[]>;
}

/** `field` is the item's key in stored entries and API bodies ("workout", "course"); `path` its API path. */
export function customStore<T extends { id: string }>(key: string, path: string, field: string): CustomStore<T> {
  const read = (): Entry<T>[] => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '[]') as Entry<T>[];
    } catch {
      return [];
    }
  };
  const write = (entries: Entry<T>[]) => {
    try {
      localStorage.setItem(key, JSON.stringify(entries));
    } catch {
      // Storage full or blocked; the account copy (if signed in) still has it.
    }
  };
  const upsert = (e: Entry<T>) => write([...read().filter((x) => x.id !== e.id), e]);
  const live = (entries: Entry<T>[]): T[] =>
    entries
      .filter((e) => !e.deleted && e[field])
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .map((e) => e[field] as T);

  async function push(e: Entry<T>) {
    try {
      if (e.deleted) await api('DELETE', `/${path}/${e.id}?at=${encodeURIComponent(e.updatedAt)}`);
      else await api('PUT', `/${path}/${e.id}`, { [field]: e[field], updatedAt: e.updatedAt });
    } catch (err) {
      // 409: another device has a newer version; the next sync picks it up.
      if (!(err instanceof ApiError && err.status === 409)) throw err;
    }
  }
  const sendIf = async (e: Entry<T>, signedIn: boolean) => {
    if (signedIn) await push(e).catch((err) => console.warn(`${field} sync failed`, err));
  };

  return {
    local: () => live(read()),
    async save(item, signedIn) {
      const e = { id: item.id, [field]: item, updatedAt: new Date().toISOString() } as Entry<T>;
      upsert(e);
      await sendIf(e, signedIn);
    },
    async remove(id, signedIn) {
      const e = { id, deleted: true, updatedAt: new Date().toISOString() } as Entry<T>;
      upsert(e);
      await sendIf(e, signedIn);
    },
    async sync() {
      const res = await api<Record<string, Entry<T>[]>>('GET', `/${path}`);
      const { merged, push: pending } = mergeCustom(read(), res[path] ?? []);
      write(merged);
      for (const e of pending) await push(e);
      return live(merged);
    },
  };
}
