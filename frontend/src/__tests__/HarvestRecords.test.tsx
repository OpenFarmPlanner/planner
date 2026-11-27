import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { HarvestRecord, PlanActualHarvest } from '../api/types';
import { HarvestRecords } from '../harvests/HarvestRecords';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('../api/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/api')>();
  return { ...actual, harvestAPI: { ...actual.harvestAPI, list: mocks.list } };
});

it('rounds plan and allocation yields while keeping missing area yields and recorded units distinct', async () => {
  const harvest: HarvestRecord = {
    id: 1, crop: 3, crop_label: 'Lauch', date: '2026-06-08', quantity: '2', unit: 'piece', note: '',
    grams_per_unit: '20', conversion_source: 'manual', measured_kg: null, estimated_kg: '0.04',
    unallocated_quantity: '0', allocations: [{
      id: 2, planting_plan: 7, quantity: '2', bed_name: 'Beet 1', season_label: '2026',
      planting_date: '2026-04-09', harvested_area_sqm: '10', kilograms_per_harvested_sqm: '0.004',
    }],
  };
  mocks.list.mockResolvedValue({ results: [harvest, {
    ...harvest, id: 2, grams_per_unit: null, estimated_kg: null,
    allocations: [{ ...harvest.allocations[0], id: 3, kilograms_per_harvested_sqm: null }],
  }] });
  const planTotals: PlanActualHarvest = {
    quantities: [{ unit: 'piece', quantity: '4' }], measured_kg: null, estimated_kg: '0.04',
    has_unconvertible_quantity: true, forecast_kg: null, forecast_percentage: null,
    actual_kg_per_sqm: '11.3691',
  };

  render(<HarvestRecords scope="plan-7" planId={7} planTotals={planTotals} initialDate="2026-06-08" />);
  expect(screen.getByText(/Geschätzter Ertrag je Anbaufläche · 11,37 kg\/m²/)).toBeVisible();

  const [estimated, missing] = await screen.findAllByRole('listitem');
  expect(within(estimated).getByText(/Geschätzter Ertrag je beernteter Fläche · < 0,01 kg\/m²/)).toBeVisible();
  expect(within(estimated).getByText('2 Stück von 2 Stück zugeordnet')).toBeVisible();
  expect(within(missing).queryByText(/kg\/m²/)).not.toBeInTheDocument();
});
