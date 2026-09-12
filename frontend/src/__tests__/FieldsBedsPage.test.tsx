import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FieldsBedsPage from '../pages/FieldsBedsPage';
import { MemoryRouter } from 'react-router';

const { locationListMock, locationCreateMock, fieldListMock, bedListMock, addFieldMock, navigateMock } = vi.hoisted(() => ({
  locationListMock: vi.fn(),
  locationCreateMock: vi.fn(),
  fieldListMock: vi.fn(),
  bedListMock: vi.fn(),
  addFieldMock: vi.fn(),
  navigateMock: vi.fn(),
}));
const projectRequirementState = vi.hoisted(() => ({
  shouldShowProjectRequiredState: false,
  missingProjectReason: null as null | 'no_projects' | 'no_active_project',
}));

vi.mock('../pages/FieldsBedsHierarchy', () => ({
  default: ({
    createFieldRequest,
    hierarchyData,
  }: {
    createFieldRequest?: number;
    hierarchyData?: { locations: { name: string }[] };
  }) => (
    <div>
      <div>Hierarchieansicht</div>
      <div data-testid="create-field-request">{createFieldRequest ?? 0}</div>
      <div data-testid="location-order">
        {hierarchyData?.locations.map((l) => l.name).join(', ')}
      </div>
    </div>
  ),
}));

vi.mock('../pages/GraphicalFields', () => ({
  default: ({ interactionMode }: { interactionMode?: 'view' | 'edit' }) => (
    <div>{`EditMode-${interactionMode ?? 'location-scoped'}`}</div>
  ),
}));

vi.mock('../commands/useCommandContext', () => ({
  useCommandContextTag: vi.fn(),
  useRegisterCommands: vi.fn(),
  useRegisterCreateActions: vi.fn(),
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    // listAll mirrors whatever list() is mocked to resolve, unwrapped —
    // useHierarchyData uses listAll (not list) to fetch every page.
    locationAPI: {
      list: locationListMock,
      listAll: async () => (await locationListMock()).data,
      create: locationCreateMock,
    },
    fieldAPI: {
      list: fieldListMock,
      listAll: async () => (await fieldListMock()).data,
    },
    bedAPI: {
      list: bedListMock,
      listAll: async () => (await bedListMock()).data,
    },
  };
});

vi.mock('../components/hierarchy/hooks/useFieldOperations', () => ({
  useFieldOperations: () => ({
    addField: addFieldMock,
    deleteField: vi.fn(),
  }),
}));

vi.mock('../hooks/useProjectRequirement', () => ({
  useProjectRequirement: () => projectRequirementState,
}));

interface RegisteredTopbarAction {
  id: string;
  label: string;
  hidden?: boolean;
  onClick?: () => void;
  menuActions?: RegisteredTopbarAction[];
}
const registeredUiState: { topbarActions: RegisteredTopbarAction[] } = { topbarActions: [] };

vi.mock('../hooks/useTopbarContextActions', () => ({
  useTopbarContextActions: (_setter: unknown, actions: typeof registeredUiState.topbarActions) => {
    registeredUiState.topbarActions = actions;
  },
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe('FieldsBedsPage', () => {
  const renderPage = (): void => {
    render(
      <MemoryRouter>
        <FieldsBedsPage />
      </MemoryRouter>
    );
  };

  beforeEach(() => {
    locationListMock.mockReset();
    locationCreateMock.mockReset();
    fieldListMock.mockReset();
    bedListMock.mockReset();
    projectRequirementState.shouldShowProjectRequiredState = false;
    projectRequirementState.missingProjectReason = null;
    locationListMock.mockResolvedValue({
      data: {
        results: [{ id: 1, name: 'Hofstelle' }],
      },
    });
    fieldListMock.mockResolvedValue({ data: { results: [{ id: 11, name: 'Nord' }] } });
    bedListMock.mockResolvedValue({ data: { results: [{ id: 21, name: 'A', field: 11 }] } });
    addFieldMock.mockReset();
    navigateMock.mockReset();
    window.localStorage.clear();
  });

  it('restores graphical view from persisted state', async () => {
    window.localStorage.setItem('fieldsBedsViewMode', 'graphical');

    renderPage();

    expect(await screen.findByText('EditMode-location-scoped')).toBeInTheDocument();
    expect(screen.queryByText('Hierarchieansicht')).not.toBeInTheDocument();
  });

  it('shows a neutral project-required state when no project is available', async () => {
    projectRequirementState.shouldShowProjectRequiredState = true;
    projectRequirementState.missingProjectReason = 'no_projects';

    renderPage();

    expect(await screen.findByText('Du hast noch kein Projekt.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erstes Projekt anlegen' })).toBeInTheDocument();
    expect(screen.queryByText('Hierarchieansicht')).not.toBeInTheDocument();
    expect(locationListMock).not.toHaveBeenCalled();
  });


  it('starts inline add-field editing via route action instead of native prompt', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    render(
      <MemoryRouter initialEntries={['/app/fields-beds?action=add-parcel']}>
        <FieldsBedsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Hierarchieansicht')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('create-field-request')).toHaveTextContent('1'));
    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('shows onboarding empty-state when no area hierarchy exists', async () => {
    locationListMock.mockResolvedValue({ data: { results: [] } });
    fieldListMock.mockResolvedValue({ data: { results: [] } });
    bedListMock.mockResolvedValue({ data: { results: [] } });

    renderPage();

    expect(await screen.findByText('Standort fehlt')).toBeInTheDocument();
    expect(screen.getByText('Der Hauptstandort ist für dieses Projekt noch nicht verfügbar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Standort hinzufügen' })).toBeInTheDocument();
    expect(screen.queryByText('Keine Einträge vorhanden')).not.toBeInTheDocument();
    expect(screen.queryByText('Hierarchieansicht')).not.toBeInTheDocument();
  });

  it('shows missing field requirement when location exists but no fields exist', async () => {
    const user = userEvent.setup();
    locationListMock.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hofstelle' }] } });
    fieldListMock.mockResolvedValue({ data: { results: [] } });
    bedListMock.mockResolvedValue({ data: { results: [] } });

    renderPage();
    expect(await screen.findByText('Parzelle fehlt')).toBeInTheDocument();
    expect(screen.getByText('Lege eine Parzelle an, um zu starten.')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('Falls du Flächen an mehreren Orten bewirtschaftest, kannst du auch'))).toBeInTheDocument();
    const addLocationLink = screen.getByRole('link', { name: 'zusätzliche Standorte anlegen' });
    expect(addLocationLink).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Parzelle hinzufügen' })).toHaveLength(1);
    expect(registeredUiState.topbarActions.find((action) => action.id === 'fields-global-add-field')?.menuActions?.map((action) => action.label))
      .toEqual(['Standort hinzufügen']);
    expect(registeredUiState.topbarActions.find((action) => action.id === 'fields-global-add-location')?.hidden).toBe(true);
    expect(screen.queryByText('Tipp: Rechtsklick auf eine Tabellenzeile öffnet weitere Aktionen.')).not.toBeInTheDocument();
    expect(screen.queryByText('Hierarchieansicht')).not.toBeInTheDocument();

    await user.click(addLocationLink);
    expect(screen.getByRole('dialog', { name: 'Weiteren Standort hinzufügen' })).toBeInTheDocument();
    const addLocationButton = screen.getByRole('button', { name: 'Standort anlegen' });
    expect(addLocationButton).toBeDisabled();
    await user.hover(addLocationButton.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Bitte alle Pflichtfelder ausfüllen.');
    await user.unhover(addLocationButton.parentElement as HTMLElement);
    await user.type(screen.getByRole('textbox', { name: 'Name des Standorts' }), 'Außenfläche');
    expect(addLocationButton).toBeEnabled();
    await user.hover(addLocationButton.parentElement as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Weiteren Standort hinzufügen' })).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Parzelle hinzufügen' }));

    expect(await screen.findByText('Hierarchieansicht')).toBeInTheDocument();
    expect(screen.getByTestId('create-field-request')).toHaveTextContent('1');
  });

  it('inserts a newly created location first, near the "Standort hinzufügen" action, without a full reload', async () => {
    const user = userEvent.setup();
    locationCreateMock.mockResolvedValue({ data: { id: 2, name: 'Nebenstelle' } });

    renderPage();
    await waitFor(() => expect(screen.getByTestId('location-order')).toHaveTextContent('Hofstelle'));
    expect(locationListMock).toHaveBeenCalledTimes(1);

    // The hierarchy is fully populated here (a location, a field, a bed),
    // so "Standort hinzufügen" lives in the global add-field topbar
    // dropdown's menu, not as an inline empty-state link.
    const addFieldAction = registeredUiState.topbarActions.find((action) => action.id === 'fields-global-add-field');
    const addLocationMenuItem = addFieldAction?.menuActions?.find((action) => action.id === 'fields-global-add-location-menu-item');
    expect(addLocationMenuItem?.label).toBe('Standort hinzufügen');
    act(() => {
      addLocationMenuItem?.onClick?.();
    });

    await user.type(await screen.findByLabelText('Name des Standorts'), 'Nebenstelle');
    await user.click(screen.getByRole('button', { name: 'Standort anlegen' }));

    await waitFor(() => expect(locationCreateMock).toHaveBeenCalledWith({ name: 'Nebenstelle' }));
    // Inserted first (right next to the action that created it), not
    // reloaded/re-sorted to wherever it would fall alphabetically.
    await waitFor(() => expect(screen.getByTestId('location-order')).toHaveTextContent('Nebenstelle, Hofstelle'));
    // No full reload was triggered by the create — the location list was
    // only ever fetched once, on initial load.
    expect(locationListMock).toHaveBeenCalledTimes(1);
  });

  it('shows location rows and missing field guidance without an action when multiple locations exist', async () => {
    locationListMock.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hofstelle' }, { id: 2, name: 'Außenfeld' }] } });
    fieldListMock.mockResolvedValue({ data: { results: [] } });
    bedListMock.mockResolvedValue({ data: { results: [] } });

    renderPage();

    expect(await screen.findByText('Parzelle fehlt')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('Füge beim gewünschten Standort über das') && content.includes('Symbol oder das Kontextmenü eine Parzelle hinzu.'))).toBeInTheDocument();
    expect(screen.getByTestId('AddIcon')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Parzelle hinzufügen' })).not.toBeInTheDocument();
    expect(registeredUiState.topbarActions.find((action) => action.id === 'fields-global-add-field')).toBeUndefined();
    expect(registeredUiState.topbarActions.find((action) => action.id === 'fields-global-add-location')?.hidden).toBe(false);
    expect(screen.getByText('Hierarchieansicht')).toBeInTheDocument();
  });

  it('shows missing bed requirement when fields exist but no beds exist', async () => {
    locationListMock.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hofstelle' }] } });
    fieldListMock.mockResolvedValue({ data: { results: [{ id: 3, name: 'Nord' }] } });
    bedListMock.mockResolvedValue({ data: { results: [] } });

    renderPage();
    expect(await screen.findByText('Es sind noch keine Beete vorhanden.')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('Füge Beete über das') && content.includes('Symbol bei der jeweiligen Parzelle hinzu. Es erscheint beim Darüberfahren.'))).toBeInTheDocument();
    expect(screen.getByTestId('AddIcon')).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Anbauflächen vorhanden')).not.toBeInTheDocument();
  });

  it('keeps the missing bed requirement visible while an additional field draft exists', async () => {
    locationListMock.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hofstelle' }] } });
    fieldListMock.mockResolvedValue({
      data: {
        results: [
          { id: -1, name: '', location: 1 },
          { id: 3, name: 'Nord', location: 1 },
        ],
      },
    });
    bedListMock.mockResolvedValue({ data: { results: [] } });

    renderPage();

    expect(await screen.findByText('Es sind noch keine Beete vorhanden.')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('Füge Beete über das') && content.includes('Symbol bei der jeweiligen Parzelle hinzu. Es erscheint beim Darüberfahren.'))).toBeInTheDocument();
    expect(screen.getByText('Hierarchieansicht')).toBeInTheDocument();
  });
});
