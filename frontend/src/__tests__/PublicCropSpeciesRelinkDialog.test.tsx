import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PublicCropSpeciesRelinkDialog } from '../crop-library/components/PublicCropSpeciesRelinkDialog';
import type { PublicCrop } from '../api/types';

const {
  cropSpeciesListMock,
  cropSpeciesProposeMock,
  relinkSpeciesMock,
} = vi.hoisted(() => ({
  cropSpeciesListMock: vi.fn(),
  cropSpeciesProposeMock: vi.fn(),
  relinkSpeciesMock: vi.fn(),
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    cropSpeciesAPI: {
      ...actual.cropSpeciesAPI,
      list: cropSpeciesListMock,
      propose: cropSpeciesProposeMock,
    },
    publicCropAPI: {
      ...actual.publicCropAPI,
      relinkSpecies: relinkSpeciesMock,
    },
  };
});

const CROP = {
  id: 7,
  name: 'Bohne',
  variety: 'Neckarkönigin',
  display_name: 'Bohne',
  crop_species: 1,
  crop_species_name: 'Bohne',
} as PublicCrop;

const renderDialog = (onRelinked = vi.fn(), varietyEditable = true) => {
  render(
    <PublicCropSpeciesRelinkDialog
      open
      crop={CROP}
      onClose={vi.fn()}
      onRelinked={onRelinked}
      varietyEditable={varietyEditable}
    />,
  );
  return onRelinked;
};

const pickSpecies = async (typed: string, optionName: RegExp) => {
  const user = userEvent.setup();
  const field = await screen.findByLabelText(/Offizielle Kulturart/i);
  await user.click(field);
  // The field is preselected with the entry's current species, so it has to
  // be cleared before typing a replacement search term.
  await user.clear(field);
  await user.type(field, typed);
  await user.click(await screen.findByRole('option', { name: optionName }));
  return user;
};

describe('PublicCropSpeciesRelinkDialog', () => {
  beforeEach(() => {
    cropSpeciesListMock.mockReset();
    cropSpeciesListMock.mockResolvedValue({
      data: {
        count: 2,
        next: null,
        previous: null,
        results: [
          { id: 1, name: 'Bohne', status: 'published' },
          { id: 2, name: 'Feuerbohne', status: 'published' },
        ],
      },
    });
    cropSpeciesProposeMock.mockReset();
    relinkSpeciesMock.mockReset();
    relinkSpeciesMock.mockResolvedValue({
      data: { relink_status: 'relinked', crop: { ...CROP, crop_species: 2 }, relink_request: null },
    });
  });

  it('shows the entry’s current crop species so the correction is made in context', async () => {
    renderDialog();

    expect(await screen.findByText(/Bisherige Kulturart/)).toBeInTheDocument();
  });

  it('relinks to an already published species', async () => {
    const onRelinked = renderDialog();

    const user = await pickSpecies('Feuer', /Feuerbohne/);
    await user.click(screen.getByRole('button', { name: 'Kulturart ändern' }));

    // The variety field is preselected with the entry's current variety and
    // was not touched, so it rides along unchanged.
    await waitFor(() => expect(relinkSpeciesMock).toHaveBeenCalledWith(7, 2, { variety: 'Neckarkönigin' }));
    expect(onRelinked).toHaveBeenCalledWith(
      expect.objectContaining({ relink_status: 'relinked' }),
      'Feuerbohne',
    );
  });

  it('sends an edited variety alongside the species correction', async () => {
    renderDialog();

    const user = await pickSpecies('Feuer', /Feuerbohne/);
    const varietyField = screen.getByLabelText('Sorte');
    await user.clear(varietyField);
    await user.type(varietyField, 'Neckarkönigin (Busch)');
    await user.click(screen.getByRole('button', { name: 'Kulturart ändern' }));

    await waitFor(() => expect(relinkSpeciesMock).toHaveBeenCalledWith(
      7, 2, { variety: 'Neckarkönigin (Busch)' },
    ));
  });

  it('disables the variety field and omits it from the payload for a non-admin moderator', async () => {
    renderDialog(vi.fn(), false);

    const varietyField = screen.getByLabelText('Sorte');
    expect(varietyField).toBeDisabled();

    const user = await pickSpecies('Feuer', /Feuerbohne/);
    await user.click(screen.getByRole('button', { name: 'Kulturart ändern' }));

    await waitFor(() => expect(relinkSpeciesMock).toHaveBeenCalledWith(7, 2, undefined));
  });

  it('files a species proposal through the existing propose flow when the target does not exist yet', async () => {
    cropSpeciesProposeMock.mockResolvedValue({ data: { id: 9, name: 'Stangenbohne', status: 'proposed' } });
    relinkSpeciesMock.mockResolvedValue({
      data: {
        relink_status: 'pending_species_proposal',
        crop: CROP,
        relink_request: { id: 3, status: 'pending' },
      },
    });
    const onRelinked = renderDialog();

    const user = await pickSpecies('Stangenbohne', /als neue Kulturart vorschlagen/);
    await user.click(screen.getByRole('button', { name: /Kulturart vorschlagen und übernehmen/ }));

    await waitFor(() => expect(cropSpeciesProposeMock).toHaveBeenCalled());
    expect(cropSpeciesProposeMock.mock.calls[0][0]).toBe('Stangenbohne');
    await waitFor(() => expect(relinkSpeciesMock).toHaveBeenCalledWith(7, 9, { variety: 'Neckarkönigin' }));
    expect(onRelinked).toHaveBeenCalledWith(
      expect.objectContaining({ relink_status: 'pending_species_proposal' }),
      'Stangenbohne',
    );
  });

  it('says the proposal was filed when only the relink call failed, so the retry reuses it', async () => {
    cropSpeciesProposeMock.mockResolvedValue({ data: { id: 9, name: 'Stangenbohne', status: 'proposed' } });
    relinkSpeciesMock.mockRejectedValue(new Error('network'));
    renderDialog();

    const user = await pickSpecies('Stangenbohne', /als neue Kulturart vorschlagen/);
    await user.click(screen.getByRole('button', { name: /Kulturart vorschlagen und übernehmen/ }));

    expect(await screen.findByText(/Vorschlag bleibt ausgewählt/)).toBeInTheDocument();
    // Retrying must not file the proposal a second time.
    await user.click(screen.getByRole('button', { name: 'Kulturart ändern' }));
    await waitFor(() => expect(relinkSpeciesMock).toHaveBeenCalledTimes(2));
    expect(cropSpeciesProposeMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces the identity conflict inline instead of closing the dialog', async () => {
    relinkSpeciesMock.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { code: 'public_crop_variety_conflict' } },
    });
    const onRelinked = renderDialog();

    const user = await pickSpecies('Feuer', /Feuerbohne/);
    await user.click(screen.getByRole('button', { name: 'Kulturart ändern' }));

    expect(
      await screen.findByText(/bereits einen veröffentlichten Eintrag mit dieser Sorte/),
    ).toBeInTheDocument();
    expect(onRelinked).not.toHaveBeenCalled();
  });
});
