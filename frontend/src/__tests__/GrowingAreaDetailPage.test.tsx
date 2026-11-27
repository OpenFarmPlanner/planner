import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveGrowingAreaEntity } from '../components/hierarchy/details/growingAreaEntity';
import { GrowingAreaCoverageRows } from '../pages/GrowingAreaCoverageRows';
import GrowingAreaDetailPage from '../pages/GrowingAreaDetailPage';
import { hasPendingFieldLayout, saveTrackedBedLayout, saveTrackedFieldLayout } from '../pages/graphicalLayoutRequests';

const apiMocks = vi.hoisted(() => ({
  projectId: 1,
  locations: vi.fn(),
  fields: vi.fn(),
  beds: vi.fn(),
  plans: vi.fn(),
  layouts: vi.fn(),
  bedUpdate: vi.fn(),
  tasks: vi.fn(),
  updateTaskStatus: vi.fn(),
  members: vi.fn(),
  rotationGroups: vi.fn(),
  rotationUpdate: vi.fn(),
  membership: undefined as { project_id: number } | undefined,
}));

vi.mock('../hooks/useProjectRequirement', () => ({
  useProjectRequirement: () => ({
    activeProjectId: apiMocks.projectId,
    activeProjectMembership: apiMocks.membership,
    shouldShowProjectRequiredState: false,
    missingProjectReason: null,
  }),
}));

vi.mock('../hooks/autosave', () => ({ useNavigationBlocker: vi.fn() }));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    locationAPI: { ...actual.locationAPI, listAll: apiMocks.locations },
    fieldAPI: { ...actual.fieldAPI, listAll: apiMocks.fields },
    bedAPI: { ...actual.bedAPI, listAll: apiMocks.beds, update: apiMocks.bedUpdate },
    layoutAPI: { ...actual.layoutAPI, listByLocation: apiMocks.layouts },
    plantingPlanAPI: { ...actual.plantingPlanAPI, listAll: apiMocks.plans },
    taskAPI: { ...actual.taskAPI, listAll: apiMocks.tasks, updateStatus: apiMocks.updateTaskStatus },
    projectAPI: { ...actual.projectAPI, listMembers: apiMocks.members },
    parcelRotationAPI: { ...actual.parcelRotationAPI, list: apiMocks.rotationGroups, update: apiMocks.rotationUpdate },
  };
});

const page = <T,>(results: T[]) => ({ data: { results, count: results.length, next: null, previous: null } });

const detailRoute = (path: string) => (
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/app/fields-beds/:entityType/:entityId" element={<GrowingAreaDetailPage />} />
      <Route path="/app/fields-beds" element={<div data-testid="list-page" />} />
    </Routes>
  </MemoryRouter>
);
const renderDetail = (path: string) => render(detailRoute(path));

const renderSeasonDetail = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route element={<Outlet context={{ activeSeason: { id: 38 } }} />}>
        <Route path="/app/fields-beds/:entityType/:entityId" element={<GrowingAreaDetailPage />} />
        <Route path="/app/fields-beds" element={<div data-testid="list-page" />} />
      </Route>
    </Routes>
  </MemoryRouter>,
);

const taskRow = (id: number, title: string, relations: {
  planting_plan?: number; field?: number; crop?: number; assigned_to?: number; due_date?: string;
} = {}) => ({ id, title, status: 'pending', season: 38, due_date: null, ...relations });

function seedAreaWork() {
  apiMocks.plans.mockResolvedValue(page([
    { id: 7, bed: 100, crop: 3, crop_name: 'Tomate', planting_date: '2026-05-01' },
    { id: 11, bed: 100, crop_name: 'Paprika', placement_mode: 'individual_bed', plants_count: 4, pending_plants_count: 2 },
    { id: 12, bed: null, parcel: 10, crop_name: 'Birne', placement_mode: 'individual_parcel', plants_count: 1 },
    { id: 13, bed: null, site: 1, crop_name: 'Pflaume', placement_mode: 'individual_site', plants_count: 2 },
    { id: 14, bed: null, site: 2, crop_name: 'Andere Pflaume', placement_mode: 'individual_site', plants_count: 2 },
  ]).data);
  const tasks = [
    taskRow(1, 'Tomaten pflegen', { planting_plan: 7, assigned_to: 12, due_date: '2025-04-20' }),
    taskRow(2, 'Paprika prüfen', { planting_plan: 11 }),
    taskRow(3, 'Birne gießen', { planting_plan: 12 }),
    taskRow(4, 'Pflaume schneiden', { planting_plan: 13 }),
    taskRow(5, 'Tunnel lüften', { field: 10 }),
    taskRow(6, 'Anderen Standort prüfen', { planting_plan: 14 }),
    taskRow(7, 'Allgemeine Erinnerung'),
    taskRow(8, 'Nur Kultur prüfen', { crop: 3 }),
    taskRow(9, 'Andere Parzelle prüfen', { field: 101 }),
  ];
  apiMocks.tasks.mockResolvedValue(page([...tasks, tasks[0]]).data);
  apiMocks.members.mockResolvedValue({ data: [{ user: 12, user_display_name: 'Garten-Team' }] });
  return tasks;
}

describe('GrowingAreaDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.projectId = 1;
    apiMocks.membership = { project_id: 1 };
    apiMocks.tasks.mockResolvedValue(page([]).data);
    apiMocks.updateTaskStatus.mockResolvedValue({});
    apiMocks.members.mockResolvedValue({ data: [] });
    apiMocks.rotationGroups.mockResolvedValue({ data: [] });
    apiMocks.layouts.mockResolvedValue({ data: { field_layouts: [], bed_layouts: [] } });
    apiMocks.locations.mockResolvedValue(page([
      { id: 1, name: 'Hofgarten', light_condition: 'sunny', irrigation: 'unavailable', length_m: 40, width_m: 20 },
    ]).data);
    apiMocks.fields.mockResolvedValue(page([
      { id: 10, name: 'Tunnel', location: 1, soil_moisture: 'dry', cultivation_environment: 'polytunnel' },
    ]).data);
    apiMocks.beds.mockResolvedValue(page([
      { id: 100, name: 'Tomate 1', field: 10, light_condition: 'shade', length_m: 10, width_m: 1, notes: '' },
    ]).data);
    apiMocks.plans.mockResolvedValue(page([
      { id: 7, bed: 100, crop: 3, crop_name: 'Tomate', planting_date: '2026-05-01' },
      { id: 8, bed: 999, crop: 3, crop_name: 'Fremd', planting_date: '2026-05-01' },
    ]).data);
  });

  it('shows zero covered area for a measured empty location after the layout loads', async () => {
    apiMocks.fields.mockResolvedValueOnce(page([]).data);
    let finishLayouts!: (data: unknown) => void;
    apiMocks.layouts.mockReturnValueOnce(new Promise(resolve => { finishLayouts = resolve; }));
    renderDetail('/app/fields-beds/locations/1');

    const geometry = within(await screen.findByTestId('detail-section-geometry'));
    expect(geometry.getByText('Flächenbelegung wird geladen …')).toBeVisible();
    expect(geometry.getByText('800 m²')).toBeVisible();
    expect(geometry.queryByTestId('detail-covered-area')).not.toBeInTheDocument();
    await act(async () => finishLayouts({ data: { field_layouts: [], bed_layouts: [] } }));
    expect(geometry.getByTestId('detail-covered-area')).toHaveTextContent('0 m²');
    expect(geometry.getByTestId('detail-remaining-area')).toHaveTextContent(/800 m² \(100\s*%\)/);
    expect(geometry.getByRole('img', { name: /0 m².*800 m².*100/ })).toBeVisible();
    expect(geometry.getAllByText('Bruttofläche')).toHaveLength(1);
  });

  it('recovers a failed coverage request and refreshes saved layouts on focus', async () => {
    apiMocks.fields.mockResolvedValue(page([
      { id: 10, name: 'Tunnel', location: 1, width_m: 10, length_m: 10 },
    ]).data);
    const layout = { field: 10, location: 1, x: 0, y: 0 };
    const payload = { bed_layouts: [], field_layouts: [layout], location_boundary: { x: 0, y: 0 } };
    apiMocks.layouts.mockRejectedValueOnce(new Error('Temporary layout error'))
      .mockResolvedValueOnce({ data: payload })
      .mockResolvedValueOnce({ data: { ...payload, field_layouts: [{ ...layout, x: 270 }] } });
    renderDetail('/app/fields-beds/locations/1');

    const geometry = within(await screen.findByTestId('detail-section-geometry'));
    expect(await geometry.findByRole('alert')).toHaveTextContent('Die Flächenbelegung konnte nicht geladen werden.');
    await userEvent.click(geometry.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await geometry.findByTestId('detail-covered-area')).toHaveTextContent('100 m²');
    fireEvent.focus(window);
    await waitFor(() => expect(geometry.getByTestId('detail-covered-area')).toHaveTextContent('50 m²'));
    expect(geometry.getByTestId('detail-remaining-area')).toHaveTextContent(/750 m² \(93,8\s*%\)/);
  });

  it('explains incomplete parcel measurements without displaying a zero as an estimate', async () => {
    renderDetail('/app/fields-beds/fields/10');
    const geometry = within(await screen.findByTestId('detail-section-geometry'));
    expect(await geometry.findByText('Für die Flächenberechnung fehlen Maße der Parzelle oder ihrer Beete.')).toBeVisible();
    expect(geometry.queryByTestId('detail-remaining-area')).not.toBeInTheDocument();
  });

  it('waits for consecutive bed drops to save in order before reading the parcel layout', async () => {
    apiMocks.fields.mockResolvedValue(page([
      { id: 10, name: 'Tunnel', location: 1, width_m: 10, length_m: 10 },
    ]).data);
    let finishSave!: () => void;
    const firstWrite = vi.fn(() => new Promise<void>(resolve => { finishSave = resolve; }));
    const lastWrite = vi.fn().mockResolvedValue(undefined);
    const firstSave = saveTrackedBedLayout(1, 100, firstWrite);
    const lastSave = saveTrackedBedLayout(1, 100, lastWrite);
    renderDetail('/app/fields-beds/fields/10');

    const geometry = within(await screen.findByTestId('detail-section-geometry'));
    expect(geometry.getByRole('status')).toBeVisible();
    expect(apiMocks.layouts).not.toHaveBeenCalled();
    expect(firstWrite).toHaveBeenCalledOnce();
    expect(lastWrite).not.toHaveBeenCalled();
    await act(async () => {
      finishSave();
      await Promise.all([firstSave, lastSave]);
    });
    expect(lastWrite).toHaveBeenCalledOnce();
    expect(geometry.getByTestId('detail-covered-area')).toBeVisible();
  });

  it('waits for another parcel drop queued during a location detail read', async () => {
    apiMocks.fields.mockResolvedValueOnce(page([]).data);
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const first = saveTrackedFieldLayout(1, () => new Promise<void>(resolve => { finishFirst = resolve; }));
    renderDetail('/app/fields-beds/locations/1');

    const geometry = within(await screen.findByTestId('detail-section-geometry'));
    expect(geometry.getByRole('status')).toBeVisible();
    const writeSecond = vi.fn(() => new Promise<void>(resolve => { finishSecond = resolve; }));
    const second = saveTrackedFieldLayout(1, writeSecond);
    expect(writeSecond).not.toHaveBeenCalled();
    await act(async () => { finishFirst(); await first; });
    expect(writeSecond).toHaveBeenCalledOnce();
    expect(hasPendingFieldLayout(1)).toBe(true);
    expect(apiMocks.layouts).not.toHaveBeenCalled();

    await act(async () => { finishSecond(); await second; });
    expect(hasPendingFieldLayout(1)).toBe(false);
    expect(geometry.getByTestId('detail-covered-area')).toHaveTextContent('0 m²');
  });

  it('clears coverage while loading layouts after the parcel moves to another location', async () => {
    const locations = [{ id: 1, name: 'Hofgarten' }, { id: 2, name: 'Neuer Standort' }];
    const resolveParcel = (location: number) => resolveGrowingAreaEntity('field', 10, {
      locations,
      fields: [{ id: 10, name: 'Tunnel', location, width_m: 10, length_m: 10 }],
      beds: [{ id: 100, name: 'Beet', field: 10, width_m: 2, length_m: 3 }],
    })!;
    let finishLayouts!: (data: unknown) => void;
    apiMocks.layouts.mockResolvedValueOnce({
      data: { field_layouts: [], bed_layouts: [{ bed: 100, location: 1, x: 144, y: 0 }] },
    }).mockReturnValueOnce(new Promise(resolve => { finishLayouts = resolve; }));
    const refreshHierarchy = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<GrowingAreaCoverageRows resolved={resolveParcel(1)} locale="de" refreshHierarchy={refreshHierarchy} />);
    expect(await screen.findByTestId('detail-covered-area')).toHaveTextContent('3 m²');

    rerender(<GrowingAreaCoverageRows resolved={resolveParcel(2)} locale="de" refreshHierarchy={refreshHierarchy} />);
    expect(screen.getByRole('status')).toBeVisible();
    expect(screen.queryByTestId('detail-covered-area')).not.toBeInTheDocument();
    await act(async () => finishLayouts({
      data: { field_layouts: [], bed_layouts: [{ bed: 100, location: 2, x: 0, y: 0 }] },
    }));
    expect(screen.getByTestId('detail-covered-area')).toHaveTextContent('6 m²');
  });

  it('shows own and inherited conditions with their source and hides empty sections', async () => {
    renderDetail('/app/fields-beds/beds/100');

    expect(await screen.findByRole('heading', { level: 1, name: 'Tomate 1' })).toBeInTheDocument();
    const light = screen.getByTestId('detail-light_condition');
    expect(light).toHaveTextContent('Schattig');
    expect(light).not.toHaveTextContent('Übernommen');
    const moisture = screen.getByTestId('detail-soil_moisture');
    expect(moisture).toHaveTextContent('Feuchtigkeit');
    expect(moisture).toHaveTextContent('Trocken');
    expect(moisture).toHaveTextContent('Übernommen von der Parzelle „Tunnel“');
    // The label explains that it is the typical long-term moisture, not a measurement.
    expect(within(moisture).getByRole('img', { name: /langfristig üblicherweise/ })).toBeInTheDocument();
    // Fields without an explanation get no info icon.
    expect(within(light).queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('detail-irrigation')).toHaveTextContent('Nicht verfügbar');
    expect(screen.getByTestId('detail-irrigation')).toHaveTextContent('Übernommen vom Standort „Hofgarten“');
    // Nothing set anywhere: no soil type row, no notes and no site-detail section.
    expect(screen.queryByTestId('detail-soil_type')).not.toBeInTheDocument();
    expect(screen.queryByTestId('detail-section-notes')).not.toBeInTheDocument();
    expect(screen.queryByTestId('detail-section-site-details')).not.toBeInTheDocument();

    const plans = await screen.findByTestId('detail-section-plans');
    expect(within(plans).getByRole('link', { name: 'Tomate' })).toHaveAttribute('href', '/app/planting-plans?planId=7');
    expect(within(plans).queryByText('Fremd')).not.toBeInTheDocument();

    const breadcrumb = screen.getByRole('navigation', { name: 'Navigationspfad' });
    expect(within(breadcrumb).getByRole('link', { name: 'Tunnel' })).toHaveAttribute('href', '/app/fields-beds/fields/10');
  });

  it('resets an own value to the inherited one in edit mode', async () => {
    apiMocks.bedUpdate.mockImplementation(async (_id: number, data: Record<string, unknown>) => ({ data: { ...data, id: 100 } }));
    renderDetail('/app/fields-beds/beds/100');

    fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Auf übernommenen Wert zurücksetzen' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(apiMocks.bedUpdate).toHaveBeenCalledWith(100, expect.objectContaining({
      light_condition: null,
      field: 10,
      name: 'Tomate 1',
    })));
    expect(await screen.findByTestId('detail-light_condition')).toHaveTextContent('Übernommen vom Standort „Hofgarten“');
  });

  it('shows the parcel environment and its beds', async () => {
    renderDetail('/app/fields-beds/fields/10');

    expect(await screen.findByTestId('detail-cultivation_environment')).toHaveTextContent('Folientunnel');
    const children = screen.getByTestId('detail-section-children');
    expect(within(children).getByRole('link', { name: 'Tomate 1' })).toHaveAttribute('href', '/app/fields-beds/beds/100');
  });

  it('shows the parcel rotation group and position and opens the shared group dialog (#1576)', async () => {
    apiMocks.rotationGroups.mockResolvedValue({ data: [{
      id: 5, name: 'Nord–Süd', parcels: [
        { id: 11, name: 'Freiland', beds: [] },
        { id: 10, name: 'Tunnel', beds: [{ id: 100, name: 'Tomate 1' }] },
      ],
    }] });
    const user = userEvent.setup();
    renderDetail('/app/fields-beds/fields/10');

    const section = await screen.findByTestId('detail-section-rotation');
    expect(within(section).getByRole('heading', { name: 'Parzellenrotation' })).toBeInTheDocument();
    expect(await within(section).findByTestId('detail-rotation-group')).toHaveTextContent('Nord–Süd');
    expect(within(section).getByTestId('detail-rotation-group')).toHaveTextContent('Parzelle 2 von 2');

    await user.click(within(section).getByRole('button', { name: 'Rotationsgruppen verwalten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rotationsgruppen verwalten' });
    expect(within(dialog).getByRole('textbox', { name: 'Gruppenname' })).toHaveValue('Nord–Süd');
  });

  it('offers assigning an unassigned parcel through the same dialog', async () => {
    const user = userEvent.setup();
    renderDetail('/app/fields-beds/fields/10');

    const section = await screen.findByTestId('detail-section-rotation');
    // The section shows a loading state first; wait for the loaded groups.
    expect(await within(section).findByText('Diese Parzelle gehört zu keiner Rotationsgruppe.')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Einer Rotationsgruppe zuordnen' }));

    const dialog = await screen.findByRole('dialog', { name: 'Rotationsgruppen verwalten' });
    expect(within(within(dialog).getByRole('list', { name: 'Parzellenreihenfolge' })).getByText('1. Tunnel'))
      .toBeInTheDocument();
  });

  it('does not present a failed rotation-group load as unassigned and retries it', async () => {
    apiMocks.rotationGroups.mockRejectedValueOnce(new Error('Unavailable'));
    apiMocks.rotationGroups.mockResolvedValueOnce({ data: [{
      id: 5, name: 'Nord–Süd', parcels: [{ id: 10, name: 'Tunnel', beds: [] }],
    }] });
    const user = userEvent.setup();
    renderDetail('/app/fields-beds/fields/10');

    const section = await screen.findByTestId('detail-section-rotation');
    expect(await within(section).findByRole('alert')).toHaveTextContent('Die Rotationsgruppen konnten nicht geladen werden.');
    expect(within(section).queryByText('Diese Parzelle gehört zu keiner Rotationsgruppe.')).not.toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Einer Rotationsgruppe zuordnen' })).not.toBeInTheDocument();

    await user.click(within(section).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await within(section).findByTestId('detail-rotation-group')).toHaveTextContent('Nord–Süd');
    expect(within(section).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a failed refresh after saving instead of keeping the old membership as current', async () => {
    const group = { id: 5, name: 'Nord–Süd', parcels: [{ id: 10, name: 'Tunnel', beds: [] }] };
    apiMocks.rotationGroups.mockResolvedValueOnce({ data: [group] }).mockResolvedValueOnce({ data: [group] })
      .mockRejectedValueOnce(new Error('Unavailable'));
    apiMocks.rotationUpdate.mockResolvedValue({ data: group });
    const user = userEvent.setup();
    renderDetail('/app/fields-beds/fields/10');

    const section = await screen.findByTestId('detail-section-rotation');
    await within(section).findByTestId('detail-rotation-group');
    await user.click(within(section).getByRole('button', { name: 'Rotationsgruppen verwalten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rotationsgruppen verwalten' });
    await user.click(await within(dialog).findByRole('button', { name: 'Speichern' }));

    expect(await within(section).findByRole('alert')).toHaveTextContent('Die Rotationsgruppen konnten nicht geladen werden.');
    expect(within(section).queryByTestId('detail-rotation-group')).not.toBeInTheDocument();
  });

  it('keeps a retry after a failed refresh in the loading state until it settles', async () => {
    const group = { id: 5, name: 'Nord–Süd', parcels: [{ id: 10, name: 'Tunnel', beds: [] }] };
    let resolveRetry: (value: { data: typeof group[] }) => void = () => undefined;
    apiMocks.rotationGroups.mockResolvedValueOnce({ data: [group] }).mockResolvedValueOnce({ data: [group] })
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockReturnValueOnce(new Promise((resolve) => { resolveRetry = resolve; }));
    apiMocks.rotationUpdate.mockResolvedValue({ data: group });
    const user = userEvent.setup();
    renderDetail('/app/fields-beds/fields/10');

    const section = await screen.findByTestId('detail-section-rotation');
    await within(section).findByTestId('detail-rotation-group');
    await user.click(within(section).getByRole('button', { name: 'Rotationsgruppen verwalten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rotationsgruppen verwalten' });
    await user.click(await within(dialog).findByRole('button', { name: 'Speichern' }));
    await within(section).findByRole('alert');

    await user.click(within(section).getByRole('button', { name: 'Erneut versuchen' }));
    expect(within(section).getByRole('progressbar')).toBeInTheDocument();
    expect(within(section).queryByTestId('detail-rotation-group')).not.toBeInTheDocument();

    resolveRetry({ data: [group] });
    expect(await within(section).findByTestId('detail-rotation-group')).toHaveTextContent('Nord–Süd');
  });

  it('refreshes season options after a rotation group is saved from parcel details', async () => {
    const group = { id: 5, name: 'Nord–Süd', parcels: [{ id: 10, name: 'Tunnel', beds: [] }] };
    apiMocks.rotationGroups.mockResolvedValue({ data: [group] });
    apiMocks.rotationUpdate.mockResolvedValue({ data: group });
    const reloadActiveSeason = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/app/fields-beds/fields/10']}>
        <Routes>
          <Route element={<Outlet context={{ reloadActiveSeason }} />}>
            <Route path="/app/fields-beds/:entityType/:entityId" element={<GrowingAreaDetailPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const section = await screen.findByTestId('detail-section-rotation');
    await within(section).findByTestId('detail-rotation-group');
    await user.click(within(section).getByRole('button', { name: 'Rotationsgruppen verwalten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rotationsgruppen verwalten' });
    await user.click(await within(dialog).findByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(reloadActiveSeason).toHaveBeenCalledTimes(1));
  });

  it('shows rotation membership without a management action to users outside the project', async () => {
    apiMocks.membership = undefined;
    renderDetail('/app/fields-beds/fields/10');

    const section = await screen.findByTestId('detail-section-rotation');
    // The section shows a loading state first; wait for the loaded groups.
    expect(await within(section).findByText('Diese Parzelle gehört zu keiner Rotationsgruppe.')).toBeInTheDocument();
    expect(within(section).queryByRole('button')).not.toBeInTheDocument();
  });

  it.each(['locations/1', 'beds/100'])('shows no rotation section on %s', async (path) => {
    renderDetail(`/app/fields-beds/${path}`);

    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByTestId('detail-section-rotation')).not.toBeInTheDocument();
    expect(apiMocks.rotationGroups).not.toHaveBeenCalled();
  });

  it.each([
    ['locations/1', 'Hofgarten'],
    ['fields/10', 'Tunnel'],
    ['beds/100', 'Tomate 1'],
  ])('shows the localized plan load error and retries on %s', async (path, name) => {
    apiMocks.plans.mockRejectedValueOnce(new Error('Unavailable'));
    const user = userEvent.setup();
    renderDetail(`/app/fields-beds/${path}`);

    const section = await screen.findByTestId('detail-section-plans');
    expect(await within(section).findByRole('alert')).toHaveTextContent('Fehler beim Laden der Anbaupläne');
    expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument();
    const retry = within(section).getByRole('button', { name: 'Erneut versuchen' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(await within(section).findByRole('link', { name: 'Tomate' })).toHaveAttribute('href', '/app/planting-plans?planId=7');
    expect(within(section).queryByRole('alert')).not.toBeInTheDocument();
    expect(apiMocks.plans).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('hides successfully empty plans (after retry: %s)', async (retry) => {
    if (retry) apiMocks.plans.mockRejectedValueOnce(new Error('Unavailable'));
    apiMocks.plans.mockResolvedValue(page([]).data);
    renderDetail('/app/fields-beds/beds/100');

    await screen.findByRole('heading', { level: 1, name: 'Tomate 1' });
    if (retry) fireEvent.click(await screen.findByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => {
      expect(apiMocks.plans).toHaveBeenCalledTimes(retry ? 2 : 1);
      expect(screen.queryByTestId('detail-section-plans')).not.toBeInTheDocument();
    });
  });

  it('keeps the edit draft, breadcrumbs and loaded plan links through a retry', async () => {
    apiMocks.plans.mockRejectedValueOnce(new Error('Unavailable'));
    let finishRetry!: () => void;
    apiMocks.plans.mockImplementationOnce(() => new Promise(resolve => {
      finishRetry = () => resolve(page([
        { id: 7, bed: 100, crop: 3, crop_name: 'Tomate', planting_date: '2026-05-01' },
      ]).data);
    }));
    renderDetail('/app/fields-beds/beds/100');
    const breadcrumb = await screen.findByRole('navigation', { name: 'Navigationspfad' });
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const nameInput = screen.getByRole('textbox', { name: /^Name/ });
    fireEvent.change(nameInput, { target: { value: 'Ungespeichertes Beet' } });
    const retry = await screen.findByRole('button', { name: 'Erneut versuchen' });
    fireEvent.click(retry);
    expect(retry).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Anbaupläne werden geladen');

    await act(async () => finishRetry());
    expect(await within(screen.getByTestId('detail-section-plans')).findByRole('link', { name: 'Tomate' })).toBeVisible();
    expect(nameInput).toHaveValue('Ungespeichertes Beet');
    expect(screen.getByRole('navigation', { name: 'Navigationspfad' })).toBe(breadcrumb);
    expect(screen.getByRole('heading', { level: 1, name: 'Tomate 1' })).toBeInTheDocument();
  });

  it('aborts obsolete project requests and ignores their late results', async () => {
    let finishPreviousProject!: () => void;
    apiMocks.plans.mockImplementationOnce(() => new Promise(resolve => {
      finishPreviousProject = () => resolve(page([{ id: 72, bed: 100, crop_name: 'Alter Projektplan' }]).data);
    }));
    const path = '/app/fields-beds/beds/100';
    const view = renderDetail(path);
    expect(await screen.findByRole('progressbar', { name: 'Anbaupläne werden geladen…' })).toBeVisible();
    const previousSignal = apiMocks.plans.mock.calls[0][0] as AbortSignal;
    apiMocks.projectId = 2;
    view.rerender(detailRoute(path));

    expect(await screen.findByRole('link', { name: 'Tomate' })).toBeVisible();
    expect(previousSignal.aborted).toBe(true);
    await act(async () => finishPreviousProject());
    expect(screen.queryByRole('link', { name: 'Alter Projektplan' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tomate' })).toBeVisible();
    const currentSignal = apiMocks.plans.mock.calls[1][0] as AbortSignal;
    view.unmount();
    expect(currentSignal.aborted).toBe(true);
  });

  it('shows a not-found state with a way back for an unknown entity', async () => {
    renderDetail('/app/fields-beds/beds/555');

    expect(await screen.findByText('Eintrag nicht gefunden')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zurück zu den Anbauflächen' })).toHaveAttribute('href', '/app/fields-beds');
  });

  it.each([
    ['locations/1', 'Hofgarten', 'Pflaume', ['Tomaten pflegen', 'Paprika prüfen', 'Birne gießen', 'Pflaume schneiden', 'Tunnel lüften']],
    ['fields/10', 'Tunnel', 'Birne', ['Tomaten pflegen', 'Paprika prüfen', 'Birne gießen', 'Tunnel lüften']],
    ['beds/100', 'Tomate 1', 'Paprika', ['Tomaten pflegen', 'Paprika prüfen']],
  ] as const)('shows the active-season work scoped to %s', async (path, heading, plant, openTitles) => {
    const all = seedAreaWork();
    renderSeasonDetail(`/app/fields-beds/${path}`);
    const title = await screen.findByRole('heading', { level: 1, name: heading });
    const back = screen.getByRole('button', { name: 'Zurück zur Liste', exact: true });
    expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const direct = within(await screen.findByTestId('detail-section-individual-plans'));
    expect(direct.getAllByRole('listitem')).toHaveLength(1);
    expect(direct.getByRole('link', { name: plant, exact: true })).toBeVisible();
    if (path.startsWith('beds')) expect(direct.getByText(/4 Einzelpflanzen.*2 noch nicht positioniert/)).toBeVisible();
    const tasks = within(screen.getByRole('region', { name: 'Aufgaben', exact: true }));
    await tasks.findByText('Tomaten pflegen');
    expect(tasks.getAllByRole('listitem')).toHaveLength(openTitles.length);
    expect(tasks.getAllByRole('listitem')[0]).toHaveTextContent(/Tomaten pflegen.*Hofgarten \/ Tunnel \/ Tomate 1.*Garten-Team/);
    expect(tasks.getByRole('status')).toHaveTextContent(`${openTitles.length} offene Aufgaben`);
    for (const task of all) {
      if (openTitles.some(name => name === task.title)) expect(tasks.getByText(task.title)).toBeVisible();
      else expect(tasks.queryByText(task.title)).not.toBeInTheDocument();
    }
    expect(apiMocks.tasks).toHaveBeenCalledTimes(1);
  });

  it('distinguishes task loading, failure, retry, completion history and a genuinely empty result', async () => {
    const tasks = seedAreaWork();
    let rejectTasks!: (error: Error) => void;
    apiMocks.tasks.mockImplementationOnce(() => new Promise((_, reject) => { rejectTasks = reject; }));
    const user = userEvent.setup();
    renderSeasonDetail('/app/fields-beds/beds/100');
    const section = within(await screen.findByRole('region', { name: 'Aufgaben', exact: true }));
    expect(section.getByRole('progressbar')).toBeVisible();
    expect(section.queryByRole('status')).not.toBeInTheDocument();
    await act(async () => rejectTasks(new Error('Task service unavailable')));
    await section.findByRole('alert');
    await user.click(section.getByRole('button', { name: 'Erneut versuchen' }));
    const complete = await section.findByRole('button', { name: /Tomaten pflegen.*als erledigt markieren/ });
    apiMocks.tasks.mockResolvedValueOnce(page(tasks.map(task => task.id === 1 ? { ...task, status: 'completed' } : task)).data);
    await user.click(complete);
    expect(apiMocks.updateTaskStatus).toHaveBeenCalledWith(1, 'completed');
    await waitFor(() => expect(section.getByRole('status')).toHaveTextContent(/1 offene Aufgabe/));
    expect(section.queryByRole('button', { name: /Tomaten pflegen.*als erledigt markieren/ })).not.toBeInTheDocument();
    const history = section.getByText(/1 erledigte Aufgabe/i);
    await user.click(history);
    expect(section.getByText('Tomaten pflegen')).toBeVisible();
    apiMocks.tasks.mockResolvedValueOnce(page([]).data);
    fireEvent.focus(window);
    await waitFor(() => expect(section.queryAllByRole('listitem')).toHaveLength(0));
    expect(section.getByRole('status')).toBeVisible();
  });

  it('keeps area work and plans readable without edit or completion permissions', async () => {
    apiMocks.membership = undefined;
    seedAreaWork();
    renderSeasonDetail('/app/fields-beds/fields/10');
    const section = within(await screen.findByRole('region', { name: 'Aufgaben', exact: true }));
    expect(await section.findByText('Tunnel lüften')).toBeVisible();
    expect(section.queryAllByRole('button', { name: /als erledigt markieren/ })).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Bearbeiten', exact: true })).not.toBeInTheDocument();
  });
});
