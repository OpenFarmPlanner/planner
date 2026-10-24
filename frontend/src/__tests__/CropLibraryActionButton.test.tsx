import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CropLibraryActionButton } from '../crops/CropLibraryActionButton';
import { usePublicCropUpdate } from '../crops/usePublicCropUpdate';
import type { Crop } from '../api/types';
import i18n from '../i18n/config';

const apiMocks = vi.hoisted(() => ({ publicUpdate: vi.fn() }));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    cropAPI: { ...actual.cropAPI, publicUpdate: apiMocks.publicUpdate },
  };
});

function Harness({ crop, onPublish, isPublishing = false }: {
  crop: Crop;
  onPublish: () => void;
  isPublishing?: boolean;
}) {
  const controller = usePublicCropUpdate(crop);
  return (
    <CropLibraryActionButton
      crop={crop}
      controller={controller}
      onPublish={onPublish}
      isPublishing={isPublishing}
    />
  );
}

const baseCrop: Crop = { id: 1, name: 'Tomate', variety: 'Roma', is_modified_from_source: false };

describe('CropLibraryActionButton', () => {
  beforeEach(async () => {
    apiMocks.publicUpdate.mockReset();
    apiMocks.publicUpdate.mockResolvedValue({ data: { available: true, public_crop_id: 9, public_version: 2, changes: [] } });
    await i18n.changeLanguage('de');
  });

  it('opens the publishing wizard for an unlinked crop', () => {
    const onPublish = vi.fn();
    render(<Harness crop={{ ...baseCrop, crop_species: 3 }} onPublish={onPublish} />);

    fireEvent.click(screen.getByRole('button', { name: 'In Bibliothek teilen' }));
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(apiMocks.publicUpdate).not.toHaveBeenCalled();
  });

  it('opens the pull diff when the library is ahead', () => {
    render(
      <Harness
        crop={{ ...baseCrop, source_public_crop: 9, public_update_available: true }}
        onPublish={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Kultur aktualisieren' }));
    expect(apiMocks.publicUpdate).toHaveBeenCalledTimes(1);
  });

  it('opens the publishing wizard for a push (own entry with local changes)', () => {
    const onPublish = vi.fn();
    render(
      <Harness
        crop={{
          ...baseCrop,
          owned_public_crop_id: 9,
          owned_public_crop_role: 'contributor',
          public_publish_blocked_reason: null,
        }}
        onPublish={onPublish}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Bibliothek aktualisieren' }));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('renders a plain "Aktuell" status chip, not a button, when there is nothing to do', async () => {
    const onPublish = vi.fn();
    render(
      <Harness
        crop={{ ...baseCrop, source_public_crop: 9, public_publish_blocked_reason: 'no_local_changes' }}
        onPublish={onPublish}
      />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    const chip = screen.getByTestId('crop-detail-library-status');
    expect(chip).toHaveTextContent('Aktuell');

    fireEvent.mouseOver(chip);
    expect(await screen.findByRole('tooltip', {}, { timeout: 4000 }))
      .toHaveTextContent('Diese Kultur entspricht dem aktuellen Stand in der Kulturbibliothek.');
    expect(onPublish).not.toHaveBeenCalled();
    expect(apiMocks.publicUpdate).not.toHaveBeenCalled();
  });

  it('keeps "Aktuell" for pinned differences and lists the pinned fields in its tooltip', async () => {
    render(
      <Harness
        crop={{
          ...baseCrop,
          source_public_crop: 9,
          public_publish_blocked_reason: 'no_local_changes',
          library_pinned_fields: ['growth_duration_days'],
        }}
        onPublish={vi.fn()}
      />,
    );

    const chip = screen.getByTestId('crop-detail-library-status');
    expect(chip).toHaveTextContent('Aktuell');
    fireEvent.mouseOver(chip);
    expect(await screen.findByRole('tooltip', {}, { timeout: 4000 }))
      .toHaveTextContent('Lokal fixiert: Wachstumszeit (Tage).');
  });

  it('replaces the pull button with a clickable "Update abgelehnt" chip after a decline', async () => {
    const onPublish = vi.fn();
    render(
      <Harness
        crop={{
          ...baseCrop,
          source_public_crop: 9,
          owned_public_crop_id: 9,
          owned_public_crop_role: 'contributor',
          public_update_available: false,
          public_update_rejected: true,
          public_publish_blocked_reason: 'update_rejected',
        }}
        onPublish={onPublish}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Kultur aktualisieren' })).not.toBeInTheDocument();
    const chip = screen.getByTestId('crop-detail-library-status');
    expect(chip).toHaveTextContent('Update abgelehnt');

    // The decision is not a dead end: the same diff reopens from the chip.
    fireEvent.click(chip);
    expect(apiMocks.publicUpdate).toHaveBeenCalledTimes(1);
    expect(onPublish).not.toHaveBeenCalled();
  });

  it('keeps the declined chip focused and single-shot while the diff loads', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    apiMocks.publicUpdate.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    render(
      <Harness
        crop={{
          ...baseCrop,
          source_public_crop: 9,
          public_update_rejected: true,
          public_publish_blocked_reason: 'update_rejected',
        }}
        onPublish={vi.fn()}
      />,
    );

    const chip = screen.getByTestId('crop-detail-library-status');
    chip.focus();
    fireEvent.click(chip);
    // The chip must survive its own click: a remount would drop focus and
    // strand the tooltip.
    expect(screen.getByTestId('crop-detail-library-status')).toBe(chip);
    expect(chip).toHaveFocus();
    expect(chip.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();

    fireEvent.click(chip);
    expect(apiMocks.publicUpdate).toHaveBeenCalledTimes(1);

    resolveRequest?.({ data: { available: true, public_crop_id: 9, public_version: 2, changes: [] } });
    await waitFor(() => {
      expect(chip.querySelector('.MuiCircularProgress-root')).not.toBeInTheDocument();
    });
  });

  it('greys the declined chip out and swallows nothing while the species is under review', () => {
    render(
      <Harness
        crop={{
          ...baseCrop,
          source_public_crop: 9,
          public_update_rejected: true,
          public_crop_species_pending: true,
        }}
        onPublish={vi.fn()}
      />,
    );

    const chip = screen.getByTestId('crop-detail-library-status');
    expect(chip).toHaveClass('Mui-disabled');
    fireEvent.click(chip);
    expect(apiMocks.publicUpdate).not.toHaveBeenCalled();
    expect(chip.parentElement).toHaveAttribute(
      'aria-label',
      'Diese Funktion ist erst verfügbar, sobald der Kulturart-Vorschlag von einem Moderator geprüft wurde.',
    );
  });

  it('disables itself with the moderation tooltip while the species is under review', () => {
    render(
      <Harness
        crop={{
          ...baseCrop,
          source_public_crop: 9,
          public_update_available: true,
          public_crop_species_pending: true,
        }}
        onPublish={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: 'Kultur aktualisieren' });
    expect(button).toBeDisabled();
    expect(button.parentElement).toHaveAttribute(
      'aria-label',
      'Diese Funktion ist erst verfügbar, sobald der Kulturart-Vorschlag von einem Moderator geprüft wurde.',
    );
  });

  it('shows a spinner while a push is in flight', () => {
    render(
      <Harness
        crop={{
          ...baseCrop,
          owned_public_crop_id: 9,
          owned_public_crop_role: 'contributor',
          public_publish_blocked_reason: null,
        }}
        onPublish={vi.fn()}
        isPublishing
      />,
    );

    const button = screen.getByRole('button', { name: 'Bibliothek aktualisieren' });
    expect(button).toBeDisabled();
    expect(button.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
  });
});
