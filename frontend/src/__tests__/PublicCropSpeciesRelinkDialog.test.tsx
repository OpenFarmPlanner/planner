import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PublicCropSpeciesRelinkDialog } from '../crop-library/components/PublicCropSpeciesRelinkDialog';
import type { PublicCrop } from '../api/types';

const {
  cropSpeciesListMock,
  cropSpeciesProposeMock,
  cropSpeciesApproveMock,
  relinkSpeciesMock,
} = vi.hoisted(() => ({
  cropSpeciesListMock: vi.fn(),
  cropSpeciesProposeMock: vi.fn(),
  cropSpeciesApproveMock: vi.fn(),
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
      approve: cropSpeciesApproveMock,
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

const fillApprovalTranslations = async (user: ReturnType<typeof userEvent.setup>, de: string, en: string) => {
  const deField = screen.getByLabelText(/Deutscher Name/);
  await user.clear(deField);
  await user.type(deField, de);
  const enField = screen.getByLabelText(/Englischer Name/);
  await user.clear(enField);
  await user.type(enField, en);
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
    cropSpeciesApproveMock.mockReset();
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

  it('never shows the variety field for the species-level (general) entry, even for an admin', async () => {
    // A blank variety is the entry that IS the general/species-level default
    // (`find_general_public_crop` keys off exactly this) — not a Sorte
    // waiting to be named. Offering to fill one in here would silently turn
    // it into a named variety instead of correcting a mapping.
    const generalCrop = { ...CROP, variety: '' };
    render(
      <PublicCropSpeciesRelinkDialog
        open
        crop={generalCrop}
        onClose={vi.fn()}
        onRelinked={vi.fn()}
        varietyEditable
      />,
    );

    expect(await screen.findByText(/Bisherige Kulturart/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Sorte')).not.toBeInTheDocument();

    const user = await pickSpecies('Feuer', /Feuerbohne/);
    await user.click(screen.getByRole('button', { name: 'Kulturart ändern' }));

    await waitFor(() => expect(relinkSpeciesMock).toHaveBeenCalledWith(7, 2, undefined));
  });

  it('proposes, self-approves, and relinks a brand new species in one step', async () => {
    cropSpeciesProposeMock.mockResolvedValue({ data: { id: 9, name: 'Stangenbohne', status: 'proposed' } });
    cropSpeciesApproveMock.mockResolvedValue({ data: { id: 9, name: 'Stangenbohne', status: 'published' } });
    const onRelinked = renderDialog();

    const user = await pickSpecies('Stangenbohne', /als neue Kulturart vorschlagen/);
    // Only the current UI language is preseeded; the moderator still has to
    // consciously provide the other one before submitting is possible.
    expect(screen.getByRole('button', { name: /Kulturart anlegen, freigeben und übernehmen/ })).toBeDisabled();
    await fillApprovalTranslations(user, 'Stangenbohne', 'Pole bean');
    await user.click(screen.getByRole('button', { name: /Kulturart anlegen, freigeben und übernehmen/ }));

    await waitFor(() => expect(cropSpeciesProposeMock).toHaveBeenCalled());
    expect(cropSpeciesProposeMock.mock.calls[0][0]).toBe('Stangenbohne');
    await waitFor(() => expect(cropSpeciesApproveMock).toHaveBeenCalledWith(
      9,
      '',
      [
        { language_code: 'de', common_name: 'Stangenbohne' },
        { language_code: 'en', common_name: 'Pole bean' },
      ],
    ));
    await waitFor(() => expect(relinkSpeciesMock).toHaveBeenCalledWith(7, 9, { variety: 'Neckarkönigin' }));
    expect(onRelinked).toHaveBeenCalledWith(
      expect.objectContaining({ relink_status: 'relinked' }),
      'Stangenbohne',
    );
  });

  it('reuses the already-approved species on retry after the relink call failed', async () => {
    cropSpeciesProposeMock.mockResolvedValue({ data: { id: 9, name: 'Stangenbohne', status: 'proposed' } });
    cropSpeciesApproveMock.mockResolvedValue({ data: { id: 9, name: 'Stangenbohne', status: 'published' } });
    relinkSpeciesMock.mockRejectedValueOnce(new Error('network'));
    renderDialog();

    const user = await pickSpecies('Stangenbohne', /als neue Kulturart vorschlagen/);
    await fillApprovalTranslations(user, 'Stangenbohne', 'Pole bean');
    await user.click(screen.getByRole('button', { name: /Kulturart anlegen, freigeben und übernehmen/ }));

    expect(await screen.findByText('Die Kulturart konnte nicht geändert werden.')).toBeInTheDocument();
    // Retrying must not re-propose or re-approve the species.
    await user.click(screen.getByRole('button', { name: 'Kulturart ändern' }));
    await waitFor(() => expect(relinkSpeciesMock).toHaveBeenCalledTimes(2));
    expect(cropSpeciesProposeMock).toHaveBeenCalledTimes(1);
    expect(cropSpeciesApproveMock).toHaveBeenCalledTimes(1);
  });

  it('reports an approval failure distinctly and lets the moderator retry without re-proposing', async () => {
    cropSpeciesProposeMock.mockResolvedValue({ data: { id: 9, name: 'Stangenbohne', status: 'proposed' } });
    cropSpeciesApproveMock.mockRejectedValueOnce(new Error('network'));
    renderDialog();

    const user = await pickSpecies('Stangenbohne', /als neue Kulturart vorschlagen/);
    await fillApprovalTranslations(user, 'Stangenbohne', 'Pole bean');
    await user.click(screen.getByRole('button', { name: /Kulturart anlegen, freigeben und übernehmen/ }));

    expect(await screen.findByText(/konnte nicht freigegeben werden/)).toBeInTheDocument();
    expect(relinkSpeciesMock).not.toHaveBeenCalled();

    cropSpeciesApproveMock.mockResolvedValue({ data: { id: 9, name: 'Stangenbohne', status: 'published' } });
    await user.click(screen.getByRole('button', { name: /Kulturart freigeben und übernehmen/ }));

    await waitFor(() => expect(relinkSpeciesMock).toHaveBeenCalledWith(7, 9, { variety: 'Neckarkönigin' }));
    expect(cropSpeciesProposeMock).toHaveBeenCalledTimes(1);
  });

  it('lets a moderator approve and relink an already-pending species straight from the list', async () => {
    cropSpeciesListMock.mockResolvedValue({
      data: {
        count: 3,
        next: null,
        previous: null,
        results: [
          { id: 1, name: 'Bohne', status: 'published' },
          { id: 2, name: 'Feuerbohne', status: 'published' },
          {
            id: 5,
            name: 'Schlangengurke',
            status: 'proposed',
            translations: [{ language_code: 'de', common_name: 'Schlangengurke' }],
          },
        ],
      },
    });
    cropSpeciesApproveMock.mockResolvedValue({ data: { id: 5, name: 'Schlangengurke', status: 'published' } });
    renderDialog();

    const user = await pickSpecies('Schlangengurke', /Schlangengurke/);
    // The German name is pre-filled from the existing pending species; only
    // the missing English one still has to be provided.
    expect(screen.getByLabelText(/Deutscher Name/)).toHaveValue('Schlangengurke');
    await fillApprovalTranslations(user, 'Schlangengurke', 'Snake cucumber');
    await user.click(screen.getByRole('button', { name: /Kulturart freigeben und übernehmen/ }));

    expect(cropSpeciesProposeMock).not.toHaveBeenCalled();
    await waitFor(() => expect(cropSpeciesApproveMock).toHaveBeenCalledWith(
      5,
      '',
      [
        { language_code: 'de', common_name: 'Schlangengurke' },
        { language_code: 'en', common_name: 'Snake cucumber' },
      ],
    ));
    await waitFor(() => expect(relinkSpeciesMock).toHaveBeenCalledWith(7, 5, { variety: 'Neckarkönigin' }));
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
