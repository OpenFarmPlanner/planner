import { useEffect, useId, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  IconButton,
  Stack,
  SwipeableDrawer,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useTranslation } from "../../../i18n";
import { useOverlayHistory } from "../../../hooks/useOverlayHistory";
import { ConfirmationDialog } from "../../feedback/ConfirmationDialog";
import { CustomContextMenu } from "../../contextMenu/CustomContextMenu";
import { ContextMenuActionItem } from "../../contextMenu/ContextMenuActionItem";
import { renderGroupedContextMenuActions } from "../../contextMenu/contextMenuGroups";
import { calculateAreaValue } from "../utils/dimensionCellState";
import {
  classifyHierarchyValidationError,
  validateAndSaveHierarchyRow,
  type HierarchyRowSaveDeps,
  type HierarchyValidationErrorField,
} from "../utils/hierarchyRowSave";
import {
  formatLocalizedNumberForInput,
  parseLocalizedNumber,
  resolveLocaleFromLanguage,
} from "../../../utils/numberLocalization";
import type { HierarchyRow } from "../utils/types";
import type { MobileHierarchyRow } from "../hooks/useMobileHierarchyRows";
import type { HierarchyRowAction } from "../hooks/useMobileHierarchyRowOperations";

/** Keeps the bottom button clear of the home indicator on notched phones. */
const SAFE_AREA_BOTTOM = "env(safe-area-inset-bottom, 0px)";

export interface HierarchyEditSheetCreateContext {
  nodeType: "field" | "bed";
  parentId: number;
  locationId?: number;
}

export interface HierarchyEditSheetAncestor {
  id: string | number;
  name: string;
}

interface HierarchyEditSheetProps {
  open: boolean;
  /** Raw close, bypassing the dirty check - only call after a clean-close decision has been made. */
  onClose: () => void;
  mode: "edit" | "create";
  row: MobileHierarchyRow | null;
  createContext?: HierarchyEditSheetCreateContext;
  ancestors: HierarchyEditSheetAncestor[];
  rowActions: HierarchyRowAction[];
  onSaved: (savedRow: HierarchyRow) => void;
  saveDeps: Omit<HierarchyRowSaveDeps, "mode">;
}

interface SheetFormValues {
  name: string;
  length: string;
  width: string;
  notes: string;
}

const EMPTY_VALUES: SheetFormValues = { name: "", length: "", width: "", notes: "" };

function buildInitialValues(
  mode: "edit" | "create",
  row: MobileHierarchyRow | null,
  locale: string,
): SheetFormValues {
  if (mode === "create" || !row) {
    return EMPTY_VALUES;
  }
  return {
    name: row.name ?? "",
    length: typeof row.length_m === "number" ? formatLocalizedNumberForInput(row.length_m, locale) : "",
    width: typeof row.width_m === "number" ? formatLocalizedNumberForInput(row.width_m, locale) : "",
    notes: row.notes ?? "",
  };
}

export function HierarchyEditSheet({
  open,
  onClose,
  mode,
  row,
  createContext,
  ancestors,
  rowActions,
  onSaved,
  saveDeps,
}: HierarchyEditSheetProps) {
  const { t, i18n } = useTranslation(["hierarchy", "common"]);
  const titleId = useId();
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage ?? i18n.language);

  const nodeType = mode === "create" ? createContext?.nodeType ?? "field" : row?.type ?? "field";

  const [values, setValues] = useState<SheetFormValues>(() => buildInitialValues(mode, row, locale));
  const [initialValues, setInitialValues] = useState<SheetFormValues>(() => buildInitialValues(mode, row, locale));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<HierarchyValidationErrorField, string>>>({});
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextValues = buildInitialValues(mode, row, locale);
    setValues(nextValues);
    setInitialValues(nextValues);
    setFieldErrors({});
    setConfirmDiscardOpen(false);
    // Only re-derive when the sheet (re)opens for a given row/mode - not on
    // every keystroke, which would reset the form the user is typing into.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, row?.id]);

  const isDirty = useMemo(
    () =>
      values.name !== initialValues.name ||
      values.length !== initialValues.length ||
      values.width !== initialValues.width ||
      values.notes !== initialValues.notes,
    [values, initialValues],
  );

  const requestClose = (): void => {
    if (!isDirty) {
      onClose();
      return;
    }
    setConfirmDiscardOpen(true);
  };

  useOverlayHistory({ open, onClose: requestClose, historyKey: "hierarchyEditSheet" });

  const liveArea = useMemo(() => {
    if (nodeType !== "field" && nodeType !== "bed") {
      return undefined;
    }
    const parsedLength = parseLocalizedNumber(values.length, locale);
    const parsedWidth = parseLocalizedNumber(values.width, locale);
    const probeRow: HierarchyRow = {
      id: "probe",
      type: nodeType,
      level: 0,
      length_m: parsedLength,
      width_m: parsedWidth,
      area_sqm: mode === "edit" ? row?.area_sqm : undefined,
    };
    const area = calculateAreaValue(probeRow);
    const numericArea = typeof area === "number" ? area : Number(area);
    return Number.isFinite(numericArea) ? numericArea : undefined;
  }, [nodeType, values.length, values.width, locale, mode, row?.area_sqm]);

  const breadcrumb = ancestors.length
    ? ancestors.map((ancestor) => ancestor.name).join(" › ")
    : t("hierarchy:mobile.sheet.topLevel");

  const typeLabel = t(`hierarchy:mobile.typeLabel.${nodeType}`);
  const title =
    mode === "edit"
      ? t("hierarchy:mobile.sheet.editTitle", { type: typeLabel })
      : t("hierarchy:mobile.sheet.createTitle", { type: typeLabel });

  const buildRowForSave = (): HierarchyRow => {
    const parsedLength = parseLocalizedNumber(values.length, locale);
    const parsedWidth = parseLocalizedNumber(values.width, locale);

    if (mode === "edit" && row) {
      return {
        ...row,
        name: values.name,
        length_m: parsedLength,
        width_m: parsedWidth,
        notes: values.notes,
      };
    }

    return {
      id: -Date.now(),
      type: createContext?.nodeType ?? "field",
      level: 0,
      name: values.name,
      length_m: parsedLength,
      width_m: parsedWidth,
      notes: values.notes,
      locationId: createContext?.nodeType === "field" ? createContext.parentId : createContext?.locationId,
      fieldId: createContext?.nodeType === "bed" ? createContext.parentId : undefined,
      field: createContext?.nodeType === "bed" ? createContext.parentId : undefined,
    };
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setFieldErrors({});
    try {
      const builtRow = buildRowForSave();
      const result = await validateAndSaveHierarchyRow(builtRow, {
        ...saveDeps,
        mode: mode === "create" ? "create" : "update",
      });
      onSaved(result);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("errors.save");
      const field = classifyHierarchyValidationError(message, t);
      setFieldErrors({ [field]: message });
    } finally {
      setSaving(false);
    }
  };

  const handleDiscardKeep = (): void => setConfirmDiscardOpen(false);
  const handleDiscardConfirm = (): void => {
    setConfirmDiscardOpen(false);
    onClose();
  };

  return (
    <>
      <SwipeableDrawer
        anchor="bottom"
        open={open}
        disableSwipeToOpen
        onOpen={() => {}}
        onClose={requestClose}
        slotProps={{
          paper: {
            id: titleId,
            role: "dialog",
            "aria-modal": true,
            "aria-labelledby": titleId,
            sx: {
              borderTopLeftRadius: (theme) => theme.spacing(2),
              borderTopRightRadius: (theme) => theme.spacing(2),
              maxHeight: "85dvh",
              display: "flex",
              flexDirection: "column",
              paddingBottom: SAFE_AREA_BOTTOM,
            },
          },
        }}
      >
        <Box
          aria-hidden="true"
          sx={{ width: 40, height: 4, borderRadius: 1, bgcolor: "divider", mx: "auto", mt: 1, flexShrink: 0 }}
        />
        <Stack
          direction="row"
          sx={{ alignItems: "center", justifyContent: "space-between", px: 2, pt: 1, pb: 0.5, flexShrink: 0 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {breadcrumb}
            </Typography>
            <Typography id={titleId} variant="h6" component="h2">
              {title}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
            {mode === "edit" && rowActions.length > 0 ? (
              <IconButton
                aria-label={t("common:actions.moreActions")}
                onClick={(event) => setMenuAnchorEl(event.currentTarget)}
              >
                <MoreVertIcon />
              </IconButton>
            ) : null}
            <IconButton aria-label={t("common:actions.close")} onClick={requestClose}>
              <CloseIcon />
            </IconButton>
          </Stack>
        </Stack>

        <Box sx={{ px: 2, pb: 2, overflowY: "auto", flex: "1 1 auto", minHeight: 0 }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {fieldErrors.general ? <Alert severity="error">{fieldErrors.general}</Alert> : null}

            <TextField
              fullWidth
              label={t("hierarchy:columns.name")}
              value={values.name}
              onChange={(event) => setValues((prev) => ({ ...prev, name: event.target.value }))}
              error={Boolean(fieldErrors.name)}
              helperText={fieldErrors.name}
              autoFocus={mode === "create"}
            />

            {nodeType === "field" || nodeType === "bed" ? (
              <>
                <Stack direction="row" spacing={2}>
                  <TextField
                    sx={{ flex: 1 }}
                    label={t("hierarchy:columns.length")}
                    value={values.length}
                    onChange={(event) => setValues((prev) => ({ ...prev, length: event.target.value }))}
                    error={Boolean(fieldErrors.length)}
                    helperText={fieldErrors.length}
                    slotProps={{ htmlInput: { inputMode: "decimal" } }}
                  />
                  <TextField
                    sx={{ flex: 1 }}
                    label={t("hierarchy:columns.width")}
                    value={values.width}
                    onChange={(event) => setValues((prev) => ({ ...prev, width: event.target.value }))}
                    error={Boolean(fieldErrors.width)}
                    helperText={fieldErrors.width}
                    slotProps={{ htmlInput: { inputMode: "decimal" } }}
                  />
                </Stack>
                <Typography variant="body2" color={fieldErrors.area ? "error" : "text.secondary"}>
                  {t("hierarchy:mobile.sheet.calculatedArea")}:{" "}
                  {liveArea !== undefined
                    ? `${formatLocalizedNumberForInput(liveArea, locale)} ${t("common:units.squareMeters")}`
                    : "—"}
                </Typography>
                {fieldErrors.area ? (
                  <Typography variant="body2" color="error">{fieldErrors.area}</Typography>
                ) : null}
              </>
            ) : (
              <Typography color="text.secondary">
                {t("hierarchy:mobile.sheet.locationNoDimensions")}
              </Typography>
            )}

            <TextField
              fullWidth
              multiline
              minRows={3}
              label={t("hierarchy:columns.notes")}
              value={values.notes}
              onChange={(event) => setValues((prev) => ({ ...prev, notes: event.target.value }))}
            />
          </Stack>
        </Box>

        <Box sx={{ px: 2, py: 1.5, borderTop: "1px solid", borderColor: "divider", flexShrink: 0 }}>
          <Stack direction="row" spacing={1.5}>
            <Button variant="outlined" fullWidth onClick={requestClose} disabled={saving}>
              {t("common:actions.cancel")}
            </Button>
            <Button variant="contained" fullWidth onClick={() => void handleSave()} disabled={saving}>
              {t("common:actions.save")}
            </Button>
          </Stack>
        </Box>
      </SwipeableDrawer>

      <CustomContextMenu
        open={menuAnchorEl !== null}
        onClose={() => setMenuAnchorEl(null)}
        anchorEl={menuAnchorEl ?? undefined}
        keyboardNavigation
      >
        {renderGroupedContextMenuActions(rowActions, (action) => (
          <ContextMenuActionItem
            key={action.id}
            label={action.label}
            icon={action.icon}
            color={action.color === "error" ? "error" : undefined}
            emphasized={action.emphasized}
            shortcutHint={action.shortcutHint}
            renderPlainWhenUnadorned
            onClick={() => {
              setMenuAnchorEl(null);
              action.onClick();
            }}
          />
        ))}
      </CustomContextMenu>

      <ConfirmationDialog
        open={confirmDiscardOpen}
        title={t("hierarchy:mobile.sheet.discardTitle")}
        message={t("hierarchy:mobile.sheet.discardMessage")}
        cancelLabel={t("hierarchy:mobile.sheet.discardKeep")}
        confirmLabel={t("hierarchy:mobile.sheet.discardConfirm")}
        onCancel={handleDiscardKeep}
        onConfirm={handleDiscardConfirm}
        cancelButtonProps={{ variant: "contained" }}
        confirmButtonProps={{ color: "error" }}
        disableBackdropClose
      />
    </>
  );
}
