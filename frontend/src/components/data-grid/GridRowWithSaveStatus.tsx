import { forwardRef } from "react";
import { GridRow, type GridRowProps } from "@mui/x-data-grid";
import { useGridRowSaving } from "./GridRowSaveStatus";

export const GridRowWithSaveStatus = forwardRef<HTMLDivElement, GridRowProps>(function GridRowWithSaveStatus(props, ref) {
  const saving = useGridRowSaving(String(props.rowId));
  return <GridRow {...props} ref={ref} aria-busy={saving || undefined} />;
});
