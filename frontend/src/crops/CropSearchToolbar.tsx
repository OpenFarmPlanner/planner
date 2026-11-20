import type { MouseEventHandler, ReactNode } from 'react';
import { Badge, Box, IconButton, TextField, type TextFieldProps } from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import { AppTooltip } from '../components/AppTooltip';
import { useTranslation } from '../i18n';

export function CropSearchToolbar({ search: { endAdornment, ...search }, actions }: {
  search: Pick<TextFieldProps, 'id' | 'inputRef' | 'onBlur' | 'onChange' | 'onFocus' | 'size' | 'value'> & {
    placeholder: string;
    endAdornment?: ReactNode;
  };
  actions: ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      <Box sx={{ flex: '1 1 80px', minWidth: 0 }}>
        <TextField
          {...search}
          fullWidth
          slotProps={{ htmlInput: { 'aria-label': search.placeholder }, input: { endAdornment } }}
          sx={{ '& .MuiInputBase-input': {
            px: 1,
            fontSize: '0.875rem',
            '&::placeholder': { opacity: 1, color: 'text.secondary', textOverflow: 'ellipsis' },
          } }}
        />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0, ml: 'auto' }}>
        {actions}
      </Box>
    </Box>
  );
}

export function CropSearchFilterButton({ activeCount, open, popoverId, onClick, touch = false }: {
  activeCount: number;
  open: boolean;
  popoverId: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  touch?: boolean;
}) {
  const { t } = useTranslation('crops');
  const label = t('filters.openAdvanced');
  const size = touch ? 48 : 40;
  return (
    <AppTooltip title={label}>
      <IconButton
        size="small"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? popoverId : undefined}
        onClick={onClick}
        sx={{ width: size, height: size, bgcolor: activeCount > 0 ? 'action.selected' : 'transparent' }}
      >
        <Badge color="primary" badgeContent={activeCount} invisible={!activeCount}>
          <TuneIcon fontSize="small" />
        </Badge>
      </IconButton>
    </AppTooltip>
  );
}
