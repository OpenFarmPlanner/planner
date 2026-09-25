import type { Crop } from '../api/types';
import type { PublicCropUpdateController } from './usePublicCropUpdate';

/**
 * The public-library state of a crop, shown as an action in the crop detail
 * badge row and as a compact status icon per crop list row. In the badge row
 * it is one button whose label, colour, enabled state and target change with
 * context — it replaced the header overflow entry, the "Update verfügbar"
 * banner and the sync marker chip.
 */
export type CropLibraryActionKind =
  | 'publish'
  | 'pullUpdate'
  | 'pushUpdate'
  | 'updateRejected'
  | 'proposalPending'
  | 'upToDate';

export interface CropLibraryAction {
  kind: CropLibraryActionKind;
  /**
   * How the state presents itself: an action `button`, or a passive status
   * `chip` for the states that offer no work to do.
   */
  variant: 'button' | 'chip';
  /** i18n key under the `library` namespace for the button label. */
  labelKey: string;
  /**
   * MUI colour: `primary` (green) for publish/push, `info` (blue) for a pull or
   * the "Aktuell" chip, `default` for the neutral declined-update chip.
   */
  color: 'primary' | 'info' | 'default';
  /**
   * The control exists but is currently unavailable (species under moderation)
   * — it renders greyed out. A passive status like "Aktuell" is not "disabled":
   * it offers no action in the first place.
   */
  disabled: boolean;
  /** i18n key under `library` for the explanatory tooltip, or null when there is none. */
  tooltipKey: string | null;
  /**
   * `publish` opens the publishing wizard (it already routes an owned-entry
   * update through its own flow); `diff` opens the pull diff/apply dialog;
   * `null` when the button is inert.
   */
  trigger: CropLibraryTrigger | null;
}

/** The dialog a library action opens: the publishing wizard or the pull diff. */
export type CropLibraryTrigger = 'publish' | 'diff';

export type CropLibrarySyncFlags = Pick<PublicCropUpdateController, 'hasOpenUpdate' | 'isRejected'>;

/**
 * The two pull-side flags straight from the serialized crop. The detail
 * page's `usePublicCropUpdate` controller exposes the same values; list rows
 * that hold no controller read them here.
 */
export function readCropLibrarySyncFlags(crop: Crop | null | undefined): CropLibrarySyncFlags {
  return {
    hasOpenUpdate: Boolean(crop?.public_update_available),
    isRejected: Boolean(crop?.public_update_rejected),
  };
}

/**
 * Resolves the library state of a crop. Shared by the detail badge row's
 * `CropLibraryActionButton` and the crop list's `CropLibraryStatusIcon`, so
 * both always show the same state. Priority order (first match wins):
 *
 * 1. Not connected to any public entry -> publish.
 * 2. The library is ahead and undecided (`public_update_available`) -> pull.
 *    Wins over any push offer: while the library is ahead, a push is never
 *    offered at the same time.
 * 2b. The pending version was explicitly declined (`public_update_rejected`)
 *    -> no button at all, only a neutral "Update abgelehnt" status chip. The
 *    decision is stored per public version, so the pull button comes back on
 *    its own once the entry changes again; the chip stays clickable so the
 *    same diff can still be reopened and applied after a change of mind. This
 *    case sits above the push cases on purpose: pushing a declined copy would
 *    silently undo the very change the user declined.
 * 2c. The user's own contribution to the entry waits in the moderation queue
 *    (`public_change_proposal_pending`) while the crop still differs -> a
 *    neutral "Vorschlag in Prüfung" status chip. Offering the push again would
 *    only file the same values a second time.
 * 3./4. Connected (own entry or imported) with local changes to contribute
 *    -> push. `public_publish_blocked_reason` is `null` exactly then; the
 *    `update_pending` reason always coincides with case 2 and is handled there.
 * 5. Connected, nothing pending and nothing to contribute -> a plain "Aktuell"
 *    status chip, not a button (there is no action to offer).
 *
 * A crop species still awaiting moderation freezes library sync, so cases 2-4
 * render disabled with the existing "proposal under review" tooltip instead.
 */
export function resolveCropLibraryAction(
  crop: Crop | null | undefined,
  controller: CropLibrarySyncFlags = readCropLibrarySyncFlags(crop),
): CropLibraryAction {
  const linked = Boolean(crop?.owned_public_crop_id || crop?.source_public_crop);
  const speciesPending = Boolean(crop?.public_crop_species_pending);
  const frozenTooltipKey = speciesPending ? 'badges.speciesPendingTooltip' : null;

  if (!linked) {
    return {
      kind: 'publish',
      variant: 'button',
      labelKey: 'libraryAction.publish',
      color: 'primary',
      disabled: false,
      tooltipKey: 'libraryAction.publishTooltip',
      trigger: 'publish',
    };
  }

  if (controller.hasOpenUpdate) {
    return {
      kind: 'pullUpdate',
      variant: 'button',
      labelKey: 'libraryAction.pullUpdate',
      color: 'info',
      disabled: speciesPending,
      tooltipKey: frozenTooltipKey ?? 'libraryAction.pullUpdateTooltip',
      trigger: speciesPending ? null : 'diff',
    };
  }

  if (controller.isRejected) {
    return {
      kind: 'updateRejected',
      variant: 'chip',
      labelKey: 'publicUpdate.markerRejectedLabel',
      color: 'default',
      disabled: speciesPending,
      tooltipKey: frozenTooltipKey ?? 'publicUpdate.markerRejectedTooltip',
      trigger: speciesPending ? null : 'diff',
    };
  }

  if (crop?.public_publish_blocked_reason == null && crop?.public_change_proposal_pending) {
    return {
      kind: 'proposalPending',
      variant: 'chip',
      labelKey: 'libraryAction.proposalPending',
      color: 'default',
      disabled: false,
      tooltipKey: 'libraryAction.proposalPendingTooltip',
      trigger: null,
    };
  }

  if (crop?.public_publish_blocked_reason == null) {
    return {
      kind: 'pushUpdate',
      variant: 'button',
      labelKey: 'libraryAction.pushUpdate',
      color: 'primary',
      disabled: speciesPending,
      tooltipKey: frozenTooltipKey ?? 'libraryAction.pushUpdateTooltip',
      trigger: speciesPending ? null : 'publish',
    };
  }

  return {
    kind: 'upToDate',
    variant: 'chip',
    labelKey: 'publicUpdate.markerUpToDateLabel',
    color: 'info',
    disabled: false,
    tooltipKey: 'publicUpdate.markerUpToDateTooltip',
    trigger: null,
  };
}

/** How the crop list's compact status icon presents a resolved action. */
export type CropLibraryStatusVisual =
  | 'notLinked'
  | 'upToDate'
  | 'push'
  | 'pull'
  | 'rejected'
  | 'pending';

/** A species under moderation freezes every action it touches into one "pending" look. */
export function resolveCropLibraryStatusVisual(action: CropLibraryAction): CropLibraryStatusVisual {
  if (action.disabled) {
    return 'pending';
  }
  switch (action.kind) {
    case 'publish':
      return 'notLinked';
    case 'pullUpdate':
      return 'pull';
    case 'pushUpdate':
      return 'push';
    case 'updateRejected':
      return 'rejected';
    case 'proposalPending':
      return 'pending';
    case 'upToDate':
      return 'upToDate';
  }
}

/**
 * Whether "Verknüpfung aufheben" is offered: the crop syncs with a public
 * entry the user did not publish. A link to the user's own entry is not
 * removable — withdrawing the entry is the path there, and an unlinked copy
 * would collide with that entry on its next publish.
 */
export function canUnlinkPublicCrop(crop: Crop | null | undefined): boolean {
  if (!crop?.source_public_crop) return false;
  const ownsLinkedEntry = crop.owned_public_crop_id === crop.source_public_crop
    && crop.owned_public_crop_role === 'contributor';
  return !ownsLinkedEntry;
}
