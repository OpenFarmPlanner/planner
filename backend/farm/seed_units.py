from __future__ import annotations

from decimal import Decimal


SEED_RATE_UNIT_G_PER_M2 = 'g_per_m2'
SEED_RATE_UNIT_G_PER_LFM = 'g_per_lfm'
SEED_RATE_UNIT_SEEDS_PER_M2 = 'seeds_per_m2'
SEED_RATE_UNIT_SEEDS_PER_LFM = 'seeds_per_lfm'
SEED_RATE_UNIT_SEEDS_PER_PLANT = 'seeds_per_plant'

SEED_RATE_UNITS = {
    SEED_RATE_UNIT_G_PER_M2,
    SEED_RATE_UNIT_G_PER_LFM,
    SEED_RATE_UNIT_SEEDS_PER_M2,
    SEED_RATE_UNIT_SEEDS_PER_LFM,
    SEED_RATE_UNIT_SEEDS_PER_PLANT,
}

SEED_PACKAGE_UNIT_GRAMS = 'g'
SEED_PACKAGE_UNIT_SEEDS = 'seeds'
SEED_PACKAGE_UNITS = {SEED_PACKAGE_UNIT_GRAMS, SEED_PACKAGE_UNIT_SEEDS}


# These are the single source of truth for TKG conversion — the seed demand
# service (farm/services/seed_demand.py, convert_requirement_to_unit) calls
# them rather than reimplementing the formula. See docs/seed-demand-calculation.md.
def seeds_to_grams(seeds: Decimal, thousand_kernel_weight_g: Decimal) -> Decimal:
    """
    Convert seed count to grams using TKG.

    :param seeds: Seed count.
    :param thousand_kernel_weight_g: Thousand-kernel weight in grams.
    :return: Converted grams.
    """
    return (seeds * thousand_kernel_weight_g) / Decimal('1000')


def grams_to_seeds(grams: Decimal, thousand_kernel_weight_g: Decimal) -> Decimal:
    """
    Convert grams to seed count using TKG.

    :param grams: Weight in grams.
    :param thousand_kernel_weight_g: Thousand-kernel weight in grams.
    :return: Converted seed count.
    """
    return (grams / thousand_kernel_weight_g) * Decimal('1000')


def are_units_convertible(source_unit: str, target_unit: str) -> bool:
    """
    Return whether source and target amount units are convertible via TKG.

    :param source_unit: Amount unit of source value.
    :param target_unit: Amount unit of target value.
    :return: True if same unit or grams/seeds conversion.
    """
    if source_unit == target_unit:
        return True
    return {source_unit, target_unit} == {SEED_PACKAGE_UNIT_GRAMS, SEED_PACKAGE_UNIT_SEEDS}
