import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { TFunction } from "i18next";
import { useNavigate } from "react-router";
import AgricultureIcon from "@mui/icons-material/Agriculture";
import DeleteIcon from "@mui/icons-material/Delete";
import type { Bed, Field, Location } from "../../../api/api";
import { HierarchyAddIcon } from "../HierarchyAddIcon";
import { useBedOperations } from "./useBedOperations";
import { useHierarchyDelete } from "./useHierarchyDelete";
import type { HierarchyRow } from "../utils/types";
import type { MobileHierarchyRow } from "./useMobileHierarchyRows";

export interface HierarchyRowAction {
  id: string;
  label: string;
  group: "create" | "destructive";
  color?: "default" | "error";
  onClick: () => void;
  emphasized?: boolean;
  icon?: React.ReactNode;
  shortcutHint?: string;
}

export interface MobileCreateSheetRequest {
  nodeType: "field" | "bed";
  parentId: number;
}

interface UseMobileHierarchyRowOperationsParams {
  locations: Location[];
  fields: Field[];
  beds: Bed[];
  expandedRows: Set<string | number>;
  fetchData: (options?: { showLoading?: boolean }) => Promise<void>;
  expandAll: (ids: (string | number)[]) => void;
  setLocations: Dispatch<SetStateAction<Location[]>>;
  setFields: Dispatch<SetStateAction<Field[]>>;
  setBeds: Dispatch<SetStateAction<Bed[]>>;
  setSelectedRowId: Dispatch<SetStateAction<string | number | null>>;
  setError: (error: string) => void;
  onPendingDeletionCountChange?: (count: number) => void;
  t: TFunction;
}

/**
 * Mobile counterpart to the bed/delete operations + per-row action list
 * `FieldsBedsHierarchy.tsx` builds around `useBedOperations`/`useHierarchyDelete`.
 * The "add field"/"add bed" actions open the create sheet instead of a
 * DataGrid draft row, since the mobile create flow never creates a
 * placeholder negative-id row first.
 */
export function useMobileHierarchyRowOperations({
  locations,
  fields,
  beds,
  expandedRows,
  fetchData,
  expandAll,
  setLocations,
  setFields,
  setBeds,
  setSelectedRowId,
  setError,
  onPendingDeletionCountChange,
  t,
}: UseMobileHierarchyRowOperationsParams) {
  const navigate = useNavigate();

  const { saveBed } = useBedOperations(setBeds, setError, t);

  const {
    pendingDeletions,
    deleteHierarchyRowWithUndo,
    undoPendingDeletion,
    closePendingDeletionSnackbar,
  } = useHierarchyDelete({
    locations,
    fields,
    beds,
    expandedRows,
    fetchData,
    expandAll,
    setLocations,
    setFields,
    setBeds,
    setSelectedRowId,
    setError,
    onPendingDeletionCountChange,
    t,
  });

  const handleCreatePlantingPlan = useCallback(
    (bedId: number): void => {
      navigate(`/app/planting-plans?bedId=${bedId}`);
    },
    [navigate],
  );

  const getHierarchyRowActions = useCallback(
    (
      row: HierarchyRow | MobileHierarchyRow,
      openCreateSheet: (request: MobileCreateSheetRequest) => void,
    ): HierarchyRowAction[] => {
      const createActions: HierarchyRowAction[] = [];

      if (row.type === "location" && row.locationId) {
        createActions.push({
          id: "add-field",
          label: t("actions.addField"),
          group: "create",
          onClick: () => openCreateSheet({ nodeType: "field", parentId: row.locationId! }),
          emphasized: true,
          icon: <HierarchyAddIcon interactive={false} ariaHidden />,
          shortcutHint: t("actions.addShortcutHint"),
        });
      }

      if (row.type === "field" && row.fieldId) {
        createActions.push({
          id: "add-bed",
          label: t("actions.addBed"),
          group: "create",
          onClick: () => openCreateSheet({ nodeType: "bed", parentId: row.fieldId! }),
          emphasized: true,
          icon: <HierarchyAddIcon interactive={false} ariaHidden />,
          shortcutHint: t("actions.addShortcutHint"),
        });
      }

      if (row.type === "bed" && row.bedId) {
        createActions.push({
          id: "create-planting-plan",
          label: t("createPlantingPlan"),
          group: "create",
          icon: <AgricultureIcon fontSize="small" />,
          onClick: () => handleCreatePlantingPlan(row.bedId!),
        });
      }

      const destructiveActions: HierarchyRowAction[] = [{
        id: "delete",
        label: t("common:actions.delete"),
        group: "destructive",
        color: "error",
        icon: <DeleteIcon fontSize="small" sx={{ color: "error.main" }} />,
        onClick: () => {
          void deleteHierarchyRowWithUndo(row);
        },
      }];

      return [...createActions, ...destructiveActions];
    },
    [deleteHierarchyRowWithUndo, handleCreatePlantingPlan, t],
  );

  return {
    saveBed,
    pendingDeletions,
    deleteHierarchyRowWithUndo,
    undoPendingDeletion,
    closePendingDeletionSnackbar,
    handleCreatePlantingPlan,
    getHierarchyRowActions,
  };
}
