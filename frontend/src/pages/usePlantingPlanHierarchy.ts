import { useState, useEffect, useMemo } from 'react';
import {
  cropAPI,
  locationAPI,
  fieldAPI,
  bedAPI,
  type Crop,
  type Bed,
} from '../api/api';
import type { Field, Location, CultivationType } from '../api/types';
import {
  getAllowedCultivationTypesForCrop,
} from './plantingPlansUtils';
import {
  toNumericValue,
  formatAreaM2,
  buildAreaColumnHeaderLabel,
  buildBedDisplayLabel,
  AREA_LABEL_SEPARATOR,
  BED_COLUMN_MAX_WIDTH,
  CROP_COLUMN_MAX_WIDTH,
} from './plantingPlansUtils';
import { resolveLocaleFromLanguage } from '../utils/numberLocalization';
import { collectHierarchyAvailability } from '../components/planting-plans/areaHierarchySelection';
import type { SearchableSelectOption } from '../components/data-grid';
import { useTranslation } from '../i18n';
import { formatCropDisplayName } from '../crops/cropDisplay';

export interface CultivationTypeSelectOption {
  value: CultivationType;
  label: string;
}

// Stable identities so consumers' memos do not see new arrays on every
// render while no project is selected.
const EMPTY_CROPS: Crop[] = [];
const EMPTY_LOCATIONS: Location[] = [];
const EMPTY_FIELDS: Field[] = [];
const EMPTY_BEDS: Bed[] = [];

const CULTIVATION_TYPE_OPTIONS = [
  { value: 'direct_sowing', labelKey: 'plantingPlans:cultivationTypes.directSowing' },
  { value: 'pre_cultivation', labelKey: 'plantingPlans:cultivationTypes.preCultivation' },
] as const;

const DATE_COLUMN_WIDTH = 142;

const estimateColumnWidth = (values: string[], min: number, max: number): number => {
  const longest = values.reduce((length, value) => Math.max(length, value.length), 0);
  const estimated = longest * 8 + 52;
  return Math.max(min, Math.min(max, estimated));
};

export function usePlantingPlanHierarchy(shouldShowProjectRequiredState: boolean) {
  const { t } = useTranslation(['plantingPlans', 'common']);
  const { i18n } = useTranslation();
  const numberLocale = resolveLocaleFromLanguage(i18n.language);

  const [loadedCrops, setCrops] = useState<Crop[]>([]);
  const [loadedLocations, setLocations] = useState<Location[]>([]);
  const [loadedFields, setFields] = useState<Field[]>([]);
  const [loadedBeds, setBeds] = useState<Bed[]>([]);
  const [isFetching, setIsHierarchyLoading] = useState(true);

  // Without a project nothing is fetched, so the hook reports an empty,
  // settled result. Derived during render rather than pushed into state from
  // the effect below, which is what react-hooks/set-state-in-effect flags.
  const crops = shouldShowProjectRequiredState ? EMPTY_CROPS : loadedCrops;
  const locations = shouldShowProjectRequiredState ? EMPTY_LOCATIONS : loadedLocations;
  const fields = shouldShowProjectRequiredState ? EMPTY_FIELDS : loadedFields;
  const beds = shouldShowProjectRequiredState ? EMPTY_BEDS : loadedBeds;
  const isHierarchyLoading = shouldShowProjectRequiredState ? false : isFetching;

  useEffect(() => {
    if (shouldShowProjectRequiredState) {
      return;
    }
    const fetchData = async (): Promise<void> => {
      setIsHierarchyLoading(true);
      try {
        const [cropsResponse, locationsResponse, fieldsResponse, bedsResponse] = await Promise.all([
          cropAPI.listAll(),
          locationAPI.listAll(),
          fieldAPI.listAll(),
          bedAPI.listAll(),
        ]);
        setCrops(cropsResponse.results);
        setLocations(locationsResponse.results);
        setFields(fieldsResponse.results);
        setBeds(
          bedsResponse.results.map((bed) => ({
            ...bed,
            area_sqm: toNumericValue(bed.area_sqm) ?? undefined,
          })),
        );
      } catch (err) {
        console.error('Error fetching hierarchy data:', err);
      } finally {
        setIsHierarchyLoading(false);
      }
    };
    fetchData();
  }, [shouldShowProjectRequiredState]);

  const cropOptions: SearchableSelectOption[] = useMemo(
    () =>
      crops
        .filter((c) => c.id !== undefined)
        .map((c) => ({
          value: c.id!,
          label: formatCropDisplayName(c),
        })),
    [crops],
  );

  const locationById = useMemo(
    () => new Map(locations.filter((l) => l.id !== undefined).map((l) => [l.id!, l])),
    [locations],
  );

  const fieldById = useMemo(
    () => new Map(fields.filter((f) => f.id !== undefined).map((f) => [f.id!, f])),
    [fields],
  );

  const bedById = useMemo(
    () => new Map(beds.filter((b) => b.id !== undefined).map((b) => [b.id!, b])),
    [beds],
  );

  const hierarchyAvailability = useMemo(
    () => collectHierarchyAvailability(fields, beds),
    [fields, beds],
  );

  const bedOptions: SearchableSelectOption[] = useMemo(() => {
    const locationIdsWithBeds = new Set<number>();
    beds.forEach((bed) => {
      const field = fieldById.get(bed.field);
      if (field) locationIdsWithBeds.add(field.location);
    });
    const includeLocation = locationIdsWithBeds.size > 1;

    return beds
      .filter((b) => b.id !== undefined)
      .filter((bed) => hierarchyAvailability.fieldIdsWithBeds.has(bed.field))
      .map((b) => {
        const field = fieldById.get(b.field);
        const locationName = field ? locationById.get(field.location)?.name : null;
        const normalizedAreaSqm = toNumericValue(b.area_sqm);
        return {
          value: b.id!,
          label: buildBedDisplayLabel(
            locationName,
            b.field_name ?? field?.name,
            b.name,
            normalizedAreaSqm,
            includeLocation,
            numberLocale,
          ),
        };
      });
  }, [beds, fieldById, hierarchyAvailability.fieldIdsWithBeds, locationById, numberLocale]);

  const bedLabelById = useMemo(
    () => new Map(bedOptions.map((option) => [option.value as number, option.label])),
    [bedOptions],
  );

  const cultivationTypeOptions: CultivationTypeSelectOption[] = useMemo(
    () => CULTIVATION_TYPE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) })),
    [t],
  );

  const cultivationTypeOptionsByCropId = useMemo(() => {
    const optionsByCropId = new Map<number, CultivationTypeSelectOption[]>();
    crops.forEach((crop) => {
      if (crop.id === undefined) return;
      const allowedTypes = getAllowedCultivationTypesForCrop(crop);
      optionsByCropId.set(
        crop.id,
        cultivationTypeOptions.filter((option) => allowedTypes.includes(option.value as CultivationType)),
      );
    });
    return optionsByCropId;
  }, [cultivationTypeOptions, crops]);

  const hasMultipleLocationsWithBeds = useMemo(() => {
    const fieldByIdLocal = new Map(
      fields.filter((item) => item.id !== undefined).map((item) => [item.id as number, item]),
    );
    const locationIdsWithBeds = new Set<number>();
    beds.forEach((bed) => {
      const field = fieldByIdLocal.get(bed.field);
      if (field) locationIdsWithBeds.add(field.location);
    });
    return locationIdsWithBeds.size > 1;
  }, [beds, fields]);

  const fieldBedColumnLabel = useMemo(
    () => t('plantingPlans:columns.fieldBed', { separator: AREA_LABEL_SEPARATOR }),
    [t],
  );

  const areaColumnLabel = useMemo(
    () =>
      buildAreaColumnHeaderLabel(
        hasMultipleLocationsWithBeds,
        t('plantingPlans:columns.location'),
        t('plantingPlans:columns.field'),
        t('plantingPlans:columns.bed'),
      ),
    [hasMultipleLocationsWithBeds, t],
  );

  const getCultivationTypeOptionsForRow = useMemo(
    () =>
      (row: { crop: number | null }): CultivationTypeSelectOption[] =>
        typeof row.crop === 'number'
          ? cultivationTypeOptionsByCropId.get(row.crop) ?? cultivationTypeOptions
          : cultivationTypeOptions,
    [cultivationTypeOptions, cultivationTypeOptionsByCropId],
  );

  const dynamicWidths = useMemo(() => {
    const cropWidth = estimateColumnWidth(
      [t('plantingPlans:columns.crop'), ...cropOptions.map((option) => option.label)],
      170,
      CROP_COLUMN_MAX_WIDTH,
    );
    const hierarchyColumnValues = [
      t('plantingPlans:columns.bed'),
      ...Array.from(new Set(bedOptions.map((option) => option.label))),
    ];
    const bedWidth = estimateColumnWidth(
      hierarchyColumnValues,
      hasMultipleLocationsWithBeds ? 210 : 160,
      hasMultipleLocationsWithBeds ? 380 : BED_COLUMN_MAX_WIDTH,
    );
    return {
      crop: cropWidth,
      bed: bedWidth,
      cultivationType: estimateColumnWidth(
        [t('plantingPlans:columns.cultivationType'), ...cultivationTypeOptions.map((option) => option.label)],
        110,
        150,
      ),
      sowingDate: DATE_COLUMN_WIDTH,
      plantingDate: DATE_COLUMN_WIDTH,
      harvestDate: DATE_COLUMN_WIDTH,
      harvestEndDate: DATE_COLUMN_WIDTH,
      area: estimateColumnWidth(
        [
          t('plantingPlans:columns.areaM2'),
          ...beds
            .filter((bed) => typeof bed.area_sqm === 'number')
            .map((bed) => formatAreaM2(bed.area_sqm as number, numberLocale)),
        ],
        95,
        120,
      ),
      plants: estimateColumnWidth([t('plantingPlans:columns.plantsCount'), '≈ 9999'], 96, 122),
      notes: 220,
    };
  }, [bedOptions, beds, cultivationTypeOptions, cropOptions, hasMultipleLocationsWithBeds, numberLocale, t]);

  return {
    crops,
    locations,
    fields,
    beds,
    isHierarchyLoading,
    numberLocale,
    cropOptions,
    locationById,
    fieldById,
    bedById,
    hierarchyAvailability,
    bedOptions,
    bedLabelById,
    cultivationTypeOptions,
    cultivationTypeOptionsByCropId,
    hasMultipleLocationsWithBeds,
    fieldBedColumnLabel,
    areaColumnLabel,
    getCultivationTypeOptionsForRow,
    dynamicWidths,
  };
}
