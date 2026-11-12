import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Crop, EffectiveCropTimingWindow } from '../api/types';
import { CropTimingWindowsDetail } from '../crops/CropTimingWindowsDetail';
import { emptyTimingWindow } from '../crops/timingWindows';

const window = (fields: Partial<EffectiveCropTimingWindow> & Pick<EffectiveCropTimingWindow, 'kind' | 'unit'>): EffectiveCropTimingWindow => ({
  ...emptyTimingWindow(fields.kind, fields.unit),
  inherited: false,
  ...fields,
});

describe('CropTimingWindowsDetail', () => {
  it('lists the windows per kind and draws one labelled lane per kind', () => {
    const crop = {
      id: 1,
      name: 'Karotte',
      effective_timing_windows: [
        window({ kind: 'direct_sowing', unit: 'decade', start_month: 3, start_decade: 'early', end_month: 5, end_decade: 'mid' }),
        window({ kind: 'direct_sowing', unit: 'iso_week', start_week: 30, end_week: 30 }),
        window({ kind: 'planting', unit: 'decade', start_month: 11, start_decade: 'early', end_month: 2, end_decade: 'late', inherited: true }),
      ],
    } as Crop;

    render(<CropTimingWindowsDetail crop={crop} isVarietyView={false} />);

    expect(screen.getByText('Anfang März bis Mitte Mai; KW 30')).toBeInTheDocument();
    expect(screen.getByText('November bis Februar')).toBeInTheDocument();
    const bar = screen.getByRole('img', { name: /Zeiträume im Jahr/ });
    expect(within(bar).getByTestId('timing-window-lane-direct_sowing')).toBeInTheDocument();
    expect(within(bar).getByTestId('timing-window-lane-planting')).toBeInTheDocument();
    expect(within(bar).queryByTestId('timing-window-lane-pre_cultivation')).toBeNull();
    expect(within(bar).getByText('Pflanzzeitraum')).toBeInTheDocument();
    // No growth duration: no calculated harvest lane.
    expect(within(bar).queryByTestId('timing-window-lane-computed-harvest')).toBeNull();
  });

  it('adds a labelled, hatched "Ernte (berechnet)" lane from the effective durations', () => {
    const crop = {
      id: 3,
      name: 'Salat',
      variety: 'Grün',
      growth_duration_days: undefined,
      effective_values: { growth_duration_days: 60, harvest_duration_days: 14 },
      effective_timing_windows: [
        window({ kind: 'direct_sowing', unit: 'decade', start_month: 3, start_decade: 'early', end_month: 4, end_decade: 'late' }),
      ],
    } as unknown as Crop;

    render(<CropTimingWindowsDetail crop={crop} isVarietyView />);

    const lane = screen.getByTestId('timing-window-lane-computed-harvest');
    expect(within(lane).getByText('Ernte (berechnet)')).toBeInTheDocument();
  });

  it('says so when the crop has no windows', () => {
    render(<CropTimingWindowsDetail crop={{ id: 2, name: 'Kresse' } as Crop} isVarietyView={false} />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});
