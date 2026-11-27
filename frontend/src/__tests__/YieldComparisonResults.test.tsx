import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import type { YieldComparisonSeason } from '../api/types';
import { YieldComparisonResults } from '../pages/YieldComparisonResults';
import { YieldComparisonSummaryPanel } from '../pages/YieldComparisonSummary';
import { YieldCropMatrix } from '../pages/YieldCropMatrix';
import { YieldSeasonDetails } from '../pages/YieldSeasonDetails';
import { groupYieldComparisonCrops } from '../pages/yieldComparisonFilters';
import { yieldChartScale, yieldChartSeries, yieldChartUnits } from '../pages/yieldSeasonChartData';

const missing: YieldComparisonSeason = {
  id: 1, label: '24/25', start_date: '2024-09-01', end_date: '2025-08-31',
  forecast_kg: null, forecast_kg_per_sqm: null, forecast_plan_count: 0, expected_plan_count: 0,
  recorded: { quantities: [], measured_kg: null, estimated_kg: null, has_unconvertible_quantity: false },
  unassigned: [], assigned_plan_count: 0, assigned_forecast_plan_count: 0,
  recorded_kg_per_plan_sqm: null, recorded_kg_per_plan_sqm_estimated: false, comparable: false,
  harvested_areas: [], losses: [], plan_dates: [],
};

it('groups yield filters by species and falls back to the name for unlinked crops', () => {
  const group = (id: number, culture: string, species: number | null, variety = '') => ({
    id, culture, name: culture, crop_species: species, culture_label: null, variety, search_names: [],
  });
  const groups = groupYieldComparisonCrops([
    group(1, 'General squash', 10),
    group(2, 'Squash', 10, 'Delicata'),
    group(3, 'Squash', 12),
    group(4, 'Leek', null),
    group(5, 'leek', null, 'Winter'),
  ], 'en');
  expect(groups).toHaveLength(3);
  expect(groups.find(option => option.cropIds.includes(1))?.cropIds).toEqual([1, 2]);
  expect(groups.find(option => option.cropIds.includes(3))?.cropIds).toEqual([3]);
  expect(groups.find(option => option.cropIds.includes(4))?.cropIds).toEqual([4, 5]);
});

it('distinguishes a missing harvest from an explicit recorded zero in the table', () => {
  const zero: YieldComparisonSeason = {
    ...missing, id: 2, label: '25/26', start_date: '2025-09-01', end_date: '2026-08-31',
    recorded: { ...missing.recorded, quantities: [{ quantity: '0', unit: 'kg' }], measured_kg: '0' },
  };
  render(<MemoryRouter><YieldComparisonResults cropName="Lauch" preferredUnit="kg" onChartUnitChange={() => undefined}
    groups={[]} loadCropComparison={() => Promise.reject(new Error('Unexpected detail load'))} comparison={{
    crop_timing: {}, seasons: [zero, missing], crop_yields: [], summary: {
      planned_area_sqm: null, plans_without_area_count: 0,
      recorded_quantities: [{ quantity: '0', unit: 'kg' }],
      excluded_unassigned_records: 0, crop_count: 1, recorded_crop_count: 1,
    },
  }} /></MemoryRouter>);

  const table = screen.getByRole('table', { name: 'Lauch' });
  const rows = within(table).getAllByRole('row');
  expect(within(rows[1]).getByText('0 kg')).toBeVisible();
  expect(within(rows[1]).getByText('Null erfasst')).toBeVisible();
  expect(within(rows[2]).getByText('Nicht erfasst')).toBeVisible();
  expect(within(rows[2]).queryByText('0 kg')).not.toBeInTheDocument();
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '1 von 1');
  expect(screen.getAllByText('Null erfasst')).toHaveLength(2);
  const chart = screen.getByRole('figure', { name: 'Erntemengen nach Saison' });
  expect(within(chart).getByRole('button', { name: /^Ertrag für 25\/26/ })).toHaveTextContent('0');
  expect(within(chart).getByRole('button', { name: /^Ertrag für 24\/25/ })).not.toHaveTextContent('0');
});

it('separates kg, pieces, and bunches and retains partial, missing, and measured-zero values', () => {
  const mixed: YieldComparisonSeason = {
    ...missing, id: 2, label: '25/26', start_date: '2025-09-01', end_date: '2026-08-31',
    forecast_kg: '12', forecast_plan_count: 1, expected_plan_count: 2, assigned_forecast_plan_count: 1,
    excluded_unassigned_records: 1,
    recorded: {
      ...missing.recorded, measured_kg: '0', estimated_kg: '1.5',
      quantities: [{ quantity: '0', unit: 'kg' }, { quantity: '8', unit: 'piece' }, { quantity: '2', unit: 'bunch' }],
    },
  };
  const countOnly: YieldComparisonSeason = {
    ...missing, id: 3, label: '26/27', start_date: '2026-09-01', end_date: '2027-08-31',
    recorded: { ...missing.recorded, estimated_kg: '10', quantities: [{ quantity: '9', unit: 'piece' }] },
  };
  expect(yieldChartUnits([missing])).toEqual([]);
  expect(yieldChartUnits([countOnly])).toEqual(['piece']);
  expect(yieldChartUnits([mixed, missing, countOnly])).toEqual(['kg', 'piece', 'bunch']);
  expect(yieldChartSeries(mixed, 'kg')).toEqual([
    { kind: 'forecast', value: '12', partial: true }, { kind: 'recorded', value: '0', partial: true },
  ]);
  expect(yieldChartSeries(countOnly, 'kg')[1].value).toBeNull();
  expect(yieldChartSeries(mixed, 'bunch')).toEqual([{ kind: 'recorded', value: '2', partial: true }]);
  const pieces = [mixed, missing, countOnly].map(row => yieldChartSeries(row, 'piece'));
  expect(pieces.flat().map(series => series.value)).toEqual(['8', null, '9']);
  expect(yieldChartScale(pieces)).toBe(10);
});

it('shows a measured zero and a missing matrix cell without inventing a trend', () => {
  const current = { ...missing, id: 2, label: '25/26' };
  render(<YieldCropMatrix crops={[{
    key: 'name:lauch', name: 'Lauch', crop_ids: [1], trend: null,
    rates: [
      { season_id: 1, status: 'missing', value: null, partial: false, below_resolution: false },
      { season_id: 2, status: 'measured', value: '0', partial: false, below_resolution: false },
    ],
  }]} seasons={[missing, current]} groups={[]} locale="de-DE" onOpen={() => undefined} />);
  const cells = within(screen.getByRole('row', { name: /^Lauch/ })).getAllByRole('cell');
  expect(within(cells[0]).getByText('Nicht erfasst')).toBeInTheDocument();
  expect(within(cells[1]).getByText('0 kg/m²')).toBeVisible();
  expect(within(cells[2]).getByText('Keine vergleichbare Entwicklung')).toBeInTheDocument();
});

it.each([
  ['de-DE', '11,37', '< 0,01'], ['en-US', '11.37', '< 0.01'],
])('formats rate cells without equating small yields with zero in %s', (locale, rounded, small) => {
  const seasons = [missing, { ...missing, id: 2, label: '25/26' }, { ...missing, id: 3, label: '26/27' }];
  render(<YieldCropMatrix crops={[{
    key: 'name:lauch', name: 'Lauch', crop_ids: [1], trend: null,
    rates: [
      { season_id: 1, status: 'measured', value: '11.3691', partial: false, below_resolution: false },
      { season_id: 2, status: 'measured', value: '0.004', partial: false, below_resolution: false },
      { season_id: 3, status: 'measured', value: '0', partial: false, below_resolution: true },
    ],
  }]} seasons={seasons} groups={[]} locale={locale} onOpen={() => undefined} />);

  const cells = within(screen.getByRole('row', { name: /^Lauch/ })).getAllByRole('cell');
  expect(cells[0]).toHaveTextContent(`${rounded} kg/m²`);
  expect(cells[1]).toHaveTextContent(`${small} kg/m²`);
  expect(cells[2]).toHaveTextContent(`${small} kg/m²`);
});

it('formats forecast, recorded and harvested-area rates in the season details', async () => {
  const user = userEvent.setup();
  const row: YieldComparisonSeason = {
    ...missing,
    forecast_kg: '43.123456',
    forecast_kg_per_sqm: '11.362988',
    recorded_kg_per_plan_sqm: '0.004',
    recorded_kg_per_plan_sqm_estimated: true,
    recorded: { ...missing.recorded, quantities: [{ quantity: '12', unit: 'piece' }] },
    harvested_areas: [
      { id: 1, date: '2025-01-12', plan_id: 3, bed_name: 'Beet 1', area_sqm: '12.34567', kg_per_sqm: '2.506', estimated: true },
      { id: 2, date: '2025-01-13', plan_id: 4, bed_name: 'Beet 2', area_sqm: '3', kg_per_sqm: null, estimated: false },
    ],
  };
  render(<MemoryRouter><YieldSeasonDetails cropName="Lauch" comparison={{
    seasons: [row], crop_timing: {}, crop_yields: [], summary: {
      planned_area_sqm: null, plans_without_area_count: 0, recorded_quantities: row.recorded.quantities,
      excluded_unassigned_records: 0, crop_count: 1, recorded_crop_count: 1,
    },
  }} /></MemoryRouter>);

  expect(screen.getByText('11,36 kg/m²')).toBeVisible();
  expect(screen.getByText(/^< 0,01 kg\/m² geschätzt/)).toBeVisible();
  expect(screen.getByText(/^43,123456\s+kg$/)).toBeVisible();
  expect(screen.getByText('12 Stück')).toBeVisible();

  await user.click(screen.getByLabelText('Termine und Beobachtungen · 24/25'));
  expect(screen.getByText(/Beet 1 · 12,34567 m² · 2,51 kg\/m² geschätzt/)).toBeVisible();
  expect(screen.getByText(/Beet 2 · 3 m² · Kein Gewicht verfügbar/)).toBeVisible();
});

it('shows partial scope, keeps harvest units separate, and reports an empty selection', () => {
  const { rerender } = render(<YieldComparisonSummaryPanel seasonCount={2} locale="de-DE" summary={{
    planned_area_sqm: '19.5', plans_without_area_count: 1,
    recorded_quantities: [{ quantity: '4.8', unit: 'kg' }, { quantity: '5', unit: 'piece' }],
    excluded_unassigned_records: 2, crop_count: 3, recorded_crop_count: 2,
  }} />);

  expect(screen.getByText('19,5 m²')).toBeVisible();
  expect(screen.getByText('Summe aus 2 Saisonen')).toBeVisible();
  expect(screen.getByText('1 Anbauplan ohne Flächenangabe')).toBeVisible();
  expect(screen.getByText('4,8 kg + 5 Stück')).toBeVisible();
  expect(screen.getByText('Anteile ohne Flächenzuordnung ausgeblendet (2 Ernten)')).toBeVisible();
  expect(screen.getByText('2 von 3')).toBeVisible();
  expect(screen.getByRole('meter', { name: 'Kulturen mit erfasster Ernte' })).toHaveAttribute('aria-valuetext', '2 von 3');

  rerender(<YieldComparisonSummaryPanel seasonCount={1} locale="de-DE" summary={{
    planned_area_sqm: null, plans_without_area_count: 0, recorded_quantities: [],
    excluded_unassigned_records: 2, crop_count: 0, recorded_crop_count: 0,
  }} />);
  expect(screen.getByText('Nicht verfügbar')).toBeVisible();
  expect(screen.getByText('Nicht erfasst')).toBeVisible();
  expect(screen.getByText('Keine Kulturen im Filterbereich')).toBeVisible();
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
});
