import { describe, expect, it } from 'vitest';
import type { Crop } from '../api/types';
import {
  canUnlinkPublicCrop,
  resolveCropLibraryAction,
  resolveCropLibraryStatusVisual,
} from '../crops/cropLibraryAction';

const openUpdate = { hasOpenUpdate: true, isRejected: false };
const rejectedUpdate = { hasOpenUpdate: false, isRejected: true };
const inSync = { hasOpenUpdate: false, isRejected: false };

const crop = (over: Partial<Crop> = {}): Crop => ({
  name: 'Tomate',
  variety: 'Roma',
  is_modified_from_source: false,
  ...over,
});

describe('resolveCropLibraryAction', () => {
  it('state 2c: an own proposal under review replaces the push with a status chip', () => {
    const action = resolveCropLibraryAction(
      crop({
        source_public_crop: 9,
        is_modified_from_source: true,
        public_publish_blocked_reason: null,
        public_change_proposal_pending: true,
      }),
      inSync,
    );
    expect(action).toMatchObject({
      kind: 'proposalPending',
      variant: 'chip',
      labelKey: 'libraryAction.proposalPending',
      tooltipKey: 'libraryAction.proposalPendingTooltip',
      disabled: false,
      trigger: null,
    });
    expect(resolveCropLibraryStatusVisual(action)).toBe('pending');
  });

  it('a pending proposal does not hide a newer library version to pull', () => {
    const action = resolveCropLibraryAction(
      crop({ source_public_crop: 9, public_update_available: true, public_change_proposal_pending: true }),
      openUpdate,
    );
    expect(action.kind).toBe('pullUpdate');
  });

  it('resolves to "Aktuell" after a sync left nothing to pull or push', () => {
    // What `public-sync` returns once every difference was decided and pushed live.
    const action = resolveCropLibraryAction(
      crop({
        source_public_crop: 9,
        source_public_version: 7,
        is_modified_from_source: false,
        public_update_available: false,
        public_update_rejected: false,
        public_publish_blocked_reason: 'no_local_changes',
        public_change_proposal_pending: false,
      }),
    );
    expect(action).toMatchObject({ kind: 'upToDate', variant: 'chip' });
  });

  it('state 1: not linked to any public entry -> publish', () => {
    const action = resolveCropLibraryAction(crop({ crop_species: 3 }), inSync);
    expect(action).toMatchObject({
      kind: 'publish',
      labelKey: 'libraryAction.publish',
      color: 'primary',
      disabled: false,
      tooltipKey: 'libraryAction.publishTooltip',
      trigger: 'publish',
    });
  });

  it('state 2: library is ahead -> pull, blue, opens the diff', () => {
    const action = resolveCropLibraryAction(
      crop({ source_public_crop: 9, public_update_available: true }),
      openUpdate,
    );
    expect(action).toMatchObject({
      kind: 'pullUpdate',
      labelKey: 'libraryAction.pullUpdate',
      color: 'info',
      disabled: false,
      tooltipKey: 'libraryAction.pullUpdateTooltip',
      trigger: 'diff',
    });
  });

  it('state 2b: a declined version drops the button for a clickable status chip', () => {
    const action = resolveCropLibraryAction(
      crop({
        source_public_crop: 9,
        owned_public_crop_id: 9,
        owned_public_crop_role: 'contributor',
        public_update_available: false,
        public_update_rejected: true,
        public_publish_blocked_reason: 'update_rejected',
      }),
      rejectedUpdate,
    );
    expect(action).toMatchObject({
      kind: 'updateRejected',
      variant: 'chip',
      labelKey: 'publicUpdate.markerRejectedLabel',
      color: 'default',
      disabled: false,
      tooltipKey: 'publicUpdate.markerRejectedTooltip',
      trigger: 'diff',
    });
  });

  it('state 2b wins over a push offer, so a decline is never silently undone', () => {
    // An imported (not owned) copy reports no publish block, which would
    // otherwise offer "Bibliothek aktualisieren" right after a decline.
    const action = resolveCropLibraryAction(
      crop({
        source_public_crop: 9,
        owned_public_crop_role: null,
        is_modified_from_source: true,
        public_update_available: false,
        public_update_rejected: true,
        public_publish_blocked_reason: null,
      }),
      rejectedUpdate,
    );
    expect(action.kind).toBe('updateRejected');
  });

  it('state 2: a new public version after a decline brings the pull button back', () => {
    const action = resolveCropLibraryAction(
      crop({
        source_public_crop: 9,
        public_update_available: true,
        public_update_rejected: false,
      }),
      openUpdate,
    );
    expect(action).toMatchObject({ kind: 'pullUpdate', variant: 'button', trigger: 'diff' });
  });

  it('freezes the declined chip into an inert one while the species is under review', () => {
    const action = resolveCropLibraryAction(
      crop({
        source_public_crop: 9,
        public_update_rejected: true,
        public_crop_species_pending: true,
      }),
      rejectedUpdate,
    );
    expect(action).toMatchObject({
      kind: 'updateRejected',
      disabled: true,
      tooltipKey: 'badges.speciesPendingTooltip',
      trigger: null,
    });
  });

  it('state 2 wins over a push offer: local changes AND library ahead -> pull', () => {
    const action = resolveCropLibraryAction(
      crop({
        owned_public_crop_id: 9,
        owned_public_crop_role: 'contributor',
        public_update_available: true,
        public_publish_blocked_reason: null,
        is_modified_from_source: true,
      }),
      openUpdate,
    );
    expect(action.kind).toBe('pullUpdate');
  });

  it('state 3: own entry with local changes -> push, green', () => {
    const action = resolveCropLibraryAction(
      crop({
        owned_public_crop_id: 9,
        owned_public_crop_role: 'contributor',
        public_publish_blocked_reason: null,
      }),
      inSync,
    );
    expect(action).toMatchObject({
      kind: 'pushUpdate',
      labelKey: 'libraryAction.pushUpdate',
      color: 'primary',
      disabled: false,
      tooltipKey: 'libraryAction.pushUpdateTooltip',
      trigger: 'publish',
    });
  });

  it('state 4: imported (not owned) with local changes -> same push', () => {
    const action = resolveCropLibraryAction(
      crop({
        source_public_crop: 9,
        owned_public_crop_role: null,
        is_modified_from_source: true,
        public_publish_blocked_reason: null,
      }),
      inSync,
    );
    expect(action).toMatchObject({ kind: 'pushUpdate', trigger: 'publish', color: 'primary' });
  });

  it('state 5: linked, nothing pending, nothing to contribute -> "Aktuell" status', () => {
    const action = resolveCropLibraryAction(
      crop({
        source_public_crop: 9,
        public_publish_blocked_reason: 'no_local_changes',
      }),
      inSync,
    );
    expect(action).toMatchObject({
      kind: 'upToDate',
      labelKey: 'publicUpdate.markerUpToDateLabel',
      tooltipKey: 'publicUpdate.markerUpToDateTooltip',
      trigger: null,
      // A passive status, not a disabled control: nothing is greyed out.
      disabled: false,
    });
  });

  it('state 5: an imported copy that matches its source (version-only bump) -> "Aktuell"', () => {
    // The backend reports no_local_changes for an imported, not-owned copy
    // whose content equals its public source, and does not flag an update for
    // a bump with no compared-field change.
    const action = resolveCropLibraryAction(
      crop({
        source_public_crop: 9,
        is_modified_from_source: true,
        public_update_available: false,
        public_publish_blocked_reason: 'no_local_changes',
      }),
      inSync,
    );
    expect(action.kind).toBe('upToDate');
    expect(action.trigger).toBeNull();
  });

  it('freezes the button while the crop species is still under moderation', () => {
    const pull = resolveCropLibraryAction(
      crop({ source_public_crop: 9, public_update_available: true, public_crop_species_pending: true }),
      openUpdate,
    );
    expect(pull).toMatchObject({
      kind: 'pullUpdate',
      disabled: true,
      tooltipKey: 'badges.speciesPendingTooltip',
      trigger: null,
    });

    const push = resolveCropLibraryAction(
      crop({
        owned_public_crop_id: 9,
        owned_public_crop_role: 'contributor',
        public_publish_blocked_reason: null,
        public_crop_species_pending: true,
      }),
      inSync,
    );
    expect(push).toMatchObject({ kind: 'pushUpdate', disabled: true, trigger: null });
  });
});

describe('unpublished linked entry', () => {
  it.each([
    ['entry_withdrawn', 'entryWithdrawn', 'libraryAction.entryWithdrawn'],
    ['entry_removed', 'entryRemoved', 'libraryAction.entryRemoved'],
  ] as const)('%s ranks before push and pull as a bare status chip', (reason, kind, labelKey) => {
    const action = resolveCropLibraryAction(
      crop({ source_public_crop: 9, public_publish_blocked_reason: reason, is_modified_from_source: true }),
      openUpdate,
    );
    expect(action).toMatchObject({
      kind,
      variant: 'chip',
      labelKey,
      tooltipKey: 'libraryAction.entryUnavailableTooltip',
      trigger: null,
      disabled: false,
    });
    expect(resolveCropLibraryStatusVisual(action)).toBe('unavailable');
  });
});

describe('canUnlinkPublicCrop', () => {
  it('follows the backend flag and nothing else', () => {
    expect(canUnlinkPublicCrop(crop({ source_public_crop: 9, can_unlink_public_crop: true }))).toBe(true);
    expect(canUnlinkPublicCrop(crop({
      source_public_crop: 9,
      can_unlink_public_crop: false,
      unlink_public_crop_blocked_reason: 'crop_link_owned',
    }))).toBe(false);
    expect(canUnlinkPublicCrop(crop({ source_public_crop: 9 }))).toBe(false);
    expect(canUnlinkPublicCrop(null)).toBe(false);
  });

  it('an unlinked crop resolves to "In Bibliothek teilen" again', () => {
    const unlinked = crop({
      source_public_crop: null,
      source_public_version: null,
      derived_from_public_crop: 9,
      origin_type: 'imported',
      public_publish_blocked_reason: null,
    });
    expect(resolveCropLibraryAction(unlinked)).toMatchObject({ kind: 'publish', trigger: 'publish' });
  });
});
