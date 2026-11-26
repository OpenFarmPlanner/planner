import type { ReactNode } from 'react';
import { Divider, Menu } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";

import { useTranslation } from "../../i18n";
import { ContextMenuActionItem } from "../contextMenu/ContextMenuActionItem";
import { isIndividualPlacement } from "../../pages/individualPlantGeometry";
import type { PlantingPlanRow } from "../../pages/plantingPlansUtils";

export interface PlanMenuNavigationAction {
  id: string;
  label: string;
  icon: ReactNode;
  disabledReason?: string;
  activate: (anchor?: HTMLElement | null) => void;
}

interface MobilePlanActionsMenuProps {
  anchorEl: HTMLElement | null;
  /** The row the menu was opened for; actions are no-ops while it is null. */
  row: PlantingPlanRow | null;
  navigationActions?: PlanMenuNavigationAction[];
  onClose: () => void;
  onEdit: (row: PlantingPlanRow) => void;
  onDuplicate: (row: PlantingPlanRow) => void;
  onCopy: (row: PlantingPlanRow) => void;
  onDelete: (row: PlantingPlanRow) => void;
}

/**
 * Presentational per-card actions menu for the mobile planting-plan list.
 * Anchor/row state and the action handlers live in PlantingPlans.tsx; every
 * item closes the menu after delegating, matching the original inline JSX.
 */
export function MobilePlanActionsMenu({
  anchorEl,
  row,
  navigationActions = [],
  onClose,
  onEdit,
  onDuplicate,
  onCopy,
  onDelete,
}: MobilePlanActionsMenuProps) {
  const { t } = useTranslation(["plantingPlans", "common"]);

  const showAreaPlanActions = row === null || (!row.carried_over && !isIndividualPlacement(row));

  return (
    <Menu
      id="planting-plan-mobile-actions-menu"
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      slotProps={{ list: { disabledItemsFocusable: true } }}
    >
      {navigationActions.map(action => <ContextMenuActionItem key={action.id} label={action.label}
        icon={action.icon} disabled={Boolean(action.disabledReason)} disabledReason={action.disabledReason}
        onClick={() => { onClose(); action.activate(anchorEl); }} />)}
      {navigationActions.length > 0 && <Divider role="separator" />}
      {showAreaPlanActions && <ContextMenuActionItem
        label={t("common:actions.edit")}
        icon={<EditIcon fontSize="small" />}
        onClick={() => {
          if (row) {
            onEdit(row);
          }
          onClose();
        }}
      />}
      {showAreaPlanActions && <ContextMenuActionItem
        label={t("common:actions.duplicate")}
        icon={<ContentCopyIcon fontSize="small" />}
        onClick={() => {
          if (row) {
            onDuplicate(row);
          }
          onClose();
        }}
      />}
      <ContextMenuActionItem
        label={t("plantingPlans:actions.copyPlantingPlan")}
        icon={<ContentCopyIcon fontSize="small" />}
        onClick={() => {
          if (row) {
            onCopy(row);
          }
          onClose();
        }}
      />
      {!row?.carried_over && <Divider role="separator" />}
      {!row?.carried_over && <ContextMenuActionItem
        label={t("common:actions.delete")}
        icon={<DeleteIcon fontSize="small" />}
        color="error"
        onClick={() => {
          if (row) {
            onDelete(row);
          }
          onClose();
        }}
      />}
    </Menu>
  );
}
