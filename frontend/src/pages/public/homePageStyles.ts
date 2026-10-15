import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';

// Hero typography is scaled up uniformly from the base sizes so the hero card
// can be tuned with a single factor.
const HERO_FONT_SCALE = 1.1;
export const heroRem = (baseRem: number): string => `${+(baseRem * HERO_FONT_SCALE).toFixed(3)}rem`;
export const heroWidth = (basePx: number): number => Math.round(basePx * HERO_FONT_SCALE);

export const HERO_ACTION_FONT_SIZE = { xs: heroRem(1.05), sm: heroRem(1.1) };

// Secondary hero action ("Demo"): a white pill on its own row below the
// Registrieren/Anmelden row. Surface, elevation and hover/focus states mirror
// the Anmelden button so the two read as the same family; the pill shape and
// missing border set it apart as the lower-commitment action.
export const HERO_DEMO_PILL_SX: SystemStyleObject<Theme> = {
  minHeight: 44,
  borderRadius: 999,
  px: { xs: 2.5, sm: 3 },
  py: 0.75,
  color: 'primary.main',
  bgcolor: 'surface.surfaceBackground',
  fontSize: HERO_ACTION_FONT_SIZE,
  fontWeight: 700,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  boxShadow: (theme) => theme.shadows[2],
  transition: 'transform 160ms ease, color 160ms ease, box-shadow 160ms ease, background-color 160ms ease',
  '& .MuiButton-startIcon': {
    mr: 0.75,
  },
  '&:hover, &.Mui-focusVisible': {
    transform: 'translateY(-1px)',
    color: 'primary.dark',
    bgcolor: (theme) => alpha(theme.palette.common.white, 0.92),
    boxShadow: (theme) => theme.shadows[4],
    textDecoration: 'none',
  },
  '&.Mui-disabled': {
    color: 'text.disabled',
    bgcolor: (theme) => alpha(theme.palette.common.white, 0.7),
    boxShadow: 'none',
  },
};

// While loading or retry-blocked the pill carries a full sentence instead of
// "Demo". On phones that sentence at hero size is wider than the hero card's
// content box, so it steps down to a compact size there; wider screens keep
// the hero size. The row sits last in the action stack, so growing never
// shifts the rows above.
export const HERO_DEMO_PILL_STATUS_SX: SystemStyleObject<Theme> = {
  maxWidth: '100%',
  px: { xs: 1.5, sm: 3 },
  fontSize: { xs: heroRem(0.9), sm: HERO_ACTION_FONT_SIZE.sm },
};
