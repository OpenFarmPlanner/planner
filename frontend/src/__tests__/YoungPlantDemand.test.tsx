import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import YoungPlantDemandPage from '../pages/YoungPlantDemand';
import { CommandProvider } from '../commands/CommandProvider';
import { FocusManagerProvider } from '../focus/FocusManager';
import i18n from '../i18n';
import type { YoungPlantDemand } from '../api/types';
import { DEFAULT_RESERVE_PERCENT, readStoredReservePercent } from '../pages/youngPlantDemandReserve';

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));
const projectRequirementState = vi.hoisted(() => ({
  shouldShowProjectRequiredState: false,
  missingProjectReason: null as null | 'no_projects' | 'no_active_project',
  activeProjectId: 7 as number | null,
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return { ...actual, youngPlantDemandAPI: { list: listMock } };
});

vi.mock('../hooks/useProjectRequirement', () => ({
  useProjectRequirement: () => projectRequirementState,
}));

const lettuceRow: YoungPlantDemand = {
  key: '1:2026-04-06',
  crop_id: 1,
  crop_name: 'Salat',
  crop_display_name: 'Salat',
  variety: 'Batavia',
  planting_week: { iso_year: 2026, iso_week: 15, start_date: '2026-04-06', end_date: '2026-04-12' },
  plant_count: 120,
  plant_count_with_reserve: 132,
  reserve_percent: 10,
  calculation_blockers: [],
  plan_count: 2,
  bed_count: 2,
  plans: [
    {
      plan_id: 11, planting_date: '2026-04-06', bed_id: 1, bed_name: 'Beet 1', field_name: 'Feld',
      location_name: '', area_usage_sqm: 3, plant_count: 40, calculation_blockers: [],
    },
    {
      plan_id: 12, planting_date: '2026-04-09', bed_id: 2, bed_name: 'Beet 2', field_name: 'Feld',
      location_name: '', area_usage_sqm: 6, plant_count: 80, calculation_blockers: [],
    },
  ],
};

const kohlrabiRow: YoungPlantDemand = {
  ...lettuceRow,
  key: '2:2026-04-06',
  crop_id: 2,
  crop_name: 'Kohlrabi',
  crop_display_name: 'Kohlrabi',
  variety: '',
  plant_count: null,
  plant_count_with_reserve: null,
  calculation_blockers: ['missing_plant_spacing'],
  plan_count: 1,
  bed_count: 1,
  plans: [{ ...lettuceRow.plans[0], plan_id: 13, plant_count: null, calculation_blockers: ['missing_plant_spacing'] }],
};

const renderPage = () => render(
  <MemoryRouter>
    <FocusManagerProvider>
      <CommandProvider>
        <YoungPlantDemandPage />
      </CommandProvider>
    </FocusManagerProvider>
  </MemoryRouter>,
);

describe('YoungPlantDemandPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    window.localStorage.clear();
    projectRequirementState.shouldShowProjectRequiredState = false;
    projectRequirementState.missingProjectReason = null;
    projectRequirementState.activeProjectId = 7;
    await i18n.changeLanguage('de');
  });

  it('lists crop, variety, planting week, plant count with reserve and plan/bed counts', async () => {
    listMock.mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [lettuceRow] } });

    renderPage();

    expect(await screen.findByText('KW 15')).toBeInTheDocument();
    expect(screen.getByText('06.04. – 12.04.2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Salat' })).toBeInTheDocument();
    expect(screen.getAllByText('Batavia').length).toBeGreaterThan(0);
    expect(screen.getByText('132')).toBeInTheDocument();
    expect(screen.getAllByText('2 / 2').length).toBeGreaterThan(0);
    expect(listMock).toHaveBeenCalledWith(DEFAULT_RESERVE_PERCENT);
  });

  it('expands a row into its underlying planting plans', async () => {
    listMock.mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [lettuceRow] } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Anbaupläne anzeigen' }));

    expect(await screen.findByText('Feld | Beet 2')).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
  });

  it('shows a hint instead of a silent zero when the plant count cannot be calculated', async () => {
    listMock.mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [kohlrabiRow] } });

    renderPage();

    expect((await screen.findAllByText('Stückzahl nicht berechenbar: Pflanzabstand fehlt')).length).toBeGreaterThan(0);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows the empty state when no bought-in plants are planned', async () => {
    listMock.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });

    renderPage();

    expect(
      await screen.findByText('In dieser Saison sind keine Pflanzungen mit gekauften Pflanzen geplant.'),
    ).toBeInTheDocument();
  });

  it('reloads with a changed reserve and remembers it for the project', async () => {
    listMock.mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [lettuceRow] } });
    renderPage();
    await screen.findByText('KW 15');

    fireEvent.change(screen.getByRole('textbox', { name: 'Reserve für Ausfälle' }), { target: { value: '5' } });

    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(5));
    expect(readStoredReservePercent(7)).toBe(5);
  });
});
