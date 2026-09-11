import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import type { TFunction } from "i18next";

import type { SelectedElement } from "./graphicalFieldsGeometry";

interface GraphicalFieldDetailsDialogProps {
  /** The dialog is open while this is non-null. */
  element: SelectedElement | null;
  onClose: () => void;
  t: TFunction<["fields", "common"]>;
}

/**
 * Presentational details dialog for a clicked field/bed on the graphical
 * map (name, location, parent field, area). Selection state lives in
 * GraphicalFields.tsx; this component only renders.
 */
export function GraphicalFieldDetailsDialog({
  element,
  onClose,
  t,
}: GraphicalFieldDetailsDialogProps) {
  return (
    <Dialog
      open={Boolean(element)}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle>
        {element
          ? t(`fields:graphical.details.${element.type}`)
          : ""}
      </DialogTitle>
      <DialogContent>
        {element ? (
          <Stack spacing={1} sx={{ mt: 1 }}>
            <Typography>
              {t("common:fields.name")}: {element.name}
            </Typography>
            <Typography>
              {t("fields:graphical.location")}: {element.locationName}
            </Typography>
            {element.parentName ? (
              <Typography>
                {t("fields:graphical.parentField")}:{" "}
                {element.parentName}
              </Typography>
            ) : null}
            {element.area !== null ? (
              <Typography>
                {t("fields:graphical.area")}: {element.area} {t('common:units.squareMeters')}
              </Typography>
            ) : null}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>
          {t("common:actions.close")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
