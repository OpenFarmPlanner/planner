import type { TFunction } from 'i18next';
import type { HarvestQuantity, HarvestUnit } from '../api/types';
import { formatLocalizedNumber } from '../utils/numberLocalization';

export const HARVEST_UNITS: readonly HarvestUnit[] = ['kg', 'g', 'piece', 'bunch'];

export function formatYieldPerAreaValue(
  value: number | string, locale: string, belowResolution = false,
): string {
  const rate = Number(value);
  const smallestDisplayedRate = 0.01;
  const digits = { maximumFractionDigits: 2 };
  if (belowResolution || (rate > 0 && rate < smallestDisplayedRate / 2)) {
    return `< ${formatLocalizedNumber(smallestDisplayedRate, locale, digits)}`;
  }
  return formatLocalizedNumber(rate, locale, digits);
}

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

export function formatHarvestTotals(quantities: HarvestQuantity[], locale: string, t: TFunction): string {
  return quantities.map(({ quantity, unit }) => formatHarvestQuantity(quantity, unit, locale, t)).join(' + ');
}
