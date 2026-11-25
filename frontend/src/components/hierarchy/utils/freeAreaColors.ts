import { alpha, type Theme } from '@mui/material/styles';

export const freeAreaColor = (theme: Theme, kind: 'site' | 'parcel'): string => kind === 'site'
  ? alpha(theme.palette.info.main, 0.12)
  : alpha(theme.palette.success.main, 0.16);
