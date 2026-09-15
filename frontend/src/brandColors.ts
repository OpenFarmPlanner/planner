/**
 * The two brand colours that exist outside the MUI theme as well as inside it.
 *
 * `theme.ts` stays the single styling system for the app — these constants are
 * only extracted because the web app manifest is generated in `vite.config.ts`
 * (Node, no MUI) and must not drift from the running theme. Everything else
 * that needs a colour reads it from the theme, never from here.
 */

/** `palette.primary.main` — also the manifest's `theme_color`. */
export const BRAND_PRIMARY_MAIN = '#256f2a';

/** `palette.surface.rootBackground` — also the manifest's `background_color`. */
export const BRAND_ROOT_BACKGROUND = '#f7f6f1';
