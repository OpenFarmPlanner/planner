import type { SxProps, Theme } from '@mui/material';

export const loadRetryAlertSx: SxProps<Theme> = {
  '& .MuiAlert-message': { minWidth: 0, overflowWrap: 'anywhere' },
};
