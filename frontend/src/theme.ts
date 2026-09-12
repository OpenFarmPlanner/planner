// Central MUI theme configuration
// Controls colors, shapes, and component style overrides.
import { alpha, createTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import type {} from '@mui/x-data-grid/themeAugmentation';

const surfaceColors = {
  rootBackground: '#f7f6f1',
  appBackground: '#ffffff',
  sidebarBackground: '#ffffff',
  topbarBackground: '#ffffff',
  contentBackground: '#faf9f5',
  surfaceBackground: '#ffffff',
  surfaceSubtleBackground: '#f8faf6',
  surfaceHoverBackground: '#f3f7f0',
  surfaceBorder: '#e7e1d6',
  surfaceSoftBorder: '#ece8df',
} as const;

// Blends a color at the given alpha over a white surface, producing a fully
// opaque color that still reads as the same tint. Toasts render as overlays
// on top of arbitrary page content (table rows, alternating stripes, etc.),
// so a real rgba/alpha background lets that content show through and makes
// the toast text hard to read — flattening to opaque avoids that.
const flattenOnWhite = (hex: string, alphaValue: number) => {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.substring(0, 2), 16);
  const g = parseInt(normalized.substring(2, 4), 16);
  const b = parseInt(normalized.substring(4, 6), 16);
  const blend = (channel: number) => Math.round(channel * alphaValue + 255 * (1 - alphaValue));
  return `rgb(${blend(r)}, ${blend(g)}, ${blend(b)})`;
};

const createPositiveFilledAlertStyles = (theme: Theme) => ({
  backgroundColor: theme.palette.primary.main,
  color: theme.palette.primary.contrastText,
  '& .MuiAlert-icon': {
    color: theme.palette.primary.contrastText,
  },
  '& .MuiAlert-action': {
    color: theme.palette.primary.contrastText,
  },
  '& .MuiIconButton-root': {
    color: theme.palette.primary.contrastText,
    '&:hover': {
      backgroundColor: alpha(theme.palette.primary.contrastText, 0.12),
    },
  },
});

declare module '@mui/material/styles' {
  interface SurfacePalette {
    rootBackground: string;
    appBackground: string;
    sidebarBackground: string;
    topbarBackground: string;
    contentBackground: string;
    surfaceBackground: string;
    surfaceSubtleBackground: string;
    surfaceHoverBackground: string;
    surfaceBorder: string;
    surfaceSoftBorder: string;
  }

  interface ChartPalette {
    /** Muted accent for the yield chart's calendar-year-boundary marker.
     * Deliberately outside the crop series palette. */
    yearBoundary: string;
  }

  interface Palette {
    surface: SurfacePalette;
    chart: ChartPalette;
    navigation: {
      inactiveText: string;
      inactiveIcon: string;
      inactiveHoverText: string;
      inactiveHoverIcon: string;
      hoverBackground: string;
      hoverBorder: string;
      activeText: string;
      activeIcon: string;
      activeBackground: string;
      activeHoverBackground: string;
      activeBorder: string;
      activeHoverBorder: string;
      activeAccent: string;
      focusRing: string;
      tooltipBackground: string;
    };
  }

  interface PaletteOptions {
    surface?: SurfacePalette;
    chart?: ChartPalette;
    navigation?: {
      inactiveText: string;
      inactiveIcon: string;
      inactiveHoverText: string;
      inactiveHoverIcon: string;
      hoverBackground: string;
      hoverBorder: string;
      activeText: string;
      activeIcon: string;
      activeBackground: string;
      activeHoverBackground: string;
      activeBorder: string;
      activeHoverBorder: string;
      activeAccent: string;
      focusRing: string;
      tooltipBackground: string;
    };
  }
}

const theme = createTheme({
  typography: {
    h5: {
      fontWeight: 600,
    },
    h6: {
      fontWeight: 600,
    },
    subtitle1: {
      fontWeight: 600,
    },
    subtitle2: {
      fontWeight: 600,
    },
    body1: {
      fontWeight: 400,
    },
    body2: {
      fontWeight: 400,
    },
    caption: {
      fontWeight: 400,
    },
  },
  palette: {
    // Primary color used by contained buttons and primary components
    primary: {
      main: '#256f2a',
      dark: '#1b5e20',
      light: '#4f9853',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#256f2a',
      dark: '#1b5e20',
      light: '#4f9853',
      contrastText: '#ffffff',
    },
    text: {
      primary: '#213547',
    },
    error: {
      main: '#d32f2f',
    },
    background: {
      default: surfaceColors.appBackground,
      paper: surfaceColors.surfaceBackground,
    },
    surface: surfaceColors,
    chart: {
      yearBoundary: '#94a3b8',
    },
    navigation: {
      inactiveText: '#000000',
      inactiveIcon: '#000000',
      inactiveHoverText: '#000000',
      inactiveHoverIcon: '#000000',
      hoverBackground: 'rgba(76, 135, 86, 0.07)',
      hoverBorder: 'rgba(76, 135, 86, 0.12)',
      activeText: '#1f6224',
      activeIcon: '#1f6224',
      activeBackground: 'rgba(76, 135, 86, 0.13)',
      activeHoverBackground: 'rgba(76, 135, 86, 0.17)',
      activeBorder: 'rgba(76, 135, 86, 0.16)',
      activeHoverBorder: 'rgba(76, 135, 86, 0.24)',
      activeAccent: 'rgba(31, 98, 36, 0.58)',
      focusRing: 'rgba(80, 130, 90, 0.22)',
      tooltipBackground: '#1f2a24',
    },
  },
  shape: {
    // Global border radius (affects Button, TextField, etc.)
    borderRadius: 4,
  },
  components: {

    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        ':root': {
          color: theme.palette.text.primary,
          backgroundColor: theme.palette.surface.rootBackground,
        },
        body: {
          minWidth: theme.spacing(40),
        },
        a: {
          color: theme.palette.primary.main,
          '&:hover, &:focus-visible, &:active, &:visited': {
            color: theme.palette.primary.dark,
          },
        },
        // Baseline visible-focus ring for anything that doesn't already get
        // one from a component-specific override below (custom focus
        // regions, chart bars, gantt tasks, etc.) — part of the keyboard
        // navigation architecture (see docs/keyboard-architecture.md): the
        // user must always be able to see which area/element is active.
        ':focus-visible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
        // Focus regions (see src/focus/FocusManager.tsx) may be focused
        // programmatically as F6 fallback targets. Only show the region ring
        // when FocusManager explicitly marks that case; pointer focus on
        // layout containers must remain invisible. The browser's own
        // focus-visible heuristic still matches these containers on a plain
        // mouse click (they're non-interactive divs) and, worse, when a
        // route change unmounts the previously focused descendant and focus
        // implicitly lands back on the container — neither case goes through
        // FocusManager, so the baseline rule above must be overridden here.
        '.ofp-focus-region:focus-visible': {
          outline: 'none',
        },
        '.ofp-focus-region[data-ofp-focus-region-visible="true"]:focus': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      }),
    },

    MuiDialogContent: {
      styleOverrides: {
        root: {
          backgroundColor: surfaceColors.surfaceBackground,
          '.MuiDialogTitle-root + &': {
            paddingTop: 12,
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        // Apply consistent padding and disable uppercase labels
        root: {
          padding: '8px 24px',
          textTransform: 'none',
          textDecoration: 'none',
          fontSize: '0.95rem',
          fontWeight: 600,
          lineHeight: 1.3,
          '&:hover, &:focus, &:focus-visible, &:active, &:visited': {
            textDecoration: 'none',
          },
        },
        outlined: ({ theme }: { theme: Theme }) => ({
          color: theme.palette.primary.main,
          borderColor: theme.palette.primary.main,
          '&:hover': {
            color: theme.palette.primary.dark,
            borderColor: theme.palette.primary.dark,
            backgroundColor: alpha(theme.palette.primary.main, 0.08),
          },
          '&:visited': {
            color: theme.palette.primary.main,
          },
          '&.Mui-focusVisible': {
            color: theme.palette.primary.dark,
            borderColor: theme.palette.primary.dark,
            outline: `2px solid ${theme.palette.primary.light}`,
            outlineOffset: 2,
          },
          '&:active': {
            color: theme.palette.primary.dark,
            borderColor: theme.palette.primary.dark,
            backgroundColor: alpha(theme.palette.primary.main, 0.12),
          },
          '&.Mui-disabled': {
            borderColor: theme.palette.action.disabledBackground,
            color: theme.palette.action.disabled,
          },
        }),
        startIcon: {
          display: 'inline-flex',
          alignItems: 'center',
        },
        endIcon: {
          display: 'inline-flex',
          alignItems: 'center',
        },
      },
      // MUI v9 no longer generates compound variant+color utility classes
      // (e.g. `containedPrimary`, `outlinedSecondary`), so overrides that
      // target a specific variant/color combination must be expressed as
      // `variants` entries instead of `styleOverrides` keys.
      variants: [
        {
          props: { variant: 'contained', color: 'primary' },
          style: ({ theme }: { theme: Theme }) => ({
            color: theme.palette.primary.contrastText,
            backgroundColor: theme.palette.primary.main,
            '&:hover': {
              color: theme.palette.primary.contrastText,
              backgroundColor: theme.palette.primary.dark,
            },
            '&:visited': {
              color: theme.palette.primary.contrastText,
            },
            '&.Mui-focusVisible': {
              color: theme.palette.primary.contrastText,
              outline: `2px solid ${theme.palette.primary.light}`,
              outlineOffset: 2,
            },
            '&:active': {
              color: theme.palette.primary.contrastText,
              backgroundColor: theme.palette.primary.dark,
            },
            '&.Mui-disabled': {
              color: theme.palette.action.disabled,
            },
          }),
        },
        {
          props: { variant: 'outlined', color: 'secondary' },
          style: ({ theme }: { theme: Theme }) => ({
            color: theme.palette.secondary.main,
            borderColor: theme.palette.secondary.main,
            '&:hover': {
              color: theme.palette.secondary.dark,
              borderColor: theme.palette.secondary.dark,
              backgroundColor: alpha(theme.palette.secondary.main, 0.08),
            },
            '&:visited': {
              color: theme.palette.secondary.main,
            },
            '&.Mui-focusVisible': {
              color: theme.palette.secondary.dark,
              borderColor: theme.palette.secondary.dark,
              outline: `2px solid ${theme.palette.secondary.light}`,
              outlineOffset: 2,
            },
            '&:active': {
              color: theme.palette.secondary.dark,
              borderColor: theme.palette.secondary.dark,
              backgroundColor: alpha(theme.palette.secondary.main, 0.12),
            },
            '&.Mui-disabled': {
              borderColor: theme.palette.action.disabledBackground,
              color: theme.palette.action.disabled,
            },
          }),
        },
        {
          props: { variant: 'outlined', color: 'error' },
          style: ({ theme }: { theme: Theme }) => ({
            color: theme.palette.error.main,
            borderColor: theme.palette.error.main,
            '&:hover': {
              color: theme.palette.error.dark,
              borderColor: theme.palette.error.dark,
              backgroundColor: alpha(theme.palette.error.main, 0.08),
            },
            '&:visited': {
              color: theme.palette.error.main,
            },
            '&.Mui-focusVisible': {
              color: theme.palette.error.dark,
              borderColor: theme.palette.error.dark,
              outline: `2px solid ${theme.palette.error.light}`,
              outlineOffset: 2,
            },
            '&:active': {
              color: theme.palette.error.dark,
              borderColor: theme.palette.error.dark,
              backgroundColor: alpha(theme.palette.error.main, 0.12),
            },
            '&.Mui-disabled': {
              borderColor: theme.palette.action.disabledBackground,
              color: theme.palette.action.disabled,
            },
          }),
        },
      ],
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: ({ theme }) => ({
          backgroundColor: theme.palette.navigation.tooltipBackground,
          color: theme.palette.primary.contrastText,
          fontSize: '0.8125rem',
          lineHeight: 1.45,
          padding: '10px 12px',
          maxWidth: 320,
          borderRadius: 4,
          '& .MuiTypography-caption': {
            fontSize: 'inherit',
            lineHeight: 'inherit',
          },
        }),
        arrow: ({ theme }) => ({
          color: theme.palette.navigation.tooltipBackground,
        }),
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
        outlined: {
          borderColor: surfaceColors.surfaceSoftBorder,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: surfaceColors.surfaceBackground,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: surfaceColors.surfaceBackground,
        },
      },
    },
    MuiListItemText: {
      styleOverrides: {
        primary: {
          fontWeight: 400,
        },
        secondary: {
          fontWeight: 400,
          color: 'rgba(47, 58, 51, 0.66)',
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        // Subtle floating shadow to compensate for the backgrounds below no
        // longer being transparent — keeps the "light" toast look.
        root: {
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        },
      },
      // MUI v9 no longer generates compound variant+color utility classes
      // (e.g. `filledInfo`, `standardSuccess`), so these must be expressed
      // as `variants` entries instead of `styleOverrides` keys.
      //
      // Match on Alert's own `color ?? severity` resolution, not a bare
      // `color` prop: every caller here only ever passes `severity`, so
      // `ownerState.color` stays undefined and a `color`-keyed variant
      // never matches. Matching on `color` here silently broke every
      // custom Alert color since the v9 migration (all alerts fell back
      // to MUI's stock palette) because `variants` prop-matching can only
      // see public `AlertProps` fields, not Alert's internal derived
      // `colorSeverity` ownerState field.
      variants: (
        [
          ['filled', 'info', ({ theme }: { theme: Theme }) => createPositiveFilledAlertStyles(theme)],
          ['filled', 'success', ({ theme }: { theme: Theme }) => createPositiveFilledAlertStyles(theme)],
          ['standard', 'info', ({ theme }: { theme: Theme }) => ({
            backgroundColor: flattenOnWhite(theme.palette.primary.main, 0.08),
            color: theme.palette.primary.dark,
            '& .MuiAlert-icon': {
              color: theme.palette.primary.main,
            },
          })],
          ['standard', 'success', {
            backgroundColor: flattenOnWhite('#4caf50', 0.1),
            color: '#2f5a35',
          }],
          ['standard', 'warning', {
            backgroundColor: flattenOnWhite('#ed6c02', 0.1),
            color: '#75491e',
          }],
          ['standard', 'error', {
            backgroundColor: flattenOnWhite('#d32f2f', 0.09),
            color: '#6e2c2c',
          }],
        ] as const
      ).map(([variant, colorSeverity, style]) => ({
        props: (props: { variant?: string; color?: string; severity?: string }) => (
          props.variant === variant && (props.color ?? props.severity) === colorSeverity
        ),
        style,
      })),
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 600,
        },
        body: {
          fontWeight: 400,
        },
      },
    },
    MuiDataGrid: {
      styleOverrides: {
        columnHeaderTitle: {
          fontWeight: 600,
        },
        cell: {
          fontWeight: 400,
        },
      },
    },
  },
});

export default theme;
