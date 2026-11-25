const pendingFieldSaves = new Map<number, Promise<void>>();
const pendingBedSaves = new Map<number, Map<number, Promise<void>>>();

async function trackLayoutSave(saves: Map<number, Promise<void>>, id: number, write: () => Promise<unknown>): Promise<void> {
  const previous = saves.get(id);
  // Preserve drop order even when a second move finishes during the first write.
  const save = (previous ? previous.then(write, write) : write()).then(() => undefined);
  saves.set(id, save);
  try {
    await save;
  } finally {
    if (saves.get(id) === save) saves.delete(id);
  }
}

export function hasPendingFieldLayout(locationId: number): boolean {
  return pendingFieldSaves.has(locationId);
}

export function saveTrackedFieldLayout(locationId: number, write: () => Promise<unknown>): Promise<void> {
  return trackLayoutSave(pendingFieldSaves, locationId, write);
}

export async function saveTrackedBedLayout(locationId: number, bedId: number, write: () => Promise<unknown>): Promise<void> {
  const saves = pendingBedSaves.get(locationId) ?? new Map<number, Promise<void>>();
  pendingBedSaves.set(locationId, saves);
  try {
    await trackLayoutSave(saves, bedId, write);
  } finally {
    if (saves.size === 0) pendingBedSaves.delete(locationId);
  }
}

// A read after navigation must wait for drops already committed on the canvas.
export async function waitForLocationLayoutSaves(locationId: number): Promise<void> {
  for (;;) {
    const field = pendingFieldSaves.get(locationId);
    const beds = pendingBedSaves.get(locationId);
    if (!field && !beds?.size) return;
    await Promise.allSettled([field, ...(beds?.values() ?? [])]);
  }
}
