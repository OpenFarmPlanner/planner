import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import type { YieldComparisonSeason } from '../api/types';
import { YieldComparisonResults } from '../pages/YieldComparisonResults';
import { YieldComparisonSummaryPanel } from '../pages/YieldComparisonSummary';
import { groupYieldComparisonCrops } from '../pages/yieldComparisonFilters';

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
  const missing: YieldComparisonSeason = {
    id: 1, label: '24/25', start_date: '2024-09-01', end_date: '2025-08-31',
    forecast_kg: null, forecast_kg_per_sqm: null, forecast_plan_count: 0, expected_plan_count: 0,
    recorded: {
      quantities: [], measured_kg: null, estimated_kg: null, has_unconvertible_quantity: false,
    },
    unassigned: [], assigned_plan_count: 0, assigned_forecast_plan_count: 0,
    recorded_kg_per_plan_sqm: null, recorded_kg_per_plan_sqm_estimated: false, comparable: false,
    harvested_areas: [], losses: [], plan_dates: [],
  };
  const zero: YieldComparisonSeason = {
    ...missing, id: 2, label: '25/26', start_date: '2025-09-01', end_date: '2026-08-31',
    recorded: { ...missing.recorded, quantities: [{ quantity: '0', unit: 'kg' }], measured_kg: '0' },
  };
  render(<MemoryRouter><YieldComparisonResults cropName="Lauch" comparison={{
    crop_timing: {}, seasons: [zero, missing], summary: {
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
