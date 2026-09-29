// Rider-made things (workouts, courses) across devices: local copies and the account's copies,
// merged newest-wins, with deletes kept as tombstones so a stale device can't bring one back.

export function mergeCustom<E extends { id: string; updatedAt: string }>(local: E[], remote: E[]): { merged: E[]; push: E[] } {
  const byId = new Map<string, E>();
  for (const r of remote) byId.set(r.id, r);
  const push: E[] = [];
  for (const l of local) {
    const r = byId.get(l.id);
    if (!r || Date.parse(l.updatedAt) > Date.parse(r.updatedAt)) {
      byId.set(l.id, l);
      push.push(l);
    }
  }
  return { merged: [...byId.values()], push };
}
