import { forwardRef } from 'react';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import { ResponsiveToolbarAction } from '../buttons/ResponsiveToolbarAction';

interface ColumnsPanelButtonProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  labelQuery?: string;
}

/**
 * Opens/closes a `DataGrid`'s built-in "manage columns" panel (see the
 * `columnsPanelOpen`/`onColumnsPanelOpenChange` props on `EditableDataGrid`).
 * Styled like the Filter button it's meant to sit next to in a table's
 * search toolbar.
 *
 * Forwards its ref so callers can anchor the panel to this button (see
 * `columnsPanelAnchorEl` on `EditableDataGrid`) instead of letting MUI fall
 * back to anchoring the panel at the grid's own top-right corner.
 */
export const ColumnsPanelButton = forwardRef<HTMLButtonElement, ColumnsPanelButtonProps>(
  function ColumnsPanelButton({ open, onOpenChange, label, labelQuery }, ref) {
    return (
      <ResponsiveToolbarAction
        ref={ref}
        variant="outlined"
        color="inherit"
        icon={<ViewColumnIcon fontSize="small" />}
        label={label}
        labelQuery={labelQuery}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        onPointerUp={(event) => {
          // The panel's click-away handler also reacts to this pointerup.
          // Without stopping it here, re-clicking this button while the panel
          // is open would close it via click-away and then reopen it via our
          // own onClick a tick later. Mirrors MUI's own ColumnsPanelTrigger.
          if (open) {
            event.stopPropagation();
          }
        }}
      />
    );
  },
);
