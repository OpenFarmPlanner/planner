import type { PublicCropSyncSubmitResult } from '../crops/publicCropSync';
import i18n from '../i18n/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { CropsPublishingWizardDialog } from '../pages/CropsPublishingWizardDialog';
import type { Crop, PublicCrop } from '../api/types';

// The species field now searches the (mocked) server on every keystroke with
// a real 250ms debounce (see `useCropSpeciesSearch`) instead of filtering an
// already-loaded list — `findBy*`/`findAllBy*`'s default 1s timeout can be
// too tight for that plus `userEvent.type`'s own per-keystroke delay.
configure({ asyncUtilTimeout: 3000 });

const {
  cropSpeciesListMock,
  cropSpeciesProposeMock,
  publicCropListMock,
  publicCropGetMock,
  publishPreviewMock,
  publicSyncPreviewMock,
  healthListMock,
} = vi.hoisted(() => ({
  cropSpeciesListMock: vi.fn(),
  cropSpeciesProposeMock: vi.fn(),
  publicCropListMock: vi.fn(),
  publicCropGetMock: vi.fn(),
  publishPreviewMock: vi.fn(),
  publicSyncPreviewMock: vi.fn(),
  healthListMock: vi.fn(),
}));

vi.mock('../crop-library/plant-health/api', () => ({ plantHealthAPI: { list: healthListMock } }));

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
      publicSyncPreview: publicSyncPreviewMock,
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
  options: {
    varieties?: Crop[];
    onClose?: () => void;
    onPublish?: (data: unknown) => void;
    onLinkPublicCrop?: (data: unknown) => Promise<boolean>;
    onSyncPublicCrop?: (data: unknown) => Promise<PublicCropSyncSubmitResult>;
    termsAlreadyAccepted?: boolean;
  } = {},
) => render(
  <MemoryRouter>
    <CropsPublishingWizardDialog
      open
      crop={crop}
      varieties={options.varieties}
      termsAlreadyAccepted={options.termsAlreadyAccepted ?? true}
      publishing={false}
      onClose={options.onClose ?? vi.fn()}
      onPublish={options.onPublish ?? vi.fn()}
      onLinkPublicCrop={options.onLinkPublicCrop ?? vi.fn().mockResolvedValue(true)}
      onSyncPublicCrop={options.onSyncPublicCrop ?? vi.fn().mockResolvedValue({ success: true })}
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

// The species field now searches the (mocked) server, so its dropdown can
// briefly show only the "propose as new species" entry before the debounced
// search results arrive. `findAllByRole('option')` resolves the moment
// *any* option exists, so it can race ahead of that — this waits for the
// expected final option count first.
const findSettledOptions = async (expectedCount: number) => {
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(expectedCount));
  return screen.getAllByRole('option');
};

// Nothing is auto-selected any more (not even an exact name match) — every
// test that publishes now has to pick the species option explicitly first.
const selectSpeciesOption = async (name: string): Promise<void> => {
  const input = await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
  if (input.getAttribute('aria-expanded') !== 'true') fireEvent.mouseDown(input);
  fireEvent.click(await screen.findByRole('option', { name }, { timeout: 10000 }));
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
    publicSyncPreviewMock.mockReset();
    publicSyncPreviewMock.mockResolvedValue({
      data: { public_crop_id: 0, public_version: 1, requires_moderation: false, changes: [] },
    });
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

    await waitFor(() => expect(screen.getByRole('combobox', { name: /Offizielle Kulturart/i })).toBeInTheDocument());

    expect(screen.queryByText('Veröffentlichen als')).not.toBeInTheDocument();
    expect(screen.queryByText('Allgemeine Kultur')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('submits the species proposal together with the publication, not when the option is picked', async () => {
    cropSpeciesListMock.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });

    renderWizard();

    const speciesInput = await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
    const user = userEvent.setup();
    await user.type(speciesInput, 'Kürbis');

    const proposeOption = await screen.findByRole('button', { name: /Kürbis.*als neue Kulturart vorschlagen/i });
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
    // Regression test: once a real CropSpecies is selected (the Autocomplete's
    // controlled `value`), retyping a different name and picking "propose as
    // new species" clears that selection to null, which is a genuine value
    // change — unlike the case where nothing was ever selected — and is what
    // triggers MUI's internal input-value reset. The field must still show
    // the proposed name afterward, not go blank.
    renderWizard();

    const speciesInput = await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
    await waitFor(() => expect(speciesInput).toHaveValue('Tomate'));
    const user = userEvent.setup();
    fireEvent.click(await screen.findByRole('option', { name: 'Tomate' }));
    expect(await screen.findByDisplayValue('Tomate')).toBeInTheDocument();

    await user.clear(speciesInput);
    await user.type(speciesInput, 'Ackerbohne test');

    const proposeOption = await screen.findByRole('button', { name: /Ackerbohne test.*als neue Kulturart vorschlagen/i });
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

    const speciesInput = await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
    const user = userEvent.setup();
    await user.type(speciesInput, 'teste DE');

    expect(await screen.findByRole('button', { name: /teste DE.*als neue Kulturart vorschlagen/i })).toBeInTheDocument();

    await user.tab();
    await user.keyboard('{Enter}');

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

    const speciesInput = await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
    const user = userEvent.setup();
    await user.type(speciesInput, 'sdfsd');

    fireEvent.click(await screen.findByRole('button', { name: /sdfsd.*als neue Kulturart vorschlagen/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Kulturart vorschlagen' }));

    await waitFor(() => expect(cropSpeciesProposeMock).toHaveBeenCalledWith('sdfsd', 'de'));
    expect(await screen.findByText(/Vor der Veröffentlichung fehlen noch Pflichtfelder/)).toBeInTheDocument();
    expect(screen.queryByText(/Dein Vorschlag für die neue Kulturart „sdfsd“ wurde zur Prüfung eingereicht/)).not.toBeInTheDocument();
  });

  it('names a blocking reason that has no detailed alert of its own', async () => {
    // A species can be rejected between search and publish; the preview then
    // blocks with no missing fields and no duplicates, which used to leave the
    // user with a disabled button and no explanation.
    publishPreviewMock.mockResolvedValue({
      data: {
        crop_species: null,
        original_language_code: 'de',
        available_language_codes: ['de'],
        missing_required_fields: [],
        duplicates: [],
        can_publish: false,
        blocking_reasons: ['crop_species_unavailable'],
        general_crop_notice: null,
      },
    });

    renderWizard();

    await selectSpeciesOption('Tomate');
    fireEvent.click(await findEnabledPublishButton());

    expect(await screen.findByText(/Die zugeordnete Kulturart ist in der Kulturbibliothek nicht mehr verfügbar/))
      .toBeInTheDocument();
  });

  it('matches an existing species by its localized display name, not just the canonical name', async () => {
    // Regression test: canonical `name` may be in a different language than
    // what the user types/sees (e.g. canonical "Pumpkin", German
    // display_name "Kürbis"). The picker must match on display_name, or a
    // species that already exists looks missing and users are wrongly
    // steered into proposing a duplicate that the backend then rejects. The
    // result list shows the UI-language name ("Kürbis") without a redundant
    // parenthetical, since that's exactly what was searched for — not the
    // canonical `name` ("Pumpkin").
    cropSpeciesListMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [{
          id: 9,
          name: 'Pumpkin',
          display_name: 'Kürbis',
          display_language_code: 'de',
          status: 'published',
          translations: [{ language_code: 'de', common_name: 'Kürbis', synonyms: [], regional_names: {} }],
        }],
      },
    });

    renderWizard();

    const speciesInput = await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
    const user = userEvent.setup();
    await user.clear(speciesInput);
    await user.type(speciesInput, 'Kürbis');

    expect(await screen.findByRole('option', { name: 'Kürbis' })).toBeInTheDocument();
  });

  it('keeps the proposal entry alongside partial species matches', async () => {
    cropSpeciesListMock.mockResolvedValue({
      data: {
        count: 2,
        next: null,
        previous: null,
        results: [
          {
            id: 9,
            name: 'Pumpkin',
            display_name: 'Kürbis',
            display_language_code: 'de',
            status: 'published',
            translations: [{ language_code: 'de', common_name: 'Kürbis', synonyms: [], regional_names: {} }],
          },
          {
            id: 10,
            name: 'Butternut squash',
            display_name: 'Kürbis Butternut',
            display_language_code: 'de',
            status: 'published',
            translations: [{ language_code: 'de', common_name: 'Kürbis Butternut', synonyms: [], regional_names: {} }],
          },
        ],
      },
    });

    renderWizard();

    const speciesInput = await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
    const user = userEvent.setup();
    await user.clear(speciesInput);
    await user.type(speciesInput, 'Kürb');

    const options = await findSettledOptions(2);
    expect(options.map((option) => option.textContent)).toEqual([
      'Kürbis',
      'Kürbis Butternut',
    ]);
  });

  it('hides the proposal entry while the species field is empty', async () => {
    renderWizard();

    const speciesInput = await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
    const user = userEvent.setup();
    await user.clear(speciesInput);
    await user.click(speciesInput);

    expect(screen.queryByRole('button', { name: /als neue Kulturart vorschlagen/i })).not.toBeInTheDocument();
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
        results: [{
          id: 9,
          name: 'Pumpkin',
          display_name: 'Kürbis',
          display_language_code: 'de',
          status: 'published',
          translations: [{ language_code: 'de', common_name: 'Kürbis', synonyms: [], regional_names: {} }],
        }],
      },
    });

    renderWizard();

    const speciesInput = await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
    const user = userEvent.setup();
    await user.clear(speciesInput);
    await user.type(speciesInput, 'kürbis');

    expect(await screen.findByRole('option', { name: 'Kürbis' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /als neue Kulturart vorschlagen/i })).not.toBeInTheDocument();
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

    const speciesInput = await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
    const user = userEvent.setup();
    await user.clear(speciesInput);
    await user.type(speciesInput, 'Paradeiser');

    expect(await screen.findByRole('option', { name: 'Tomate Synonym: Paradeiser' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Paradeiser.*als neue Kulturart vorschlagen/i })).not.toBeInTheDocument();
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

    const speciesInput = await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
    const user = userEvent.setup();
    await user.clear(speciesInput);
    await user.type(speciesInput, 'Peperoni');

    const options = await findSettledOptions(3);
    expect(options.map((option) => option.textContent)).toEqual([
      'Paprika Synonym: Peperoni',
      'Chili Synonym: Peperoni',
      'Pfefferoni Synonym: Peperoni',
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

    const speciesInput = await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
    const user = userEvent.setup();
    await user.clear(speciesInput);
    await user.type(speciesInput, 'Paradei');

    const options = await findSettledOptions(1);
    expect(options.map((option) => option.textContent)).toEqual([
      'Tomate Synonym: Paradeis',
    ]);
  });

  it('explains a synonym hit and confirms the official name it is published under', async () => {
    cropSpeciesListMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [{
          id: 21,
          name: 'Lauch',
          display_name: 'Lauch',
          scientific_name: 'Allium ampeloprasum',
          status: 'published',
          search_names: ['Lauch', 'Porree', 'Allium ampeloprasum'],
          translations: [{ language_code: 'de', common_name: 'Lauch', synonyms: ['Porree'], regional_names: {} }],
          search_match: { source: 'synonym', synonym: 'Porree' },
        }],
      },
    });

    renderWizard({ ...CROP, name: 'Porree', variety: '' });

    const option = await screen.findByRole('option', { name: 'Lauch Synonym: Porree · Allium ampeloprasum' });
    expect(screen.queryByText(/wird als/)).not.toBeInTheDocument();
    fireEvent.click(option);

    expect(await screen.findByText('Deine Kultur „Porree“ wird als „Lauch“ veröffentlicht.')).toBeInTheDocument();
  });

  describe('picking an official species after typing', () => {
    const SUGAR_PEA_CROP: Crop = { ...CROP, name: 'Zuckererbse', variety: '' };
    const speciesHit = (
      id: number,
      name: string,
      searchMatch: { source: 'name' | 'synonym' | 'fuzzy'; synonym: string },
    ) => ({
      id,
      name,
      display_name: name,
      status: 'published',
      search_names: [name, searchMatch.synonym].filter(Boolean),
      translations: [{ language_code: 'de', common_name: name, synonyms: searchMatch.synonym ? [searchMatch.synonym] : [] }],
      search_match: searchMatch,
    });
    const page = (results: unknown[]) => ({ data: { count: results.length, next: null, previous: null, results } });
    const resultsByQuery: Record<string, unknown[]> = {
      Zuckererbse: [
        speciesHit(31, 'Zuckererbse', { source: 'name', synonym: '' }),
        speciesHit(32, 'Futtererbse', { source: 'fuzzy', synonym: '' }),
      ],
      zuck: [
        speciesHit(33, 'Zuckerhut', { source: 'name', synonym: '' }),
        speciesHit(31, 'Zuckererbse', { source: 'synonym', synonym: 'Zuckerschote' }),
      ],
    };
    const searchedQueries = () => cropSpeciesListMock.mock.calls.map(([params]) => params.q);
    const renderOpenable = (open: boolean) => (
      <MemoryRouter>
        <CropsPublishingWizardDialog
          open={open}
          crop={SUGAR_PEA_CROP}
          termsAlreadyAccepted
          publishing={false}
          onClose={vi.fn()}
          onPublish={vi.fn()}
          onLinkPublicCrop={vi.fn().mockResolvedValue(true)}
          onSyncPublicCrop={vi.fn().mockResolvedValue({ success: true })}
        />
      </MemoryRouter>
    );

    beforeEach(() => {
      cropSpeciesListMock.mockImplementation((params: { q: string }) => (
        Promise.resolve(page(resultsByQuery[params.q] ?? []))
      ));
    });

    it('applies the option on the first click and keeps the list it was picked from', async () => {
      // Regression: the click used to land on nothing, leaving the typed text
      // in the field and the publish button disabled.
      render(renderOpenable(true));
      const speciesInput = await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
      const user = userEvent.setup();
      await user.clear(speciesInput);
      await user.type(speciesInput, 'zuck');

      const option = await screen.findByRole('option', { name: 'Zuckererbse Synonym: Zuckerschote' });
      const searchesBeforePick = searchedQueries().length;
      fireEvent.click(option);

      expect(speciesInput).toHaveValue('Zuckererbse');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Jetzt veröffentlichen' })).toBeEnabled());
      // Writing the picked label into the field is not a new search: one
      // would replace the options the user just picked from.
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(searchedQueries()).toHaveLength(searchesBeforePick);
      expect(searchedQueries().at(-1)).toBe('zuck');
      expect(speciesInput).toHaveValue('Zuckererbse');
    });

    it('never offers the previous query\'s results while the current one is pending', async () => {
      // A stale list swapped for the fresh one mid-click moved another option
      // under the pointer, so the click selected nothing.
      let resolvePending: (value: unknown) => void = () => undefined;
      cropSpeciesListMock.mockImplementation((params: { q: string }) => (
        params.q === 'zuck'
          ? new Promise((resolve) => { resolvePending = resolve; })
          : Promise.resolve(page(resultsByQuery[params.q] ?? []))
      ));
      render(renderOpenable(true));
      const speciesInput = await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
      expect(await screen.findByRole('option', { name: /^Futtererbse/ })).toBeInTheDocument();
      const user = userEvent.setup();
      // Typing over the selected prefill, as users do: the field never goes
      // empty in between, which would clear the old list by itself.
      await user.tripleClick(speciesInput);
      await user.keyboard('zuck');

      await waitFor(() => expect(searchedQueries()).toContain('zuck'));
      expect(screen.queryByRole('option', { name: /^Futtererbse/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /als neue Kulturart vorschlagen/ })).not.toBeInTheDocument();
      expect(screen.getByText('Lädt...')).toBeInTheDocument();

      resolvePending(page(resultsByQuery.zuck));
      expect(await screen.findByRole('option', { name: 'Zuckererbse Synonym: Zuckerschote' })).toBeInTheDocument();
    });

    it('starts from the crop name again when reopened, without a stale selection', async () => {
      const view = render(renderOpenable(true));
      const speciesInput = await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
      const user = userEvent.setup();
      await user.clear(speciesInput);
      await user.type(speciesInput, 'zuck');
      fireEvent.click(await screen.findByRole('option', { name: 'Zuckererbse Synonym: Zuckerschote' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Jetzt veröffentlichen' })).toBeEnabled());

      view.rerender(renderOpenable(false));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      view.rerender(renderOpenable(true));

      const reopenedInput = await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
      await waitFor(() => expect(reopenedInput).toHaveValue('Zuckererbse'));
      // The prefilled crop name is not a pick: nothing is selected, so the
      // field and the publish button agree.
      expect(await screen.findByRole('button', { name: 'Jetzt veröffentlichen' })).toBeDisabled();
      expect(screen.queryByText(/wird als/)).not.toBeInTheDocument();
      const options = await findSettledOptions(2);
      expect(options.map((option) => option.textContent)).toEqual(['Zuckererbse', 'Futtererbse']);
    });
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

    const speciesInput = await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
    const user = userEvent.setup();
    await user.type(speciesInput, 'Kürbis');

    const proposeOption = await screen.findByRole('button', { name: /Kürbis.*als neue Kulturart vorschlagen/i });
    fireEvent.click(proposeOption);
    fireEvent.click(await screen.findByRole('button', { name: 'Kulturart vorschlagen' }));

    await waitFor(() => expect(cropSpeciesProposeMock).toHaveBeenCalledWith('Kürbis', 'de'));
    expect(await screen.findByText(/existiert bereits oder wurde schon vorgeschlagen/)).toBeInTheDocument();
    expect(screen.queryByText(/wurde zur Prüfung eingereicht/)).not.toBeInTheDocument();
    // A failed proposal must not publish the variety under a species that
    // does not exist.
    expect(publishPreviewMock).not.toHaveBeenCalled();
  });

  it('opens the comparison directly for a unique existing variety and saves only on confirmation', async () => {
    publicCropListMock.mockResolvedValue({ data: { results: [
      { id: 40, status: 'published', name: 'Tomate', variety: 'Roma', crop_species: 1, version: 2, original_language_code: 'it' },
      { id: 41, status: 'published', name: 'Tomate', variety: 'Ochsenherz', crop_species: 1, version: 1 },
    ] } });
    const onLinkPublicCrop = vi.fn().mockResolvedValue(true);
    const onPublish = vi.fn();
    const onClose = vi.fn();
    renderWizard(CROP, { onLinkPublicCrop, onPublish, onClose });
    expect(await screen.findByRole('dialog', { name: 'Mit vorhandenem Eintrag verknüpfen' })).toBeVisible();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(publicSyncPreviewMock).toHaveBeenCalledWith(CROP.id, 40);
    expect(onLinkPublicCrop).not.toHaveBeenCalled();
    expect(onPublish).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Verknüpfen und Werte übernehmen' }));
    await waitFor(() => expect(onLinkPublicCrop).toHaveBeenCalledWith(expect.objectContaining({ publicCropId: 40 })));
    expect(onPublish).not.toHaveBeenCalled();
  });

  it('skips the picker for a unique general entry, cancels without writes and keeps its target on back', async () => {
    publicCropListMock.mockResolvedValue({ data: { results: [
      { id: 40, status: 'published', name: 'Tomate', variety: '', crop_species: 1, version: 2 },
    ] } });
    const onLinkPublicCrop = vi.fn();
    const onPublish = vi.fn();
    const onClose = vi.fn();
    renderWizard(GENERAL_CROP, { onLinkPublicCrop, onPublish, onClose });
    await screen.findByRole('dialog', { name: 'Mit vorhandenem Eintrag verknüpfen' });
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }));
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    fireEvent.click(await findEnabledPublishButton('Weiter zum Abgleich'));
    await screen.findByRole('dialog', { name: 'Mit vorhandenem Eintrag verknüpfen' });
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen', exact: true }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onLinkPublicCrop).not.toHaveBeenCalled();
    expect(onPublish).not.toHaveBeenCalled();
  });

  it.each([false, true])('resolves an existing entry by %s assigned identity or an exact alias', async (assigned) => {
    cropSpeciesListMock.mockResolvedValue({ data: { count: 1, next: null, results: [
      { id: 1, name: 'Tomate', status: 'published', search_names: ['Tomate', 'Paradeiser'] },
    ] } });
    publicCropListMock.mockResolvedValue({ data: { results: [
      { id: 40, status: 'published', name: 'Tomate', variety: '', crop_species: 1, version: 2 },
    ] } });
    renderWizard({ ...GENERAL_CROP, name: assigned ? 'My local name' : 'Paradeiser', crop_species: assigned ? 1 : null });
    await screen.findByRole('dialog', { name: 'Mit vorhandenem Eintrag verknüpfen' });
    expect(publicSyncPreviewMock).toHaveBeenCalledWith(GENERAL_CROP.id, 40);
  });

  it.each(['similar', 'ambiguous', 'incomplete'])('keeps the picker for a %s species match', async (kind) => {
    const results = [{ id: 1, name: kind === 'similar' ? 'Tomat' : 'Tomate', status: 'published' },
      ...(kind === 'ambiguous' ? [{ id: 2, name: 'Other species', status: 'published', search_names: ['Tomate'] }] : [])];
    cropSpeciesListMock.mockResolvedValue({ data: { count: kind === 'incomplete' ? 50 : results.length,
      results, next: kind === 'incomplete' ? '/next' : null } });
    publicCropListMock.mockResolvedValue({ data: { results: [
      { id: 40, status: 'published', name: 'Tomate', variety: '', crop_species: 1, version: 2 },
    ] } });
    renderWizard(GENERAL_CROP);
    await waitFor(() => expect(publicCropListMock).toHaveBeenCalled());
    expect(screen.getByRole('dialog', { name: 'Kultur verknüpfen oder veröffentlichen' })).toBeVisible();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(publicSyncPreviewMock).not.toHaveBeenCalled();
  });

  it('does not pick one of several entries with the same identity', async () => {
    publicCropListMock.mockResolvedValue({ data: { results: [40, 41].map(id => (
      { id, status: 'published', name: 'Tomate', variety: '', crop_species: 1, version: 2 }
    )) } });
    renderWizard(GENERAL_CROP);
    await waitFor(() => expect(publicCropListMock).toHaveBeenCalledWith({ crop_species: 1, page_size: 200 }, expect.any(AbortSignal)));
    expect(screen.getByRole('dialog', { name: 'Kultur verknüpfen oder veröffentlichen' })).toBeVisible();
    expect(publicSyncPreviewMock).not.toHaveBeenCalled();
  });

  it('loads subsequent library pages before deciding that an entry is unique', async () => {
    publicCropListMock.mockImplementation((params) => Promise.resolve({ data: params.page === 2
      ? { results: [{ id: 40, status: 'published', name: 'Tomate', variety: '', crop_species: 1, version: 2 }], next: null }
      : { results: [], next: '/api/public-crops/?page=2' } }));
    renderWizard(GENERAL_CROP);
    await screen.findByRole('dialog', { name: 'Mit vorhandenem Eintrag verknüpfen' });
    expect(publicCropListMock).toHaveBeenCalledWith({ crop_species: 1, page_size: 200, page: 2 }, expect.any(AbortSignal));
    expect(publicSyncPreviewMock).toHaveBeenCalledWith(GENERAL_CROP.id, 40);
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
    await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
    await selectSpeciesOption('Tomate');

    fireEvent.click(await findEnabledPublishButton());

    const viewLink = await screen.findByRole('link', { name: 'Eintrag ansehen' });
    expect(viewLink).toHaveAttribute('href', '/app/crop-library?cropId=55');
  });

  describe('linking a general Kultur to a foreign duplicate', () => {
    const foreignGeneralEntry: PublicCrop = {
      id: 77,
      status: 'published',
      name: 'Tomate',
      variety: '',
      crop_species: 1,
      version: 1,
    };

    const mockBlockingDuplicate = () => {
      publishPreviewMock.mockResolvedValue({
        data: {
          crop_species: { id: 1, name: 'Tomate' },
          original_language_code: 'de',
          available_language_codes: ['de'],
          missing_required_fields: [],
          duplicates: [{ id: 77, name: 'Tomate', variety: '', version: 1, published_at: null, is_mine: false }],
          can_publish: false,
          general_crop_notice: null,
        },
      });
      publicCropGetMock.mockResolvedValue({ data: foreignGeneralEntry });
    };

    it('walks from the blocking warning through the confirmation view to a link submission', async () => {
      mockBlockingDuplicate();
      publicSyncPreviewMock.mockResolvedValue({
        data: {
          public_crop_id: 77,
          public_version: 4,
          requires_moderation: false,
          changes: [
            { field: 'growth_duration_days', local_value: 90, public_value: 80, pushable: true },
            { field: 'notes', local_value: 'Meine Notiz', public_value: '', pushable: true, pinnable: true },
          ],
        },
      });
      const onLinkPublicCrop = vi.fn().mockResolvedValue(true);
      const cropLevelCrop: Crop = { ...GENERAL_CROP, name: 'Tomate' };

      renderWizard(cropLevelCrop, { onLinkPublicCrop });
      await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
      await selectSpeciesOption('Tomate');

      // Disabled while the warning is unresolved, with a tooltip explaining why.
      const blockedButton = await findEnabledPublishButton();
      fireEvent.click(blockedButton);
      const resolveButton = await screen.findByRole('button', { name: 'Warnungen zuerst lösen' });
      expect(resolveButton).toBeDisabled();

      const linkAction = await screen.findByRole('button', { name: 'Mit diesem Eintrag verknüpfen' });
      fireEvent.click(linkAction);

      await screen.findByText('Mit bestehendem Eintrag verknüpfen');
      await waitFor(() => expect(publicCropGetMock).toHaveBeenCalledWith(77));
      expect(screen.getByText(/Allgemeine Werte werden an Sorten vererbt/))
        .toBeInTheDocument();
      await waitFor(() => expect(publicSyncPreviewMock).toHaveBeenCalledWith(cropLevelCrop.id, 77));
      expect(screen.getByText(/Wähle für jeden abweichenden Wert, welcher gelten soll/)).toBeInTheDocument();
      // Both set and different -> library; only the local value set -> mine.
      expect(await screen.findByTestId('public-crop-sync-summary')).toHaveTextContent(
        '1 Wert wird in deine Kultur übernommen, 1 eigener Wert bleibt erhalten.',
      );

      fireEvent.click(within(screen.getByTestId('public-crop-sync-row-notes')).getByRole('radio', { name: 'Nur lokal behalten' }));
      const submitButton = await screen.findByRole('button', { name: 'Verknüpfen und Werte übernehmen' });
      fireEvent.click(submitButton);

      await waitFor(() => expect(onLinkPublicCrop).toHaveBeenCalledWith(expect.objectContaining({
        publicCropId: 77,
        cropSpeciesId: 1,
        originalLanguageCode: 'de',
        baseVersion: 4,
        pullFields: ['growth_duration_days'],
        pushFields: [],
        pinFields: ['notes'],
        varieties: [],
      })));
    });

    it('does not offer co-publication when linking an existing general entry', async () => {
      mockBlockingDuplicate();
      const sorte: Crop = { ...VARIETY_ROMA, name: 'Tomate' };
      const cropLevelCrop: Crop = { ...GENERAL_CROP, name: 'Tomate' };

      renderWizard(cropLevelCrop, { varieties: [sorte] });
      await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
      await selectSpeciesOption('Tomate');

      fireEvent.click(await findEnabledPublishButton());
      fireEvent.click(await screen.findByRole('button', { name: 'Mit diesem Eintrag verknüpfen' }));

      await screen.findByText('Mit bestehendem Eintrag verknüpfen');
      await screen.findByRole('button', { name: 'Verknüpfen und Werte übernehmen' });
      expect(screen.queryByRole('checkbox', { name: /Roma/ })).not.toBeInTheDocument();
    });

    it('returns to the refreshed warning view via "Zurück"', async () => {
      mockBlockingDuplicate();
      const cropLevelCrop: Crop = { ...GENERAL_CROP, name: 'Tomate' };

      renderWizard(cropLevelCrop);
      await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
      await selectSpeciesOption('Tomate');

      fireEvent.click(await findEnabledPublishButton());
      fireEvent.click(await screen.findByRole('button', { name: 'Mit diesem Eintrag verknüpfen' }));
      await screen.findByText('Mit bestehendem Eintrag verknüpfen');

      fireEvent.click(screen.getByRole('button', { name: 'Zurück' }));

      await screen.findByText('Diese Kultur scheint bereits öffentlich vorhanden zu sein. Bitte prüfe zuerst den bestehenden Eintrag:');
      expect(screen.getByRole('button', { name: 'Warnungen zuerst lösen' })).toBeDisabled();
    });
  });

  it('hides the "Existing variety" field and publishes as general for a crop-level crop (no variety)', async () => {
    const cropLevelCrop: Crop = { ...CROP, variety: '' };
    renderWizard(cropLevelCrop);

    await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
    expect(screen.queryByLabelText('Vorhandene Sorte')).not.toBeInTheDocument();
    await selectSpeciesOption('Tomate');

    fireEvent.click(await findEnabledPublishButton());

    await waitFor(() => expect(publishPreviewMock).toHaveBeenCalledWith(
      cropLevelCrop.id,
      expect.objectContaining({ crop_species_id: 1, original_language_code: 'de', publish_as_general: true }),
    ));
  });

  describe('syncing an already linked crop ("Bibliothek aktualisieren")', () => {
    const linkedPublicCrop: PublicCrop = {
      id: 55,
      status: 'published',
      name: 'Bohne',
      display_name: 'Bohne',
      variety: '',
      crop_species: 1,
      version: 6,
    };
    const ownedGeneralCrop: Crop = { ...CROP, variety: '', owned_public_crop_id: 55 };

    beforeEach(() => {
      publicCropGetMock.mockResolvedValue({ data: linkedPublicCrop });
      publicSyncPreviewMock.mockResolvedValue({
        data: {
          public_crop_id: 55,
          public_version: 6,
          requires_moderation: false,
          changes: [
            { field: 'thousand_kernel_weight_g', local_value: 472, public_value: 400, pushable: true },
            { field: 'harvest_duration_days', local_value: 60, public_value: null, pushable: true },
          ],
        },
      });
    });

    it('keeps decisions and the dialog after a name conflict, allowing correction and cancellation', async () => {
      const message = 'Diese Kultur existiert bereits in diesem Projekt.';
      const onClose = vi.fn();
      const onSyncPublicCrop = vi.fn().mockResolvedValue({
        success: false, code: 'crop_name_conflict', error: message,
      });
      renderWizard(ownedGeneralCrop, { onSyncPublicCrop, onClose });
      fireEvent.click(await screen.findByRole('button', { name: 'Alle teilen' }));
      fireEvent.click(screen.getByRole('button', { name: 'Abgleichen' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(onClose).not.toHaveBeenCalled();
      expect(publicSyncPreviewMock).toHaveBeenCalledTimes(1);
      expect(onSyncPublicCrop).toHaveBeenLastCalledWith(expect.objectContaining({
        pullFields: [], pushFields: ['thousand_kernel_weight_g', 'harvest_duration_days'],
      }));
      fireEvent.click(screen.getByRole('button', { name: 'Abgleichen' }));
      await waitFor(() => expect(onSyncPublicCrop).toHaveBeenCalledTimes(2));
      expect(onSyncPublicCrop.mock.calls[1][0]).toEqual(onSyncPublicCrop.mock.calls[0][0]);
      fireEvent.click(screen.getByRole('button', { name: 'Alle aus Bibliothek' }));
      fireEvent.click(screen.getByRole('button', { name: 'Abgleichen' }));
      await waitFor(() => expect(onSyncPublicCrop).toHaveBeenCalledTimes(3));
      expect(onSyncPublicCrop).toHaveBeenLastCalledWith(expect.objectContaining({
        pullFields: ['thousand_kernel_weight_g', 'harvest_duration_days'], pushFields: [],
      }));
      fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('refreshes only a stale public version after a rejected sync', async () => {
      const onSyncPublicCrop = vi.fn().mockResolvedValue({
        success: false, code: 'stale_public_crop_version', error: 'The library entry changed.',
      });
      renderWizard(ownedGeneralCrop, { onSyncPublicCrop });
      fireEvent.click(await screen.findByRole('button', { name: 'Alle aus Bibliothek' }));
      fireEvent.click(screen.getByRole('button', { name: 'Abgleichen' }));
      await waitFor(() => expect(publicSyncPreviewMock).toHaveBeenCalledTimes(2));
      expect(screen.getByRole('alert')).toHaveTextContent('The library entry changed.');
    });

    it('keeps an already pinned field locally and sends it as a pin', async () => {
      publicSyncPreviewMock.mockResolvedValue({
        data: {
          public_crop_id: 55,
          public_version: 6,
          requires_moderation: false,
          changes: [
            { field: 'thousand_kernel_weight_g', local_value: 472, public_value: 400, pushable: true, pinnable: true },
            {
              field: 'harvest_duration_days', local_value: 60, public_value: 45, pushable: true,
              pinned: true, pinnable: true,
            },
          ],
        },
      });
      const onSyncPublicCrop = vi.fn().mockResolvedValue({ success: true });
      renderWizard(ownedGeneralCrop, { onSyncPublicCrop });

      expect(await screen.findByText('bisher lokal fixiert')).toBeInTheDocument();
      const submit = screen.getByRole('button', { name: 'Abgleichen' });
      await waitFor(() => expect(submit).toBeEnabled());
      fireEvent.click(submit);

      await waitFor(() => expect(onSyncPublicCrop).toHaveBeenCalledWith(expect.objectContaining({
        pullFields: ['thousand_kernel_weight_g'],
        pushFields: [],
        pinFields: ['harvest_duration_days'],
      })));
    });

    it('offers the field-by-field sync instead of pushing every difference', async () => {
      const onSyncPublicCrop = vi.fn().mockResolvedValue({ success: true });
      renderWizard(ownedGeneralCrop, { onSyncPublicCrop });

      expect(await screen.findByText('Mit Kulturbibliothek abgleichen')).toBeInTheDocument();
      await waitFor(() => expect(publicSyncPreviewMock).toHaveBeenCalledWith(ownedGeneralCrop.id, 55));
      expect(screen.queryByRole('combobox', { name: /Offizielle Kulturart/i })).not.toBeInTheDocument();

      fireEvent.click(await screen.findByRole('button', { name: 'Alle aus Bibliothek' }));
      const submit = screen.getByRole('button', { name: 'Abgleichen' });
      await waitFor(() => expect(submit).toBeEnabled());
      fireEvent.click(submit);

      await waitFor(() => expect(onSyncPublicCrop).toHaveBeenCalledWith({
        acceptedPublicLibraryTerms: false,
        publicCropId: 55,
        baseVersion: 6,
        pullFields: ['thousand_kernel_weight_g', 'harvest_duration_days'],
        pushFields: [],
        pinFields: [],
      }));
      expect(publishPreviewMock).not.toHaveBeenCalled();
    });

    it('syncs a crop imported from someone else\'s entry the same way', async () => {
      const onSyncPublicCrop = vi.fn().mockResolvedValue({ success: true });
      renderWizard({ ...CROP, variety: '', source_public_crop: 55 }, { onSyncPublicCrop });

      fireEvent.click(await screen.findByRole('button', { name: 'Alle teilen' }));
      const submit = screen.getByRole('button', { name: 'Abgleichen' });
      await waitFor(() => expect(submit).toBeEnabled());
      fireEvent.click(submit);

      await waitFor(() => expect(onSyncPublicCrop).toHaveBeenCalledWith(expect.objectContaining({
        pullFields: [],
        pushFields: ['thousand_kernel_weight_g', 'harvest_duration_days'],
      })));
    });

    it('asks for the license before pushing values, preselecting the one-sided local value', async () => {
      const onSyncPublicCrop = vi.fn().mockResolvedValue({ success: true });
      renderWizard(ownedGeneralCrop, { onSyncPublicCrop, termsAlreadyAccepted: false });

      const submit = await screen.findByRole('button', { name: 'Abgleichen' });
      await waitFor(() => expect(submit).toBeEnabled());
      fireEvent.click(submit);

      const licenseCheckbox = await screen.findByRole('checkbox', { name: /Lizenz|CC BY-SA|akzeptiere/i });
      expect(onSyncPublicCrop).not.toHaveBeenCalled();
      fireEvent.click(licenseCheckbox);
      fireEvent.click(screen.getByRole('button', { name: 'Abgleichen' }));

      await waitFor(() => expect(onSyncPublicCrop).toHaveBeenCalledWith(expect.objectContaining({
        acceptedPublicLibraryTerms: true,
        pullFields: ['thousand_kernel_weight_g'],
        pushFields: ['harvest_duration_days'],
      })));
    });

    it('explains the disabled button when nothing differs', async () => {
      publicSyncPreviewMock.mockResolvedValue({
        data: { public_crop_id: 55, public_version: 6, requires_moderation: false, changes: [] },
      });
      renderWizard(ownedGeneralCrop);

      expect(await screen.findByText('Keine Abweichungen zum öffentlichen Eintrag.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Abgleichen' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Alle aus Bibliothek' })).not.toBeInTheDocument();
    });
  });

  it('offers publishing or linking again after the library link was removed', async () => {
    // Provenance survives the unlink, but only the sync link decides the flow.
    renderWizard({ ...CROP, variety: '', derived_from_public_crop: 55, origin_type: 'imported' });

    expect(await screen.findByRole('combobox', { name: /Offizielle Kulturart/i })).toBeInTheDocument();
    expect(screen.queryByText('Mit Kulturbibliothek abgleichen')).not.toBeInTheDocument();
    expect(publicSyncPreviewMock).not.toHaveBeenCalled();
  });

  it('keeps staged health mappings on a failed publication and discards them on cancellation', async () => {
    const identity = '00000000-0000-4000-8000-000000000123';
    healthListMock.mockResolvedValue({ data: { results: [{ id: 123, identity_key: identity,
      name: 'Official pathogen', display_name: 'Official pathogen', status: 'published',
      kind: 'pathogen', scientific_name: '', translations: [] }] } });
    const original = { ...CROP, updated_at: '2026-11-17T01:00:00Z',
      plant_health: { entries: [{ name: 'Private pathogen' }] } };
    const onPublish = vi.fn().mockResolvedValue(false);
    const onClose = vi.fn();
    renderWizard(original, { onPublish, onClose });
    await selectSpeciesOption('Tomate');
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Katalogeintrag für „Private pathogen“' }));
    await user.click(await screen.findByRole('option', { name: /^Official pathogen/ }));
    expect(onPublish).not.toHaveBeenCalled();
    await user.click(await findEnabledPublishButton());
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
      cropUpdatedAt: original.updated_at,
      healthMappings: [{ crop_id: CROP.id, expected_updated_at: original.updated_at,
        mappings: [{ local_name: 'Private pathogen', catalogue_identity: identity, catalogue_name: 'Official pathogen' }] }],
    })));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(original.plant_health.entries).toEqual([{ name: 'Private pathogen' }]);
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Abbrechen', exact: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('prefills the species field with the local crop name on open, for crop-level and variety crops', async () => {
    renderWizard();
    expect(await screen.findByDisplayValue('Tomate')).toBeInTheDocument();
  });

  it('has no language summary or language controls', async () => {
    renderWizard();
    await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
    expect(screen.queryByText(/Originalsprache/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Originalsprache')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ändern' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });

  it.each(['de', 'en', 'fr', 'es', 'it', 'pt', 'nl'])('uses UI language %s for a new species proposal and publication', async (language) => {
    await i18n.changeLanguage(language);
    cropSpeciesListMock.mockResolvedValue({ data: { count: 0, results: [] } });
    const onPublish = vi.fn();
    renderWizard(CROP, { onPublish });
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'New species' } });
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('crops:library.speciesPicker.proposeInlineLabel', { name: 'New species' }) }));
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('crops:library.publishWizard.proposeSpeciesSubmit') }));
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({ originalLanguageCode: language })));
    expect(cropSpeciesProposeMock).toHaveBeenCalledWith('New species', language);
    expect(publishPreviewMock).toHaveBeenCalledWith(CROP.id, expect.objectContaining({ original_language_code: language }));
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
    await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
    await selectSpeciesOption('Tomate');

    fireEvent.click(await findEnabledPublishButton());

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

      await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
      expect(screen.getByText(/Wähle die passende Kulturart für/)).toBeInTheDocument();
      expect(screen.queryByText('Sorten mitveröffentlichen')).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('preselects every Sorte and publishes them along with the Kultur', async () => {
      const onPublish = vi.fn();
      renderWizard(GENERAL_CROP, { varieties: [VARIETY_ROMA, VARIETY_OCHSENHERZ], onPublish });

      await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
      expect(screen.getByText(/Wähle die passende Kulturart für/)).toBeInTheDocument();
      // The Sorten-matching lookup only runs once a species is selected.
      await selectSpeciesOption('Tomate');

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

      await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
      await selectSpeciesOption('Tomate');
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

      await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
      await selectSpeciesOption('Tomate');
      await waitFor(() => expect(publicCropListMock).toHaveBeenLastCalledWith(
        { crop_species: 1, page_size: 200 }, expect.any(AbortSignal),
      ));
      await waitFor(() => expect(screen.getAllByText('bereits vorhanden – wird verknüpft')).toHaveLength(1));

      fireEvent.click(await findEnabledPublishButton());

      await waitFor(() => expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
        varieties: [
          { cropId: 2, publicCropId: 40 },
          { cropId: 3, publicCropId: null },
        ],
      })));
    });
    it('warns instead of silently offering every Sorte as new when the library lookup fails', async () => {
      publicCropListMock.mockRejectedValue(new Error('network down'));
      const onPublish = vi.fn();
      renderWizard(GENERAL_CROP, { varieties: [VARIETY_ROMA, VARIETY_OCHSENHERZ], onPublish });

      await screen.findByRole('combobox', { name: /Offizielle Kulturart/i });
      await selectSpeciesOption('Tomate');
      await waitFor(() => expect(screen.getByText(/Der Bibliothekseintrag konnte nicht ermittelt werden/)).toBeInTheDocument());

      expect(await screen.findByRole('button', { name: 'Jetzt veröffentlichen' })).toBeDisabled();
      expect(onPublish).not.toHaveBeenCalled();
      const retry = await screen.findByRole('button', { name: 'Erneut versuchen' });
      publicCropListMock.mockResolvedValue({ data: { results: [] } });
      await userEvent.setup().click(retry);
      fireEvent.click(await findEnabledPublishButton());
      await waitFor(() => expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({
        varieties: [{ cropId: 2, publicCropId: null }, { cropId: 3, publicCropId: null }],
      })));
    });
  });
});
