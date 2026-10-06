/**
 * Edit cell for area_m2 field in PlantingPlans grid.
 *
 * Provides a numeric input for area editing with optional normalization on blur.
 */

import { memo, useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { TextField } from '@mui/material';
import { useGridApiContext } from '@mui/x-data-grid';
import type { GridRenderEditCellParams } from '@mui/x-data-grid';
import { getInitialInputValue } from './areaM2EditCellValue';
import { useEditCellNavigation } from './EditCellNavigationContext';
import { useEditCellAutoFocus } from './useEditCellAutoFocus';
import { forwardEditCellTabNavigation, useEditCellTabNavigation } from './useEditCellTabNavigation';

export interface AreaM2EditCellProps extends GridRenderEditCellParams {
  onLastEditedFieldChange: (field: 'area_m2', value: string) => void;
  fallbackValue?: number | null;
  locale: string;
  maxKeyword: string;
  maxPlaceholder: string;
}

function AreaM2EditCellComponent(props: AreaM2EditCellProps) {
  const {
    id,
    value,
    field,
    hasFocus,
    onLastEditedFieldChange,
    fallbackValue,
    locale,
    maxPlaceholder,
  } = props;
  const apiRef = useGridApiContext();
  const editCellNavigation = useEditCellNavigation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [inputValue, setInputValue] = useState<string>(
    () => getInitialInputValue(value, fallbackValue, locale)
  );
  const displayedInputValue = hasFocus
    ? inputValue
    : getInitialInputValue(value, fallbackValue, locale);

  const selectAll = useCallback((input: HTMLInputElement): void => {
    input.select();
  }, []);
  useEditCellAutoFocus(hasFocus, inputRef, selectAll);

  useEditCellTabNavigation(inputRef, editCellNavigation, id, field);

  const applyValue = async (nextValue: string): Promise<void> => {
    // Awaited before notifying the caller: a coupled-field live-update
    // started concurrently with this field's own setEditCellValue can lose
    // the race and get overwritten by it, since both read/clone the row's
    // edit-state snapshot independently (see docs/datagrid-architecture.md's
    // lastEditedDateFieldRef note on the same hazard).
    await apiRef.current.setEditCellValue({
      id,
      field,
      value: nextValue,
    });
    onLastEditedFieldChange('area_m2', nextValue);
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const val = e.target.value;
    setInputValue(val);
    await applyValue(val);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    forwardEditCellTabNavigation(event, editCellNavigation, id, field);
  };

  return (
    <TextField
      type="text"
      inputMode="decimal"
      inputRef={inputRef}
      value={displayedInputValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      size="small"
      fullWidth
      placeholder={maxPlaceholder}
      slotProps={{
        htmlInput: {
          min: 0,
          step: 0.01,
          tabIndex: 0,
        },
      }}
      sx={{
        minWidth: 96,
        flex: 1,
        '& .MuiInputBase-root': {
          height: '100%',
          outline: 'none',
          boxShadow: 'none',
        },
        '& .MuiOutlinedInput-notchedOutline': {
          border: 0,
        },
        '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': {
          border: 0,
        },
        '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
          border: 0,
        },
      }}
    />
  );
}

export const AreaM2EditCell = memo(AreaM2EditCellComponent, (previous, next) => (
  previous.id === next.id
  && previous.field === next.field
  && previous.value === next.value
  && previous.hasFocus === next.hasFocus
  && previous.fallbackValue === next.fallbackValue
  && previous.locale === next.locale
  && previous.maxKeyword === next.maxKeyword
  && previous.maxPlaceholder === next.maxPlaceholder
));
