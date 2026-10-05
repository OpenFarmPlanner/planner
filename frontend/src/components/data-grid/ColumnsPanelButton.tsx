import { Button } from '@mui/material';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';

interface ColumnsPanelButtonProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
}

/**
 * Opens/closes a `DataGrid`'s built-in "manage columns" panel (see the
 * `columnsPanelOpen`/`onColumnsPanelOpenChange` props on `EditableDataGrid`).
 * Styled like the Filter button it's meant to sit next to in a table's
 * search toolbar.
 */
export function ColumnsPanelButton({ open, onOpenChange, label }: ColumnsPanelButtonProps) {
  return (
    <Button
      variant="outlined"
      color="inherit"
      startIcon={<ViewColumnIcon fontSize="small" />}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => onOpenChange(!open)}
      sx={{ minHeight: 40 }}
    >
      {label}
    </Button>
  );
}
