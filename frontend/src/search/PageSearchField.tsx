import type { KeyboardEvent, Ref } from 'react';
import { Box, IconButton, InputAdornment, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';

import { AppTooltip } from '../components/AppTooltip';

interface PageSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  placeholder: string;
  ariaLabel: string;
  clearLabel: string;
  inputRef?: Ref<HTMLInputElement>;
  /** `rounded` is the full-width pill used under the mobile app bar. */
  variant?: 'toolbar' | 'rounded';
  /** Keyboard shortcut shown inside the empty field, e.g. "/". */
  shortcutHint?: string;
  sx?: SxProps<Theme>;
}

const shortcutHintSx: SxProps<Theme> = {
  px: 0.75,
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 0.5,
  color: 'text.secondary',
  fontFamily: 'inherit',
  fontSize: '0.75rem',
  lineHeight: 1.5,
};

/**
 * The page search input: search icon, a clear button once there is text,
 * and Esc to clear. Page search lives on the page itself, never in the
 * topbar, which is reserved for a later app-wide search (see docs/search.md).
 */
export function PageSearchField({
  value,
  onChange,
  onClear,
  placeholder,
  ariaLabel,
  clearLabel,
  inputRef,
  variant = 'toolbar',
  shortcutHint,
  sx,
}: PageSearchFieldProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape' && value) {
      event.preventDefault();
      event.stopPropagation();
      onClear();
    }
  };

  let endAdornment = null;
  if (value) {
    endAdornment = (
      <InputAdornment position="end">
        <AppTooltip title={clearLabel}>
          <IconButton size="small" edge="end" aria-label={clearLabel} onClick={onClear}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </AppTooltip>
      </InputAdornment>
    );
  } else if (shortcutHint) {
    endAdornment = (
      <InputAdornment position="end" aria-hidden="true">
        <Box component="kbd" sx={shortcutHintSx}>{shortcutHint}</Box>
      </InputAdornment>
    );
  }

  return (
    <TextField
      size="small"
      type="search"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
      inputRef={inputRef}
      autoComplete="off"
      slotProps={{
        htmlInput: {
          'aria-label': ariaLabel,
          'aria-keyshortcuts': shortcutHint,
          enterKeyHint: 'search',
        },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
          endAdornment,
          sx: variant === 'rounded'
            ? { borderRadius: 5, bgcolor: 'background.paper', minHeight: 44 }
            : { bgcolor: 'background.paper' },
        },
      }}
      sx={[
        // The native search-cancel button would duplicate the clear button.
        { '& input::-webkit-search-cancel-button': { display: 'none' } },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
}
