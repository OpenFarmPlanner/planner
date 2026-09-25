import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ReactElement } from 'react';
import type { AxiosError } from 'axios';
import Crops from '../pages/Crops';
import { CommandProvider } from '../commands/CommandProvider';
import { FocusManagerProvider } from '../focus/FocusManager';

const {
  detailLoadingHistory,
  listMock,
  locationListMock,
  fieldListMock,
  bedListMock,
  cropSpeciesListMock,
  publishPreviewMock,
  publicCropListMock,
  publicCropGetMock,
  publicCropImportToProjectMock,
  publishPublicMock,
  publicSyncPreviewMock,
  publicSyncMock,
  deletePreviewMock,
  deleteMock,
  undeleteMock,
  refreshUserMock,
  authUser,
} = vi.hoisted(() => ({
  detailLoadingHistory: [] as boolean[],
  listMock: vi.fn(),
  locationListMock: vi.fn(),
  fieldListMock: vi.fn(),
  bedListMock: vi.fn(),
  cropSpeciesListMock: vi.fn(),
  publishPreviewMock: vi.fn(),
  publicCropListMock: vi.fn(),
  publicCropGetMock: vi.fn(),
  publicCropImportToProjectMock: vi.fn(),
  publishPublicMock: vi.fn(),
  publicSyncPreviewMock: vi.fn(),
  publicSyncMock: vi.fn(),
  deletePreviewMock: vi.fn(),
  deleteMock: vi.fn(),
  undeleteMock: vi.fn(),
  refreshUserMock: vi.fn(),
  authUser: {
    id: 1,
    email: 'tester@example.com',
    display_name: 'Tester',
    is_staff: false,
    is_superuser: false,
    public_library_terms_accepted: false,
  },
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    cropAPI: {
      ...actual.cropAPI,
      list: listMock,
      publishPreview: publishPreviewMock,
      publishPublic: publishPublicMock,
      publicSyncPreview: publicSyncPreviewMock,
      publicSync: publicSyncMock,
      deletePreview: deletePreviewMock,
      delete: deleteMock,
      undelete: undeleteMock,
    },
    locationAPI: {
      ...actual.locationAPI,
      list: locationListMock,
    },
    fieldAPI: {
      ...actual.fieldAPI,
      list: fieldListMock,
    },
    bedAPI: {
      ...actual.bedAPI,
      list: bedListMock,
    },
    cropSpeciesAPI: {
      ...actual.cropSpeciesAPI,
      list: cropSpeciesListMock,
      propose: vi.fn(),
    },
    publicCropAPI: {
      ...actual.publicCropAPI,
      list: publicCropListMock,
      get: publicCropGetMock,
      importToProject: publicCropImportToProjectMock,
    },
  };
});

interface CropDetailMockCrop {
  id?: number;
  name: string;
  variety?: string;
  cultivation_type?: string;
  owned_public_crop_id?: number | null;
  owned_public_crop_role?: 'contributor' | 'moderator' | null;
}

vi.mock('../crops/CropDetail', () => ({
  CropDetail: ({
    crops,
    onCropSelect,
    onCreateCrop,
    onCreatePlan,
    onPublishCrop,
    onEditCrop,
    onDeleteCrop,
    canCreatePlan,
    selectedCropId,
    isLoading,
  }: {
    crops: Array<CropDetailMockCrop>;
    onCropSelect: (crop: { id?: number; name: string } | null) => void;
    onCreateCrop?: () => void;
    onCreatePlan?: () => void;
    onPublishCrop?: () => void;
    onEditCrop?: (crop: { id?: number; name: string }) => void;
    onDeleteCrop?: (crop: { id?: number; name: string; variety?: string; cultivation_type?: string }) => void;
    canCreatePlan?: boolean;
    selectedCropId?: number;
    isLoading?: boolean;
  }): ReactElement => {
    detailLoadingHistory.push(Boolean(isLoading));

    return (
      <div data-testid="crop-detail-mock">
        <span data-testid="selected-crop-id">{selectedCropId ?? 'none'}</span>
        {crops.map((crop) => (
          <span key={crop.id} data-testid={`crop-row-${crop.id}`}>{crop.name}</span>
        ))}
        <button type="button" onClick={() => onCreateCrop?.()}>Kultur hinzufügen</button>
        <button type="button" onClick={() => onPublishCrop?.()}>Veröffentlichen</button>
        <button type="button" onClick={() => onCreatePlan?.()} disabled={!canCreatePlan}>Anbauplan erstellen</button>
        <button type="button" onClick={() => onEditCrop?.(crops[0])}>Kultur bearbeiten</button>
        <button type="button" onClick={() => onDeleteCrop?.(crops[0])}>Kultur löschen</button>
        <button type="button" onClick={() => onCropSelect(crops[0] ?? null)}>select-crop</button>
      </div>
    );
  },
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    user: authUser,
    refreshUser: refreshUserMock,
  }),
}));

vi.mock('../hooks/useProjectRequirement', () => ({
  useProjectRequirement: () => ({
    shouldShowProjectRequiredState: false,
    missingProjectReason: null,
  }),
}));

function renderCrops(initialPath = '/crops'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/crops"
          element={(
            <FocusManagerProvider><CommandProvider><Crops /></CommandProvider></FocusManagerProvider>
          )}
        />
      </Routes>
    </MemoryRouter>
  );
}

const waitForDeleteDialogToClose = async (): Promise<void> => {
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Projektkultur löschen?' })).not.toBeInTheDocument();
  });
};

describe('Crops action area', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detailLoadingHistory.length = 0;
    authUser.public_library_terms_accepted = false;
    authUser.is_staff = false;
    authUser.is_superuser = false;
    refreshUserMock.mockResolvedValue(authUser);

    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          { id: 1, name: 'Tomate', variety: 'Roma', crop_species: 1, cultivation_type: 'pre_cultivation', growth_duration_days: 1, harvest_duration_days: 1 },
        ],
      },
    });
    deleteMock.mockResolvedValue(undefined);
    undeleteMock.mockResolvedValue({ data: { id: 1, name: 'Tomate', variety: 'Roma' } });

    publicCropListMock.mockResolvedValue({
      data: {
        count: 0,
        next: null,
        previous: null,
        results: [],
      },
    });
    publicCropGetMock.mockResolvedValue({
      data: {
        id: 77,
        name: 'Tomate',
        variety: 'Roma',
        status: 'published',
        version: 1,
        crop_species: 1,
        crop_species_name: 'Tomate',
        original_language_code: 'de',
        growth_duration_days: 1,
        harvest_duration_days: 1,
      },
    });
    publicCropImportToProjectMock.mockResolvedValue({
      data: {
        operation: 'created',
        crop: { id: 42, name: 'Salat', variety: 'Maikönig', growth_duration_days: 45, harvest_duration_days: 10 },
      },
    });
    locationListMock.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hof' }] } });
    fieldListMock.mockResolvedValue({ data: { results: [{ id: 1, name: 'Parzelle A', location: 1 }] } });
    bedListMock.mockResolvedValue({ data: { results: [{ id: 1, name: 'Beet A', field: 1 }] } });
    cropSpeciesListMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 1, name: 'Tomate', status: 'published' }],
      },
    });
    publishPreviewMock.mockResolvedValue({
      data: {
        crop_species: { id: 1, name: 'Tomate' },
        original_language_code: 'de',
        available_language_codes: ['de'],
        missing_required_fields: [],
        duplicates: [],
        can_publish: true,
      },
    });
    publishPublicMock.mockResolvedValue({
      data: {
        operation: 'created',
        public_crop: { id: 99, name: 'Tomate', version: 1, status: 'published' },
        duplicates: [],
      },
    });
    deletePreviewMock.mockResolvedValue({
      data: {
        crop_ids: [1],
        varieties: [{ id: 1, name: 'Roma' }],
        variety_count: 1,
        planning_data_count: 0,
        deletes_general_crop: false,
        group_without_general: true,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not render a public library shortcut in the crops action area', async () => {
    renderCrops('/crops?cropId=1');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Kultur hinzufügen' })).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Kulturbibliothek' })).not.toBeInTheDocument();
  });

  it('keeps public crop API idle when no public-library button is rendered', async () => {
    renderCrops();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Kultur hinzufügen' })).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Kulturbibliothek' })).not.toBeInTheDocument();
    expect(publicCropListMock).not.toHaveBeenCalled();
  });

  it('shows duplicate publish warning when backend returns conflict', async () => {
    const duplicateError = {
      isAxiosError: true,
      response: {
        status: 409,
        data: {
          code: 'duplicate_public_crop',
          detail: 'A similar public crop already exists.',
          duplicates: [{ id: 4, name: 'Tomate', variety: 'Roma', version: 1 }],
        },
      },
    } as AxiosError;
    publishPublicMock.mockRejectedValue(duplicateError);

    renderCrops();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Veröffentlichen' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Veröffentlichen' }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Kultur veröffentlichen');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Jetzt veröffentlichen' }));
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: /CC BY-SA 4\.0/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Jetzt veröffentlichen' }));

    await waitFor(() => {
      expect(publishPublicMock).toHaveBeenCalledWith(1, { accepted_public_library_terms: true, crop_species_id: 1, original_language_code: 'de' });
      expect(screen.getByText('Diese Kultur ist bereits öffentlich vorhanden: Tomate (Roma)')).toBeInTheDocument();
    });
    expect(refreshUserMock).not.toHaveBeenCalled();
  });

  it('shows a lightweight publishing dialog and delays license details until publishing', async () => {
    renderCrops();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Veröffentlichen' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Veröffentlichen' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Kultur veröffentlichen')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Offizielle Kulturart/)).toBeInTheDocument();
    // "Original language" is collapsed to a summary + change link by
    // default (it's pre-set to the app's current language), not an
    // always-visible required field.
    expect(within(dialog).queryByLabelText('Originalsprache')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Originalsprache: /)).toBeInTheDocument();
    expect(within(dialog).queryByText('Zusammenfassung')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Pflichtfelder')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Dublettenprüfung')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox', { name: /CC BY-SA 4\.0/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Jetzt veröffentlichen' })).toBeEnabled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Jetzt veröffentlichen' }));
    expect(await within(dialog).findByRole('checkbox', { name: /CC BY-SA 4\.0/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Jetzt veröffentlichen' })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /CC BY-SA 4\.0/ }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Jetzt veröffentlichen' })).toBeEnabled());
    expect(publishPublicMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(publishPublicMock).not.toHaveBeenCalled();
  });

  it('still runs the publishing wizard after the current public-library terms were already accepted', async () => {
    authUser.public_library_terms_accepted = true;
    renderCrops();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Veröffentlichen' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Veröffentlichen' }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Jetzt veröffentlichen' })).toBeEnabled());
    expect(within(dialog).queryByRole('checkbox', { name: /CC BY-SA 4\.0/ })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Jetzt veröffentlichen' }));

    await waitFor(() => {
      expect(publishPublicMock).toHaveBeenCalledWith(1, { accepted_public_library_terms: false, crop_species_id: 1, original_language_code: 'de' });
      expect(listMock).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps the crop list rendered across the refetch that follows publishing', async () => {
    authUser.public_library_terms_accepted = true;
    // The refetch triggered by publishing is held open, so the render pass
    // while it is in flight is observable: putting the page back into its
    // loading state there unmounts the crop list and resets its scroll
    // position.
    let resolveRefetch = (): void => {};

    renderCrops();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Veröffentlichen' })).toBeInTheDocument();
    });

    // Captured after the initial load, so the held-open refetch resolves with
    // the same rows the list is already showing instead of an empty payload.
    const refetchResponse = await listMock.mock.results[0]?.value;
    expect(refetchResponse).toBeDefined();

    listMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRefetch = () => resolve(refetchResponse);
    }));
    detailLoadingHistory.length = 0;

    fireEvent.click(screen.getByRole('button', { name: 'Veröffentlichen' }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Jetzt veröffentlichen' })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Jetzt veröffentlichen' }));

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2);
    });

    expect(detailLoadingHistory).not.toContain(true);
    expect(screen.getByTestId('crop-detail-mock')).toBeInTheDocument();
    expect(screen.getByTestId('crop-row-1')).toBeInTheDocument();

    await act(async () => {
      resolveRefetch();
    });

    expect(detailLoadingHistory).not.toContain(true);
    expect(screen.getByTestId('crop-row-1')).toBeInTheDocument();
  });

  it('preselects the official crop species when the crop name matches', async () => {
    authUser.public_library_terms_accepted = true;
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          { id: 32, name: 'Gurke', variety: 'Arola', cultivation_type: 'pre_cultivation', growth_duration_days: 60, harvest_duration_days: 30 },
        ],
      },
    });
    cropSpeciesListMock.mockResolvedValue({
      data: {
        count: 2,
        next: null,
        previous: null,
        results: [
          { id: 1, name: 'Tomate', status: 'published' },
          { id: 12, name: 'Gurke', status: 'published' },
        ],
      },
    });

    renderCrops('/crops?cropId=32');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Veröffentlichen' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Veröffentlichen' }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByRole('combobox', { name: /Offizielle Kulturart/ })).toHaveValue('Gurke');
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Jetzt veröffentlichen' }));

    await waitFor(() => {
      expect(publishPublicMock).toHaveBeenCalledWith(32, {
        accepted_public_library_terms: false,
        crop_species_id: 12,
        original_language_code: 'de',
      });
    });
  });

  it('does not attempt to render public-library entries without a trigger', async () => {
    publicCropListMock.mockResolvedValue({
      data: {
        count: 2,
        next: null,
        previous: null,
        results: [
          { id: 11, name: 'Salat', variety: 'Bijella', status: 'published', version: 1, published_at: '2026-03-10T12:00:00Z' },
          { id: 12, name: ' salat ', variety: ' BIJELLA ', status: 'published', version: 1, published_at: '2026-03-11T12:00:00Z' },
        ],
      },
    });

    renderCrops();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Kultur hinzufügen' })).toBeInTheDocument();
    });

    expect(screen.queryByText('Salat (Bijella)')).not.toBeInTheDocument();
    expect(publicCropListMock).not.toHaveBeenCalled();
  });

  it('closes the import dialog and selects the imported crop after a successful library import', async () => {
    const initialCrop = { id: 1, name: 'Tomate', variety: 'Roma', crop_species: 1, cultivation_type: 'pre_cultivation', growth_duration_days: 1, harvest_duration_days: 1 };
    const importedCrop = { id: 42, name: 'Salat', variety: 'Maikönig', growth_duration_days: 45, harvest_duration_days: 10 };
    listMock
      .mockResolvedValueOnce({
        data: {
          count: 1,
          next: null,
          previous: null,
          results: [initialCrop],
        },
      })
      .mockResolvedValueOnce({
        data: {
          count: 2,
          next: null,
          previous: null,
          results: [initialCrop, importedCrop],
        },
      });
    publicCropListMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          { id: 77, name: 'Salat', variety: 'Maikönig', status: 'published', version: 1, growth_duration_days: 45, harvest_duration_days: 10 },
        ],
      },
    });
    publicCropImportToProjectMock.mockResolvedValue({
      data: {
        operation: 'created',
        crop: importedCrop,
      },
    });

    renderCrops('/crops?library=true');

    const dialog = await screen.findByRole('dialog', { name: 'Aus Kulturbibliothek importieren' });
    fireEvent.click(within(dialog).getByRole('option', { name: 'Salat' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'In Projekt importieren' }));

    await waitFor(() => expect(publicCropImportToProjectMock).toHaveBeenCalledWith(77));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Aus Kulturbibliothek importieren' })).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('selected-crop-id')).toHaveTextContent('42');
    expect(screen.getByTestId('crop-row-42')).toHaveTextContent('Salat');
    expect(screen.getByText('„Salat (Maikönig)“ wurde in dieses Projekt importiert.')).toBeInTheDocument();
  });

  it('keeps the import dialog open and shows the existing error when a library import fails', async () => {
    publicCropListMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          { id: 77, name: 'Salat', variety: 'Maikönig', status: 'published', version: 1, growth_duration_days: 45, harvest_duration_days: 10 },
        ],
      },
    });
    publicCropImportToProjectMock.mockRejectedValue(new Error('network'));

    renderCrops('/crops?library=true');

    const dialog = await screen.findByRole('dialog', { name: 'Aus Kulturbibliothek importieren' });
    fireEvent.click(within(dialog).getByRole('option', { name: 'Salat' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'In Projekt importieren' }));

    await waitFor(() => expect(publicCropImportToProjectMock).toHaveBeenCalledWith(77));
    expect(await within(dialog).findByText('Die öffentliche Kultur konnte nicht importiert werden.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Aus Kulturbibliothek importieren' })).toBeInTheDocument();
  });

  // The dynamic label per library-link state is covered by cropLibraryAction.test.ts;
  // this suite drives the flow through a mocked CropDetail with a plain button.

  it('syncs an owned entry field by field instead of re-running the publishing mapping', async () => {
    authUser.public_library_terms_accepted = true;
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: 1,
            name: 'Tomate',
            variety: 'Roma',
            crop_species: 1,
            growth_duration_days: 2,
            harvest_duration_days: 1,
            owned_public_crop_id: 77,
          },
        ],
      },
    });
    publicCropGetMock.mockResolvedValue({
      data: {
        id: 77,
        name: 'Tomate',
        variety: 'Roma',
        status: 'published',
        version: 1,
        crop_species: 12,
        crop_species_name: 'Tomate',
        original_language_code: 'en',
        growth_duration_days: 1,
        harvest_duration_days: 1,
      },
    });

    publicSyncPreviewMock.mockResolvedValue({
      data: {
        public_crop_id: 77,
        public_version: 1,
        requires_moderation: false,
        changes: [{ field: 'growth_duration_days', local_value: 2, public_value: 1, pushable: true }],
      },
    });
    publicSyncMock.mockResolvedValue({ data: { operation: 'synced', crop: {}, change_proposal: null } });

    renderCrops('/crops?cropId=1');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Veröffentlichen' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Veröffentlichen' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Mit Kulturbibliothek abgleichen')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Offizielle Kulturart/)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Originalsprache')).not.toBeInTheDocument();
    expect(publicCropListMock).not.toHaveBeenCalled();

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Alle meine Werte' }));
    const submit = within(dialog).getByRole('button', { name: 'Abgleichen' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => {
      expect(publicSyncMock).toHaveBeenCalledWith(1, {
        public_crop_id: 77,
        base_version: 1,
        pull_fields: [],
        push_fields: ['growth_duration_days'],
      });
    });
    expect(publishPublicMock).not.toHaveBeenCalled();
  });

  it('does not expose the remove from library action for owned public crops', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: 1,
            name: 'Tomate',
            growth_duration_days: 1,
            harvest_duration_days: 1,
            owned_public_crop_id: 77,
            owned_public_crop_role: 'contributor',
          },
        ],
      },
    });

    renderCrops('/crops?cropId=1');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Veröffentlichen' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Aus Bibliothek entfernen' })).not.toBeInTheDocument();
  });

  it('does not expose hard delete from the standard crop action area', async () => {
    authUser.is_superuser = true;
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          { id: 1, name: 'Tomate', growth_duration_days: 1, harvest_duration_days: 1, owned_public_crop_id: 77 },
        ],
      },
    });

    renderCrops('/crops?cropId=1');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Veröffentlichen' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Aus Bibliothek entfernen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Endgültig löschen' })).not.toBeInTheDocument();
  });

  it('renders a compact crop delete confirmation dialog', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          { id: 1, name: 'Tomate', variety: '', crop_species: 1, cultivation_type: 'pre_cultivation', growth_duration_days: 1, harvest_duration_days: 1 },
        ],
      },
    });
    deletePreviewMock.mockResolvedValue({
      data: {
        crop_ids: [1],
        varieties: [],
        variety_count: 0,
        planning_data_count: 0,
        deletes_general_crop: true,
        group_without_general: false,
      },
    });
    renderCrops('/crops?cropId=1');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Kultur löschen' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Kultur löschen' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Projektkultur löschen?');
    expect(dialog).toHaveTextContent('Möchtest du die Projektkultur „Tomate“ wirklich löschen?');
    expect(dialog).not.toHaveTextContent('Roma');
    expect(dialog).not.toHaveTextContent('Pflanzung');
    expect(dialog).not.toHaveTextContent('8 Sekunden');
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('removes a confirmed variety deletion after server delete and shows undo feedback', async () => {
    renderCrops('/crops?cropId=1');

    await waitFor(() => expect(screen.getByTestId('crop-row-1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Kultur löschen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Löschen' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(1));
    expect(screen.queryByTestId('crop-row-1')).not.toBeInTheDocument();
    expect(screen.getByText('Sorte gelöscht')).toBeInTheDocument();
    await waitForDeleteDialogToClose();
    expect(screen.getByRole('button', { name: 'Rückgängig: Sorte gelöscht' })).toBeInTheDocument();
  });

  it('shows crop-specific undo feedback for deleting a general crop', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          { id: 1, name: 'Tomate', variety: '', crop_species: 1, cultivation_type: 'pre_cultivation', growth_duration_days: 1, harvest_duration_days: 1 },
        ],
      },
    });
    renderCrops('/crops?cropId=1');

    await waitFor(() => expect(screen.getByTestId('crop-row-1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Kultur löschen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Löschen' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(1));
    expect(screen.getByText('Kultur gelöscht')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rückgängig: Kultur gelöscht' })).toBeInTheDocument();
  });

  it('warns and removes sibling varieties when deleting a general crop', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 3,
        next: null,
        previous: null,
        results: [
          { id: 1, name: 'Karotte', variety: '', crop_species: 7, cultivation_type: 'pre_cultivation', growth_duration_days: 1, harvest_duration_days: 1 },
          { id: 2, name: 'Karotte', variety: 'Nantaise 2', crop_species: 7, cultivation_type: 'pre_cultivation', growth_duration_days: 1, harvest_duration_days: 1 },
          { id: 3, name: 'Karotte', variety: 'Milan', crop_species: 7, cultivation_type: 'pre_cultivation', growth_duration_days: 1, harvest_duration_days: 1 },
        ],
      },
    });
    deletePreviewMock.mockResolvedValue({
      data: {
        crop_ids: [1, 2, 3],
        varieties: [{ id: 2, name: 'Nantaise 2' }, { id: 3, name: 'Milan' }],
        variety_count: 2,
        planning_data_count: 2,
        deletes_general_crop: true,
        group_without_general: false,
      },
    });
    renderCrops('/crops?cropId=1');

    await waitFor(() => expect(screen.getByTestId('crop-row-1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Kultur löschen' }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog).toHaveTextContent('„Karotte“ wird mit 2 Sorten gelöscht: Nantaise 2, Milan.');
      expect(dialog).toHaveTextContent('Davon sind 2 Planungsdaten betroffen.');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(1));
    expect(screen.queryByTestId('crop-row-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('crop-row-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('crop-row-3')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rückgängig: Kultur gelöscht' }));

    await waitFor(() => expect(undeleteMock).toHaveBeenCalledWith(1));
    expect(screen.getByTestId('crop-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('crop-row-2')).toBeInTheDocument();
    expect(screen.getByTestId('crop-row-3')).toBeInTheDocument();
  });

  it('labels a variety-only group delete as deleting varieties', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 2,
        next: null,
        previous: null,
        results: [
          { id: 1, name: 'Karotte', variety: 'Nantaise 2', cultivation_type: 'pre_cultivation', growth_duration_days: 1, harvest_duration_days: 1 },
          { id: 2, name: 'Karotte', variety: 'Milan', cultivation_type: 'pre_cultivation', growth_duration_days: 1, harvest_duration_days: 1 },
        ],
      },
    });
    deletePreviewMock.mockResolvedValue({
      data: {
        crop_ids: [1, 2],
        varieties: [{ id: 1, name: 'Nantaise 2' }, { id: 2, name: 'Milan' }],
        variety_count: 2,
        planning_data_count: 0,
        deletes_general_crop: false,
        group_without_general: true,
      },
    });
    renderCrops('/crops?cropId=1');

    await waitFor(() => expect(screen.getByTestId('crop-row-1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Kultur löschen' }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveTextContent('2 Sorten werden gelöscht: Nantaise 2, Milan.'));
    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(1));
    expect(screen.queryByTestId('crop-row-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('crop-row-2')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rückgängig: Sorten gelöscht' })).toBeInTheDocument();
  });

  it('restores a server-deleted crop when undo is clicked', async () => {
    renderCrops('/crops?cropId=1');

    await waitFor(() => expect(screen.getByTestId('crop-row-1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Kultur löschen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(1));
    await waitForDeleteDialogToClose();
    fireEvent.click(screen.getByRole('button', { name: 'Rückgängig: Sorte gelöscht' }));

    await waitFor(() => expect(undeleteMock).toHaveBeenCalledWith(1));
    expect(screen.getByTestId('crop-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('selected-crop-id')).toHaveTextContent('1');
  });

  it('keeps a confirmed crop deletion on the server while the undo snackbar is visible', async () => {
    renderCrops('/crops?cropId=1');

    await waitFor(() => expect(screen.getByTestId('crop-row-1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Kultur löschen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(1));
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Rückgängig: Sorte gelöscht' })).toBeInTheDocument();
  });

  it('keeps selection stable after confirmed delete and restores previous selection on undo', async () => {
    listMock.mockResolvedValue({
      data: {
        count: 2,
        next: null,
        previous: null,
        results: [
          { id: 1, name: 'Tomate', variety: 'Roma', cultivation_type: 'pre_cultivation', growth_duration_days: 1, harvest_duration_days: 1 },
          { id: 2, name: 'Salat', variety: 'Bijella', cultivation_type: 'direct_sowing', growth_duration_days: 1, harvest_duration_days: 1 },
        ],
      },
    });
    renderCrops('/crops?cropId=1');

    await waitFor(() => expect(screen.getByTestId('selected-crop-id')).toHaveTextContent('1'));
    fireEvent.click(screen.getByRole('button', { name: 'Kultur löschen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(1));

    expect(screen.getByTestId('selected-crop-id')).toHaveTextContent('2');

    await waitForDeleteDialogToClose();
    fireEvent.click(screen.getByRole('button', { name: 'Rückgängig: Sorte gelöscht' }));

    await waitFor(() => expect(undeleteMock).toHaveBeenCalledWith(1));
    expect(screen.getByTestId('crop-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('selected-crop-id')).toHaveTextContent('1');
  });

  it('cleans pending crop deletion timers on unmount', async () => {
    const { unmount } = renderCrops('/crops?cropId=1');

    await waitFor(() => expect(screen.getByTestId('crop-row-1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Kultur löschen' }));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    await vi.waitFor(() => expect(deleteMock).toHaveBeenCalledWith(1));
    unmount();
    vi.advanceTimersByTime(8000);

    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it('disables create planting plan button with bed-specific guidance when no beds exist', async () => {
    bedListMock.mockResolvedValue({ data: { results: [] } });
    renderCrops('/crops?cropId=1');

    const createPlanButton = await screen.findByRole('button', { name: 'Anbauplan erstellen' });
    expect(createPlanButton).toBeDisabled();
    const fieldsBedsLink = await screen.findByRole('link', { name: 'Anbauflächen öffnen' });
    expect(fieldsBedsLink).toBeInTheDocument();
    expect(fieldsBedsLink).toHaveAttribute('href', '/app/fields-beds');
    expect(screen.queryByRole('link', { name: 'Beet anlegen' })).not.toBeInTheDocument();

    fireEvent.mouseOver(createPlanButton.parentElement as HTMLElement);
    expect(await screen.findByText('Du brauchst zuerst mindestens ein Beet. Beete werden innerhalb einer Parzelle auf der Seite Anbauflächen hinzugefügt.')).toBeInTheDocument();
  });

  it('enables create planting plan button when all prerequisites are present', async () => {
    renderCrops('/crops?cropId=1');
    const createPlanButton = await screen.findByRole('button', { name: 'Anbauplan erstellen' });
    await waitFor(() => expect(createPlanButton).toBeEnabled());
  });
});
