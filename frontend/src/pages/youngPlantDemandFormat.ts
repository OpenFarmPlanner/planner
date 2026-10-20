import type { YoungPlantDemand, YoungPlantDemandPlan, YoungPlantDemandWeek } from '../api/types';
import { formatCropDisplayName } from '../crops/cropDisplay';
import { formatLocalizedNumber } from '../utils/numberLocalization';
import { parseIsoDate } from '../utils/isoDate';
import { AREA_LABEL_SEPARATOR } from './plantingPlansUtils';

export type YoungPlantDemandTranslator = (key: string, options?: Record<string, unknown>) => string;

const BLOCKER_LABEL_KEYS: Record<string, string> = {
  missing_plant_spacing: 'youngPlantDemand.calculationBlockers.missing_plant_spacing',
  missing_area: 'youngPlantDemand.calculationBlockers.missing_area',
};

const formatDayMonth = (isoDate: string, locale: string, withYear: boolean): string => {
  const date = parseIsoDate(isoDate);
  if (!date) {
    return isoDate;
  }
  return date.toLocaleDateString(locale, {
    day: '2-digit',
    month: '2-digit',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
};

/** "KW 15" / "Wk 15" etc. */
export const formatPlantingWeekLabel = (
  week: YoungPlantDemandWeek | null,
  t: YoungPlantDemandTranslator,
): string => (
  week ? t('youngPlantDemand.weekLabel', { week: week.iso_week }) : t('youngPlantDemand.noPlantingDate')
);

/** Monday to Sunday of the planting week, localized ("06.04. – 12.04.2026"). */
export const formatPlantingWeekRange = (
  week: YoungPlantDemandWeek | null,
  locale: string,
  t: YoungPlantDemandTranslator,
): string => (
  week
    ? t('youngPlantDemand.weekRange', {
      start: formatDayMonth(week.start_date, locale, false),
      end: formatDayMonth(week.end_date, locale, true),
    })
    : ''
);

export const formatPlantingDate = (isoDate: string | null, locale: string): string => (
  isoDate ? formatDayMonth(isoDate, locale, true) : '—'
);

/** "Stückzahl nicht berechenbar: Pflanzabstand fehlt" for a row or plan without a count. */
export const getPlantCountUnavailableText = (
  item: Pick<YoungPlantDemand | YoungPlantDemandPlan, 'calculation_blockers'>,
  t: YoungPlantDemandTranslator,
): string => {
  const reasons = item.calculation_blockers.length > 0
    ? item.calculation_blockers.map((blocker) => (
      t(BLOCKER_LABEL_KEYS[blocker] ?? 'youngPlantDemand.calculationBlockers.missingData')
    ))
    : [t('youngPlantDemand.calculationBlockers.missingData')];
  return t('youngPlantDemand.countUnavailable', { reason: reasons.join(', ') });
};

/** The plant count to order (reserve included), or null when not computable. */
export const formatPlantCount = (row: YoungPlantDemand, locale: string): string | null => (
  row.plant_count_with_reserve === null ? null : formatLocalizedNumber(row.plant_count_with_reserve, locale)
);

/** "120 Pflanzen + 10 % Reserve = 132", shown only when a reserve applies. */
export const getReserveBreakdown = (
  row: YoungPlantDemand,
  locale: string,
  t: YoungPlantDemandTranslator,
): string | null => {
  if (row.plant_count === null || row.plant_count_with_reserve === null || row.reserve_percent <= 0) {
    return null;
  }
  return t('youngPlantDemand.reserveBreakdown', {
    base: formatLocalizedNumber(row.plant_count, locale),
    percent: formatLocalizedNumber(row.reserve_percent, locale),
    total: formatLocalizedNumber(row.plant_count_with_reserve, locale),
  });
};

export const getYoungPlantCropLabel = (row: YoungPlantDemand): string => (
  formatCropDisplayName({ crop_display_name: row.crop_display_name, crop_name: row.crop_name })
);

export const formatPlanLocation = (plan: YoungPlantDemandPlan): string => (
  [plan.location_name, plan.field_name, plan.bed_name]
    .filter((part) => part.length > 0)
    .join(AREA_LABEL_SEPARATOR) || '—'
);
