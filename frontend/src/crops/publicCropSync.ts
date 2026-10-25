import type { PublicCropSyncFieldChange, PublicCropSyncPinBlockedReason } from '../api/types';
import { isEmptyPublicValue } from '../crop-library/components/publicCropLibrary/formatters';

/**
 * Which side wins for one differing field when a crop is synced with its
 * public entry: `library` overwrites the local value, `mine` writes the local
 * value into the entry, `local` keeps the local value without sharing it — the
 * field is pinned (`Crop.library_pinned_fields`) and drops out of every later
 * library diff, so it never leaves a pull or push action standing. `local` is
 * only offered for an already linked crop ("Mit Kulturbibliothek abgleichen").
 */
export type PublicCropSyncChoice = 'library' | 'mine' | 'local';

export interface PublicCropSyncChoiceOptions {
  /** The flow offers "Nur lokal" (the sync of a linked crop, not a link confirmation). */
  allowLocal?: boolean;
}

/**
 * Whether "Nur lokal" can be chosen for this field. The rule lives in the
 * backend alone (`library_pin_blocked_reason`); the preview reports it per field.
 */
export function canKeepSyncFieldLocally(change: PublicCropSyncFieldChange): boolean {
  return change.pinnable === true;
}

const PIN_BLOCKED_REASON_KEYS: Record<PublicCropSyncPinBlockedReason, string> = {
  identity: 'library.sync.notPinnableIdentity',
  species_invariant: 'library.sync.notPinnableSpeciesInvariant',
  empty: 'library.sync.notPinnableEmpty',
};

/** The i18n key explaining why "Nur lokal" is unavailable, or null when the backend named no reason. */
export function getSyncPinBlockedReasonKey(change: PublicCropSyncFieldChange): string | null {
  if (canKeepSyncFieldLocally(change) || !change.pin_blocked_reason) return null;
  return PIN_BLOCKED_REASON_KEYS[change.pin_blocked_reason] ?? null;
}

export type PublicCropSyncChoices = Record<string, PublicCropSyncChoice>;

/**
 * The preselection for one field: only the library has a value -> take it;
 * only the local crop has one -> push it; both set and different -> the
 * library's value wins. When in doubt, the library (reviewed by its
 * maintainers) is trusted over a local edit whose origin the user may not
 * remember, whether this is the first link or an update of an already-linked
 * crop.
 * A field the user may not push (the fixed Kulturart name, a Sorte rename on
 * someone else's entry) always starts on the library side.
 */
export function getDefaultSyncChoice(
  change: PublicCropSyncFieldChange,
  { allowLocal = false }: PublicCropSyncChoiceOptions = {},
): PublicCropSyncChoice {
  // A field the user already pinned stays pinned unless they release it here.
  if (allowLocal && change.pinned && canKeepSyncFieldLocally(change)) return 'local';
  if (!change.pushable) return 'library';
  const hasPublicValue = !isEmptyPublicValue(change.public_value);
  const hasLocalValue = !isEmptyPublicValue(change.local_value);
  if (!hasLocalValue) return 'library';
  if (!hasPublicValue) return 'mine';
  return 'library';
}

export function buildDefaultSyncChoices(
  changes: readonly PublicCropSyncFieldChange[],
  options: PublicCropSyncChoiceOptions = {},
): PublicCropSyncChoices {
  return Object.fromEntries(changes.map((change) => [change.field, getDefaultSyncChoice(change, options)]));
}

function isChoiceAvailable(change: PublicCropSyncFieldChange, choice: PublicCropSyncChoice): boolean {
  if (choice === 'mine') return change.pushable;
  if (choice === 'local') return canKeepSyncFieldLocally(change);
  return true;
}

/**
 * "Alle aus Bibliothek" / "Alle teilen" / "Alle nur lokal" — a field that
 * cannot take the chosen side (not pushable, nothing to keep) stays on the
 * library side.
 */
export function buildUniformSyncChoices(
  changes: readonly PublicCropSyncFieldChange[],
  choice: PublicCropSyncChoice,
): PublicCropSyncChoices {
  return Object.fromEntries(changes.map((change) => [
    change.field,
    isChoiceAvailable(change, choice) ? choice : 'library',
  ]));
}

export interface PublicCropSyncSelection {
  /** Take the library's value locally. */
  pullFields: string[];
  /** Write the local value into the library entry. */
  pushFields: string[];
  /** Keep the local value, not shared (pinned). */
  pinFields: string[];
}

export function splitSyncChoices(
  changes: readonly PublicCropSyncFieldChange[],
  choices: PublicCropSyncChoices,
  options: PublicCropSyncChoiceOptions = {},
): PublicCropSyncSelection {
  const pullFields: string[] = [];
  const pushFields: string[] = [];
  const pinFields: string[] = [];
  changes.forEach((change) => {
    const choice = choices[change.field] ?? getDefaultSyncChoice(change, options);
    if (choice === 'local' && options.allowLocal && canKeepSyncFieldLocally(change)) {
      pinFields.push(change.field);
    } else if (choice === 'mine' && change.pushable) {
      pushFields.push(change.field);
    } else {
      pullFields.push(change.field);
    }
  });
  return { pullFields, pushFields, pinFields };
}
