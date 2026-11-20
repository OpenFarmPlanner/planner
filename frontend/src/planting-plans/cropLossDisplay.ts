import type { TFunction } from 'i18next';
import type { CropLoss } from '../api/types';
import { formatLocalizedNumber } from '../utils/numberLocalization';

export function formatCropLossExtent(
  { extent_unit: unit, extent_value: value }: Pick<CropLoss, 'extent_unit' | 'extent_value'>,
  locale: string,
  t: TFunction,
): string {
  if (value === null || !unit) return '';
  const amount = Number(value);
  if (unit === 'percent') {
    return formatLocalizedNumber(amount / 100, locale, { style: 'percent', maximumFractionDigits: 3 });
  }
  const formatted = formatLocalizedNumber(amount, locale, { maximumFractionDigits: 3 });
  return unit === 'plants' ? t('cropLosses.extentPlants', { count: amount, value: formatted })
    : t('cropLosses.extentArea', { value: formatted });
}
