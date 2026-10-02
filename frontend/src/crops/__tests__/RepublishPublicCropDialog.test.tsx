import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Crop } from '../../api/types';
import { RepublishPublicCropDialog } from '../RepublishPublicCropDialog';

// The species field searches the (mocked) server with a real debounce.
configure({ asyncUtilTimeout: 3000 });

const { publishPreviewMock, cropSpeciesListMock } = vi.hoisted(() => ({
  publishPreviewMock: vi.fn(),
  cropSpeciesListMock: vi.fn(),
}));

vi.mock('../../api/api', async () => {
  const actual = await vi.importActual<typeof import('../../api/api')>('../../api/api');
  return {
    ...actual,
    cropAPI: { ...actual.cropAPI, publishPreview: publishPreviewMock },
    cropSpeciesAPI: { ...actual.cropSpeciesAPI, list: cropSpeciesListMock },
  };
});

const CROP: Crop = {
  id: 7,
  name: 'Lauchzwiebel',
  variety: 'Ishikura',
  crop_species: 12,
  growth_duration_days: 70,
  harvest_duration_days: 30,
};

const previewWith = (blockingReasons: string[]) => ({
  data: {
    crop_species: blockingReasons.length ? null : { id: 12, name: 'Lauchzwiebel' },
    original_language_code: 'de',
    available_language_codes: ['de'],
    missing_required_fields: [],
    duplicates: [],
    can_publish: blockingReasons.length === 0,
    blocking_reasons: blockingReasons,
    general_crop_notice: null,
  },
});

const renderDialog = (onConfirm = vi.fn()) => {
  render(
    <RepublishPublicCropDialog
      open
      crop={CROP}
      originalLanguageCode="de"
      publishAsGeneral={false}
      onCancel={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
};

const confirmButton = () => screen.getByRole('button', { name: 'Wieder veröffentlichen' });

describe('RepublishPublicCropDialog', () => {
  beforeEach(() => {
    publishPreviewMock.mockReset();
    cropSpeciesListMock.mockReset();
    cropSpeciesListMock.mockResolvedValue({
      data: { count: 1, next: null, previous: null, results: [{ id: 31, name: 'Lauchzwiebel', status: 'published' }] },
    });
  });

  it('confirms with the crop’s own species when it is still publishable', async () => {
    publishPreviewMock.mockResolvedValue(previewWith([]));
    const onConfirm = renderDialog();

    await waitFor(() => expect(confirmButton()).toBeEnabled());
    expect(publishPreviewMock).toHaveBeenCalledWith(CROP.id, { original_language_code: 'de' });
    expect(screen.queryByLabelText(/Offizielle Kulturart/i)).not.toBeInTheDocument();

    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith({});
  });

  it('requires an official crop species when the linked one is no longer available', async () => {
    publishPreviewMock.mockResolvedValue(previewWith(['crop_species_unavailable']));
    const onConfirm = renderDialog();

    const speciesInput = await screen.findByLabelText(/Offizielle Kulturart/i);
    expect(speciesInput).toBeRequired();
    // Prefilled with the crop's own name, like the publishing wizard.
    await waitFor(() => expect(speciesInput).toHaveValue('Lauchzwiebel'));
    expect(confirmButton()).toBeDisabled();

    fireEvent.click(await screen.findByRole('option', { name: 'Lauchzwiebel' }));
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    fireEvent.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledWith({ cropSpeciesId: 31 });
  });

  it('does not block the republish when the pre-check itself fails', async () => {
    publishPreviewMock.mockRejectedValue(new Error('offline'));
    renderDialog();

    expect(await screen.findByText(/konnte nicht geprüft werden/)).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
  });
});
