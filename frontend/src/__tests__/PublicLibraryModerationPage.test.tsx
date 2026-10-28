import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GLOBAL_SNACKBAR_EVENT, type GlobalSnackbarDetail } from '../utils/globalSnackbar';
import PublicLibraryModerationPage from '../crop-library/pages/PublicLibraryModerationPage';

const authUser = vi.hoisted(() => ({
  is_public_library_moderator: true,
  is_staff: true,
  is_superuser: false,
}));

const apiMocks = vi.hoisted(() => ({
  cropSpeciesList: vi.fn(),
  cropSpeciesApprove: vi.fn(),
  cropSpeciesReject: vi.fn(),
  cropSpeciesUpdateTranslations: vi.fn(),
  moderatorRequestList: vi.fn(),
  moderatorRequestApprove: vi.fn(),
  moderatorRequestReject: vi.fn(),
  publicCropList: vi.fn(),
  publicCropRestore: vi.fn(),
  pendingChangeProposals: vi.fn(),
  approveChangeProposal: vi.fn(),
  rejectChangeProposal: vi.fn(),
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ user: authUser }),
}));

vi.mock('../api/api', () => ({
  cropSpeciesAPI: {
    list: apiMocks.cropSpeciesList,
    approve: apiMocks.cropSpeciesApprove,
    reject: apiMocks.cropSpeciesReject,
    updateTranslations: apiMocks.cropSpeciesUpdateTranslations,
  },
  publicLibraryModeratorRequestAPI: {
    list: apiMocks.moderatorRequestList,
    approve: apiMocks.moderatorRequestApprove,
    reject: apiMocks.moderatorRequestReject,
  },
  publicCropAPI: {
    list: apiMocks.publicCropList,
    restore: apiMocks.publicCropRestore,
    pendingChangeProposals: apiMocks.pendingChangeProposals,
    approveChangeProposal: apiMocks.approveChangeProposal,
    rejectChangeProposal: apiMocks.rejectChangeProposal,
  },
}));

describe('PublicLibraryModerationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser.is_public_library_moderator = true;
    authUser.is_staff = true;
    authUser.is_superuser = false;
    // The proposal queue and the alias curation section read the same
    // endpoint; only the queue asks for `status: 'proposed'`, so the alias
    // table stays empty unless a test fills it.
    apiMocks.cropSpeciesList.mockImplementation((params?: { status?: string }) => (
      params?.status === 'proposed'
        ? Promise.resolve({
          data: {
            results: [
              {
                id: 7,
                name: 'Baumspinat',
                status: 'proposed',
                proposed_by_label: 'Mara',
                translations: [{ language_code: 'de', common_name: 'Baumspinat' }],
                similar_species: [{ id: 2, name: 'Spinat', match_type: 'similar' }],
              },
            ],
          },
        })
        : Promise.resolve({ data: { results: [] } })
    ));
    apiMocks.cropSpeciesApprove.mockResolvedValue({ data: { id: 7, name: 'Baumspinat', status: 'published' } });
    apiMocks.cropSpeciesReject.mockResolvedValue({ data: { id: 7, name: 'Baumspinat', status: 'rejected' } });
    apiMocks.moderatorRequestList.mockResolvedValue({
      data: {
        results: [
          {
            id: 3,
            user: 5,
            user_label: 'Jonas',
            motivation: 'Ich möchte helfen.',
            status: 'pending',
            created_at: '2026-07-27T08:00:00Z',
          },
        ],
      },
    });
    apiMocks.moderatorRequestApprove.mockResolvedValue({ data: { id: 3, status: 'approved' } });
    apiMocks.moderatorRequestReject.mockResolvedValue({ data: { id: 3, status: 'rejected' } });
    apiMocks.publicCropList.mockResolvedValue({ data: { results: [] } });
    apiMocks.publicCropRestore.mockResolvedValue({ data: { id: 9, status: 'published' } });
    apiMocks.pendingChangeProposals.mockResolvedValue({
      data: {
        count: 1,
        results: [
          {
            id: 11,
            public_crop: 42,
            public_crop_label: 'Tomate (Roma)',
            kind: 'edit',
            origin_api: true,
            origin_declared_agent: true,
            summary: 'Direct edit awaiting moderation (1 field(s) changed)',
            proposed_data: { growth_duration_days: 55 },
            status: 'pending',
            proposed_by_label: 'Mara',
            created_at: '2026-07-27T08:00:00Z',
          },
        ],
      },
    });
    apiMocks.approveChangeProposal.mockResolvedValue({ data: { id: 11, status: 'approved' } });
    apiMocks.rejectChangeProposal.mockResolvedValue({ data: { id: 11, status: 'rejected' } });
  });

  it('approves a queued crop library contribution with a review note', async () => {
    const user = userEvent.setup();
    render(<PublicLibraryModerationPage />);

    expect(await screen.findByText('Beiträge zur Kulturbibliothek')).toBeInTheDocument();
    expect(screen.getByText('Tomate (Roma)')).toBeInTheDocument();
    expect(screen.getByText('Änderung')).toBeInTheDocument();
    expect(screen.getByText('API-Zugang')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Prüfen' }));

    const dialog = await screen.findByRole('dialog', { name: 'Beitrag prüfen' });
    // The moderator must see what they are approving, not just a summary.
    expect(within(dialog).getByText('55')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Notiz zur Entscheidung/), 'Plausibel.');
    await user.click(within(dialog).getByRole('button', { name: 'Annehmen' }));

    await waitFor(() => expect(apiMocks.approveChangeProposal).toHaveBeenCalledWith(42, 11, 'Plausibel.'));
  });

  it('rejects a queued contribution and reloads the queue', async () => {
    const user = userEvent.setup();
    render(<PublicLibraryModerationPage />);

    await user.click(await screen.findByRole('button', { name: 'Prüfen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Beitrag prüfen' });
    await user.click(within(dialog).getByRole('button', { name: 'Ablehnen' }));

    await waitFor(() => expect(apiMocks.rejectChangeProposal).toHaveBeenCalledWith(42, 11, ''));
    // Two calls: the initial load and the reload after the decision.
    await waitFor(() => expect(apiMocks.pendingChangeProposals).toHaveBeenCalledTimes(2));
  });

  it('shows the new-publish wording for a queued brand-new entry', async () => {
    apiMocks.pendingChangeProposals.mockResolvedValue({
      data: {
        count: 1,
        results: [
          {
            id: 12,
            public_crop: 43,
            public_crop_label: 'Rhabarber (Holsteiner)',
            kind: 'new_publish',
            origin_api: false,
            origin_declared_agent: false,
            summary: 'New publish awaiting moderation',
            // Only the backend's internal plumbing keys, never a field diff.
            proposed_data: { _source_crop_id: 5, _publish_as_general: false },
            status: 'pending',
            proposed_by_label: 'Jonas',
            created_at: '2026-07-27T08:00:00Z',
          },
        ],
      },
    });
    const user = userEvent.setup();
    render(<PublicLibraryModerationPage />);

    expect(await screen.findByText('Neuer Eintrag')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Prüfen' }));

    const dialog = await screen.findByRole('dialog', { name: 'Beitrag prüfen' });
    expect(within(dialog).getByText(/soll neu in die Kulturbibliothek aufgenommen werden/)).toBeInTheDocument();
    // The internal keys must not leak into the moderator's view.
    expect(within(dialog).queryByText(/_source_crop_id/)).not.toBeInTheDocument();
  });

  it('shows an empty state when no contribution is waiting', async () => {
    apiMocks.pendingChangeProposals.mockResolvedValue({ data: { count: 0, results: [] } });
    render(<PublicLibraryModerationPage />);

    expect(await screen.findByText('Keine offenen Beiträge.')).toBeInTheDocument();
  });

  const nameField = (language: string): HTMLElement => screen.getByLabelText(new RegExp(`^Name \\(${language}\\)`));
  const synonymField = (language: string): HTMLElement => screen.getByLabelText(new RegExp(`^Synonyme \\(${language}\\)`));
  const emptyTranslation = (languageCode: string, commonName: string) => ({
    language_code: languageCode, common_name: commonName, synonyms: [], regional_names: {},
  });

  it('reviews crop species proposals and admin moderator requests', async () => {
    const user = userEvent.setup();
    render(<PublicLibraryModerationPage />);

    expect(await screen.findByText('Kulturart-Vorschläge')).toBeInTheDocument();
    expect(screen.getByText('Baumspinat')).toBeInTheDocument();
    expect(screen.getByText('Spinat')).toBeInTheDocument();
    expect(screen.getByText('Moderator-Anfragen')).toBeInTheDocument();
    expect(screen.getByText('Jonas')).toBeInTheDocument();
    const speciesTable = screen.getByRole('table', { name: 'Kulturart-Vorschläge' });
    expect(within(speciesTable).getByLabelText('Deutsch')).toBeInTheDocument();
    expect(within(speciesTable).getByLabelText('Englisch fehlt')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Annehmen' })[0]);

    expect(await screen.findByRole('dialog', { name: 'Kulturart annehmen' })).toBeInTheDocument();
    expect(nameField('Deutsch')).toHaveValue('Baumspinat');
    const approveButtons = screen.getAllByRole('button', { name: 'Annehmen' });
    const approveButton = approveButtons[approveButtons.length - 1];
    expect(approveButton).toBeDisabled();
    await user.hover(approveButton.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Bitte zuerst in jeder Sprache einen Namen eingeben.',
    );

    await user.type(nameField('Englisch'), 'Tree spinach');
    await user.type(nameField('Französisch'), 'Chénopode géant');
    expect(approveButton).toBeDisabled();
    await user.type(nameField('Spanisch'), 'Cenizo gigante');
    await user.click(approveButton);

    await waitFor(() => expect(apiMocks.cropSpeciesApprove).toHaveBeenCalledWith(7, '', [
      emptyTranslation('de', 'Baumspinat'),
      emptyTranslation('en', 'Tree spinach'),
      emptyTranslation('fr', 'Chénopode géant'),
      emptyTranslation('es', 'Cenizo gigante'),
    ]));
  });

  it('prefills the English approval field for an English species proposal', async () => {
    const user = userEvent.setup();
    apiMocks.cropSpeciesList.mockResolvedValue({
      data: {
        results: [
          {
            id: 8,
            name: 'Tree onion',
            status: 'proposed',
            proposed_by_label: 'Mara',
            translations: [{ language_code: 'en', common_name: 'Tree onion' }],
            similar_species: [],
          },
        ],
      },
    });

    render(<PublicLibraryModerationPage />);

    const speciesTable = await screen.findByRole('table', { name: 'Kulturart-Vorschläge' });
    await user.click(within(speciesTable).getByRole('button', { name: 'Annehmen' }));

    expect(nameField('Englisch')).toHaveValue('Tree onion');
    expect(nameField('Deutsch')).toHaveValue('');

    await user.type(nameField('Deutsch'), 'Baumzwiebel');
    await user.type(nameField('Französisch'), 'Oignon rocambole');
    await user.type(nameField('Spanisch'), 'Cebolla egipcia');
    const approveButtons = screen.getAllByRole('button', { name: 'Annehmen' });
    await user.click(approveButtons[approveButtons.length - 1]);

    await waitFor(() => expect(apiMocks.cropSpeciesApprove).toHaveBeenCalledWith(8, '', [
      emptyTranslation('de', 'Baumzwiebel'),
      emptyTranslation('en', 'Tree onion'),
      emptyTranslation('fr', 'Oignon rocambole'),
      emptyTranslation('es', 'Cebolla egipcia'),
    ]));
  });

  it('shows and sends the stored synonyms and regional names of every language', async () => {
    const user = userEvent.setup();
    apiMocks.cropSpeciesList.mockResolvedValue({
      data: {
        results: [
          {
            id: 9,
            name: 'Erdmandel',
            scientific_name: 'Cyperus esculentus',
            family: 'Cyperaceae',
            status: 'proposed',
            proposed_by_label: 'Mara',
            translations: [
              {
                language_code: 'de', common_name: 'Erdmandel', synonyms: ['Tigernuss'],
                regional_names: { switzerland: 'Erdmandeli' },
              },
              { language_code: 'en', common_name: 'Tiger nut', synonyms: ['Chufa'], regional_names: {} },
              { language_code: 'fr', common_name: 'Souchet comestible', synonyms: [], regional_names: {} },
              { language_code: 'es', common_name: 'Chufa', synonyms: ['Juncia avellanada'], regional_names: {} },
            ],
            similar_species: [],
          },
        ],
      },
    });

    render(<PublicLibraryModerationPage />);

    const speciesTable = await screen.findByRole('table', { name: 'Kulturart-Vorschläge' });
    expect(within(speciesTable).getByText('Cyperus esculentus')).toBeInTheDocument();
    for (const language of ['Deutsch', 'Englisch', 'Französisch', 'Spanisch']) {
      expect(within(speciesTable).getByLabelText(language)).toBeInTheDocument();
    }
    await user.click(within(speciesTable).getByRole('button', { name: 'Annehmen' }));

    expect(screen.getByText('Cyperus esculentus · Cyperaceae')).toBeInTheDocument();
    expect(nameField('Spanisch')).toHaveValue('Chufa');
    expect(synonymField('Deutsch')).toHaveValue('Tigernuss');
    expect(screen.getByLabelText('Name in der Schweiz')).toHaveValue('Erdmandeli');

    await user.type(synonymField('Deutsch'), ', Chufa');
    await user.type(screen.getByLabelText('Name in Österreich'), 'Erdmandel');
    const approveButtons = screen.getAllByRole('button', { name: 'Annehmen' });
    await user.click(approveButtons[approveButtons.length - 1]);

    await waitFor(() => expect(apiMocks.cropSpeciesApprove).toHaveBeenCalledWith(9, '', [
      {
        language_code: 'de', common_name: 'Erdmandel', synonyms: ['Tigernuss', 'Chufa'],
        regional_names: { switzerland: 'Erdmandeli', austria: 'Erdmandel' },
      },
      { language_code: 'en', common_name: 'Tiger nut', synonyms: ['Chufa'], regional_names: {} },
      { language_code: 'fr', common_name: 'Souchet comestible', synonyms: [], regional_names: {} },
      { language_code: 'es', common_name: 'Chufa', synonyms: ['Juncia avellanada'], regional_names: {} },
    ]));
  });

  it('approves several complete proposals at once and reports failures per species', async () => {
    const user = userEvent.setup();
    const snackbars: GlobalSnackbarDetail[] = [];
    const recordSnackbar = (event: Event) => snackbars.push((event as CustomEvent<GlobalSnackbarDetail>).detail);
    window.addEventListener(GLOBAL_SNACKBAR_EVENT, recordSnackbar);
    const complete = (id: number, de: string, en: string, synonyms: string[] = []) => ({
      id,
      name: de,
      status: 'proposed',
      proposed_by_label: 'Mara',
      translations: [
        { language_code: 'de', common_name: de, synonyms, regional_names: {} },
        { language_code: 'en', common_name: en, synonyms: [], regional_names: {} },
        { language_code: 'fr', common_name: `${en} (fr)`, synonyms: [], regional_names: {} },
        { language_code: 'es', common_name: `${en} (es)`, synonyms: [], regional_names: {} },
      ],
      similar_species: [],
    });
    apiMocks.cropSpeciesList.mockImplementation((params?: { status?: string }) => Promise.resolve({
      data: {
        results: params?.status === 'proposed'
          ? [
            complete(11, 'Erdmandel', 'Tiger nut', ['Tigernuss']),
            complete(12, 'Akelei', 'Columbine'),
            {
              id: 13, name: 'Baumspinat', status: 'proposed', proposed_by_label: 'Mara',
              translations: [{ language_code: 'de', common_name: 'Baumspinat' }], similar_species: [],
            },
          ]
          : [],
      },
    }));
    apiMocks.cropSpeciesApprove.mockImplementation((id: number) => (
      id === 12 ? Promise.reject(new Error('duplicate')) : Promise.resolve({ data: { id, status: 'published' } })
    ));

    try {
      render(<PublicLibraryModerationPage />);
      const speciesTable = await screen.findByRole('table', { name: 'Kulturart-Vorschläge' });
      expect(within(speciesTable).getByRole('checkbox', { name: '„Baumspinat“ auswählen' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '0 ausgewählte annehmen' })).toBeDisabled();

      await user.click(within(speciesTable).getByRole('checkbox', { name: 'Alle vollständigen Vorschläge auswählen' }));
      expect(within(speciesTable).getByRole('checkbox', { name: '„Erdmandel“ auswählen' })).toBeChecked();
      expect(within(speciesTable).getByRole('checkbox', { name: '„Akelei“ auswählen' })).toBeChecked();
      expect(within(speciesTable).getByRole('checkbox', { name: '„Baumspinat“ auswählen' })).not.toBeChecked();

      await user.click(screen.getByRole('button', { name: '2 ausgewählte annehmen' }));
      const confirmDialog = await screen.findByRole('dialog', { name: 'Kulturarten annehmen' });
      expect(within(confirmDialog).getByText('Erdmandel')).toBeInTheDocument();
      expect(within(confirmDialog).getByText('Akelei')).toBeInTheDocument();
      expect(within(confirmDialog).queryByText('Baumspinat')).not.toBeInTheDocument();
      await user.click(within(confirmDialog).getByRole('button', { name: 'Annehmen' }));

      await waitFor(() => expect(apiMocks.cropSpeciesApprove).toHaveBeenCalledTimes(2));
      expect(apiMocks.cropSpeciesApprove).toHaveBeenCalledWith(11, '', [
        { language_code: 'de', common_name: 'Erdmandel', synonyms: ['Tigernuss'], regional_names: {} },
        { language_code: 'en', common_name: 'Tiger nut', synonyms: [], regional_names: {} },
        { language_code: 'fr', common_name: 'Tiger nut (fr)', synonyms: [], regional_names: {} },
        { language_code: 'es', common_name: 'Tiger nut (es)', synonyms: [], regional_names: {} },
      ]);
      await waitFor(() => expect(snackbars).toContainEqual(expect.objectContaining({
        severity: 'error',
        message: '1 Kulturart angenommen, 1 fehlgeschlagen: Akelei',
      })));
      // The failed proposal is still in the queue and stays selected for a retry.
      const reloadedTable = await screen.findByRole('table', { name: 'Kulturart-Vorschläge' });
      expect(within(reloadedTable).getByRole('checkbox', { name: '„Akelei“ auswählen' })).toBeChecked();
    } finally {
      window.removeEventListener(GLOBAL_SNACKBAR_EVENT, recordSnackbar);
    }
  });

  const erdmandelProposal = {
    id: 21,
    name: 'Erdmandel',
    status: 'proposed',
    proposed_by_label: 'Mara',
    translations: [
      {
        language_code: 'de', common_name: 'Erdmandel', synonyms: ['Tigernuss', 'Chufa'],
        regional_names: { switzerland: 'Erdmandeli' },
      },
      { language_code: 'en', common_name: 'Tiger nut', synonyms: [], regional_names: {} },
      { language_code: 'fr', common_name: 'Souchet comestible', synonyms: ['Amande de terre'], regional_names: {} },
    ],
    similar_species: [],
  };

  it('shows the translation of a language in the tooltip of its chip', async () => {
    const user = userEvent.setup();
    window.localStorage.removeItem('moderationSpeciesAllLanguages');
    apiMocks.cropSpeciesList.mockImplementation((params?: { status?: string }) => Promise.resolve({
      data: { results: params?.status === 'proposed' ? [erdmandelProposal] : [] },
    }));
    render(<PublicLibraryModerationPage />);

    const speciesTable = await screen.findByRole('table', { name: 'Kulturart-Vorschläge' });
    await user.hover(within(speciesTable).getByLabelText('Französisch'));
    const frenchTooltip = await screen.findByRole('tooltip');
    expect(frenchTooltip).toHaveTextContent('Souchet comestible');
    expect(frenchTooltip).toHaveTextContent('Synonyme: Amande de terre');
    await user.unhover(within(speciesTable).getByLabelText('Französisch'));

    await user.hover(within(speciesTable).getByLabelText('Deutsch'));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Name in der Schweiz: Erdmandeli'));
    await user.unhover(within(speciesTable).getByLabelText('Deutsch'));

    await user.hover(within(speciesTable).getByLabelText('Spanisch fehlt'));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Spanisch fehlt'));
  });

  it('switches the proposal table to one column per language and remembers the choice', async () => {
    const user = userEvent.setup();
    window.localStorage.removeItem('moderationSpeciesAllLanguages');
    apiMocks.cropSpeciesList.mockImplementation((params?: { status?: string }) => Promise.resolve({
      data: { results: params?.status === 'proposed' ? [erdmandelProposal] : [] },
    }));
    const { unmount } = render(<PublicLibraryModerationPage />);

    const speciesTable = await screen.findByRole('table', { name: 'Kulturart-Vorschläge' });
    expect(within(speciesTable).getByRole('columnheader', { name: 'Sprachen' })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Alle Sprachen anzeigen' }));

    for (const language of ['Deutsch', 'Englisch', 'Französisch', 'Spanisch']) {
      expect(within(speciesTable).getByRole('columnheader', { name: language })).toBeInTheDocument();
    }
    expect(within(speciesTable).queryByRole('columnheader', { name: 'Sprachen' })).not.toBeInTheDocument();
    expect(within(speciesTable).getByText('Souchet comestible')).toBeInTheDocument();
    expect(within(speciesTable).getByText('Synonyme: Tigernuss, Chufa')).toBeInTheDocument();
    expect(within(speciesTable).getByText('Name in der Schweiz: Erdmandeli')).toBeInTheDocument();
    expect(within(speciesTable).getByText('fehlt')).toBeInTheDocument();
    expect(window.localStorage.getItem('moderationSpeciesAllLanguages')).toBe('true');

    unmount();
    render(<PublicLibraryModerationPage />);
    const reloadedTable = await screen.findByRole('table', { name: 'Kulturart-Vorschläge' });
    expect(within(reloadedTable).getByRole('columnheader', { name: 'Spanisch' })).toBeInTheDocument();
    window.localStorage.removeItem('moderationSpeciesAllLanguages');
  });

  it('lists removed public crops and restores one', async () => {
    const user = userEvent.setup();
    apiMocks.publicCropList.mockResolvedValue({
      data: {
        results: [
          {
            id: 9,
            name: 'Tomate',
            variety: 'Roma',
            status: 'removed',
            removal_reason: 'duplicate',
            updated_at: '2026-07-27T08:00:00Z',
          },
        ],
      },
    });
    render(<PublicLibraryModerationPage />);

    expect(await screen.findByText('Entfernte Kulturen')).toBeInTheDocument();
    expect(apiMocks.publicCropList).toHaveBeenCalledWith({ status: 'removed' });
    expect(screen.getByText('Tomate · Roma')).toBeInTheDocument();
    expect(screen.getByText('Duplikat')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Wiederherstellen' }));

    await waitFor(() => expect(apiMocks.publicCropRestore).toHaveBeenCalledWith(9));
  });

  it('shows an empty state when there are no removed public crops', async () => {
    render(<PublicLibraryModerationPage />);

    expect(await screen.findByText('Entfernte Kulturen')).toBeInTheDocument();
    expect(screen.getByText('Keine entfernten Kulturen.')).toBeInTheDocument();
  });

  it('edits the search aliases of a published crop species', async () => {
    const potato = {
      id: 12,
      name: 'Kartoffel',
      display_name: 'Kartoffel',
      status: 'published',
      translations: [
        {
          language_code: 'de',
          common_name: 'Kartoffel',
          synonyms: ['Erdapfel'],
          regional_names: {},
        },
      ],
    };
    apiMocks.cropSpeciesList.mockImplementation((params?: { status?: string }) => (
      params?.status === 'proposed'
        ? Promise.resolve({ data: { results: [] } })
        : Promise.resolve({ data: { results: [potato] } })
    ));
    apiMocks.cropSpeciesUpdateTranslations.mockResolvedValue({
      data: {
        ...potato,
        translations: [{
          language_code: 'de',
          common_name: 'Kartoffel',
          synonyms: ['Erdapfel', 'Grundbirne'],
          regional_names: {},
        }],
      },
    });

    render(<PublicLibraryModerationPage />);

    const aliasSection = await screen.findByRole('table', { name: 'Kulturart-Synonyme' });
    expect(within(aliasSection).getByText('Kartoffel')).toBeInTheDocument();
    expect(within(aliasSection).getByText('Erdapfel')).toBeInTheDocument();

    await userEvent.click(within(aliasSection).getByRole('button', { name: 'Synonyme bearbeiten' }));

    const aliasField = await screen.findByLabelText('Synonyme (Deutsch)');
    expect(aliasField).toHaveValue('Erdapfel');
    await userEvent.type(aliasField, ', Grundbirne');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(apiMocks.cropSpeciesUpdateTranslations).toHaveBeenCalledWith(12, [{
        language_code: 'de',
        common_name: 'Kartoffel',
        synonyms: ['Erdapfel', 'Grundbirne'],
        regional_names: {},
      }]);
    });
    await waitFor(() => {
      expect(screen.queryByLabelText('Synonyme (Deutsch)')).not.toBeInTheDocument();
    });
  });

  it('hides moderator request management from non-admin moderators', async () => {
    authUser.is_staff = false;
    render(<PublicLibraryModerationPage />);

    expect(await screen.findByText('Kulturart-Vorschläge')).toBeInTheDocument();
    expect(screen.queryByText('Moderator-Anfragen')).not.toBeInTheDocument();
    expect(apiMocks.moderatorRequestList).not.toHaveBeenCalled();
  });
});
