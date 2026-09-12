import { alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

export const authPrimaryButtonSx: SxProps<Theme> = {
  minHeight: 46,
  borderRadius: 2,
  px: { xs: 2, sm: 3.2 },
  whiteSpace: 'nowrap',
  boxShadow: 3,
  transition: 'transform 160ms ease, box-shadow 160ms ease',
  '&:hover': {
    transform: 'translateY(-1px)',
    boxShadow: 5,
  },
  '&:focus-visible': {
    outline: (theme) => `3px solid ${alpha(theme.palette.primary.main, 0.35)}`,
    outlineOffset: 2,
  },
};

export const authSecondaryButtonSx: SxProps<Theme> = {
  minHeight: 46,
  borderRadius: 2,
  px: { xs: 2, sm: 3.2 },
  color: 'primary.main',
  borderColor: 'surface.surfaceBackground',
  bgcolor: 'surface.surfaceBackground',
  whiteSpace: 'nowrap',
  boxShadow: 2,
  transition: 'transform 160ms ease, color 160ms ease, box-shadow 160ms ease, background-color 160ms ease',
  '&:hover': {
    transform: 'translateY(-1px)',
    color: 'primary.dark',
    borderColor: 'surface.surfaceBackground',
    bgcolor: (theme) => alpha(theme.palette.surface?.surfaceBackground ?? theme.palette.background.paper, 0.92),
    boxShadow: 4,
  },
  '&:focus-visible': {
    outline: (theme) => `3px solid ${alpha(theme.palette.primary.main, 0.35)}`,
    outlineOffset: 2,
  },
};

export const authTextButtonSx: SxProps<Theme> = {
  minHeight: 40,
  borderRadius: 2,
  fontWeight: 600,
  color: 'primary.dark',
  textAlign: 'center',
  whiteSpace: 'normal',
  '&:hover': {
    bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
  },
  '&:focus-visible': {
    outline: (theme) => `3px solid ${alpha(theme.palette.primary.main, 0.28)}`,
    outlineOffset: 2,
  },
};

export const authTextFieldSx: SxProps<Theme> = {
  '& .MuiOutlinedInput-root': {
    borderRadius: 2,
    bgcolor: 'surface.surfaceBackground',
  },
  '& .MuiInputAdornment-root': {
    mr: -0.5,
  },
};

export const authFormSx: SxProps<Theme> = {
  width: '100%',
};

export const authLegalLinkSx: SxProps<Theme> = {
  color: 'text.primary',
  transition: 'color 160ms ease',
  '&:visited': {
    color: 'text.primary',
  },
  '&:hover': {
    color: 'primary.dark',
  },
  '&:focus-visible': {
    color: 'primary.dark',
    outline: (theme) => `2px solid ${alpha(theme.palette.primary.main, 0.32)}`,
    outlineOffset: 3,
    borderRadius: 0.5,
  },
};
