import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";

import { useTranslation } from "../../i18n";
import { formatAreaM2 } from "../../pages/plantingPlansUtils";
import type { AreaValidationDialogState } from "../../pages/useAreaValidationDialog";

interface AreaValidationDialogProps {
  dialog: AreaValidationDialogState;
  numberLocale: string;
  onClose: () => void;
  onCommit: (dialog: AreaValidationDialogState) => Promise<void> | void;
}

/**
 * Presentational dialog explaining why a requested planting area was clamped
 * and offering to apply the bed/remaining area instead. State and the commit
 * handler live in PlantingPlans.tsx; this component only renders.
 */
export function AreaValidationDialog({
  dialog,
  numberLocale,
  onClose,
  onCommit,
}: AreaValidationDialogProps) {
  const { t } = useTranslation(["plantingPlans", "common"]);

  return (
    <Dialog
      open
      onClose={onClose}
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle>
        {dialog.mode === "bedLimit"
          ? t("plantingPlans:areaValidation.bedLimitTitle")
          : dialog.mode === "noRemainingArea"
            ? t("plantingPlans:areaValidation.noRemainingTitle")
            : t("plantingPlans:areaValidation.remainingLimitTitle")}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1}>
          {dialog.mode !== "bedLimit" && dialog.successionLimit ? (
            <Typography data-testid="area-validation-succession-limit">
              {t("plantingPlans:areaValidation.successionLimit", {
                count: dialog.successionLimit.min_days_after_harvest_start,
                crop: dialog.successionLimit.crop_label,
                date: new Date(`${dialog.successionLimit.harvest_start_date}T00:00:00`).toLocaleDateString(numberLocale),
              })}
            </Typography>
          ) : null}
          {dialog.mode !== "bedLimit" && (
            <Typography sx={{ whiteSpace: "nowrap" }}>{t("plantingPlans:areaValidation.availableArea", { area: formatAreaM2(dialog.availableArea, numberLocale) })}</Typography>
          )}
          <Typography sx={{ whiteSpace: "nowrap" }}>{t("plantingPlans:areaValidation.bedArea", { area: formatAreaM2(dialog.bedArea, numberLocale) })}</Typography>
          {dialog.mode !== "bedLimit" && (
            <Typography sx={{ whiteSpace: "nowrap" }}>{t("plantingPlans:areaValidation.occupiedArea", { area: formatAreaM2(dialog.occupiedArea, numberLocale) })}</Typography>
          )}
          {dialog.mode !== "noRemainingArea" && (
            <Typography sx={{ whiteSpace: "nowrap" }}>{t("plantingPlans:areaValidation.requestedArea", { area: formatAreaM2(dialog.requestedArea, numberLocale) })}</Typography>
          )}
          {dialog.mode !== "noRemainingArea" && (
            <Typography sx={{ whiteSpace: "nowrap", fontWeight: 700 }}>
              {t("plantingPlans:areaValidation.acceptedArea", {
                area: formatAreaM2(
                  dialog.mode === "bedLimit"
                    ? dialog.bedArea
                    : dialog.availableArea,
                  numberLocale,
                ),
              })}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        {dialog.mode !== "noRemainingArea" && (
          <Button
            variant="contained"
            color="success"
            onClick={async () => {
              await onCommit(dialog);
            }}
          >
            {dialog.mode === "bedLimit"
              ? t("plantingPlans:areaValidation.applyBedArea")
              : t("plantingPlans:areaValidation.applyRemainingArea")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
