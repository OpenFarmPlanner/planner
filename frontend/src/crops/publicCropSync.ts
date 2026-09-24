import type { PublicCropSyncFieldChange } from '../api/types';
import { isEmptyPublicValue } from '../crop-library/components/publicCropLibrary/formatters';

/**
 * Which side wins for one differing field when a crop is synced with its
 * public entry: `library` overwrites the local value, `mine` writes the local
 * value into the entry. There is deliberately no "keep only locally" choice:
 * the update model has no "linked but intentionally different" state, so it
 * would leave a push action standing forever.
 */
export type PublicCropSyncChoice = 'library' | 'mine';

export type PublicCropSyncChoices = Record<string, PublicCropSyncChoice>;

/**
 * The preselection for one field: only the library has a value -> take it;
 * only the local crop has one -> push it; both set and different -> the
 * library's value. A field the user may not push (the fixed Kulturart name,
 * a Sorte rename on someone else's entry) always starts on the library side.
 */
export function getDefaultSyncChoice(change: PublicCropSyncFieldChange): PublicCropSyncChoice {
  if (!change.pushable) return 'library';
  const hasPublicValue = !isEmptyPublicValue(change.public_value);
  const hasLocalValue = !isEmptyPublicValue(change.local_value);
  return hasLocalValue && !hasPublicValue ? 'mine' : 'library';
}

export function buildDefaultSyncChoices(changes: readonly PublicCropSyncFieldChange[]): PublicCropSyncChoices {
  return Object.fromEntries(changes.map((change) => [change.field, getDefaultSyncChoice(change)]));
}

/** "Alle aus Bibliothek" / "Alle meine Werte" — fields that cannot be pushed stay on the library side. */
export function buildUniformSyncChoices(
  changes: readonly PublicCropSyncFieldChange[],
  choice: PublicCropSyncChoice,
): PublicCropSyncChoices {
  return Object.fromEntries(changes.map((change) => [
    change.field,
    choice === 'mine' && change.pushable ? 'mine' : 'library',
  ]));
}

export interface PublicCropSyncSelection {
  /** Take the library's value locally. */
  pullFields: string[];
  /** Write the local value into the library entry. */
  pushFields: string[];
}

export function splitSyncChoices(
  changes: readonly PublicCropSyncFieldChange[],
  choices: PublicCropSyncChoices,
): PublicCropSyncSelection {
  const pullFields: string[] = [];
  const pushFields: string[] = [];
  changes.forEach((change) => {
    const choice = choices[change.field] ?? getDefaultSyncChoice(change);
    if (choice === 'mine' && change.pushable) {
      pushFields.push(change.field);
    } else {
      pullFields.push(change.field);
    }
  });
  return { pullFields, pushFields };
}
