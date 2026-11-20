import type { TFunction } from 'i18next';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../utils/numberLocalization';

/**
 * Site, life cycle and plant health of a crop: descriptive values a Sorte
 * inherits from its Kultur and the crop library carries like any copy field.
 * Light and water also inform advisory checks against the selected bed.
 */
export const SITE_HEALTH_CHOICES = {
  light_requirement: ['full_sun', 'partial_shade', 'shade'],
  water_requirement: ['low', 'medium', 'high'],
  life_cycle: ['annual', 'biennial', 'perennial'],
  winter_hardiness: ['hardy', 'with_protection', 'not_hardy'],
} as const;

export type SiteHealthChoiceField = keyof typeof SITE_HEALTH_CHOICES;
export const SITE_HEALTH_CHOICE_FIELDS = Object.keys(SITE_HEALTH_CHOICES) as SiteHealthChoiceField[];
export const SITE_HEALTH_FIELDS = [...SITE_HEALTH_CHOICE_FIELDS, 'standing_time_years', 'pests_diseases'] as const;
export type SiteHealthField = typeof SITE_HEALTH_FIELDS[number];

export type LightRequirement = typeof SITE_HEALTH_CHOICES.light_requirement[number];
export type WaterRequirement = typeof SITE_HEALTH_CHOICES.water_requirement[number];
export type LifeCycle = typeof SITE_HEALTH_CHOICES.life_cycle[number];
export type WinterHardiness = typeof SITE_HEALTH_CHOICES.winter_hardiness[number];

export function normalizeLightRequirements(value: unknown): LightRequirement[] {
  const choices = Array.isArray(value) ? value : [value];
  return SITE_HEALTH_CHOICES.light_requirement.filter((choice) => choices.includes(choice));
}

/** Stored and portable values include biennial; new UI selections do not. */
export function selectableSiteHealthChoices(field: SiteHealthChoiceField): readonly string[] {
  return field === 'life_cycle'
    ? SITE_HEALTH_CHOICES.life_cycle.filter((value) => value !== 'biennial')
    : SITE_HEALTH_CHOICES[field];
}

export function formatSiteHealthValue(field: SiteHealthField, value: unknown, t: TFunction): string {
  if (value == null || value === '') return t('noData');
  if (field === 'pests_diseases') return String(value);
  if (field === 'standing_time_years') return formatLocalizedNumber(Number(value), getActiveFormattingLocale());
  if (field === 'light_requirement') {
    return normalizeLightRequirements(value)
      .map((choice) => t(`siteHealth.values.light_requirement.${choice}`)).join(', ') || t('noData');
  }
  const choices: readonly string[] = SITE_HEALTH_CHOICES[field];
  return choices.includes(String(value)) ? t(`siteHealth.values.${field}.${String(value)}`) : String(value);
}
