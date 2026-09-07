import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Fragment, useState } from 'react';
import { MemoryRouter, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PublicCropLibraryPage from '../crop-library/pages/PublicCropLibraryPage';
import type { PublicCrop, PublicCropDiscussionComment, PublicCropDiscussionTopic } from '../api/types';
import { CommandProvider } from '../commands/CommandProvider';
import { FocusManagerProvider } from '../focus/FocusManager';
import i18n from '../i18n/config';
import { GLOBAL_SNACKBAR_EVENT, type GlobalSnackbarDetail } from '../utils/globalSnackbar';
import type { TopbarContextAction } from '../navigation/topbarTypes';

const publicCropApiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  discussionTopics: vi.fn(),
  discussionComments: vi.fn(),
  createDiscussionTopic: vi.fn(),
  createDiscussionComment: vi.fn(),
  updateDiscussionComment: vi.fn(),
  deleteDiscussionComment: vi.fn(),
  versions: vi.fn(),
  importToProject: vi.fn(),
  update: vi.fn(),
  getTranslations: vi.fn(),
  updateTranslations: vi.fn(),
  remove: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  user: {
    id: 1,
    email: 'test@example.com',
    display_name: 'Test User',
    display_label: 'Test User',
    public_display_name: 'Test User',
    is_active: true,
    default_project_id: 1,
    last_project_id: 1,
    resolved_project_id: 1,
    needs_project_selection: false,
    memberships: [],
    account_pending_deletion: false,
    scheduled_deletion_at: null,
    pending_consents: [],
    public_library_terms_accepted: true,
    is_public_library_moderator: false,
    is_staff: false,
    is_superuser: false,
    is_guest_demo: false,
    guest_demo_session_id: null,
    has_password: true,
  },
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    user: authMocks.user,
  }),
}));

vi.mock('../components/data-grid/RichTextEditor', () => ({
  RichTextEditor: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel?: string;
  }) => (
    <textarea
      data-testid="rich-text-editor"
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    publicCropAPI: {
      ...actual.publicCropAPI,
      list: publicCropApiMocks.list,
      listAll: publicCropApiMocks.list,
      get: publicCropApiMocks.get,
      discussionTopics: publicCropApiMocks.discussionTopics,
      discussionComments: publicCropApiMocks.discussionComments,
      createDiscussionTopic: publicCropApiMocks.createDiscussionTopic,
      createDiscussionComment: publicCropApiMocks.createDiscussionComment,
      updateDiscussionComment: publicCropApiMocks.updateDiscussionComment,
      deleteDiscussionComment: publicCropApiMocks.deleteDiscussionComment,
      versions: publicCropApiMocks.versions,
      importToProject: publicCropApiMocks.importToProject,
      update: publicCropApiMocks.update,
      getTranslations: publicCropApiMocks.getTranslations,
      updateTranslations: publicCropApiMocks.updateTranslations,
      remove: publicCropApiMocks.remove,
    },
  };
});

const publicCrops: PublicCrop[] = [
  {
    id: 1,
    status: 'published',
    name: 'Tomate',
    variety: 'Roma',
    crop_species_name: 'Tomate',
    description: 'Robuste Sorte.',
    description_language_code: 'de',
    notes: 'Robuste Sorte.',
    translations: {
      de: 'Robuste Sorte.',
    },
    growth_duration_days: 70,
    harvest_duration_days: 28,
    display_color: '#7cb342',
    version: 1,
    original_language_code: 'de',
    published_at: '2026-07-23T10:00:00Z',
    created_at: '2026-07-20T08:00:00Z',
    updated_at: '2026-07-27T12:00:00Z',
    imported_crops_count: 3,
  },
  {
    id: 2,
    status: 'published',
    name: 'Salat',
    variety: 'Maikönig',
    crop_species_name: 'Salat',
    growth_duration_days: 45,
    harvest_duration_days: 10,
    version: 1,
    original_language_code: 'de',
    published_at: '2026-07-24T10:00:00Z',
    created_at: '2026-07-21T08:00:00Z',
    updated_at: '2026-07-25T12:00:00Z',
  },
];

function mockMobileViewport(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width:600px') || query.includes('max-width:899.95px'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function mockDesktopViewport(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('min-width:900px'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="current route">{`${location.pathname}${location.search}`}</output>
      <button type="button" onClick={() => navigate(-1)}>Browser zurück</button>
      <button type="button" onClick={() => navigate(1)}>Browser vorwärts</button>
      <button type="button" onClick={() => navigate('/app/dashboard')}>Zur Hauptseite</button>
      <button type="button" onClick={() => navigate('/app/crop-library')}>Zur Kulturbibliothek</button>
    </>
  );
}

function TestAppShell() {
  const [topbarContextActions, setTopbarContextActions] = useState<TopbarContextAction[]>([]);
  const [, setTopbarTitleActions] = useState<TopbarContextAction[]>([]);
  const [openMenuActionId, setOpenMenuActionId] = useState<string | null>(null);
  return (
    <>
      <LocationProbe />
      <header>
        <h1>Kulturbibliothek</h1>
        {topbarContextActions.map((action) => (
          <Fragment key={action.id}>
            <button
              type="button"
              aria-label={action.ariaLabel ?? action.label}
              onClick={() => {
                if (action.menuActions && action.menuActions.length > 0) {
                  setOpenMenuActionId((current) => (current === action.id ? null : action.id));
                } else {
                  action.onClick();
                }
              }}
              disabled={action.disabled}
            >
              {action.label}
            </button>
            {action.menuActions && openMenuActionId === action.id ? (
              <div role="menu">
                {action.menuActions.map((menuAction) => (
                  <button
                    key={menuAction.id}
                    type="button"
                    role="menuitem"
                    onClick={() => { setOpenMenuActionId(null); menuAction.onClick(); }}
                    disabled={menuAction.disabled}
                  >
                    {menuAction.label}
                  </button>
                ))}
              </div>
            ) : null}
          </Fragment>
        ))}
      </header>
      <Outlet context={{ setTopbarContextActions, setTopbarTitleActions }} />
    </>
  );
}

function renderPage(initialEntries: string[] = ['/app/crop-library']): ReturnType<typeof render> {
  return render(
    <FocusManagerProvider>
      <CommandProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/app" element={<TestAppShell />}>
              <Route path="crop-library" element={<PublicCropLibraryPage />} />
              <Route path="public-library-moderation" element={<h1>Moderation</h1>} />
              <Route path="dashboard" element={<h1>Hauptseite</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </CommandProvider>
    </FocusManagerProvider>,
  );
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

const paginated = <T,>(results: T[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

describe('PublicCropLibraryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.user.is_public_library_moderator = false;
    authMocks.user.is_staff = false;
    authMocks.user.is_superuser = false;
    mockDesktopViewport();
    window.localStorage.clear();
    window.history.replaceState({ page: 'crop-library-test' }, '', '/app/crop-library?cropId=1');
    publicCropApiMocks.list.mockResolvedValue(paginated(publicCrops));
    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: [] });
    publicCropApiMocks.discussionComments.mockResolvedValue({ data: [] });
    publicCropApiMocks.versions.mockResolvedValue({ data: [] });
    publicCropApiMocks.update.mockResolvedValue({
      data: {
        ...publicCrops[0],
        growth_duration_days: 48,
        display_color: '#123456',
        version: 2,
      },
    });
    publicCropApiMocks.updateTranslations.mockResolvedValue({
      data: {
        original_language_code: 'de',
        translations: { de: 'Robuste Sorte.', en: 'A robust variety.' },
      },
    });
    publicCropApiMocks.getTranslations.mockResolvedValue({
      data: {
        original_language_code: 'de',
        translations: { de: 'Robuste Sorte.' },
      },
    });
    publicCropApiMocks.get.mockResolvedValue({
      data: {
        ...publicCrops[0],
        description: 'A robust variety.',
        description_language_code: 'en',
        translations: { de: 'Robuste Sorte.', en: 'A robust variety.' },
        version: 2,
      },
    });
    publicCropApiMocks.remove.mockResolvedValue({
      data: { ...publicCrops[0], status: 'removed' },
    });
  });

  it('hides the global moderation action completely for users without moderation rights', async () => {
    renderPage(['/app/crop-library?cropId=1']);

    await screen.findByRole('heading', { level: 2, name: 'Tomate' });
    const cropDetailHeader = screen.getByTestId('public-crop-detail-header');

    expect(screen.getAllByRole('heading', { name: 'Kulturbibliothek' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Moderation' })).not.toBeInTheDocument();
    expect(within(cropDetailHeader).getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
    expect(within(cropDetailHeader).getByRole('button', { name: 'In Projekt importieren' })).toBeInTheDocument();
    expect(within(cropDetailHeader).queryByRole('button', { name: 'Übersetzen' })).not.toBeInTheDocument();
    expect(within(cropDetailHeader).queryByRole('button', { name: 'Aus Bibliothek entfernen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aus Bibliothek entfernen' })).not.toBeInTheDocument();
  });

  it('lets a moderator remove a public crop after selecting a reason', async () => {
    const user = userEvent.setup();
    authMocks.user.is_public_library_moderator = true;
    renderPage(['/app/crop-library?cropId=1']);

    await screen.findByRole('heading', { level: 2, name: 'Tomate' });
    const cropDetailHeader = screen.getByTestId('public-crop-detail-header');

    // The remove action lives inside the "Moderation" menu in the topbar, not
    // in the crop detail header alongside Edit/Import — it's a moderator-only
    // destructive action, kept visually and positionally separate.
    expect(within(cropDetailHeader).queryByRole('button', { name: 'Aus Bibliothek entfernen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Aus Bibliothek entfernen' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Moderation' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Aus Bibliothek entfernen' }));

    const removeDialog = await screen.findByRole('dialog', { name: 'Aus Bibliothek entfernen?' });
    const confirmButton = within(removeDialog).getByRole('button', { name: 'Aus Bibliothek entfernen' });
    expect(confirmButton).toBeDisabled();

    await user.click(within(removeDialog).getByLabelText('Grund'));
    await user.click(await screen.findByRole('option', { name: 'Duplikat' }));
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);

    await waitFor(() => {
      expect(publicCropApiMocks.remove).toHaveBeenCalledWith(1, 'duplicate');
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Aus Bibliothek entfernen?' })).not.toBeInTheDocument();
    });
  });

  it('opens the global moderation interface from the public crop library header for moderators', async () => {
    const user = userEvent.setup();
    authMocks.user.is_public_library_moderator = true;
    renderPage(['/app/crop-library?cropId=1']);

    await screen.findByRole('heading', { level: 2, name: 'Tomate' });
    const cropDetailHeader = screen.getByTestId('public-crop-detail-header');

    expect(screen.getAllByRole('heading', { name: 'Kulturbibliothek' })).toHaveLength(1);
    expect(within(cropDetailHeader).getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
    expect(within(cropDetailHeader).getByRole('button', { name: 'In Projekt importieren' })).toBeInTheDocument();
    expect(within(cropDetailHeader).queryByRole('button', { name: 'Moderation' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Moderation' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Kulturbibliothek moderieren' }));

    expect(screen.getByLabelText('current route')).toHaveTextContent('/app/public-library-moderation');
    expect(screen.getByRole('heading', { name: 'Moderation' })).toBeInTheDocument();
  });

  it('does not show the empty state while public crops are still loading', () => {
    const deferredList = createDeferred<ReturnType<typeof paginated<PublicCrop>>>();
    publicCropApiMocks.list.mockReturnValue(deferredList.promise);

    renderPage();

    expect(screen.getAllByText('Kulturen werden geladen…').length).toBeGreaterThan(0);
    expect(screen.queryByText('Keine öffentlichen Kulturen gefunden.')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Die Kulturbibliothek wächst mit der Community' })).not.toBeInTheDocument();
  });

  it('shows loaded public crops without flashing an empty state first', async () => {
    window.localStorage.setItem('selectedPublicCropId', '1');
    renderPage();

    expect(screen.queryByText('Keine öffentlichen Kulturen gefunden.')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Die Kulturbibliothek wächst mit der Community' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Tomate' })).toBeInTheDocument();
    expect(screen.queryByText('Keine öffentlichen Kulturen gefunden.')).not.toBeInTheDocument();
  });

  it('uses the project seed layout without package sizes in public crop details', async () => {
    publicCropApiMocks.list.mockResolvedValue(paginated([
      {
        id: 10,
        status: 'published',
        name: 'Möhre',
        variety: 'Nantaise',
        crop_species_name: 'Möhre',
        cultivation_types: ['pre_cultivation', 'direct_sowing'],
        seed_rate_direct_value: 0.014,
        seed_rate_direct_unit: 'seeds_per_lfm',
        seed_rate_pre_cultivation_value: 1.357,
        seed_rate_pre_cultivation_unit: 'seeds_per_plant',
        thousand_kernel_weight_g: 1.3,
        seeding_requirement: 4.5,
        seeding_requirement_type: 'per_sqm',
        seed_packages: [{ size_value: 250, size_unit: 'g' }],
        version: 1,
        original_language_code: 'de',
        published_at: '2026-07-24T10:00:00Z',
        created_at: '2026-07-21T08:00:00Z',
        updated_at: '2026-07-25T12:00:00Z',
      },
    ]));

    renderPage(['/app/crop-library?cropId=10']);

    await screen.findByRole('heading', { level: 2, name: 'Möhre' });
    expect(screen.getByText('Saatgutmenge nach Anbauart')).toBeInTheDocument();
    expect(screen.getByText('Methode')).toBeInTheDocument();
    expect(screen.getByText('Menge')).toBeInTheDocument();
    expect(screen.getByText('Einheit')).toBeInTheDocument();
    // The seed safety margin is a farm-specific planning value and must not
    // appear anywhere in the public library.
    expect(screen.queryByText('Sicherheitszuschlag (%)')).not.toBeInTheDocument();
    expect(screen.queryByText('Sicherheitszuschlag Saatgut')).not.toBeInTheDocument();
    expect(screen.getByText('Pflanzung')).toBeInTheDocument();
    expect(screen.getByText('Direktsaat')).toBeInTheDocument();
    expect(screen.getByText('1,357')).toBeInTheDocument();
    expect(screen.getByText('0,014')).toBeInTheDocument();
    expect(screen.getByText('Korn / Pflanze')).toBeInTheDocument();
    expect(screen.getByText('Korn / lfm')).toBeInTheDocument();
    expect(screen.getByText('1000-Korn-Gewicht (g)')).toBeInTheDocument();
    expect(screen.getByText('1,3 g')).toBeInTheDocument();
    expect(screen.getByText('Saatgutbedarf')).toBeInTheDocument();
    expect(screen.getByText('4,5 / m²')).toBeInTheDocument();
    expect(screen.queryByText('Packungsgrößen')).not.toBeInTheDocument();
    expect(screen.queryByText('250 g')).not.toBeInTheDocument();
  });

  it('marks public variety values as from the crop or own values', async () => {
    publicCropApiMocks.list.mockResolvedValue(paginated([
      {
        id: 20,
        status: 'published',
        name: 'Tomate',
        variety: '',
        crop_species: 7,
        crop_species_name: 'Tomate',
        crop_family: 'Nachtschattengewächse',
        nutrient_demand: 'high',
        cultivation_types: ['pre_cultivation'],
        growth_duration_days: 78,
        harvest_duration_days: 56,
        row_spacing_m: 0.80,
        distance_within_row_m: 0.50,
        seed_rate_by_cultivation: {
          pre_cultivation: { value: 1.2, unit: 'seeds_per_plant' },
        },
        thousand_kernel_weight_g: 3.1,
        harvest_method: 'per_plant',
        expected_yield: 4.5,
        version: 1,
        original_language_code: 'de',
        published_at: '2026-07-24T10:00:00Z',
        created_at: '2026-07-21T08:00:00Z',
        updated_at: '2026-07-25T12:00:00Z',
      },
      {
        id: 21,
        status: 'published',
        name: 'Tomate',
        variety: 'Roma',
        crop_species: 7,
        crop_species_name: 'Tomate',
        growth_duration_days: 72,
        row_spacing_m: 0.70,
        thousand_kernel_weight_g: 3.2,
        version: 1,
        original_language_code: 'de',
        published_at: '2026-07-24T10:00:00Z',
        created_at: '2026-07-21T08:00:00Z',
        updated_at: '2026-07-25T12:00:00Z',
      },
    ]));

    renderPage(['/app/crop-library?cropId=21']);

    await screen.findByRole('heading', { level: 2, name: 'Tomate' });
    expect(screen.getAllByText('Roma').length).toBeGreaterThan(0);
    expect(screen.getByText('72 Tage')).toBeInTheDocument();
    expect(screen.getByText('56 Tage')).toBeInTheDocument();
    expect(screen.getByText('1,2 Korn / Pflanze')).toBeInTheDocument();
    expect(screen.getByText('3,2 g')).toBeInTheDocument();
    expect(screen.getByText('Markierte Werte')).toBeInTheDocument();
    expect(screen.getByText('= gelten nur für diese Sorte.')).toBeInTheDocument();
    expect(screen.queryByText('Eigener Wert')).not.toBeInTheDocument();
    expect(screen.queryByText('Aus der Kultur')).not.toBeInTheDocument();
  });

  it('shows the shared varieties overview on public crop species details', async () => {
    const user = userEvent.setup();
    publicCropApiMocks.list.mockResolvedValue(paginated([
      {
        id: 20,
        status: 'published',
        name: 'Tomate',
        variety: '',
        crop_species: 7,
        crop_species_name: 'Tomate',
        growth_duration_days: 78,
        harvest_duration_days: 56,
        thousand_kernel_weight_g: 3.1,
        version: 1,
        original_language_code: 'de',
        published_at: '2026-07-24T10:00:00Z',
        created_at: '2026-07-21T08:00:00Z',
        updated_at: '2026-07-25T12:00:00Z',
      },
      {
        id: 21,
        status: 'published',
        name: 'Tomate',
        variety: 'Roma',
        crop_species: 7,
        crop_species_name: 'Tomate',
        growth_duration_days: 72,
        thousand_kernel_weight_g: 3.2,
        version: 1,
        original_language_code: 'de',
        published_at: '2026-07-24T10:00:00Z',
        created_at: '2026-07-21T08:00:00Z',
        updated_at: '2026-07-25T12:00:00Z',
      },
      {
        id: 22,
        status: 'published',
        name: 'Tomate',
        variety: 'Cherry',
        crop_species: 7,
        crop_species_name: 'Tomate',
        growth_duration_days: 65,
        thousand_kernel_weight_g: 2.8,
        version: 1,
        original_language_code: 'de',
        published_at: '2026-07-24T10:00:00Z',
        created_at: '2026-07-21T08:00:00Z',
        updated_at: '2026-07-25T12:00:00Z',
      },
    ]));

    renderPage(['/app/crop-library?cropId=20']);

    await screen.findByRole('heading', { level: 2, name: 'Tomate' });
    expect(screen.getByRole('heading', { name: 'Sorten' })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Roma')).toBeInTheDocument();
    expect(within(table).getByText('Cherry')).toBeInTheDocument();
    expect(within(table).getByText('72 Tage')).toBeInTheDocument();
    expect(within(table).getByText('2,8 g')).toBeInTheDocument();

    await user.click(within(table).getByText('Cherry'));

    expect(await screen.findByText('65 Tage')).toBeInTheDocument();
    expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=22');
  });

  it('uses the selected public crop title as the mobile selector trigger', async () => {
    mockMobileViewport();
    renderPage(['/app/crop-library?cropId=1']);

    const titleTrigger = await screen.findByRole('button', { name: 'Kultur auswählen' });

    expect(within(titleTrigger).getByText('Tomate')).toBeInTheDocument();
    expect(within(titleTrigger).getByTestId('crop-title-selector-chevron')).toBeInTheDocument();
    expect(screen.getAllByText('Roma').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'In Projekt importieren' })).toBeInTheDocument();
    expect(screen.queryByText('Version 1')).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Kulturbibliothek' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Öffentliche Kulturen durchsuchen' })).not.toBeInTheDocument();
  });

  it('opens the mobile public crop selector from the title', async () => {
    const user = userEvent.setup();
    mockMobileViewport();
    renderPage(['/app/crop-library?cropId=1']);

    await user.click(await screen.findByRole('button', { name: 'Kultur auswählen' }));

    expect(screen.getByRole('listbox', { name: 'Kulturbibliothek' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Öffentliche Kulturen durchsuchen' })).toBeInTheDocument();
  });

  it('opens the mobile public crop selector from the chevron', async () => {
    const user = userEvent.setup();
    mockMobileViewport();
    renderPage(['/app/crop-library?cropId=1']);

    const titleTrigger = await screen.findByRole('button', { name: 'Kultur auswählen' });
    await user.click(within(titleTrigger).getByTestId('crop-title-selector-chevron'));

    expect(screen.getByRole('listbox', { name: 'Kulturbibliothek' })).toBeInTheDocument();
  });

  it('keeps the selected public crop when the mobile selector is cancelled', async () => {
    const user = userEvent.setup();
    mockMobileViewport();
    renderPage(['/app/crop-library?cropId=1']);

    await user.click(await screen.findByRole('button', { name: 'Kultur auswählen' }));
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));

    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Kulturbibliothek' })).not.toBeInTheDocument();
    });
    expect(within(screen.getByRole('button', { name: 'Kultur auswählen' })).getByText('Tomate')).toBeInTheDocument();
    expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=1');
  });

  it('closes the mobile public crop selector on browser back without leaving the library', async () => {
    const user = userEvent.setup();
    mockMobileViewport();
    renderPage(['/app/crop-library?cropId=1']);

    await user.click(await screen.findByRole('button', { name: 'Kultur auswählen' }));
    expect(screen.getByRole('listbox', { name: 'Kulturbibliothek' })).toBeInTheDocument();

    act(() => {
      window.history.back();
    });

    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Kulturbibliothek' })).not.toBeInTheDocument();
      expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=1');
    });
  });

  it('selects another public crop from the mobile selector and updates the URL', async () => {
    const user = userEvent.setup();
    mockMobileViewport();
    renderPage(['/app/crop-library?cropId=1']);

    await user.click(await screen.findByRole('button', { name: 'Kultur auswählen' }));
    const salatRow = within(screen.getByRole('option', { name: 'Salat' }));
    const expandSalat = salatRow.queryByRole('button', { name: 'Kultur aufklappen' });
    if (expandSalat) {
      await user.click(expandSalat);
    }
    await user.click(screen.getByRole('option', { name: /Salat \(Maikönig\)/ }));

    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Kulturbibliothek' })).not.toBeInTheDocument();
      expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=2');
    });
    expect(within(screen.getByRole('button', { name: 'Kultur auswählen' })).getByText('Salat')).toBeInTheDocument();
    expect(screen.getAllByText('Maikönig').length).toBeGreaterThan(0);
  });

  it('keeps long mobile public crop titles truncated with the chevron visible', async () => {
    const longTitleCrop: PublicCrop = {
      ...publicCrops[0],
      id: 3,
      name: 'Sehr lange Tomatenkultur mit vielen beschreibenden Namensbestandteilen',
      variety: 'Roma Spezial',
    };
    publicCropApiMocks.list.mockResolvedValue(paginated([longTitleCrop]));
    mockMobileViewport();

    renderPage(['/app/crop-library?cropId=3']);

    const titleTrigger = await screen.findByRole('button', { name: 'Kultur auswählen' });
    expect(within(titleTrigger).getByTestId('crop-title-selector-label')).toHaveStyle({
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
    expect(within(titleTrigger).getByTestId('crop-title-selector-chevron')).toBeInTheDocument();
  });

  it('keeps the public library desktop master-detail selector unchanged', async () => {
    renderPage(['/app/crop-library?cropId=1']);

    expect(await screen.findByRole('heading', { level: 2, name: 'Tomate' })).toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Kulturbibliothek' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Öffentliche Kulturen durchsuchen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kultur auswählen' })).not.toBeInTheDocument();
  });

  it('shows a compact, single-surface empty state before any crop is selected', async () => {
    publicCropApiMocks.list.mockResolvedValue(paginated([]));
    renderPage();

    await screen.findByText('Keine öffentlichen Kulturen gefunden.');

    // Regression guard for a layout bug where the empty state's intro used
    // a separate grey header block (bgcolor + border-bottom) on top of the
    // three feature blocks, with a large forced min-height creating a big
    // empty gap below them. The intro and the three blocks should now sit
    // in one unified surface with a short subtitle.
    expect(screen.getByRole('heading', { name: 'Die Kulturbibliothek wächst mit der Community' })).toBeInTheDocument();
    expect(screen.getByText('Teile deine bewährten Kulturen mit anderen.')).toBeInTheDocument();
    expect(screen.queryByText(/Jede veröffentlichte Kultur erweitert die gemeinsame Kulturbibliothek/)).not.toBeInTheDocument();

    expect(screen.getByText('Entdecken')).toBeInTheDocument();
    expect(screen.getByText('Übernehmen')).toBeInTheDocument();
    expect(screen.getByText('Verbessern')).toBeInTheDocument();
    expect(screen.getByText(/Spätere Änderungen der öffentlichen Kultur werden nie automatisch übernommen/)).toBeInTheDocument();
  });

  it('shows the public library load error without rendering an empty state', async () => {
    publicCropApiMocks.list.mockRejectedValue(new Error('Network error'));
    renderPage();

    expect(await screen.findAllByText('Die Kulturbibliothek konnte nicht geladen werden.')).toHaveLength(3);
    expect(screen.queryByText('Keine öffentlichen Kulturen gefunden.')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Die Kulturbibliothek wächst mit der Community' })).not.toBeInTheDocument();
  });


  it('shows discussion topics empty state and opens the new topic form', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('option', { name: /Tomate \(Roma\)/ }));
    await userEvent.click(screen.getByRole('tab', { name: 'Diskussionen' }));
    expect(await screen.findByText('Noch keine Diskussionen')).toBeInTheDocument();
    expect(screen.getByText(/Frage zu den Daten/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Neue Diskussion' }));
    expect(screen.getByRole('textbox', { name: 'Titel' })).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Kommentar' })).toBeInTheDocument();
  });

  it('shows discussion topics as an interactive activity-sorted overview', async () => {
    const user = userEvent.setup();
    const topics: PublicCropDiscussionTopic[] = [
      {
        id: 11,
        public_crop: 1,
        title: 'TKG ok?',
        created_by_label: 'Martin Public',
        created_at: '2026-07-27T10:00:00Z',
        revision: 99,
        version: 4,
        comment_count: 1,
        last_activity_at: '2026-07-28T10:00:00Z',
        last_comment_preview: '**Was** ist die Quelle für das TKG?',
      },
      {
        id: 10,
        public_crop: 1,
        title: 'Allgemeine Diskussion',
        created_by_label: 'Martin Public',
        created_at: '2026-07-27T09:00:00Z',
        comment_count: 3,
        last_activity_at: '2026-07-27T12:00:00Z',
        last_comment_preview: 'Da stimmt was nicht',
      },
    ];
    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: topics });
    publicCropApiMocks.discussionComments.mockResolvedValue({ data: [] });

    const { container } = renderPage();
    await user.click(await screen.findByRole('option', { name: /Tomate \(Roma\)/ }));
    await user.click(screen.getByRole('tab', { name: 'Diskussionen' }));

    const overviewText = container.textContent ?? '';
    expect(overviewText.indexOf('TKG ok?')).toBeLessThan(overviewText.indexOf('Allgemeine Diskussion'));
    expect(screen.getByText('Martin Public · 1 Beitrag · zuletzt aktiv 28.07.2026')).toBeInTheDocument();
    expect(screen.getByText('Martin Public · 3 Beiträge · zuletzt aktiv 27.07.2026')).toBeInTheDocument();
    expect(screen.getByText('Was ist die Quelle für das TKG?')).toBeInTheDocument();
    expect(screen.getByText('Da stimmt was nicht')).toBeInTheDocument();
    expect(screen.getByText('Version 4')).toBeInTheDocument();

    const topicRow = screen.getByRole('button', { name: /TKG ok?/ });
    topicRow.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(publicCropApiMocks.discussionComments).toHaveBeenCalledWith(1, 11));
  });

  it('stores opened discussion threads in URL history so browser back and forward return between overview and thread', async () => {
    const user = userEvent.setup();
    const topics: PublicCropDiscussionTopic[] = [{
      id: 10,
      public_crop: 1,
      title: 'Allgemeine Diskussion',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      comment_count: 1,
      last_activity_at: '2026-07-27T12:00:00Z',
      last_comment_preview: 'Start',
    }];
    const comments: PublicCropDiscussionComment[] = [{
      id: 1,
      topic: 10,
      parent: null,
      body: 'Start im Thread',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      updated_at: '2026-07-27T10:00:00Z',
      deleted_at: null,
      is_edited: false,
      can_edit: true,
    }];
    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: topics });
    publicCropApiMocks.discussionComments.mockResolvedValue({ data: comments });

    renderPage();
    await user.click(await screen.findByRole('option', { name: /Tomate \(Roma\)/ }));
    await user.click(screen.getByRole('tab', { name: 'Diskussionen' }));
    expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=1&tab=discussion');

    await user.click(await screen.findByText('Allgemeine Diskussion'));
    await screen.findByText('Start im Thread');
    expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=1&tab=discussion&discussionId=10');

    await user.click(screen.getByRole('button', { name: 'Browser zurück' }));
    expect(await screen.findByText('Allgemeine Diskussion')).toBeInTheDocument();
    expect(screen.queryByText('Start im Thread')).not.toBeInTheDocument();
    expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=1&tab=discussion');

    await user.click(screen.getByRole('button', { name: 'Browser vorwärts' }));
    expect(await screen.findByText('Start im Thread')).toBeInTheDocument();
    expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=1&tab=discussion&discussionId=10');
  });

  it('keeps the discussion overview unchanged when clicking the already selected discussions tab', async () => {
    const user = userEvent.setup();
    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: [{
      id: 10,
      public_crop: 1,
      title: 'Übersicht bleibt offen',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      comment_count: 1,
      last_activity_at: '2026-07-27T12:00:00Z',
    }] });

    renderPage(['/app/crop-library?cropId=1&tab=discussion']);
    expect(await screen.findByText('Übersicht bleibt offen')).toBeInTheDocument();
    const routeBeforeClick = screen.getByLabelText('current route').textContent;

    await user.click(screen.getByRole('tab', { name: 'Diskussionen' }));

    expect(screen.getByText('Übersicht bleibt offen')).toBeInTheDocument();
    expect(screen.getByLabelText('current route')).toHaveTextContent(routeBeforeClick ?? '');
    expect(publicCropApiMocks.discussionComments).not.toHaveBeenCalled();
  });

  it('opens the discussion overview when clicking the discussions tab from an open thread', async () => {
    const user = userEvent.setup();
    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: [{
      id: 10,
      public_crop: 1,
      title: 'Thread im Tab',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      comment_count: 1,
      last_activity_at: '2026-07-27T12:00:00Z',
    }] });
    publicCropApiMocks.discussionComments.mockResolvedValue({ data: [{
      id: 1,
      topic: 10,
      parent: null,
      body: 'Kommentar im Thread',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      updated_at: '2026-07-27T10:00:00Z',
      deleted_at: null,
      is_edited: false,
      can_edit: true,
    }] });

    renderPage(['/app/crop-library?cropId=1&tab=discussion&discussionId=10']);
    expect(await screen.findByText('Kommentar im Thread')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Diskussionen' }));

    expect(await screen.findByText('Thread im Tab')).toBeInTheDocument();
    expect(screen.queryByText('Kommentar im Thread')).not.toBeInTheDocument();
    expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=1&tab=discussion');

    await user.click(screen.getByRole('button', { name: 'Browser zurück' }));
    expect(await screen.findByText('Kommentar im Thread')).toBeInTheDocument();
    expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=1&tab=discussion&discussionId=10');
  });

  it('restores the selected discussion thread when returning through main navigation', async () => {
    const user = userEvent.setup();
    const topics: PublicCropDiscussionTopic[] = [{
      id: 10,
      public_crop: 1,
      title: 'Gespeicherter Thread',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      comment_count: 1,
      last_activity_at: '2026-07-27T12:00:00Z',
      last_comment_preview: 'Wird wieder geöffnet',
    }];
    const comments: PublicCropDiscussionComment[] = [{
      id: 1,
      topic: 10,
      parent: null,
      body: 'Wiederhergestellter Kommentar',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      updated_at: '2026-07-27T10:00:00Z',
      deleted_at: null,
      is_edited: false,
      can_edit: true,
    }];
    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: topics });
    publicCropApiMocks.discussionComments.mockResolvedValue({ data: comments });

    renderPage();
    await user.click(await screen.findByRole('option', { name: /Tomate \(Roma\)/ }));
    await user.click(screen.getByRole('tab', { name: 'Diskussionen' }));
    await user.click(await screen.findByText('Gespeicherter Thread'));
    expect(await screen.findByText('Wiederhergestellter Kommentar')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Zur Hauptseite' }));
    expect(await screen.findByRole('heading', { name: 'Hauptseite' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Zur Kulturbibliothek' }));

    expect(await screen.findByRole('heading', { name: 'Gespeicherter Thread' })).toBeInTheDocument();
    expect(await screen.findByText('Wiederhergestellter Kommentar')).toBeInTheDocument();
    expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=1&tab=discussion&discussionId=10');
  });

  it('keeps explicit crop library URLs authoritative over saved view state', async () => {
    window.localStorage.setItem('publicCropLibraryViewState', JSON.stringify({
      cropId: 1,
      tab: 'discussion',
      discussionId: 10,
      query: '',
      listScrollTop: 0,
    }));

    renderPage(['/app/crop-library?cropId=2']);

    expect(await screen.findByRole('heading', { level: 2, name: 'Salat' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=2');
    expect(publicCropApiMocks.discussionComments).not.toHaveBeenCalled();
  });

  it('falls back to the discussion overview when a saved discussion thread no longer exists', async () => {
    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: [{
      id: 10,
      public_crop: 1,
      title: 'Weiterhin sichtbarer Thread',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      comment_count: 1,
      last_activity_at: '2026-07-27T12:00:00Z',
    }] });
    window.localStorage.setItem('publicCropLibraryViewState', JSON.stringify({
      cropId: 1,
      tab: 'discussion',
      discussionId: 999,
      query: '',
      listScrollTop: 0,
    }));

    renderPage();

    expect(await screen.findByText('Weiterhin sichtbarer Thread')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=1&tab=discussion');
    });
    expect(publicCropApiMocks.discussionComments).not.toHaveBeenCalledWith(1, 999);
  });

  it('restores the public crop list scroll position after returning through main navigation', async () => {
    const user = userEvent.setup();
    const topics: PublicCropDiscussionTopic[] = [{
      id: 10,
      public_crop: 1,
      title: 'Thread mit Scrollposition',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      comment_count: 1,
      last_activity_at: '2026-07-27T12:00:00Z',
    }];
    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: topics });
    publicCropApiMocks.discussionComments.mockResolvedValue({ data: [{
      id: 1,
      topic: 10,
      parent: null,
      body: 'Kommentar mit Scrollposition',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      updated_at: '2026-07-27T10:00:00Z',
      deleted_at: null,
      is_edited: false,
      can_edit: true,
    }] });

    renderPage();
    await user.click(await screen.findByRole('option', { name: /Tomate \(Roma\)/ }));
    const cropList = screen.getByRole('listbox', { name: 'Kulturbibliothek' });
    fireEvent.scroll(cropList, { target: { scrollTop: 48 } });
    await user.click(screen.getByRole('tab', { name: 'Diskussionen' }));
    await user.click(await screen.findByText('Thread mit Scrollposition'));
    await screen.findByText('Kommentar mit Scrollposition');

    await user.click(screen.getByRole('button', { name: 'Zur Hauptseite' }));
    await screen.findByRole('heading', { name: 'Hauptseite' });
    await user.click(screen.getByRole('button', { name: 'Zur Kulturbibliothek' }));

    await screen.findByText('Kommentar mit Scrollposition');
    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: 'Kulturbibliothek' }).scrollTop).toBe(48);
    });
  });

  it('opens a discussion thread directly from the URL after reload', async () => {
    const topics: PublicCropDiscussionTopic[] = [{
      id: 10,
      public_crop: 1,
      title: 'Direkt verlinkter Thread',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      comment_count: 1,
      last_activity_at: '2026-07-27T12:00:00Z',
    }];
    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: topics });
    publicCropApiMocks.discussionComments.mockResolvedValue({ data: [{
      id: 1,
      topic: 10,
      parent: null,
      body: 'Direktlink-Kommentar',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      updated_at: '2026-07-27T10:00:00Z',
      deleted_at: null,
      is_edited: false,
      can_edit: true,
    }] });

    renderPage(['/app/crop-library?cropId=1&tab=discussion&discussionId=10']);

    expect(await screen.findByRole('heading', { name: 'Direkt verlinkter Thread' })).toBeInTheDocument();
    expect(await screen.findByText('Direktlink-Kommentar')).toBeInTheDocument();
    expect(publicCropApiMocks.discussionComments).toHaveBeenCalledWith(1, 10);
  });

  it('uses the same deterministic discussion overview target for the internal back action', async () => {
    const user = userEvent.setup();
    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: [{
      id: 10,
      public_crop: 1,
      title: 'Direkt verlinkter Thread',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      comment_count: 1,
      last_activity_at: '2026-07-27T12:00:00Z',
    }] });
    publicCropApiMocks.discussionComments.mockResolvedValue({ data: [{
      id: 1,
      topic: 10,
      parent: null,
      body: 'Direktlink-Kommentar',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      updated_at: '2026-07-27T10:00:00Z',
      deleted_at: null,
      is_edited: false,
      can_edit: true,
    }] });

    renderPage(['/app/crop-library?cropId=1&tab=discussion&discussionId=10']);
    await screen.findByText('Direktlink-Kommentar');

    await user.click(screen.getByRole('button', { name: 'Alle Diskussionen' }));

    expect(await screen.findByText('Direkt verlinkter Thread')).toBeInTheDocument();
    expect(screen.queryByText('Direktlink-Kommentar')).not.toBeInTheDocument();
    expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=1&tab=discussion');
  });

  it('removes incompatible discussion IDs when switching crop or tab', async () => {
    const user = userEvent.setup();
    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: [{
      id: 10,
      public_crop: 1,
      title: 'Thread der Tomate',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      comment_count: 1,
      last_activity_at: '2026-07-27T12:00:00Z',
    }] });
    publicCropApiMocks.discussionComments.mockResolvedValue({ data: [{
      id: 1,
      topic: 10,
      parent: null,
      body: 'Tomaten-Kommentar',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      updated_at: '2026-07-27T10:00:00Z',
      deleted_at: null,
      is_edited: false,
      can_edit: true,
    }] });

    renderPage(['/app/crop-library?cropId=1&tab=discussion&discussionId=10']);
    await screen.findByText('Tomaten-Kommentar');

    await user.click(screen.getByRole('tab', { name: 'Details' }));
    expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=1');
    expect(screen.queryByText('Tomaten-Kommentar')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Diskussionen' }));
    await user.click(await screen.findByText('Thread der Tomate'));
    await screen.findByText('Tomaten-Kommentar');
    const salatDiscussionRow = within(screen.getByRole('option', { name: 'Salat' }));
    const expandDiscussionSalat = salatDiscussionRow.queryByRole('button', { name: 'Kultur aufklappen' });
    if (expandDiscussionSalat) {
      await user.click(expandDiscussionSalat);
    }
    await user.click(screen.getByRole('option', { name: /Salat \(Maikönig\)/ }));

    expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=2&tab=discussion');
    expect(screen.getByLabelText('current route')).not.toHaveTextContent('discussionId=');
  });

  it('falls back to the discussion overview for an unknown discussion ID', async () => {
    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: [{
      id: 10,
      public_crop: 1,
      title: 'Bekannter Thread',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      comment_count: 1,
      last_activity_at: '2026-07-27T12:00:00Z',
    }] });

    renderPage(['/app/crop-library?cropId=1&tab=discussion&discussionId=999']);

    expect(await screen.findByText('Bekannter Thread')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=1&tab=discussion');
    });
    expect(publicCropApiMocks.discussionComments).not.toHaveBeenCalledWith(1, 999);
  });

  // DELIBERATELY NOT RETRIED while the flake is being identified.
  //
  // This test has flaked on CI since 2026-08-10 and the cause is still
  // unknown. Four fixes have been tried and measured, and none stopped it:
  // raising the assertion timeout (#451), giving `discussionTopics` a default
  // mock so an extra call cannot resolve `undefined` (#467), stopping the
  // topic-exists guard from deselecting a just-created topic (#469), and
  // running the full suite locally under heavier load than CI (671s vs CI's
  // 471s - still green, so it is not plain starvation). It does not reproduce
  // locally at all.
  //
  // A `retry` was added and then removed on purpose: retrying hides the one
  // signal left to work with. The assertion below is split so a CI failure
  // names which half broke - the lost navigation or the topic list - instead
  // of only reporting "element could not be found". Once a failure has been
  // captured and the cause is understood, fix it and delete this note.
  it('creates a new discussion inline and opens it after saving', async () => {
    const user = userEvent.setup();
    const createdTopic: PublicCropDiscussionTopic = {
      id: 20,
      public_crop: 1,
      title: 'Neue Frage',
      created_by_label: 'Martin Public',
      created_at: '2026-07-28T10:00:00Z',
      comment_count: 1,
      last_activity_at: '2026-07-28T10:00:00Z',
      // Deliberately not the comment body: the overview list renders this
      // preview, so reusing the body text let the assertion below pass by
      // matching the overview instead of the opened discussion.
      last_comment_preview: 'Vorschau des Kommentars',
    };
    const createdComment: PublicCropDiscussionComment = {
      id: 21,
      topic: 20,
      parent: null,
      body: 'Was ist hier gemeint?',
      created_by_label: 'Martin Public',
      created_at: '2026-07-28T10:00:00Z',
      updated_at: '2026-07-28T10:00:00Z',
      deleted_at: null,
      is_edited: false,
      can_edit: true,
    };
    publicCropApiMocks.createDiscussionTopic.mockResolvedValue({ data: createdTopic });
    // The default covers every call after the first: the topic reload races
    // with the `discussionId` navigation that follows it, so under load the
    // page can refetch the topics once more. With only two queued `Once`
    // values that extra call resolved `undefined` and blew up the reload,
    // leaving the heading below to time out instead of failing loudly.
    publicCropApiMocks.discussionTopics
      .mockResolvedValue({ data: [createdTopic] })
      .mockResolvedValueOnce({ data: [] });
    publicCropApiMocks.discussionComments.mockResolvedValue({ data: [createdComment] });

    renderPage(['/app/crop-library?cropId=1&tab=discussion']);
    await user.click(await screen.findByRole('button', { name: 'Neue Diskussion' }));

    expect(screen.queryByRole('button', { name: 'Neue Diskussion' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Titel' })).toHaveFocus();
    await user.type(screen.getByRole('textbox', { name: 'Titel' }), 'Neue Frage');
    await user.type(screen.getByRole('textbox', { name: 'Kommentar' }), 'Was ist hier gemeint?');
    const submitButton = screen.getByRole('button', { name: 'Diskussion starten' });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    await waitFor(() => expect(publicCropApiMocks.createDiscussionTopic).toHaveBeenCalledWith(1, {
      title: 'Neue Frage',
      body: 'Was ist hier gemeint?',
      revision: undefined,
    }));
    await waitFor(() => expect(publicCropApiMocks.discussionTopics).toHaveBeenCalledTimes(2));
    // Opening the created discussion needs two things to converge: the `topics`
    // state from the reload fetch, and the `discussionId` URL param that
    // selects it (set via a router navigation in the same handler). This
    // assertion splits the two, because the combined one below only ever
    // reported "element could not be found" and never said which half was
    // missing. If this line is what fails, the navigation was lost or
    // overwritten; if it passes and the heading below fails, the navigation
    // landed and the topic list is what did not.
    await waitFor(
      () => expect(screen.getByLabelText('current route')).toHaveTextContent('discussionId=20'),
      { timeout: 25000 },
    );
    expect(await screen.findByRole('heading', { name: 'Neue Frage' }, { timeout: 25000 })).toBeInTheDocument();
    // The heading only needs the reloaded topic list, the comment body needs
    // the separate discussionComments request on top of it - so this has to
    // wait for one more round trip rather than read the DOM synchronously.
    expect(await screen.findByText('Was ist hier gemeint?', undefined, { timeout: 25000 })).toBeInTheDocument();
  }, 60000);

  it('keeps a created discussion open when the reloaded topic list does not contain it yet', async () => {
    const user = userEvent.setup();
    const createdTopic: PublicCropDiscussionTopic = {
      id: 20,
      public_crop: 1,
      title: 'Neue Frage',
      created_by_label: 'Martin Public',
      created_at: '2026-07-28T10:00:00Z',
      comment_count: 1,
      last_activity_at: '2026-07-28T10:00:00Z',
      last_comment_preview: 'Vorschau des Kommentars',
    };
    const createdComment: PublicCropDiscussionComment = {
      id: 21,
      topic: 20,
      parent: null,
      body: 'Was ist hier gemeint?',
      created_by_label: 'Martin Public',
      created_at: '2026-07-28T10:00:00Z',
      updated_at: '2026-07-28T10:00:00Z',
      deleted_at: null,
      is_edited: false,
      can_edit: true,
    };
    publicCropApiMocks.createDiscussionTopic.mockResolvedValue({ data: createdTopic });
    // The reload never returns the new topic - the case this guards against is
    // a list response that lags behind the create (ordering, pagination, or a
    // replica that has not caught up). Without the created-topic merge the
    // "unknown discussion ID" guard deselects the discussion the user just
    // created and the detail pane is stuck on a spinner.
    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: [] });
    publicCropApiMocks.discussionComments.mockResolvedValue({ data: [createdComment] });

    renderPage();
    await user.click(await screen.findByRole('option', { name: /Tomate \(Roma\)/ }));
    await user.click(screen.getByRole('tab', { name: 'Diskussionen' }));
    await user.click(await screen.findByRole('button', { name: 'Neue Diskussion' }));
    await user.type(screen.getByRole('textbox', { name: 'Titel' }), 'Neue Frage');
    await user.type(screen.getByRole('textbox', { name: 'Kommentar' }), 'Was ist hier gemeint?');
    const submitButton = screen.getByRole('button', { name: 'Diskussion starten' });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    expect(await screen.findByRole('heading', { name: 'Neue Frage' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('current route')).toHaveTextContent('discussionId=20');
    });
  });

  it('returns focus to the new discussion button after cancelling the inline editor', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('option', { name: /Tomate \(Roma\)/ }));
    await user.click(screen.getByRole('tab', { name: 'Diskussionen' }));
    const newTopicButton = await screen.findByRole('button', { name: 'Neue Diskussion' });

    await user.click(newTopicButton);
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));

    expect(screen.getByRole('button', { name: 'Neue Diskussion' })).toHaveFocus();
  });

  it('keeps the selected version reference when starting a discussion from the version history', async () => {
    const user = userEvent.setup();
    publicCropApiMocks.versions.mockResolvedValue({
      data: [{
        id: 99,
        public_crop: 1,
        version: 4,
        action: 'updated',
        snapshot: {},
        changed_fields: [],
        created_by_label: 'Martin Public',
        created_at: '2026-07-28T10:00:00Z',
      }],
    });
    publicCropApiMocks.createDiscussionTopic.mockResolvedValue({
      data: {
        id: 30,
        public_crop: 1,
        title: 'TKG ok?',
        created_by_label: 'Martin Public',
        created_at: '2026-07-28T10:00:00Z',
        revision: 99,
        version: 4,
        comment_count: 1,
        last_activity_at: '2026-07-28T10:00:00Z',
        last_comment_preview: 'Quelle?',
      },
    });
    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: [] });
    publicCropApiMocks.discussionComments.mockResolvedValue({ data: [] });

    renderPage();
    await user.click(await screen.findByRole('option', { name: /Tomate \(Roma\)/ }));
    await user.click(screen.getByRole('tab', { name: 'Versionen' }));
    await user.click(await screen.findByRole('button', { name: 'Diskutieren' }));

    expect(screen.getByText('Bezug:')).toBeInTheDocument();
    expect(screen.getByText('Version 4')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Titel' }), 'TKG ok?');
    await user.type(screen.getByRole('textbox', { name: 'Kommentar' }), 'Quelle?');
    const submitButton = screen.getByRole('button', { name: 'Diskussion starten' });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    await waitFor(() => expect(publicCropApiMocks.createDiscussionTopic).toHaveBeenCalledWith(1, {
      title: 'TKG ok?',
      body: 'Quelle?',
      revision: 99,
    }));
  }, 30000);

  it('renders a real parent-child reply tree and keeps reply focus local', async () => {
    const user = userEvent.setup();
    const topics: PublicCropDiscussionTopic[] = [{
      id: 10,
      public_crop: 1,
      title: 'Allgemeine Diskussion',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      comment_count: 4,
      last_activity_at: '2026-07-28T10:00:00Z',
    }];
    const initialComments: PublicCropDiscussionComment[] = [
      {
        id: 1,
        topic: 10,
        parent: null,
        body: 'test2',
        created_by_label: 'Martin Public',
        created_at: '2026-07-27T10:00:00Z',
        updated_at: '2026-07-27T10:00:00Z',
        deleted_at: null,
        is_edited: false,
        can_edit: true,
      },
      {
        id: 2,
        topic: 10,
        parent: 1,
        body: 'nein',
        created_by_label: 'Martin Public',
        created_at: '2026-07-28T09:00:00Z',
        updated_at: '2026-07-28T09:00:00Z',
        deleted_at: null,
        is_edited: false,
        can_edit: true,
      },
      {
        id: 3,
        topic: 10,
        parent: 2,
        body: 'ja',
        created_by_label: 'Martin Public',
        created_at: '2026-07-28T09:10:00Z',
        updated_at: '2026-07-28T09:10:00Z',
        deleted_at: null,
        is_edited: false,
        can_edit: true,
      },
      {
        id: 4,
        topic: 10,
        parent: 3,
        body: 'reply zu ja',
        created_by_label: 'Martin Public',
        created_at: '2026-07-28T09:20:00Z',
        updated_at: '2026-07-28T09:20:00Z',
        deleted_at: null,
        is_edited: false,
        can_edit: true,
      },
      {
        id: 5,
        topic: 10,
        parent: 4,
        body: 'sehr tiefe Antwort',
        created_by_label: 'Martin Public',
        created_at: '2026-07-28T09:30:00Z',
        updated_at: '2026-07-28T09:30:00Z',
        deleted_at: null,
        is_edited: false,
        can_edit: true,
      },
      {
        id: 6,
        topic: 10,
        parent: 5,
        body: 'noch tiefere Antwort',
        created_by_label: 'Martin Public',
        created_at: '2026-07-28T09:40:00Z',
        updated_at: '2026-07-28T09:40:00Z',
        deleted_at: null,
        is_edited: false,
        can_edit: true,
      },
      {
        id: 7,
        topic: 10,
        parent: 1,
        body: 'reply zu test2',
        created_by_label: 'Martin Public',
        created_at: '2026-07-28T09:50:00Z',
        updated_at: '2026-07-28T09:50:00Z',
        deleted_at: null,
        is_edited: false,
        can_edit: true,
      },
    ];
    const createdReply: PublicCropDiscussionComment = {
      id: 8,
      topic: 10,
      parent: 2,
      body: 'Neue Antwort auf nein',
      created_by_label: 'Martin Public',
      created_at: '2026-07-28T10:00:00Z',
      updated_at: '2026-07-28T10:00:00Z',
      deleted_at: null,
      is_edited: false,
      can_edit: true,
    };

    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: topics });
    publicCropApiMocks.discussionComments
      .mockResolvedValueOnce({ data: initialComments })
      .mockResolvedValueOnce({ data: [...initialComments, createdReply] });
    publicCropApiMocks.createDiscussionComment.mockResolvedValue({ data: createdReply });

    const { container } = renderPage();
    await user.click(await screen.findByRole('option', { name: /Tomate \(Roma\)/ }));
    await user.click(screen.getByRole('tab', { name: 'Diskussionen' }));
    await user.click(await screen.findByText('Allgemeine Diskussion'));

    const threadText = container.textContent ?? '';
    expect(threadText.indexOf('test2')).toBeLessThan(threadText.indexOf('nein'));
    expect(threadText.indexOf('nein')).toBeLessThan(threadText.indexOf('ja'));
    expect(threadText.indexOf('ja')).toBeLessThan(threadText.indexOf('reply zu ja'));
    expect(threadText.indexOf('reply zu ja')).toBeLessThan(threadText.indexOf('reply zu test2'));
    expect(screen.queryByRole('menuitem', { name: 'Bearbeiten' })).not.toBeInTheDocument();

    const commentA = container.querySelector('[data-comment-id="1"]');
    const commentB = container.querySelector('[data-comment-id="2"]');
    const commentC = container.querySelector('[data-comment-id="3"]');
    const commentD = container.querySelector('[data-comment-id="7"]');
    const deepComment = container.querySelector('[data-comment-id="6"]');
    expect(commentA).toHaveAttribute('data-logical-depth', '0');
    expect(commentB).toHaveAttribute('data-logical-depth', '1');
    expect(commentC).toHaveAttribute('data-logical-depth', '2');
    expect(commentD).toHaveAttribute('data-logical-depth', '1');
    expect(commentB).toHaveAttribute('data-visual-depth', '1');
    expect(commentD).toHaveAttribute('data-visual-depth', '1');
    expect(deepComment).toHaveAttribute('data-logical-depth', '5');
    expect(deepComment).toHaveAttribute('data-visual-depth', '3');
    expect(screen.getAllByText('Antwort auf Martin Public').length).toBeGreaterThan(0);

    expect(commentB).not.toBeNull();
    await user.click(within(commentB as HTMLElement).getByRole('button', { name: 'Auf Beitrag von Martin Public antworten' }));
    expect(screen.getByRole('textbox', { name: 'Antwort' })).toHaveFocus();
    await user.type(screen.getByRole('textbox', { name: 'Antwort' }), 'Neue Antwort auf nein');
    const replySubmitButton = screen.getByRole('button', { name: 'Absenden' });
    await waitFor(() => expect(replySubmitButton).toBeEnabled());
    await user.click(replySubmitButton);

    await waitFor(() => expect(publicCropApiMocks.createDiscussionComment).toHaveBeenCalledWith(1, 10, 'Neue Antwort auf nein', 2));
    await screen.findByText('Neue Antwort auf nein');
    const updatedThreadText = container.textContent ?? '';
    expect(updatedThreadText.indexOf('ja')).toBeLessThan(updatedThreadText.indexOf('Neue Antwort auf nein'));
    expect(updatedThreadText.indexOf('Neue Antwort auf nein')).toBeLessThan(updatedThreadText.indexOf('reply zu test2'));
    expect(document.activeElement).toHaveTextContent('Neue Antwort auf nein');
  }, 30000);

  it('creates a root-level contribution from the general comment field', async () => {
    const user = userEvent.setup();
    const topics: PublicCropDiscussionTopic[] = [{
      id: 10,
      public_crop: 1,
      title: 'Allgemeine Diskussion',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      comment_count: 0,
      last_activity_at: null,
    }];
    const createdRootComment: PublicCropDiscussionComment = {
      id: 50,
      topic: 10,
      parent: null,
      body: 'Neuer Root-Beitrag',
      created_by_label: 'Martin Public',
      created_at: '2026-07-28T10:00:00Z',
      updated_at: '2026-07-28T10:00:00Z',
      deleted_at: null,
      is_edited: false,
      can_edit: true,
    };
    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: topics });
    publicCropApiMocks.discussionComments
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [createdRootComment] });
    publicCropApiMocks.createDiscussionComment.mockResolvedValue({ data: createdRootComment });

    const { container } = renderPage();
    await user.click(await screen.findByRole('option', { name: /Tomate \(Roma\)/ }));
    await user.click(screen.getByRole('tab', { name: 'Diskussionen' }));
    await user.click(await screen.findByText('Allgemeine Diskussion'));
    await user.type(screen.getByRole('textbox', { name: 'Kommentar' }), 'Neuer Root-Beitrag');
    const submitButton = screen.getByRole('button', { name: 'Absenden' });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    await waitFor(() => expect(publicCropApiMocks.createDiscussionComment).toHaveBeenCalledWith(1, 10, 'Neuer Root-Beitrag', undefined));
    await screen.findByText('Neuer Root-Beitrag');
    expect(container.querySelector('[data-comment-id="50"]')).toHaveAttribute('data-logical-depth', '0');
  }, 30000);

  it('keeps deleted posts in the reply tree with a neutral placeholder', async () => {
    const user = userEvent.setup();
    const topics: PublicCropDiscussionTopic[] = [{
      id: 10,
      public_crop: 1,
      title: 'Allgemeine Diskussion',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      comment_count: 2,
      last_activity_at: '2026-07-28T10:00:00Z',
    }];
    const comments: PublicCropDiscussionComment[] = [
      {
        id: 1,
        topic: 10,
        parent: null,
        body: '',
        created_by_label: 'Martin Public',
        created_at: '2026-07-27T10:00:00Z',
        updated_at: '2026-07-28T09:00:00Z',
        deleted_at: '2026-07-28T09:00:00Z',
        deletion_kind: 'author',
        is_edited: false,
        can_edit: false,
        can_delete: false,
      },
      {
        id: 2,
        topic: 10,
        parent: 1,
        body: 'Antwort bleibt sichtbar',
        created_by_label: 'Martin Public',
        created_at: '2026-07-28T10:00:00Z',
        updated_at: '2026-07-28T10:00:00Z',
        deleted_at: null,
        is_edited: false,
        can_edit: true,
        can_delete: true,
      },
      {
        id: 3,
        topic: 10,
        parent: null,
        body: '',
        created_by_label: 'Martin Public',
        created_at: '2026-07-28T11:00:00Z',
        updated_at: '2026-07-28T11:30:00Z',
        deleted_at: '2026-07-28T11:30:00Z',
        deletion_kind: 'moderator',
        is_edited: false,
        can_edit: false,
        can_delete: false,
      },
    ];
    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: topics });
    publicCropApiMocks.discussionComments.mockResolvedValue({ data: comments });

    const { container } = renderPage();
    await user.click(await screen.findByRole('option', { name: /Tomate \(Roma\)/ }));
    await user.click(screen.getByRole('tab', { name: 'Diskussionen' }));
    await user.click(await screen.findByText('Allgemeine Diskussion'));

    expect(await screen.findByLabelText('Dieser Beitrag wurde vom Autor gelöscht.')).toBeInTheDocument();
    expect(await screen.findByLabelText('Dieser Beitrag wurde von einem Moderator entfernt.')).toBeInTheDocument();
    expect(screen.queryByText('Dieser Beitrag wurde gelöscht.')).not.toBeInTheDocument();
    expect(screen.getByText('Antwort bleibt sichtbar')).toBeInTheDocument();
    expect(container.querySelector('[data-comment-id="2"]')).toHaveAttribute('data-logical-depth', '1');
    expect(screen.queryByText('Ursprünglicher Inhalt')).not.toBeInTheDocument();
  }, 30000);

  it('shows a clear message when deleting an opening post with visible replies is blocked', async () => {
    const user = userEvent.setup();
    const snackbarSpy = vi.fn<(event: Event) => void>();
    window.addEventListener(GLOBAL_SNACKBAR_EVENT, snackbarSpy);
    const topics: PublicCropDiscussionTopic[] = [{
      id: 10,
      public_crop: 1,
      title: 'Root mit Antwort',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      comment_count: 2,
      last_activity_at: '2026-07-28T10:00:00Z',
    }];
    const comments: PublicCropDiscussionComment[] = [
      {
        id: 1,
        topic: 10,
        parent: null,
        body: 'Root bleibt',
        created_by_label: 'Martin Public',
        created_at: '2026-07-27T10:00:00Z',
        updated_at: '2026-07-27T10:00:00Z',
        deleted_at: null,
        is_edited: false,
        can_edit: true,
        can_delete: false,
        delete_blocked_reason: 'visible_replies',
      },
      {
        id: 2,
        topic: 10,
        parent: 1,
        body: 'Sichtbare Antwort',
        created_by_label: 'Martin Public',
        created_at: '2026-07-28T10:00:00Z',
        updated_at: '2026-07-28T10:00:00Z',
        deleted_at: null,
        is_edited: false,
        can_edit: true,
        can_delete: true,
      },
    ];
    publicCropApiMocks.discussionTopics.mockResolvedValue({ data: topics });
    publicCropApiMocks.discussionComments.mockResolvedValue({ data: comments });

    const { container } = renderPage();
    await user.click(await screen.findByRole('option', { name: /Tomate \(Roma\)/ }));
    await user.click(screen.getByRole('tab', { name: 'Diskussionen' }));
    await user.click(await screen.findByText('Root mit Antwort'));

    const rootElement = container.querySelector('[data-comment-id="1"]');
    expect(rootElement).not.toBeNull();
    await user.click(within(rootElement as HTMLElement).getByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(screen.getByRole('menuitem', { name: 'Löschen' }));

    expect(publicCropApiMocks.deleteDiscussionComment).not.toHaveBeenCalled();
    expect(snackbarSpy).toHaveBeenCalled();
    const event = snackbarSpy.mock.calls[0]?.[0] as CustomEvent<GlobalSnackbarDetail>;
    expect(event.detail.message).toBe('Der Eröffnungsbeitrag kann nicht gelöscht werden, solange sichtbare Antworten vorhanden sind.');
    window.removeEventListener(GLOBAL_SNACKBAR_EVENT, snackbarSpy);
  });

  it('returns to the discussion overview when deleting the last visible post hides the topic', async () => {
    const user = userEvent.setup();
    const topic: PublicCropDiscussionTopic = {
      id: 10,
      public_crop: 1,
      title: 'Nur Root',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      comment_count: 1,
      last_activity_at: '2026-07-28T10:00:00Z',
    };
    const rootComment: PublicCropDiscussionComment = {
      id: 1,
      topic: 10,
      parent: null,
      body: 'Letzter sichtbarer Beitrag',
      created_by_label: 'Martin Public',
      created_at: '2026-07-27T10:00:00Z',
      updated_at: '2026-07-27T10:00:00Z',
      deleted_at: null,
      is_edited: false,
      can_edit: true,
      can_delete: true,
    };
    publicCropApiMocks.discussionTopics
      .mockResolvedValueOnce({ data: [topic] })
      .mockResolvedValueOnce({ data: [] });
    publicCropApiMocks.discussionComments
      .mockResolvedValueOnce({ data: [rootComment] })
      .mockResolvedValueOnce({ data: [{ ...rootComment, body: '', deleted_at: '2026-07-28T10:00:00Z', deletion_kind: 'author', can_edit: false, can_delete: false }] });
    publicCropApiMocks.deleteDiscussionComment.mockResolvedValue({ data: undefined });

    const { container } = renderPage(['/app/crop-library?cropId=1&tab=discussion&discussionId=10']);
    await screen.findByText('Letzter sichtbarer Beitrag');

    const rootElement = container.querySelector('[data-comment-id="1"]');
    expect(rootElement).not.toBeNull();
    await user.click(within(rootElement as HTMLElement).getByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(screen.getByRole('menuitem', { name: 'Löschen' }));

    await waitFor(() => expect(publicCropApiMocks.deleteDiscussionComment).toHaveBeenCalledWith(1, 1));
    await screen.findByText('Noch keine Diskussionen');
    expect(screen.getByLabelText('current route')).toHaveTextContent('/app/crop-library?cropId=1&tab=discussion');
    expect(screen.getByLabelText('current route')).not.toHaveTextContent('discussionId=');
  });

  it('shows only provenance metadata in the public crop detail section', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('option', { name: /Tomate \(Roma\)/ }));

    const metadataHeading = await screen.findByRole('heading', { name: 'Bibliotheksdaten' });
    const metadataSection = metadataHeading.closest('div');
    expect(metadataSection).not.toBeNull();
    const metadata = within(metadataSection as HTMLElement);

    expect(metadata.getByText('Originalsprache')).toBeInTheDocument();
    expect(metadata.getByText('Deutsch')).toBeInTheDocument();
    expect(metadata.getByText('Veröffentlicht am')).toBeInTheDocument();
    expect(metadata.getByText('23.07.2026')).toBeInTheDocument();
    expect(metadata.getByText('Zuletzt geändert')).toBeInTheDocument();
    expect(metadata.getByText('27.07.2026')).toBeInTheDocument();
    expect(metadata.queryByText('Version')).not.toBeInTheDocument();
    expect(metadata.queryByText('Angelegt am')).not.toBeInTheDocument();
    expect(metadata.queryByText('Status')).not.toBeInTheDocument();
  });

  it('uses the shared crop list keyboard navigation on the full public library page', async () => {
    const user = userEvent.setup();
    renderPage();

    const tomatoOption = await screen.findByRole('option', { name: 'Tomate' });
    tomatoOption.focus();

    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('heading', { level: 2, name: 'Tomate' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Tomate (Roma)' })).toHaveFocus();
    });

    await user.keyboard('{ArrowDown}');

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Salat' })).toHaveFocus();
    });

    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('heading', { level: 2, name: 'Salat' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Salat (Maikönig)' })).toHaveFocus();
    });

    await user.keyboard('{ArrowUp}');

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Salat' })).toHaveFocus();
    });

    await user.keyboard('{ArrowUp}');

    expect(screen.getByRole('heading', { level: 2, name: 'Tomate' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Tomate (Roma)' })).toHaveFocus();
    });
  });

  it('keeps list focus after clicking a public crop so arrow keys choose the next crop', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('option', { name: 'Tomate (Roma)' }));

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Tomate (Roma)' })).toHaveFocus();
    });

    await user.keyboard('{ArrowDown}');

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Salat' })).toHaveFocus();
    });

    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('heading', { level: 2, name: 'Salat' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Salat (Maikönig)' })).toHaveFocus();
    });
  });

  it('focuses the selected public crop from the URL so arrow keys do not scroll the page', async () => {
    const user = userEvent.setup();
    renderPage(['/app/crop-library?cropId=1']);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Tomate (Roma)' })).toHaveFocus();
    });

    await user.keyboard('{ArrowDown}');

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Salat' })).toHaveFocus();
    });

    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('heading', { level: 2, name: 'Salat' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Salat (Maikönig)' })).toHaveFocus();
    });
  });

  it('filters the public crop list locally while keeping focus in the search field', async () => {
    const user = userEvent.setup();

    renderPage(['/app/crop-library?cropId=1']);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Tomate (Roma)' })).toHaveFocus();
    });

    const searchInput = screen.getByRole('textbox', { name: 'Öffentliche Kulturen durchsuchen' });
    await user.click(searchInput);
    await user.type(searchInput, 'mai');

    expect(screen.queryByRole('option', { name: 'Tomate (Roma)' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Salat' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Salat (Maikönig)' })).toBeInTheDocument();
    expect(publicCropApiMocks.list).toHaveBeenCalledTimes(1);
    expect(searchInput).toHaveFocus();
  });

  it('shows public crop primary actions as labeled buttons', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('option', { name: /Tomate \(Roma\)/ }));

    expect(await screen.findByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'In Projekt importieren' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Übersetzen' })).not.toBeInTheDocument();
  });

  it('opens source links in the notes section in a new tab', async () => {
    publicCropApiMocks.list.mockResolvedValue(paginated([
      {
        ...publicCrops[0],
        description: 'Robuste Sorte.\n\n## Quellen\n\n- [ReinSaat - Roma](https://www.reinsaat.at/roma)',
        translations: { de: 'Robuste Sorte.\n\n## Quellen\n\n- [ReinSaat - Roma](https://www.reinsaat.at/roma)' },
      },
      ...publicCrops.slice(1),
    ]));
    renderPage();
    await userEvent.click(await screen.findByRole('option', { name: 'Tomate' }));
    await userEvent.click(await screen.findByRole('option', { name: /Tomate \(Roma\)/ }));

    const sourceLink = await screen.findByRole('link', { name: 'ReinSaat - Roma' });
    expect(sourceLink).toHaveAttribute('href', 'https://www.reinsaat.at/roma');
    expect(sourceLink).toHaveAttribute('target', '_blank');
    expect(sourceLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('edits public crops with the shared crop form and public-library save shortcut', async () => {
    const user = userEvent.setup();
    authMocks.user.is_staff = true;
    renderPage();

    await user.click(await screen.findByRole('option', { name: 'Tomate (Roma)' }));
    await screen.findByRole('heading', { level: 2, name: 'Tomate' });
    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));

    const editDialog = await screen.findByRole('dialog', { name: 'Öffentliche Kultur bearbeiten' });
    expect(editDialog).toHaveTextContent('Allgemeine Informationen');
    expect(editDialog).toHaveTextContent('Kultur (öffentliche Identität, nicht änderbar)');
    expect(editDialog).toHaveTextContent('Tomate');
    expect(editDialog).toHaveTextContent('Diese Änderung betrifft 3 lokale Kopien');
    expect(editDialog).toHaveTextContent('#7CB342');
    expect(within(editDialog).getByText('Originalsprache: Deutsch')).toBeInTheDocument();
    expect(editDialog).not.toHaveTextContent('Kulturspezifische Lieferantendaten');
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();

    const varietyInput = within(editDialog).getByLabelText('Sorte');
    expect(varietyInput).toHaveValue('Roma');
    const notesInput = within(editDialog).getByLabelText('Notizen');
    const colorInput = within(editDialog).getByLabelText('Anzeigefarbe');
    fireEvent.change(varietyInput, { target: { value: 'Roma VF' } });
    fireEvent.change(notesInput, { target: { value: 'Aktualisierte Notizen.' } });
    fireEvent.change(colorInput, { target: { value: '#123456' } });
    colorInput.focus();
    fireEvent.keyDown(window, {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 's',
    });

    await waitFor(() => expect(publicCropApiMocks.update).toHaveBeenCalledTimes(1));
    expect(publicCropApiMocks.update).toHaveBeenCalledWith(1, expect.objectContaining({
      base_version: 1,
      variety: 'Roma VF',
      notes: 'Aktualisierte Notizen.',
      display_color: '#123456',
      row_spacing_m: null,
    }));
    expect(publicCropApiMocks.update.mock.calls[0][1]).not.toHaveProperty('name');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Öffentliche Kultur bearbeiten' })).not.toBeInTheDocument());
  }, 30000);

  it('keeps the public crop variety read-only for non-admin contributors', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('option', { name: 'Tomate (Roma)' }));
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));

    const editDialog = await screen.findByRole('dialog', { name: 'Öffentliche Kultur bearbeiten' });
    expect(within(editDialog).getByLabelText('Sorte')).toBeDisabled();
  });

  it('adds a missing English notes translation from the Notes section dialog and refreshes the fallback state', async () => {
    await i18n.changeLanguage('en');
    const user = userEvent.setup();
    renderPage(['/app/crop-library?cropId=1']);

    await screen.findByRole('heading', { level: 2, name: 'Tomate' });
    expect(screen.getAllByText('Only available in German').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Translate' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add English translation' }));

    const translationDialog = await screen.findByRole('dialog', { name: 'Edit translation' });
    expect(publicCropApiMocks.getTranslations).toHaveBeenCalledWith(1);
    expect(within(translationDialog).getByText('Robuste Sorte.')).toBeInTheDocument();
    const englishNotesInput = within(translationDialog).getByLabelText('English – Translation');
    expect(englishNotesInput).toHaveValue('');

    fireEvent.change(englishNotesInput, { target: { value: 'A robust variety.' } });
    await user.click(within(translationDialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(publicCropApiMocks.updateTranslations).toHaveBeenCalledWith(1, { en: 'A robust variety.' }));
    await waitFor(() => expect(publicCropApiMocks.get).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByText('Only available in German')).not.toBeInTheDocument());
    expect(screen.getByText('A robust variety.')).toBeInTheDocument();
    expect(publicCropApiMocks.update).not.toHaveBeenCalled();
  }, 30000);

  it('keeps the saved public crop details while the search field filters locally', async () => {
    const user = userEvent.setup();
    const pendingUpdate = createDeferred<{ data: PublicCrop }>();
    publicCropApiMocks.update.mockReturnValueOnce(pendingUpdate.promise);

    renderPage(['/app/crop-library?cropId=1']);

    await screen.findByRole('heading', { level: 2, name: 'Tomate' });
    const searchInput = screen.getByLabelText('Öffentliche Kulturen durchsuchen');
    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const editDialog = await screen.findByRole('dialog', { name: 'Öffentliche Kultur bearbeiten' });

    fireEvent.change(within(editDialog).getByLabelText('Wachstumszeit (Tage)'), { target: { value: '48' } });
    await user.click(within(editDialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(publicCropApiMocks.update).toHaveBeenCalledTimes(1));

    fireEvent.change(searchInput, { target: { value: 'Roma' } });
    const searchForm = searchInput.closest('form');
    expect(searchForm).not.toBeNull();
    fireEvent.submit(searchForm as HTMLFormElement);
    expect(publicCropApiMocks.list).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingUpdate.resolve({
        data: {
          ...publicCrops[0],
          growth_duration_days: 48,
          display_color: '#123456',
          version: 2,
        },
      });
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Öffentliche Kultur bearbeiten' })).not.toBeInTheDocument());

    await waitFor(() => expect(screen.getByText('48 Tage')).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.queryByText('70 Tage')).not.toBeInTheDocument();
  }, 30000);

  describe('re-import handling', () => {
    async function importViaButton(user: ReturnType<typeof userEvent.setup>): Promise<void> {
      await user.click(await screen.findByRole('option', { name: 'Tomate (Roma)' }));
      const cropDetailHeader = screen.getByTestId('public-crop-detail-header');
      await user.click(within(cropDetailHeader).getByRole('button', { name: 'In Projekt importieren' }));
    }

    it('imports a crop for the first time', async () => {
      const user = userEvent.setup();
      const snackbarSpy = vi.fn<(event: Event) => void>();
      window.addEventListener(GLOBAL_SNACKBAR_EVENT, snackbarSpy);
      publicCropApiMocks.importToProject.mockResolvedValue({
        data: { crop: { id: 99 }, operation: 'created' },
      });
      renderPage();

      await importViaButton(user);

      await waitFor(() => expect(publicCropApiMocks.importToProject).toHaveBeenCalledWith(1, undefined));
      await waitFor(() => expect(snackbarSpy).toHaveBeenCalled());
      const event = snackbarSpy.mock.calls[0]?.[0] as CustomEvent<GlobalSnackbarDetail>;
      expect(event.detail.message).toBe('„Tomate (Roma)“ wurde in dieses Projekt importiert.');
      expect(event.detail.severity).toBe('success');
      window.removeEventListener(GLOBAL_SNACKBAR_EVENT, snackbarSpy);
    });

    it('shows a non-blocking info toast when re-importing an unchanged crop', async () => {
      const user = userEvent.setup();
      const snackbarSpy = vi.fn<(event: Event) => void>();
      window.addEventListener(GLOBAL_SNACKBAR_EVENT, snackbarSpy);
      publicCropApiMocks.importToProject.mockResolvedValue({
        data: { crop: { id: 42 }, operation: 'unchanged' },
      });
      renderPage();

      await importViaButton(user);

      await waitFor(() => expect(snackbarSpy).toHaveBeenCalled());
      const event = snackbarSpy.mock.calls[0]?.[0] as CustomEvent<GlobalSnackbarDetail>;
      expect(event.detail.message).toBe('„Tomate (Roma)“ ist bereits identisch in diesem Projekt vorhanden – kein Update erforderlich.');
      expect(event.detail.severity).toBe('info');
      window.removeEventListener(GLOBAL_SNACKBAR_EVENT, snackbarSpy);
    });

    it('automatically syncs and reports an update when the library version changed with no local edits', async () => {
      const user = userEvent.setup();
      const snackbarSpy = vi.fn<(event: Event) => void>();
      window.addEventListener(GLOBAL_SNACKBAR_EVENT, snackbarSpy);
      publicCropApiMocks.importToProject.mockResolvedValue({
        data: { crop: { id: 42 }, operation: 'updated' },
      });
      renderPage();

      await importViaButton(user);

      await waitFor(() => expect(snackbarSpy).toHaveBeenCalled());
      const event = snackbarSpy.mock.calls[0]?.[0] as CustomEvent<GlobalSnackbarDetail>;
      expect(event.detail.message).toBe('„Tomate (Roma)“ wurde aktualisiert (neue Version aus der Bibliothek übernommen).');
      expect(event.detail.severity).toBe('success');
      window.removeEventListener(GLOBAL_SNACKBAR_EVENT, snackbarSpy);
    });

    it('opens a conflict dialog when re-importing over local changes, and cancel makes no request', async () => {
      const user = userEvent.setup();
      const conflictError = {
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            code: 'import_requires_confirmation',
            detail: 'This public crop was already imported and has local changes.',
            existing_crop_id: 42,
            existing_crop_name: 'Tomate (Roma)',
          },
        },
      };
      publicCropApiMocks.importToProject.mockRejectedValue(conflictError);
      renderPage();

      await importViaButton(user);

      const dialog = await screen.findByRole('dialog', { name: 'Bereits importiert' });
      expect(within(dialog).getByText(/wurde bereits in dieses Projekt importiert/)).toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bereits importiert' })).not.toBeInTheDocument());
      expect(publicCropApiMocks.importToProject).toHaveBeenCalledTimes(1);
    });

    it('resolves the conflict dialog with "Aktualisieren" by re-importing with mode=update', async () => {
      const user = userEvent.setup();
      const snackbarSpy = vi.fn<(event: Event) => void>();
      window.addEventListener(GLOBAL_SNACKBAR_EVENT, snackbarSpy);
      const conflictError = {
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            code: 'import_requires_confirmation',
            detail: 'This public crop was already imported and has local changes.',
            existing_crop_id: 42,
            existing_crop_name: 'Tomate (Roma)',
          },
        },
      };
      publicCropApiMocks.importToProject
        .mockRejectedValueOnce(conflictError)
        .mockResolvedValueOnce({ data: { crop: { id: 42 }, operation: 'updated' } });
      renderPage();

      await importViaButton(user);
      const dialog = await screen.findByRole('dialog', { name: 'Bereits importiert' });
      await user.click(within(dialog).getByRole('button', { name: 'Aktualisieren' }));

      await waitFor(() => expect(publicCropApiMocks.importToProject).toHaveBeenNthCalledWith(2, 1, 'update'));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bereits importiert' })).not.toBeInTheDocument());
      const event = snackbarSpy.mock.calls.at(-1)?.[0] as CustomEvent<GlobalSnackbarDetail>;
      expect(event.detail.message).toBe('„Tomate (Roma)“ wurde aktualisiert (lokale Änderungen wurden überschrieben).');
      window.removeEventListener(GLOBAL_SNACKBAR_EVENT, snackbarSpy);
    });

    it('resolves the conflict dialog with "Als neue Kultur importieren" by re-importing with mode=new', async () => {
      const user = userEvent.setup();
      const snackbarSpy = vi.fn<(event: Event) => void>();
      window.addEventListener(GLOBAL_SNACKBAR_EVENT, snackbarSpy);
      const conflictError = {
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            code: 'import_requires_confirmation',
            detail: 'This public crop was already imported and has local changes.',
            existing_crop_id: 42,
            existing_crop_name: 'Tomate (Roma)',
          },
        },
      };
      publicCropApiMocks.importToProject
        .mockRejectedValueOnce(conflictError)
        .mockResolvedValueOnce({ data: { crop: { id: 100 }, operation: 'created' } });
      renderPage();

      await importViaButton(user);
      const dialog = await screen.findByRole('dialog', { name: 'Bereits importiert' });
      await user.click(within(dialog).getByRole('button', { name: 'Als neue Kultur importieren' }));

      await waitFor(() => expect(publicCropApiMocks.importToProject).toHaveBeenNthCalledWith(2, 1, 'new'));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bereits importiert' })).not.toBeInTheDocument());
      const event = snackbarSpy.mock.calls.at(-1)?.[0] as CustomEvent<GlobalSnackbarDetail>;
      expect(event.detail.message).toBe('„Tomate (Roma)“ wurde als neue Kultur importiert.');
      window.removeEventListener(GLOBAL_SNACKBAR_EVENT, snackbarSpy);
    });
  });

  it('supports the same keyboard shortcuts as the project crop list (Alt+E, Alt+I, Alt+Shift+arrows)', async () => {
    publicCropApiMocks.importToProject.mockResolvedValue({ data: { crop: {}, operation: 'created' } });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('option', { name: 'Tomate (Roma)' }));
    await screen.findByRole('heading', { level: 2, name: 'Tomate' });
    (document.activeElement as HTMLElement | null)?.blur();

    await user.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
    expect(await screen.findByRole('heading', { level: 2, name: 'Salat' })).toBeInTheDocument();

    await user.keyboard('{Alt>}{Shift>}{ArrowLeft}{/Shift}{/Alt}');
    expect(await screen.findByRole('heading', { level: 2, name: 'Tomate' })).toBeInTheDocument();

    await user.keyboard('{Alt>}e{/Alt}');
    expect(await screen.findByRole('dialog', { name: 'Öffentliche Kultur bearbeiten' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Öffentliche Kultur bearbeiten' })).not.toBeInTheDocument());

    await user.keyboard('{Alt>}i{/Alt}');
    await waitFor(() => expect(publicCropApiMocks.importToProject).toHaveBeenCalledWith(1, undefined));
  }, 30000);

  describe('species groups without a general entry are not greyed out', () => {
    it('renders the species row as a selectable option instead of a disabled presentation row', async () => {
      renderPage();

      const tomatoRow = await screen.findByRole('option', { name: 'Tomate' });
      expect(tomatoRow).not.toHaveAttribute('aria-disabled', 'true');
      expect(tomatoRow).not.toHaveClass('Mui-disabled');
    });

    it('selects the first (and only) variety when clicking a single-variety species row', async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('option', { name: 'Tomate' }));

      expect(await screen.findByRole('heading', { level: 2, name: 'Tomate' })).toBeInTheDocument();
      const cropDetailHeader = screen.getByTestId('public-crop-detail-header');
      expect(within(cropDetailHeader).getByText('Roma')).toBeInTheDocument();
    });

    it('expands the group and selects the first variety when clicking a multi-variety species row with no general entry', async () => {
      publicCropApiMocks.list.mockResolvedValue(paginated([
        ...publicCrops,
        {
          id: 3,
          status: 'published',
          name: 'Kohl',
          variety: 'Odysseus',
          crop_species_name: 'Kohl',
          version: 1,
          original_language_code: 'de',
          published_at: '2026-07-24T10:00:00Z',
          created_at: '2026-07-21T08:00:00Z',
          updated_at: '2026-07-25T12:00:00Z',
        },
        {
          id: 4,
          status: 'published',
          name: 'Kohl',
          variety: 'Noriko',
          crop_species_name: 'Kohl',
          version: 1,
          original_language_code: 'de',
          published_at: '2026-07-24T10:00:00Z',
          created_at: '2026-07-21T08:00:00Z',
          updated_at: '2026-07-25T12:00:00Z',
        },
      ]));
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('option', { name: 'Kohl' }));

      expect(await screen.findByRole('heading', { level: 2, name: 'Kohl' })).toBeInTheDocument();
      const cropDetailHeader = screen.getByTestId('public-crop-detail-header');
      expect(within(cropDetailHeader).getByText('Odysseus')).toBeInTheDocument();
      expect(await screen.findByRole('option', { name: 'Kohl (Noriko)' })).toBeInTheDocument();
    });
  });

  describe('import button reflects project_import_status', () => {
    it('shows "Im Projekt aktualisieren" for a crop already imported into the active project, and "In Projekt importieren" for one that is not', async () => {
      publicCropApiMocks.list.mockResolvedValue(paginated([
        {
          ...publicCrops[0],
          project_import_status: { crop_id: 5, crop_name: 'Tomate (Roma)', is_modified_from_source: false },
        },
        publicCrops[1],
      ]));
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('option', { name: 'Tomate (Roma)' }));
      const cropDetailHeader = screen.getByTestId('public-crop-detail-header');
      await screen.findByRole('heading', { level: 2, name: 'Tomate' });
      expect(within(cropDetailHeader).getByRole('button', { name: 'Im Projekt aktualisieren' })).toBeInTheDocument();
      expect(within(cropDetailHeader).queryByRole('button', { name: 'In Projekt importieren' })).not.toBeInTheDocument();

      (document.activeElement as HTMLElement | null)?.blur();
      await user.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
      expect(await screen.findByRole('heading', { level: 2, name: 'Salat' })).toBeInTheDocument();
      expect(within(cropDetailHeader).getByRole('button', { name: 'In Projekt importieren' })).toBeInTheDocument();
      expect(within(cropDetailHeader).queryByRole('button', { name: 'Im Projekt aktualisieren' })).not.toBeInTheDocument();
    });

    it('switches the button to "Im Projekt aktualisieren" right after a first-time import succeeds', async () => {
      publicCropApiMocks.importToProject.mockResolvedValue({
        data: {
          crop: { id: 99, name: 'Tomate', variety: 'Roma', crop_display_name: 'Tomate (Roma)', is_modified_from_source: false },
          operation: 'created',
        },
      });
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('option', { name: 'Tomate (Roma)' }));
      const cropDetailHeader = screen.getByTestId('public-crop-detail-header');
      await user.click(within(cropDetailHeader).getByRole('button', { name: 'In Projekt importieren' }));

      expect(await within(cropDetailHeader).findByRole('button', { name: 'Im Projekt aktualisieren' })).toBeInTheDocument();
    });
  });
  describe('crop species awaiting moderation', () => {
    const pendingCrops = [
      { ...publicCrops[0], crop_species_status: 'proposed' as const },
      publicCrops[1],
    ];

    it('marks the entry as pending and blocks import while the species is unreviewed', async () => {
      publicCropApiMocks.list.mockResolvedValue(paginated(pendingCrops));
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('option', { name: 'Tomate (Roma)' }));
      const cropDetailHeader = screen.getByTestId('public-crop-detail-header');

      expect(within(cropDetailHeader).getByText('Vorschlag in Prüfung')).toBeInTheDocument();
      expect(within(cropDetailHeader).getByRole('button', { name: 'In Projekt importieren' })).toBeDisabled();
    });

    it('blocks starting a discussion and explains why', async () => {
      publicCropApiMocks.list.mockResolvedValue(paginated(pendingCrops));
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('option', { name: 'Tomate (Roma)' }));
      await user.click(screen.getByRole('tab', { name: /Diskussion/i }));

      expect(await screen.findByText(/Diese Funktion ist erst verfügbar, sobald der Kulturart-Vorschlag/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Neue Diskussion' })).toBeDisabled();
    });

    it('leaves everything enabled for a species that was already reviewed', async () => {
      publicCropApiMocks.list.mockResolvedValue(paginated(publicCrops));
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('option', { name: 'Tomate (Roma)' }));
      const cropDetailHeader = screen.getByTestId('public-crop-detail-header');

      expect(within(cropDetailHeader).queryByText('Vorschlag in Prüfung')).not.toBeInTheDocument();
      expect(within(cropDetailHeader).getByRole('button', { name: 'In Projekt importieren' })).toBeEnabled();
    });
  });
});
