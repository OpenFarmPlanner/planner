import { memo } from 'react';
import type { GridRenderEditCellParams } from '@mui/x-data-grid';
import { MenuItem, TextField } from '@mui/material';
import type { HierarchyRow } from './utils/types';
import { useSingleSelectEditCell } from '../data-grid/useSingleSelectEditCell';

/** The select value that clears the row's own value (inherit / not specified). */
export const INHERIT_VALUE = '';

export interface SiteConditionOption {
  value: string;
  label: string;
}

interface SiteConditionEditCellProps extends GridRenderEditCellParams<HierarchyRow> {
  options: SiteConditionOption[];
}

/**
 * Select edit cell of a site condition. The first option, "Inherit (…)",
 * clears the row's own value, which is the inline "Reset to inherited".
 */
export const SiteConditionEditCell = memo(function SiteConditionEditCell({
  id,
  field,
  value,
  hasFocus,
  api,
  options,
}: SiteConditionEditCellProps) {
  const normalizedValue = typeof value === 'string' ? value : INHERIT_VALUE;
  const { open, handleOpen, handleClose, handleSelectKeyDown, handleMenuKeyDown } =
    useSingleSelectEditCell<string>({ id, field, api, options, typeaheadValue: normalizedValue });

  return (
    <TextField
      select
      fullWidth
      size="small"
      autoFocus={hasFocus}
      value={normalizedValue}
      slotProps={{
        htmlInput: { tabIndex: hasFocus ? 0 : -1 },
        select: {
          displayEmpty: true,
          open,
          onClose: handleClose,
          onOpen: handleOpen,
          onKeyDown: handleSelectKeyDown,
          MenuProps: { slotProps: { list: { onKeyDown: handleMenuKeyDown } } },
          renderValue: (selected) => options.find((option) => option.value === selected)?.label ?? '',
        },
      }}
      onChange={async (event) => {
        await api.setEditCellValue({ id, field, value: event.target.value });
      }}
    >
      {options.map((option) => (
        <MenuItem key={option.value || 'inherit'} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </TextField>
  );
});
