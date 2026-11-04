/**
 * Edit cell for searchable single-select fields in DataGrid.
 *
 * @remarks
 * Uses MUI Autocomplete to provide inline search for large option lists.
 *
 * @param props - Component props.
 * @param props.options - Select options with value and label.
 * @returns Autocomplete-based edit cell.
 */

import { useCallback, useMemo, useState } from 'react';
import { useGridApiContext } from '@mui/x-data-grid';
import type { GridRenderEditCellParams } from '@mui/x-data-grid';
import { SearchableSelect } from '../inputs/SearchableSelect';
import type { SearchableSelectOption } from '../inputs/SearchableSelect';
import { useSelectEditCellOpenRequest } from './SelectEditCellContext';

export interface SearchableSelectEditCellProps extends GridRenderEditCellParams {
  options: SearchableSelectOption[];
  onValueChange?: (nextValue: number | null) => Promise<void> | void;
  placeholder?: string;
}

export function SearchableSelectEditCell({
  id,
  value,
  field,
  options,
  onValueChange,
  placeholder,
  hasFocus,
}: SearchableSelectEditCellProps) {
  const apiRef = useGridApiContext();
  const [inputValue, setInputValue] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const handleOpen = useCallback((): void => {
    setOpen(true);
  }, []);
  const notifyMenuClose = useSelectEditCellOpenRequest(id, field, handleOpen);
  const handleClose = useCallback((event: unknown): void => {
    setOpen(false);
    setInputValue(null);
    notifyMenuClose(event);
  }, [notifyMenuClose]);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  );

  const resolvedInputValue = inputValue ?? selectedOption?.label ?? '';

  const handleChange = useCallback(async (newValue: SearchableSelectOption | null): Promise<void> => {
    const nextValue = newValue?.value ?? null;

    if (nextValue !== value) {
      await apiRef.current.setEditCellValue({
        id,
        field,
        value: nextValue,
      });
      await onValueChange?.(nextValue);
    }
  }, [apiRef, field, id, onValueChange, value]);

  return (
    <SearchableSelect
      options={options}
      value={selectedOption}
      inputValue={resolvedInputValue}
      onInputChange={setInputValue}
      onChange={(newValue) => {
        setInputValue(newValue?.label ?? '');
        void handleChange(newValue);
      }}
      placeholder={placeholder}
      size="small"
      autoFocus={hasFocus}
      inputTabIndex={hasFocus ? 0 : -1}
      textFieldSx={{
        height: '100%',
        '& .MuiAutocomplete-inputRoot.MuiOutlinedInput-root': {
          height: '100%',
          minHeight: 0,
          paddingBlock: 0,
        },
        '& .MuiAutocomplete-inputRoot.MuiOutlinedInput-root .MuiAutocomplete-input': {
          paddingBlock: 0,
        },
      }}
      open={open}
      onOpen={handleOpen}
      onClose={handleClose}
    />
  );
}

export type { SearchableSelectOption } from '../inputs/SearchableSelect';
