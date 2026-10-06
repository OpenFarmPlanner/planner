/**
 * Edit cell for plants_count field in PlantingPlans grid.
 * 
 * Keeps raw input text during editing and lets the save flow normalize it.
 */

import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { TextField } from '@mui/material';
import { useGridApiContext } from '@mui/x-data-grid';
import type { GridRenderEditCellParams } from '@mui/x-data-grid';
import type { Crop } from '../../api/types';
import { useEditCellNavigation } from './EditCellNavigationContext';
import { useEditCellAutoFocus } from './useEditCellAutoFocus';
import { forwardEditCellTabNavigation, useEditCellTabNavigation } from './useEditCellTabNavigation';

export interface PlantsCountEditCellProps extends GridRenderEditCellParams {
  crops: Crop[];
  onLastEditedFieldChange: (field: 'plants_count', value: string) => void;
  placeholder?: string;
}

export function PlantsCountEditCell(props: PlantsCountEditCellProps) {
  const { id, value, field, hasFocus, onLastEditedFieldChange, placeholder } = props;
  const apiRef = useGridApiContext();
  const editCellNavigation = useEditCellNavigation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [inputValue, setInputValue] = useState<string>(
    typeof value === 'number' && !isNaN(value) ? value.toString() : ''
  );
  const displayedInputValue = hasFocus
    ? inputValue
    : typeof value === 'number' && !isNaN(value) ? value.toString() : typeof value === 'string' ? value : '';

  const selectAll = useCallback((input: HTMLInputElement): void => {
    input.select();
  }, []);
  useEditCellAutoFocus(hasFocus, inputRef, selectAll);

  useEditCellTabNavigation(inputRef, editCellNavigation, id, field);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const val = e.target.value;
    setInputValue(val);
    // Awaited before notifying the caller: a coupled-field live-update
    // started concurrently with this field's own setEditCellValue can lose
    // the race and get overwritten by it, since both read/clone the row's
    // edit-state snapshot independently (see docs/datagrid-architecture.md's
    // lastEditedDateFieldRef note on the same hazard).
    await apiRef.current.setEditCellValue({
      id,
      field,
      value: val
    });

    onLastEditedFieldChange('plants_count', val);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    forwardEditCellTabNavigation(event, editCellNavigation, id, field);
  };
  
  return (
    <TextField
      type="text"
      inputMode="numeric"
      inputRef={inputRef}
      value={displayedInputValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      slotProps={{
        htmlInput: {
          min: 0,
          step: 1,
          tabIndex: 0,
        },
      }}
      size="small"
      fullWidth
      sx={{ '& .MuiInputBase-root': { height: '100%' } }}
    />
  );
}
