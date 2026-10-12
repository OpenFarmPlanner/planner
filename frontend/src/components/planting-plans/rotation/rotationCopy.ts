import type { TFunction } from 'i18next';

import type {
  BedSuggestion,
  RotationFinding,
  RotationStatus,
} from '../../../api/types';

/** Names the UI fills into rotation messages that the finding does not carry. */
export interface RotationCopyContext {
  bedLabel: string;
  cultureLabel: string;
}

export interface RotationCopy {
  title: string;
  text: string;
}

const STATUS_ORDER: Record<RotationStatus, number> = {
  conflict: 0,
  accepted: 1,
  hint: 2,
  info: 3,
  ok: 4,
};

/** Severity order used to sort the rotation column (most urgent first). */
export const compareRotationStatus = (
  first: RotationStatus | undefined,
  second: RotationStatus | undefined,
): number => (first ? STATUS_ORDER[first] : 5) - (second ? STATUS_ORDER[second] : 5);

export const getPrimaryFinding = (
  findings: RotationFinding[] | undefined,
): RotationFinding | null => findings?.[0] ?? null;

const fallback = (value: string | null | undefined): string => value ?? '';

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
    family: fallback(finding.family_name),
    culture: fallback(finding.crop_label) || context.cultureLabel,
    count: finding.break_years ?? 0,
    earliestYear: finding.earliest_year,
  });
}

export function getOkText(finding: RotationFinding, t: TFunction): string {
  const family = fallback(finding.family_name);
  if (finding.year === null) {
    return t('plantingPlans:rotation.ok.noFamilyOnBed', { family });
  }
  if (finding.previous_crop_label) {
    return t('plantingPlans:rotation.ok.lastFamily', {
      family,
      year: finding.year,
      previousCulture: finding.previous_crop_label,
    });
  }
  return t('plantingPlans:rotation.ok.lastFamilyWithoutPrevious', { family, year: finding.year });
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
      return t('plantingPlans:rotation.info.noBreak', { culture, family: fallback(finding.family_name) });
    case 'no_history':
      return t('plantingPlans:rotation.info.noHistory');
    default:
      return t('plantingPlans:rotation.info.incomplete');
  }
}

/**
 * Title and text of a plan's primary rotation finding, as shown in the table
 * tooltip. The dialog renders the same copy with its links and actions.
 */
export function getRotationCopy(
  status: RotationStatus,
  finding: RotationFinding | null,
  t: TFunction,
  context: RotationCopyContext,
): RotationCopy {
  if (!finding) {
    return { title: t(`plantingPlans:rotation.status.${status}`), text: '' };
  }
  switch (finding.kind) {
    case 'family_conflict':
      return status === 'accepted'
        ? {
          title: t('plantingPlans:rotation.accepted.title', { family: fallback(finding.family_name) }),
          text: getConflictText(finding, t, context),
        }
        : {
          title: t('plantingPlans:rotation.conflict.title', { family: fallback(finding.family_name) }),
          text: getConflictText(finding, t, context),
        };
    case 'nutrient_hint':
      return {
        title: t('plantingPlans:rotation.hint.title'),
        text: t('plantingPlans:rotation.hint.text', {
          year: finding.year,
          previousCulture: fallback(finding.previous_crop_label),
        }),
      };
    case 'ok':
      return { title: t('plantingPlans:rotation.ok.title'), text: getOkText(finding, t) };
    default:
      return { title: t('plantingPlans:rotation.info.title'), text: getInfoText(finding, t, context) };
  }
}

/** The one reason sentence shown next to a bed suggestion. */
export function getSuggestionReason(
  suggestion: BedSuggestion,
  t: TFunction,
  cultureLabel: string,
): string {
  const finding = getPrimaryFinding(suggestion.findings);
  if (!finding) {
    return '';
  }
  const family = fallback(finding.family_name);
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
    case 'no_history':
      return t('plantingPlans:rotation.suggestions.reasons.noHistory');
    case 'ok':
      if (suggestion.previous_is_soil_improver && suggestion.category === 'good' && finding.previous_crop_label) {
        return t('plantingPlans:rotation.suggestions.reasons.soilImproverBefore', {
          previousCulture: finding.previous_crop_label,
          culture: cultureLabel,
        });
      }
      if (finding.year === null || suggestion.years_since_family === null) {
        return t('plantingPlans:rotation.suggestions.reasons.neverOnBed', { family });
      }
      return t('plantingPlans:rotation.suggestions.reasons.lastFamily', {
        family,
        year: finding.year,
        count: suggestion.years_since_family,
      });
    default:
      return '';
  }
}

export const formatAcceptedDate = (iso: string | null | undefined, language: string): string => {
  if (!iso) {
    return '';
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(parsed);
};

/** Link to a crop's edit view, where family and rotation break live. */
export const getCropSettingsPath = (cropId: number): string => `/app/crops?cropId=${cropId}&action=edit`;
