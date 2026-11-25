/**
 * Planting Plans (Anbaupläne) page component.
 *
 * Manages planting schedules with Excel-like editable data grid.
 * UI text is in German, code comments remain in English.
 *
 * @returns The Planting Plans page component
 */

import { GerminationInfo } from "../components/planting-plans/GerminationInfo";
import { useCallback, useState, useEffect, useId, useMemo, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { isTypingInEditableElement } from "../hooks/useKeyboardShortcuts";
import { useLocation, useNavigate, useOutletContext, useSearchParams } from "react-router";
import type {
  GridCellParams,
  GridColDef,
  GridRenderCellParams,
  GridRenderEditCellParams,
  GridRowId,
  GridSortModel,
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
import NotesIcon from "@mui/icons-material/Notes";
import PhotoCameraOutlinedIcon from "@mui/icons-material/PhotoCameraOutlined";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import GrassOutlinedIcon from "@mui/icons-material/GrassOutlined";
import GridViewOutlinedIcon from "@mui/icons-material/GridViewOutlined";
import { useGridColumnSizing } from "../components/data-grid/useGridColumnSizing";
import { useTranslation } from "../i18n";
import {
  normalizeCultivationType,
  toNumericValue,
  formatAreaM2,
  buildBedDisplayLabel,
  getAllowedCultivationTypesForCrop,
  isEmptyNewPlantingPlanRow,
} from "./plantingPlansUtils";
import { plantingPlanTableHeaderSx } from "./plantingPlanHeaderStyles";
import { usePlantingPlanHierarchy } from "./usePlantingPlanHierarchy";
import { CultivationTypeEditCell } from "./CultivationTypeEditCell";
import PageContainer from "../components/layout/PageContainer";
import PageSurface from "../components/layout/PageSurface";
import { AlertSnackbar } from "../components/feedback/AlertSnackbar";
import {
  plantingPlanAPI,
  type PlantingPlan,
} from "../api/api";
import type { Crop, PlanActualHarvest, PlanCultivationType, SuccessionLimit, TimingWindowFinding } from "../api/types";
import { extractApiErrorMessage, isAreaInputSpacingMissingError } from "../api/errors";
import { formatHarvestQuantity, formatHarvestTotals } from "../harvests/harvestDisplay";
import {
  formatLocalizedNumber,
  formatLocalizedNumberForInput,
  parseLocalizedNumber,
  resolveLocaleFromLanguage,
} from "../utils/numberLocalization";
import { AreaM2EditCell } from "../components/data-grid/AreaM2EditCell";
import { PlantsCountEditCell } from "../components/data-grid/PlantsCountEditCell";
import {
  EditableDataGrid,
  createSearchableSelectColumn,
  type EditableDataGridRowAction,
  type EditableDataGridRowActionHelpers,
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
  stripMarkdown,
  type ExternalRowFilter,
} from "../components/data-grid";
import { getCoupledFieldHeaderClassName } from "../components/data-grid/coupledFieldHeader";
import { DateEditCell } from "../components/data-grid/DateEditCell";
import { GridTooltipScope } from "../components/data-grid/GridTooltipScope";
import { formatCalendarDate, formatSeasonDate, resolveSeasonDateLocale } from "../seasons/formatSeasonDate";
import { usePlantingPlanGridAPI } from "../planting-plans/usePlantingPlanGridAPI";
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
import { PlantingPlanBedCell } from "../components/planting-plans/PlantingPlanBedCell";
import { BED_PATH_SEPARATOR, buildBedPickerResults } from "../components/planting-plans/bedPickerOptions";
import EmptyStateCard from "../components/project/EmptyStateCard";
import { formatCropDisplayName, getCropDisplayName } from "../crops/cropDisplay";
import { usePlantingPlanSearch, type PlantingPlanSearchSnapshot } from "./usePlantingPlanSearch";
import { useCreatedPlanPin, withPinnedRowFirst } from "./useCreatedPlanPin";
import type { PlantingPlanSearchRecordInput } from "./plantingPlanSearch";
import { SearchHighlightContext } from "../search/SearchHighlightContext";
import { SearchHighlightedText } from "../search/SearchHighlightedText";
import { buildMatchExcerpt } from "../search/searchText";
import { PlantingPlanSearchMatchContext } from "../components/planting-plans/search/plantingPlanSearchMatchContext";
import { PlantingPlanCropLabel } from "../components/planting-plans/search/PlantingPlanCropLabel";
import { CarriedOverPlanIndicator } from "../components/planting-plans/CarriedOverPlanIndicator";
import { PlantingPlanSearchToolbar } from "../components/planting-plans/search/PlantingPlanSearchToolbar";
import { PlantingPlanMobileSearchBar } from "../components/planting-plans/search/PlantingPlanMobileSearchBar";
import { PlantingPlanMobileListHeader } from "../components/planting-plans/search/PlantingPlanMobileListHeader";
import { PlantingPlanFilterSheet } from "../components/planting-plans/search/PlantingPlanFilterSheet";
import { PlantingPlanSearchEmptyState } from "../components/planting-plans/search/PlantingPlanSearchEmptyState";
import { getEffectiveCropValue, resolveSpacingEditCropId } from "../crops/varietyValueSource";
import {
  getExplicitPropagationStart,
  getPlanPropagationInfo,
  getPlanSowingSchedule,
  getPlantingDateFromSowingDate,
  PURCHASED_TRANSPLANT,
} from "./planSowingDate";

import { useAreaValidationDialog, type AreaValidationDialogState } from "./useAreaValidationDialog";
import { AreaValidationDialog } from "../components/planting-plans/AreaValidationDialog";
import { MobilePlanFormDialog } from "../components/planting-plans/MobilePlanFormDialog";
import { CropSpacingEditAction } from "../components/planting-plans/CropSpacingEditAction";
import { MobilePlanActionsMenu, type PlanMenuNavigationAction } from "../components/planting-plans/MobilePlanActionsMenu";
import { getEntityDetailPath } from "../components/hierarchy/details/hierarchyDetailRoutes";
import { isPlantingPlanDetailPath, plantingPlanDetailPath, PLANTING_PLANS_PATH } from "../planting-plans/plantingPlanDetailRoutes";
import { individualPlantGraphicPath } from "../planting-plans/individualPlantRoutes";
import {
  ACTUAL_DATE_FIELDS, displayedPlanDate, displayedPlanDates, getPlanColumnDates, PLANTING_PLAN_DATE_COLUMNS,
  getPlanDateReadOnlyReason, type PlantingPlanDateColumn, type PlantingPlanDateComparison,
} from "../planting-plans/plantingPlanActualDates";
import { usePlantingPlanDateMode } from "../planting-plans/usePlantingPlanDateMode";
import { ActualPlanDateCell, DateComparisonTooltipText, PlantingPlanDateModeSelect, RecordedPlanDateCell, type ActualPlanDateDrafts } from "../planting-plans/PlantingPlanDateCells";
import { ReadOnlyRotationWarning, RotationStatusIcon } from "../components/planting-plans/rotation/RotationStatusIcon";
import { CompanionWarningIcon } from "../components/planting-plans/rotation/CompanionCheckAlert";
import { SiteSuitabilityHints } from "../components/planting-plans/rotation/SiteSuitabilityHints";
import { HarvestOverlapDateCell, HarvestOverlapIcon } from "../components/planting-plans/HarvestOverlapInfo";
import { TimingWindowDateCell, TimingWindowIcon } from "../components/planting-plans/TimingWindowInfo";
import { TIMING_WINDOW_KINDS_BY_DATE_FIELD } from "../components/planting-plans/useTimingWindowLines";
import {
  getTableRotationStatus,
  isFlaggedRotationStatus,
} from "../components/planting-plans/rotation/rotationCopy";
import {
  buildRotationKey,
  useRotationAcceptanceDraft,
} from "../components/planting-plans/rotation/useRotationAcceptanceDraft";
import {
  areRowsSemanticallyEqual,
  buildMobileCreateForm,
  clearSupplementalPlannedDates,
  createEmptyMobileCreateForm,
  getPlanOccupancyEndIso,
  getSeasonOccupancyStatus,
  hasEarlyRecordedOccupancy,
  getSupplementalPlannedDates,
  toPlanIsoDate,
  getVisibleMobileRows,
  isAutoAreaRequest,
  normalizeSelectionAfterBedChange,
  resolveBedCellValue,
  toAreaNumericValue,
  toOptionalNumber,
  toOptionalString,
  type MobileCreateFormState,
  type PlantingPlanRow,
  type SeasonOccupancyStatus,
} from './plantingPlansUtils';
import { AppTooltip } from '../components/AppTooltip';
import { TruncatedTextWithTooltip } from "../components/TruncatedTextWithTooltip";
import { dataGridHeaderLabelSx } from "../components/data-grid/dataGridHeaderLabelSx";
import { GridHeaderHelp } from "../components/data-grid/GridHeaderHelp";


/**
 * Row data type for Data Grid
 */

/** Columns whose editor is a dialog the cell opens on a single click. */
const PLANTING_PLAN_DIALOG_EDIT_FIELDS = ["bed"];

/**
 * Hoisted so `useColumnVisibility` gets a referentially stable array: an
 * inline literal here would recreate `defaultHiddenFieldsOnSmallScreen` on
 * every render, which (since that hook's `defaultModel` depends on it)
 * handed back a new `columnVisibilityModel` object every render whenever the
 * user has no saved visibility choice yet. The `columns` useMemo below reads
 * that model to tint/untint coupled headers, so that instability recomputed
 * the entire column array (and the grid's column layout with it) on every
 * render — visible as the header/toolbar jitter this constant fixes.
 */
const DEFAULT_HIDDEN_FIELDS_ON_SMALL_SCREEN = ["harvest_date", "harvest_end_date"];
const DEFAULT_HIDDEN_FIELDS = ["season_status", "actual_harvest", "crop_loss_count"];
const FOCUSABLE_SUMMARY_FIELDS = ["actual_harvest", "crop_loss_count"];
const DEFAULT_PLAN_SORT: GridSortModel = [{ field: "planting_date", sort: "asc" }];
const PLAN_NOTES = {
  fields: [{
    field: "notes",
    labelKey: "common:fields.notes",
    attachmentNoteIdField: "id",
    attachmentCountField: "note_attachment_count",
    compactIndicator: true,
  }],
};

const formatGridDate = (date: Date | null | undefined) => date ? formatCalendarDate(date) : "";

const isCarriedOverPlan = (row: PlantingPlanRow): boolean => Boolean(row.carried_over);
const duplicatePlanRow = (row: PlantingPlanRow): PlantingPlanRow => ({
  ...row,
  ...Object.fromEntries(Object.values(ACTUAL_DATE_FIELDS).map(field => [field, null])),
  id: -Date.now(),
  isNew: true,
  __draft: true,
  note_attachment_count: 0,
});
const DIRECT_PLAN_EDIT_FIELDS = ["crop", "bed", "cultivation_type", "quantity", "notes", "area_m2", "plants_count"] as const;

function createPlanColumnDateReader(cropById: ReadonlyMap<Crop["id"], Crop>) {
  const byRow = new WeakMap<PlantingPlanRow, Partial<Record<PlantingPlanDateColumn, PlantingPlanDateComparison>>>();
  return (row: PlantingPlanRow, field: PlantingPlanDateColumn): PlantingPlanDateComparison => {
    const cached = byRow.get(row);
    if (cached?.[field]) return cached[field];
    const dates = getPlanColumnDates(row, field, cropById.get(row.crop ?? undefined));
    byRow.set(row, { ...cached, [field]: dates });
    return dates;
  };
}

function PlantingPlans({ onOpenDetails, detailOpen = false, detailRevision = 0, restoredView }: {
  onOpenDetails?: (id: number, view: PlantingPlanSearchSnapshot, anchor?: HTMLElement | null) => void;
  detailOpen?: boolean;
  detailRevision?: number;
  restoredView?: PlantingPlanSearchSnapshot;
} = {}) {
  const { t, i18n } = useTranslation(["plantingPlans", "common", "fields"]);
  const { t: tHarvest } = useTranslation("harvests");
  const outletContext = useOutletContext<RootLayoutOutletContext | null>();
  const activeSeason = outletContext?.activeSeason ?? null;
  const activeSeasonId = activeSeason?.id;
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
  const { shouldShowProjectRequiredState, missingProjectReason, activeProjectId, userId } = useProjectRequirement();
  const [dateMode, setDateMode] = usePlantingPlanDateMode(userId);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const isSmallScreen = useMediaQuery(theme.breakpoints.down("lg"));
  const { columnVisibilityModel, setColumnVisibilityModel } = useColumnVisibility({
    tableKey: "plantingPlans",
    defaultHiddenFieldsOnSmallScreen: DEFAULT_HIDDEN_FIELDS_ON_SMALL_SCREEN,
    defaultHiddenFields: DEFAULT_HIDDEN_FIELDS,
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
    bedColumnLabel,
    getCultivationTypeOptionsForRow,
    dynamicWidths,
  } = usePlantingPlanHierarchy(shouldShowProjectRequiredState);
  const cropById = useMemo(() => new Map(crops.map((crop) => [crop.id, crop])), [crops]);
  const bedPickerOptions = useMemo(() => buildBedPickerResults(beds, fields, locations, numberLocale), [beds, fields, locations, numberLocale]);
  const bedPickerOptionsById = useMemo(() => new Map(
    bedPickerOptions.filter((option) => option.kind === "bed").map((option) => [option.id, option]),
  ), [bedPickerOptions]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  // State (not a ref) because it feeds EditableDataGrid's slotProps during
  // render, where reading a ref's `.current` is disallowed.
  const [columnsAnchorEl, setColumnsAnchorEl] = useState<HTMLButtonElement | null>(null);
  const filterSheetId = useId();
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [isColumnsPanelOpen, setIsColumnsPanelOpen] = useState(false);
  const [areaNotice, setAreaNotice] = useState<{
    message: string;
    severity: "info" | "warning";
  } | null>(null);
  const urlParamProcessedRef = useRef<boolean>(false);
  const gridCommandApiRef = useRef<EditableDataGridCommandApi | null>(null);
  const { api: plantingPlanGridAPI, getRowHarvestOverlaps } = usePlantingPlanGridAPI(
    `${userId}:${activeProjectId}:${activeSeasonId}`,
  );
  const getRowTimingWindowFindings = useCallback(
    (row: PlantingPlanRow | undefined): TimingWindowFinding[] | undefined => (
      !row || row.isNew ? undefined : row.timing_window_findings
    ),
    [],
  );
  const hasTimingWindowFinding = useCallback(
    (row: PlantingPlanRow | undefined, field: keyof typeof TIMING_WINDOW_KINDS_BY_DATE_FIELD): boolean => (
      (getRowTimingWindowFindings(row) ?? []).some((finding) => (
        TIMING_WINDOW_KINDS_BY_DATE_FIELD[field].includes(finding.kind)
      ))
    ),
    [getRowTimingWindowFindings],
  );
  const reloadPlans = useCallback(async (): Promise<void> => {
    await gridCommandApiRef.current?.reload();
  }, []);
  const loadedDetailRevision = useRef(detailRevision);
  useEffect(() => {
    if (detailRevision === loadedDetailRevision.current) return;
    loadedDetailRevision.current = detailRevision;
    void reloadPlans();
  }, [detailRevision, reloadPlans]);
  const [selectedPlan, setSelectedPlan] = useState<PlantingPlanRow | null>(
    null,
  );
  const [mobileRows, setMobileRows] = useState<PlantingPlanRow[]>([]);
  const syncGridRows = useCallback((rows: PlantingPlanRow[]) => {
    setMobileRows(previous => areRowsSemanticallyEqual(previous, rows) ? previous : rows);
  }, []);
  const getInlinePlanActions = useCallback((row: PlantingPlanRow): EditableDataGridRowAction<PlantingPlanRow>[] => row.carried_over ? [] : [{
    id: "delete",
    label: t("common:actions.delete"),
    icon: <DeleteIcon fontSize="small" />,
    color: "error",
    onClick: (target, helpers) => helpers.delete(target.id),
  }], [t]);
  const [isPlansLoading, setIsPlansLoading] = useState(true);
  const [expandedCardIds, setExpandedCardIds] = useState<Set<number | string>>(
    new Set(),
  );
  const [isMobileCreateOpen, setIsMobileCreateOpen] = useState(false);
  const [mobileCreateForm, setMobileCreateForm] = useState<MobileCreateFormState>(
    () => createEmptyMobileCreateForm(),
  );
  const [mobileCreateError, setMobileCreateError] = useState("");
  const [mobileCreateErrorAction, setMobileCreateErrorAction] = useState<{ message: string; action: ReactNode } | null>(null);
  const [mobileEditId, setMobileEditId] = useState<number | null>(null);
  const [mobileLastEditedField, setMobileLastEditedField] = useState<
    "area_m2" | "plants_count" | null
  >(null);
  const [mobileActionMenuAnchor, setMobileActionMenuAnchor] = useState<HTMLElement | null>(null);
  const [mobileActionMenuRow, setMobileActionMenuRow] = useState<PlantingPlanRow | null>(null);
  const mobilePrefillHandledRef = useRef(false);
  const {
    resetFromPlan: resetRotationAcceptance,
    getControls: getRotationAcceptanceControls,
    getPayload: getRotationAcceptancePayload,
  } = useRotationAcceptanceDraft();
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
        await reloadPlans();
      } catch (error) {
        throw new Error(extractApiErrorMessage(error, t, t("plantingPlans:errors.save")), { cause: error });
      }
    },
    onError: setMobileCreateError,
  });

  // Desktop grid and mobile dialog share this so both offer the same fix
  // when a plant-count area cannot be derived for lack of crop spacing.
  const getCropSpacingErrorAction = useCallback((error: unknown, cropId: unknown): ReactNode => {
    if (!isAreaInputSpacingMissingError(error)) {
      return null;
    }
    const crop = crops.find((item) => item.id === Number(cropId));
    const targetCropId = crop ? resolveSpacingEditCropId(crop) : undefined;
    return targetCropId ? <CropSpacingEditAction cropId={targetCropId} /> : null;
  }, [crops]);

  const getGridSaveErrorAction = useCallback(
    (error: unknown, row: PlantingPlanRow): ReactNode => getCropSpacingErrorAction(error, row.crop),
    [getCropSpacingErrorAction],
  );

  const showMobileSaveError = (error: unknown): void => {
    const message = extractApiErrorMessage(error, t, t("plantingPlans:errors.save"));
    setMobileCreateError(message);
    setMobileCreateErrorAction({ message, action: getCropSpacingErrorAction(error, mobileCreateForm.crop) });
  };

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
      // The search row sticks under the app bar, so the app bar has to stick too.
      document.body.classList.add("sticky-app-bar");
    } else {
      document.body.classList.remove("hide-version-footer");
      document.body.classList.remove("sticky-app-bar");
    }
    return () => {
      document.body.classList.remove("hide-version-footer");
      document.body.classList.remove("sticky-app-bar");
    };
  }, [isMobile]);

  useCommandContextTag("plans");

  useEffect(() => {
    if (detailOpen) return;
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
  }, [detailOpen, isMobile]);

  // Track which field was last edited (for determining API payload)
  const lastEditedFieldRef = useRef<"area_m2" | "plants_count" | null>(null);
  // Same idea for the Aussaattermin/Pflanztermin pair: only planting_date is
  // persisted, so mapToApiData recomputes it from sowing_date itself rather
  // than trusting the grid's own row assembly for the edited field — MUI's
  // internal row-edit-state replay doesn't reliably keep a derived sibling
  // field in sync when both columns carry their own preProcessEditCellProps
  // (confirmed via trace: the sibling revalidation pass it triggers on every
  // keystroke re-asserts a stale snapshot of the other field's value).
  const lastEditedDateFieldRef = useRef<"sowing_date" | "planting_date" | null>(null);
  // Set for the duration of a programmatic setEditCellValue call that
  // live-carries a coupled partner field (see applyLinkedAreaPlantsValue /
  // applyLinkedDateValue below). setEditCellValue re-runs that field's own
  // preProcessEditCellProps exactly like a real keystroke would, so without
  // this guard the carried-along update would itself look like the user
  // edited the partner and incorrectly steal lastEditedFieldRef /
  // lastEditedDateFieldRef from the field the user actually typed into.
  const linkedPartnerUpdateInProgressRef = useRef(false);
  // Which coupled-field cell currently shows the "just carried along live"
  // highlight (components/data-grid/styles.ts's ofp-cell-linked-highlight).
  // Cleared on every real edit to a coupled field (see the preProcessEditCellProps
  // below) and implicitly hidden once the row leaves edit mode, since the
  // cellClassName checks below also require api.getCellMode === 'edit'.
  const [linkedPartnerHighlight, setLinkedPartnerHighlight] = useState<
    { rowId: GridRowId; field: "sowing_date" | "planting_date" | "area_m2" | "plants_count" } | null
  >(null);
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

  const getBedPath = useCallback((row: PlantingPlanRow) => (
    bedPickerOptionsById.get(resolveBedCellValue(row.bed, row)) ?? {
      locationName: toOptionalString(row.location_name) ?? "",
      fieldName: toOptionalString(row.field_name) ?? "",
      name: toOptionalString(row.bed_name) ?? "",
    }
  ), [bedPickerOptionsById]);

  const getGridBedLabel = useCallback((row: PlantingPlanRow | null | undefined): string => {
    if (!row) return "—";
    const { locationName, fieldName, name } = getBedPath(row);
    return [locationName, fieldName, name].filter(Boolean).join(BED_PATH_SEPARATOR) || "—";
  }, [getBedPath]);

  const applyBedSelection = useCallback(
    async (
      rowId: GridRowId,
      row: PlantingPlanRow,
      nextBedId: number,
      freeAreaSqm: number | null,
    ): Promise<boolean> => {
      const selectedBed = bedById.get(nextBedId);
      const shouldAutofillArea = Boolean(row.isNew)
        && (row.area_m2 === undefined || row.area_m2 === null);
      // A new row takes the area that is still free in its period, so the
      // save check accepts the picked bed; with nothing free,
      // the area stays empty.
      const autofillArea = freeAreaSqm ?? selectedBed?.area_sqm;
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

      return gridCommandApiRef.current?.applyDialogEditValues(rowId, {
        location_id,
        field_id,
        bed,
        // The stored assessment belongs to the saved bed. The save response
        // supplies a new assessment, and a draft has none until it is saved.
        rotation_status: undefined,
        rotation_findings: undefined,
        ...(shouldAutofillArea && autofillArea !== undefined && autofillArea !== null && autofillArea > 0
          ? { area_m2: autofillArea }
          : {}),
      }) ?? false;
    },
    [bedById, beds, fields],
  );

  const saveRotationAcceptance = useCallback(async (id: number, accepted: boolean): Promise<void> => {
    const { data } = await plantingPlanAPI.patch(id, { rotation_conflict_accepted: accepted });
    gridCommandApiRef.current?.applySavedRowValues?.(id, {
      rotation_conflict_accepted: data.rotation_conflict_accepted,
      rotation_conflict_accepted_at: data.rotation_conflict_accepted_at,
      rotation_conflict_accepted_by_user: data.rotation_conflict_accepted_by_user,
      rotation_status: data.rotation_status,
      rotation_findings: data.rotation_findings,
    });
  }, []);

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
    () => detailOpen ? [] : [
      {
        id: "plans.focusSearch",
        label: t("plantingPlans:commands.focusSearch"),
        group: 'navigation',
        keywords: keywordList(t, "plantingPlans:commands.keywords.search"),
        shortcutHint: "/",
        keys: { key: "/" },
        contextTags: ["plans"],
        isEnabled: () => searchInputRef.current !== null,
        action: () => searchInputRef.current?.focus(),
      },
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
    [detailOpen, selectedPlan, t],
  );

  useRegisterCommands("plans-page", commands);

  const formatDateForDisplay = useCallback((value?: string | null): string => {
    if (!value) {
      return "—";
    }
    const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage ?? i18n.language);
    return formatSeasonDate(value, locale);
  }, [i18n.language, i18n.resolvedLanguage]);

  const getRowSowingSchedule = useCallback(
    (row: PlantingPlanRow) => getPlanSowingSchedule(row, cropById.get(row.crop ?? undefined)),
    [cropById],
  );

  const getColumnDates = useMemo(() => createPlanColumnDateReader(cropById), [cropById]);
  const displayDateMode = isMobile ? 'planned' : dateMode;
  // A date-mode change can move a row out of the grid's rendered window or
  // replace its cell renderer while a planned row draft is open.
  const actualDateDraftState = useMemo<{ key: string; drafts: ActualPlanDateDrafts }>(() => ({
    key: `${userId}:${activeProjectId}:${activeSeasonId}`,
    drafts: new Map(),
  }), [userId, activeProjectId, activeSeasonId]);
  const getDisplayedDate = useCallback((row: PlantingPlanRow, field: PlantingPlanDateColumn) => (
    displayedPlanDate(getColumnDates(row, field), displayDateMode)
  ), [displayDateMode, getColumnDates]);
  const dateSortProjection = useMemo(() => ({
    mode: displayDateMode,
    getValue: (row: PlantingPlanRow, field: string) => PLANTING_PLAN_DATE_COLUMNS.includes(field as PlantingPlanDateColumn)
      ? getDisplayedDate(row, field as PlantingPlanDateColumn) : row[field],
  }), [displayDateMode, getDisplayedDate]);

  const applySavedActualDates = useCallback((id: number, dates: Partial<PlantingPlan>) => {
    gridCommandApiRef.current?.applySavedRowValues?.(id, dates);
  }, []);
  const saveActualDate = useCallback(async (id: number, dates: PlantingPlanDateComparison, value: string | null) => {
    const { activity, occurrenceYear } = dates;
    if (occurrenceYear !== undefined && activeSeasonId) {
      const field = activity === 'harvestStart' ? 'start_date' : 'end_date';
      const { data } = await plantingPlanAPI.saveHarvestActualDates(id, activeSeasonId, {
        year: occurrenceYear, [field]: value,
      });
      applySavedActualDates(id, data);
      if (data.harvest_actual_occurrences?.length === 0) await reloadPlans();
      return;
    }
    const field = ACTUAL_DATE_FIELDS[activity];
    const { data } = await plantingPlanGridAPI.patch(id, { [field]: value });
    applySavedActualDates(id, {
      [field]: data[field], seasonal_harvest: data.seasonal_harvest,
      harvest_actual_occurrences: data.harvest_actual_occurrences,
    });
  }, [activeSeasonId, applySavedActualDates, plantingPlanGridAPI, reloadPlans]);

  const getDateReadOnlyReason = useCallback((row: PlantingPlanRow, field: string) => {
    if (!PLANTING_PLAN_DATE_COLUMNS.includes(field as PlantingPlanDateColumn)) return undefined;
    const crop = cropById.get(row.crop ?? undefined);
    const reason = getPlanDateReadOnlyReason(row, field as PlantingPlanDateColumn, displayDateMode, Boolean(activeSeasonId), crop);
    if (reason === null) return null;
    if (reason === 'noOwnPropagation' || reason === 'missingPropagationDuration') {
      return t(`plantingPlans:tooltips.${reason}`);
    }
    return t(`plantingPlans:actualDates.readOnlyReasons.${reason}`);
  }, [activeSeasonId, cropById, displayDateMode, t]);
  const isActualDateEditor = useCallback((row: PlantingPlanRow, field: string) =>
    displayDateMode !== 'planned' && !row.isNew && getDateReadOnlyReason(row, field) === null,
  [displayDateMode, getDateReadOnlyReason]);

  const renderDateCell = useCallback((params: GridRenderCellParams<PlantingPlanRow>, renderPlanned: (comparison: ReactNode, row: PlantingPlanRow) => ReactNode) => {
    const field = params.field as PlantingPlanDateColumn;
    const getCurrentRow = () => params.api?.getRowMode?.(params.id) === 'edit'
      ? params.api.getRowWithUpdatedValues(params.id, field) as PlantingPlanRow : params.row;
    const row = getCurrentRow();
    const dates = getColumnDates(row, field);
    const readOnlyReason = getDateReadOnlyReason(row, field);
    const editable = isActualDateEditor(row, field);
    const comparison = editable || dates.actual || readOnlyReason ? <DateComparisonTooltipText dates={dates}
      editMode={editable ? 'actual' : !readOnlyReason && params.isEditable ? 'planned' : undefined}
      readOnlyReason={readOnlyReason} /> : null;
    const cell = displayDateMode === 'actual' || (displayDateMode === 'combined' && dates.actual)
      ? <RecordedPlanDateCell dates={dates} hasFocus={params.hasFocus} editable={editable} readOnlyReason={readOnlyReason} />
      : renderPlanned(comparison, row);
    return editable ? <ActualPlanDateCell key={actualDateDraftState.key}
      params={params} drafts={actualDateDraftState.drafts}
      getEditDates={() => getColumnDates(getCurrentRow(), field)}
      onSaveActual={(editedDates, value) => saveActualDate(params.row.id, editedDates, value)}>{cell}</ActualPlanDateCell> : cell;
  }, [actualDateDraftState, displayDateMode, getColumnDates, getDateReadOnlyReason, isActualDateEditor, saveActualDate]);

  const plannedDateLabel = useCallback((row: PlantingPlanRow, field: PlantingPlanDateColumn) => {
    const { activity } = getColumnDates(row, field);
    return `${t('plantingPlans:actualDates.modes.planned')} ${t(`plantingPlans:actualDates.activities.${activity}`)}`;
  }, [getColumnDates, t]);

  const renderCalculatedHarvestDateCell = useCallback((
    params: GridRenderCellParams<PlantingPlanRow, Date | null>,
  ) => renderDateCell(params, comparison => {
    const row = params.row as PlantingPlanRow;
    const dates = getColumnDates(row, params.field as PlantingPlanDateColumn);
    if (dates.plannedDates) {
      const labels = dates.plannedDates.map(formatDateForDisplay);
      const content = <span><SearchHighlightedText text={labels[0] ?? '—'} /></span>;
      return comparison || labels.length > 1
        ? <FullCellTooltip describeChild touchPreview={Boolean(comparison)} title={comparison ?? labels.join(' · ')} cellHasFocus={params.hasFocus}>{content}</FullCellTooltip>
        : content;
    }
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
        <FullCellTooltip describeChild touchPreview={Boolean(comparison)} title={<>{comparison}{missingDurationTooltip}</>} cellHasFocus={params.hasFocus}>
          <Box component="span">—</Box>
        </FullCellTooltip>
      );
    }

    const overlaps = params.field === "harvest_end_date" ? getRowHarvestOverlaps(row) : null;
    return (
      <HarvestOverlapDateCell overlaps={overlaps} cellHasFocus={params.hasFocus} tooltipContent={comparison}>
        <SearchHighlightedText text={formatDateForDisplay(value)} />
      </HarvestOverlapDateCell>
    );
  }), [crops, formatDateForDisplay, getColumnDates, getRowHarvestOverlaps, renderDateCell, t]);

  // Read as primitive booleans, not the `columnVisibilityModel` object
  // itself, in the columns useMemo's dependency array below: the model's
  // reference can change without these actual flags changing (see
  // DEFAULT_HIDDEN_FIELDS_ON_SMALL_SCREEN's comment), and depending on the
  // object directly would recompute every column on every render.
  const isSowingDatePartnerVisible = columnVisibilityModel.planting_date !== false;
  const isPlantingDatePartnerVisible = columnVisibilityModel.sowing_date !== false;
  const isAreaPartnerVisible = columnVisibilityModel.plants_count !== false;
  const isPlantsPartnerVisible = columnVisibilityModel.area_m2 !== false;

  const columns: GridColDef[] = useMemo(() => {
    const formatPlannedGridDate = (params: GridRenderCellParams<PlantingPlanRow>, row: PlantingPlanRow) => {
      const value = row === params.row
        ? params.formattedValue
        : params.api?.getRowFormattedValue?.(row, params.colDef) ?? params.formattedValue;
      return typeof value === "string" ? value : "";
    };
    const renderSowingDate = (params: GridRenderCellParams<PlantingPlanRow>) => renderDateCell(params, (comparison, row) => {
      const schedule = getRowSowingSchedule(row);
      if (!schedule?.sowingDate) {
        const tooltip = schedule?.isPurchasedTransplant
          ? t("plantingPlans:tooltips.noOwnPropagation")
          : t("plantingPlans:tooltips.missingPropagationDuration");
        return (
          <FullCellTooltip describeChild touchPreview={Boolean(comparison)} title={comparison ?? tooltip} cellHasFocus={params.hasFocus}>
            <Box component="span">—</Box>
          </FullCellTooltip>
        );
      }
      return (
        <TimingWindowDateCell
          findings={getRowTimingWindowFindings(row)}
          kinds={TIMING_WINDOW_KINDS_BY_DATE_FIELD.sowing_date}
          tooltipContent={comparison}
          germinationFindings={row.germination_findings}
          cellHasFocus={params.hasFocus}
        >
          <SearchHighlightedText text={formatPlannedGridDate(params, row)} />
        </TimingWindowDateCell>
      );
    });
    const renderPlantingDate = (params: GridRenderCellParams<PlantingPlanRow>) => renderDateCell(params, (comparison, row) => (
      <TimingWindowDateCell
        findings={getRowTimingWindowFindings(row)}
        kinds={TIMING_WINDOW_KINDS_BY_DATE_FIELD.planting_date}
        tooltipContent={comparison}
        cellHasFocus={params.hasFocus}
      >
        <SearchHighlightedText text={formatPlannedGridDate(params, row)} />
      </TimingWindowDateCell>
    ));

    return [
      {
        ...createSearchableSelectColumn<PlantingPlanRow>({
          field: "crop",
          headerName: t("plantingPlans:columns.crop"),
          flex: 0,
          minWidth: 128,
          truncateCellText: true,
          options: cropOptions,
          placeholder: t("plantingPlans:placeholders.selectCrop"),
        }),
        width: dynamicWidths.crop,
        hideable: false,
        renderCell: (params) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            <PlantingPlanCropLabel planId={Number(params.id)} text={String(params.formattedValue ?? "")} truncate />
            {params.row.carried_over && (
              <CarriedOverPlanIndicator
                season={params.row.origin_season_label}
                early={hasEarlyRecordedOccupancy(params.row)}
                tabIndex={params.hasFocus ? 0 : -1}
                compact
              />
            )}
          </Box>
        ),
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
            ...(numericValue !== nextRow.crop ? clearSupplementalPlannedDates : {}),
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
        minWidth: 88,
        width: dynamicWidths.cultivationType,
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
          const option = cultivationTypeOptions.find((item) => item.value === value);
          return option?.shortLabel ?? "";
        },
        cellClassName: (params) => {
          const option = cultivationTypeOptions.find((item) => item.value === params.value);
          return option && option.shortLabel !== option.label ? FULL_CELL_TOOLTIP_CELL_CLASS : "";
        },
        renderCell: (params) => {
          const formattedValue =
            typeof params.formattedValue === "string" ? params.formattedValue : "";
          const option = cultivationTypeOptions.find((item) => item.value === params.value);
          if (option && option.shortLabel !== option.label) {
            return (
              <FullCellTooltip title={option.label} cellHasFocus={params.hasFocus}>
                <Box component="span"><SearchHighlightedText text={formattedValue} /></Box>
              </FullCellTooltip>
            );
          }
          return <SearchHighlightedText text={formattedValue} />;
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
          const acceptedType = nextType && allowedTypes.includes(nextType) ? nextType : "";

          return {
            ...row,
            ...(acceptedType !== nextRow.cultivation_type ? clearSupplementalPlannedDates : {}),
            cultivation_type: acceptedType,
          };
        },
        preProcessEditCellProps: (params) => ({
          ...params.props,
          error: !params.props.value,
        }),
      },
      {
        field: "bed",
        headerName: bedColumnLabel,
        flex: 0,
        minWidth: 152,
        width: dynamicWidths.bed,
        // The inline picker owns its edit lifecycle within the view cell.
        editable: false,
        type: "singleSelect",
        valueOptions: bedOptions,
        valueFormatter: (_value, row) => getGridBedLabel(row as PlantingPlanRow),
        sortComparator: (_value1, _value2, cellParams1, cellParams2) => {
          const row1 = cellParams1.api.getRow(cellParams1.id) as PlantingPlanRow | null;
          const row2 = cellParams2.api.getRow(cellParams2.id) as PlantingPlanRow | null;
          return getGridBedLabel(row1).localeCompare(
            getGridBedLabel(row2),
            numberLocale,
          );
        },
        renderCell: (params) => {
          const row = params.row as PlantingPlanRow;
          if (row.parcel) {
            return <Typography variant="inherit" noWrap>{getGridBedLabel(row)}</Typography>;
          }
          const bedId = resolveBedCellValue(params.value, row);
          const isEditing = params.api?.getRowMode?.(params.id) === "edit";
          const hasDraft = row.isNew || isEditing;
          const draft = isEditing
            ? params.api.getRowWithUpdatedValues(params.id, params.field) as PlantingPlanRow
            : row;
          return (
            <PlantingPlanBedCell
              path={getBedPath(row)}
              options={bedPickerOptions}
              selected={bedPickerOptionsById.get(bedId)}
              numberLocale={numberLocale}
              hasFocus={params.hasFocus}
              readOnly={Boolean(row.carried_over)}
              rowId={params.id}
              field={params.field}
              onSelect={(nextBedId, freeAreaSqm) => applyBedSelection(params.id, row, nextBedId, freeAreaSqm)}
              onAccept={(accepted) => saveRotationAcceptance(row.id, accepted)}
              rotation={{
                bedId: bedId || null,
                cropId: typeof draft.crop === "number" && draft.crop > 0 ? draft.crop : null,
                plantingDate: toPlanIsoDate(draft.planting_date),
                endDate: getPlanOccupancyEndIso(draft),
                areaSqm: toAreaNumericValue(draft.area_m2 ?? draft.area_usage_sqm, numberLocale),
                planId: row.isNew ? null : row.id,
                cultivationType: draft.cultivation_type,
                cultureLabel: row.crop_display_name ?? row.crop_name ?? "",
                status: hasDraft ? null : row.rotation_status ?? null,
                findings: hasDraft ? null : row.rotation_findings ?? null,
              }}
              endAdornment={(
                <>
                  {row.carried_over && <HarvestOverlapIcon overlaps={getRowHarvestOverlaps(row)} fontSize="inherit" />}
                  <CompanionWarningIcon findings={row.companion_findings} fontSize="inherit" />
                </>
              )}
            />
          );
        },
      },
      {
        field: "sowing_date",
        headerName: t("plantingPlans:columns.sowingDate"),
        flex: 0,
        minWidth: 80,
        width: dynamicWidths.sowingDate,
        type: "date",
        editable: true,
        headerClassName: getCoupledFieldHeaderClassName("start", isSowingDatePartnerVisible),
        renderHeader: () => (
          <GridHeaderHelp label={t("plantingPlans:tableHeaders.sowingDate")}
            description={t("plantingPlans:tooltips.sowingDateDescription")} />
        ),
        valueGetter: (_value, row) => toGridDateValue(getRowSowingSchedule(row as PlantingPlanRow)?.sowingDate ?? null),
        valueFormatter: formatGridDate,
        cellClassName: (params) => [
          (displayDateMode !== 'planned' || getDateReadOnlyReason(params.row, 'sowing_date') || getColumnDates(params.row, 'sowing_date').actual)
            ? FULL_CELL_TOOLTIP_CELL_CLASS : '',
          getRowSowingSchedule(params.row as PlantingPlanRow)?.sowingDate
            && !hasTimingWindowFinding(params.row as PlantingPlanRow, "sowing_date")
            && !(params.row as PlantingPlanRow).germination_findings?.length
            ? ""
            : FULL_CELL_TOOLTIP_CELL_CLASS,
          getLinkedPartnerHighlightClassName(params),
        ].filter(Boolean).join(" "),
        renderCell: renderSowingDate,
        renderEditCell: (params) => {
          const editedRow = params.api.getRowWithUpdatedValues(params.id, params.field) as PlantingPlanRow;
          if (isActualDateEditor(editedRow, params.field) || getDateReadOnlyReason(editedRow, params.field)) {
            return renderSowingDate(params);
          }
          return <DateEditCell {...params} ariaLabel={plannedDateLabel(editedRow, 'sowing_date')}
            onCommitted={value => applyLinkedDateValue(params, "sowing_date", value)} />;
        },
        preProcessEditCellProps: (params) => {
          const row = params.row as PlantingPlanRow;
          if (row.cultivation_type === PURCHASED_TRANSPLANT) {
            return { ...params.props, error: false };
          }
          if (params.hasChanged && !linkedPartnerUpdateInProgressRef.current) {
            lastEditedDateFieldRef.current = "sowing_date";
          }
          const isoValue = toIsoDateString(params.props.value);
          if (!isoValue) {
            return { ...params.props, error: true };
          }
          const crop = crops.find((item) => item.id === row.crop);
          if (getExplicitPropagationStart(row, crop)) {
            return { ...params.props, error: false };
          }
          const resultingPlantingDate = getPlantingDateFromSowingDate(isoValue, row, crop);
          return { ...params.props, error: !isPlantingDateWithinSeason(resultingPlantingDate) };
        },
      },
      {
        field: "planting_date",
        headerName: t("plantingPlans:columns.plantingDate"),
        flex: 0,
        minWidth: 80,
        width: dynamicWidths.plantingDate,
        type: "date",
        editable: true,
        headerClassName: getCoupledFieldHeaderClassName("end", isPlantingDatePartnerVisible),
        renderHeader: () => (
          <TruncatedTextWithTooltip text={t("plantingPlans:tableHeaders.plantingDate")}
            sx={dataGridHeaderLabelSx} focusWithinColumnHeader />
        ),
        valueGetter: (value) => toGridDateValue(value),
        valueFormatter: formatGridDate,
        cellClassName: (params) => [
          (displayDateMode !== 'planned' || getDateReadOnlyReason(params.row, 'planting_date') || getColumnDates(params.row, 'planting_date').actual)
            ? FULL_CELL_TOOLTIP_CELL_CLASS : '',
          hasTimingWindowFinding(params.row as PlantingPlanRow, "planting_date") ? FULL_CELL_TOOLTIP_CELL_CLASS : "",
          getLinkedPartnerHighlightClassName(params),
        ].filter(Boolean).join(" "),
        renderCell: renderPlantingDate,
        renderEditCell: (params) => (
          isActualDateEditor(params.row, params.field) || getDateReadOnlyReason(params.row, params.field)
        ) ? renderPlantingDate(params) : (
          <DateEditCell
            {...params}
            ariaLabel={plannedDateLabel(params.row, 'planting_date')}
            minDate={seasonBounds?.minDate}
            maxDate={seasonBounds?.maxDate}
            onCommitted={(value) => applyLinkedDateValue(params, "planting_date", value)}
          />
        ),
        preProcessEditCellProps: (params) => {
          if (params.hasChanged && !linkedPartnerUpdateInProgressRef.current) {
            lastEditedDateFieldRef.current = "planting_date";
          }
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
        minWidth: 80,
        width: dynamicWidths.harvestDate,
        renderHeader: () => <GridHeaderHelp label={t("plantingPlans:tableHeaders.harvestStartDate")}
          description={t("plantingPlans:tooltips.calculatedHarvestStartDate")} />,
        editable: false,
        type: "date",
        valueGetter: (_value, row) => toGridDateValue(getColumnDates(row, 'harvest_date').planned),
        valueFormatter: formatGridDate,
        cellClassName: FULL_CELL_TOOLTIP_CELL_CLASS,
        renderCell: renderCalculatedHarvestDateCell,
      },
      {
        field: "harvest_end_date",
        headerName: t("plantingPlans:columns.harvestEndDate"),
        flex: 0,
        minWidth: 80,
        width: dynamicWidths.harvestEndDate,
        renderHeader: () => <GridHeaderHelp label={t("plantingPlans:tableHeaders.harvestEndDate")}
          description={t("plantingPlans:tooltips.calculatedHarvestEndDate")} />,
        editable: false,
        type: "date",
        valueGetter: (_value, row) => toGridDateValue(getColumnDates(row, 'harvest_end_date').planned),
        valueFormatter: formatGridDate,
        cellClassName: FULL_CELL_TOOLTIP_CELL_CLASS,
        renderCell: renderCalculatedHarvestDateCell,
      },
      {
        field: "area_m2",
        headerName: t("plantingPlans:columns.areaM2"),
        flex: 0,
        minWidth: 72,
        width: dynamicWidths.area,
        editable: true,
        renderHeader: () => (
          <GridHeaderHelp label={t("plantingPlans:columns.areaM2")}
            description={t("plantingPlans:tooltips.areaAutoMax")} />
        ),
        preProcessEditCellProps: (params) => {
          if (params.hasChanged && !linkedPartnerUpdateInProgressRef.current) {
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
              onLastEditedFieldChange={(field, value) => {
                lastEditedFieldRef.current = field;
                setAreaNotice(null);
                void applyLinkedAreaPlantsValue(params, field, value);
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
        cellClassName: (params) => getLinkedPartnerHighlightClassName(params),
        headerClassName: getCoupledFieldHeaderClassName("start", isAreaPartnerVisible),
      },
      {
        field: "plants_count",
        headerName: t("plantingPlans:columns.plantsCount"),
        flex: 0,
        minWidth: 72,
        width: dynamicWidths.plants,
        editable: true,
        type: "number",
        renderHeader: () => (
          <GridHeaderHelp label={t("plantingPlans:columns.plantsCount")}
            description={t("plantingPlans:tooltips.plantsFromSpacing")} />
        ),
        preProcessEditCellProps: (params) => {
          if (params.hasChanged && !linkedPartnerUpdateInProgressRef.current) {
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
            onLastEditedFieldChange={(field, value) => {
              lastEditedFieldRef.current = field;
              setAreaNotice(null);
              void applyLinkedAreaPlantsValue(params, field, value);
            }}
          />
        ),
        valueFormatter: (value, row) => {
          if (typeof value === "number" && !isNaN(value)) {
            if ((row as PlantingPlanRow).parcel) return formatLocalizedNumber(value, numberLocale);
            return `≈ ${Math.round(value)}`;
          }
          return "—";
        },
        cellClassName: (params) => getLinkedPartnerHighlightClassName(params),
        headerClassName: getCoupledFieldHeaderClassName("end", isPlantsPartnerVisible),
      },
      {
        field: "season_status",
        headerName: t("plantingPlans:seasonStatus.column"),
        width: 156,
        editable: false,
        valueGetter: (_value, row: PlantingPlanRow) => {
          const start = row.seasonal_harvest?.occupancy_start_date ?? toPlanIsoDate(row.planting_date);
          const end = row.occupancy_end_date ?? getPlanOccupancyEndIso(row) ?? start;
          return seasonBounds && (row.bed || row.parcel) && start && end
            ? getSeasonOccupancyStatus(start, end, seasonBounds) : null;
        },
        valueFormatter: (value: SeasonOccupancyStatus | null) => (
          value ? t(`plantingPlans:seasonStatus.labels.${value}`) : "—"
        ),
        renderCell: ({ value, formattedValue, hasFocus }) => value && (
          <AppTooltip title={t(`plantingPlans:seasonStatus.descriptions.${value as SeasonOccupancyStatus}`)} describeChild>
            <Typography component="span" variant="inherit" noWrap tabIndex={hasFocus ? 0 : -1}>
              {formattedValue}
            </Typography>
          </AppTooltip>
        ),
      },
      {
        field: "actual_harvest",
        headerName: tHarvest("tableColumn"),
        width: 178,
        editable: false,
        sortable: false,
        valueFormatter: (value: PlanActualHarvest | null | undefined) => value
          ? formatHarvestTotals(value.quantities, numberLocale, tHarvest) : "—",
        renderCell: ({ value, formattedValue, hasFocus }) => {
          const actual = value as PlanActualHarvest | null | undefined;
          const comparable = actual?.forecast_kg && actual.forecast_percentage && actual.quantities.length === 1
            && actual.quantities[0].unit === 'kg';
          const text = <Typography component="span" variant="inherit" noWrap tabIndex={comparable && hasFocus ? 0 : -1}>
            {formattedValue ?? "—"}
          </Typography>;
          return comparable ? <AppTooltip describeChild title={tHarvest('forecastComparison', {
            forecast: formatHarvestQuantity(actual.forecast_kg!, 'kg', numberLocale, tHarvest),
            percent: formatLocalizedNumber(Number(actual.forecast_percentage) / 100, numberLocale, {
              style: 'percent', maximumFractionDigits: 1,
            }),
          })}>{text}</AppTooltip> : text;
        },
      },
      {
        field: "crop_loss_count",
        headerName: t("plantingPlans:cropLosses.title"),
        width: 150,
        editable: false,
        valueFormatter: (count: number | undefined) => count
          ? t("plantingPlans:cropLosses.incidentCount", { count }) : "—",
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
    ];
  },
    [
      applyBedSelection,
      bedColumnLabel,
      bedLabelById,
      bedOptions,
      bedPickerOptions,
      bedPickerOptionsById,
      cultivationTypeOptions,
      getCultivationTypeOptionsForRow,
      cropOptions,
      crops,
      dynamicWidths,
      getBedPath,
      getGridBedLabel,
      getRowHarvestOverlaps,
      renderCalculatedHarvestDateCell,
      getRowSowingSchedule,
      isActualDateEditor,
      displayDateMode,
      getColumnDates,
      getDateReadOnlyReason,
      renderDateCell,
      plannedDateLabel,
      numberLocale,
      saveRotationAcceptance,
      seasonBounds,
      isPlantingDateWithinSeason,
      isSowingDatePartnerVisible,
      isPlantingDatePartnerVisible,
      isAreaPartnerVisible,
      isPlantsPartnerVisible,
      linkedPartnerHighlight,
      t,
      tHarvest,
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

  /**
   * Whether the given cell currently shows the "live-carried coupled
   * partner" highlight — requires both the state match *and* the cell to
   * still be in edit mode, so the highlight disappears by itself once the
   * row is saved or the edit is cancelled, without a separate cleanup effect.
   */
  const getLinkedPartnerHighlightClassName = (params: GridCellParams<PlantingPlanRow>): string =>
    linkedPartnerHighlight !== null
      && linkedPartnerHighlight.rowId === params.id
      && linkedPartnerHighlight.field === params.field
      && params.api.getCellMode(params.id, params.field) === "edit"
      ? "ofp-cell-linked-highlight"
      : "";

  /**
   * Live-carries the Fläche/Pflanzen pair while either is being typed, using
   * the same plants-per-m² math `buildAreaAndPlantsDraft`/`getDerivedAreaFromRow`
   * use at save time (see docs/datagrid-architecture.md#coupled-field-pairs).
   * Skips silently — leaving the partner and the highlight untouched — for
   * anything not resolvable to a concrete number right now: the "max" keyword
   * (resolved only at save), an empty/unparsable value, or a crop with no
   * plant spacing.
   */
  const applyLinkedAreaPlantsValue = async (
    params: GridRenderEditCellParams<PlantingPlanRow>,
    source: "area_m2" | "plants_count",
    rawValue: string,
  ): Promise<void> => {
    setLinkedPartnerHighlight(null);
    const row = params.row as PlantingPlanRow;
    const plantsPerSqm = getPlantsPerSqmForCrop(String(row.crop ?? ""));
    if (!plantsPerSqm) {
      return;
    }

    let partnerField: "area_m2" | "plants_count";
    let partnerValue: number;
    if (source === "area_m2") {
      if (rawValue.trim().toLowerCase() === t("plantingPlans:placeholders.maxKeyword").toLowerCase()) {
        return;
      }
      const numericArea = parseLocalizedNumber(rawValue, numberLocale);
      if (numericArea === null) {
        return;
      }
      partnerField = "plants_count";
      partnerValue = buildAreaAndPlantsDraft(row, numericArea).plants_count as number;
    } else {
      const numericPlants = parseLocalizedNumber(rawValue, numberLocale);
      if (numericPlants === null) {
        return;
      }
      partnerField = "area_m2";
      const derivedArea = getDerivedAreaFromRow({ ...row, plants_count: numericPlants, area_m2: undefined });
      if (derivedArea === null) {
        return;
      }
      partnerValue = derivedArea;
    }

    linkedPartnerUpdateInProgressRef.current = true;
    try {
      await params.api.setEditCellValue({ id: params.id, field: partnerField, value: partnerValue });
    } finally {
      linkedPartnerUpdateInProgressRef.current = false;
    }
    setLinkedPartnerHighlight({ rowId: params.id, field: partnerField });
  };

  /**
   * Live-carries the Aussaattermin/Pflanztermin pair, using the same
   * `getPlanSowingSchedule`/`getPlantingDateFromSowingDate` helpers the save
   * path and the Anbaukalender use (see planSowingDate.ts). Skips silently
   * for a crop with no resolvable propagation duration — `getPlanSowingSchedule`
   * then returns a null `sowingDate`, the same condition that already makes
   * the Aussaattermin cell itself non-editable.
   */
  const applyLinkedDateValue = async (
    params: GridRenderEditCellParams<PlantingPlanRow>,
    source: "sowing_date" | "planting_date",
    value: Date | null,
  ): Promise<void> => {
    setLinkedPartnerHighlight(null);
    const isoValue = toIsoDateString(value);
    if (!isoValue) {
      return;
    }
    const row = params.row as PlantingPlanRow;
    const crop = crops.find((item) => item.id === row.crop);
    if (getExplicitPropagationStart(row, crop)) {
      return;
    }

    let partnerField: "sowing_date" | "planting_date";
    let partnerValue: string;
    if (source === "sowing_date") {
      partnerField = "planting_date";
      partnerValue = getPlantingDateFromSowingDate(isoValue, row, crop);
    } else {
      const schedule = getPlanSowingSchedule({ ...row, planting_date: isoValue }, crop);
      if (!schedule?.sowingDate) {
        return;
      }
      partnerField = "sowing_date";
      partnerValue = schedule.sowingDate;
    }

    linkedPartnerUpdateInProgressRef.current = true;
    try {
      await params.api.setEditCellValue({
        id: params.id,
        field: partnerField,
        value: toGridDateValue(partnerValue),
      });
    } finally {
      linkedPartnerUpdateInProgressRef.current = false;
    }
    setLinkedPartnerHighlight({ rowId: params.id, field: partnerField });
  };

  /**
   * Why the mobile dialog's Aussaattermin field cannot be computed for the
   * form's current crop/cultivation_type (bought-in plants, or Anzucht
   * without a resolvable propagation duration), independent of whether a
   * planting date has been entered yet; null when it can.
   */
  const getMobileSowingDateDisabledReason = (form: MobileCreateFormState): string | null => {
    const crop = crops.find((item) => item.id === Number(form.crop));
    if (getExplicitPropagationStart(form, crop)) {
      return null;
    }
    const propagationInfo = getPlanPropagationInfo(form, crop);
    if (propagationInfo.isPurchasedTransplant) {
      return t("plantingPlans:tooltips.noOwnPropagation");
    }
    if (propagationInfo.isPreCultivation && propagationInfo.propagationDurationDays === null) {
      return t("plantingPlans:tooltips.missingPropagationDuration");
    }
    return null;
  };

  /** Recomputes the Aussaattermin text from the form's current planting date. */
  const getMobileSowingDateFromPlantingDate = (form: MobileCreateFormState): string => {
    const crop = crops.find((item) => item.id === Number(form.crop));
    if (getExplicitPropagationStart(form, crop)) {
      return form.sowing_date;
    }
    const plantingDateIso = toIsoDateString(parseGermanDateText(form.planting_date));
    if (!plantingDateIso) {
      return "";
    }
    const schedule = getPlanSowingSchedule({ ...form, planting_date: plantingDateIso }, crop);
    return formatDateAsGerman(schedule?.sowingDate ?? null);
  };

  /** Recomputes the planting date from the form's current Aussaattermin text. */
  const getMobilePlantingDateFromSowingDate = (form: MobileCreateFormState): string => {
    const crop = crops.find((item) => item.id === Number(form.crop));
    if (getExplicitPropagationStart(form, crop)) {
      return form.planting_date;
    }
    const sowingDateIso = toIsoDateString(parseGermanDateText(form.sowing_date));
    if (!sowingDateIso) {
      return form.planting_date;
    }
    return formatDateAsGerman(getPlantingDateFromSowingDate(sowingDateIso, form, crop));
  };

  const getMobilePropagationChange = (form: MobileCreateFormState): Partial<PlantingPlan> => {
    const crop = crops.find(item => item.id === Number(form.crop));
    const previous = getExplicitPropagationStart(form, crop);
    const next = previous && toIsoDateString(parseGermanDateText(form.sowing_date));
    return next && next !== previous ? { planned_propagation_start_date: next } : {};
  };

  const getDisplayArea = (row: PlantingPlanRow): string => {
    if (row.parcel) return "—";
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

  const toSearchRecordInput = useCallback((row: PlantingPlanRow): PlantingPlanSearchRecordInput => {
    const linkedCrop = typeof row.crop === "number" ? cropById.get(row.crop) : undefined;
    const bedId = resolveBedCellValue(row.bed, row);
    const linkedBed = bedById.get(bedId);
    const linkedField = linkedBed ? fieldById.get(linkedBed.field) : undefined;
    const linkedLocation = linkedField ? locationById.get(linkedField.location) : undefined;
    const cropLabel = formatCropDisplayName({
      name: linkedCrop?.name,
      crop_name: row.crop_name,
      crop_display_name: row.crop_display_name ?? linkedCrop?.crop_display_name,
      variety: linkedCrop?.variety,
      crop_variety: row.crop_variety,
    }) || (cropOptions.find((option) => option.value === row.crop)?.label ?? "");
    return {
      id: row.id,
      cropLabel,
      cropName: getCropDisplayName({
        name: linkedCrop?.name,
        crop_name: row.crop_name,
        crop_display_name: row.crop_display_name ?? linkedCrop?.crop_display_name,
      }),
      cropSynonyms: linkedCrop?.crop_species_search_names ?? [],
      cultivationType: row.cultivation_type ?? "",
      cultivationTypeLabel: cultivationTypeOptions.find((item) => item.value === row.cultivation_type)?.label ?? "",
      cultivationTypeShortLabel: cultivationTypeOptions.find((item) => item.value === row.cultivation_type)?.shortLabel ?? "",
      locationId: linkedLocation?.id ?? row.location_id ?? null,
      locationName: linkedLocation?.name ?? toOptionalString(row.location_name) ?? "",
      fieldId: linkedField?.id ?? row.field_id ?? null,
      fieldName: linkedBed?.field_name ?? linkedField?.name ?? toOptionalString(row.field_name) ?? "",
      bedName: linkedBed?.name ?? toOptionalString(row.bed_name) ?? "",
      notesText: stripMarkdown(row.notes ?? ""),
      plantingDate: getDisplayedDate(row, 'planting_date'),
      sowingDate: getDisplayedDate(row, 'sowing_date'),
      harvestDate: getDisplayedDate(row, 'harvest_date'),
      harvestEndDate: getDisplayedDate(row, 'harvest_end_date'),
      rotationStatus: row.isNew ? null : getTableRotationStatus(row.rotation_status, row.rotation_findings),
      hasHarvestOverlap: (getRowHarvestOverlaps(row)?.length ?? 0) > 0,
      carriedOver: row.carried_over,
      hasTimingWindowFinding: (getRowTimingWindowFindings(row)?.length ?? 0) > 0,
    };
  }, [bedById, cropById, cropOptions, cultivationTypeOptions, fieldById, locationById, getDisplayedDate, getRowHarvestOverlaps, getRowTimingWindowFindings]);
  const persistedRows = useMemo(() => getVisibleMobileRows(mobileRows), [mobileRows]);
  const search = usePlantingPlanSearch({
    rows: persistedRows,
    toRecordInput: toSearchRecordInput,
    projectId: activeProjectId ?? null,
    restoredView,
  });
  // The column menu closes itself on click; open the panel once it is gone
  // so the menu's focus restore does not fight the panel for focus.
  const openFilterPanel = useCallback((): void => {
    window.setTimeout(() => setIsFilterPanelOpen(true), 0);
  }, []);
  const isRowVisible = search.isRowVisible;
  const { pinnedPlanId, flashingPlanId, pinCreatedPlan } = useCreatedPlanPin(search.sortKey);
  const mobileListRows = useMemo(
    () => withPinnedRowFirst(search.sortedRows, persistedRows, pinnedPlanId),
    [persistedRows, pinnedPlanId, search.sortedRows],
  );
  const gridExternalFilter = useMemo<ExternalRowFilter<PlantingPlanRow>>(() => ({
    isRowVisible,
    onOpenFilterPanel: openFilterPanel,
    highlightedNoteRowIds: search.noteMatchIds,
  }), [isRowVisible, openFilterPanel, search.noteMatchIds]);
  const hasDraftRows = mobileRows.some((row) => row.isNew);
  const showDesktopSearchEmptyState = search.isActive && search.shownCount === 0 && !hasDraftRows;

  const getPlantsCountLabel = (row: PlantingPlanRow): string => (
    typeof row.plants_count === "number" && !Number.isNaN(row.plants_count)
      ? `≈ ${Math.round(row.plants_count)}`
      : "—"
  );

  const columnSizing = useGridColumnSizing(columns, "plantingPlans", userId, activeProjectId);

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
      headerName: bedColumnLabel,
      getValue: getGridBedLabel,
    },
    {
      field: "sowing_date",
      headerName: t("plantingPlans:columns.sowingDate"),
      getValue: (row: PlantingPlanRow) => formatDateForDisplay(getDisplayedDate(row, 'sowing_date')),
    },
    {
      field: "planting_date",
      headerName: t("plantingPlans:columns.plantingDate"),
      getValue: (row: PlantingPlanRow) => formatDateForDisplay(getDisplayedDate(row, 'planting_date')),
    },
    {
      field: "harvest_date",
      headerName: t("plantingPlans:columns.harvestStartDate"),
      getValue: (row: PlantingPlanRow) => displayedPlanDates(getColumnDates(row, 'harvest_date'), displayDateMode)
        .map(formatDateForDisplay).join(' · ') || '—',
    },
    {
      field: "harvest_end_date",
      headerName: t("plantingPlans:columns.harvestEndDate"),
      getValue: (row: PlantingPlanRow) => displayedPlanDates(getColumnDates(row, 'harvest_end_date'), displayDateMode)
        .map(formatDateForDisplay).join(' · ') || '—',
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
    bedColumnLabel,
    getGridBedLabel,
    getCropLabel,
    getCultivationTypeLabel,
    getDisplayArea,
    getPlantsCountLabel,
    getDisplayedDate,
    getColumnDates,
    displayDateMode,
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
    resetRotationAcceptance(null, "");
    setIsMobileCreateOpen(true);
  }, [resetRotationAcceptance]);

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

  const openDetailsForPlan = (planId: number, anchor?: HTMLElement | null): void => {
    if (onOpenDetails) onOpenDetails(planId, { query: search.query, filters: search.filters, sortKey: search.sortKey }, anchor);
    else void navigate(plantingPlanDetailPath(planId));
  };

  const getPlanNavigationActions = (row: PlantingPlanRow): PlanMenuNavigationAction[] => {
    const planId = typeof row.id === 'number' && row.id > 0 && !row.isNew ? row.id : null;
    const cropId = crops.some(crop => crop.id === row.crop) ? row.crop : null;
    const bedId = row.bed && bedById.has(row.bed) ? row.bed : null;
    const originSeasonId = row.carried_over ? row.season : null;
    return [
      {
        id: 'plan-details', label: t('plantingPlans:details.title'), icon: <ArticleOutlinedIcon fontSize="small" />,
        disabledReason: planId ? undefined : t('plantingPlans:details.saveFirst'),
        activate: anchor => {
          if (planId) openDetailsForPlan(planId, anchor);
        },
      },
      {
        id: 'plan-crop', label: t('plantingPlans:details.openCrop'), icon: <GrassOutlinedIcon fontSize="small" />,
        disabledReason: cropId ? undefined : t('plantingPlans:details.missingCrop'),
        activate: () => { if (cropId) void navigate(`/app/crops?cropId=${cropId}`); },
      },
      ...(planId && row.parcel && row.parcel_location_id ? [{
        id: 'plan-placement', label: t('fields:individualPlants.openGraphic'), icon: <GridViewOutlinedIcon fontSize="small" />,
        activate: () => { if (row.parcel_location_id) void navigate(individualPlantGraphicPath(planId, row.parcel_location_id)); },
      }] : [{
        id: 'plan-bed', label: t('plantingPlans:details.openBed'), icon: <GridViewOutlinedIcon fontSize="small" />,
        disabledReason: bedId ? undefined : t('plantingPlans:details.missingBed'),
        activate: () => { if (bedId) void navigate(getEntityDetailPath('bed', bedId)); },
      }]),
      ...(planId && originSeasonId && outletContext?.switchActiveSeason ? [{
        id: 'plan-origin-season', label: t('plantingPlans:carriedOver.openOrigin'),
        icon: <ArticleOutlinedIcon fontSize="small" />,
        activate: () => outletContext.switchActiveSeason?.(
          originSeasonId, `${PLANTING_PLANS_PATH}?planId=${planId}`,
        ),
      }] : []),
    ];
  };

  const getDerivedAreaFromRow = (row: PlantingPlanRow): number | null => {
    if (row.parcel) return null;
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

  /**
   * The bed's capacity in the row's period, from the backend's shared
   * capacity rule (farm/services/bed_capacity.py) — the same rule the bed
   * options in the inline bed picker use, so a bed offered there is never
   * rejected here. Null skips the check (no bed, no bed area, or the check
   * failed: a failed check never blocks a save).
   */
  const fetchCapacityForRow = async (row: PlantingPlanRow): Promise<{
    bedArea: number;
    occupiedArea: number;
    availableArea: number;
    successionLimit?: SuccessionLimit | null;
  } | null> => {
    const rowBedId = getPlanBedId(row);
    if (rowBedId === null) {
      return null;
    }
    const plantingDate = toPlanIsoDate(row.planting_date);
    if (!plantingDate) {
      // Without a period only the bed's own size limits the area.
      const bedArea = toNumericValue(bedById.get(rowBedId)?.area_sqm);
      return bedArea === null ? null : { bedArea, occupiedArea: 0, availableArea: bedArea };
    }
    const endDate = getPlanOccupancyEndIso(row);
    const harvestStartDate = toPlanIsoDate(row.harvest_date);
    const cropId = typeof row.crop === "number" && row.crop > 0 ? row.crop : null;
    try {
      const { data } = await plantingPlanAPI.remainingArea({
        bed_id: rowBedId,
        start_date: plantingDate,
        ...(endDate ? { end_date: endDate } : {}),
        ...(endDate && harvestStartDate && harvestStartDate >= plantingDate ? { harvest_start_date: harvestStartDate } : {}),
        ...(cropId ? { crop_id: cropId } : {}),
        ...(!row.isNew && typeof row.id === "number" ? {
          exclude_plan_id: row.id,
          ...(row.cultivation_type === undefined ? {} : { cultivation_type: row.cultivation_type }),
        } : {}),
      });
      if (!data.has_bed_area) {
        return null;
      }
      return {
        bedArea: data.bed_area_sqm,
        occupiedArea: data.overlapping_used_area_sqm,
        availableArea: data.remaining_area_sqm,
        successionLimit: data.succession_limit ?? null,
      };
    } catch (error) {
      console.error("Error checking the remaining bed area:", error);
      return null;
    }
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

  const buildAvailableAreaDraft = async (
    row: PlantingPlanRow,
  ): Promise<Pick<PlantingPlanRow, "area_m2" | "plants_count"> | null> => {
    const capacity = await fetchCapacityForRow(row);
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

  const mobileRotationKey = buildRotationKey(
    mobileCreateForm.crop,
    mobileCreateForm.bed,
    mobileCreateForm.planting_date,
  );

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
    const crop = crops.find(item => item.id === Number(mobileCreateForm.crop));
    if (getExplicitPropagationStart(mobileCreateForm, crop) && !parseGermanDateText(mobileCreateForm.sowing_date)) {
      setMobileCreateError(t('plantingPlans:validation.requiredFields', { fields: t('plantingPlans:columns.sowingDate') }));
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

  // Once the plan just created is in the list (first, see useCreatedPlanPin),
  // bring its card into view and move focus to its actions, so it can be
  // edited right away — also when the list was scrolled far down before.
  const revealMobilePlanIdRef = useRef<number | null>(null);
  const revealCreatedMobileCard = (planId: number): void => {
    revealMobilePlanIdRef.current = planId;
  };
  useEffect(() => {
    const planId = revealMobilePlanIdRef.current;
    if (planId === null || !mobileListRows.some((row) => row.id === planId)) {
      return;
    }
    revealMobilePlanIdRef.current = null;
    const card = document.querySelector<HTMLElement>(`[data-mobile-card-id="${planId}"]`);
    card?.scrollIntoView({ block: "center", behavior: "smooth" });
    card?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus({ preventScroll: true });
  }, [mobileListRows]);

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
      const response = await plantingPlanAPI.create({
        crop: Number(mobileCreateForm.crop),
        bed: Number(mobileCreateForm.bed),
        planting_date: plantingDateIso,
        ...getSupplementalPlannedDates(mobileCreateForm),
        ...getMobilePropagationChange(mobileCreateForm),
        cultivation_type: mobileCreateForm.cultivation_type,
        notes: mobileCreateForm.notes || "",
        ...areaPayload,
        ...getRotationAcceptancePayload(mobileRotationKey),
      } as PlantingPlan);
      closeMobileCreateDialog();
      await reloadPlans();
      if (typeof response.data.id === "number") {
        pinCreatedPlan(response.data.id);
        revealCreatedMobileCard(response.data.id);
      }
    } catch (error) {
      showMobileSaveError(error);
    }
  };

  const openMobileEditDialog = (row: PlantingPlanRow): void => {
    if (row.carried_over || row.parcel) return;
    const derivedArea = getDerivedAreaFromRow(row);
    setMobileCreateError("");
    setMobileEditId(row.id);
    resetRotationAcceptance(
      row,
      buildRotationKey(String(row.crop ?? ""), String(row.bed ?? ""), formatDateAsGerman(row.planting_date)),
    );
    setMobileCreateForm({
      crop: String(row.crop ?? ""),
      bed: String(row.bed ?? ""),
      cultivation_type: (row.cultivation_type as PlanCultivationType) || "",
      sowing_date: formatDateAsGerman(getRowSowingSchedule(row)?.sowingDate ?? null),
      ...getSupplementalPlannedDates(row),
      planting_date: formatDateAsGerman(row.planting_date),
      area_m2:
        derivedArea !== null
          ? formatLocalizedNumberForInput(derivedArea, numberLocale, { maximumFractionDigits: 2 })
          : "",
      plants_count:
        typeof row.plants_count === "number"
          ? formatLocalizedNumberForInput(Math.round(row.plants_count), numberLocale, {
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
    if (row.carried_over || row.parcel) return;
    const derivedArea = getDerivedAreaFromRow(row);
    setMobileCreateError("");
    setMobileEditId(null);
    resetRotationAcceptance(null, "");
    setMobileCreateForm({
      crop: String(row.crop ?? ""),
      bed: String(row.bed ?? ""),
      cultivation_type: (row.cultivation_type as PlanCultivationType) || "",
      sowing_date: formatDateAsGerman(getRowSowingSchedule(row)?.sowingDate ?? null),
      ...getSupplementalPlannedDates(row),
      planting_date: formatDateAsGerman(row.planting_date),
      area_m2:
        derivedArea !== null
          ? formatLocalizedNumberForInput(derivedArea, numberLocale, { maximumFractionDigits: 2 })
          : "",
      plants_count:
        typeof row.plants_count === "number"
          ? formatLocalizedNumberForInput(Math.round(row.plants_count), numberLocale, {
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
        ...getMobilePropagationChange(mobileCreateForm),
        cultivation_type: mobileCreateForm.cultivation_type,
        notes: mobileCreateForm.notes || "",
        ...areaPayload,
        ...getRotationAcceptancePayload(mobileRotationKey),
      } as PlantingPlan);
      closeMobileCreateDialog();
      await reloadPlans();
    } catch (error) {
      showMobileSaveError(error);
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

  const createActions = useMemo(() => detailOpen ? [] : [
    {
      id: "create-planting-plan",
      label: t("plantingPlans:addButton"),
      shortcut: "Alt+Shift+N",
      tooltipOnIconOnly: true,
      disabled: !canCreatePlan || shouldShowProjectRequiredState,
      handler: handleCreatePlan,
    },
  ], [canCreatePlan, detailOpen, handleCreatePlan, shouldShowProjectRequiredState, t]);

  useRegisterCreateActions("plans-page", createActions);

  useEffect(() => {
    if (detailOpen || createIntentHandledRef.current || !canCreatePlan) {
      return;
    }
    if (searchParams.get("create") !== "true") {
      return;
    }

    // The mobile prefill effect opens the form once its bed options are ready.
    // Opening the bare form here could overwrite its selected crop or bed.
    if (!isMobile || (initialSelection.cropId === null && initialSelection.bedId === null)) {
      handleCreatePlan();
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("create");
    replacePlantingPlanSearchParams(nextParams);
    createIntentHandledRef.current = true;
  }, [canCreatePlan, detailOpen, handleCreatePlan, initialSelection, isMobile, replacePlantingPlanSearchParams, searchParams]);

  if (shouldShowProjectRequiredState && missingProjectReason) {
    return (
      <PageContainer>
        <ProjectRequiredState reason={missingProjectReason} />
      </PageContainer>
    );
  }

  return (
    <SearchHighlightContext.Provider value={search.terms}>
    <PlantingPlanSearchMatchContext.Provider value={search.matchById}>
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
            <PlantingPlanMobileSearchBar
              search={search}
              searchInputRef={searchInputRef}
              isFilterSheetOpen={isFilterPanelOpen}
              onOpenFilterSheet={() => setIsFilterPanelOpen(true)}
              filterSheetId={filterSheetId}
            />
            <PlantingPlanMobileListHeader
              search={search}
              onOpenFilterSheet={() => setIsFilterPanelOpen(true)}
            />
            <MobileCardList
              items={mobileListRows}
              flashingId={flashingPlanId}
              expandedIds={expandedCardIds}
              onToggleExpanded={toggleCardExpanded}
              onOpenItem={(item, anchor) => { if (item.id > 0 && !item.isNew) openDetailsForPlan(item.id, anchor); }}
              renderPrimary={(item) => <PlantingPlanCropLabel planId={item.id} text={getCropLabel(item)} />}
              renderSecondary={(item) => {
                const rotationStatus = getTableRotationStatus(item.rotation_status, item.rotation_findings);
                const dates = getColumnDates(item, 'planting_date');
                return (
                  <>
                    {dates.planned && <>
                      {t(`plantingPlans:actualDates.plannedCardLabels.${dates.activity === 'sowing' ? 'sowing' : 'transplanting'}`)}{' '}
                      <SearchHighlightedText text={formatDateForDisplay(dates.planned)} />
                      {" · "}
                    </>}
                    <SearchHighlightedText text={getBedLabelForRow(item)} />
                    {isFlaggedRotationStatus(rotationStatus) && (
                      item.carried_over ? (
                        <ReadOnlyRotationWarning
                          status={rotationStatus}
                          findings={item.rotation_findings}
                          cultureLabel={getCropLabel(item)}
                        />
                      ) : (
                        <RotationStatusIcon
                          status={rotationStatus}
                          fontSize="inherit"
                          titleAccess={t(`plantingPlans:rotation.status.${rotationStatus}`)}
                          sx={{ ml: 0.5, verticalAlign: "middle" }}
                        />
                      )
                    )}
                    <HarvestOverlapIcon
                      overlaps={getRowHarvestOverlaps(item)}
                      fontSize="inherit"
                      sx={{ ml: 0.5, verticalAlign: "middle" }}
                    />
                    <CompanionWarningIcon
                      findings={item.companion_findings}
                      fontSize="inherit"
                      sx={{ ml: 0.5, verticalAlign: "middle" }}
                    />
                    <TimingWindowIcon
                      findings={getRowTimingWindowFindings(item)}
                      germinationFindings={item.germination_findings}
                      fontSize="inherit"
                      sx={{ ml: 0.5, verticalAlign: "middle" }}
                    />
                  </>
                );
              }}
              renderHeaderAction={(item) => (
                <Stack direction="row">
                  {item.carried_over && (
                    <CarriedOverPlanIndicator season={item.origin_season_label} early={hasEarlyRecordedOccupancy(item)} />
                  )}
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
                </Stack>
              )}
              renderDetails={(item) => (
                <Stack spacing={0.75}>
                  <SiteSuitabilityHints findings={item.site_suitability_findings} />
                  <GerminationInfo
                    {...item}
                    sowingDate={item.planned_sowing_date ?? getRowSowingSchedule(item)?.sowingDate}
                  />
                  <Typography variant="body2"><strong>{t("plantingPlans:columns.cultivationType")}:</strong> <SearchHighlightedText text={getCultivationTypeLabel(item) || "—"} /></Typography>
                  <Typography variant="body2"><strong>{t("plantingPlans:columns.bed")}:</strong> <SearchHighlightedText text={getBedLabelForRow(item)} /></Typography>
                  {PLANTING_PLAN_DATE_COLUMNS.map(field => {
                    const dates = getColumnDates(item, field);
                    const displayed = displayedPlanDates(dates, 'planned');
                    if (!displayed.length) return null;
                    return <Typography key={field} variant="body2">
                      {t(`plantingPlans:actualDates.activities.${dates.activity}`)}{' '}
                      <SearchHighlightedText text={displayed.map(formatDateForDisplay).join(' · ')} />
                    </Typography>;
                  })}
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
              renderFooter={(item) => (
                <>
                  {search.noteMatchIds.has(item.id) && (
                    <Box
                      data-testid="planting-plan-notes-match"
                      sx={{ display: "flex", alignItems: "flex-start", gap: 0.75, pt: 0.75, borderTop: "1px solid", borderColor: "divider" }}
                    >
                      <NotesIcon
                        fontSize="small"
                        color="action"
                        titleAccess={t("plantingPlans:search.notesMatchAria")}
                        sx={{ mt: 0.125, flexShrink: 0 }}
                      />
                      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
                        <SearchHighlightedText text={buildMatchExcerpt(stripMarkdown(item.notes ?? ""), search.terms)} />
                      </Typography>
                    </Box>
                  )}
                </>
              )}
              detailsShowLabel={t("plantingPlans:mobile.showDetails")}
              detailsHideLabel={t("plantingPlans:mobile.hideDetails")}
              emptyState={search.isActive ? <PlantingPlanSearchEmptyState search={search} /> : (
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
              navigationActions={mobileActionMenuRow ? getPlanNavigationActions(mobileActionMenuRow) : undefined}
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
          {!isMobile && hasPlans ? (
            <GridTooltipScope editing={false}>
            <PlantingPlanSearchToolbar
              search={search}
              searchInputRef={searchInputRef}
              filterButtonRef={filterButtonRef}
              isFilterPanelOpen={isFilterPanelOpen}
              onFilterPanelOpenChange={setIsFilterPanelOpen}
              columnsPanelOpen={isColumnsPanelOpen}
              onColumnsPanelOpenChange={setIsColumnsPanelOpen}
              columnsButtonRef={setColumnsAnchorEl}
              viewControls={<PlantingPlanDateModeSelect mode={dateMode} onChange={setDateMode} />}
            />
            </GridTooltipScope>
          ) : null}
          {!isMobile && showDesktopSearchEmptyState ? <PlantingPlanSearchEmptyState search={search} /> : null}
          {/* Collapsed rather than unmounted while nothing matches, so the grid
              keeps its rows and scroll state, and still sizes the card: the
              toolbar does not jump when the last hit disappears. */}
          <Box
            aria-hidden={!isMobile && showDesktopSearchEmptyState ? true : undefined}
            sx={[plantingPlanTableHeaderSx, !isMobile && showDesktopSearchEmptyState
              ? { height: 0, overflow: 'hidden', visibility: 'hidden' } : {}]}
          >
          <EditableDataGrid<PlantingPlanRow>
            surfaceSizing={isMobile ? "fullWorkspace" : "contentFit"}
            scrollMode="continuous"
            pinCreatedRowsToTop
            columns={columnSizing.columns}
            columnSizing={columnSizing}
            api={plantingPlanGridAPI}
            dialogEditFields={PLANTING_PLAN_DIALOG_EDIT_FIELDS}
            isStandaloneEditCell={isActualDateEditor}
            getCellReadOnlyReason={(row, field) => row.parcel && ['bed', 'area_m2', 'plants_count'].includes(field)
              ? t('fields:individualPlants.editInGraphic') : getDateReadOnlyReason(row, field)}
            focusableReadOnlyFields={FOCUSABLE_SUMMARY_FIELDS}
            commandApiRef={gridCommandApiRef}
            onSelectedRowChange={setSelectedPlan}
            onRowsStateChange={syncGridRows}
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
          getSaveErrorAction={getGridSaveErrorAction}
          isNewRowEmpty={isEmptyNewPlantingPlanRow}
          isReadOnlyRow={isCarriedOverPlan}
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
            const linkedFieldId = linkedBed?.field ?? plan.parcel ?? undefined;
            const linkedField = linkedFieldId === undefined ? undefined : fieldById.get(linkedFieldId);
            return {
              ...plan,
              id: plan.id!,
              crop: plan.crop,
              cultivation_type: plan.cultivation_type ?? "",
              crop_name: plan.crop_name || "",
              bed: plan.bed,
              bed_name: plan.bed_name || "",
              field_id: linkedFieldId,
              field_name: linkedField?.name ?? plan.parcel_name ?? undefined,
              location_id: linkedField?.location,
              location_name: linkedField ? locationById.get(linkedField.location)?.name : undefined,
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
            let plantingDate = toIsoDateString(row.planting_date);

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

            // Aussaattermin isn't a persisted field, so editing it never
            // reliably ends up in row.planting_date by the time this runs —
            // MUI's row-edit commit doesn't keep a derived sibling field in
            // sync here (see lastEditedDateFieldRef above). Recompute it
            // from row.sowing_date instead, the same way the area/plants
            // pair below picks its payload from lastEditedFieldRef rather
            // than trusting the grid's own row assembly.
            const crop = crops.find((item) => item.id === row.crop);
            const explicitPropagationStart = getExplicitPropagationStart(row, crop);
            const propagationStart = explicitPropagationStart ? toIsoDateString(row.sowing_date) : null;
            if (!explicitPropagationStart && lastEditedDateFieldRef.current === "sowing_date" && row.cultivation_type !== PURCHASED_TRANSPLANT) {
              const sowingDateIso = toIsoDateString(row.sowing_date);
              if (sowingDateIso) {
                plantingDate = getPlantingDateFromSowingDate(sowingDateIso, row, crop);
              }
            }
            lastEditedDateFieldRef.current = null;

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
              ...(row.isNew ? getSupplementalPlannedDates(row) : {}),
              ...(propagationStart && propagationStart !== explicitPropagationStart
                ? { planned_propagation_start_date: propagationStart } : {}),
              quantity: row.quantity,
              notes: row.notes || "",
              cultivation_type: row.cultivation_type ?? "",
            };
            if (row.parcel) {
              lastEditedFieldRef.current = null;
              return apiData;
            }
            // Determine which field to send based on last edit
            const source = lastEditedFieldRef.current || "area_m2";
            const autoAreaDraft = source === "area_m2" && isAutoAreaRequest(row.area_m2, t("plantingPlans:placeholders.maxKeyword"))
              ? await buildAvailableAreaDraft(row)
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
            if (!row.parcel && (!row.bed || row.bed === 0)) {
              errors.bed = t("plantingPlans:validation.bedRequired");
            }
            if (!row.cultivation_type) {
              errors.cultivation_type = t("plantingPlans:validation.cultivationTypeRequired");
            }
            return errors;
          }}
          onBeforeSaveRow={async (row, original) => {
            if (areaValidationDialogRef.current || suppressAreaValidationSaveRef.current) {
              return false;
            }
            if (original && !row.isNew &&
              DIRECT_PLAN_EDIT_FIELDS.every(field => row[field] === original[field]) &&
              toIsoDateString(row.planting_date) === toIsoDateString(original.planting_date) &&
              (row.sowing_date === undefined ||
                toIsoDateString(row.sowing_date) === (getRowSowingSchedule(original)?.sowingDate ?? null))
            ) {
              lastEditedDateFieldRef.current = null;
              lastEditedFieldRef.current = null;
              return 'unchanged';
            }
            const requestedAreaBeforeCheck = getRequestedAreaForValidation(row);
            const maxKeywordBeforeCheck = t("plantingPlans:placeholders.maxKeyword");
            if (requestedAreaBeforeCheck === null && !isAutoAreaRequest(row.area_m2, maxKeywordBeforeCheck)) {
              // No area to check: skip the request entirely.
              return true;
            }
            const capacity = await fetchCapacityForRow(row);
            if (!capacity) {
              return true;
            }
            const maxKeyword = t("plantingPlans:placeholders.maxKeyword");
            if (isAutoAreaRequest(row.area_m2, maxKeyword)) {
              if (capacity.availableArea > 0) {
                setAreaNotice({
                  severity: "info",
                  message: t("plantingPlans:areaValidation.maxAreaApplied", { area: formatAreaM2(capacity.availableArea, numberLocale) }),
                });
                lastEditedFieldRef.current = "area_m2";
                return buildAreaAndPlantsDraft(row, capacity.availableArea);
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
                successionLimit: capacity.successionLimit,
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
                successionLimit: capacity.successionLimit,
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
          addButtonLabel={t("plantingPlans:addButton")}
          addButtonText={t("plantingPlans:addButton")}
          showAddAction={false}
          showDeleteAction={false}
          showFooterEditControls={false}
          showRowEditActions={false}
          showPendingRowSaves
          inlineRowActionField="crop"
          showInlineRowActionMenu
          suspendRouteNavigationGuard={detailOpen}
          requireSavedBeforeNavigation={isPlantingPlanDetailPath}
          getRowActions={row => [
            ...getPlanNavigationActions(row).map(action => ({
              id: action.id,
              label: action.label,
              icon: action.icon,
              disabled: Boolean(action.disabledReason),
              disabledReason: action.disabledReason,
              onClick: (_row: PlantingPlanRow, _helpers: unknown, anchor?: HTMLElement | null) => action.activate(anchor),
            })),
            {
              id: "create-planting-plan",
              separatorBefore: true,
              label: t("plantingPlans:actions.createPlantingPlan"),
              icon: <AddIcon fontSize="small" />,
              color: "primary",
              onClick: () => handleCreatePlan(),
            },
            ...(!row.carried_over && !row.parcel ? [{
              id: "duplicate",
              label: t("common:actions.duplicate"),
              icon: <ContentCopyIcon fontSize="small" />,
              onClick: (row: PlantingPlanRow, helpers: EditableDataGridRowActionHelpers<PlantingPlanRow>) => helpers.duplicate(row),
            }] : []),
            ...(!row.carried_over ? [{
              id: "delete",
              label: t("common:actions.delete"),
              icon: <DeleteIcon fontSize="small" />,
              color: "error" as const,
              onClick: (row: PlantingPlanRow, helpers: EditableDataGridRowActionHelpers<PlantingPlanRow>) => helpers.delete(row.id),
            }] : []),
          ]}
          getInlineRowActions={getInlinePlanActions}
          duplicateRow={duplicatePlanRow}
          tableKey="plantingPlans"
          defaultSortModel={DEFAULT_PLAN_SORT}
          sortProjection={dateSortProjection}
          persistSortInUrl={true}
          columnVisibilityModel={columnVisibilityModel}
          onColumnVisibilityModelChange={setColumnVisibilityModel}
          columnsPanelOpen={isColumnsPanelOpen}
          onColumnsPanelOpenChange={setIsColumnsPanelOpen}
          columnsPanelAnchorEl={columnsAnchorEl}
          externalFilter={gridExternalFilter}
            notes={PLAN_NOTES}
          />
          </Box>
        </PageSurface>}

      </Box>

      <MobilePlanFormDialog
        open={isMobileCreateOpen}
        isEdit={mobileEditId !== null}
        form={mobileCreateForm}
        setForm={setMobileCreateForm}
        error={mobileCreateError}
        errorAction={
          mobileCreateErrorAction?.message === mobileCreateError ? mobileCreateErrorAction.action : undefined
        }
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
        getSowingDateDisabledReason={getMobileSowingDateDisabledReason}
        getSowingDateFromPlantingDate={getMobileSowingDateFromPlantingDate}
        getPlantingDateFromSowingDate={getMobilePlantingDateFromSowingDate}
        onLinkedFieldEdited={handleMobileLinkedFieldEdited}
        rotation={{
          planId: mobileEditId,
          cultureLabel: cropOptions.find((option) => String(option.value) === mobileCreateForm.crop)?.label ?? "",
          bedLabel: bedById.get(Number(mobileCreateForm.bed))?.name ?? "",
          acceptance: getRotationAcceptanceControls(mobileRotationKey),
        }}
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
        readOnly={Boolean(mobileNotesEditor.currentRow?.carried_over)}
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
      {isMobile ? (
        <PlantingPlanFilterSheet
          id={filterSheetId}
          open={isFilterPanelOpen}
          onClose={() => setIsFilterPanelOpen(false)}
          search={search}
        />
      ) : null}
    </PageContainer>
    </PlantingPlanSearchMatchContext.Provider>
    </SearchHighlightContext.Provider>
  );
}

export default PlantingPlans;
