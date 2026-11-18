import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GrowingAreaDetailPage from '../pages/GrowingAreaDetailPage';

const apiMocks = vi.hoisted(() => ({
  locations: vi.fn(),
  fields: vi.fn(),
  beds: vi.fn(),
  plans: vi.fn(),
  bedUpdate: vi.fn(),
}));

vi.mock('../hooks/useProjectRequirement', () => ({
  useProjectRequirement: () => ({
    activeProjectId: 1,
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
    plantingPlanAPI: { ...actual.plantingPlanAPI, listAll: apiMocks.plans },
  };
});

const page = <T,>(results: T[]) => ({ data: { results, count: results.length, next: null, previous: null } });

const renderDetail = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/app/fields-beds/:entityType/:entityId" element={<GrowingAreaDetailPage />} />
      <Route path="/app/fields-beds" element={<div data-testid="list-page" />} />
    </Routes>
  </MemoryRouter>,
);

describe('GrowingAreaDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('shows own and inherited conditions with their source and hides empty sections', async () => {
    renderDetail('/app/fields-beds/beds/100');

    expect(await screen.findByRole('heading', { level: 1, name: 'Tomate 1' })).toBeInTheDocument();
    const light = screen.getByTestId('detail-light_condition');
    expect(light).toHaveTextContent('Schattig');
    expect(light).not.toHaveTextContent('Übernommen');
    expect(screen.getByTestId('detail-soil_moisture')).toHaveTextContent('Übernommen von der Parzelle „Tunnel“');
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

  it('shows a not-found state with a way back for an unknown entity', async () => {
    renderDetail('/app/fields-beds/beds/555');

    expect(await screen.findByText('Eintrag nicht gefunden')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zurück zu den Anbauflächen' })).toHaveAttribute('href', '/app/fields-beds');
  });
});
