import type { TFunction } from 'i18next';

import type {
  BedSuggestion,
  RotationFinding,
  RotationStatus,
} from '../../../api/types';
import { formatLocalizedNumber } from '../../../utils/numberLocalization';

/**
 * Name of a plant family in the UI language, from its botanical key. Rotation
 * copy never renders the backend's `family_name` directly (see
 * `useFamilyNameResolver`); the fallback is only used while the family list
 * has not loaded.
 */
export type FamilyNameResolver = (key: string | null | undefined, fallback?: string | null) => string;

/** Names the UI fills into rotation messages that the finding does not carry. */
export interface RotationCopyContext {
  bedLabel: string;
  cultureLabel: string;
  familyName: FamilyNameResolver;
}

const STATUS_ORDER: Record<RotationStatus, number> = {
  conflict: 0,
  accepted: 1,
  hint: 2,
  info: 3,
  ok: 4,
};

/** Severity order of rotation statuses (most urgent first). */
export const compareRotationStatus = (
  first: RotationStatus | undefined,
  second: RotationStatus | undefined,
): number => (first ? STATUS_ORDER[first] : 5) - (second ? STATUS_ORDER[second] : 5);

/**
 * Statuses the table flags next to the growing area: only what still needs
 * the user — an open conflict, or culture data that is missing for the check.
 * Accepted conflicts and nutrient hints show only in "Anbaufläche ändern".
 */
export const isFlaggedRotationStatus = (
  status: RotationStatus | null | undefined,
): status is 'conflict' | 'info' => status === 'conflict' || status === 'info';

export const getPrimaryFinding = (
  findings: RotationFinding[] | undefined,
): RotationFinding | null => findings?.[0] ?? null;

const fallback = (value: string | null | undefined): string => value ?? '';

const familyOf = (finding: RotationFinding, familyName: FamilyNameResolver): string => (
  familyName(finding.family_key, finding.family_name)
);

const MISSING_DATA_KINDS: ReadonlySet<RotationFinding['kind']> = new Set([
  'no_family',
  'no_break',
  'previous_no_family',
]);

const isMissingDataFinding = (finding: RotationFinding): boolean => MISSING_DATA_KINDS.has(finding.kind);

/**
 * The status the table and its "Fruchtfolge" filter work with. "Not
 * checkable" only counts when missing culture data blocks the check; the
 * backend only reports that when the bed has earlier plans in the break
 * window. A draft without bed or date (`incomplete`) has nothing to check yet.
 */
export const getTableRotationStatus = (
  status: RotationStatus | null | undefined,
  findings: RotationFinding[] | null | undefined,
): RotationStatus | null => {
  if (!status) {
    return null;
  }
  if (status === 'info' && !(findings ?? []).some(isMissingDataFinding)) {
    return null;
  }
  return status;
};

/**
 * Why the check is not possible, one reason per line: the heading line, each
 * missing value, and the hint where to add it.
 */
export function getMissingDataLines(
  findings: RotationFinding[] | null | undefined,
  t: TFunction,
  cultureLabel: string,
): string[] {
  const reasons = (findings ?? []).filter(isMissingDataFinding).map((finding) => {
    switch (finding.kind) {
      case 'no_family':
        return t('plantingPlans:rotation.info.missingData.noFamily', { crop: fallback(finding.crop_label) || cultureLabel });
      case 'no_break':
        return t('plantingPlans:rotation.info.missingData.noBreak', { crop: fallback(finding.crop_label) || cultureLabel });
      default:
        return t('plantingPlans:rotation.info.missingData.previousNoFamily', {
          crop: fallback(finding.previous_crop_label),
          year: finding.year,
        });
    }
  });
  return [
    t('plantingPlans:rotation.info.missingData.heading'),
    ...reasons,
    t('plantingPlans:rotation.info.missingData.closing'),
  ];
}

export function getConflictText(
  finding: RotationFinding,
  t: TFunction,
  context: RotationCopyContext,
): string {
  const key = finding.break_source === 'crop'
    ? 'plantingPlans:rotation.conflict.textCrop'
    : 'plantingPlans:rotation.conflict.textFamily';
  return t(key, {
    bed: context.bedLabel,
    year: finding.year,
    previousCulture: fallback(finding.previous_crop_label),
    family: familyOf(finding, context.familyName),
    culture: fallback(finding.crop_label) || context.cultureLabel,
    count: finding.break_years ?? 0,
    earliestYear: finding.earliest_year,
  });
}

/** "Fruchtfolge passt: {{reason}}", the one line shown for a fitting bed. */
export function getOkText(finding: RotationFinding, t: TFunction, familyName: FamilyNameResolver): string {
  const family = familyOf(finding, familyName);
  let reason: string;
  if (finding.kind === 'no_history') {
    reason = t('plantingPlans:rotation.ok.reasons.noHistory');
  } else if (finding.year === null) {
    reason = t('plantingPlans:rotation.ok.reasons.noFamilyOnBed', { family });
  } else if (finding.previous_crop_label) {
    reason = t('plantingPlans:rotation.ok.reasons.lastFamily', {
      family,
      year: finding.year,
      previousCulture: finding.previous_crop_label,
    });
  } else {
    reason = t('plantingPlans:rotation.ok.reasons.lastFamilyWithoutPrevious', { family, year: finding.year });
  }
  return t('plantingPlans:rotation.ok.text', { reason });
}

export function getInfoText(
  finding: RotationFinding,
  t: TFunction,
  context: RotationCopyContext,
): string {
  const culture = fallback(finding.crop_label) || context.cultureLabel;
  switch (finding.kind) {
    case 'no_family':
      return t('plantingPlans:rotation.info.noFamily', { culture });
    case 'no_break':
      return t('plantingPlans:rotation.info.noBreak', { culture, family: familyOf(finding, context.familyName) });
    case 'previous_no_family':
      return t('plantingPlans:rotation.info.missingData.previousNoFamily', {
        crop: fallback(finding.previous_crop_label),
        year: finding.year,
      });
    default:
      return t('plantingPlans:rotation.info.incomplete');
  }
}

/** The short title of a plan's rotation status, as in the table tooltip. */
export function getRotationTitle(
  status: RotationStatus,
  finding: RotationFinding | null,
  t: TFunction,
  familyName: FamilyNameResolver,
): string {
  const family = finding ? familyOf(finding, familyName) : '';
  switch (status) {
    case 'conflict':
      return t('plantingPlans:rotation.conflict.title', { family });
    case 'accepted':
      return t('plantingPlans:rotation.accepted.title', { family });
    case 'hint':
      return t('plantingPlans:rotation.hint.title');
    case 'info':
      return t('plantingPlans:rotation.info.title');
    default:
      return finding ? getOkText(finding, t, familyName) : t('plantingPlans:rotation.status.ok');
  }
}

/** The one reason line shown with a suggested bed or a bed option. */
export function getSuggestionReason(
  suggestion: BedSuggestion,
  t: TFunction,
  familyName: FamilyNameResolver,
  cultureLabel: string,
): string {
  const finding = getPrimaryFinding(suggestion.findings);
  if (!finding) {
    return '';
  }
  const family = familyOf(finding, familyName);
  switch (finding.kind) {
    case 'family_conflict':
      return t('plantingPlans:rotation.suggestions.reasons.conflict', {
        year: finding.year,
        previousCulture: fallback(finding.previous_crop_label),
        family,
        earliestYear: finding.earliest_year,
      });
    case 'nutrient_hint':
      return t('plantingPlans:rotation.suggestions.reasons.hint', {
        year: finding.year,
        previousCulture: fallback(finding.previous_crop_label),
      });
    case 'no_family':
      return t('plantingPlans:rotation.suggestions.reasons.noFamily', { culture: cultureLabel });
    case 'no_break':
      return t('plantingPlans:rotation.suggestions.reasons.noBreak', { family });
    case 'previous_no_family':
      return t('plantingPlans:rotation.info.missingData.previousNoFamily', {
        crop: fallback(finding.previous_crop_label),
        year: finding.year,
      });
    case 'no_history':
      return t('plantingPlans:rotation.suggestions.reasons.noHistory');
    case 'ok':
      if (suggestion.previous_is_soil_improver && suggestion.category === 'good' && finding.previous_crop_label) {
        return t('plantingPlans:rotation.suggestions.reasons.soilImproverBefore', {
          previousCulture: finding.previous_crop_label,
          culture: cultureLabel,
        });
      }
      if (finding.year === null) {
        return finding.previous_crop_label
          ? t('plantingPlans:rotation.suggestions.reasons.neverOnBedWithPrevious', {
            family,
            previousCulture: finding.previous_crop_label,
          })
          : t('plantingPlans:rotation.suggestions.reasons.neverOnBed', { family });
      }
      return t('plantingPlans:rotation.suggestions.reasons.lastFamily', { family, year: finding.year });
    default:
      return '';
  }
}

/**
 * Formats an ISO date (or date-time) in the UI language. Date-only values are
 * read as local calendar dates, so they never shift by a day.
 */
export const formatIsoDate = (iso: string | null | undefined, language: string): string => {
  if (!iso) {
    return '';
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(parsed);
};

const formatSquareMeters = (value: number, locale: string): string => (
  formatLocalizedNumber(value, locale, { maximumFractionDigits: 2 })
);

/**
 * The capacity part of a bed option's secondary line: the reason a bed cannot
 * hold the plan, or how much of a partly occupied bed is still free. Empty
 * for a bed that is free in the whole period.
 */
export function getBedCapacityText(
  suggestion: BedSuggestion,
  neededAreaSqm: number | null | undefined,
  t: TFunction,
  numberLocale: string,
  language: string,
): string {
  const free = suggestion.free_area_sqm;
  if (!suggestion.has_enough_area && free !== null && neededAreaSqm) {
    const values = {
      free: formatSquareMeters(free, numberLocale),
      needed: formatSquareMeters(neededAreaSqm, numberLocale),
    };
    const blocker = suggestion.blocking_plan;
    return blocker
      ? t('plantingPlans:rotation.capacity.insufficient', {
        ...values,
        blockingCulture: blocker.crop_label,
        date: formatIsoDate(blocker.end_date, language),
      })
      : t('plantingPlans:rotation.capacity.insufficientWithoutBlocker', values);
  }
  if (suggestion.is_partially_occupied && free !== null && suggestion.bed_area_sqm !== null) {
    return t('plantingPlans:rotation.capacity.partial', {
      free: formatSquareMeters(free, numberLocale),
      total: formatSquareMeters(suggestion.bed_area_sqm, numberLocale),
    });
  }
  return '';
}

/** Link to a crop's edit view, where family and rotation break live. */
export const getCropSettingsPath = (cropId: number): string => `/app/crops?cropId=${cropId}&action=edit`;
