import { describe, expect, it } from 'vitest';
import type { YieldCalendarForecast, YieldForecastCropGroup } from '../api/types';
import { buildForecastCropIndex, projectForecastWeeks } from '../pages/yieldForecastGrouping';
import { ALL_CROPS } from '../pages/yieldOverviewUtils';

describe('forecast grouping', () => {
  it('sums one crop with ten varieties and keeps explicit colors in the breakdown', () => {
    const base = '#226644';
    const custom = '#ba3625';
    const general: YieldForecastCropGroup = {
      crop_id: 100, crop_name: 'Lettuce', general_crop_id: 100, general_crop_name: 'Lettuce',
      color: base, effective_color: base, has_color_override: false,
    };
    const variants = Array.from({ length: 10 }, (_, index): YieldForecastCropGroup => ({
      ...general, crop_id: 101 + index, crop_variety: `Variety ${index + 1}`,
      effective_color: index === 1 ? custom : base, has_color_override: index < 2,
    }));
    const forecast: YieldCalendarForecast = {
      crop_groups: [general, ...variants], incomplete_plans: [],
      weeks: [{ iso_week: '2026-W13', week_start: '2026-03-23', week_end: '2026-03-30',
        crops: [general, ...variants].map(crop => ({ ...crop, yield: 1.25 })) }],
    };
    const { byId, crops, varieties } = buildForecastCropIndex(forecast, 'en', name => `${name} (general)`);
    expect(crops).toEqual([{ id: 100, name: 'Lettuce', color: base }]);
    expect(varieties).toHaveLength(11);
    const [aggregate] = projectForecastWeeks(forecast.weeks, byId, 'crop', ALL_CROPS, ALL_CROPS);
    const [breakdown] = projectForecastWeeks(forecast.weeks, byId, 'variety', '100', ALL_CROPS);
    expect(aggregate.crops).toHaveLength(1);
    expect(aggregate.crops[0]).toMatchObject({ crop_id: 100, color: base, yield: 13.75 });
    expect(breakdown.crops.reduce((sum, crop) => sum + crop.yield, 0)).toBe(13.75);
    expect(breakdown.crops[0].crop_display_name).toBe('Lettuce (general)');
    expect(breakdown.crops[0].color).toBe(base);
    expect(breakdown.crops[1]).toMatchObject({ color: base, crop_display_name: 'Lettuce (Variety 1)' });
    expect(breakdown.crops[2].color).toBe(custom);
    expect(new Set(breakdown.crops.map(crop => crop.color)).size).toBe(10);
    const [filtered] = projectForecastWeeks(forecast.weeks, byId, 'variety', '100', '110');
    expect(filtered.crops).toEqual([breakdown.crops[10]]);
    expect(forecast.weeks[0].crops[3].color).toBe(base);
  });
});
