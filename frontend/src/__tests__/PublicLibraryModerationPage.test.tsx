import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
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
  });

  it('reviews crop species proposals and admin moderator requests', async () => {
    const user = userEvent.setup();
    render(<PublicLibraryModerationPage />);

    expect(await screen.findByText('Kulturart-Vorschläge')).toBeInTheDocument();
    expect(screen.getByText('Baumspinat')).toBeInTheDocument();
    expect(screen.getByText('Spinat')).toBeInTheDocument();
    expect(screen.getByText('Moderator-Anfragen')).toBeInTheDocument();
    expect(screen.getByText('Jonas')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Annehmen' })[0]);

    expect(await screen.findByRole('dialog', { name: 'Kulturart annehmen' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Deutscher Name/)).toHaveValue('Baumspinat');
    const approveButtons = screen.getAllByRole('button', { name: 'Annehmen' });
    const approveButton = approveButtons[approveButtons.length - 1];
    expect(approveButton).toBeDisabled();
    await user.hover(approveButton.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Bitte zuerst den deutschen und englischen Namen eingeben.',
    );

    await user.type(screen.getByLabelText(/Englischer Name/), 'Tree spinach');
    await user.click(approveButton);

    await waitFor(() => expect(apiMocks.cropSpeciesApprove).toHaveBeenCalledWith(7, '', [
      { language_code: 'de', common_name: 'Baumspinat' },
      { language_code: 'en', common_name: 'Tree spinach' },
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

    expect(screen.getByLabelText(/Englischer Name/)).toHaveValue('Tree onion');
    expect(screen.getByLabelText(/Deutscher Name/)).toHaveValue('');

    await user.type(screen.getByLabelText(/Deutscher Name/), 'Baumzwiebel');
    const approveButtons = screen.getAllByRole('button', { name: 'Annehmen' });
    await user.click(approveButtons[approveButtons.length - 1]);

    await waitFor(() => expect(apiMocks.cropSpeciesApprove).toHaveBeenCalledWith(8, '', [
      { language_code: 'de', common_name: 'Baumzwiebel' },
      { language_code: 'en', common_name: 'Tree onion' },
    ]));
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
