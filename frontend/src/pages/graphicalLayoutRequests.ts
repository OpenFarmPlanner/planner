export const pendingFieldSaves = new Map<number, Promise<void>>();
const pendingBedSaves = new Map<number, Map<number, Promise<void>>>();

export async function saveTrackedBedLayout(locationId: number, bedId: number, write: () => Promise<unknown>): Promise<void> {
  const saves = pendingBedSaves.get(locationId) ?? new Map<number, Promise<void>>();
  pendingBedSaves.set(locationId, saves);
  const previous = saves.get(bedId) ?? Promise.resolve();
  // Preserve drop order even when a second move finishes during the first write.
  const save = previous.catch(() => undefined).then(write).then(() => undefined);
  saves.set(bedId, save);
  try {
    await save;
  } finally {
    if (saves.get(bedId) === save) saves.delete(bedId);
    if (saves.size === 0) pendingBedSaves.delete(locationId);
  }
}

// A read after navigation must wait for drops already committed on the canvas.
export async function waitForLocationLayoutSaves(locationId: number): Promise<void> {
  await Promise.allSettled([pendingFieldSaves.get(locationId), ...(pendingBedSaves.get(locationId)?.values() ?? [])]);
}
