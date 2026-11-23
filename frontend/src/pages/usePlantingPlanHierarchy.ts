import { useState, useEffect, useMemo } from 'react';
import { useTheme } from '@mui/material';
import {
  cropAPI,
  locationAPI,
  fieldAPI,
  bedAPI,
  type Crop,
  type Bed,
} from '../api/api';
import type { Field, Location, PlanCultivationType } from '../api/types';
import {
  getAllowedCultivationTypesForCrop,
} from './plantingPlansUtils';
import {
  toNumericValue,
  formatAreaM2,
  buildBedDisplayLabel,
  CROP_COLUMN_MAX_WIDTH,
} from './plantingPlansUtils';
import { resolveLocaleFromLanguage } from '../utils/numberLocalization';
import { collectHierarchyAvailability } from '../components/planting-plans/areaHierarchySelection';
import { BED_PATH_SEPARATOR } from '../components/planting-plans/bedPickerOptions';
import type { SearchableSelectOption } from '../components/data-grid';
import { useTranslation } from '../i18n';
import { formatCropDisplayName } from '../crops/cropDisplay';
import { widthForHeaderTitles } from '../components/data-grid/columnHeaderWidth';

export interface CultivationTypeSelectOption {
  value: PlanCultivationType;
  /** Full label for menus, dialogs, the mobile sheet and tooltips. */
  label: string;
  /** Compact label shown in the plans table cell; may equal `label`. */
  shortLabel: string;
}

// Stable identities so consumers' memos do not see new arrays on every
// render while no project is selected.
const EMPTY_CROPS: Crop[] = [];
const EMPTY_LOCATIONS: Location[] = [];
const EMPTY_FIELDS: Field[] = [];
const EMPTY_BEDS: Bed[] = [];

const CULTIVATION_TYPE_OPTIONS = [
  {
    value: 'direct_sowing',
    labelKey: 'plantingPlans:cultivationTypesLong.directSowing',
    shortLabelKey: 'plantingPlans:cultivationTypes.directSowing',
  },
  {
    value: 'pre_cultivation',
    labelKey: 'plantingPlans:cultivationTypesLong.preCultivation',
    shortLabelKey: 'plantingPlans:cultivationTypes.preCultivation',
  },
  {
    value: 'purchased_transplant',
    labelKey: 'plantingPlans:cultivationTypesLong.purchasedTransplant',
    shortLabelKey: 'plantingPlans:cultivationTypes.purchasedTransplant',
  },
] as const;

// Size dates from their visible table labels; form/export labels stay explicit.
// German and English retain their existing widths.
const DATE_COLUMN_WIDTH_OPTIONS = { baseWidth: 116, allowance: 82, maxWidth: 200 } as const;

const estimateColumnWidth = (values: string[], min: number, max: number): number => {
  const longest = values.reduce((length, value) => Math.max(length, value.length), 0);
  const estimated = longest * 8 + 52;
  return Math.max(min, Math.min(max, estimated));
};

// Spaces and full stops are about half as wide as an average glyph. Counting
// them as such keeps abbreviated short labels ("Pfl. Zukauf") from widening
// the cultivation-type column past the width its longest word-label needs.
const NARROW_CHARACTERS = new Set([' ', '.']);

const countLabelWidthUnits = (label: string): number => (
  Array.from(label).reduce((units, character) => units + (NARROW_CHARACTERS.has(character) ? 0.5 : 1), 0)
);

/**
 * Width of the cultivation-type column: driven by the header and the longest
 * short label of the active language. Long labels only appear in the
 * dropdown menu and tooltips, which may be wider than the column.
 */
export const estimateCultivationTypeColumnWidth = (headerName: string, shortLabels: string[]): number => {
  const longest = [headerName, ...shortLabels].reduce(
    (units, value) => Math.max(units, countLabelWidthUnits(value)),
    0,
  );
  return Math.max(110, Math.min(150, longest * 8 + 52));
};

const estimateDateColumnWidth = (headerName: string): number => (
  widthForHeaderTitles([headerName], DATE_COLUMN_WIDTH_OPTIONS)
);

export function usePlantingPlanHierarchy(shouldShowProjectRequiredState: boolean) {
  const { typography } = useTheme();
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
    () => CULTIVATION_TYPE_OPTIONS.map((option) => ({
      value: option.value,
      label: t(option.labelKey),
      shortLabel: t(option.shortLabelKey),
    })),
    [t],
  );

  const cultivationTypeOptionsByCropId = useMemo(() => {
    const optionsByCropId = new Map<number, CultivationTypeSelectOption[]>();
    crops.forEach((crop) => {
      if (crop.id === undefined) return;
      const allowedTypes = getAllowedCultivationTypesForCrop(crop);
      optionsByCropId.set(
        crop.id,
        cultivationTypeOptions.filter((option) => allowedTypes.includes(option.value)),
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

  const bedColumnLabel = [t('plantingPlans:columns.location'), t('plantingPlans:columns.field'), t('plantingPlans:columns.bed')]
    .join(BED_PATH_SEPARATOR);

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
    // Keep room for the bed name itself, status controls and cell padding.
    // Only the location/field prefix can shrink when the path is longer.
    const measure = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
    if (measure) measure.font = `500 ${typography.fontSize}px ${typography.fontFamily}`;
    const longestBed = beds.reduce((width, bed) => Math.max(width, measure
      ? Math.ceil(measure.measureText(bed.name).width)
      : Array.from(bed.name).length * 15), 0);
    const bedWidth = Math.min(330, Math.max(estimateColumnWidth([bedColumnLabel], 210, 330), longestBed + 102));
    return {
      crop: cropWidth,
      bed: bedWidth,
      cultivationType: estimateCultivationTypeColumnWidth(
        t('plantingPlans:columns.cultivationType'),
        cultivationTypeOptions.map((option) => option.shortLabel),
      ),
      sowingDate: estimateDateColumnWidth(t('plantingPlans:tableHeaders.sowingDate')),
      plantingDate: estimateDateColumnWidth(t('plantingPlans:tableHeaders.plantingDate')),
      harvestDate: estimateDateColumnWidth(t('plantingPlans:tableHeaders.harvestStartDate')),
      harvestEndDate: estimateDateColumnWidth(t('plantingPlans:tableHeaders.harvestEndDate')),
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
  }, [bedColumnLabel, beds, cultivationTypeOptions, cropOptions, numberLocale, t, typography]);

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
    bedColumnLabel,
    getCultivationTypeOptionsForRow,
    dynamicWidths,
  };
}
