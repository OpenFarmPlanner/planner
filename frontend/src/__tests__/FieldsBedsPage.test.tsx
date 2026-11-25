import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FieldsBedsPage from '../pages/FieldsBedsPage';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { useContext, useState, type ReactNode } from 'react';
import { ParcelRotationContext } from '../components/hierarchy/rotation/parcelRotationContext';
import type { GraphicalFieldsProps } from '../pages/graphicalFieldsGeometry';

const { locationListMock, locationCreateMock, fieldListMock, bedListMock, addFieldMock, navigateMock, rotationListMock } = vi.hoisted(() => ({
  rotationListMock: vi.fn(),
  locationListMock: vi.fn(),
  locationCreateMock: vi.fn(),
  fieldListMock: vi.fn(),
  bedListMock: vi.fn(),
  addFieldMock: vi.fn(),
  navigateMock: vi.fn(),
}));
const projectRequirementState = vi.hoisted(() => ({
  activeProjectId: 1 as number | null,
  userId: 71,
  shouldShowProjectRequiredState: false,
  missingProjectReason: null as null | 'no_projects' | 'no_active_project',
  activeProjectMembership: undefined as { project_id: number } | undefined,
}));

function RotationContextProbe() {
  const { memberships, manage, status } = useContext(ParcelRotationContext);
  return (
    <>
      <span data-testid="rotation-status">{status}</span>
      <span data-testid="rotation-membership">{JSON.stringify(memberships.get(11) ?? null)}</span>
      {manage ? <button type="button" onClick={manage}>Probe: manage rotation</button> : null}
    </>
  );
}

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
      <RotationContextProbe />
      <div data-testid="create-field-request">{createFieldRequest ?? 0}</div>
      <div data-testid="location-order">
        {hierarchyData?.locations.map((l) => l.name).join(', ')}
      </div>
    </div>
  ),
}));

vi.mock('../pages/GraphicalFields', () => ({
  default: ({ interactionMode, selectedLocationId, hierarchyData }: GraphicalFieldsProps) => (
    <div><span>{`EditMode-${interactionMode ?? 'location-scoped'}`}</span>
      <span data-testid="selected-graphical-location">{selectedLocationId}</span>
      <button onClick={() => hierarchyData?.setLocations(current => current.filter(item => item.id !== selectedLocationId))}>Remove displayed location</button>
    </div>
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
    parcelRotationAPI: { ...actual.parcelRotationAPI, list: rotationListMock },
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
const registeredUiState: { topbarActions: RegisteredTopbarAction[]; titleActions: RegisteredTopbarAction[] } = { topbarActions: [], titleActions: [] };

vi.mock('../hooks/useTopbarTitleActions', () => ({
  useTopbarTitleActions: (_setter: unknown, actions: RegisteredTopbarAction[]) => { registeredUiState.titleActions = actions; },
}));

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
    projectRequirementState.activeProjectId = 1;
    projectRequirementState.userId = 71;
    projectRequirementState.shouldShowProjectRequiredState = false;
    projectRequirementState.missingProjectReason = null;
    projectRequirementState.activeProjectMembership = undefined;
    rotationListMock.mockReset();
    rotationListMock.mockResolvedValue({ data: [] });
    locationListMock.mockResolvedValue({
      data: {
        results: [{ id: 1, name: 'Hofstelle' }],
      },
    });
    fieldListMock.mockResolvedValue({ data: { results: [{ id: 11, name: 'Nord', location: 1 }] } });
    bedListMock.mockResolvedValue({ data: { results: [{ id: 21, name: 'A', field: 11 }] } });
    addFieldMock.mockReset();
    navigateMock.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('provides rotation memberships and project-level management to the list (#1576)', async () => {
    projectRequirementState.activeProjectMembership = { project_id: 1 };
    rotationListMock.mockResolvedValue({ data: [{
      id: 5, name: 'Nord–Süd', parcels: [{ id: 12, name: 'Süd', beds: [] }, { id: 11, name: 'Nord', beds: [] }],
    }] });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('rotation-membership')).toHaveTextContent('{"group":"Nord–Süd","position":2,"size":2}');
    });
    // The former topbar overflow only held this action; it now lives in the list toolbar.
    expect(screen.queryByRole('button', { name: 'Weitere Aktionen' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Probe: manage rotation' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rotationsgruppen verwalten' });
    // Opened project-wide: no parcel is preselected into a new group.
    expect(within(dialog).getByRole('combobox', { name: 'Rotationsgruppe' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('list', { name: 'Parzellenreihenfolge' })).not.toBeInTheDocument();
  });

  it('lets only the latest rotation-group load update the page', async () => {
    projectRequirementState.activeProjectMembership = { project_id: 1 };
    let rejectMountLoad: (reason: unknown) => void = () => undefined;
    rotationListMock.mockReset();
    rotationListMock
      .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectMountLoad = reject; }))
      .mockResolvedValueOnce({ data: [{ id: 5, name: 'Nord–Süd', parcels: [{ id: 11, name: 'Nord', beds: [] }] }] });
    const user = userEvent.setup();
    renderPage();

    // Opening management while the mount load is pending starts a newer load that succeeds first.
    await user.click(await screen.findByRole('button', { name: 'Probe: manage rotation' }));
    await waitFor(() => expect(screen.getByTestId('rotation-status')).toHaveTextContent('ready'));
    await act(async () => { rejectMountLoad(new Error('Late failure')); });

    expect(screen.getByTestId('rotation-status')).toHaveTextContent('ready');
    expect(screen.getByTestId('rotation-membership')).toHaveTextContent('"group":"Nord–Süd"');
    expect(await screen.findByRole('dialog', { name: 'Rotationsgruppen verwalten' })).toBeInTheDocument();
    expect(screen.queryByText('Die Rotationsgruppen konnten nicht geladen werden.')).not.toBeInTheDocument();
  });

  it('offers no rotation management without project membership', async () => {
    renderPage();

    expect(await screen.findByText('Hierarchieansicht')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Probe: manage rotation' })).not.toBeInTheDocument();
  });

  it('restores graphical view from persisted state', async () => {
    window.localStorage.setItem('fieldsBedsViewMode', 'graphical');

    renderPage();

    expect(await screen.findByText('EditMode-view')).toBeInTheDocument();
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

  it('shows a load error instead of the missing-location empty state when the hierarchy fetch fails', async () => {
    locationListMock.mockRejectedValue(new Error('Request failed with status code 400'));
    fieldListMock.mockRejectedValue(new Error('Request failed with status code 400'));
    bedListMock.mockRejectedValue(new Error('Request failed with status code 400'));

    renderPage();

    expect(await screen.findByText('Fehler beim Laden der Daten')).toBeInTheDocument();
    expect(screen.queryByText('Standort fehlt')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Standort hinzufügen' })).not.toBeInTheDocument();
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

  it('shows the only location row with plot guidance when no fields exist', async () => {
    const user = userEvent.setup();
    locationListMock.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hofstelle' }] } });
    fieldListMock.mockResolvedValue({ data: { results: [] } });
    bedListMock.mockResolvedValue({ data: { results: [] } });

    renderPage();
    expect(await screen.findByText('Parzelle fehlt')).toBeInTheDocument();
    // The location row is always listed; its add icon is how plots are added.
    expect(screen.getByText('Hierarchieansicht')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('Füge beim gewünschten Standort über das') && content.includes('Symbol oder das Kontextmenü eine Parzelle hinzu.'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Parzelle hinzufügen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'zusätzliche Standorte anlegen' })).not.toBeInTheDocument();
    expect(registeredUiState.topbarActions.find((action) => action.id === 'fields-global-add-field')).toBeUndefined();
    const addLocationAction = registeredUiState.topbarActions.find((action) => action.id === 'fields-global-add-location');
    expect(addLocationAction?.hidden).toBeFalsy();
    expect(addLocationAction?.menuActions).toBeUndefined();

    act(() => {
      addLocationAction?.onClick?.();
    });
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
  });

  it('inserts a newly created location first, near the "Standort hinzufügen" action, without a full reload', async () => {
    const user = userEvent.setup();
    locationCreateMock.mockResolvedValue({ data: { id: 2, name: 'Nebenstelle' } });

    renderPage();
    await waitFor(() => expect(screen.getByTestId('location-order')).toHaveTextContent('Hofstelle'));
    expect(locationListMock).toHaveBeenCalledTimes(1);

    const addLocationAction = registeredUiState.topbarActions.find((action) => action.id === 'fields-global-add-location');
    expect(addLocationAction?.label).toBe('Standort hinzufügen');
    act(() => {
      addLocationAction?.onClick?.();
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
    expect(registeredUiState.topbarActions.find((action) => action.id === 'fields-global-add-location')?.hidden).toBeFalsy();
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
  function WorkspaceShell() {
    const [controls, setControls] = useState<ReactNode>(null);
    return <>{controls}<Outlet context={{ setTopbarWorkspaceControls: setControls }} /></>;
  }
  const workspace = () => <MemoryRouter><Routes><Route element={<WorkspaceShell />}>
    <Route index element={<FieldsBedsPage />} />
  </Route></Routes></MemoryRouter>;

  it('retains a geometry-only display preference for the account that chose it', async () => {
    window.localStorage.setItem('fieldsBedsViewMode', 'graphical');
    const user = userEvent.setup();
    const view = render(workspace());
    await user.click(await screen.findByRole('button', { name: 'Darstellung der Grafik · Kulturen & Aufgaben' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Anbauflächen' }));
    expect(window.localStorage.getItem('growingAreas.graphic.displayMode:user:71')).toBe('areas');

    projectRequirementState.userId = 72;
    view.rerender(workspace());
    expect(await screen.findByRole('button', { name: 'Darstellung der Grafik · Kulturen & Aufgaben' })).toBeInTheDocument();
    projectRequirementState.userId = 71;
    view.rerender(workspace());
    expect(await screen.findByRole('button', { name: 'Darstellung der Grafik · Anbauflächen' })).toBeInTheDocument();
  });

  it('keeps location selection across representations and falls back safely after removal', async () => {
    locationListMock.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hof Nord' }, { id: 2, name: 'Hof Süd' }] } });
    fieldListMock.mockResolvedValue({ data: { results: [{ id: 11, name: 'Nord', location: 1 }, { id: 21, name: 'Süd', location: 2 }] } });
    window.localStorage.setItem('fieldsBedsViewMode', 'graphical');
    const user = userEvent.setup();
    render(workspace());
    await user.click(await screen.findByRole('combobox', { name: 'Standort' }));
    await user.click(screen.getByRole('option', { name: 'Hof Süd' }));
    expect(screen.getByTestId('selected-graphical-location')).toHaveTextContent('2');
    act(() => registeredUiState.titleActions.find(action => action.id === 'fields-view-mode-list')?.onClick?.());
    expect(screen.queryByRole('combobox', { name: 'Standort' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location-order')).toHaveTextContent('Hof Nord, Hof Süd');
    act(() => registeredUiState.titleActions.find(action => action.id === 'fields-view-mode-graphical')?.onClick?.());
    expect(await screen.findByTestId('selected-graphical-location')).toHaveTextContent('2');
    await user.click(await screen.findByRole('button', { name: 'Grafik bearbeiten' }));
    expect(screen.getByText('EditMode-edit')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove displayed location' }));
    expect(screen.getByTestId('selected-graphical-location')).toHaveTextContent('1');
    expect(screen.getByText('EditMode-view')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Standort' })).not.toBeInTheDocument();
    expect(await screen.findByText('Standort: Hof Nord')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove displayed location' }));
    expect(screen.queryByRole('button', { name: 'Grafik bearbeiten' })).not.toBeInTheDocument();
    expect(screen.getByText('Standort fehlt')).toBeInTheDocument();
  });

  it('resets graphic editing and location data when the active project changes', async () => {
    window.localStorage.setItem('fieldsBedsViewMode', 'graphical');
    const user = userEvent.setup();
    const view = render(workspace());
    await user.click(await screen.findByRole('button', { name: 'Grafik bearbeiten' }));
    expect(screen.getByText('EditMode-edit')).toBeInTheDocument();
    projectRequirementState.activeProjectId = 2;
    locationListMock.mockResolvedValue({ data: { results: [{ id: 7, name: 'Anderer Hof' }] } });
    fieldListMock.mockResolvedValue({ data: { results: [{ id: 77, name: 'Anderes Feld', location: 7 }] } });
    bedListMock.mockResolvedValue({ data: { results: [{ id: 777, name: 'Anderes Beet', field: 77 }] } });
    view.rerender(workspace());
    await screen.findByText('Standort: Anderer Hof');
    expect(screen.getByTestId('selected-graphical-location')).toHaveTextContent('7');
    expect(screen.getByText('EditMode-view')).toBeInTheDocument();
    expect(screen.queryByText('Standort: Hofstelle')).not.toBeInTheDocument();
  });

});
