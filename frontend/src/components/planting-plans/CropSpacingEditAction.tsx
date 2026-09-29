import { Button } from "@mui/material";
import { Link as RouterLink } from "react-router";

import { useTranslation } from "../../i18n";

interface CropSpacingEditActionProps {
  cropId: number;
}

/**
 * Alert action that opens a crop's edit view so the user can fill in the
 * spacing a planting plan needs to derive its area from a plant count.
 */
export function CropSpacingEditAction({ cropId }: CropSpacingEditActionProps) {
  const { t } = useTranslation("plantingPlans");
  return (
    <Button
      color="inherit"
      size="small"
      component={RouterLink}
      to={`/app/crops?cropId=${cropId}&action=edit`}
      data-testid="planting-plan-edit-crop-spacing"
      sx={{ whiteSpace: "nowrap" }}
    >
      {t("plantingPlans:errors.editCropSpacing")}
    </Button>
  );
}
