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
        window({ kind: 'harvest', unit: 'decade', start_month: 11, start_decade: 'early', end_month: 2, end_decade: 'late', inherited: true }),
      ],
    } as Crop;

    render(<CropTimingWindowsDetail crop={crop} isVarietyView={false} />);

    expect(screen.getByText('Anfang März bis Mitte Mai; KW 30')).toBeInTheDocument();
    expect(screen.getByText('November bis Februar')).toBeInTheDocument();
    const bar = screen.getByRole('img', { name: /Zeiträume im Jahr/ });
    expect(within(bar).getByTestId('timing-window-lane-direct_sowing')).toBeInTheDocument();
    expect(within(bar).getByTestId('timing-window-lane-harvest')).toBeInTheDocument();
    expect(within(bar).queryByTestId('timing-window-lane-planting')).toBeNull();
    expect(within(bar).getByText('Ernte')).toBeInTheDocument();
  });

  it('says so when the crop has no windows', () => {
    render(<CropTimingWindowsDetail crop={{ id: 2, name: 'Kresse' } as Crop} isVarietyView={false} />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});
