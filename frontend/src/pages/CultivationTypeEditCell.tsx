import { memo } from "react";
import { Box, MenuItem, TextField } from "@mui/material";
import type { GridRenderEditCellParams } from "@mui/x-data-grid";
import { useSingleSelectEditCell } from "../components/data-grid/useSingleSelectEditCell";
import { normalizeCultivationType } from "./plantingPlansUtils";
import type { CultivationTypeSelectOption } from "./usePlantingPlanHierarchy";

interface CultivationTypeEditCellProps extends GridRenderEditCellParams {
  options: CultivationTypeSelectOption[];
  placeholder: string;
}

export const CultivationTypeEditCell = memo(function CultivationTypeEditCell({
  id,
  field,
  value,
  hasFocus,
  api,
  options,
  placeholder,
}: CultivationTypeEditCellProps) {
  const selectedValue = normalizeCultivationType(value) ?? "";
  const selectedOption = options.find((option) => option.value === selectedValue);
  const { open, handleOpen, handleClose, handleSelectKeyDown, handleMenuKeyDown } =
    useSingleSelectEditCell<string>({
      id,
      field,
      api,
      options,
      typeaheadValue: selectedValue,
    });

  return (
    <TextField
      select
      fullWidth
      size="small"
      autoFocus={hasFocus}
      value={selectedValue}
      slotProps={{
        htmlInput: {
          tabIndex: hasFocus ? 0 : -1,
        },
        select: {
          displayEmpty: true,
          open,
          onClose: handleClose,
          onOpen: handleOpen,
          onKeyDown: handleSelectKeyDown,
          MenuProps: {
            slotProps: {
              list: {
                onKeyDown: handleMenuKeyDown,
              },
            },
          },
          // The closed select sits in the narrow table column and shows the
          // short label; the menu lists the full labels and may be wider.
          renderValue: () => selectedOption?.shortLabel ?? (
            <Box
              component="span"
              sx={{
                display: "block",
                minWidth: 0,
                overflow: "hidden",
                color: "text.disabled",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {placeholder}
            </Box>
          ),
        },
      }}
      sx={{
        "& .MuiSelect-select": {
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        },
      }}
      onChange={async (event) => {
        await api.setEditCellValue({
          id,
          field,
          value: event.target.value,
        });
      }}
    >
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </TextField>
  );
}, (previous, next) => (
  previous.id === next.id
  && previous.field === next.field
  && previous.value === next.value
  && previous.hasFocus === next.hasFocus
  && previous.options === next.options
  && previous.placeholder === next.placeholder
));
