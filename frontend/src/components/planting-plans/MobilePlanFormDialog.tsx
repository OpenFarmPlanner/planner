import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useRef } from "react";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";

import type { CultivationType } from "../../api/types";
import { useTranslation } from "../../i18n";
import {
  formatLocalizedNumberForInput,
  parseLocalizedNumber,
} from "../../utils/numberLocalization";
import type { SearchableSelectOption } from "../data-grid";
import { formatDateAsGerman, parseGermanDateText } from "../data-grid/dateEditCellUtils";
import { toIsoDateString } from "../data-grid/dateEditCellUtils";
import type { MobileCreateFormState } from "../../pages/plantingPlansUtils";
import type { CultivationTypeSelectOption } from "../../pages/usePlantingPlanHierarchy";
import { TypeaheadSelect as Select } from "../inputs/TypeaheadSelect";
import {
  compactFieldSx,
  formRowSx,
  fullWidthFieldSx,
  smallFieldSx,
  wideFieldSx,
} from "../forms/formLayout";

interface MobilePlanFormDialogProps {
  open: boolean;
  /** Edit mode changes only the title and submit label; the form is shared. */
  isEdit: boolean;
  form: MobileCreateFormState;
  setForm: Dispatch<SetStateAction<MobileCreateFormState>>;
  error: string;
  /** Optional fix-it action shown inside the error alert. */
  errorAction?: ReactNode;
  cropOptions: SearchableSelectOption[];
  bedOptions: SearchableSelectOption[];
  cultivationTypeOptions: CultivationTypeSelectOption[];
  numberLocale: string;
  /** Shown under the planting-date field to signal the active season's range. */
  plantingDateHelperText?: string;
  getPlantsPerSqm: (cropId: string) => number | null;
  /**
   * Whether the Aussaattermin field can be computed at all for the form's
   * current crop/cultivation_type (false only for Anzucht without a
   * resolvable propagation duration — not simply an empty planting date).
   */
  isSowingDateDisabled: (form: MobileCreateFormState) => boolean;
  /** Recomputes the Aussaattermin text from the form's current planting date. */
  getSowingDateFromPlantingDate: (form: MobileCreateFormState) => string;
  /** Recomputes the planting date text from the form's current Aussaattermin. */
  getPlantingDateFromSowingDate: (form: MobileCreateFormState) => string;
  /** Called when the user edits one of the two linked area/plants inputs. */
  onLinkedFieldEdited: (field: "area_m2" | "plants_count") => void;
  onClose: () => void;
  onSubmit: () => void;
}

/**
 * Presentational mobile create/edit/duplicate form for a planting plan.
 * All state (form draft, edit id, error) and the submit handlers live in
 * PlantingPlans.tsx; this component only renders the dialog and keeps the
 * area ↔ plants-count inputs in sync while typing.
 */
export function MobilePlanFormDialog({
  open,
  isEdit,
  form,
  setForm,
  error,
  errorAction,
  cropOptions,
  bedOptions,
  cultivationTypeOptions,
  numberLocale,
  plantingDateHelperText,
  getPlantsPerSqm,
  isSowingDateDisabled,
  getSowingDateFromPlantingDate,
  getPlantingDateFromSowingDate,
  onLinkedFieldEdited,
  onClose,
  onSubmit,
}: MobilePlanFormDialogProps) {
  const { t } = useTranslation(["plantingPlans", "common"]);
  const plantingDatePickerRef = useRef<HTMLInputElement | null>(null);
  const sowingDatePickerRef = useRef<HTMLInputElement | null>(null);

  const pickerValue = toIsoDateString(parseGermanDateText(form.planting_date)) ?? "";
  const openPlantingDatePicker = (): void => {
    const pickerInput = plantingDatePickerRef.current;
    if (!pickerInput) {
      return;
    }

    if (typeof pickerInput.showPicker === "function") {
      pickerInput.showPicker();
      return;
    }

    pickerInput.click();
  };

  const sowingDateDisabled = isSowingDateDisabled(form);
  const sowingPickerValue = toIsoDateString(parseGermanDateText(form.sowing_date)) ?? "";
  const openSowingDatePicker = (): void => {
    const pickerInput = sowingDatePickerRef.current;
    if (!pickerInput) {
      return;
    }

    if (typeof pickerInput.showPicker === "function") {
      pickerInput.showPicker();
      return;
    }

    pickerInput.click();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {isEdit ? t("plantingPlans:mobile.editTitle") : t("plantingPlans:mobile.createTitle")}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? (
            <Alert
              severity="error"
              action={errorAction}
              // The dialog is too narrow for the action beside the message,
              // so it gets its own line below the text.
              sx={{
                flexWrap: "wrap",
                "& .MuiAlert-message": { flex: "1 1 0", minWidth: 0 },
                "& .MuiAlert-action": { flexBasis: "100%", justifyContent: "flex-end", pt: 0, mr: 0 },
              }}
            >
              {error}
            </Alert>
          ) : null}
          <FormControl sx={wideFieldSx}>
            <InputLabel>{t("plantingPlans:columns.crop")}</InputLabel>
            <Select
              fullWidth
              value={form.crop}
              label={t("plantingPlans:columns.crop")}
              onChange={(event) =>
                setForm((previous) => {
                  const next = { ...previous, crop: String(event.target.value) };
                  return { ...next, sowing_date: getSowingDateFromPlantingDate(next) };
                })
              }
            >
              {cropOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl sx={wideFieldSx}>
            <InputLabel>{t("plantingPlans:columns.bed")}</InputLabel>
            <Select
              fullWidth
              value={form.bed}
              label={t("plantingPlans:columns.bed")}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, bed: String(event.target.value) }))
              }
            >
              {bedOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl sx={smallFieldSx}>
            <InputLabel>{t("plantingPlans:columns.cultivationType")}</InputLabel>
            <Select
              fullWidth
              value={form.cultivation_type}
              label={t("plantingPlans:columns.cultivationType")}
              onChange={(event) =>
                setForm((previous) => {
                  const next = { ...previous, cultivation_type: event.target.value as CultivationType };
                  return { ...next, sowing_date: getSowingDateFromPlantingDate(next) };
                })
              }
            >
              {cultivationTypeOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Box sx={formRowSx}>
            <TextField
              type="text"
              label={t("plantingPlans:columns.sowingDate")}
              placeholder={t('common:dateFormatPlaceholder')}
              value={form.sowing_date}
              disabled={sowingDateDisabled}
              onChange={(event) =>
                setForm((previous) => {
                  const next = { ...previous, sowing_date: event.target.value };
                  return { ...next, planting_date: getPlantingDateFromSowingDate(next) };
                })
              }
              helperText={sowingDateDisabled ? t("plantingPlans:tooltips.missingPropagationDuration") : undefined}
              sx={compactFieldSx}
              slotProps={{
                htmlInput: { inputMode: "numeric" },
                inputLabel: { shrink: true },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={t("plantingPlans:dateEditor.openCalendar")}
                        size="medium"
                        sx={{ width: 44, height: 44 }}
                        onClick={openSowingDatePicker}
                        disabled={sowingDateDisabled}
                      >
                        <CalendarTodayIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <input
              ref={sowingDatePickerRef}
              type="date"
              aria-hidden="true"
              tabIndex={-1}
              value={sowingPickerValue}
              onChange={(event) => {
                const nextValue = event.target.value ? new Date(`${event.target.value}T00:00:00`) : null;
                setForm((previous) => {
                  const next = { ...previous, sowing_date: formatDateAsGerman(nextValue) };
                  return { ...next, planting_date: getPlantingDateFromSowingDate(next) };
                });
              }}
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                opacity: 0,
                pointerEvents: "none",
              }}
            />
            <TextField
              type="text"
              label={t("plantingPlans:columns.plantingDate")}
              placeholder={t('common:dateFormatPlaceholder')}
              value={form.planting_date}
              onChange={(event) =>
                setForm((previous) => {
                  const next = { ...previous, planting_date: event.target.value };
                  return { ...next, sowing_date: getSowingDateFromPlantingDate(next) };
                })
              }
              helperText={plantingDateHelperText}
              sx={compactFieldSx}
              slotProps={{
                htmlInput: { inputMode: "numeric" },
                inputLabel: { shrink: true },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={t("plantingPlans:dateEditor.openCalendar")}
                        size="medium"
                        sx={{ width: 44, height: 44 }}
                        onClick={openPlantingDatePicker}
                      >
                        <CalendarTodayIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <input
              ref={plantingDatePickerRef}
              type="date"
              aria-hidden="true"
              tabIndex={-1}
              value={pickerValue}
              onChange={(event) => {
                const nextValue = event.target.value ? new Date(`${event.target.value}T00:00:00`) : null;
                setForm((previous) => {
                  const next = { ...previous, planting_date: formatDateAsGerman(nextValue) };
                  return { ...next, sowing_date: getSowingDateFromPlantingDate(next) };
                });
              }}
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                opacity: 0,
                pointerEvents: "none",
              }}
            />
            <TextField
              type="text"
              inputMode="decimal"
              label={t("plantingPlans:columns.areaM2")}
              value={form.area_m2}
              onChange={(event) => {
                const nextArea = event.target.value;
                const plantsPerSqm = getPlantsPerSqm(form.crop);
                const normalizedArea = nextArea.trim().toLowerCase();
                const maxKeyword = t("plantingPlans:placeholders.maxKeyword").toLowerCase();
                const parsedArea = normalizedArea === maxKeyword ? null : parseLocalizedNumber(nextArea, numberLocale);
                setForm((previous) => ({
                  ...previous,
                  area_m2: nextArea,
                  plants_count:
                    plantsPerSqm && parsedArea !== null
                      ? formatLocalizedNumberForInput(
                          Math.round(parsedArea * plantsPerSqm),
                          numberLocale,
                          { maximumFractionDigits: 0 },
                        )
                      : previous.plants_count,
                }));
                onLinkedFieldEdited("area_m2");
              }}
              placeholder={t("plantingPlans:placeholders.maxKeyword")}
              helperText={t("plantingPlans:tooltips.areaAutoMax")}
              slotProps={{ htmlInput: { inputMode: "decimal" } }}
              sx={compactFieldSx}
            />
            <TextField
              type="text"
              inputMode="numeric"
              label={t("plantingPlans:columns.plantsCount")}
              value={form.plants_count}
              onChange={(event) => {
                const nextPlants = event.target.value;
                const plantsPerSqm = getPlantsPerSqm(form.crop);
                const parsedPlants = parseLocalizedNumber(nextPlants, numberLocale);
                setForm((previous) => ({
                  ...previous,
                  plants_count: nextPlants,
                  area_m2:
                    plantsPerSqm && parsedPlants !== null
                      ? formatLocalizedNumberForInput(parsedPlants / plantsPerSqm, numberLocale, {
                          maximumFractionDigits: 2,
                        })
                      : previous.area_m2,
                }));
                onLinkedFieldEdited("plants_count");
              }}
              slotProps={{ htmlInput: { inputMode: "numeric" } }}
              sx={compactFieldSx}
            />
          </Box>
          <TextField
            label={t("common:fields.notes")}
            multiline
            minRows={3}
            value={form.notes}
            onChange={(event) =>
              setForm((previous) => ({ ...previous, notes: event.target.value }))
            }
            sx={fullWidthFieldSx}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button onClick={onSubmit} variant="contained">
          {isEdit ? t("common:actions.save") : t("common:actions.add")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
