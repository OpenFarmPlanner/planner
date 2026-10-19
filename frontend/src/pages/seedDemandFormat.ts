import type { SeedDemand } from '../api/types';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../utils/numberLocalization';
import type { SeedDemandTranslator } from './seedDemandDiagnostics';

export const formatUnit = (unit: 'g' | 'seeds', t: SeedDemandTranslator): string => (
  unit === 'seeds' ? t('seedDemand.unitSeeds') : t('seedDemand.unitGrams')
);

export const formatSeedAmount = (value: number, options?: Intl.NumberFormatOptions): string => (
  formatLocalizedNumber(value, getActiveFormattingLocale(), options)
);

export const formatRequiredSeedAmount = (value: number): string => (
  formatSeedAmount(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
);

export const formatPackageSelection = (row: SeedDemand, t: SeedDemandTranslator): string => (
  (row.package_suggestion?.selection ?? [])
    .map((item) => `${formatSeedAmount(item.size_value)} ${formatUnit(item.size_unit, t)}${item.count > 1 ? ` × ${item.count}` : ''}`)
    .join(' + ')
);
