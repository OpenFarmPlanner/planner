import type { Crop, PublicCrop } from '../api/types';
import { normalizeSeedRateUnit } from './enumNormalization';
import { stripCitationMarkers } from '../components/data-grid/markdown';
import { buildDisplayedTimingWindows, buildInheritedValueBaseline } from './varietyValueSource';
import { getCropDisplayName } from './cropDisplay';
import { metersToCentimeters, metersToRoundedCentimeters } from '../utils/measurementConversion';

const EMPTY_CROP: Partial<Crop> = {
  name: '',
  variety: '',
  timing_windows: [],
  crop_family: null,
  seed_type: '',
  nutrient_demand: '',
  cultivation_type: 'pre_cultivation',
  cultivation_types: ['pre_cultivation'],
  notes: '',
  growth_duration_days: undefined,
  harvest_duration_days: undefined,
  propagation_duration_days: undefined,
  germination_temperature_optimal_min_c: null,
  germination_temperature_optimal_max_c: null,
  germination_temperature_min_c: null,
  germination_days_min: null,
  germination_days_max: null,
  germination_temperature_requirement: '',
  germination_light_requirement: '',
  stratification_days_min: null,
  stratification_days_max: null,
  stratification_temperature_min_c: null,
  stratification_temperature_max_c: null,
  germination_types: [],
  germination_pretreatment: '',
  specific_properties: {},
  specific_property_profile: '',
  pests_diseases: '',
  light_requirement: '',
  water_requirement: '',
  life_cycle: '',
  winter_hardiness: '',
  expected_yield: undefined,
  distance_within_row_cm: undefined,
  row_spacing_cm: undefined,
  sowing_depth_cm: undefined,
  sowing_depth_max_cm: undefined,
  display_color: '',
  sowing_calculation_safety_percent: 0,
  sowing_calculation_safety_percent_direct: undefined,
  sowing_calculation_safety_percent_pre_cultivation: undefined,
  thousand_kernel_weight_g: undefined,
  seeding_requirement: undefined,
  seeding_requirement_type: '',
  seed_rate_value: null,
  seed_rate_unit: null,
  seed_rate_by_cultivation: null,
  seed_rate_direct_value: null,
  seed_rate_direct_unit: null,
  seed_rate_pre_cultivation_value: null,
  seed_rate_pre_cultivation_unit: null,
  seed_packages: [],
};

// List fields without an EMPTY_CROP entry (e.g. tags) must stay lists:
// the API rejects an empty string when the user restores inheritance.
export function emptyInheritableValue(field: keyof Crop, inheritedValue: unknown): unknown {
  if (field in EMPTY_CROP) return EMPTY_CROP[field];
  return Array.isArray(inheritedValue) ? [] : '';
}

export const getPublicCropDraftName = (publicCrop: PublicCrop): string => (
  publicCrop.display_name || publicCrop.crop_species_name || publicCrop.name
);

export const buildDraftFromPublicCrop = (publicCrop: PublicCrop): Partial<Crop> => ({
  name: getPublicCropDraftName(publicCrop),
  variety: publicCrop.variety ?? '',
  notes: publicCrop.notes ?? '',
  crop_species: publicCrop.crop_species ?? null,
  source_public_crop: publicCrop.id,
  source_public_version: publicCrop.version,
  origin_type: 'imported',
  is_modified_from_source: false,
  crop_family: publicCrop.crop_family ?? null,
  seed_type: publicCrop.seed_type ?? '',
  nutrient_demand: publicCrop.nutrient_demand ?? '',
  cultivation_type: publicCrop.cultivation_type || 'pre_cultivation',
  cultivation_types: publicCrop.cultivation_types?.length ? publicCrop.cultivation_types : ['pre_cultivation'],
  growth_duration_days: publicCrop.growth_duration_days ?? undefined,
  harvest_duration_days: publicCrop.harvest_duration_days ?? undefined,
  propagation_duration_days: publicCrop.propagation_duration_days ?? undefined,
  germination_temperature_optimal_min_c: publicCrop.germination_temperature_optimal_min_c ?? undefined,
  germination_temperature_optimal_max_c: publicCrop.germination_temperature_optimal_max_c ?? undefined,
  germination_temperature_min_c: publicCrop.germination_temperature_min_c ?? undefined,
  germination_days_min: publicCrop.germination_days_min ?? undefined,
  germination_days_max: publicCrop.germination_days_max ?? undefined,
  germination_temperature_requirement: publicCrop.germination_temperature_requirement ?? '',
  germination_light_requirement: publicCrop.germination_light_requirement ?? '',
  stratification_days_min: publicCrop.stratification_days_min ?? null,
  stratification_days_max: publicCrop.stratification_days_max ?? null,
  stratification_temperature_min_c: publicCrop.stratification_temperature_min_c ?? null,
  stratification_temperature_max_c: publicCrop.stratification_temperature_max_c ?? null,
  germination_types: publicCrop.germination_types ?? [],
  germination_pretreatment: publicCrop.germination_pretreatment ?? '',
  specific_properties: { ...(publicCrop.specific_properties ?? {}) },
  specific_property_profile: publicCrop.specific_property_profile ?? '',
  pests_diseases: publicCrop.pests_diseases ?? '',
  light_requirement: publicCrop.light_requirement ?? '',
  water_requirement: publicCrop.water_requirement ?? '',
  life_cycle: publicCrop.life_cycle ?? '',
  winter_hardiness: publicCrop.winter_hardiness ?? '',
  harvest_method: publicCrop.harvest_method ?? '',
  expected_yield: publicCrop.expected_yield ?? undefined,
  distance_within_row_cm: metersToRoundedCentimeters(publicCrop.distance_within_row_m),
  row_spacing_cm: metersToRoundedCentimeters(publicCrop.row_spacing_m),
  // The only spacing field that takes decimals; rounding it would make a
  // freshly linked crop differ from its entry.
  sowing_depth_cm: metersToCentimeters(publicCrop.sowing_depth_m),
  sowing_depth_max_cm: metersToCentimeters(publicCrop.sowing_depth_max_m),
  seed_rate_value: publicCrop.seed_rate_value ?? null,
  seed_rate_unit: publicCrop.seed_rate_unit ?? null,
  seed_rate_by_cultivation: publicCrop.seed_rate_by_cultivation ?? null,
  seed_rate_direct_value: publicCrop.seed_rate_direct_value ?? null,
  seed_rate_direct_unit: publicCrop.seed_rate_direct_unit ?? null,
  seed_rate_pre_cultivation_value: publicCrop.seed_rate_pre_cultivation_value ?? null,
  seed_rate_pre_cultivation_unit: publicCrop.seed_rate_pre_cultivation_unit ?? null,
  thousand_kernel_weight_g: publicCrop.thousand_kernel_weight_g ?? undefined,
  seeding_requirement: publicCrop.seeding_requirement ?? undefined,
  seeding_requirement_type: publicCrop.seeding_requirement_type ?? '',
  display_color: publicCrop.display_color ?? '',
  seed_packages: publicCrop.seed_packages ?? [],
});

export const buildInitialFormData = (crop?: Crop, initialDraft?: Partial<Crop>): Partial<Crop> => {
  if (!crop) {
    return initialDraft ? { ...EMPTY_CROP, ...initialDraft } : EMPTY_CROP;
  }

  // A Sorte only stores the values it actually overrides. Every other field
  // shows the value the backend resolved from its general Kultur, so the form
  // displays what the Sorte effectively is instead of a row of empty inputs.
  // The merged-in values carry no override styling (they equal the Kultur's
  // own values, see getVarietyOwnValueSource) and are stripped again on save.
  // Timing windows follow the same rule per kind (see buildDisplayedTimingWindows).
  const displayedCrop: Crop = {
    ...crop,
    ...buildInheritedValueBaseline(crop),
    timing_windows: buildDisplayedTimingWindows(crop),
  };

  const normalizedSpacingValues: Partial<Crop> = {
    distance_within_row_cm:
      typeof displayedCrop.distance_within_row_cm === 'number'
        ? Math.round(displayedCrop.distance_within_row_cm)
        : displayedCrop.distance_within_row_cm,
    row_spacing_cm:
      typeof displayedCrop.row_spacing_cm === 'number'
        ? Math.round(displayedCrop.row_spacing_cm)
        : displayedCrop.row_spacing_cm,
  };

  const normalizedSeedRateUnits: Partial<Crop> = {
    seed_rate_unit: normalizeSeedRateUnit(displayedCrop.seed_rate_unit),
    seed_rate_direct_unit: normalizeSeedRateUnit(displayedCrop.seed_rate_direct_unit),
    seed_rate_pre_cultivation_unit: normalizeSeedRateUnit(displayedCrop.seed_rate_pre_cultivation_unit),
  };

  const normalizedNotes = displayedCrop.notes
    ? stripCitationMarkers(displayedCrop.notes)
    : displayedCrop.notes;

  // `crop.name` is free text and never cascades a later crop_species rename
  // (see crop_display.py) — `crop_display_name` is the field that already
  // resolves to the species' current name, and it falls back to `crop.name`
  // itself when there is no linked species, so preferring it here can only
  // correct a stale value, never lose one.
  const normalizedName = getCropDisplayName(displayedCrop);

  if (displayedCrop.supplier || !displayedCrop.seed_supplier) {
    return {
      ...displayedCrop,
      ...normalizedSpacingValues,
      ...normalizedSeedRateUnits,
      notes: normalizedNotes,
      name: normalizedName,
    };
  }

  return {
    ...displayedCrop,
    ...normalizedSpacingValues,
    ...normalizedSeedRateUnits,
    notes: normalizedNotes,
    name: normalizedName,
    supplier: {
      name: displayedCrop.seed_supplier,
      allowed_domains: [],
    },
  };
};
