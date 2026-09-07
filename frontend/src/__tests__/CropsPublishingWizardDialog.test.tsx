import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { CropsPublishingWizardDialog } from '../pages/CropsPublishingWizardDialog';
import type { Crop, PublicCrop } from '../api/types';

const {
  cropSpeciesListMock,
  cropSpeciesProposeMock,
  publicCropListMock,
  publicCropGetMock,
  publishPreviewMock,
} = vi.hoisted(() => ({
  cropSpeciesListMock: vi.fn(),
  cropSpeciesProposeMock: vi.fn(),
  publicCropListMock: vi.fn(),
  publicCropGetMock: vi.fn(),
  publishPreviewMock: vi.fn(),
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
      list: publicCropListMock,
      get: publicCropGetMock,
    },
    cropAPI: {
      ...actual.cropAPI,
      publishPreview: publishPreviewMock,
    },
  };
});

const CROP: Crop = {
  id: 1,
  name: 'Tomate',
  variety: 'Roma',
  growth_duration_days: 90,
  harvest_duration_days: 60,
};

const renderWizard = (
  crop: Crop = CROP,
  options: { varieties?: Crop[]; onPublish?: (data: unknown) => void; termsAlreadyAccepted?: boolean } = {},
) => render(
  <MemoryRouter>
    <CropsPublishingWizardDialog
      open
      crop={crop}
      varieties={options.varieties}
      termsAlreadyAccepted={options.termsAlreadyAccepted ?? true}
      publishing={false}
      onClose={vi.fn()}
      onPublish={options.onPublish ?? vi.fn()}
    />
  </MemoryRouter>,
);

// The wizard keeps the publish button disabled until the public entries the
// Sorten are matched against have arrived, so a Sorte is never offered as new
// just because the lookup had not answered yet.
const findEnabledPublishButton = async (name = 'Jetzt veröffentlichen') => {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
};

const GENERAL_CROP: Crop = { ...CROP, variety: '' };
const VARIETY_ROMA: Crop = { ...CROP, id: 2, variety: 'Roma' };
const VARIETY_OCHSENHERZ: Crop = { ...CROP, id: 3, variety: 'Ochsenherz' };

describe('CropsPublishingWizardDialog', () => {
  beforeEach(() => {
    cropSpeciesListMock.mockReset();
    cropSpeciesListMock.mockResolvedValue({
      data: { count: 1, next: null, previous: null, results: [{ id: 1, name: 'Tomate', status: 'published' }] },
    });
    cropSpeciesProposeMock.mockReset();
    cropSpeciesProposeMock.mockResolvedValue({ data: { id: 2, name: 'Kürbis', status: 'proposed' } });
    publicCropListMock.mockReset();
    publicCropListMock.mockResolvedValue({ data: { results: [] } });
    publicCropGetMock.mockReset();
    publishPreviewMock.mockReset();
    publishPreviewMock.mockResolvedValue({
      data: {
        crop_species: { id: 1, name: 'Tomate' },
        original_language_code: 'de',
        available_language_codes: ['de'],
        missing_required_fields: [],
        duplicates: [],
        can_publish: true,
        general_crop_notice: null,
      },
    });
  });

  it('does not render a general-crop vs. variety toggle', async () => {
    renderWizard();

    await waitFor(() => expect(screen.getByLabelText(/Offizielle Kulturart/i)).toBeInTheDocument());

    expect(screen.queryByText('Veröffentlichen als')).not.toBeInTheDocument();
    expect(screen.queryByText('Allgemeine Kultur')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('submits the species proposal together with the publication, not when the option is picked', async () => {
    cropSpeciesListMock.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });

    renderWizard();

    const speciesInput = await screen.findByLabelText(/Offizielle Kulturart/i);
    const user = userEvent.setup();
    await user.type(speciesInput, 'Kürbis');

    const proposeOption = await screen.findByRole('option', { name: /Kürbis.*als neue Kulturart vorschlagen/i });
    fireEvent.click(proposeOption);

    // Picking the option only arms the dialog: no request yet, the typed text
    // stays in the field, and the main button explains what will happen.
    expect(cropSpeciesProposeMock).not.toHaveBeenCalled();
    expect(await screen.findByDisplayValue('Kürbis')).toBeInTheDocument();
    expect(screen.getByText(/Deine Sorte wird vorläufig unter „Kürbis“ veröffentlicht/)).toBeInTheDocument();

    const proposeButton = screen.getByRole('button', { name: 'Kulturart vorschlagen' });
    expect(proposeButton).toBeEnabled();
    fireEvent.click(proposeButton);

    await waitFor(() => expect(cropSpeciesProposeMock).toHaveBeenCalledWith('Kürbis', 'de'));
    // The freshly proposed (pending) species is used for this publication
    // right away instead of blocking the user until a moderator reviews it.
    await waitFor(() => expect(publishPreviewMock).toHaveBeenCalledWith(
      CROP.id,
      expect.objectContaining({ crop_species_id: 2 }),
    ));
    expect(await screen.findByText(/Dein Vorschlag für die neue Kulturart „Kürbis“ wurde zur Prüfung eingereicht/)).toBeInTheDocument();
  });

  it('keeps showing the proposed name after picking it while an existing species was already selected', async () => {
    // Regression test: the crop's name ("Tomate") matches an existing
    // species in the default beforeEach mock, so the Autocomplete's
    // `selectedSpecies` (its controlled `value`) starts out as that real
    // CropSpecies, not null. Retyping a different name and picking "propose
    // as new species" clears `selectedSpecies` to null, which is a genuine
    // value change — unlike the case where nothing was ever selected — and
    // is what triggers MUI's internal input-value reset. The field must
    // still show the proposed name afterward, not go blank.
    renderWizard();

    const speciesInput = await screen.findByLabelText(/Offizielle Kulturart/i);
    await waitFor(() => expect(speciesInput).toHaveValue('Tomate'));

    const user = userEvent.setup();
    await user.clear(speciesInput);
    await user.type(speciesInput, 'Ackerbohne test');

    const proposeOption = await screen.findByRole('option', { name: /Ackerbohne test.*als neue Kulturart vorschlagen/i });
    fireEvent.click(proposeOption);

    expect(await screen.findByDisplayValue('Ackerbohne test')).toBeInTheDocument();
    expect(screen.getByText(/Deine Sorte wird vorläufig unter „Ackerbohne test“ veröffentlicht/)).toBeInTheDocument();

    // Switching back to an existing species afterward must not leave any
    // stale "propose" state behind.
    await user.clear(speciesInput);
    await user.type(speciesInput, 'Tomate');
    const tomatoOption = await screen.findByRole('option', { name: 'Tomate' });
    fireEvent.click(tomatoOption);

    expect(await screen.findByDisplayValue('Tomate')).toBeInTheDocument();
    expect(screen.queryByText(/Deine Sorte wird vorläufig unter/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jetzt veröffentlichen' })).toBeInTheDocument();
  });

  it('keeps the proposal selected when the user tabs away from the species field', async () => {
    cropSpeciesListMock.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });

    renderWizard();

    const speciesInput = await screen.findByLabelText(/Offizielle Kulturart/i);
    const user = userEvent.setup();
    await user.type(speciesInput, 'teste DE');

    expect(await screen.findByRole('option', { name: /teste DE.*als neue Kulturart vorschlagen/i })).toBeInTheDocument();

    await user.tab();

    expect(await screen.findByDisplayValue('teste DE')).toBeInTheDocument();
    expect(screen.getByText(/Deine Sorte wird vorläufig unter „teste DE“ veröffentlicht/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kulturart vorschlagen' })).toBeEnabled();
  });

  it('does not show the proposed species notice when publication is blocked by missing fields', async () => {
    cropSpeciesListMock.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
    cropSpeciesProposeMock.mockResolvedValue({ data: { id: 2, name: 'sdfsd', status: 'proposed' } });
    publishPreviewMock.mockResolvedValue({
      data: {
        crop_species: { id: 2, name: 'sdfsd' },
        original_language_code: 'de',
        available_language_codes: ['de'],
        missing_required_fields: [
          { field: 'growth_duration_days', label_key: 'library.publishWizard.requiredFields.growth_duration_days' },
          { field: 'harvest_duration_days', label_key: 'library.publishWizard.requiredFields.harvest_duration_days' },
        ],
        duplicates: [],
        can_publish: false,
        general_crop_notice: null,
      },
    });

    renderWizard();

    const speciesInput = await screen.findByLabelText(/Offizielle Kulturart/i);
    const user = userEvent.setup();
    await user.type(speciesInput, 'sdfsd');

    fireEvent.click(await screen.findByRole('option', { name: /sdfsd.*als neue Kulturart vorschlagen/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Kulturart vorschlagen' }));

    await waitFor(() => expect(cropSpeciesProposeMock).toHaveBeenCalledWith('sdfsd', 'de'));
    expect(await screen.findByText(/Vor der Veröffentlichung fehlen noch Pflichtfelder/)).toBeInTheDocument();
    expect(screen.queryByText(/Dein Vorschlag für die neue Kulturart „sdfsd“ wurde zur Prüfung eingereicht/)).not.toBeInTheDocument();
  });

  it('matches an existing species by its localized display name, not just the canonical name', async () => {
    // Regression test: canonical `name` may be in a different language than
    // what the user types/sees (e.g. canonical "Pumpkin", German
    // display_name "Kürbis"). The picker must match on display_name, or a
    // species that already exists looks missing and users are wrongly
    // steered into proposing a duplicate that the backend then rejects.
    cropSpeciesListMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 9, name: 'Pumpkin', display_name: 'Kürbis', status: 'published' }],
      },
    });

    renderWizard();

    const speciesInput = await screen.findByLabelText(/Offizielle Kulturart/i);
    const user = userEvent.setup();
    await user.clear(speciesInput);
    await user.type(speciesInput, 'Kürbis');

    expect(await screen.findByRole('option', { name: 'Pumpkin (Kürbis)' })).toBeInTheDocument();
  });

  it('keeps the proposal entry alongside partial species matches', async () => {
    cropSpeciesListMock.mockResolvedValue({
      data: {
        count: 2,
        next: null,
        previous: null,
        results: [
          { id: 9, name: 'Pumpkin', display_name: 'Kürbis', status: 'published' },
          { id: 10, name: 'Butternut squash', display_name: 'Kürbis Butternut', status: 'published' },
        ],
      },
    });

    renderWizard();

    const speciesInput = await screen.findByLabelText(/Offizielle Kulturart/i);
    const user = userEvent.setup();
    await user.clear(speciesInput);
    await user.type(speciesInput, 'Kürb');

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Pumpkin (Kürbis)',
      'Butternut squash (Kürbis Butternut)',
      '„Kürb“ als neue Kulturart vorschlagen',
    ]);
  });

  it('hides the proposal entry while the species field is empty', async () => {
    renderWizard();

    const speciesInput = await screen.findByLabelText(/Offizielle Kulturart/i);
    const user = userEvent.setup();
    await user.clear(speciesInput);
    await user.click(speciesInput);

    expect(screen.queryByRole('option', { name: /als neue Kulturart vorschlagen/i })).not.toBeInTheDocument();
  });

  it('hides the proposal entry when the typed text already names an existing species', async () => {
    // Proposing an exact duplicate can only be rejected server-side, so the
    // escape hatch disappears once the typed name *is* an existing one —
    // case-insensitively, since that is how the backend compares.
    cropSpeciesListMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 9, name: 'Pumpkin', display_name: 'Kürbis', status: 'published' }],
      },
    });

    renderWizard();

    const speciesInput = await screen.findByLabelText(/Offizielle Kulturart/i);
    const user = userEvent.setup();
    await user.clear(speciesInput);
    await user.type(speciesInput, 'kürbis');

    expect(await screen.findByRole('option', { name: 'Pumpkin (Kürbis)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /als neue Kulturart vorschlagen/i })).not.toBeInTheDocument();
  });

  it('matches regional species aliases and hides the proposal option', async () => {
    cropSpeciesListMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [{
          id: 9,
          name: 'Tomate',
          display_name: 'Tomate',
          status: 'published',
          search_names: ['Tomate', 'Paradeis', 'Paradeiser'],
          translations: [{
            language_code: 'de',
            common_name: 'Tomate',
            synonyms: ['Paradeis'],
            regional_names: { austria: 'Paradeiser' },
          }],
        }],
      },
    });

    renderWizard();

    const speciesInput = await screen.findByLabelText(/Offizielle Kulturart/i);
    const user = userEvent.setup();
    await user.clear(speciesInput);
    await user.type(speciesInput, 'Paradeiser');

    expect(await screen.findByRole('option', { name: 'Tomate (Paradeiser)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Paradeiser.*als neue Kulturart vorschlagen/i })).not.toBeInTheDocument();
  });

  it('offers every species an ambiguous alias can mean', async () => {
    const speciesWithAlias = (id: number, name: string, synonyms: string[]) => ({
      id,
      name,
      display_name: name,
      status: 'published',
      search_names: [name, ...synonyms],
      translations: [{
        language_code: 'de',
        common_name: name,
        synonyms,
        regional_names: {},
      }],
    });
    cropSpeciesListMock.mockResolvedValue({
      data: {
        count: 3,
        next: null,
        previous: null,
        results: [
          speciesWithAlias(11, 'Paprika', ['Gemüsepaprika', 'Peperoni']),
          speciesWithAlias(12, 'Chili', ['Chilischote', 'Peperoni']),
          speciesWithAlias(13, 'Pfefferoni', ['Peperoni', 'Peperoncini']),
        ],
      },
    });

    renderWizard();

    const speciesInput = await screen.findByLabelText(/Offizielle Kulturart/i);
    const user = userEvent.setup();
    await user.clear(speciesInput);
    await user.type(speciesInput, 'Peperoni');

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Paprika (Peperoni)',
      'Chili (Peperoni)',
      'Pfefferoni (Peperoni)',
    ]);
  });

  it('keeps the proposal entry alongside partial regional alias matches', async () => {
    cropSpeciesListMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [{
          id: 9,
          name: 'Tomate',
          display_name: 'Tomate',
          status: 'published',
          search_names: ['Tomate', 'Paradeis', 'Paradeiser'],
          translations: [{
            language_code: 'de',
            common_name: 'Tomate',
            synonyms: ['Paradeis'],
            regional_names: { austria: 'Paradeiser' },
          }],
        }],
      },
    });

    renderWizard();

    const speciesInput = await screen.findByLabelText(/Offizielle Kulturart/i);
    const user = userEvent.setup();
    await user.clear(speciesInput);
    await user.type(speciesInput, 'Paradei');

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Tomate (Paradeis)',
      '„Paradei“ als neue Kulturart vorschlagen',
    ]);
  });

  it('shows an inline error when proposing a species fails', async () => {
    cropSpeciesListMock.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
    cropSpeciesProposeMock.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: { name: ['This crop species already exists or has already been proposed.'] },
      },
    });

    renderWizard();

    const speciesInput = await screen.findByLabelText(/Offizielle Kulturart/i);
    const user = userEvent.setup();
    await user.type(speciesInput, 'Kürbis');

    const proposeOption = await screen.findByRole('option', { name: /Kürbis.*als neue Kulturart vorschlagen/i });
    fireEvent.click(proposeOption);
    fireEvent.click(await screen.findByRole('button', { name: 'Kulturart vorschlagen' }));

    await waitFor(() => expect(cropSpeciesProposeMock).toHaveBeenCalledWith('Kürbis', 'de'));
    expect(await screen.findByText(/existiert bereits oder wurde schon vorgeschlagen/)).toBeInTheDocument();
    expect(screen.queryByText(/wurde zur Prüfung eingereicht/)).not.toBeInTheDocument();
    // A failed proposal must not publish the variety under a species that
    // does not exist.
    expect(publishPreviewMock).not.toHaveBeenCalled();
  });

  it('pre-selects the existing public variety that already matches the local variety name', async () => {
    publicCropListMock.mockResolvedValue({
      data: {
        results: [
          { id: 40, status: 'published', name: 'Tomate', display_name: 'Tomate', variety: 'Roma', crop_species: 1, version: 2 },
          { id: 41, status: 'published', name: 'Tomate', display_name: 'Tomate', variety: 'Ochsenherz', crop_species: 1, version: 1 },
        ],
      },
    });

    renderWizard();

    await screen.findByLabelText(/Offizielle Kulturart/i);
    // The species is already selected in the field above, so this field
    // shows only the variety name — not a redundant "Species · Variety".
    await waitFor(() => expect(screen.getByDisplayValue('Roma')).toBeInTheDocument());
  });

  it('shows a link to view foreign duplicates instead of blocking on plain text', async () => {
    publishPreviewMock.mockResolvedValue({
      data: {
        crop_species: { id: 1, name: 'Tomate' },
        original_language_code: 'de',
        available_language_codes: ['de'],
        missing_required_fields: [],
        duplicates: [{ id: 55, name: 'Tomate', variety: 'Roma', version: 1, published_at: null, is_mine: false }],
        can_publish: false,
        general_crop_notice: null,
      },
    });

    renderWizard();
    await screen.findByLabelText(/Offizielle Kulturart/i);

    fireEvent.click(screen.getByRole('button', { name: 'Jetzt veröffentlichen' }));

    const viewLink = await screen.findByRole('link', { name: 'Eintrag ansehen' });
    expect(viewLink).toHaveAttribute('href', '/app/crop-library?cropId=55');
  });

  it('hides the "Existing variety" field and publishes as general for a crop-level crop (no variety)', async () => {
    const cropLevelCrop: Crop = { ...CROP, variety: '' };
    renderWizard(cropLevelCrop);

    await screen.findByLabelText(/Offizielle Kulturart/i);
    expect(screen.queryByLabelText('Vorhandene Sorte')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Jetzt veröffentlichen' }));

    await waitFor(() => expect(publishPreviewMock).toHaveBeenCalledWith(
      cropLevelCrop.id,
      expect.objectContaining({ crop_species_id: 1, original_language_code: 'de', publish_as_general: true }),
    ));
  });

  it('publishes as general when updating an already-linked public entry that has no variety', async () => {
    const linkedPublicCrop: PublicCrop = {
      id: 55,
      status: 'published',
      name: 'Bohne',
      variety: '',
      crop_species: 1,
      thousand_kernel_weight_g: 400,
      version: 1,
    };
    publicCropGetMock.mockResolvedValue({ data: linkedPublicCrop });
    const ownedGeneralCrop: Crop = {
      ...CROP,
      variety: '',
      owned_public_crop_id: 55,
      thousand_kernel_weight_g: 472,
    };

    renderWizard(ownedGeneralCrop);

    await waitFor(() => expect(publicCropGetMock).toHaveBeenCalledWith(55));
    const updateButton = await screen.findByRole('button', { name: 'Öffentliche Version aktualisieren' });
    await waitFor(() => expect(updateButton).toBeEnabled());

    fireEvent.click(updateButton);

    await waitFor(() => expect(publishPreviewMock).toHaveBeenCalledWith(
      ownedGeneralCrop.id,
      expect.objectContaining({ publish_as_general: true }),
    ));
  });

  it('prefills the species field with the local crop name on open, for crop-level and variety crops', async () => {
    renderWizard();
    expect(await screen.findByDisplayValue('Tomate')).toBeInTheDocument();
  });

  it('keeps "Original language" collapsed to a summary with a change link by default', async () => {
    renderWizard();
    await screen.findByLabelText(/Offizielle Kulturart/i);

    expect(screen.queryByLabelText('Originalsprache')).not.toBeInTheDocument();
    expect(screen.getByText(/Originalsprache: /)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ändern' }));
    expect(screen.getByLabelText('Originalsprache')).toBeInTheDocument();
  });

  it('shows a dismissible notice when the general crop data looks stale', async () => {
    publishPreviewMock.mockResolvedValue({
      data: {
        crop_species: { id: 1, name: 'Tomate' },
        original_language_code: 'de',
        available_language_codes: ['de'],
        missing_required_fields: [],
        duplicates: [],
        can_publish: true,
        general_crop_notice: { public_crop_id: 42, updated_at: '2024-01-01T00:00:00Z', is_stale: true, is_incomplete: false },
      },
    });

    renderWizard();
    await screen.findByLabelText(/Offizielle Kulturart/i);

    fireEvent.click(screen.getByRole('button', { name: 'Jetzt veröffentlichen' }));

    const notice = await screen.findByText(/wurden lange nicht aktualisiert/);
    expect(notice).toBeInTheDocument();
    const editLink = screen.getByRole('link', { name: 'In der Bibliothek bearbeiten' });
    expect(editLink).toHaveAttribute('href', '/app/crop-library?cropId=42');

    fireEvent.click(screen.getByLabelText(/close/i));
    await waitFor(() => expect(screen.queryByText(/wurden lange nicht aktualisiert/)).not.toBeInTheDocument());
  });
  describe('publishing the Kultur together with its Sorten', () => {
    it('keeps the dialog unchanged for a Kultur without Sorten', async () => {
      renderWizard(GENERAL_CROP);

      await screen.findByLabelText(/Offizielle Kulturart/i);
      expect(screen.getByText(/Es werden die allgemeinen Daten dieser Kulturart veröffentlicht, keine Sorte/)).toBeInTheDocument();
      expect(screen.queryByText('Sorten mitveröffentlichen')).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('preselects every Sorte and publishes them along with the Kultur', async () => {
      const onPublish = vi.fn();
      renderWizard(GENERAL_CROP, { varieties: [VARIETY_ROMA, VARIETY_OCHSENHERZ], onPublish });

      await screen.findByLabelText(/Offizielle Kulturart/i);
      expect(screen.getByText('Es werden die allgemeinen Daten dieser Kulturart veröffentlicht. Zusätzlich ausgewählte Sorten werden mitveröffentlicht.')).toBeInTheDocument();

      const romaCheckbox = screen.getByRole('checkbox', { name: /^Roma/ });
      const ochsenherzCheckbox = screen.getByRole('checkbox', { name: /^Ochsenherz/ });
      expect(romaCheckbox).toBeChecked();
      expect(ochsenherzCheckbox).toBeChecked();

      fireEvent.click(await findEnabledPublishButton());

      await waitFor(() => expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
        publishAsGeneral: true,
        varieties: [
          { cropId: 2, publicCropId: null },
          { cropId: 3, publicCropId: null },
        ],
      })));
    });

    it('leaves deselected Sorten out of the publication', async () => {
      const onPublish = vi.fn();
      renderWizard(GENERAL_CROP, { varieties: [VARIETY_ROMA, VARIETY_OCHSENHERZ], onPublish });

      await screen.findByLabelText(/Offizielle Kulturart/i);
      fireEvent.click(screen.getByRole('checkbox', { name: /^Ochsenherz/ }));
      expect(screen.getByRole('checkbox', { name: /^Ochsenherz/ })).not.toBeChecked();

      fireEvent.click(await findEnabledPublishButton());

      await waitFor(() => expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
        varieties: [{ cropId: 2, publicCropId: null }],
      })));
    });

    it('links a Sorte that already exists in the public library instead of duplicating it', async () => {
      publicCropListMock.mockResolvedValue({
        data: {
          results: [
            { id: 40, status: 'published', name: 'Tomate', display_name: 'Tomate', variety: 'Roma', crop_species: 1, version: 2 },
          ],
        },
      });
      const onPublish = vi.fn();
      renderWizard(GENERAL_CROP, { varieties: [VARIETY_ROMA, VARIETY_OCHSENHERZ], onPublish });

      await screen.findByLabelText(/Offizielle Kulturart/i);
      expect(await screen.findByText('bereits vorhanden – wird verknüpft')).toBeInTheDocument();
      // Only the conflicting Sorte carries the hint.
      expect(screen.getAllByText('bereits vorhanden – wird verknüpft')).toHaveLength(1);

      fireEvent.click(await findEnabledPublishButton());

      await waitFor(() => expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
        varieties: [
          { cropId: 2, publicCropId: 40 },
          { cropId: 3, publicCropId: null },
        ],
      })));
    });
    it('asks for the license before co-publishing Sorten on the link path', async () => {
      // Linking the Kultur itself needs no license, but the Sorten published
      // along with it do — without the acceptance the backend rejects each of
      // them with `public_library_terms_required`.
      const linkedGeneralEntry: PublicCrop = {
        id: 55,
        status: 'published',
        name: 'Tomate',
        display_name: 'Tomate',
        variety: '',
        crop_species: 1,
        version: 3,
      };
      publicCropGetMock.mockResolvedValue({ data: linkedGeneralEntry });
      const onPublish = vi.fn();
      renderWizard(
        { ...GENERAL_CROP, source_public_crop: 55 },
        { varieties: [VARIETY_ROMA], onPublish, termsAlreadyAccepted: false },
      );

      await waitFor(() => expect(publicCropGetMock).toHaveBeenCalledWith(55));
      fireEvent.click(await findEnabledPublishButton('Mit öffentlicher Kultur verknüpfen'));

      // First click only reveals the license box; nothing is published yet.
      const licenseCheckbox = await screen.findByRole('checkbox', { name: /Lizenz|CC BY-SA|akzeptiere/i });
      expect(onPublish).not.toHaveBeenCalled();

      fireEvent.click(licenseCheckbox);
      fireEvent.click(screen.getByRole('button', { name: 'Mit öffentlicher Kultur verknüpfen' }));

      await waitFor(() => expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
        acceptedPublicLibraryTerms: true,
        publicCropId: 55,
        varieties: [{ cropId: 2, publicCropId: null }],
      })));
    });

    it('warns instead of silently offering every Sorte as new when the library lookup fails', async () => {
      publicCropListMock.mockRejectedValue(new Error('network down'));
      const onPublish = vi.fn();
      renderWizard(GENERAL_CROP, { varieties: [VARIETY_ROMA, VARIETY_OCHSENHERZ], onPublish });

      await screen.findByLabelText(/Offizielle Kulturart/i);
      expect(await screen.findByText(/Abgleich mit der Kulturbibliothek fehlgeschlagen/)).toBeInTheDocument();

      // A failed lookup must not block publishing — the backend's own
      // duplicate gate still catches a Sorte that is public already.
      fireEvent.click(await findEnabledPublishButton());
      await waitFor(() => expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
        varieties: [
          { cropId: 2, publicCropId: null },
          { cropId: 3, publicCropId: null },
        ],
      })));
    });
  });
});
