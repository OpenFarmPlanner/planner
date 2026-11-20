import type { TFunction } from 'i18next';
import type { HarvestQuantity, HarvestUnit, Season } from '../api/types';
import { toIsoDateString } from '../components/data-grid/dateEditCellUtils';
import { formatLocalizedNumber } from '../utils/numberLocalization';

export const HARVEST_UNITS: readonly HarvestUnit[] = ['kg', 'g', 'piece', 'bunch'];

export function formatHarvestQuantity(
  quantity: number | string, unit: HarvestUnit, locale: string, t: TFunction,
): string {
  const value = Number(quantity);
  const mass = unit === 'kg' ? 'kilogram' : unit === 'g' ? 'gram' : undefined;
  const digits = { maximumFractionDigits: 6 };
  if (mass) {
    return formatLocalizedNumber(value, locale, { ...digits, style: 'unit', unit: mass, unitDisplay: 'short' });
  }
  return t(`quantities.${unit}`, { count: value, value: formatLocalizedNumber(value, locale, digits) });
}

export function initialHarvestDate(season: Season | null | undefined, planned?: string | null): string {
  const today = toIsoDateString(new Date())!;
  if (!season || (season.start_date <= today && today <= season.end_date)) return today;
  if (planned && season.start_date <= planned && planned <= season.end_date) return planned;
  return today < season.start_date ? season.start_date : season.end_date;
}

export function formatHarvestTotals(quantities: HarvestQuantity[], locale: string, t: TFunction): string {
  return quantities.map(({ quantity, unit }) => formatHarvestQuantity(quantity, unit, locale, t)).join(' + ');
}
