import { Box, Chip, IconButton, Link } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

export interface ActiveFilterChip {
  key: string;
  /** The filter's name, used in the remove button's accessible name. */
  filterLabel: string;
  label: string;
}

interface ActiveFilterChipsProps {
  chips: readonly ActiveFilterChip[];
  onRemove: (key: string) => void;
  onResetAll: () => void;
  groupAriaLabel: string;
  resetAllLabel: string;
  removeAriaLabel: (filterLabel: string) => string;
  /** Mobile keeps the chips on one horizontally scrolling line. */
  scrollable?: boolean;
  sx?: SxProps<Theme>;
}

/** The active filters as removable chips, plus a reset link. Renders nothing without filters. */
export function ActiveFilterChips({
  chips,
  onRemove,
  onResetAll,
  groupAriaLabel,
  resetAllLabel,
  removeAriaLabel,
  scrollable = false,
  sx,
}: ActiveFilterChipsProps) {
  if (chips.length === 0) {
    return null;
  }

  return (
    <Box
      role="group"
      aria-label={groupAriaLabel}
      sx={[
        {
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          flexWrap: scrollable ? 'nowrap' : 'wrap',
          overflowX: scrollable ? 'auto' : 'visible',
          scrollbarWidth: scrollable ? 'none' : undefined,
          py: 0.25,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {chips.map((chip) => (
        <Chip
          key={chip.key}
          size={scrollable ? 'medium' : 'small'}
          color="primary"
          variant="outlined"
          sx={{ flexShrink: 0, maxWidth: scrollable ? 'none' : '100%', pr: 0.25 }}
          label={(
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{chip.label}</Box>
              <IconButton
                size="small"
                aria-label={removeAriaLabel(chip.filterLabel)}
                onClick={() => onRemove(chip.key)}
                sx={{ p: scrollable ? 0.5 : 0.25, mr: -0.5, color: 'inherit' }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
          )}
        />
      ))}
      <Link
        component="button"
        type="button"
        variant="body2"
        onClick={onResetAll}
        sx={{ flexShrink: 0, whiteSpace: 'nowrap', ml: 0.5, minHeight: scrollable ? 32 : undefined }}
      >
        {resetAllLabel}
      </Link>
    </Box>
  );
}
