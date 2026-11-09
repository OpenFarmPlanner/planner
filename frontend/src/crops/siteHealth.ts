import type { TFunction } from 'i18next';

/**
 * Site, life cycle and plant health of a crop: descriptive values a Sorte
 * inherits from its Kultur and the crop library carries like any copy field.
 * They are not planning checks (yet): see docs/crop-library-architecture.md.
 */
export const SITE_HEALTH_CHOICES = {
  light_requirement: ['full_sun', 'partial_shade', 'shade'],
  water_requirement: ['low', 'medium', 'high'],
  life_cycle: ['annual', 'biennial', 'perennial'],
  winter_hardiness: ['hardy', 'with_protection', 'not_hardy'],
} as const;

export type SiteHealthChoiceField = keyof typeof SITE_HEALTH_CHOICES;
export const SITE_HEALTH_CHOICE_FIELDS = Object.keys(SITE_HEALTH_CHOICES) as SiteHealthChoiceField[];
export const SITE_HEALTH_FIELDS = [...SITE_HEALTH_CHOICE_FIELDS, 'pests_diseases'] as const;
export type SiteHealthField = typeof SITE_HEALTH_FIELDS[number];

export type LightRequirement = typeof SITE_HEALTH_CHOICES.light_requirement[number];
export type WaterRequirement = typeof SITE_HEALTH_CHOICES.water_requirement[number];
export type LifeCycle = typeof SITE_HEALTH_CHOICES.life_cycle[number];
export type WinterHardiness = typeof SITE_HEALTH_CHOICES.winter_hardiness[number];

export function formatSiteHealthValue(field: SiteHealthField, value: unknown, t: TFunction): string {
  if (value == null || value === '') return t('noData');
  if (field === 'pests_diseases') return String(value);
  const choices: readonly string[] = SITE_HEALTH_CHOICES[field];
  return choices.includes(String(value)) ? t(`siteHealth.values.${field}.${String(value)}`) : String(value);
}
