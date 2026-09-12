import type { Crop, CultivationType, PublicCrop, SeedRateUnit } from '../api/types';
import { normalizeLanguageTag } from '../i18n/languages';
import {
  normalizeCultivationType,
  normalizeHarvestMethod,
  normalizeNutrientDemand,
  normalizeSeedingRequirementType,
  normalizeSeedRateUnit,
} from './enumNormalization';
import { buildSeedRateByCultivation } from './seedRatePayload';
import { centimetersToMeters, metersToRoundedCentimeters } from '../utils/measurementConversion';

const publicCropCentimeters = (
  centimeters: number | null | undefined,
  meters: number | null | undefined,
): number | undefined => (
  centimeters === null || centimeters === undefined ? metersToRoundedCentimeters(meters) : centimeters
);

const seedRateUnitOrNull = (value: unknown): SeedRateUnit | null => normalizeSeedRateUnit(value) ?? null;

const directSeedRate = (
  crop: PublicCrop,
  type: CultivationType,
): { value?: number | null; unit?: SeedRateUnit | null } => {
  const methodSpecific = crop.seed_rate_by_cultivation?.[type];
  if (methodSpecific) {
    return methodSpecific;
  }
  if (crop.cultivation_type === type || crop.cultivation_types?.includes(type)) {
    return {
      value: crop.seed_rate_value ?? null,
      unit: seedRateUnitOrNull(crop.seed_rate_unit),
    };
  }
  return {};
};

const resolveCultivationTypes = (crop: PublicCrop): CultivationType[] => {
  if (crop.cultivation_types?.length) {
    return crop.cultivation_types;
  }
  return crop.cultivation_type ? [crop.cultivation_type] : ['pre_cultivation'];
};

const isCultivationType = (value: unknown): value is CultivationType => (
  value === 'pre_cultivation' || value === 'direct_sowing'
);

const resolveDraftCultivationTypes = (draft: Crop): CultivationType[] => {
  if (draft.cultivation_types && draft.cultivation_types.length > 0) {
    return draft.cultivation_types.filter(isCultivationType);
  }
  const normalized = normalizeCultivationType(draft.cultivation_type);
  return isCultivationType(normalized) ? [normalized] : ['pre_cultivation'];
};

export function publicCropToCropFormData(crop: PublicCrop): Crop {
  const cultivationTypes = resolveCultivationTypes(crop);
  const directRate = directSeedRate(crop, 'direct_sowing');
  const preCultivationRate = directSeedRate(crop, 'pre_cultivation');
  const originalLanguageCode = normalizeLanguageTag(crop.original_language_code) ?? '';
  const originalNotes = originalLanguageCode
    ? crop.translations?.[originalLanguageCode] ?? crop.notes ?? ''
    : crop.notes ?? '';

  return {
    id: crop.id,
    name: crop.name,
    variety: crop.variety ?? '',
    notes: originalNotes,
    crop_family: crop.crop_family ?? '',
    nutrient_demand: crop.nutrient_demand ?? '',
    cultivation_type: crop.cultivation_type || cultivationTypes[0] || 'pre_cultivation',
    cultivation_types: cultivationTypes,
    growth_duration_days: crop.growth_duration_days ?? undefined,
    harvest_duration_days: crop.harvest_duration_days ?? undefined,
    propagation_duration_days: crop.propagation_duration_days ?? undefined,
    harvest_method: crop.harvest_method ?? '',
    expected_yield: crop.expected_yield ?? undefined,
    distance_within_row_cm: publicCropCentimeters(crop.distance_within_row_cm, crop.distance_within_row_m),
    row_spacing_cm: publicCropCentimeters(crop.row_spacing_cm, crop.row_spacing_m),
    sowing_depth_cm: publicCropCentimeters(crop.sowing_depth_cm, crop.sowing_depth_m),
    seed_rate_value: crop.seed_rate_value ?? null,
    seed_rate_unit: normalizeSeedRateUnit(crop.seed_rate_unit),
    seed_rate_by_cultivation: crop.seed_rate_by_cultivation ?? null,
    seed_rate_direct_value: directRate.value ?? null,
    seed_rate_direct_unit: normalizeSeedRateUnit(directRate.unit),
    seed_rate_pre_cultivation_value: preCultivationRate.value ?? null,
    seed_rate_pre_cultivation_unit: normalizeSeedRateUnit(preCultivationRate.unit),
    thousand_kernel_weight_g: crop.thousand_kernel_weight_g ?? undefined,
    seeding_requirement: crop.seeding_requirement ?? undefined,
    seeding_requirement_type: crop.seeding_requirement_type ?? '',
    display_color: crop.display_color ?? '',
    seed_packages: crop.seed_packages ?? [],
  };
}

/**
 * Overlays the effective (inherited) value onto every field a Sorte does not
 * set itself, so a value it takes from its general Kultur is published as that
 * resolved value instead of as blank. Mirrors `build_public_crop_payload` on
 * the backend, which resolves the same fields through `resolve_crop_field`.
 * A no-op for crops without inheritance data (a general Kultur, a free-text
 * Sorte, or a draft built from a public crop).
 */
function resolveInheritedCropValues(draft: Crop): Crop {
  const inheritedFields = draft.inherited_fields;
  const effectiveValues = draft.effective_values;
  if (!inheritedFields?.length || !effectiveValues) {
    return draft;
  }
  const resolved: Crop = { ...draft };
  for (const field of inheritedFields) {
    const value = effectiveValues[field];
    if (value !== undefined) {
      Object.assign(resolved, { [field]: value });
    }
  }
  return resolved;
}

export function buildPublicCropUpdatePayload(
  rawDraft: Crop,
  baseVersion: number,
): Partial<PublicCrop> & { base_version: number } {
  const draft = resolveInheritedCropValues(rawDraft);
  const cultivationTypes = resolveDraftCultivationTypes(draft);
  const seedRateFallbackFields = buildSeedRateByCultivation(
    draft,
    cultivationTypes,
    seedRateUnitOrNull(draft.seed_rate_unit),
    seedRateUnitOrNull(draft.seed_rate_direct_unit),
    seedRateUnitOrNull(draft.seed_rate_pre_cultivation_unit),
  );
  return {
    base_version: baseVersion,
    variety: draft.variety ?? '',
    notes: draft.notes ?? '',
    crop_family: draft.crop_family ?? '',
    nutrient_demand: normalizeNutrientDemand(draft.nutrient_demand),
    cultivation_type: normalizeCultivationType(draft.cultivation_type),
    cultivation_types: cultivationTypes,
    growth_duration_days: draft.growth_duration_days ?? null,
    harvest_duration_days: draft.harvest_duration_days ?? null,
    propagation_duration_days: draft.propagation_duration_days ?? null,
    harvest_method: normalizeHarvestMethod(draft.harvest_method),
    expected_yield: draft.expected_yield ?? null,
    distance_within_row_m: centimetersToMeters(draft.distance_within_row_cm),
    row_spacing_m: centimetersToMeters(draft.row_spacing_cm),
    sowing_depth_m: centimetersToMeters(draft.sowing_depth_cm),
    seed_rate_value: seedRateFallbackFields.seed_rate_value,
    seed_rate_unit: seedRateFallbackFields.seed_rate_unit,
    seed_rate_by_cultivation: seedRateFallbackFields.seed_rate_by_cultivation,
    thousand_kernel_weight_g: draft.thousand_kernel_weight_g ?? null,
    seeding_requirement: draft.seeding_requirement ?? null,
    seeding_requirement_type: normalizeSeedingRequirementType(draft.seeding_requirement_type),
    display_color: draft.display_color ?? '',
    seed_packages: draft.seed_packages ?? [],
  };
}
