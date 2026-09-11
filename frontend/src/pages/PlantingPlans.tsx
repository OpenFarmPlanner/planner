/**
 * Planting Plans (Anbaupläne) page component.
 *
 * Manages planting schedules with Excel-like editable data grid.
 * UI text is in German, code comments remain in English.
 *
 * @returns The Planting Plans page component
 */

import { useCallback, useState, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { isTypingInEditableElement } from "../hooks/useKeyboardShortcuts";
import { useLocation, useNavigate, useOutletContext, useSearchParams } from "react-router";
import type {
  GridColDef,
  GridRenderCellParams,
  GridRowId,
  GridValueOptionsParams,
} from "@mui/x-data-grid";
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PhotoCameraOutlinedIcon from "@mui/icons-material/PhotoCameraOutlined";
import { useTranslation } from "../i18n";
import {
  normalizeCultivationType,
  toNumericValue,
  formatAreaM2,
  buildBedDisplayLabel,
  getAllowedCultivationTypesForCrop,
  isEmptyNewPlantingPlanRow,
} from "./plantingPlansUtils";
import { usePlantingPlanHierarchy } from "./usePlantingPlanHierarchy";
import { CultivationTypeEditCell } from "./CultivationTypeEditCell";
import PageContainer from "../components/layout/PageContainer";
import PageSurface from "../components/layout/PageSurface";
import { AlertSnackbar } from "../components/feedback/AlertSnackbar";
import {
  plantingPlanAPI,
  type PlantingPlan,
} from "../api/api";
import type { CultivationType } from "../api/types";
import { extractApiErrorMessage } from "../api/errors";
import {
  formatLocalizedNumber,
  parseLocalizedNumber,
} from "../utils/numberLocalization";
import { AreaM2EditCell } from "../components/data-grid/AreaM2EditCell";
import { PlantsCountEditCell } from "../components/data-grid/PlantsCountEditCell";
import {
  EditableDataGrid,
  createSearchableSelectColumn,
  getCalculatedColumnProps,
  type DataGridAPI,
  type EditableDataGridCommandApi,
  copyRowsToClipboard,
  formatClipboardValue,
  getPlainExcerpt,
  toIsoDateString,
  toGridDateValue,
  parseGermanDateText,
  formatDateAsGerman,
  FullCellTooltip,
  FULL_CELL_TOOLTIP_CELL_CLASS,
} from "../components/data-grid";
import { CALCULATED_COLUMN_CELL_CLASS } from "../components/data-grid/calculatedColumns";
import { DateEditCell } from "../components/data-grid/DateEditCell";
import { formatSeasonDate, resolveSeasonDateLocale } from "../seasons/formatSeasonDate";
import type { RootLayoutOutletContext } from "../navigation/topbarTypes";
import { MobileCardList } from "../components/mobile/MobileCardList";
import { NotesDrawer } from "../components/data-grid/NotesDrawer";
import { useNotesEditor } from "../components/data-grid/useNotesEditor";
import ProjectRequiredState from "../components/project/ProjectRequiredState";
import {
  useCommandContextTag,
  useRegisterCommands,
  useRegisterCreateActions,
} from "../commands/useCommandContext";
import type { CommandSpec } from "../commands/types";
import { keywordList } from "../commands/keywordList";
import { useProjectRequirement } from "../hooks/useProjectRequirement";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import {
  getFirstMissingCultivationPlanRequirement,
  getTranslatedProjectSetupAction,
  getTranslatedProjectSetupActions,
} from "./requirementFlow";
import { AreaAssignmentDialog } from "../components/planting-plans/AreaAssignmentDialog";
import EmptyStateCard from "../components/project/EmptyStateCard";
import { formatCropDisplayName } from "../crops/cropDisplay";
import { getEffectiveCropValue } from "../crops/varietyValueSource";

import { useAreaValidationDialog, type AreaValidationDialogState } from "./useAreaValidationDialog";
import { AreaValidationDialog } from "../components/planting-plans/AreaValidationDialog";
import { MobilePlanFormDialog } from "../components/planting-plans/MobilePlanFormDialog";
import { MobilePlanActionsMenu } from "../components/planting-plans/MobilePlanActionsMenu";
import {
  areRowsSemanticallyEqual,
  buildMobileCreateForm,
  createEmptyMobileCreateForm,
  BED_COLUMN_MAX_WIDTH,
  CROP_COLUMN_MAX_WIDTH,
  getVisibleMobileRows,
  isAutoAreaRequest,
  normalizeSelectionAfterBedChange,
  resolveBedCellValue,
  toAreaNumericValue,
  toDateKey,
  toOptionalNumber,
  toOptionalString,
  type MobileCreateFormState,
  type PlantingPlanRow,
} from './plantingPlansUtils';
import { AppTooltip } from '../components/AppTooltip';
import { dataGridHeaderLabelSx } from "../components/data-grid/styles";


/**
 * Row data type for Data Grid
 */

/** Columns whose editor is a dialog the cell opens on a single click. */
const PLANTING_PLAN_DIALOG_EDIT_FIELDS = ["bed"];

function PlantingPlans() {
  const { t, i18n } = useTranslation(["plantingPlans", "common"]);
  const outletContext = useOutletContext<RootLayoutOutletContext | null>();
  const activeSeason = outletContext?.activeSeason ?? null;
  const activeSeasonLoaded = outletContext?.activeSeasonLoaded ?? true;
  const isMissingActiveSeason = Boolean(outletContext) && activeSeasonLoaded && !activeSeason;
  const seasonBounds = useMemo(() => {
    if (!activeSeason) {
      return null;
    }
    const locale = resolveSeasonDateLocale(i18n);
    return {
      minDate: activeSeason.start_date,
      maxDate: activeSeason.end_date,
      startLabel: formatSeasonDate(activeSeason.start_date, locale),
      endLabel: formatSeasonDate(activeSeason.end_date, locale),
    };
  }, [activeSeason, i18n]);
  const isPlantingDateWithinSeason = useCallback(
    (isoDate: string | null | undefined): boolean => {
      if (!seasonBounds || !isoDate) {
        return true;
      }
      return isoDate >= seasonBounds.minDate && isoDate <= seasonBounds.maxDate;
    },
    [seasonBounds],
  );
  const { shouldShowProjectRequiredState, missingProjectReason } = useProjectRequirement();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const isSmallScreen = useMediaQuery(theme.breakpoints.down("lg"));
  const { columnVisibilityModel, setColumnVisibilityModel } = useColumnVisibility({
    tableKey: "plantingPlans",
    defaultHiddenFieldsOnSmallScreen: ["harvest_date", "harvest_end_date"],
    isSmallScreen,
  });
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const {
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
    bedOptions,
    bedLabelById,
    cultivationTypeOptions,
    hasMultipleLocationsWithBeds,
    fieldBedColumnLabel,
    areaColumnLabel,
    getCultivationTypeOptionsForRow,
    dynamicWidths,
  } = usePlantingPlanHierarchy(shouldShowProjectRequiredState);
  const [areaNotice, setAreaNotice] = useState<{
    message: string;
    severity: "info" | "warning";
  } | null>(null);
  const urlParamProcessedRef = useRef<boolean>(false);
  const gridCommandApiRef = useRef<EditableDataGridCommandApi | null>(null);
  const plantingPlanGridAPI = useMemo<DataGridAPI<PlantingPlanRow>>(() => ({
    ...plantingPlanAPI,
    list: async () => {
      const data = await plantingPlanAPI.listAll();
      return { data };
    },
  }) as unknown as DataGridAPI<PlantingPlanRow>, []);
  const [selectedPlan, setSelectedPlan] = useState<PlantingPlanRow | null>(
    null,
  );
  const [mobileRows, setMobileRows] = useState<PlantingPlanRow[]>([]);
  const [isPlansLoading, setIsPlansLoading] = useState(true);
  const [expandedCardIds, setExpandedCardIds] = useState<Set<number | string>>(
    new Set(),
  );
  const [isMobileCreateOpen, setIsMobileCreateOpen] = useState(false);
  const [mobileCreateForm, setMobileCreateForm] = useState<MobileCreateFormState>(
    () => createEmptyMobileCreateForm(),
  );
  const [mobileCreateError, setMobileCreateError] = useState("");
  const [mobileEditId, setMobileEditId] = useState<number | null>(null);
  const [mobileLastEditedField, setMobileLastEditedField] = useState<
    "area_m2" | "plants_count" | null
  >(null);
  const [mobileActionMenuAnchor, setMobileActionMenuAnchor] = useState<HTMLElement | null>(null);
  const [mobileActionMenuRow, setMobileActionMenuRow] = useState<PlantingPlanRow | null>(null);
  const mobilePrefillHandledRef = useRef(false);
  const createIntentHandledRef = useRef(false);
  const planIdParamProcessedRef = useRef(false);
  const openMobileEditDialogRef = useRef<((row: PlantingPlanRow) => void) | null>(null);

  // The mobile card list edits notes through the same drawer the desktop grid
  // uses, so it shares the grid's notes editor rather than repeating its state.
  const mobileNotesEditor = useNotesEditor<PlantingPlanRow>({
    rows: mobileRows,
    onSave: async ({ row, value }) => {
      try {
        await plantingPlanAPI.patch(row.id, { notes: value } as PlantingPlan);
        await gridCommandApiRef.current?.reload();
      } catch (error) {
        throw new Error(extractApiErrorMessage(error, t, t("plantingPlans:errors.save")), { cause: error });
      }
    },
    onError: setMobileCreateError,
  });

  const replacePlantingPlanSearchParams = useCallback((nextParams: URLSearchParams): void => {
    const browserPathname = window.location.pathname;
    if (browserPathname.includes("/app/") && !browserPathname.endsWith(location.pathname)) {
      return;
    }

    const nextSearch = nextParams.toString();
    const currentSearch = location.search.startsWith("?") ? location.search.slice(1) : location.search;
    if (nextSearch === currentSearch) {
      return;
    }

    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
        hash: location.hash,
      },
      { replace: true },
    );
  }, [location.hash, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (isMobile) {
      document.body.classList.add("hide-version-footer");
    } else {
      document.body.classList.remove("hide-version-footer");
    }
    return () => {
      document.body.classList.remove("hide-version-footer");
    };
  }, [isMobile]);

  useCommandContextTag("plans");

  useEffect(() => {
    const handleAltT = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "t" && event.key !== "T") return;
      if (isMobile) return;
      if (isTypingInEditableElement(document.activeElement)) return;
      event.preventDefault();
      gridCommandApiRef.current?.focusTable();
    };
    window.addEventListener("keydown", handleAltT);
    return () => window.removeEventListener("keydown", handleAltT);
  }, [isMobile]);

  // Track which field was last edited (for determining API payload)
  const lastEditedFieldRef = useRef<"area_m2" | "plants_count" | null>(null);
  const {
    areaValidationDialog,
    setAreaValidationDialog,
    areaValidationDialogRef,
    suppressAreaValidationSaveRef,
    clearAreaValidationCloseTimer,
    openAreaValidationDialog,
    closeAreaValidationDialog,
  } = useAreaValidationDialog();

  const getBedLabelForRow = useCallback(
    (row: PlantingPlanRow | null | undefined): string => {
      if (!row) {
        return "—";
      }

      const bedId = resolveBedCellValue(row.bed, row);
      const linkedBed = bedById.get(bedId);
      const linkedField = linkedBed ? fieldById.get(linkedBed.field) : undefined;
      const locationName = linkedField
        ? locationById.get(linkedField.location)?.name
        : toOptionalString(row.location_name);

      if (linkedBed) {
        return buildBedDisplayLabel(
          locationName,
          linkedBed.field_name ?? linkedField?.name ?? toOptionalString(row.field_name),
          linkedBed.name,
          toNumericValue(linkedBed.area_sqm),
          hasMultipleLocationsWithBeds,
          numberLocale,
        );
      }

      return buildBedDisplayLabel(
        toOptionalString(row.location_name),
        toOptionalString(row.field_name),
        toOptionalString(row.bed_name),
        null,
        hasMultipleLocationsWithBeds,
        numberLocale,
      );
    },
    [
      bedById,
      fieldById,
      hasMultipleLocationsWithBeds,
      locationById,
      numberLocale,
    ],
  );

  /**
   * Writes a growing-area selection made in the AreaAssignmentDialog back into
   * the grid. The bed cell has no inline edit mode, so the column's former
   * `valueSetter` side effects (hierarchy sync, area autofill for new rows)
   * live here instead.
   */
  const applyBedSelection = useCallback(
    async (rowId: GridRowId, row: PlantingPlanRow, nextBedId: number): Promise<void> => {
      const selectedBed = bedById.get(nextBedId);
      const shouldAutofillArea = Boolean(row.isNew)
        && (row.area_m2 === undefined || row.area_m2 === null);
      // Only the hierarchy fields the selection actually changes are written
      // back. `normalizeSelectionAfterBedChange` returns a whole row, and
      // handing that to the grid would push every other field of a
      // render-time snapshot back into the row — overwriting newer draft
      // edits, and feeding raw ISO date strings into the edit session of the
      // date columns, which MUI only accepts as `Date` objects.
      const { location_id, field_id, bed } = normalizeSelectionAfterBedChange(
        row,
        nextBedId,
        fields,
        beds,
      );

      await gridCommandApiRef.current?.applyDialogEditValues(rowId, {
        location_id,
        field_id,
        bed,
        ...(shouldAutofillArea && selectedBed?.area_sqm !== undefined
          ? { area_m2: selectedBed.area_sqm }
          : {}),
      });
    },
    [bedById, beds, fields],
  );

  /**
   * Check for cropId or bedId parameter in URL and set as initial values
   */
  const [initialSelection] = useState(() => {
    const cropIdParam = searchParams.get("cropId");
    const bedIdParam = searchParams.get("bedId");
    let cropId: number | null = null;
    let bedId: number | null = null;

    if (cropIdParam) {
      const parsedCropId = parseInt(cropIdParam, 10);
      if (!isNaN(parsedCropId)) {
        cropId = parsedCropId;
      }
    }

    if (bedIdParam) {
      const parsedBedId = parseInt(bedIdParam, 10);
      if (!isNaN(parsedBedId)) {
        bedId = parsedBedId;
      }
    }

    return { cropId, bedId };
  });

  useEffect(() => {
    if (urlParamProcessedRef.current) {
      return;
    }

    const newParams = new URLSearchParams(searchParams);
    let hasChanges = false;

    if (initialSelection.cropId !== null) {
      newParams.delete("cropId");
      hasChanges = true;
    }

    if (initialSelection.bedId !== null) {
      newParams.delete("bedId");
      hasChanges = true;
    }

    if (hasChanges) {
      replacePlantingPlanSearchParams(newParams);
    }

    urlParamProcessedRef.current = true;
  }, [initialSelection, replacePlantingPlanSearchParams, searchParams]);

  /**
   * Define columns for the Data Grid with inline editing
   * Recalculates when crops or beds change to update dropdown options
   */
  const commands = useMemo<CommandSpec[]>(
    () => [
      {
        id: "plans.edit",
        label: t("plantingPlans:commands.edit"),
        group: 'navigation',
        keywords: keywordList(t, "plantingPlans:commands.keywords.edit"),
        shortcutHint: "Alt+E",
        keys: { alt: true, key: "e" },
        contextTags: ["plans"],
        isEnabled: () => selectedPlan !== null,
        action: () => gridCommandApiRef.current?.editSelectedRow(),
      },
      {
        id: "plans.delete",
        label: t("plantingPlans:commands.delete"),
        group: 'navigation',
        keywords: keywordList(t, "plantingPlans:commands.keywords.delete"),
        shortcutHint: "Entf",
        keys: { key: "Delete" },
        contextTags: ["plans"],
        isEnabled: () => selectedPlan !== null,
        action: () => gridCommandApiRef.current?.deleteSelectedRow(),
      },
    ],
    [selectedPlan, t],
  );

  useRegisterCommands("plans-page", commands);

  const formatDateForDisplay = useCallback((value?: string | null): string => {
    if (!value) {
      return "—";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleDateString("de-DE");
  }, []);

  const renderCalculatedHarvestDateCell = useCallback((
    params: GridRenderCellParams<PlantingPlanRow, Date | null>,
  ) => {
    const row = params.row as PlantingPlanRow;
    const value = params.field === "harvest_end_date" ? row.harvest_end_date : row.harvest_date;
    const crop = crops.find((item) => item.id === row.crop);
    // Effective values: a Sorte that inherits its timing from the general
    // Kultur has complete timing, so it must not be reported as missing.
    const hasGrowthDuration = typeof getEffectiveCropValue(crop, "growth_duration_days") === "number";
    const hasHarvestDuration = typeof getEffectiveCropValue(crop, "harvest_duration_days") === "number";
    let missingDurationTooltip = t("plantingPlans:tooltips.missingGrowthDuration");
    if (params.field === "harvest_end_date") {
      if (!hasGrowthDuration && !hasHarvestDuration) {
        missingDurationTooltip = t("plantingPlans:tooltips.missingGrowthAndHarvestDuration");
      } else if (!hasHarvestDuration) {
        missingDurationTooltip = t("plantingPlans:tooltips.missingHarvestDuration");
      }
    }

    if (!value) {
      return (
        <FullCellTooltip title={missingDurationTooltip} cellHasFocus={params.hasFocus}>
          <Box component="span">—</Box>
        </FullCellTooltip>
      );
    }

    return <Box component="span">{formatDateForDisplay(value)}</Box>;
  }, [crops, formatDateForDisplay, t]);

  const columns: GridColDef[] = useMemo(
    () => [
      {
        ...createSearchableSelectColumn<PlantingPlanRow>({
          field: "crop",
          headerName: t("plantingPlans:columns.crop"),
          flex: 0,
          minWidth: dynamicWidths.crop,
          maxWidth: CROP_COLUMN_MAX_WIDTH,
          truncateCellText: true,
          options: cropOptions,
          placeholder: t("plantingPlans:placeholders.selectCrop"),
        }),
        valueSetter: (value, row) => {
          const nextRow = row as PlantingPlanRow;
          const numericValue =
            typeof value === "number" ? value : Number(value);
          const selectedCrop = crops.find(
            (crop) => crop.id === numericValue,
          );
          const availableTypes =
            getAllowedCultivationTypesForCrop(selectedCrop);
          const currentCultivationType = normalizeCultivationType(nextRow.cultivation_type);

          return {
            ...nextRow,
            crop: numericValue,
            cultivation_type: currentCultivationType && availableTypes.includes(currentCultivationType)
              ? currentCultivationType
              : "",
          } as PlantingPlanRow;
        },
      },
      {
        field: "cultivation_type",
        headerName: t("plantingPlans:columns.cultivationType"),
        flex: 0,
        minWidth: dynamicWidths.cultivationType,
        editable: true,
        type: "singleSelect",
        valueOptions: (params: GridValueOptionsParams<PlantingPlanRow>) => {
          const row = params.row as PlantingPlanRow | undefined;
          if (!row) {
            return cultivationTypeOptions;
          }
          return getCultivationTypeOptionsForRow(row);
        },
        valueFormatter: (value) => {
          const stringValue = typeof value === "string" ? value : "";
          const option = cultivationTypeOptions.find(
            (item) => item.value === (stringValue as CultivationType),
          );
          return option?.label ?? "";
        },
        renderCell: (params) => {
          const formattedValue =
            typeof params.formattedValue === "string" ? params.formattedValue : "";
          return formattedValue;
        },
        renderEditCell: (params) => {
          const row = params.row as PlantingPlanRow;
          const options = getCultivationTypeOptionsForRow(row);

          return (
            <CultivationTypeEditCell
              {...params}
              options={options}
              placeholder={t("plantingPlans:placeholders.selectCultivationType")}
            />
          );
        },
        valueSetter: (value, row) => {
          const nextRow = row as PlantingPlanRow;
          const selectedCrop = crops.find(
            (crop) => crop.id === nextRow.crop,
          );
          const allowedTypes =
            getAllowedCultivationTypesForCrop(selectedCrop);
          const nextType = normalizeCultivationType(value);

          return {
            ...row,
            cultivation_type: nextType && allowedTypes.includes(nextType)
              ? nextType
              : "",
          };
        },
        preProcessEditCellProps: (params) => ({
          ...params.props,
          error: !params.props.value,
        }),
      },
      {
        field: "bed",
        headerName: areaColumnLabel,
        flex: 0,
        minWidth: dynamicWidths.bed,
        maxWidth: BED_COLUMN_MAX_WIDTH,
        // The growing area is only ever picked in AreaAssignmentDialog, so the
        // cell skips inline edit mode entirely — see the grid's
        // `dialogEditFields` prop below.
        editable: false,
        type: "singleSelect",
        valueOptions: bedOptions,
        valueFormatter: (_value, row) => getBedLabelForRow(row as PlantingPlanRow),
        sortComparator: (_value1, _value2, cellParams1, cellParams2) => {
          const row1 = cellParams1.api.getRow(cellParams1.id) as PlantingPlanRow | null;
          const row2 = cellParams2.api.getRow(cellParams2.id) as PlantingPlanRow | null;
          return getBedLabelForRow(row1).localeCompare(
            getBedLabelForRow(row2),
            "de",
          );
        },
        renderCell: (params) => {
          const row = params.row as PlantingPlanRow;
          const bedId = resolveBedCellValue(params.value, row);
          const label = getBedLabelForRow(row);
          return (
            <AreaAssignmentDialog
              bedId={bedId || null}
              beds={beds}
              fields={fields}
              locations={locations}
              locale={numberLocale}
              compactLabel={label}
              placeholder={t("plantingPlans:placeholders.selectArea")}
              hasFocus={params.hasFocus}
              rowId={params.id}
              field={params.field}
              memoKey={`${String(params.id)}:${params.field}`}
              onApply={(nextBedId) => applyBedSelection(params.id, row, nextBedId)}
            />
          );
        },
      },
      {
        field: "planting_date",
        headerName: t("plantingPlans:columns.plantingDate"),
        flex: 0,
        minWidth: dynamicWidths.plantingDate,
        width: dynamicWidths.plantingDate,
        maxWidth: dynamicWidths.plantingDate,
        type: "date",
        editable: true,
        valueGetter: (value) => toGridDateValue(value),
        renderEditCell: (params) => (
          <DateEditCell
            {...params}
            minDate={seasonBounds?.minDate}
            maxDate={seasonBounds?.maxDate}
          />
        ),
        preProcessEditCellProps: (params) => {
          const isoValue = toIsoDateString(params.props.value);
          const hasError =
            !params.props.value || !isPlantingDateWithinSeason(isoValue);
          return { ...params.props, error: hasError };
        },
      },
      {
        field: "harvest_date",
        headerName: t("plantingPlans:columns.harvestStartDate"),
        flex: 0,
        minWidth: dynamicWidths.harvestDate,
        width: dynamicWidths.harvestDate,
        maxWidth: dynamicWidths.harvestDate,
        ...getCalculatedColumnProps<PlantingPlanRow>({
          headerName: t("plantingPlans:columns.harvestStartDate"),
          tooltip: t("plantingPlans:tooltips.calculatedHarvestStartDate"),
        }),
        type: "date",
        valueGetter: (value) => toGridDateValue(value),
        cellClassName: (params) => params.value
          ? CALCULATED_COLUMN_CELL_CLASS
          : `${CALCULATED_COLUMN_CELL_CLASS} ${FULL_CELL_TOOLTIP_CELL_CLASS}`,
        renderCell: renderCalculatedHarvestDateCell,
      },
      {
        field: "harvest_end_date",
        headerName: t("plantingPlans:columns.harvestEndDate"),
        flex: 0,
        minWidth: dynamicWidths.harvestEndDate,
        width: dynamicWidths.harvestEndDate,
        maxWidth: dynamicWidths.harvestEndDate,
        ...getCalculatedColumnProps<PlantingPlanRow>({
          headerName: t("plantingPlans:columns.harvestEndDate"),
          tooltip: t("plantingPlans:tooltips.calculatedHarvestEndDate"),
        }),
        type: "date",
        valueGetter: (value) => toGridDateValue(value),
        cellClassName: (params) => params.value
          ? CALCULATED_COLUMN_CELL_CLASS
          : `${CALCULATED_COLUMN_CELL_CLASS} ${FULL_CELL_TOOLTIP_CELL_CLASS}`,
        renderCell: renderCalculatedHarvestDateCell,
      },
      {
        field: "area_m2",
        headerName: t("plantingPlans:columns.areaM2"),
        flex: 0,
        minWidth: dynamicWidths.area,
        width: dynamicWidths.area,
        maxWidth: dynamicWidths.area,
        editable: true,
        renderHeader: () => (
          <AppTooltip
            title={(
              <Box component="span" sx={{ display: "block" }}>
                <Box component="span" sx={{ display: "block", fontWeight: 600 }}>
                  {t("plantingPlans:tooltips.areaInputTitle")}
                </Box>
                <Box component="span" sx={{ display: "block" }}>
                  {t("plantingPlans:tooltips.areaInputDescription")}
                </Box>
              </Box>
            )}
          >
            <Box component="span" sx={dataGridHeaderLabelSx}>
              {t("plantingPlans:columns.areaM2")}
            </Box>
          </AppTooltip>
        ),
        preProcessEditCellProps: (params) => {
          if (params.hasChanged) {
            lastEditedFieldRef.current = "area_m2";
          }
          return params.props;
        },
        renderEditCell: (params) => {
          const row = params.row as PlantingPlanRow;
          const derivedArea = getDerivedAreaFromRow(row);

          return (
            <AreaM2EditCell
              {...params}
              fallbackValue={derivedArea}
              locale={numberLocale}
              maxKeyword={t("plantingPlans:placeholders.maxKeyword")}
              maxPlaceholder={t("plantingPlans:placeholders.maxKeyword")}
              onLastEditedFieldChange={() => {
                lastEditedFieldRef.current = "area_m2";
                setAreaNotice(null);
              }}
            />
          );
        },
        valueFormatter: (value) => {
          const numericValue = Number(value);
          if (!Number.isNaN(numericValue)) {
            return formatAreaM2(numericValue, numberLocale);
          }
          return "";
        },
        headerClassName: "coupled-field-header",
      },
      {
        field: "plants_count",
        headerName: t("plantingPlans:columns.plantsCount"),
        flex: 0,
        minWidth: dynamicWidths.plants,
        editable: true,
        type: "number",
        renderHeader: () => (
          <AppTooltip title={t("plantingPlans:tooltips.plantsFromSpacing")}>
            <Box component="span" sx={dataGridHeaderLabelSx}>
              {t("plantingPlans:columns.plantsCount")}
            </Box>
          </AppTooltip>
        ),
        preProcessEditCellProps: (params) => {
          if (params.hasChanged) {
            lastEditedFieldRef.current = "plants_count";
            setAreaNotice(null);
          }
          return params.props;
        },
        renderEditCell: (params) => (
          <PlantsCountEditCell
            {...params}
            crops={crops}
            placeholder={t("plantingPlans:placeholders.plantsCount")}
            onLastEditedFieldChange={() => {
              lastEditedFieldRef.current = "plants_count";
              setAreaNotice(null);
            }}
          />
        ),
        valueFormatter: (value) => {
          if (typeof value === "number" && !isNaN(value)) {
            return `≈ ${Math.round(value)}`;
          }
          return "—";
        },
        headerClassName: "coupled-field-header",
      },
      {
        field: "notes",
        headerName: t("common:fields.notes"),
        width: 72,
        minWidth: 56,
        maxWidth: 90,
        align: "center",
        headerAlign: "center",
        // Notes field will be overridden by NotesCell in EditableDataGrid
      },
    ],
    [
      applyBedSelection,
      bedLabelById,
      bedOptions,
      beds,
      fields,
      locations,
      cultivationTypeOptions,
      getCultivationTypeOptionsForRow,
      cropOptions,
      crops,
      dynamicWidths,
      getBedLabelForRow,
      renderCalculatedHarvestDateCell,
      areaColumnLabel,
      fieldBedColumnLabel,
      numberLocale,
      seasonBounds,
      isPlantingDateWithinSeason,
      t,
    ],
  );

  const getCropLabel = (row: PlantingPlanRow): string => {
    const linkedCrop = crops.find((crop) => crop.id === row.crop);
    const cropLabel = formatCropDisplayName({
      name: linkedCrop?.name,
      crop_name: row.crop_name,
      crop_display_name: row.crop_display_name ?? linkedCrop?.crop_display_name,
      variety: linkedCrop?.variety,
      crop_variety: row.crop_variety,
    });
    if (cropLabel) {
      return cropLabel;
    }
    const fallback = cropOptions.find((option) => option.value === row.crop);
    return fallback?.label ?? "—";
  };

  const getPlantsPerSqmForCrop = (cropId: string): number | null => {
    const numericCropId = Number(cropId);
    const crop = crops.find((item) => item.id === numericCropId);
    if (!crop || !crop.plants_per_m2 || crop.plants_per_m2 <= 0) {
      return null;
    }
    return crop.plants_per_m2;
  };

  const getDisplayArea = (row: PlantingPlanRow): string => {
    const explicitArea = toNumericValue(row.area_m2);
    if (explicitArea !== null) {
      return formatAreaM2(explicitArea, numberLocale);
    }
    if (typeof row.plants_count === "number") {
      const plantsPerSqm = getPlantsPerSqmForCrop(String(row.crop));
      if (plantsPerSqm) {
        return formatAreaM2(row.plants_count / plantsPerSqm, numberLocale);
      }
    }
    return "—";
  };

  const getCultivationTypeLabel = (row: PlantingPlanRow): string => {
    const option = cultivationTypeOptions.find((item) => item.value === row.cultivation_type);
    return option?.label ?? "";
  };

  const getPlantsCountLabel = (row: PlantingPlanRow): string => (
    typeof row.plants_count === "number" && !Number.isNaN(row.plants_count)
      ? `≈ ${Math.round(row.plants_count)}`
      : "—"
  );

  const clipboardColumns = useMemo(() => [
    {
      field: "crop",
      headerName: t("plantingPlans:columns.crop"),
      getValue: getCropLabel,
    },
    {
      field: "cultivation_type",
      headerName: t("plantingPlans:columns.cultivationType"),
      getValue: getCultivationTypeLabel,
    },
    {
      field: "bed",
      headerName: areaColumnLabel,
      getValue: getBedLabelForRow,
    },
    {
      field: "planting_date",
      headerName: t("plantingPlans:columns.plantingDate"),
      getValue: (row: PlantingPlanRow) => formatDateForDisplay(row.planting_date),
    },
    {
      field: "harvest_date",
      headerName: t("plantingPlans:columns.harvestStartDate"),
      getValue: (row: PlantingPlanRow) => formatDateForDisplay(row.harvest_date),
    },
    {
      field: "harvest_end_date",
      headerName: t("plantingPlans:columns.harvestEndDate"),
      getValue: (row: PlantingPlanRow) => formatDateForDisplay(row.harvest_end_date),
    },
    {
      field: "area_m2",
      headerName: t("plantingPlans:columns.areaM2"),
      getValue: getDisplayArea,
    },
    {
      field: "plants_count",
      headerName: t("plantingPlans:columns.plantsCount"),
      getValue: getPlantsCountLabel,
    },
    {
      field: "notes",
      headerName: t("common:fields.notes"),
      getValue: (row: PlantingPlanRow) => getPlainExcerpt(row.notes ?? "", 120),
    },
  ], [
    areaColumnLabel,
    getBedLabelForRow,
    getCropLabel,
    getCultivationTypeLabel,
    getDisplayArea,
    getPlantsCountLabel,
    formatDateForDisplay,
    t,
  ]);

  const getClipboardRowValues = useCallback((row: PlantingPlanRow): string[] => (
    clipboardColumns.map((column) => (
      column.getValue
        ? column.getValue(row)
        : formatClipboardValue(row[column.field as keyof PlantingPlanRow])
    ))
  ), [clipboardColumns]);

  const copyClipboardRows = useCallback(async (
    rows: readonly string[][],
    successMessage: string,
  ): Promise<void> => {
    await copyRowsToClipboard({
      rows,
      successMessage,
      errorMessage: t("common:messages.copyError"),
      errorLogMessage: "Error copying planting plan data",
    });
  }, [t]);

  const handleCopyPlantingPlan = useCallback((row: PlantingPlanRow): void => {
    void copyClipboardRows(
      [getClipboardRowValues(row)],
      t("plantingPlans:messages.plantingPlanCopied"),
    );
  }, [copyClipboardRows, getClipboardRowValues, t]);

  const formatNumberForInput = (
    value: number,
    options?: Intl.NumberFormatOptions,
  ): string =>
    formatLocalizedNumber(value, numberLocale, {
      useGrouping: false,
      maximumFractionDigits: 6,
      ...options,
    });

  const toggleCardExpanded = (id: string | number): void => {
    setExpandedCardIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const openMobileCreateDialog = useCallback((
    prefill?: { cropId?: number | null; bedId?: number | null },
  ): void => {
    setMobileCreateError("");
    setMobileEditId(null);
    setMobileCreateForm(buildMobileCreateForm(prefill));
    setMobileLastEditedField(null);
    setIsMobileCreateOpen(true);
  }, []);

  const closeMobileCreateDialog = (): void => {
    setIsMobileCreateOpen(false);
    setMobileCreateError("");
    setMobileEditId(null);
    setMobileLastEditedField(null);
  };

  const handleMobileLinkedFieldEdited = (field: "area_m2" | "plants_count"): void => {
    setMobileLastEditedField(field);
    setAreaNotice(null);
  };

  useEffect(() => {
    if (!isMobile || mobilePrefillHandledRef.current) {
      return;
    }
    if (initialSelection.cropId === null && initialSelection.bedId === null) {
      return;
    }
    if (initialSelection.bedId !== null && beds.length === 0) {
      return;
    }
    openMobileCreateDialog({
      cropId: initialSelection.cropId,
      bedId: initialSelection.bedId,
    });
    mobilePrefillHandledRef.current = true;
  }, [isMobile, initialSelection.cropId, initialSelection.bedId, beds.length, openMobileCreateDialog]);

  const openMobileActionMenu = (
    event: ReactMouseEvent<HTMLElement>,
    row: PlantingPlanRow,
  ): void => {
    event.stopPropagation();
    setMobileActionMenuAnchor(event.currentTarget);
    setMobileActionMenuRow(row);
  };

  const closeMobileActionMenu = (): void => {
    setMobileActionMenuAnchor(null);
    setMobileActionMenuRow(null);
  };

  const getDerivedAreaFromRow = (row: PlantingPlanRow): number | null => {
    const explicitArea = toNumericValue(row.area_m2);
    if (explicitArea !== null) {
      return explicitArea;
    }
    if (typeof row.plants_count !== "number") {
      return null;
    }
    const plantsPerSqm = getPlantsPerSqmForCrop(String(row.crop ?? ""));
    if (!plantsPerSqm) {
      return null;
    }
    return Number((row.plants_count / plantsPerSqm).toFixed(2));
  };

  const getRequestedAreaForValidation = (row: PlantingPlanRow): number | null => {
    if (lastEditedFieldRef.current === "plants_count") {
      const plantsCount = toAreaNumericValue(row.plants_count, numberLocale);
      const plantsPerSqm = getPlantsPerSqmForCrop(String(row.crop ?? ""));
      if (plantsCount !== null && plantsPerSqm) {
        return Number((plantsCount / plantsPerSqm).toFixed(2));
      }
    }

    return toAreaNumericValue(row.area_m2, numberLocale);
  };

  const getPlanBedId = (row: PlantingPlanRow): number | null => {
    const rowRecord = row as PlantingPlanRow & {
      bed_id?: unknown;
    };
    const bedValue: unknown = (row as { bed?: unknown }).bed;
    const directBedId = toOptionalNumber(bedValue);
    if (directBedId !== undefined) {
      return directBedId;
    }
    const apiBedId = toOptionalNumber(rowRecord.bed_id);
    if (apiBedId !== undefined) {
      return apiBedId;
    }
    if (
      bedValue &&
      typeof bedValue === "object" &&
      "id" in bedValue
    ) {
      return toOptionalNumber((bedValue as { id?: unknown }).id) ?? null;
    }
    return null;
  };

  const isSamePlanRow = (rowA: PlantingPlanRow, rowB: PlantingPlanRow): boolean =>
    rowA === rowB || (typeof rowA.id === "number" && typeof rowB.id === "number" && rowA.id === rowB.id);

  const datesOverlap = (rowA: PlantingPlanRow, rowB: PlantingPlanRow): boolean => {
    const startA = toDateKey(rowA.planting_date);
    const startB = toDateKey(rowB.planting_date);
    if (startA === null || startB === null) {
      return false;
    }
    const endA = toDateKey(rowA.harvest_end_date) ?? toDateKey(rowA.harvest_date) ?? Number.MAX_SAFE_INTEGER;
    const endB = toDateKey(rowB.harvest_end_date) ?? toDateKey(rowB.harvest_date) ?? Number.MAX_SAFE_INTEGER;
    return startA <= endB && startB <= endA;
  };

  const getCapacityForRow = (row: PlantingPlanRow): {
    bedArea: number;
    occupiedArea: number;
    availableArea: number;
  } | null => {
    const rowBedId = getPlanBedId(row);
    if (rowBedId === null) {
      return null;
    }
    const selectedBed = bedById.get(rowBedId);
    const bedArea = toNumericValue(selectedBed?.area_sqm);
    if (bedArea === null) {
      return null;
    }
    const occupiedArea = mobileRows
      .filter((item) => getPlanBedId(item) === rowBedId && !isSamePlanRow(item, row) && datesOverlap(item, row))
      .reduce((total, item) => total + Math.max(0, toAreaNumericValue(item.area_m2 ?? item.area_usage_sqm, numberLocale) ?? 0), 0);
    return {
      bedArea,
      occupiedArea,
      availableArea: Math.max(0, bedArea - occupiedArea),
    };
  };

  const buildAreaAndPlantsDraft = (
    row: Pick<PlantingPlanRow, "crop" | "plants_count"> | undefined,
    nextArea: number,
    fallbackCropId?: number,
    fallbackPlantsCount?: number | null,
  ): Pick<PlantingPlanRow, "area_m2" | "plants_count"> => {
    const normalizedArea = Number(nextArea.toFixed(2));
    const cropId = row?.crop ?? fallbackCropId;
    const crop = crops.find((item) => item.id === cropId);
    const plantsPerSqm = crop?.plants_per_m2;
    return {
      area_m2: normalizedArea,
      plants_count: plantsPerSqm && plantsPerSqm > 0 ? Math.round(normalizedArea * plantsPerSqm) : row?.plants_count ?? fallbackPlantsCount,
    };
  };

  const buildAvailableAreaDraft = (
    row: PlantingPlanRow,
  ): Pick<PlantingPlanRow, "area_m2" | "plants_count"> | null => {
    const capacity = getCapacityForRow(row);
    if (!capacity || capacity.availableArea <= 0) {
      return null;
    }

    return buildAreaAndPlantsDraft(row, capacity.availableArea);
  };

  const commitAreaValidationDialogValue = async (dialog: AreaValidationDialogState): Promise<void> => {
    const nextArea = dialog.mode === "bedLimit" ? dialog.bedArea : dialog.availableArea;
    const row = mobileRows.find((item) => item.id === dialog.rowId);
    const draftValues = buildAreaAndPlantsDraft(row, nextArea, dialog.cropId, dialog.plantsCount);

    lastEditedFieldRef.current = "area_m2";
    areaValidationDialogRef.current = null;
    clearAreaValidationCloseTimer();
    suppressAreaValidationSaveRef.current = false;

    await gridCommandApiRef.current?.commitDraftValues(dialog.rowId, draftValues);
    setMobileRows((previousRows) => previousRows.map((item) =>
      item.id === dialog.rowId
        ? {
          ...item,
          ...draftValues,
        }
        : item,
    ));
    setAreaValidationDialog(null);
  };

  const validateMobileForm = (): boolean => {
    if (!mobileCreateForm.crop || !mobileCreateForm.bed || !mobileCreateForm.planting_date) {
      setMobileCreateError(t("plantingPlans:validation.requiredFields", {
        fields: [
          t("plantingPlans:columns.crop"),
          t("plantingPlans:columns.bed"),
          t("plantingPlans:columns.plantingDate"),
        ].join(", "),
      }));
      return false;
    }
    if (!parseGermanDateText(mobileCreateForm.planting_date)) {
      setMobileCreateError(t("plantingPlans:validation.plantingDateRequired"));
      return false;
    }
    if (
      seasonBounds &&
      !isPlantingDateWithinSeason(
        toIsoDateString(parseGermanDateText(mobileCreateForm.planting_date)),
      )
    ) {
      setMobileCreateError(
        t("plantingPlans:validation.plantingDateOutsideSeason", {
          start: seasonBounds.startLabel,
          end: seasonBounds.endLabel,
        }),
      );
      return false;
    }
    if (
      mobileCreateForm.area_m2.trim() !== "" &&
      mobileCreateForm.area_m2.trim().toLowerCase() !== t("plantingPlans:placeholders.maxKeyword").toLowerCase() &&
      parseLocalizedNumber(mobileCreateForm.area_m2, numberLocale) === null
    ) {
      setMobileCreateError(t("plantingPlans:errors.save"));
      return false;
    }
    if (
      mobileCreateForm.plants_count.trim() !== "" &&
      parseLocalizedNumber(mobileCreateForm.plants_count, numberLocale) === null
    ) {
      setMobileCreateError(t("plantingPlans:errors.save"));
      return false;
    }
    return true;
  };

  const handleMobileCreate = async (): Promise<void> => {
    if (!validateMobileForm()) {
      return;
    }
    const normalizedMobileArea = mobileCreateForm.area_m2.trim().toLowerCase();
    const maxKeyword = t("plantingPlans:placeholders.maxKeyword").toLowerCase();
    const isMaxAreaKeyword = normalizedMobileArea === maxKeyword;
    const hasAreaInput = mobileCreateForm.area_m2.trim() !== "" && !isMaxAreaKeyword;
    const hasPlantsInput = mobileCreateForm.plants_count.trim() !== "";
    const parsedArea = isMaxAreaKeyword ? null : parseLocalizedNumber(mobileCreateForm.area_m2, numberLocale);
    const parsedPlants = parseLocalizedNumber(mobileCreateForm.plants_count, numberLocale);
    const usePlantsInput =
      mobileLastEditedField === "plants_count" ||
      (!mobileLastEditedField && !hasAreaInput && hasPlantsInput);
    let areaPayload: Partial<PlantingPlan> = {};
    if (hasAreaInput || hasPlantsInput) {
      areaPayload = {
        area_input_value: usePlantsInput
          ? parsedPlants ?? undefined
          : parsedArea ?? undefined,
        area_input_unit: usePlantsInput ? "PLANTS" : "M2",
      };
    }

    const plantingDateIso = toIsoDateString(parseGermanDateText(mobileCreateForm.planting_date)) ?? mobileCreateForm.planting_date;

    try {
      await plantingPlanAPI.create({
        crop: Number(mobileCreateForm.crop),
        bed: Number(mobileCreateForm.bed),
        planting_date: plantingDateIso,
        cultivation_type: mobileCreateForm.cultivation_type,
        notes: mobileCreateForm.notes || "",
        ...areaPayload,
      } as PlantingPlan);
      closeMobileCreateDialog();
      await gridCommandApiRef.current?.reload();
    } catch (error) {
      setMobileCreateError(
        extractApiErrorMessage(error, t, t("plantingPlans:errors.save")),
      );
    }
  };

  const openMobileEditDialog = (row: PlantingPlanRow): void => {
    const derivedArea = getDerivedAreaFromRow(row);
    setMobileCreateError("");
    setMobileEditId(row.id);
    setMobileCreateForm({
      crop: String(row.crop ?? ""),
      bed: String(row.bed ?? ""),
      cultivation_type: (row.cultivation_type as CultivationType) || "",
      planting_date: formatDateAsGerman(row.planting_date),
      area_m2:
        derivedArea !== null
          ? formatNumberForInput(derivedArea, { maximumFractionDigits: 2 })
          : "",
      plants_count:
        typeof row.plants_count === "number"
          ? formatNumberForInput(Math.round(row.plants_count), {
              maximumFractionDigits: 0,
            })
          : "",
      notes: row.notes || "",
    });
    setMobileLastEditedField(null);
    setIsMobileCreateOpen(true);
  };
  // Assigned from an effect rather than during render. The effect is declared
  // before the deep-link effect below, which is the one that reads the ref, so
  // effect ordering still guarantees the callback is in place on first mount.
  useEffect(() => {
    openMobileEditDialogRef.current = openMobileEditDialog;
  });

  // Consumes a `?planId=<id>` deep link (e.g. "Anbauplan öffnen"/"bearbeiten"
  // or a double-click from the Gantt calendar's context menu): opens the
  // existing plan row/card instead of the `bedId`/`cropId` path above,
  // which always prefills a brand-new draft row. An additional `edit=true`
  // also opens it in edit mode straight away.
  useEffect(() => {
    if (planIdParamProcessedRef.current || isPlansLoading) {
      return;
    }

    const planIdParam = searchParams.get("planId");
    if (!planIdParam) {
      return;
    }

    const planId = parseInt(planIdParam, 10);
    const shouldStartEdit = searchParams.get("edit") === "true";
    planIdParamProcessedRef.current = true;

    if (!isNaN(planId)) {
      if (isMobile) {
        const targetRow = mobileRows.find((row) => row.id === planId);
        if (targetRow) {
          setSelectedPlan(targetRow);
          setExpandedCardIds((previous) => new Set(previous).add(planId));
          window.setTimeout(() => {
            document
              .querySelector(`[data-mobile-card-id="${planId}"]`)
              ?.scrollIntoView({ block: "center", behavior: "smooth" });
          }, 0);

          if (shouldStartEdit) {
            openMobileEditDialogRef.current?.(targetRow);
          }
        }
      } else {
        gridCommandApiRef.current?.openRowById(planId, { startEdit: shouldStartEdit });
      }
    }

    const newParams = new URLSearchParams(searchParams);
    newParams.delete("edit");
    newParams.delete("planId");
    replacePlantingPlanSearchParams(newParams);
  }, [isMobile, isPlansLoading, mobileRows, replacePlantingPlanSearchParams, searchParams]);

  const openMobileDuplicateDialog = (row: PlantingPlanRow): void => {
    const derivedArea = getDerivedAreaFromRow(row);
    setMobileCreateError("");
    setMobileEditId(null);
    setMobileCreateForm({
      crop: String(row.crop ?? ""),
      bed: String(row.bed ?? ""),
      cultivation_type: (row.cultivation_type as CultivationType) || "",
      planting_date: formatDateAsGerman(row.planting_date),
      area_m2:
        derivedArea !== null
          ? formatNumberForInput(derivedArea, { maximumFractionDigits: 2 })
          : "",
      plants_count:
        typeof row.plants_count === "number"
          ? formatNumberForInput(Math.round(row.plants_count), {
              maximumFractionDigits: 0,
            })
          : "",
      notes: row.notes || "",
    });
    setMobileLastEditedField(null);
    setIsMobileCreateOpen(true);
  };

  const handleMobileUpdate = async (): Promise<void> => {
    if (!mobileEditId || !validateMobileForm()) {
      return;
    }
    const hasAreaInput = mobileCreateForm.area_m2.trim() !== "";
    const hasPlantsInput = mobileCreateForm.plants_count.trim() !== "";
    const parsedArea = parseLocalizedNumber(mobileCreateForm.area_m2, numberLocale);
    const parsedPlants = parseLocalizedNumber(mobileCreateForm.plants_count, numberLocale);
    const usePlantsInput =
      mobileLastEditedField === "plants_count" ||
      (!mobileLastEditedField && !hasAreaInput && hasPlantsInput);
    let areaPayload: Partial<PlantingPlan> = {};
    if (hasAreaInput || hasPlantsInput) {
      areaPayload = {
        area_input_value: usePlantsInput
          ? parsedPlants ?? undefined
          : parsedArea ?? undefined,
        area_input_unit: usePlantsInput ? "PLANTS" : "M2",
      };
    }

    const updateDateIso = toIsoDateString(parseGermanDateText(mobileCreateForm.planting_date)) ?? mobileCreateForm.planting_date;

    try {
      await plantingPlanAPI.update(mobileEditId, {
        crop: Number(mobileCreateForm.crop),
        bed: Number(mobileCreateForm.bed),
        planting_date: updateDateIso,
        cultivation_type: mobileCreateForm.cultivation_type,
        notes: mobileCreateForm.notes || "",
        ...areaPayload,
      } as PlantingPlan);
      closeMobileCreateDialog();
      await gridCommandApiRef.current?.reload();
    } catch (error) {
      setMobileCreateError(
        extractApiErrorMessage(error, t, t("plantingPlans:errors.save")),
      );
    }
  };
  const hasFields = fields.length > 0;
  const hasCrops = crops.length > 0;
  const hasBeds = beds.length > 0;
  const hasPlans = mobileRows.length > 0;
  const firstMissingRequirement = getFirstMissingCultivationPlanRequirement({
    hasFields,
    hasBeds,
    hasCrops,
  });
  const canCreatePlan = firstMissingRequirement === null && !isMissingActiveSeason;
  const shouldShowNoSeasonState = isMissingActiveSeason;
  const shouldShowPrerequisiteState = !canCreatePlan && !shouldShowNoSeasonState;
  const shouldShowNoPlansState = canCreatePlan && !hasPlans;
  const isInitialLoading = !shouldShowProjectRequiredState && (isHierarchyLoading || (!shouldShowPrerequisiteState && isPlansLoading));
  const prerequisiteActions = firstMissingRequirement
    ? getTranslatedProjectSetupActions(firstMissingRequirement, t)
    : [];
  const createPlanAction = getTranslatedProjectSetupAction("plans", t);

  const handleCreatePlan = useCallback((): void => {
    if (isMissingActiveSeason) {
      return;
    }
    if (isMobile) {
      openMobileCreateDialog();
      return;
    }
    gridCommandApiRef.current?.addRow();
  }, [isMissingActiveSeason, isMobile, openMobileCreateDialog]);

  const createActions = useMemo(() => [
    {
      id: "create-planting-plan",
      label: t("plantingPlans:addButton"),
      shortcut: "Alt+Shift+N",
      disabled: !canCreatePlan || shouldShowProjectRequiredState,
      handler: handleCreatePlan,
    },
  ], [canCreatePlan, handleCreatePlan, shouldShowProjectRequiredState, t]);

  useRegisterCreateActions("plans-page", createActions);

  useEffect(() => {
    if (createIntentHandledRef.current || !canCreatePlan) {
      return;
    }
    if (searchParams.get("create") !== "true") {
      return;
    }

    handleCreatePlan();
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("create");
    replacePlantingPlanSearchParams(nextParams);
    createIntentHandledRef.current = true;
  }, [canCreatePlan, handleCreatePlan, replacePlantingPlanSearchParams, searchParams]);

  if (shouldShowProjectRequiredState && missingProjectReason) {
    return (
      <PageContainer>
        <ProjectRequiredState reason={missingProjectReason} />
      </PageContainer>
    );
  }

  return (
    <PageContainer variant="workspacePage">

      <AlertSnackbar
        open={areaNotice !== null}
        onClose={() => setAreaNotice(null)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        message={areaNotice?.message}
        severity={areaNotice?.severity ?? "info"}
        variant="filled"
      />

      <Box sx={{ width: "100%" }}>
        {isInitialLoading ? (
          <Box
            sx={{
              minHeight: 280,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px dashed",
              borderColor: "surface.surfaceSoftBorder",
              borderRadius: 2,
              bgcolor: "surface.surfaceBackground",
            }}
          >
            <Stack spacing={1.25} sx={{ alignItems: "center", }} >
              <CircularProgress size={24} />
              <Typography variant="body2" color="text.secondary">
                {t('plantingPlans:loadingPlans')}
              </Typography>
            </Stack>
          </Box>
        ) : shouldShowNoSeasonState ? (
          <EmptyStateCard
            title={t("plantingPlans:emptyStates.states.seasons.title")}
            description={t("plantingPlans:emptyStates.states.seasons.description")}
            actions={[
              {
                label: t("plantingPlans:emptyStates.actions.createSeason"),
                onClick: outletContext?.requestSeasonCreation,
              },
            ]}
          />
        ) : shouldShowPrerequisiteState ? (
          <EmptyStateCard
            title={t(`plantingPlans:emptyStates.states.${firstMissingRequirement}.title`)}
            description={t(`plantingPlans:emptyStates.states.${firstMissingRequirement}.description`)}
            actions={prerequisiteActions}
          />
        ) : shouldShowNoPlansState ? (
          <EmptyStateCard
            title={t("plantingPlans:emptyStates.states.plans.title")}
            description={t("plantingPlans:emptyStates.states.plans.description")}
            actions={[{ label: createPlanAction.label, onClick: handleCreatePlan }]}
          />
        ) : null}

        {isMobile && hasPlans ? (
          <Box sx={{ pb: 10 }}>
            <MobileCardList
              items={getVisibleMobileRows(mobileRows)}
              expandedIds={expandedCardIds}
              onToggleExpanded={toggleCardExpanded}
              renderPrimary={(item) => getCropLabel(item)}
              renderSecondary={(item) => `${formatDateForDisplay(item.planting_date)} · ${getBedLabelForRow(item)}`}
              renderHeaderAction={(item) => (
                <AppTooltip title={t("common:actions.actions")}>
                  <IconButton
                    size="small"
                    aria-label={t("plantingPlans:mobile.actionsAria", {
                      plan: getCropLabel(item),
                    })}
                    aria-controls={mobileActionMenuAnchor ? "planting-plan-mobile-actions-menu" : undefined}
                    aria-haspopup="menu"
                    aria-expanded={Boolean(mobileActionMenuAnchor && mobileActionMenuRow?.id === item.id)}
                    onClick={(event) => openMobileActionMenu(event, item)}
                    sx={{ width: 44, height: 44 }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </AppTooltip>
              )}
              renderDetails={(item) => (
                <Stack spacing={0.75}>
                  <Typography variant="body2"><strong>{t("plantingPlans:columns.cultivationType")}:</strong> {t(`plantingPlans:cultivationTypes.${item.cultivation_type === "direct_sowing" ? "directSowing" : "preCultivation"}`)}</Typography>
                  <Typography variant="body2"><strong>{t("plantingPlans:columns.bed")}:</strong> {getBedLabelForRow(item)}</Typography>
                  <Typography variant="body2"><strong>{t("plantingPlans:columns.plantingDate")}:</strong> {formatDateForDisplay(item.planting_date)}</Typography>
                  <Typography variant="body2"><strong>{t("plantingPlans:columns.harvestStartDate")}:</strong> {formatDateForDisplay(item.harvest_date)}</Typography>
                  <Typography variant="body2"><strong>{t("plantingPlans:columns.harvestEndDate")}:</strong> {formatDateForDisplay(item.harvest_end_date)}</Typography>
                  <Typography variant="body2"><strong>{t("plantingPlans:columns.areaM2")}:</strong> {getDisplayArea(item)}</Typography>
                  <Typography variant="body2"><strong>{t("plantingPlans:columns.plantsCount")}:</strong> {typeof item.plants_count === "number" ? `≈ ${Math.round(item.plants_count)}` : "—"}</Typography>
                  <Typography variant="body2"><strong>{t("common:fields.notes")}:</strong> {item.notes?.trim() ? item.notes : "—"}</Typography>
                </Stack>
              )}
              renderActions={(item) => (
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", }} >
                  <Button
                    variant="outlined"
                    startIcon={<PhotoCameraOutlinedIcon />}
                    size="small"
                    onClick={() => mobileNotesEditor.handleOpen(item.id, "notes", { focusAttachments: true })}
                    aria-label={t("plantingPlans:mobile.notesPhotosAria")}
                    sx={{ minWidth: "auto" }}
                  >
                    {t("plantingPlans:mobile.notesPhotos")}
                  </Button>
                </Stack>
              )}
              detailsShowLabel={t("plantingPlans:mobile.showDetails")}
              detailsHideLabel={t("plantingPlans:mobile.hideDetails")}
              emptyState={(
                <Box sx={{ p: 2, border: "1px dashed", borderColor: "divider", borderRadius: 2 }}>
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle1">{t("plantingPlans:mobile.emptyTitle")}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t("plantingPlans:mobile.emptyDescription")}
                    </Typography>
                    <Button variant="contained" onClick={() => openMobileCreateDialog()}>
                      {t("plantingPlans:mobile.emptyCta")}
                    </Button>
                  </Stack>
                </Box>
              )}
            />
            <MobilePlanActionsMenu
              anchorEl={mobileActionMenuAnchor}
              row={mobileActionMenuRow}
              onClose={closeMobileActionMenu}
              onEdit={openMobileEditDialog}
              onDuplicate={openMobileDuplicateDialog}
              onCopy={handleCopyPlantingPlan}
              onDelete={(row) => gridCommandApiRef.current?.deleteRow(row.id)}
            />
          </Box>
        ) : null}

        {!shouldShowPrerequisiteState && <PageSurface
          variant={isMobile ? "fullWorkspace" : "contentFit"}
          sx={isMobile ? { position: 'fixed', top: '-9999px', left: 0, width: '100vw', height: 1, overflow: 'hidden', pointerEvents: 'none', visibility: 'hidden' } : undefined}
        >
          <EditableDataGrid<PlantingPlanRow>
            surfaceSizing={isMobile ? "fullWorkspace" : "contentFit"}
            scrollMode="continuous"
            columns={columns}
            api={plantingPlanGridAPI}
            dialogEditFields={PLANTING_PLAN_DIALOG_EDIT_FIELDS}
            commandApiRef={gridCommandApiRef}
            onSelectedRowChange={setSelectedPlan}
            onRowsStateChange={(rows) => {
              setMobileRows((previousRows) =>
                areRowsSemanticallyEqual(previousRows, rows)
                  ? previousRows
                  : rows,
              );
            }}
            onLoadStateChange={({ loading, dataFetched }) => {
              setIsPlansLoading(loading || !dataFetched);
            }}
            createNewRow={() => ({
              id: -Date.now(),
              crop: 0,
              cultivation_type: "",
              location_id: undefined,
              field_id: undefined,
              bed: 0,
              planting_date: "",
              quantity: undefined,
              area_m2: undefined,
              plants_count: undefined,
              notes: "",
              note_attachment_count: 0,
              isNew: true,
            })}
            isNewRowEmpty={isEmptyNewPlantingPlanRow}
          initialRow={
            !isMobile && (initialSelection.cropId || initialSelection.bedId)
              ? {
                  ...(initialSelection.cropId
                    ? { crop: initialSelection.cropId }
                    : {}),
                  ...(initialSelection.bedId
                    ? { bed: initialSelection.bedId }
                    : {}),
                }
              : undefined
          }
          mapToRow={(plan) => {
            const areaFromApi = toNumericValue(plan.area_usage_sqm);
            const linkedBed = plan.bed ? bedById.get(plan.bed) : undefined;
            const linkedField = linkedBed ? fieldById.get(linkedBed.field) : undefined;
            return {
              ...plan,
              id: plan.id!,
              crop: plan.crop,
              cultivation_type: plan.cultivation_type ?? "",
              crop_name: plan.crop_name || "",
              bed: plan.bed,
              bed_name: plan.bed_name || "",
              field_id: linkedBed?.field,
              location_id: linkedField?.location,
              planting_date: plan.planting_date,
              harvest_date: plan.harvest_date,
              harvest_end_date: plan.harvest_end_date,
              quantity: plan.quantity,
              // Backend field name is area_usage_sqm, map to area_m2 for grid
              area_m2: areaFromApi ?? undefined,
              // plants_count computed by backend serializer
              plants_count: plan.plants_count ?? null,
              notes: plan.notes || "",
              note_attachment_count: plan.note_attachment_count ?? 0,
            };
          }}
          mapToApiData={async (row) => {
            // Bed and planting date may still be unset — the row can be
            // saved as a draft, so send null rather than blocking on them.
            const plantingDate = toIsoDateString(row.planting_date);

            // Ensure crop and bed are numeric IDs, not label strings
            // DataGrid singleSelect can sometimes provide the label instead of value
            let cropId: number | null;
            let bedId: number | null;

            if (typeof row.crop === "number" && row.crop !== 0) {
              cropId = row.crop;
            } else if (row.crop && typeof row.crop !== "number") {
              // If it's a string, it's the label - should not happen but handle gracefully
              console.warn(
                "Crop field contains non-numeric value:",
                row.crop,
              );
              cropId = null;
            } else {
              // Not selected yet — allowed as long as a bed is chosen instead.
              cropId = null;
            }

            if (typeof row.bed === "number" && row.bed !== 0) {
              bedId = row.bed;
            } else if (row.bed && typeof row.bed !== "number") {
              // If it's a string, it's the label - should not happen but handle gracefully
              console.warn("Bed field contains non-numeric value:", row.bed);
              bedId = null;
            } else {
              // Not selected yet — allowed, the row can be saved as a draft.
              bedId = null;
            }

            // Prepare API data object
            const apiData: Partial<PlantingPlanRow> = {
              crop: cropId,
              bed: bedId,
              planting_date: plantingDate,
              quantity: row.quantity,
              notes: row.notes || "",
              cultivation_type: row.cultivation_type ?? "",
            };

            // Determine which field to send based on last edit
            const source = lastEditedFieldRef.current || "area_m2";
            const autoAreaDraft = source === "area_m2" && isAutoAreaRequest(row.area_m2, t("plantingPlans:placeholders.maxKeyword"))
              ? buildAvailableAreaDraft(row)
              : null;
            const areaInputValue = autoAreaDraft?.area_m2 ?? toAreaNumericValue(row.area_m2, numberLocale);
            const plantsInputValue = autoAreaDraft?.plants_count ?? toAreaNumericValue(row.plants_count, numberLocale);

            if (source === "area_m2" && typeof areaInputValue === "number") {
              // Persist direct and automatically applied area values through the same m² payload.
              apiData.area_input_value = areaInputValue;
              apiData.area_input_unit = "M2";
            } else if (
              source === "plants_count" &&
              typeof plantsInputValue === "number"
            ) {
              // User edited plants count - send as PLANTS
              apiData.area_input_value = plantsInputValue;
              apiData.area_input_unit = "PLANTS";
            }

            // Clear last edited field after use
            lastEditedFieldRef.current = null;

            return apiData;
          }}
          validateRow={(row) => {
            // A row can be saved as a draft and completed later, so nothing
            // is strictly required except enough to identify what the row
            // is about: either a crop or a bed. Missing fields stay
            // visible via getRowValidationErrors' per-cell markers below.
            const hasCrop = Boolean(row.crop) && row.crop !== 0;
            const hasBed = Boolean(row.bed) && row.bed !== 0;
            if (!hasCrop && !hasBed) {
              return t("plantingPlans:validation.cropOrBedRequired");
            }

            return null;
          }}
          getRowValidationErrors={(row) => {
            const errors: Record<string, string> = {};
            const plantingDateIso = toIsoDateString(row.planting_date);
            if (!row.planting_date) {
              errors.planting_date = t("plantingPlans:validation.plantingDateRequired");
            } else if (seasonBounds && !isPlantingDateWithinSeason(plantingDateIso)) {
              errors.planting_date = t("plantingPlans:validation.plantingDateOutsideSeason", {
                start: seasonBounds.startLabel,
                end: seasonBounds.endLabel,
              });
            }
            if (!row.crop || row.crop === 0) {
              errors.crop = t("plantingPlans:validation.cropRequired");
            }
            if (!row.bed || row.bed === 0) {
              errors.bed = t("plantingPlans:validation.bedRequired");
            }
            if (!row.cultivation_type) {
              errors.cultivation_type = t("plantingPlans:validation.cultivationTypeRequired");
            }
            return errors;
          }}
          onBeforeSaveRow={(row) => {
            if (areaValidationDialogRef.current || suppressAreaValidationSaveRef.current) {
              return false;
            }
            const capacity = getCapacityForRow(row);
            if (!capacity) {
              return true;
            }
            const maxKeyword = t("plantingPlans:placeholders.maxKeyword");
            if (isAutoAreaRequest(row.area_m2, maxKeyword)) {
              const availableAreaDraft = buildAvailableAreaDraft(row);
              if (availableAreaDraft) {
                setAreaNotice({
                  severity: "info",
                  message: t("plantingPlans:areaValidation.maxAreaApplied", { area: formatAreaM2(capacity.availableArea, numberLocale) }),
                });
                lastEditedFieldRef.current = "area_m2";
                return availableAreaDraft;
              }
              return false;
            }
            const requestedArea = getRequestedAreaForValidation(row);
            if (requestedArea === null) {
              return true;
            }
            const isRemainingAreaLimited = capacity.availableArea < capacity.bedArea;
            if (isRemainingAreaLimited && capacity.availableArea <= 0) {
              openAreaValidationDialog({
                rowId: row.id,
                requestedArea,
                availableArea: capacity.availableArea,
                bedArea: capacity.bedArea,
                occupiedArea: capacity.occupiedArea,
                cropId: row.crop ?? undefined,
                plantsCount: row.plants_count,
                mode: "noRemainingArea",
              });
              return false;
            }
            if (isRemainingAreaLimited && requestedArea > capacity.availableArea) {
              openAreaValidationDialog({
                rowId: row.id,
                requestedArea,
                availableArea: capacity.availableArea,
                bedArea: capacity.bedArea,
                occupiedArea: capacity.occupiedArea,
                cropId: row.crop ?? undefined,
                plantsCount: row.plants_count,
                mode: "remainingLimit",
              });
              return false;
            }
            if (requestedArea > capacity.bedArea) {
              openAreaValidationDialog({
                rowId: row.id,
                requestedArea,
                availableArea: capacity.availableArea,
                bedArea: capacity.bedArea,
                occupiedArea: capacity.occupiedArea,
                cropId: row.crop ?? undefined,
                plantsCount: row.plants_count,
                mode: "bedLimit",
              });
              return false;
            }
            return true;
          }}
          loadErrorMessage={t("plantingPlans:errors.load")}
          saveErrorMessage={t("plantingPlans:errors.save")}
          deleteErrorMessage={t("plantingPlans:errors.delete")}
          deleteConfirmMessage={t("plantingPlans:confirmDelete")}
          deleteUndoOptions={{
                  message: t("plantingPlans:messages.deleted"),
                  snackbarTestId: "planting-plan-delete-snackbar",
          }}
          clipboardColumns={clipboardColumns}
          addButtonLabel={`${t("plantingPlans:addButton")} (Alt+Shift+N)`}
          addButtonText={t("plantingPlans:addButton")}
          showAddAction={false}
          showDeleteAction={false}
          showFooterEditControls={false}
          showRowEditActions={false}
          inlineRowActionField="crop"
          showInlineRowActionMenu
          getRowActions={() => [
            {
              id: "create-planting-plan",
              label: t("plantingPlans:actions.createPlantingPlan"),
              icon: <AddIcon fontSize="small" />,
              color: "primary",
              onClick: () => handleCreatePlan(),
            },
            {
              id: "duplicate",
              label: t("common:actions.duplicate"),
              icon: <ContentCopyIcon fontSize="small" />,
              onClick: (row, helpers) => helpers.duplicate(row),
            },
            {
              id: "delete",
              label: t("common:actions.delete"),
              icon: <DeleteIcon fontSize="small" />,
              color: "error",
              onClick: (row, helpers) => helpers.delete(row.id),
            },
          ]}
          getInlineRowActions={(row, helpers) => [
            {
              id: "delete",
              label: t("common:actions.delete"),
              icon: <DeleteIcon fontSize="small" />,
              color: "error",
              onClick: () => helpers.delete(row.id),
            },
          ]}
          duplicateRow={(row) => ({
            ...row,
                  id: -Date.now(),
                  isNew: true,
            __draft: true,
            note_attachment_count: 0,
          })}
          tableKey="plantingPlans"
          defaultSortModel={[{ field: "planting_date", sort: "asc" }]}
          persistSortInUrl={true}
          columnVisibilityModel={columnVisibilityModel}
          onColumnVisibilityModelChange={setColumnVisibilityModel}
            notes={{
              fields: [
                {
                  field: "notes",
                  labelKey: "common:fields.notes",
                  attachmentNoteIdField: "id",
                  attachmentCountField: "note_attachment_count",
                  compactIndicator: true,
                },
              ],
            }}
          />
        </PageSurface>}

      </Box>

      <MobilePlanFormDialog
        open={isMobileCreateOpen}
        isEdit={mobileEditId !== null}
        form={mobileCreateForm}
        setForm={setMobileCreateForm}
        error={mobileCreateError}
        cropOptions={cropOptions}
        bedOptions={bedOptions}
        cultivationTypeOptions={cultivationTypeOptions}
        numberLocale={numberLocale}
        plantingDateHelperText={
          seasonBounds
            ? t("plantingPlans:hints.plantingDateSeasonRange", {
                start: seasonBounds.startLabel,
                end: seasonBounds.endLabel,
              })
            : undefined
        }
        getPlantsPerSqm={getPlantsPerSqmForCrop}
        onLinkedFieldEdited={handleMobileLinkedFieldEdited}
        onClose={closeMobileCreateDialog}
        onSubmit={() => void (mobileEditId ? handleMobileUpdate() : handleMobileCreate())}
      />
      {areaValidationDialog && (
        <AreaValidationDialog
          dialog={areaValidationDialog}
          numberLocale={numberLocale}
          onClose={closeAreaValidationDialog}
          onCommit={commitAreaValidationDialogValue}
        />
      )}

      <NotesDrawer
        open={mobileNotesEditor.isOpen}
        title={t("common:fields.notes")}
        value={mobileNotesEditor.draft}
        onChange={mobileNotesEditor.setDraft}
        onSave={mobileNotesEditor.handleSave}
        onClose={mobileNotesEditor.handleClose}
        hasUnsavedChanges={Boolean(
          mobileNotesEditor.currentRow
            && mobileNotesEditor.draft !== (mobileNotesEditor.currentRow.notes || ""),
        )}
        loading={mobileNotesEditor.isSaving}
        noteId={mobileNotesEditor.currentRow?.id}
        focusAttachments={mobileNotesEditor.focusAttachments}
        focusRequestId={mobileNotesEditor.focusRequestId}
      />
    </PageContainer>
  );
}

export default PlantingPlans;
