import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CropLibraryStatusIcon } from '../crops/CropLibraryStatusIcon';
import type { Crop } from '../api/types';
import i18n from '../i18n/config';

const baseCrop: Crop = { id: 1, name: 'Tomate', variety: 'Roma', is_modified_from_source: false };

const PUBLISH_TOOLTIP = 'Diese Kultur zum ersten Mal in der gemeinschaftlichen Kulturbibliothek veröffentlichen.';
const PULL_TOOLTIP = 'Die Bibliothek hat eine neuere Version. Änderungen ansehen und in deine Projektkultur übernehmen.';
const PUSH_TOOLTIP = 'Deine lokalen Änderungen in die öffentliche Version in der Bibliothek übernehmen.';
const REJECTED_TOOLTIP_START = 'Du hast diese Version aus der Kulturbibliothek abgelehnt.';
const UP_TO_DATE_TOOLTIP = 'Diese Kultur entspricht dem aktuellen Stand in der Kulturbibliothek.';
const PENDING_TOOLTIP = 'Diese Funktion ist erst verfügbar, sobald der Kulturart-Vorschlag von einem Moderator geprüft wurde.';

const pullCrop: Crop = {
  ...baseCrop,
  source_public_crop: 9,
  public_update_available: true,
  public_publish_blocked_reason: 'update_pending',
};
const rejectedCrop: Crop = {
  ...baseCrop,
  source_public_crop: 9,
  public_update_rejected: true,
  public_publish_blocked_reason: 'update_rejected',
};
const pushCrop: Crop = {
  ...baseCrop,
  owned_public_crop_id: 9,
  owned_public_crop_role: 'contributor',
  public_publish_blocked_reason: null,
};
const upToDateCrop: Crop = {
  ...baseCrop,
  source_public_crop: 9,
  public_publish_blocked_reason: 'no_local_changes',
};

function renderIcon(crop: Crop) {
  const onActivate = vi.fn();
  render(<CropLibraryStatusIcon crop={crop} onActivate={onActivate} />);
  return { onActivate, icon: screen.getByTestId('crop-list-library-status') };
}

async function expectTooltip(element: HTMLElement, text: string) {
  fireEvent.mouseOver(element);
  expect(await screen.findByRole('tooltip', {}, { timeout: 4000 })).toHaveTextContent(text);
}

describe('CropLibraryStatusIcon', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  it.each([
    ['not linked', { ...baseCrop, crop_species: 3 }, 'notLinked', 'publish', PUBLISH_TOOLTIP, 'publish'],
    ['library ahead', pullCrop, 'pull', 'pullUpdate', PULL_TOOLTIP, 'diff'],
    ['update declined', rejectedCrop, 'rejected', 'updateRejected', REJECTED_TOOLTIP_START, 'diff'],
    ['local changes', pushCrop, 'push', 'pushUpdate', PUSH_TOOLTIP, 'publish'],
  ] as const)(
    '%s: clickable, with the detail button tooltip, opens the same dialog',
    async (_state, crop, status, kind, tooltip, trigger) => {
      const { onActivate, icon } = renderIcon(crop);

      expect(icon.tagName).toBe('BUTTON');
      expect(icon).toHaveAttribute('data-status', status);
      expect(icon).toHaveAttribute('data-action-kind', kind);
      expect(icon).toHaveAccessibleName(expect.stringContaining(tooltip));
      await expectTooltip(icon, tooltip);

      fireEvent.click(icon);
      expect(onActivate).toHaveBeenCalledTimes(1);
      expect(onActivate).toHaveBeenCalledWith(trigger);
    },
  );

  it('up to date: an inert check with the "Aktuell" tooltip, outside the tab order', async () => {
    const { onActivate, icon } = renderIcon(upToDateCrop);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(icon).toHaveAttribute('data-status', 'upToDate');
    expect(icon).toHaveAttribute('role', 'img');
    expect(icon).not.toHaveAttribute('tabindex');
    expect(icon).toHaveAccessibleName(UP_TO_DATE_TOOLTIP);
    await expectTooltip(icon, UP_TO_DATE_TOOLTIP);

    fireEvent.click(icon);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it.each([
    ['pull', pullCrop, 'pullUpdate'],
    ['push', pushCrop, 'pushUpdate'],
    ['declined update', rejectedCrop, 'updateRejected'],
  ] as const)(
    'species under moderation freezes the %s state: focusable, explained, not clickable',
    async (_state, crop, kind) => {
      const { onActivate, icon } = renderIcon({ ...crop, public_crop_species_pending: true });

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(icon).toHaveAttribute('data-status', 'pending');
      expect(icon).toHaveAttribute('data-action-kind', kind);
      expect(icon).toHaveAttribute('aria-disabled', 'true');
      expect(icon).toHaveAttribute('tabindex', '0');
      expect(icon).toHaveAccessibleName(PENDING_TOOLTIP);
      await expectTooltip(icon, PENDING_TOOLTIP);

      fireEvent.click(icon);
      expect(onActivate).not.toHaveBeenCalled();
    },
  );

  it('does not let a click reach the surrounding row', () => {
    const onRowClick = vi.fn();
    const onActivate = vi.fn();
    render(
      <div onClick={onRowClick}>
        <CropLibraryStatusIcon crop={pushCrop} onActivate={onActivate} />
      </div>,
    );

    fireEvent.click(screen.getByTestId('crop-list-library-status'));
    expect(onActivate).toHaveBeenCalledWith('publish');
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
