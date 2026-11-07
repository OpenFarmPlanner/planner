import type { Crop, CultivationType, SeedRateByCultivation, SeedRateUnit } from '../api/types';

const isSetSeedRateValue = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

const hasValue = (value: unknown): boolean => value !== null && value !== undefined;

const keepActiveCultivationTypes = (
  seedRates: SeedRateByCultivation | null | undefined,
  cultivationTypes: CultivationType[],
): SeedRateByCultivation | null => {
  if (!seedRates) return null;
  const active = Object.fromEntries(
    Object.entries(seedRates).filter(([type]) => cultivationTypes.includes(type as CultivationType)),
  ) as SeedRateByCultivation;
  return Object.keys(active).length > 0 ? active : null;
};

export const buildSeedRateByCultivation = (
  crop: Crop,
  cultivationTypes: CultivationType[],
  legacyUnit: SeedRateUnit | null,
  directUnit: SeedRateUnit | null,
  preCultivationUnit: SeedRateUnit | null,
): {
  seed_rate_by_cultivation: SeedRateByCultivation | null;
  seed_rate_value: number | null;
  seed_rate_unit: SeedRateUnit | null;
} => {
  const hasMethodSpecificSeedRateInput = (
    hasValue(crop.seed_rate_direct_value)
    || hasValue(crop.seed_rate_direct_unit)
    || hasValue(crop.sowing_calculation_safety_percent_direct)
    || hasValue(crop.seed_rate_pre_cultivation_value)
    || hasValue(crop.seed_rate_pre_cultivation_unit)
    || hasValue(crop.sowing_calculation_safety_percent_pre_cultivation)
  );

  if (!hasMethodSpecificSeedRateInput) {
    return {
      seed_rate_by_cultivation: keepActiveCultivationTypes(crop.seed_rate_by_cultivation, cultivationTypes),
      seed_rate_value: crop.seed_rate_value ?? null,
      seed_rate_unit: legacyUnit,
    };
  }

  const seedRateByCultivation: SeedRateByCultivation = {};

  if (
    cultivationTypes.includes('direct_sowing')
    && isSetSeedRateValue(crop.seed_rate_direct_value)
    && directUnit
  ) {
    seedRateByCultivation.direct_sowing = {
      value: crop.seed_rate_direct_value,
      unit: directUnit,
    };
  }

  if (
    cultivationTypes.includes('pre_cultivation')
    && isSetSeedRateValue(crop.seed_rate_pre_cultivation_value)
    && preCultivationUnit
  ) {
    seedRateByCultivation.pre_cultivation = {
      value: crop.seed_rate_pre_cultivation_value,
      unit: preCultivationUnit,
    };
  }

  const primarySeedRate = seedRateByCultivation.pre_cultivation ?? seedRateByCultivation.direct_sowing ?? null;

  return {
    seed_rate_by_cultivation: Object.keys(seedRateByCultivation).length > 0 ? seedRateByCultivation : null,
    seed_rate_value: primarySeedRate?.value ?? null,
    seed_rate_unit: primarySeedRate?.unit ?? null,
  };
};
