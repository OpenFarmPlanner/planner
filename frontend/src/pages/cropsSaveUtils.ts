import type { Crop } from '../api/api';
import type {
  CultivationType,
  CropSupplierData,
  CropSupplierDataInput,
} from '../api/types';
import { isEmptySupplierDataRow } from '../crops/supplierDataRows';
import { buildSeedRateByCultivation } from '../crops/seedRatePayload';
import {
  normalizeCultivationType,
  normalizeHarvestMethod,
  normalizeNutrientDemand,
  normalizeSeedingRequirementType,
  normalizeSeedRateUnit,
} from '../crops/enumNormalization';
import { VARIETY_INHERITABLE_FIELDS } from '../crops/varietyValueSource';
import { arePublicValuesEqual } from '../crop-library/components/publicCropLibrary/formatters';

export type CropSavePayload = Crop & {
  supplier_id: number | null;
  supplier_name?: string;
  supplier?: undefined;
};

const SPECIES_INVARIANT_GENERAL_FIELDS: readonly (keyof Crop)[] = [
  'crop_family',
  'nutrient_demand',
  'rotation_break_years',
];

const ORGANIZATIONAL_GENERAL_FIELDS: readonly (keyof Crop)[] = [
  'display_color',
  'notes',
  'cultivation_type',
  'cultivation_types',
];

type FirstVarietyGeneralCropDraft = Pick<Crop, 'name'> & Partial<Crop>;

export function buildGeneralCropDraftForFirstVariety(
  crop: Crop,
  {
    copyValuesToCrop = false,
  }: { copyValuesToCrop?: boolean } = {},
): FirstVarietyGeneralCropDraft {
  const draft: FirstVarietyGeneralCropDraft = {
    name: crop.name,
    variety: '',
    crop_species: crop.crop_species,
    source_public_crop: crop.source_public_crop,
    source_public_version: crop.source_public_version,
    origin_type: crop.origin_type,
  };
  const fieldsToCopy = [
    ...ORGANIZATIONAL_GENERAL_FIELDS,
    ...SPECIES_INVARIANT_GENERAL_FIELDS,
    ...(copyValuesToCrop ? VARIETY_INHERITABLE_FIELDS : []),
  ];

  fieldsToCopy.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(crop, field)) {
      (draft as Record<keyof Crop, Crop[keyof Crop]>)[field] = crop[field];
    }
  });

  return draft;
}

// Every crop states its own cultivation types; a Sorte never inherits them.
const NON_INHERITED_LIBRARY_FIELDS = new Set<string>(['cultivation_type', 'cultivation_types']);

/**
 * The first Sorte's values without the ones that only repeat the linked
 * library entry: those belong to the general Kultur, and the Sorte keeps
 * inheriting them instead of freezing a copy. Values the user chose to keep
 * as their own stay on the Sorte.
 */
export function omitInheritedLibraryValues(crop: Crop, libraryValues: Partial<Crop> | undefined): Crop {
  if (!libraryValues) return crop;
  const result: Crop = { ...crop };
  Object.entries(libraryValues).forEach(([field, value]) => {
    if (!NON_INHERITED_LIBRARY_FIELDS.has(field) && arePublicValuesEqual(crop[field as keyof Crop], value)) {
      delete (result as Partial<Crop>)[field as keyof Crop];
    }
  });
  return result;
}

const mapSupplierDataRowToInput = (row: CropSupplierData): CropSupplierDataInput => ({
  id: row.id,
  supplier_id: row.supplier_id ?? row.supplier?.id ?? null,
  supplier_name_input: row.supplier_name_input,
  supplier_name: row.supplier_name ?? row.supplier?.name,
  supplier_product_name: row.supplier_product_name,
  supplier_product_url: row.supplier_product_url,
  packaging_sizes: row.packaging_sizes ?? [],
  germination_rate: row.germination_rate ?? null,
  price: row.price ?? null,
  notes: row.notes ?? '',
  source_url: row.source_url ?? '',
});

const isSeedRateCultivationType = (value: unknown): value is CultivationType => (
  value === 'pre_cultivation' || value === 'direct_sowing'
);

export function buildCropSavePayload(crop: Crop): CropSavePayload {
  const supplierPayloadRows: CropSupplierDataInput[] = [];
  if (Array.isArray(crop.supplier_data) && crop.supplier_data.length > 0) {
    supplierPayloadRows.push(
      ...crop.supplier_data
        .filter((row) => !isEmptySupplierDataRow(row))
        .map(mapSupplierDataRowToInput),
    );
  } else if (crop.supplier) {
    supplierPayloadRows.push({
      supplier_id: crop.supplier.id ?? null,
      supplier_name_input: crop.supplier.id ? undefined : crop.supplier.name,
      supplier_name: crop.supplier.name,
      supplier_product_url: crop.supplier_product_url ?? '',
      packaging_sizes: [],
    });
  }

  const cultivationTypes: CultivationType[] = (crop.cultivation_types && crop.cultivation_types.length > 0)
    ? crop.cultivation_types.filter(isSeedRateCultivationType)
    : (crop.cultivation_type
      ? [normalizeCultivationType(crop.cultivation_type)].filter(isSeedRateCultivationType)
      : ['pre_cultivation']);
  const seedRateUnit = normalizeSeedRateUnit(crop.seed_rate_unit) ?? null;
  const seedRateDirectUnit = normalizeSeedRateUnit(crop.seed_rate_direct_unit) ?? null;
  const seedRatePreCultivationUnit = normalizeSeedRateUnit(crop.seed_rate_pre_cultivation_unit) ?? null;
  const seedRateFallbackFields = buildSeedRateByCultivation(
    crop,
    cultivationTypes,
    seedRateUnit,
    seedRateDirectUnit,
    seedRatePreCultivationUnit,
  );

  const payload: CropSavePayload = {
    ...crop,
    seed_packages: undefined,
    seed_rate_unit: seedRateFallbackFields.seed_rate_unit,
    seed_rate_direct_unit: seedRateDirectUnit,
    seed_rate_pre_cultivation_unit: seedRatePreCultivationUnit,
    harvest_method: normalizeHarvestMethod(crop.harvest_method),
    nutrient_demand: normalizeNutrientDemand(crop.nutrient_demand),
    cultivation_type: normalizeCultivationType(crop.cultivation_type),
    cultivation_types: cultivationTypes,
    seed_rate_value: seedRateFallbackFields.seed_rate_value,
    seed_rate_by_cultivation: seedRateFallbackFields.seed_rate_by_cultivation,
    seeding_requirement_type: normalizeSeedingRequirementType(crop.seeding_requirement_type),
    supplier_id: crop.supplier?.id || null,
    supplier_name: crop.supplier && !crop.supplier.id ? crop.supplier.name : undefined,
    supplier_data_input: supplierPayloadRows,
    supplier: undefined,
  };

  delete (payload as unknown as Record<string, unknown>).distance_within_row_m;
  delete (payload as unknown as Record<string, unknown>).row_spacing_m;
  delete (payload as unknown as Record<string, unknown>).sowing_depth_m;

  // Read-only inheritance data: the backend resolves these per response and
  // ignores them on write, so sending them back is pure payload noise.
  delete (payload as unknown as Record<string, unknown>).general_crop;
  delete (payload as unknown as Record<string, unknown>).inherited_fields;
  delete (payload as unknown as Record<string, unknown>).effective_values;

  return payload;
}
