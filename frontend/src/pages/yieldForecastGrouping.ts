import type { YieldCalendarForecast, YieldCalendarWeek } from '../api/types';
import { formatCropDisplayName, getCropDisplayName } from '../crops/cropDisplay';
import { ALL_CROPS, mergeCropYields, type YieldCropMeta } from './yieldOverviewUtils';

export type YieldForecastGrouping = 'crop' | 'variety';

interface ForecastVariety extends YieldCropMeta {
  generalCrop: YieldCropMeta;
  keepColor: boolean;
}

export function buildForecastCropIndex(
  { weeks, crop_groups }: YieldCalendarForecast,
  locale: string,
  formatGeneralVariety: (name: string) => string,
  seriesColors: readonly string[],
) {
  const byId = new Map<number, ForecastVariety>();
  for (const group of crop_groups ?? []) {
    byId.set(group.crop_id, {
      id: group.crop_id,
      name: group.crop_variety?.trim()
        ? formatCropDisplayName(group)
        : formatGeneralVariety(getCropDisplayName(group)),
      color: group.effective_color,
      generalCrop: { id: group.general_crop_id, name: group.general_crop_name, color: group.color },
      keepColor: group.has_color_override || !group.crop_variety?.trim(),
    });
  }
  // Cached or older API responses can still display every row they provided.
  for (const week of weeks) {
    for (const crop of week.crops) {
      if (byId.has(crop.crop_id)) continue;
      const meta = { id: crop.crop_id, name: getCropDisplayName(crop), color: crop.color };
      byId.set(meta.id, { ...meta, generalCrop: meta, keepColor: true });
    }
  }
  const varieties = [...byId.values()];
  assignVarietyChartColors(varieties, seriesColors);
  const groupOptions = new Map(varieties.map(({ generalCrop }) => [generalCrop.id, generalCrop]));
  const compare = (left: YieldCropMeta, right: YieldCropMeta) =>
    left.name.localeCompare(right.name, locale) || left.id - right.id;
  return { byId, crops: [...groupOptions.values()].sort(compare), varieties: varieties.sort(compare) };
}

function assignVarietyChartColors(varieties: ForecastVariety[], seriesColors: readonly string[]): void {
  if (!seriesColors.length) return;
  const counts = new Map<string, number>();
  for (const variety of varieties) {
    const color = variety.color.toLowerCase();
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  const reserved = new Set(varieties
    .filter(({ color, keepColor }) => keepColor || counts.get(color.toLowerCase()) === 1)
    .map(({ color }) => color.toLowerCase()));
  const available = seriesColors.filter(color => !reserved.has(color.toLowerCase()));
  const palette = available.length ? available : seriesColors;
  let index = 0;
  for (const variety of [...varieties].sort((left, right) => left.id - right.id)) {
    if (!variety.keepColor && (counts.get(variety.color.toLowerCase()) ?? 0) > 1) {
      variety.color = palette[index % palette.length];
      index += 1;
    }
  }
}

export function forecastCropMatches(
  cropId: number,
  byId: ReadonlyMap<number, ForecastVariety>,
  groupId: string,
  varietyId: string,
): boolean {
  return (groupId === ALL_CROPS || String(byId.get(cropId)?.generalCrop.id ?? cropId) === groupId)
    && (varietyId === ALL_CROPS || String(cropId) === varietyId);
}

export function projectForecastWeeks(
  weeks: YieldCalendarWeek[],
  byId: ReadonlyMap<number, ForecastVariety>,
  grouping: YieldForecastGrouping,
  groupId: string,
  varietyId: string,
): YieldCalendarWeek[] {
  return weeks.map(week => {
    const crops = week.crops
      .filter(crop => forecastCropMatches(crop.crop_id, byId, groupId, varietyId))
      .map(crop => {
        const variety = byId.get(crop.crop_id);
        if (!variety) return crop;
        const series = grouping === 'crop' ? variety.generalCrop : variety;
        return { ...crop, crop_id: series.id, crop_display_name: series.name, color: series.color };
      });
    return { ...week, crops: grouping === 'crop' ? mergeCropYields(crops) : crops };
  });
}
