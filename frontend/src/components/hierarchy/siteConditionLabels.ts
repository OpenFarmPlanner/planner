import type { TFunction } from 'i18next';
import type { EffectiveSiteCondition } from '../../api/types';
import type { InheritedSiteConditionField } from './utils/siteConditions';

export type SiteConditionChoiceField = InheritedSiteConditionField | 'cultivation_environment';

/** Localized label of a stored site-condition choice; soil types reuse the location labels. */
export function getSiteConditionValueLabel(
  t: TFunction,
  field: SiteConditionChoiceField,
  value: string | null | undefined,
): string {
  if (!value) {
    return t('hierarchy:siteConditions.notSpecified');
  }
  if (field === 'soil_type') {
    return t(`locations:soilType.${value}`);
  }
  return t(`hierarchy:siteConditions.values.${field}.${value}`);
}

export function getSiteConditionFieldLabel(t: TFunction, field: string): string {
  return t(`hierarchy:siteConditions.labels.${field}`);
}

/** Site conditions whose label needs an explanation (`siteConditions.help`). */
const FIELDS_WITH_HELP: ReadonlySet<string> = new Set(['soil_moisture']);

/** Tooltip text explaining a site-condition field, or undefined when it needs none. */
export function getSiteConditionFieldHelp(t: TFunction, field: string): string | undefined {
  return FIELDS_WITH_HELP.has(field) ? t(`hierarchy:siteConditions.help.${field}`) : undefined;
}

/** "Inherited from parcel „North“" for an inherited value, otherwise null. */
export function getInheritedSourceLabel(
  t: TFunction,
  condition: EffectiveSiteCondition | undefined,
  ownLevel: 'location' | 'field' | 'bed',
): string | null {
  if (!condition?.source || condition.source === ownLevel) {
    return null;
  }
  return t(`hierarchy:siteConditions.inheritedFrom.${condition.source}`, { name: condition.source_name ?? '' });
}
