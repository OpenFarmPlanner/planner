import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BedSuggestion } from '../api/types';
import { BedSuggestionsPanel } from '../components/planting-plans/rotation/BedSuggestionsPanel';
import { resetPlantFamiliesCache } from '../crops/plantFamilies';

const { bedSuggestionsMock, plantFamiliesMock } = vi.hoisted(() => ({
  bedSuggestionsMock: vi.fn(),
  plantFamiliesMock: vi.fn(),
}));
vi.mock('../api/api', () => ({
  plantingPlanAPI: { bedSuggestions: bedSuggestionsMock },
  plantFamilyAPI: { list: plantFamiliesMock },
}));

const suggestion = (bedId: number, overrides: Partial<BedSuggestion> = {}): BedSuggestion => ({
  bed_id: bedId,
  bed_name: `Beet ${bedId}`,
  field_name: 'Parzelle A',
  field_id: 10,
  location_name: 'Hof',
  location_id: 1,
  category: 'good',
  status: 'ok',
  findings: [{
    kind: 'ok',
    crop_label: 'Brokkoli',
    family_key: 'Brassicaceae',
    // A stored English label: the UI must still show the German name.
    family_name: 'Cabbage family',
    previous_plan_id: null,
    previous_crop_label: null,
    previous_family_key: null,
    previous_family_name: null,
    year: null,
    break_years: 4,
    earliest_year: null,
    break_source: 'family_default',
    settings_crop_id: 1,
    settings_crop_label: 'Brokkoli',
  }],
  years_since_family: null,
  previous_is_soil_improver: false,
  bed_area_sqm: 10,
  used_area_sqm: 0,
  free_area_sqm: 10,
  has_enough_area: true,
  is_partially_occupied: false,
  blocking_plan: null,
  ...overrides,
});

const input = { cropId: 1, bedId: 2, plantingDate: '2026-04-01', planId: 5 };

describe('BedSuggestionsPanel', () => {
  beforeEach(() => {
    bedSuggestionsMock.mockReset();
    resetPlantFamiliesCache();
    plantFamiliesMock.mockResolvedValue({
      data: [{
        botanical_name: 'Brassicaceae',
        display_name: 'Cabbage family',
        translations: { de: 'Kreuzblütler', en: 'Cabbage family' },
        default_rotation_break_years: 4,
      }],
    });
  });

  it('lists the top five beds with category, reason and the current bed', async () => {
    const user = userEvent.setup();
    const onApplyBed = vi.fn();
    const results = [
      ...[1, 2, 3, 4, 5, 6, 7].map((id) => suggestion(id, id === 7 ? { category: 'conflict', status: 'conflict' } : {})),
      suggestion(8, { has_enough_area: false, free_area_sqm: 0, used_area_sqm: 10, is_partially_occupied: true }),
    ];
    bedSuggestionsMock.mockResolvedValue({ data: { count: results.length, available_count: 7, results } });

    render(<BedSuggestionsPanel input={input} cultureLabel="Brokkoli" onApplyBed={onApplyBed} />);

    expect(screen.getByText('Passende Beete für Brokkoli')).toBeInTheDocument();
    expect(await screen.findAllByTestId('bed-suggestion')).toHaveLength(5);
    expect(bedSuggestionsMock).toHaveBeenCalledWith({ crop_id: 1, planting_date: '2026-04-01', exclude_plan_id: 5 });

    const current = screen.getAllByTestId('bed-suggestion')[1];
    expect(within(current).getByText('aktuell gewählt')).toBeInTheDocument();
    const first = screen.getAllByTestId('bed-suggestion')[0];
    expect(within(first).getByText('Hof / Parzelle A / Beet 1')).toBeInTheDocument();
    expect(within(first).getByText('Passt gut')).toBeInTheDocument();
    expect(await within(first).findByText('Keine Kreuzblütler erfasst')).toBeInTheDocument();

    await user.click(within(first).getByRole('button', { name: 'Hof / Parzelle A / Beet 1 übernehmen' }));
    expect(onApplyBed).toHaveBeenCalledWith(1);

    await user.click(screen.getByRole('button', { name: 'Alle 7 Beete anzeigen' }));
    expect(screen.getAllByTestId('bed-suggestion')).toHaveLength(7);
  });

  it('asks for crop and date before suggesting anything', () => {
    render(<BedSuggestionsPanel input={{ ...input, plantingDate: null }} cultureLabel="Brokkoli" onApplyBed={vi.fn()} />);

    expect(screen.getByText('Wähle Kultur und Pflanztermin, dann zeigen wir dir passende Beete.')).toBeInTheDocument();
    expect(bedSuggestionsMock).not.toHaveBeenCalled();
  });
});
