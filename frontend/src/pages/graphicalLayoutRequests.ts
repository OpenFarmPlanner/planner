export const pendingFieldSaves = new Map<number, Promise<void>>();
const pendingBedSaves = new Map<number, Set<Promise<unknown>>>();

export async function trackBedLayoutSave(locationId: number, save: Promise<unknown>): Promise<void> {
  const saves = pendingBedSaves.get(locationId) ?? new Set();
  pendingBedSaves.set(locationId, saves);
  saves.add(save);
  try {
    await save;
  } finally {
    saves.delete(save);
    if (saves.size === 0) pendingBedSaves.delete(locationId);
  }
}

// A read after navigation must wait for writes already sent to the server.
export async function waitForLocationLayoutSaves(locationId: number): Promise<void> {
  await Promise.allSettled([pendingFieldSaves.get(locationId), ...(pendingBedSaves.get(locationId) ?? [])]);
}
