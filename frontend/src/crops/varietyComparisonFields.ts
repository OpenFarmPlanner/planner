/**
 * Registry driving the Varieties comparison table in the Crop detail view.
 * Each entry describes one displayed value (backed by one or more Crop
 * fields), its label, and how to format it — so new fields can be added
 * here without touching the column-selection/rendering logic.
 */

import type { Crop, CultivationType } from '../api/types';
import {
  formatDistance,
  formatNumber,
} from './cropDetailFormatters';
import { areCropValuesEqual, isEmptyCropValue } from './varietyValueSource';

type TranslateFn = (key: string) => string;

/** Lookups a cell formatter may need beyond translations. */
export interface ComparisonFormatContext {
  /** Localized name for a plant-family key (see `usePlantFamilies`). */
  getPlantFamilyName?: (botanicalName: string | null | undefined) => string;
}

export interface CropComparisonField {
  id: string;
  keys: (keyof Crop)[];
  labelKey: string;
  format: (crop: Crop, t: TranslateFn, locale: string, context: ComparisonFormatContext) => string;
  /**
   * Overrides the default "effective value per key" resolution (variety's
   * own value for each of `keys`, falling back to the crop's) for fields
   * whose displayed value isn't a straight 1:1 mapping to `keys` — e.g.
   * seed safety margin, which is actually sourced from a cultivation-type
   * -specific field (direct/pre-cultivation), not the general one, mirroring
   * the resolution CropDetail.tsx/CropSeedDetails already do. Must
   * return values keyed exactly like `format` expects to read them.
   */
  resolveEffectiveValues?: (variety: Crop, cropCrop: Crop) => Partial<Crop>;
}

function getActiveCultivationTypes(crop: Crop): CultivationType[] {
  const types = crop.cultivation_types;
  if (types && types.length > 0) {
    return types;
  }
  return crop.cultivation_type ? [crop.cultivation_type] : [];
}

/**
 * The cultivation type(s) a crop effectively has: its own, or the crop's
 * when it has none of its own — same fallback as `activeCultivationTypes` in
 * CropDetail.tsx.
 */
function getEffectiveCultivationTypes(crop: Crop, cropCrop: Crop): CultivationType[] {
  const ownTypes = getActiveCultivationTypes(crop);
  return ownTypes.length > 0 ? ownTypes : getActiveCultivationTypes(cropCrop);
}

export const CROP_COMPARISON_FIELDS: CropComparisonField[] = [
  {
    id: 'cropFamily',
    keys: ['crop_family'],
    labelKey: 'form.cropFamily',
    format: (crop, _t, _locale, context) => (
      context.getPlantFamilyName?.(crop.crop_family) ?? crop.crop_family ?? ''
    ),
  },
  {
    id: 'nutrientDemand',
    keys: ['nutrient_demand'],
    labelKey: 'form.nutrientDemand',
    format: (crop, t) => (
      crop.nutrient_demand === 'low'
        ? t('form.nutrientDemandLow')
        : crop.nutrient_demand === 'medium'
          ? t('form.nutrientDemandMedium')
          : crop.nutrient_demand === 'high'
            ? t('form.nutrientDemandHigh')
            : ''
    ),
  },
  {
    id: 'cultivationType',
    keys: ['cultivation_types', 'cultivation_type'],
    labelKey: 'form.cultivationType',
    format: (crop, t) => (
      getActiveCultivationTypes(crop)
        .map((item) => (
          item === 'pre_cultivation'
            ? t('form.cultivationTypePreCultivation')
            : t('form.cultivationTypeDirectSowing')
        ))
        .join(', ')
    ),
  },
  {
    id: 'growthDurationDays',
    keys: ['growth_duration_days'],
    labelKey: 'form.growthDurationDays',
    format: (crop, t, locale) => `${formatNumber(crop.growth_duration_days ?? null, t, locale)} ${t('detail.units.days')}`,
  },
  {
    id: 'harvestDurationDays',
    keys: ['harvest_duration_days'],
    labelKey: 'form.harvestDurationDays',
    format: (crop, t, locale) => `${formatNumber(crop.harvest_duration_days ?? null, t, locale)} ${t('detail.units.days')}`,
  },
  {
    id: 'propagationDurationDays',
    keys: ['propagation_duration_days'],
    labelKey: 'form.propagationDurationDays',
    format: (crop, t, locale) => `${formatNumber(crop.propagation_duration_days ?? null, t, locale)} ${t('detail.units.days')}`,
  },
  {
    id: 'distanceWithinRow',
    keys: ['distance_within_row_cm'],
    labelKey: 'detail.fields.distanceWithinRow',
    format: (crop, t, locale) => `${formatDistance(crop.distance_within_row_cm ?? null, t, locale)} ${t('detail.units.centimeters')}`,
  },
  {
    id: 'rowSpacing',
    keys: ['row_spacing_cm'],
    labelKey: 'detail.fields.rowSpacing',
    format: (crop, t, locale) => `${formatDistance(crop.row_spacing_cm ?? null, t, locale)} ${t('detail.units.centimeters')}`,
  },
  {
    id: 'sowingDepth',
    keys: ['sowing_depth_cm'],
    labelKey: 'detail.fields.sowingDepth',
    format: (crop, t, locale) => `${formatDistance(crop.sowing_depth_cm ?? null, t, locale, 1)} ${t('detail.units.centimeters')}`,
  },
  {
    id: 'seedSafetyMargin',
    // Bookkeeping only (which raw fields feed this value) — the actual
    // per-variety resolution lives in `resolveEffectiveValues` below, since
    // which of these three fields is "the" safety margin depends on the
    // crop's (effective) cultivation type.
    keys: [
      'sowing_calculation_safety_percent',
      'sowing_calculation_safety_percent_direct',
      'sowing_calculation_safety_percent_pre_cultivation',
    ],
    labelKey: 'detail.fields.seedSafetyMargin',
    format: (crop, t, locale) => `${formatNumber(crop.sowing_calculation_safety_percent ?? null, t, locale)} ${t('detail.units.percent')}`,
    resolveEffectiveValues: (variety, cropCrop) => {
      const effectiveTypes = getEffectiveCultivationTypes(variety, cropCrop);
      const key = effectiveTypes.length === 1
        ? (effectiveTypes[0] === 'direct_sowing' ? 'sowing_calculation_safety_percent_direct' : 'sowing_calculation_safety_percent_pre_cultivation')
        : 'sowing_calculation_safety_percent';
      const resolvedValue = getEffectiveValue(variety, cropCrop, key) as number | null | undefined;
      return { sowing_calculation_safety_percent: resolvedValue ?? undefined };
    },
  },
  {
    id: 'seedingRequirement',
    keys: ['seeding_requirement', 'seeding_requirement_type'],
    labelKey: 'detail.fields.seedingRequirement',
    format: (crop, t, locale) => {
      const amount = formatNumber(crop.seeding_requirement ?? null, t, locale);
      const suffix = crop.seeding_requirement_type === 'per_sqm'
        ? ` ${t('detail.seedingRequirementTypes.perSqm')}`
        : crop.seeding_requirement_type === 'per_plant'
          ? ` ${t('detail.seedingRequirementTypes.perPlant')}`
          : '';
      return `${amount}${suffix}`;
    },
  },
  {
    id: 'thousandKernelWeight',
    keys: ['thousand_kernel_weight_g'],
    labelKey: 'form.thousandKernelWeightLabel',
    format: (crop, t, locale) => `${formatNumber(crop.thousand_kernel_weight_g ?? null, t, locale)} ${t('detail.units.grams')}`,
  },
  {
    id: 'yieldUnit',
    keys: ['harvest_method'],
    labelKey: 'form.yieldUnit',
    format: (crop, t) => (
      crop.harvest_method === 'per_plant'
        ? t('form.yieldUnitPerPlant')
        : crop.harvest_method === 'per_sqm'
          ? t('form.yieldUnitPerSqm')
          : ''
    ),
  },
  {
    id: 'expectedYield',
    keys: ['expected_yield'],
    labelKey: 'form.expectedYield',
    format: (crop, t, locale) => `${formatNumber(crop.expected_yield ?? null, t, locale)} ${t('detail.units.kilograms')}`,
  },
];

const EMPTY_CELL_VALUE = '—';

/**
 * The value a variety effectively has for one Crop field: its own value
 * if it has one, otherwise the general crop's value — the same inherit
 * fallback used everywhere else in the detail view.
 */
function getEffectiveValue(variety: Crop, cropCrop: Crop, key: keyof Crop): unknown {
  const ownValue = variety[key];
  return isEmptyCropValue(ownValue) ? cropCrop[key] : ownValue;
}

/**
 * The effective values for one field/variety pair, keyed exactly like
 * `field.format` expects to read them — via `field.resolveEffectiveValues`
 * when the field defines one, otherwise the default per-key fallback.
 */
function resolveFieldValues(field: CropComparisonField, variety: Crop, cropCrop: Crop): Partial<Crop> {
  if (field.resolveEffectiveValues) {
    return field.resolveEffectiveValues(variety, cropCrop);
  }

  const values: Record<string, unknown> = {};
  for (const key of field.keys) {
    values[key] = getEffectiveValue(variety, cropCrop, key);
  }
  return values as Partial<Crop>;
}

function fieldValuesDiffer(a: Partial<Crop>, b: Partial<Crop>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Crop>;
  for (const key of keys) {
    if (!areCropValuesEqual(a[key], b[key])) {
      return true;
    }
  }
  return false;
}

/**
 * Fields where at least two of the given varieties end up with a genuinely
 * different *effective* value (own value, or the inherited crop value when
 * the variety has none) — i.e. the columns worth showing in the comparison
 * table. A field with fewer than two varieties, or where every variety
 * agrees (including two varieties inheriting the same crop value, or all
 * being empty on both variety and crop), is left out entirely rather than
 * shown with identical values in every row.
 */
export function getVaryingComparisonFields(varieties: Crop[], cropCrop: Crop): CropComparisonField[] {
  if (varieties.length < 2) {
    return [];
  }

  const [reference, ...rest] = varieties;
  return CROP_COMPARISON_FIELDS.filter((field) => {
    const referenceValues = resolveFieldValues(field, reference, cropCrop);
    return rest.some((variety) => fieldValuesDiffer(referenceValues, resolveFieldValues(field, variety, cropCrop)));
  });
}

/**
 * Formats one table cell for a given variety/field pair. A variety with no
 * own value for a field still effectively has the general crop's value (the
 * same inherit fallback used everywhere else in the detail view), so that's
 * what's shown here — a plain em-dash (matching the rest of the app's
 * empty-value convention) only appears when neither the variety nor the
 * crop has a value for this field at all.
 */
export function getComparisonCellValue(
  variety: Crop,
  cropCrop: Crop,
  field: CropComparisonField,
  t: TranslateFn,
  locale: string,
  context: ComparisonFormatContext = {},
): string {
  const effective = resolveFieldValues(field, variety, cropCrop);
  const hasAnyValue = Object.values(effective).some((value) => !isEmptyCropValue(value));

  if (!hasAnyValue) {
    return EMPTY_CELL_VALUE;
  }

  return field.format({ ...variety, ...effective } as Crop, t, locale, context);
}
