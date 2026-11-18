import { useId } from 'react';
import { Box, Chip, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { FieldInfoIcon } from '../../crops/FieldInfoIcon';

export interface FilterChipOption<T extends string | number> {
  value: T;
  label: string;
}

interface FilterChipGroupProps<T extends string | number> {
  label: string;
  options: readonly FilterChipOption<T>[];
  selected: readonly T[];
  onChange: (selected: T[]) => void;
  hint?: string;
  /** Short explanation of the group, shown in an info tooltip next to its label. */
  info?: string;
}

const fieldLabelSx: SxProps<Theme> = { mb: 0.75, fontWeight: 600 };

/** A multi-select as toggle chips; selected values combine with OR (docs/search.md). */
export function FilterChipGroup<T extends string | number>({
  label,
  options,
  selected,
  onChange,
  hint,
  info,
}: FilterChipGroupProps<T>) {
  const labelId = useId();
  const toggle = (value: T): void => {
    onChange(selected.includes(value) ? selected.filter((entry) => entry !== value) : [...selected, value]);
  };

  return (
    <Box role="group" aria-labelledby={labelId}>
      {info ? (
        // The icon stays outside the labelling element, so the help text is
        // not part of the group's accessible name.
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75 }}>
          <Typography id={labelId} variant="body2" component="div" sx={{ fontWeight: 600 }}>
            {label}
          </Typography>
          <FieldInfoIcon title={info} />
        </Box>
      ) : (
        <Typography id={labelId} variant="body2" component="div" sx={fieldLabelSx}>
          {label}
        </Typography>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {options.map((option) => {
          const isSelected = selected.includes(option.value);
          return (
            <Chip
              key={String(option.value)}
              label={option.label}
              size="small"
              clickable
              color={isSelected ? 'primary' : 'default'}
              variant={isSelected ? 'filled' : 'outlined'}
              icon={isSelected ? <CheckIcon fontSize="small" /> : undefined}
              aria-pressed={isSelected}
              onClick={() => toggle(option.value)}
              sx={{ maxWidth: '100%' }}
            />
          );
        })}
        {options.length === 0 ? (
          <Typography variant="body2" color="text.disabled" aria-hidden="true">—</Typography>
        ) : null}
      </Box>
      {hint ? (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.75 }}>
          {hint}
        </Typography>
      ) : null}
    </Box>
  );
}
