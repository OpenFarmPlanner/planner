import type { HarvestUnit, YieldComparisonSeason } from '../api/types';

export type YieldChartUnit = Exclude<HarvestUnit, 'g'>;

export function yieldChartUnits(seasons: YieldComparisonSeason[]): YieldChartUnit[] {
  return (['kg', 'piece', 'bunch'] as const).filter(unit => seasons.some(row => unit === 'kg'
    ? row.forecast_kg !== null || row.recorded.measured_kg !== null
    : row.recorded.quantities.some(quantity => quantity.unit === unit)));
}

export interface YieldChartSeries {
  kind: 'forecast' | 'recorded';
  value: string | null;
  partial: boolean;
}

export function yieldChartSeries(row: YieldComparisonSeason, unit: YieldChartUnit): YieldChartSeries[] {
  const recorded: YieldChartSeries = {
    kind: 'recorded',
    value: unit === 'kg' ? row.recorded.measured_kg
      : row.recorded.quantities.find(quantity => quantity.unit === unit)?.quantity ?? null,
    partial: Boolean(row.excluded_unassigned_records)
      || row.assigned_forecast_plan_count < row.expected_plan_count
      || (unit === 'kg' && row.recorded.quantities.some(quantity => quantity.unit !== 'kg'))
      || (unit === 'kg' && row.forecast_kg !== null && !row.comparable),
  };
  if (unit !== 'kg') return [recorded];
  return [{
    kind: 'forecast', value: row.forecast_kg, partial: row.forecast_plan_count < row.expected_plan_count,
  }, recorded];
}

export function yieldChartScale(seasons: YieldChartSeries[][]): number {
  const peak = seasons.reduce((maximum, season) => Math.max(maximum, ...season.map(series => Number(series.value))), 0);
  if (peak === 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  return ([1, 2, 5].find(step => step * magnitude >= peak) ?? 10) * magnitude;
}
