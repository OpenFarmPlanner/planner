import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CropDetail } from '../crops/CropDetail';
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

const localCrop: Crop = {
  id: 1,
  name: 'Tomate',
  variety: 'Matina',
  origin_type: 'manual',
  crop_species: 3,
  is_modified_from_source: false,
  growth_duration_days: 60,
  harvest_duration_days: 30,
};

const importedInSync: Crop = {
  id: 2,
  name: 'Salat',
  variety: 'Bijella',
  origin_type: 'imported',
  source_public_crop: 12,
  is_modified_from_source: false,
  public_update_available: false,
  public_publish_blocked_reason: 'no_local_changes',
  growth_duration_days: 45,
  harvest_duration_days: 21,
};

const importedDiverged: Crop = {
  ...importedInSync,
  id: 3,
  is_modified_from_source: true,
  public_update_available: true,
  public_publish_blocked_reason: 'update_pending',
};

const renderDetail = (crop: Crop, { withPublishHandler = true } = {}) =>
  render(
    <CropDetail
      crops={[crop]}
      selectedCropId={crop.id}
      onCropSelect={() => {}}
      onPublishCrop={withPublishHandler ? vi.fn() : undefined}
    />,
    { wrapper: MemoryRouter },
  );

describe('CropDetail library badge row', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  it('shows the "Importiert" badge only for imported crops', () => {
    renderDetail(importedInSync);
    expect(screen.getByText('Importiert')).toBeInTheDocument();
  });

  it('renders no "Lokal", "Veröffentlicht" or "Lokal geändert" badge and no sync marker', () => {
    renderDetail(importedDiverged);
    expect(screen.queryByText('Lokal')).not.toBeInTheDocument();
    expect(screen.queryByText('Veröffentlicht')).not.toBeInTheDocument();
    expect(screen.queryByText('Lokal geändert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('crop-public-update-marker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('crop-public-update-notice')).not.toBeInTheDocument();
  });

  it('shows the publish action for an unlinked crop', () => {
    renderDetail(localCrop);
    const button = screen.getByRole('button', { name: 'In Bibliothek teilen' });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('data-action-kind', 'publish');
  });

  it('shows a blue "Kultur aktualisieren" button when the library is ahead', () => {
    renderDetail(importedDiverged);
    const button = screen.getByRole('button', { name: 'Kultur aktualisieren' });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('data-action-kind', 'pullUpdate');
    expect(button.className).toMatch(/MuiButton-(outlined)?[Cc]olorInfo/);
  });

  it('shows an "Aktuell" status chip (no button, no dialog) when there is nothing to do', async () => {
    renderDetail(importedInSync);
    expect(screen.queryByRole('button', { name: /veröffentlichen|aktualisieren/i })).not.toBeInTheDocument();

    const chip = screen.getByTestId('crop-detail-library-status');
    expect(chip).toHaveTextContent('Aktuell');

    fireEvent.mouseOver(chip);
    expect(await screen.findByRole('tooltip', {}, { timeout: 4000 }))
      .toHaveTextContent('Diese Kultur entspricht dem aktuellen Stand in der Kulturbibliothek.');
  });

  it('does not render the action button when no publish handler is wired', () => {
    renderDetail(localCrop, { withPublishHandler: false });
    expect(screen.queryByRole('button', {
      name: /veröffentlichen|aktualisieren/i,
    })).not.toBeInTheDocument();
  });

  it('marks a variety published under an unreviewed crop species as pending', () => {
    renderDetail({ ...importedInSync, public_crop_species_pending: true });
    expect(screen.getByText('Vorschlag in Prüfung')).toBeInTheDocument();
  });

  it('shows the imported badge hover tooltip', async () => {
    renderDetail(importedInSync);
    fireEvent.mouseOver(screen.getByText('Importiert'));
    expect(await screen.findByRole('tooltip', {}, { timeout: 4000 }))
      .toHaveTextContent('Diese Kultur wurde aus der öffentlichen Kulturbibliothek importiert.');
  });
});

describe('CropDetail list library status icons', () => {
  const tomatoSibling: Crop = {
    ...localCrop,
    id: 4,
    variety: 'Roma',
    source_public_crop: 12,
    public_update_available: true,
    public_publish_blocked_reason: 'update_pending',
  };

  function SelectionHarness({ crops, initialId, onPublishCrop }: {
    crops: Crop[];
    initialId: number;
    onPublishCrop: () => void;
  }) {
    const [selectedCropId, setSelectedCropId] = useState(initialId);
    return (
      <CropDetail
        crops={crops}
        selectedCropId={selectedCropId}
        onCropSelect={(crop) => setSelectedCropId(crop?.id ?? initialId)}
        onPublishCrop={onPublishCrop}
      />
    );
  }

  const rowIcon = (varietyName: string) => within(
    screen.getByRole('option', { name: new RegExp(varietyName) }),
  ).getByTestId('crop-list-library-status');

  beforeEach(async () => {
    apiMocks.publicUpdate.mockReset();
    apiMocks.publicUpdate.mockResolvedValue({
      data: { available: true, public_crop_id: 12, public_version: 2, changes: [] },
    });
    await i18n.changeLanguage('de');
  });

  it('shows one status icon per crop row, reflecting each crop\'s own state', () => {
    render(
      <SelectionHarness crops={[localCrop, tomatoSibling]} initialId={localCrop.id!} onPublishCrop={vi.fn()} />,
      { wrapper: MemoryRouter },
    );

    expect(rowIcon('Matina')).toHaveAttribute('data-status', 'notLinked');
    expect(rowIcon('Roma')).toHaveAttribute('data-status', 'pull');
  });

  it('opens the publishing wizard straight away for the selected row', () => {
    const onPublishCrop = vi.fn();
    render(
      <SelectionHarness crops={[localCrop, tomatoSibling]} initialId={localCrop.id!} onPublishCrop={onPublishCrop} />,
      { wrapper: MemoryRouter },
    );

    fireEvent.click(rowIcon('Matina'));
    expect(onPublishCrop).toHaveBeenCalledTimes(1);
  });

  it('does not reopen the publishing wizard while the selected crop is being published', () => {
    const onPublishCrop = vi.fn();
    render(
      <CropDetail
        crops={[localCrop, tomatoSibling]}
        selectedCropId={localCrop.id!}
        onCropSelect={vi.fn()}
        onPublishCrop={onPublishCrop}
        isPublishingCrop
      />,
      { wrapper: MemoryRouter },
    );

    fireEvent.click(rowIcon('Matina'));
    expect(onPublishCrop).not.toHaveBeenCalled();
  });

  it('selects another row first, then opens that crop\'s pull diff', async () => {
    const onPublishCrop = vi.fn();
    render(
      <SelectionHarness crops={[localCrop, tomatoSibling]} initialId={localCrop.id!} onPublishCrop={onPublishCrop} />,
      { wrapper: MemoryRouter },
    );

    fireEvent.click(rowIcon('Roma'));

    await waitFor(() => expect(apiMocks.publicUpdate).toHaveBeenCalledWith(tomatoSibling.id));
    expect(onPublishCrop).not.toHaveBeenCalled();
    // The open diff dialog hides the page behind it from the accessibility tree.
    expect(screen.getByRole('option', { name: /Roma/, hidden: true })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders no list icons when no publish handler is wired', () => {
    renderDetail(localCrop, { withPublishHandler: false });
    expect(screen.queryByTestId('crop-list-library-status')).not.toBeInTheDocument();
  });
});
