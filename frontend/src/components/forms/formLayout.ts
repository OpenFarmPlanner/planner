import type { SxProps, Theme } from '@mui/material/styles';

export const formRowSx = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 1,
  alignItems: 'flex-start',
} as const;

// The roles below land on the field's own FormControl, a column flexbox. They
// must not set `alignItems`: anything but the default `stretch` makes the
// outlined input shrink-wrap to the native <input>'s intrinsic width, which
// differs per browser engine and font (and collapses for number inputs with a
// `max`), instead of filling the role width.
const responsiveFieldWidth = (desktopWidth: number) => ({
  width: { xs: '100%', sm: desktopWidth },
  maxWidth: { xs: '100%', sm: desktopWidth },
  flex: { xs: '1 1 100%', sm: `0 1 ${desktopWidth}px` },
  minWidth: 0,
} as const);

const stackedFieldWidth = (desktopWidth: number) => ({
  width: { xs: '100%', sm: desktopWidth },
  maxWidth: '100%',
  minWidth: 0,
} as const);

/** Numbers, dates, versions, priorities, and other short values. */
export const compactFieldSx = responsiveFieldWidth(180);

/** Short option sets such as status, units, and cultivation methods. */
export const smallFieldSx = responsiveFieldWidth(224);

/** Column-stacked variant of `smallFieldSx` without a flex-basis height. */
export const smallStackedFieldSx = stackedFieldWidth(224);

/** Families, suppliers, coordinates, and other moderately long values. */
export const mediumFieldSx = responsiveFieldWidth(300);

/** Column-stacked variant of `mediumFieldSx` without a flex-basis height. */
export const mediumStackedFieldSx = stackedFieldWidth(300);

/** Names, email addresses, URLs, and other potentially long single-line values. */
export const wideFieldSx = responsiveFieldWidth(400);

/** Column-stacked variant of `wideFieldSx` without a flex-basis height. */
export const wideSingleColumnFieldSx = stackedFieldWidth(400);

/**
 * Multiline fields stacked vertically (not inside `formRowSx`'s row flex).
 * Plain width/maxWidth only - the `flex` shorthand from `responsiveFieldWidth`
 * sets the *main-axis* size, which is height inside a column Stack, and would
 * stretch a multiline field's box to that height instead of constraining its width.
 */
export const wideStackedFieldSx = {
  width: { xs: '100%', sm: 460 },
  maxWidth: '100%',
} as const;

/** Descriptions, notes, comments, and fields that deliberately span their row. */
export const fullWidthFieldSx = {
  width: '100%',
  maxWidth: '100%',
  minWidth: 0,
  flex: '1 1 100%',
} as const;

/**
 * Responsive form grid: one column on a phone, three equal columns from `sm`
 * up. The tracks are fixed, so a short field keeps its column width and every
 * row and section of a form lines up, even when a row has fewer than three
 * fields. Children fill their cell (`formGridFieldSx`) or span columns.
 */
export const formGridSx: SxProps<Theme> = (theme) => ({
  display: 'grid',
  gap: theme.spacing(1.5),
  alignItems: 'start',
  gridTemplateColumns: 'minmax(0, 1fr)',
  [theme.breakpoints.up('sm')]: {
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  },
});

/** A field inside `formGridSx`: fills its cell. */
export const formGridFieldSx = {
  width: '100%',
  maxWidth: '100%',
  minWidth: 0,
} as const;

/** A field inside `formGridSx` that spans the full row (e.g. tags, long text). */
export const formGridFullRowSx = {
  ...formGridFieldSx,
  gridColumn: '1 / -1',
} as const;

/** A field inside `formGridSx` spanning two of the three desktop columns. */
export const formGridDoubleColumnSx = {
  ...formGridFieldSx,
  gridColumn: { xs: 'auto', sm: 'span 2' },
} as const;
